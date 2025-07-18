import express from 'express';
import http from 'http';
import { Server } from 'colyseus';
import { monitor } from "@colyseus/monitor";
import { WebSocketTransport } from '@colyseus/ws-transport';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

import { connectDB } from './db/mongoose.js';
import { addAuthRoutes } from './routes/authRoutes.js';
import { addGameRoute } from './routes/gameRoute.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { WeizenRoom } from './rooms/WeizenRoom.js';

const PORT = process.env.PORT || 2567;

// Resolve __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to MongoDB first
await connectDB();

// Setup Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (e.g., from forms)

// Allow CORS from any domain (or specify your frontend origin)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve static uploaded avatars
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// Serve WebGL builds from /games/*
app.use('/games', express.static(path.join(__dirname, '../public/games')));
// Server Lobby
app.use('/', express.static(path.join(__dirname, '../public/lobby')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/lobby', 'index.html'));
});

// Add authentication REST API routes
addAuthRoutes(app);
addGameRoute(app);

// Optional: Colyseus admin monitor
app.use("/colyseus", monitor());

// Create HTTP server (for Express + Colyseus)
const server = http.createServer(app);

// Setup Colyseus game server
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

// Define rooms
gameServer.define('lobby', LobbyRoom);
gameServer.define('weizen', WeizenRoom).enableRealtimeListing();

// Start listening
gameServer.listen(PORT);

console.log(`✅ Server ready at:
 - REST:    http://localhost:${PORT}/api
 - WS:      ws://localhost:${PORT}
 - Avatars: http://localhost:${PORT}/uploads
 - Admin:   http://localhost:${PORT}/colyseus
`);
