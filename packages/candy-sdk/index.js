const UINT256_MAX = (1n << 256n) - 1n;

export class CandyApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'CandyApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asIdentifier(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    if (typeof value.address === 'string' && value.address.trim()) return value.address.trim();
    if (typeof value.username === 'string' && value.username.trim()) return value.username.trim();
  }
  throw new TypeError('User identifier must be a username, address, or object containing username/address.');
}

export function asRawAmount(value) {
  let amount;
  if (typeof value === 'bigint') {
    amount = value;
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('Numbers must be safe integers. Prefer bigint or a decimal string.');
    }
    amount = BigInt(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    amount = BigInt(value);
  } else {
    throw new TypeError('Amount must be an unsigned bigint, safe integer, or decimal digit string.');
  }
  if (amount < 0n || amount > UINT256_MAX) {
    throw new RangeError('Amount is outside uint256 range.');
  }
  return amount;
}

export function parseUnits(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new TypeError('Human amount must be a positive decimal string.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new RangeError(`Too many decimal places; token uses ${decimals}.`);
  }
  const raw = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return asRawAmount(raw || '0');
}

export function formatUnits(value, decimals) {
  const raw = asRawAmount(value).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export class CandyClient {
  constructor(baseUrl = '/api', fetchImpl) {
    const resolvedFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    if (typeof resolvedFetch !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = resolvedFetch;
  }

  async request(path, options = {}) {
    const { headers, body, ...rest } = options;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
      ...rest,
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CandyApiError(
        payload?.error?.message || `Request failed with status ${response.status}`,
        response.status,
        payload?.error?.code || 'HTTP_ERROR',
        payload?.error?.details,
      );
    }
    return payload;
  }

  async name() { return (await this.request('/token/name')).value; }
  async symbol() { return (await this.request('/token/symbol')).value; }
  async decimals() { return (await this.request('/token/decimals')).value; }
  async totalSupply() { return BigInt((await this.request('/token/totalSupply')).value); }
  async balanceOf(owner) { return BigInt((await this.request(`/token/balanceOf/${encodeURIComponent(asIdentifier(owner))}`)).value); }
  async allowance(owner, spender) {
    return BigInt((await this.request(`/token/allowance/${encodeURIComponent(asIdentifier(owner))}/${encodeURIComponent(asIdentifier(spender))}`)).value);
  }
  async transfer(to, amount) {
    return this.request('/token/transfer', { method: 'POST', body: { to: asIdentifier(to), amount: asRawAmount(amount).toString() } });
  }
  async approve(spender, amount) {
    return this.request('/token/approve', { method: 'POST', body: { spender: asIdentifier(spender), amount: asRawAmount(amount).toString() } });
  }
  async transferFrom(from, to, amount) {
    return this.request('/token/transferFrom', {
      method: 'POST',
      body: { from: asIdentifier(from), to: asIdentifier(to), amount: asRawAmount(amount).toString() },
    });
  }
  async mint(to, amount) {
    return this.request('/token/mint', { method: 'POST', body: { to: asIdentifier(to), amount: asRawAmount(amount).toString() } });
  }
  async burn(from, amount) {
    return this.request('/token/burn', { method: 'POST', body: { from: asIdentifier(from), amount: asRawAmount(amount).toString() } });
  }
  async getOnlyOwnerOrAllowed() { return (await this.request('/admin/onlyOwnerOrAllowed')).enabled; }
  async setOnlyOwnerOrAllowed(enabled) {
    return this.request('/admin/onlyOwnerOrAllowed', { method: 'PUT', body: { enabled: Boolean(enabled) } });
  }

  async register(username, password) {
    return this.request('/auth/register', { method: 'POST', body: { username, password } });
  }
  async login(username, password) {
    return this.request('/auth/login', { method: 'POST', body: { username, password } });
  }
  async logout() { return this.request('/auth/logout', { method: 'POST' }); }
  async me() { return (await this.request('/auth/me')).user; }
  async publicConfig() { return this.request('/config/public'); }

  async startGame(stake) {
    return this.request('/games', { method: 'POST', body: { stake: asRawAmount(stake).toString() } });
  }
  async getGame(gameId) { return this.request(`/games/${encodeURIComponent(gameId)}`); }
  async resolveGame(gameId, engineNumber, playerNumber) {
    return this.request(`/games/${encodeURIComponent(gameId)}/resolve`, {
      method: 'POST',
      body: { engineNumber, playerNumber },
    });
  }
}

export async function readBaseUsdcBalance({ rpcUrl, tokenAddress, ownerAddress }) {
  const address = String(ownerAddress).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new TypeError('Invalid EVM address.');
  const selector = '70a08231';
  const data = `0x${selector}${address.slice(2).padStart(64, '0')}`;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest'],
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error || typeof payload.result !== 'string') {
    throw new CandyApiError(payload?.error?.message || 'Base RPC request failed.', response.status, 'RPC_ERROR', payload.error);
  }
  return BigInt(payload.result);
}
