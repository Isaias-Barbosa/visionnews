import {
  aiStatus,
  generateEditorialSuggestion as defaultGenerateEditorialSuggestion,
  translationProvider,
  translateWithProvider as defaultTranslateWithProvider,
} from "./ai.mjs";
import { extractArticleDetailed } from "./article.mjs";
import { canonicalItemKey, legacyItemKey, normalizeTitle } from "./dedup.mjs";
import {
  claimQueueItems,
  countQueueByStatus,
  enqueueQueueItems,
  finishQueueItem,
  getRssItemForPipeline,
  insertSuggestion,
  registerDedup,
  releaseQueueItems,
  requeueStaleQueueItems,
  sourceHash,
  updateRssItemPipeline,
} from "./queue.mjs";
import { fetchPublicHtml as defaultFetchPublicHtml } from "./rss.mjs";

const PORTUGUESE = /^pt(?:[-_]|$)/i;
const MAX_SUGGESTION_LENGTH = 50000;

const countWords = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/** Perfis leves: cada fonte mantém sua regra sem acoplar o extrator. */
export function sourceProfile(item = {}) {
  const label =
    `${item.feed_name || ""} ${item.feed_site_url || ""}`.toLowerCase();

  if (/anime\s*news\s*network|animenewsnetwork|\bann\b/.test(label)) {
    return { name: "ann", forceTranslation: true, alwaysFetch: true };
  }
  if (/otaku\s*pt|otakupt/.test(label)) {
    return { name: "otakupt", dropSocial: true, alwaysFetch: true };
  }
  if (/cr\s*news|crunchyroll/.test(label)) {
    return { name: "crnews", alwaysFetch: true };
  }
  if (/anmtv|anime\s*tv/.test(label)) {
    return { name: "anmtv", rssFirst: true };
  }
  return { name: "generic", alwaysFetch: true };
}

/** Enfileira itens RSS recém-persistidos. Nunca cria rascunho nem publica. */
export async function enqueueRssItems(DB, input = {}) {
  if (!DB || !Array.isArray(input.items) || !input.items.length) {
    return { enqueued: 0, skipped: 0, ids: [] };
  }

  const feedId = Number(input.feedId) || 0;
  const feedName = String(input.feedName || "").slice(0, 120);

  const queueItems = input.items
    .filter((item) => item && Number(item.id) > 0)
    .map((item) => ({
      sourceType: "rss",
      sourceId: feedId,
      itemKey: String(item.itemKey || legacyItemKey(item)).slice(0, 500),
      canonicalKey: canonicalItemKey(item),
      priority: 0,
      payload: {
        rssItemId: Number(item.id),
        feedId,
        feedName,
        link: String(item.link || ""),
        title: String(item.title || ""),
        summary: String(item.summary || ""),
        content: String(item.content || ""),
        image: String(item.image || ""),
      },
    }));

  return enqueueQueueItems(DB, queueItems);
}

function depsFor(options) {
  return {
    fetchPublicHtml: defaultFetchPublicHtml,
    translateWithProvider: defaultTranslateWithProvider,
    generateEditorialSuggestion: defaultGenerateEditorialSuggestion,
    now: () => new Date().toISOString(),
    ...(options.deps || {}),
  };
}

async function failJob(DB, job, deps, stage, reason, extraFields = {}) {
  const message = Array.isArray(reason) ? reason.join("; ") : String(reason || "");
  const hash = sourceHash(`${job.id}|${stage}|${message}`);

  try {
    await insertSuggestion(DB, {
      rssItemId: job.payload?.rssItemId || null,
      stage,
      provider: stage === "extraction" ? "extractor" : "pipeline",
      model: null,
      sourceHash: hash,
      status: "error",
      error: message,
      payload: { queueId: job.id, reason: message },
    });
  } catch {
    // A revisão continua disponível mesmo se o registro da sugestão falhar.
  }

  await updateRssItemPipeline(DB, job.payload?.rssItemId, {
    pipeline_stage: "needs_review",
    extract_status: stage === "extraction" ? "failed" : extraFields.extractStatus,
    last_pipeline_error: message.slice(0, 1000),
    ...extraFields,
  });

  await finishQueueItem(DB, job.id, {
    status: stage === "review" ? "failed" : "skipped",
    error: message.slice(0, 1000),
  });

  return { id: job.id, status: "needs_review", reason: message, stage };
}

async function translateFacts(facts, language, env, deps, force = false) {
  if (!force && PORTUGUESE.test(language || "pt")) {
    return { facts, translation: null };
  }

  const texts = [
    { id: "title", text: facts.title },
    { id: "summary", text: facts.summary },
    { id: "content", text: facts.content },
  ].filter((item) => item.text);

  if (!texts.length) {
    throw new Error("não há fatos verificáveis para traduzir");
  }

  const translated = await deps.translateWithProvider(texts, env, {
    provider: translationProvider(env),
  });
  const byId = new Map(translated.map((item) => [item.id, item.text]));

  return {
    facts: {
      title: byId.get("title") || facts.title,
      summary: byId.get("summary") || facts.summary,
      content: byId.get("content") || facts.content,
    },
    translation: {
      provider: translationProvider(env),
      model: aiStatus(env).translation.model,
      from: language || "unknown",
      to: "pt-BR",
      texts: translated,
    },
  };
}

