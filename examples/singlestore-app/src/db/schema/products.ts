/**
 * Products schema (SingleStore) — exercises:
 *   ✓ decimal / bigint types
 *   ✓ Enum inline columns
 *   ✓ JSON column
 *   ✓ boolean / timestamp
 *
 * Note: SingleStore columnstore tables don't support secondary indexes,
 *       unique constraints (unless they include the shard key), or foreign keys.
 */

import {
  bigint,
  boolean,
  decimal,
  int,
  json,
  singlestoreEnum,
  singlestoreTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/singlestore-core'

// ── Categories (self-referencing FK) ────────────────────────────

export const categories = singlestoreTable('categories', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  parentId: bigint('parent_id', { mode: 'number', unsigned: true }),  // no FK — SingleStore doesn't support foreign keys
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Products ────────────────────────────────────────────────────

export const products = singlestoreTable('products', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  sku: varchar('sku', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  categoryId: bigint('category_id', { mode: 'number', unsigned: true }),  // no FK — SingleStore doesn't support foreign keys
  status: singlestoreEnum('status', ['draft', 'active', 'discontinued', 'archived'])
    .notNull()
    .default('draft'),
  metadata: json('metadata'),
  discount: decimal('discount', { precision: 5, scale: 2 }).default('0.00'),
  isActive: boolean('is_active').notNull().default(false),
  // ── New columns ──
  weight: decimal('weight', { precision: 8, scale: 3 }),
  stockQuantity: int('stock_quantity').notNull().default(0),
  // ────────────────
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})
