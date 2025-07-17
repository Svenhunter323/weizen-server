import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  avatar: { type: String, default: "" },

  // NEW FIELDS:
  wznBalance: { type: Number, default: 100 },
  cheatFlags: { type: Number, default: 0 },
  roundHistory: [{
    date: { type: Date, default: Date.now },
    contractType: Number,
    success: Boolean,
    scoreDelta: Number
  }],
  ShopHistory: [{
    date: { type: Date, default: Date.now },
    type: String,
    success: Boolean,
    amount: Number
  }],
  PubkeyStr: String,
  entryFee: { type: Number, default: 0}
});

userSchema.statics.getPubKeyById = async function (id) {
  const user = await this.findById(id, 'PubkeyStr');
  return user ? user.PubkeyStr : null;
};
userSchema.statics.getEntryFeeById = async function (id) {
  const user = await this.findById(id, 'entryFee');
  return user ? user.entryFee : 0;
};

export const User = mongoose.model('User', userSchema);
