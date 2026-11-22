#!/usr/bin/env node
/**
 * Stable executable entry point. npm creates a junction for linked packages on
 * Windows, so comparing a symlinked argv path with the imported module URL is
 * unreliable. This wrapper always hands control to the CLI parser.
 */

import { main } from '../src/cli.ts';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
