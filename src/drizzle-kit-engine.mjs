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
import { Client } from 'pg';
import { loadConfig, formatTimestamp } from './config.mjs';

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
   */
  constructor(opts = {}) {
    this.customName = opts.name ?? null;
    this._configOverride = opts.config ?? null;
    this._projectRoot = opts.projectRoot ?? null;
    this._cliExcludeTables = opts.excludeTables ?? [];
    this._cliSchemas = opts.schemas ?? [];

    this.config = null;
    this.schemaDir = null;
    this.migrationsDir = null;
    this.databaseUrl = null;
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
      //      ON "databasechangelog", TABLE "databasechangelog"
      const patterns = [
        `"${t}"`,          // quoted identifier
        ` ${t} `,          // unquoted with spaces
        ` ${t};`,          // unquoted at end of statement
        ` ${t}\n`,         // unquoted at end of line
        `.${t}"`,          // schema-qualified "public"."table"
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
  // Main entry point
  // ------------------------------------------------------------------

  async run() {
    console.log('🚀 Starting migration generation (drizzle-kit engine)...');

    try {
      await this.init();

      // 1. Load schema exports
      const imports = await this.loadSchemaExports();

      // 2. Import drizzle-kit API
      //    v1 beta uses 'drizzle-kit/api-postgres', v0.31 uses 'drizzle-kit/api'
      let pushSchema;
      let drizzleKitVersion = 'unknown';
      try {
        // Try v1 beta first (drizzle-kit/api-postgres)
        const api = await importFromProject('drizzle-kit/api-postgres', this._projectRoot);
        pushSchema = api.pushSchema;
        drizzleKitVersion = 'v1';
        console.log('   Using drizzle-kit v1 API (drizzle-kit/api-postgres)');
      } catch {
        try {
          // Fall back to v0.31 (drizzle-kit/api)
          const api = await importFromProject('drizzle-kit/api', this._projectRoot);
          pushSchema = api.pushSchema;
          drizzleKitVersion = 'v0';
          console.log('   Using drizzle-kit v0.31 API (drizzle-kit/api)');
        } catch (e) {
          throw new Error(
            'drizzle-kit is required for the drizzle-kit engine.\n' +
            'Install it: npm install -D drizzle-kit\n' +
            `Error: ${e.message}`
          );
        }
      }

      // 3. Create drizzle-orm database instance
      let drizzle;
      try {
        const dorm = await importFromProject('drizzle-orm/node-postgres', this._projectRoot);
        drizzle = dorm.drizzle;
      } catch (e) {
        throw new Error(
          'drizzle-orm with node-postgres driver is required for the drizzle-kit engine.\n' +
          'Install it: npm install -D drizzle-orm\n' +
          `Error: ${e.message}`
        );
      }

      const client = new Client({ connectionString: this.databaseUrl });

      try {
        await client.connect();
        const db = drizzle({ client });

        console.log('🔍 Comparing schema against database...');

        // Pass schema filters to drizzle-kit to limit introspection.
        // Default: ['public'] — prevents dropping tables from other schemas
        // (auth, storage, realtime, etc. in Supabase projects).
        const schemas = this.config.schemas ?? ['public'];
        if (schemas.length) {
          console.log(`   Schema filter: ${schemas.join(', ')}`);
        }

        let result;
        if (drizzleKitVersion === 'v1') {
          // v1 beta: pushSchema(imports, db, casing?, entitiesConfig?, migrationsConfig?)
          result = await pushSchema(imports, db, undefined, {
            schemas,
            tables: [],
            entities: undefined,
            extensions: [],
          });
        } else {
          // v0.31: pushSchema(imports, db, schemaFilters?, tablesFilter?, extensionsFilters?)
          result = await pushSchema(imports, db, schemas);
        }

        // Normalise result — v0.31 and v1 beta return different shapes:
        //   v0.31:  { statementsToExecute: string[], hasDataLoss: boolean, warnings: string[] }
        //   v1:     { sqlStatements: string[], hints: { hint: string, statement?: string }[] }
        const rawStatements = result.sqlStatements ?? result.statementsToExecute ?? [];

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
        await client.end();
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
   */
  generateRollback(sql) {
    const upper = sql.toUpperCase().trim();

    // ── CREATE TABLE ──
    const createTable = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/i);
    if (createTable) {
      const schema = createTable[1];
      const table = createTable[2];
      return schema
        ? `DROP TABLE IF EXISTS "${schema}"."${table}";`
        : `DROP TABLE IF EXISTS "${table}";`;
    }

    // ── DROP TABLE ──
    if (upper.startsWith('DROP TABLE')) {
      return '-- Manual rollback required: recreate dropped table';
    }

    // ── ADD COLUMN ──
    const addCol = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?/i);
    if (addCol) {
      return `ALTER TABLE "${addCol[1]}" DROP COLUMN "${addCol[2]}";`;
    }

    // ── DROP COLUMN ──
    if (upper.includes('DROP COLUMN')) {
      return '-- Manual rollback required: recreate dropped column';
    }

    // ── SET NOT NULL ──
    const setNN = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+SET NOT NULL/i);
    if (setNN) {
      return `ALTER TABLE "${setNN[1]}" ALTER COLUMN "${setNN[2]}" DROP NOT NULL;`;
    }

    // ── DROP NOT NULL ──
    const dropNN = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+DROP NOT NULL/i);
    if (dropNN) {
      return `ALTER TABLE "${dropNN[1]}" ALTER COLUMN "${dropNN[2]}" SET NOT NULL;`;
    }

    // ── SET DEFAULT ──
    const setDef = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+SET DEFAULT/i);
    if (setDef) {
      return `ALTER TABLE "${setDef[1]}" ALTER COLUMN "${setDef[2]}" DROP DEFAULT;`;
    }

    // ── DROP DEFAULT ──
    const dropDef = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+DROP DEFAULT/i);
    if (dropDef) {
      return '-- Manual rollback required: set default back to previous value';
    }

    // ── ALTER COLUMN TYPE ──
    if (upper.includes('ALTER COLUMN') && upper.includes('SET DATA TYPE')) {
      return '-- Manual rollback required: revert column type change';
    }

    // ── CREATE INDEX ──
    const createIdx = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/i);
    if (createIdx) {
      return `DROP INDEX IF EXISTS "${createIdx[1]}";`;
    }

    // ── DROP INDEX ──
    if (upper.startsWith('DROP INDEX')) {
      return '-- Manual rollback required: recreate dropped index';
    }

    // ── ADD CONSTRAINT ──
    const addConst = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD CONSTRAINT\s+"?(\w+)"?/i);
    if (addConst) {
      return `ALTER TABLE "${addConst[1]}" DROP CONSTRAINT "${addConst[2]}";`;
    }

    // ── DROP CONSTRAINT ──
    if (upper.includes('DROP CONSTRAINT')) {
      return '-- Manual rollback required: recreate dropped constraint';
    }

    // ── CREATE TYPE (enum) ──
    const createType = sql.match(/CREATE TYPE\s+"?(\w+)"?/i);
    if (createType) {
      return `DROP TYPE IF EXISTS "${createType[1]}";`;
    }

    // ── ALTER TYPE ADD VALUE (enum) ──
    if (upper.includes('ALTER TYPE') && upper.includes('ADD VALUE')) {
      return '-- Enum value additions cannot be rolled back in PostgreSQL';
    }

    // ── ENABLE ROW LEVEL SECURITY ──
    const enableRLS = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ENABLE ROW LEVEL SECURITY/i);
    if (enableRLS) {
      return `ALTER TABLE "${enableRLS[1]}" DISABLE ROW LEVEL SECURITY;`;
    }

    // ── DISABLE ROW LEVEL SECURITY ──
    const disableRLS = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+DISABLE ROW LEVEL SECURITY/i);
    if (disableRLS) {
      return `ALTER TABLE "${disableRLS[1]}" ENABLE ROW LEVEL SECURITY;`;
    }

    // ── CREATE POLICY ──
    const createPol = sql.match(/CREATE POLICY\s+"?([^"]+)"?\s+ON\s+"?(\w+)"?/i);
    if (createPol) {
      return `DROP POLICY IF EXISTS "${createPol[1]}" ON "${createPol[2]}";`;
    }

    // ── DROP POLICY ──
    if (upper.startsWith('DROP POLICY')) {
      return '-- Manual rollback required: recreate dropped policy';
    }

    // ── CREATE SEQUENCE ──
    const createSeq = sql.match(/CREATE SEQUENCE\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i);
    if (createSeq) {
      return `DROP SEQUENCE IF EXISTS "${createSeq[1]}";`;
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

    const statementsWithDelimiter = statements.map(
      stmt => stmt.replace(/\s*-->\s*statement-breakpoint\s*$/, '').trim() + '\n--> statement-breakpoint'
    );

    const rollbackWithDelimiter = rollbackStatements.map(stmt => {
      const clean = stmt.replace(/;\s*-->\s*statement-breakpoint\s*$/, '').replace(/;$/, '').trim();
      return `--rollback ${clean};\n--rollback --> statement-breakpoint`;
    });

    const content = `--liquibase formatted sql

--changeset ${author}:${changesetName} splitStatements:false endDelimiter:--> statement-breakpoint

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
