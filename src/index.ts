import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { handleConnection } from './handlers/connection.js';
import { logger } from './utils/logger.js';
import apiRouter from './routes/api.js';

const app = express();
const httpServer = createServer(app);

const getCorsOrigins = (): string | string[] => {
  const envOrigins = process.env.CLIENT_URL || '';
  if (!envOrigins) return 'http://localhost:5173';

  const origins = envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  return origins.length > 0 ? origins : ['http://localhost:5173'];
};

app.use(cors({ origin: getCorsOrigins(), credentials: true }));
app.use(express.json());
app.use('/api', apiRouter);

const io = new Server(httpServer, {
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

io.on('connection', (socket) => handleConnection(socket, io));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info('Server', `Multiplayer server running on port ${PORT}`, { port: PORT, corsOrigin: process.env.CLIENT_URL || 'http://localhost:5173' });
});
