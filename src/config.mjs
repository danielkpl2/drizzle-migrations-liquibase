/**
 * drizzle-migrations-liquibase — Configuration loader
 *
 * Loads and validates the user's drizzle-liquibase.config.mjs configuration.
 * Also provides helpers for parsing DATABASE_URL into JDBC format.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------
const DEFAULTS = {
  /** Absolute path to the directory containing Drizzle schema files */
  schemaDir: null, // REQUIRED — e.g. './src/schema'

  /** Glob/directory used by the generator to find the schema index.ts */
  schemaIndexFile: 'index.ts',

  /**
   * Database dialect: 'postgresql' | 'mysql' | 'sqlite' | 'singlestore'
   *   null (default) — auto-detect from DATABASE_URL scheme
   *   postgresql     — PostgreSQL (pg driver)
   *   mysql          — MySQL / MariaDB (mysql2 driver)
   *   sqlite         — SQLite (better-sqlite3 / libsql driver)
   *   singlestore    — SingleStore (mysql2 driver)
   */
  dialect: null,

  /**
   * Diff engine: 'custom' | 'drizzle-kit'
   *   custom     — built-in AST-based parser + diff engine (default, PostgreSQL only)
   *   drizzle-kit — hooks into drizzle-kit's own serializer + diff algorithms
   *                 (requires drizzle-kit + drizzle-orm as peer dependencies)
   */
  engine: 'custom',

  /** Directory where Liquibase migration SQL files are written */
  migrationsDir: './liquibase/migrations',

  /** Path to the master changelog XML file */
  masterChangelog: './liquibase/master-changelog.xml',

  /** DATABASE_URL — can also be set via env var */
  databaseUrl: null,

  /**
   * Timestamp format for migration filenames.
   * Tokens: YYYY MM DD HH mm ss SSS
   * Default produces: 20250710092120  (down to seconds, no microseconds)
   */
  timestampFormat: 'YYYYMMDDHHmmss',

  /**
   * Liquibase execution mode: 'node' | 'cli' | 'docker'
   *   node   — uses the `liquibase` npm package (default)
   *   cli    — shells out to a system-installed `liquibase` binary
   *   docker — runs the official liquibase/liquibase Docker image
   */
  liquibaseMode: 'node',

  /**
   * Default changeset author. If null the generator will try git user.email,
   * then git user.name, then $USER.
   */
  author: null,

  /** Noise-reduction toggles for the schema diff generator */
  diff: {
    includePolicies: true,
    modifyPolicies: false,
    dropOrphanPolicies: false,
    dropOrphanIndexes: false,
    dropOrphanUniques: false,
  },
};

// ---------------------------------------------------------------------------
// DATABASE_URL → JDBC helpers
// ---------------------------------------------------------------------------

/**
 * Detect dialect from a database URL scheme.
 *
 * Returns 'postgresql', 'mysql', or null if unrecognised.
 */
