import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAddressFromXpub,
  deriveWalletFromMnemonic,
  deriveWalletFromXpub,
  generateMnemonic,
  isValidXpub,
  keccak256,
  validateMnemonic,
} from '../src/utils/wallet.js';

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
// First six addresses of the standard Hardhat test account, in derivation order.
const HARDHAT_ADDRESSES = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
];

async function readConfig() {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL('../../../config/demo.constants.json', import.meta.url), 'utf8'));
}

test('keccak256 matches the Ethereum empty-string vector', () => {
  assert.equal(
    keccak256(Buffer.alloc(0)).toString('hex'),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
});

test('derives the standard Hardhat first address from its mnemonic', () => {
  const wallet = deriveWalletFromMnemonic(HARDHAT_MNEMONIC);
  assert.equal(wallet.address, HARDHAT_ADDRESSES[0]);
  assert.match(wallet.xpub, /^xpub/);
});

test('generated mnemonics pass their BIP39 checksum', () => {
  assert.equal(validateMnemonic(generateMnemonic()), true);
});

test('an account xpub alone derives the same addresses as the seed phrase', () => {
  const { xpub } = deriveWalletFromMnemonic(HARDHAT_MNEMONIC);
  HARDHAT_ADDRESSES.forEach((expected, index) => {
    assert.equal(deriveAddressFromXpub(xpub, index), expected, `index ${index}`);
  });
});

test('deriveWalletFromXpub reports the path it derived', () => {
  const { xpub } = deriveWalletFromMnemonic(HARDHAT_MNEMONIC);
  const wallet = deriveWalletFromXpub(xpub, 3, "m/44'/60'/0'");
  assert.equal(wallet.address, HARDHAT_ADDRESSES[3]);
  assert.equal(wallet.addressPath, "m/44'/60'/0'/0/3");
  assert.equal(wallet.addressIndex, 3);
  assert.equal(wallet.xpub, xpub);
});

test('isValidXpub rejects anything that is not a BIP32 extended public key', () => {
  const { xpub } = deriveWalletFromMnemonic(HARDHAT_MNEMONIC);
  assert.equal(isValidXpub(xpub), true);
  assert.equal(isValidXpub(`${xpub}tampered`), false);
  assert.equal(isValidXpub('not-an-xpub'), false);
  assert.equal(isValidXpub(undefined), false);
});

test('the configured account xpub is valid and yields unique addresses per index', async () => {
  const config = await readConfig();
  assert.equal(isValidXpub(config.wallet.accountXpub), true, 'wallet.accountXpub must be a valid xpub');

  const addresses = config.users.map((_user, index) =>
    deriveAddressFromXpub(config.wallet.accountXpub, index).toLowerCase());
  assert.equal(new Set(addresses).size, addresses.length, 'each address index must be distinct');
});

test('no seed phrase is stored for demo users', async () => {
  const config = await readConfig();
  for (const user of config.users) {
    assert.equal('mnemonic' in user, false, `${user.username} must not carry a seed phrase`);
  }
  assert.equal('mnemonic' in config.wallet, false, 'the config must hold only watch-only public data');
});