async function processRssJob(DB, env, deps, job) {
  const rssItemId = Number(job.payload?.rssItemId);
  if (!Number.isSafeInteger(rssItemId) || rssItemId < 1) {
    return failJob(DB, job, deps, "review", "item RSS inválido na fila");
  }

  const item = await getRssItemForPipeline(DB, rssItemId);
  if (!item) {
    return failJob(DB, job, deps, "review", "item RSS não encontrado");
  }

  const canonicalKey =
    String(item.canonical_key || "").trim() ||
    canonicalItemKey({ guid: item.guid, link: item.link, title: item.title });

  if (!canonicalKey) {
    return failJob(
      DB,
      job,
      deps,
      "review",
      "não foi possível determinar a chave canônica",
    );
  }

  await updateRssItemPipeline(DB, rssItemId, { canonical_key: canonicalKey });

  if (item.imported_news_id) {
    await updateRssItemPipeline(DB, rssItemId, {
      pipeline_stage: "imported",
    });
    await finishQueueItem(DB, job.id, {
      status: "done",
      newsId: Number(item.imported_news_id),
    });
    return { id: job.id, status: "already_imported" };
  }

  const dedup = await registerDedup(DB, {
    canonicalKey,
    titleKey: normalizeTitle(item.title),
    url: item.link,
    sourceType: "rss",
    sourceId: job.source_id,
    itemKey: job.item_key,
    newsId: null,
  });

  const owner =
    dedup.item &&
    dedup.item.source_type === "rss" &&
    Number(dedup.item.source_id) === Number(job.source_id) &&
    String(dedup.item.item_key || "") === String(job.item_key || "");

  if (!dedup.created && !owner) {
    await updateRssItemPipeline(DB, rssItemId, {
      pipeline_stage: "duplicate",
      extract_status: "not_run",
    });
    await finishQueueItem(DB, job.id, {
      status: "skipped",
      error: "duplicata de outra fonte",
    });
    return { id: job.id, status: "duplicate", canonicalKey };
  }

  const profile = sourceProfile(item);
  const configuredMinWords = Number(env.PIPELINE_MIN_WORDS);
  const minWords =
    Number.isFinite(configuredMinWords) && configuredMinWords > 0
      ? configuredMinWords
      : 120;
  const rssWordCount = countWords(item.content);
  const useRssContent = profile.rssFirst && rssWordCount >= minWords;

  let fetched = {
    url: item.link,
    fetchedAt: null,
    html: "",
  };
  let extracted;

  if (useRssContent) {
    extracted = {
      item: {
        title: String(item.title || ""),
        summary: String(item.summary || ""),
        content: String(item.content || ""),
        style: item.style,
        link: item.link,
        image: item.image_url,
        author: item.author,
        publishedAt: item.published_at,
      },
      report: {
        ok: true,
        reasons: [],
        canonical: item.link,
        language: "pt",
        siteName: item.feed_name,
        wordCount: rssWordCount,
        blockCount: 1,
        selectors: ["rss"],
      },
    };
  } else {
    try {
      fetched = await deps.fetchPublicHtml(item.link);
    } catch (error) {
      return failJob(DB, job, deps, "extraction", error?.message || error, {
        extractStatus: "fetch_failed",
      });
    }

    extracted = extractArticleDetailed({
      html: fetched.html,
      url: fetched.url || item.link,
      options: {
        minWords,
        dropSocial: profile.dropSocial !== false,
      },
    });
  }

  if (!extracted.report.ok) {
    return failJob(DB, job, deps, "extraction", extracted.report.reasons, {
      extractStatus: "failed",
      sourceLanguage: extracted.report.language || null,
      extracted_json: {
        report: extracted.report,
        fetchedUrl: fetched.url,
        fetchedAt: fetched.fetchedAt,
      },
    });
  }

  await insertSuggestion(DB, {
    rssItemId,
    stage: "extraction",
    provider: "extractor",
    model: null,
    sourceHash: sourceHash(`${canonicalKey}|${extracted.item.content}`),
    status: "suggested",
    payload: {
      report: extracted.report,
      item: {
        title: extracted.item.title,
        summary: extracted.item.summary,
        link: extracted.item.link,
        image: extracted.item.image,
        author: extracted.item.author,
        publishedAt: extracted.item.publishedAt,
      },
    },
  });

  let translated;
  try {
    translated = await translateFacts(
      {
        title: extracted.item.title || item.title,
        summary: extracted.item.summary || item.summary,
        content: extracted.item.content,
      },
      extracted.report.language,
      env,
      deps,
      profile.forceTranslation === true,
    );
  } catch (error) {
    return failJob(DB, job, deps, "translation", error?.message || error, {
      extractStatus: "ok",
      sourceLanguage: extracted.report.language || null,
      extracted_json: {
        report: extracted.report,
        fetchedUrl: fetched.url,
        fetchedAt: fetched.fetchedAt,
      },
    });
  }

  if (translated.translation) {
    await insertSuggestion(DB, {
      rssItemId,
      stage: "translation",
      provider: translated.translation.provider,
      model: translated.translation.model,
      sourceHash: sourceHash(
        `${canonicalKey}|${extracted.report.language}|${extracted.item.content}`,
      ),
      status: "suggested",
      payload: translated.translation,
    });
  }

  const facts = translated.facts;
  let suggestion;

  try {
    suggestion = await deps.generateEditorialSuggestion(
      {
        title: facts.title,
        summary: facts.summary,
        content: facts.content,
        sourceUrl: extracted.item.link || item.link,
        sourceLabel: item.feed_name || "Fonte",
      },
      env,
    );
  } catch (error) {
    return failJob(DB, job, deps, "rewrite", error?.message || error, {
      extractStatus: "ok",
      translationStatus: translated.translation ? "suggested" : "not_required",
      sourceLanguage: extracted.report.language || null,
      extracted_json: {
        report: extracted.report,
        fetchedUrl: fetched.url,
        fetchedAt: fetched.fetchedAt,
        translation: translated.translation,
      },
    });
  }

  const status = suggestion?.status === "suggested" ? "suggested" : "needs_review";
  const reasons = Array.isArray(suggestion?.reasons) ? suggestion.reasons : [];
  const hash = sourceHash(`${canonicalKey}|${facts.title}|${facts.content}`);

  await insertSuggestion(DB, {
    rssItemId,
    stage: "rewrite",
    provider: suggestion?.provider || "openrouter",
    model: suggestion?.model || null,
    sourceHash: hash,
    status: status === "suggested" ? "suggested" : "error",
    error: reasons.join("; ") || null,
    payload: suggestion,
  });

  await updateRssItemPipeline(DB, rssItemId, {
    pipeline_stage: status,
    extract_status: "ok",
    translation_status: translated.translation ? "suggested" : "not_required",
    source_language: extracted.report.language || null,
    last_pipeline_error: reasons.join("; ").slice(0, 1000) || null,
    extracted_json: {
      report: extracted.report,
      fetchedUrl: fetched.url,
      fetchedAt: fetched.fetchedAt,
      translation: translated.translation,
      facts: {
        title: String(facts.title || "").slice(0, MAX_SUGGESTION_LENGTH),
        summary: String(facts.summary || "").slice(0, MAX_SUGGESTION_LENGTH),
      },
    },
  });

  await finishQueueItem(DB, job.id, {
    status: status === "suggested" ? "done" : "skipped",
    error: reasons.join("; ").slice(0, 1000) || null,
  });

  return {
    id: job.id,
    status,
    rssItemId,
    canonicalKey,
    provider: suggestion?.provider,
    model: suggestion?.model,
  };
}

