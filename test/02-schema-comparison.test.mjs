/**
 * Test 02 — Schema Comparison (normal + reverse)
 *
 * Builds mock database schemas and Drizzle-parsed schemas, then verifies
 * that compareSchemas / compareSchemasReverse detect the correct differences:
 *   - new tables, dropped tables
 *   - added / dropped / modified columns
 *   - added / dropped foreign keys
 *   - added / dropped indexes
 *   - added / dropped unique constraints
 *   - added / dropped / modified policies
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ASTSchemaParser } from '../src/ast-parser.mjs';
import { SchemaDiffGenerator } from '../src/generate.mjs';
import { suite, assert, eq, includes, gt, summary } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(__dirname, 'fixtures', 'schema');

// Parse real Drizzle schemas so we have realistic input
const parser = new ASTSchemaParser();
const drizzleSchema = {};
for (const file of ['users', 'products', 'orders', 'reviews']) {
  const content = readFileSync(join(schemaDir, `${file}.ts`), 'utf-8');
  drizzleSchema[file] = parser.parseFile(content, file);
}

// We need a SchemaDiffGenerator instance for its comparison methods.
// We won't connect to any database — just use the methods directly.
function makeGenerator(opts = {}) {
  const gen = new SchemaDiffGenerator({
    config: {
      schemaDir,
      migrationsDir: '/tmp/test-migrations',
      masterChangelog: '/tmp/test-changelog.xml',
      diff: {
        includePolicies: true,
        modifyPolicies: true,
        dropOrphanPolicies: true,
        dropOrphanIndexes: true,
        dropOrphanUniques: true,
        ...opts,
      },
    },
  });
  // Initialise internal maps from the parsed schema so FK normalisation works
  Object.values(drizzleSchema).forEach((fileTables) => {
    Object.entries(fileTables).forEach(([varName, t]) => {
      if (t && t.name) {
        gen.varToPhysical[varName] = t.name;
        if (!gen.columnLogicalToPhysical[t.name]) gen.columnLogicalToPhysical[t.name] = {};
        Object.values(t.columns).forEach((col) => {
          if (col.logicalName && col.name && col.logicalName !== col.name)
            gen.columnLogicalToPhysical[t.name][col.logicalName] = col.name;
        });
      }
    });
  });
  gen.config = gen._configOverride;
  gen.options = { ...gen.config.diff };
  return gen;
}

// ---------------------------------------------------------------------------
// Helper — build a minimal "database table" object matching the shape
// that getDatabaseSchema returns.
// ---------------------------------------------------------------------------
function dbTable(name, columns = {}, extras = {}) {
  return {
    name,
    schema: 'public',
    columns,
    constraints: [],
    foreignKeys: extras.foreignKeys || {},
    uniqueConstraints: extras.uniqueConstraints || [],
    indexes: extras.indexes || [],
    policies: extras.policies || [],
  };
}

function dbCol(name, type, opts = {}) {
  return {
    name,
    type,
    nullable: opts.nullable ?? true,
    isArray: opts.isArray ?? false,
    enumName: opts.enumName ?? null,
    primaryKey: opts.primaryKey ?? false,
    default: opts.default ?? null,
    ...opts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Normal mode — compareSchemas (schema → DB)
// ═══════════════════════════════════════════════════════════════════

suite('compareSchemas — empty DB → all tables created');
{
  const gen = makeGenerator();
  const changes = gen.compareSchemas(drizzleSchema, {});
  // We have: users, categories, products, orders, order_items, reviews = 6 tables
  gt(changes.tablesToCreate.length, 0, 'tablesToCreate is non-empty');
  const names = changes.tablesToCreate.map((t) => t.name).sort();
  includes(names, 'users', 'includes users');
  includes(names, 'categories', 'includes categories');
  includes(names, 'products', 'includes products');
  includes(names, 'orders', 'includes orders');
  includes(names, 'order_items', 'includes order_items');
  includes(names, 'reviews', 'includes reviews');
  eq(changes.tablesToDrop.length, 0, 'nothing to drop');
}

suite('compareSchemas — fully matching DB → no changes');
{
  const gen = makeGenerator();
  // Build a DB that matches the Drizzle schema exactly
  const mockDb = {};

  // Users table
  mockDb.users = dbTable('users', {
    id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
    public_id: dbCol('public_id', 'uuid', { nullable: false }),
    email: dbCol('email', 'varchar', { nullable: false }),
    name: dbCol('name', 'varchar'),
    bio: dbCol('bio', 'text'),
    role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
    is_active: dbCol('is_active', 'bool', { nullable: false }),
    tags: dbCol('tags', 'text', { isArray: true }),
    preferences: dbCol('preferences', 'jsonb'),
    last_login_at: dbCol('last_login_at', 'timestamp'),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
    updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
  }, {
    indexes: [
      { name: 'users_email_idx', definition: 'CREATE INDEX users_email_idx ON users USING btree (email)' },
      { name: 'users_role_idx', definition: 'CREATE INDEX users_role_idx ON users USING btree (role)' },
    ],
    uniqueConstraints: [
      { name: 'users_email_unique', columns: ['email'] },
    ],
    policies: [
      { name: 'users_select_policy', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
      { name: 'users_insert_policy', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid() = public_id' },
      { name: 'users_update_policy', command: 'update', roles: ['authenticated'], using: 'auth.uid() = public_id', with_check: 'auth.uid() = public_id' },
    ],
  });

  // Categories
  mockDb.categories = dbTable('categories', {
    id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
    name: dbCol('name', 'varchar', { nullable: false }),
    slug: dbCol('slug', 'varchar', { nullable: false }),
    parent_id: dbCol('parent_id', 'int4'),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
  }, {
    foreignKeys: {
      parent_id: { column: 'parent_id', references: { table: 'categories', column: 'id' }, constraintName: 'categories_parent_id_fk' },
    },
  });

  // Products
  mockDb.products = dbTable('products', {
    id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
    sku: dbCol('sku', 'varchar', { nullable: false }),
    name: dbCol('name', 'varchar', { nullable: false }),
    description: dbCol('description', 'text'),
    price: dbCol('price', 'numeric', { nullable: false }),
    category_id: dbCol('category_id', 'int4'),
    status: dbCol('status', 'varchar', { enumName: 'product_status', nullable: false }),
    metadata: dbCol('metadata', 'jsonb'),
    is_active: dbCol('is_active', 'bool', { nullable: false }),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
    updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    deleted_at: dbCol('deleted_at', 'timestamp'),
  }, {
    foreignKeys: {
      category_id: { column: 'category_id', references: { table: 'categories', column: 'id' }, constraintName: 'products_category_id_fk' },
    },
    indexes: [
      { name: 'products_sku_idx', definition: 'CREATE INDEX products_sku_idx ON products USING btree (sku)' },
      { name: 'products_status_active_idx', definition: 'CREATE INDEX products_status_active_idx ON products USING btree (status, is_active)' },
      { name: 'products_metadata_idx', definition: 'CREATE INDEX products_metadata_idx ON products USING gin (metadata)' },
    ],
    uniqueConstraints: [
      { name: 'products_sku_unique', columns: ['sku'] },
    ],
    policies: [
      { name: 'products_select', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
      { name: 'products_admin_insert', command: 'insert', roles: ['authenticated'], using: null, with_check: 'is_admin(auth.uid())' },
    ],
  });

  // Orders
  mockDb.orders = dbTable('orders', {
    id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
    order_number: dbCol('order_number', 'varchar', { nullable: false }),
    user_id: dbCol('user_id', 'int4', { nullable: false }),
    status: dbCol('status', 'varchar', { enumName: 'order_status', nullable: false }),
    payment_method: dbCol('payment_method', 'varchar', { enumName: 'payment_method' }),
    total_amount: dbCol('total_amount', 'numeric', { nullable: false }),
    shipping_address: dbCol('shipping_address', 'jsonb'),
    notes: dbCol('notes', 'varchar'),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
    updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
  }, {
    foreignKeys: {
      user_id: { column: 'user_id', references: { table: 'users', column: 'id' }, constraintName: 'orders_user_id_fk' },
    },
    indexes: [
      { name: 'orders_user_id_idx', definition: 'CREATE INDEX orders_user_id_idx ON orders USING btree (user_id)' },
      { name: 'orders_status_idx', definition: 'CREATE INDEX orders_status_idx ON orders USING btree (status)' },
      { name: 'orders_created_at_idx', definition: 'CREATE INDEX orders_created_at_idx ON orders USING btree (created_at)' },
    ],
    policies: [
      { name: 'orders_select', command: 'select', roles: ['authenticated'], using: 'auth.uid()::int = user_id', with_check: null },
      { name: 'orders_insert', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid()::int = user_id' },
    ],
  });

  // Order Items
  mockDb.order_items = dbTable('order_items', {
    id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
    order_id: dbCol('order_id', 'int4', { nullable: false }),
    product_id: dbCol('product_id', 'int4', { nullable: false }),
    quantity: dbCol('quantity', 'int4', { nullable: false }),
    unit_price: dbCol('unit_price', 'numeric', { nullable: false }),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
  }, {
    foreignKeys: {
      order_id: { column: 'order_id', references: { table: 'orders', column: 'id' }, constraintName: 'order_items_order_id_fk' },
      product_id: { column: 'product_id', references: { table: 'products', column: 'id' }, constraintName: 'order_items_product_id_fk' },
    },
    indexes: [
      { name: 'order_items_order_id_idx', definition: 'CREATE INDEX order_items_order_id_idx ON order_items USING btree (order_id)' },
      { name: 'order_items_product_id_idx', definition: 'CREATE INDEX order_items_product_id_idx ON order_items USING btree (product_id)' },
    ],
    uniqueConstraints: [
      { name: 'order_items_order_id_product_id_unique', columns: ['order_id', 'product_id'] },
    ],
  });

  // Reviews
  mockDb.reviews = dbTable('reviews', {
    id: dbCol('id', 'uuid', { primaryKey: true, nullable: false }),
    user_id: dbCol('user_id', 'int4', { nullable: false }),
    product_id: dbCol('product_id', 'int4', { nullable: false }),
    rating: dbCol('rating', 'int2', { nullable: false }),
    title: dbCol('title', 'text'),
    body: dbCol('body', 'text'),
    is_verified: dbCol('is_verified', 'bool', { nullable: false }),
    created_at: dbCol('created_at', 'timestamp', { nullable: false }),
    updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
  }, {
    foreignKeys: {
      user_id: { column: 'user_id', references: { table: 'users', column: 'id' }, constraintName: 'reviews_user_id_fk' },
      product_id: { column: 'product_id', references: { table: 'products', column: 'id' }, constraintName: 'reviews_product_id_fk' },
    },
    indexes: [
      { name: 'reviews_user_id_idx', definition: 'CREATE INDEX reviews_user_id_idx ON reviews USING btree (user_id)' },
      { name: 'reviews_product_id_idx', definition: 'CREATE INDEX reviews_product_id_idx ON reviews USING btree (product_id)' },
      { name: 'reviews_rating_idx', definition: 'CREATE INDEX reviews_rating_idx ON reviews USING btree (rating)' },
    ],
    policies: [
      { name: 'reviews_select', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
      { name: 'reviews_insert', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid()::int = user_id' },
      { name: 'reviews_delete', command: 'delete', roles: ['authenticated'], using: 'auth.uid()::int = user_id', with_check: null },
    ],
  });

  const changes = gen.compareSchemas(drizzleSchema, mockDb);
  eq(changes.tablesToCreate.length, 0, 'no tables to create');
  eq(changes.tablesToDrop.length, 0, 'no tables to drop');
  eq(changes.columnsToAdd.length, 0, 'no columns to add');
  eq(changes.columnsToDrop.length, 0, 'no columns to drop');
  eq(changes.foreignKeysToAdd.length, 0, 'no FKs to add');
  eq(changes.foreignKeysToDrop.length, 0, 'no FKs to drop');
  eq(changes.indexesToAdd.length, 0, 'no indexes to add');
  eq(changes.policiesToAdd.length, 0, 'no policies to add');
}

suite('compareSchemas — detect added columns');
{
  const gen = makeGenerator();
  // Provide a users table missing "bio" and "preferences"
  const partialDb = {
    users: dbTable('users', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      public_id: dbCol('public_id', 'uuid', { nullable: false }),
      email: dbCol('email', 'varchar', { nullable: false }),
      name: dbCol('name', 'varchar'),
      // bio: MISSING
      role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
      is_active: dbCol('is_active', 'bool', { nullable: false }),
      tags: dbCol('tags', 'text', { isArray: true }),
      // preferences: MISSING
      last_login_at: dbCol('last_login_at', 'timestamp'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }),
  };
  // Only supply users to drizzle schema
  const miniDrizzle = { users: drizzleSchema.users };
  const changes = gen.compareSchemas(miniDrizzle, partialDb);
  eq(changes.columnsToAdd.length, 2, '2 columns to add');
  const addedNames = changes.columnsToAdd.map((c) => c.column).sort();
  eq(addedNames, ['bio', 'preferences'], 'bio and preferences added');
}

suite('compareSchemas — detect dropped columns');
{
  const gen = makeGenerator();
  const extraDb = {
    users: dbTable('users', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      public_id: dbCol('public_id', 'uuid', { nullable: false }),
      email: dbCol('email', 'varchar', { nullable: false }),
      name: dbCol('name', 'varchar'),
      bio: dbCol('bio', 'text'),
      role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
      is_active: dbCol('is_active', 'bool', { nullable: false }),
      tags: dbCol('tags', 'text', { isArray: true }),
      preferences: dbCol('preferences', 'jsonb'),
      last_login_at: dbCol('last_login_at', 'timestamp'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
      // Extra column in DB not in schema
      legacy_flag: dbCol('legacy_flag', 'bool'),
    }),
  };
  const miniDrizzle = { users: drizzleSchema.users };
  const changes = gen.compareSchemas(miniDrizzle, extraDb);
  eq(changes.columnsToDrop.length, 1, '1 column to drop');
  eq(changes.columnsToDrop[0].column, 'legacy_flag', 'legacy_flag dropped');
}

suite('compareSchemas — detect missing FK');
{
  const gen = makeGenerator();
  // Reviews table without the product FK in DB
  const miniDb = {
    reviews: dbTable('reviews', {
      id: dbCol('id', 'uuid', { primaryKey: true, nullable: false }),
      user_id: dbCol('user_id', 'int4', { nullable: false }),
      product_id: dbCol('product_id', 'int4', { nullable: false }),
      rating: dbCol('rating', 'int2', { nullable: false }),
      title: dbCol('title', 'text'),
      body: dbCol('body', 'text'),
      is_verified: dbCol('is_verified', 'bool', { nullable: false }),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }, {
      foreignKeys: {
        user_id: { column: 'user_id', references: { table: 'users', column: 'id' } },
        // product FK missing!
      },
    }),
  };
  const miniDrizzle = { reviews: drizzleSchema.reviews };
  const changes = gen.compareSchemas(miniDrizzle, miniDb);
  gt(changes.foreignKeysToAdd.length, 0, 'at least 1 FK to add');
  assert(
    changes.foreignKeysToAdd.some((fk) => fk.column === 'product_id'),
    'missing product FK detected'
  );
}

suite('compareSchemas — detect missing index');
{
  const gen = makeGenerator();
  const miniDb = {
    orders: dbTable('orders', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      order_number: dbCol('order_number', 'varchar', { nullable: false }),
      user_id: dbCol('user_id', 'int4', { nullable: false }),
      status: dbCol('status', 'varchar', { enumName: 'order_status', nullable: false }),
      payment_method: dbCol('payment_method', 'varchar', { enumName: 'payment_method' }),
      total_amount: dbCol('total_amount', 'numeric', { nullable: false }),
      shipping_address: dbCol('shipping_address', 'jsonb'),
      notes: dbCol('notes', 'varchar'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }, {
      foreignKeys: {
        user_id: { column: 'user_id', references: { table: 'users', column: 'id' } },
      },
      indexes: [
        // Missing orders_status_idx and orders_created_at_idx
        { name: 'orders_user_id_idx', definition: 'CREATE INDEX orders_user_id_idx ON orders USING btree (user_id)' },
      ],
      policies: [
        { name: 'orders_select', command: 'select', roles: ['authenticated'], using: 'auth.uid()::int = user_id', with_check: null },
        { name: 'orders_insert', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid()::int = user_id' },
      ],
    }),
  };
  const miniDrizzle = { orders: drizzleSchema.orders };
  const changes = gen.compareSchemas(miniDrizzle, miniDb);
  eq(changes.indexesToAdd.length, 2, '2 missing indexes detected');
  const idxNames = changes.indexesToAdd.map((i) => i.index.name).sort();
  includes(idxNames, 'orders_created_at_idx', 'created_at idx');
  includes(idxNames, 'orders_status_idx', 'status idx');
}

suite('compareSchemas — detect orphan index to drop');
{
  const gen = makeGenerator({ dropOrphanIndexes: true });
  const miniDb = {
    users: dbTable('users', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      public_id: dbCol('public_id', 'uuid', { nullable: false }),
      email: dbCol('email', 'varchar', { nullable: false }),
      name: dbCol('name', 'varchar'),
      bio: dbCol('bio', 'text'),
      role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
      is_active: dbCol('is_active', 'bool', { nullable: false }),
      tags: dbCol('tags', 'text', { isArray: true }),
      preferences: dbCol('preferences', 'jsonb'),
      last_login_at: dbCol('last_login_at', 'timestamp'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }, {
      indexes: [
        { name: 'users_email_idx', definition: 'CREATE INDEX users_email_idx ON users USING btree (email)' },
        { name: 'users_role_idx', definition: 'CREATE INDEX users_role_idx ON users USING btree (role)' },
        // Orphan — not in schema
        { name: 'users_legacy_idx', definition: 'CREATE INDEX users_legacy_idx ON users USING btree (name)' },
      ],
      uniqueConstraints: [{ name: 'users_email_unique', columns: ['email'] }],
      policies: [
        { name: 'users_select_policy', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
        { name: 'users_insert_policy', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid() = public_id' },
        { name: 'users_update_policy', command: 'update', roles: ['authenticated'], using: 'auth.uid() = public_id', with_check: 'auth.uid() = public_id' },
      ],
    }),
  };
  const miniDrizzle = { users: drizzleSchema.users };
  const changes = gen.compareSchemas(miniDrizzle, miniDb);
  eq(changes.indexesToDrop.length, 1, '1 orphan index');
  eq(changes.indexesToDrop[0].index.name, 'users_legacy_idx', 'legacy index');
}

suite('compareSchemas — detect missing policy');
{
  const gen = makeGenerator();
  const miniDb = {
    reviews: dbTable('reviews', {
      id: dbCol('id', 'uuid', { primaryKey: true, nullable: false }),
      user_id: dbCol('user_id', 'int4', { nullable: false }),
      product_id: dbCol('product_id', 'int4', { nullable: false }),
      rating: dbCol('rating', 'int2', { nullable: false }),
      title: dbCol('title', 'text'),
      body: dbCol('body', 'text'),
      is_verified: dbCol('is_verified', 'bool', { nullable: false }),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }, {
      foreignKeys: {
        user_id: { column: 'user_id', references: { table: 'users', column: 'id' } },
        product_id: { column: 'product_id', references: { table: 'products', column: 'id' } },
      },
      indexes: [
        { name: 'reviews_user_id_idx', definition: 'CREATE INDEX reviews_user_id_idx ON reviews USING btree (user_id)' },
        { name: 'reviews_product_id_idx', definition: 'CREATE INDEX reviews_product_id_idx ON reviews USING btree (product_id)' },
        { name: 'reviews_rating_idx', definition: 'CREATE INDEX reviews_rating_idx ON reviews USING btree (rating)' },
      ],
      policies: [
        // Missing reviews_delete policy
        { name: 'reviews_select', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
        { name: 'reviews_insert', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid()::int = user_id' },
      ],
    }),
  };
  const miniDrizzle = { reviews: drizzleSchema.reviews };
  const changes = gen.compareSchemas(miniDrizzle, miniDb);
  eq(changes.policiesToAdd.length, 1, '1 policy to add');
  eq(changes.policiesToAdd[0].policy.name, 'reviews_delete', 'delete policy missing');
}

suite('compareSchemas — detect policy modification');
{
  const gen = makeGenerator({ modifyPolicies: true });
  const miniDb = {
    users: dbTable('users', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      public_id: dbCol('public_id', 'uuid', { nullable: false }),
      email: dbCol('email', 'varchar', { nullable: false }),
      name: dbCol('name', 'varchar'),
      bio: dbCol('bio', 'text'),
      role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
      is_active: dbCol('is_active', 'bool', { nullable: false }),
      tags: dbCol('tags', 'text', { isArray: true }),
      preferences: dbCol('preferences', 'jsonb'),
      last_login_at: dbCol('last_login_at', 'timestamp'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
    }, {
      indexes: [
        { name: 'users_email_idx', definition: 'CREATE INDEX users_email_idx ON users USING btree (email)' },
        { name: 'users_role_idx', definition: 'CREATE INDEX users_role_idx ON users USING btree (role)' },
      ],
      uniqueConstraints: [{ name: 'users_email_unique', columns: ['email'] }],
      policies: [
        { name: 'users_select_policy', command: 'select', roles: ['anon', 'authenticated'], using: 'true', with_check: null },
        { name: 'users_insert_policy', command: 'insert', roles: ['authenticated'], using: null, with_check: 'auth.uid() = public_id' },
        // MODIFIED: different expression
        { name: 'users_update_policy', command: 'update', roles: ['authenticated'], using: 'old_expr()', with_check: 'old_expr()' },
      ],
    }),
  };
  const miniDrizzle = { users: drizzleSchema.users };
  const changes = gen.compareSchemas(miniDrizzle, miniDb);
  eq(changes.policiesToModify.length, 1, '1 policy modified');
  eq(changes.policiesToModify[0].policy.name, 'users_update_policy', 'update policy');
}

// ═══════════════════════════════════════════════════════════════════
// Reverse mode — compareSchemasReverse (DB → schema)
// ═══════════════════════════════════════════════════════════════════

suite('compareSchemasReverse — table in DB but not in schema');
{
  const gen = makeGenerator();
  const dbWithExtra = {
    audit_log: dbTable('audit_log', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      action: dbCol('action', 'varchar', { nullable: false }),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
    }),
  };
  const emptyDrizzle = {};
  const changes = gen.compareSchemasReverse(emptyDrizzle, dbWithExtra);
  eq(changes.tablesToCreate.length, 1, '1 table to create (reverse)');
  eq(changes.tablesToCreate[0].name, 'audit_log', 'audit_log table');
}

suite('compareSchemasReverse — column in DB but not in schema');
{
  const gen = makeGenerator();
  const dbWithExtraCol = {
    users: dbTable('users', {
      id: dbCol('id', 'int4', { primaryKey: true, nullable: false }),
      public_id: dbCol('public_id', 'uuid', { nullable: false }),
      email: dbCol('email', 'varchar', { nullable: false }),
      name: dbCol('name', 'varchar'),
      bio: dbCol('bio', 'text'),
      role: dbCol('role', 'varchar', { enumName: 'user_role', nullable: false }),
      is_active: dbCol('is_active', 'bool', { nullable: false }),
      tags: dbCol('tags', 'text', { isArray: true }),
      preferences: dbCol('preferences', 'jsonb'),
      last_login_at: dbCol('last_login_at', 'timestamp'),
      created_at: dbCol('created_at', 'timestamp', { nullable: false }),
      updated_at: dbCol('updated_at', 'timestamp', { nullable: false }),
      // Extra
      phone: dbCol('phone', 'varchar'),
    }),
  };
  const miniDrizzle = { users: drizzleSchema.users };
  const changes = gen.compareSchemasReverse(miniDrizzle, dbWithExtraCol);
  eq(changes.columnsToAdd.length, 1, '1 column from DB');
  eq(changes.columnsToAdd[0].column, 'phone', 'phone column');
}

// ─── Summary ────────────────────────────────────────────────────
summary();
