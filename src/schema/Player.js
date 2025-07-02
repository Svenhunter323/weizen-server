import { ArraySchema, Schema, type } from '@colyseus/schema';
import { Card } from './Card.js';

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
    type("string")(this.prototype, "id");
    type("string")(this.prototype, "name");
    type("string")(this.prototype, "seat");
    type([ Card ])(this.prototype, "hand");
    type("number")(this.prototype, "bid");
    type("number")(this.prototype, "tricksWon");
    type("number")(this.prototype, "score");
    type([Card])(this.prototype, "capturedCards");
  }
}
Player.defineSchema();
