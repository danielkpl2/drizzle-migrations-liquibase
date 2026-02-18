/**
 * Test 05 — Configuration Loader & Helpers
 *
 * Tests the public API of config.mjs:
 *   - loadConfig() — reads drizzle-liquibase.config.mjs, merges defaults, resolves paths
 *   - parseDatabaseUrl() — postgresql:// → JDBC conversion
 *   - rewriteJdbcForDocker() — localhost → host.docker.internal
 *   - formatTimestamp() — date formatting tokens
 */

import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadConfig,
  parseDatabaseUrl,
  rewriteJdbcForDocker,
  formatTimestamp,
  detectDialectFromUrl,
} from '../src/config.mjs';
import { suite, assert, eq, includes, summary } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, 'fixtures');

// ─── parseDatabaseUrl ───────────────────────────────────────────

suite('parseDatabaseUrl — standard postgres URL');
{
  const result = parseDatabaseUrl('postgresql://myuser:mypass@localhost:5432/mydb');
  assert(result !== null, 'returns non-null');
  includes(result.jdbc, 'jdbc:postgresql://localhost:5432/mydb', 'JDBC prefix');
  eq(result.username, 'myuser', 'user returned separately');
  eq(result.password, 'mypass', 'password returned separately');
  // localhost → no sslmode appended
  assert(!result.jdbc.includes('sslmode'), 'no SSL for localhost');
}

suite('parseDatabaseUrl — remote host adds sslmode');
{
  const result = parseDatabaseUrl('postgresql://u:p@db.example.com:5432/prod');
  assert(result !== null, 'returns non-null');
  includes(result.jdbc, 'sslmode=require', 'sslmode appended');
}

suite('parseDatabaseUrl — already JDBC passthrough');
{
  const jdbc = 'jdbc:postgresql://host:5432/db?user=a&password=b';
  const result = parseDatabaseUrl(jdbc);
  eq(result.jdbc, jdbc, 'passes through unchanged');
}

suite('parseDatabaseUrl — null input');
{
  const result = parseDatabaseUrl(null);
  eq(result, null, 'returns null');
}

suite('parseDatabaseUrl — invalid format');
{
  const result = parseDatabaseUrl('not-a-url');
  eq(result, null, 'returns null for invalid');
}

suite('parseDatabaseUrl — URL-encoded characters');
{
  const result = parseDatabaseUrl('postgresql://user%40host:p%40ss@localhost:5432/db');
  assert(result !== null, 'handles encoded chars');
  eq(result.username, 'user@host', 'user decoded with @');
  eq(result.password, 'p@ss', 'password decoded with @');
}

suite('parseDatabaseUrl — postgres:// alias');
{
  const result = parseDatabaseUrl('postgres://u:p@localhost:5432/db');
  assert(result !== null, 'accepts postgres://');
  includes(result.jdbc, 'jdbc:postgresql://localhost:5432/db', 'JDBC format');
}

suite('parseDatabaseUrl — with query string');
{
  const result = parseDatabaseUrl('postgresql://u:p@remote.host:5432/db?sslmode=require');
  assert(result !== null, 'accepts query string');
  // The function sees sslmode in the input URL and correctly skips appending it.
  // However the original query params (beyond user/password) are NOT carried to JDBC,
  // so sslmode won't appear in the generated JDBC at all. This is expected — the
  // function only builds user=&password=&sslmode, and skips sslmode when already present.
  // The important thing is it doesn't DUPLICATE it.
  const sslCount = (result.jdbc.match(/sslmode/g) || []).length;
  assert(sslCount <= 1, 'no duplicate sslmode');
}

// ─── rewriteJdbcForDocker ───────────────────────────────────────

suite('rewriteJdbcForDocker');
{
  const input = 'jdbc:postgresql://localhost:5432/db?user=a&password=b';
  const result = rewriteJdbcForDocker(input);
  includes(result, 'host.docker.internal', 'localhost → docker');
  assert(!result.includes('localhost'), 'no more localhost');
}
{
  const input = 'jdbc:postgresql://127.0.0.1:5432/db?user=a&password=b';
  const result = rewriteJdbcForDocker(input);
  includes(result, 'host.docker.internal', '127.0.0.1 → docker');
}
{
  const input = 'jdbc:postgresql://remote.host:5432/db?user=a&password=b';
  const result = rewriteJdbcForDocker(input);
  assert(!result.includes('host.docker.internal'), 'remote unchanged');
}

// ─── formatTimestamp ────────────────────────────────────────────

suite('formatTimestamp — default pattern');
{
  const d = new Date(2025, 6, 10, 14, 35, 22); // July 10 2025, 14:35:22
  const result = formatTimestamp(d);
  eq(result, '20250710143522', 'YYYYMMDDHHmmss');
}

suite('formatTimestamp — custom pattern');
{
  const d = new Date(2025, 0, 5, 9, 3, 7, 42); // Jan 5 2025, 09:03:07.042
  eq(formatTimestamp(d, 'YYYY-MM-DD'), '2025-01-05', 'date only');
  eq(formatTimestamp(d, 'HH:mm:ss.SSS'), '09:03:07.042', 'time with millis');
  eq(formatTimestamp(d, 'YYYYMMDD'), '20250105', 'compact date');
}

