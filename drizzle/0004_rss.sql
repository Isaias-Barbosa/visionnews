CREATE TABLE IF NOT EXISTS `rss_feeds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `feed_url` text NOT NULL UNIQUE,
  `site_url` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `auto_import` integer NOT NULL DEFAULT 0,
  `last_fetched_at` text,
  `last_error` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rss_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `feed_id` integer NOT NULL REFERENCES `rss_feeds`(`id`) ON DELETE CASCADE,
  `item_key` text NOT NULL,
  `guid` text,
  `link` text,
  `title` text NOT NULL,
  `summary` text,
  `content` text,
  `image_url` text,
  `author` text,
  `published_at` text,
  `imported_at` text,
  `imported_news_id` integer REFERENCES `news`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`feed_id`, `item_key`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rss_items_feed_published` ON `rss_items` (`feed_id`, `published_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rss_items_published` ON `rss_items` (`published_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rss_items_imported` ON `rss_items` (`imported_at`);
