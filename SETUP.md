# Setup Guide - Decentralized Time Bank

This guide will help you set up and run the project on your local machine.

## Prerequisites

Before you begin, make sure you have the following installed:

1. **Node.js** (v18 or higher)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`

2. **MongoDB** (Local or Atlas)
   - **Option A - Local MongoDB:**
     - Download from: https://www.mongodb.com/try/download/community
     - Or use package manager: `choco install mongodb` (Windows)
   - **Option B - MongoDB Atlas (Cloud - Recommended):**
     - Free tier available at: https://www.mongodb.com/cloud/atlas/register
     - No local installation needed

3. **MetaMask** browser extension
   - Install from: https://metamask.io/
   - Connect to Ethereum Sepolia testnet

4. **Git** (to clone the repository)
   - Download from: https://git-scm.com/

## Step 1: Clone the Repository

```bash
git clone <your-repository-url>
cd Decentralized-Time-Bank
```

## Step 2: Install Dependencies

### Backend Dependencies

```bash
cd backend
npm install
```

### Frontend Dependencies

```bash
cd ../frontend
npm install
```

## Step 3: Configure Environment Variables

### Backend Configuration

Create a file named `.env` in the `backend/` directory:

**Windows (PowerShell):**
```powershell
cd backend
New-Item -Path .env -ItemType File
notepad .env
```

**Mac/Linux:**
```bash
cd backend
touch .env
nano .env
```

**Copy this content into `backend/.env`:**
```env
# MongoDB Connection
# For local MongoDB:
MONGODB_URI=mongodb://localhost:27017

# For MongoDB Atlas (replace with your connection string):
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net

# Database name (separate from other projects)
DB_NAME=timebank

# Server port
PORT=4000
```

**Important Notes:**
- If using MongoDB Atlas, get your connection string from the Atlas dashboard
- The database name `timebank` will be created automatically
- Make sure your MongoDB is running (local) or your Atlas cluster is accessible

### Frontend Configuration

Create a file named `.env` in the `frontend/` directory:

**Windows (PowerShell):**
```powershell
cd frontend
New-Item -Path .env -ItemType File
notepad .env
```

**Mac/Linux:**
```bash
cd frontend
touch .env
nano .env
```

**Copy this content into `frontend/.env`:**
```env
# Backend API URL
VITE_BACKEND_URL=http://localhost:4000

# Smart Contract Addresses (optional - only if contracts are deployed)
# VITE_TTK_ADDRESS=0x0000000000000000000000000000000000000000
# VITE_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
```

**Note:** Contract addresses are optional if you're just testing the frontend/backend features.

### Root Directory Configuration (For Contract Deployment - Optional)

If you want to deploy smart contracts yourself, create a `.env` file in the **project root** (not in backend/ or frontend/):

**Windows (PowerShell):**
```powershell
cd ..  # Go back to project root
New-Item -Path .env -ItemType File
notepad .env
```

**Mac/Linux:**
```bash
cd ..  # Go back to project root
touch .env
nano .env
```

**Copy this content into the root `.env` file:**
```env
# Sepolia Testnet RPC URL
SEPOLIA_RPC_URL=https://rpc.sepolia.org

# Your wallet's private key (for deploying contracts)
# ⚠️ WARNING: Only use a test wallet, never your main wallet!
PRIVATE_KEY=0x_your_private_key_here
```

**Note:** This `.env` file is only needed if you're deploying contracts. For testing wallet features with pre-deployed contracts, you don't need this file.

## Step 4: Start MongoDB

### If using Local MongoDB:

**Windows:**
```bash
# If installed as a service, it should already be running
# Check with: net start MongoDB

# Or start manually:
mongod
```

**Mac/Linux:**
```bash
# Start MongoDB service
sudo systemctl start mongod
# OR
brew services start mongodb-community
```

### If using MongoDB Atlas:

No local setup needed! Just make sure:
- Your cluster is running
- Your IP address is whitelisted (or use `0.0.0.0/0` for testing)
- You have the correct connection string in `.env`

## Step 5: Start the Backend Server

Open a terminal and run:

```bash
cd backend
npm run dev
```

You should see:
```
[MongoDB] Connected to database: timebank
TimeBank backend running on port 4000
Socket.io server ready for real-time chat and video calls
```

**Keep this terminal open!**

## Step 6: Start the Frontend

Open a **new terminal** (keep the backend running) and run:

```bash
cd frontend
npm run dev
```

You should see:
```
  VITE v7.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

