/**
 * Test 03 — SQL Generation
 *
 * Feeds known change objects into SchemaDiffGenerator.generateSQL() and
 * verifies the resulting SQL statements contain:
 *   - CREATE TABLE with proper columns and escaping
 *   - ALTER TABLE ADD COLUMN / DROP COLUMN / ALTER COLUMN TYPE / SET NOT NULL
 *   - ALTER TABLE ADD FOREIGN KEY / DROP CONSTRAINT
 *   - CREATE INDEX (btree, GIN) / DROP INDEX
 *   - ALTER TABLE ADD CONSTRAINT … UNIQUE / DROP CONSTRAINT
 *   - CREATE POLICY / DROP POLICY (including modify as drop+create)
 *   - DROP TABLE
 *   - Matching rollback statements
 */

import { SchemaDiffGenerator } from '../src/generate.mjs';
import { suite, assert, eq, includes, gt, summary } from './helpers.mjs';

// Utility — create a minimal generator instance (no DB)
function makeGenerator() {
  const gen = new SchemaDiffGenerator({
    config: {
      schemaDir: '/tmp',
      migrationsDir: '/tmp/migrations',
      masterChangelog: '/tmp/cl.xml',
      diff: {
        includePolicies: true,
        modifyPolicies: true,
        dropOrphanPolicies: true,
        dropOrphanIndexes: true,
        dropOrphanUniques: true,
      },
    },
  });
  gen.config = gen._configOverride;
  gen.options = { ...gen.config.diff };
  return gen;
}

const gen = makeGenerator();

// ─── CREATE TABLE ───────────────────────────────────────────────

