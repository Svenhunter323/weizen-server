import {Schema, type} from '@colyseus/schema';

export class RoomInfo extends Schema {
  constructor() {
    super();
    this.roomId = "";
    this.name = "";
    this.playercount = 0;
    this.isJoinable = true;
  }

  static defineSchema() {
    type("string")(this.prototype, "roomId");
    type("string")(this.prototype, "name");
    type("int32")(this.prototype, "playercount");
    type("boolean")(this.prototype, "isJoinable");
  }
}
RoomInfo.defineSchema();
