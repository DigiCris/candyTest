import { createHash } from 'node:crypto';

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deterministicDie(secret, selectedNumber, side) {
  return Number(BigInt(`0x${sha256Text(`${secret}:${selectedNumber}:${side}`)}`) % 6n) + 1;
}

export function createGameCommitment(gameId, secret, salt) {
  return sha256Text(`${gameId}:${secret}:${salt}`);
}
