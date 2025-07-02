import {Schema, type} from '@colyseus/schema';

export class BidEntry extends Schema {
  constructor() {
    super();
    this.playerId = "";
    this.bidType = 0;
  }

  static defineSchema() {
    type("string")(this.prototype, "playerId");
    type("number")(this.prototype, "bidType");
  }
}
BidEntry.defineSchema();
