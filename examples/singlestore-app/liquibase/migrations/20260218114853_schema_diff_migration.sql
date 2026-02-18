--liquibase formatted sql

-- ⚠️  DRIZZLE-KIT SINGLESTORE CAVEAT
-- drizzle-kit uses a "copy to new table" strategy for SingleStore migrations:
--   1. CREATE TABLE `__new_<table>` with the desired schema
--   2. INSERT INTO `__new_<table>` SELECT ... FROM `<table>`
--   3. DROP TABLE `<table>`
--   4. ALTER TABLE `__new_<table>` RENAME TO `<table>`
--
-- The INSERT...SELECT may reference columns that don't exist in the original
-- table (e.g. newly added columns). This is a known drizzle-kit limitation.
-- You may need to manually fix these INSERT statements before applying, e.g.:
--   - Remove new columns from the SELECT column list
--   - Add DEFAULT values or NULL for new columns in the INSERT column list
--
-- The generate command gets you ~90% of the way — review and correct as needed.

--changeset danielkpl2@gmail.com:schema_diff_migration

CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(100),
	`bio` text,
	`role` enum('admin','member','guest') NOT NULL DEFAULT 'member',
	`is_active` boolean NOT NULL DEFAULT true,
	`preferences` json,
	`phone` varchar(20),
	`avatar_url` varchar(500),
	`login_count` int NOT NULL DEFAULT 0,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
);

CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`parent_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);

CREATE TABLE `products` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sku` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`price` decimal(10,2) NOT NULL,
	`category_id` bigint unsigned,
	`status` enum('draft','active','discontinued','archived') NOT NULL DEFAULT 'draft',
	`metadata` json,
	`discount` decimal(5,2) DEFAULT '0.00',
	`is_active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);

CREATE TABLE `order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` decimal(10,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_number` varchar(30) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`status` enum('pending','processing','shipped','delivered','cancelled','refunded','on_hold') NOT NULL DEFAULT 'pending',
	`payment_method` enum('credit_card','paypal','bank_transfer','crypto'),
	`total_amount` decimal(10,2) NOT NULL,
	`shipping_address` json,
	`notes` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);

CREATE TABLE `reviews` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`rating` smallint NOT NULL,
	`title` text,
	`body` text,
	`is_verified` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);

--rollback DROP TABLE IF EXISTS `reviews`;
--rollback DROP TABLE IF EXISTS `orders`;
--rollback DROP TABLE IF EXISTS `order_items`;
--rollback DROP TABLE IF EXISTS `products`;
--rollback DROP TABLE IF EXISTS `categories`;
--rollback DROP TABLE IF EXISTS `users`;
