// Update checks against the npm registry (the channel users actually install from).

import { getUpdateCheck, setUpdateCheck } from './config.js';

/** Published package name (the installed command stays `orcc`). */
export const PACKAGE_NAME = 'openrouter-claude-code-launcher';

const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_TTL_MS = 24 * 60 * 60 * 1000; // throttle auto-checks to once/day

/** Parse "1.2.3" / "v1.2.3-beta" → [1, 2, 3] (prerelease suffix ignored). */
function parse(v) {
  return String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}

/** True if `latest` is a strictly newer x.y.z than `current` (false for dev/unknown). */
export function isNewer(latest, current) {
  if (!latest || !current || current === 'dev') return false;
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** Fetch the latest published version from npm, or null on any failure/timeout. */
export async function fetchLatestVersion({ timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Latest version with a 24h throttle (cached in config). `force` bypasses the throttle.
 * On network failure, falls back to the last known cached value.
 */
export async function getLatestVersionThrottled({ force = false } = {}) {
  const cached = await getUpdateCheck();
  const fresh = cached?.at && Date.now() - cached.at < CHECK_TTL_MS;
  if (!force && fresh) return cached.latest || null;

  const latest = await fetchLatestVersion();
  if (latest) {
    await setUpdateCheck({ at: Date.now(), latest });
    return latest;
  }
  return cached?.latest || null; // stale fallback when offline
}
