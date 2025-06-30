import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player.js';

export class WeizenState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.phase = "waiting";
    this.turnOrder = [];
    this.currentTurnIndex = 0;
  }

  static defineSchema() {
    type({ map: Player })(this.prototype, "players");
    type("string")(this.prototype, "phase");
    type(["string"])(this.prototype, "turnOrder");
    type("number")(this.prototype, "currentTurnIndex");
  }
}
WeizenState.defineSchema();
