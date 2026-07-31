import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cached;

export function getConfig() {
  if (cached) return cached;
  const path = process.env.CONFIG_PATH || resolve(process.cwd(), '../../config/demo.constants.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!config?.token?.name || !Number.isInteger(config?.token?.decimals)) {
    throw new Error(`Invalid Candy configuration at ${path}`);
  }
  cached = config;
  return cached;
}
