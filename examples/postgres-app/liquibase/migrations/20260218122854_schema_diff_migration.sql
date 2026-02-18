--liquibase formatted sql

--changeset test-user:schema_diff_migration splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TYPE "public"."discount_type" AS ENUM('percentage', 'fixed_amount');
--> statement-breakpoint

CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint

ALTER TABLE "products" ADD COLUMN "weight" numeric(8, 3);
--> statement-breakpoint

ALTER TABLE "products" ADD COLUMN "stock_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "phone" varchar(20);
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "address" text;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "date_of_birth" timestamp;
--> statement-breakpoint

--rollback ALTER TABLE "users" DROP COLUMN "date_of_birth";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "users" DROP COLUMN "address";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "users" DROP COLUMN "phone";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "products" DROP COLUMN "stock_quantity";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "products" DROP COLUMN "weight";
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "coupons";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public"."discount_type";
--rollback --> statement-breakpoint
