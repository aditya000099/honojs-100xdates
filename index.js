const { Client, Databases } = require('node-appwrite');
const http = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Appwrite client
const client = new Client();
client
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

// Initialize cache
const cache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

// Initialize HTTP server
const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello World');
});

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
        onlineUsers.set(userId, socket.id);
        io.emit('userStatus', { userId, status: 'online' });
    });

    // Send message
    socket.on('sendMessage', async (message) => {
        // Save message to Appwrite
        try {
            const response = await databases.createDocument(
                process.env.APPWRITE_DATABASE_ID,
                process.env.APPWRITE_MESSAGES_COLLECTION_ID,
                'unique()',
                message
            );
              // Emit message to both users in the chat
           io.to(message.chatId).emit('receiveMessage', response);
        } catch (error) {
            console.error("Error saving message to appwrite:", error);
        }

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



const port = process.env.PORT || 3001;
httpServer.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Error starting server:', err);
    } else {
        console.log(`Server is running on port ${port}`);
    }
});


let requestHandled = false;

// Endpoint to get messages for a specific chat
httpServer.on('request', async (req, res) => {
     requestHandled = false;
  const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/messages/')) {
        if(req.method === 'GET'){
             const chatId = url.pathname.split('/')[2];
                 try {
                         const cachedMessages = cache.get(chatId);
                            if(cachedMessages){
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify(cachedMessages));
                                requestHandled = true;
                                return;
                            }

                            const response = await databases.listDocuments(
                                process.env.APPWRITE_DATABASE_ID,
                                process.env.APPWRITE_MESSAGES_COLLECTION_ID,
                                [`equal("chatId", "${chatId}")`, `orderAsc("timestamp")`]
                            );

                                  cache.set(chatId, response.documents);
                                 res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify(response.documents));
                                requestHandled = true;
                                 return;
                    }catch(error){
                         console.error("Error getting messages:", error);
                             res.writeHead(500, { 'Content-Type': 'text/plain' });
                             res.end('Internal Server Error');
                                requestHandled = true;
                                  return;
                    }
        } else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            requestHandled = true;
            return;
      }
    }
    
        if (url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end("Hello World");
            requestHandled = true;
             return;
    }
         if (!requestHandled) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
             return;
        }

});