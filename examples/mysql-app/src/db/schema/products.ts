/**
 * Products schema (MySQL) — exercises:
 *   ✓ Foreign keys (.references)
 *   ✓ decimal / int types
 *   ✓ Enum inline columns
 *   ✓ Multi-column index
 *   ✓ JSON column
 */

import {
  bigint,
  boolean,
  decimal,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

// ── Categories (self-referencing FK) ────────────────────────────

export const categories = mysqlTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  parentId: bigint('parent_id', { mode: 'number', unsigned: true }).references(() => categories.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Products ────────────────────────────────────────────────────

export const products = mysqlTable(
  'products',
  {
    id: serial('id').primaryKey(),
    sku: varchar('sku', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    categoryId: bigint('category_id', { mode: 'number', unsigned: true }).references(() => categories.id),
    status: mysqlEnum('status', ['draft', 'active', 'discontinued', 'archived'])
      .notNull()
      .default('draft'),
    metadata: json('metadata'),
    discount: decimal('discount', { precision: 5, scale: 2 }).default('0.00'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    skuIdx: index('products_sku_idx').on(t.sku),
    statusActiveIdx: index('products_status_active_idx').on(t.status, t.isActive),
    skuUnique: unique('products_sku_unique').on(t.sku),
    nameStatusIdx: index('products_name_status_idx').on(t.name, t.status),
  })
)
