const { Client, Databases } = require('node-appwrite');
const http = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');

dotenv.config();

// Log environment variables at the start
console.log("Environment Variables:", process.env);
// Initialize Appwrite client
const client = new Client();
client
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
    
    console.log("Appwrite client initialized");


const databases = new Databases(client);
 console.log("Appwrite databases initialized");

// Initialize cache
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });
console.log("Cache initialized");

// Initialize HTTP server
const httpServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/') {
          console.log("GET / request received")
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("Hello Devs");
         return;
  } else {
         console.log(`404 request received for ${url.pathname}`)
     res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end("Not Found");
         return;
  }
});

console.log("HTTP server initialized")

// Initialize Socket.io
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// Track user online status
const onlineUsers = new Map();

// Socket.io for real-time chat
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User comes online
    socket.on('online', (userId) => {
         console.log(`User ${userId} came online`)
        onlineUsers.set(userId, socket.id);
         io.emit('userStatus', { userId, status: 'online' });
    });

    // Send message
    socket.on('sendMessage', async (message) => {
        // Save message to Appwrite
        try {
            console.log("Saving message to appwrite:", message);

            const response = await databases.createDocument(
                process.env.APPWRITE_DATABASE_ID,
                process.env.APPWRITE_MESSAGES_COLLECTION_ID,
                'unique()',
                message
            );
             console.log("Message saved to Appwrite", response);
              // Emit message to both users in the chat
           io.to(message.chatId).emit('receiveMessage', response);
        } catch (error) {
            console.error("Error saving message to appwrite:", error);
        }

    });

    // Join a chat room
    socket.on('joinChat', (chatId) => {
         console.log(`User joined chat ${chatId}`)
        socket.join(chatId);
        console.log(`User ${socket.id} joined chat ${chatId}`);
    });

    // User goes offline
    socket.on('disconnect', () => {
        const userId = [...onlineUsers.entries()].find(([_, id]) => id === socket.id)?.[0];
        if (userId) {
             console.log(`User ${userId} went offline`)
            onlineUsers.delete(userId);
            io.emit('userStatus', { userId, status: 'offline' });
        }
        console.log('User disconnected:', socket.id);
    });
});


const port = process.env.PORT || 3001;
httpServer.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Error starting server:', err);
    } else {
        console.log(`Server is running on port ${port}`);
    }
});
 console.log("http Server running on port", port)

// Endpoint to get messages for a specific chat
io.on('connection', (socket) => {
    socket.on('getMessages', async (chatId) => {
           console.log(`Fetching messages for ${chatId}`);
         try {
             const cachedMessages = cache.get(chatId);
                if(cachedMessages){
                      console.log(`Messages fetched from cache for ${chatId}`);
                    socket.emit("messages", cachedMessages)
                    return;
                }
                     console.log(`Fetching messages from Appwrite for ${chatId}`);

                   const response = await databases.listDocuments(
                        process.env.APPWRITE_DATABASE_ID,
                        process.env.APPWRITE_MESSAGES_COLLECTION_ID,
                        [`equal("chatId", "${chatId}")`, `orderAsc("timestamp")`]
                    );
                    console.log("Fetched messages from appwrite", response);
                 cache.set(chatId, response.documents);
                 socket.emit("messages",response.documents);
              } catch (error) {
                   console.error("Error getting messages:", error);
              }
        });
});