export function detectDialectFromUrl(dbUrl) {
  if (!dbUrl) return null;
  if (/^postgres(?:ql)?:\/\//i.test(dbUrl)) return 'postgresql';
  if (/^mysql:\/\//i.test(dbUrl)) return 'mysql';
  // SQLite URLs don't typically look like URLs (file paths / :memory:)
  if (/^(?:file:|:memory:)/i.test(dbUrl) || dbUrl.endsWith('.db') || dbUrl.endsWith('.sqlite')) return 'sqlite';
  return null;
}

/**
 * Parse a database connection URL into JDBC components.
 *
 * Accepts:
 *   PostgreSQL:
 *     postgresql://user:pass@host:port/dbname
 *     postgres://user:pass@host:port/dbname
 *     postgresql://user:pass@host:port/dbname?sslmode=require
 *
 *   MySQL:
 *     mysql://user:pass@host:port/dbname
 *     mysql://user:pass@host:port/dbname?ssl=true
 *
 * Returns { jdbc, username, password } or null on failure.
 */
export function parseDatabaseUrl(dbUrl) {
  if (!dbUrl) return null;

  // Already a JDBC url — pass through
  if (dbUrl.startsWith('jdbc:')) {
    return { jdbc: dbUrl, username: '', password: '' };
  }

  // ── PostgreSQL ──
  const pgMatch = dbUrl.match(
    /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)(\?.*)?$/
  );
  if (pgMatch) {
    const [, user, pass, host, port, dbname, queryString] = pgMatch;
    const decodedUser = decodeURIComponent(user);
    const decodedPass = decodeURIComponent(pass);

    const isLocal =
      host.includes('127') ||
      host.includes('localhost') ||
      host.includes('host.docker.internal');

    let ssl = '';
    if (!isLocal && (!queryString || !queryString.includes('sslmode'))) {
      ssl = '&sslmode=require';
    }

    const jdbc = `jdbc:postgresql://${host}:${port}/${dbname}?user=${encodeURIComponent(decodedUser)}&password=${encodeURIComponent(decodedPass)}${ssl}`;
    return { jdbc, username: '', password: '' };
  }

  // ── MySQL ──
  const mysqlMatch = dbUrl.match(
    /^mysql:\/\/([^:]*):?([^@]*)@([^:/]+):(\d+)\/([^?]+)(\?.*)?$/
  );
  if (mysqlMatch) {
    const [, user, pass, host, port, dbname, queryString] = mysqlMatch;
    const decodedUser = decodeURIComponent(user || 'root');
    const decodedPass = decodeURIComponent(pass || '');

    const isLocal =
      host.includes('127') ||
      host.includes('localhost') ||
      host.includes('host.docker.internal');

    let ssl = '';
    if (!isLocal && (!queryString || !queryString.includes('useSSL'))) {
      ssl = '&useSSL=true';
    }

    const jdbc = `jdbc:mariadb://${host}:${port}/${dbname}?user=${encodeURIComponent(decodedUser)}&password=${encodeURIComponent(decodedPass)}${ssl}`;
    return { jdbc, username: '', password: '' };
  }

  return null;
}

/**
 * Rewrite localhost/127.0.0.1 in a JDBC url to host.docker.internal
 * (needed when running Liquibase via Docker).
 */
export function rewriteJdbcForDocker(jdbc) {
  return jdbc.replace(/localhost|127\.0\.0\.1/g, 'host.docker.internal');
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

/**
 * Format a Date according to the configured timestamp pattern.
 *
 * Supported tokens: YYYY, MM, DD, HH, mm, ss, SSS
 */
export function formatTimestamp(date, pattern = 'YYYYMMDDHHmmss') {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return pattern
    .replace('YYYY', pad(date.getFullYear(), 4))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('DD', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()))
    .replace('SSS', pad(date.getMilliseconds(), 3));
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load and merge configuration.
 *
 * Resolution order:
 *   1. drizzle-liquibase.config.mjs  in the given projectRoot (or cwd)
 *   2. Defaults
 *   3. Environment variable DATABASE_URL (lowest priority for databaseUrl)
 *
 * @param {string} [projectRoot] — directory to search for the config file
 * @returns {Promise<object>} merged configuration
 */
export async function loadConfig(projectRoot) {
  const root = projectRoot ? resolve(projectRoot) : process.cwd();

  let userConfig = {};

  const configCandidates = [
    'drizzle-liquibase.config.mjs',
    'drizzle-liquibase.config.js',
    'drizzle-liquibase.config.cjs',
  ];

  for (const candidate of configCandidates) {
    const configPath = join(root, candidate);
    if (existsSync(configPath)) {
      const imported = await import(pathToFileURL(configPath).href);
      userConfig = imported.default || imported;
      break;
    }
  }

  // Merge diff options
  const diff = { ...DEFAULTS.diff, ...(userConfig.diff || {}) };

  const config = {
    ...DEFAULTS,
    ...userConfig,
    diff,
    // Resolve paths relative to project root
    _projectRoot: root,
  };

  // Resolve relative paths against project root
  if (config.schemaDir) {
    config.schemaDir = resolve(root, config.schemaDir);
  }
  config.migrationsDir = resolve(root, config.migrationsDir);
  config.masterChangelog = resolve(root, config.masterChangelog);

  // DATABASE_URL fallback from environment
  if (!config.databaseUrl) {
    config.databaseUrl =
      process.env.MIGRATION_DATABASE_URL ||
      process.env.DATABASE_URL;
  }

  return config;
}

export default { loadConfig, parseDatabaseUrl, rewriteJdbcForDocker, formatTimestamp, detectDialectFromUrl };
