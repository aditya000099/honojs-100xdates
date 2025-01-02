const { Hono } = require('hono');
const { Client, Databases } = require('node-appwrite');
const { createServer } = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Hono app
const app = new Hono();

// Initialize Appwrite client
const client = new Client();
client
  .setEndpoint('https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

// Initialize cache
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

// Initialize HTTP server and Socket.io
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware to parse JSON
app.use('*', async (c, next) => {
  c.req.body = await c.req.json();
  await next();
});

// Track user online status
const onlineUsers = new Map();

// Endpoint to get messages for a specific chat
app.get('/messages/:chatId', async (c) => {
  const chatId = c.req.param('chatId');
  const cachedMessages = cache.get(chatId);

  if (cachedMessages) {
    return c.json(cachedMessages);
  }

  const response = await databases.listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_MESSAGES_COLLECTION_ID,
    [`equal("chatId", "${chatId}")`, `orderAsc("timestamp")`]
  );

  cache.set(chatId, response.documents);
  return c.json(response.documents);
});


// Socket.io for real-time chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User comes online
  socket.on('online', (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit('userStatus', { userId, status: 'online' });
  });

  // Send message
  socket.on('sendMessage', async (message) => {
        // Save message to Appwrite
        const response = await databases.createDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_MESSAGES_COLLECTION_ID,
          'unique()',
          message
        );


      // Emit message to both users in the chat
      io.to(message.chatId).emit('receiveMessage', response);
  });


  // Join a chat room
  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined chat ${chatId}`);
  });

  // User goes offline
  socket.on('disconnect', () => {
    const userId = [...onlineUsers.entries()].find(([_, id]) => id === socket.id)?.[0];
    if (userId) {
      onlineUsers.delete(userId);
      io.emit('userStatus', { userId, status: 'offline' });
    }
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const port = process.env.PORT || 3001
httpServer.listen(port, () => {
  console.log('Server is running on port', port);
});