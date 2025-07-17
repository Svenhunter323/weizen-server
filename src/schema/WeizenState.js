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
    this.dealerId = "";            // NEW: Current dealer ID
    this.roundNumber = 1;          // NEW: Track round count

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
    type("string")(this.prototype, "dealerId");               // 5 NEW
    type("int32")(this.prototype, "roundNumber");             // 6 NEW
    type([ BidEntry ])(this.prototype, "bids");               // 7
    type("string")(this.prototype, "currentBidderId");        // 8
    type(BidEntry)(this.prototype, "winningBid");             // 9
    type("int32")(this.prototype, "contractType");            // 10
    type("string")(this.prototype, "contractBidderId");       // 11
    type([ "string" ])(this.prototype, "contractPartners");   // 12
    type("string")(this.prototype, "trumpSuit");              // 13
  }
}

WeizenState.defineSchema();
