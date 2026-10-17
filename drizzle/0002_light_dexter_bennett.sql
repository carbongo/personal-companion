CREATE TABLE `digests` (
	`kind` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`summary_md` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`kind`, `start`)
);
--> statement-breakpoint
ALTER TABLE `memories` ADD `confirmed_at` integer;