/**
 * Test 04 — Migration File & Master Changelog
 *
 * Verifies that SchemaDiffGenerator can:
 *   - generateMigrationFile() with Liquibase-formatted SQL header
 *   - include changeset, rollback, and statement-breakpoint markers
 *   - use the configured author
 *   - write to the correct directory
 *   - addToMasterChangelog() creates the XML if missing
 *   - addToMasterChangelog() appends new includes sorted by timestamp
 *   - addToMasterChangelog() skips duplicates
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SchemaDiffGenerator } from '../src/generate.mjs';
import { suite, assert, eq, includes, gt, summary } from './helpers.mjs';

// Create a temp workspace for each run
const tmpBase = join(tmpdir(), `dml-test04-${Date.now()}`);
const migrationsDir = join(tmpBase, 'migrations');
const changelogPath = join(tmpBase, 'master-changelog.xml');
mkdirSync(migrationsDir, { recursive: true });

function makeGenerator(author = 'test-user') {
  const gen = new SchemaDiffGenerator({
    config: {
      schemaDir: '/tmp',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author,
      diff: {},
    },
  });
  gen.config = gen._configOverride;
  gen.options = { ...gen.config.diff };
  // Set instance fields that init() normally populates
  gen.migrationsDir = migrationsDir;
  return gen;
}

// ─── generateMigrationFile ──────────────────────────────────────

suite('generateMigrationFile — basic output');
{
  const gen = makeGenerator('alice');
  const statements = [
    'CREATE TABLE IF NOT EXISTS "widgets" (\n  "id" SERIAL\n);',
    'CREATE INDEX IF NOT EXISTS "widgets_name_idx" ON "widgets" USING BTREE ("name");',
  ];
  const rollbackStatements = [
    'DROP TABLE IF EXISTS "widgets";',
    'DROP INDEX IF EXISTS "widgets_name_idx";',
  ];

  const filepath = gen.generateMigrationFile(statements, rollbackStatements);

  assert(existsSync(filepath), 'file exists');
  assert(filepath.endsWith('.sql'), 'ends with .sql');
  assert(filepath.includes(migrationsDir), 'in migrations dir');

  const content = readFileSync(filepath, 'utf-8');
  includes(content, '--liquibase formatted sql', 'liquibase header');
  includes(content, '--changeset alice:', 'changeset with author');
  includes(content, 'splitStatements:false', 'splitStatements:false');
  includes(content, 'endDelimiter:--> statement-breakpoint', 'endDelimiter');
  includes(content, 'CREATE TABLE IF NOT EXISTS "widgets"', 'SQL statement');
  includes(content, '--> statement-breakpoint', 'breakpoint marker');
  includes(content, '--rollback DROP TABLE IF EXISTS "widgets"', 'rollback');
  includes(content, '--rollback DROP INDEX IF EXISTS "widgets_name_idx"', 'rollback 2');
}

suite('generateMigrationFile — custom migration name');
{
  const gen = makeGenerator();
  gen.customName = 'add_widgets_table';
  const filepath = gen.generateMigrationFile(
    ['CREATE TABLE "foo" ();'],
    ['DROP TABLE "foo";']
  );
  assert(filepath.includes('add_widgets_table'), 'custom name in filename');
  assert(filepath.endsWith('.sql'), 'still .sql');
  gen.customName = null; // reset
}

suite('generateMigrationFile — timestamp in filename');
{
  const gen = makeGenerator();
  const filepath = gen.generateMigrationFile(
    ['SELECT 1;'],
    ['SELECT 1;']
  );
  const filename = filepath.split('/').pop();
  const match = filename.match(/^(\d{14})_/);
  assert(match !== null, 'filename starts with 14-digit timestamp');
}

// ─── addToMasterChangelog ───────────────────────────────────────

suite('addToMasterChangelog — creates XML from scratch');
{
  // Delete the changelog so it creates fresh
  if (existsSync(changelogPath)) rmSync(changelogPath);
  const gen = makeGenerator();
  gen.addToMasterChangelog('20250701000000_first.sql');

  assert(existsSync(changelogPath), 'changelog created');
  const xml = readFileSync(changelogPath, 'utf-8');
  includes(xml, '<?xml version="1.0"', 'XML header');
  includes(xml, '<databaseChangeLog', 'root element');
  includes(xml, '<include file="migrations/20250701000000_first.sql"/>', 'first include');
}

suite('addToMasterChangelog — appends sorted');
{
  const gen = makeGenerator();
  gen.addToMasterChangelog('20250702000000_second.sql');
  gen.addToMasterChangelog('20250701120000_middle.sql');

  const xml = readFileSync(changelogPath, 'utf-8');
  const includeLines = xml.match(/<include\s+file="[^"]+"\s*\/>/g) || [];
  eq(includeLines.length, 3, '3 includes');

  // They should be sorted by timestamp
  const files = includeLines.map((l) => l.match(/file="migrations\/([^"]+)"/)[1]);
  assert(files[0].startsWith('20250701000000'), 'first sorted');
  assert(files[1].startsWith('20250701120000'), 'middle sorted');
  assert(files[2].startsWith('20250702000000'), 'last sorted');
}

suite('addToMasterChangelog — deduplicates');
{
  const gen = makeGenerator();
  gen.addToMasterChangelog('20250701000000_first.sql');
  const xml = readFileSync(changelogPath, 'utf-8');
  const count = (xml.match(/20250701000000_first\.sql/g) || []).length;
  eq(count, 1, 'no duplicates');
}

// ─── Cleanup ────────────────────────────────────────────────────

suite('cleanup temp files');
try {
  rmSync(tmpBase, { recursive: true, force: true });
  assert(true, 'cleaned up');
} catch {
  assert(true, 'cleanup skipped (non-fatal)');
}

summary();
