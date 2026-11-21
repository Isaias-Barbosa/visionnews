import { createHash } from "node:crypto";

import { normalizeTitle } from "./dedup.mjs";

const QUEUE_STATUSES = new Set([
  "pending",
  "processing",
  "done",
  "failed",
  "skipped",
]);
const SUGGESTION_STAGES = new Set([
  "extraction",
  "translation",
  "rewrite",
  "review",
]);
const SUGGESTION_STATUSES = new Set([
  "suggested",
  "applied",
  "rejected",
  "error",
]);
const RSS_PIPELINE_COLUMNS = new Set([
  "canonical_key",
  "pipeline_stage",
  "extract_status",
  "translation_status",
  "source_language",
  "extracted_json",
  "last_pipeline_error",
]);

const limited = (value, max) => String(value ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

export function sourceHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function queueResponse(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    source_id: Number(row.source_id || 0),
    priority: Number(row.priority || 0),
    attempts: Number(row.attempts || 0),
    payload: parseJson(row.payload_json, {}),
  };
}

function suggestionResponse(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    news_id: row.news_id ? Number(row.news_id) : null,
    rss_item_id: row.rss_item_id ? Number(row.rss_item_id) : null,
    payload: parseJson(row.payload_json, {}),
  };
}

/** Enfileira um item. Não substitui o UPSERT legado de rss_items. */
export async function enqueueQueueItem(DB, item, options = {}) {
  const sourceType = limited(item.sourceType, 40) || "rss";
  const sourceId = Number.isSafeInteger(Number(item.sourceId))
    ? Number(item.sourceId)
    : 0;
  const itemKey = limited(item.itemKey, 500);

  if (!itemKey) return { enqueued: 0, skipped: 1, id: null };

  const existing = await DB.prepare(
    `SELECT id FROM ingestion_queue
     WHERE source_type=? AND source_id=? AND item_key=?`,
  )
    .bind(sourceType, sourceId, itemKey)
    .first();

  if (existing) {
    return { enqueued: 0, skipped: 1, id: Number(existing.id) };
  }

  const priority = Number.isSafeInteger(Number(options.priority))
    ? Number(options.priority)
    : 0;
  const result = await DB.prepare(
    `INSERT INTO ingestion_queue (
       source_type,
       source_id,
       item_key,
       canonical_key,
       status,
       priority,
       payload_json,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      sourceType,
      sourceId,
      itemKey,
      limited(item.canonicalKey, 500) || null,
      priority,
      JSON.stringify(item.payload || {}),
      nowIso(),
      nowIso(),
    )
    .run();

  return {
    enqueued: Number(result?.meta?.changes || 0),
    skipped: 0,
    id: Number(result?.meta?.last_row_id || 0) || null,
  };
}

export async function enqueueQueueItems(DB, items, options = {}) {
  const totals = { enqueued: 0, skipped: 0, ids: [] };

  for (const item of Array.isArray(items) ? items : []) {
    const result = await enqueueQueueItem(DB, item, options);
    totals.enqueued += result.enqueued;
    totals.skipped += result.skipped;
    if (result.id) totals.ids.push(result.id);
  }

  return totals;
}

export async function countQueueByStatus(DB) {
  const { results } = await DB.prepare(
    `SELECT status, COUNT(*) AS total FROM ingestion_queue GROUP BY status`,
  ).all();

  const counts = {
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of results || []) {
    if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.total);
  }

  return counts;
}

/** Reabre jobs que falharam, sem tocar em itens concluídos ou duplicatas. */
export async function retryFailedQueueItems(DB, options = {}) {
  const limit = Math.min(20, Math.max(1, Number(options.limit) || 20));
  const { results } = await DB.prepare(
    `SELECT * FROM ingestion_queue
     WHERE status='failed'
     ORDER BY id ASC LIMIT ?`,
  )
    .bind(limit)
    .all();

  const ids = [];
  const rssItemIds = new Set();

  for (const row of results || []) {
    const payload = parseJson(row.payload_json, {});
    const rssItemId = Number(payload.rssItemId || 0);
    if (Number.isSafeInteger(rssItemId) && rssItemId > 0) {
      rssItemIds.add(rssItemId);
    }

    const result = await DB.prepare(
      `UPDATE ingestion_queue
       SET status='pending', error=NULL, attempts=0, updated_at=?
       WHERE id=? AND status='failed'`,
    )
      .bind(nowIso(), row.id)
      .run();

    if (Number(result?.meta?.changes || 0)) ids.push(Number(row.id));
  }

  for (const rssItemId of rssItemIds) {
    await updateRssItemPipeline(DB, rssItemId, {
      pipeline_stage: "found",
      extract_status: "pending",
      last_pipeline_error: null,
    });
  }

  return { retried: ids.length, ids, counts: await countQueueByStatus(DB) };
}

export async function listQueueItems(DB, options = {}) {
  const conditions = [];
  const parameters = [];

  const status = limited(options.status, 40);
  if (status && QUEUE_STATUSES.has(status)) {
    conditions.push("status=?");
    parameters.push(status);
  }

  const sourceType = limited(options.sourceType, 40);
  if (sourceType) {
    conditions.push("source_type=?");
    parameters.push(sourceType);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 30));
  const page = Math.max(1, Number(options.page) || 1);
  const offset = (page - 1) * limit;

  const totalRow = await DB.prepare(
    `SELECT COUNT(*) AS total FROM ingestion_queue ${where}`,
  )
    .bind(...parameters)
    .first();

  const { results } = await DB.prepare(
    `SELECT * FROM ingestion_queue ${where}
     ORDER BY priority DESC, id ASC LIMIT ? OFFSET ?`,
  )
    .bind(...parameters, limit, offset)
    .all();

  return {
    total: Number(totalRow?.total || 0),
    items: (results || []).map(queueResponse),
    counts: await countQueueByStatus(DB),
  };
}

/** Marca itens como `processing` antes de qualquer acesso à rede. */
export async function claimQueueItems(DB, options = {}) {
  const limit = Math.min(20, Math.max(1, Number(options.limit) || 5));
  const { results } = await DB.prepare(
    `SELECT * FROM ingestion_queue
     WHERE status='pending'
     ORDER BY priority DESC, id ASC LIMIT ?`,
  )
    .bind(limit)
    .all();

  const claimed = [];

  for (const row of results || []) {
    const result = await DB.prepare(
      `UPDATE ingestion_queue
       SET status='processing', attempts=attempts+1, updated_at=?
       WHERE id=? AND status='pending'`,
    )
      .bind(nowIso(), row.id)
      .run();

    if (Number(result?.meta?.changes || 0)) {
      claimed.push(
        queueResponse({
          ...row,
          status: "processing",
          attempts: Number(row.attempts || 0) + 1,
        }),
      );
    }
  }

  return claimed;
}

export async function finishQueueItem(DB, id, options = {}) {
  const status = limited(options.status, 40);
  if (!QUEUE_STATUSES.has(status)) {
    throw new Error("Status da fila inválido.");
  }

  const result = await DB.prepare(
    `UPDATE ingestion_queue
     SET status=?, error=?, news_id=?, updated_at=?
     WHERE id=?`,
  )
    .bind(
      status,
      limited(options.error, 1000) || null,
      options.newsId ? Number(options.newsId) : null,
      nowIso(),
      id,
    )
    .run();

  return Number(result?.meta?.changes || 0);
}

export async function getRssItemForPipeline(DB, id) {
  const row = await DB.prepare(
    `SELECT
       i.*,
       f.name AS feed_name,
       f.site_url AS feed_site_url
     FROM rss_items i
     INNER JOIN rss_feeds f ON f.id=i.feed_id
     WHERE i.id=?`,
  )
    .bind(id)
    .first();

  if (!row) return null;

  return {
    ...row,
    id: Number(row.id),
    feed_id: Number(row.feed_id),
    style: parseJson(row.style_json, { fonts: [], colors: [], backgrounds: [] }),
  };
}

/** Atualiza somente colunas conhecidas do schema aditivo. */
export async function updateRssItemPipeline(DB, id, fields = {}) {
  const entries = Object.entries(fields).filter(
    ([key, value]) => RSS_PIPELINE_COLUMNS.has(key) && value !== undefined,
  );

  if (!entries.length) return 0;

  const assignments = entries.map(([key]) => `${key}=?`);
  assignments.push("updated_at=?");

  const values = entries.map(([key, value]) =>
    key === "extracted_json" && typeof value !== "string"
      ? JSON.stringify(value)
      : value,
  );

  const result = await DB.prepare(
    `UPDATE rss_items SET ${assignments.join(", ")} WHERE id=?`,
  )
    .bind(...values, nowIso(), id)
    .run();

  return Number(result?.meta?.changes || 0);
}

export async function findDedup(DB, canonicalKey) {
  const row = await DB.prepare(
    `SELECT * FROM article_dedup WHERE canonical_key=?`,
  )
    .bind(canonicalKey)
    .first();

  return row ? { ...row, id: Number(row.id) } : null;
}

/** Reserva a chave canônica. Retorna `created:false` para duplicatas. */
export async function registerDedup(DB, input = {}) {
  const canonicalKey = limited(input.canonicalKey, 500);
  if (!canonicalKey) return { created: false, item: null };

  const existing = await findDedup(DB, canonicalKey);
  if (existing) return { created: false, item: existing };

  try {
    const result = await DB.prepare(
      `INSERT INTO article_dedup (
         canonical_key,
         title_key,
         url,
         source_type,
         source_id,
         item_key,
         news_id,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        canonicalKey,
        limited(input.titleKey, 200) || null,
        limited(input.url, 2000) || null,
        limited(input.sourceType, 40) || "rss",
        Number(input.sourceId) || 0,
        limited(input.itemKey, 500) || null,
        input.newsId ? Number(input.newsId) : null,
        nowIso(),
      )
      .run();

    return {
      created: Number(result?.meta?.changes || 0) > 0,
      item: {
        canonical_key: canonicalKey,
        source_type: limited(input.sourceType, 40) || "rss",
        source_id: Number(input.sourceId) || 0,
        item_key: limited(input.itemKey, 500) || null,
        url: limited(input.url, 2000) || null,
      },
    };
  } catch {
    const raced = await findDedup(DB, canonicalKey);
    return { created: false, item: raced };
  }
}

