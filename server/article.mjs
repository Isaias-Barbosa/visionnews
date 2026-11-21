import { canonicalUrl } from "./dedup.mjs";
import { extractStyleHints } from "./rss.mjs";

const MAX_HTML = 500000;
const MAX_CONTENT = 100000;
const DEFAULT_MIN_WORDS = 120;
const limited = (value, max) => String(value ?? "").trim().slice(0, max);
const SOCIAL_BLOCK =
  /^(?:compartilh(?:ar|e)|share|tweet|twittar|seguir(?:[- ]nos)?|follow us|instagram|twitter|facebook|whatsapp|telegram)\b/i;

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = parseInt(code, 16);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function inlineText(value) {
  return stripTags(decodeEntities(stripTags(value)))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaValue(html, key) {
  const name = escapeRegExp(key);
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*?(?:property|name)=["']${name}["'][^>]*?content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${name}["'][^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return inlineText(match[1]);
  }

  return "";
}

function canonicalLink(html) {
  const patterns = [
    /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return inlineText(match[1]);
  }

  return "";
}

function absoluteUrl(value, base) {
  const raw = inlineText(value);
  if (!raw) return "";

  try {
    const url = new URL(raw, base || undefined);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function stripNoise(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function pickScope(html) {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article?.[1]?.trim()) {
    return { html: article[1], selectors: ["article"] };
  }

  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main?.[1]?.trim()) {
    return { html: main[1], selectors: ["main"] };
  }

  return { html, selectors: ["body"] };
}

function extractBlocks(scopeHtml, dropSocial) {
  const pattern = /<(h1|h2|h3|h4|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  let match;

  while ((match = pattern.exec(scopeHtml))) {
    const text = inlineText(match[2]);
    if (text.length < 2) continue;
    if (dropSocial && SOCIAL_BLOCK.test(text)) continue;
    blocks.push({ tag: match[1].toLowerCase(), text });
  }

  return blocks;
}

/**
 * Extrai um artigo completo sem inventar conteúdo.
 * O objeto `item` tem o mesmo contrato de `normalizeItem()` do RSS.
 * O `report` indica se há material suficiente para seguir no pipeline.
 */
export function extractArticleDetailed(input = {}) {
  const html = String(input.html || "").slice(0, MAX_HTML);
  const sourceUrl = inlineText(input.url);
  const options = input.options || {};
  const minWords = Number.isFinite(options.minWords)
    ? Math.max(0, Math.min(1000, options.minWords))
    : DEFAULT_MIN_WORDS;
  const dropSocial = options.dropSocial !== false;

  const scope = pickScope(stripNoise(html));
  const blocks = extractBlocks(scope.html, dropSocial);

  const canonical = canonicalUrl(canonicalLink(html), sourceUrl);
  const base = canonical || sourceUrl;

  const h1 = blocks.find((block) => block.tag === "h1")?.text || "";
  const title = limited(
    h1 ||
      metaValue(html, "og:title") ||
      metaValue(html, "twitter:title") ||
      inlineText((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]) ||
      blocks.find((block) => block.tag === "h2")?.text,
    500,
  );

  const titleKey = title.toLocaleLowerCase("pt-BR");
  const paragraphs = blocks.filter(
    (block) =>
      !(block.tag === "h1" && block.text.toLocaleLowerCase("pt-BR") === titleKey),
  );

  const content = paragraphs
    .map((block) => block.text)
    .join("\n\n")
    .slice(0, MAX_CONTENT);
  const summary = limited(
    paragraphs.find((block) => block.text.length >= 40)?.text ||
      paragraphs[0]?.text ||
      "",
    5000,
  );

  const imageMatch = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(scope.html);
  const image = absoluteUrl(
    metaValue(html, "og:image") ||
      metaValue(html, "twitter:image") ||
      imageMatch?.[1],
    base,
  );

  const author = limited(
    metaValue(html, "author") || metaValue(html, "article:author"),
    160,
  );
  const siteName = limited(metaValue(html, "og:site_name"), 160);
  const language = limited(
    inlineText((/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html) || [])[1]),
    20,
  );

  const publishedRaw =
    metaValue(html, "article:published_time") ||
    metaValue(html, "date") ||
    inlineText((/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i.exec(html) || [])[1]);
  const parsedDate = publishedRaw ? new Date(publishedRaw) : null;
  const publishedAt =
    parsedDate && Number.isFinite(parsedDate.getTime())
      ? parsedDate.toISOString()
      : null;

  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const reasons = [];
  if (!title) reasons.push("título não encontrado");
  if (!content) reasons.push("texto não encontrado");
  else if (wordCount < minWords) {
    reasons.push(`texto insuficiente (${wordCount} palavras)`);
  }

  return {
    item: {
      guid: limited(canonical || base || title, 1000),
      title,
      summary,
      content,
      style: extractStyleHints([html]),
      link: canonical || absoluteUrl(sourceUrl),
      image,
      author,
      publishedAt,
    },
    report: {
      ok: reasons.length === 0,
      reasons,
      canonical,
      language,
      siteName,
      wordCount,
      blockCount: paragraphs.length,
      selectors: scope.selectors,
    },
  };
}

/** Atalho com o contrato de `normalizeItem()`; use `extractArticleDetailed` no pipeline. */
export function extractArticle(input) {
  return extractArticleDetailed(input).item;
}
