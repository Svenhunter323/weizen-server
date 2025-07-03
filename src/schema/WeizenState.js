import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";
import { BidEntry } from "./BidEntry.js";
import { Player } from "./Player.js";

export class WeizenState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.phase = "waiting";
    this.turnOrder = new ArraySchema();
    this.currentTurnIndex = 0;
    this.currentDealerIndex = 0;
    this.bids = new ArraySchema();
    this.currentBidderId = "";
    this.winningBid;
    this.contractType = 0;
    this.contractBidderId = "";
    this.contractPartners = new ArraySchema();
    this.trumpSuit = "";
  }

  static defineSchema() {
    type({ map: Player })(this.prototype, "players");         // 0
    type("string")(this.prototype, "phase");                  // 1
    type([ "string" ])(this.prototype, "turnOrder");          // 2
    type("int32")(this.prototype, "currentTurnIndex");        // 3
    type("int32")(this.prototype, "currentDealerIndex");      // 4
    type([ BidEntry ])(this.prototype, "bids");               // 5
    type("string")(this.prototype, "currentBidderId");        // 6
    type(BidEntry)(this.prototype, "winningBid");             // 7
    type("int32")(this.prototype, "contractType");            // 8
    type("string")(this.prototype, "contractBidderId");       // 9
    type([ "string" ])(this.prototype, "contractPartners");   // 10
    type("string")(this.prototype, "trumpSuit");              // 11
  }
}
WeizenState.defineSchema();