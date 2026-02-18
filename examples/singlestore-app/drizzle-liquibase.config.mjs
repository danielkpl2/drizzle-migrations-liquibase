/**
 * drizzle-migrations-liquibase configuration — SingleStore example
 *
 * NOTE: Special characters in the password (: @ { } etc.) must be
 * percent-encoded in the URL.  Example:
 *   node -e "console.log(encodeURIComponent('my:pass@word'))"
 */
export default {
  schemaDir: './src/db/schema',
  migrationsDir: './liquibase/migrations',
  masterChangelog: './liquibase/master-changelog.xml',

  // Dialect auto-detects from singlestore:// URL scheme, but explicit here for clarity
  dialect: 'singlestore',

  // Use drizzle-kit engine (required for SingleStore)
  engine: 'drizzle-kit',

  // Connection URL — uses singlestore:// scheme (auto-rewritten to mysql:// for the driver)
  // Percent-encode special chars in the password:
  //   node -e "console.log(encodeURIComponent('your-password'))"
  databaseUrl: 'singlestore://user:password@your-host.svc.singlestore.com:3333/your_database',

  // Tables to exclude from drizzle-kit engine output (none currently)
  excludeTables: [],
};
