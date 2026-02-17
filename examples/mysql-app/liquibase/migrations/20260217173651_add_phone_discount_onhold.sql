--liquibase formatted sql

--changeset danielkpl2@gmail.com:add_phone_discount_onhold

ALTER TABLE `orders` MODIFY COLUMN `status` enum('pending','processing','shipped','delivered','cancelled','refunded','on_hold') NOT NULL DEFAULT 'pending';

ALTER TABLE `products` ADD `discount` decimal(5,2) DEFAULT '0.00';

ALTER TABLE `users` ADD `phone` varchar(20);

ALTER TABLE `users` ADD `avatar_url` varchar(500);

CREATE INDEX `products_name_status_idx` ON `products` (`name`,`status`);

--rollback DROP INDEX `products_name_status_idx` ON `products`;
--rollback ALTER TABLE `users` DROP COLUMN `avatar_url`;
--rollback ALTER TABLE `users` DROP COLUMN `phone`;
--rollback ALTER TABLE `products` DROP COLUMN `discount`;
--rollback -- Manual rollback required: revert MODIFY COLUMN change;
