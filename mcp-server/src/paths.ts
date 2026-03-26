// paths.ts — Where are the data files?
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function getMcpServerDir(): string {
  return path.resolve(moduleDir, '..');
}

export function getDatacoreRepoRoot(): string {
  return path.resolve(moduleDir, '../..');
}

export function getDatacoreServerEntryPath(): string {
  return path.resolve(moduleDir, '../dist/server.js');
}

export function getDatacoreServerLauncherPath(): string {
  return path.resolve(moduleDir, '../scripts/run-server.mjs');
}

export function getDatacoreHooksDir(): string {
  return path.resolve(moduleDir, '../../hooks');
}
