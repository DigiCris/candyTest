import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { parseCookies } from '../utils/cookies.js';
import { verifySession } from '../utils/jwt.js';
import { getUserById, getUserByIdentifier } from '../services/user-service.js';
import { getOnlyOwnerOrAllowed } from '../services/settings-service.js';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) throw new Error('JWT_SECRET must contain at least 24 characters.');
  return secret;
}

// Authentication abstraction hook. Replace only this hook to migrate from JWT cookies
// to server sessions, OAuth, API keys, or another centralized identity mechanism.
export async function identityHook(req, _res, next) {
  req.identity = null;
  const token = parseCookies(req.headers.cookie).candy_session;
  if (!token) return next();
  try {
    const payload = verifySession(token, jwtSecret());
    req.identity = await getUserById(payload.sub);
  } catch {
    req.identity = null;
  }
  return next();
}

export function requireIdentity(req, _res, next) {
  if (!req.identity) return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
  return next();
}

// Equivalent to an onlyOwner modifier. The project maps ERC-20 owner to role=admin.
export function onlyOwnerHook(req, _res, next) {
  if (!req.identity) return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
  if (req.identity.role !== 'admin') return next(new AppError(403, 'ONLY_OWNER', 'Only the token owner/admin can call this endpoint.'));
  return next();
}

// Dynamic modifier used by transfer, balanceOf and allowance.
// When the database setting is false it is a no-op. When true it allows:
// admin, the token owner, or a caller with positive allowance from that owner.
export function onlyOwnerOrAllowedHook(resolveOwnerIdentifier) {
  return async (req, _res, next) => {
    try {
      if (!req.identity) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
      if (!(await getOnlyOwnerOrAllowed(pool))) return next();
      if (req.identity.role === 'admin') return next();

      const ownerIdentifier = await resolveOwnerIdentifier(req);
      const owner = await getUserByIdentifier(ownerIdentifier, pool);
      if (owner.id === req.identity.id) return next();

      const allowance = await pool.query(
        'SELECT amount FROM allowances WHERE owner_id = $1 AND spender_id = $2',
        [owner.id, req.identity.id],
      );
      if (BigInt(allowance.rows[0]?.amount || 0) > 0n) return next();
      throw new AppError(403, 'OWNER_OR_ALLOWANCE_REQUIRED', 'This endpoint is restricted to the admin, token owner, or an approved spender.');
    } catch (error) {
      next(error);
    }
  };
}
