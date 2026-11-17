-- Preenche a capa de rascunhos criados a partir do radar RSS que ficaram sem
-- imagem por causa da extração antiga. Só altera capas vazias e mantém
-- qualquer escolha editorial já salva.
UPDATE news
SET cover = (
  SELECT i.image_url
  FROM rss_items i
  WHERE i.imported_news_id = news.id
    AND i.image_url IS NOT NULL
    AND i.image_url <> ''
  ORDER BY i.id DESC
  LIMIT 1
)
WHERE status = 'draft'
  AND (cover IS NULL OR cover = '')
  AND EXISTS (
    SELECT 1
    FROM rss_items i
    WHERE i.imported_news_id = news.id
      AND i.image_url IS NOT NULL
      AND i.image_url <> ''
  );
