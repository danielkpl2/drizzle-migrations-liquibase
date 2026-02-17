/**
 * Reviews schema (SQLite) — exercises:
 *   ✓ Multiple FKs in one table
 *   ✓ integer / text / boolean
 *   ✓ Index definitions
 */

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'
import { products } from './products'

export const reviews = sqliteTable(
  'reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    rating: integer('rating').notNull(),
    title: text('title'),
    body: text('body'),
    isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdIdx: index('reviews_user_id_idx').on(t.userId),
    productIdIdx: index('reviews_product_id_idx').on(t.productId),
    ratingIdx: index('reviews_rating_idx').on(t.rating),
  })
)
