-- Dicas de tipografia detectadas no HTML dos itens RSS (fonte, cor e realce).
ALTER TABLE rss_items ADD COLUMN IF NOT EXISTS style_json TEXT;
