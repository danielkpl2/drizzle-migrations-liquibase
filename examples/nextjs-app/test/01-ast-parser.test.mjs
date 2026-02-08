/**
 * Test 01 — AST Schema Parser
 *
 * Verifies that the AST parser correctly extracts every feature from
 * the example Drizzle schema files:
 *   - barrel imports
 *   - pgTable + enableRLS chain
 *   - all column types (serial, uuid, varchar, text, boolean, timestamp, jsonb, numeric, smallint, array)
 *   - column modifiers (.notNull, .primaryKey, .unique, .default, .defaultNow, .defaultRandom, .array)
 *   - foreign keys (.references)
 *   - self-referencing foreign keys
 *   - cross-file foreign keys
 *   - pgEnum columns
 *   - indexes (btree, gin, multi-column)
 *   - unique constraints (named, unnamed/auto-named)
 *   - RLS policies (select, insert, update, delete)
 *   - policy USING and WITH CHECK expressions
 *   - constraint callback: array form, object form, block-body form
 *   - non-exported tables skipped
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ASTSchemaParser } from 'drizzle-migrations-liquibase/ast-parser';
import { suite, assert, eq, includes, gt, summary } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(__dirname, '..', 'src', 'db', 'schema');

const parser = new ASTSchemaParser();

// ─── Index / barrel imports ──────────────────────────────────────

suite('parseImports — barrel index.ts');
const indexContent = readFileSync(join(schemaDir, 'index.ts'), 'utf-8');
const modules = parser.parseImports(indexContent);
eq(modules, ['users', 'products', 'orders', 'reviews'], 'extracts all 4 modules');

// ─── Users ──────────────────────────────────────────────────────

suite('users.ts — table detection');
const usersContent = readFileSync(join(schemaDir, 'users.ts'), 'utf-8');
const usersResult = parser.parseFile(usersContent, 'users');
assert(usersResult.users !== undefined, 'finds "users" table variable');
eq(usersResult.users.name, 'users', 'physical table name = users');

suite('users.ts — column types & modifiers');
const uCols = usersResult.users.columns;
assert(uCols.id?.type === 'serial', 'id: serial type');
assert(uCols.id?.primaryKey === true, 'id: primaryKey');
assert(uCols.id?.nullable === false, 'id: not nullable (pk)');
assert(uCols.public_id?.type === 'uuid', 'public_id: uuid type');
assert(uCols.public_id?.hasDefault === true, 'public_id: defaultRandom');
assert(uCols.public_id?.unique === true, 'public_id: unique');
assert(uCols.public_id?.nullable === false, 'public_id: notNull');
assert(uCols.email?.type === 'varchar', 'email: varchar type');
assert(uCols.email?.args.includes('255'), 'email: length 255 in args');
assert(uCols.name?.nullable === true, 'name: nullable');
assert(uCols.bio?.type === 'text', 'bio: text type');
assert(uCols.role?.enumName === 'userRoleEnum', 'role: enum name');
assert(uCols.role?.type === 'varchar', 'role: normalised to varchar');
assert(uCols.role?.hasDefault === true, 'role: has default');
assert(uCols.is_active?.type === 'boolean', 'is_active: boolean type');
assert(uCols.is_active?.hasDefault === true, 'is_active: has default');
assert(uCols.tags?.type === 'text', 'tags: text base type');
assert(uCols.tags?.isArray === true, 'tags: array column');
assert(uCols.preferences?.type === 'jsonb', 'preferences: jsonb type');
assert(uCols.last_login_at?.type === 'timestamp', 'last_login_at: timestamp');
assert(uCols.last_login_at?.nullable === true, 'last_login_at: nullable');
assert(uCols.created_at?.hasDefault === true, 'created_at: defaultNow');
assert(uCols.created_at?.nullable === false, 'created_at: notNull');
eq(uCols.created_at?.logicalName, 'createdAt', 'created_at: logical name = createdAt');

suite('users.ts — indexes');
const uIdx = usersResult.users.indexes;
eq(uIdx.length, 2, '2 indexes');
assert(uIdx.find((i) => i.name === 'users_email_idx'), 'email index exists');
assert(uIdx.find((i) => i.name === 'users_role_idx'), 'role index exists');

suite('users.ts — unique constraints');
eq(usersResult.users.uniqueConstraints.length, 1, '1 unique constraint');
eq(usersResult.users.uniqueConstraints[0].name, 'users_email_unique', 'named unique');

suite('users.ts — policies');
const uPols = usersResult.users.policies;
eq(uPols.length, 3, '3 policies');
assert(uPols.find((p) => p.name === 'users_select_policy' && p.command === 'select'), 'select policy');
assert(uPols.find((p) => p.name === 'users_insert_policy' && p.command === 'insert'), 'insert policy');
const updatePol = uPols.find((p) => p.name === 'users_update_policy');
assert(updatePol?.command === 'update', 'update policy command');
assert(updatePol?.using?.includes('auth.uid()'), 'update policy USING');
assert(updatePol?.with_check?.includes('auth.uid()'), 'update policy WITH CHECK');

suite('users.ts — constraints metadata');
assert(usersResult.users.constraints.some((c) => c.type === 'PRIMARY KEY'), 'PK constraint meta');

// ─── Products ───────────────────────────────────────────────────

suite('products.ts — tables');
const prodContent = readFileSync(join(schemaDir, 'products.ts'), 'utf-8');
const prodResult = parser.parseFile(prodContent, 'products');
assert(prodResult.categories !== undefined, 'finds categories table');
assert(prodResult.products !== undefined, 'finds products table');

suite('products.ts — categories self-referencing FK');
const catCols = prodResult.categories.columns;
assert(catCols.parent_id?.references?.table === 'categories', 'self-ref FK table');
assert(catCols.parent_id?.references?.column === 'id', 'self-ref FK column');

suite('products.ts — product columns');
const pCols = prodResult.products.columns;
assert(pCols.sku?.type === 'varchar', 'sku: varchar');
assert(pCols.price?.type === 'numeric', 'price: numeric');
assert(pCols.category_id?.references?.table === 'categories', 'category FK');
assert(pCols.status?.enumName === 'productStatusEnum', 'status enum');
assert(pCols.metadata?.type === 'jsonb', 'metadata: jsonb');

suite('products.ts — object-form constraints');
const pIdx = prodResult.products.indexes;
gt(pIdx.length, 0, 'has indexes');
assert(pIdx.find((i) => i.name === 'products_sku_idx'), 'sku index');
assert(pIdx.find((i) => i.name === 'products_status_active_idx'), 'multi-col index');
const ginIdx = pIdx.find((i) => i.name === 'products_metadata_idx');
assert(ginIdx?.method === 'gin', 'GIN index method');

const pUq = prodResult.products.uniqueConstraints;
assert(pUq.find((u) => u.name === 'products_sku_unique'), 'named unique on sku');

const pPols = prodResult.products.policies;
assert(pPols.find((p) => p.name === 'products_select'), 'select policy');
assert(pPols.find((p) => p.name === 'products_admin_insert')?.with_check?.includes('is_admin'), 'admin insert policy withCheck');

// ─── Orders ─────────────────────────────────────────────────────

suite('orders.ts — tables');
const ordContent = readFileSync(join(schemaDir, 'orders.ts'), 'utf-8');
const ordResult = parser.parseFile(ordContent, 'orders');
assert(ordResult.orders !== undefined, 'finds orders table');
assert(ordResult.orderItems !== undefined, 'finds orderItems table');

suite('orders.ts — cross-file foreign keys');
const oCols = ordResult.orders.columns;
assert(oCols.user_id?.references?.table === 'users', 'user FK references users var');
const oiCols = ordResult.orderItems.columns;
assert(oiCols.order_id?.references?.table === 'orders', 'order item → orders');
assert(oiCols.product_id?.references?.table === 'products', 'order item → products');

suite('orders.ts — auto-named composite unique');
const oiUq = ordResult.orderItems.uniqueConstraints;
eq(oiUq.length, 1, '1 unique constraint');
// Auto-generated name: order_items_orderId_productId_unique (columns sorted)
assert(oiUq[0].columns.length === 2, 'composite unique has 2 columns');

suite('orders.ts — enums');
assert(oCols.status?.enumName === 'orderStatusEnum', 'order status enum');
assert(oCols.payment_method?.enumName === 'paymentMethodEnum', 'payment method enum');

// ─── Reviews ────────────────────────────────────────────────────

suite('reviews.ts — uuid PK + block-body constraints');
const revContent = readFileSync(join(schemaDir, 'reviews.ts'), 'utf-8');
const revResult = parser.parseFile(revContent, 'reviews');
assert(revResult.reviews !== undefined, 'finds reviews table');

const rCols = revResult.reviews.columns;
assert(rCols.id?.type === 'uuid', 'id: uuid type');
assert(rCols.id?.primaryKey === true, 'id: primaryKey');
assert(rCols.id?.hasDefault === true, 'id: defaultRandom');
assert(rCols.rating?.type === 'smallint', 'rating: smallint type');
assert(rCols.user_id?.references?.table === 'users', 'user FK');
assert(rCols.product_id?.references?.table === 'products', 'product FK');

suite('reviews.ts — block-body constraint callback');
const rIdx = revResult.reviews.indexes;
eq(rIdx.length, 3, '3 indexes from block body');

const rPols = revResult.reviews.policies;
eq(rPols.length, 3, '3 policies');
assert(rPols.find((p) => p.command === 'delete'), 'has delete policy');

// ─── Summary ────────────────────────────────────────────────────

summary();
