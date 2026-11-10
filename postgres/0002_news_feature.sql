ALTER TABLE news ADD COLUMN featured_at text;
ALTER TABLE news ADD COLUMN featured integer NOT NULL DEFAULT 0;
ALTER TABLE news ADD COLUMN news_published_once integer NOT NULL DEFAULT 0;
