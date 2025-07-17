import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

export function verifyJWT(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded === null) throw new Error("Invalid or expired token");
    return decoded;
  } catch (err) {
    return null;
  }
}
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['Authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'Access token missing' });
  }

  try {
    const decoded = verifyJWT(token, JWT_SECRET);
    req.user = decoded; // Attach decoded payload to request
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
}