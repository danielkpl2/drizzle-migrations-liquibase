--liquibase formatted sql

--changeset daniel:create_products_table splitStatements:false endDelimiter:--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "products_unique_slug_deleted_at" UNIQUE("slug","deleted_at")
);
--> statement-breakpoint

--rollback DROP TABLE IF EXISTS "products";
--rollback --> statement-breakpoint
