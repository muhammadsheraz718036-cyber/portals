import jwt, { type SignOptions } from "jsonwebtoken";

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is required");
  return s;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: "7d" };
  return jwt.sign(payload, getJwtSecret(), opts);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & Partial<JwtPayload>;
  if (!decoded.sub || !decoded.email) {
    throw new Error("Invalid token payload");
  }
  return { sub: decoded.sub, email: decoded.email };
}
