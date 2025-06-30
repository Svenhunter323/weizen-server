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

    // Safely update room list every 3 seconds
    this.clock.setInterval(() => this.updateRoomList(), 3000);

    // Built-in: automatic room list updates are already handled
    // when client calls "getAvailableRooms" on the lobby
  }
  async onAuth(client, options) {
    const token = options.token;
    const user = verifyJWT(token);
    if (!user) throw new Error("Unauthorized");
    client.userData = user;
    return true;
  }

  onMessage(client, type, message) {
    console.log(`📩 LobbyRoom received message: ${type}`);
    // Call built-in handling first!
    super.onMessage(client, type, message);
  }

  onJoin(client, options) {
    console.log(`✅ Client joined lobby: ${client.sessionId}`);

    const username = client.userData?.username || "Guest";
    const user = new UserInfo();
    user.id = client.sessionId;
    user.username = username;

    this.state.users.set(client.sessionId, user);

    console.log(`✅ User registered in lobby: ${user.username} (${user.id})`);

    // Notify all clients that state changed
    this.broadcastPatch();
  }

  onLeave(client) {
    console.log(`❎ Client left lobby: ${client.sessionId}`);

    if (this.state.users.has(client.sessionId)) {
      this.state.users.delete(client.sessionId);
      this.broadcastPatch();
    }
    // Notify all clients that state changed
    this.broadcastPatch();
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

        // console.log(`room name = ${info.name}, players = ${room.clients}`);

        roomInfos.push(info);
      }

      this.state.rooms = new ArraySchema(...roomInfos);
      this.broadcastPatch();
    } catch (err) {
      console.error("[LobbyRoom] Failed to update room list:", err);
    }
  }

}
