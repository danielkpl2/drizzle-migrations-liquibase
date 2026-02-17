/**
 * Orders schema (SQLite) — exercises:
 *   ✓ Multiple foreign keys to different tables
 *   ✓ Cross-file references (users, products)
 *   ✓ Text enum columns
 *   ✓ integer / text / real / timestamp
 */

import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { users } from './users'
import { products } from './products'

// ── Orders ──────────────────────────────────────────────────────

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderNumber: text('order_number', { length: 30 }).notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', {
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    })
      .notNull()
      .default('pending'),
    paymentMethod: text('payment_method', {
      enum: ['credit_card', 'paypal', 'bank_transfer', 'crypto'],
    }),
    totalAmount: real('total_amount').notNull(),
    shippingAddress: text('shipping_address', { mode: 'json' }),
    notes: text('notes', { length: 500 }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    orderNumberUnique: uniqueIndex('orders_order_number_unique').on(t.orderNumber),
    userIdIdx: index('orders_user_id_idx').on(t.userId),
    statusIdx: index('orders_status_idx').on(t.status),
    createdAtIdx: index('orders_created_at_idx').on(t.createdAt),
  })
)

// ── Order Items ─────────────────────────────────────────────────

export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    orderIdIdx: index('order_items_order_id_idx').on(t.orderId),
    productIdIdx: index('order_items_product_id_idx').on(t.productId),
  })
)
