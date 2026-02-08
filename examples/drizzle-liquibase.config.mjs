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
  diff: {
    includePolicies: true,
    modifyPolicies: false,
    dropOrphanPolicies: false,
    dropOrphanIndexes: false,
    dropOrphanUniques: false,
  },
};
