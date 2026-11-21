import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  aiStatus,
  generateEditorialSuggestion,
  translationModel,
  translateWithOpenRouter,
} from "../server/ai.mjs";
import { extractArticleDetailed } from "../server/article.mjs";
import {
  canonicalItemKey,
  canonicalUrl,
  findCrossFeedDuplicates,
  legacyItemKey,
  normalizeTitle,
} from "../server/dedup.mjs";
import {
  enqueueRssItems,
  processQueueItems,
  sourceProfile,
} from "../server/pipeline.mjs";
import {
  claimQueueItems,
  enqueueQueueItems,
  finishQueueItem,
  listQueueItems,
  listSuggestions,
} from "../server/queue.mjs";
import { translateTexts } from "../server/translation.mjs";
import worker from "../dist/server/index.js";

const MIGRATIONS = [
  "0000_news.sql",
  "0001_editor_reviews_schedule.sql",
  "0002_editorial_dashboard.sql",
  "0003_news_feature.sql",
  "0004_rss.sql",
  "0006_rss_style.sql",
  "0007_ingestion_pipeline.sql",
];

function testDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) {
    db.exec(
      readFileSync(`drizzle/${file}`, "utf8").replace(/^\uFEFF/, ""),
    );
  }
  return db;
}

function testEnv(db, extra = {}) {
  return {
    ADMIN_EMAIL: "editor@example.com",
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) {
            args = values;
            return this;
          },
          async all() {
            return { results: db.prepare(sql).all(...args) };
          },
          async first() {
            return db.prepare(sql).get(...args) || null;
          },
          async run() {
            const result = db.prepare(sql).run(...args);
            return {
              meta: {
                changes: Number(result.changes),
                last_row_id: Number(result.lastInsertRowid),
              },
            };
          },
        };
      },
    },
    ...extra,
  };
}

