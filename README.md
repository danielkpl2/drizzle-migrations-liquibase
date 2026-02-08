# drizzle-migrations-liquibase

**Bridge between [Drizzle ORM](https://orm.drizzle.team/) and [Liquibase](https://www.liquibase.com/)** — keep using Drizzle for your schemas and queries, delegate all migration management to Liquibase.

## Why?

Drizzle Kit's built-in migration system relies on a **journal file** and a **linked-list** structure where each migration references the previous one. This works fine for solo developers, but quickly becomes **chaotic in teams**:

- Multiple developers generating migrations in parallel creates conflicts
- Journal entries must be regenerated when migrations are reordered or merged
- No built-in rollback support
- No concept of migration checksums or verification

**Liquibase** is a battle-tested migration manager (used across Java, .NET, Python, and Node.js ecosystems) that solves all of these problems:

- ✅ **No linked-list / journal** — each migration is independent, referenced in a master changelog
- ✅ **Team-friendly** — multiple developers can generate migrations simultaneously without conflicts
- ✅ **Rollback support** — every migration can define rollback statements
- ✅ **Checksum verification** — Liquibase tracks MD5 checksums to detect if applied migrations were modified
- ✅ **Proven at scale** — used by thousands of enterprises for 15+ years

This package lets you continue using **Drizzle ORM** (just the ORM — schemas, queries, relations) while delegating **all migration work** to Liquibase.

## How It Works

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────────┐
│  Drizzle Schema │────▶│  Schema Diff Engine   │────▶│  Liquibase SQL │
│  (*.ts files)   │     │  (compares schema     │     │  Migration     │
│                 │     │   vs live database)   │     │  (with rollback)│
└─────────────────┘     └──────────────────────┘     └────────┬───────┘
                                                              │
┌─────────────────┐     ┌──────────────────────┐              │
│  PostgreSQL DB  │◀────│  Liquibase Runner    │◀─────────────┘
│                 │     │  (node/cli/docker)    │
└─────────────────┘     └──────────────────────┘
```

1. You define your schema using **Drizzle ORM's `pgTable()`** syntax
2. The **generate** command compares your schema files against the live database
3. It produces a **Liquibase-formatted SQL migration** with rollback statements
4. The **update** command applies pending migrations via Liquibase
5. Liquibase tracks what's been applied in its own `databasechangelog` table

## Features

- 🔄 **Auto-diff** — detects tables, columns, indexes, foreign keys, unique constraints, and RLS policies
- ↕️ **Bidirectional** — normal mode (schema → DB) and reverse mode (DB → schema)
- 📝 **Rollback generation** — automatic rollback SQL for every change
- 📋 **Master changelog** — automatically maintained XML changelog
- 🔧 **Three Liquibase modes** — node (npm package), CLI (system binary), or Docker
- 🔒 **Security** — SQL identifier escaping, injection prevention, input validation
- 🐘 **PostgreSQL** — tested and optimised for PostgreSQL (the only supported database currently)

## Quick Start

### 1. Install

```bash
npm install drizzle-migrations-liquibase
# or
pnpm add drizzle-migrations-liquibase
# or
yarn add drizzle-migrations-liquibase
```

> **Peer dependency**: You also need `drizzle-orm` installed. The `liquibase` npm package is optional — only needed if you use `liquibaseMode: 'node'` (the default).

```bash
npm install drizzle-orm liquibase
```

### 2. Initialise

```bash
npx drizzle-liquibase init
```

This creates:
- `drizzle-liquibase.config.mjs` — configuration file
- `liquibase/master-changelog.xml` — master changelog
- `liquibase/migrations/` — directory for migration files

### 3. Configure

Edit `drizzle-liquibase.config.mjs`:

```js
export default {
  // REQUIRED: path to your Drizzle schema directory
  schemaDir: './src/schema',

  // Database URL (or set DATABASE_URL env var)
  databaseUrl: process.env.DATABASE_URL,

  // Execution mode: 'node' | 'cli' | 'docker'
  liquibaseMode: 'node',
};
```

### 4. Generate a migration

```bash
npx drizzle-liquibase generate add_users_table
```

This:
1. Reads your Drizzle schema files
2. Connects to the database and introspects the current schema
3. Computes the diff
4. Generates `liquibase/migrations/20250710092120_add_users_table.sql`
5. Updates `liquibase/master-changelog.xml`

### 5. Apply migrations

```bash
npx drizzle-liquibase update
```

## Schema Directory Structure

Your Drizzle schema directory must have an `index.ts` that re-exports all schema files:

```
src/schema/
  index.ts          ← re-exports all schema files
  users.ts
  products.ts
  orders.ts
```

**index.ts**:
```ts
export * from './users'
export * from './products'
export * from './orders'
```

**users.ts**:
```ts
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

## Commands

| Command | Description |
|---------|-------------|
| `npx drizzle-liquibase init` | Scaffold config and directory structure |
| `npx drizzle-liquibase generate <name>` | Generate migration from schema diff |
| `npx drizzle-liquibase generate <name> --reverse` | Generate migration for DB-only objects |
| `npx drizzle-liquibase update` | Apply all pending migrations |
| `npx drizzle-liquibase status` | Show pending/applied migration status |
| `npx drizzle-liquibase validate` | Validate the master changelog |
| `npx drizzle-liquibase rollback <count>` | Rollback the last N changesets |
| `npx drizzle-liquibase history` | Show applied migration history |
| `npx drizzle-liquibase tag <name>` | Tag current database state |
| `npx drizzle-liquibase updateSQL` | Preview SQL without executing |

### Package.json scripts (optional)

Add these to your `package.json` for convenience:

```json
{
  "scripts": {
    "liquibase:generate": "drizzle-liquibase generate",
    "liquibase:generate:reverse": "drizzle-liquibase generate --reverse",
    "liquibase:update": "drizzle-liquibase update",
    "liquibase:status": "drizzle-liquibase status",
    "liquibase:rollback": "drizzle-liquibase rollback",
    "liquibase:history": "drizzle-liquibase history",
    "liquibase:validate": "drizzle-liquibase validate"
  }
}
```

Then:
```bash
pnpm liquibase:generate add_users_table
pnpm liquibase:update
pnpm liquibase:status
pnpm liquibase:rollback 1
```

## Configuration Reference

Create `drizzle-liquibase.config.mjs` in your project root:

```js
export default {
  // REQUIRED — path to your Drizzle schema directory (with index.ts)
  schemaDir: './src/schema',

  // Name of the index file in schemaDir (default: 'index.ts')
  schemaIndexFile: 'index.ts',

  // Directory for generated migration files
  migrationsDir: './liquibase/migrations',

  // Path to the master changelog XML
  masterChangelog: './liquibase/master-changelog.xml',

  // Database connection URL
  // Also reads from: MIGRATION_DATABASE_URL, DATABASE_URL env vars
  databaseUrl: null,

  // Timestamp pattern for filenames (default: 'YYYYMMDDHHmmss')
  // Tokens: YYYY, MM, DD, HH, mm, ss, SSS
  timestampFormat: 'YYYYMMDDHHmmss',

  // Liquibase execution mode: 'node' | 'cli' | 'docker'
  liquibaseMode: 'node',

  // Changeset author (null = auto-detect from git / $USER)
  author: null,

  // Schema diff options
  diff: {
    includePolicies: true,      // Include RLS policies in diff
    modifyPolicies: false,      // Detect modified policies
    dropOrphanPolicies: false,  // Drop policies not in schema
    dropOrphanIndexes: false,   // Drop indexes not in schema
    dropOrphanUniques: false,   // Drop unique constraints not in schema
  },
}
```

### Database URL

The tool accepts a standard PostgreSQL connection URL:

```
postgresql://user:password@host:port/dbname
```

It automatically converts this to JDBC format for Liquibase:

```
jdbc:postgresql://host:port/dbname?user=X&password=Y&sslmode=require
```

You can also provide a JDBC URL directly if preferred.

**Priority order for database URL**:
1. `databaseUrl` in config file
2. `MIGRATION_DATABASE_URL` environment variable
3. `DATABASE_URL` environment variable

> **Tip**: Use a separate `MIGRATION_DATABASE_URL` pointing to a session pooler (port 5432) for migrations, while your app uses a transaction pooler (port 6543) at runtime. Migrations need session-level features that transaction poolers don't support.

## Liquibase Execution Modes

### Node (default)

Uses the [`liquibase` npm package](https://www.npmjs.com/package/liquibase). No system dependencies required.

```js
{ liquibaseMode: 'node' }
```

### CLI

Uses a system-installed Liquibase binary. Install via:
- macOS: `brew install liquibase`
- Linux: [Official install guide](https://docs.liquibase.com/install/home.html)
- Windows: `choco install liquibase` or download from liquibase.com

```js
{ liquibaseMode: 'cli' }
```

### Docker

Uses the official `liquibase/liquibase` Docker image. No installation needed beyond Docker itself.

```js
{ liquibaseMode: 'docker' }
```

The tool automatically:
- Mounts your `liquibase/` directory into the container
- Rewrites `localhost`/`127.0.0.1` to `host.docker.internal`

## Migration File Format

Generated migrations use the **Liquibase Formatted SQL** format:

```sql
--liquibase formatted sql

--changeset daniel:create_users_table splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

--rollback DROP TABLE IF EXISTS "users";
--rollback --> statement-breakpoint
```

See [MIGRATION-FORMAT.md](./MIGRATION-FORMAT.md) for the complete format specification and conversion guide.

## Reverse Mode

Generate migrations for objects that exist in the database but aren't in your Drizzle schema:

```bash
npx drizzle-liquibase generate db_only_objects --reverse
```

This is useful for:
- Documenting manually-applied changes
- Capturing database objects created outside of Drizzle (triggers, functions, etc.)
- Auditing schema drift

---

## Migrating from Drizzle Kit to Liquibase

If you're currently using Drizzle Kit's built-in migration system (`drizzle-kit generate` / `drizzle-kit migrate`) and want to switch to Liquibase, follow this guide.

### Overview

1. Rewrite existing migrations in Liquibase format
2. Register them as already-applied in Liquibase's tracking table
3. Remove Drizzle Kit migration artifacts
4. Start using `drizzle-liquibase` going forward

### Step 1: Install and initialise

```bash
npm install drizzle-migrations-liquibase liquibase
npx drizzle-liquibase init
```

Edit `drizzle-liquibase.config.mjs` with your schema directory and database URL.

### Step 2: Convert existing migrations

Your Drizzle Kit migrations live in (typically) `drizzle/` or a configured output directory. Each `.sql` file needs to be converted to the Liquibase format.

See [MIGRATION-FORMAT.md](./MIGRATION-FORMAT.md) for detailed conversion rules. The key changes:

1. Add the Liquibase header (`--liquibase formatted sql`)
2. Add a changeset declaration (`--changeset author:id ...`)
3. Replace statement separators with `--> statement-breakpoint`
4. Add `IF NOT EXISTS` / `IF EXISTS` for idempotency
5. Add rollback statements
6. Rename files from `0001_name.sql` to `<timestamp>_name.sql`

Place the converted files in `liquibase/migrations/` and add each to `liquibase/master-changelog.xml`.

### Step 3: Mark migrations as already applied

Since these migrations have already been run against your database, you need to tell Liquibase they're done without re-executing them. There are two approaches:

#### Option A: Use `changelogSync` (recommended)

This tells Liquibase to mark all pending changesets as executed:

```bash
npx drizzle-liquibase changelogSync
```

This populates the `databasechangelog` table with entries for every changeset, including the correct checksums — without executing any SQL.

#### Option B: Manual SQL insert

If you need fine-grained control, you can manually insert records into the `databasechangelog` table:

```sql
-- Liquibase creates this table automatically on first run.
-- If it doesn't exist yet, run: npx drizzle-liquibase update (it will create the table)
-- Or create it manually:

CREATE TABLE IF NOT EXISTS databasechangelog (
    id VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    dateexecuted TIMESTAMP NOT NULL,
    orderexecuted INTEGER NOT NULL,
    exectype VARCHAR(10) NOT NULL,
    md5sum VARCHAR(35),
    description VARCHAR(255),
    comments VARCHAR(255),
    tag VARCHAR(255),
    liquibase VARCHAR(20),
    contexts VARCHAR(255),
    labels VARCHAR(255),
    deployment_id VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS databasechangeloglock (
    id INTEGER NOT NULL PRIMARY KEY,
    locked BOOLEAN NOT NULL,
    lockgranted TIMESTAMP,
    lockedby VARCHAR(255)
);

INSERT INTO databasechangeloglock (id, locked) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
```

Then for each migration:
```sql
INSERT INTO databasechangelog (id, author, filename, dateexecuted, orderexecuted, exectype, md5sum, description, comments, liquibase)
VALUES (
  'create_users_table',                              -- changeset id
  'daniel',                                           -- changeset author
  'migrations/20250705123138_create_users_table.sql', -- filename relative to changelog
  NOW(),                                              -- dateexecuted
  1,                                                  -- orderexecuted (increment for each)
  'EXECUTED',                                         -- exectype
  NULL,                                               -- md5sum (NULL = Liquibase recalculates on next run)
  'sql',                                              -- description
  '',                                                 -- comments
  '4.28.0'                                            -- liquibase version
);
```

> **About checksums**: When `md5sum` is `NULL`, Liquibase will compute and store the checksum on the next `update` or `status` run. This is the safest approach — you don't need to compute checksums manually. Alternatively, running `changelogSync` (Option A) handles checksums automatically.

### Step 4: Verify

```bash
# Should show all migrations as already applied
npx drizzle-liquibase status

# Should show the history of applied migrations
npx drizzle-liquibase history
```

### Step 5: Clean up Drizzle Kit artifacts

Once verified, you can remove:
- `drizzle/` directory (or wherever Drizzle Kit stored migrations)
- `drizzle/meta/` journal files
- `drizzle-kit` from your dependencies (if you're not using it for anything else)
- `drizzle.config.ts` migration-related settings

**Keep**:
- Your Drizzle ORM schema files (`src/schema/`)
- `drizzle-orm` dependency
- `drizzle.config.ts` if you use Drizzle Studio or other non-migration features

### Step 6: Going forward

```bash
# Make schema changes in your Drizzle .ts files, then:
npx drizzle-liquibase generate describe_your_change

# Review the generated migration
cat liquibase/migrations/20250710_describe_your_change.sql

# Apply to database
npx drizzle-liquibase update
```

---

## Team Workflow

The key advantage of this setup is **parallel migration generation**:

1. **Developer A** adds a `users` table to the schema and generates a migration
2. **Developer B** adds a `products` table and generates a migration (independently)
3. Both migrations get unique timestamps and are added to `master-changelog.xml`
4. On merge, both migrations exist side-by-side — no journal conflicts
5. `npx drizzle-liquibase update` applies them in chronological order

### Merge conflicts

The only file that might have a merge conflict is `master-changelog.xml`. Since each entry is a single `<include>` line with a timestamp, these are trivial to resolve — just keep both lines in chronological order.

---

## Programmatic API

```js
import { SchemaDiffGenerator, runLiquibase, loadConfig } from 'drizzle-migrations-liquibase';

// Generate a migration programmatically
const generator = new SchemaDiffGenerator({
  name: 'add_users_table',
  projectRoot: '/path/to/project',
});
await generator.run();

// Run Liquibase commands programmatically
await runLiquibase('update', [], { projectRoot: '/path/to/project' });
await runLiquibase('status', [], { projectRoot: '/path/to/project' });
await runLiquibase('rollbackCount', ['1'], { projectRoot: '/path/to/project' });
```

---

## Supported Database Features

| Feature | Forward (schema→DB) | Reverse (DB→schema) |
|---------|:-------------------:|:-------------------:|
| CREATE TABLE | ✅ | ✅ |
| DROP TABLE | ✅ | — |
| ADD COLUMN | ✅ | ✅ |
| DROP COLUMN | ✅ | — |
| ALTER COLUMN (type) | ✅ | — |
| ALTER COLUMN (nullability) | ✅ | — |
| Foreign Keys | ✅ | ✅ |
| Indexes | ✅ | ✅ |
| Unique Constraints | ✅ | ✅ |
| RLS Policies | ✅ | ✅ |
| Enums | ✅ (as varchar) | ✅ |
| Arrays | ✅ | ✅ |

---

## Limitations

- **PostgreSQL only** — the schema introspection and SQL generation are PostgreSQL-specific
- **Schema parsing is regex-based** — it reads your TypeScript schema files as text (doesn't compile them), so very complex/dynamic schema definitions may not be parsed correctly
- **Enum types** — currently treated as `varchar` for comparison purposes (values are not diffed)
- **Custom SQL** — triggers, functions, and other database objects not defined via `pgTable()` are not detected by the diff engine (use `--reverse` mode or manual migrations)

---

## License

MIT
