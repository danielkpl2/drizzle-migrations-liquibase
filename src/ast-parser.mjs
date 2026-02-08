/**
 * AST-based Drizzle schema parser using ts-morph.
 *
 * Replaces regex-based parsing with proper TypeScript AST analysis for
 * reliable extraction of table definitions, columns, constraints, indexes,
 * and policies from Drizzle ORM schema files.
 *
 * Handles all syntax variations that trip up regexes:
 *   - Multi-line expressions
 *   - Template literals and tagged templates
 *   - Unusual indentation or formatting
 *   - Comments inside definitions
 *   - Computed/spread properties (gracefully skipped)
 */

import { Project, SyntaxKind } from 'ts-morph';

// ---------------------------------------------------------------------------
// Drizzle type function name → normalised base type
// ---------------------------------------------------------------------------

const TYPE_MAP = {
  varchar: 'varchar',
  char: 'char',
  text: 'text',
  integer: 'integer',
  int: 'integer',
  serial: 'serial',
  bigint: 'bigint',
  bigserial: 'bigserial',
  smallint: 'smallint',
  smallserial: 'smallserial',
  boolean: 'boolean',
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  numeric: 'numeric',
  decimal: 'numeric',
  real: 'real',
  doublePrecision: 'doublePrecision',
  jsonb: 'jsonb',
  json: 'json',
  uuid: 'uuid',
  bytea: 'bytea',
  inet: 'inet',
  cidr: 'cidr',
  macaddr: 'macaddr',
  macaddr8: 'macaddr8',
  interval: 'interval',
  point: 'point',
  line: 'line',
  vector: 'vector',
};

// ---------------------------------------------------------------------------
// Main parser class
// ---------------------------------------------------------------------------

