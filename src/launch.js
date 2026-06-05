// Launch Claude Code as a child process with OpenRouter env injected for that process only.

import { spawn, spawnSync } from 'node:child_process';
import { ANTHROPIC_BASE_URL } from './openrouter.js';

const onWindows = process.platform === 'win32';

/** Run `npm uninstall -g <pkg>`, inheriting stdio. Resolves with the exit code. */
export function npmUninstallGlobal(pkg) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['uninstall', '-g', pkg], { stdio: 'inherit', shell: onWindows });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Quick preflight: is the `claude` CLI on PATH? */
export function isClaudeInstalled() {
  try {
    const res = spawnSync('claude', ['--version'], {
      stdio: 'ignore',
      shell: onWindows,
    });
    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Build the environment for the spawned Claude Code process.
 * - main/subagent/opus/sonnet roles → the model the user picked
 * - cheap "fast"/haiku role → a free model (falls back to the picked model)
 */
export function buildEnv(apiKey, selectedId, fastId) {
  const fast = fastId || selectedId;
  return {
    ...process.env,
    ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: '', // must be explicitly empty per OpenRouter integration guide
    ANTHROPIC_DEFAULT_OPUS_MODEL: selectedId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: selectedId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
    ANTHROPIC_SMALL_FAST_MODEL: fast,
    CLAUDE_CODE_SUBAGENT_MODEL: selectedId,
  };
}

/**
 * Spawn Claude Code, inheriting the terminal, and resolve with its exit code.
 * Extra CLI args (after the launcher's own flags) are forwarded to claude.
 */
export function launchClaude({ apiKey, selectedId, fastId, passthroughArgs = [] }) {
  const env = buildEnv(apiKey, selectedId, fastId);
  const args = ['--model', selectedId, ...passthroughArgs];

  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      stdio: 'inherit',
      env,
      shell: onWindows, // resolves claude.cmd on Windows
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('\nCould not start `claude` — is Claude Code installed and on your PATH?');
        console.error('Install it with: npm install -g @anthropic-ai/claude-code');
      } else {
        console.error(`\nFailed to launch Claude Code: ${err.message}`);
      }
      resolve(1);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}
