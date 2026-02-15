/** @type {import('drizzle-migrations-liquibase/config')} */
export default {
  schemaDir: './src/db/schema',
  schemaIndexFile: 'index.ts',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',
  timestampFormat: 'YYYYMMDDHHmmss',
  liquibaseMode: 'node',
  author: 'test-user',

  // Tables to exclude from drizzle-kit engine output (in addition to
  // Liquibase's own tracking tables which are always excluded)
  excludeTables: [],

  // Database schemas to include in drizzle-kit introspection (default: ['public'])
  // schemas: ['public'],

  diff: {
    includePolicies: true,
    modifyPolicies: true,
    dropOrphanPolicies: true,
    dropOrphanIndexes: true,
    dropOrphanUniques: true,
  },
};
