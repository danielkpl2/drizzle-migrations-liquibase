/**
 * Reviews schema (SingleStore) — exercises:
 *   ✓ Multiple tables referencing other tables
 *   ✓ smallint / text / timestamp / boolean
 *
 * Note: SingleStore columnstore tables don't support secondary indexes,
 *       unique constraints (unless they include the shard key), or foreign keys.
 */

import {
  bigint,
  boolean,
  singlestoreTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/singlestore-core'

// SingleStore doesn't support foreign keys — use application-level joins

export const reviews = singlestoreTable('reviews', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  rating: smallint('rating').notNull(),
  title: text('title'),
  body: text('body'),
  isVerified: boolean('is_verified').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
