import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
    // bcrypt-hashed string
  },
  refreshToken: String,
  avatar: String
}, {
  timestamps: true // optional: adds createdAt / updatedAt
});

export const User = mongoose.model('User', UserSchema);
