import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

const WORDLIST = readFileSync(new URL('./bip39-english.txt', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/);
const WORD_INDEX = new Map(WORDLIST.map((word, index) => [word, index]));

const CURVE_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
const UINT32_MAX = 0xffffffff;
const MASK_64 = (1n << 64n) - 1n;
const XPUB_VERSION = Buffer.from('0488b21e', 'hex');
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

function mod(value, modulo) {
  const result = value % modulo;
  return result >= 0n ? result : result + modulo;
}

function modPow(base, exponent, modulo) {
  let result = 1n;
  let current = mod(base, modulo);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = mod(result * current, modulo);
    current = mod(current * current, modulo);
    power >>= 1n;
  }
  return result;
}

function modInverse(value, modulo) {
  let low = mod(value, modulo);
  let high = modulo;
  let lm = 1n;
  let hm = 0n;
  while (low > 1n) {
    const ratio = high / low;
    [lm, hm] = [hm - lm * ratio, lm];
    [low, high] = [high - low * ratio, low];
  }
  return mod(lm, modulo);
}

function pointAdd(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x && mod(left.y + right.y, CURVE_P) === 0n) return null;

  let slope;
  if (left.x === right.x && left.y === right.y) {
    if (left.y === 0n) return null;
    slope = mod((3n * left.x * left.x) * modInverse(2n * left.y, CURVE_P), CURVE_P);
  } else {
    slope = mod((right.y - left.y) * modInverse(right.x - left.x, CURVE_P), CURVE_P);
  }

  const x = mod(slope * slope - left.x - right.x, CURVE_P);
  const y = mod(slope * (left.x - x) - left.y, CURVE_P);
  return { x, y };
}

function scalarMultiply(scalar, point = G) {
  let n = mod(scalar, CURVE_N);
  if (n === 0n || !point) return null;
  let result = null;
  let addend = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

function bigintToBuffer(value, length) {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

function bufferToBigint(buffer) {
  const hex = Buffer.from(buffer).toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function serializeUint32(value) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError('Child index must be uint32.');
  }
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function compressPoint(point) {
  if (!point) throw new Error('Cannot serialize point at infinity.');
  return Buffer.concat([Buffer.from([point.y & 1n ? 0x03 : 0x02]), bigintToBuffer(point.x, 32)]);
}

function uncompressPoint(point) {
  if (!point) throw new Error('Cannot serialize point at infinity.');
  return Buffer.concat([Buffer.from([0x04]), bigintToBuffer(point.x, 32), bigintToBuffer(point.y, 32)]);
}

function decompressPoint(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 65 && buffer[0] === 0x04) {
    return { x: bufferToBigint(buffer.subarray(1, 33)), y: bufferToBigint(buffer.subarray(33, 65)) };
  }
  if (buffer.length !== 33 || (buffer[0] !== 0x02 && buffer[0] !== 0x03)) {
    throw new Error('Invalid compressed secp256k1 public key.');
  }
  const x = bufferToBigint(buffer.subarray(1));
  const alpha = mod(x ** 3n + 7n, CURVE_P);
  let y = modPow(alpha, (CURVE_P + 1n) / 4n, CURVE_P);
  const odd = Boolean(y & 1n);
  if (odd !== (buffer[0] === 0x03)) y = CURVE_P - y;
  return { x, y };
}

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function hash160(data) {
  return createHash('ripemd160').update(sha256(data)).digest();
}

function hmacSha512(key, data) {
  return createHmac('sha512', key).update(data).digest();
}

function base58Encode(buffer) {
  let value = bufferToBigint(buffer);
  let output = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    output = BASE58_ALPHABET[remainder] + output;
    value /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output || '1';
}

function base58Decode(value) {
  let result = 0n;
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) throw new Error('Invalid Base58 character.');
    result = result * 58n + BigInt(digit);
  }
  let hex = result.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let buffer = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  let leading = 0;
  while (value[leading] === '1') leading += 1;
  if (leading) buffer = Buffer.concat([Buffer.alloc(leading), buffer]);
  return buffer;
}

