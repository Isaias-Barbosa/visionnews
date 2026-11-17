import { createHash } from "node:crypto";
import { fetchAndParseFeed } from "./rss.mjs";

const categories = ["Notícias", "Reviews", "Guias", "Cultura"];
const statuses = ["draft", "published", "archived"];
const platforms = ["Crunchyroll", "Disney+", "Netflix", "HBO Max", "TV aberta"];
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
  const identity = item.guid || item.link || item.title;

  return createHash("sha256")
    .update(String(identity).trim().toLowerCase())
    .digest("hex");
}

function rssFeedId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function rssItemResponse(item) {
  return {
    ...item,
    imported: Boolean(item.imported_at),
  };
}

async function refreshRssFeed(DB, feedId) {
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
    const result = await fetchAndParseFeed(feed.feed_url);
    let inserted = 0;
    let updated = 0;

    for (const item of result.items) {
      const itemKey = rssItemKey(item);

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
              published_at=?
          WHERE id=?
        `,
        )
          .bind(
            item.guid || null,
            item.link || null,
            item.title.slice(0, 300),
            item.summary || "",
            item.content || "",
            item.image || "",
            item.publishedAt,
            existing.id,
          )
          .run();

        updated++;
      } else {
        await DB.prepare(
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
            published_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (feed_id, item_key) DO NOTHING
        `,
        )
          .bind(
            feedId,
            itemKey,
            item.guid || null,
            item.link || null,
            item.title.slice(0, 300),
            item.summary || "",
            item.content || "",
            item.image || "",
            item.publishedAt,
          )
          .run();

        inserted++;
      }
    }

    await DB.prepare(
      `
      UPDATE rss_feeds
      SET site_url=?,
          last_fetched_at=?,
          last_error=NULL,
          updated_at=NOW()
      WHERE id=?
    `,
    )
      .bind(result.siteUrl || feed.site_url || null, result.fetchedAt, feedId)
      .run();

    return {
      ok: true,
      feedId,
      feedTitle: result.title,
      format: result.format,
      total: result.items.length,
      inserted,
      updated,
      fetchedAt: result.fetchedAt,
    };
  } catch (error) {
    await DB.prepare(
      `
      UPDATE rss_feeds
      SET last_error=?,
          updated_at=NOW()
      WHERE id=?
    `,
    )
      .bind(
        String(error.message || "Erro ao consultar feed").slice(0, 500),
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
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  );
  return response;
}
export async function handle(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  try {
    if (path === "/api/health") return json({ ok: true });
    const privatePage = path.match(
      /^\/(admin|dashboard)(?:\/index\.html|\/)?$/,
    )?.[1];
    if (privatePage && ["GET", "HEAD"].includes(request.method)) {
      const target = "/" + privatePage;
      if (!request.headers.get("oai-authenticated-user-id")) {
        const login = new URL(
          env.SIGN_IN_PATH || "/signin-with-chatgpt",
          url.origin,
        );
        login.searchParams.set(env.SIGN_IN_PATH ? "next" : "return_to", target);
        return Response.redirect(login, 302);
      }
      if (
        !(privatePage === "admin"
          ? canAdmin(request, env)
          : await canEdit(request, env))
      )
        return json({ error: "Acesso restrito a esta área." }, 403);
      return serve(
        target + "/index.html",
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
    if (path.startsWith("/api/admin/") || path.startsWith("/api/editor/")) {
      const adminRoute = path.startsWith("/api/admin/");
      if (!(adminRoute ? canAdmin(request, env) : await canEdit(request, env)))
        return json(
          { error: "Acesso restrito à administração." },
          request.headers.get("oai-authenticated-user-id") ? 403 : 401,
        );
      if (path === "/api/admin/session" && request.method === "GET")
        return json({ authorized: true });
      if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
      if (
        request.method !== "GET" &&
        (request.headers.get("Origin") !== url.origin ||
          !request.headers
            .get("Content-Type")
            ?.startsWith("application/json") ||
          request.headers.get("Sec-Fetch-Site") === "cross-site")
      )
        return json({ error: "Origem da solicitação não permitida." }, 403);
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

// ========================================
// RSS - GERENCIAMENTO DE FONTES
// ========================================

if (path === '/api/editor/rss-feeds' && request.method === 'GET') {
  const { results } = await env.DB.prepare(`
    SELECT
      f.*,
      COUNT(i.id)::INTEGER AS total_items,
      COUNT(i.imported_at)::INTEGER AS imported_items
    FROM rss_feeds f
    LEFT JOIN rss_items i ON i.feed_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `).all();

  return json({ items: results });
}

if (path === '/api/editor/rss-feeds' && request.method === 'POST') {
  let input;

  try {
    input = await bodyJson(request);
  } catch {
    return json({ error: 'Conteúdo inválido.' }, 400);
  }

  const name = typeof input.name === 'string'
    ? input.name.trim()
    : '';

  const feedUrl = typeof input.feed_url === 'string'
    ? input.feed_url.trim()
    : '';

  if (name.length < 2 || name.length > 120) {
    return json({ error: 'O nome deve ter entre 2 e 120 caracteres.' }, 422);
  }

  if (!feedUrl || feedUrl.length > 2048) {
    return json({ error: 'Informe uma URL válida para o feed.' }, 422);
  }

  try {
    const result = await fetchAndParseFeed(feedUrl);

    const item = await env.DB.prepare(`
      INSERT INTO rss_feeds (
        name,
        feed_url,
        site_url,
        is_active
      )
      VALUES (?, ?, ?, TRUE)
      RETURNING *
    `).bind(
      name,
      result.requestedUrl,
      result.siteUrl || null
    ).first();

    return json({
      item,
      preview: {
        format: result.format,
        title: result.title,
        total: result.items.length
      }
    }, 201);

  } catch (error) {
    if (String(error.message).includes('duplicate key')) {
      return json({ error: 'Esta fonte RSS já está cadastrada.' }, 409);
    }

    return json({
      error: error.message || 'Não foi possível cadastrar o feed.'
    }, 422);
  }
}

// Atualizar, ativar ou desativar uma fonte
const rssFeedMatch = path.match(
  /^\/api\/editor\/rss-feeds\/([1-9]\d*)$/
);

if (rssFeedMatch && ['PUT', 'DELETE'].includes(request.method)) {
  const id = rssFeedId(rssFeedMatch[1]);

  if (!id) return json({ error: 'Identificador inválido.' }, 422);

  const existing = await env.DB.prepare(
    'SELECT * FROM rss_feeds WHERE id=?'
  ).bind(id).first();

  if (!existing) {
    return json({ error: 'Fonte RSS não encontrada.' }, 404);
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare(
      'DELETE FROM rss_feeds WHERE id=?'
    ).bind(id).run();

    return json({ ok: true });
  }

  let input;

  try {
    input = await bodyJson(request);
  } catch {
    return json({ error: 'Conteúdo inválido.' }, 400);
  }

  const name = typeof input.name === 'string'
    ? input.name.trim()
    : existing.name;

  const isActive = typeof input.is_active === 'boolean'
    ? input.is_active
    : existing.is_active;

  if (name.length < 2 || name.length > 120) {
    return json({ error: 'Nome inválido.' }, 422);
  }

  await env.DB.prepare(`
    UPDATE rss_feeds
    SET name=?,
        is_active=?,
        updated_at=NOW()
    WHERE id=?
  `).bind(name, isActive, id).run();

  return json({
    item: await env.DB.prepare(
      'SELECT * FROM rss_feeds WHERE id=?'
    ).bind(id).first()
  });
}

// ========================================
// RSS - ATUALIZAÇÃO DOS FEEDS
// ========================================

const rssRefreshMatch = path.match(
  /^\/api\/editor\/rss-feeds\/([1-9]\d*)\/refresh$/
);

if (
  rssRefreshMatch &&
  request.method === 'POST'
) {
  const id = rssFeedId(rssRefreshMatch[1]);

  if (!id) return json({ error: 'Identificador inválido.' }, 422);

  const result = await refreshRssFeed(env.DB, id);

  if (result.error) {
    return json({ error: result.error }, result.status);
  }

  return json(result);
}

if (
  path === '/api/editor/rss/refresh' &&
  request.method === 'POST'
) {
  const { results: feeds } = await env.DB.prepare(
    'SELECT id FROM rss_feeds WHERE is_active=TRUE ORDER BY id'
  ).all();

  const results = [];

  // Atualização sequencial para evitar sobrecarregar o servidor.
  for (const feed of feeds) {
    const result = await refreshRssFeed(env.DB, Number(feed.id));

    results.push({
      feedId: Number(feed.id),
      ...result
    });
  }

  return json({
    total: feeds.length,
    results
  });
}

// ========================================
// RSS - LISTAGEM DE NOTÍCIAS
// ========================================

if (path === '/api/editor/rss-items' && request.method === 'GET') {
  const feedId = url.searchParams.get('feed');
  const imported = url.searchParams.get('imported');
  const search = (url.searchParams.get('q') || '').trim().slice(0, 150);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = 30;
  const offset = (page - 1) * limit;

  if (feedId && !rssFeedId(feedId)) {
    return json({ error: 'Fonte inválida.' }, 422);
  }

  const conditions = [];
  const parameters = [];

  if (feedId) {
    conditions.push('i.feed_id=?');
    parameters.push(Number(feedId));
  }

  if (imported === 'true') {
    conditions.push('i.imported_at IS NOT NULL');
  } else if (imported === 'false') {
    conditions.push('i.imported_at IS NULL');
  }

  if (search) {
    conditions.push('(i.title ILIKE ? OR i.summary ILIKE ?)');
    parameters.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const { results } = await env.DB.prepare(`
    SELECT
      i.*,
      f.name AS feed_name,
      f.site_url AS feed_site_url
    FROM rss_items i
    INNER JOIN rss_feeds f ON f.id = i.feed_id
    ${where}
    ORDER BY i.published_at DESC NULLS LAST, i.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...parameters, limit, offset).all();

  const count = await env.DB.prepare(`
    SELECT COUNT(*)::INTEGER AS total
    FROM rss_items i
    INNER JOIN rss_feeds f ON f.id = i.feed_id
    ${where}
  `).bind(...parameters).first();

  return json({
    items: results.map(rssItemResponse),
    page,
    limit,
    total: Number(count?.total || 0),
    pages: Math.ceil(Number(count?.total || 0) / limit)
  });
}

// ========================================
// RSS - DETALHES E IMPORTAÇÃO
// ========================================

const rssItemMatch = path.match(
  /^\/api\/editor\/rss-items\/([1-9]\d*)$/
);

if (rssItemMatch && request.method === 'GET') {
  const id = rssFeedId(rssItemMatch[1]);

  if (!id) return json({ error: 'Identificador inválido.' }, 422);

  const item = await env.DB.prepare(`
    SELECT
      i.*,
      f.name AS feed_name,
      f.site_url AS feed_site_url
    FROM rss_items i
    INNER JOIN rss_feeds f ON f.id = i.feed_id
    WHERE i.id=?
  `).bind(id).first();

  if (!item) {
    return json({ error: 'Notícia RSS não encontrada.' }, 404);
  }

  return json({ item: rssItemResponse(item) });
}

// Marcar notícia RSS como importada após salvar no editor
const rssImportedMatch = path.match(
  /^\/api\/editor\/rss-items\/([1-9]\d*)\/imported$/
);

if (rssImportedMatch && request.method === 'POST') {
  const id = rssFeedId(rssImportedMatch[1]);

  if (!id) return json({ error: 'Identificador inválido.' }, 422);

  let input;

  try {
    input = await bodyJson(request);
  } catch {
    return json({ error: 'Conteúdo inválido.' }, 400);
  }

  const newsId = Number(input.news_id);

  if (!Number.isSafeInteger(newsId) || newsId < 1) {
    return json({ error: 'Informe o ID da notícia criada.' }, 422);
  }

  const news = await env.DB.prepare(
    'SELECT id FROM news WHERE id=?'
  ).bind(newsId).first();

  if (!news) {
    return json({ error: 'Notícia editorial não encontrada.' }, 404);
  }

  const result = await env.DB.prepare(`
    UPDATE rss_items
    SET imported_at=NOW(),
        imported_news_id=?
    WHERE id=?
  `).bind(newsId, id).run();

  if (!result.meta.changes) {
    return json({ error: 'Notícia RSS não encontrada.' }, 404);
  }

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
      path === "/" ? "/index.html" : path === "/login" ? "/login.html" : path,
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
