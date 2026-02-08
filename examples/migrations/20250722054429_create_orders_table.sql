--liquibase formatted sql

--changeset daniel:create_orders_table splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total" integer NOT NULL,
	"status" varchar(50) DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_orders_user_id" ON "orders" ("user_id");
--> statement-breakpoint

--rollback DROP INDEX IF EXISTS "idx_orders_user_id";
--rollback --> statement-breakpoint
--rollback DO $$ BEGIN
--rollback  ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_users_id_fk";
--rollback EXCEPTION
--rollback  WHEN undefined_object THEN null;
--rollback END $$;
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "orders";
--rollback --> statement-breakpoint
