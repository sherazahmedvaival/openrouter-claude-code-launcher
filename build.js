// Bundles the CLI + all npm dependencies into a single self-contained file so that
// `npx orcc` / `npm i -g orcc` cold-start fast (no dependency tree to fetch at install time).
//
// Output is CommonJS (dist/orcc.cjs) — the most robust esbuild target for a Node CLI:
// the entry shebang is preserved and there is no ESM `require` shim to worry about.
// Source stays ESM (src/, bin/) for local development (`node bin/orcc.js`).

import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['bin/orcc.js'],
  outfile: 'dist/orcc.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  legalComments: 'none',
});

chmodSync('dist/orcc.cjs', 0o755);
console.log('Bundled → dist/orcc.cjs');
