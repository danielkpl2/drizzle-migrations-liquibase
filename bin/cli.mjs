#!/usr/bin/env node

/**
 * drizzle-migrations-liquibase CLI
 *
 * Usage:
 *   drizzle-liquibase init                        — scaffold config + directory structure
 *   drizzle-liquibase generate [name]             — generate migration from schema diff
 *   drizzle-liquibase generate [name] --reverse   — generate migration for DB-only objects
 *   drizzle-liquibase update                      — apply pending migrations
 *   drizzle-liquibase status                      — show pending/applied migrations
 *   drizzle-liquibase validate                    — validate the changelog
 *   drizzle-liquibase rollback <count>            — rollback N changesets
 *   drizzle-liquibase history                     — show applied migration history
 *   drizzle-liquibase <command> [args...]         — pass-through to Liquibase
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load .env files (best-effort, no dependency required)
// ---------------------------------------------------------------------------
// Attempts to load environment variables from common dotenv files in the
// current working directory. Priority (last wins): .env → .env.local
// This covers Next.js, Vite, and plain dotenv conventions.
// If none exist or readFileSync fails, we silently continue.

const cwd = process.cwd();
for (const envFile of ['.env', '.env.local']) {
  try {
    const envPath = join(cwd, envFile);
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // File doesn't exist or can't be read — that's fine
  }
}

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const command = rawArgs[0];

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

switch (command) {
  case 'init':
    await runInit();
    break;
  case 'generate':
    await runGenerate(rawArgs.slice(1));
    break;
  case 'rollbackCount':
    await runLiquibaseCommand('rollbackCount', rawArgs.slice(1));
    break;
  case 'rollbackTag':
    await runLiquibaseCommand('rollback', rawArgs.slice(1));
    break;
  case 'rollbackToDate':
    await runLiquibaseCommand('rollbackToDate', rawArgs.slice(1));
    break;
  case 'rollback': {
    // Smart shorthand:
    //   numeric        → rollbackCount (e.g. "3")
    //   date-like      → rollbackToDate (e.g. "2025-01-15" or "2025-01-15 10:30:00")
    //   anything else  → rollback to tag
    const rollbackArgs = rawArgs.slice(1);
    const target = rollbackArgs[0];
    if (target && /^\d+$/.test(target)) {
      await runLiquibaseCommand('rollbackCount', rollbackArgs);
    } else if (target && /^\d{4}-\d{2}-\d{2}/.test(target)) {
      await runLiquibaseCommand('rollbackToDate', rollbackArgs);
    } else {
      await runLiquibaseCommand('rollback', rollbackArgs);
    }
    break;
  }
  default:
    // Pass-through to Liquibase runner
    await runLiquibaseCommand(command, rawArgs.slice(1));
    break;
}

// ---------------------------------------------------------------------------
// init — scaffold project structure
// ---------------------------------------------------------------------------

async function runInit() {
  const cwd = process.cwd();
  console.log('📁 Initialising drizzle-migrations-liquibase...\n');

  // 1. Create config file
  const configPath = join(cwd, 'drizzle-liquibase.config.mjs');
  if (!existsSync(configPath)) {
    const templatePath = join(packageRoot, 'templates', 'drizzle-liquibase.config.mjs');
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf-8')
      : getDefaultConfigTemplate();
    writeFileSync(configPath, template);
    console.log('  ✅ Created drizzle-liquibase.config.mjs');
  } else {
    console.log('  ⏭️  drizzle-liquibase.config.mjs already exists');
  }

  // 2. Create liquibase directory + master changelog
  const lbDir = join(cwd, 'liquibase');
  const migrationsDir = join(lbDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
    console.log('  ✅ Created liquibase/migrations/');
  } else {
    console.log('  ⏭️  liquibase/migrations/ already exists');
  }

  const changelogPath = join(lbDir, 'master-changelog.xml');
  if (!existsSync(changelogPath)) {
    const templatePath = join(packageRoot, 'templates', 'master-changelog.xml');
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf-8')
      : getDefaultChangelogTemplate();
    writeFileSync(changelogPath, template);
    console.log('  ✅ Created liquibase/master-changelog.xml');
  } else {
    console.log('  ⏭️  liquibase/master-changelog.xml already exists');
  }

  console.log('\n🎉 Done! Next steps:');
  console.log('  1. Edit drizzle-liquibase.config.mjs — set schemaDir and databaseUrl');
  console.log('  2. Run: npx drizzle-liquibase generate <migration_name>');
  console.log('  3. Review the generated SQL in liquibase/migrations/');
  console.log('  4. Run: npx drizzle-liquibase update');
}

// ---------------------------------------------------------------------------
// generate — schema diff → migration file
// ---------------------------------------------------------------------------

async function runGenerate(args) {
  let customName = null;
  let reverse = false;
  let engine = null;
  let dialect = null;
  let excludeTables = [];
  let schemas = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reverse' || arg === '-r') {
      reverse = true;
    } else if (arg === '--engine' || arg === '-e') {
      engine = args[++i]; // consume next arg as engine value
    } else if (arg.startsWith('--engine=')) {
      engine = arg.split('=')[1];
    } else if (arg === '--dialect' || arg === '-d') {
      dialect = args[++i];
    } else if (arg.startsWith('--dialect=')) {
      dialect = arg.split('=')[1];
    } else if (arg === '--exclude-tables') {
      // Comma-separated list: --exclude-tables audit_log,temp_data
      const val = args[++i];
      if (val) excludeTables = val.split(',').map(t => t.trim()).filter(Boolean);
    } else if (arg.startsWith('--exclude-tables=')) {
      excludeTables = arg.split('=')[1].split(',').map(t => t.trim()).filter(Boolean);
    } else if (arg === '--schemas') {
      // Comma-separated list: --schemas public,custom_schema
      const val = args[++i];
      if (val) schemas = val.split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--schemas=')) {
      schemas = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    } else if (!arg.startsWith('-')) {
      customName = customName || arg;
    }
  }

  // Resolve engine: CLI flag > config file > default ('custom')
  if (!engine) {
    const { loadConfig } = await import('../src/config.mjs');
    const config = await loadConfig(process.cwd());
    engine = config.engine || 'custom';
  }

  if (engine === 'drizzle-kit') {
    const { DrizzleKitEngine } = await import('../src/drizzle-kit-engine.mjs');
    const generator = new DrizzleKitEngine({
      name: customName,
      projectRoot: process.cwd(),
      excludeTables,
      schemas,
      dialect,
    });
    await generator.run();
  } else {
    const { SchemaDiffGenerator } = await import('../src/generate.mjs');
    const generator = new SchemaDiffGenerator({
      name: customName,
      reverse,
      projectRoot: process.cwd(),
    });
    await generator.run();
  }
}

// ---------------------------------------------------------------------------
// Liquibase pass-through
// ---------------------------------------------------------------------------

async function runLiquibaseCommand(command, args) {
  const { runLiquibase } = await import('../src/runner.mjs');

  try {
    await runLiquibase(command, args, { projectRoot: process.cwd() });
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
drizzle-migrations-liquibase — Bridge between Drizzle ORM and Liquibase

Usage:
  drizzle-liquibase <command> [options]

Commands:
  init                         Scaffold config file and directory structure
  generate [name]              Generate a migration from Drizzle schema ↔ DB diff
    --reverse, -r              Generate migration for objects in DB but not in schema
    --engine, -e <engine>      Diff engine: 'custom' (default) or 'drizzle-kit'
    --dialect, -d <dialect>    Database dialect: postgresql, mysql, sqlite, singlestore
    --exclude-tables <list>    Comma-separated tables to exclude (drizzle-kit engine)
    --schemas <list>           Comma-separated schemas to include (default: public)

  update                       Apply all pending migrations
  status                       Show pending / applied migration status
  validate                     Validate the master changelog
  rollback <count|tag|date>     Smart rollback (number → by count, date → by date, string → by tag)
  rollbackCount <count>        Rollback the last N changesets
  rollbackTag <tag>            Rollback to a named tag
  rollbackToDate <date>        Rollback to a date (YYYY-MM-DD or "YYYY-MM-DD HH:MM:SS")
  history                      Show applied migration history
  tag <name>                   Tag the current database state
  updateSQL                    Preview the SQL that would be executed

  <command> [args...]          Any other Liquibase command (pass-through)

Examples:
  npx drizzle-liquibase init
  npx drizzle-liquibase generate add_users_table
  npx drizzle-liquibase generate add_users_table --engine drizzle-kit
  npx drizzle-liquibase generate --engine drizzle-kit --dialect mysql
  npx drizzle-liquibase generate --engine drizzle-kit --exclude-tables audit_log,staging
  npx drizzle-liquibase generate --engine drizzle-kit --schemas public,custom_schema
  npx drizzle-liquibase generate --reverse
  npx drizzle-liquibase update
  npx drizzle-liquibase rollback 1
  npx drizzle-liquibase status
`);
}

// ---------------------------------------------------------------------------
// Inline fallback templates
// ---------------------------------------------------------------------------

function getDefaultConfigTemplate() {
  return `/**
 * drizzle-migrations-liquibase configuration
 * @see https://github.com/danielkpl2/drizzle-migrations-liquibase
 */