export async function insertSuggestion(DB, input = {}) {
  const stage = limited(input.stage, 40);
  const status = limited(input.status, 40) || "suggested";

  if (!SUGGESTION_STAGES.has(stage)) {
    throw new Error("Estágio de sugestão inválido.");
  }
  if (!SUGGESTION_STATUSES.has(status)) {
    throw new Error("Status de sugestão inválido.");
  }

  const rssItemId = input.rssItemId ? Number(input.rssItemId) : null;
  const newsId = input.newsId ? Number(input.newsId) : null;
  const hash = limited(input.sourceHash, 100) || sourceHash(JSON.stringify(input.payload || {}));
  const payload = JSON.stringify(input.payload || {});

  const existing = rssItemId
    ? await DB.prepare(
        `SELECT id FROM ai_suggestions
         WHERE rss_item_id=? AND stage=? AND source_hash=?`,
      )
        .bind(rssItemId, stage, hash)
        .first()
    : newsId
      ? await DB.prepare(
          `SELECT id FROM ai_suggestions
           WHERE news_id=? AND stage=? AND source_hash=?`,
        )
          .bind(newsId, stage, hash)
          .first()
      : await DB.prepare(
          `SELECT id FROM ai_suggestions
           WHERE news_id IS NULL AND stage=? AND source_hash=?`,
        )
          .bind(stage, hash)
          .first();

  if (existing) {
    await DB.prepare(
      `UPDATE ai_suggestions
       SET provider=?, model=?, payload_json=?, status=?, error=?, updated_at=?
       WHERE id=?`,
    )
      .bind(
        limited(input.provider, 40) || "extractor",
        limited(input.model, 120) || null,
        payload,
        status,
        limited(input.error, 1000) || null,
        nowIso(),
        existing.id,
      )
      .run();
    return { created: false, id: Number(existing.id) };
  }

  const result = await DB.prepare(
    `INSERT INTO ai_suggestions (
       news_id,
       rss_item_id,
       stage,
       provider,
       model,
       source_hash,
       payload_json,
       status,
       error,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newsId,
      rssItemId,
      stage,
      limited(input.provider, 40) || "extractor",
      limited(input.model, 120) || null,
      hash,
      payload,
      status,
      limited(input.error, 1000) || null,
      nowIso(),
      nowIso(),
    )
    .run();

  return {
    created: Number(result?.meta?.changes || 0) > 0,
    id: Number(result?.meta?.last_row_id || 0) || null,
  };
}

export async function listSuggestions(DB, options = {}) {
  const conditions = [];
  const parameters = [];

  const rssItemId = Number(options.rssItemId);
  if (Number.isSafeInteger(rssItemId) && rssItemId > 0) {
    conditions.push("rss_item_id=?");
    parameters.push(rssItemId);
  }

  const newsId = Number(options.newsId);
  if (Number.isSafeInteger(newsId) && newsId > 0) {
    conditions.push("news_id=?");
    parameters.push(newsId);
  }

  const stage = limited(options.stage, 40);
  if (SUGGESTION_STAGES.has(stage)) {
    conditions.push("stage=?");
    parameters.push(stage);
  }

  const status = limited(options.status, 40);
  if (SUGGESTION_STATUSES.has(status)) {
    conditions.push("status=?");
    parameters.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 30));

  const { results } = await DB.prepare(
    `SELECT * FROM ai_suggestions ${where}
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(...parameters, limit)
    .all();

  return (results || []).map(suggestionResponse);
}

export function normalizeDedupTitle(value) {
  return normalizeTitle(value);
}
