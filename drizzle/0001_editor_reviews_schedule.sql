ALTER TABLE `news` ADD `body_format` text NOT NULL DEFAULT 'plain';
--> statement-breakpoint
ALTER TABLE `news` ADD `review_score` real;
--> statement-breakpoint
ALTER TABLE `news` ADD `review_verdict` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `news` ADD `anime_title` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE `schedule` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `title` text NOT NULL,
 `summary` text NOT NULL DEFAULT '',
 `weekday` integer NOT NULL,
 `time` text NOT NULL DEFAULT '',
 `platform` text NOT NULL,
 `official_url` text NOT NULL DEFAULT '',
 `language` text NOT NULL DEFAULT 'Legendado',
 `season_year` integer NOT NULL,
 `season_quarter` integer NOT NULL,
 `cover` text NOT NULL DEFAULT '',
 `episode` text NOT NULL DEFAULT '',
 `status` text NOT NULL DEFAULT 'draft',
 `created_at` text NOT NULL,
 `updated_at` text NOT NULL,
 `version` integer NOT NULL DEFAULT 1
);
