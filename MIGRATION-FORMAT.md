# Liquibase SQL Migration Format

This document describes the **exact format** required for Liquibase-compatible SQL migration files used by `drizzle-migrations-liquibase`. Use this as a reference when converting Drizzle Kit migrations or writing new migrations by hand.

---

## File Naming Convention

```
<timestamp>_<descriptive_name>.sql
```

- **Timestamp**: `YYYYMMDDHHmmss` format (configurable), e.g. `20250710092120`
- **Name**: snake_case, describes what the migration does
- **Extension**: `.sql`

Examples:
```
20250705123138_create_products_table.sql
20250810053642_major_schema_restructure.sql
20260123222756_add_paid_amount_to_orders.sql
```

---

## File Structure

Every `.sql` migration file **must** begin with the Liquibase format header and contain at least one changeset:

```sql
--liquibase formatted sql

--changeset <author>:<changeset_id> splitStatements:false endDelimiter:--> statement-breakpoint

<SQL statements separated by --> statement-breakpoint>

--rollback <rollback SQL statements>
--rollback --> statement-breakpoint
```

### Required Elements

1. **`--liquibase formatted sql`** — MUST be the very first line (tells Liquibase this is a formatted SQL changelog)

2. **`--changeset <author>:<id>`** — declares a changeset
   - `author`: email or username (e.g. `daniel`, `jane@example.com`)
   - `id`: unique identifier, typically the filename without timestamp and extension
   - Attributes:
     - `splitStatements:false` — prevents Liquibase from splitting on `;` (we control splitting via delimiter)
     - `endDelimiter:--> statement-breakpoint` — custom delimiter between statements

3. **SQL Statements** — each statement ends with:
   ```
   --> statement-breakpoint
   ```

4. **Rollback block** — lines prefixed with `--rollback`:
   ```sql
   --rollback <SQL>;
   --rollback --> statement-breakpoint
   ```

---

## Complete Examples

### CREATE TABLE

```sql
--liquibase formatted sql

--changeset daniel:create_users_table splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint

--rollback DROP TABLE IF EXISTS "users";
--rollback --> statement-breakpoint
```

### ADD COLUMN

```sql
--liquibase formatted sql

--changeset jane@example.com:add_phone_to_users splitStatements:false endDelimiter:--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(20);
--> statement-breakpoint

--rollback ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
--rollback --> statement-breakpoint
```

### ADD FOREIGN KEY (with exception handling)

```sql
--liquibase formatted sql

--changeset daniel:add_product_fk_to_orders splitStatements:false endDelimiter:--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

--rollback DO $$ BEGIN
--rollback  ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_product_id_products_id_fk";
--rollback EXCEPTION
--rollback  WHEN undefined_object THEN null;
--rollback END $$;
--rollback --> statement-breakpoint
```

### CREATE INDEX

```sql
--liquibase formatted sql

--changeset daniel:add_orders_customer_index splitStatements:false endDelimiter:--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_orders_customer_id" ON "orders" ("customer_id");
--> statement-breakpoint

--rollback DROP INDEX IF EXISTS "idx_orders_customer_id";
--rollback --> statement-breakpoint
```

### CREATE ENUM TYPE

```sql
--liquibase formatted sql

--changeset daniel:create_order_status_enum splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TYPE "public"."order_status" AS ENUM('received', 'processing', 'shipped', 'cancelled');
--> statement-breakpoint

--rollback DROP TYPE IF EXISTS "public"."order_status";
--rollback --> statement-breakpoint
```

### MULTIPLE STATEMENTS IN ONE CHANGESET

```sql
--liquibase formatted sql

--changeset daniel:restructure_delivery splitStatements:false endDelimiter:--> statement-breakpoint

ALTER TABLE "delivery-methods" RENAME TO "delivery_methods";
--> statement-breakpoint

ALTER TABLE "delivery_methods" ALTER COLUMN "cost" SET DATA TYPE integer;
--> statement-breakpoint

ALTER TABLE "delivery_methods" ALTER COLUMN "free_threshold" SET DATA TYPE integer;
--> statement-breakpoint

ALTER TABLE "delivery_methods" ADD COLUMN "created_by" uuid;
--> statement-breakpoint

--rollback ALTER TABLE "delivery_methods" DROP COLUMN IF EXISTS "created_by";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "delivery_methods" ALTER COLUMN "free_threshold" SET DATA TYPE numeric;
--rollback --> statement-breakpoint
--rollback ALTER TABLE "delivery_methods" ALTER COLUMN "cost" SET DATA TYPE numeric;
--rollback --> statement-breakpoint
--rollback ALTER TABLE "delivery_methods" RENAME TO "delivery-methods";
--rollback --> statement-breakpoint
```

