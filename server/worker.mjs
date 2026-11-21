import {
  aiStatus,
  hasDeepL,
  hasOpenRouter,
  translateWithProvider,
} from "./ai.mjs";
import { canonicalItemKey, legacyItemKey } from "./dedup.mjs";
import { enqueueRssItems, processQueueItems } from "./pipeline.mjs";
import {
  countQueueByStatus,
  getRssItemForPipeline,
  listQueueItems,
  listSuggestions,
} from "./queue.mjs";
import { fetchAndParseFeed, validateFeedUrl } from "./rss.mjs";
import {
  animePlatforms,
  fetchSeasonSchedule,
  fetchTrendingAnime,
  seasonFromQuarter,
} from "./anime.mjs";

const categories = ["Notícias", "Reviews", "Guias", "Cultura"];
const statuses = ["draft", "published", "archived"];
const platforms = animePlatforms;
const newsColumns = [
  "title",
  "summary",
  "body",
  "category",
  "author",
  "cover",
  "source_url",
  "source_label",
  "status",
  "body_format",
  "review_score",
  "review_verdict",
  "anime_title",
  "topic",
  "tags",
];
const scheduleColumns = [
  "title",
  "summary",
  "weekday",
  "time",
  "platform",
  "official_url",
  "language",
  "season_year",
  "season_quarter",
  "cover",
  "episode",
  "status",
];
const recommendationColumns = [
  "feature_date",
  "title",
  "summary",
  "cover",
  "streams",
  "status",
];
const editorialTables = {
  news: { columns: newsColumns, validate: validateNews },
  schedule: { columns: scheduleColumns, validate: validateSchedule },
  recommendations: {
    columns: recommendationColumns,
    validate: validateRecommendation,
  },
};
const todayInBrasilia = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );

// Catálogo tipográfico mantido no GitHub a partir do Google Fonts. A resposta
// é cacheada no Worker para não depender de rede a cada abertura do editor.
const FONT_CATALOG_SOURCES = [
  "https://fonts.grida.co/webfonts.json",
  "https://raw.githubusercontent.com/gridaco/fonts/master/webfonts.json",
];
const FONT_CATALOG_TTL = 6 * 60 * 60 * 1000;
let fontCatalogCache = null;

async function fontCatalogData() {
  if (fontCatalogCache && fontCatalogCache.expires > Date.now()) {
    return fontCatalogCache.data;
  }

  let lastError = null;

  for (const source of FONT_CATALOG_SOURCES) {
    try {
      const response = await fetch(source, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw Error("HTTP " + response.status);

      const payload = await response.json();
      const items = (Array.isArray(payload?.items) ? payload.items : [])
        .map((item) => ({
          family: String(item.family || "").trim().slice(0, 80),
          category: String(item.category || "sans-serif").slice(0, 30),
          variants: (Array.isArray(item.variants) ? item.variants : [])
            .map(String)
            .slice(0, 30),
          subsets: (Array.isArray(item.subsets) ? item.subsets : [])
            .map(String)
            .slice(0, 30),
        }))
        .filter((item) => item.family)
        .sort((a, b) => a.family.localeCompare(b.family, "pt-BR"));

      // O catálogo completo tem mais de 1.900 famílias; nunca devolvemos uma
      // lista parcial que não atenda ao mínimo de 500 fontes.
      if (items.length < 500) throw Error("Catálogo incompleto.");

      const data = { source, count: items.length, items };
      fontCatalogCache = { data, expires: Date.now() + FONT_CATALOG_TTL };
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  if (fontCatalogCache) return fontCatalogCache.data;
  throw lastError || Error("Catálogo de fontes indisponível.");
}

function rssStyle(value) {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return normalizeRssStyle(parsed);
    } catch {
      return null;
    }
  }

  return normalizeRssStyle(value);
}

function normalizeRssStyle(value) {
  if (!value || typeof value !== "object") return null;

  const strings = (list, limit) =>
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || "").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, limit);

  return {
    fonts: strings(value.fonts, 12),
    colors: strings(value.colors, 16),
    backgrounds: strings(value.backgrounds, 12),
  };
}

async function canEdit(request, env) {
  if (canAdmin(request, env)) return true;
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.toLowerCase();
  if (!env.DB || !request.headers.get("oai-authenticated-user-id") || !email)
    return false;
  return Boolean(
    await env.DB.prepare("SELECT email FROM editorial_accounts WHERE email=?")
      .bind(email)
      .first(),
  );
}

function rssItemKey(item) {
  return legacyItemKey(item);
}

function rssItemToQueueInput(row) {
  return {
    id: Number(row.id),
    itemKey: row.item_key,
    link: row.link,
    title: row.title,
    summary: row.summary,
    content: row.content,
    image: row.image_url || row.image,
  };
}

function rssFeedId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function rssNow() {
  return new Date().toISOString();
}

// D1/SQLite store booleans as 0/1 while PostgreSQL expects real booleans.
function rssBoolean(DB, value) {
  return DB?.__postgres === true ? Boolean(value) : value ? 1 : 0;
}

function rssDuplicateError(error) {
  return /duplicate key|unique constraint/i.test(
    String(error?.message || error || ""),
  );
}

function rssInputUrl(input) {
  if (typeof input?.feed_url === "string") return input.feed_url.trim();
  if (typeof input?.url === "string") return input.url.trim();
  return "";
}

function rssItemResponse(item) {
  const style = rssStyle(item.style_json ?? item.style);
  const response = { ...item };
  delete response.style_json;

  return {
    ...response,
    id: Number(item.id),
    feed_id: Number(item.feed_id),
    imported_news_id: item.imported_news_id
      ? Number(item.imported_news_id)
      : null,
    imported: Boolean(item.imported_at),
    canonical_key: canonicalItemKey(item),
    style: style || { fonts: [], colors: [], backgrounds: [] },
  };
}

function rssFeedResponse(feed) {
  return {
    ...feed,
    id: Number(feed.id),
    is_active: Boolean(feed.is_active),
    auto_import: Boolean(feed.auto_import),
    total_items: Number(feed.total_items || 0),
    imported_items: Number(feed.imported_items || 0),
  };
}

async function rssPersistItems(DB, feedId, result) {
  const insertedItems = [];
  const seen = new Set();
  let inserted = 0;
  let updated = 0;

  for (const item of result.items || []) {
    const itemKey = rssItemKey(item);

    if (seen.has(itemKey)) continue;
    seen.add(itemKey);

    const style = normalizeRssStyle(item.style);
    const values = [
      item.guid || null,
      item.link || null,
      String(item.title || "").slice(0, 300),
      item.summary || "",
      item.content || "",
      item.image || "",
      item.author || "",
      item.publishedAt,
      style ? JSON.stringify(style) : null,
    ];

    const existing = await DB.prepare(
      "SELECT id FROM rss_items WHERE feed_id=? AND item_key=?",
    )
      .bind(feedId, itemKey)
      .first();

    if (existing) {
      await DB.prepare(
        `
        UPDATE rss_items
        SET guid=?,
            link=?,
            title=?,
            summary=?,
            content=?,
            image_url=?,
            author=?,
            published_at=?,
            style_json=?
        WHERE id=?
      `,
      )
        .bind(...values, existing.id)
        .run();

      updated++;
      continue;
    }

    const row = await DB.prepare(
      `
      INSERT INTO rss_items (
        feed_id,
        item_key,
        guid,
        link,
        title,
        summary,
        content,
        image_url,
        author,
        published_at,
        style_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (feed_id, item_key) DO NOTHING
      RETURNING id
    `,
    )
      .bind(feedId, itemKey, ...values, rssNow())
      .first();

    if (row) insertedItems.push({ id: Number(row.id), ...item, itemKey });
    inserted++;
  }

  // Novos itens entram no motor de ingestão em segundo plano. Falhas aqui
  // nunca impedem a coleta RSS; o item continua disponível no radar.
  let queued = 0;
  if (insertedItems.length) {
    try {
      queued = (
        await enqueueRssItems(DB, {
          feedId,
          feedName: String(result.title || ""),
          items: insertedItems,
        })
      ).enqueued;
    } catch (error) {
      console.error("Falha ao enfileirar itens RSS:", error?.message || error);
    }
  }

  return {
    inserted,
    updated,
    insertedItems,
    total: result.items?.length || 0,
    queued,
  };
}

async function rssTouchFeed(DB, feedId, result) {
  await DB.prepare(
    `
    UPDATE rss_feeds
    SET site_url=?,
        last_fetched_at=?,
        last_error=NULL,
        updated_at=?
    WHERE id=?
  `,
  )
    .bind(
      result.siteUrl || null,
      result.fetchedAt || rssNow(),
      rssNow(),
      feedId,
    )
    .run();
}

