// OpenRouter model fetching, normalization, and free/paid categorization.

import { readCache, writeCache } from './config.js';

export const MODELS_URL = 'https://openrouter.ai/api/v1/models';
// Base URL Claude Code points at (it appends /v1/messages itself).
export const ANTHROPIC_BASE_URL = 'https://openrouter.ai/api';

/** A model is free only when both prompt and completion cost exactly zero. */
function isFree(pricing) {
  const p = parseFloat(pricing?.prompt ?? 'NaN');
  const c = parseFloat(pricing?.completion ?? 'NaN');
  return p === 0 && c === 0;
}

/** Claude Code is tool-use driven; a model must accept `tools` to function. */
function supportsTools(model) {
  return Array.isArray(model.supported_parameters) && model.supported_parameters.includes('tools');
}

/** True for Anthropic first-party models — the only ones OpenRouter guarantees with Claude Code. */
export function isAnthropic(model) {
  return (model?.id || '').startsWith('anthropic/');
}

/** Map a raw OpenRouter model into the compact shape the UI/launcher needs. */
function normalize(model) {
  return {
    id: model.id,
    name: model.name || model.id,
    free: isFree(model.pricing),
    tools: supportsTools(model),
    promptPrice: parseFloat(model.pricing?.prompt ?? '0') || 0,
    completionPrice: parseFloat(model.pricing?.completion ?? '0') || 0,
    contextLength: model.context_length || model.top_provider?.context_length || 0,
    description: model.description || '',
  };
}

/** Fetch the live model list from OpenRouter (public endpoint, no auth required). */
async function fetchLive() {
  let res;
  try {
    res = await fetch(MODELS_URL, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Could not reach OpenRouter (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`OpenRouter returned HTTP ${res.status} when listing models`);
  }
  const body = await res.json();
  if (!Array.isArray(body?.data)) {
    throw new Error('Unexpected response from OpenRouter models endpoint');
  }
  return body.data.map(normalize);
}

/**
 * Return all models, preferring fresh cache, then network, then stale cache.
 * Returns { models, fromCache, stale }.
 */
export async function getAllModels({ refresh = false } = {}) {
  if (!refresh) {
    const cached = await readCache();
    if (cached) return { models: cached.models, fromCache: true, stale: false };
  }
  try {
    const models = await fetchLive();
    await writeCache(models);
    return { models, fromCache: false, stale: false };
  } catch (err) {
    // Network/API failure: fall back to stale cache if we have any.
    const stale = await readCache({ allowStale: true });
    if (stale) return { models: stale.models, fromCache: true, stale: true, error: err };
    throw err;
  }
}

/**
 * Keep tool-capable, valid-priced models and split into sorted free/paid lists.
 * Models with sentinel/negative pricing (routers like `openrouter/auto`) are dropped.
 * Paid models are sorted Anthropic-first (recommended for Claude Code), then by price.
 */
export function categorize(models) {
  const usable = models.filter((m) => m.tools && m.promptPrice >= 0 && m.completionPrice >= 0);
  const free = usable
    .filter((m) => m.free)
    .sort((a, b) => a.name.localeCompare(b.name));
  const paid = usable
    .filter((m) => !m.free)
    .sort((a, b) => {
      // Lowest-cost first (sum of prompt + completion price per token).
      const ca = a.promptPrice + a.completionPrice;
      const cb = b.promptPrice + b.completionPrice;
      return ca - cb || a.name.localeCompare(b.name);
    });
  const droppedNoTools = models.filter((m) => !m.tools).length;
  return { free, paid, droppedNoTools };
}

/**
 * Choose a cheap, Claude-Code-compatible model for the background/"fast" role.
 * Never returns a free model — those are quota-capped (~50/day) and unreliable in Claude Code.
 *   - Anthropic main model -> cheapest Anthropic "haiku" (falls back to the main model)
 *   - non-Anthropic main   -> the main model itself (keeps cost + provider consistent)
 */
export function pickFastModel(selectedId, models) {
  if (isAnthropic({ id: selectedId })) {
    const haiku = models
      .filter((m) => m.tools && m.promptPrice > 0 && isAnthropic(m) && /haiku/i.test(m.id))
      .sort((a, b) => a.promptPrice - b.promptPrice)[0];
    return haiku ? haiku.id : selectedId;
  }
  return selectedId;
}
