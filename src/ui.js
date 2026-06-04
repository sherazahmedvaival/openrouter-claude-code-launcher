// Interactive prompts: API-key entry, reuse-last, category choice, and the searchable model picker.

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

/** Build a one-line choice for the search menu. ⭐ marks Anthropic (recommended) models. */
function toChoice(m) {
  const star = !m.free && (m.id || '').startsWith('anthropic/') ? '⭐ ' : '';
  const tag = m.free ? 'FREE' : `${perMillion(m.promptPrice)}/${perMillion(m.completionPrice)} per M`;
  const bits = [m.id, ctx(m.contextLength), tag].filter(Boolean).join('  ·  ');
  return {
    name: `${star}${m.name}  —  ${bits}`,
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

/** First step of browsing: choose the Free or Paid category. Returns 'free' | 'paid'. */
export async function pickCategory(free, paid) {
  return select({
    message: 'Which models do you want to browse?',
    default: 'paid',
    choices: [
      { name: `Paid  (${paid.length})  — cheapest first · ⭐ Anthropic recommended for Claude Code`, value: 'paid' },
      { name: `Free  (${free.length})  — $0, but rate-limited (~50/day) & often unreliable in Claude Code`, value: 'free' },
    ],
  });
}

/**
 * Searchable picker over a single category (already sorted by the caller).
 * Type to filter; empty query lists everything (with a "back" option on top).
 * Returns the chosen model id, or PICK_BACK to return to the category chooser.
 */
export async function pickModel(models, { label }) {
  const back = { name: '↩  Back to Free / Paid', value: PICK_BACK };
  return search({
    message: `Select a ${label} model (type to filter, ↑/↓ to browse):`,
    pageSize: 15,
    source: async (term) => {
      if (!term) return [back, new Separator(`── ${label} (${models.length}) ──`), ...models.map(toChoice)];
      const t = term.toLowerCase();
      const filtered = models.filter((m) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t));
      return filtered.map(toChoice);
    },
  });
}
