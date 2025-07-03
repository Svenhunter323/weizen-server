import { Schema, type } from "@colyseus/schema";

export class BidEntry extends Schema {
  constructor() {
    super();
    this.playerId = "";
    this.bidType = 0;
  }

  static defineSchema() {
    type("string")(this.prototype, "playerId"); // index 0
    type("int32")(this.prototype, "bidType");  // index 1
  }
}
BidEntry.defineSchema();
