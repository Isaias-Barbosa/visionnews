CREATE TABLE `news` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `summary` text NOT NULL,
  `body` text NOT NULL,
  `category` text NOT NULL,
  `author` text NOT NULL,
  `cover` text NOT NULL DEFAULT '',
  `source_url` text NOT NULL DEFAULT '',
  `source_label` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `published_at` text,
  `version` integer NOT NULL DEFAULT 1
);
