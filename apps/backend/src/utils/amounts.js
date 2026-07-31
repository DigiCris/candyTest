import { AppError } from './errors.js';

export const UINT256_MAX = (1n << 256n) - 1n;

export function parseRawAmount(value, { allowZero = true, field = 'amount' } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new AppError(400, 'INVALID_AMOUNT', `${field} must be an unsigned integer string.`);
  }
  const amount = BigInt(value);
  if ((!allowZero && amount === 0n) || amount > UINT256_MAX) {
    throw new AppError(400, 'INVALID_AMOUNT', `${field} is outside the permitted uint256 range.`);
  }
  return amount;
}

export function humanToRaw(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Invalid human token amount: ${value}`);
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`Too many decimals in amount: ${value}`);
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}
