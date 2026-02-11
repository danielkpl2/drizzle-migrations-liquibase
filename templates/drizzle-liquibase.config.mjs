/**
 * drizzle-migrations-liquibase configuration
 *
 * This file configures the bridge between Drizzle ORM and Liquibase.
 * Copy this to your project root as: drizzle-liquibase.config.mjs
 *
 * @see https://github.com/danielkpl2/drizzle-migrations-liquibase
 */
export default {
  // =========================================================================
  // REQUIRED — Path to your Drizzle schema directory
  // =========================================================================
  // This directory must contain an index.ts that re-exports all schema files:
  //   export * from './users'
  //   export * from './products'
  //   ...
  schemaDir: './src/schema',

  // =========================================================================
  // Migration output
  // =========================================================================

  // Directory where Liquibase migration SQL files are generated
  migrationsDir: './liquibase/migrations',

  // Path to the Liquibase master changelog XML
  masterChangelog: './liquibase/master-changelog.xml',

  // =========================================================================
  // Database connection
  // =========================================================================

  // PostgreSQL connection URL. Can also be set via:
  //   - MIGRATION_DATABASE_URL env var (preferred for migrations)
  //   - DATABASE_URL env var (fallback)
  //
  // Standard format:
  //   postgresql://user:password@host:port/dbname
  //
  // The tool automatically converts this to JDBC format for Liquibase.
  // You can also pass a JDBC URL directly if preferred:
  //   jdbc:postgresql://host:port/dbname?user=X&password=Y
  //
  // databaseUrl: process.env.DATABASE_URL,

  // =========================================================================
  // Timestamp format
  // =========================================================================

  // Pattern for migration filename timestamps.
  // Tokens: YYYY, MM, DD, HH, mm, ss, SSS
  //
  // Default: 'YYYYMMDDHHmmss' → 20250710092120
  //
  // Other examples:
  //   'YYYYMMDDHHmmssSSS'   → 20250710092120456   (with milliseconds)
  //   'YYYYMMDD_HHmmss'     → 20250710_092120      (with separator)
  timestampFormat: 'YYYYMMDDHHmmss',

  // =========================================================================
  // Liquibase execution mode
  // =========================================================================

  // How to run Liquibase:
  //   'node'   — via the `liquibase` npm package (default, zero system deps)
  //   'cli'    — via a system-installed `liquibase` binary
  //   'docker' — via the official liquibase/liquibase Docker image
  liquibaseMode: 'node',

  // =========================================================================
  // Author
  // =========================================================================

  // Changeset author written into migration files.
  // null = auto-detect from git config user.email → git user.name → $USER
  author: null,

  // =========================================================================
  // Schema diff options
  // =========================================================================
  diff: {
    // Include RLS policies in the diff
    includePolicies: true,

    // Detect and generate ALTER for modified policies
    // (disabled by default — policy diff is hard to get right semantically)
    modifyPolicies: false,

    // Drop policies that exist in DB but not in schema
    dropOrphanPolicies: false,

    // Drop indexes that exist in DB but not in schema
    dropOrphanIndexes: false,

    // Drop unique constraints that exist in DB but not in schema
    dropOrphanUniques: false,
  },
};
