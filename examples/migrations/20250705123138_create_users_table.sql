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
