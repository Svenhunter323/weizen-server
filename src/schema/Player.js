import { Schema, type, ArraySchema } from "@colyseus/schema";
import { Card } from "./Card.js";

export class Player extends Schema {
  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.seat = "";
    this.hand = new ArraySchema();
    this.bid = 0;
    this.tricksWon = 0;
    this.score = 0;
    this.capturedCards = new ArraySchema();
  }

  static defineSchema() {
    type("string")(this.prototype, "id");                  // index 0
    type("string")(this.prototype, "name");                // index 1
    type("string")(this.prototype, "seat");                // index 2
    type([Card])(this.prototype, "hand");                  // index 3
    type("int32")(this.prototype, "bid");                  // index 4
    type("int32")(this.prototype, "tricksWon");            // index 5
    type("int32")(this.prototype, "score");                // index 6
    type([Card])(this.prototype, "capturedCards");         // index 7
  }
}
Player.defineSchema();
