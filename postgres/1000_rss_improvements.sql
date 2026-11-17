-- Incremental changes for databases that already applied 999_rss.sql.
ALTER TABLE rss_feeds
    ADD COLUMN IF NOT EXISTS auto_import BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rss_items
    ADD COLUMN IF NOT EXISTS author VARCHAR(160);

CREATE INDEX IF NOT EXISTS idx_rss_items_feed_created
    ON rss_items (feed_id, created_at DESC);
