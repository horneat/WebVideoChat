// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Fix: Configure Express trust proxy for rate limiting
app.set('trust proxy', 1); // Trust first proxy

// Fix: Add body parser middleware for JSON
app.use(express.json({ limit: '10kb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Update socket.io configuration for better reliability
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['websocket', 'polling'], // Add fallback transport
  allowUpgrades: true,
  maxHttpBufferSize: 1e8 // Increase buffer size for slow connections
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms with metadata
const rooms = new Map();

// Generate shorter room IDs
function generateShortRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Add connection state tracking
const connectionStates = new Map();

// Simple route handling
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lounge.html'));
});

app.get('/lounge', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lounge.html'));
});

app.get('/chat/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
  const newRoomId = generateShortRoomId();
  rooms.set(newRoomId, {
    users: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    roomName: `Room ${newRoomId}`,
    isSecret: false,
    creator: null
  });
  console.log(`New room created: ${newRoomId}`);
  res.redirect(`/chat/${newRoomId}`);
});

// Add room creation with name and secret option
app.post('/api/rooms/create', (req, res) => {
  const { roomName, isSecret } = req.body;
  const newRoomId = generateShortRoomId();

  rooms.set(newRoomId, {
    users: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    roomName: roomName || `Room ${newRoomId}`,
    isSecret: isSecret || false,
    creator: req.ip // Store creator IP for simple ownership
  });

  console.log(`New room created: ${newRoomId} - Name: ${roomName} - Secret: ${isSecret}`);
  res.json({ roomId: newRoomId, roomName: roomName || `Room ${newRoomId}`, isSecret });
});

// API endpoints
app.get('/api/rooms', (req, res) => {
  const roomInfo = {};
  rooms.forEach((roomData, roomId) => {
    // Don't include secret rooms in public API
    if (roomData.isSecret) return;

    roomInfo[roomId] = {
      roomName: roomData.roomName,
      users: Array.from(roomData.users),
      userCount: roomData.users.size,
      createdAt: roomData.createdAt,
      lastActivity: roomData.lastActivity,
      isSecret: roomData.isSecret
    };
  });

  res.json({
    totalRooms: Array.from(rooms.values()).filter(room => !room.isSecret).length,
    activeUsers: Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0),
    rooms: roomInfo
  });
});

// Add this endpoint to check if room exists
app.get('/api/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const exists = rooms.has(roomId);
  console.log(`API Check: Room ${roomId} exists: ${exists}`);
  res.json({ exists, roomId });
});

// Add mobile detection helper endpoint
app.get('/api/device-info', (req, res) => {
  const userAgent = req.headers['user-agent'];
  const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);

  res.json({
    isMobile,
    userAgent: userAgent.substring(0, 100) // For debugging
  });
});

app.get('/health', (req, res) => {
  const roomCount = rooms.size;
  const totalUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0);

  res.json({
    status: 'ok',
    rooms: roomCount,
    activeUsers: totalUsers,
    timestamp: new Date().toISOString()
  });
});

