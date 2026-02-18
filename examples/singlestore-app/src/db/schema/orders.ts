/**
 * Orders schema (SingleStore) — exercises:
 *   ✓ Multiple tables referencing other tables
 *   ✓ singlestoreEnum
 *   ✓ int / varchar / decimal / timestamp / json
 *
 * Note: SingleStore columnstore tables don't support secondary indexes,
 *       unique constraints (unless they include the shard key), or foreign keys.
 */

import {
  bigint,
  decimal,
  int,
  json,
  singlestoreEnum,
  singlestoreTable,
  timestamp,
  varchar,
} from 'drizzle-orm/singlestore-core'

// SingleStore doesn't support foreign keys — use application-level joins

// ── Orders ──────────────────────────────────────────────────────

export const orders = singlestoreTable('orders', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  orderNumber: varchar('order_number', { length: 30 }).notNull(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
  status: singlestoreEnum('status', [
    'pending',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'on_hold',
  ])
    .notNull()
    .default('pending'),
  paymentMethod: singlestoreEnum('payment_method', [
    'credit_card',
    'paypal',
    'bank_transfer',
    'crypto',
  ]),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  shippingAddress: json('shipping_address'),
  notes: varchar('notes', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Order Items ─────────────────────────────────────────────────

export const orderItems = singlestoreTable('order_items', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull(),
  productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull(),
  quantity: int('quantity').notNull().default(1),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
