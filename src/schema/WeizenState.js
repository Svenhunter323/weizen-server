import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { Player } from './Player.js';
import { BidEntry } from './BidEntry.js';

export class WeizenState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.phase = "waiting";
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.currentDealerIndex = 0;
    this.bids = new ArraySchema();
    this.currentBidderId = "";
    this.winningBid = null;
    this.contractType = -1;
    this.contractBidderId = "";
    this.contractPartners = new ArraySchema();
    this.trumpSuit = "";
  }

  static defineSchema() {
    type({ map: Player })(this.prototype, "players");
    type("string")(this.prototype, "phase");
    type(["string"])(this.prototype, "turnOrder");
    type("number")(this.prototype, "currentTurnIndex");
    type("number")(this.prototype, "currentDealerIndex");
    type([BidEntry])(this.prototype, "bids");
    type("string")(this.prototype, "currentBidderId");
    type(BidEntry)(this.prototype, "winningBid");
    type("number")(this.prototype, "contractType");
    type("string")(this.prototype, "contractBidderId");
    type(["string"])(this.prototype, "contractPartners");
    type("string")(this.prototype, "trumpSuit");
  }
}
WeizenState.defineSchema();
