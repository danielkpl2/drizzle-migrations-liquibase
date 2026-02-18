# SingleStore Example

Demonstrates `drizzle-migrations-liquibase` with **SingleStore Helios** (free tier).

## Quick Start

```bash
npm install
npm run generate   # diff schema against live DB → Liquibase migration
npm run update     # apply pending migrations via Liquibase
```

## SingleStore Limitations

SingleStore uses the MySQL wire protocol but has significant differences from MySQL. These affect both the Drizzle schema definitions and the generated migrations:

### No Foreign Keys

SingleStore doesn't support `FOREIGN KEY` constraints. Remove all `.references()` calls from your Drizzle schema. Enforce referential integrity at the application level.

### No Secondary Indexes on Columnstore Tables

The default columnstore engine doesn't support secondary `CREATE INDEX` statements. Remove all `index()` definitions from your table's third argument. If you need indexes, you must explicitly create **rowstore** tables.

### Unique Keys Must Include the Shard Key

SingleStore requires that any `UNIQUE` constraint includes all columns of the shard key (which defaults to the primary key). A standalone `UNIQUE(email)` on a table sharded by `id` will fail. Remove `.unique()` constraints or use composite unique keys that include the PK.

### No `serial` Type

`serial` in MySQL/SingleStore maps to `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE KEY`. Combined with an explicit `PRIMARY KEY(id)`, this creates two HASH indexes on the same column, which SingleStore rejects. Use `bigint().autoincrement().primaryKey()` instead:

```ts
// ❌ Fails on SingleStore
id: serial('id').primaryKey(),

// ✅ Works
id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
```

### `singlestore://` URL Scheme

SingleStore's portal provides `singlestore://` connection URLs. This tool auto-detects the scheme and rewrites it to `mysql://` for the driver, and adds SSL for non-local hosts.

## drizzle-kit Migration Strategy (Copy-to-New-Table)

When generating incremental migrations, **drizzle-kit** doesn't use `ALTER TABLE ADD COLUMN` for SingleStore. Instead it uses a "copy to new table" approach:

1. `CREATE TABLE __new_<table>` with the desired schema
2. `INSERT INTO __new_<table>(...) SELECT ... FROM <table>`
3. `DROP TABLE <table>`
4. `ALTER TABLE __new_<table> RENAME TO <table>`

### ⚠️ Known Issue: INSERT column mismatch

The generated `INSERT...SELECT` may reference **new columns** that don't exist in the original table, causing `Unknown column` errors. This is a drizzle-kit bug — the tool generates the column diff correctly but the data-copy statement is wrong.

**What to do**: After `npm run generate`, review the migration SQL. For any table with new columns, manually fix the INSERT statement:

```sql
-- Generated (broken): tries to SELECT new columns from old table
INSERT INTO `__new_products`(..., `weight`, `stock_quantity`, ...)
SELECT ..., `weight`, `stock_quantity`, ... FROM `products`;

-- Fixed: only SELECT existing columns; new ones get their defaults
INSERT INTO `__new_products`(`id`, `sku`, `name`, ..., `created_at`)
SELECT `id`, `sku`, `name`, ..., `created_at` FROM `products`;
```

The generate command gets you ~90% of the way. Review and correct as needed before applying.

## Schema Files

| File | Tables | Exercises |
|------|--------|-----------|
| `users.ts` | `users` | bigint auto_increment, enum, json, boolean |
| `products.ts` | `categories`, `products` | decimal, enum, text, multiple tables |
| `orders.ts` | `orders`, `order_items` | enum, json, decimal, int |
| `reviews.ts` | `reviews` | smallint, boolean, text |
| `coupons.ts` | `coupons` | Added in second migration |
