--liquibase formatted sql

--changeset daniel:add_phone_and_avatar_to_users splitStatements:false endDelimiter:--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(20);
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint

--rollback ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL;
--rollback --> statement-breakpoint
--rollback ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_url";
--rollback --> statement-breakpoint
--rollback ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
--rollback --> statement-breakpoint
