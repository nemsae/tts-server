import 'dotenv/config';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection.js';
import { logger } from './utils/logger.js';
import { handleApiRequest } from './routes/api.js';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

io.on('connection', (socket) => handleConnection(socket, io));

// REST API handler
httpServer.on('request', async (req, res) => {
  // Skip Socket.io internal requests
  if (req.url?.startsWith('/socket.io/')) {
    return; // Let Socket.io handle it
  }
  
  const handled = await handleApiRequest(req, res);
  if (!handled && !res.headersSent) {
    // Not an API request, send 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info('Server', `Multiplayer server running on port ${PORT}`, { port: PORT, corsOrigin: process.env.CLIENT_URL || 'http://localhost:5173' });
});