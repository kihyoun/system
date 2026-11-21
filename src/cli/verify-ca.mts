#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyBundle } from '../common/ca-policy.mts';
/** Runs on the pinned Node runtime before installed application dependencies exist. */
export function verifyCaMain(args = process.argv.slice(2)): void {
  if (args.length !== 1 || args[0] !== '--bundle') throw Error('usage-verify-ca-bundle');
  console.log(JSON.stringify(verifyBundle(process.cwd())));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    verifyCaMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'ca-verification-failed');
    process.exitCode = 1;
  }
}
