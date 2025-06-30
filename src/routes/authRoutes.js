import express from 'express';
import bcrypt from 'bcrypt';
import jwt from "jsonwebtoken";
import { User } from '../models/User.js';
import { JWT_SECRET } from '../util/jwt.util.js';

const SALT_ROUNDS = 10;

export function addAuthRoutes(app) {
  const router = express.Router();

  /**
   * User Registration
   * POST /api/register
   * Body: { username, password }
   */
  router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    try {
      const existing = await User.findOne({ username });
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const newUser = new User({ username, password: hashedPassword });
      await newUser.save();

      res.json({ success: true, username });
    } catch (err) {
      console.error('❌ Registration Error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /**
   * User Login
   * POST /api/login
   * Body: { username, password }
   */
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    console.log(req.body);

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    try {
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
      res.json({ success: true, token: token, user: user });
    } catch (err) {
      console.error('❌ Login Error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Mount router on /api
  app.use('/api', router);
}
