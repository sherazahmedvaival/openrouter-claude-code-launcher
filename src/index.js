// Orchestration: parse flags → fetch/categorize models → resolve key → pick model → launch.

import { getAllModels, categorize, pickFastModel } from './openrouter.js';
import {
  getApiKey,
  saveApiKey,
  setLastModel,
  getFavourites,
  toggleFavourite,
  setUpdateCheck,
  configDir,
  removeConfigDir,
} from './config.js';
import {
  promptApiKey,
  confirmSaveKey,
  confirmAction,
  pickCategory,
  pickModel,
  modelAction,
  PICK_BACK,
} from './ui.js';
import { isClaudeInstalled, launchClaude, npmUninstallGlobal, npmInstallGlobalLatest } from './launch.js';
import { VERSION } from './version.js';
import { PACKAGE_NAME, isNewer, fetchLatestVersion, getLatestVersionThrottled } from './update.js';

const HELP = `
orcc — OpenRouter launcher for Claude Code

Usage:
  orcc [options] [-- <claude args>]

Options:
  -m, --model <id>   Skip the picker and launch this OpenRouter model id
  -l, --list         Print free + paid (tool-capable) models and exit
  -r, --refresh      Ignore the cached model list and re-fetch
  -u, --uninstall    Remove orcc's saved data (and optionally the global package)
  -y, --yes          Skip confirmation prompts (use with --uninstall)
      --update       Update orcc to the latest version from npm
  -v, --version      Print the orcc version
  -h, --help         Show this help

Credentials:
  Reads OPENROUTER_API_KEY, else a saved config, else prompts once.

Browsing: choose Favourites / Search-all / Paid / Free, type to filter the list,
and add any model to ★ favourites — favourites are pinned to the top next time.

Tip: Claude Code works reliably only with Anthropic models (⭐). Free models
are rate-limited (~50/day) and often fail mid-session.

Anything after "--" is forwarded to Claude Code, e.g.:
  orcc -m anthropic/claude-haiku-4.5 -- --dangerously-skip-permissions
`;

const freeWarning = (id) =>
  `\n⚠ "${id}" is a FREE model — rate-limited (~50/day) and often unreliable in Claude Code.`;

