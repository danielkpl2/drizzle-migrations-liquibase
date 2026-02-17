/**
 * drizzle-migrations-liquibase configuration — MySQL example
 */
export default {
  schemaDir: './src/db/schema',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',

  // Database dialect — auto-detected from URL, but explicit here for clarity
  dialect: 'mysql',

  // Use drizzle-kit engine for schema diffing
  engine: 'drizzle-kit',

  // MySQL connection URL (local dev — no secrets)
  databaseUrl: 'mysql://root@localhost:3306/drizzle_test',

  // Tables to exclude from drizzle-kit engine output
  excludeTables: [],
};
