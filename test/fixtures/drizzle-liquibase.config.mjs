/** @type {import('drizzle-migrations-liquibase/config')} */
export default {
  schemaDir: './schema',
  schemaIndexFile: 'index.ts',
  migrationsDir: './migrations',
  masterChangelog: './master-changelog.xml',
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