export default {
  // REQUIRED — path to your Drizzle schema directory (contains index.ts with exports)
  schemaDir: './src/schema',

  // Directory where Liquibase migration files are generated
  migrationsDir: './liquibase/migrations',

  // Path to the master changelog XML
  masterChangelog: './liquibase/master-changelog.xml',

  // Database connection URL (can also use DATABASE_URL env var)
  // databaseUrl: process.env.DATABASE_URL,

  // Timestamp format for migration filenames (default: YYYYMMDDHHmmss)
  timestampFormat: 'YYYYMMDDHHmmss',

  // Liquibase execution mode: 'node' | 'cli' | 'docker'
  liquibaseMode: 'node',

  // Changeset author (null = auto-detect from git)
  author: null,

  // Tables to exclude from drizzle-kit engine output (in addition to
  // Liquibase's own tracking tables which are always excluded)
  excludeTables: [],

  // Database schemas to include in drizzle-kit introspection.
  // Default: ['public'] — only generates migrations for the public schema.
  // Set to include additional schemas if your Drizzle schema uses pgSchema().
  // schemas: ['public'],

  // Schema diff options
  diff: {
    includePolicies: true,
    modifyPolicies: false,
    dropOrphanPolicies: false,
    dropOrphanIndexes: false,
    dropOrphanUniques: false,
  },
};
`;
}

function getDefaultChangelogTemplate() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.20.xsd">

    <!-- Migration files will be added here automatically by the generate command -->

</databaseChangeLog>
`;
}