export function rssDraftInput(item, feed) {
  const rawTitle = String(item.title || "").trim().slice(0, 160);
  const title =
    rawTitle.length >= 5 ? rawTitle : `${rawTitle} — notícia RSS`.slice(0, 160);

  let summary = String(item.summary || item.content || "").trim();
  if (summary.length > 350) summary = `${summary.slice(0, 347).trimEnd()}...`;
  if (summary.length < 15) {
    summary = `${title} — matéria recebida de ${feed.name}.`.slice(0, 350);
  }

  let body = String(item.content || item.summary || "").trim().slice(0, 50000);
  if (body.length < 40) {
    body = `${body}\n\nNotícia recebida de ${feed.name}. Revise, complemente e confira a fonte antes de publicar.`.trim();
  }

  // Quando a fonte traz tipografia própria, preservamos as dicas no documento
  // rich para que o editor abra já com a fonte/cor detectadas.
  const style = rssStyle(item.style_json ?? item.style);
  const hasStyle = Boolean(
    style && (style.fonts.length || style.colors.length || style.backgrounds.length),
  );
  let bodyFormat = "plain";

  if (hasStyle) {
    try {
      body = JSON.stringify(
        VisionContent.validate(VisionContent.fromPlainStyled(body, style)),
      );
      bodyFormat = "rich-v1";
    } catch {
      style.colors.length = 0;
      style.backgrounds.length = 0;
      style.fonts.length = 0;
    }
  }

  const author = (
    String(item.author || "").trim() ||
    String(feed.name || "").trim() ||
    "Redação VisionNews"
  ).slice(0, 80);

  return {
    title,
    summary,
    body,
    category: "Notícias",
    author: author.length >= 2 ? author : "Redação VisionNews",
    // Itens recém-lidos do feed usam `image`; itens já persistidos usam
    // `image_url`. Os dois formatos precisam preencher a capa do rascunho.
    cover: VisionContent.https(item.image_url || item.image) || "",
    source_url: VisionContent.https(item.link) || "",
    source_label: String(feed.name || "Fonte RSS").slice(0, 120),
    status: "draft",
    body_format: bodyFormat,
    topic: "",
    tags: "",
    featured: false,
  };
}

async function rssCreateNewsDraft(DB, item, feed) {
  if (!String(item.title || "").trim()) {
    return { error: "O item RSS não possui título.", status: 422 };
  }

  const { errors, value } = validateNews(rssDraftInput(item, feed));

  if (errors.length) return { error: errors.join(" "), status: 422 };

  const now = rssNow();
  const subject = await DB.prepare(
    `
    INSERT INTO news (
      title,
      summary,
      body,
      category,
      author,
      cover,
      source_url,
      source_label,
      status,
      body_format,
      review_score,
      review_verdict,
      anime_title,
      topic,
      tags,
      featured,
      news_published_once,
      published_at,
      featured_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `,
  )
    .bind(
      value.title,
      value.summary,
      value.body,
      value.category,
      value.author,
      value.cover,
      value.source_url,
      value.source_label,
      value.status,
      value.body_format,
      value.review_score,
      value.review_verdict,
      value.anime_title,
      value.topic,
      value.tags,
      0,
      0,
      null,
      null,
      now,
      now,
    )
    .first();

  return { item: subject };
}

async function rssMarkImported(DB, rssItemId, newsId) {
  await DB.prepare(
    `
    UPDATE rss_items
    SET imported_at=?,
        imported_news_id=?
    WHERE id=?
  `,
  )
    .bind(rssNow(), newsId, rssItemId)
    .run();
}

// Optional automation: when a source is marked for automatic import, every
// newly fetched item becomes an editorial draft. Publication remains manual.
async function rssAutoImportNewItems(DB, feed, items) {
  if (!feed.auto_import || !items?.length) return 0;

  let imported = 0;

  for (const item of items.slice(0, 20)) {
    const draft = await rssCreateNewsDraft(DB, item, feed);

    if (draft.item) {
      await rssMarkImported(DB, item.id, draft.item.id);
      imported++;
    }
  }

  return imported;
}

// Rascunhos criados antes da correção da extração de imagens ficaram sem capa.
// Ao atualizar o feed, preenchemos somente as capas vazias dos rascunhos
// vinculados a itens daquela fonte, sem sobrescrever escolhas editoriais.
async function rssSyncDraftCovers(DB, feedId) {
  const result = await DB.prepare(
    `
    UPDATE news
    SET cover=(
          SELECT i.image_url
          FROM rss_items i
          WHERE i.imported_news_id=news.id
            AND i.image_url IS NOT NULL
            AND i.image_url<>''
          ORDER BY i.id DESC
          LIMIT 1
        ),
        updated_at=?
    WHERE status='draft'
      AND (cover IS NULL OR cover='')
      AND EXISTS (
        SELECT 1
        FROM rss_items i
        INNER JOIN rss_feeds f ON f.id=i.feed_id
        WHERE i.imported_news_id=news.id
          AND f.id=?
          AND i.image_url IS NOT NULL
          AND i.image_url<>''
      )
  `,
  )
    .bind(rssNow(), feedId)
    .run();

  return Number(result?.meta?.changes || 0);
}

async function refreshRssFeed(DB, feedId, prefetched = null) {
  const feed = await DB.prepare("SELECT * FROM rss_feeds WHERE id=?")
    .bind(feedId)
    .first();

  if (!feed) {
    return { error: "Fonte RSS não encontrada.", status: 404 };
  }

  if (!feed.is_active) {
    return { error: "Esta fonte está desativada.", status: 422 };
  }

  try {
    const result = prefetched || (await fetchAndParseFeed(feed.feed_url));
    const persisted = await rssPersistItems(DB, feedId, result);

    await rssTouchFeed(DB, feedId, {
      ...result,
      siteUrl: result.siteUrl || feed.site_url,
    });

    const autoImported = await rssAutoImportNewItems(
      DB,
      feed,
      persisted.insertedItems,
    );
    const coversUpdated = await rssSyncDraftCovers(DB, feedId);

    return {
      ok: true,
      feedId,
      feedTitle: result.title,
      format: result.format,
      total: persisted.total,
      inserted: persisted.inserted,
      updated: persisted.updated,
      queued: persisted.queued || 0,
      autoImported,
      coversUpdated,
      fetchedAt: result.fetchedAt || rssNow(),
    };
  } catch (error) {
    await DB.prepare(
      `
      UPDATE rss_feeds
      SET last_error=?,
          updated_at=?
      WHERE id=?
    `,
    )
      .bind(
        String(error.message || "Erro ao consultar feed").slice(0, 500),
        rssNow(),
        feedId,
      )
      .run();

    return {
      error: error.message || "Não foi possível atualizar o feed.",
      status: 422,
    };
  }
}

export function validateRecommendation(input) {
  const errors = [];
  const feature_date = text(input, "feature_date", 10, 10, errors);
  const date = new Date(feature_date + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(feature_date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== feature_date
  )
    errors.push("Informe uma data válida.");
  const title = text(input, "title", 2, 160, errors);
  const summary = text(input, "summary", 15, 600, errors);
  const cover = validUrl(input, "cover", errors);
  const status = statuses.includes(input.status) ? input.status : null;
  if (!status) errors.push("Status inválido.");
  const streams = [];
  if (!Array.isArray(input.streams) || input.streams.length > 5) {
    errors.push("Informe até cinco plataformas.");
  } else {
    for (const stream of input.streams) {
      if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
        errors.push("Plataforma inválida.");
        continue;
      }
      const name = text(stream, "name", 2, 60, errors);
      const url = validUrl(stream, "url", errors);
      if (!url) errors.push("Informe o link oficial de cada plataforma.");
      streams.push({ name, url });
    }
  }
  if (status === "published" && !streams.length)
    errors.push("Cadastre pelo menos um streaming oficial para publicar.");
  return {
    errors,
    value: {
      feature_date,
      title,
      summary,
      cover,
      streams: JSON.stringify(streams),
      status,
    },
  };
}

