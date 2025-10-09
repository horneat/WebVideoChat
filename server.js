const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms
const rooms = new Map();

app.get('/', (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, new Set());
  res.redirect(`/${roomId}`);
});

app.get('/:room', (req, res) => {
  const roomId = req.params.room;
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId, userId) => {
    console.log(`User ${userId} joining room ${roomId}`);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    
    // Get existing users before adding new one
    const otherUsers = Array.from(room);
    
    // Add new user to room
    room.add(userId);
    socket.join(roomId);
    
    console.log(`Room ${roomId} has users:`, Array.from(room));

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
        rooms.set(data.roomId, new Set());
      }
      
      const rejoinRoom = rooms.get(data.roomId);
      rejoinRoom.add(data.userId);
      socket.join(data.roomId);
      
      // Notify other users about reconnection
      socket.to(data.roomId).emit('user-reconnected', data.userId);
      console.log(`User ${data.userId} rejoined room ${data.roomId}`);
    });

    // Handle user reconnection notification
    socket.on('user-reconnected', (data) => {
      console.log(`User ${data.userId} reconnected to room ${data.roomId}`);
      socket.to(data.roomId).emit('user-reconnected', data.userId);
    });

    // Handle user leaving (refresh/close)
    socket.on('user-leaving', (data) => {
      console.log(`User ${data.userId} is leaving room ${data.roomId}`);
      socket.to(data.roomId).emit('user-left', data.userId);
    });

    // Handle manual reconnection request
    socket.on('reconnect-request', (data) => {
      console.log(`Reconnection requested by ${data.userId} in room ${data.roomId}`);
      socket.to(data.roomId).emit('reconnect-user', data.userId);
    });

    // Handle remote audio toggle (mute/unmute)
    socket.on('remote-audio-toggle', (data) => {
      console.log(`User ${data.userId} ${data.muted ? 'muted' : 'unmuted'} their audio in room ${data.roomId}`);
      socket.to(data.roomId).emit('remote-audio-toggle', {
        userId: data.userId,
        muted: data.muted
      });
    });

    // WebRTC signaling handlers
    socket.on('offer', (data) => {
      console.log(`Offer from ${data.userId} to room ${roomId}`);
      socket.to(roomId).emit('offer', data);
    });

    socket.on('answer', (data) => {
      console.log(`Answer from ${data.userId} to room ${roomId}`);
      socket.to(roomId).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
      socket.to(roomId).emit('ice-candidate', data);
    });

    socket.on('chat-message', (data) => {
      console.log(`Chat message from ${data.userId} in room ${roomId}: ${data.message}`);
      io.to(roomId).emit('chat-message', {
        userId: data.userId || userId,
        message: data.message,
        messageId: data.messageId, // Include message ID to prevent duplicates
        timestamp: data.timestamp || new Date().toLocaleTimeString()
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected from room ${roomId}`);
      
      const room = rooms.get(roomId);
      if (room) {
        room.delete(userId);
        socket.to(roomId).emit('user-disconnected', userId);
        
        // Clean up empty rooms
        if (room.size === 0) {
          // Wait a bit before deleting room to allow reconnections
          setTimeout(() => {
            if (rooms.get(roomId) && rooms.get(roomId).size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} deleted (empty)`);
            }
          }, 30000); // Wait 30 seconds before deleting room
        } else {
          console.log(`Room ${roomId} still has ${room.size} users:`, Array.from(room));
        }
      }
    });
  });

  // Handle direct socket disconnection (without room context)
  socket.on('disconnect', (reason) => {
    console.log(`Socket ${socket.id} disconnected:`, reason);
    
    // Find and remove user from all rooms
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);
        
        if (users.size === 0) {
          setTimeout(() => {
            if (rooms.get(roomId) && rooms.get(roomId).size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} cleaned up after disconnect`);
            }
          }, 30000);
        }
      }
    });
  });

  // Handle connection errors
  socket.on('connect_error', (error) => {
    console.log('Socket connection error:', error);
  });

  // Handle reconnection attempts
  socket.on('reconnect', (attemptNumber) => {
    console.log('Socket reconnected, attempt:', attemptNumber);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Socket reconnection attempt:', attemptNumber);
  });

  socket.on('reconnect_error', (error) => {
    console.log('Socket reconnection error:', error);
  });

  socket.on('reconnect_failed', () => {
    console.log('Socket reconnection failed');
  });
});

// Room cleanup interval (remove empty rooms periodically)
setInterval(() => {
  const now = Date.now();
  let roomsCleaned = 0;
  
  rooms.forEach((users, roomId) => {
    if (users.size === 0) {
      rooms.delete(roomId);
      roomsCleaned++;
      console.log(`Cleaned up empty room: ${roomId}`);
    }
  });
  
  if (roomsCleaned > 0) {
    console.log(`Cleaned up ${roomsCleaned} empty rooms`);
  }
}, 60000); // Check every minute

// Health check endpoint
app.get('/health', (req, res) => {
  const roomCount = rooms.size;
  const totalUsers = Array.from(rooms.values()).reduce((sum, users) => sum + users.size, 0);
  
  res.json({
    status: 'ok',
    rooms: roomCount,
    totalUsers: totalUsers,
    timestamp: new Date().toISOString()
  });
});

// Room info endpoint (for debugging)
app.get('/api/rooms', (req, res) => {
  const roomInfo = {};
  rooms.forEach((users, roomId) => {
    roomInfo[roomId] = Array.from(users);
  });
  
  res.json({
    totalRooms: rooms.size,
    rooms: roomInfo
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access via: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Room info: http://localhost:${PORT}/api/rooms`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server gracefully...');
  console.log(`Active rooms before shutdown: ${rooms.size}`);
  
  // Notify all clients about server shutdown
  io.emit('server-shutdown');
  
  setTimeout(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }, 1000);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
