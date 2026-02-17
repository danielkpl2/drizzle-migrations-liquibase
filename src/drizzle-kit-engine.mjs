/**
 * drizzle-migrations-liquibase — Drizzle Kit Engine
 *
 * Alternative diff engine that hooks into drizzle-kit's own schema
 * serializer and diff algorithms via the public `drizzle-kit/api` export.
 *
 * Supports both drizzle-kit v0.31+ (drizzle-kit/api) and
 * v1.0.0-beta (drizzle-kit/api-postgres). Auto-detects which
 * version is installed and adapts accordingly.
 *
 * Benefits over the custom engine:
 *   - Uses drizzle-kit's battle-tested serializer (runtime Drizzle objects)
 *   - Handles column renames interactively (detects rename vs create+delete)
 *   - Covers more schema features (sequences, check constraints, views, etc.)
 *   - Future multi-database support (MySQL, SQLite) with minimal work
 *
 * Trade-offs:
 *   - Requires `drizzle-kit` and `drizzle-orm` as peer dependencies
 *   - Uses `jiti` to load TypeScript schema files at runtime
 *   - May prompt interactively on table/column renames
 *   - No reverse mode (schema → DB direction only)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { loadConfig, formatTimestamp, detectDialectFromUrl } from './config.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tables that Liquibase uses to track migration state.
 * These must never appear in generated migrations — drizzle-kit sees them in the
 * database, doesn't find them in the Drizzle schema, and tries to drop them.
 */
const LIQUIBASE_TABLES = ['databasechangelog', 'databasechangeloglock'];

/**
 * Import a package from the *project's* node_modules rather than from this
 * package's own node_modules.  This is critical for pnpm's strict isolation:
 * peer/dev deps installed by the consuming project aren't visible to imports
 * resolved relative to files inside a tarball-installed package.
 *
 * Falls back to a plain dynamic import() when there is no projectRoot
 * (e.g. when running tests inside the package itself).
 */
