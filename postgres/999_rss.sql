
CREATE TABLE IF NOT EXISTS rss_feeds (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    feed_url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_fetched_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rss_items (
    id BIGSERIAL PRIMARY KEY,
    feed_id BIGINT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    guid TEXT,
    link TEXT,
    title VARCHAR(300) NOT NULL,
    summary TEXT,
    content TEXT,
    image_url TEXT,
    published_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ,
    imported_news_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT rss_items_feed_item_key UNIQUE (feed_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_rss_items_feed_published
    ON rss_items (feed_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_rss_items_published
    ON rss_items (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_rss_items_imported
    ON rss_items (imported_at);
