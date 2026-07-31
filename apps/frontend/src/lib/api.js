import { CandyClient } from '@candy/web2-sdk';

export const candy = new CandyClient('/api');

export function errorMessage(error) {
  return error?.message || 'Ocurrió un error inesperado.';
}

export function shortAddress(address) {
  if (!address) return '—';
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}