/**
 * Processa um lote da fila. A injeção de `deps` permite testar sem rede.
 * Nenhuma sugestão é aplicada: tudo volta para revisão manual.
 */
export async function processQueueItems(DB, env = {}, options = {}) {
  if (!DB) {
    return { claimed: 0, processed: 0, results: [], error: "Banco indisponível." };
  }

  const deps = depsFor(options);
  // Lots pequenos e orçamento de tempo evitam 504 na Vercel: o que não couber
  // volta para pending e é retomado na próxima chamada.
  const limit = Math.min(5, Math.max(1, Number(options.limit) || 3));
  const configuredMaxMs = Number(options.maxMs);
  const maxMs = Number.isFinite(configuredMaxMs)
    ? Math.min(25000, Math.max(0, configuredMaxMs))
    : 20000;
  const stale = options.skipStale
    ? { released: 0 }
    : await requeueStaleQueueItems(DB, {
        olderThanMs: options.staleMs || 120000,
      });
  const claimed = await claimQueueItems(DB, { limit });
  const results = [];
  const startedAt = Date.now();
  let released = [];

  for (let index = 0; index < claimed.length; index++) {
    if (Date.now() - startedAt >= maxMs) {
      released = claimed.slice(index);
      break;
    }

    const job = claimed[index];
    try {
      if (job.source_type !== "rss") {
        await finishQueueItem(DB, job.id, {
          status: "skipped",
          error: "tipo de fonte não suportado",
        });
        results.push({ id: job.id, status: "unsupported" });
        continue;
      }

      results.push(await processRssJob(DB, env, deps, job));
    } catch (error) {
      results.push(
        await failJob(DB, job, deps, "review", error?.message || error),
      );
    }
  }

  if (released.length) await releaseQueueItems(DB, released);

  return {
    claimed: claimed.length,
    processed: results.length,
    released: released.length,
    recovered: stale.released,
    results,
    counts: await countQueueByStatus(DB),
  };
}
