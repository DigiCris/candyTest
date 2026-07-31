import { randomBytes, randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import { AppError, assert } from '../utils/errors.js';
import { parseRawAmount } from '../utils/amounts.js';
import { candyToken } from './token-service.js';
import { getUserByIdentifier } from './user-service.js';
import { createGameCommitment, deterministicDie } from '../utils/game-formula.js';

export const GAME_FORMULA = {
  commitment: 'sha256(gameId + ":" + secret + ":" + salt)',
  engineDie: '1 + (uint256(sha256(secret + ":" + engineNumber + ":engine")) mod 6)',
  playerDie: '1 + (uint256(sha256(secret + ":" + playerNumber + ":player")) mod 6)',
  winner: 'playerDie > engineDie ? player : gameEngine (ties go to gameEngine)',
};

function parseSelectedNumber(value, field) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : String(value ?? '');
  if (!/^\d+$/.test(normalized)) throw new AppError(400, 'INVALID_GAME_NUMBER', `${field} must be a non-negative integer.`);
  const number = BigInt(normalized);
  if (number > 9223372036854775807n) throw new AppError(400, 'INVALID_GAME_NUMBER', `${field} must fit in PostgreSQL BIGINT.`);
  return number;
}


async function releaseUnusedGameAllowance(client, player, gameEngine, stake, gameId) {
  const result = await client.query(
    'SELECT amount FROM allowances WHERE owner_id = $1 AND spender_id = $2 FOR UPDATE',
    [player.id, gameEngine.id],
  );
  const current = BigInt(result.rows[0]?.amount || 0);
  assert(current >= stake, 409, 'GAME_ALLOWANCE_MISSING', 'The game allowance is no longer available.');
  const next = current - stake;
  await client.query(
    'UPDATE allowances SET amount = $1, updated_at = now() WHERE owner_id = $2 AND spender_id = $3',
    [next.toString(), player.id, gameEngine.id],
  );
  await client.query(
    `INSERT INTO token_events(event_type, actor_id, from_user_id, spender_id, amount, metadata)
     VALUES ('APPROVAL', NULL, $1, $2, $3, $4::jsonb)`,
    [player.id, gameEngine.id, next.toString(), JSON.stringify({ gameId, reason: 'unused_game_allowance_released' })],
  );
}