export class ASTSchemaParser {
  constructor() {
    this._project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        strict: false,
        noEmit: true,
        target: 99, // ESNext
        module: 99, // ESNext
      },
    });
    this._counter = 0;
  }

  /**
   * Create a temporary in-memory source file for parsing.
   * Each call gets a unique name to avoid collisions.
   */
  _tempFile(content, hint = 'schema') {
    return this._project.createSourceFile(
      `_parse_${hint}_${this._counter++}.ts`,
      content,
      { overwrite: true },
    );
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Parse `export * from './...'` declarations from an index/barrel file.
   * Returns module names without the './' prefix.
   *
   * @param {string} content — file content of the index.ts
   * @returns {string[]}
   */
  parseImports(content) {
    const sf = this._tempFile(content, 'index');
    const files = [];

    for (const decl of sf.getExportDeclarations()) {
      const mod = decl.getModuleSpecifierValue();
      if (mod && mod.startsWith('./')) {
        files.push(mod.slice(2));
      }
    }

    return files;
  }

  /**
   * Parse a Drizzle schema file and extract all pgTable definitions.
   *
   * Returns the same shape the regex-based `parseSchemaFile()` produced:
   *   { [varName]: { name, columns, constraints, indexes, policies, foreignKeys, uniqueConstraints } }
   *
   * @param {string} content  — TypeScript source of the schema file
   * @param {string} filename — used for logging
   * @returns {Record<string, object>}
   */
  parseFile(content, filename) {
    console.log(`  Parsing schema file (AST): ${filename}`);
    const sf = this._tempFile(content, filename);
    const tables = {};

    // Walk every VariableDeclaration in the file
    for (const node of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = node.getInitializer();
      if (!init) continue;

      // Find the pgTable() call — it may be direct or chained (e.g. pgTable(...).enableRLS)
      const pgTableCall = this._findPgTableCall(init);
      if (!pgTableCall) continue;

      // Ensure the variable is exported
      // VariableDeclaration → VariableDeclarationList → VariableStatement
      const varStmt = node.getParent()?.getParent();
      if (!varStmt || varStmt.getKind() !== SyntaxKind.VariableStatement) continue;
      const isExported = varStmt.getModifiers?.()?.some(
        (m) => m.getKind() === SyntaxKind.ExportKeyword,
      );
      if (!isExported) continue;

      const varName = node.getName();
      const args = pgTableCall.getArguments();
      if (args.length < 2) continue;

      // First arg: table name (string literal)
      const tableName = this._getStringValue(args[0]);
      if (!tableName) continue;

      // Second arg: columns object literal
      const columns = this._parseColumns(args[1]);

      // Third arg (optional): constraints callback
      let indexes = [];
      let policies = [];
      let uniqueConstraints = [];
      if (args.length >= 3) {
        const result = this._parseConstraints(args[2], tableName);
        indexes = result.indexes;
        policies = result.policies;
        uniqueConstraints = result.uniqueConstraints;
      }

      // Build constraints metadata array (for compatibility)
      const constraintsMeta = [];
      if (Object.values(columns).some((c) => c.primaryKey)) {
        constraintsMeta.push({ type: 'PRIMARY KEY' });
      }
      for (const col of Object.values(columns)) {
        if (col.references) {
          constraintsMeta.push({
            type: 'FOREIGN KEY',
            references: `${col.references.table}.${col.references.column}`,
          });
        }
      }

      tables[varName] = {
        name: tableName,
        columns,
        constraints: constraintsMeta,
        indexes,
        policies,
        foreignKeys: {},
        uniqueConstraints,
      };
    }

    return tables;
  }

  // ------------------------------------------------------------------
  // Column parsing
  // ------------------------------------------------------------------

  /**
   * Parse columns from the second argument of pgTable().
   * Expects an ObjectLiteralExpression: { id: integer('id'), name: varchar('name') }
   */
  _parseColumns(node) {
    const columns = {};
    if (node.getKind() !== SyntaxKind.ObjectLiteralExpression) return columns;

    for (const prop of node.getProperties()) {
      // Skip spread elements, shorthand assignments, methods, etc.
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;

      const logicalName = prop.getName();
      const value = prop.getInitializer();
      if (!value) continue;

      const colDef = this._parseColumnExpression(value, logicalName);
      if (colDef) {
        columns[colDef.name] = colDef;
      }
    }

    return columns;
  }

  /**
   * Parse a single column expression and its method chain.
   *
   * Handles patterns like:
   *   integer('id').primaryKey()
   *   varchar('user_name', { length: 255 }).notNull()
   *   text().notNull().default('pending')
   *   statusEnum('status')
   *   timestamp('created_at').defaultNow()
   *   integer('role_id').references(() => roles.id)
   */
  _parseColumnExpression(node, logicalName) {
    const chain = this._collectChain(node);
    if (!chain) return null;

    const { root, methods } = chain;
    const fnName = root.fnName;

    // ── Determine physical name & args text ──────────────────────
    let physicalName = logicalName;
    let argsText = '';

    if (root.args.length > 0) {
      const firstArg = root.args[0];
      if (firstArg.getKind() === SyntaxKind.StringLiteral) {
        physicalName = firstArg.getLiteralText();
        // Build args text matching original format (used for varchar length extraction)
        const parts = root.args.map((a) =>
          a.getKind() === SyntaxKind.StringLiteral ? a.getLiteralText() : a.getText(),
        );
        argsText = parts.join(', ');
      } else {
        // First arg is not a string (e.g. enum values array, options object)
        argsText = root.args.map((a) => a.getText()).join(', ');
      }
    }

    // ── Inspect method chain ─────────────────────────────────────
    const methodNames = new Set(methods.map((m) => m.name));

    const notNull = methodNames.has('notNull');
    const isPrimary = methodNames.has('primaryKey');
    const isUnique = methodNames.has('unique');
    const isArray = methodNames.has('array');
    const hasDefault =
      methodNames.has('default') ||
      methodNames.has('defaultNow') ||
      methodNames.has('defaultRandom') ||
      methodNames.has('$defaultFn') ||
      methodNames.has('$default');

    // ── Extract .references(() => table.column) ──────────────────
    let references = null;
    const refsMethod = methods.find((m) => m.name === 'references');
    if (refsMethod && refsMethod.args.length > 0) {
      references = this._parseReferences(refsMethod.args[0]);
    }

    // ── Base type ────────────────────────────────────────────────
    const baseType = this._extractBaseType(fnName);
    const isEnum = fnName.toLowerCase().includes('enum');

    return {
      name: physicalName,
      logicalName,
      type: baseType,
      args: argsText,
      fullType: fnName,
      nullable: isPrimary ? false : !notNull,
      primaryKey: isPrimary,
      unique: isUnique,
      hasDefault,
      isArray,
      enumName: isEnum ? fnName : null,
      references,
    };
  }

  // ------------------------------------------------------------------
  // Fluent method-chain walker
  // ------------------------------------------------------------------

  /**
   * Walk a fluent method chain (CallExpression tree) and decompose it into
   * the root function call plus an ordered list of chained methods.
   *
   *   varchar('name', { length: 255 }).notNull().references(() => t.id)
   *
   * becomes:
   *   {
   *     root: { fnName: 'varchar', args: [<StringLiteral>, <ObjectLiteral>] },
   *     methods: [
   *       { name: 'notNull',    args: [] },
   *       { name: 'references', args: [<ArrowFunction>] },
   *     ]
   *   }
   */
  _collectChain(node) {
    const methods = [];
    let current = node;

    while (current && current.getKind() === SyntaxKind.CallExpression) {
      const expr = current.getExpression();
      const args = current.getArguments();

      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        // Chained method: someExpr.method(args)
        methods.unshift({ name: expr.getName(), args });
        current = expr.getExpression();
      } else if (expr.getKind() === SyntaxKind.Identifier) {
        // Root function call: fnName(args)
        return { root: { fnName: expr.getText(), args }, methods };
      } else {
        // Other expression (e.g. namespace.fnName, or imported call)
        return { root: { fnName: expr.getText(), args }, methods };
      }
    }

    return null;
  }

  // ------------------------------------------------------------------
  // Constraints parsing (third arg to pgTable)
  // ------------------------------------------------------------------

  /**
   * Parse the third argument to pgTable — a callback returning constraints.
   *
   * Handles all Drizzle syntax variants:
   *   (t) => [index(...), unique(...), pgPolicy(...)]          — array form
   *   (t) => ({ idx: index(...), uq: unique(...) })            — object form
   *   (t) => { return [...]; }                                 — block form
   */
  _parseConstraints(node, tableName) {
    const indexes = [];
    const policies = [];
    const uniqueConstraints = [];

    if (
      node.getKind() !== SyntaxKind.ArrowFunction &&
      node.getKind() !== SyntaxKind.FunctionExpression
    ) {
      return { indexes, policies, uniqueConstraints };
    }

    const body = node.getBody();
    const items = this._extractConstraintItems(body);

    for (const item of items) {
      const chain = this._collectChain(item);
      if (!chain) continue;

      const rootFn = chain.root.fnName;

      if (rootFn === 'index') {
        const idx = this._parseIndexDef(chain);
        if (idx) indexes.push(idx);
      } else if (rootFn === 'unique' || rootFn === 'uniqueIndex') {
        const uq = this._parseUniqueDef(chain, tableName);
        if (uq) uniqueConstraints.push(uq);
      } else if (rootFn === 'pgPolicy') {
        const pol = this._parsePolicyDef(chain);
        if (pol) policies.push(pol);
      }
    }

    return { indexes, policies, uniqueConstraints };
  }

  /**
   * Recursively extract constraint items from the callback body.
   */
  _extractConstraintItems(body) {
    if (!body) return [];

    const kind = body.getKind();

    // [item1, item2, ...]
    if (kind === SyntaxKind.ArrayLiteralExpression) {
      return body.getElements();
    }

    // Parenthesized: ({ key: value })  →  unwrap and recurse
    if (kind === SyntaxKind.ParenthesizedExpression) {
      return this._extractConstraintItems(body.getExpression());
    }

    // Object literal: { key: value, ... }
    if (kind === SyntaxKind.ObjectLiteralExpression) {
      return body
        .getProperties()
        .filter((p) => p.getKind() === SyntaxKind.PropertyAssignment)
        .map((p) => p.getInitializer())
        .filter(Boolean);
    }

    // Block: { return [...]; }
    if (kind === SyntaxKind.Block) {
      for (const stmt of body.getStatements()) {
        if (stmt.getKind() === SyntaxKind.ReturnStatement) {
          const expr = stmt.getExpression();
          if (expr) return this._extractConstraintItems(expr);
        }
      }
    }

    return [];
  }

  // ------------------------------------------------------------------
  // Constraint-type parsers
  // ------------------------------------------------------------------

  /**
   * index('name').on(t.col1, t.col2)
   * index('name').using('gin').on(t.col1)
   */
  _parseIndexDef(chain) {
    const name =
      chain.root.args.length > 0 ? this._getStringValue(chain.root.args[0]) : null;
    if (!name) return null;

    let method = null;
    let columns = [];

    for (const m of chain.methods) {
      if (m.name === 'using') {
        if (m.args.length > 0) {
          method = this._getStringValue(m.args[0]);
        }
      } else if (m.name === 'on') {
        columns = m.args
          .map((a) => this._extractColumnName(a))
          .filter(Boolean)
          .sort();
      }
    }

    return { name, method: method || null, columns };
  }

  /**
   * unique().on(t.col1, t.col2)
   * unique('constraint_name').on(t.col1)
   */
  _parseUniqueDef(chain, tableName) {
    let name =
      chain.root.args.length > 0 ? this._getStringValue(chain.root.args[0]) : null;

    let columns = [];
    for (const m of chain.methods) {
      if (m.name === 'on') {
        columns = m.args
          .map((a) => this._extractColumnName(a))
          .filter(Boolean)
          .sort();
      }
    }

    // Auto-generate name when not provided (matches original behaviour)
    if (!name && columns.length > 0) {
      name = `${tableName}_${columns.join('_')}_unique`;
    }

    return name ? { name, columns } : null;
  }

  /**
   * pgPolicy('name', { for, to, using, withCheck })
   */
  _parsePolicyDef(chain) {
    const args = chain.root.args;
    if (args.length < 1) return null;

    const name = this._getStringValue(args[0]);
    if (!name) return null;

    let command = 'select';
    let roles = [];
    let using = null;
    let withCheck = null;

    if (args.length >= 2 && args[1].getKind() === SyntaxKind.ObjectLiteralExpression) {
      for (const prop of args[1].getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;

        const propName = prop.getName();
        const value = prop.getInitializer();
        if (!value) continue;

        switch (propName) {
          case 'for':
            command = this._getStringValue(value) || 'select';
            break;
          case 'to':
            if (value.getKind() === SyntaxKind.ArrayLiteralExpression) {
              roles = value
                .getElements()
                .map((el) => this._getStringValue(el))
                .filter(Boolean)
                .sort();
            }
            break;
          case 'using':
            using = this._extractSqlTemplate(value);
            break;
          case 'withCheck':
          case 'with_check':
            withCheck = this._extractSqlTemplate(value);
            break;
        }
      }
    }

    return {
      name,
      command: command.toLowerCase(),
      roles,
      using: using?.trim() || null,
      with_check: withCheck?.trim() || null,
      permissive: true,
    };
  }

  // ------------------------------------------------------------------
  // Low-level helpers
  // ------------------------------------------------------------------

  /** Check whether a CallExpression calls `pgTable` (direct or namespaced). */
  _isPgTableCall(callExpr) {
    const expr = callExpr.getExpression();
    if (expr.getKind() === SyntaxKind.Identifier) {
      return expr.getText() === 'pgTable';
    }
    // schema.pgTable or pg.pgTable
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      return expr.getName() === 'pgTable';
    }
    return false;
  }

  /**
   * Walk an expression tree to find the underlying pgTable() CallExpression.
   *
   * Handles:
   *   pgTable(...)                        — direct call
   *   pgTable(...).enableRLS              — PropertyAccess on call
   *   pgTable(...).enableRLS()            — chained call
   *   pgTable(...).enableRLS.something()  — deeper chain
   *
   * Returns the CallExpression node for pgTable() or null.
   */
  _findPgTableCall(node) {
    if (!node) return null;
    const kind = node.getKind();

    // Direct: pgTable(...)
    if (kind === SyntaxKind.CallExpression) {
      if (this._isPgTableCall(node)) return node;
      // Could be pgTable(...).enableRLS() — check the expression
      return this._findPgTableCall(node.getExpression());
    }

    // Chained: pgTable(...).enableRLS
    if (kind === SyntaxKind.PropertyAccessExpression) {
      return this._findPgTableCall(node.getExpression());
    }

    return null;
  }

  /** Safely extract a string value from a StringLiteral or template literal. */
  _getStringValue(node) {
    if (!node) return null;
    const kind = node.getKind();
    if (kind === SyntaxKind.StringLiteral) return node.getLiteralText();
    if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) return node.getLiteralText();
    return null;
  }

  /** Map a Drizzle column-type function name to a normalised base type. */
  _extractBaseType(fnName) {
    const lower = fnName.toLowerCase();
    const base = TYPE_MAP[fnName] || TYPE_MAP[lower] || lower;
    if (lower.includes('enum')) return 'varchar';
    return base;
  }

  /** Extract the column name from a `table.columnName` PropertyAccess. */
  _extractColumnName(node) {
    if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
      return node.getName();
    }
    if (node.getKind() === SyntaxKind.Identifier) {
      return node.getText();
    }
    // Fallback: get last dotted segment
    const text = node.getText();
    const parts = text.split('.');
    return parts[parts.length - 1].replace(/[^a-zA-Z0-9_]/g, '');
  }

  /** Parse `.references(() => table.column)` arrow function. */
  _parseReferences(node) {
    if (node.getKind() !== SyntaxKind.ArrowFunction) return null;
    const body = node.getBody();
    if (body.getKind() === SyntaxKind.PropertyAccessExpression) {
      return {
        table: body.getExpression().getText(),
        column: body.getName(),
      };
    }
    return null;
  }

  /**
   * Extract content from a `sql\`...\`` tagged template expression.
   * Returns the raw template text (preserving ${} interpolations as-is).
   */
  _extractSqlTemplate(node) {
    if (node.getKind() === SyntaxKind.TaggedTemplateExpression) {
      const template = node.getTemplate();
      if (template.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return template.getLiteralText();
      }
      // Template with substitutions — return raw text minus backtick delimiters
      const text = template.getText();
      return text.slice(1, -1);
    }
    // Fallback for plain string
    return this._getStringValue(node);
  }
}
