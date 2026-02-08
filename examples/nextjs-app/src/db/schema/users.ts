/**
 * Users schema — exercises:
 *   ✓ serial / varchar / text / boolean / timestamp / uuid / jsonb
 *   ✓ named physical columns (different from logical)
 *   ✓ .notNull(), .primaryKey(), .unique(), .default(), .defaultRandom(), .defaultNow()
 *   ✓ .array() columns
 *   ✓ pgEnum
 *   ✓ pgPolicy with using / withCheck
 *   ✓ index (btree default)
 *   ✓ unique constraint (named and unnamed)
 *   ✓ .enableRLS chain on pgTable()
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ── Enum ─────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['admin', 'member', 'guest'])

// ── Table ────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('public_id').defaultRandom().notNull().unique(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }),
    bio: text('bio'),
    role: userRoleEnum('role').notNull().default('member'),
    isActive: boolean('is_active').notNull().default(true),
    tags: text('tags').array(),
    preferences: jsonb('preferences'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('users_email_idx').on(t.email),
    index('users_role_idx').on(t.role),
    unique('users_email_unique').on(t.email),

    // RLS policies
    pgPolicy('users_select_policy', {
      for: 'select',
      to: ['authenticated', 'anon'],
      using: sql`true`,
    }),
    pgPolicy('users_insert_policy', {
      for: 'insert',
      to: ['authenticated'],
      withCheck: sql`auth.uid() = public_id`,
    }),
    pgPolicy('users_update_policy', {
      for: 'update',
      to: ['authenticated'],
      using: sql`auth.uid() = public_id`,
      withCheck: sql`auth.uid() = public_id`,
    }),
  ]
).enableRLS
