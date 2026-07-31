import { pool, withTransaction } from '../db/pool.js';
import { AppError, assert } from '../utils/errors.js';
import { parseRawAmount } from '../utils/amounts.js';
import { getUserByIdentifier } from './user-service.js';

function amountString(value) {
  return BigInt(value).toString();
}

async function lockBalances(client, userIds) {
  const unique = [...new Set(userIds)].sort();
  const result = await client.query(
    `SELECT user_id, amount
     FROM balances
     WHERE user_id = ANY($1::uuid[])
     ORDER BY user_id
     FOR UPDATE`,
    [unique],
  );
  const map = new Map(result.rows.map((row) => [row.user_id, BigInt(row.amount)]));
  for (const id of unique) {
    if (!map.has(id)) throw new AppError(500, 'BALANCE_MISSING', `Balance row missing for user ${id}.`);
  }
  return map;
}


async function reservedOutgoingBalance(client, userId, excludeGameId = null) {
  const result = await client.query(
    `SELECT COALESCE(SUM(stake), 0) AS amount
     FROM games
     WHERE status = 'committed'
       AND (player_id = $1 OR game_engine_id = $1)
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, excludeGameId],
  );
  return BigInt(result.rows[0].amount);
}

async function reservedAllowance(client, ownerId, spenderId, excludeGameId = null) {
  const result = await client.query(
    `SELECT COALESCE(SUM(stake), 0) AS amount
     FROM games
     WHERE status = 'committed'
       AND player_id = $1
       AND game_engine_id = $2
       AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [ownerId, spenderId, excludeGameId],
  );
  return BigInt(result.rows[0].amount);
}

function availableAfterReservation(total, reserved) {
  return total > reserved ? total - reserved : 0n;
}

async function insertEvent(client, event) {
  const result = await client.query(
    `INSERT INTO token_events(event_type, actor_id, from_user_id, to_user_id, spender_id, amount, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id, created_at`,
    [
      event.eventType,
      event.actorId || null,
      event.fromUserId || null,
      event.toUserId || null,
      event.spenderId || null,
      amountString(event.amount),
      JSON.stringify(event.metadata || {}),
    ],
  );
  return result.rows[0];
}

export class CandyTokenService {
  constructor(defaultClient = pool) {
    this.defaultClient = defaultClient;
  }

  async metadata(client = this.defaultClient) {
    const result = await client.query('SELECT * FROM token_metadata WHERE id = 1');
    if (!result.rows[0]) throw new AppError(503, 'TOKEN_NOT_INITIALIZED', 'Candy token metadata has not been initialized.');
    return result.rows[0];
  }

  async name() { return (await this.metadata()).name; }
  async symbol() { return (await this.metadata()).symbol; }
  async decimals() { return Number((await this.metadata()).decimals); }
  async totalSupply() { return BigInt((await this.metadata()).total_supply); }

  async balanceOf(ownerIdentifier, client = this.defaultClient) {
    const owner = await getUserByIdentifier(ownerIdentifier, client);
    const result = await client.query('SELECT amount FROM balances WHERE user_id = $1', [owner.id]);
    return { owner, amount: BigInt(result.rows[0]?.amount || 0) };
  }

  async allowance(ownerIdentifier, spenderIdentifier, client = this.defaultClient) {
    const owner = await getUserByIdentifier(ownerIdentifier, client);
    const spender = await getUserByIdentifier(spenderIdentifier, client);
    const result = await client.query(
      'SELECT amount FROM allowances WHERE owner_id = $1 AND spender_id = $2',
      [owner.id, spender.id],
    );
    return { owner, spender, amount: BigInt(result.rows[0]?.amount || 0) };
  }

  async transfer(actor, toIdentifier, rawAmount, options = {}) {
    const amount = parseRawAmount(String(rawAmount));
    const execute = (client) => this.transferTx(client, actor, toIdentifier, amount, options);
    return options.client ? execute(options.client) : withTransaction(execute);
  }

  async transferTx(client, actor, toIdentifier, amount, options = {}) {
    const from = await getUserByIdentifier(actor.address || actor.username, client);
    const to = await getUserByIdentifier(toIdentifier, client);
    const balances = await lockBalances(client, [from.id, to.id]);
    const fromBalance = balances.get(from.id);
    assert(fromBalance >= amount, 409, 'INSUFFICIENT_BALANCE', 'Transfer amount exceeds the sender balance.', {
      balance: fromBalance.toString(), amount: amount.toString(),
    });
    if (from.id !== to.id) {
      const reserved = await reservedOutgoingBalance(client, from.id, options.reservationGameId || null);
      const available = availableAfterReservation(fromBalance, reserved);
      assert(available >= amount, 409, 'BALANCE_RESERVED_FOR_GAME', 'Transfer amount exceeds the balance available after open-game reservations.', {
        balance: fromBalance.toString(), reserved: reserved.toString(), available: available.toString(), amount: amount.toString(),
      });
    }

    if (from.id !== to.id && amount > 0n) {
      await client.query('UPDATE balances SET amount = amount - $1, updated_at = now() WHERE user_id = $2', [amount.toString(), from.id]);
      await client.query('UPDATE balances SET amount = amount + $1, updated_at = now() WHERE user_id = $2', [amount.toString(), to.id]);
    }
    const event = await insertEvent(client, {
      eventType: 'TRANSFER', actorId: actor.id, fromUserId: from.id, toUserId: to.id, amount,
      metadata: options.metadata,
    });
    return { eventId: event.id, from, to, amount };
  }

