// Current orcc version.
//
// The published bundle has the real version injected at build time by esbuild
// (`define: __ORCC_VERSION__`). When run from ESM source (dev), that global is
// undefined, so we report 'dev' (which also disables update checks/prompts).

/* global __ORCC_VERSION__ */
export const VERSION = typeof __ORCC_VERSION__ !== 'undefined' ? __ORCC_VERSION__ : 'dev';

export const isDev = VERSION === 'dev';
