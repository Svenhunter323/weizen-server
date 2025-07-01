import { Schema, type } from '@colyseus/schema';

export class Card extends Schema {
  constructor({ rank = "", suit = "" } = {}) {
    super();
    this.rank = rank;
    this.suit = suit;
  }

  static defineSchema() {
    type("string")(this.prototype, "rank");
    type("string")(this.prototype, "suit");
  }
}

Card.defineSchema();