#!/usr/bin/env node

/**
 * Run all tests in order and report aggregate results.
 *
 * Usage:
 *   node test/run-all.mjs          — run all suites
 *   node test/run-all.mjs 01 03    — run only suites 01 and 03
 *   node test/run-all.mjs ast      — run suites matching "ast"
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALL_SUITES = [
  { file: 'ast-parser.test.mjs', label: 'AST Parser (inline schemas)' },
  { file: '01-ast-parser.test.mjs', label: 'AST Parser (real schemas)' },
  { file: '02-schema-comparison.test.mjs', label: 'Schema Comparison' },
  { file: '03-sql-generation.test.mjs', label: 'SQL Generation' },
  { file: '04-migration-file.test.mjs', label: 'Migration File & Changelog' },
  { file: '05-config.test.mjs', label: 'Config Loader & Helpers' },
  { file: '06-type-mappings.test.mjs', label: 'Data Type Mappings' },
];

// Allow filtering by suite number prefix or keyword
const args = process.argv.slice(2);
const suites = args.length
  ? ALL_SUITES.filter((s) =>
      args.some((a) => s.file.startsWith(a) || s.file.includes(a))
    )
  : ALL_SUITES;

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║         drizzle-migrations-liquibase test suite         ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log();

let totalPassed = 0;
let totalFailed = 0;
const results = [];

for (const { file, label } of suites) {
  const path = join(__dirname, file);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶ ${label}  (${file})`);
  console.log('═'.repeat(60));

  try {
    const output = execSync(`node "${path}"`, {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    process.stdout.write(output);

    // Parse passed/failed from the summary line
    const match = output.match(/(\d+) passed.*?(\d+) failed/);
    if (match) {
      const p = parseInt(match[1], 10);
      const f = parseInt(match[2], 10);
      totalPassed += p;
      totalFailed += f;
      results.push({ label, passed: p, failed: f, error: null });
    } else {
      results.push({ label, passed: '?', failed: '?', error: null });
    }
  } catch (err) {
    // Print stdout + stderr even on failure
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    totalFailed++;
    results.push({ label, passed: 0, failed: 1, error: err.message?.split('\n')[0] });
  }
}

// ─── Aggregate ──────────────────────────────────────────────────

console.log('\n');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║                    AGGREGATE RESULTS                    ║');
console.log('╠══════════════════════════════════════════════════════════╣');
for (const r of results) {
  const icon = r.failed === 0 && !r.error ? '✅' : '❌';
  const stats = r.error
    ? `ERROR: ${r.error.substring(0, 40)}`
    : `${r.passed} passed, ${r.failed} failed`;
  console.log(`║  ${icon} ${r.label.padEnd(35)} ${stats.padEnd(19)} ║`);
}
console.log('╠══════════════════════════════════════════════════════════╣');
const overall = totalFailed === 0 ? '✅ ALL PASSED' : `❌ ${totalFailed} FAILURES`;
console.log(`║  Total: ${totalPassed} passed, ${totalFailed} failed — ${overall.padEnd(27)} ║`);
console.log('╚══════════════════════════════════════════════════════════╝');

process.exit(totalFailed > 0 ? 1 : 0);
