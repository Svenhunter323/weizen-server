import {Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { UserInfo } from './UserInfo.js';
import { RoomInfo } from './RoomInfo.js';

export class LobbyState extends Schema {
  constructor() {
    super();
    this.users = new MapSchema();
    this.rooms = new ArraySchema();
  }

  static defineSchema() {
    type({ map: UserInfo })(this.prototype, "users");
    type([ RoomInfo ])(this.prototype, "rooms");
  }
}
LobbyState.defineSchema();