function seedRssItem(db, options = {}) {
  const now = new Date().toISOString();
  const feedUrl = options.feedUrl || "https://example.test/feed.xml";
  const feed = db
    .prepare(
      `INSERT INTO rss_feeds (name, feed_url, created_at, updated_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(options.feedName || "Feed Teste", feedUrl, now, now);

  const link = options.link || "https://example.test/noticia";
  const item = db
    .prepare(
      `INSERT INTO rss_items (
         feed_id, item_key, guid, link, title, summary, content,
         image_url, author, published_at, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      Number(feed.id),
      options.itemKey || `key-${Date.now()}-${Math.random()}`,
      options.guid || link,
      link,
      options.title || "Notícia de teste",
      options.summary || "Resumo da notícia de teste.",
      options.content || "",
      "",
      "Redação",
      now,
      now,
    );

  return { feedId: Number(feed.id), itemId: Number(item.id), link };
}

function apiRequest(path, method = "GET", body) {
  return new Request(`https://vision.test${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://vision.test",
      "oai-authenticated-user-id": "user-1",
      "oai-authenticated-user-email": "editor@example.com",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("canonical URL removes tracking, hash, www and trailing slash", () => {
  const result = canonicalUrl(
    "https://www.Example.com/noticia/?utm_source=rss&b=2&a=1#top",
  );
  assert.equal(result, "https://example.com/noticia?a=1&b=2");
  assert.equal(canonicalUrl("javascript:alert(1)"), "");
  assert.equal(canonicalUrl("https://user:pass@example.com/x"), "");
});

test("title normalization strips accents and punctuation", () => {
  assert.equal(normalizeTitle("Sétimo estúdio!"), "setimo estudio");
  assert.equal(
    normalizeTitle("Temporada 2 Anunciada"),
    normalizeTitle("temporada 2 anunciada!"),
  );
});

test("legacy RSS key keeps its original SHA-256 contract", () => {
  const expected = createHash("sha256").update("guid-1").digest("hex");
  assert.equal(
    legacyItemKey({ guid: "GUID-1", link: "https://example.com/x", title: "x" }),
    expected,
  );
});

test("cross-feed duplicates share a canonical key without touching legacy keys", () => {
  const fromA = {
    guid: "guid-a",
    link: "https://www.example.com/noticia?utm_source=rss#top",
    title: "Temporada 2 Anunciada!",
  };
  const fromB = {
    guid: "guid-b",
    link: "https://example.com/noticia/",
    title: "temporada 2 anunciada",
  };
  const other = {
    guid: "guid-c",
    link: "https://example.com/outra",
    title: "Outra matéria",
  };

  assert.equal(canonicalItemKey(fromA), canonicalItemKey(fromB));
  assert.notEqual(legacyItemKey(fromA), legacyItemKey(fromB));

  const groups = findCrossFeedDuplicates([fromA, fromB, other]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
});

const articleHtml = `<html lang="en"><head>
  <title>Original headline</title>
  <link rel="canonical" href="https://www.example.com/news/tamon?utm_source=rss">
  <meta property="og:title" content="Tamon's B-Side ganha 2ª temporada">
  <meta property="og:image" content="/img/tamon.jpg">
  <meta name="author" content="Redação ANN">
  <meta property="article:published_time" content="2026-11-18T10:00:00Z">
</head><body>
  <nav>Menu compartilhar Twitter Instagram</nav>
  <article>
    <h1>Tamon's B-Side ganha 2ª temporada</h1>
    <p><span style="font-family:'Gotham'; color:#d9ff60">A Anime News Network anunciou nesta quarta-feira que a segunda temporada foi confirmada.</span></p>
    <p>A estreia está prevista para abril de 2027 no Japão, com a equipe original retornando.</p>
    <h2>Reação dos fãs</h2>
    <p>Segundo o comunicado oficial, os fãs acompanharam o anúncio durante o evento.</p>
    <p>Compartilhe no Twitter e siga-nos no Instagram.</p>
  </article>
  <footer>Siga-nos no Twitter</footer>
</body></html>`;

test("article extractor returns the RSS item contract with verified metadata", () => {
  const { item, report } = extractArticleDetailed({
    html: articleHtml,
    url: "https://www.example.com/news/tamon?utm_source=rss",
    options: { minWords: 5 },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.reasons, []);
  assert.equal(report.language, "en");
  assert.equal(report.selectors[0], "article");

  assert.equal(item.title, "Tamon's B-Side ganha 2ª temporada");
  assert.equal(item.link, "https://example.com/news/tamon");
  assert.equal(item.image, "https://example.com/img/tamon.jpg");
  assert.equal(item.author, "Redação ANN");
  assert.match(item.publishedAt, /^2026-11-18/);
  assert.match(item.content, /\n\n/);
  assert(!item.content.includes("Menu compartilhar"));
  assert(!item.content.includes("Siga-nos no Twitter"));
  assert(!item.content.includes("Compartilhe no Twitter"));
  assert.equal(item.style.fonts[0], "Gotham");
  assert(item.style.colors.includes("#d9ff60"));
});

test("article extractor refuses thin content instead of inventing a story", () => {
  const { item, report } = extractArticleDetailed({
    html: "<html><body><p>Kurto.</p></body></html>",
    url: "https://example.com/rascunho",
    options: { minWords: 20 },
  });

  assert.equal(report.ok, false);
  assert(report.reasons.some((reason) => reason.includes("texto insuficiente")));
  assert.equal(item.title, "");
  assert.equal(item.link, "https://example.com/rascunho");
});

test("DeepL adapter translates to PT-BR using a mocked response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody = null;

  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ translations: [{ text: "Olá mundo" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await translateTexts(
      [{ id: "titulo", text: "Hello world" }],
      { DEEPL_API_KEY: "teste:fx" },
    );

    assert.deepEqual(result, [{ id: "titulo", text: "Olá mundo" }]);
    assert.match(requestedUrl, /api-free\.deepl\.com/);
    assert.equal(requestedBody.target_lang, "PT-BR");
    assert.equal(requestedBody.preserve_formatting, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepL quota errors become a clear message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "quota" }), { status: 456 });

  try {
    await assert.rejects(
      () =>
        translateTexts([{ id: "a", text: "Hello" }], {
          DEEPL_API_KEY: "teste:fx",
        }),
      /cota mensal/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepL requires a server key and health never exposes it", async () => {
  await assert.rejects(
    () => translateTexts([{ id: "a", text: "Hello" }], {}),
    /DEEPL_API_KEY|DEEPL_AUTH_KEY/,
  );

  const response = await worker.fetch(
    new Request("https://vision.test/api/health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.database, false);
  assert.deepEqual(body.translation, {
    provider: "deepl",
    configured: false,
  });
  assert(!JSON.stringify(body).includes("DEEPL_API_KEY:"));
  assert.equal(body.ai.translation.provider, "deepl");
  assert.equal(body.ai.editorial.configured, false);
});

test("AI status separates translation and editorial models without secrets", () => {
  const deepl = aiStatus({ DEEPL_API_KEY: "chave:fx" });
  assert.equal(deepl.translation.provider, "deepl");
  assert.equal(deepl.translation.configured, true);
  assert.equal(deepl.editorial.configured, false);

  const both = aiStatus({
    DEEPL_API_KEY: "chave:fx",
    OPENROUTER_API_KEY: "sk-segredo",
    OPENROUTER_EDITORIAL_MODEL: "editor/modelo",
  });
  assert.equal(both.translation.provider, "deepl");
  assert.equal(both.editorial.provider, "openrouter");
  assert.equal(both.editorial.model, "editor/modelo");
  assert(!JSON.stringify(both).includes("sk-segredo"));

  const onlyOpenRouter = aiStatus({
    OPENROUTER_API_KEY: "sk-segredo",
    OPENROUTER_TRANSLATION_MODEL: "traducao/modelo",
  });
  assert.equal(onlyOpenRouter.translation.provider, "openrouter");
  assert.equal(
    translationModel({
      OPENROUTER_API_KEY: "sk-segredo",
      OPENROUTER_TRANSLATION_MODEL: "traducao/modelo",
    }),
    "traducao/modelo",
  );
  assert(!JSON.stringify(onlyOpenRouter).includes("sk-segredo"));
});

test("OpenRouter translation uses the configured model and keeps text ids", async () => {
  const originalFetch = globalThis.fetch;
  let requested = null;

  globalThis.fetch = async (url, init) => {
    requested = { url: String(url), body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: [
                  { id: "titulo", text: "Título traduzido" },
                  { id: "corpo", text: "Corpo traduzido" },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await translateWithOpenRouter(
      [
        { id: "titulo", text: "Original title" },
        { id: "corpo", text: "Original body" },
      ],
      {
        OPENROUTER_API_KEY: "sk-teste",
        OPENROUTER_TRANSLATION_MODEL: "teste/tradutor",
      },
    );

    assert.deepEqual(result, [
      { id: "titulo", text: "Título traduzido" },
      { id: "corpo", text: "Corpo traduzido" },
    ]);
    assert.match(requested.url, /openrouter\.ai/);
    assert.equal(requested.body.model, "teste/tradutor");
    assert.match(
      requested.body.messages[0].content,
      /português brasileiro/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editorial suggestion uses verified facts, credits the source and refuses thin input", async () => {
  const originalFetch = globalThis.fetch;
  let payload = null;

  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: `\`\`\`json
                {"title":"Nova temporada confirmada","summary":"Anúncio em evento.","body":"A Anime News Network confirmou a segunda temporada durante um evento no Japão. A estreia está marcada para abril de 2027.","confidence":0.91,"notes":""}
                \`\`\``,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const suggestion = await generateEditorialSuggestion(
      {
        title: "Tamon's B-Side ganha 2ª temporada",
        summary: "Anúncio em evento.",
        content: "A Anime News Network confirmou a segunda temporada.",
        sourceUrl: "https://www.animenewsnetwork.com/noticia",
        sourceLabel: "Anime News Network",
      },
      {
        OPENROUTER_API_KEY: "sk-teste",
        OPENROUTER_EDITORIAL_MODEL: "teste/redator",
      },
    );

    assert.equal(suggestion.status, "suggested");
    assert.equal(suggestion.provider, "openrouter");
    assert.equal(suggestion.model, "teste/redator");
    assert.equal(suggestion.confidence, 0.91);
    assert.match(suggestion.body, /Fonte: Anime News Network — https:\/\//);
    assert.equal(payload.model, "teste/redator");
    assert(!JSON.stringify(payload).includes("sk-teste"));

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"insufficient"}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const refused = await generateEditorialSuggestion(
      { title: "Curto", content: "Pouco texto" },
      { OPENROUTER_API_KEY: "sk-teste" },
    );
    assert.equal(refused.status, "needs_review");
    assert(refused.reasons.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queue deduplicates enqueue, claims and finishes jobs", async () => {
  const db = testDb();
  const env = testEnv(db);

  const item = {
    sourceType: "rss",
    sourceId: 7,
    itemKey: "item-1",
    canonicalKey: "url:abc",
    payload: { rssItemId: 1 },
  };

  const first = await enqueueQueueItems(env.DB, [item, { ...item }]);
  assert.equal(first.enqueued, 1);
  assert.equal(first.skipped, 1);

  const listed = await listQueueItems(env.DB, { status: "pending" });
  assert.equal(listed.total, 1);
  assert.equal(listed.counts.pending, 1);
  assert.deepEqual(listed.items[0].payload, { rssItemId: 1 });

  const claimed = await claimQueueItems(env.DB, { limit: 5 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "processing");
  assert.equal(claimed[0].attempts, 1);

  assert.equal(await finishQueueItem(env.DB, claimed[0].id, {
    status: "done",
  }), 1);
  assert.equal((await listQueueItems(env.DB)).counts.done, 1);
});

test("pipeline extracts, translates, suggests and never creates a published note", async () => {
  const db = testDb();
  const env = testEnv(db, {
    OPENROUTER_API_KEY: "sk-teste",
    OPENROUTER_TRANSLATION_MODEL: "teste/tradutor",
    OPENROUTER_EDITORIAL_MODEL: "teste/redator",
    PIPELINE_MIN_WORDS: 5,
  });
  const { feedId, itemId } = seedRssItem(db, {
    feedName: "Anime News Network",
    link: "https://www.example.com/news/tamon?utm_source=rss",
    title: "Tamon's B-Side ganha 2ª temporada",
    content: "Conteúdo curto do feed.",
  });

  const queued = await enqueueRssItems(env.DB, {
    feedId,
    feedName: "Anime News Network",
    items: [
      {
        id: itemId,
        itemKey: "legacy-key",
        link: "https://www.example.com/news/tamon?utm_source=rss",
        title: "Tamon's B-Side ganha 2ª temporada",
      },
    ],
  });
  assert.equal(queued.enqueued, 1);

  let translatedCall = null;
  let generatedCall = null;

  const result = await processQueueItems(env.DB, env, {
    limit: 5,
    deps: {
      fetchPublicHtml: async () => ({
        html: articleHtml,
        url: "https://example.com/news/tamon",
        fetchedAt: new Date().toISOString(),
      }),
      translateWithProvider: async (texts, receivedEnv, options) => {
        translatedCall = { texts, options };
        return texts.map((entry) => ({
          id: entry.id,
          text: `[PT-BR] ${entry.text}`,
        }));
      },
      generateEditorialSuggestion: async (input) => {
        generatedCall = input;
        return {
          status: "suggested",
          provider: "openrouter",
          model: "teste/redator",
          title: "Nova temporada de Tamon confirmada",
          summary: "Anúncio feito durante evento no Japão.",
          body: "A segunda temporada foi confirmada pelos responsáveis pela animação.",
          confidence: 0.9,
          notes: "",
        };
      },
    },
  });

  assert.equal(result.claimed, 1);
  assert.equal(result.results[0].status, "suggested");
  assert.equal(
    translatedCall.options.provider,
    "openrouter",
  );
  assert.equal(generatedCall.sourceLabel, "Anime News Network");

  const row = db
    .prepare(
      "SELECT pipeline_stage, extract_status, translation_status, source_language FROM rss_items WHERE id=?",
    )
    .get(itemId);
  assert.equal(row.pipeline_stage, "suggested");
  assert.equal(row.extract_status, "ok");
  assert.equal(row.translation_status, "suggested");
  assert.equal(row.source_language, "en");

  const suggestions = await listSuggestions(env.DB, { rssItemId: itemId });
  assert.deepEqual(
    suggestions.map((entry) => entry.stage).sort(),
    ["extraction", "rewrite", "translation"],
  );
  assert.equal(
    suggestions.find((entry) => entry.stage === "rewrite").status,
    "suggested",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM news").get().total,
    0,
  );
});

test("pipeline marks failed extraction for review without calling AI", async () => {
  const db = testDb();
  const env = testEnv(db, { OPENROUTER_API_KEY: "sk-teste" });
  const { feedId, itemId } = seedRssItem(db, {
    link: "https://example.test/rascunho",
  });

  await enqueueRssItems(env.DB, {
    feedId,
    feedName: "Feed Teste",
    items: [
      {
        id: itemId,
        itemKey: "thin-key",
        link: "https://example.test/rascunho",
        title: "Rascunho",
      },
    ],
  });

  const result = await processQueueItems(env.DB, env, {
    deps: {
      fetchPublicHtml: async () => ({
        html: "<html><body><p>Kurto.</p></body></html>",
        url: "https://example.test/rascunho",
        fetchedAt: new Date().toISOString(),
      }),
      translateWithProvider: async () => {
        throw new Error("tradução não deveria ser chamada");
      },
      generateEditorialSuggestion: async () => {
        throw new Error("IA não deveria ser chamada");
      },
    },
  });

  assert.equal(result.results[0].status, "needs_review");
  assert.equal(result.results[0].stage, "extraction");

  const row = db
    .prepare("SELECT pipeline_stage, extract_status FROM rss_items WHERE id=?")
    .get(itemId);
  assert.equal(row.pipeline_stage, "needs_review");
  assert.equal(row.extract_status, "failed");

  const stages = (await listSuggestions(env.DB, { rssItemId: itemId })).map(
    (entry) => entry.stage,
  );
  assert.deepEqual(stages, ["extraction"]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM news").get().total,
    0,
  );
});

test("pipeline skips cross-feed duplicates after the first canonical item", async () => {
  const db = testDb();
  const env = testEnv(db, {
    OPENROUTER_API_KEY: "sk-teste",
    PIPELINE_MIN_WORDS: 5,
  });
  const link = "https://example.test/materia-unica";
  const first = seedRssItem(db, {
    feedName: "Fonte A",
    feedUrl: "https://a.test/feed.xml",
    link,
    itemKey: "key-a",
  });
  const second = seedRssItem(db, {
    feedName: "Fonte B",
    feedUrl: "https://b.test/feed.xml",
    link,
    itemKey: "key-b",
  });

  for (const seed of [first, second]) {
    await enqueueRssItems(env.DB, {
      feedId: seed.feedId,
      feedName: seed.feedId === first.feedId ? "Fonte A" : "Fonte B",
      items: [
        {
          id: seed.itemId,
          itemKey: seed.itemId === first.itemId ? "key-a" : "key-b",
          link,
          title: "Matéria única",
        },
      ],
    });
  }

  const deps = {
    fetchPublicHtml: async () => ({
      html: articleHtml,
      url: link,
      fetchedAt: new Date().toISOString(),
    }),
    translateWithProvider: async (texts) =>
      texts.map((entry) => ({ id: entry.id, text: entry.text })),
    generateEditorialSuggestion: async () => ({
      status: "suggested",
      provider: "openrouter",
      model: "teste/redator",
      title: "Matéria reescrita",
      summary: "Resumo.",
      body: "Corpo editorial suficiente para a sugestão.",
    }),
  };

  await processQueueItems(env.DB, env, { limit: 1, deps });
  const secondPass = await processQueueItems(env.DB, env, { limit: 1, deps });

  assert.equal(secondPass.results[0].status, "duplicate");
  assert.equal(
    db
      .prepare("SELECT pipeline_stage FROM rss_items WHERE id=?")
      .get(second.itemId).pipeline_stage,
    "duplicate",
  );
  assert.equal(
    (
      await listSuggestions(env.DB, { rssItemId: second.itemId, stage: "rewrite" })
    ).length,
    0,
  );
});

test("pipeline routes expose queue and suggestions without publishing", async () => {
  const db = testDb();
  const env = testEnv(db, { OPENROUTER_API_KEY: "sk-teste" });
  const { feedId, itemId } = seedRssItem(db, {
    link: "https://example.test/rota",
  });

  const empty = await worker.fetch(
    apiRequest("/api/editor/pipeline/queue"),
    env,
  );
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).total, 0);

  const enqueued = await worker.fetch(
    apiRequest("/api/editor/pipeline/enqueue", "POST", { rssItemId: itemId }),
    env,
  );
  assert.equal(enqueued.status, 200);
  assert.equal((await enqueued.json()).enqueued, 1);

  const queue = await worker.fetch(
    apiRequest("/api/editor/pipeline/queue?status=pending"),
    env,
  );
  assert.equal((await queue.json()).total, 1);

  // Evita acesso à rede neste teste de rota: o job RSS já foi concluído.
  db.prepare("UPDATE ingestion_queue SET status='done' WHERE source_type='rss'")
    .run();

  // Um job de fonte não RSS é encerrado sem acessar a rede.
  db.prepare(
    `INSERT INTO ingestion_queue (source_type, source_id, item_key, status, payload_json)
     VALUES ('twitter', 0, 'job-twitter', 'pending', ?)`,
  ).run(JSON.stringify({ rssItemId: itemId }));

  const processed = await worker.fetch(
    apiRequest("/api/editor/pipeline/process", "POST", { limit: 5 }),
    env,
  );
  assert.equal(processed.status, 200);
  const processedBody = await processed.json();
  assert.equal(processedBody.claimed, 1);
  assert(
    processedBody.results.some((entry) => entry.status === "unsupported"),
  );

  const suggestions = await worker.fetch(
    apiRequest("/api/editor/pipeline/suggestions"),
    env,
  );
  assert.equal(suggestions.status, 200);
  const suggestionBody = await suggestions.json();
  assert.equal(suggestionBody.ai.translation.provider, "openrouter");
  assert(!JSON.stringify(suggestionBody).includes("sk-teste"));

  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM news").get().total,
    0,
  );
  assert.equal(
    db.prepare("SELECT imported_at FROM rss_items WHERE id=?").get(itemId)
      .imported_at,
    null,
  );
  assert.equal(feedId > 0, true);
});

