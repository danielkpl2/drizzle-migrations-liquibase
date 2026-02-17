/**
 * Users schema (SQLite) — exercises:
 *   ✓ integer (autoincrement) / text / blob
 *   ✓ .notNull(), .primaryKey(), .unique(), .default()
 *   ✓ index
 *   ✓ unique constraint
 */

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    name: text('name', { length: 100 }),
    bio: text('bio'),
    role: text('role', { enum: ['admin', 'member', 'guest'] })
      .notNull()
      .default('member'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    preferences: text('preferences', { mode: 'json' }),
    phone: text('phone', { length: 20 }),
    avatarUrl: text('avatar_url', { length: 500 }),
    loginCount: integer('login_count').notNull().default(0),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
  })
)
