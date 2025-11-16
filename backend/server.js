const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
// CORS: Use environment variable in production, allow all in development
const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));

// Socket.io CORS: Use same origin as Express CORS
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

// Test endpoint to verify backend is accessible from other computers
app.get("/api/test", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Backend API is accessible",
    timestamp: new Date().toISOString(),
    clientIp: req.ip || req.connection.remoteAddress,
    serverTime: new Date().toISOString()
  });
});

// MongoDB configuration - uses separate database "timebank" (not "test")
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "timebank"; // Separate database for this project

// MongoDB connection
let db = null;
let listingsCollection = null;
let chatMessagesCollection = null;

// Connect to MongoDB
async function connectMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    listingsCollection = db.collection("listings");
    chatMessagesCollection = db.collection("chatMessages");
    
    // Create indexes for better performance
    await listingsCollection.createIndex({ owner: 1 });
    await listingsCollection.createIndex({ createdAt: -1 });
    await chatMessagesCollection.createIndex({ roomId: 1, timestamp: 1 });
    await chatMessagesCollection.createIndex({ roomId: 1 });
    
    console.log(`[MongoDB] Connected to database: ${DB_NAME}`);
  } catch (error) {
    console.error("[MongoDB] Connection failed:", error.message);
    console.warn("[MongoDB] Will continue without database - some features may not work");
  }
}

// Initialize MongoDB connection
connectMongoDB();


app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Get listings status
app.get("/api/listings/status", async (_req, res) => {
  try {
    const count = listingsCollection ? await listingsCollection.countDocuments() : 0;
    res.json({
      count,
      database: listingsCollection ? "MongoDB" : "Not connected",
    });
  } catch (error) {
    res.json({
      count: 0,
      database: "Error",
      error: error.message,
    });
  }
});

// Test MongoDB connection
app.get("/api/test-db", async (_req, res) => {
  try {
    if (!listingsCollection) {
      return res.status(500).json({ 
        error: "MongoDB not connected",
        database: DB_NAME
      });
    }
    
    const count = await listingsCollection.countDocuments();
    return res.json({
      success: true,
      connected: true,
      database: DB_NAME,
      listingsCount: count,
      message: "MongoDB connection successful"
    });
  } catch (error) {
    return res.status(500).json({
      error: "MongoDB connection failed",
      message: error.message
    });
  }
});

// Get all listings from MongoDB
async function getAllListingsFromDB() {
  if (!listingsCollection) {
    console.warn("[Listings] MongoDB not connected, returning empty array");
    return [];
  }
  
  try {
    const listings = await listingsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    
    // Convert MongoDB _id to string and ensure all fields are present
    return listings.map(listing => ({
      cid: listing.cid || listing._id.toString(),
      title: listing.title || "Untitled Service",
      description: listing.description || "",
      category: listing.category || "",
      ratePerHour: listing.ratePerHour || 1,
      contactMethod: listing.contactMethod || "",
      skills: Array.isArray(listing.skills) ? listing.skills : [],
      createdAt: listing.createdAt || listing.timestamp || new Date().toISOString(),
      owner: listing.owner || "unknown",
    }));
  } catch (error) {
    console.error("[Listings] Failed to fetch from MongoDB:", error.message);
    return [];
  }
}

// Save listing to MongoDB
async function saveListingToDB(listingData) {
  if (!listingsCollection) {
    throw new Error("MongoDB not connected");
  }
  
  try {
    const listing = {
      title: listingData.title || "Untitled Service",
      description: listingData.description || "",
      category: listingData.category || "",
      ratePerHour: listingData.ratePerHour || 1,
      contactMethod: listingData.contactMethod || "",
      skills: Array.isArray(listingData.skills) ? listingData.skills : [],
      owner: listingData.owner || "unknown",
      createdAt: new Date(),
      timestamp: new Date().toISOString(),
    };
    
    // Save to MongoDB
    const result = await listingsCollection.insertOne(listing);
    listing._id = result.insertedId;
    listing.cid = result.insertedId.toString();
    
    console.log(`[Listings] Saved to MongoDB: ${listing.title} (ID: ${result.insertedId})`);
    
    return listing;
  } catch (error) {
    console.error("[Listings] Failed to save to MongoDB:", error.message);
    throw error;
  }
}

