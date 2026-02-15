/**
 * Example drizzle-liquibase.config.mjs
 *
 * Copy to your project root and adjust paths.
 */
export default {
  schemaDir: './src/schema',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',
  databaseUrl: process.env.DATABASE_URL,
  timestampFormat: 'YYYYMMDDHHmmss',
  liquibaseMode: 'node',
  author: null,

  // Tables to exclude from drizzle-kit engine output (in addition to
  // Liquibase's own tracking tables which are always excluded)
  excludeTables: [],

  // Database schemas to include in drizzle-kit introspection (default: ['public'])
  // schemas: ['public'],

  diff: {
    includePolicies: true,
    modifyPolicies: false,
    dropOrphanPolicies: false,
    dropOrphanIndexes: false,
    dropOrphanUniques: false,
  },
};
