--liquibase formatted sql

--changeset danielkpl2@gmail.com:initial_schema

CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text(100),
	`bio` text,
	`role` text DEFAULT 'member' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`preferences` text,
	`login_count` integer DEFAULT 0 NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX `users_email_idx` ON `users` (`email`);

CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text(100) NOT NULL,
	`slug` text(100) NOT NULL,
	`parent_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);

CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text(50) NOT NULL,
	`name` text(255) NOT NULL,
	`description` text,
	`price` real NOT NULL,
	`category_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`metadata` text,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `products_sku_idx` ON `products` (`sku`);

CREATE INDEX `products_status_active_idx` ON `products` (`status`,`is_active`);

CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);

CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);

CREATE INDEX `order_items_product_id_idx` ON `order_items` (`product_id`);

CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text(30) NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_method` text,
	`total_amount` real NOT NULL,
	`shipping_address` text,
	`notes` text(500),
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);

CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);

CREATE INDEX `orders_status_idx` ON `orders` (`status`);

CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);

CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`title` text,
	`body` text,
	`is_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `reviews_user_id_idx` ON `reviews` (`user_id`);

CREATE INDEX `reviews_product_id_idx` ON `reviews` (`product_id`);

CREATE INDEX `reviews_rating_idx` ON `reviews` (`rating`);

--rollback DROP INDEX IF EXISTS "reviews_rating_idx";
--rollback DROP INDEX IF EXISTS "reviews_product_id_idx";
--rollback DROP INDEX IF EXISTS "reviews_user_id_idx";
--rollback DROP TABLE IF EXISTS "reviews";
--rollback DROP INDEX IF EXISTS "orders_created_at_idx";
--rollback DROP INDEX IF EXISTS "orders_status_idx";
--rollback DROP INDEX IF EXISTS "orders_user_id_idx";
--rollback DROP INDEX IF EXISTS "orders_order_number_unique";
--rollback DROP TABLE IF EXISTS "orders";
--rollback DROP INDEX IF EXISTS "order_items_product_id_idx";
--rollback DROP INDEX IF EXISTS "order_items_order_id_idx";
--rollback DROP TABLE IF EXISTS "order_items";
--rollback DROP INDEX IF EXISTS "products_sku_unique";
--rollback DROP INDEX IF EXISTS "products_status_active_idx";
--rollback DROP INDEX IF EXISTS "products_sku_idx";
--rollback DROP TABLE IF EXISTS "products";
--rollback DROP INDEX IF EXISTS "categories_slug_unique";
--rollback DROP TABLE IF EXISTS "categories";
--rollback DROP INDEX IF EXISTS "users_email_unique";
--rollback DROP INDEX IF EXISTS "users_email_idx";
--rollback DROP TABLE IF EXISTS "users";