test("source profiles route each feed to its own extraction rule", async () => {
  assert.equal(sourceProfile({ feed_name: "Anime News Network" }).name, "ann");
  assert.equal(
    sourceProfile({ feed_name: "Anime News Network" }).forceTranslation,
    true,
  );
  assert.equal(sourceProfile({ feed_name: "OtakuPT" }).dropSocial, true);
  assert.equal(sourceProfile({ feed_name: "CR News" }).name, "crnews");
  assert.equal(sourceProfile({ feed_name: "ANMTV" }).rssFirst, true);

  const db = testDb();
  const env = testEnv(db, {
    OPENROUTER_API_KEY: "sk-teste",
    PIPELINE_MIN_WORDS: 5,
  });
  const { feedId, itemId } = seedRssItem(db, {
    feedName: "ANMTV",
    content:
      "A segunda temporada foi anunciada durante o evento no Japão com equipe original retornando.",
  });

  await enqueueRssItems(env.DB, {
    feedId,
    feedName: "ANMTV",
    items: [
      {
        id: itemId,
        itemKey: "anmtv-key",
        link: `https://example.test/anmtv-${itemId}`,
        title: "Anúncio da temporada",
        content:
          "A segunda temporada foi anunciada durante o evento no Japão com equipe original retornando.",
      },
    ],
  });

  let fetchCalled = false;
  const result = await processQueueItems(env.DB, env, {
    deps: {
      fetchPublicHtml: async () => {
        fetchCalled = true;
        throw new Error("fetch não deveria ser chamado");
      },
      translateWithProvider: async () => {
        throw new Error("tradução não deveria ser chamada");
      },
      generateEditorialSuggestion: async () => ({
        status: "suggested",
        provider: "openrouter",
        model: "teste/redator",
        title: "Temporada anunciada",
        summary: "Anúncio no Japão.",
        body: "A segunda temporada foi anunciada durante o evento no Japão.",
      }),
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.results[0].status, "suggested");
  const row = db
    .prepare("SELECT extract_status, extracted_json FROM rss_items WHERE id=?")
    .get(itemId);
  assert.equal(row.extract_status, "ok");
  assert.equal(JSON.parse(row.extracted_json).report.selectors[0], "rss");
});

test("cron trigger requires a secret and processes only a bounded batch", async () => {
  const db = testDb();
  const env = testEnv(db, { CRON_SECRET: "segredo-cron" });

  const denied = await worker.fetch(
    apiRequest("/api/cron/pipeline", "POST", {}),
    env,
  );
  assert.equal(denied.status, 401);

  db.prepare(
    `INSERT INTO ingestion_queue (source_type, source_id, item_key, status, payload_json)
     VALUES ('twitter', 0, 'cron-job', 'pending', '{}')`,
  ).run();

  const allowed = await worker.fetch(
    new Request("https://vision.test/api/cron/pipeline?limit=2", {
      method: "GET",
      headers: { Authorization: "Bearer segredo-cron" },
    }),
    env,
  );
  assert.equal(allowed.status, 200);

  const body = await allowed.json();
  assert.equal(body.claimed, 1);
  assert.equal(body.results[0].status, "unsupported");
});
