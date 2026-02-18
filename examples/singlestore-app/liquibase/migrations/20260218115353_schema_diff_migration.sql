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

CREATE TABLE `coupons` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`description` varchar(255),
	`discount_type` enum('percentage','fixed_amount') NOT NULL,
	`discount_value` decimal(10,2) NOT NULL,
	`min_order_amount` decimal(10,2),
	`max_uses` int,
	`current_uses` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`starts_at` timestamp,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `coupons_id` PRIMARY KEY(`id`)
);

CREATE TABLE `__new_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`parent_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);

INSERT INTO `__new_categories`(`id`, `name`, `slug`, `parent_id`, `created_at`) SELECT `id`, `name`, `slug`, `parent_id`, `created_at` FROM `categories`;

DROP TABLE `categories`;

ALTER TABLE `__new_categories` RENAME TO `categories`;

CREATE TABLE `__new_order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` decimal(10,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);

INSERT INTO `__new_order_items`(`id`, `order_id`, `product_id`, `quantity`, `unit_price`, `created_at`) SELECT `id`, `order_id`, `product_id`, `quantity`, `unit_price`, `created_at` FROM `order_items`;

DROP TABLE `order_items`;

ALTER TABLE `__new_order_items` RENAME TO `order_items`;

CREATE TABLE `__new_orders` (
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

INSERT INTO `__new_orders`(`id`, `order_number`, `user_id`, `status`, `payment_method`, `total_amount`, `shipping_address`, `notes`, `created_at`, `updated_at`) SELECT `id`, `order_number`, `user_id`, `status`, `payment_method`, `total_amount`, `shipping_address`, `notes`, `created_at`, `updated_at` FROM `orders`;

DROP TABLE `orders`;

ALTER TABLE `__new_orders` RENAME TO `orders`;

CREATE TABLE `__new_products` (
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
	`weight` decimal(8,3),
	`stock_quantity` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);

INSERT INTO `__new_products`(`id`, `sku`, `name`, `description`, `price`, `category_id`, `status`, `metadata`, `discount`, `is_active`, `weight`, `stock_quantity`, `created_at`, `updated_at`, `deleted_at`) SELECT `id`, `sku`, `name`, `description`, `price`, `category_id`, `status`, `metadata`, `discount`, `is_active`, `weight`, `stock_quantity`, `created_at`, `updated_at`, `deleted_at` FROM `products`;

DROP TABLE `products`;

ALTER TABLE `__new_products` RENAME TO `products`;

CREATE TABLE `__new_reviews` (
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

INSERT INTO `__new_reviews`(`id`, `user_id`, `product_id`, `rating`, `title`, `body`, `is_verified`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `product_id`, `rating`, `title`, `body`, `is_verified`, `created_at`, `updated_at` FROM `reviews`;

DROP TABLE `reviews`;

ALTER TABLE `__new_reviews` RENAME TO `reviews`;

CREATE TABLE `__new_users` (
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
	`address` text,
	`date_of_birth` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
);

INSERT INTO `__new_users`(`id`, `email`, `name`, `bio`, `role`, `is_active`, `preferences`, `phone`, `avatar_url`, `login_count`, `last_login_at`, `address`, `date_of_birth`, `created_at`, `updated_at`) SELECT `id`, `email`, `name`, `bio`, `role`, `is_active`, `preferences`, `phone`, `avatar_url`, `login_count`, `last_login_at`, `address`, `date_of_birth`, `created_at`, `updated_at` FROM `users`;

DROP TABLE `users`;

ALTER TABLE `__new_users` RENAME TO `users`;

--rollback DROP TABLE IF EXISTS `__new_users`;
--rollback DROP TABLE IF EXISTS `__new_reviews`;
--rollback DROP TABLE IF EXISTS `__new_products`;
--rollback DROP TABLE IF EXISTS `__new_orders`;
--rollback DROP TABLE IF EXISTS `__new_order_items`;
--rollback DROP TABLE IF EXISTS `__new_categories`;
--rollback DROP TABLE IF EXISTS `coupons`;
--rollback ALTER TABLE `users` RENAME TO `__new_users`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
--rollback ALTER TABLE `reviews` RENAME TO `__new_reviews`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
--rollback ALTER TABLE `products` RENAME TO `__new_products`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
--rollback ALTER TABLE `orders` RENAME TO `__new_orders`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
--rollback ALTER TABLE `order_items` RENAME TO `__new_order_items`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
--rollback ALTER TABLE `categories` RENAME TO `__new_categories`;
--rollback -- Manual rollback required: recreate dropped table;
--rollback -- Manual rollback required;
