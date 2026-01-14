ALTER TABLE `users` ADD `two_factor_secret` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_enabled` boolean DEFAULT false NOT NULL;