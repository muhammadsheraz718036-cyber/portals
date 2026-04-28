import jwt from "jsonwebtoken";
import { env } from "../env.js";
function getJwtSecret() {
    return env.JWT_SECRET;
}
export function signToken(payload) {
    const opts = { expiresIn: "7d" };
    return jwt.sign(payload, getJwtSecret(), opts);
}
export function verifyToken(token) {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded.sub || !decoded.email) {
        throw new Error("Invalid token payload");
    }
    return { sub: decoded.sub, email: decoded.email };
}
