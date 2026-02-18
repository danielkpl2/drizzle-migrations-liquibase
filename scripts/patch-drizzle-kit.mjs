#!/usr/bin/env node

/**
 * patch-drizzle-kit.mjs
 *
 * Patches drizzle-kit v0.31's pushMySQLSchema to fix two bugs in the **public
 * API** (`drizzle-kit/api` exports). Normal drizzle-kit CLI commands (push,
 * generate, migrate) use separate internal code paths and are NOT affected.
 *
 * Bug 1: MySQL's logSuggestionsAndReturn2 function does NOT call fromJson() to
 * convert structured statement objects to raw SQL, unlike PostgreSQL, SQLite,
 * and SingleStore versions which all do.
 *
 * Bug 2: pushMySQLSchema does NOT call filterStatements() before processing,
 * unlike the CLI code path. filterStatements filters out false-positive diffs
 * like tinyint↔boolean, bigint unsigned↔serial, and redundant serial unique keys.
 *
 * This script is idempotent — it will skip each patch individually if already
 * applied or if drizzle-kit is not installed. A backup of the original file is
 * saved alongside the patched file (*.backup) for clean restoration on uninstall.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

// Resolve from the consuming project's directory (cwd), not from this script
const require = createRequire(resolve(process.cwd(), 'package.json'));

// ─── Resolve drizzle-kit/api.js ─────────────────────────────────────────────
let apiPath;
try {
  apiPath = require.resolve('drizzle-kit/api');
} catch {
  // drizzle-kit not installed — nothing to patch
  console.log('[drizzle-liquibase] drizzle-kit not found, skipping patch.');
  process.exit(0);
}

// ─── Read the file ──────────────────────────────────────────────────────────
let source = readFileSync(apiPath, 'utf8');

// ─── Save a backup of the original (only once) ─────────────────────────────
const backupPath = apiPath + '.backup';
if (!existsSync(backupPath)) {
  copyFileSync(apiPath, backupPath);
  console.log('[drizzle-liquibase] Saved backup of original drizzle-kit/api.js.');
}

// ─── Check if drizzle-kit even has the bug ──────────────────────────────────
if (!source.includes('init_mysqlPushUtils')) {
  console.log('[drizzle-liquibase] drizzle-kit version does not have mysqlPushUtils, skipping patch.');
  process.exit(0);
}

let patchCount = 0;

// ─── Patch 1: Add fromJson call to logSuggestionsAndReturn2 ─────────────────
// MySQL's logSuggestionsAndReturn2 never converts structured statements to SQL.
// All other dialects do this. We add the missing fromJson call at the end of
// the for loop, matching the pattern used by PG, SQLite, and SingleStore.

if (source.includes('fromJson([statement], "mysql", "push")')) {
  console.log('[drizzle-liquibase] Patch 1 (fromJson): already applied.');
} else {
  const SEARCH_1 = `        }
      }
      return {
        statementsToExecute,
        shouldAskForApprove,
        infoToPrint,
        columnsToRemove: [...new Set(columnsToRemove)],
        schemasToRemove: [...new Set(schemasToRemove)],
        tablesToTruncate: [...new Set(tablesToTruncate)],
        tablesToRemove: [...new Set(tablesToRemove)]
      };
    };
  }
});

// src/cli/commands/mysqlIntrospect.ts`;

  const REPLACE_1 = `        }
        const stmnt = fromJson([statement], "mysql", "push");
        if (typeof stmnt !== "undefined") {
          statementsToExecute.push(...stmnt);
        }
      }
      return {
        statementsToExecute,
        shouldAskForApprove,
        infoToPrint,
        columnsToRemove: [...new Set(columnsToRemove)],
        schemasToRemove: [...new Set(schemasToRemove)],
        tablesToTruncate: [...new Set(tablesToTruncate)],
        tablesToRemove: [...new Set(tablesToRemove)]
      };
    };
  }
});

// src/cli/commands/mysqlIntrospect.ts`;

  if (!source.includes(SEARCH_1)) {
    console.log('[drizzle-liquibase] Patch 1 (fromJson): could not find target. Skipping.');
  } else {
    source = source.replace(SEARCH_1, REPLACE_1);
    patchCount++;
    console.log('[drizzle-liquibase] Patch 1 (fromJson): applied.');
  }
}

// ─── Patch 2: Add filterStatements call to pushMySQLSchema ──────────────────
// pushMySQLSchema passes raw `statements` directly to logSuggestionsAndReturn
// without filtering. filterStatements removes false-positive diffs:
// - tinyint(1) ↔ boolean type changes
// - bigint unsigned ↔ serial type changes
// - redundant UNIQUE KEY drops on serial columns
// - boolean default 0→false / 1→true normalization
// Without it, re-running generate on an already-applied schema produces bogus
// ALTER TABLE statements.

if (source.includes('filterStatements: filterStatements4')) {
  console.log('[drizzle-liquibase] Patch 2 (filterStatements): already applied.');
} else {
  // 2a: Import filterStatements alongside logSuggestionsAndReturn from mysqlPushUtils
  const SEARCH_2A = `  const { logSuggestionsAndReturn: logSuggestionsAndReturn4 } = await Promise.resolve().then(() => (init_mysqlPushUtils(), mysqlPushUtils_exports));`;
  const REPLACE_2A = `  const { logSuggestionsAndReturn: logSuggestionsAndReturn4, filterStatements: filterStatements4 } = await Promise.resolve().then(() => (init_mysqlPushUtils(), mysqlPushUtils_exports));`;

  // 2b: Call filterStatements before logSuggestionsAndReturn
  const SEARCH_2B = `  const { shouldAskForApprove, statementsToExecute, infoToPrint } = await logSuggestionsAndReturn4(
    db,
    statements,
    validatedCur
  );`;
  const REPLACE_2B = `  const filteredStatements = filterStatements4(statements, validatedCur, validatedPrev);
  const { shouldAskForApprove, statementsToExecute, infoToPrint } = await logSuggestionsAndReturn4(
    db,
    filteredStatements,
    validatedCur
  );`;

  if (!source.includes(SEARCH_2A)) {
    console.log('[drizzle-liquibase] Patch 2a (import filterStatements): could not find target. Skipping.');
  } else if (!source.includes(SEARCH_2B)) {
    console.log('[drizzle-liquibase] Patch 2b (call filterStatements): could not find target. Skipping.');
  } else {
    source = source.replace(SEARCH_2A, REPLACE_2A);
    source = source.replace(SEARCH_2B, REPLACE_2B);
    patchCount++;
    console.log('[drizzle-liquibase] Patch 2 (filterStatements): applied.');
  }
}

// ─── Write the patched file ─────────────────────────────────────────────────
if (patchCount > 0) {
  writeFileSync(apiPath, source, 'utf8');
  console.log(`[drizzle-liquibase] ✅ Applied ${patchCount} patch(es) to drizzle-kit MySQL push.`);
} else {
  console.log('[drizzle-liquibase] No patches needed.');
}
