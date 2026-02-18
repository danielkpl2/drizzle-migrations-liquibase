/**
 * Coupons schema (SingleStore) — new table added in second migration.
 *   ✓ varchar / decimal / int / timestamp / boolean
 *   ✓ singlestoreEnum
 *
 * Note: SingleStore columnstore tables don't support secondary indexes,
 *       unique constraints (unless they include the shard key), or foreign keys.
 */

import {
  bigint,
  boolean,
  decimal,
  int,
  singlestoreEnum,
  singlestoreTable,
  timestamp,
  varchar,
} from 'drizzle-orm/singlestore-core'

export const coupons = singlestoreTable('coupons', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  description: varchar('description', { length: 255 }),
  discountType: singlestoreEnum('discount_type', ['percentage', 'fixed_amount']).notNull(),
  discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull(),
  minOrderAmount: decimal('min_order_amount', { precision: 10, scale: 2 }),
  maxUses: int('max_uses'),
  currentUses: int('current_uses').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  startsAt: timestamp('starts_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
