#!/usr/bin/env node
import { run } from '../src/index.js';

// Surface unexpected rejections (e.g. EACCES while pruning) as a clean
// one-line error instead of an unhandled-rejection stack trace.
run(process.argv).catch((err) => {
  console.error(`fast-cv: ${err.message}`);
  process.exit(2);
});
