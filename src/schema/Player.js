import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.seat = "";
    this.hand = [];
    this.bid = -1;
    this.tricksWon = 0;
    this.score = 0;
  }

  static defineSchema() {
    type("string")(this.prototype, "id");
    type("string")(this.prototype, "name");
    type("string")(this.prototype, "seat");
    type(["string"])(this.prototype, "hand");
    type("number")(this.prototype, "bid");
    type("number")(this.prototype, "tricksWon");
    type("number")(this.prototype, "score");
  }
}
Player.defineSchema();
