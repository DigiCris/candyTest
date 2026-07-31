import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { pool } from './db/pool.js';
import { AppError } from './utils/errors.js';
import { getConfig } from './utils/config.js';
import { signSession } from './utils/jwt.js';
import { clearSessionCookie, sessionCookie } from './utils/cookies.js';
import { authenticateUser, registerUser, serializeUser, getUserByIdentifier } from './services/user-service.js';
import { candyToken, candyFor } from './services/token-service.js';
import { getOnlyOwnerOrAllowed, setOnlyOwnerOrAllowed } from './services/settings-service.js';
import { seedDemoIfEmpty } from './services/bootstrap-service.js';
import { startGame, getGame, resolveGame } from './services/game-service.js';
import {
  identityHook,
  requireIdentity,
  onlyOwnerHook,
  onlyOwnerOrAllowedHook,
} from './auth/hooks.js';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) throw new Error('JWT_SECRET must contain at least 24 characters.');
  return secret;
}

function setSession(res, userId) {
  res.setHeader('Set-Cookie', sessionCookie(signSession(userId, getJwtSecret())));
}

function safeSecretEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenResult(result) {
  return {
    eventId: String(result.eventId),
    amount: result.amount.toString(),
    from: result.from ? { username: result.from.username, address: result.from.address } : null,
    to: result.to ? { username: result.to.username, address: result.to.address } : null,
    owner: result.owner ? { username: result.owner.username, address: result.owner.address } : null,
    spender: result.spender ? { username: result.spender.username, address: result.spender.address } : null,
  };
}

export function createApp() {
  const app = express();
  const config = getConfig();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(identityHook);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.get('/api/config/public', async (_req, res) => {
    const gameEngine = await getUserByIdentifier('gameEngine', pool, { required: false });
    res.json({
      token: config.token,
      external: config.external,
      gameEngine: gameEngine ? { username: gameEngine.username, address: gameEngine.address } : null,
      demoUsers: config.users.map(({ username, role }) => ({ username, role })),
    });
  });

  app.post('/api/bootstrap/seed', async (req, res) => {
    if (process.env.ALLOW_DEMO_BOOTSTRAP !== 'true') throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
    if (!safeSecretEquals(req.headers['x-bootstrap-secret'], config.bootstrap.secret)) {
      throw new AppError(403, 'BAD_BOOTSTRAP_SECRET', 'Invalid bootstrap secret.');
    }
    res.json(await seedDemoIfEmpty());
  });

  app.post('/api/auth/register', async (req, res) => {
    const result = await registerUser({ username: req.body?.username, password: req.body?.password, role: 'user' });
    setSession(res, result.user.id);
    res.status(201).json({
      user: result.user,
      recoveryPhrase: result.recoveryPhrase,
      warning: 'This phrase is returned once. Store it offline; the database stores only the xpub and address.',
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const user = await authenticateUser(req.body?.username, req.body?.password);
    setSession(res, user.id);
    res.json({ user });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireIdentity, (req, res) => {
    res.json({ user: serializeUser(req.identity) });
  });

  app.get('/api/token/name', async (_req, res) => res.json({ value: await candyToken.name() }));
  app.get('/api/token/symbol', async (_req, res) => res.json({ value: await candyToken.symbol() }));
  app.get('/api/token/decimals', async (_req, res) => res.json({ value: await candyToken.decimals() }));
  app.get('/api/token/totalSupply', async (_req, res) => res.json({ value: (await candyToken.totalSupply()).toString() }));

  app.get(
    '/api/token/balanceOf/:owner',
    requireIdentity,
    onlyOwnerOrAllowedHook((req) => req.params.owner),
    async (req, res) => {
      const result = await candyToken.balanceOf(req.params.owner);
      res.json({ value: result.amount.toString(), owner: { username: result.owner.username, address: result.owner.address } });
    },
  );

  app.post(
    '/api/token/transfer',
    requireIdentity,
    onlyOwnerOrAllowedHook((req) => req.identity.address),
    async (req, res) => res.json(tokenResult(await candyFor(req.identity).transfer(req.body?.to, req.body?.amount))),
  );

  app.post('/api/token/approve', requireIdentity, async (req, res) => {
    res.json(tokenResult(await candyFor(req.identity).approve(req.body?.spender, req.body?.amount)));
  });

  app.get(
    '/api/token/allowance/:owner/:spender',
    requireIdentity,
    onlyOwnerOrAllowedHook((req) => req.params.owner),
    async (req, res) => {
      const result = await candyToken.allowance(req.params.owner, req.params.spender);
      res.json({
        value: result.amount.toString(),
        owner: { username: result.owner.username, address: result.owner.address },
        spender: { username: result.spender.username, address: result.spender.address },
      });
    },
  );

  app.post('/api/token/transferFrom', requireIdentity, async (req, res) => {
    const result = await candyFor(req.identity).transferFrom(req.body?.from, req.body?.to, req.body?.amount);
    res.json(tokenResult(result));
  });

  app.post('/api/token/mint', requireIdentity, onlyOwnerHook, async (req, res) => {
    res.json(tokenResult(await candyFor(req.identity).mint(req.body?.to, req.body?.amount)));
  });

  app.post('/api/token/burn', requireIdentity, onlyOwnerHook, async (req, res) => {
    res.json(tokenResult(await candyFor(req.identity).burn(req.body?.from, req.body?.amount)));
  });

  app.get('/api/token/events', requireIdentity, async (req, res) => {
    res.json({ events: await candyToken.recentEvents(req.query.limit) });
  });

  app.get('/api/admin/onlyOwnerOrAllowed', requireIdentity, onlyOwnerHook, async (_req, res) => {
    res.json({ enabled: await getOnlyOwnerOrAllowed() });
  });

  app.put('/api/admin/onlyOwnerOrAllowed', requireIdentity, onlyOwnerHook, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') throw new AppError(400, 'INVALID_SETTING', 'enabled must be boolean.');
    res.json({ enabled: await setOnlyOwnerOrAllowed(req.body.enabled) });
  });

  app.post('/api/games', requireIdentity, async (req, res) => {
    res.status(201).json(await startGame(req.identity, req.body?.stake));
  });

  app.get('/api/games/:gameId', requireIdentity, async (req, res) => {
    res.json({ game: await getGame(req.identity, req.params.gameId) });
  });

  app.post('/api/games/:gameId/resolve', requireIdentity, async (req, res) => {
    const game = await resolveGame(req.identity, req.params.gameId, req.body?.engineNumber, req.body?.playerNumber);
    res.json({ game });
  });

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));

  app.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: status >= 500 ? 'Internal server error.' : error.message,
        details: error.details,
      },
    });
  });

  return app;
}