app.get("/api/listings", async (req, res) => {
  try {
    // Always fetch from MongoDB (fast and reliable)
    const listings = await getAllListingsFromDB();
    console.log(`[Listings] GET /api/listings - Returning ${listings.length} listings from MongoDB`);
    res.json({ listings });
  } catch (error) {
    console.error("[Listings] GET /api/listings error:", error.message);
    res.status(500).json({ 
      listings: [], 
      error: "Failed to fetch listings",
      message: error.message 
    });
  }
});

// Refresh listings cache manually (MongoDB is always fresh, but this endpoint remains for compatibility)
app.post("/api/listings/refresh", async (_req, res) => {
  try {
    console.log("[Listings] Manual refresh requested...");
    const listings = await getAllListingsFromDB();
    console.log(`[Listings] Refresh completed: ${listings.length} listings from MongoDB`);
    return res.json({ 
      success: true, 
      count: listings.length, 
      message: `Refreshed ${listings.length} listing(s) from MongoDB` 
    });
  } catch (error) {
    console.error("[Listings] Refresh failed:", error.message);
    return res.status(500).json({ 
      error: "Failed to refresh listings", 
      details: error.message
    });
  }
});

// Get all conversations for a user from MongoDB
app.get("/api/chat/conversations/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    console.log(`[Chat] Fetching conversations for ${userAddress} from MongoDB`);
    
    const conversations = await getUserConversationsFromDB(userAddress);
    console.log(`[Chat] Found ${conversations.length} conversations for ${userAddress}`);
    
    return res.json({ conversations });
  } catch (error) {
    console.error("[Chat] Failed to get conversations:", error.message);
    return res.json({ conversations: [] });
  }
});

// Delete a listing from MongoDB
app.delete("/api/listings/:cid", async (req, res) => {
  if (!listingsCollection) {
    return res.status(500).json({ error: "MongoDB not connected" });
  }

  const { cid } = req.params;
  const { owner } = req.body; // Optional: verify ownership

  try {
    // Find listing in MongoDB
    const listing = await listingsCollection.findOne({ 
      $or: [{ cid: cid }, { _id: cid }] 
    });

    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }

    // Verify ownership if owner is provided
    if (owner && listing.owner && listing.owner !== "unknown") {
      if (listing.owner.toLowerCase() !== owner.toLowerCase()) {
        return res.status(403).json({ error: "You can only delete your own listings" });
      }
    }

    // Delete from MongoDB
    await listingsCollection.deleteOne({ 
      $or: [{ cid: cid }, { _id: cid }] 
    });
    
    console.log(`[Listings] Deleted listing: ${listing.title} (ID: ${cid})`);
    return res.json({ success: true, message: "Listing deleted" });
  } catch (error) {
    console.error("[Listings] Delete failed:", error.message);
    return res.status(500).json({ error: "Failed to delete listing", details: error.message });
  }
});

app.post("/api/listings", async (req, res) => {
  if (!listingsCollection) {
    return res.status(500).json({ error: "MongoDB not connected" });
  }

  const {
    title = "Untitled Service",
    description = "",
    category = "",
    ratePerHour = 1,
    contactMethod = "",
    skills = [],
    owner = "unknown",
  } = req.body || {};

  try {
    const listingData = {
      title,
      description,
      category,
      ratePerHour,
      contactMethod,
      skills,
      owner,
    };

    const savedListing = await saveListingToDB(listingData);
    
    return res.json({
      cid: savedListing.cid,
      listing: savedListing,
    });
  } catch (error) {
    console.error("[Listings] Failed to create listing:", error.message);
    return res.status(500).json({ 
      error: "Failed to create listing", 
      details: error.message 
    });
  }
});

