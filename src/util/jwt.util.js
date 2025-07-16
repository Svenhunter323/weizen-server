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
