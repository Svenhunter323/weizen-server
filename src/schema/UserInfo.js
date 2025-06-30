import {Schema, type} from '@colyseus/schema';

export class UserInfo extends Schema {
  constructor() {
    super();
    this.id = "";
    this.username = "";
  }

  static defineSchema() {
    type("string")(this.prototype, "id");
    type("string")(this.prototype, "username");
  }
}
UserInfo.defineSchema();