### MULTIPLE CHANGESETS IN ONE FILE

You can include multiple changesets in a single file. Each gets its own `--changeset` line:

```sql
--liquibase formatted sql

--changeset daniel:create_signatures_bucket splitStatements:false endDelimiter:--> statement-breakpoint

INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO UPDATE SET public = false;
--> statement-breakpoint

--changeset daniel:signatures_storage_policies splitStatements:false endDelimiter:--> statement-breakpoint

CREATE POLICY "Users can upload their own signature"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures' AND (auth.uid())::text = SPLIT_PART(name, '.', 1));
--> statement-breakpoint

--rollback DROP POLICY IF EXISTS "Users can upload their own signature" ON storage.objects;
--rollback --> statement-breakpoint
--rollback DELETE FROM storage.buckets WHERE id = 'signatures';
--rollback --> statement-breakpoint
```

### DATA MIGRATION (backfill)

```sql
--liquibase formatted sql

--changeset daniel:add_paid_amount_to_orders splitStatements:false endDelimiter:--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paid_amount" INTEGER;
--> statement-breakpoint

-- Backfill paid_amount from existing transaction data
UPDATE orders o
SET paid_amount = CAST(ftj.payment_amount AS INTEGER)
FROM financial_transaction_journal ftj
WHERE ftj.basket_id = o.reference_id::text
  AND ftj.transaction_status = 'PaymentSuccess'
  AND o.paid_amount IS NULL;
--> statement-breakpoint

--rollback ALTER TABLE "orders" DROP COLUMN IF EXISTS "paid_amount";
--rollback --> statement-breakpoint
```

---

## Converting Drizzle Kit Migrations

Drizzle Kit generates migrations in a different format. Here's how to convert:

### Drizzle Kit format (0001_xxx.sql)
```sql
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL
);

ALTER TABLE "orders" ADD COLUMN "user_id" uuid NOT NULL;

ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
```

### Converted to Liquibase format
```sql
--liquibase formatted sql

--changeset your_email:create_users_and_link_orders splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL
);
--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN "user_id" uuid NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

--rollback ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_users_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "orders" DROP COLUMN IF EXISTS "user_id";
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "users";
--rollback --> statement-breakpoint
```

### Key differences when converting:

| Aspect | Drizzle Kit | Liquibase Format |
|--------|-------------|-----------------|
| Header | None | `--liquibase formatted sql` + `--changeset` |
| Statement separator | `;` + blank line | `--> statement-breakpoint` |
| `CREATE TABLE` | `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS` |
| Foreign keys | Plain `ALTER TABLE` | Wrapped in `DO $$ ... EXCEPTION ... END $$` |
| Rollbacks | Not supported | `--rollback` lines (reverse order) |
| Filename | `0001_name.sql` | `20250710092120_name.sql` |
| Tracking | Journal JSON + linked list | `master-changelog.xml` + `databasechangelog` table |

### Conversion Checklist

1. ✅ Add `--liquibase formatted sql` as first line
2. ✅ Add `--changeset author:id splitStatements:false endDelimiter:--> statement-breakpoint`
3. ✅ Replace every `;` (followed by blank line or EOF) with `;\n--> statement-breakpoint`
4. ✅ Change `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`
5. ✅ Wrap FK additions in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$`
6. ✅ Add rollback block at end (statements in reverse order)
7. ✅ Rename file: `0001_name.sql` → `<timestamp>_name.sql`
8. ✅ Add `<include file="migrations/<filename>"/>` to `master-changelog.xml`

---

## Master Changelog (master-changelog.xml)

All migration files must be referenced in the master changelog:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.20.xsd">

    <include file="migrations/20250705123138_create_products_table.sql"/>
    <include file="migrations/20250710092120_create_product_variants_table.sql"/>
    <include file="migrations/20250810053642_major_schema_restructure.sql"/>
</databaseChangeLog>
```

The `generate` command automatically adds new files to this changelog in chronological order.

---

## Rollback Best Practices

- **Rollback statements execute in order** — write them in reverse order of the forward migration
- Use `IF EXISTS` / `IF NOT EXISTS` for idempotency
- Data loss rollbacks should include a `-- WARNING:` comment
- For complex rollbacks that need data preservation, consider a two-step approach:
  1. Rename column/table instead of dropping
  2. Add a second migration to clean up

---

## Liquibase Tracking

Liquibase creates two tables in your database:

- **`databasechangelog`** — records every applied changeset (id, author, filename, dateexecuted, md5sum, ...)
- **`databasechangeloglock`** — prevents concurrent migrations

These are managed entirely by Liquibase and excluded from schema diff detection.