function json(value, status = 200) {
  return securityHeaders(
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
}
export function canAdmin(request, env) {
  const id = request.headers.get("oai-authenticated-user-id"),
    email = request.headers.get("oai-authenticated-user-email");
  return Boolean(
    env.ADMIN_EMAIL &&
    id &&
    email &&
    email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase(),
  );
}
function text(input, key, min, max, errors) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (value.length < min || value.length > max)
    errors.push(`${key}: use entre ${min} e ${max} caracteres.`);
  return value;
}
function validUrl(input, key, errors) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) return "";
  const result = VisionContent.https(value);
  if (!result) errors.push(`${key}: informe um endereço HTTPS válido.`);
  return result;
}
export function validateNews(input) {
  const errors = [];
  const title = text(input, "title", 5, 160, errors),
    summary = text(input, "summary", 15, 350, errors),
    author = text(input, "author", 2, 80, errors);
  const category = categories.includes(input.category) ? input.category : null,
    status = statuses.includes(input.status) ? input.status : null;
  if (!category) errors.push("Categoria inválida.");
  if (!status) errors.push("Status inválido.");
  const body_format = input.body_format || "plain";
  let body = typeof input.body === "string" ? input.body : "";
  if (body_format === "rich-v1") {
    try {
      if (body.length > 800000) throw Error("Conteúdo grande demais.");
      const doc = VisionContent.validate(JSON.parse(body));
      const length = VisionContent.plain(doc).trim().length;
      if (length < 40)
        errors.push("O conteúdo precisa de ao menos 40 caracteres.");
      body = JSON.stringify(doc);
    } catch (e) {
      errors.push(e.message);
    }
  } else if (body_format === "plain") {
    body = body.trim();
    if (body.length < 40 || body.length > 50000)
      errors.push("O conteúdo deve ter entre 40 e 50.000 caracteres.");
  } else errors.push("Formato de conteúdo inválido.");
  const cover = validUrl(input, "cover", errors),
    source_url = validUrl(input, "source_url", errors),
    source_label = text(input, "source_label", 0, 120, errors),
    anime_title = text(input, "anime_title", 0, 160, errors),
    review_verdict = text(input, "review_verdict", 0, 400, errors);
  const topic = text(input, "topic", 0, 60, errors);
  const featured = input.featured === true;
  if (featured && category !== "Notícias")
    errors.push("Apenas notícias podem ser o destaque principal.");
  const tags = [
    ...new Set(
      text(input, "tags", 0, 400, errors)
        .split(",")
        .map((tag) => tag.trim().toLocaleLowerCase("pt-BR"))
        .filter(Boolean),
    ),
  ];
  if (tags.length > 10 || tags.some((tag) => tag.length > 36))
    errors.push("Use até 10 tags de até 36 caracteres cada.");
  let review_score = null;
  if (
    input.review_score !== "" &&
    input.review_score !== null &&
    input.review_score !== undefined
  ) {
    if (
      typeof input.review_score !== "number" ||
      !Number.isFinite(input.review_score) ||
      input.review_score < 0 ||
      input.review_score > 10
    )
      errors.push("A nota deve ser um número de 0 a 10.");
    else review_score = Math.round(input.review_score * 10) / 10;
  }
  if (status === "published" && category === "Notícias" && !source_url)
    errors.push("Notícias publicadas precisam de uma fonte oficial.");
  if (category === "Reviews" && status === "published" && !anime_title)
    errors.push("Informe o anime avaliado na review.");
  return {
    errors,
    value: {
      title,
      summary,
      body,
      author,
      category,
      status,
      cover,
      source_url,
      source_label,
      body_format,
      review_score,
      review_verdict,
      anime_title,
      topic,
      featured,
      tags: tags.join(", "),
    },
  };
}
export function validateSchedule(input) {
  const errors = [];
  const title = text(input, "title", 2, 160, errors),
    summary = text(input, "summary", 0, 500, errors),
    episode = text(input, "episode", 0, 60, errors),
    time = text(input, "time", 0, 5, errors);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    errors.push("Horário inválido. Use HH:mm de Brasília.");
  const weekday = input.weekday,
    season_year = input.season_year,
    season_quarter = input.season_quarter;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    errors.push("Dia da semana inválido.");
  if (
    !Number.isInteger(season_year) ||
    season_year < 2020 ||
    season_year > 2100
  )
    errors.push("Ano inválido.");
  if (
    !Number.isInteger(season_quarter) ||
    season_quarter < 1 ||
    season_quarter > 4
  )
    errors.push("Temporada inválida.");
  const platform = platforms.includes(input.platform) ? input.platform : null,
    language = ["Legendado", "Dublado", "TV aberta"].includes(input.language)
      ? input.language
      : null,
    status = statuses.includes(input.status) ? input.status : null;
  if (!platform) errors.push("Plataforma inválida.");
  if (!language) errors.push("Idioma/formato inválido.");
  if (!status) errors.push("Status inválido.");
  const official_url = validUrl(input, "official_url", errors),
    cover = validUrl(input, "cover", errors);
  if (status === "published" && !official_url)
    errors.push("Informe o link oficial antes de publicar a exibição.");
  return {
    errors,
    value: {
      title,
      summary,
      weekday,
      time,
      platform,
      official_url,
      language,
      season_year,
      season_quarter,
      cover,
      episode,
      status,
    },
  };
}
async function bodyJson(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 1200000)
    throw Error();
  const raw = await request.text();
  if (raw.length > 1200000) throw Error();
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error();
  return value;
}
function securityHeaders(response) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://fonts.grida.co https://raw.githubusercontent.com; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
);
  return response;
}
/**
 * Public aliases for the RSS API. They keep the dedicated /api/rss/*
 * entrypoints (used by the Vercel functions in api/rss) aligned with the
 * canonical editorial routes handled by the Worker.
 */
function mapRssAlias(path) {
  if (path === "/api/rss/sources") return "/api/editor/rss-feeds";
  if (path === "/api/rss/fetch") return "/api/editor/rss/refresh";

  let match = path.match(/^\/api\/rss\/sources\/([1-9]\d*)$/);
  if (match) return `/api/editor/rss-feeds/${match[1]}`;

  match = path.match(/^\/api\/rss\/fetch\/([1-9]\d*)$/);
  if (match) return `/api/editor/rss-feeds/${match[1]}/refresh`;

  if (path === "/api/rss/articles") return "/api/editor/rss-items";

  match = path.match(
    /^\/api\/rss\/articles\/([1-9]\d*)(\/imported|\/import)?$/,
  );
  if (match) return `/api/editor/rss-items/${match[1]}${match[2] || ""}`;

  return path;
}


function prepareNewsTranslation(news) {
  const texts = [];
  const setters = new Map();

  const translated = {
    title: news.title,
    summary: news.summary,
    topic: news.topic,
    body: news.body,
  };

  function addText(key, value, setter) {
    if (typeof value !== "string" || !value.trim()) return;

    const id = `${news.id}:${key}`;

    texts.push({ id, text: value });
    setters.set(id, setter);
  }

  addText("title", news.title, (value) => {
    translated.title = value;
  });

  addText("summary", news.summary, (value) => {
    translated.summary = value;
  });

  addText("topic", news.topic, (value) => {
    translated.topic = value;
  });

  if (news.body_format === "rich-v1") {
    let document;

    try {
      document = VisionContent.validate(JSON.parse(news.body || ""));
    } catch {
      throw new Error(
        `O conteúdo da notícia ${news.id} possui um documento rich-v1 inválido.`,
      );
    }

    translated.body = document;

    document.blocks.forEach((block, blockIndex) => {
      function collectInline(nodes, prefix) {
        nodes.forEach((node, nodeIndex) => {
          // Imagens não são enviadas para tradução.
          if (node.image !== undefined) return;

          if (typeof node.text !== "string") return;

          addText(
            `body:${prefix}:${nodeIndex}`,
            node.text,
            (value) => {
              node.text = value;
            },
          );
        });
      }

      if (block.type === "ul" || block.type === "ol") {
        block.items.forEach((item, itemIndex) => {
          collectInline(
            item,
            `${blockIndex}:item:${itemIndex}`,
          );
        });
      } else {
        collectInline(
          block.children,
          `${blockIndex}:children`,
        );
      }
    });
  } else {
    addText("body", news.body, (value) => {
      translated.body = value;
    });
  }

  return {
    texts,

    build(translations) {
      for (const item of translations) {
        const setter = setters.get(item.id);

        if (!setter) {
          throw new Error("Foi recebida uma tradução desconhecida.");
        }

        setter(item.text);
      }

      return {
        title: translated.title,
        summary: translated.summary,
        topic: translated.topic,
        body:
          news.body_format === "rich-v1"
            ? JSON.stringify(translated.body)
            : translated.body,
      };
    },
  };
}


