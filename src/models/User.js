import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
    // bcrypt-hashed string
  }
}, {
  timestamps: true // optional: adds createdAt / updatedAt
});

export const User = mongoose.model('User', UserSchema);
