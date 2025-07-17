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
    this.roundscore = 0;
    this.capturedCards = new ArraySchema();
    this.avatar = "";
    this.wznBalance = 100;       // NEW: Default starting balance
    this.cheatFlags = 0;         // NEW: Cheating reports
  }

  static defineSchema() {
    type("string")(this.prototype, "id");                  // 0
    type("string")(this.prototype, "name");                // 1
    type("string")(this.prototype, "seat");                // 2
    type([Card])(this.prototype, "hand");                  // 3
    type("int32")(this.prototype, "bid");                  // 4
    type("int32")(this.prototype, "tricksWon");            // 5
    type("int32")(this.prototype, "score");                // 6
    type("int32")(this.prototype, "roundscore");           // 7
    type([Card])(this.prototype, "capturedCards");         // 8
    type("string")(this.prototype, "avatar");              // 9
    type("int32")(this.prototype, "wznBalance");           // 10 NEW
    type("int32")(this.prototype, "cheatFlags");           // 11 NEW
  }
}

Player.defineSchema();
