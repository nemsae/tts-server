import 'dotenv/config';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection.js';
import { logger } from './utils/logger.js';

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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info('Server', `Multiplayer server running on port ${PORT}`, { port: PORT, corsOrigin: process.env.CLIENT_URL || 'http://localhost:5173' });
});
