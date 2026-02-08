/**
 * Orders schema — exercises:
 *   ✓ Multiple foreign keys to different tables
 *   ✓ Cross-file references (users, products)
 *   ✓ pgEnum
 *   ✓ integer / varchar / numeric / timestamp / jsonb
 *   ✓ Composite unique constraint (multi-column, unnamed → auto-named)
 *   ✓ Constraints as array form
 *   ✓ Check constraints are gracefully ignored
 */

import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  serial,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { products } from './products'

// ── Enums ────────────────────────────────────────────────────────

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
])

export const paymentMethodEnum = pgEnum('payment_method', [
  'credit_card',
  'paypal',
  'bank_transfer',
  'crypto',
])

// ── Orders ──────────────────────────────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    orderNumber: varchar('order_number', { length: 30 }).notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id),
    status: orderStatusEnum('status').notNull().default('pending'),
    paymentMethod: paymentMethodEnum('payment_method'),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
    shippingAddress: jsonb('shipping_address'),
    notes: varchar('notes', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('orders_user_id_idx').on(t.userId),
    index('orders_status_idx').on(t.status),
    index('orders_created_at_idx').on(t.createdAt),

    pgPolicy('orders_select', {
      for: 'select',
      to: ['authenticated'],
      using: sql`auth.uid()::int = user_id`,
    }),
    pgPolicy('orders_insert', {
      for: 'insert',
      to: ['authenticated'],
      withCheck: sql`auth.uid()::int = user_id`,
    }),
  ]
)

// ── Order Items (junction table with cross-file FKs) ────────────

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id').notNull().references(() => orders.id),
    productId: integer('product_id').notNull().references(() => products.id),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_product_id_idx').on(t.productId),
    // Auto-named composite unique
    unique().on(t.orderId, t.productId),
  ]
)
