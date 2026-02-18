/**
 * Users schema (SingleStore) — exercises:
 *   ✓ bigint auto_increment / varchar / text / boolean / timestamp
 *   ✓ singlestoreEnum
 *   ✓ .notNull(), .primaryKey(), .default(), .defaultNow()
 *   ✓ json column
 *
 * Note: SingleStore columnstore tables don't support secondary indexes,
 *       unique constraints (unless they include the shard key), or foreign keys.
 */

import {
  bigint,
  boolean,
  int,
  json,
  singlestoreEnum,
  singlestoreTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/singlestore-core'

// ── Inline Enum ──────────────────────────────────────────────────

// SingleStore enums are inline column types (same as MySQL), not standalone CREATE TYPE

// ── Table ────────────────────────────────────────────────────────

export const users = singlestoreTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }),
  bio: text('bio'),
  role: singlestoreEnum('role', ['admin', 'member', 'guest']).notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  preferences: json('preferences'),
  phone: varchar('phone', { length: 20 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  loginCount: int('login_count').notNull().default(0),
  lastLoginAt: timestamp('last_login_at'),
  // ── New columns ──
  address: text('address'),
  dateOfBirth: varchar('date_of_birth', { length: 10 }),
  // ────────────────
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
