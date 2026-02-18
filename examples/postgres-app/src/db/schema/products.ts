/**
 * Products schema — exercises:
 *   ✓ Foreign keys (.references)
 *   ✓ numeric / real / doublePrecision types
 *   ✓ Enum references across files
 *   ✓ GIN index (non-default method)
 *   ✓ Multi-column index
 *   ✓ pgPolicy with admin-only write access
 *   ✓ Constraints as object literal form (not array)
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

// ── Enums ────────────────────────────────────────────────────────

export const productStatusEnum = pgEnum('product_status', [
  'draft',
  'active',
  'discontinued',
  'archived',
])

export const categoryEnum = pgEnum('product_category', [
  'electronics',
  'clothing',
  'food',
  'health',
  'other',
])

// ── Categories (self-referencing FK) ────────────────────────────

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  parentId: integer('parent_id').references(() => categories.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Products (object-form constraints) ──────────────────────────

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    sku: varchar('sku', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    status: productStatusEnum('status').notNull().default('draft'),
    weight: numeric('weight', { precision: 8, scale: 3 }),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    metadata: jsonb('metadata'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    // Named index
    skuIdx: index('products_sku_idx').on(t.sku),
    // Multi-column index
    statusActiveIdx: index('products_status_active_idx').on(t.status, t.isActive),
    // GIN index on metadata
    metadataIdx: index('products_metadata_idx').using('gin', t.metadata),
    // Unique on sku
    skuUnique: unique('products_sku_unique').on(t.sku),

    // Policies
    selectPolicy: pgPolicy('products_select', {
      for: 'select',
      to: ['authenticated', 'anon'],
      using: sql`true`,
    }),
    insertPolicy: pgPolicy('products_admin_insert', {
      for: 'insert',
      to: ['authenticated'],
      withCheck: sql`is_admin(auth.uid())`,
    }),
  })
)
