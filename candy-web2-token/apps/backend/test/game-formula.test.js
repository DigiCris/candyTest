import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCommitment, deterministicDie } from '../src/utils/game-formula.js';

test('game commitment and dice are deterministic', () => {
  assert.equal(
    createGameCommitment('game-1', '123456789', 'abc123'),
    '888a75a055e371fbb552677177155072e3413eeb400581087d83439996a69a5e',
  );
  const first = deterministicDie('123456789', 17n, 'engine');
  const second = deterministicDie('123456789', 17n, 'engine');
  assert.equal(first, second);
  assert.ok(first >= 1 && first <= 6);
  assert.ok(deterministicDie('123456789', 42n, 'player') >= 1);
});
