import { createHash } from "node:crypto";

// Parâmetros que não identificam conteúdo e costumam variar por campanha/rede.
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
]);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const limited = (value, max) => String(value ?? "").trim().slice(0, max);

/** Remove acentos, pontuação e caixa para comparar títulos de fontes distintas. */
export function normalizeTitle(value) {
  return limited(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** URL canônica para deduplicação; nunca é usada como fonte de navegação. */
export function canonicalUrl(value, base = "") {
  const raw = limited(value, 2000);
  if (!raw) return "";

  let url;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return "";
  }

  if (!["http:", "https:"].includes(url.protocol)) return "";
  if (url.username || url.password) return "";

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  for (const name of [...url.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(name);
    }
  }
  url.searchParams.sort();

  const path = url.pathname.length > 1
    ? url.pathname.replace(/\/+$/, "")
    : "";
  const query = url.searchParams.toString();

  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
}

/** Chave usada hoje pelo RSS; preservada para não alterar o UPSERT existente. */
export function legacyItemKey(item) {
  const identity = item?.guid || item?.link || item?.title;
  return hash(String(identity).trim().toLowerCase());
}

/** Chave cross-feed, somente leitura nesta fase do projeto. */
export function canonicalItemKey(item) {
  const url = canonicalUrl(item?.link);
  if (url) return `url:${hash(url)}`;

  const title = normalizeTitle(item?.title);
  if (title) return `title:${hash(title)}`;

  const guid = limited(item?.guid, 1000).toLocaleLowerCase("pt-BR");
  if (guid) return `guid:${hash(guid)}`;

  return "";
}

/** Agrupa itens que apontam para o mesmo fato em fontes diferentes. */
export function findCrossFeedDuplicates(items) {
  const groups = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const key = canonicalItemKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, items: group }));
}
