-- Camada aditiva do motor de ingestão. Nenhuma rota depende destas tabelas ainda.
CREATE TABLE IF NOT EXISTS `ingestion_queue` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_type` text NOT NULL,
  `source_id` integer NOT NULL DEFAULT 0,
  `item_key` text NOT NULL,
  `canonical_key` text,
  `status` text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','skipped')),
  `priority` integer NOT NULL DEFAULT 0,
  `attempts` integer NOT NULL DEFAULT 0,
  `error` text,
  `payload_json` text,
  `news_id` integer REFERENCES `news`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `article_dedup` (
  `canonical_key` text PRIMARY KEY NOT NULL,
  `title_key` text,
  `url` text,
  `source_type` text NOT NULL,
  `source_id` integer NOT NULL DEFAULT 0,
  `item_key` text,
  `news_id` integer REFERENCES `news`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_suggestions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `news_id` integer REFERENCES `news`(`id`) ON DELETE CASCADE,
  `rss_item_id` integer REFERENCES `rss_items`(`id`) ON DELETE SET NULL,
  `stage` text NOT NULL CHECK (stage IN ('extraction','translation','rewrite','review')),
  `provider` text NOT NULL,
  `model` text,
  `source_hash` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','applied','rejected','error')),
  `error` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `image_assets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_hash` text NOT NULL UNIQUE,
  `source_url` text NOT NULL,
  `storage_url` text,
  `mime_type` text,
  `width` integer,
  `height` integer,
  `status` text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  `news_id` integer REFERENCES `news`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `canonical_key` text;
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `pipeline_stage` text NOT NULL DEFAULT 'found';
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `extract_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `translation_status` text NOT NULL DEFAULT 'not_required';
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `source_language` text;
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `extracted_json` text;
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `last_pipeline_error` text;
--> statement-breakpoint
ALTER TABLE `rss_items` ADD COLUMN `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `uq_ingestion_queue_source` ON `ingestion_queue` (`source_type`, `source_id`, `item_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ingestion_queue_status` ON `ingestion_queue` (`status`, `priority`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_article_dedup_source` ON `article_dedup` (`source_type`, `source_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_suggestions_news` ON `ai_suggestions` (`news_id`, `stage`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rss_items_pipeline` ON `rss_items` (`pipeline_stage`, `extract_status`);
