import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_ACCOUNT_PATH, isValidXpub } from './wallet.js';

let cached;

export function getConfig() {
  if (cached) return cached;
  const path = process.env.CONFIG_PATH || resolve(process.cwd(), '../../config/demo.constants.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!config?.token?.name || !Number.isInteger(config?.token?.decimals)) {
    throw new Error(`Invalid Candy configuration at ${path}`);
  }

  // The account xpub may come from the environment so a deployment can keep it
  // out of the config file. It is public, watch-only data either way.
  const wallet = {
    accountPath: process.env.CANDY_ACCOUNT_PATH || config.wallet?.accountPath || DEFAULT_ACCOUNT_PATH,
    accountXpub: process.env.CANDY_ACCOUNT_XPUB || config.wallet?.accountXpub,
  };
  if (!isValidXpub(wallet.accountXpub)) {
    throw new Error(`Missing or invalid wallet.accountXpub in ${path} (or CANDY_ACCOUNT_XPUB).`);
  }

  cached = { ...config, wallet };
  return cached;
}
