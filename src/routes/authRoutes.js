import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import { User } from '../models/User.js';
import { JWT_SECRET, verifyJWT } from '../util/jwt.util.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

// Multer config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/avatars'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage });

export function addAuthRoutes(app) {
  const router = express.Router();

  /** REGISTER */
  router.post('/register', async (req, res) => {
    const { username, email, password, walletAddress } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing wallet address' });
    }

    try {
      const existing = await User.findOne({ username });
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const newUser = new User({ username, email, password: hashedPassword, PubkeyStr: walletAddress });

      const accessToken = jwt.sign(
        { id: newUser._id, username, email },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
      );
      const refreshToken = jwt.sign(
        { id: newUser._id, username },
        JWT_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
      );

      newUser.refreshToken = refreshToken;
      await newUser.save();

      res.json({
        success: true,
        user: { id: newUser._id, username, email, avatar: newUser.avatar },
        accessToken,
        refreshToken
      });
    } catch (err) {
      console.error('❌ Registration Error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /** LOGIN */
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    try {
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const accessToken = jwt.sign(
        { id: user._id, username: user.username, email: user.email, avatar: user.avatar },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
      );
      const refreshToken = jwt.sign(
        { id: user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
      );

      user.refreshToken = refreshToken;
      await user.save();

      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          wallet: user.PubkeyStr
        },
        accessToken,
        refreshToken
      });
    } catch (err) {
      console.error('❌ Login Error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

    /** VERIFY JWT */
  router.post('/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    // console.log(req);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = verifyJWT(token);
      if (decoded) 
        res.status(200).json({ success: true, user: decoded });
      else 
        res.status(401).json({ success: false, message: "Invalid or expired token" });
    } catch (err) {
      res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
  });

  /** REFRESH */
  router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    try {
      const decoded = verifyJWT(refreshToken);

      const user = await User.findOne({ _id: decoded.id, refreshToken });
      if (!user) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const newAccessToken = jwt.sign(
        { id: user._id, username: user.username, email: user.email, avatar: user.avatar },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
      );

      res.json({ accessToken: newAccessToken });
    } catch (err) {
      console.error('❌ Refresh Error:', err);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  /** PROFILE UPDATE */
  router.post('/profile/update', upload.single('avatar'), async (req, res) => {
    try {
      const { userId, username, email, wallet } = req.body;
      // console.log(req.body);
      const avatarPath = req.file ? `/uploads/avatars/${req.file.filename}` : null;

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (username) user.username = username;
      if (email) user.email = email;
      if (avatarPath) user.avatar = avatarPath;
      if (wallet) user.PubkeyStr = wallet;

      await user.save();

      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          wallet: user.PubkeyStr,
        }
      });
    } catch (err) {
      console.error('❌ Profile Update Error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/change-password', async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

      const hashed = await bcrypt.hash(newPassword, 10);
      user.password = hashed;
      await user.save();

      res.json({ success: true, message: 'Password updated' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });


  /** Mount Router */
  app.use('/api', router);
}
