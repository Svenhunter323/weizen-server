import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

export function verifyJWT(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}
