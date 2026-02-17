/**
 * Products schema (SQLite) — exercises:
 *   ✓ Foreign keys (.references)
 *   ✓ real / integer types
 *   ✓ Text enum columns
 *   ✓ Multi-column index
 */

import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ── Categories (self-referencing FK) ────────────────────────────

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 100 }).notNull(),
  slug: text('slug', { length: 100 }).notNull().unique(),
  parentId: integer('parent_id').references(() => categories.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ── Products ────────────────────────────────────────────────────

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sku: text('sku', { length: 50 }).notNull(),
    name: text('name', { length: 255 }).notNull(),
    description: text('description'),
    price: real('price').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    status: text('status', { enum: ['draft', 'active', 'discontinued', 'archived'] })
      .notNull()
      .default('draft'),
    metadata: text('metadata', { mode: 'json' }),
    discount: real('discount').default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (t) => ({
    skuIdx: index('products_sku_idx').on(t.sku),
    statusActiveIdx: index('products_status_active_idx').on(t.status, t.isActive),
    skuUnique: uniqueIndex('products_sku_unique').on(t.sku),
    nameStatusIdx: index('products_name_status_idx').on(t.name, t.status),
  })
)