/** Minimal flag parser. Returns parsed options + claude passthrough args. */
function parseArgs(argv) {
  const opts = {
    help: false, list: false, refresh: false, uninstall: false, yes: false,
    update: false, version: false, model: null, passthrough: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.passthrough = argv.slice(i + 1); break; }
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-l' || a === '--list') opts.list = true;
    else if (a === '-r' || a === '--refresh') opts.refresh = true;
    else if (a === '-u' || a === '--uninstall') opts.uninstall = true;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--update') opts.update = true;
    else if (a === '-v' || a === '--version') opts.version = true;
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

/** Resolve the model list + display label for a chosen category. */
function listForCategory(cat, { free, paid, all, favs }) {
  if (cat === 'fav') return { list: all.filter((m) => favs.includes(m.id)), label: '★ Favourites' };
  if (cat === 'search') return { list: all, label: 'All' };
  if (cat === 'free') return { list: free, label: 'Free' };
  return { list: paid, label: 'Paid' };
}

/**
 * Browse flow: choose a category (Favourites / Search-all / Paid / Free), then a
 * searchable list with favourites pinned on top. After picking a model the user can
 * launch it or toggle it as a favourite. Returns the chosen model id.
 */
async function selectViaBrowser(free, paid, all) {
  for (;;) {
    // Category chooser (favourite count is recomputed each loop).
    const favCount = (await getFavourites()).filter((id) => all.some((m) => m.id === id)).length;
    const cat = await pickCategory(free, paid, favCount);

    // List loop — re-rendered after each favourite toggle.
    for (;;) {
      const favs = await getFavourites();
      const { list, label } = listForCategory(cat, { free, paid, all, favs });
      if (!list.length) {
        console.log(
          cat === 'fav'
            ? '\nNo favourites yet — pick a model and choose “★ Add to favourites”.'
            : `\nNo ${label} models available.`,
        );
        break; // back to category chooser
      }

      const pick = await pickModel(list, { label, favourites: favs });
      if (pick === PICK_BACK) break; // back to category chooser

      const model = all.find((x) => x.id === pick);
      const action = await modelAction(model, favs.includes(pick));
      if (action === 'launch') {
        if (model?.free) console.warn(freeWarning(pick));
        return pick;
      }
      if (action === 'fav') {
        const nowFav = await toggleFavourite(pick);
        console.log(nowFav ? `★ Added to favourites: ${pick}` : `☆ Removed from favourites: ${pick}`);
      }
      // 'fav'/'back' → fall through and re-render the list with updated favourites.
    }
  }
}

/**
 * Uninstall flow: remove orcc's data directory (config + cache) and optionally the
 * global npm package. Non-interactive shells (no TTY) print manual steps unless --yes.
 */
async function runUninstall({ yes }) {
  const dir = configDir();
  const canPrompt = Boolean(process.stdin.isTTY);

  console.log('\norcc — uninstall\n');
  console.log("orcc keeps its saved data (API key, favourites, last model, cache) here:");
  console.log(`  ${dir}\n`);

  if (!yes && !canPrompt) {
    console.log('Non-interactive shell — nothing was removed. To uninstall manually:');
    console.log(`  rm -rf "${dir}"                 # remove saved data`);
    console.log(`  npm uninstall -g ${PACKAGE_NAME}   # remove the command`);
    console.log('Or re-run with --yes to remove the data directory automatically.');
    return 0;
  }

  const removeData = yes || (await confirmAction('Remove the data directory above?', true));
  if (removeData) {
    const { dir: removed, existed } = await removeConfigDir();
    console.log(existed ? `✓ Removed ${removed}` : `(nothing to remove at ${removed})`);
  } else {
    console.log('• Kept your data directory.');
  }

  const removePkg = yes || (await confirmAction(`Also uninstall the global npm package "${PACKAGE_NAME}" now?`, false));
  if (removePkg) {
    console.log(`\n$ npm uninstall -g ${PACKAGE_NAME}`);
    const code = await npmUninstallGlobal(PACKAGE_NAME);
    console.log(
      code === 0
        ? '✓ Global package removed.'
        : `(could not auto-remove — exit ${code}). If it was installed globally, run:\n  npm uninstall -g ${PACKAGE_NAME}`,
    );
  } else {
    console.log(`\nTo remove the command itself, run:\n  npm uninstall -g ${PACKAGE_NAME}`);
  }

  console.log('\nDone. Thanks for using orcc.');
  return 0;
}

/**
 * Manual update: check npm for the latest version and run `npm install -g <pkg>@latest`.
 * Returns a process exit code.
 */
async function runUpdate() {
  console.log(`\norcc — update\n\nInstalled version: ${VERSION}`);
  if (VERSION === 'dev') {
    console.log('Running from source (dev). Update your git checkout, or install the published build:');
    console.log(`  npm install -g ${PACKAGE_NAME}@latest`);
    return 0;
  }

  console.log('Checking npm for the latest version…');
  const latest = await fetchLatestVersion({ timeoutMs: 6000 });
  if (!latest) {
    console.log(`Could not reach the npm registry. Try again later, or run:\n  npm install -g ${PACKAGE_NAME}@latest`);
    return 1;
  }
  await setUpdateCheck({ at: Date.now(), latest }); // refresh the throttle cache

  if (!isNewer(latest, VERSION)) {
    console.log(`✓ You're already on the latest version (${VERSION}).`);
    return 0;
  }

  console.log(`Updating ${VERSION} → ${latest}\n\n$ npm install -g ${PACKAGE_NAME}@latest`);
  const code = await npmInstallGlobalLatest(PACKAGE_NAME);
  if (code === 0) {
    console.log(`\n✓ Updated to ${latest}. Run orcc again to use it.`);
    return 0;
  }
  console.log(
    `\n(could not auto-update — exit ${code}). If you use npx, just re-run \`npx ${PACKAGE_NAME}\`; ` +
      `if installed globally, run:\n  npm install -g ${PACKAGE_NAME}@latest`,
  );
  return 1;
}

/** Non-blocking, throttled "update available" notice for interactive launches. */
async function maybeNotifyUpdate() {
  if (VERSION === 'dev' || process.env.ORCC_NO_UPDATE_CHECK) return;
  try {
    const latest = await getLatestVersionThrottled();
    if (isNewer(latest, VERSION)) {
      console.log(`\n⬆  Update available: ${VERSION} → ${latest}.  Run \`orcc --update\` to upgrade.`);
    }
  } catch {
    /* never block the launcher on update checks */
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
  if (opts.version) { console.log(VERSION); return; }
  if (opts.help) { console.log(HELP); return; }
  if (opts.uninstall) { process.exit(await runUninstall({ yes: opts.yes })); }
  if (opts.update) { process.exit(await runUpdate()); }

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

  // Non-blocking, throttled notice if a newer orcc is published.
  await maybeNotifyUpdate();

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
        '. ⭐ = Anthropic (recommended) · ★ = your favourites.',
    );
    selectedId = await selectViaBrowser(free, paid, all);
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
