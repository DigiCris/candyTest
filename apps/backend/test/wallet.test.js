import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWalletFromMnemonic,
  generateMnemonic,
  keccak256,
  validateMnemonic,
} from '../src/utils/wallet.js';

test('keccak256 matches the Ethereum empty-string vector', () => {
  assert.equal(
    keccak256(Buffer.alloc(0)).toString('hex'),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
});

test('derives the standard Hardhat first address from its mnemonic', () => {
  const wallet = deriveWalletFromMnemonic('test test test test test test test test test test test junk');
  assert.equal(wallet.address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.match(wallet.xpub, /^xpub/);
});

test('generated mnemonics pass their BIP39 checksum', () => {
  assert.equal(validateMnemonic(generateMnemonic()), true);
});

test('all configured demo mnemonics are valid and derive unique addresses', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../../../config/demo.constants.json', import.meta.url), 'utf8'));
  const addresses = config.users.map((user) => {
    assert.equal(validateMnemonic(user.mnemonic), true, `${user.username} mnemonic must be valid`);
    return deriveWalletFromMnemonic(user.mnemonic).address.toLowerCase();
  });
  assert.equal(new Set(addresses).size, addresses.length);
});
