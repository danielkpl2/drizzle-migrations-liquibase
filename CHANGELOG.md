# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-15

### Added

- **Drizzle Kit engine** — alternative diff engine that hooks into `drizzle-kit`'s own schema serializer and diff algorithms via the public `drizzle-kit/api` export. Use it with `--engine drizzle-kit` on the CLI or `engine: 'drizzle-kit'` in your config. Benefits:
  - Uses drizzle-kit's battle-tested schema serializer (runtime Drizzle objects, not AST parsing)
  - Handles column/table rename detection interactively
  - Covers more schema features (sequences, check constraints, views, etc.)
  - Future multi-database support (MySQL, SQLite) with minimal work
  - Trade-off: requires `drizzle-kit` + `drizzle-orm` as peer dependencies and `jiti` for TypeScript schema loading

- **drizzle-kit v1 beta auto-detection** — the engine automatically detects whether your project uses drizzle-kit v0.31+ (`drizzle-kit/api`) or v1.0.0-beta (`drizzle-kit/api-postgres`) and adapts the `pushSchema()` call signature accordingly. No configuration needed.

- **`schemas` config option + `--schemas` CLI flag** — controls which database schemas are introspected by the drizzle-kit engine. Defaults to `['public']`, which prevents `DROP TABLE` / `DROP POLICY` statements for tables in other schemas (e.g. Supabase's `auth`, `storage`, `realtime`). Set `schemas: ['public', 'custom_schema']` in your config or pass `--schemas public,custom_schema` on the CLI if your Drizzle schema uses `pgSchema()`.

- **`excludeTables` config option + `--exclude-tables` CLI flag** — exclude specific tables from drizzle-kit engine output. Liquibase's tracking tables (`databasechangelog`, `databasechangeloglock`) are always excluded automatically. Use this for additional tables: `excludeTables: ['audit_log', 'staging_data']` or `--exclude-tables audit_log,staging_data`.

- **`--engine` / `-e` CLI flag** for `generate` command — switch between `custom` (default, AST-based) and `drizzle-kit` engines. Also supports `--engine=drizzle-kit` form and config file `engine` option.

- **155 new tests** for the drizzle-kit engine covering rollback generation (20+ DDL patterns), statement pairing, file output format, changelog management, config validation, table exclusion filtering, schema config handling, and end-to-end flows. Total: **555 tests** across 8 suites.

### Changed

- `drizzle-kit` added as an optional peer dependency (`>=0.31.0`).
- `jiti` and `drizzle-kit` added to dev dependencies for testing.
- New export: `drizzle-migrations-liquibase/drizzle-kit-engine`.

## [1.0.1] - 2026-02-12

### Fixed

- **Parse `foreignKey()` helper in table config callback.** Drizzle ORM supports two ways to define foreign key relationships:

  1. **Inline `.references()`** — chained directly on the column definition:
     ```ts
     userId: integer('user_id').references(() => users.id)
     ```

  2. **`foreignKey()` helper** — declared in the table's third-argument config callback:
     ```ts
     export const products = pgTable('products', {
       id: integer('id').primaryKey(),
       assessmentId: integer('assessment_id'),
     }, (table) => [
       foreignKey({
         columns: [table.assessmentId],
         foreignColumns: [assessments.id],
       }),
     ]);
     ```

  The `foreignKey()` helper is commonly used when you need to name the constraint, when the FK references a table defined later in the file (avoiding circular reference issues), or simply as a stylistic preference to keep column definitions clean.

  Previously, only the inline `.references()` form was detected by the AST parser. Tables using the `foreignKey()` helper would silently lose their FK relationships, resulting in missing `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements in generated migrations. This is now fixed — both forms are fully supported and produce identical migration output.

  If a column has both an inline `.references()` and a `foreignKey()` pointing to a different table, the inline reference takes priority (as it's the more explicit declaration).

### Added

- **Tests for `foreignKey()` helper.** 9 new test assertions covering basic parsing, coexistence with inline `.references()`, priority when both are present, and `AnyPgColumn` self-referencing FKs.

## [1.0.0] - 2026-02-11

Initial public release.

- AST-based Drizzle schema parser (ts-morph) — replaces fragile regex parsing
- Diff engine: detects tables, columns, types, nullability, defaults, foreign keys, indexes, unique constraints, and RLS policies
- Generates Liquibase-compatible SQL migration files with proper rollback blocks
- Bidirectional mode: schema-first (Drizzle → DB) and database-first (DB → Drizzle)
- Smart rollback commands: `rollbackCount`, `rollbackTag`, `rollbackToDate`, and auto-detecting `rollback` shorthand
- `.env` / `.env.local` auto-loading for database credentials
- 390 tests across 7 test suites

[1.1.0]: https://github.com/danielkpl2/drizzle-migrations-liquibase/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/danielkpl2/drizzle-migrations-liquibase/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/danielkpl2/drizzle-migrations-liquibase/releases/tag/v1.0.0
