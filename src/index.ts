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

const CLIENT_URL = process.env.CLIENT_URL;
if (!CLIENT_URL) throw new Error('CLIENT_URL environment variable is required');

const corsOrigins = CLIENT_URL;

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use('/api', apiRouter);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

io.on('connection', (socket) => handleConnection(socket, io));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info('Server', `Multiplayer server running on port ${PORT}`, { port: PORT, corsOrigin: corsOrigins });
});
