// Orchestration: parse flags → fetch/categorize models → resolve key → pick model → launch.

import { getAllModels, categorize, pickFastModel } from './openrouter.js';
import { getApiKey, saveApiKey, setLastModel } from './config.js';
import { promptApiKey, confirmSaveKey, pickCategory, pickModel, PICK_BACK } from './ui.js';
import { isClaudeInstalled, launchClaude } from './launch.js';

const HELP = `
orcc — OpenRouter launcher for Claude Code

Usage:
  orcc [options] [-- <claude args>]

Options:
  -m, --model <id>   Skip the picker and launch this OpenRouter model id
  -l, --list         Print free + paid (tool-capable) models and exit
  -r, --refresh      Ignore the cached model list and re-fetch
  -h, --help         Show this help

Credentials:
  Reads OPENROUTER_API_KEY, else a saved config, else prompts once.

Tip: Claude Code works reliably only with Anthropic models (⭐). Free models
are rate-limited (~50/day) and often fail mid-session.

Anything after "--" is forwarded to Claude Code, e.g.:
  orcc -m anthropic/claude-haiku-4.5 -- --dangerously-skip-permissions
`;

const freeWarning = (id) =>
  `\n⚠ "${id}" is a FREE model — rate-limited (~50/day) and often unreliable in Claude Code.`;

/** Minimal flag parser. Returns parsed options + claude passthrough args. */
function parseArgs(argv) {
  const opts = { help: false, list: false, refresh: false, model: null, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.passthrough = argv.slice(i + 1); break; }
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-l' || a === '--list') opts.list = true;
    else if (a === '-r' || a === '--refresh') opts.refresh = true;
    else if (a === '-m' || a === '--model') opts.model = argv[++i];
    else if (a.startsWith('--model=')) opts.model = a.slice('--model='.length);
    else console.error(`Ignoring unknown option: ${a}`);
  }
  return opts;
}

function printList(free, paid) {
  const line = (m) => `  ${m.id}${m.contextLength ? `  (${m.contextLength.toLocaleString()} ctx)` : ''}`;
  console.log(`\nFree models (${free.length}):`);
  free.forEach((m) => console.log(line(m)));
  console.log(`\nPaid models (${paid.length}, ⭐ = Anthropic recommended):`);
  paid.forEach((m) => console.log(`${m.id.startsWith('anthropic/') ? ' ⭐' : '  '}${line(m).slice(2)}`));
  console.log('');
}

/**
 * Browse flow: ask Free or Paid, then show that category's searchable list.
 * Loops on "back" and on declining the free-model warning. Returns a model id.
 */
async function selectViaBrowser(free, paid) {
  for (;;) {
    const cat = await pickCategory(free, paid);
    const list = cat === 'free' ? free : paid;
    const label = cat === 'free' ? 'Free' : 'Paid';
    if (!list.length) {
      console.log(`\nNo ${label.toLowerCase()} models available — choose the other category.`);
      continue;
    }
    const pick = await pickModel(list, { label });
    if (pick === PICK_BACK) continue;
    if (list.find((x) => x.id === pick)?.free) console.warn(freeWarning(pick));
    return pick;
  }
}

/** Resolve an API key from env/config, prompting (and optionally saving) if needed. */
async function resolveApiKey() {
  const { key } = await getApiKey();
  if (key) return key;
  console.log('\nNo OpenRouter API key found (OPENROUTER_API_KEY or saved config).');
  const entered = (await promptApiKey()).trim();
  if (await confirmSaveKey()) {
    await saveApiKey(entered);
    console.log('Key saved.');
  }
  return entered;
}

export async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  // 1. Fetch + categorize models (with cache and stale-cache fallback).
  let result;
  try {
    result = await getAllModels({ refresh: opts.refresh });
  } catch (err) {
    console.error(`\nFailed to load models: ${err.message}`);
    console.error('Check your network connection and try again.');
    process.exit(1);
  }
  if (result.stale) {
    console.warn(`\n⚠ Using cached model list — live fetch failed (${result.error?.message || 'network error'}).`);
  }

  const { free, paid, droppedNoTools } = categorize(result.models);
  if (!free.length && !paid.length) {
    console.error('\nNo tool-capable models were returned by OpenRouter. Try `orcc --refresh`.');
    process.exit(1);
  }

  if (opts.list) { printList(free, paid); return; }

  const all = [...free, ...paid];

  // 2. Determine the model: explicit flag → reuse-last prompt → searchable picker.
  let selectedId = null;
  if (opts.model) {
    const m = all.find((x) => x.id === opts.model);
    if (!m) console.warn(`\n⚠ "${opts.model}" is not in the tool-capable list; launching it anyway.`);
    if (m?.free) console.warn(freeWarning(opts.model));
    selectedId = opts.model;
  } else {
    console.log(
      `\n${free.length} free + ${paid.length} paid tool-capable models` +
        (droppedNoTools ? ` (${droppedNoTools} non-tool models hidden)` : '') +
        '. ⭐ = Anthropic (recommended for Claude Code).',
    );
    selectedId = await selectViaBrowser(free, paid);
  }
  if (!selectedId) { console.error('No model selected.'); process.exit(1); }

  // 3. Preflight Claude Code before asking for a key.
  if (!isClaudeInstalled()) {
    console.error('\n`claude` was not found on your PATH.');
    console.error('Install Claude Code with: npm install -g @anthropic-ai/claude-code');
    process.exit(127);
  }

  // 4. Resolve credentials (needed to actually talk to OpenRouter).
  const apiKey = await resolveApiKey();
  if (!apiKey) { console.error('An OpenRouter API key is required to launch.'); process.exit(1); }

  await setLastModel(selectedId);

  // 5. Hand off to Claude Code.
  const fastId = pickFastModel(selectedId, result.models);
  const fastNote = fastId && fastId !== selectedId ? `  (background → ${fastId})` : '';
  console.log(`\n▶ Launching Claude Code with ${selectedId}${fastNote}\n`);

  const code = await launchClaude({ apiKey, selectedId, fastId, passthroughArgs: opts.passthrough });
  process.exit(code);
}
