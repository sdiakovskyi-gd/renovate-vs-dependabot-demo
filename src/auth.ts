import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret';
const TTL_SECONDS = 60 * 60;

export interface SessionClaims {
  sub: string;
  role: 'admin' | 'user';
}

export function issueToken(claims: SessionClaims): string {
  return jwt.sign(claims, SECRET, { algorithm: 'HS256', expiresIn: TTL_SECONDS });
}

export function verifyToken(token: string): SessionClaims {
  // jsonwebtoken 8.x defaults are part of what the security advisory is about;
  // the algorithm allowlist is what 9.x makes mandatory.
  const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') {
    throw new Error('unexpected string payload');
  }
  return { sub: String(decoded.sub), role: decoded.role as SessionClaims['role'] };
}
