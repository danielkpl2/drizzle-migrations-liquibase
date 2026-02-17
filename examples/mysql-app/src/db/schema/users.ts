/**
 * Users schema (MySQL) — exercises:
 *   ✓ serial (auto_increment) / varchar / text / boolean / timestamp
 *   ✓ mysqlEnum
 *   ✓ .notNull(), .primaryKey(), .unique(), .default(), .defaultNow()
 *   ✓ index (btree default)
 *   ✓ unique constraint
 *   ✓ json column
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

// ── Inline Enum ──────────────────────────────────────────────────

// MySQL enums are inline column types, not standalone CREATE TYPE

// ── Table ────────────────────────────────────────────────────────

export const users = mysqlTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }),
    bio: text('bio'),
    role: mysqlEnum('role', ['admin', 'member', 'guest']).notNull().default('member'),
    isActive: boolean('is_active').notNull().default(true),
    preferences: json('preferences'),
    phone: varchar('phone', { length: 20 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    loginCount: int('login_count').notNull().default(0),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    emailUnique: unique('users_email_unique').on(t.email),
  })
)