suite('generateSQL — CREATE TABLE');
{
  const changes = gen._emptyChanges();
  changes.tablesToCreate.push({
    name: 'widgets',
    definition: {
      columns: {
        id: { name: 'id', type: 'serial', primaryKey: true, nullable: false },
        label: { name: 'label', type: 'varchar', nullable: false, args: 'length: 100' },
        data: { name: 'data', type: 'jsonb', nullable: true },
        tags: { name: 'tags', type: 'text', nullable: true, isArray: true },
      },
    },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  gt(statements.length, 0, 'has statements');
  includes(statements[0], 'CREATE TABLE IF NOT EXISTS "widgets"', 'CREATE TABLE');
  includes(statements[0], '"id" SERIAL', 'serial column');
  includes(statements[0], '"label" VARCHAR(100)', 'varchar with length');
  includes(statements[0], '"data" JSONB', 'jsonb column');
  includes(statements[0], '"tags" TEXT[]', 'array column');
  includes(rollbackStatements[0], 'DROP TABLE IF EXISTS "widgets"', 'rollback drop');
}

// ─── ALTER TABLE — add, drop, modify columns ────────────────────

suite('generateSQL — ADD COLUMN');
{
  const changes = gen._emptyChanges();
  changes.columnsToAdd.push({
    table: 'users',
    column: 'phone',
    definition: { name: 'phone', type: 'varchar', nullable: true, args: 'length: 20' },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'ALTER TABLE "users" ADD COLUMN "phone"', 'ADD COLUMN');
  includes(statements[0], 'VARCHAR', 'type in SQL');
  includes(rollbackStatements[0], 'DROP COLUMN IF EXISTS "phone"', 'rollback drop col');
}

suite('generateSQL — DROP COLUMN');
{
  const changes = gen._emptyChanges();
  changes.columnsToDrop.push({ table: 'users', column: 'legacy_flag' });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'ALTER TABLE "users" DROP COLUMN IF EXISTS "legacy_flag"', 'DROP COLUMN');
}

suite('generateSQL — modify column type');
{
  const changes = gen._emptyChanges();
  changes.columnsToModify.push({
    kind: 'type',
    table: 'products',
    column: 'price',
    from: { type: 'varchar' },
    to: { type: 'numeric' },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'ALTER TABLE "products" ALTER COLUMN "price" TYPE NUMERIC', 'ALTER TYPE');
}

suite('generateSQL — modify column nullability');
{
  const changes = gen._emptyChanges();
  changes.columnsToModify.push({
    kind: 'nullability',
    table: 'users',
    column: 'email',
    from: { nullable: true },
    to: { nullable: false },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'SET NOT NULL', 'SET NOT NULL');
  includes(rollbackStatements[0], 'DROP NOT NULL', 'rollback');
}

// ─── FOREIGN KEYS ───────────────────────────────────────────────

suite('generateSQL — ADD FOREIGN KEY');
{
  const changes = gen._emptyChanges();
  changes.foreignKeysToAdd.push({
    table: 'orders',
    column: 'user_id',
    references: { table: 'users', column: 'id' },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users"("id")', 'FK SQL');
}

suite('generateSQL — DROP FOREIGN KEY');
{
  const changes = gen._emptyChanges();
  changes.foreignKeysToDrop.push({
    table: 'orders',
    column: 'user_id',
    constraintName: 'orders_user_id_fk',
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'DROP CONSTRAINT IF EXISTS "orders_user_id_fk"', 'DROP FK');
}

// ─── INDEXES ────────────────────────────────────────────────────

suite('generateSQL — CREATE INDEX (btree)');
{
  const changes = gen._emptyChanges();
  changes.indexesToAdd.push({
    table: 'users',
    index: { name: 'users_email_idx', columns: ['email'], method: 'btree' },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"', 'index created');
  includes(statements[0], 'USING BTREE', 'btree method');
  includes(rollbackStatements[0], 'DROP INDEX IF EXISTS "users_email_idx"', 'rollback');
}

suite('generateSQL — CREATE INDEX (GIN)');
{
  const changes = gen._emptyChanges();
  changes.indexesToAdd.push({
    table: 'products',
    index: { name: 'products_metadata_idx', columns: ['metadata'], method: 'gin' },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'USING GIN', 'gin method');
}

suite('generateSQL — DROP INDEX');
{
  const changes = gen._emptyChanges();
  changes.indexesToDrop.push({
    table: 'users',
    index: { name: 'users_legacy_idx', columns: ['name'] },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'DROP INDEX IF EXISTS "users_legacy_idx"', 'drop index');
}

// ─── UNIQUE CONSTRAINTS ─────────────────────────────────────────

suite('generateSQL — ADD UNIQUE constraint');
{
  const changes = gen._emptyChanges();
  changes.uniqueToAdd.push({
    table: 'products',
    unique: { name: 'products_sku_unique', columns: ['sku'] },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'ADD CONSTRAINT "products_sku_unique" UNIQUE ("sku")', 'unique SQL');
  includes(rollbackStatements[0], 'DROP CONSTRAINT IF EXISTS "products_sku_unique"', 'rollback');
}

suite('generateSQL — composite unique');
{
  const changes = gen._emptyChanges();
  changes.uniqueToAdd.push({
    table: 'order_items',
    unique: { name: 'order_items_oid_pid_unique', columns: ['order_id', 'product_id'] },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], '"order_id","product_id"', 'composite cols');
}

suite('generateSQL — DROP UNIQUE');
{
  const changes = gen._emptyChanges();
  changes.uniqueToDrop.push({
    table: 'products',
    unique: { name: 'products_old_unique', columns: ['name'] },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'DROP CONSTRAINT IF EXISTS "products_old_unique"', 'drop unique');
}

// ─── POLICIES ───────────────────────────────────────────────────

suite('generateSQL — CREATE POLICY');
{
  const changes = gen._emptyChanges();
  changes.policiesToAdd.push({
    table: 'reviews',
    policy: {
      name: 'reviews_select',
      command: 'select',
      roles: ['authenticated', 'anon'],
      using: 'true',
      with_check: null,
    },
  });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'CREATE POLICY "reviews_select" ON "reviews"', 'policy created');
  includes(statements[0], 'FOR SELECT', 'SELECT command');
  includes(statements[0], 'USING (true)', 'using clause');
  includes(rollbackStatements[0], 'DROP POLICY IF EXISTS "reviews_select"', 'rollback');
}

suite('generateSQL — DROP POLICY');
{
  const changes = gen._emptyChanges();
  changes.policiesToDrop.push({
    table: 'users',
    policy: { name: 'users_old_policy', command: 'select', roles: [] },
  });
  const { statements } = gen.generateSQL(changes);
  includes(statements[0], 'DROP POLICY IF EXISTS "users_old_policy" ON "users"', 'drop policy');
}

suite('generateSQL — MODIFY POLICY (drop + recreate)');
{
  const changes = gen._emptyChanges();
  changes.policiesToModify.push({
    table: 'users',
    policy: {
      name: 'users_update_policy',
      command: 'update',
      roles: ['authenticated'],
      using: 'auth.uid() = public_id',
      with_check: 'auth.uid() = public_id',
    },
    previous: {
      name: 'users_update_policy',
      command: 'update',
      roles: ['authenticated'],
      using: 'old_expr()',
      with_check: 'old_expr()',
    },
  });
  const { statements } = gen.generateSQL(changes);
  // Should be DROP then CREATE
  eq(statements.length, 2, 'drop + create = 2 statements');
  includes(statements[0], 'DROP POLICY IF EXISTS "users_update_policy"', 'drops first');
  includes(statements[1], 'CREATE POLICY "users_update_policy"', 'creates second');
  includes(statements[1], 'auth.uid() = public_id', 'new expression');
}

// ─── DROP TABLE ─────────────────────────────────────────────────

suite('generateSQL — DROP TABLE');
{
  const changes = gen._emptyChanges();
  changes.tablesToDrop.push({ name: 'legacy_table' });
  const { statements, rollbackStatements } = gen.generateSQL(changes);
  includes(statements[0], 'DROP TABLE IF EXISTS "legacy_table"', 'drop table');
  includes(rollbackStatements[0], 'WARNING', 'rollback warning');
}

// ─── Identifier escaping ────────────────────────────────────────

suite('escapeIdentifier — double quotes');
eq(gen.escapeIdentifier('my table'), '"my table"', 'spaces preserved');
eq(gen.escapeIdentifier('has"quote'), '"has""quote"', 'quotes escaped');

// ─── Summary ────────────────────────────────────────────────────

summary();
