--liquibase formatted sql

--changeset danielkpl2@gmail.com:add_phone_discount

ALTER TABLE `users` ADD `phone` text(20);

ALTER TABLE `users` ADD `avatar_url` text(500);

ALTER TABLE `products` ADD `discount` real DEFAULT 0;

CREATE INDEX `products_name_status_idx` ON `products` (`name`,`status`);

--rollback DROP INDEX IF EXISTS "products_name_status_idx";
--rollback ALTER TABLE "products" DROP COLUMN "discount";
--rollback ALTER TABLE "users" DROP COLUMN "avatar_url";
--rollback ALTER TABLE "users" DROP COLUMN "phone";