// Chat message storage - MongoDB only
const chatRoomsCache = new Map(); // roomId -> messages[] (in-memory cache for real-time)
const onlineUsers = new Map(); // userAddress -> { socketIds: Set, lastSeen: timestamp }
const typingUsers = new Map(); // roomId -> Set<userAddress> (users currently typing)

// Save chat message to MongoDB
async function saveChatMessageToDB(roomId, messageObj) {
  if (!chatMessagesCollection) {
    console.warn("[Chat] MongoDB not connected, message not persisted");
    return false;
  }

  try {
    await chatMessagesCollection.insertOne({
      roomId,
      ...messageObj,
      timestamp: new Date(messageObj.timestamp || new Date()),
    });
    return true;
  } catch (error) {
    console.error("[Chat] Failed to save message to MongoDB:", error.message);
    return false;
  }
}

// Load chat messages from MongoDB
async function loadChatFromDB(roomId) {
  if (!chatMessagesCollection) {
    return [];
  }

  try {
    const messages = await chatMessagesCollection
      .find({ roomId })
      .sort({ timestamp: 1 })
      .toArray();
    
    // Remove MongoDB _id and return clean message objects
    return messages.map(msg => {
      const { _id, roomId: _, ...messageObj } = msg;
      return messageObj;
    });
  } catch (error) {
    console.error("[Chat] Failed to load from MongoDB:", error.message);
    return [];
  }
}

// Get all conversations for a user from MongoDB
async function getUserConversationsFromDB(userAddress) {
  if (!chatMessagesCollection) {
    return [];
  }

  try {
    // Get all unique roomIds where this user is a participant
    const rooms = await chatMessagesCollection.distinct("roomId", {
      $or: [
        { sender: userAddress.toLowerCase() },
        { "roomId": { $regex: userAddress.toLowerCase() } }
      ]
    });

    const conversations = [];
    for (const roomId of rooms) {
      const [user1, user2] = roomId.split("_");
      if (!user1 || !user2) continue;
      
      const otherUser = user1.toLowerCase() === userAddress.toLowerCase() ? user2 : user1;
      
      // Get last message
      const lastMessage = await chatMessagesCollection
        .findOne(
          { roomId },
          { sort: { timestamp: -1 } }
        );

      if (lastMessage) {
        const { _id, roomId: _, ...lastMsg } = lastMessage;
        conversations.push({
          roomId,
          otherUser,
          lastMessage: lastMsg,
          lastUpdated: lastMessage.timestamp,
          messageCount: await chatMessagesCollection.countDocuments({ roomId }),
        });
      }
    }

    // Sort by last updated
    conversations.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    return conversations;
  } catch (error) {
    console.error("[Chat] Failed to get conversations from MongoDB:", error.message);
    return [];
  }
}


// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Track online status
  socket.on("user-online", (userAddress) => {
    if (!userAddress) return;
    
    const normalizedAddress = userAddress.toLowerCase();
    if (!onlineUsers.has(normalizedAddress)) {
      onlineUsers.set(normalizedAddress, { socketIds: new Set(), lastSeen: Date.now() });
    }
    onlineUsers.get(normalizedAddress).socketIds.add(socket.id);
    onlineUsers.get(normalizedAddress).lastSeen = Date.now();
    socket.data.userAddress = normalizedAddress;
    
    // Notify all rooms this user is in that they're online
    socket.rooms.forEach(roomId => {
      if (roomId !== socket.id) {
        io.to(roomId).emit("user-status", { userAddress: normalizedAddress, status: "online" });
      }
    });
    
    console.log(`[Status] User ${normalizedAddress} is now online (socket: ${socket.id})`);
  });

  // Join a chat room (roomId is typically: user1_user2 sorted alphabetically)
  socket.on("join-room", async (roomId, userAddress) => {
    if (!roomId || !userAddress) {
      console.warn("[Chat] Invalid join-room request:", { roomId, userAddress });
      return;
    }
    
    const normalizedAddress = userAddress.toLowerCase();
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userAddress = normalizedAddress;
    
    console.log(`[Chat] ✅ User ${normalizedAddress} joined room ${roomId} (socket: ${socket.id})`);
    console.log(`[Chat] Room ${roomId} now has ${io.sockets.adapter.rooms.get(roomId)?.size || 0} users`);
    
    // Track online status FIRST (before checking other user's status)
    if (!onlineUsers.has(normalizedAddress)) {
      onlineUsers.set(normalizedAddress, { socketIds: new Set(), lastSeen: Date.now() });
    }
    onlineUsers.get(normalizedAddress).socketIds.add(socket.id);
    onlineUsers.get(normalizedAddress).lastSeen = Date.now();
    console.log(`[Status] ✅ Marked ${normalizedAddress} as online (total sockets: ${onlineUsers.get(normalizedAddress).socketIds.size})`);
    
    // Notify ALL users in room (including self) that this user is online
    io.to(roomId).emit("user-status", { userAddress: normalizedAddress, status: "online" });
    console.log(`[Status] ✅ Broadcasted online status for ${normalizedAddress} to room ${roomId}`);
    
    // Load messages from MongoDB (fast and reliable)
    const dbMessages = await loadChatFromDB(roomId);
    
    if (dbMessages.length > 0) {
      // Update cache with DB messages
      chatRoomsCache.set(roomId, dbMessages);
      console.log(`[Chat] 📜 Loaded ${dbMessages.length} messages from MongoDB for room ${roomId}`);
      socket.emit("chat-history", dbMessages);
    } else {
      // No messages in DB, initialize empty cache
      chatRoomsCache.set(roomId, []);
      console.log(`[Chat] No messages found in MongoDB for room ${roomId}`);
      socket.emit("chat-history", []);
    }
    
    // Send online status of other user - check ALL sockets in the room
    const [user1, user2] = roomId.split("_");
    if (user1 && user2) {
      const otherUser = user1.toLowerCase() === normalizedAddress ? user2.toLowerCase() : user1.toLowerCase();
      
      // Check if other user is in the room by checking all sockets in the room
      const room = io.sockets.adapter.rooms.get(roomId);
      let otherUserOnline = false;
      
      if (room) {
        // Check all sockets in the room to see if any belong to the other user
        for (const socketId of room) {
          const otherSocket = io.sockets.sockets.get(socketId);
          if (otherSocket && otherSocket.data.userAddress === otherUser) {
            otherUserOnline = true;
            break;
          }
        }
      }
      
      // Also check onlineUsers map as backup
      if (!otherUserOnline && onlineUsers.has(otherUser) && onlineUsers.get(otherUser).socketIds.size > 0) {
        otherUserOnline = true;
      }
      
      if (otherUserOnline) {
        socket.emit("user-status", { userAddress: otherUser, status: "online" });
        console.log(`[Status] ✅ Notified ${normalizedAddress} that ${otherUser} is online`);
      } else {
        socket.emit("user-status", { userAddress: otherUser, status: "offline" });
        console.log(`[Status] ⚠️ Notified ${normalizedAddress} that ${otherUser} is offline (not in room)`);
      }
      
      // Also re-broadcast other user's status to the room after a short delay (in case they just joined)
      setTimeout(() => {
        const room = io.sockets.adapter.rooms.get(roomId);
        let otherUserOnlineNow = false;
        if (room) {
          for (const socketId of room) {
            const otherSocket = io.sockets.sockets.get(socketId);
            if (otherSocket && otherSocket.data.userAddress === otherUser) {
              otherUserOnlineNow = true;
              break;
            }
          }
        }
        if (otherUserOnlineNow) {
          io.to(roomId).emit("user-status", { userAddress: otherUser, status: "online" });
          console.log(`[Status] ✅ Re-broadcasted online status for ${otherUser} after delay`);
        }
      }, 500);
    }
    
    console.log(`[Chat] ✅ Setup complete for ${normalizedAddress} in room ${roomId}`);
  });

  // Handle typing indicators
  socket.on("typing-start", (data) => {
    const { roomId, userAddress } = data;
    if (!typingUsers.has(roomId)) {
      typingUsers.set(roomId, new Set());
    }
    typingUsers.get(roomId).add(userAddress);
    socket.to(roomId).emit("typing", { userAddress, typing: true });
  });

  socket.on("typing-stop", (data) => {
    const { roomId, userAddress } = data;
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(userAddress);
      if (typingUsers.get(roomId).size === 0) {
        typingUsers.delete(roomId);
      }
    }
    socket.to(roomId).emit("typing", { userAddress, typing: false });
  });

  // Handle chat messages - INSTANT delivery via socket.io
  socket.on("chat-message", async (data) => {
    const { roomId, message, sender, timestamp, type = "text" } = data;
    
    if (!roomId || !sender || !message) {
      console.warn("[Chat] ❌ Invalid message data:", data);
      return;
    }
    
    const normalizedSender = sender.toLowerCase();
    console.log(`[Chat] 📨 Received message from ${normalizedSender} in room ${roomId}: "${message.substring(0, 50)}..."`);
    
    // Stop typing indicator
    if (typingUsers.has(roomId)) {
      typingUsers.get(roomId).delete(normalizedSender);
      io.to(roomId).emit("typing", { userAddress: normalizedSender, typing: false });
    }
    
    if (!chatRoomsCache.has(roomId)) {
      chatRoomsCache.set(roomId, []);
    }
    
    const messageObj = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      message,
      sender: normalizedSender,
      timestamp: timestamp || new Date().toISOString(),
      type, // 'text', 'video-call', 'system'
    };
    
    const messages = chatRoomsCache.get(roomId);
    messages.push(messageObj);
    chatRoomsCache.set(roomId, messages);
    
    // Get room info
    const room = io.sockets.adapter.rooms.get(roomId);
    const userCount = room ? room.size : 0;
    console.log(`[Chat] 📢 Broadcasting message to room ${roomId}`);
    console.log(`[Chat] 👥 Room has ${userCount} connected user(s)`);
    
    if (userCount === 0) {
      console.warn(`[Chat] ⚠️ WARNING: Room ${roomId} has NO connected users! Message will not be delivered.`);
      console.warn(`[Chat] ⚠️ The other user must open the chat and join the room to receive messages.`);
    }
    
    // INSTANT delivery via socket.io (real-time) - broadcast to ALL users in room
    io.to(roomId).emit("chat-message", messageObj);
    console.log(`[Chat] ✅ Message broadcasted to ${userCount} user(s) in room ${roomId}`);
    
    // Save to MongoDB in background (fast and reliable, doesn't block delivery)
    saveChatMessageToDB(roomId, messageObj).then(success => {
      if (success) {
        console.log(`[Chat] 💾 Message saved to MongoDB`);
      }
    }).catch(err => {
      console.error("[Chat] ❌ Failed to save message to MongoDB:", err.message);
    });
  });

  // Handle video call end with duration
  socket.on("video-call-ended", async (data) => {
    const { roomId, duration, sender } = data; // duration in seconds
    
    if (!chatRoomsCache.has(roomId)) {
      chatRoomsCache.set(roomId, []);
    }
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const durationText = minutes > 0 
      ? `${minutes}m ${seconds}s` 
      : `${seconds}s`;
    
    const messageObj = {
      id: Date.now().toString(),
      message: `Video call ended - Duration: ${durationText}`,
      sender: "system",
      timestamp: new Date().toISOString(),
      type: "video-call",
      duration,
    };
    
    const messages = chatRoomsCache.get(roomId);
    messages.push(messageObj);
    chatRoomsCache.set(roomId, messages);
    
    // Broadcast to all users in the room
    io.to(roomId).emit("chat-message", messageObj);
    
    // Save to MongoDB
    saveChatMessageToDB(roomId, messageObj).then(success => {
      if (success) {
        console.log(`[Chat] Video call duration saved to MongoDB`);
      }
    }).catch(err => {
      console.error("[Chat] Failed to save video call duration to MongoDB:", err.message);
    });
  });

  // WebRTC signaling - offer
  socket.on("webrtc-offer", (data) => {
    const { roomId, offer, sender } = data;
    socket.to(roomId).emit("webrtc-offer", { offer, sender });
  });

  // WebRTC signaling - answer
  socket.on("webrtc-answer", (data) => {
    const { roomId, answer, sender } = data;
    socket.to(roomId).emit("webrtc-answer", { answer, sender });
  });

  // WebRTC signaling - ICE candidate
  socket.on("webrtc-ice-candidate", (data) => {
    const { roomId, candidate, sender } = data;
    socket.to(roomId).emit("webrtc-ice-candidate", { candidate, sender });
  });

  // Video call status
  socket.on("video-call-status", (data) => {
    const { roomId, status, sender } = data; // status: 'calling', 'ringing', 'answered', 'ended'
    if (!roomId || !status || !sender) {
      console.warn("[VideoCall] ❌ Invalid video-call-status data:", data);
      return;
    }
    const normalizedSender = sender.toLowerCase();
    console.log(`[VideoCall] 📞 Status update: ${status} in room ${roomId} from ${normalizedSender}`);
    
    // Get room info
    const room = io.sockets.adapter.rooms.get(roomId);
    const userCount = room ? room.size : 0;
    console.log(`[VideoCall] 👥 Room ${roomId} has ${userCount} connected user(s)`);
    
    if (userCount === 0) {
      console.warn(`[VideoCall] ⚠️ WARNING: Room ${roomId} has NO connected users! Call notification will not be delivered.`);
      console.warn(`[VideoCall] ⚠️ The other user must be on the Marketplace page to receive call notifications.`);
    }
    
    // Broadcast to ALL users in room (including sender for consistency, frontend will filter)
    // Include roomId in the response so frontend can verify
    io.to(roomId).emit("video-call-status", { status, sender: normalizedSender, roomId });
    console.log(`[VideoCall] ✅ Call status broadcasted to ${userCount} user(s) in room ${roomId}`);
  });

  // Disconnect
  socket.on("disconnect", () => {
    const userAddress = socket.data.userAddress;
    const roomId = socket.data.roomId;
    
    if (userAddress && onlineUsers.has(userAddress)) {
      onlineUsers.get(userAddress).socketIds.delete(socket.id);
      
      // If no more sockets for this user, mark as offline
      if (onlineUsers.get(userAddress).socketIds.size === 0) {
        // Notify all rooms this user was in that they're offline
        if (roomId) {
          io.to(roomId).emit("user-status", { userAddress, status: "offline" });
          console.log(`[Status] User ${userAddress} is now offline (no active sockets)`);
        }
        // Also check all rooms this user might be in
        socket.rooms.forEach(room => {
          if (room !== socket.id) {
            io.to(room).emit("user-status", { userAddress, status: "offline" });
          }
        });
      }
    }
    
    // Remove typing indicator
    if (roomId && typingUsers.has(roomId)) {
      if (userAddress) {
        typingUsers.get(roomId).delete(userAddress);
        io.to(roomId).emit("typing", { userAddress, typing: false });
      }
    }
    
    console.log(`[Disconnect] User disconnected: ${socket.id} (user: ${userAddress || 'unknown'})`);
  });
});

const PORT = process.env.PORT || 4000;
// Listen on all network interfaces (0.0.0.0) so other computers can connect
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TimeBank backend running on port ${PORT}`);
  console.log(`Socket.io server ready for real-time chat and video calls`);
  console.log(`Backend accessible at:`);
  console.log(`  - http://localhost:${PORT} (local)`);
  console.log(`  - http://0.0.0.0:${PORT} (all interfaces)`);
  console.log(`\n⚠️  Make sure your firewall allows connections on port ${PORT}`);
  console.log(`⚠️  Other users should use: http://YOUR_IP_ADDRESS:${PORT}`);
});


