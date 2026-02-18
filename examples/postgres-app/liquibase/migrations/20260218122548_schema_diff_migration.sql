--liquibase formatted sql

--changeset test-user:schema_diff_migration splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TYPE "public"."user_role" AS ENUM('admin', 'member', 'guest');
--> statement-breakpoint

CREATE TYPE "public"."product_category" AS ENUM('electronics', 'clothing', 'food', 'health', 'other');
--> statement-breakpoint

CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'discontinued', 'archived');
--> statement-breakpoint

CREATE TYPE "public"."order_status" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
--> statement-breakpoint

CREATE TYPE "public"."payment_method" AS ENUM('credit_card', 'paypal', 'bank_transfer', 'crypto');
--> statement-breakpoint

CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100),
	"bio" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tags" text[],
	"preferences" jsonb,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"category_id" integer,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_order_id_product_id_unique" UNIQUE("order_id","product_id")
);
--> statement-breakpoint

CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(30) NOT NULL,
	"user_id" integer NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"payment_method" "payment_method",
	"total_amount" numeric(10, 2) NOT NULL,
	"shipping_address" jsonb,
	"notes" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "users_email_idx" ON "users" USING btree ("email");
--> statement-breakpoint

CREATE INDEX "users_role_idx" ON "users" USING btree ("role");
--> statement-breakpoint

CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");
--> statement-breakpoint

CREATE INDEX "products_status_active_idx" ON "products" USING btree ("status","is_active");
--> statement-breakpoint

CREATE INDEX "products_metadata_idx" ON "products" USING gin ("metadata");
--> statement-breakpoint

CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");
--> statement-breakpoint

CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");
--> statement-breakpoint

CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");
--> statement-breakpoint

CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
--> statement-breakpoint

CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "reviews_product_id_idx" ON "reviews" USING btree ("product_id");
--> statement-breakpoint

CREATE INDEX "reviews_rating_idx" ON "reviews" USING btree ("rating");
--> statement-breakpoint

CREATE POLICY "users_select_policy" ON "users" AS PERMISSIVE FOR SELECT TO "anon", "authenticated";
--> statement-breakpoint

CREATE POLICY "users_insert_policy" ON "users" AS PERMISSIVE FOR INSERT TO "authenticated";
--> statement-breakpoint

CREATE POLICY "users_update_policy" ON "users" AS PERMISSIVE FOR UPDATE TO "authenticated";
--> statement-breakpoint

CREATE POLICY "products_select" ON "products" AS PERMISSIVE FOR SELECT TO "anon", "authenticated";
--> statement-breakpoint

CREATE POLICY "products_admin_insert" ON "products" AS PERMISSIVE FOR INSERT TO "authenticated";
--> statement-breakpoint

CREATE POLICY "orders_select" ON "orders" AS PERMISSIVE FOR SELECT TO "authenticated";
--> statement-breakpoint

CREATE POLICY "orders_insert" ON "orders" AS PERMISSIVE FOR INSERT TO "authenticated";
--> statement-breakpoint

CREATE POLICY "reviews_select" ON "reviews" AS PERMISSIVE FOR SELECT TO "anon", "authenticated";
--> statement-breakpoint

CREATE POLICY "reviews_insert" ON "reviews" AS PERMISSIVE FOR INSERT TO "authenticated";
--> statement-breakpoint

CREATE POLICY "reviews_delete" ON "reviews" AS PERMISSIVE FOR DELETE TO "authenticated";
--> statement-breakpoint

--rollback DROP POLICY IF EXISTS "reviews_delete" ON "reviews";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "reviews_insert" ON "reviews";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "reviews_select" ON "reviews";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "orders_insert" ON "orders";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "orders_select" ON "orders";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "products_admin_insert" ON "products";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "products_select" ON "products";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "users_update_policy" ON "users";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "users_insert_policy" ON "users";
--rollback --> statement-breakpoint
--rollback DROP POLICY IF EXISTS "users_select_policy" ON "users";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "reviews_rating_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "reviews_product_id_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "reviews_user_id_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "orders_created_at_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "orders_status_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "orders_user_id_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "order_items_product_id_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "order_items_order_id_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "products_metadata_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "products_status_active_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "products_sku_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "users_role_idx";
--rollback --> statement-breakpoint
--rollback DROP INDEX IF EXISTS "users_email_idx";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "reviews" DROP CONSTRAINT "reviews_product_id_products_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "reviews" DROP CONSTRAINT "reviews_user_id_users_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_users_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "order_items" DROP CONSTRAINT "order_items_product_id_products_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "order_items" DROP CONSTRAINT "order_items_order_id_orders_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "products" DROP CONSTRAINT "products_category_id_categories_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_categories_id_fk";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "reviews" DISABLE ROW LEVEL SECURITY;
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "reviews";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "orders";
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "order_items";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "products";
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "categories";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
--rollback --> statement-breakpoint
--rollback DROP TABLE IF EXISTS "users";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public";
--rollback --> statement-breakpoint
--rollback DROP TYPE IF EXISTS "public";
--rollback --> statement-breakpoint
