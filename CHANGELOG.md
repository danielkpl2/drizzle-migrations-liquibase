# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.1]: https://github.com/danielkpl2/drizzle-migrations-liquibase/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/danielkpl2/drizzle-migrations-liquibase/releases/tag/v1.0.0