  async approve(actor, spenderIdentifier, rawAmount, options = {}) {
    const amount = parseRawAmount(String(rawAmount));
    const execute = async (client) => {
      const owner = await getUserByIdentifier(actor.address || actor.username, client);
      const spender = await getUserByIdentifier(spenderIdentifier, client);
      const reserved = await reservedAllowance(client, owner.id, spender.id, options.reservationGameId || null);
      assert(amount >= reserved, 409, 'ALLOWANCE_RESERVED_FOR_GAME', 'Allowance cannot be set below the amount reserved by open games.', {
        reserved: reserved.toString(), requested: amount.toString(),
      });
      await client.query(
        `INSERT INTO allowances(owner_id, spender_id, amount, updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (owner_id, spender_id)
         DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
        [owner.id, spender.id, amount.toString()],
      );
      const event = await insertEvent(client, {
        eventType: 'APPROVAL', actorId: actor.id, fromUserId: owner.id, spenderId: spender.id, amount,
        metadata: options.metadata,
      });
      return { eventId: event.id, owner, spender, amount };
    };
    return options.client ? execute(options.client) : withTransaction(execute);
  }

  async transferFrom(actor, fromIdentifier, toIdentifier, rawAmount, options = {}) {
    const amount = parseRawAmount(String(rawAmount));
    const execute = (client) => this.transferFromTx(client, actor, fromIdentifier, toIdentifier, amount, options);
    return options.client ? execute(options.client) : withTransaction(execute);
  }

  async transferFromTx(client, actor, fromIdentifier, toIdentifier, amount, options = {}) {
    const spender = await getUserByIdentifier(actor.address || actor.username, client);
    const from = await getUserByIdentifier(fromIdentifier, client);
    const to = await getUserByIdentifier(toIdentifier, client);

    const allowanceResult = await client.query(
      `SELECT amount FROM allowances
       WHERE owner_id = $1 AND spender_id = $2
       FOR UPDATE`,
      [from.id, spender.id],
    );
    const allowed = BigInt(allowanceResult.rows[0]?.amount || 0);
    assert(allowed >= amount, 409, 'INSUFFICIENT_ALLOWANCE', 'Transfer amount exceeds the approved allowance.', {
      allowance: allowed.toString(), amount: amount.toString(),
    });
    const allowanceReserved = await reservedAllowance(client, from.id, spender.id, options.reservationGameId || null);
    const allowanceAvailable = availableAfterReservation(allowed, allowanceReserved);
    assert(allowanceAvailable >= amount, 409, 'ALLOWANCE_RESERVED_FOR_GAME', 'Transfer amount exceeds the allowance available after open-game reservations.', {
      allowance: allowed.toString(), reserved: allowanceReserved.toString(), available: allowanceAvailable.toString(), amount: amount.toString(),
    });

    const balances = await lockBalances(client, [from.id, to.id]);
    const fromBalance = balances.get(from.id);
    assert(fromBalance >= amount, 409, 'INSUFFICIENT_BALANCE', 'Transfer amount exceeds the token owner balance.', {
      balance: fromBalance.toString(), amount: amount.toString(),
    });
    if (from.id !== to.id) {
      const balanceReserved = await reservedOutgoingBalance(client, from.id, options.reservationGameId || null);
      const balanceAvailable = availableAfterReservation(fromBalance, balanceReserved);
      assert(balanceAvailable >= amount, 409, 'BALANCE_RESERVED_FOR_GAME', 'Transfer amount exceeds the balance available after open-game reservations.', {
        balance: fromBalance.toString(), reserved: balanceReserved.toString(), available: balanceAvailable.toString(), amount: amount.toString(),
      });
    }

    if (amount > 0n) {
      await client.query(
        `INSERT INTO allowances(owner_id, spender_id, amount, updated_at)
         VALUES ($1,$2,0,now())
         ON CONFLICT (owner_id, spender_id)
         DO UPDATE SET amount = allowances.amount - $3, updated_at = now()`,
        [from.id, spender.id, amount.toString()],
      );
      if (from.id !== to.id) {
        await client.query('UPDATE balances SET amount = amount - $1, updated_at = now() WHERE user_id = $2', [amount.toString(), from.id]);
        await client.query('UPDATE balances SET amount = amount + $1, updated_at = now() WHERE user_id = $2', [amount.toString(), to.id]);
      }
    }

    const event = await insertEvent(client, {
      eventType: 'TRANSFER', actorId: actor.id, fromUserId: from.id, toUserId: to.id, spenderId: spender.id, amount,
      metadata: { transferFrom: true, ...(options.metadata || {}) },
    });
    return { eventId: event.id, spender, from, to, amount };
  }

  async mint(actor, toIdentifier, rawAmount, options = {}) {
    assert(actor.role === 'admin', 403, 'ONLY_OWNER', 'Only the token owner/admin can mint.');
    const amount = parseRawAmount(String(rawAmount));
    const execute = async (client) => {
      const to = await getUserByIdentifier(toIdentifier, client);
      await lockBalances(client, [to.id]);
      const metadata = await this.metadata(client);
      const nextSupply = BigInt(metadata.total_supply) + amount;
      assert(nextSupply <= ((1n << 256n) - 1n), 409, 'SUPPLY_OVERFLOW', 'Mint would exceed uint256 total supply.');
      if (amount > 0n) {
        await client.query('UPDATE balances SET amount = amount + $1, updated_at = now() WHERE user_id = $2', [amount.toString(), to.id]);
        await client.query('UPDATE token_metadata SET total_supply = total_supply + $1 WHERE id = 1', [amount.toString()]);
      }
      const event = await insertEvent(client, { eventType: 'MINT', actorId: actor.id, toUserId: to.id, amount });
      return { eventId: event.id, to, amount };
    };
    return options.client ? execute(options.client) : withTransaction(execute);
  }

  async burn(actor, fromIdentifier, rawAmount, options = {}) {
    assert(actor.role === 'admin', 403, 'ONLY_OWNER', 'Only the token owner/admin can burn.');
    const amount = parseRawAmount(String(rawAmount));
    const execute = async (client) => {
      const from = await getUserByIdentifier(fromIdentifier, client);
      const balances = await lockBalances(client, [from.id]);
      const balance = balances.get(from.id);
      assert(balance >= amount, 409, 'INSUFFICIENT_BALANCE', 'Burn amount exceeds the user balance.', {
        balance: balance.toString(), amount: amount.toString(),
      });
      const reserved = await reservedOutgoingBalance(client, from.id, options.reservationGameId || null);
      const available = availableAfterReservation(balance, reserved);
      assert(available >= amount, 409, 'BALANCE_RESERVED_FOR_GAME', 'Burn amount exceeds the balance available after open-game reservations.', {
        balance: balance.toString(), reserved: reserved.toString(), available: available.toString(), amount: amount.toString(),
      });
      if (amount > 0n) {
        await client.query('UPDATE balances SET amount = amount - $1, updated_at = now() WHERE user_id = $2', [amount.toString(), from.id]);
        await client.query('UPDATE token_metadata SET total_supply = total_supply - $1 WHERE id = 1', [amount.toString()]);
      }
      const event = await insertEvent(client, { eventType: 'BURN', actorId: actor.id, fromUserId: from.id, amount });
      return { eventId: event.id, from, amount };
    };
    return options.client ? execute(options.client) : withTransaction(execute);
  }

  async recentEvents(limit = 20, client = this.defaultClient) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const result = await client.query(
      `SELECT e.id, e.event_type, e.amount, e.created_at,
              actor.username AS actor_username,
              from_user.username AS from_username,
              to_user.username AS to_username,
              spender.username AS spender_username
       FROM token_events e
       LEFT JOIN users actor ON actor.id = e.actor_id
       LEFT JOIN users from_user ON from_user.id = e.from_user_id
       LEFT JOIN users to_user ON to_user.id = e.to_user_id
       LEFT JOIN users spender ON spender.id = e.spender_id
       ORDER BY e.id DESC
       LIMIT $1`,
      [safeLimit],
    );
    return result.rows;
  }
}

export const candyToken = new CandyTokenService();

// Session-bound facade with the same call shape as the browser SDK / ERC-20 interface.
// Example: const candy = candyFor(req.identity); await candy.transfer('user2', '1000000');
export function candyFor(actor, service = candyToken) {
  return Object.freeze({
    name: () => service.name(),
    symbol: () => service.symbol(),
    decimals: () => service.decimals(),
    totalSupply: () => service.totalSupply(),
    balanceOf: (owner) => service.balanceOf(owner),
    transfer: (to, amount) => service.transfer(actor, to, amount),
    approve: (spender, amount) => service.approve(actor, spender, amount),
    allowance: (owner, spender) => service.allowance(owner, spender),
    transferFrom: (from, to, amount) => service.transferFrom(actor, from, to, amount),
    mint: (to, amount) => service.mint(actor, to, amount),
    burn: (from, amount) => service.burn(actor, from, amount),
  });
}
