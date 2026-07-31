import test from 'node:test';
import assert from 'node:assert/strict';
import { asIdentifier, asRawAmount, formatUnits, parseUnits } from '../index.js';

test('parseUnits and formatUnits preserve six-decimal amounts', () => {
  assert.equal(parseUnits('123.456789', 6), 123456789n);
  assert.equal(formatUnits(123456789n, 6), '123.456789');
});

test('raw amounts reject unsafe JavaScript numbers', () => {
  assert.throws(() => asRawAmount(Number.MAX_SAFE_INTEGER + 1), /safe integers/);
});

test('user identifiers accept strings or user objects', () => {
  assert.equal(asIdentifier('user2'), 'user2');
  assert.equal(asIdentifier({ username: 'user2' }), 'user2');
  assert.equal(asIdentifier({ address: '0x123' }), '0x123');
});
