#!/usr/bin/env node
import { main } from '../src/index.js';

main().catch((err) => {
  // Last-resort guard; src/index.js handles expected errors gracefully.
  console.error(`\nUnexpected error: ${err?.message || err}`);
  process.exit(1);
});