export async function handle(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    routePath = mapRssAlias(path);
  try {
    if (path === "/api/health") {
      const ai = aiStatus(env);
      return json({
        ok: true,
        database: Boolean(env.DB),
        translation: {
          provider: ai.translation.provider,
          configured: ai.translation.configured,
        },
        ai,
      });
    }
    if (
      path === "/api/cron/pipeline" &&
      ["GET", "POST"].includes(request.method)
    ) {
      const secret = String(env.CRON_SECRET || "").trim();
      const provided = String(request.headers.get("authorization") || "")
        .replace(/^Bearer\s+/i, "")
        .trim();

      if (!secret || provided !== secret) {
        return json({ error: "Não autorizado." }, 401);
      }

      const limit = Math.min(
        20,
        Math.max(1, Number(url.searchParams.get("limit")) || 5),
      );

      return json(
        await processQueueItems(env.DB, env, { limit }),
      );
    }
    if (path === "/api/fonts/catalog" && request.method === "GET") {
      try {
        const catalog = await fontCatalogData();
        return json(catalog);
      } catch (error) {
        return json(
          { error: "Catálogo de fontes indisponível.", detail: String(error?.message || "") },
          503,
        );
      }
    }
    const privatePage = path.match(
      /^\/(admin|dashboard)(?:\/index\.html|\/)?$/,
    )?.[1];
    const rssPage = /^\/(?:rss|rss\.html|rss\/index\.html)\/?$/.test(path);
    const adminRssPage = /^\/admin\/rss(?:\.html|\/index\.html)?\/?$/.test(
      path,
    );
    const adminUsersPage = /^\/admin\/(?:usuarios|users)(?:\.html|\/index\.html)?\/?$/.test(
      path,
    );

    if (
      (privatePage || rssPage || adminRssPage || adminUsersPage) &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      const target = rssPage
        ? "/rss"
        : adminRssPage
          ? "/admin/rss"
          : adminUsersPage
            ? "/admin/usuarios"
            : "/" + privatePage;

      if (!request.headers.get("oai-authenticated-user-id")) {
        const login = new URL(
          env.SIGN_IN_PATH || "/signin-with-chatgpt",
          url.origin,
        );
        login.searchParams.set(env.SIGN_IN_PATH ? "next" : "return_to", target);
        return Response.redirect(login, 302);
      }

      const adminOnly = adminRssPage || adminUsersPage || privatePage === "admin";

      if (!(adminOnly ? canAdmin(request, env) : await canEdit(request, env)))
        return json({ error: "Acesso restrito a esta área." }, 403);

      return serve(
        rssPage
          ? "/rss.html"
          : adminRssPage
            ? "/admin/rss.html"
            : adminUsersPage
              ? "/admin/usuarios.html"
              : target + "/index.html",
        request.method === "HEAD",
        env.ASSETS,
      );
    }
    if (path === "/api/recommendation" && request.method === "GET") {
      if (!env.DB)
        return json(
          { error: "Recomendação temporariamente indisponível." },
          503,
        );
      const date = todayInBrasilia();
      const item = await env.DB.prepare(
        "SELECT feature_date,title,summary,cover,streams FROM recommendations WHERE status='published' AND feature_date=?",
      )
        .bind(date)
        .first();
      return json({
        date,
        item: item ? { ...item, streams: JSON.parse(item.streams) } : null,
      });
    }
    if (path === "/api/news" && request.method === "GET") {
      if (!env.DB)
        return json({ error: "Redação temporariamente indisponível." }, 503);
      const { results } = await env.DB.prepare(
        `SELECT id,title,summary,body,body_format,category,author,cover,source_url,source_label,review_score,review_verdict,anime_title,topic,tags,published_at,updated_at,featured_at
  FROM news WHERE status='published' ORDER BY published_at DESC,id DESC LIMIT 200`,
      ).all();
      const featured = await env.DB.prepare(
        "SELECT id,status,featured FROM news WHERE featured_at IS NOT NULL ORDER BY featured_at DESC,id DESC LIMIT 1",
      ).first();
      const firstNews = await env.DB.prepare(
        "SELECT id FROM news WHERE news_published_once=1 OR (category='Notícias' AND published_at IS NOT NULL) LIMIT 1",
      ).first();
      const featuredId =
        featured?.status === "published" && featured.featured === 1
          ? featured.id
          : null;
      if (featuredId && !results.some((item) => item.id === featuredId)) {
        const item = await env.DB.prepare(
          "SELECT id,title,summary,body,body_format,category,author,cover,source_url,source_label,review_score,review_verdict,anime_title,topic,tags,published_at,updated_at,featured_at FROM news WHERE id=? AND status='published'",
        )
          .bind(featuredId)
          .first();
        if (item) results.push(item);
      }
      return json({ items: results, demo: !firstNews, featuredId });
    }
    if (path === "/api/schedule" && request.method === "GET") {
      if (!env.DB)
        return json({ error: "Calendário temporariamente indisponível." }, 503);
      const now = new Date(),
        year = Number(
          url.searchParams.get("year") ||
            new Intl.DateTimeFormat("en-US", {
              year: "numeric",
              timeZone: "America/Sao_Paulo",
            }).format(now),
        ),
        quarter = Number(
          url.searchParams.get("quarter") ||
            Math.ceil(
              Number(
                new Intl.DateTimeFormat("en-US", {
                  month: "numeric",
                  timeZone: "America/Sao_Paulo",
                }).format(now),
              ) / 3,
            ),
        );
      if (
        !Number.isInteger(year) ||
        year < 2020 ||
        year > 2100 ||
        !Number.isInteger(quarter) ||
        quarter < 1 ||
        quarter > 4
      )
        return json({ error: "Temporada inválida." }, 422);
      const { results } = await env.DB.prepare(
        "SELECT id,title,summary,weekday,time,platform,official_url,language,season_year,season_quarter,cover,episode,updated_at FROM schedule WHERE status='published' AND season_year=? AND season_quarter=? ORDER BY weekday,time,id LIMIT 500",
      )
        .bind(year, quarter)
        .all();
      return json({ items: results, year, quarter });
    }
    if (
      routePath.startsWith("/api/admin/") ||
      routePath.startsWith("/api/editor/")
    ) {
      const adminRoute = routePath.startsWith("/api/admin/");
      if (!(adminRoute ? canAdmin(request, env) : await canEdit(request, env)))
        return json(
          { error: "Acesso restrito à administração." },
          request.headers.get("oai-authenticated-user-id") ? 403 : 401,
        );
      if (path === "/api/admin/session" && request.method === "GET")
        return json({ authorized: true });
      if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
      const contentType = request.headers.get("Content-Type") || "";
      if (
        !["GET", "HEAD"].includes(request.method) &&
        (request.headers.get("Origin") !== url.origin ||
          (contentType && !contentType.startsWith("application/json")) ||
          request.headers.get("Sec-Fetch-Site") === "cross-site")
      )
        return json({ error: "Origem da solicitação não permitida." }, 403);


if (
  path === "/api/editor/news/translate-preview" &&
  request.method === "POST"
) {
  try {
    const input = await bodyJson(request);

    const ids = input?.ids;
    const versions = input?.versions;

    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 5 ||
      !ids.every(
        (id) => Number.isSafeInteger(id) && id > 0,
      ) ||
      new Set(ids).size !== ids.length ||
      !versions ||
      typeof versions !== "object" ||
      Array.isArray(versions)
    ) {
      return json(
        { error: "Selecione entre 1 e 5 notícias válidas." },
        400,
      );
    }

    // Cada notícia precisa ter a versão que estava aberta
    // no momento em que foi selecionada.
    for (const id of ids) {
      if (
        !Object.hasOwn(versions, String(id)) ||
        !Number.isSafeInteger(versions[String(id)]) ||
        versions[String(id)] < 1
      ) {
        return json(
          {
            error: `A versão da notícia ${id} não foi informada corretamente.`,
          },
          400,
        );
      }
    }

    const placeholders = ids.map(() => "?").join(",");

    const { results: newsRows } = await env.DB.prepare(
      `SELECT * FROM news WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all();

    if (!Array.isArray(newsRows) || newsRows.length !== ids.length) {
      return json(
        {
          error: "Uma ou mais notícias selecionadas não foram encontradas.",
        },
        404,
      );
    }

    const newsById = new Map(
      newsRows.map((news) => [Number(news.id), news]),
    );

    const selectedNews = ids.map((id) => newsById.get(id));

    // A operação inteira é rejeitada se houver uma notícia
    // que não seja rascunho ou esteja em outra versão.
    for (const news of selectedNews) {
      if (news.status !== "draft") {
        return json(
          {
            error: `A notícia ${news.id} não é um rascunho. Nenhuma tradução foi realizada.`,
          },
          409,
        );
      }

      if (news.version !== versions[String(news.id)]) {
        return json(
          {
            error: `A notícia ${news.id} foi modificada. Atualize a página antes de traduzir.`,
          },
          409,
        );
      }
    }

    const prepared = selectedNews.map((news) => ({
      news,
      translation: prepareNewsTranslation(news),
    }));

    const allTexts = prepared.flatMap(
      (item) => item.translation.texts,
    );

    if (!allTexts.length) {
      return json(
        { error: "Não existem textos disponíveis para tradução." },
        400,
      );
    }

    if (allTexts.length > 500) {
      return json(
        {
          error: "A seleção contém muitos trechos de texto. Divida a tradução em lotes menores.",
        },
        413,
      );
    }

    const totalCharacters = allTexts.reduce(
      (total, item) => total + item.text.length,
      0,
    );

    if (totalCharacters > 70000) {
      return json(
        {
          error: "O conteúdo selecionado excede o limite de caracteres para tradução.",
        },
        413,
      );
    }

    if (!hasDeepL(env) && !hasOpenRouter(env)) {
      return json(
        {
          error:
            "Configure DEEPL_API_KEY/DEEPL_AUTH_KEY ou OPENROUTER_API_KEY no servidor.",
        },
        503,
      );
    }
    // A tradução acontece somente em memória.
    const translations = await translateWithProvider(allTexts, env);

    const translatedById = new Map(
      translations.map((item) => [item.id, item]),
    );

    const previews = prepared.map(({ news, translation }) => {
      const translatedTexts = translation.texts.map((item) => {
        const result = translatedById.get(item.id);

        if (!result) {
          throw new Error(
            `A tradução do trecho ${item.id} não foi encontrada.`,
          );
        }

        return result;
      });

      const translated = translation.build(translatedTexts);

      return {
        id: news.id,
        version: news.version,
        body_format: news.body_format || "plain",

        original: {
          title: news.title,
          summary: news.summary,
          topic: news.topic,
          body: news.body,
        },

        translated,
      };
    });

    // Consulta novamente o banco depois da tradução.
    // Isso impede que uma prévia baseada em conteúdo antigo
    // seja apresentada como se ainda estivesse atualizada.
    const { results: latestRows } = await env.DB.prepare(
      `SELECT id, status, version FROM news WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all();

    const latestById = new Map(
      (latestRows || []).map((news) => [
        Number(news.id),
        news,
      ]),
    );

    const conflicts = ids.filter((id) => {
      const latest = latestById.get(id);
      const original = newsById.get(id);

      return (
        !latest ||
        latest.status !== "draft" ||
        latest.version !== original.version
      );
    });

    if (conflicts.length) {
      return json(
        {
          error: "Uma ou mais notícias foram modificadas durante a tradução. Gere uma nova prévia.",
          conflicts,
        },
        409,
      );
    }

    return json({
      success: true,
      message: "Tradução concluída. Revise a prévia antes de salvar.",
      items: previews,
    });
  } catch (error) {
  console.error("Erro ao traduzir notícias:", error);

  return json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível traduzir as notícias.",
    },
    502,
  );
}
}


      // ========================================
      // ANILIST / ANICHART - SUGESTÕES E TEMPORADA
      // ========================================

      if (path === "/api/editor/anime/trending" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 12);

        if (!Number.isInteger(limit) || limit < 1 || limit > 25)
          return json({ error: "Informe um limite entre 1 e 25." }, 422);

        try {
          return json({ items: await fetchTrendingAnime(limit) });
        } catch (error) {
          return json(
            {
              error: `Não foi possível consultar o AniList agora. ${
                error?.message || "Tente novamente."
              }`,
            },
            502,
          );
        }
      }

      if (path === "/api/editor/anime/season" && request.method === "GET") {
        const year = Number(url.searchParams.get("year"));
        const quarter = Number(url.searchParams.get("quarter"));

        if (!Number.isInteger(year) || year < 2020 || year > 2100)
          return json({ error: "Informe um ano válido." }, 422);
        if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4)
          return json({ error: "Informe uma temporada válida." }, 422);

        try {
          const items = await fetchSeasonSchedule({
            year,
            quarter,
            maxPages: 3,
          });
          const { results } = await env.DB.prepare(
            `SELECT title, official_url
             FROM schedule
             WHERE season_year=? AND season_quarter=?`,
          )
            .bind(year, quarter)
            .all();
          const existingTitles = new Set(
            results.map((item) => String(item.title || "").trim().toLowerCase()),
          );
          const existingUrls = new Set(
            results
              .map((item) => String(item.official_url || "").trim())
              .filter(Boolean),
          );

          return json({
            year,
            quarter,
            season: seasonFromQuarter(quarter),
            items: items.map((item) => ({
              ...item,
              imported:
                existingTitles.has(item.title.toLowerCase()) ||
                Boolean(item.official_url && existingUrls.has(item.official_url)),
            })),
          });
        } catch (error) {
          return json(
            {
              error: `Não foi possível carregar a temporada no AniList. ${
                error?.message || "Tente novamente."
              }`,
            },
            502,
          );
        }
      }

      if (
        path === "/api/editor/anime/season/import" &&
        request.method === "POST"
      ) {
        let input;
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido ou grande demais." }, 400);
        }

        const year = Number(input.year);
        const quarter = Number(input.quarter);
        const ids = [
          ...new Set(
            (Array.isArray(input.ids) ? input.ids : [])
              .map((value) => String(value))
              .filter(Boolean),
          ),
        ].slice(0, 200);

        if (!Number.isInteger(year) || year < 2020 || year > 2100)
          return json({ error: "Informe um ano válido." }, 422);
        if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4)
          return json({ error: "Informe uma temporada válida." }, 422);
        if (!ids.length)
          return json(
            { error: "Selecione ao menos um anime para importar." },
            422,
          );

        try {
          const candidates = await fetchSeasonSchedule({
            year,
            quarter,
            maxPages: 3,
          });
          const selected = candidates.filter((item) =>
            ids.includes(item.anime_id),
          );

          const { results } = await env.DB.prepare(
            `SELECT title, official_url
             FROM schedule
             WHERE season_year=? AND season_quarter=?`,
          )
            .bind(year, quarter)
            .all();
          const existingTitles = new Set(
            results.map((item) => String(item.title || "").trim().toLowerCase()),
          );
          const existingUrls = new Set(
            results
              .map((item) => String(item.official_url || "").trim())
              .filter(Boolean),
          );

          const now = new Date().toISOString();
          const created = [];
          const skipped = [];
          const seen = new Set(selected.map((item) => item.anime_id));

          for (const id of ids)
            if (!seen.has(id))
              skipped.push({
                id,
                title: "",
                reason:
                  "Título sem exibição semanal confirmada no AniList ou fora das páginas consultadas.",
              });

          for (const candidate of selected) {
            const titleKey = candidate.title.trim().toLowerCase();

            if (
              existingTitles.has(titleKey) ||
              (candidate.official_url &&
                existingUrls.has(candidate.official_url))
            ) {
              skipped.push({
                id: candidate.anime_id,
                title: candidate.title,
                reason: "Já está no calendário desta temporada.",
              });
              continue;
            }

            const { errors, value } = validateSchedule({
              ...candidate,
              status: "draft",
            });

            if (errors.length) {
              skipped.push({
                id: candidate.anime_id,
                title: candidate.title,
                reason: errors.join(" "),
              });
              continue;
            }

            const result = await env.DB.prepare(
              `INSERT INTO schedule (${scheduleColumns.join(
                ",",
              )},created_at,updated_at) VALUES (${scheduleColumns
                .map(() => "?")
                .join(",")},?,?)`,
            )
              .bind(
                ...scheduleColumns.map((column) => value[column]),
                now,
                now,
              )
              .run();

            existingTitles.add(titleKey);
            if (value.official_url) existingUrls.add(value.official_url);
            created.push({
              id: Number(result?.meta?.last_row_id) || null,
              title: value.title,
            });
          }

          return json({ ok: true, created, skipped });
        } catch (error) {
          return json(
            {
              error: `Não foi possível importar a temporada. ${
                error?.message || "Tente novamente."
              }`,
            },
            502,
          );
        }
      }

      if (path === "/api/admin/overview" && request.method === "GET") {
        const counts = await Promise.all(
          Object.keys(editorialTables).map(async (table) => {
            const { results } = await env.DB.prepare(
              `SELECT status,COUNT(*) AS total FROM ${table} GROUP BY status`,
            ).all();
            return [
              table,
              Object.fromEntries(results.map((row) => [row.status, row.total])),
            ];
          }),
        );
        const { results: editors } = await env.DB.prepare(
          "SELECT email FROM editorial_accounts ORDER BY email",
        ).all();
        return json({
          counts: Object.fromEntries(counts),
          editors: editors.map((account) => account.email),
          database: "online",
          timezone: "America/Sao_Paulo",
        });
      }

      if (path === "/api/admin/users" && request.method === "GET") {
        const adminEmail = (env.ADMIN_EMAIL || "").toLowerCase().trim();
        let editorRows = [];
        try {
          const res = await env.DB.prepare(
            "SELECT email, created_at FROM editorial_accounts ORDER BY email",
          ).all();
          editorRows = res?.results || [];
        } catch {
          editorRows = [];
        }

        const editorMap = new Map();
        for (const row of editorRows) {
          if (row?.email) {
            editorMap.set(row.email.toLowerCase().trim(), row.created_at);
          }
        }

        let userRows = [];
        try {
          const isPostgres = env.DB?.__postgres === true;
          const userTable = isPostgres ? '"user"' : 'user';
          const { results } = await env.DB.prepare(
            `SELECT id, name, email, "emailVerified", image, "createdAt" FROM ${userTable} ORDER BY "createdAt" DESC LIMIT 500`,
          ).all();
          userRows = results || [];
        } catch {
          try {
            const { results } = await env.DB.prepare(
              "SELECT id, name, email, emailVerified, image, createdAt FROM user ORDER BY createdAt DESC LIMIT 500",
            ).all();
            userRows = results || [];
          } catch {
            userRows = [];
          }
        }

        const knownEmails = new Set();
        const users = [];

        for (const u of userRows) {
          const email = String(u.email || "").toLowerCase().trim();
          if (!email) continue;
          knownEmails.add(email);
          const isAdmin = Boolean(adminEmail && email === adminEmail);
          const isEditor = editorMap.has(email);
          users.push({
            id: u.id,
            name: u.name || email.split("@")[0],
            email,
            emailVerified: Boolean(u.emailVerified ?? u["emailVerified"]),
            image: u.image || null,
            createdAt: u.createdAt || u["createdAt"] || null,
            role: isAdmin ? "admin" : isEditor ? "editor" : "user",
          });
        }

        if (adminEmail && !knownEmails.has(adminEmail)) {
          users.unshift({
            id: "admin-root",
            name: "Administrador Geral",
            email: adminEmail,
            emailVerified: true,
            image: null,
            createdAt: new Date().toISOString(),
            role: "admin",
          });
          knownEmails.add(adminEmail);
        }

        for (const [editorEmail, createdAt] of editorMap.entries()) {
          if (!knownEmails.has(editorEmail)) {
            users.push({
              id: "editor-" + editorEmail,
              name: editorEmail.split("@")[0],
              email: editorEmail,
              emailVerified: false,
              image: null,
              createdAt: createdAt || new Date().toISOString(),
              role: editorEmail === adminEmail ? "admin" : "editor",
            });
            knownEmails.add(editorEmail);
          }
        }

        const stats = {
          total: users.length,
          admins: users.filter((u) => u.role === "admin").length,
          editors: users.filter((u) => u.role === "editor").length,
          readers: users.filter((u) => u.role === "user").length,
          verified: users.filter((u) => u.emailVerified).length,
        };

        return json({ users, stats });
      }

      // ========================================
      // RSS - FONTES
      // ========================================

      if (routePath === "/api/editor/rss-feeds" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `
          SELECT
            f.*,
            (SELECT COUNT(*) FROM rss_items i WHERE i.feed_id = f.id) AS total_items,
            (SELECT COUNT(*) FROM rss_items i WHERE i.feed_id = f.id AND i.imported_at IS NOT NULL) AS imported_items
          FROM rss_feeds f
          ORDER BY f.name ASC, f.id ASC
        `,
        ).all();

        return json({ items: results.map(rssFeedResponse) });
      }

      if (routePath === "/api/editor/rss-feeds" && request.method === "POST") {
        let input;

        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }

        const name =
          typeof input.name === "string" ? input.name.trim() : "";
        const feedUrl = rssInputUrl(input);
        const autoImport = input.auto_import === true;

        if (name.length < 2 || name.length > 120) {
          return json(
            { error: "O nome deve ter entre 2 e 120 caracteres." },
            422,
          );
        }

        if (!feedUrl || feedUrl.length > 2048) {
          return json({ error: "Informe uma URL válida para o feed." }, 422);
        }

        try {
          const result = await fetchAndParseFeed(feedUrl);
          const now = rssNow();

          const feed = await env.DB.prepare(
            `
            INSERT INTO rss_feeds (
              name,
              feed_url,
              site_url,
              is_active,
              auto_import,
              last_fetched_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *
          `,
          )
            .bind(
              name,
              result.requestedUrl,
              result.siteUrl || null,
              rssBoolean(env.DB, true),
              rssBoolean(env.DB, autoImport),
              now,
              now,
              now,
            )
            .first();

          const feedId = Number(feed.id);
          const persisted = await rssPersistItems(env.DB, feedId, result);

          await rssTouchFeed(env.DB, feedId, result);

          const autoImported = await rssAutoImportNewItems(
            env.DB,
            { ...feed, auto_import: autoImport },
            persisted.insertedItems,
          );

          return json(
            {
              item: rssFeedResponse({
                ...feed,
                total_items: persisted.inserted,
                imported_items: autoImported,
              }),
              preview: {
                format: result.format,
                title: result.title,
                siteUrl: result.siteUrl,
                total: result.items.length,
              },
              inserted: persisted.inserted,
              updated: persisted.updated,
              queued: persisted.queued || 0,
              autoImported,
            },
            201,
          );
        } catch (error) {
          if (rssDuplicateError(error)) {
            return json(
              { error: "Esta fonte RSS já está cadastrada." },
              409,
            );
          }

          return json(
            {
              error:
                error.message || "Não foi possível cadastrar o feed.",
            },
            422,
          );
        }
      }

      const rssFeedMatch = routePath.match(
        /^\/api\/editor\/rss-feeds\/([1-9]\d*)$/,
      );

      if (
        rssFeedMatch &&
        ["PUT", "DELETE"].includes(request.method)
      ) {
        const id = rssFeedId(rssFeedMatch[1]);

        if (!id) return json({ error: "Identificador inválido." }, 422);

        const existing = await env.DB.prepare(
          "SELECT * FROM rss_feeds WHERE id=?",
        )
          .bind(id)
          .first();

        if (!existing) {
          return json({ error: "Fonte RSS não encontrada." }, 404);
        }

        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM rss_feeds WHERE id=?")
            .bind(id)
            .run();

          return json({ ok: true });
        }

        let input;

        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }

        const name =
          typeof input.name === "string" && input.name.trim()
            ? input.name.trim()
            : existing.name;
        const isActive =
          typeof input.is_active === "boolean"
            ? input.is_active
            : Boolean(existing.is_active);
        const autoImport =
          typeof input.auto_import === "boolean"
            ? input.auto_import
            : Boolean(existing.auto_import);

        if (name.length < 2 || name.length > 120) {
          return json({ error: "Nome inválido." }, 422);
        }

        let feedUrl = existing.feed_url;
        const feedUrlInput = rssInputUrl(input);

        if (feedUrlInput && feedUrlInput !== existing.feed_url) {
          try {
            feedUrl = await validateFeedUrl(feedUrlInput);
          } catch (error) {
            return json(
              {
                error:
                  error.message || "Informe uma URL válida para o feed.",
              },
              422,
            );
          }
        }

        const duplicate = await env.DB.prepare(
          "SELECT id FROM rss_feeds WHERE feed_url=? AND id<>?",
        )
          .bind(feedUrl, id)
          .first();

        if (duplicate) {
          return json(
            { error: "Já existe uma fonte cadastrada com esta URL." },
            409,
          );
        }

        await env.DB.prepare(
          `
          UPDATE rss_feeds
          SET name=?,
              feed_url=?,
              is_active=?,
              auto_import=?,
              updated_at=?
          WHERE id=?
        `,
        )
          .bind(
            name,
            feedUrl,
            rssBoolean(env.DB, isActive),
            rssBoolean(env.DB, autoImport),
            rssNow(),
            id,
          )
          .run();

        const item = await env.DB.prepare(
          "SELECT * FROM rss_feeds WHERE id=?",
        )
          .bind(id)
          .first();

        return json({ item: rssFeedResponse(item) });
      }

      // ========================================
      // RSS - ATUALIZAÇÃO DOS FEEDS
      // ========================================

      const rssRefreshMatch = routePath.match(
        /^\/api\/editor\/rss-feeds\/([1-9]\d*)\/refresh$/,
      );

      if (rssRefreshMatch && request.method === "POST") {
        const id = rssFeedId(rssRefreshMatch[1]);

        if (!id) return json({ error: "Identificador inválido." }, 422);

        const result = await refreshRssFeed(env.DB, id);

        if (result.error) {
          return json({ error: result.error }, result.status);
        }

        return json(result);
      }

      if (
        routePath === "/api/editor/rss/refresh" &&
        request.method === "POST"
      ) {
        const { results: feeds } = await env.DB.prepare(
          "SELECT id FROM rss_feeds WHERE is_active=? ORDER BY id",
        )
          .bind(rssBoolean(env.DB, true))
          .all();

        const results = [];
        let inserted = 0;
        let updated = 0;
        let queued = 0;
        let autoImported = 0;
        let coversUpdated = 0;

        // Atualização sequencial para não sobrecarregar as fontes.
        for (const feed of feeds) {
          const result = await refreshRssFeed(env.DB, Number(feed.id));

          if (!result.error) {
            inserted += result.inserted || 0;
            updated += result.updated || 0;
            queued += result.queued || 0;
            autoImported += result.autoImported || 0;
            coversUpdated += result.coversUpdated || 0;
          }

          results.push({
            feedId: Number(feed.id),
            ...result,
          });
        }

        return json({
          total: feeds.length,
          inserted,
          updated,
          queued,
          autoImported,
          coversUpdated,
          failures: results.filter((result) => result.error).length,
          results,
        });
      }

      // ========================================
      // PIPELINE - FILA, EXTRAÇÃO E SUGESTÕES DE IA
      // ========================================

      if (
        routePath === "/api/editor/pipeline/queue" &&
        request.method === "GET"
      ) {
        return json(
          await listQueueItems(env.DB, {
            status: url.searchParams.get("status") || "",
            sourceType: url.searchParams.get("source") || "",
            limit: Number(url.searchParams.get("limit")) || 30,
            page: Number(url.searchParams.get("page")) || 1,
          }),
        );
      }

      if (
        routePath === "/api/editor/pipeline/suggestions" &&
        request.method === "GET"
      ) {
        const items = await listSuggestions(env.DB, {
          rssItemId: Number(
            url.searchParams.get("rssItemId") ||
              url.searchParams.get("rss_item_id") ||
              0,
          ),
          newsId: Number(
            url.searchParams.get("newsId") ||
              url.searchParams.get("news_id") ||
              0,
          ),
          stage: url.searchParams.get("stage") || "",
          status: url.searchParams.get("status") || "",
          limit: Number(url.searchParams.get("limit")) || 30,
        });

        return json({ items, total: items.length, ai: aiStatus(env) });
      }

      if (
        routePath === "/api/editor/pipeline/enqueue" &&
        request.method === "POST"
      ) {
        let input;
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }

        const rssItemId = Number(
          input.rssItemId || input.rss_item_id || 0,
        );
        const feedId = Number(input.feedId || input.feed_id || 0);

        if (rssItemId > 0) {
          const item = await getRssItemForPipeline(env.DB, rssItemId);
          if (!item) {
            return json({ error: "Item RSS não encontrado." }, 404);
          }

          const queued = await enqueueRssItems(env.DB, {
            feedId: Number(item.feed_id),
            feedName: item.feed_name,
            items: [rssItemToQueueInput(item)],
          });

          return json({
            ...queued,
            counts: await countQueueByStatus(env.DB),
          });
        }

        if (feedId > 0) {
          const feed = await env.DB.prepare(
            "SELECT id, name FROM rss_feeds WHERE id=?",
          )
            .bind(feedId)
            .first();

          if (!feed) {
            return json({ error: "Fonte RSS não encontrada." }, 404);
          }

          const { results } = await env.DB.prepare(
            `SELECT * FROM rss_items
             WHERE feed_id=? AND imported_at IS NULL
             ORDER BY id DESC LIMIT 200`,
          )
            .bind(feedId)
            .all();

          const queued = await enqueueRssItems(env.DB, {
            feedId,
            feedName: feed.name,
            items: (results || []).map(rssItemToQueueInput),
          });

          return json({
            ...queued,
            counts: await countQueueByStatus(env.DB),
          });
        }

        if (input.all === true) {
          const { results } = await env.DB.prepare(
            `SELECT i.*, f.name AS feed_name
             FROM rss_items i
             INNER JOIN rss_feeds f ON f.id=i.feed_id
             WHERE i.imported_at IS NULL
             ORDER BY i.id DESC LIMIT 200`,
          ).all();

          const byFeed = new Map();
          for (const row of results || []) {
            const id = Number(row.feed_id);
            if (!byFeed.has(id)) byFeed.set(id, []);
            byFeed.get(id).push(row);
          }

          const totals = { enqueued: 0, skipped: 0, ids: [] };
          for (const [id, rows] of byFeed) {
            const queued = await enqueueRssItems(env.DB, {
              feedId: id,
              feedName: rows[0]?.feed_name || "Fonte RSS",
              items: rows.map(rssItemToQueueInput),
            });
            totals.enqueued += queued.enqueued;
            totals.skipped += queued.skipped;
            totals.ids.push(...queued.ids);
          }

          return json({
            ...totals,
            counts: await countQueueByStatus(env.DB),
          });
        }

        return json(
          { error: "Informe rssItemId, feedId ou all." },
          422,
        );
      }

      if (
        routePath === "/api/editor/pipeline/process" &&
        request.method === "POST"
      ) {
        let input = {};
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }

        const limit = Math.min(
          20,
          Math.max(1, Number(input.limit) || 5),
        );

        return json(await processQueueItems(env.DB, env, { limit }));
      }

      // ========================================
      // RSS - LISTAGEM DE NOTÍCIAS
      // ========================================

      if (
        routePath === "/api/editor/rss-items" &&
        request.method === "GET"
      ) {
        const feedIdRaw = url.searchParams.get("feed");
        const imported = url.searchParams.get("imported");
        const search = (url.searchParams.get("q") || "")
          .trim()
          .slice(0, 150);
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const limit = Math.min(
          100,
          Math.max(1, Number(url.searchParams.get("limit")) || 30),
        );
        const offset = (page - 1) * limit;

        if (feedIdRaw && !rssFeedId(feedIdRaw)) {
          return json({ error: "Fonte inválida." }, 422);
        }

        const conditions = [];
        const parameters = [];

        if (feedIdRaw) {
          conditions.push("i.feed_id=?");
          parameters.push(Number(feedIdRaw));
        }

        if (imported === "true" || imported === "1") {
          conditions.push("i.imported_at IS NOT NULL");
        } else if (imported === "false" || imported === "0") {
          conditions.push("i.imported_at IS NULL");
        }

        if (search) {
          conditions.push(
            "(LOWER(i.title) LIKE LOWER(?) OR LOWER(COALESCE(i.summary,'')) LIKE LOWER(?))",
          );
          parameters.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

        const { results } = await env.DB.prepare(
          `
          SELECT
            i.*,
            f.name AS feed_name,
            f.feed_url AS feed_url,
            f.site_url AS feed_site_url
          FROM rss_items i
          INNER JOIN rss_feeds f ON f.id = i.feed_id
          ${where}
          ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC
          LIMIT ? OFFSET ?
        `,
        )
          .bind(...parameters, limit, offset)
          .all();

        const count = await env.DB.prepare(
          `
          SELECT COUNT(*) AS total
          FROM rss_items i
          INNER JOIN rss_feeds f ON f.id = i.feed_id
          ${where}
        `,
        )
          .bind(...parameters)
          .first();

        const total = Number(count?.total || 0);

        return json({
          items: results.map(rssItemResponse),
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        });
      }

      // ========================================
      // RSS - DETALHES E IMPORTAÇÃO
      // ========================================

      const rssItemMatch = routePath.match(
        /^\/api\/editor\/rss-items\/([1-9]\d*)$/,
      );

      if (rssItemMatch && request.method === "GET") {
        const id = rssFeedId(rssItemMatch[1]);

        if (!id) return json({ error: "Identificador inválido." }, 422);

        const item = await env.DB.prepare(
          `
          SELECT
            i.*,
            f.name AS feed_name,
            f.feed_url AS feed_url,
            f.site_url AS feed_site_url
          FROM rss_items i
          INNER JOIN rss_feeds f ON f.id = i.feed_id
          WHERE i.id=?
        `,
        )
          .bind(id)
          .first();

        if (!item) {
          return json({ error: "Notícia RSS não encontrada." }, 404);
        }

        return json({ item: rssItemResponse(item) });
      }

      // Cria um rascunho editorial diretamente a partir do item RSS.
      const rssImportMatch = routePath.match(
        /^\/api\/editor\/rss-items\/([1-9]\d*)\/import$/,
      );

      if (rssImportMatch && request.method === "POST") {
        const id = rssFeedId(rssImportMatch[1]);

        if (!id) return json({ error: "Identificador inválido." }, 422);

        const item = await env.DB.prepare(
          `
          SELECT
            i.*,
            f.name AS feed_name,
            f.site_url AS feed_site_url
          FROM rss_items i
          INNER JOIN rss_feeds f ON f.id = i.feed_id
          WHERE i.id=?
        `,
        )
          .bind(id)
          .first();

        if (!item) {
          return json({ error: "Notícia RSS não encontrada." }, 404);
        }

        if (item.imported_news_id) {
          return json(
            {
              error: "Esta notícia RSS já foi cadastrada.",
              newsId: Number(item.imported_news_id),
            },
            409,
          );
        }

        const draft = await rssCreateNewsDraft(env.DB, item, {
          name: item.feed_name || "Fonte RSS",
        });

        if (draft.error) {
          return json({ error: draft.error }, draft.status || 422);
        }

        await rssMarkImported(env.DB, id, draft.item.id);

        return json(
          {
            ok: true,
            item: draft.item,
            newsId: Number(draft.item.id),
            rssItemId: id,
          },
          201,
        );
      }

      // Marca o item RSS como importado depois de salvar no editor.
      const rssImportedMatch = routePath.match(
        /^\/api\/editor\/rss-items\/([1-9]\d*)\/imported$/,
      );

      if (rssImportedMatch && request.method === "POST") {
        const id = rssFeedId(rssImportedMatch[1]);

        if (!id) return json({ error: "Identificador inválido." }, 422);

        let input;

        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }

        const newsId = Number(input.news_id);

        if (!Number.isSafeInteger(newsId) || newsId < 1) {
          return json(
            { error: "Informe o ID da notícia criada." },
            422,
          );
        }

        const news = await env.DB.prepare("SELECT id FROM news WHERE id=?")
          .bind(newsId)
          .first();

        if (!news) {
          return json(
            { error: "Notícia editorial não encontrada." },
            404,
          );
        }

        const rssItem = await env.DB.prepare(
          "SELECT id FROM rss_items WHERE id=?",
        )
          .bind(id)
          .first();

        if (!rssItem) {
          return json({ error: "Notícia RSS não encontrada." }, 404);
        }

        await rssMarkImported(env.DB, id, newsId);

        return json({ ok: true, newsId });
      }

      if (
        path === "/api/admin/editors" &&
        ["POST", "DELETE"].includes(request.method)
      ) {
        let input;
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido." }, 400);
        }
        const email =
          typeof input.email === "string"
            ? input.email.trim().toLowerCase()
            : "";
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return json({ error: "Informe um e-mail válido." }, 422);
        if (email === env.ADMIN_EMAIL.toLowerCase())
          return json(
            { error: "A conta administradora é gerenciada na hospedagem." },
            422,
          );
        if (request.method === "POST") {
          await env.DB.prepare(
            "INSERT INTO editorial_accounts (email,created_at) VALUES (?,?) ON CONFLICT(email) DO NOTHING",
          )
            .bind(email, new Date().toISOString())
            .run();
        } else {
          await env.DB.prepare("DELETE FROM editorial_accounts WHERE email=?")
            .bind(email)
            .run();
        }
        return json({ ok: true });
      }
      // Publicação em lote de rascunhos. Cada item passa pela mesma validação
      // do editor; itens inválidos são informados e não são publicados.
      if (
        path === "/api/editor/news/bulk-publish" &&
        request.method === "POST"
      ) {
        let input;
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido ou grande demais." }, 400);
        }

        const requested = Array.isArray(input.ids) ? input.ids : [];
        const ids = [
          ...new Set(
            requested
              .map((value) => Number(value))
              .filter((value) => Number.isSafeInteger(value) && value > 0),
          ),
        ].slice(0, 100);

        if (!ids.length) {
          return json(
            { error: "Selecione ao menos um rascunho para publicar." },
            422,
          );
        }

        const now = new Date().toISOString();
        const published = [];
        const skipped = [];
        const placeholders = ids.map(() => "?").join(",");

        // Uma leitura para todos os itens e outra para as capas do radar RSS,
        // evitando muitas idas ao banco em publicações maiores.
        const { results: rows } = await env.DB.prepare(
          `SELECT * FROM news WHERE id IN (${placeholders})`,
        )
          .bind(...ids)
          .all();
        const byId = new Map(rows.map((row) => [Number(row.id), row]));

        const { results: covers } = await env.DB.prepare(
          `
          SELECT imported_news_id, image_url
          FROM rss_items
          WHERE imported_news_id IN (${placeholders})
            AND image_url IS NOT NULL
            AND image_url<>''
          ORDER BY id
        `,
        )
          .bind(...ids)
          .all();
        const coverById = new Map(
          covers.map((item) => [Number(item.imported_news_id), item.image_url]),
        );

        for (const id of ids) {
          const existing = byId.get(id);

          if (!existing) {
            skipped.push({
              id,
              title: "",
              reason: "Item não encontrado.",
            });
            continue;
          }

          if (existing.status !== "draft") {
            skipped.push({
              id,
              title: existing.title,
              reason:
                existing.status === "published"
                  ? "Já está publicado."
                  : "Não é um rascunho.",
            });
            continue;
          }

          const cover = existing.cover || coverById.get(id) || "";

          const { errors, value } = validateNews({
            ...existing,
            cover,
            status: "published",
          });

          if (errors.length) {
            skipped.push({
              id,
              title: existing.title,
              reason: errors.join(" "),
            });
            continue;
          }

          const isNews = value.category === "Notícias";
          const marked = isNews && existing.featured === 1;
          const featuredAt = marked
            ? existing.featured_at || now
            : existing.featured_at || null;
          const newsOnce =
            existing.news_published_once === 1 || isNews ? 1 : 0;

          await env.DB.prepare(
            `
            UPDATE news
            SET status='published',
                cover=?,
                featured=?,
                featured_at=?,
                news_published_once=?,
                published_at=COALESCE(published_at, ?),
                updated_at=?,
                version=version+1
            WHERE id=?
          `,
          )
            .bind(
              cover,
              marked ? 1 : 0,
              featuredAt,
              newsOnce,
              now,
              now,
              id,
            )
            .run();

          published.push({
            id,
            title: value.title,
            cover,
          });
        }

        return json({ ok: true, published, skipped });
      }

      const match = path.match(
        /^\/api\/(?:admin|editor)\/(news|schedule|recommendations)(?:\/([1-9]\d*))?$/,
      );
      if (!match) return json({ error: "Rota não encontrada." }, 404);
      const table = match[1],
        id = match[2] ? Number(match[2]) : null,
        { columns, validate } = editorialTables[table];
      if (request.method === "GET" && !id) {
        const { results } = await env.DB.prepare(
          `SELECT * FROM ${table} ORDER BY updated_at DESC,id DESC LIMIT 1000`,
        ).all();
        return json({ items: results });
      }
      if (
        (request.method === "POST" && !id) ||
        (request.method === "PUT" && id)
      ) {
        let input;
        try {
          input = await bodyJson(request);
        } catch {
          return json({ error: "Conteúdo inválido ou grande demais." }, 400);
        }
        const { errors, value: a } = validate(input);
        if (errors.length) return json({ error: errors.join(" ") }, 422);
        const now = new Date().toISOString();
        let existing = null;
        if (id) {
          if (
            !Number.isSafeInteger(id) ||
            !Number.isInteger(input.version) ||
            input.version < 1
          )
            return json({ error: "Versão inválida. Recarregue o item." }, 422);
          existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`)
            .bind(id)
            .first();
          if (!existing) return json({ error: "Item não encontrado." }, 404);
          if (existing.version !== input.version)
            return json(
              {
                error:
                  "Este item foi alterado em outra sessão. Recarregue antes de salvar.",
              },
              409,
            );
        }
        try {
          const values = columns.map((c) => a[c]);
          const writeColumns = [...columns];
          if (table === "news") {
            writeColumns.push(
              "published_at",
              "featured_at",
              "featured",
              "news_published_once",
            );
            const isNews = a.category === "Notícias";
            const marked =
              isNews &&
              (input.featured === undefined
                ? existing?.featured === 1
                : a.featured);
            const published = a.status === "published";
            const selectedAt =
              marked && published && input.featured === true
                ? now
                : existing?.featured_at;
            const alreadyPublished =
              existing?.news_published_once === 1 ||
              (existing?.category === "Notícias" && existing?.published_at);
            values.push(
              published
                ? existing?.published_at || now
                : existing?.published_at || null,
              selectedAt ?? null,
              marked ? 1 : 0,
              alreadyPublished || (isNews && published) ? 1 : 0,
            );
          }
          if (!id) {
            const cols = [...writeColumns, "created_at", "updated_at"];
            const item = await env.DB.prepare(
              `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) RETURNING *`,
            )
              .bind(...values, now, now)
              .first();
            return json({ item }, 201);
          }
          const result = await env.DB.prepare(
            `UPDATE ${table} SET ${writeColumns.map((c) => c + "=?").join(",")},updated_at=?,version=version+1 WHERE id=? AND version=?`,
          )
            .bind(...values, now, id, input.version)
            .run();
          if (!result.meta.changes)
            return json(
              { error: "Conflito de edição. Recarregue o item." },
              409,
            );
          return json({
            item: await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`)
              .bind(id)
              .first(),
          });
        } catch (error) {
          if (
            table === "recommendations" &&
            (error?.constraint === "recommendations_feature_date_key" ||
              String(error).includes("recommendations.feature_date"))
          )
            return json(
              {
                error:
                  "Já existe uma recomendação para esta data. Edite o item existente.",
              },
              409,
            );
          throw error;
        }
      }
      return json({ error: "Rota não encontrada." }, 404);
    }
    if (path.startsWith("/api/"))
      return json({ error: "Rota não encontrada." }, 404);
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Método não permitido", { status: 405 });
    return serve(
      path === "/"
        ? "/index.html"
        : path === "/login"
          ? "/login.html"
          : path === "/noticia" || path === "/noticias"
            ? "/noticia.html"
            : path,
      request.method === "HEAD",
      env.ASSETS,
    );
  } catch (error) {
    console.error("VisionNews request failed", error?.name);
    return json({ error: "Não foi possível concluir. Tente novamente." }, 500);
  }
}
function serve(path, head = false, source = assets) {
  const asset = source[path];
  if (!asset) return new Response("Página não encontrada", { status: 404 });
  return securityHeaders(
    new Response(head ? null : asset.body, {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control":
          path.includes("/admin/") || path.includes("/dashboard/")
            ? "no-store"
            : "no-cache",
      },
    }),
  );
}
export default { fetch: handle };
