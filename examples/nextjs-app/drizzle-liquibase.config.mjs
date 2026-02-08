/** @type {import('drizzle-migrations-liquibase/config')} */
export default {
  schemaDir: './src/db/schema',
  schemaIndexFile: 'index.ts',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',
  timestampFormat: 'YYYYMMDDHHmmss',
  liquibaseMode: 'node',
  author: 'test-user',

  diff: {
    includePolicies: true,
    modifyPolicies: true,
    dropOrphanPolicies: true,
    dropOrphanIndexes: true,
    dropOrphanUniques: true,
  },
};
