import jwt from "jsonwebtoken";
function getJwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s)
        throw new Error("JWT_SECRET is required");
    return s;
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
