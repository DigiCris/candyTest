import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPart(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signSession(userId, secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: userId, iat: now, exp: now + ttlSeconds }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signPart(unsigned, secret)}`;
}

export function verifySession(token, secret) {
  try {
    const [header, payload, signature] = String(token).split('.');
    if (!header || !payload || !signature) throw new Error('Malformed token');
    const unsigned = `${header}.${payload}`;
    const expected = Buffer.from(signPart(unsigned, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Bad signature');
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsedHeader.alg !== 'HS256' || !parsedPayload.sub || parsedPayload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Expired or invalid token');
    }
    return parsedPayload;
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'The session is invalid or expired.');
  }
}
