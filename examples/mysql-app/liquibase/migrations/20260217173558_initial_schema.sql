--liquibase formatted sql

--changeset danielkpl2@gmail.com:initial_schema

CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(100),
	`bio` text,
	`role` enum('admin','member','guest') NOT NULL DEFAULT 'member',
	`is_active` boolean NOT NULL DEFAULT true,
	`preferences` json,
	`login_count` int NOT NULL DEFAULT 0,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);

CREATE TABLE `categories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`parent_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sku` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`price` decimal(10,2) NOT NULL,
	`category_id` bigint unsigned,
	`status` enum('draft','active','discontinued','archived') NOT NULL DEFAULT 'draft',
	`metadata` json,
	`is_active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_sku_unique` UNIQUE(`sku`)
);

CREATE TABLE `order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` decimal(10,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_number` varchar(30) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`status` enum('pending','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`payment_method` enum('credit_card','paypal','bank_transfer','crypto'),
	`total_amount` decimal(10,2) NOT NULL,
	`shipping_address` json,
	`notes` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_number_unique` UNIQUE(`order_number`)
);

CREATE TABLE `reviews` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`rating` smallint NOT NULL,
	`title` text,
	`body` text,
	`is_verified` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);

ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;

ALTER TABLE `reviews` ADD CONSTRAINT `reviews_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;

CREATE INDEX `users_email_idx` ON `users` (`email`);

CREATE INDEX `products_sku_idx` ON `products` (`sku`);

CREATE INDEX `products_status_active_idx` ON `products` (`status`,`is_active`);

CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);

CREATE INDEX `order_items_product_id_idx` ON `order_items` (`product_id`);

CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);

CREATE INDEX `orders_status_idx` ON `orders` (`status`);

CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);

CREATE INDEX `reviews_user_id_idx` ON `reviews` (`user_id`);

CREATE INDEX `reviews_product_id_idx` ON `reviews` (`product_id`);

CREATE INDEX `reviews_rating_idx` ON `reviews` (`rating`);

--rollback ALTER TABLE `reviews` DROP CONSTRAINT `reviews_product_id_products_id_fk`;
--rollback ALTER TABLE `reviews` DROP CONSTRAINT `reviews_user_id_users_id_fk`;
--rollback ALTER TABLE `orders` DROP CONSTRAINT `orders_user_id_users_id_fk`;
--rollback ALTER TABLE `order_items` DROP CONSTRAINT `order_items_product_id_products_id_fk`;
--rollback ALTER TABLE `order_items` DROP CONSTRAINT `order_items_order_id_orders_id_fk`;
--rollback ALTER TABLE `products` DROP CONSTRAINT `products_category_id_categories_id_fk`;
--rollback ALTER TABLE `categories` DROP CONSTRAINT `categories_parent_id_categories_id_fk`;
--rollback DROP INDEX `reviews_rating_idx` ON `reviews`;
--rollback DROP INDEX `reviews_product_id_idx` ON `reviews`;
--rollback DROP INDEX `reviews_user_id_idx` ON `reviews`;
--rollback DROP INDEX `orders_created_at_idx` ON `orders`;
--rollback DROP INDEX `orders_status_idx` ON `orders`;
--rollback DROP INDEX `orders_user_id_idx` ON `orders`;
--rollback DROP INDEX `order_items_product_id_idx` ON `order_items`;
--rollback DROP INDEX `order_items_order_id_idx` ON `order_items`;
--rollback DROP INDEX `products_status_active_idx` ON `products`;
--rollback DROP INDEX `products_sku_idx` ON `products`;
--rollback DROP INDEX `users_email_idx` ON `users`;
--rollback DROP TABLE IF EXISTS `reviews`;
--rollback DROP TABLE IF EXISTS `orders`;
--rollback DROP TABLE IF EXISTS `order_items`;
--rollback DROP TABLE IF EXISTS `products`;
--rollback DROP TABLE IF EXISTS `categories`;
--rollback DROP TABLE IF EXISTS `users`;
