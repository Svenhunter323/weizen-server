// index.js
import express from 'express';
import http from 'http';
import { Server } from 'colyseus';
import { monitor } from "@colyseus/monitor";
import { WebSocketTransport } from '@colyseus/ws-transport';
import { connectDB } from './db/mongoose.js';
import { addAuthRoutes } from './routes/authRoutes.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { WeizenRoom } from './rooms/WeizenRoom.js';
const cors = require('cors');

import appConfig from './app.config.js';

const PORT = process.env.PORT || 2567;

// Connect to MongoDB first
await connectDB();

// Setup Express
const app = express();
app.use(express.json());

// Allow requests from Unity's domain or any specific domain
app.use(cors({
  origin: '*',  // This allows all origins
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add authentication REST API routes
addAuthRoutes(app);

app.use("/colyseus", monitor());


// Create HTTP server (for Express + Colyseus)
const server = http.createServer(app);

// Setup Colyseus game server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server
  }),
});

// Define rooms
gameServer.define('lobby', LobbyRoom); //.enableRealtimeListing();
gameServer.define('weizen', WeizenRoom).enableRealtimeListing();

// Start listening
gameServer.listen(PORT);

console.log(`✅ Server ready at:
 - REST:    http://localhost:${PORT}/api
 - WebSocket: ws://localhost:${PORT}
`);
