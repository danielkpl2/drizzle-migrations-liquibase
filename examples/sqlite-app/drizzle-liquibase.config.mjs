/**
 * drizzle-migrations-liquibase configuration — SQLite example
 */
export default {
  schemaDir: './src/db/schema',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',

  // Database dialect — auto-detected from URL, but explicit here for clarity
  dialect: 'sqlite',

  // Use drizzle-kit engine for schema diffing
  engine: 'drizzle-kit',

  // SQLite database file (local dev — file-based, no server needed)
  databaseUrl: './drizzle_test.db',

  // Tables to exclude from drizzle-kit engine output
  excludeTables: [],
};
