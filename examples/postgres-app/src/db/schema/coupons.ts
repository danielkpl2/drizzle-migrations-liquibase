/**
 * Coupons schema — exercises:
 *   ✓ New table added in second migration
 *   ✓ numeric / varchar / boolean / timestamp / integer
 *   ✓ Default values
 *   ✓ pgEnum
 */

import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// ── Enum ─────────────────────────────────────────────────────────

export const discountTypeEnum = pgEnum('discount_type', ['percentage', 'fixed_amount'])

// ── Table ────────────────────────────────────────────────────────

export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  discountType: discountTypeEnum('discount_type').notNull(),
  discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
  maxUses: integer('max_uses'),
  currentUses: integer('current_uses').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
