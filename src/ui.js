// Interactive prompts: API-key entry, category choice, searchable picker, favourites, model actions.

import { search, select, confirm, password, Separator } from '@inquirer/prompts';

/** Sentinel returned by pickModel when the user chooses "back to categories". */
export const PICK_BACK = '__back__';

/** Format a per-token price as a per-million-token dollar figure. */
function perMillion(price) {
  if (!price) return '$0';
  const v = price * 1_000_000;
  return v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
}

function ctx(contextLength) {
  if (!contextLength) return '';
  if (contextLength >= 1_000_000) return `${(contextLength / 1_000_000).toFixed(contextLength % 1_000_000 ? 1 : 0)}M ctx`;
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}K ctx`;
  return `${contextLength} ctx`;
}

/** Build a one-line choice. ★ marks a favourite; ⭐ marks Anthropic (recommended). */
function toChoice(m, { fav = false } = {}) {
  const favMark = fav ? '★ ' : '';
  const recMark = !m.free && (m.id || '').startsWith('anthropic/') ? '⭐ ' : '';
  const tag = m.free ? 'FREE' : `${perMillion(m.promptPrice)}/${perMillion(m.completionPrice)} per M`;
  const bits = [m.id, ctx(m.contextLength), tag].filter(Boolean).join('  ·  ');
  return {
    name: `${favMark}${recMark}${m.name}  —  ${bits}`,
    value: m.id,
    description: m.description ? m.description.slice(0, 140) : undefined,
  };
}

/** Prompt for an API key (hidden input). */
export async function promptApiKey() {
  return password({
    message: 'Enter your OpenRouter API key (https://openrouter.ai/keys):',
    mask: '*',
    validate: (v) => (v && v.trim().length > 8 ? true : 'That does not look like a valid key'),
  });
}

export async function confirmSaveKey() {
  return confirm({ message: 'Save this key to your config for next time?', default: true });
}

/** Generic yes/no confirmation. */
export async function confirmAction(message, def = false) {
  return confirm({ message, default: def });
}

/**
 * First browse step: choose Favourites / Search-all / Paid / Free.
 * Returns 'fav' | 'search' | 'paid' | 'free'.
 */
export async function pickCategory(free, paid, favCount = 0) {
  return select({
    message: 'Which models do you want to browse?',
    default: favCount > 0 ? 'fav' : 'paid',
    choices: [
      { name: `★ Favourites  (${favCount})`, value: 'fav' },
      { name: '🔍 Search all models  — type to filter across free + paid', value: 'search' },
      { name: `Paid  (${paid.length})  — cheapest first · ⭐ Anthropic recommended for Claude Code`, value: 'paid' },
      { name: `Free  (${free.length})  — $0, but rate-limited (~50/day) & often unreliable in Claude Code`, value: 'free' },
    ],
  });
}

/**
 * Searchable picker over a list (already sorted by the caller).
 * Favourites present in the list are pinned to the top with a ★.
 * Type to filter (id or name); returns a model id, or PICK_BACK to go back.
 */
export async function pickModel(models, { label, favourites = [] }) {
  const favSet = new Set(favourites);
  const favModels = models.filter((m) => favSet.has(m.id));
  const rest = models.filter((m) => !favSet.has(m.id));
  const back = { name: '↩  Back to categories', value: PICK_BACK };
  const choice = (m) => toChoice(m, { fav: favSet.has(m.id) });

  return search({
    message: `Select a ${label} model (type to filter, ↑/↓ to browse):`,
    pageSize: 15,
    source: async (term) => {
      if (term) {
        const t = term.toLowerCase();
        const match = (m) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t);
        return [...favModels.filter(match), ...rest.filter(match)].map(choice);
      }
      const out = [back];
      if (favModels.length) {
        out.push(new Separator('★ Favourites'), ...favModels.map(choice));
        if (rest.length) out.push(new Separator(`── ${label} ──`), ...rest.map(choice));
      } else {
        out.push(new Separator(`── ${label} (${models.length}) ──`), ...rest.map(choice));
      }
      return out;
    },
  });
}

/**
 * After a model is picked: launch it, toggle its favourite state, or go back.
 * Returns 'launch' | 'fav' | 'back'.
 */
export async function modelAction(model, isFav) {
  return select({
    message: `${model.name}  (${model.id})`,
    default: 'launch',
    choices: [
      { name: '▶  Launch Claude Code with this model', value: 'launch' },
      { name: isFav ? '☆  Remove from favourites' : '★  Add to favourites', value: 'fav' },
      { name: '↩  Back to list', value: 'back' },
    ],
  });
}
