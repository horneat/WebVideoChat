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

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms with metadata
const rooms = new Map();

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
  const newRoomId = uuidv4();
  rooms.set(newRoomId, {
    users: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now()
  });
  console.log(`New room created: ${newRoomId}`);
  res.redirect(`/chat/${newRoomId}`);
});

// API endpoints
app.get('/api/rooms', (req, res) => {
  const roomInfo = {};
  rooms.forEach((roomData, roomId) => {
    roomInfo[roomId] = {
      users: Array.from(roomData.users),
      userCount: roomData.users.size,
      createdAt: roomData.createdAt,
      lastActivity: roomData.lastActivity
    };
  });

  res.json({
    totalRooms: rooms.size,
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Add this handler for room checking
  socket.on('check-room', (roomId, callback) => {
    const exists = rooms.has(roomId);
    console.log(`Socket Check: Room ${roomId} exists: ${exists}`);
    callback({ exists });
  });

  socket.on('join-room', (roomId, userId) => {
    console.log(`User ${userId} joining room ${roomId}`);

    // Create room if it doesn't exist (for direct URL access)
    if (!rooms.has(roomId)) {
      console.log(`Room ${roomId} doesn't exist, creating new room`);
      rooms.set(roomId, {
        users: new Set(),
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    }

    const room = rooms.get(roomId);

    // Get existing users before adding new one
    const otherUsers = Array.from(room.users);

    // Add new user to room
    room.users.add(userId);
    room.lastActivity = Date.now();
    socket.join(roomId);

    console.log(`Room ${roomId} now has users:`, Array.from(room.users));

    // Notify new user about existing users
    if (otherUsers.length > 0) {
      socket.emit('existing-users', otherUsers);
    }

    // Notify other users about new user
    socket.to(roomId).emit('user-connected', userId);

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
    socket.on('offer', (data) => {
      console.log(`Offer from ${data.userId} to room ${roomId}`);
      socket.to(roomId).emit('offer', {
        offer: data.offer,
        userId: data.userId
      });
    });

    socket.on('answer', (data) => {
      console.log(`Answer from ${data.userId} to room ${roomId}`);
      socket.to(roomId).emit('answer', {
        answer: data.answer,
        userId: data.userId
      });
    });

    socket.on('ice-candidate', (data) => {
      console.log(`ICE candidate from ${data.userId} to room ${roomId}`);
      socket.to(roomId).emit('ice-candidate', {
        candidate: data.candidate,
        userId: data.userId
      });
    });

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
