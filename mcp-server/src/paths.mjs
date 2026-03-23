import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function getMcpServerDir() {
  return path.resolve(moduleDir, '..');
}

export function getDatacoreRepoRoot() {
  return path.resolve(moduleDir, '../..');
}

export function getDatacoreServerEntryPath() {
  return path.resolve(moduleDir, 'index.mjs');
}

export function getDatacoreServerLauncherPath() {
  return path.resolve(moduleDir, '../scripts/run-server.mjs');
}

export function getDatacoreHooksDir() {
  return path.resolve(moduleDir, '../../hooks');
}
