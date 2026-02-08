/**
 * Reviews schema — exercises:
 *   ✓ Zero-arg column definitions: uuid(), text(), boolean(), timestamp()
 *   ✓ $defaultFn pattern
 *   ✓ smallint type
 *   ✓ Multiple FKs in one table
 *   ✓ Delete policy
 *   ✓ Block-body constraint callback (return [...])
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { products } from './products'

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id').notNull().references(() => users.id),
    productId: integer('product_id').notNull().references(() => products.id),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body'),
    isVerified: boolean('is_verified').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => {
    return [
      index('reviews_user_id_idx').on(t.userId),
      index('reviews_product_id_idx').on(t.productId),
      index('reviews_rating_idx').on(t.rating),

      pgPolicy('reviews_select', {
        for: 'select',
        to: ['authenticated', 'anon'],
        using: sql`true`,
      }),
      pgPolicy('reviews_insert', {
        for: 'insert',
        to: ['authenticated'],
        withCheck: sql`auth.uid()::int = user_id`,
      }),
      pgPolicy('reviews_delete', {
        for: 'delete',
        to: ['authenticated'],
        using: sql`auth.uid()::int = user_id`,
      }),
    ]
  }
)
