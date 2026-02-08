/**
 * Smoke test for the AST-based Drizzle schema parser.
 *
 * Run:  node test/ast-parser.test.mjs
 */

import { ASTSchemaParser } from '../src/ast-parser.mjs';

const parser = new ASTSchemaParser();
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     expected: ${e}`);
    console.error(`     actual:   ${a}`);
  }
}

// ─── Test 1: parseImports ─────────────────────────────────────────

console.log('\n📋 Test: parseImports');

const indexContent = `
export * from './users';
export * from './orders';
export * from './products';
export * from './assessment-requirements';
`;

const imports = parser.parseImports(indexContent);
assertDeepEqual(imports, ['users', 'orders', 'products', 'assessment-requirements'], 'extracts re-export module names');

// ─── Test 2: Basic table with named columns ───────────────────────

console.log('\n📋 Test: basic table with named columns');

const basicSchema = `
import { pgTable, varchar, integer, boolean, timestamp, text } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: integer('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  price: integer('price').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;

const basicResult = parser.parseFile(basicSchema, 'products');
assert(basicResult.products !== undefined, 'finds products table');
assert(basicResult.products.name === 'products', 'physical table name = products');

const cols = basicResult.products.columns;
assert(cols.id?.primaryKey === true, 'id is primary key');
assert(cols.id?.nullable === false, 'primary key is not nullable');
assert(cols.name?.type === 'varchar', 'name is varchar');
assert(cols.name?.nullable === false, 'name is not null');
assert(cols.name?.args.includes('255'), 'name preserves length arg');
assert(cols.description?.type === 'text', 'description is text');
assert(cols.description?.nullable === true, 'description is nullable');
assert(cols.price?.type === 'integer', 'price is integer');
assert(cols.active?.hasDefault === true, 'active has default');
assert(cols.created_at?.hasDefault === true, 'created_at has default');
assert(cols.created_at?.logicalName === 'createdAt', 'logical name preserved');
assert(cols.created_at?.name === 'created_at', 'physical name = created_at');

// ─── Test 3: Foreign key references ──────────────────────────────

console.log('\n📋 Test: foreign key references');

const fkSchema = `
import { pgTable, integer, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer('id').primaryKey(),
  name: varchar('name').notNull(),
});

export const orders = pgTable('orders', {
  id: integer('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
});
`;

const fkResult = parser.parseFile(fkSchema, 'orders');
assert(fkResult.users !== undefined, 'finds users table');
assert(fkResult.orders !== undefined, 'finds orders table');

const orderCols = fkResult.orders.columns;
assert(orderCols.user_id?.references?.table === 'users', 'FK references users table');
assert(orderCols.user_id?.references?.column === 'id', 'FK references id column');
assert(orderCols.status?.hasDefault === true, 'status has default');

// ─── Test 4: Zero-arg column types ──────────────────────────────

console.log('\n📋 Test: zero-arg column types');

const zeroArgSchema = `
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid().primaryKey().defaultRandom(),
  token: text().notNull().unique(),
  active: boolean().notNull().default(false),
  expiresAt: timestamp().notNull(),
});
`;

const zeroResult = parser.parseFile(zeroArgSchema, 'sessions');
const sCols = zeroResult.sessions.columns;
assert(sCols.id?.type === 'uuid', 'uuid() type detected');
assert(sCols.id?.primaryKey === true, 'uuid primaryKey');
assert(sCols.id?.hasDefault === true, 'defaultRandom detected');
assert(sCols.token?.unique === true, 'unique() detected');
assert(sCols.active?.hasDefault === true, 'default(false) detected');
assert(sCols.expiresAt?.type === 'timestamp', 'timestamp() type detected');
// Zero-arg columns use the logical name as the physical name
assert(sCols.expiresAt?.name === 'expiresAt', 'zero-arg preserves logical as physical');

// ─── Test 5: Enum columns ───────────────────────────────────────

console.log('\n📋 Test: enum columns');

const enumSchema = `
import { pgTable, integer, varchar } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';

export const orderStatusEnum = pgEnum('order_status', ['pending', 'processing', 'shipped']);

export const items = pgTable('items', {
  id: integer('id').primaryKey(),
  status: orderStatusEnum('status').notNull(),
});
`;

const enumResult = parser.parseFile(enumSchema, 'items');
const eCols = enumResult.items.columns;
assert(eCols.status?.enumName === 'orderStatusEnum', 'enum name captured');
assert(eCols.status?.type === 'varchar', 'enum normalises to varchar');

// ─── Test 6: Array columns ─────────────────────────────────────

console.log('\n📋 Test: array columns');

const arraySchema = `
import { pgTable, integer, text } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
  id: integer('id').primaryKey(),
  tags: text('tags').array().notNull(),
});
`;

const arrayResult = parser.parseFile(arraySchema, 'posts');
assert(arrayResult.posts.columns.tags?.isArray === true, 'array() detected');

// ─── Test 7: Constraints — indexes + unique + policies ──────────

console.log('\n📋 Test: constraints (indexes, unique, policies)');

const constraintSchema = `
import { pgTable, integer, varchar, index, unique, text } from 'drizzle-orm/pg-core';
import { pgPolicy } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const members = pgTable('members', {
  id: integer('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  orgId: integer('org_id').notNull(),
  role: varchar('role', { length: 50 }).notNull(),
}, (t) => [
  index('members_email_idx').on(t.email),
  index('members_org_role_idx').on(t.orgId, t.role),
  unique().on(t.email, t.orgId),
  pgPolicy('members_select_policy', {
    for: 'select',
    to: ['authenticated'],
    using: sql\`auth.uid() = id\`,
  }),
]);
`;

const cResult = parser.parseFile(constraintSchema, 'members');
const mTable = cResult.members;

assert(mTable.indexes.length === 2, '2 indexes found');
assert(mTable.indexes[0].name === 'members_email_idx', 'index name correct');
assertDeepEqual(mTable.indexes[0].columns, ['email'], 'single-col index columns');
assertDeepEqual(mTable.indexes[1].columns, ['orgId', 'role'].sort(), 'multi-col index columns (sorted)');

assert(mTable.uniqueConstraints.length === 1, '1 unique constraint');
assertDeepEqual(mTable.uniqueConstraints[0].columns, ['email', 'orgId'].sort(), 'unique columns');

assert(mTable.policies.length === 1, '1 policy');
assert(mTable.policies[0].name === 'members_select_policy', 'policy name');
assert(mTable.policies[0].command === 'select', 'policy command');
assertDeepEqual(mTable.policies[0].roles, ['authenticated'], 'policy roles');
assert(mTable.policies[0].using?.includes('auth.uid()'), 'policy USING expression');

// ─── Test 8: Constraints as object form ─────────────────────────

console.log('\n📋 Test: constraints as object literal form');

const objectFormSchema = `
import { pgTable, integer, varchar, index, unique } from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
  id: integer('id').primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull(),
  parentId: integer('parent_id'),
}, (t) => ({
  slugIdx: index('categories_slug_idx').on(t.slug),
  parentSlug: unique('categories_parent_slug_unique').on(t.parentId, t.slug),
}));
`;

const objResult = parser.parseFile(objectFormSchema, 'categories');
assert(objResult.categories.indexes.length === 1, 'object-form: 1 index');
assert(objResult.categories.indexes[0].name === 'categories_slug_idx', 'object-form: index name');
assert(objResult.categories.uniqueConstraints.length === 1, 'object-form: 1 unique');
assert(objResult.categories.uniqueConstraints[0].name === 'categories_parent_slug_unique', 'object-form: named unique');

// ─── Test 9: Non-exported tables are skipped ────────────────────

console.log('\n📋 Test: non-exported tables are skipped');

const mixedSchema = `
import { pgTable, integer } from 'drizzle-orm/pg-core';

const _internal = pgTable('_internal', {
  id: integer('id').primaryKey(),
});

export const public_table = pgTable('public_table', {
  id: integer('id').primaryKey(),
});
`;

const mixedResult = parser.parseFile(mixedSchema, 'mixed');
assert(mixedResult._internal === undefined, 'non-exported table skipped');
assert(mixedResult.public_table !== undefined, 'exported table found');

// ─── Test 10: Multi-line / odd formatting ───────────────────────

console.log('\n📋 Test: multi-line / weird formatting tolerance');

const weirdFormatSchema = `
import { pgTable, integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const weirdTable = pgTable(
  'weird_table',
  {
    id: integer(
      'id'
    ).primaryKey(
    ),
    name: varchar(
      'name',
      { length: 255 }
    )
    .notNull()
    .default('hello'),
    bio: text(
      'bio'
    ),
    ts: timestamp('created_at')
      .defaultNow()
      .notNull(),
  }
);
`;

const weirdResult = parser.parseFile(weirdFormatSchema, 'weird');
const wCols = weirdResult.weirdTable.columns;
assert(wCols.id?.primaryKey === true, 'multi-line: id primaryKey');
assert(wCols.name?.nullable === false, 'multi-line: name notNull');
assert(wCols.name?.hasDefault === true, 'multi-line: name default');
assert(wCols.bio?.nullable === true, 'multi-line: bio nullable');
assert(wCols.created_at?.hasDefault === true, 'multi-line: ts defaultNow');
assert(wCols.created_at?.nullable === false, 'multi-line: ts notNull');

// ─── Test 11: Policy with withCheck ─────────────────────────────

console.log('\n📋 Test: policy with withCheck');

const policySchema = `
import { pgTable, integer, varchar } from 'drizzle-orm/pg-core';
import { pgPolicy } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const docs = pgTable('documents', {
  id: integer('id').primaryKey(),
  ownerId: integer('owner_id').notNull(),
}, (t) => [
  pgPolicy('docs_insert_policy', {
    for: 'insert',
    to: ['authenticated'],
    withCheck: sql\`auth.uid() = owner_id\`,
  }),
  pgPolicy('docs_update_policy', {
    for: 'update',
    to: ['authenticated'],
    using: sql\`auth.uid() = owner_id\`,
    withCheck: sql\`auth.uid() = owner_id\`,
  }),
]);
`;

const polResult = parser.parseFile(policySchema, 'docs');
const pols = polResult.docs.policies;
assert(pols.length === 2, '2 policies found');
assert(pols[0].command === 'insert', 'insert policy');
assert(pols[0].with_check?.includes('auth.uid()'), 'insert withCheck');
assert(pols[0].using === null, 'insert no USING');
assert(pols[1].command === 'update', 'update policy');
assert(pols[1].using?.includes('auth.uid()'), 'update USING');
assert(pols[1].with_check?.includes('auth.uid()'), 'update withCheck');

// ─── Test 12: GIN index ─────────────────────────────────────────

console.log('\n📋 Test: index with method (GIN)');

const ginSchema = `
import { pgTable, integer, jsonb, index } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  id: integer('id').primaryKey(),
  payload: jsonb('payload'),
}, (t) => [
  index('events_payload_idx').using('gin', t.payload),
]);
`;

const ginResult = parser.parseFile(ginSchema, 'events');
assert(ginResult.events.indexes.length === 1, 'gin index found');
assert(ginResult.events.indexes[0].method === 'gin', 'method = gin');

// ─── Summary ────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('🎉 All tests passed!\n');
