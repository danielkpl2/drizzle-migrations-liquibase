#!/usr/bin/env node

/**
 * unpatch-drizzle-kit.mjs
 *
 * Restores the original drizzle-kit/api.js from the backup created by
 * patch-drizzle-kit.mjs. This runs automatically via the `preuninstall`
 * lifecycle hook when the package is removed.
 *
 * Safe to run manually — exits cleanly if drizzle-kit is not installed
 * or no backup exists.
 */

import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

// Resolve from the consuming project's directory (cwd), not from this script
const require = createRequire(resolve(process.cwd(), 'package.json'));

// ─── Resolve drizzle-kit/api.js ─────────────────────────────────────────────
let apiPath;
try {
  apiPath = require.resolve('drizzle-kit/api');
} catch {
  console.log('[drizzle-liquibase] drizzle-kit not found, nothing to unpatch.');
  process.exit(0);
}

// ─── Restore from backup ────────────────────────────────────────────────────
const backupPath = apiPath + '.backup';

if (!existsSync(backupPath)) {
  console.log('[drizzle-liquibase] No backup found — drizzle-kit/api.js was not patched or backup was removed.');
  process.exit(0);
}

try {
  copyFileSync(backupPath, apiPath);
  unlinkSync(backupPath);
  console.log('[drizzle-liquibase] ✅ Restored original drizzle-kit/api.js from backup.');
} catch (err) {
  console.log(`[drizzle-liquibase] Could not restore backup: ${err.message}`);
  process.exit(0); // non-fatal — don't block uninstall
}
