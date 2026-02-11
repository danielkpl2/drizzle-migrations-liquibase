/**
 * drizzle-migrations-liquibase — Schema Diff Generator
 *
 * Compares Drizzle ORM schema files against a live PostgreSQL database and
 * produces a Liquibase-compatible SQL migration capturing the differences.
 *
 * Supports two modes:
 *   normal  — "what's in the schema but not in DB" (schema → DB)
 *   reverse — "what's in the DB but not in the schema" (DB → schema)
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Client } from 'pg';
import { loadConfig, formatTimestamp } from './config.mjs';
import { ASTSchemaParser } from './ast-parser.mjs';

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class SchemaDiffGenerator {
  /**
   * @param {object} opts
   * @param {string}  [opts.name]          — custom migration name
   * @param {boolean} [opts.reverse=false] — reverse mode
   * @param {object}  [opts.config]        — pre-loaded config (skips loadConfig)
   * @param {string}  [opts.projectRoot]   — project root (for loadConfig fallback)
   */
  constructor(opts = {}) {
    this.customName = opts.name ?? null;
    this.reverse = opts.reverse ?? false;
    this._configOverride = opts.config ?? null;
    this._projectRoot = opts.projectRoot ?? null;

    // Will be populated by init()
    this.config = null;
    this.schemaDir = null;
    this.migrationsDir = null;
    this.databaseUrl = null;
    this.sqlClient = null;

    // AST-based schema parser (replaces regex-based parsing)
    this.astParser = new ASTSchemaParser();

    // Drizzle variable name → physical table name mapping
    this.varToPhysical = {};
    // table → { logicalCol → physicalCol }
    this.columnLogicalToPhysical = {};
  }

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  async init() {
    this.config = this._configOverride || (await loadConfig(this._projectRoot));

    if (!this.config.schemaDir) {
      throw new Error(
        'schemaDir is required in drizzle-liquibase.config.mjs (path to your Drizzle schema directory)'
      );
    }

    this.schemaDir = this.config.schemaDir;
    this.migrationsDir = this.config.migrationsDir;
    this.databaseUrl = this.config.databaseUrl;

    this.options = { ...this.config.diff };

    // Validate custom name
    if (this.customName !== null) {
      if (typeof this.customName !== 'string' || this.customName.trim().length === 0) {
        throw new Error('Custom name must be a non-empty string');
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(this.customName)) {
        throw new Error('Custom name can only contain letters, numbers, underscores, and hyphens');
      }
      if (this.customName.length > 80) {
        throw new Error('Custom name must be 80 characters or less');
      }
    }

    if (!this.databaseUrl) {
      throw new Error(
        'DATABASE_URL is not configured. Set it in drizzle-liquibase.config.mjs, ' +
        '.env, or as an environment variable.'
      );
    }
  }

  // ------------------------------------------------------------------
  // Security helpers
  // ------------------------------------------------------------------

  escapeIdentifier(identifier) {
    if (typeof identifier !== 'string') {
      throw new Error('Identifier must be a string');
    }
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  validateIdentifier(identifier, context = 'identifier') {
    if (typeof identifier !== 'string' || identifier.length === 0) {
      throw new Error(`Invalid ${context}: must be a non-empty string`);
    }
    if (identifier.length > 63) {
      if (context === 'policy name') {
        throw new Error(
          `❌ FATAL: Policy name "${identifier}" exceeds PostgreSQL's 63 character limit (${identifier.length} chars).\n` +
          `   PostgreSQL will silently truncate this to "${identifier.substring(0, 63)}".\n` +
          `   This causes drift detection issues. Please use a shorter policy name in the schema.`
        );
      }
      const truncated = identifier.substring(0, 63);
      console.warn(`⚠️  ${context} "${identifier}" exceeds 63 characters. Truncating to: "${truncated}"`);
      return truncated;
    }
    if (identifier.includes('\0') || identifier.includes('\r') || identifier.includes('\n')) {
      throw new Error(`Invalid ${context}: contains forbidden characters`);
    }
    return identifier;
  }

  validateSqlMethod(method, allowedMethods) {
    if (typeof method !== 'string') {
      throw new Error('SQL method must be a string');
    }
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
      throw new Error(`Invalid SQL method: ${method}. Allowed: ${allowedMethods.join(', ')}`);
    }
    return upperMethod;
  }

  sanitizePolicyExpression(expression) {
    if (!expression || typeof expression !== 'string') return '';
    const dangerous = /(\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b.*;|\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b.*--|\*\/.*;)/gi;
    if (dangerous.test(expression)) {
      throw new Error('Policy expression contains potentially dangerous SQL patterns');
    }
    if (expression.includes('\0') || expression.includes('\r')) {
      throw new Error('Policy expression contains forbidden characters');
    }
    return expression.trim();
  }

  // ------------------------------------------------------------------
  // Database connection
  // ------------------------------------------------------------------

  async initDb() {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    this.sqlClient = client;
  }

  async cleanup() {
    if (this.sqlClient && typeof this.sqlClient.end === 'function') {
      try {
        await this.sqlClient.end();
      } catch (error) {
        console.warn('Warning: Error closing database connection:', error.message);
      } finally {
        this.sqlClient = null;
      }
    }
  }

  // ------------------------------------------------------------------
  // Database introspection
  // ------------------------------------------------------------------

  async getDatabaseSchema() {
    console.log('🔍 Introspecting current database schema...');

    const tablesRes = await this.sqlClient.query(`
      SELECT
        t.table_name,
        t.table_schema,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        tc.constraint_type,
        kcu.column_name as fk_column,
        ccu.table_name as fk_table,
        ccu.column_name as fk_ref_column
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      LEFT JOIN information_schema.table_constraints tc ON t.table_name = tc.table_name AND t.table_schema = tc.table_schema
      LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE 'pg_%'
        AND t.table_name NOT LIKE '_prisma_%'
        AND t.table_name NOT IN ('databasechangelog', 'databasechangeloglock')
      ORDER BY t.table_name, c.ordinal_position
    `);

    const indexesRes = await this.sqlClient.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
        AND tablename NOT LIKE '_prisma_%'
        AND tablename NOT IN ('databasechangelog', 'databasechangeloglock')
    `);

    const policiesRes = await this.sqlClient.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
    `);

    const foreignKeysRes = await this.sqlClient.query(`
      SELECT
        con.conname as constraint_name,
        nsp.nspname as schema_name,
        cls.relname as table_name,
        att.attname as column_name,
        refcls.relname as ref_table,
        refatt.attname as ref_column
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      JOIN pg_class refcls ON refcls.oid = con.confrelid
      JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
      JOIN pg_attribute refatt ON refatt.attrelid = con.confrelid AND refatt.attnum = fk.attnum
      WHERE con.contype = 'f' AND nsp.nspname = 'public'
    `);

    const uniqueConstraintsRes = await this.sqlClient.query(`
      SELECT
        con.conname as constraint_name,
        cls.relname as table_name,
        att.attname as column_name
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      WHERE con.contype = 'u' AND nsp.nspname = 'public'
      ORDER BY con.conname, k.ord
    `);

    return this.parseDatabaseResults(
      tablesRes.rows,
      indexesRes.rows,
      policiesRes.rows,
      foreignKeysRes.rows,
      uniqueConstraintsRes.rows
    );
  }

  // ------------------------------------------------------------------
  // Parse database introspection results
  // ------------------------------------------------------------------

  parseDatabaseResults(tables, indexes, policies, foreignKeys = [], uniqueConstraintsData = []) {
    const tableMap = {};
    const uniqueTemp = {};

    tables.forEach((row) => {
      if (!tableMap[row.table_name]) {
        tableMap[row.table_name] = {
          name: row.table_name,
          schema: row.table_schema,
          columns: {},
          constraints: [],
          foreignKeys: {},
          uniqueConstraints: [],
          indexes: [],
          policies: [],
        };
      }

      if (row.column_name) {
        const mapped = this.mapPostgresType(row.data_type, row.udt_name);
        tableMap[row.table_name].columns[row.column_name] = {
          name: row.column_name,
          ...mapped,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
        };
      }

      if (row.constraint_type) {
        if (row.constraint_type === 'FOREIGN KEY' && row.fk_column) {
          tableMap[row.table_name].foreignKeys[row.fk_column] = {
            column: row.fk_column,
            references: row.fk_table ? { table: row.fk_table, column: row.fk_ref_column } : null,
            constraintName: row.constraint_name,
          };
        } else if (row.constraint_type === 'UNIQUE') {
          if (!uniqueTemp[row.constraint_name])
            uniqueTemp[row.constraint_name] = { table: row.table_name, columns: [] };
          if (row.fk_column) uniqueTemp[row.constraint_name].columns.push(row.fk_column);
        }
      }
    });

    // Overwrite with reliable FK data from pg_constraint
    foreignKeys.forEach((fk) => {
      if (!tableMap[fk.table_name]) return;
      tableMap[fk.table_name].foreignKeys[fk.column_name] = {
        column: fk.column_name,
        references: { table: fk.ref_table, column: fk.ref_column },
        constraintName: fk.constraint_name,
      };
    });

    // Reliable unique constraints from pg_constraint
    const uniqueFromPg = {};
    uniqueConstraintsData.forEach((uq) => {
      if (!uniqueFromPg[uq.constraint_name]) {
        uniqueFromPg[uq.constraint_name] = { table: uq.table_name, columns: [] };
      }
      uniqueFromPg[uq.constraint_name].columns.push(uq.column_name);
    });
    Object.entries(uniqueFromPg).forEach(([cname, data]) => {
      uniqueTemp[cname] = data;
    });
    Object.entries(uniqueTemp).forEach(([cname, data]) => {
      if (tableMap[data.table]) {
        tableMap[data.table].uniqueConstraints.push({ name: cname, columns: data.columns.sort() });
      }
    });

    // Indexes
    indexes.forEach((idx) => {
      if (tableMap[idx.tablename]) {
        tableMap[idx.tablename].indexes.push({ name: idx.indexname, definition: idx.indexdef });
      }
    });

    // Policies
    policies.forEach((policy) => {
      if (tableMap[policy.tablename]) {
        let rolesArr = [];
        if (policy.roles) {
          if (Array.isArray(policy.roles)) {
            rolesArr = policy.roles.map((r) => String(r).trim()).filter(Boolean).sort();
          } else if (typeof policy.roles === 'string') {
            rolesArr = policy.roles
              .replace(/[{}]/g, '')
              .split(',')
              .map((r) => r.trim())
              .filter(Boolean)
              .sort();
          }
        }
        tableMap[policy.tablename].policies.push({
          name: policy.policyname,
          command: (policy.cmd || '').toLowerCase(),
          roles: rolesArr,
          using: policy.qual && policy.qual.trim(),
          with_check: policy.with_check && policy.with_check.trim(),
        });
      }
    });

    return tableMap;
  }

  // ------------------------------------------------------------------
  // PostgreSQL type mapping
  // ------------------------------------------------------------------

  mapPostgresType(pgType, udtName) {
    const typeMap = {
      integer: 'integer',
      bigint: 'bigint',
      smallint: 'smallint',
      'character varying': 'varchar',
      text: 'text',
      boolean: 'boolean',
      'timestamp without time zone': 'timestamp',
      'timestamp with time zone': 'timestamp',
      date: 'date',
      'time without time zone': 'time',
      numeric: 'numeric',
      real: 'real',
      'double precision': 'doublePrecision',
      json: 'json',
      jsonb: 'jsonb',
      uuid: 'uuid',
      bytea: 'bytea',
      'USER-DEFINED': 'varchar',
      'user-defined': 'varchar',
    };

    if (pgType === 'ARRAY') {
      const base = (udtName || '').replace(/^_/, '');
      return { type: typeMap[base] || base, isArray: true, enumName: this.isLikelyEnum(base) ? base : null };
    }
    if (pgType === 'USER-DEFINED' && udtName) {
      return { type: 'varchar', isArray: false, enumName: udtName };
    }
    return { type: typeMap[pgType] || pgType, isArray: false, enumName: null };
  }

  isLikelyEnum(name) {
    return /[a-z0-9_]/.test(name);
  }

  // ------------------------------------------------------------------
  // Drizzle schema parsing (AST-based via ASTSchemaParser)
  // ------------------------------------------------------------------

  async getDrizzleSchema() {
    console.log('📖 Parsing Drizzle schema files...');

    const indexPath = join(this.schemaDir, this.config.schemaIndexFile || 'index.ts');
    if (!existsSync(indexPath)) {
      throw new Error(`Schema index file not found: ${indexPath}`);
    }

    const indexContent = readFileSync(indexPath, 'utf-8');
    const schemaFiles = this.astParser.parseImports(indexContent);

    const schemas = {};
    for (const file of schemaFiles) {
      const filePath = join(this.schemaDir, `${file}.ts`);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        schemas[file] = this.astParser.parseFile(content, file);
        // Collect var → physical mapping
        Object.entries(schemas[file]).forEach(([varName, t]) => {
          if (t && t.name) {
            this.varToPhysical[varName] = t.name;
            if (!this.columnLogicalToPhysical[t.name]) {
              this.columnLogicalToPhysical[t.name] = {};
            }
            Object.values(t.columns).forEach((col) => {
              if (col.logicalName && col.name && col.logicalName !== col.name) {
                this.columnLogicalToPhysical[t.name][col.logicalName] = col.name;
              }
            });
          }
        });
      }
    }

    // Normalise FK references from variable name → physical table/column name
    Object.values(schemas).forEach((fileTables) => {
      Object.values(fileTables).forEach((tableDef) => {
        Object.values(tableDef.columns).forEach((col) => {
          if (col.references) {
            if (this.varToPhysical[col.references.table]) {
              col.references.table = this.varToPhysical[col.references.table];
            }
            if (
              this.columnLogicalToPhysical[col.references.table] &&
              this.columnLogicalToPhysical[col.references.table][col.references.column]
            ) {
              col.references.column =
                this.columnLogicalToPhysical[col.references.table][col.references.column];
            }
          }
        });
      });
    });

    return schemas;
  }

  // ------------------------------------------------------------------
  // Schema comparison — normal mode
  // ------------------------------------------------------------------

  compareSchemas(drizzleSchema, dbSchema) {
    const changes = this._emptyChanges();

    for (const [, fileTables] of Object.entries(drizzleSchema)) {
      for (const [, tableDef] of Object.entries(fileTables)) {
        const tableName = tableDef.name;
        if (!dbSchema[tableName]) {
          changes.tablesToCreate.push({ name: tableName, definition: tableDef });
        } else {
          const dbTable = dbSchema[tableName];
          const colChanges = this.compareTableColumns(tableDef, dbTable);
          changes.columnsToAdd.push(...colChanges.toAdd);
          changes.columnsToDrop.push(...colChanges.toDrop);
          changes.columnsToModify.push(...colChanges.toModify);
          const fkChanges = this.compareForeignKeys(tableDef, dbTable);
          changes.foreignKeysToAdd.push(...fkChanges.toAdd);
          changes.foreignKeysToDrop.push(...fkChanges.toDrop);
          const idxChanges = this.compareIndexes(tableDef, dbTable);
          changes.indexesToAdd.push(...idxChanges.toAdd);
          changes.indexesToDrop.push(...idxChanges.toDrop);
          const uqChanges = this.compareUniqueConstraints(tableDef, dbTable);
          changes.uniqueToAdd.push(...uqChanges.toAdd);
          changes.uniqueToDrop.push(...uqChanges.toDrop);
          const polChanges = this.comparePolicies(tableDef, dbTable);
          changes.policiesToAdd.push(...polChanges.toAdd);
          changes.policiesToDrop.push(...polChanges.toDrop);
          changes.policiesToModify.push(...polChanges.toModify);
        }
      }
    }

    // Tables in DB but not in schema
    for (const [tableName] of Object.entries(dbSchema)) {
      let found = false;
      for (const fileTables of Object.values(drizzleSchema)) {
        for (const tableDef of Object.values(fileTables)) {
          if (tableDef.name === tableName) { found = true; break; }
        }
        if (found) break;
      }
      if (!found) changes.tablesToDrop.push({ name: tableName });
    }

    return changes;
  }

  // ------------------------------------------------------------------
  // Schema comparison — reverse mode
  // ------------------------------------------------------------------

  compareSchemasReverse(drizzleSchema, dbSchema) {
    const changes = this._emptyChanges();

    for (const [tableName, dbTable] of Object.entries(dbSchema)) {
      let found = false;
      for (const fileTables of Object.values(drizzleSchema)) {
        for (const tableDef of Object.values(fileTables)) {
          if (tableDef.name === tableName) { found = true; break; }
        }
        if (found) break;
      }
      if (!found) {
        changes.tablesToCreate.push({ name: tableName, definition: this._generateTableDefFromDB(dbTable) });
      } else {
        const drizzleTable = this._findDrizzleTable(drizzleSchema, tableName);
        if (drizzleTable) {
          const colChanges = this._compareColumnsReverse(drizzleTable, dbTable);
          changes.columnsToAdd.push(...colChanges.toAdd);
          const idxChanges = this._compareIndexesReverse(drizzleTable, dbTable);
          changes.indexesToAdd.push(...idxChanges.toAdd);
          const uqChanges = this._compareUniquesReverse(drizzleTable, dbTable);
          changes.uniqueToAdd.push(...uqChanges.toAdd);
          const fkChanges = this._compareForeignKeysReverse(drizzleTable, dbTable);
          changes.foreignKeysToAdd.push(...fkChanges.toAdd);
          const polChanges = this._comparePoliciesReverse(drizzleTable, dbTable);
          changes.policiesToAdd.push(...polChanges.toAdd);
        }
      }
    }

    return changes;
  }

  // ------------------------------------------------------------------
  // Comparison helpers
  // ------------------------------------------------------------------

  _emptyChanges() {
    return {
      tablesToCreate: [], tablesToDrop: [],
      columnsToAdd: [], columnsToDrop: [], columnsToModify: [],
      indexesToAdd: [], indexesToDrop: [],
      uniqueToAdd: [], uniqueToDrop: [],
      foreignKeysToAdd: [], foreignKeysToDrop: [],
      policiesToAdd: [], policiesToDrop: [], policiesToModify: [],
    };
  }

  _findDrizzleTable(drizzleSchema, tableName) {
    for (const fileTables of Object.values(drizzleSchema)) {
      for (const tableDef of Object.values(fileTables)) {
        if (tableDef.name === tableName) return tableDef;
      }
    }
    return null;
  }

  _generateTableDefFromDB(dbTable) {
    const columns = {};
    for (const [colName, colDef] of Object.entries(dbTable.columns)) {
      columns[colName] = {
        name: colName, type: this.normalizeType(colDef.type), nullable: colDef.nullable,
        isArray: colDef.isArray, enumName: colDef.enumName, primaryKey: colDef.primaryKey, default: colDef.default,
      };
    }
    return {
      name: dbTable.name, columns,
      indexes: dbTable.indexes || [], uniqueConstraints: dbTable.uniqueConstraints || [],
      foreignKeys: dbTable.foreignKeys || {}, policies: dbTable.policies || [],
    };
  }

  compareTableColumns(drizzleTable, dbTable) {
    const changes = { toAdd: [], toDrop: [], toModify: [] };
    for (const [colName, colDef] of Object.entries(drizzleTable.columns)) {
      const dbCol = dbTable.columns[colName];
      if (!dbCol) {
        changes.toAdd.push({ table: drizzleTable.name, column: colName, definition: colDef });
      } else {
        changes.toModify.push(...this._getColumnDiffs(colDef, dbCol, drizzleTable.name, colName));
      }
    }
    for (const colName of Object.keys(dbTable.columns)) {
      if (!drizzleTable.columns[colName]) changes.toDrop.push({ table: drizzleTable.name, column: colName });
    }
    return changes;
  }

  _compareColumnsReverse(drizzleTable, dbTable) {
    const changes = { toAdd: [] };
    for (const [colName, dbCol] of Object.entries(dbTable.columns)) {
      if (!drizzleTable.columns[colName]) {
        changes.toAdd.push({
          table: drizzleTable.name, column: colName,
          definition: { name: colName, type: this.normalizeType(dbCol.type), nullable: dbCol.nullable, isArray: dbCol.isArray, enumName: dbCol.enumName, primaryKey: dbCol.primaryKey, default: dbCol.default },
        });
      }
    }
    return changes;
  }

  compareForeignKeys(drizzleTable, dbTable) {
    const toAdd = [];
    const toDrop = [];
    Object.values(drizzleTable.columns).forEach((col) => {
      if (col.references) {
        const refTable = this.varToPhysical[col.references.table] || col.references.table;
        const dbFks = dbTable.foreignKeys ? Object.values(dbTable.foreignKeys) : [];
        const targetCol = col.references.column;
        const exists = dbFks.some((fk) => fk.column === col.name && fk.references && fk.references.table === refTable && fk.references.column === targetCol);
        if (!exists) toAdd.push({ table: drizzleTable.name, column: col.name, references: { table: refTable, column: targetCol } });
      }
    });
    if (dbTable.foreignKeys) {
      Object.values(dbTable.foreignKeys).forEach((fk) => {
        const dCol = drizzleTable.columns[fk.column];
        if (!dCol || !dCol.references) toDrop.push({ table: drizzleTable.name, column: fk.column, constraintName: fk.constraintName });
      });
    }
    return { toAdd, toDrop };
  }

  _compareForeignKeysReverse(drizzleTable, dbTable) {
    const toAdd = [];
    if (dbTable.foreignKeys) {
      Object.values(dbTable.foreignKeys).forEach((fk) => {
        const dCol = drizzleTable.columns[fk.column];
        if (!dCol || !dCol.references) {
          toAdd.push({ table: drizzleTable.name, column: fk.column, references: { table: fk.references.table, column: fk.references.column }, constraintName: fk.constraintName });
        }
      });
    }
    return { toAdd };
  }

  compareIndexes(drizzleTable, dbTable) {
    const toAdd = [];
    const toDrop = [];
    const dbIndexes = this._parseDbIndexes(dbTable);
    const drizzleIdxMap = new Map(drizzleTable.indexes.map((i) => [i.name, i]));
    drizzleTable.indexes.forEach((idx) => {
      if (!dbIndexes.find((di) => di.name === idx.name)) toAdd.push({ table: drizzleTable.name, index: idx });
    });
    if (this.options.dropOrphanIndexes) {
      dbIndexes.forEach((di) => {
        if (di.unique || /_unique$/.test(di.name)) return;
        if (!drizzleIdxMap.has(di.name)) {
          const colSet = di.columns.join(',');
          if (!drizzleTable.indexes.some((d) => d.columns.join(',') === colSet)) toDrop.push({ table: drizzleTable.name, index: di });
        }
      });
    }
    return { toAdd, toDrop };
  }

  _compareIndexesReverse(drizzleTable, dbTable) {
    const toAdd = [];
    if (!this.options.dropOrphanIndexes) return { toAdd };
    const dbIndexes = this._parseDbIndexes(dbTable);
    const drizzleIdxMap = new Map(drizzleTable.indexes.map((i) => [i.name, i]));
    dbIndexes.forEach((dbIdx) => {
      if (dbIdx.unique || /_unique$/.test(dbIdx.name)) return;
      if (!drizzleIdxMap.has(dbIdx.name)) {
        const colSet = dbIdx.columns.join(',');
        if (!drizzleTable.indexes.some((d) => d.columns.join(',') === colSet)) {
          toAdd.push({ table: drizzleTable.name, index: { name: dbIdx.name, columns: dbIdx.columns, unique: dbIdx.unique, method: dbIdx.definition.match(/USING\s+(\w+)/i)?.[1]?.toLowerCase() || 'btree' } });
        }
      }
    });
    return { toAdd };
  }

  _parseDbIndexes(dbTable) {
    return (dbTable.indexes || [])
      .filter((i) => !i.name.includes('pkey'))
      .map((idx) => {
        const unique = /CREATE UNIQUE INDEX/i.test(idx.definition);
        const colsMatch = idx.definition.match(/\(([^)]+)\)\s*$/) || idx.definition.match(/USING [^(]+\(([^)]+)\)/i);
        let cols = [];
        if (colsMatch && colsMatch[1]) {
          cols = colsMatch[1].split(',').map((c) => c.trim().replace(/"/g, '')).sort();
        }
        return { ...idx, unique, columns: cols };
      });
  }

  compareUniqueConstraints(drizzleTable, dbTable) {
    const toAdd = [];
    const toDrop = [];
    const dbUniques = dbTable.uniqueConstraints || [];
    const drizzleMap = new Map(drizzleTable.uniqueConstraints.map((u) => [u.name, u]));
    drizzleTable.uniqueConstraints.forEach((uq) => {
      const match = dbUniques.find((du) => {
        if (!du.columns || !uq.columns) return false;
        return [...du.columns].sort().join(',') === [...uq.columns].sort().join(',');
      });
      if (!match) toAdd.push({ table: drizzleTable.name, unique: uq });
    });
    if (this.options.dropOrphanUniques) {
      dbUniques.forEach((du) => {
        if (!drizzleMap.has(du.name)) toDrop.push({ table: drizzleTable.name, unique: du });
      });
    }
    return { toAdd, toDrop };
  }

  _compareUniquesReverse(drizzleTable, dbTable) {
    const toAdd = [];
    if (!this.options.dropOrphanUniques) return { toAdd };
    const dbUniques = dbTable.uniqueConstraints || [];
    dbUniques.forEach((dbUq) => {
      const colSet = dbUq.columns.join(',');
      if (!drizzleTable.uniqueConstraints.some((d) => d.columns.join(',') === colSet)) {
        toAdd.push({ table: drizzleTable.name, unique: { name: dbUq.name, columns: dbUq.columns } });
      }
    });
    return { toAdd };
  }

  comparePolicies(drizzleTable, dbTable) {
    const toAdd = [];
    const toDrop = [];
    const toModify = [];
    const dbPolicies = dbTable.policies || [];
    const dMap = new Map(drizzleTable.policies.map((p) => [p.name, p]));
    const dbMap = new Map(dbPolicies.map((p) => [p.name, p]));
    if (this.options.includePolicies) {
      drizzleTable.policies.forEach((p) => {
        const existing = dbMap.get(p.name);
        if (!existing) toAdd.push({ table: drizzleTable.name, policy: p });
        else if (this.options.modifyPolicies) {
          const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const pRoles = (p.roles || []).slice().sort();
          const eRoles = (existing.roles || []).slice().sort();
          if (!(pRoles.join(',') === eRoles.join(',') && p.command === existing.command && normalize(p.using) === normalize(existing.using) && normalize(p.with_check) === normalize(existing.with_check))) {
            toModify.push({ table: drizzleTable.name, policy: p, previous: existing });
          }
        }
      });
      if (this.options.dropOrphanPolicies) {
        dbPolicies.forEach((p) => { if (!dMap.has(p.name)) toDrop.push({ table: drizzleTable.name, policy: p }); });
      }
    }
    return { toAdd, toDrop, toModify };
  }

  _comparePoliciesReverse(drizzleTable, dbTable) {
    const toAdd = [];
    if (this.options.includePolicies && this.options.dropOrphanPolicies) {
      const drizzleMap = new Map(drizzleTable.policies.map((p) => [p.name, p]));
      (dbTable.policies || []).forEach((dbPol) => {
        if (!drizzleMap.has(dbPol.name)) {
          toAdd.push({ table: drizzleTable.name, policy: { name: dbPol.name, command: dbPol.command, roles: dbPol.roles || [], using: dbPol.using, with_check: dbPol.with_check } });
        }
      });
    }
    return { toAdd };
  }

  _getColumnDiffs(drizzleCol, dbCol, tableName, colName) {
    const diffs = [];
    const drizzleType = this.normalizeType(drizzleCol.type);
    const dbType = this.normalizeType(dbCol.type);

    const equivalent = (a, b) => {
      if (a === b) return true;
      const groups = [['varchar', 'text'], ['timestamp', 'timestamptz']];
      return groups.some((g) => g.includes(a) && g.includes(b));
    };

    const drizzleIsArray = !!drizzleCol.isArray;
    const dbIsArray = !!dbCol.isArray;
    const isDrizzleEnum = !!drizzleCol.enumName || (drizzleCol.fullType && drizzleCol.fullType.toLowerCase().includes('enum'));
    const isDbEnum = !!dbCol.enumName || (!['varchar', 'text', 'int4', 'int8', 'int2', 'uuid', 'jsonb', 'timestamp', 'timestamptz', 'bool', 'numeric', 'float8', 'bytea'].includes(dbType) && !dbCol.isArray);

    if (drizzleIsArray !== dbIsArray) {
      diffs.push({ kind: 'type', table: tableName, column: colName, from: dbCol, to: drizzleCol });
    } else if (!(isDrizzleEnum && isDbEnum) && !equivalent(drizzleType, dbType)) {
      diffs.push({ kind: 'type', table: tableName, column: colName, from: dbCol, to: drizzleCol });
    }

    if (typeof drizzleCol.nullable === 'boolean' && drizzleCol.nullable !== dbCol.nullable) {
      diffs.push({ kind: 'nullability', table: tableName, column: colName, from: dbCol, to: drizzleCol });
    }

    return diffs;
  }

  normalizeType(type) {
    const map = {
      'character varying': 'varchar', 'timestamp without time zone': 'timestamp',
      'timestamp with time zone': 'timestamptz', 'double precision': 'float8',
      boolean: 'bool', integer: 'int4', bigint: 'int8', smallint: 'int2',
      serial: 'int4', bigserial: 'int8',
    };
    return (map[type] || type).toLowerCase();
  }

  // ------------------------------------------------------------------
  // SQL generation
  // ------------------------------------------------------------------

  generateSQL(changes) {
    const statements = [];
    const rollbackStatements = [];

    // CREATE TABLE
    for (const table of changes.tablesToCreate) {
      statements.push(this._generateCreateTableSQL(table));
      rollbackStatements.push(`DROP TABLE IF EXISTS "${table.name}";`);
    }

    // ALTER columns
    const alter = this._generateAlterTableSQL(changes.columnsToAdd, changes.columnsToDrop, changes.columnsToModify);
    statements.push(...alter.statements);
    rollbackStatements.push(...alter.rollbackStatements);

    // Foreign keys
    changes.foreignKeysToAdd.forEach((fk) => {
      this.validateIdentifier(fk.table, 'table name');
      this.validateIdentifier(fk.column, 'column name');
      this.validateIdentifier(fk.references.table, 'referenced table name');
      this.validateIdentifier(fk.references.column, 'referenced column name');
      statements.push(`ALTER TABLE ${this.escapeIdentifier(fk.table)} ADD FOREIGN KEY (${this.escapeIdentifier(fk.column)}) REFERENCES ${this.escapeIdentifier(fk.references.table)}(${this.escapeIdentifier(fk.references.column)});`);
      rollbackStatements.push(`-- WARNING: Cannot reliably rollback FK on ${fk.table}.${fk.column} without constraint name`);
    });
    changes.foreignKeysToDrop.forEach((fk) => {
      if (fk.constraintName) {
        this.validateIdentifier(fk.table, 'table name');
        this.validateIdentifier(fk.constraintName, 'constraint name');
        statements.push(`ALTER TABLE ${this.escapeIdentifier(fk.table)} DROP CONSTRAINT IF EXISTS ${this.escapeIdentifier(fk.constraintName)};`);
        rollbackStatements.push(`-- WARNING: Dropped FK ${fk.constraintName}; manual recreation may be needed`);
      }
    });

    // Indexes
    changes.indexesToAdd.forEach((idx) => {
      this.validateIdentifier(idx.index.name, 'index name');
      this.validateIdentifier(idx.table, 'table name');
      idx.index.columns.forEach((col) => this.validateIdentifier(col, 'column name'));
      const cols = idx.index.columns.map((c) => this.escapeIdentifier(c)).join(',');
      let method = '';
      if (idx.index.method) {
        method = ` USING ${this.validateSqlMethod(idx.index.method, ['BTREE', 'HASH', 'GIN', 'GIST', 'SP-GIST', 'BRIN'])}`;
      }
      statements.push(`CREATE INDEX IF NOT EXISTS ${this.escapeIdentifier(idx.index.name)} ON ${this.escapeIdentifier(idx.table)}${method} (${cols});`);
      rollbackStatements.push(`DROP INDEX IF EXISTS ${this.escapeIdentifier(idx.index.name)};`);
    });
    changes.indexesToDrop.forEach((idx) => {
      this.validateIdentifier(idx.index.name, 'index name');
      statements.push(`DROP INDEX IF EXISTS ${this.escapeIdentifier(idx.index.name)};`);
      rollbackStatements.push(`-- WARNING: Cannot rollback index drop ${idx.index.name}`);
    });

    // Unique constraints
    changes.uniqueToAdd.forEach((uq) => {
      this.validateIdentifier(uq.table, 'table name');
      this.validateIdentifier(uq.unique.name, 'constraint name');
      uq.unique.columns.forEach((col) => this.validateIdentifier(col, 'column name'));
      const cols = uq.unique.columns.map((c) => this.escapeIdentifier(c)).join(',');
      statements.push(`ALTER TABLE ${this.escapeIdentifier(uq.table)} ADD CONSTRAINT ${this.escapeIdentifier(uq.unique.name)} UNIQUE (${cols});`);
      rollbackStatements.push(`ALTER TABLE ${this.escapeIdentifier(uq.table)} DROP CONSTRAINT IF EXISTS ${this.escapeIdentifier(uq.unique.name)};`);
    });
    changes.uniqueToDrop.forEach((uq) => {
      this.validateIdentifier(uq.table, 'table name');
      this.validateIdentifier(uq.unique.name, 'constraint name');
      statements.push(`ALTER TABLE ${this.escapeIdentifier(uq.table)} DROP CONSTRAINT IF EXISTS ${this.escapeIdentifier(uq.unique.name)};`);
      rollbackStatements.push(`-- WARNING: Cannot rollback unique constraint drop ${uq.unique.name}`);
    });

    // Policies
    changes.policiesToAdd.forEach((pol) => {
      this.validateIdentifier(pol.policy.name, 'policy name');
      this.validateIdentifier(pol.table, 'table name');
      const roles = pol.policy.roles.length ? pol.policy.roles.map((r) => { if (r.toUpperCase() !== 'PUBLIC') this.validateIdentifier(r, 'role name'); return r; }).join(', ') : 'PUBLIC';
      const cmd = this.validateSqlMethod(pol.policy.command, ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
      const using = pol.policy.using ? ` USING (${this.sanitizePolicyExpression(pol.policy.using)})` : '';
      const withCheck = pol.policy.with_check ? ` WITH CHECK (${this.sanitizePolicyExpression(pol.policy.with_check)})` : '';
      statements.push(`CREATE POLICY ${this.escapeIdentifier(pol.policy.name)} ON ${this.escapeIdentifier(pol.table)} AS PERMISSIVE FOR ${cmd} TO ${roles}${using}${withCheck};`);
      rollbackStatements.push(`DROP POLICY IF EXISTS ${this.escapeIdentifier(pol.policy.name)} ON ${this.escapeIdentifier(pol.table)};`);
    });
    changes.policiesToDrop.forEach((pol) => {
      this.validateIdentifier(pol.policy.name, 'policy name');
      this.validateIdentifier(pol.table, 'table name');
      statements.push(`DROP POLICY IF EXISTS ${this.escapeIdentifier(pol.policy.name)} ON ${this.escapeIdentifier(pol.table)};`);
      rollbackStatements.push(`-- WARNING: Cannot rollback dropped policy ${pol.policy.name}`);
    });
    changes.policiesToModify.forEach((pol) => {
      this.validateIdentifier(pol.policy.name, 'policy name');
      this.validateIdentifier(pol.table, 'table name');
      const drop = `DROP POLICY IF EXISTS ${this.escapeIdentifier(pol.policy.name)} ON ${this.escapeIdentifier(pol.table)};`;
      const roles = pol.policy.roles.length ? pol.policy.roles.map((r) => { if (r.toUpperCase() !== 'PUBLIC') this.validateIdentifier(r, 'role name'); return r; }).join(', ') : 'PUBLIC';
      const cmd = this.validateSqlMethod(pol.policy.command, ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
      const using = pol.policy.using ? ` USING (${this.sanitizePolicyExpression(pol.policy.using)})` : '';
      const withCheck = pol.policy.with_check ? ` WITH CHECK (${this.sanitizePolicyExpression(pol.policy.with_check)})` : '';
      const create = `CREATE POLICY ${this.escapeIdentifier(pol.policy.name)} ON ${this.escapeIdentifier(pol.table)} AS PERMISSIVE FOR ${cmd} TO ${roles}${using}${withCheck};`;
      statements.push(drop, create);
      rollbackStatements.push(`-- WARNING: Policy modification for ${pol.policy.name} not fully reversible`);
    });

    // DROP TABLE
    for (const table of changes.tablesToDrop) {
      this.validateIdentifier(table.name, 'table name');
      statements.push(`DROP TABLE IF EXISTS ${this.escapeIdentifier(table.name)};`);
      rollbackStatements.push(`-- WARNING: Cannot rollback DROP TABLE for ${table.name}`);
    }

    return { statements, rollbackStatements };
  }

  _generateCreateTableSQL(table) {
    this.validateIdentifier(table.name, 'table name');
    const columns = Object.values(table.definition.columns)
      .map((col) => {
        this.validateIdentifier(col.name, 'column name');
        return `  ${this.escapeIdentifier(col.name)} ${this._columnTypeSQL(col)}`;
      })
      .join(',\n');
    return `CREATE TABLE IF NOT EXISTS ${this.escapeIdentifier(table.name)} (\n${columns}\n);`;
  }

  _generateAlterTableSQL(columnsToAdd, columnsToDrop, columnsToModify) {
    const statements = [];
    const rollbackStatements = [];
    for (const change of columnsToAdd) {
      statements.push(`ALTER TABLE "${change.table}" ADD COLUMN "${change.column}" ${this._columnDefSQL(change.definition)};`);
      rollbackStatements.push(`ALTER TABLE "${change.table}" DROP COLUMN IF EXISTS "${change.column}";`);
    }
    for (const change of columnsToDrop) {
      statements.push(`ALTER TABLE "${change.table}" DROP COLUMN IF EXISTS "${change.column}";`);
      rollbackStatements.push(`-- WARNING: Cannot rollback DROP COLUMN for ${change.table}.${change.column}`);
    }
    for (const change of columnsToModify) {
      if (change.kind === 'type') {
        statements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" TYPE ${this._columnTypeSQL(change.to)};`);
        rollbackStatements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" TYPE ${this._columnTypeSQL(change.from)};`);
      } else if (change.kind === 'nullability') {
        if (!change.to.nullable) {
          statements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" SET NOT NULL;`);
          rollbackStatements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" DROP NOT NULL;`);
        } else {
          statements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" DROP NOT NULL;`);
          rollbackStatements.push(`ALTER TABLE "${change.table}" ALTER COLUMN "${change.column}" SET NOT NULL;`);
        }
      }
    }
    return { statements, rollbackStatements };
  }

  _columnDefSQL(colDef) {
    let sql = this._columnTypeSQL(colDef);
    if (colDef.primaryKey) sql += ' PRIMARY KEY';
    if (colDef.unique) sql += ' UNIQUE';
    if (!colDef.nullable) sql += ' NOT NULL';
    if (colDef.default) sql += ` DEFAULT ${colDef.default}`;
    return sql;
  }

  _columnTypeSQL(colDef) {
    const typeMap = {
      varchar: 'VARCHAR', text: 'TEXT', integer: 'INTEGER', serial: 'SERIAL',
      bigint: 'BIGINT', boolean: 'BOOLEAN', timestamp: 'TIMESTAMP', date: 'DATE',
      numeric: 'NUMERIC', jsonb: 'JSONB', json: 'JSON', uuid: 'UUID',
    };
    let base = colDef.type;
    if (colDef.enumName) base = 'varchar';
    let sql = typeMap[base] || base.toUpperCase();
    if (colDef.type === 'varchar' && colDef.args) {
      const lengthMatch = colDef.args.match(/length:\s*(\d+)/);
      if (lengthMatch) sql += `(${lengthMatch[1]})`;
    }
    if (colDef.isArray) sql += '[]';
    return sql;
  }

  // ------------------------------------------------------------------
  // File generation
  // ------------------------------------------------------------------

  getCurrentUser() {
    try {
      if (this.config && this.config.author) return this.config.author;
      try {
        const gitEmail = execSync('git config user.email', { encoding: 'utf8' }).trim();
        if (gitEmail) return gitEmail;
      } catch { /* ignore */ }
      try {
        const gitUser = execSync('git config user.name', { encoding: 'utf8' }).trim();
        if (gitUser) return gitUser;
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    return process.env.USER || process.env.USERNAME || process.env.LOGNAME || 'unknown';
  }

  generateMigrationFile(statements, rollbackStatements) {
    const pattern = (this.config && this.config.timestampFormat) || 'YYYYMMDDHHmmss';
    const timestamp = formatTimestamp(new Date(), pattern);
    const baseName = this.customName || 'schema_diff_migration';
    const extMatch = baseName.match(/\.([a-zA-Z0-9]+)$/);
    const filename = extMatch ? `${timestamp}_${baseName}` : `${timestamp}_${baseName}.sql`;

    // Ensure migrations directory exists
    if (!existsSync(this.migrationsDir)) {
      mkdirSync(this.migrationsDir, { recursive: true });
    }

    const filepath = join(this.migrationsDir, filename);

    const fileExt = filename.split('.').pop().toLowerCase();
    if (fileExt === 'sql') {
      const changesetName = filename.replace(/^\d+_/, '').replace(/\.sql$/, '');
      const author = this.getCurrentUser();

      const statementsWithDelimiter = statements.map((stmt) =>
        stmt.replace(/\s*-->\s*statement-breakpoint\s*$/, '').trim() + '\n--> statement-breakpoint'
      );

      const rollbackWithDelimiter = rollbackStatements.map((stmt) => {
        const clean = stmt.replace(/;\s*-->\s*statement-breakpoint\s*$/, '').replace(/;$/, '').trim();
        return `--rollback ${clean};\n--rollback --> statement-breakpoint`;
      });

      const content = `--liquibase formatted sql

--changeset ${author}:${changesetName} splitStatements:false endDelimiter:--> statement-breakpoint

${statementsWithDelimiter.join('\n\n')}

${rollbackWithDelimiter.join('\n')}
`;
      writeFileSync(filepath, content);
    } else {
      writeFileSync(filepath, '');
    }

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
      // Create the master changelog if it doesn't exist
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
    const existing = matches.map((m) => m[1]);

    if (existing.includes(filename)) return;

    const all = existing.concat([filename]);
    all.sort((a, b) => {
      const ta = parseInt((a.match(/^(\d+)_/) || [0, '0'])[1], 10) || 0;
      const tb = parseInt((b.match(/^(\d+)_/) || [0, '0'])[1], 10) || 0;
      if (ta === tb) return a.localeCompare(b);
      return ta - tb;
    });

    const includeLines = all.map((f) => `    <include file="migrations/${f}"/>`).join('\n');

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

  // ------------------------------------------------------------------
  // Main entry point
  // ------------------------------------------------------------------

  async run() {
    console.log(`🚀 Starting schema diff migration generation${this.reverse ? ' (REVERSE MODE)' : ''}...`);

    try {
      await this.init();
      await this.initDb();

      const dbSchema = await this.getDatabaseSchema();
      const drizzleSchema = await this.getDrizzleSchema();

      console.log('⚖️  Comparing schemas...');
      const changes = this.reverse
        ? this.compareSchemasReverse(drizzleSchema, dbSchema)
        : this.compareSchemas(drizzleSchema, dbSchema);

      console.log('🛠️  Generating SQL...');
      const { statements, rollbackStatements } = this.generateSQL(changes);

      if (statements.length === 0) {
        console.log('✅ No changes detected between schema and database');
        return;
      }

      console.log('📝 Generating migration file...');
      const filepath = this.generateMigrationFile(statements, rollbackStatements);

      console.log(`✅ Migration generated: ${filepath}`);
      console.log(`📊 Changes detected:`);
      console.log(`   - Tables to create: ${changes.tablesToCreate.length}`);
      console.log(`   - Tables to drop: ${changes.tablesToDrop.length}`);
      console.log(`   - Columns to add: ${changes.columnsToAdd.length}`);
      console.log(`   - Columns to drop: ${changes.columnsToDrop.length}`);
      console.log(`   - Columns to modify: ${changes.columnsToModify.length}`);
      console.log(`   - Indexes to add: ${changes.indexesToAdd.length}`);
      console.log(`   - Indexes to drop: ${changes.indexesToDrop.length}`);
      console.log(`   - Unique to add: ${changes.uniqueToAdd.length}`);
      console.log(`   - Unique to drop: ${changes.uniqueToDrop.length}`);
      console.log(`   - FKs to add: ${changes.foreignKeysToAdd.length}`);
      console.log(`   - FKs to drop: ${changes.foreignKeysToDrop.length}`);
      console.log(`   - Policies to add: ${changes.policiesToAdd.length}`);
      console.log(`   - Policies to drop: ${changes.policiesToDrop.length}`);
      console.log(`   - Policies to modify: ${changes.policiesToModify.length}`);
    } catch (error) {
      console.error('❌ Error generating migration:', error.message);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

export default SchemaDiffGenerator;
