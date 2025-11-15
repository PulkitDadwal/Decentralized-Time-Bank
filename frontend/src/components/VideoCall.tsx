import React, { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useSocket, createRoomId } from '../hooks/useSocket'

interface VideoCallProps {
  otherUser: string
  listingTitle?: string
  onClose: () => void
}

type CallStatus = 'idle' | 'calling' | 'ringing' | 'answered' | 'ended'

export function VideoCall({ otherUser, listingTitle, onClose }: VideoCallProps) {
  const { address } = useAccount()
  const { socket, connected } = useSocket()
  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [isInitiator, setIsInitiator] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const callStartTimeRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const roomId = address && otherUser ? createRoomId(address, otherUser) : ''

  // WebRTC configuration (using free STUN servers)
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  }

  useEffect(() => {
    if (!socket || !address || !roomId) return

    const normalizedAddress = address.toLowerCase()
    
    const joinRoom = () => {
      if (!socket.connected) {
        console.log('[VideoCall] Socket not connected, waiting...')
        return
      }
      // Notify server that user is online
      socket.emit('user-online', normalizedAddress)
      // Join room
      socket.emit('join-room', roomId, normalizedAddress)
      console.log(`[VideoCall] Joined room ${roomId} as ${normalizedAddress}`)
    }
    
    // Join immediately if connected
    if (socket.connected) {
      joinRoom()
    }
    
    // Rejoin on connect/reconnect
    socket.on('connect', joinRoom)

    const handleCallStatus = (data: { status: CallStatus; sender: string }) => {
      const normalizedSender = data.sender?.toLowerCase()
      if (normalizedSender === normalizedAddress) {
        console.log('[VideoCall] Ignoring own status update')
        return // Ignore own status updates
      }

      console.log(`[VideoCall] Received call status: ${data.status} from ${normalizedSender}`)

      if (data.status === 'calling' && callStatus === 'idle') {
        console.log('[VideoCall] Incoming call detected, setting status to ringing')
        setCallStatus('ringing')
        setIsInitiator(false)
      } else if (data.status === 'answered') {
        console.log('[VideoCall] Call answered')
        setCallStatus('answered')
        startCallTimer()
        if (!isInitiator) {
          createAnswer()
        }
      } else if (data.status === 'ended') {
        console.log('[VideoCall] Call ended by other party')
        endCall()
      }
    }

    const handleOffer = async (data: { offer: RTCSessionDescriptionInit; sender: string }) => {
      const normalizedSender = data.sender?.toLowerCase()
      if (normalizedSender === normalizedAddress) {
        console.log('[VideoCall] Ignoring own offer')
        return
      }
      console.log('[VideoCall] Received offer from', normalizedSender)
      await handleReceivedOffer(data.offer)
    }

    const handleAnswer = async (data: { answer: RTCSessionDescriptionInit; sender: string }) => {
      const normalizedSender = data.sender?.toLowerCase()
      if (normalizedSender === normalizedAddress) {
        console.log('[VideoCall] Ignoring own answer')
        return
      }
      console.log('[VideoCall] Received answer from', normalizedSender)
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer))
        // Start timer when call is connected (answer received)
        if (callStatus === 'calling' && isInitiator) {
          setCallStatus('answered')
          startCallTimer()
        }
      }
    }

    const handleIceCandidate = (data: { candidate: RTCIceCandidateInit; sender: string }) => {
      const normalizedSender = data.sender?.toLowerCase()
      if (normalizedSender === normalizedAddress) {
        return
      }
      if (peerConnectionRef.current && data.candidate) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
      }
    }

    socket.on('video-call-status', handleCallStatus)
    socket.on('webrtc-offer', handleOffer)
    socket.on('webrtc-answer', handleAnswer)
    socket.on('webrtc-ice-candidate', handleIceCandidate)

    return () => {
      socket.off('connect', joinRoom)
      socket.off('video-call-status', handleCallStatus)
      socket.off('webrtc-offer', handleOffer)
      socket.off('webrtc-answer', handleAnswer)
      socket.off('webrtc-ice-candidate', handleIceCandidate)
    }
  }, [socket, address, roomId, callStatus, isInitiator])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current)
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
      }
    }
  }, [])

  const startCall = async () => {
    if (!socket || !address || !roomId) return

    if (!socket.connected) {
      alert('Not connected to server. Please wait...')
      return
    }

    try {
      // Ensure we're in the room before starting call
      const normalizedAddress = address.toLowerCase()
      socket.emit('join-room', roomId, normalizedAddress)
      socket.emit('user-online', normalizedAddress)

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Create peer connection
      const pc = new RTCPeerConnection(rtcConfig)
      peerConnectionRef.current = pc

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream)
      })

      // Handle remote stream
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0]
        }
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', { roomId, candidate: event.candidate, sender: normalizedAddress })
        }
      }

      // Create and send offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      console.log('[VideoCall] Sending offer and call status')
      socket.emit('webrtc-offer', { roomId, offer, sender: normalizedAddress })
      socket.emit('video-call-status', { roomId, status: 'calling', sender: normalizedAddress })

      setCallStatus('calling')
      setIsInitiator(true)
    } catch (error) {
      console.error('Error starting call:', error)
      alert('Failed to access camera/microphone. Please check permissions.')
    }
  }

  const startCallTimer = () => {
    if (callStartTimeRef.current) return // Timer already started
    
    callStartTimeRef.current = Date.now()
    setCallDuration(0)
    
    durationIntervalRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000)
        setCallDuration(elapsed)
      }
    }, 1000)
  }

  const handleReceivedOffer = async (offer: RTCSessionDescriptionInit) => {
    if (!socket || !address || !roomId) return

    const normalizedAddress = address.toLowerCase()

    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Create peer connection
      const pc = new RTCPeerConnection(rtcConfig)
      peerConnectionRef.current = pc

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream)
      })

      // Handle remote stream
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0]
        }
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', { roomId, candidate: event.candidate, sender: normalizedAddress })
        }
      }

      // Set remote description and create answer
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('[VideoCall] Sending answer')
      socket.emit('webrtc-answer', { roomId, answer, sender: normalizedAddress })
      socket.emit('video-call-status', { roomId, status: 'answered', sender: normalizedAddress })

      setCallStatus('answered')
      startCallTimer()
    } catch (error) {
      console.error('Error handling offer:', error)
      alert('Failed to access camera/microphone. Please check permissions.')
    }
  }

  const createAnswer = async () => {
    // This is called when we receive 'answered' status
    // The actual answer was already created in handleReceivedOffer
  }

  const answerCall = () => {
    if (callStatus === 'ringing' && socket && roomId && address) {
      const normalizedAddress = address.toLowerCase()
      console.log('[VideoCall] Answering call')
      socket.emit('video-call-status', { roomId, status: 'answered', sender: normalizedAddress })
      // The actual WebRTC answer is handled in handleReceivedOffer
    }
  }

  const endCall = () => {
    // Stop timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    // Calculate final duration
    let finalDuration = callDuration
    if (callStartTimeRef.current) {
      finalDuration = Math.floor((Date.now() - callStartTimeRef.current) / 1000)
    }

    // Send call duration to backend if call was answered
    if (socket && roomId && address && callStatus === 'answered' && finalDuration > 0) {
      socket.emit('video-call-ended', { roomId, duration: finalDuration, sender: address })
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }

    // Reset timer ref
    callStartTimeRef.current = null
    setCallDuration(0)

    // Notify other user
    if (socket && roomId && address) {
      const normalizedAddress = address.toLowerCase()
      socket.emit('video-call-status', { roomId, status: 'ended', sender: normalizedAddress })
    }

    setCallStatus('ended')
    setTimeout(() => {
      onClose()
    }, 500)
  }

  const rejectCall = () => {
    if (socket && roomId && address) {
      const normalizedAddress = address.toLowerCase()
      socket.emit('video-call-status', { roomId, status: 'ended', sender: normalizedAddress })
    }
    endCall()
  }

  if (!address) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-md w-full">
          <p className="text-neutral-300">Please connect your wallet to use video calls</p>
          <button className="btn-primary mt-4 w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <div className="relative w-full h-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 bg-neutral-900 border-b border-neutral-800">
          <div>
            <h3 className="text-lg font-semibold">Video Call</h3>
            {listingTitle && <p className="text-sm text-neutral-400">{listingTitle}</p>}
            <p className="text-xs text-neutral-500">With: {otherUser.slice(0, 6)}...{otherUser.slice(-4)}</p>
          </div>
          <button
            onClick={endCall}
            className="text-neutral-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Video Area */}
        <div className="flex-1 relative bg-black rounded-lg overflow-hidden">
          {/* Remote Video (main) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Local Video (small, top-right) */}
          <div className="absolute top-4 right-4 w-48 h-36 rounded-lg overflow-hidden border-2 border-neutral-700">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>

          {/* Call Duration Display */}
          {callStatus === 'answered' && callDuration > 0 && (
            <div className="absolute top-4 left-4 bg-black/70 text-white px-4 py-2 rounded-lg">
              <div className="text-sm font-mono">
                {Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, '0')}
              </div>
            </div>
          )}

          {/* Status Overlay */}
          {callStatus === 'calling' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center">
                <div className="animate-pulse text-2xl mb-2">📞</div>
                <p className="text-white text-lg">Calling...</p>
              </div>
            </div>
          )}

          {callStatus === 'ringing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center">
                <div className="animate-pulse text-4xl mb-4">📞</div>
                <p className="text-white text-xl mb-4">Incoming call...</p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={answerCall}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-full text-lg"
                  >
                    Answer
                  </button>
                  <button
                    onClick={rejectCall}
                    className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-full text-lg"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800 flex justify-center gap-4">
          {callStatus === 'idle' && (
            <button
              onClick={startCall}
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-full text-lg"
            >
              Start Call
            </button>
          )}

          {(callStatus === 'answered' || callStatus === 'calling') && (
            <button
              onClick={endCall}
              className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full text-lg"
            >
              End Call
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