function importFromProject(packageName, projectRoot) {
  if (projectRoot) {
    try {
      const require = createRequire(join(resolve(projectRoot), 'package.json'));
      return require(packageName);
    } catch { /* fall through to dynamic import */ }
  }
  return import(packageName);
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class DrizzleKitEngine {
  /**
   * @param {object} opts
   * @param {string}    [opts.name]          — custom migration name
   * @param {object}    [opts.config]        — pre-loaded config (skips loadConfig)
   * @param {string}    [opts.projectRoot]   — project root (for loadConfig fallback)
   * @param {string[]}  [opts.excludeTables] — extra tables to exclude (merged with config)
   * @param {string[]}  [opts.schemas]       — schemas to include (merged with config)
   * @param {string}    [opts.dialect]       — database dialect override (postgresql|mysql|sqlite|singlestore)
   */
  constructor(opts = {}) {
    this.customName = opts.name ?? null;
    this._configOverride = opts.config ?? null;
    this._projectRoot = opts.projectRoot ?? null;
    this._cliExcludeTables = opts.excludeTables ?? [];
    this._cliSchemas = opts.schemas ?? [];
    this._cliDialect = opts.dialect ?? null;

    this.config = null;
    this.schemaDir = null;
    this.migrationsDir = null;
    this.databaseUrl = null;
    this.dialect = null;
  }

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  async init() {
    this.config = this._configOverride || (await loadConfig(this._projectRoot));

    if (!this.config.schemaDir) {
      throw new Error(
        'schemaDir is required in drizzle-liquibase.config.mjs — e.g. schemaDir: "./src/schema"'
      );
    }

    this.schemaDir = this.config.schemaDir;
    this.migrationsDir = this.config.migrationsDir;
    this.databaseUrl = this.config.databaseUrl;

    // Resolve dialect: CLI flag > config > auto-detect from URL
    const VALID_DIALECTS = ['postgresql', 'mysql', 'sqlite', 'singlestore'];
    this.dialect = this._cliDialect ?? this.config.dialect ?? detectDialectFromUrl(this.databaseUrl) ?? 'postgresql';
    if (!VALID_DIALECTS.includes(this.dialect)) {
      throw new Error(
        `Invalid dialect "${this.dialect}". Must be one of: ${VALID_DIALECTS.join(', ')}`
      );
    }

    // Merge CLI --exclude-tables with config excludeTables
    if (this._cliExcludeTables.length) {
      const existing = this.config.excludeTables ?? [];
      this.config.excludeTables = [...existing, ...this._cliExcludeTables];
    }

    // Merge CLI --schemas with config schemas (CLI overrides config if provided)
    if (this._cliSchemas.length) {
      this.config.schemas = this._cliSchemas;
    }

    // Validate custom name
    if (this.customName !== null) {
      if (typeof this.customName !== 'string' || this.customName.length === 0) {
        throw new Error('Migration name must be a non-empty string');
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(this.customName)) {
        throw new Error(
          `Invalid migration name "${this.customName}". Must start with a letter and contain only a-z, A-Z, 0-9, _ or -`
        );
      }
    }

    if (!this.databaseUrl) {
      throw new Error(
        'DATABASE_URL is required. Set it in drizzle-liquibase.config.mjs, .env.local, or environment.'
      );
    }
  }

  // ------------------------------------------------------------------
  // Schema loading — uses jiti to import TypeScript at runtime
  // ------------------------------------------------------------------

  async loadSchemaExports() {
    console.log('📖 Loading Drizzle schema files...');

    const indexPath = resolve(this.schemaDir, this.config.schemaIndexFile || 'index.ts');
    if (!existsSync(indexPath)) {
      throw new Error(
        `Schema index file not found: ${indexPath}\n` +
        `Make sure your schemaDir points to a directory with an ${this.config.schemaIndexFile || 'index.ts'} that re-exports all schema files.`
      );
    }

    // Try jiti first (lightweight TS loader), fall back to native import
    let imports;
    try {
      const jitiModule = await importFromProject('jiti', this._projectRoot);
      const createJiti = jitiModule.createJiti || jitiModule.default?.createJiti;
      const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        moduleCache: false,
      });
      imports = await jiti.import(indexPath);
    } catch (jitiErr) {
      // If jiti isn't available, try native import (works for .js/.mjs files)
      try {
        imports = await import(pathToFileURL(indexPath).href);
      } catch (importErr) {
        throw new Error(
          `Failed to load schema files from ${indexPath}.\n` +
          `Install jiti for TypeScript support: npm install -D jiti\n` +
          `Original error: ${jitiErr.message}`
        );
      }
    }

    // Count what we loaded
    const exportKeys = Object.keys(imports).filter(k => k !== 'default' && k !== '__esModule');
    console.log(`   Found ${exportKeys.length} exports from schema`);

    return imports;
  }

  // ------------------------------------------------------------------
  // Table exclusion — filter out Liquibase tracking tables
  // ------------------------------------------------------------------

  /**
   * Build the set of table names to exclude from generated migrations.
   * Always includes Liquibase's own tracking tables; users can add more
   * via the `excludeTables` config option.
   */
  getExcludedTables() {
    const custom = this.config?.excludeTables ?? [];
    const all = [...LIQUIBASE_TABLES, ...custom].map(t => t.toLowerCase());
    return [...new Set(all)];
  }

  /**
   * Returns true if a SQL statement references any excluded table.
   * Checks for table names in common DDL patterns:
   *   DROP TABLE "x", ALTER TABLE "x", CREATE INDEX ... ON "x",
   *   DROP POLICY ... ON "x", CREATE POLICY ... ON "x", etc.
   */
  statementReferencesExcludedTable(sql, excludedTables) {
    const upper = sql.toUpperCase();
    for (const table of excludedTables) {
      const t = table.toUpperCase();
      // Match quoted or unquoted table references in common DDL positions
      // e.g. DROP TABLE "databasechangelog", ALTER TABLE databasechangelog,
      //      ON "databasechangelog", TABLE `databasechangelog`
      const patterns = [
        `"${t}"`,          // double-quoted identifier (PostgreSQL)
        `\`${t}\``,        // backtick-quoted identifier (MySQL)
        ` ${t} `,          // unquoted with spaces
        ` ${t};`,          // unquoted at end of statement
        ` ${t}\n`,         // unquoted at end of line
        `.${t}"`,          // schema-qualified "public"."table"
        `.${t}\``,         // schema-qualified `public`.`table`
      ];
      for (const pattern of patterns) {
        if (upper.includes(pattern)) return true;
      }
    }
    return false;
  }

  /**
   * Remove any SQL statements that reference excluded tables.
   * Returns { filtered, removedCount }.
   */
  filterExcludedStatements(sqlStatements) {
    const excludedTables = this.getExcludedTables();
    if (!excludedTables.length) return { filtered: sqlStatements, removedCount: 0 };

    const filtered = [];
    let removedCount = 0;

    for (const stmt of sqlStatements) {
      if (this.statementReferencesExcludedTable(stmt, excludedTables)) {
        removedCount++;
      } else {
        filtered.push(stmt);
      }
    }

    return { filtered, removedCount };
  }

  // ------------------------------------------------------------------
  // Dialect-aware drizzle-kit API import
  // ------------------------------------------------------------------

  /**
   * Import the correct drizzle-kit API functions for the configured dialect.
   *
   * PostgreSQL:
   *   v1 beta: pushSchema from 'drizzle-kit/api-postgres'
   *   v0.31:   pushSchema from 'drizzle-kit/api'
   *
   * MySQL / SingleStore / SQLite:
   *   v0.31: pushXxxSchema from 'drizzle-kit/api'
   *   Note: drizzle-kit v0.31 has a bug where pushMySQLSchema's statementsToExecute
   *   is empty for DDL ops. Our postinstall script patches this (see scripts/patch-drizzle-kit.mjs).
   *
   * @returns {{ pushFn: Function, drizzleKitVersion: string }}
   */
  async importDrizzleKitApi() {
    const dialect = this.dialect;

    if (dialect === 'postgresql') {
      // Try v1 beta first, fall back to v0.31
      try {
        const api = await importFromProject('drizzle-kit/api-postgres', this._projectRoot);
        console.log('   Using drizzle-kit v1 API (drizzle-kit/api-postgres)');
        return { pushFn: api.pushSchema, drizzleKitVersion: 'v1' };
      } catch {
        try {
          const api = await importFromProject('drizzle-kit/api', this._projectRoot);
          console.log('   Using drizzle-kit v0.31 API (drizzle-kit/api)');
          return { pushFn: api.pushSchema, drizzleKitVersion: 'v0' };
        } catch (e) {
          throw new Error(
            'drizzle-kit is required for the drizzle-kit engine.\n' +
            'Install it: npm install -D drizzle-kit\n' +
            `Error: ${e.message}`
          );
        }
      }
    }

    // MySQL, SQLite, SingleStore — v0.31 only
    const pushFnName = {
      mysql: 'pushMySQLSchema',
      sqlite: 'pushSQLiteSchema',
      singlestore: 'pushSingleStoreSchema',
    }[dialect];

    if (!pushFnName) {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }

    try {
      const api = await importFromProject('drizzle-kit/api', this._projectRoot);
      if (!api[pushFnName]) {
        throw new Error(`drizzle-kit/api does not export ${pushFnName}. You may need drizzle-kit v0.31+.`);
      }
      console.log(`   Using drizzle-kit v0.31 API (${pushFnName})`);
      return {
        pushFn: api[pushFnName],
        drizzleKitVersion: 'v0',
      };
    } catch (e) {
      if (e.message.includes('does not export')) throw e;
      throw new Error(
        `drizzle-kit v0.31+ is required for ${dialect} dialect.\n` +
        'v1 beta does not yet support MySQL/SQLite/SingleStore push.\n' +
        'Install it: npm install -D drizzle-kit@0.31\n' +
        `Error: ${e.message}`
      );
    }
  }

  // ------------------------------------------------------------------
  // Dialect-aware database connection
  // ------------------------------------------------------------------

  /**
   * Create a drizzle ORM database instance for the configured dialect.
   *
   * Returns { db, cleanup, databaseName }
   *   db          — drizzle instance for pushSchema
   *   cleanup()   — async function to close the connection
   *   databaseName — extracted database name (needed for MySQL/SingleStore push)
   */
  async createDatabaseConnection() {
    const dialect = this.dialect;
    const url = this.databaseUrl;

    if (dialect === 'postgresql') {
      const { Client } = await importFromProject('pg', this._projectRoot);
      const client = new Client({ connectionString: url });
      await client.connect();

      const dorm = await importFromProject('drizzle-orm/node-postgres', this._projectRoot);
      const db = dorm.drizzle({ client });

      return {
        db,
        cleanup: () => client.end(),
        databaseName: null,
      };
    }

    if (dialect === 'mysql' || dialect === 'singlestore') {
      const mysql2 = await importFromProject('mysql2/promise', this._projectRoot);

      // Parse database name from URL
      const dbNameMatch = url.match(/\/([^/?]+)(?:\?|$)/);
      const databaseName = dbNameMatch?.[1];
      if (!databaseName) {
        throw new Error(
          'Could not extract database name from DATABASE_URL.\n' +
          'MySQL URL format: mysql://user:pass@host:port/dbname'
        );
      }

      const pool = mysql2.createPool(url);

      const dorm = await importFromProject('drizzle-orm/mysql2', this._projectRoot);
      const db = dorm.drizzle({ client: pool });

      return {
        db,
        cleanup: () => pool.end(),
        databaseName,
      };
    }

    if (dialect === 'sqlite') {
      // better-sqlite3 is the standard driver for Drizzle + SQLite.
      // URL can be a file path, file:./path, or :memory:
      const bs3Module = await importFromProject('better-sqlite3', this._projectRoot);
      const BetterSqlite3 = bs3Module.default ?? bs3Module;
      const dbPath = url.replace(/^file:/, '') || ':memory:';
      const sqlite = new BetterSqlite3(dbPath);

      const dorm = await importFromProject('drizzle-orm/better-sqlite3', this._projectRoot);
      const db = dorm.drizzle(sqlite);

      return {
        db,
        cleanup: () => sqlite.close(),
        databaseName: null,
      };
    }

    throw new Error(`Unsupported dialect: ${dialect}`);
  }

  // ------------------------------------------------------------------
  // Main entry point
  // ------------------------------------------------------------------

  async run() {
    console.log('🚀 Starting migration generation (drizzle-kit engine)...');

    try {
      await this.init();

      // 1. Load schema exports
      const imports = await this.loadSchemaExports();

      // 2. Import drizzle-kit API (dialect-aware)
      const { pushFn, drizzleKitVersion } = await this.importDrizzleKitApi();

      // 3. Create database connection and drizzle instance
      const { db, cleanup, databaseName } = await this.createDatabaseConnection();

      try {
        console.log('🔍 Comparing schema against database...');
        console.log(`   Dialect: ${this.dialect}`);

        // Call pushSchema with dialect-appropriate arguments
        let result;

        if (this.dialect === 'postgresql') {
          // Pass schema filters to drizzle-kit to limit introspection.
          // Default: ['public'] — prevents dropping tables from other schemas.
          const schemas = this.config.schemas ?? ['public'];
          if (schemas.length) {
            console.log(`   Schema filter: ${schemas.join(', ')}`);
          }

          if (drizzleKitVersion === 'v1') {
            // v1 beta: pushSchema(imports, db, casing?, entitiesConfig?, migrationsConfig?)
            result = await pushFn(imports, db, undefined, {
              schemas,
              tables: [],
              entities: undefined,
              extensions: [],
            });
          } else {
            // v0.31: pushSchema(imports, db, schemaFilters?, tablesFilter?, extensionsFilters?)
            result = await pushFn(imports, db, schemas);
          }
        } else if (this.dialect === 'sqlite') {
          // SQLite: pushSQLiteSchema(imports, db)
          result = await pushFn(imports, db);
        } else {
          // MySQL / SingleStore: pushXxxSchema(imports, db, databaseName)
          result = await pushFn(imports, db, databaseName);
        }

        // Normalise result — v0.31 and v1 beta return different shapes:
        //   v0.31:  { statementsToExecute: string[], hasDataLoss: boolean, warnings: string[] }
        //   v1:     { sqlStatements: string[], hints: { hint: string, statement?: string }[] }
        const rawStatements = [...new Set(result.sqlStatements ?? result.statementsToExecute ?? [])];

        // Filter out statements that reference excluded tables (Liquibase tracking tables etc.)
        const { filtered: sqlStatements, removedCount } = this.filterExcludedStatements(rawStatements);
        if (removedCount > 0) {
          console.log(`   Excluded ${removedCount} statement(s) referencing Liquibase tracking tables`);
        }

        // Show warnings / hints
        if (drizzleKitVersion === 'v1' && result.hints?.length) {
          console.log('\n⚠️  Hints:');
          result.hints.forEach(h => {
            console.log(`   ${h.hint}`);
            if (h.statement) console.log(`      → ${h.statement}`);
          });
        } else if (result.warnings?.length) {
          console.log('\n⚠️  Warnings:');
          result.warnings.forEach(w => console.log(`   ${w}`));
        }

        // No changes
        if (!sqlStatements.length) {
          console.log('✅ No schema changes detected.');
          return;
        }

        if (result.hasDataLoss) {
          console.log('\n⚠️  This migration may cause data loss. Review carefully.');
        }

        // Preview
        console.log(`\n📝 Found ${sqlStatements.length} statement(s):`);
        sqlStatements.forEach((sql, i) => {
          const preview = sql.length > 100 ? sql.substring(0, 100) + '...' : sql;
          console.log(`   ${i + 1}. ${preview}`);
        });

        // Generate Liquibase formatted migration
        const { statements, rollbackStatements } = this.buildLiquibaseStatements(sqlStatements);
        const filepath = this.generateMigrationFile(statements, rollbackStatements);

        console.log(`\n✅ Migration generated: ${filepath}`);
        console.log(`   ${sqlStatements.length} SQL statement(s) with rollback blocks`);
      } finally {
        await cleanup();
      }
    } catch (error) {
      console.error('❌ Error generating migration:', error.message);
      if (process.env.DEBUG) console.error(error.stack);
      process.exit(1);
    }
  }

  // ------------------------------------------------------------------
  // Liquibase formatting
  // ------------------------------------------------------------------

  /**
   * Take raw SQL statements from drizzle-kit and pair each with a rollback.
   */
  buildLiquibaseStatements(sqlStatements) {
    const statements = [];
    const rollbackStatements = [];

    for (const raw of sqlStatements) {
      const trimmed = raw.trim().replace(/;$/, '').trim();
      statements.push(trimmed + ';');
      rollbackStatements.push(this.generateRollback(trimmed));
    }

    return { statements, rollbackStatements };
  }

  /**
   * Pattern-match a SQL statement to produce a rollback statement.
   * Handles the most common DDL operations; destructive ops get a manual comment.
   * Dialect-aware: uses backticks for MySQL/SingleStore, double-quotes for PostgreSQL.
   */
  generateRollback(sql) {
    const upper = sql.toUpperCase().trim();
    const q = this.dialect === 'mysql' || this.dialect === 'singlestore' ? '`' : '"';

    // ── CREATE TABLE ──
    const createTable = sql.match(
      new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:[${q}"'\`]?(\\w+)[${q}"'\`]?\\.)?[${q}"'\`]?(\\w+)[${q}"'\`]?\\s*\\(`, 'i')
    );
    if (createTable) {
      const schema = createTable[1];
      const table = createTable[2];
      return schema
        ? `DROP TABLE IF EXISTS ${q}${schema}${q}.${q}${table}${q};`
        : `DROP TABLE IF EXISTS ${q}${table}${q};`;
    }

    // ── DROP TABLE ──
    if (upper.startsWith('DROP TABLE')) {
      return '-- Manual rollback required: recreate dropped table';
    }

    // ── RENAME TABLE ──
    // ALTER TABLE "old_name" RENAME TO "new_name"
    const renameTable = sql.match(
      new RegExp(`ALTER TABLE\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?\\s+RENAME TO\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?`, 'i')
    );
    if (renameTable && !upper.includes('RENAME COLUMN')) {
      return `ALTER TABLE ${q}${renameTable[2]}${q} RENAME TO ${q}${renameTable[1]}${q};`;
    }

    // ── RENAME COLUMN ──
    // ALTER TABLE "table" RENAME COLUMN "old_col" TO "new_col"
    const renameCol = sql.match(
      new RegExp(`ALTER TABLE\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?\\s+RENAME COLUMN\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?\\s+TO\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?`, 'i')
    );
    if (renameCol) {
      return `ALTER TABLE ${q}${renameCol[1]}${q} RENAME COLUMN ${q}${renameCol[3]}${q} TO ${q}${renameCol[2]}${q};`;
    }

    // ── ADD COLUMN ──
    // MySQL omits the COLUMN keyword: ALTER TABLE `t` ADD `col` ...
    // Negative lookahead prevents matching ADD CONSTRAINT, ADD INDEX, ADD FOREIGN KEY, etc.
    const addCol = sql.match(
      new RegExp(`ALTER TABLE\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?\\s+ADD\\s+(?:COLUMN\\s+)?(?!CONSTRAINT\\b|INDEX\\b|UNIQUE\\b|FOREIGN\\b|PRIMARY\\b|CHECK\\b|KEY\\b|PARTITION\\b)[${q}"'\`]?(\\w+)[${q}"'\`]?`, 'i')
    );
    if (addCol) {
      return `ALTER TABLE ${q}${addCol[1]}${q} DROP COLUMN ${q}${addCol[2]}${q};`;
    }

    // ── DROP COLUMN ──
    if (upper.includes('DROP COLUMN')) {
      return '-- Manual rollback required: recreate dropped column';
    }

    // ── SET NOT NULL (PostgreSQL-style) ──
    const setNN = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+ALTER COLUMN\s+[`"']?(\w+)[`"']?\s+SET NOT NULL/i);
    if (setNN) {
      return `ALTER TABLE ${q}${setNN[1]}${q} ALTER COLUMN ${q}${setNN[2]}${q} DROP NOT NULL;`;
    }

    // ── MODIFY COLUMN (MySQL-style for NOT NULL changes) ──
    const modifyCol = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+MODIFY\s+(?:COLUMN\s+)?[`"']?(\w+)[`"']?/i);
    if (modifyCol) {
      return '-- Manual rollback required: revert MODIFY COLUMN change';
    }

    // ── DROP NOT NULL ──
    const dropNN = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+ALTER COLUMN\s+[`"']?(\w+)[`"']?\s+DROP NOT NULL/i);
    if (dropNN) {
      return `ALTER TABLE ${q}${dropNN[1]}${q} ALTER COLUMN ${q}${dropNN[2]}${q} SET NOT NULL;`;
    }

    // ── SET DEFAULT ──
    const setDef = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+ALTER COLUMN\s+[`"']?(\w+)[`"']?\s+SET DEFAULT/i);
    if (setDef) {
      return `ALTER TABLE ${q}${setDef[1]}${q} ALTER COLUMN ${q}${setDef[2]}${q} DROP DEFAULT;`;
    }

    // ── DROP DEFAULT ──
    const dropDef = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+ALTER COLUMN\s+[`"']?(\w+)[`"']?\s+DROP DEFAULT/i);
    if (dropDef) {
      return '-- Manual rollback required: set default back to previous value';
    }

    // ── ALTER COLUMN TYPE (PostgreSQL) / MODIFY COLUMN (MySQL) ──
    if ((upper.includes('ALTER COLUMN') && upper.includes('SET DATA TYPE')) ||
        (upper.includes('MODIFY') && upper.includes('COLUMN'))) {
      return '-- Manual rollback required: revert column type change';
    }

    // ── CREATE INDEX ──
    // MySQL requires ON <table>: DROP INDEX `idx` ON `table`
    // PostgreSQL uses: DROP INDEX IF EXISTS "idx"
    const createIdx = sql.match(
      new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF NOT EXISTS\\s+)?[${q}"'\`]?(\\w+)[${q}"'\`]?(?:\\s+ON\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?)?`, 'i')
    );
    if (createIdx) {
      const idxName = createIdx[1];
      const tableName = createIdx[2];
      if ((this.dialect === 'mysql' || this.dialect === 'singlestore') && tableName) {
        return `DROP INDEX ${q}${idxName}${q} ON ${q}${tableName}${q};`;
      }
      return `DROP INDEX IF EXISTS ${q}${idxName}${q};`;
    }

    // ── DROP INDEX ──
    if (upper.startsWith('DROP INDEX')) {
      return '-- Manual rollback required: recreate dropped index';
    }

    // ── ADD CONSTRAINT ──
    const addConst = sql.match(
      new RegExp(`ALTER TABLE\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?\\s+ADD CONSTRAINT\\s+[${q}"'\`]?(\\w+)[${q}"'\`]?`, 'i')
    );
    if (addConst) {
      return `ALTER TABLE ${q}${addConst[1]}${q} DROP CONSTRAINT ${q}${addConst[2]}${q};`;
    }

    // ── DROP CONSTRAINT ──
    if (upper.includes('DROP CONSTRAINT')) {
      return '-- Manual rollback required: recreate dropped constraint';
    }

    // ── CREATE TYPE (enum) — PostgreSQL only ──
    const createType = sql.match(/CREATE TYPE\s+[`"']?(\w+)[`"']?/i);
    if (createType) {
      return `DROP TYPE IF EXISTS ${q}${createType[1]}${q};`;
    }

    // ── ALTER TYPE ADD VALUE (enum) — PostgreSQL only ──
    if (upper.includes('ALTER TYPE') && upper.includes('ADD VALUE')) {
      return '-- Enum value additions cannot be rolled back in PostgreSQL';
    }

    // ── ENABLE ROW LEVEL SECURITY — PostgreSQL only ──
    const enableRLS = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+ENABLE ROW LEVEL SECURITY/i);
    if (enableRLS) {
      return `ALTER TABLE ${q}${enableRLS[1]}${q} DISABLE ROW LEVEL SECURITY;`;
    }

    // ── DISABLE ROW LEVEL SECURITY — PostgreSQL only ──
    const disableRLS = sql.match(/ALTER TABLE\s+[`"']?(\w+)[`"']?\s+DISABLE ROW LEVEL SECURITY/i);
    if (disableRLS) {
      return `ALTER TABLE ${q}${disableRLS[1]}${q} ENABLE ROW LEVEL SECURITY;`;
    }

    // ── CREATE POLICY — PostgreSQL only ──
    const createPol = sql.match(/CREATE POLICY\s+[`"']?([^`"']+)[`"']?\s+ON\s+[`"']?(\w+)[`"']?/i);
    if (createPol) {
      return `DROP POLICY IF EXISTS ${q}${createPol[1]}${q} ON ${q}${createPol[2]}${q};`;
    }

    // ── DROP POLICY — PostgreSQL only ──
    if (upper.startsWith('DROP POLICY')) {
      return '-- Manual rollback required: recreate dropped policy';
    }

    // ── CREATE SEQUENCE — PostgreSQL only ──
    const createSeq = sql.match(/CREATE SEQUENCE\s+(?:IF NOT EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    if (createSeq) {
      return `DROP SEQUENCE IF EXISTS ${q}${createSeq[1]}${q};`;
    }

    // ── DROP SEQUENCE ──
    if (upper.startsWith('DROP SEQUENCE')) {
      return '-- Manual rollback required: recreate dropped sequence';
    }

    // ── Fallback ──
    return '-- Manual rollback required';
  }

  // ------------------------------------------------------------------
  // File generation (matches custom engine format exactly)
  // ------------------------------------------------------------------

  getCurrentUser() {
    try {
      if (this.config?.author) return this.config.author;
      try {
        const email = execSync('git config user.email', { encoding: 'utf8' }).trim();
        if (email) return email;
      } catch { /* ignore */ }
      try {
        const name = execSync('git config user.name', { encoding: 'utf8' }).trim();
        if (name) return name;
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    return process.env.USER || process.env.USERNAME || process.env.LOGNAME || 'unknown';
  }

  generateMigrationFile(statements, rollbackStatements) {
    const pattern = this.config?.timestampFormat || 'YYYYMMDDHHmmss';
    const timestamp = formatTimestamp(new Date(), pattern);
    const baseName = this.customName || 'schema_diff_migration';
    const filename = baseName.match(/\.([a-zA-Z0-9]+)$/)
      ? `${timestamp}_${baseName}`
      : `${timestamp}_${baseName}.sql`;

    // Ensure migrations directory exists
    if (!existsSync(this.migrationsDir)) {
      mkdirSync(this.migrationsDir, { recursive: true });
    }

    const filepath = join(this.migrationsDir, filename);
    const changesetName = filename.replace(/^\d+_/, '').replace(/\.sql$/, '');
    const author = this.getCurrentUser();

    // PostgreSQL uses splitStatements:false with a custom endDelimiter of
    // '--> statement-breakpoint', so both forward and rollback lines need it.
    // MySQL/SingleStore/SQLite use splitStatements:true (the default) and split
    // on ';', so '--> statement-breakpoint' is just noise (or worse, invalid SQL).
    const useCustomDelimiter = this.dialect === 'postgresql';

    const statementsWithDelimiter = statements.map(stmt => {
      const clean = stmt.replace(/\s*-->\s*statement-breakpoint\s*$/, '').trim();
      return useCustomDelimiter ? clean + '\n--> statement-breakpoint' : clean;
    });

    // Rollbacks must execute in reverse order: if forward creates tables then
    // adds FKs then creates indexes, rollback must drop indexes, then FKs, then tables.
    let reversedRollbacks = [...rollbackStatements].reverse();

    // MySQL/SingleStore: indexes back foreign keys, so we must DROP CONSTRAINT
    // before DROP INDEX, otherwise MySQL refuses with "needed in a foreign key
    // constraint". Re-sort so: DROP CONSTRAINT → DROP INDEX → DROP TABLE → rest.
    if (this.dialect === 'mysql' || this.dialect === 'singlestore') {
      const priority = (s) => {
        const u = s.toUpperCase();
        if (u.includes('DROP CONSTRAINT') || u.includes('DROP FOREIGN KEY')) return 0;
        if (u.includes('DROP INDEX')) return 1;
        if (u.includes('DROP TABLE')) return 2;
        return 3;
      };
      reversedRollbacks = reversedRollbacks.sort((a, b) => priority(a) - priority(b));
    }

    const rollbackWithDelimiter = reversedRollbacks.map(stmt => {
      const clean = stmt.replace(/;\s*-->\s*statement-breakpoint\s*$/, '').replace(/;$/, '').trim();
      // PostgreSQL uses custom endDelimiter, so rollbacks need the same delimiter.
      // MySQL/SQLite/SingleStore use splitStatements:true (default) and split on ';',
      // so '--> statement-breakpoint' would be sent as invalid SQL.
      if (useCustomDelimiter) {
        return `--rollback ${clean};\n--rollback --> statement-breakpoint`;
      }
      return `--rollback ${clean};`;
    });

    const changesetHeader = useCustomDelimiter
      ? `--changeset ${author}:${changesetName} splitStatements:false endDelimiter:--> statement-breakpoint`
      : `--changeset ${author}:${changesetName}`;

    const content = `--liquibase formatted sql

${changesetHeader}

${statementsWithDelimiter.join('\n\n')}

${rollbackWithDelimiter.join('\n')}
`;

    writeFileSync(filepath, content);

    // Update master changelog
    try {
      this.addToMasterChangelog(filename);
    } catch (err) {
      console.warn('Could not update master changelog:', err.message);
    }

    return filepath;
  }

  addToMasterChangelog(filename) {
    const changelogPath = this.config.masterChangelog;
    if (!existsSync(changelogPath)) {
      const dir = dirname(changelogPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const template = `<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.20.xsd">

    <!-- Include all SQL migration files in chronological order -->
    <include file="migrations/${filename}"/>
</databaseChangeLog>
`;
      writeFileSync(changelogPath, template);
      console.log('Created master changelog with first migration:', filename);
      return;
    }

    const content = readFileSync(changelogPath, 'utf-8');
    const includeRegex = /^\s*<include\s+file="migrations\/([^"]+\.(?:sql|xml|yaml|yml|json))"\/>\s*$/gim;
    const matches = Array.from(content.matchAll(includeRegex));
    const existing = matches.map(m => m[1]);

    if (existing.includes(filename)) return;

    const all = existing.concat([filename]);
    all.sort((a, b) => {
      const ta = parseInt((a.match(/^(\d+)_/) || [0, '0'])[1], 10) || 0;
      const tb = parseInt((b.match(/^(\d+)_/) || [0, '0'])[1], 10) || 0;
      if (ta === tb) return a.localeCompare(b);
      return ta - tb;
    });

    const includeLines = all.map(f => `    <include file="migrations/${f}"/>`).join('\n');

    if (matches.length > 0) {
      const firstIndex = matches[0].index;
      const lastMatch = matches[matches.length - 1];
      const lastEnd = lastMatch.index + lastMatch[0].length;
      const updated = content.slice(0, firstIndex) + includeLines + content.slice(lastEnd);
      writeFileSync(changelogPath, updated);
    } else {
      const closingTag = '</databaseChangeLog>';
      const idx = content.indexOf(closingTag);
      if (idx !== -1) {
        const before = content.slice(0, idx);
        const after = content.slice(idx);
        const needNl = !/\n$/.test(before);
        writeFileSync(changelogPath, before + (needNl ? '\n' : '') + includeLines + '\n' + after);
      }
    }
    console.log('Updated master changelog with:', filename);
  }
}

export default DrizzleKitEngine;
