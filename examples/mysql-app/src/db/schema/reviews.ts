/**
 * Reviews schema (MySQL) — exercises:
 *   ✓ Multiple FKs in one table
 *   ✓ tinyint / text / timestamp / boolean
 *   ✓ Index definitions
 */

import {
  bigint,
  boolean,
  index,
  mysqlTable,
  serial,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/mysql-core'
import { users } from './users'
import { products } from './products'

export const reviews = mysqlTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id),
    productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull().references(() => products.id),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body'),
    isVerified: boolean('is_verified').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    userIdIdx: index('reviews_user_id_idx').on(t.userId),
    productIdIdx: index('reviews_product_id_idx').on(t.productId),
    ratingIdx: index('reviews_rating_idx').on(t.rating),
  })
)