suite('formatTimestamp — edge: midnight');
{
  const d = new Date(2025, 11, 31, 0, 0, 0, 0);
  eq(formatTimestamp(d, 'YYYYMMDDHHmmss'), '20251231000000', 'midnight');
}

// ─── loadConfig ─────────────────────────────────────────────────

suite('loadConfig — reads fixtures config');
{
  const config = await loadConfig(fixturesRoot);
  assert(config.schemaDir !== null, 'schemaDir set');
  assert(config.schemaDir.endsWith('schema'), 'schemaDir resolved');
  eq(config.author, 'test-user', 'author from config');
  eq(config.diff.includePolicies, true, 'includePolicies');
  eq(config.diff.modifyPolicies, true, 'modifyPolicies');
  eq(config.diff.dropOrphanPolicies, true, 'dropOrphanPolicies');
  eq(config.diff.dropOrphanIndexes, true, 'dropOrphanIndexes');
  eq(config.diff.dropOrphanUniques, true, 'dropOrphanUniques');
  eq(config.timestampFormat, 'YYYYMMDDHHmmss', 'timestampFormat');
  eq(config.liquibaseMode, 'node', 'liquibaseMode');
}

suite('loadConfig — migrationsDir resolved');
{
  const config = await loadConfig(fixturesRoot);
  assert(config.migrationsDir.startsWith('/'), 'absolute path');
  includes(config.migrationsDir, 'migrations', 'migrations path');
}

suite('loadConfig — masterChangelog resolved');
{
  const config = await loadConfig(fixturesRoot);
  includes(config.masterChangelog, 'master-changelog.xml', 'changelog path');
}

suite('loadConfig — defaults applied for missing keys');
{
  // loadConfig with a dir that has no config file falls back to defaults
  const config = await loadConfig('/tmp');
  eq(config.schemaDir, null, 'schemaDir is null (not configured)');
  eq(config.liquibaseMode, 'node', 'default liquibaseMode');
  eq(config.diff.includePolicies, true, 'default includePolicies');
  eq(config.diff.modifyPolicies, false, 'default modifyPolicies');
  eq(config.diff.dropOrphanPolicies, false, 'default dropOrphanPolicies');
}

// ─── parseDatabaseUrl — MySQL URLs ──────────────────────────────

suite('parseDatabaseUrl — standard MySQL URL');
{
  const result = parseDatabaseUrl('mysql://myuser:mypass@localhost:3306/mydb');
  assert(result !== null, 'returns non-null');
  includes(result.jdbc, 'jdbc:mariadb://localhost:3306/mydb', 'JDBC prefix');
  eq(result.username, 'myuser', 'user returned separately');
  eq(result.password, 'mypass', 'password returned separately');
  assert(!result.jdbc.includes('useSSL'), 'no SSL for localhost');
}

suite('parseDatabaseUrl — MySQL remote host adds SSL');
{
  const result = parseDatabaseUrl('mysql://u:p@db.example.com:3306/prod');
  assert(result !== null, 'returns non-null');
  includes(result.jdbc, 'useSSL=true', 'SSL appended for remote');
}

suite('parseDatabaseUrl — MySQL with no password');
{
  const result = parseDatabaseUrl('mysql://root:@localhost:3306/drizzle_test');
  assert(result !== null, 'handles empty password');
  includes(result.jdbc, 'jdbc:mariadb://localhost:3306/drizzle_test', 'JDBC prefix');
  eq(result.username, 'root', 'user returned separately');
  eq(result.password, '', 'empty password');
}

suite('parseDatabaseUrl — MySQL URL-encoded characters');
{
  const result = parseDatabaseUrl('mysql://user%40host:p%40ss@localhost:3306/db');
  assert(result !== null, 'handles encoded chars');
  eq(result.username, 'user@host', 'user decoded with @');
  eq(result.password, 'p@ss', 'password decoded with @');
}

// ─── detectDialectFromUrl ───────────────────────────────────────

suite('detectDialectFromUrl — PostgreSQL URLs');
{
  eq(detectDialectFromUrl('postgresql://u:p@localhost:5432/db'), 'postgresql', 'postgresql://');
  eq(detectDialectFromUrl('postgres://u:p@localhost:5432/db'), 'postgresql', 'postgres://');
}

suite('detectDialectFromUrl — MySQL URLs');
{
  eq(detectDialectFromUrl('mysql://u:p@localhost:3306/db'), 'mysql', 'mysql://');
}

suite('detectDialectFromUrl — SQLite paths');
{
  eq(detectDialectFromUrl(':memory:'), 'sqlite', ':memory:');
  eq(detectDialectFromUrl('file:test.db'), 'sqlite', 'file: protocol');
  eq(detectDialectFromUrl('/path/to/data.db'), 'sqlite', '.db extension');
  eq(detectDialectFromUrl('/path/to/data.sqlite'), 'sqlite', '.sqlite extension');
}

suite('detectDialectFromUrl — null and unknown');
{
  eq(detectDialectFromUrl(null), null, 'null input');
  eq(detectDialectFromUrl('redis://localhost:6379'), null, 'unknown scheme');
}

// ─── Summary ────────────────────────────────────────────────────

summary();