function serializeGame(row) {
  const resolved = row.status === 'resolved';
  return {
    id: row.id,
    playerId: row.player_id,
    stake: row.stake,
    commitmentHash: row.commitment_hash,
    status: row.status,
    engineNumber: resolved ? row.engine_number : null,
    playerNumber: resolved ? row.player_number : null,
    engineDie: resolved ? row.engine_die : null,
    playerDie: resolved ? row.player_die : null,
    winner: resolved ? row.winner : null,
    secret: resolved ? row.secret_value : null,
    salt: resolved ? row.secret_salt : null,
    formula: GAME_FORMULA,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function startGame(actor, rawStake) {
  const stake = parseRawAmount(String(rawStake), { allowZero: false, field: 'stake' });
  return withTransaction(async (client) => {
    const player = await getUserByIdentifier(actor.address, client);
    const gameEngine = await getUserByIdentifier('gameEngine', client);
    assert(player.id !== gameEngine.id, 400, 'GAME_ENGINE_CANNOT_PLAY', 'The game engine cannot play against itself.');

    const open = await client.query("SELECT id FROM games WHERE player_id = $1 AND status = 'committed' FOR UPDATE", [player.id]);
    assert(!open.rowCount, 409, 'OPEN_GAME_EXISTS', 'Resolve the existing open game before starting another one.', { gameId: open.rows[0]?.id });

    const balanceRows = await client.query(
      `SELECT user_id, amount FROM balances
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id FOR UPDATE`,
      [[player.id, gameEngine.id].sort()],
    );
    const balances = new Map(balanceRows.rows.map((row) => [row.user_id, BigInt(row.amount)]));
    const playerBalance = balances.get(player.id) || 0n;
    const engineBalance = balances.get(gameEngine.id) || 0n;
    assert(playerBalance >= stake, 409, 'INSUFFICIENT_BALANCE', 'Player balance is lower than the stake.');

    const allowance = await client.query(
      'SELECT amount FROM allowances WHERE owner_id = $1 AND spender_id = $2 FOR UPDATE',
      [player.id, gameEngine.id],
    );
    const approved = BigInt(allowance.rows[0]?.amount || 0);
    assert(approved >= stake, 409, 'INSUFFICIENT_ALLOWANCE', 'Approve gameEngine for at least the stake before starting the game.', {
      allowance: approved.toString(), stake: stake.toString(),
    });

    const reserved = await client.query(
      "SELECT COALESCE(SUM(stake), 0) AS amount FROM games WHERE game_engine_id = $1 AND status = 'committed'",
      [gameEngine.id],
    );
    const reservedAmount = BigInt(reserved.rows[0].amount);
    assert(engineBalance >= reservedAmount + stake, 409, 'GAME_ENGINE_LIQUIDITY', 'gameEngine does not have enough unreserved Candy to cover a player win.', {
      engineBalance: engineBalance.toString(), reserved: reservedAmount.toString(), required: stake.toString(),
    });

    const id = randomUUID();
    const secret = BigInt(`0x${randomBytes(32).toString('hex')}`).toString();
    const salt = randomBytes(16).toString('hex');
    const commitmentHash = createGameCommitment(id, secret, salt);
    const result = await client.query(
      `INSERT INTO games(id, player_id, game_engine_id, stake, secret_value, secret_salt, commitment_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [id, player.id, gameEngine.id, stake.toString(), secret, salt, commitmentHash],
    );
    return { game: serializeGame(result.rows[0]), gameEngine: { username: gameEngine.username, address: gameEngine.address } };
  });
}

export async function getGame(actor, gameId) {
  const result = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = result.rows[0];
  if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
  if (actor.role !== 'admin' && game.player_id !== actor.id) throw new AppError(403, 'GAME_FORBIDDEN', 'This game belongs to another user.');
  return serializeGame(game);
}

export async function resolveGame(actor, gameId, engineNumberInput, playerNumberInput) {
  const engineNumber = parseSelectedNumber(engineNumberInput, 'engineNumber');
  const playerNumber = parseSelectedNumber(playerNumberInput, 'playerNumber');
  assert(engineNumber !== playerNumber, 400, 'NUMBERS_MUST_DIFFER', 'Choose two different numbers.');

  return withTransaction(async (client) => {
    const gameResult = await client.query('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId]);
    const game = gameResult.rows[0];
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found.');
    assert(game.player_id === actor.id, 403, 'GAME_FORBIDDEN', 'Only the player can resolve this game.');
    assert(game.status === 'committed', 409, 'GAME_ALREADY_RESOLVED', 'This game has already been resolved.');

    const player = await getUserByIdentifier(actor.address, client);
    const gameEngine = await getUserByIdentifier('gameEngine', client);
    const engineDie = deterministicDie(game.secret_value, engineNumber, 'engine');
    const playerDie = deterministicDie(game.secret_value, playerNumber, 'player');
    const playerWins = playerDie > engineDie;

    let transfer;
    if (playerWins) {
      transfer = await candyToken.transferTx(client, gameEngine, player.address, BigInt(game.stake), {
        metadata: { gameId, result: 'player_win' },
        reservationGameId: gameId,
      });
      await releaseUnusedGameAllowance(client, player, gameEngine, BigInt(game.stake), gameId);
    } else {
      transfer = await candyToken.transferFromTx(client, gameEngine, player.address, gameEngine.address, BigInt(game.stake), {
        metadata: { gameId, result: 'game_engine_win' },
        reservationGameId: gameId,
      });
    }

    const updated = await client.query(
      `UPDATE games
       SET engine_number = $1, player_number = $2, engine_die = $3, player_die = $4,
           winner = $5, status = 'resolved', resolved_event_id = $6, resolved_at = now()
       WHERE id = $7
       RETURNING *`,
      [
        engineNumber.toString(), playerNumber.toString(), engineDie, playerDie,
        playerWins ? 'player' : 'game_engine', transfer.eventId, gameId,
      ],
    );
    return serializeGame(updated.rows[0]);
  });
}
