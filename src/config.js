// Persistent config + cache: API key, last-used model, and a short-lived model-list cache.
// Cross-platform config location with guarded file permissions.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR_NAME = 'orcc';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve the per-user config directory for the current platform. */
export function configDir() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, APP_DIR_NAME);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

const configPath = () => path.join(configDir(), 'config.json');
const cachePath = () => path.join(configDir(), 'cache.json');

async function ensureDir() {
  await fs.mkdir(configDir(), { recursive: true });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write JSON, restricting permissions to the owner on POSIX systems. */
async function writeJson(file, data) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(file, 0o600);
    } catch {
      /* best effort */
    }
  }
}

// ---- config (api key + last model) ----

export async function readConfig() {
  return (await readJson(configPath())) || {};
}

export async function getApiKey() {
  // Environment variable always wins over the stored value.
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const cfg = await readConfig();
  if (cfg.apiKey) return { key: cfg.apiKey, source: 'config' };
  return { key: null, source: null };
}

export async function saveApiKey(key) {
  const cfg = await readConfig();
  cfg.apiKey = key;
  await writeJson(configPath(), cfg);
}

export async function getLastModel() {
  const cfg = await readConfig();
  return cfg.lastModel || null;
}

export async function setLastModel(id) {
  const cfg = await readConfig();
  cfg.lastModel = id;
  await writeJson(configPath(), cfg);
}

// ---- favourites ----

export async function getFavourites() {
  const cfg = await readConfig();
  return Array.isArray(cfg.favourites) ? cfg.favourites : [];
}

/** Add or remove a model id from favourites. Returns true if it is now a favourite. */
export async function toggleFavourite(id) {
  const cfg = await readConfig();
  const favs = Array.isArray(cfg.favourites) ? cfg.favourites : [];
  const at = favs.indexOf(id);
  if (at >= 0) favs.splice(at, 1);
  else favs.push(id);
  cfg.favourites = favs;
  await writeJson(configPath(), cfg);
  return favs.includes(id);
}

// ---- model-list cache ----

/** Return cached models. `allowStale` returns expired cache too (network-failure fallback). */
export async function readCache({ allowStale = false } = {}) {
  const cache = await readJson(cachePath());
  if (!cache?.models?.length || !cache.fetchedAt) return null;
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!fresh && !allowStale) return null;
  return { models: cache.models, fetchedAt: cache.fetchedAt, stale: !fresh };
}

export async function writeCache(models) {
  await writeJson(cachePath(), { fetchedAt: Date.now(), models });
}

// ---- uninstall ----

/** Remove orcc's data directory (config + cache). Returns { dir, existed }. */
export async function removeConfigDir() {
  const dir = configDir();
  let existed = true;
  try {
    await fs.access(dir);
  } catch {
    existed = false;
  }
  if (existed) await fs.rm(dir, { recursive: true, force: true });
  return { dir, existed };
}
