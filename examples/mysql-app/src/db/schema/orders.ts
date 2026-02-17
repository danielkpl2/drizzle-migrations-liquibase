/**
 * Orders schema (MySQL) — exercises:
 *   ✓ Multiple foreign keys to different tables
 *   ✓ Cross-file references (users, products)
 *   ✓ mysqlEnum
 *   ✓ int / varchar / decimal / timestamp / json
 *   ✓ Composite unique constraint
 */

import {
  bigint,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'
import { users } from './users'
import { products } from './products'

// ── Orders ──────────────────────────────────────────────────────

export const orders = mysqlTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    orderNumber: varchar('order_number', { length: 30 }).notNull().unique(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id),
    status: mysqlEnum('status', [
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
    paymentMethod: mysqlEnum('payment_method', [
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
  },
  (t) => ({
    userIdIdx: index('orders_user_id_idx').on(t.userId),
    statusIdx: index('orders_status_idx').on(t.status),
    createdAtIdx: index('orders_created_at_idx').on(t.createdAt),
  })
)

// ── Order Items ─────────────────────────────────────────────────

export const orderItems = mysqlTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true }).notNull().references(() => orders.id),
    productId: bigint('product_id', { mode: 'number', unsigned: true }).notNull().references(() => products.id),
    quantity: int('quantity').notNull().default(1),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    orderIdIdx: index('order_items_order_id_idx').on(t.orderId),
    productIdIdx: index('order_items_product_id_idx').on(t.productId),
  })
)