// Translation rate limiting - FIXED VERSION
const translationLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // Limit each IP to 20 translation requests per minute
    message: { error: 'Too many translation requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Dual translation endpoint
app.post('/api/translate', translationLimiter, async (req, res) => {
    console.log('Translation request received:', req.body);

    const { text, targetLang, messageId, service = 'google' } = req.body;

    // Fix: Better error handling for missing body
    if (!text || !targetLang) {
        console.log('Missing required fields:', { text: !!text, targetLang: !!targetLang });
        return res.status(400).json({
            error: 'Text and target language are required',
            received: { text: !!text, targetLang: !!targetLang }
        });
    }

    // Simple input validation
    if (typeof text !== 'string' || text.length > 1000) {
        return res.status(400).json({ error: 'Text must be a string with maximum 1000 characters.' });
    }

    const supportedLangs = ['en', 'ru', 'tr', 'es', 'fr'];
    if (!supportedLangs.includes(targetLang)) {
        return res.status(400).json({ error: 'Unsupported target language' });
    }

    try {
        console.log(`Translating text to ${targetLang} using ${service}: "${text.substring(0, 50)}..."`);

        let translatedText;
        let usedService = service;

        if (service === 'google') {
            // Use Google Translate (free)
            const result = await tryGoogleTranslate(text, targetLang);
            if (result.success) {
                translatedText = result.translatedText;
            } else {
                throw new Error('Google Translate failed');
            }
        } else if (service === 'deepseek') {
            // Use DeepSeek API
            if (!process.env.DEEPSEEK_API_KEY) {
                return res.status(503).json({
                    error: 'DeepSeek service not configured',
                    details: 'API key missing. Please check your .env file.'
                });
            }
            const result = await tryDeepSeekTranslate(text, targetLang);
            if (result.success) {
                translatedText = result.translatedText;
            } else {
                throw new Error('DeepSeek translation failed');
            }
        } else {
            return res.status(400).json({ error: 'Invalid translation service' });
        }

        console.log(`Translation successful (${usedService}): "${text.substring(0, 30)}..." -> "${translatedText.substring(0, 30)}..."`);

        res.json({
            translatedText: translatedText,
            messageId: messageId,
            targetLang: targetLang,
            service: usedService,
            success: true
        });

    } catch (error) {
        console.error('Translation error:', error);

        // If the requested service fails, try the other one as fallback
        try {
            const fallbackService = service === 'google' ? 'deepseek' : 'google';
            console.log(`Trying fallback service: ${fallbackService}`);

            let fallbackResult;
            if (fallbackService === 'google') {
                fallbackResult = await tryGoogleTranslate(text, targetLang);
            } else {
                if (process.env.DEEPSEEK_API_KEY) {
                    fallbackResult = await tryDeepSeekTranslate(text, targetLang);
                } else {
                    fallbackResult = { success: false };
                }
            }

            if (fallbackResult.success) {
                console.log(`Fallback translation successful (${fallbackService}): "${text.substring(0, 30)}..." -> "${fallbackResult.translatedText.substring(0, 30)}..."`);
                return res.json({
                    translatedText: fallbackResult.translatedText,
                    messageId: messageId,
                    targetLang: targetLang,
                    service: fallbackService,
                    fallback: true,
                    success: true
                });
            }
        } catch (fallbackError) {
            console.error('Fallback translation also failed:', fallbackError);
        }

        res.status(500).json({
            error: 'Translation service unavailable. Please try again later.',
            details: error.message,
            success: false
        });
    }
});

// Google Translate function (free)
async function tryGoogleTranslate(text, targetLang) {
    try {
        // Using a free Google Translate API proxy
        const response = await fetch('https://translate.googleapis.com/translate_a/single', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client: 'gtx',
                sl: 'auto',
                tl: targetLang,
                dt: 't',
                q: text
            })
        });

        if (response.ok) {
            const data = await response.json();
            // Google returns nested array structure
            if (data && data[0] && data[0][0] && data[0][0][0]) {
                return {
                    success: true,
                    translatedText: data[0][0][0]
                };
            }
        }

        return { success: false };
    } catch (error) {
        console.error('Google Translate error:', error);
        return { success: false };
    }
}