## Step 7: Open in Browser

1. Open your browser and go to: **http://localhost:5173**
2. Connect your MetaMask wallet
3. Make sure MetaMask is connected to **Ethereum Sepolia testnet**

## Verification

### Test Backend Connection:

1. **Health Check:**
   - Visit: http://localhost:4000/health
   - Should return: `{"status":"ok"}`

2. **Database Connection:**
   - Visit: http://localhost:4000/api/test-db
   - Should return: `{"success":true,"connected":true,"database":"timebank",...}`

### Test Frontend:

1. Navigate to different pages (Marketplace, Chat, My Services, etc.)
2. Create a listing in "My Services"
3. Check "Marketplace" to see your listing
4. Try the chat feature

## Troubleshooting

### Backend won't start

**Error: "Cannot find module 'mongodb'"**
```bash
cd backend
npm install
```

**Error: "EADDRINUSE: address already in use :::4000"**
- Port 4000 is already in use
- **Windows:** `netstat -ano | findstr :4000` then `taskkill /PID <pid> /F`
- **Mac/Linux:** `lsof -ti:4000 | xargs kill`

**Error: "MongoDB connection failed"**
- Check if MongoDB is running: `mongod --version`
- Verify connection string in `backend/.env`
- For Atlas: Check IP whitelist and connection string

### Frontend won't start

**Error: "Cannot find module"**
```bash
cd frontend
npm install
```

**Port 5173 already in use**
- Vite will automatically use the next available port (5174, 5175, etc.)
- Or change port in `vite.config.js`

### Can't see listings/messages

- Check backend console for errors
- Verify MongoDB collections exist (`listings`, `chatMessages`)
- Check browser console (F12) for API errors
- Make sure backend is running on port 4000

### MetaMask connection issues

- Make sure MetaMask is installed and unlocked
- Connect to Ethereum Sepolia testnet
- Get testnet ETH from a faucet if needed

## Project Structure

```
Decentralized-Time-Bank/
├── backend/              # Node.js + Express + MongoDB backend
│   ├── server.js         # Main server file
│   ├── package.json      # Backend dependencies
│   └── .env             # Backend environment variables (create this)
├── frontend/             # React + Vite frontend
│   ├── src/             # Source code
│   ├── package.json     # Frontend dependencies
│   └── .env             # Frontend environment variables (create this)
├── contracts/           # Solidity smart contracts
├── scripts/            # Deployment scripts
└── README.md           # Project overview
```

## Key Features

- ✅ **Listings**: Create and manage service listings (stored in MongoDB)
- ✅ **Marketplace**: Browse all available services
- ✅ **Chat**: Real-time messaging between users
- ✅ **Video Calls**: WebRTC video calling feature
- ✅ **Escrow**: Blockchain-based escrow system for service transactions
- ✅ **Analytics**: Dashboard with statistics and leaderboards

## Testing Wallet Features

To test blockchain transactions (escrow, tokens, etc.), see **[WALLET_TESTING_GUIDE.md](./WALLET_TESTING_GUIDE.md)**

This guide covers:
- MetaMask setup with Sepolia testnet
- Getting testnet ETH
- Deploying smart contracts
- Minting TTK tokens
- Testing all transaction features

## Important Notes

- ⚠️ **Never commit `.env` files to Git** - they contain sensitive information
- ✅ The `.env` files are already in `.gitignore` - they won't be committed
- 📝 Each person needs to create their own `.env` files based on the examples above
- 🔒 Keep your MongoDB connection strings private

## Need Help?

If you encounter any issues:

1. Check the console logs (both backend and browser)
2. Verify all environment variables are set correctly
3. Ensure MongoDB is running and accessible
4. Make sure both backend and frontend are running simultaneously
5. Check that ports 4000 (backend) and 5173 (frontend) are not in use

## Quick Commands Reference

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start backend (Terminal 1)
cd backend && npm run dev

# Start frontend (Terminal 2)
cd frontend && npm run dev

# Check MongoDB connection
curl http://localhost:4000/api/test-db

# Check backend health
curl http://localhost:4000/health
```

---

**Note:** This project uses MongoDB for data storage. All listings and chat messages are stored in MongoDB for reliability and fast access. The blockchain smart contracts handle token transactions and escrow functionality.

