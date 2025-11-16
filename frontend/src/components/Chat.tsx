import React, { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSocket, createRoomId } from '../hooks/useSocket'
import { CONTRACTS } from '../lib/contracts'

const socketUrl = CONTRACTS.sepolia.backendBaseUrl || 'http://localhost:4000'

interface ChatMessage {
  id: string
  message: string
  sender: string
  timestamp: string
  type?: 'text' | 'video-call' | 'system'
}

interface ChatProps {
  otherUser: string
  listingTitle?: string
  onClose: () => void
}

export function Chat({ otherUser, listingTitle, onClose }: ChatProps) {
  const { address } = useAccount()
  const { socket, connected } = useSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [otherUserTyping, setOtherUserTyping] = useState(false)
  const [otherUserOnline, setOtherUserOnline] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const roomId = address && otherUser ? createRoomId(address, otherUser) : ''

  useEffect(() => {
    if (!socket || !address || !roomId) {
      console.log('[Chat] Missing requirements:', { socket: !!socket, address: !!address, roomId })
      return
    }
    
    const normalizedOtherUser = otherUser.toLowerCase()
    const normalizedAddress = address.toLowerCase()
    
    console.log(`[Chat] Setting up chat for room: ${roomId}`)
    console.log(`[Chat] My address: ${normalizedAddress}, Other user: ${normalizedOtherUser}`)
    
    const joinRoom = () => {
      if (!socket.connected) {
        console.log('[Chat] ⚠️ Socket not connected, waiting...')
        return
      }
      console.log(`[Chat] ✅ Socket connected, joining room ${roomId}`)
      // Notify server that user is online
      socket.emit('user-online', normalizedAddress)
      console.log(`[Chat] Emitted 'user-online' for ${normalizedAddress}`)
      // Join room
      socket.emit('join-room', roomId, normalizedAddress)
      console.log(`[Chat] Emitted 'join-room' for room ${roomId} as ${normalizedAddress}`)
    }
    
    // Join immediately if connected
    if (socket.connected) {
      console.log('[Chat] Socket already connected, joining room immediately')
      joinRoom()
    } else {
      console.log('[Chat] Socket not connected yet, will join on connect')
    }
    
    // Rejoin on connect/reconnect
    socket.on('connect', () => {
      console.log('[Chat] Socket connected event received, joining room')
      joinRoom()
    })

    // Listen for chat history
    const handleHistory = (history: ChatMessage[]) => {
      console.log(`[Chat] 📜 Received ${history.length} messages from history`)
      // Replace messages with history (fresh load)
      const sorted = history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      setMessages(sorted)
      // Scroll to bottom after loading history
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }, 100)
    }

    // Listen for new messages (real-time) - optimized for instant display
    const handleMessage = (message: ChatMessage) => {
      console.log(`[Chat] 💬 Received real-time message:`, message)
      setMessages((prev) => {
        // Prevent duplicate messages by ID
        if (prev.some(m => m.id === message.id)) {
          console.log(`[Chat] ⚠️ Duplicate message detected, skipping: ${message.id}`)
          return prev
        }
        // Add new message immediately
        const updated = [...prev, message]
        const sorted = updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        console.log(`[Chat] ✅ Message added instantly, total messages: ${sorted.length}`)
        return sorted
      })
      // Auto-scroll to bottom when new message arrives
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    }

    // Listen for typing indicators
    const handleTyping = (data: { userAddress: string; typing: boolean }) => {
      if (data.userAddress.toLowerCase() === normalizedOtherUser) {
        setOtherUserTyping(data.typing)
      }
    }

    // Listen for online/offline status - with immediate update
    const handleUserStatus = (data: { userAddress: string; status: 'online' | 'offline' }) => {
      const normalizedDataAddress = data.userAddress?.toLowerCase()
      console.log(`[Chat] Status update for ${normalizedDataAddress}: ${data.status}`)
      if (normalizedDataAddress === normalizedOtherUser) {
        setOtherUserOnline(data.status === 'online')
        console.log(`[Chat] Other user ${normalizedOtherUser} is now ${data.status}`)
      }
    }

    socket.on('chat-history', handleHistory)
    socket.on('chat-message', handleMessage)
    socket.on('typing', handleTyping)
    socket.on('user-status', handleUserStatus)

    return () => {
      socket.off('connect', joinRoom)
      socket.off('chat-history', handleHistory)
      socket.off('chat-message', handleMessage)
      socket.off('typing', handleTyping)
      socket.off('user-status', handleUserStatus)
    }
  }, [socket, address, roomId, otherUser])

  // Auto-scroll to bottom when messages change - optimized for smooth scrolling
  useEffect(() => {
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [messages, otherUserTyping])

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      // Stop typing on unmount
      if (socket && address && roomId && isTyping) {
        socket.emit('typing-stop', { roomId, userAddress: address })
      }
    }
  }, [socket, address, roomId, isTyping])

  const handleTyping = () => {
    if (!socket || !address || !roomId || !socket.connected) return
    
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    
    // Send typing start if not already typing
    if (!isTyping) {
      setIsTyping(true)
      socket.emit('typing-start', { roomId, userAddress: address.toLowerCase() })
    }
    
    // Set timeout to stop typing after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      if (socket && address && roomId && socket.connected) {
        setIsTyping(false)
        socket.emit('typing-stop', { roomId, userAddress: address.toLowerCase() })
      }
    }, 3000)
  }

    const sendMessage = () => {
    if (!socket || !address || !inputMessage.trim() || !roomId) {
      console.log('[Chat] ⚠️ Cannot send message:', { socket: !!socket, address: !!address, message: !!inputMessage.trim(), roomId })
      return
    }

    if (!socket.connected) {
      console.error('[Chat] ❌ Not connected to chat server!')
      alert('Not connected to chat server. Please wait for connection...')
      return
    }

    const messageText = inputMessage.trim()
    
    // Stop typing indicator
    if (isTyping) {
      setIsTyping(false)
      socket.emit('typing-stop', { roomId, userAddress: address.toLowerCase() })
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    const messageData = {
      roomId,
      message: messageText,
      sender: address.toLowerCase(),
      timestamp: new Date().toISOString(),
    }

    console.log('[Chat] 📤 Sending message to server:', { roomId, message: messageText.substring(0, 50) + '...', sender: messageData.sender })
    
    // Optimistically add message to UI immediately (will be confirmed by server response)
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      ...messageData,
      type: 'text',
    }
    setMessages((prev) => {
      const updated = [...prev, tempMessage]
      const sorted = updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      return sorted
    })
    setInputMessage('')
    
    // Scroll immediately
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
    
    // Send to server
    socket.emit('chat-message', messageData)
    console.log('[Chat] ✅ Message emitted to server, waiting for broadcast...')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    } else {
      handleTyping()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputMessage(e.target.value)
    handleTyping()
  }

  if (!address) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-md w-full">
          <p className="text-neutral-300">Please connect your wallet to use chat</p>
          <button className="btn-primary mt-4 w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg flex flex-col h-[600px] max-w-2xl w-full">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Chat</h3>
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${otherUserOnline ? 'bg-green-500' : 'bg-neutral-500'}`} />
                <span className="text-xs text-neutral-400">
                  {otherUserOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
            {listingTitle && <p className="text-sm text-neutral-400">{listingTitle}</p>}
            <p className="text-xs text-neutral-500">With: {otherUser.slice(0, 6)}...{otherUser.slice(-4)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (socket && roomId && address) {
                  socket.emit('join-room', roomId, address)
                }
              }}
              className="text-neutral-400 hover:text-white text-sm px-2 py-1"
              title="Refresh messages"
            >
              ↻
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-neutral-400 py-8">
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.sender.toLowerCase() === address.toLowerCase()
              const isSystem = msg.type === 'video-call' || msg.sender === 'system'
              
              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="bg-neutral-800/50 text-neutral-400 text-xs px-3 py-1 rounded-full">
                      {msg.message}
                    </div>
                  </div>
                )
              }
              
              return (
                <div
                  key={msg.id}
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-4 py-2 ${
                      isOwn
                        ? 'bg-indigo-600 text-white'
                        : 'bg-neutral-800 text-neutral-200'
                    }`}
                  >
                    <p className="text-sm">{msg.message}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          {otherUserTyping && (
            <div className="flex justify-start">
              <div className="bg-neutral-800 text-neutral-400 text-sm px-4 py-2 rounded-lg">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                </span>
                <span className="ml-2">typing...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-neutral-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder={connected ? "Type a message..." : "Connecting..."}
              disabled={!connected}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-4 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={sendMessage}
              disabled={!connected || !inputMessage.trim()}
              className="btn-primary px-6"
            >
              Send
            </button>
          </div>
          {!connected && (
            <div className="text-xs text-yellow-400 mt-2 space-y-1">
              <p>⚠️ Connecting to chat server...</p>
              <p className="text-xs text-neutral-500">Server: {socketUrl || 'Not configured'}</p>
            </div>
          )}
          {connected && (
            <p className="text-xs text-green-400 mt-2">✅ Connected to chat server</p>
          )}
        </div>
      </div>
    </div>
  )
}