// DeepSeek Translate function
async function tryDeepSeekTranslate(text, targetLang) {
    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional translator. Translate the following text to ${targetLang}. Only return the translation, no additional text or explanations. Preserve any formatting, emojis, or special characters.`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('DeepSeek API error:', response.status, errorText);

            if (response.status === 401) {
                throw new Error('DeepSeek API authentication failed');
            } else if (response.status === 402) {
                throw new Error('DeepSeek API insufficient balance');
            } else if (response.status === 429) {
                throw new Error('DeepSeek API rate limit exceeded');
            } else {
                throw new Error(`DeepSeek API error: ${response.status}`);
            }
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response format from DeepSeek API');
        }

        const translatedText = data.choices[0].message.content.trim();

        return {
            success: true,
            translatedText: translatedText
        };

    } catch (error) {
        console.error('DeepSeek translation error:', error);
        return { success: false, error: error.message };
    }
}

// Socket.io connection handling with better reconnection logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  connectionStates.set(socket.id, { connected: true, lastPing: Date.now() });

  // Enhanced ping/pong for connection monitoring
  socket.on('ping', (data) => {
    socket.emit('pong', { ...data, serverTime: Date.now() });
    connectionStates.set(socket.id, {
      ...connectionStates.get(socket.id),
      lastPing: Date.now()
    });
  });

  // Add this handler for room checking
  socket.on('check-room', (roomId, callback) => {
    const exists = rooms.has(roomId);
    console.log(`Socket Check: Room ${roomId} exists: ${exists}`);
    callback({ exists });
  });

  // Enhanced room joining with retry mechanism
  socket.on('join-room', (roomId, userId, callback) => {
    console.log(`User ${userId} joining room ${roomId}`);

    // Validate room exists or create with retry
    let room = rooms.get(roomId);
    if (!room) {
      console.log(`Room ${roomId} doesn't exist, creating new room`);
      room = {
        users: new Set(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
        roomName: `Room ${roomId}`,
        isSecret: false,
        creator: null
      };
      rooms.set(roomId, room);
    }

    // Remove user from any previous rooms
    rooms.forEach((roomData, existingRoomId) => {
      if (roomData.users.has(userId)) {
        roomData.users.delete(userId);
        socket.leave(existingRoomId);
        console.log(`Removed user ${userId} from previous room ${existingRoomId}`);
      }
    });

    // Add user to new room
    room.users.add(userId);
    room.lastActivity = Date.now();
    socket.join(roomId);

    const otherUsers = Array.from(room.users).filter(id => id !== userId);
    console.log(`Room ${roomId} now has users:`, Array.from(room.users));

    // Send acknowledgment with room state
    if (callback) {
      callback({
        success: true,
        otherUsers,
        roomExists: true
      });
    }

    // Notify other users about new user with retry
    if (otherUsers.length > 0) {
      const notifyUsers = () => {
        socket.to(roomId).emit('user-connected', userId);
        console.log(`Notified room ${roomId} about new user ${userId}`);
      };

      // Retry notification for slow connections
      setTimeout(notifyUsers, 100);
      setTimeout(notifyUsers, 500);
    }

    // Send existing users to new user with retry
    if (otherUsers.length > 0) {
      const sendExistingUsers = () => {
        socket.emit('existing-users', otherUsers);
        console.log(`Sent existing users to ${userId}:`, otherUsers);
      };

      setTimeout(sendExistingUsers, 150);
      setTimeout(sendExistingUsers, 600);
    }

    // Handle reconnection to room
    socket.on('rejoin-room', (data) => {
      console.log(`User ${data.userId} rejoining room ${data.roomId}`);

      if (!rooms.has(data.roomId)) {
        socket.emit('room-not-found');
        return;
      }

      const rejoinRoom = rooms.get(data.roomId);
      rejoinRoom.users.add(data.userId);
      rejoinRoom.lastActivity = Date.now();
      socket.join(data.roomId);

      socket.to(data.roomId).emit('user-reconnected', data.userId);
      console.log(`User ${data.userId} rejoined room ${data.roomId}`);
    });

    // Enhanced WebRTC signaling with retry mechanism
    const sendWithRetry = (event, data, maxRetries = 3) => {
      let retries = 0;

      const send = () => {
        try {
          socket.to(data.roomId).emit(event, data);
          console.log(`Sent ${event} from ${data.userId}`);
        } catch (error) {
          if (retries < maxRetries) {
            retries++;
            setTimeout(send, 500 * retries);
          } else {
            console.error(`Failed to send ${event} after ${maxRetries} retries:`, error);
          }
        }
      };

      send();
    };

    socket.on('offer', (data) => {
      console.log(`Offer from ${data.userId} to room ${data.roomId}`);
      sendWithRetry('offer', data);
    });

    socket.on('answer', (data) => {
      console.log(`Answer from ${data.userId} to room ${data.roomId}`);
      sendWithRetry('answer', data);
    });

    socket.on('ice-candidate', (data) => {
      sendWithRetry('ice-candidate', data, 5); // More retries for ICE candidates
    });

    // Handle user leaving (refresh/close)
    socket.on('user-leaving', (data) => {
      console.log(`User ${data.userId} is leaving room ${data.roomId}`);
      socket.to(data.roomId).emit('user-left', data.userId);
    });

    // Handle remote audio toggle (mute/unmute)
    socket.on('remote-audio-toggle', (data) => {
      console.log(`User ${data.userId} ${data.muted ? 'muted' : 'unmuted'} their audio in room ${data.roomId}`);
      socket.to(data.roomId).emit('remote-audio-toggle', {
        userId: data.userId,
        muted: data.muted
      });
    });

    // Handle end conversation
    socket.on('end-conversation', (data) => {
      console.log(`User ${data.userId} ended conversation in room ${data.roomId}`);

      io.to(data.roomId).emit('conversation-ended', {
        endedBy: data.userId,
        message: 'Conversation ended by partner'
      });

      const room = rooms.get(data.roomId);
      if (room) {
        room.users.forEach(userId => {
          io.to(userId).emit('redirect-to-lounge');
        });
        rooms.delete(data.roomId);
        console.log(`Room ${data.roomId} deleted by ${data.userId}`);
      }
    });

    // Handle user voluntarily leaving
    socket.on('leave-room', (data) => {
      console.log(`User ${data.userId} voluntarily leaving room ${data.roomId}`);

      const room = rooms.get(data.roomId);
      if (room) {
        room.users.delete(data.userId);
        socket.to(data.roomId).emit('user-left-voluntarily', {
          userId: data.userId,
          message: 'Partner left the conversation'
        });

        room.lastActivity = Date.now();

        if (room.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(data.roomId) && rooms.get(data.roomId).users.size === 0) {
              rooms.delete(data.roomId);
              console.log(`Room ${data.roomId} deleted (empty)`);
            }
          }, 30000);
        }
      }

      socket.emit('redirect-to-lounge');
    });

    // WebRTC signaling handlers
    socket.on('chat-message', (data) => {
      console.log(`Chat message from ${data.userId} in room ${roomId}: ${data.message}`);
      io.to(roomId).emit('chat-message', {
        userId: data.userId,
        message: data.message,
        messageId: data.messageId,
        timestamp: data.timestamp || new Date().toLocaleTimeString(),
        detectedLang: data.detectedLang
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected from room ${roomId}`);

      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(userId);
        room.lastActivity = Date.now();
        socket.to(roomId).emit('user-disconnected', userId);

        if (room.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(roomId) && rooms.get(roomId).users.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} deleted (empty)`);
            }
          }, 30000);
        }
      }
    });
  });

  // Handle direct socket disconnection
  socket.on('disconnect', (reason) => {
    console.log(`Socket ${socket.id} disconnected:`, reason);
    connectionStates.delete(socket.id);

    rooms.forEach((roomData, roomId) => {
      if (roomData.users.has(socket.id)) {
        roomData.users.delete(socket.id);
        roomData.lastActivity = Date.now();
        socket.to(roomId).emit('user-disconnected', socket.id);

        if (roomData.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(roomId) && rooms.get(roomId).users.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} cleaned up after disconnect`);
            }
          }, 30000);
        }
      }
    });
  });
});

// Room cleanup interval
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  let roomsCleaned = 0;

  rooms.forEach((roomData, roomId) => {
    if (roomData.users.size === 0 && (now - roomData.lastActivity) > ONE_HOUR) {
      rooms.delete(roomId);
      roomsCleaned++;
      console.log(`Cleaned up inactive room: ${roomId}`);
    }
  });

  if (roomsCleaned > 0) {
    console.log(`Cleaned up ${roomsCleaned} inactive rooms`);
  }
}, 60000);

// Connection state monitoring
setInterval(() => {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;

  connectionStates.forEach((state, socketId) => {
    if (now - state.lastPing > FIVE_MINUTES) {
      console.log(`Cleaning up stale connection: ${socketId}`);
      connectionStates.delete(socketId);
    }
  });
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access via: http://localhost:${PORT}`);
  console.log(`Lounge: http://localhost:${PORT}/lounge`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Active rooms: ${rooms.size}`);

  // Check translation services availability
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  WARNING: DEEPSEEK_API_KEY not found in environment variables');
    console.warn('   DeepSeek translation will not be available');
  } else {
    console.log('✅ DeepSeek translation service is available');
  }
  console.log('✅ Google translation service is available (free)');
  console.log('✅ Enhanced mobile support enabled');
  console.log('✅ Short room ID generation enabled');
});

process.on('SIGINT', () => {
  console.log('Shutting down server gracefully...');
  console.log(`Active rooms before shutdown: ${rooms.size}`);

  io.emit('server-shutdown');

  setTimeout(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }, 1000);
});
