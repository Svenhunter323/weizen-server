import { LobbyRoom as ColyseusLobby, matchMaker } from 'colyseus';
import {ArraySchema } from '@colyseus/schema';
import { LobbyState } from '../schema/LobbyState.js';
import { UserInfo } from '../schema/UserInfo.js';
import { RoomInfo } from '../schema/RoomInfo.js';

import { verifyJWT } from '../util/jwt.util.js';

export class LobbyRoom extends ColyseusLobby {

  onCreate(options) {
    super.onCreate(options);
    console.log('✅ LobbyRoom created');

    this.state = new LobbyState();

    // NEW: track pending reconnections
    this.pendingReconnections = new Map();

    this.clock.setInterval(() => this.updateRoomList(), 3000);
  }

  async onAuth(client, options) {
    const token = options.token;
    // console.log("🛂 Received token:", token);

    try {
      const user = verifyJWT(token);
      // console.log(user);
      if (!user) throw new Error("User not found in token");

      // Check if they are reconnecting
      if (this.pendingReconnections.has(user.id)) {
        console.log(`✅ Recognized pending reconnection for user ${user.username}`);
        // Allow reconnection
        client.userData = user;
        return true;
      }

      // Check if someone else is already logged in with this ID
      const alreadyConnected = this.clients.find(
        c => c.userData?.id === user.id
      );

      if (alreadyConnected) {
        console.warn(`❌ User ${user.username} is already connected. Rejecting duplicate.`);
        throw new Error("Duplicate login detected");
      }

      client.userData = user;
      return true;

    } catch (err) {
      console.error("❌ JWT verification failed:", err.message);
      throw new Error("Unauthorized");
    }
  }

  onJoin(client, options) {
    console.log(`✅ Client joined lobby: ${client.sessionId}`);

    const username = client.userData?.username || "Guest";

    // Check if this was a reconnection
    if (this.pendingReconnections.has(client.userData.id)) {
      console.log(`🔄 Restoring state for reconnected user ${username}`);
      const savedUserInfo = this.pendingReconnections.get(client.userData.id);
      this.state.users.set(client.sessionId, savedUserInfo);
      this.pendingReconnections.delete(client.userData.id);
    } else {
      // Normal first-time join
      const user = new UserInfo();
      user.id = client.sessionId;
      user.username = username;
      this.state.users.set(client.sessionId, user);
    }

    this.broadcastPatch();
  }

  async onLeave(client, consented) {
    console.log(`❎ Client left lobby: ${client.sessionId} (consented=${consented})`);

    if (consented) {
      // Voluntary leave → remove immediately
      if (this.state.users.has(client.sessionId)) {
        this.state.users.delete(client.sessionId);
        this.broadcastPatch();
      }
      return;
    }

    console.log(`🕒 Waiting for possible reconnection for ${client.sessionId}`);

    // Save user data temporarily
    const userInfo = this.state.users.get(client.sessionId);
    if (userInfo) {
      this.pendingReconnections.set(client.userData.id, userInfo);
    }

    // Wait up to 10 seconds for reconnection
    try {
      await this.allowReconnection(client, 10);
      console.log(`✅ Client ${client.sessionId} successfully reconnected!`);
    } catch (e) {
      console.log(`❌ Client ${client.sessionId} failed to reconnect in time.`);
      // Timed out → clean up
      if (this.state.users.has(client.sessionId)) {
        this.state.users.delete(client.sessionId);
      }
      this.pendingReconnections.delete(client.userData.id);
      this.broadcastPatch();
    }
  }

  onDispose() {
    console.log('❎ LobbyRoom disposed');
  }

  async updateRoomList() {
    try {
      const rooms = await matchMaker.query({});
      const roomInfos = [];

      for (const room of rooms) {
        if (room.name === "lobby") continue;

        const info = new RoomInfo();
        info.roomId = room.roomId;
        info.name = room.name;
        info.playercount = room.clients;
        info.isJoinable = !room.locked;

        roomInfos.push(info);
      }

      this.state.rooms = new ArraySchema(...roomInfos);
      this.broadcastPatch();
    } catch (err) {
      console.error("[LobbyRoom] Failed to update room list:", err);
    }
  }
}