function base58CheckEncode(payload) {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

function base58CheckDecode(value) {
  const decoded = base58Decode(value);
  if (decoded.length < 5) throw new Error('Invalid Base58Check payload.');
  const payload = decoded.subarray(0, -4);
  const checksum = decoded.subarray(-4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error('Invalid Base58Check checksum.');
  return payload;
}

function parsePath(path) {
  if (path === 'm' || path === '') return [];
  const parts = path.replace(/^m\//, '').split('/');
  return parts.map((part) => {
    const hardened = part.endsWith("'") || part.endsWith('h') || part.endsWith('H');
    const raw = hardened ? part.slice(0, -1) : part;
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid derivation path component: ${part}`);
    const index = Number(raw);
    if (!Number.isSafeInteger(index) || index >= 0x80000000) throw new RangeError('Invalid child index.');
    return hardened ? index + 0x80000000 : index;
  });
}

function masterNodeFromSeed(seed) {
  const digest = hmacSha512(Buffer.from('Bitcoin seed', 'utf8'), seed);
  const privateKey = bufferToBigint(digest.subarray(0, 32));
  if (privateKey === 0n || privateKey >= CURVE_N) throw new Error('Invalid BIP32 master key.');
  return {
    privateKey,
    publicKey: scalarMultiply(privateKey),
    chainCode: digest.subarray(32),
    depth: 0,
    parentFingerprint: Buffer.alloc(4),
    childNumber: 0,
  };
}

function derivePrivateChild(parent, index) {
  const parentPublic = compressPoint(parent.publicKey);
  const data = index >= 0x80000000
    ? Buffer.concat([Buffer.from([0]), bigintToBuffer(parent.privateKey, 32), serializeUint32(index)])
    : Buffer.concat([parentPublic, serializeUint32(index)]);
  const digest = hmacSha512(parent.chainCode, data);
  const tweak = bufferToBigint(digest.subarray(0, 32));
  if (tweak >= CURVE_N) throw new Error('Invalid BIP32 child tweak.');
  const privateKey = mod(tweak + parent.privateKey, CURVE_N);
  if (privateKey === 0n) throw new Error('Invalid BIP32 child key.');
  return {
    privateKey,
    publicKey: scalarMultiply(privateKey),
    chainCode: digest.subarray(32),
    depth: parent.depth + 1,
    parentFingerprint: hash160(parentPublic).subarray(0, 4),
    childNumber: index,
  };
}

function derivePrivatePath(seed, path) {
  let node = masterNodeFromSeed(seed);
  for (const index of parsePath(path)) node = derivePrivateChild(node, index);
  return node;
}

function derivePublicChild(parent, index) {
  if (index >= 0x80000000) throw new Error('Cannot derive hardened child from xpub.');
  const parentPublic = compressPoint(parent.publicKey);
  const digest = hmacSha512(parent.chainCode, Buffer.concat([parentPublic, serializeUint32(index)]));
  const tweak = bufferToBigint(digest.subarray(0, 32));
  if (tweak >= CURVE_N) throw new Error('Invalid BIP32 public child tweak.');
  const publicKey = pointAdd(scalarMultiply(tweak), parent.publicKey);
  if (!publicKey) throw new Error('Invalid BIP32 public child key.');
  return {
    publicKey,
    chainCode: digest.subarray(32),
    depth: parent.depth + 1,
    parentFingerprint: hash160(parentPublic).subarray(0, 4),
    childNumber: index,
  };
}

function serializeXpub(node) {
  const payload = Buffer.concat([
    XPUB_VERSION,
    Buffer.from([node.depth]),
    node.parentFingerprint,
    serializeUint32(node.childNumber),
    node.chainCode,
    compressPoint(node.publicKey),
  ]);
  return base58CheckEncode(payload);
}

function parseXpub(xpub) {
  const payload = base58CheckDecode(xpub);
  if (payload.length !== 78 || !payload.subarray(0, 4).equals(XPUB_VERSION)) {
    throw new Error('Unsupported or invalid xpub.');
  }
  return {
    depth: payload[4],
    parentFingerprint: payload.subarray(5, 9),
    childNumber: payload.readUInt32BE(9),
    chainCode: payload.subarray(13, 45),
    publicKey: decompressPoint(payload.subarray(45, 78)),
  };
}

const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl64(value, shift) {
  const amount = BigInt(shift % 64);
  if (amount === 0n) return value & MASK_64;
  return ((value << amount) | (value >> (64n - amount))) & MASK_64;
}

function keccakPermutation(state) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const c = new Array(5);
    const d = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64;
    }

    const b = new Array(25).fill(0n);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const targetX = y;
        const targetY = (2 * x + 3 * y) % 5;
        b[targetX + 5 * targetY] = rotl64(state[x + 5 * y], KECCAK_ROTATION[x][y]);
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] = (b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

export function keccak256(data) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = Buffer.alloc(paddedLength);
  input.copy(padded);
  padded[input.length] ^= 0x01;
  padded[paddedLength - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let index = 0; index < rate; index += 1) {
      const lane = Math.floor(index / 8);
      const shift = BigInt((index % 8) * 8);
      state[lane] ^= BigInt(padded[offset + index]) << shift;
    }
    keccakPermutation(state);
  }

  const output = Buffer.alloc(32);
  for (let index = 0; index < output.length; index += 1) {
    const lane = Math.floor(index / 8);
    const shift = BigInt((index % 8) * 8);
    output[index] = Number((state[lane] >> shift) & 0xffn);
  }
  return output;
}

function toChecksumAddress(lowercaseAddress) {
  const hex = lowercaseAddress.toLowerCase().replace(/^0x/, '');
  const digest = keccak256(Buffer.from(hex, 'ascii')).toString('hex');
  let result = '0x';
  for (let index = 0; index < hex.length; index += 1) {
    result += Number.parseInt(digest[index], 16) >= 8 ? hex[index].toUpperCase() : hex[index];
  }
  return result;
}

function publicKeyToAddress(point) {
  const uncompressed = uncompressPoint(point).subarray(1);
  const digest = keccak256(uncompressed);
  return toChecksumAddress(`0x${digest.subarray(-20).toString('hex')}`);
}

export function validateMnemonic(mnemonic) {
  const words = String(mnemonic).normalize('NFKD').trim().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  const bits = [];
  for (const word of words) {
    const index = WORD_INDEX.get(word);
    if (index === undefined) return false;
    bits.push(index.toString(2).padStart(11, '0'));
  }
  const allBits = bits.join('');
  const entropyLength = Math.floor((allBits.length * 32) / 33);
  const checksumLength = allBits.length - entropyLength;
  const entropyBits = allBits.slice(0, entropyLength);
  const checksumBits = allBits.slice(entropyLength);
  const entropy = Buffer.alloc(entropyLength / 8);
  for (let index = 0; index < entropy.length; index += 1) {
    entropy[index] = Number.parseInt(entropyBits.slice(index * 8, index * 8 + 8), 2);
  }
  const expected = [...sha256(entropy)]
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join('')
    .slice(0, checksumLength);
  return checksumBits === expected;
}

export function generateMnemonic() {
  const entropy = randomBytes(16);
  const entropyBits = [...entropy].map((byte) => byte.toString(2).padStart(8, '0')).join('');
  const checksum = [...sha256(entropy)].map((byte) => byte.toString(2).padStart(8, '0')).join('').slice(0, 4);
  const combined = entropyBits + checksum;
  const words = [];
  for (let index = 0; index < combined.length; index += 11) {
    words.push(WORDLIST[Number.parseInt(combined.slice(index, index + 11), 2)]);
  }
  return words.join(' ');
}

export function mnemonicToSeed(mnemonic, passphrase = '') {
  if (!validateMnemonic(mnemonic)) throw new Error('Invalid BIP39 mnemonic.');
  return pbkdf2Sync(
    String(mnemonic).normalize('NFKD'),
    `mnemonic${String(passphrase).normalize('NFKD')}`,
    2048,
    64,
    'sha512',
  );
}

export function deriveAddressFromXpub(xpub, index = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new RangeError('Invalid address index.');
  let node = parseXpub(xpub);
  node = derivePublicChild(node, 0);
  node = derivePublicChild(node, index);
  return publicKeyToAddress(node.publicKey);
}

export function deriveWalletFromMnemonic(mnemonic, index = 0) {
  const seed = mnemonicToSeed(mnemonic);
  const accountNode = derivePrivatePath(seed, "m/44'/60'/0'");
  const xpub = serializeXpub(accountNode);
  const address = deriveAddressFromXpub(xpub, index);
  return {
    xpub,
    address,
    accountPath: "m/44'/60'/0'",
    addressPath: `m/44'/60'/0'/0/${index}`,
    addressIndex: index,
  };
}
