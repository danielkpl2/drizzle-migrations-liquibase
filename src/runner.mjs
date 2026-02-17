/**
 * drizzle-migrations-liquibase — Liquibase runner
 *
 * Thin wrapper that executes Liquibase commands via one of three modes:
 *   node   — the `liquibase` npm package (default)
 *   cli    — a system-installed `liquibase` binary
 *   docker — the official liquibase/liquibase Docker image
 *
 * Configuration is loaded from drizzle-liquibase.config.mjs via loadConfig().
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { loadConfig, parseDatabaseUrl, rewriteJdbcForDocker, detectDialectFromUrl } from './config.mjs';

// ---------------------------------------------------------------------------
// JDBC driver mapping per dialect
// ---------------------------------------------------------------------------

const DIALECT_DRIVER = {
  postgresql: 'org.postgresql.Driver',
  mysql: 'org.mariadb.jdbc.Driver',      // MariaDB driver is MySQL-compatible & bundled with Liquibase
  singlestore: 'org.mariadb.jdbc.Driver',
  sqlite: 'org.sqlite.JDBC',
};

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Run a Liquibase command.
 *
 * @param {string}   command        — Liquibase command name (e.g. 'update', 'status', 'rollbackCount')
 * @param {string[]} [args=[]]      — additional CLI arguments
 * @param {object}   [options={}]   — overrides / extras
 * @param {string}   [options.projectRoot] — project root directory
 * @param {object}   [options.config]      — pre-loaded config (skips loadConfig)
 */
export async function runLiquibase(command, args = [], options = {}) {
  const config = options.config || (await loadConfig(options.projectRoot));

  const databaseUrl = config.databaseUrl;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in drizzle-liquibase.config.mjs or as an environment variable.'
    );
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) {
    throw new Error(`Failed to parse DATABASE_URL: ${databaseUrl}`);
  }

  // Resolve dialect for driver and schema defaults
  const dialect = config.dialect || detectDialectFromUrl(databaseUrl) || 'postgresql';
  const driver = DIALECT_DRIVER[dialect] || DIALECT_DRIVER.postgresql;
  const defaultSchemaName = dialect === 'postgresql' ? 'public' : undefined;

  const mode = config.liquibaseMode || 'node';

  // Determine the searchPath (directory containing master-changelog.xml)
  const searchPath = dirname(config.masterChangelog);

  // Changelog file — relative to searchPath
  const changeLogFile = config.masterChangelog.split('/').pop().includes('master')
    ? 'master-changelog.xml'
    : config.masterChangelog.replace(searchPath + '/', '');

  const lbConfig = {
    changeLogFile,
    url: mode === 'docker' ? rewriteJdbcForDocker(parsed.jdbc) : parsed.jdbc,
    driver,
    defaultSchemaName,
    username: parsed.username,
    password: parsed.password,
    searchPath,
  };

  switch (mode) {
    case 'node':
      return runNode(lbConfig, command, args);
    case 'cli':
      return runCli(lbConfig, command, args);
    case 'docker':
      return runDocker(lbConfig, command, args, searchPath);
    default:
      throw new Error(`Invalid liquibaseMode: "${mode}". Must be "node", "cli", or "docker".`);
  }
}

// ---------------------------------------------------------------------------
// Mode: node (liquibase npm package)
// ---------------------------------------------------------------------------

async function runNode(lbConfig, command, extraArgs) {
  const { Liquibase } = await import('liquibase');
  const lbOpts = {
    changeLogFile: lbConfig.changeLogFile,
    url: lbConfig.url,
    username: lbConfig.username,
    password: lbConfig.password,
    driver: lbConfig.driver,
    searchPath: lbConfig.searchPath,
  };
  if (lbConfig.defaultSchemaName) {
    lbOpts.defaultSchemaName = lbConfig.defaultSchemaName;
  }
  const lb = new Liquibase(lbOpts);

  if (typeof lb[command] !== 'function') {
    throw new Error(
      `Liquibase command "${command}" is not available via the node-liquibase package. ` +
      `Try using cli or docker mode instead.`
    );
  }

  if (extraArgs.length > 0) {
    await lb[command](extraArgs);
  } else {
    await lb[command]();
  }
}

// ---------------------------------------------------------------------------
// Mode: cli (system-installed liquibase binary)
// ---------------------------------------------------------------------------

function runCli(lbConfig, command, extraArgs) {
  const args = buildCliArgs(lbConfig);
  args.push(command, ...extraArgs);

  // Mask password when logging
  const loggedArgs = args.map((a) =>
    a.startsWith('--password=') ? '--password=****' : a
  );
  console.log('Using CLI: liquibase', loggedArgs.join(' '));

  const res = spawnSync('liquibase', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Liquibase CLI exited with code ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Mode: docker (official liquibase Docker image)
// ---------------------------------------------------------------------------

function runDocker(lbConfig, command, extraArgs, searchPath) {
  const dockerArgs = ['run', '--rm'];

  // Mount the liquibase directory as volume
  dockerArgs.push('-v', `${searchPath}:/liquibase/changelog`);

  // Use official liquibase Docker image
  dockerArgs.push('liquibase/liquibase:latest');

  // Override searchPath inside Docker container
  const lbArgs = buildCliArgs({ ...lbConfig, searchPath: '/liquibase/changelog' });
  dockerArgs.push(...lbArgs, command, ...extraArgs);

  // Mask password when logging
  const loggedArgs = dockerArgs.map((a) =>
    a.startsWith('--password=') ? '--password=****' : a
  );
  console.log('Using Docker: docker', loggedArgs.join(' '));

  const res = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Liquibase Docker exited with code ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCliArgs(lbConfig) {
  const args = [];
  if (lbConfig.changeLogFile) args.push(`--changeLogFile=${lbConfig.changeLogFile}`);
  if (lbConfig.url) args.push(`--url=${lbConfig.url}`);
  if (lbConfig.driver) args.push(`--driver=${lbConfig.driver}`);
  if (lbConfig.defaultSchemaName) args.push(`--defaultSchemaName=${lbConfig.defaultSchemaName}`);
  if (lbConfig.username) args.push(`--username=${lbConfig.username}`);
  if (lbConfig.password) args.push(`--password=${lbConfig.password}`);
  if (lbConfig.searchPath) args.push(`--searchPath=${lbConfig.searchPath}`);
  return args;
}

export default { runLiquibase };
