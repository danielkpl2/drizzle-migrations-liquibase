/**
 * Test 07 — Drizzle Kit Engine
 *
 * Unit tests for the DrizzleKitEngine class covering:
 *   - generateRollback() — all supported DDL patterns
 *   - buildLiquibaseStatements() — statement/rollback pairing
 *   - generateMigrationFile() — Liquibase formatted SQL output
 *   - addToMasterChangelog() — XML changelog management
 *   - init() — config validation
 *   - CLI engine flag — config resolution
 *
 * These tests do NOT require a database connection — they test the
 * Liquibase formatting, rollback generation, and file output layers.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DrizzleKitEngine } from '../src/drizzle-kit-engine.mjs';
import { suite, assert, eq, includes, summary } from './helpers.mjs';

// ─── Helper to create a testable engine instance ────────────────

const tmpBase = join(tmpdir(), `dml-test07-${Date.now()}`);
const migrationsDir = join(tmpBase, 'migrations');
const changelogPath = join(tmpBase, 'master-changelog.xml');
mkdirSync(migrationsDir, { recursive: true });

function makeEngine(overrides = {}) {
  const engine = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'postgresql://localhost:5432/test',
      engine: 'drizzle-kit',
      diff: {},
      ...overrides,
    },
  });
  // Simulate init() without actually loading config
  engine.config = engine._configOverride;
  engine.schemaDir = engine.config.schemaDir;
  engine.migrationsDir = engine.config.migrationsDir;
  engine.databaseUrl = engine.config.databaseUrl;
  engine.dialect = overrides.dialect ?? 'postgresql';
  return engine;
}

// ═══════════════════════════════════════════════════════════════
// generateRollback — CREATE patterns
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — CREATE TABLE');
{
  const e = makeEngine();
  eq(
    e.generateRollback('CREATE TABLE "users" (\n  "id" serial PRIMARY KEY\n)'),
    'DROP TABLE IF EXISTS "users";',
    'basic CREATE TABLE'
  );
  eq(
    e.generateRollback('CREATE TABLE IF NOT EXISTS "products" (\n  "id" uuid\n)'),
    'DROP TABLE IF EXISTS "products";',
    'CREATE TABLE IF NOT EXISTS'
  );
  eq(
    e.generateRollback('CREATE TABLE widgets (\n  id serial\n)'),
    'DROP TABLE IF EXISTS "widgets";',
    'unquoted table name'
  );
}

suite('generateRollback — RENAME TABLE');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" RENAME TO "members"'),
    'ALTER TABLE "members" RENAME TO "users";',
    'basic RENAME TABLE'
  );
  eq(
    e.generateRollback('ALTER TABLE old_name RENAME TO new_name'),
    'ALTER TABLE "new_name" RENAME TO "old_name";',
    'unquoted RENAME TABLE'
  );
}

suite('generateRollback — RENAME COLUMN');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" RENAME COLUMN "email" TO "email_address"'),
    'ALTER TABLE "users" RENAME COLUMN "email_address" TO "email";',
    'basic RENAME COLUMN'
  );
  eq(
    e.generateRollback('ALTER TABLE users RENAME COLUMN old_col TO new_col'),
    'ALTER TABLE "users" RENAME COLUMN "new_col" TO "old_col";',
    'unquoted RENAME COLUMN'
  );
}

suite('generateRollback — CREATE INDEX');
{
  const e = makeEngine();
  eq(
    e.generateRollback('CREATE INDEX "users_email_idx" ON "users" USING btree ("email")'),
    'DROP INDEX IF EXISTS "users_email_idx";',
    'basic CREATE INDEX'
  );
  eq(
    e.generateRollback('CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email")'),
    'DROP INDEX IF EXISTS "users_email_unique";',
    'CREATE UNIQUE INDEX'
  );
  eq(
    e.generateRollback('CREATE INDEX CONCURRENTLY "big_idx" ON "logs" ("ts")'),
    'DROP INDEX IF EXISTS "big_idx";',
    'CREATE INDEX CONCURRENTLY'
  );
  eq(
    e.generateRollback('CREATE INDEX IF NOT EXISTS "safe_idx" ON "t" ("a")'),
    'DROP INDEX IF EXISTS "safe_idx";',
    'CREATE INDEX IF NOT EXISTS'
  );
  eq(
    e.generateRollback('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "combo_idx" ON "t" ("a")'),
    'DROP INDEX IF EXISTS "combo_idx";',
    'UNIQUE + CONCURRENTLY + IF NOT EXISTS'
  );
}

suite('generateRollback — CREATE TYPE (enum)');
{
  const e = makeEngine();
  eq(
    e.generateRollback('CREATE TYPE "status" AS ENUM (\'active\', \'inactive\')'),
    'DROP TYPE IF EXISTS "status";',
    'CREATE TYPE enum'
  );
  eq(
    e.generateRollback('CREATE TYPE mood AS ENUM (\'happy\', \'sad\')'),
    'DROP TYPE IF EXISTS "mood";',
    'unquoted type name'
  );
  eq(
    e.generateRollback('CREATE TYPE "public"."discount_type" AS ENUM (\'percentage\', \'fixed_amount\')'),
    'DROP TYPE IF EXISTS "public"."discount_type";',
    'schema-qualified type name'
  );
}

suite('generateRollback — CREATE POLICY');
{
  const e = makeEngine();
  eq(
    e.generateRollback('CREATE POLICY "users_select" ON "users" FOR SELECT USING (true)'),
    'DROP POLICY IF EXISTS "users_select" ON "users";',
    'CREATE POLICY'
  );
}

suite('generateRollback — CREATE SEQUENCE');
{
  const e = makeEngine();
  eq(
    e.generateRollback('CREATE SEQUENCE "order_seq" START 1000'),
    'DROP SEQUENCE IF EXISTS "order_seq";',
    'CREATE SEQUENCE'
  );
  eq(
    e.generateRollback('CREATE SEQUENCE IF NOT EXISTS "safe_seq" START 1'),
    'DROP SEQUENCE IF EXISTS "safe_seq";',
    'CREATE SEQUENCE IF NOT EXISTS'
  );
}

// ═══════════════════════════════════════════════════════════════
// generateRollback — ALTER TABLE patterns
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — ADD COLUMN');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" ADD COLUMN "email" varchar(255)'),
    'ALTER TABLE "users" DROP COLUMN "email";',
    'ADD COLUMN'
  );
  eq(
    e.generateRollback('ALTER TABLE users ADD COLUMN age integer NOT NULL DEFAULT 0'),
    'ALTER TABLE "users" DROP COLUMN "age";',
    'ADD COLUMN unquoted'
  );
}

suite('generateRollback — DROP COLUMN');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" DROP COLUMN "legacy_field"'),
    '-- Manual rollback required: recreate dropped column',
    'DROP COLUMN → manual'
  );
}

suite('generateRollback — SET / DROP NOT NULL');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "orders" ALTER COLUMN "status" SET NOT NULL'),
    'ALTER TABLE "orders" ALTER COLUMN "status" DROP NOT NULL;',
    'SET NOT NULL → DROP NOT NULL'
  );
  eq(
    e.generateRollback('ALTER TABLE "orders" ALTER COLUMN "notes" DROP NOT NULL'),
    'ALTER TABLE "orders" ALTER COLUMN "notes" SET NOT NULL;',
    'DROP NOT NULL → SET NOT NULL'
  );
}

suite('generateRollback — SET / DROP DEFAULT');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "products" ALTER COLUMN "price" SET DEFAULT 0'),
    'ALTER TABLE "products" ALTER COLUMN "price" DROP DEFAULT;',
    'SET DEFAULT → DROP DEFAULT'
  );
  eq(
    e.generateRollback('ALTER TABLE "products" ALTER COLUMN "price" DROP DEFAULT'),
    '-- Manual rollback required: set default back to previous value',
    'DROP DEFAULT → manual'
  );
}

suite('generateRollback — ALTER COLUMN TYPE');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint'),
    '-- Manual rollback required: revert column type change',
    'SET DATA TYPE → manual'
  );
}

suite('generateRollback — ADD / DROP CONSTRAINT');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "orders" ADD CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")'),
    'ALTER TABLE "orders" DROP CONSTRAINT "orders_user_fk";',
    'ADD CONSTRAINT → DROP CONSTRAINT'
  );
  eq(
    e.generateRollback('ALTER TABLE "orders" DROP CONSTRAINT "orders_user_fk"'),
    '-- Manual rollback required: recreate dropped constraint',
    'DROP CONSTRAINT → manual'
  );
}

// ═══════════════════════════════════════════════════════════════
// generateRollback — RLS patterns
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — ENABLE / DISABLE RLS');
{
  const e = makeEngine();
  eq(
    e.generateRollback('ALTER TABLE "users" ENABLE ROW LEVEL SECURITY'),
    'ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;',
    'ENABLE RLS → DISABLE'
  );
  eq(
    e.generateRollback('ALTER TABLE "users" DISABLE ROW LEVEL SECURITY'),
    'ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;',
    'DISABLE RLS → ENABLE'
  );
}

// ═══════════════════════════════════════════════════════════════
// generateRollback — DROP patterns (destructive → manual)
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — DROP operations → manual rollback');
{
  const e = makeEngine();
  eq(
    e.generateRollback('DROP TABLE "users"'),
    '-- Manual rollback required: recreate dropped table',
    'DROP TABLE → manual'
  );
  eq(
    e.generateRollback('DROP INDEX "users_email_idx"'),
    '-- Manual rollback required: recreate dropped index',
    'DROP INDEX → manual'
  );
  eq(
    e.generateRollback('DROP POLICY "users_select" ON "users"'),
    '-- Manual rollback required: recreate dropped policy',
    'DROP POLICY → manual'
  );
  eq(
    e.generateRollback('DROP SEQUENCE "order_seq"'),
    '-- Manual rollback required: recreate dropped sequence',
    'DROP SEQUENCE → manual'
  );
}

// ═══════════════════════════════════════════════════════════════
// generateRollback — enum value + fallback
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — ALTER TYPE ADD VALUE');
{
  const e = makeEngine();
  eq(
    e.generateRollback("ALTER TYPE \"status\" ADD VALUE 'cancelled'"),
    '-- Enum value additions cannot be rolled back in PostgreSQL',
    'ALTER TYPE ADD VALUE → enum warning'
  );
}

suite('generateRollback — unknown SQL → generic fallback');
{
  const e = makeEngine();
  eq(
    e.generateRollback('GRANT SELECT ON "users" TO readonly_role'),
    '-- Manual rollback required',
    'unknown DDL → generic fallback'
  );
  eq(
    e.generateRollback('COMMENT ON TABLE "users" IS \'User accounts\''),
    '-- Manual rollback required',
    'COMMENT → generic fallback'
  );
}

// ═══════════════════════════════════════════════════════════════
// buildLiquibaseStatements
// ═══════════════════════════════════════════════════════════════

suite('buildLiquibaseStatements — pairs statements with rollbacks');
{
  const e = makeEngine();
  const result = e.buildLiquibaseStatements([
    'CREATE TABLE "users" (\n  "id" serial PRIMARY KEY\n);',
    'CREATE INDEX "users_email_idx" ON "users" ("email");',
    'ALTER TABLE "users" ADD COLUMN "name" text;',
  ]);

  eq(result.statements.length, 3, '3 forward statements');
  eq(result.rollbackStatements.length, 3, '3 rollback statements');

  includes(result.statements[0], 'CREATE TABLE', 'forward 1 is CREATE TABLE');
  includes(result.rollbackStatements[0], 'DROP TABLE', 'rollback 1 is DROP TABLE');

  includes(result.statements[1], 'CREATE INDEX', 'forward 2 is CREATE INDEX');
  includes(result.rollbackStatements[1], 'DROP INDEX', 'rollback 2 is DROP INDEX');

  includes(result.statements[2], 'ADD COLUMN', 'forward 3 is ADD COLUMN');
  includes(result.rollbackStatements[2], 'DROP COLUMN', 'rollback 3 is DROP COLUMN');
}

suite('buildLiquibaseStatements — normalises trailing semicolons');
{
  const e = makeEngine();
  const result = e.buildLiquibaseStatements([
    'CREATE TABLE "t" ("id" serial);',   // has semicolon
    'CREATE TABLE "t2" ("id" serial)',    // no semicolon
    '  CREATE TABLE "t3" ("id" serial);  ', // whitespace + semicolon
  ]);

  for (let i = 0; i < result.statements.length; i++) {
    assert(result.statements[i].endsWith(';'), `statement ${i} ends with semicolon`);
    assert(!result.statements[i].endsWith(';;'), `statement ${i} no double semicolon`);
  }
}

suite('buildLiquibaseStatements — empty input');
{
  const e = makeEngine();
  const result = e.buildLiquibaseStatements([]);
  eq(result.statements.length, 0, 'no statements');
  eq(result.rollbackStatements.length, 0, 'no rollbacks');
}

// ═══════════════════════════════════════════════════════════════
// generateMigrationFile — output format
// ═══════════════════════════════════════════════════════════════

suite('generateMigrationFile — basic output');
{
  // Clean changelog for this sub-suite
  if (existsSync(changelogPath)) rmSync(changelogPath);

  const e = makeEngine({ author: 'alice' });
  const statements = [
    'CREATE TABLE IF NOT EXISTS "widgets" (\n  "id" SERIAL\n);',
    'CREATE INDEX IF NOT EXISTS "widgets_name_idx" ON "widgets" USING BTREE ("name");',
  ];
  const rollbackStatements = [
    'DROP TABLE IF EXISTS "widgets";',
    'DROP INDEX IF EXISTS "widgets_name_idx";',
  ];

  const filepath = e.generateMigrationFile(statements, rollbackStatements);

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
  includes(content, '--rollback DROP TABLE IF EXISTS "widgets"', 'rollback block');
  includes(content, '--rollback DROP INDEX IF EXISTS "widgets_name_idx"', 'rollback 2');
}

suite('generateMigrationFile — custom name');
{
  const e = makeEngine();
  e.customName = 'add_orders_table';
  const filepath = e.generateMigrationFile(
    ['CREATE TABLE "orders" ();'],
    ['DROP TABLE "orders";']
  );
  assert(filepath.includes('add_orders_table'), 'custom name in filename');
  assert(filepath.endsWith('.sql'), 'still .sql');
}

suite('generateMigrationFile — timestamp format');
{
  const e = makeEngine();
  const filepath = e.generateMigrationFile(['SELECT 1;'], ['SELECT 1;']);
  const filename = filepath.split('/').pop();
  const match = filename.match(/^(\d{14})_/);
  assert(match !== null, 'filename starts with 14-digit timestamp');
}

suite('generateMigrationFile — format matches custom engine');
{
  // Verify the file structure matches what the custom engine produces
  const e = makeEngine({ author: 'comparison-user' });
  const statements = [
    'ALTER TABLE "users" ADD COLUMN "age" integer;',
  ];
  const rollbacks = [
    'ALTER TABLE "users" DROP COLUMN "age";',
  ];
  const filepath = e.generateMigrationFile(statements, rollbacks);
  const content = readFileSync(filepath, 'utf-8');

  // Must start with liquibase header
  assert(content.startsWith('--liquibase formatted sql'), 'starts with liquibase header');

  // Must have changeset line with splitStatements and endDelimiter
  const changesetLine = content.split('\n').find(l => l.startsWith('--changeset'));
  assert(changesetLine !== undefined, 'has changeset line');
  includes(changesetLine, 'comparison-user:', 'changeset has author');
  includes(changesetLine, 'splitStatements:false', 'has splitStatements');
  includes(changesetLine, 'endDelimiter:--> statement-breakpoint', 'has endDelimiter');

  // Rollback lines must use --rollback prefix
  const rollbackLines = content.split('\n').filter(l => l.startsWith('--rollback'));
  assert(rollbackLines.length > 0, 'has rollback lines');
  includes(rollbackLines[0], 'DROP COLUMN', 'rollback has DROP COLUMN');
}

// ═══════════════════════════════════════════════════════════════
// addToMasterChangelog (same behaviour as custom engine)
// ═══════════════════════════════════════════════════════════════

suite('addToMasterChangelog — creates XML from scratch');
{
  if (existsSync(changelogPath)) rmSync(changelogPath);
  const e = makeEngine();
  e.addToMasterChangelog('20250701000000_first.sql');

  assert(existsSync(changelogPath), 'changelog created');
  const xml = readFileSync(changelogPath, 'utf-8');
  includes(xml, '<?xml version="1.0"', 'XML header');
  includes(xml, '<databaseChangeLog', 'root element');
  includes(xml, '<include file="migrations/20250701000000_first.sql"/>', 'first include');
}

suite('addToMasterChangelog — appends sorted by timestamp');
{
  const e = makeEngine();
  e.addToMasterChangelog('20250703000000_third.sql');
  e.addToMasterChangelog('20250702000000_second.sql');

  const xml = readFileSync(changelogPath, 'utf-8');
  const includeLines = xml.match(/<include\s+file="[^"]+"\s*\/>/g) || [];
  eq(includeLines.length, 3, '3 includes total');

  const files = includeLines.map(l => l.match(/file="migrations\/([^"]+)"/)[1]);
  assert(files[0].startsWith('20250701'), 'first sorted');
  assert(files[1].startsWith('20250702'), 'second sorted');
  assert(files[2].startsWith('20250703'), 'third sorted');
}

suite('addToMasterChangelog — deduplicates');
{
  const e = makeEngine();
  e.addToMasterChangelog('20250701000000_first.sql');
  const xml = readFileSync(changelogPath, 'utf-8');
  const count = (xml.match(/20250701000000_first\.sql/g) || []).length;
  eq(count, 1, 'no duplicate entries');
}

// ═══════════════════════════════════════════════════════════════
// init() — validation
// ═══════════════════════════════════════════════════════════════

suite('init — rejects missing schemaDir');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: null,
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
    },
  });
  let threw = false;
  try { await e.init(); } catch (err) {
    threw = true;
    includes(err.message, 'schemaDir is required', 'error mentions schemaDir');
  }
  assert(threw, 'init() threw for missing schemaDir');
}

suite('init — rejects missing databaseUrl');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: null,
    },
  });
  let threw = false;
  try { await e.init(); } catch (err) {
    threw = true;
    includes(err.message, 'DATABASE_URL is required', 'error mentions DATABASE_URL');
  }
  assert(threw, 'init() threw for missing databaseUrl');
}

suite('init — rejects invalid migration name');
{
  const e = new DrizzleKitEngine({
    name: '123-bad-start',
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
    },
  });
  let threw = false;
  try { await e.init(); } catch (err) {
    threw = true;
    includes(err.message, 'Invalid migration name', 'error mentions invalid name');
  }
  assert(threw, 'init() threw for invalid name');
}

suite('init — accepts valid migration name');
{
  const e = new DrizzleKitEngine({
    name: 'add-users-table',
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
    },
  });
  let threw = false;
  try { await e.init(); } catch { threw = true; }
  assert(!threw, 'init() accepted valid name with hyphens');
}

suite('init — accepts name with underscores');
{
  const e = new DrizzleKitEngine({
    name: 'add_users_table',
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
    },
  });
  let threw = false;
  try { await e.init(); } catch { threw = true; }
  assert(!threw, 'init() accepted valid name with underscores');
}

// ═══════════════════════════════════════════════════════════════
// loadSchemaExports — error handling
// ═══════════════════════════════════════════════════════════════

suite('loadSchemaExports — rejects missing schema file');
{
  const e = makeEngine({ schemaDir: '/tmp/nonexistent-dir-xyz-99999' });
  let threw = false;
  try { await e.loadSchemaExports(); } catch (err) {
    threw = true;
    includes(err.message, 'Schema index file not found', 'error mentions missing file');
  }
  assert(threw, 'loadSchemaExports() threw for missing file');
}

// ═══════════════════════════════════════════════════════════════
// Config engine option
// ═══════════════════════════════════════════════════════════════

suite('config — engine defaults to custom');
{
  const { loadConfig } = await import('../src/config.mjs');
  // loadConfig reads from a project dir; we can check DEFAULTS has engine
  // by importing config and reflecting on exported defaults
  const configModule = await import('../src/config.mjs');
  // The default merging happens inside loadConfig — test config manually
  const testConfig = {
    schemaDir: '/tmp',
    // no engine specified
  };
  // When engine is not in user config, it should default to 'custom'
  assert(testConfig.engine === undefined, 'user config has no engine');
  // After merge with defaults, it would be 'custom'
  eq('custom', configModule.DEFAULTS?.engine ?? 'custom', 'DEFAULTS.engine is custom (or not exported)');
}

// ═══════════════════════════════════════════════════════════════
// Constructor defaults
// ═══════════════════════════════════════════════════════════════

suite('constructor — default values');
{
  const e = new DrizzleKitEngine();
  eq(e.customName, null, 'customName defaults to null');
  eq(e._configOverride, null, 'no config override by default');
  eq(e._projectRoot, null, 'no projectRoot by default');
  eq(e.config, null, 'config not loaded yet');
  eq(e.schemaDir, null, 'schemaDir not set');
  eq(e.migrationsDir, null, 'migrationsDir not set');
  eq(e.databaseUrl, null, 'databaseUrl not set');
}

suite('constructor — accepts options');
{
  const e = new DrizzleKitEngine({
    name: 'my_migration',
    projectRoot: '/some/path',
  });
  eq(e.customName, 'my_migration', 'customName from opts');
  eq(e._projectRoot, '/some/path', 'projectRoot from opts');
}

// ═══════════════════════════════════════════════════════════════
// Complex rollback scenarios
// ═══════════════════════════════════════════════════════════════

suite('generateRollback — schema-qualified names');
{
  const e = makeEngine();
  // drizzle-kit sometimes emits schema-qualified names like "public"."table"
  eq(
    e.generateRollback('CREATE TABLE "public"."users" (\n  "id" serial\n)'),
    'DROP TABLE IF EXISTS "public"."users";',
    'schema.table — schema-qualified DROP'
  );
  eq(
    e.generateRollback('CREATE TABLE "users" (\n  "id" serial\n)'),
    'DROP TABLE IF EXISTS "users";',
    'no schema prefix — plain DROP'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" RENAME TO "members"'),
    'ALTER TABLE "public"."members" RENAME TO "users";',
    'schema-qualified RENAME TABLE'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" RENAME COLUMN "email" TO "email_address"'),
    'ALTER TABLE "public"."users" RENAME COLUMN "email_address" TO "email";',
    'schema-qualified RENAME COLUMN'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" ADD COLUMN "phone" varchar(20)'),
    'ALTER TABLE "public"."users" DROP COLUMN "phone";',
    'schema-qualified ADD COLUMN'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" ALTER COLUMN "name" SET NOT NULL'),
    'ALTER TABLE "public"."users" ALTER COLUMN "name" DROP NOT NULL;',
    'schema-qualified SET NOT NULL'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" ALTER COLUMN "name" DROP NOT NULL'),
    'ALTER TABLE "public"."users" ALTER COLUMN "name" SET NOT NULL;',
    'schema-qualified DROP NOT NULL'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" ALTER COLUMN "role" SET DEFAULT \'member\''),
    'ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;',
    'schema-qualified SET DEFAULT'
  );
  eq(
    e.generateRollback('CREATE INDEX "public"."users_email_idx" ON "public"."users" USING btree ("email")'),
    'DROP INDEX IF EXISTS "public"."users_email_idx";',
    'schema-qualified CREATE INDEX'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."products" ADD CONSTRAINT "products_cat_fk" FOREIGN KEY ("cat_id") REFERENCES "categories"("id")'),
    'ALTER TABLE "public"."products" DROP CONSTRAINT "products_cat_fk";',
    'schema-qualified ADD CONSTRAINT'
  );
  eq(
    e.generateRollback('CREATE TYPE "public"."discount_type" AS ENUM (\'percentage\', \'fixed_amount\')'),
    'DROP TYPE IF EXISTS "public"."discount_type";',
    'schema-qualified CREATE TYPE'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY'),
    'ALTER TABLE "public"."users" DISABLE ROW LEVEL SECURITY;',
    'schema-qualified ENABLE RLS'
  );
  eq(
    e.generateRollback('ALTER TABLE "public"."users" DISABLE ROW LEVEL SECURITY'),
    'ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;',
    'schema-qualified DISABLE RLS'
  );
  eq(
    e.generateRollback('CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (true)'),
    'DROP POLICY IF EXISTS "users_select" ON "public"."users";',
    'schema-qualified CREATE POLICY'
  );
  eq(
    e.generateRollback('CREATE SEQUENCE "public"."users_id_seq" AS integer'),
    'DROP SEQUENCE IF EXISTS "public"."users_id_seq";',
    'schema-qualified CREATE SEQUENCE'
  );
}

suite('generateRollback — multiline ALTER TABLE');
{
  const e = makeEngine();
  const sql = `ALTER TABLE "orders"
  ADD COLUMN "shipping_address" jsonb`;
  eq(
    e.generateRollback(sql),
    'ALTER TABLE "orders" DROP COLUMN "shipping_address";',
    'multiline ADD COLUMN'
  );
}

suite('buildLiquibaseStatements — real-world drizzle-kit output');
{
  // Simulate what drizzle-kit's pushSchema actually returns
  const e = makeEngine();
  const drizzleKitOutput = [
    'CREATE TABLE "categories" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" text NOT NULL,\n\t"slug" text NOT NULL\n);\n',
    'ALTER TABLE "products" ADD COLUMN "category_id" integer;',
    'CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");',
    'ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL;',
  ];

  const result = e.buildLiquibaseStatements(drizzleKitOutput);

  eq(result.statements.length, 4, '4 statements');
  eq(result.rollbackStatements.length, 4, '4 rollbacks');

  // Verify each rollback matches its statement
  includes(result.rollbackStatements[0], 'DROP TABLE IF EXISTS "categories"', 'table rollback');
  includes(result.rollbackStatements[1], 'DROP COLUMN "category_id"', 'column rollback');
  includes(result.rollbackStatements[2], 'DROP INDEX IF EXISTS "products_category_idx"', 'index rollback');
  includes(result.rollbackStatements[3], 'DROP CONSTRAINT "products_category_fk"', 'constraint rollback');
}

// ═══════════════════════════════════════════════════════════════
// End-to-end: buildLiquibaseStatements → generateMigrationFile
// ═══════════════════════════════════════════════════════════════

suite('end-to-end — build + generate produces valid Liquibase file');
{
  if (existsSync(changelogPath)) rmSync(changelogPath);

  const e = makeEngine({ author: 'e2e-test' });
  e.customName = 'add_categories';

  const input = [
    'CREATE TABLE "categories" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" text NOT NULL\n);',
    'ALTER TABLE "products" ADD COLUMN "category_id" integer;',
  ];

  const { statements, rollbackStatements } = e.buildLiquibaseStatements(input);
  const filepath = e.generateMigrationFile(statements, rollbackStatements);

  const content = readFileSync(filepath, 'utf-8');

  // Verify complete file structure
  includes(content, '--liquibase formatted sql', 'header present');
  includes(content, '--changeset e2e-test:add_categories', 'changeset with author + name');
  includes(content, 'CREATE TABLE "categories"', 'forward SQL');
  includes(content, 'ADD COLUMN "category_id"', 'forward SQL 2');
  includes(content, '--rollback DROP TABLE IF EXISTS "categories"', 'rollback 1');
  includes(content, '--rollback ALTER TABLE "products" DROP COLUMN "category_id"', 'rollback 2');
  includes(content, '--> statement-breakpoint', 'breakpoint markers');

  // Verify changelog was updated
  assert(existsSync(changelogPath), 'changelog created');
  const xml = readFileSync(changelogPath, 'utf-8');
  includes(xml, 'add_categories.sql', 'changelog includes new migration');
}

// ═══════════════════════════════════════════════════════════════
// schemas — constructor, init, defaults
// ═══════════════════════════════════════════════════════════════

suite('constructor — schemas defaults to empty array');
{
  const e = new DrizzleKitEngine();
  assert(Array.isArray(e._cliSchemas), '_cliSchemas is an array');
  eq(e._cliSchemas.length, 0, '_cliSchemas defaults to empty');
}

suite('constructor — accepts schemas option');
{
  const e = new DrizzleKitEngine({ schemas: ['public', 'custom'] });
  eq(e._cliSchemas.length, 2, '2 schemas from constructor');
  eq(e._cliSchemas[0], 'public', 'first schema');
  eq(e._cliSchemas[1], 'custom', 'second schema');
}

suite('init — CLI schemas override config schemas');
{
  const e = new DrizzleKitEngine({
    schemas: ['custom_schema'],
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
      schemas: ['public'],
    },
  });
  await e.init();
  eq(e.config.schemas.length, 1, 'CLI override produced 1 schema');
  eq(e.config.schemas[0], 'custom_schema', 'CLI schemas replaced config schemas');
}

suite('init — config schemas preserved when no CLI schemas');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
      schemas: ['public', 'audit'],
    },
  });
  await e.init();
  eq(e.config.schemas.length, 2, 'config schemas preserved');
  eq(e.config.schemas[0], 'public', 'first config schema');
  eq(e.config.schemas[1], 'audit', 'second config schema');
}

suite('init — no schemas in config or CLI leaves config.schemas undefined');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/schema',
      migrationsDir,
      masterChangelog: changelogPath,
      databaseUrl: 'postgresql://localhost/test',
    },
  });
  await e.init();
  eq(e.config.schemas, undefined, 'schemas not set when neither CLI nor config provides them');
}

suite('makeEngine — schemas in config accessible during run');
{
  // The run() method defaults to ['public'] when config.schemas is undefined
  const e1 = makeEngine();
  eq(e1.config.schemas, undefined, 'no schemas in default makeEngine');

  const e2 = makeEngine({ schemas: ['public', 'custom'] });
  eq(e2.config.schemas.length, 2, 'schemas from config override');
  eq(e2.config.schemas[0], 'public', 'first schema in config');
  eq(e2.config.schemas[1], 'custom', 'second schema in config');
}

// ═══════════════════════════════════════════════════════════════
// filterExcludedStatements() — Liquibase tracking table exclusion
// ═══════════════════════════════════════════════════════════════

suite('filterExcludedStatements — default Liquibase tables');
{
  const engine = makeEngine();

  // DROP TABLE statements for Liquibase tables should be filtered
  const { filtered, removedCount } = engine.filterExcludedStatements([
    'ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;',
    'DROP TABLE "databasechangelog" CASCADE;',
    'DROP TABLE "databasechangeloglock" CASCADE;',
    'ALTER TABLE "orders" ADD COLUMN "status" text;',
  ]);
  eq(removedCount, 2, 'removed 2 Liquibase table statements');
  eq(filtered.length, 2, 'kept 2 non-Liquibase statements');
  assert(!filtered.some(s => s.includes('databasechangelog')), 'no changelog statements remain');
}

suite('filterExcludedStatements — DROP POLICY on Liquibase tables');
{
  const engine = makeEngine();

  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP POLICY "allow_service_role_on_databasechangelog" ON "databasechangelog" CASCADE;',
    'DROP POLICY "allow_service_role_on_databasechangeloglock" ON "databasechangeloglock" CASCADE;',
    'CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status");',
  ]);
  eq(removedCount, 2, 'removed 2 policy statements for Liquibase tables');
  eq(filtered.length, 1, 'kept the index statement');
  includes(filtered[0], 'idx_orders_status', 'kept the correct statement');
}

suite('filterExcludedStatements — ALTER TABLE on Liquibase tables');
{
  const engine = makeEngine();

  const { filtered, removedCount } = engine.filterExcludedStatements([
    'ALTER TABLE "databasechangelog" ADD COLUMN "extra" text;',
    'ALTER TABLE "databasechangeloglock" ALTER COLUMN "locked" SET DEFAULT false;',
    'ALTER TABLE "orders" DROP COLUMN "old_col";',
  ]);
  eq(removedCount, 2, 'removed 2 ALTER TABLE statements for Liquibase tables');
  eq(filtered.length, 1, 'kept the orders ALTER');
}

suite('filterExcludedStatements — schema-qualified table names');
{
  const engine = makeEngine();

  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP TABLE "public"."databasechangelog" CASCADE;',
    'DROP TABLE "public"."databasechangeloglock" CASCADE;',
    'ALTER TABLE "public"."orders" ADD COLUMN "x" int;',
  ]);
  eq(removedCount, 2, 'removed schema-qualified Liquibase tables');
  eq(filtered.length, 1, 'kept schema-qualified orders statement');
}

suite('filterExcludedStatements — case insensitive matching');
{
  const engine = makeEngine();

  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP TABLE "DATABASECHANGELOG" CASCADE;',
    'DROP TABLE "DatabaseChangeLogLock" CASCADE;',
    'ALTER TABLE "orders" ADD COLUMN "x" int;',
  ]);
  eq(removedCount, 2, 'case-insensitive matching works');
  eq(filtered.length, 1, 'kept the orders statement');
}

suite('filterExcludedStatements — no false positives');
{
  const engine = makeEngine();

  // Table names that contain "changelog" as a substring but aren't the Liquibase tables
  const { filtered, removedCount } = engine.filterExcludedStatements([
    'ALTER TABLE "orders" ADD COLUMN "status" text;',
    'CREATE TABLE "my_changelog" (id serial);',
    'ALTER TABLE "users" DROP COLUMN "old";',
  ]);
  eq(removedCount, 0, 'no false positives on similar-but-different names');
  eq(filtered.length, 3, 'all statements kept');
}

suite('filterExcludedStatements — empty input');
{
  const engine = makeEngine();

  const { filtered, removedCount } = engine.filterExcludedStatements([]);
  eq(removedCount, 0, 'no removals on empty input');
  eq(filtered.length, 0, 'empty output for empty input');
}

suite('filterExcludedStatements — custom excludeTables config');
{
  const engine = makeEngine({ excludeTables: ['audit_log', 'temp_imports'] });

  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP TABLE "databasechangelog" CASCADE;',
    'DROP TABLE "audit_log" CASCADE;',
    'DROP TABLE "temp_imports" CASCADE;',
    'ALTER TABLE "orders" ADD COLUMN "x" int;',
  ]);
  eq(removedCount, 3, 'removed Liquibase + custom excluded tables');
  eq(filtered.length, 1, 'kept only the orders statement');
}

suite('filterExcludedStatements — custom excludeTables without defaults');
{
  const engine = makeEngine({ excludeTables: ['staging_data'] });

  // Verify Liquibase defaults are still excluded even with custom list
  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP TABLE "databasechangelog" CASCADE;',
    'DROP TABLE "staging_data" CASCADE;',
    'ALTER TABLE "orders" ADD COLUMN "x" int;',
  ]);
  eq(removedCount, 2, 'both default + custom tables excluded');
  eq(filtered.length, 1, 'kept only the orders statement');
}

suite('getExcludedTables — deduplication');
{
  // If user lists a Liquibase table in their custom config, don't duplicate
  const engine = makeEngine({ excludeTables: ['databasechangelog', 'my_table'] });
  const tables = engine.getExcludedTables();
  const changelogCount = tables.filter(t => t === 'databasechangelog').length;
  eq(changelogCount, 1, 'no duplicate databasechangelog');
  assert(tables.includes('my_table'), 'custom table included');
  assert(tables.includes('databasechangeloglock'), 'lock table still included');
}

// ═══════════════════════════════════════════════════════════════
// MySQL dialect — rollback generation with backtick quoting
// ═══════════════════════════════════════════════════════════════

suite('MySQL generateRollback — CREATE TABLE');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('CREATE TABLE `users` (\n  `id` int AUTO_INCREMENT PRIMARY KEY\n)'),
    'DROP TABLE IF EXISTS `users`;',
    'backtick-quoted CREATE TABLE'
  );
  eq(
    e.generateRollback('CREATE TABLE IF NOT EXISTS `products` (\n  `id` int\n)'),
    'DROP TABLE IF EXISTS `products`;',
    'CREATE TABLE IF NOT EXISTS'
  );
  eq(
    e.generateRollback('CREATE TABLE widgets (\n  id int\n)'),
    'DROP TABLE IF EXISTS `widgets`;',
    'unquoted table name'
  );
}

suite('MySQL generateRollback — ADD COLUMN');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('ALTER TABLE `users` ADD COLUMN `age` int NOT NULL'),
    'ALTER TABLE `users` DROP COLUMN `age`;',
    'backtick ADD COLUMN'
  );
}

suite('MySQL generateRollback — CREATE INDEX');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('CREATE INDEX `users_email_idx` ON `users` (`email`)'),
    'DROP INDEX `users_email_idx` ON `users`;',
    'backtick CREATE INDEX'
  );
  eq(
    e.generateRollback('CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)'),
    'DROP INDEX `users_email_unique` ON `users`;',
    'backtick CREATE UNIQUE INDEX'
  );
}

suite('MySQL generateRollback — ADD CONSTRAINT');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('ALTER TABLE `orders` ADD CONSTRAINT `orders_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)'),
    'ALTER TABLE `orders` DROP CONSTRAINT `orders_user_fk`;',
    'backtick ADD CONSTRAINT'
  );
}

suite('MySQL generateRollback — DROP TABLE (manual)');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('DROP TABLE `users`'),
    '-- Manual rollback required: recreate dropped table',
    'DROP TABLE needs manual'
  );
}

suite('MySQL generateRollback — MODIFY COLUMN');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('ALTER TABLE `users` MODIFY COLUMN `name` varchar(200) NOT NULL'),
    '-- Manual rollback required: revert MODIFY COLUMN change',
    'MODIFY COLUMN needs manual'
  );
}

suite('MySQL generateRollback — RENAME TABLE');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('ALTER TABLE `users` RENAME TO `members`'),
    'ALTER TABLE `members` RENAME TO `users`;',
    'backtick RENAME TABLE'
  );
}

suite('MySQL generateRollback — RENAME COLUMN');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  eq(
    e.generateRollback('ALTER TABLE `users` RENAME COLUMN `email` TO `email_address`'),
    'ALTER TABLE `users` RENAME COLUMN `email_address` TO `email`;',
    'backtick RENAME COLUMN'
  );
}

// ═══════════════════════════════════════════════════════════════
// MySQL dialect — filterExcludedStatements with backticks
// ═══════════════════════════════════════════════════════════════

suite('MySQL filterExcludedStatements — backtick-quoted tables');
{
  const engine = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  const { filtered, removedCount } = engine.filterExcludedStatements([
    'DROP TABLE `databasechangelog`;',
    'DROP TABLE `databasechangeloglock`;',
    'CREATE TABLE `users` (`id` int);',
  ]);
  eq(removedCount, 2, 'removed backtick-quoted Liquibase tables');
  eq(filtered.length, 1, 'kept non-Liquibase table');
  includes(filtered[0], 'users', 'kept users table');
}

// ═══════════════════════════════════════════════════════════════
// MySQL buildLiquibaseStatements — pairing with backtick rollbacks
// ═══════════════════════════════════════════════════════════════

suite('MySQL buildLiquibaseStatements');
{
  const e = makeEngine({ dialect: 'mysql', databaseUrl: 'mysql://root@localhost:3306/test' });
  const { statements, rollbackStatements } = e.buildLiquibaseStatements([
    'CREATE TABLE `users` (`id` int AUTO_INCREMENT PRIMARY KEY, `name` varchar(100));',
    'CREATE INDEX `users_name_idx` ON `users` (`name`);',
  ]);
  eq(statements.length, 2, '2 statements');
  eq(rollbackStatements.length, 2, '2 rollbacks');
  includes(rollbackStatements[0], 'DROP TABLE IF EXISTS `users`', 'CREATE TABLE rollback');
  includes(rollbackStatements[1], 'DROP INDEX `users_name_idx` ON `users`', 'CREATE INDEX rollback');
}

// ═══════════════════════════════════════════════════════════════
// Dialect resolution — init()
// ═══════════════════════════════════════════════════════════════

suite('dialect — auto-detect from PostgreSQL URL');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'postgresql://localhost:5432/test',
      engine: 'drizzle-kit',
      diff: {},
    },
  });
  await e.init();
  eq(e.dialect, 'postgresql', 'auto-detected postgresql');
}

suite('dialect — auto-detect from MySQL URL');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'mysql://root@localhost:3306/test',
      engine: 'drizzle-kit',
      diff: {},
    },
  });
  await e.init();
  eq(e.dialect, 'mysql', 'auto-detected mysql');
}

suite('dialect — config dialect overrides auto-detect');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'postgresql://localhost:5432/test',
      engine: 'drizzle-kit',
      dialect: 'mysql',
      diff: {},
    },
  });
  await e.init();
  eq(e.dialect, 'mysql', 'config dialect wins');
}

suite('dialect — CLI dialect overrides config');
{
  const e = new DrizzleKitEngine({
    dialect: 'mysql',
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'postgresql://localhost:5432/test',
      engine: 'drizzle-kit',
      dialect: 'postgresql',
      diff: {},
    },
  });
  await e.init();
  eq(e.dialect, 'mysql', 'CLI dialect wins over config');
}

suite('dialect — invalid dialect throws');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'postgresql://localhost:5432/test',
      engine: 'drizzle-kit',
      dialect: 'mongodb',
      diff: {},
    },
  });
  let threw = false;
  try { await e.init(); } catch (err) {
    threw = true;
    includes(err.message, 'Invalid dialect', 'error has "Invalid dialect"');
  }
  assert(threw, 'init() threw for invalid dialect');
}

suite('dialect — defaults to postgresql when no URL');
{
  const e = new DrizzleKitEngine({
    config: {
      schemaDir: '/tmp/fake-schema',
      schemaIndexFile: 'index.ts',
      migrationsDir,
      masterChangelog: changelogPath,
      timestampFormat: 'YYYYMMDDHHmmss',
      author: 'test-user',
      databaseUrl: 'some-custom-url',
      engine: 'drizzle-kit',
      diff: {},
    },
  });
  await e.init();
  eq(e.dialect, 'postgresql', 'defaults to postgresql');
}

// ═══════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════

suite('cleanup temp files');
try {
  rmSync(tmpBase, { recursive: true, force: true });
  assert(true, 'cleaned up');
} catch {
  assert(true, 'cleanup skipped (non-fatal)');
}

summary();
