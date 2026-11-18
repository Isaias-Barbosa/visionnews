
/**
 * Catálogo tipográfico do VisionNews.
 *
 * Os metadados vêm de um projeto hospedado no GitHub que publica, sem chave de
 * API, o catálogo completo do Google Fonts (1.900+ famílias):
 *   https://github.com/gridaco/fonts
 *   https://fonts.grida.co/webfonts.json
 *
 * O Worker faz a ponte em /api/fonts/catalog para manter a política de CSP e
 * poder cachear a resposta. Este módulo guarda uma cópia local para funcionar
 * mesmo quando a rede falha.
 */
(function (root) {
  const CACHE_KEY = "visionnews.fontCatalog.v2";
  const ENDPOINT = "/api/fonts/catalog";
  const FALLBACKS = ["https://fonts.grida.co/webfonts.json"];

  let catalog = null;
  let loading = null;
  const queued = new Set();
  let sheetTimer = null;

  const escape = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
    );

  function normalize(items) {
    if (!Array.isArray(items)) return [];

    return items
      .map((item) => ({
        family: String(item.family || "").trim(),
        category: String(item.category || "sans-serif").trim(),
        variants: Array.isArray(item.variants) ? item.variants : [],
        subsets: Array.isArray(item.subsets) ? item.subsets : [],
      }))
      .filter((item) => item.family && item.family.length <= 80)
      .sort((a, b) => a.family.localeCompare(b.family, "pt-BR"));
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.items) || parsed.items.length < 500) return null;
      const items = normalize(parsed.items);
      return {
        items,
        count: items.length,
        source: parsed.source || "cache",
        cachedAt: parsed.cachedAt || "",
      };
    } catch {
      return null;
    }
  }

  function writeCache(value) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          items: value.items,
          source: value.source,
          cachedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Armazenamento cheio ou desabilitado: o catálogo continua em memória.
    }
  }

  async function download(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(force = false) {
    if (catalog && !force) return catalog;
    if (loading) return loading;

    loading = (async () => {
      const cached = readCache();
      if (cached && !force) {
        catalog = cached;
        return catalog;
      }

      let lastError = null;
      const urls = [ENDPOINT, ...FALLBACKS];

      for (const url of urls) {
        try {
          const data = await download(url);
          const items = normalize(data.items);
          // O catálogo completo tem ~1.900 famílias; aceitamos no mínimo 500.
          if (items.length < 500) throw Error("Catálogo incompleto.");

          catalog = {
            items,
            count: items.length,
            source: data.source || url,
            cachedAt: new Date().toISOString(),
          };
          writeCache(catalog);
          return catalog;
        } catch (error) {
          lastError = error;
        }
      }

      if (cached) {
        catalog = cached;
        return catalog;
      }

      throw Error(
        "Não foi possível carregar as fontes (" +
          (lastError?.message || "falha na rede") +
          ").",
      );
    })().finally(() => {
      loading = null;
    });

    return loading;
  }

  function all() {
    return catalog?.items || [];
  }

  function search(query, options = {}) {
    const term = String(query || "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .replace(/\s+/g, " ");
    const category = options.category || "all";
    const limit = Math.min(Number(options.limit) || 120, 1000);
    const result = [];

    for (const item of all()) {
      if (category !== "all" && item.category !== category) continue;
      if (
        term &&
        !item.family.toLocaleLowerCase("pt-BR").includes(term)
      ) {
        continue;
      }
      result.push(item);
      if (result.length >= limit) break;
    }

    return result;
  }

  function optionHtml(item) {
    const family = escape(item.family);
    return (
      '<button type="button" class="fontOption" data-font="' +
      family +
      '" role="option" aria-selected="false">' +
      '<span class="fontOptionPreview" style="font-family:&quot;' +
      family +
      '&quot;,serif">' +
      family +
      "</span>" +
      '<small>' +
      escape(item.category) +
      "</small></button>"
    );
  }

  /** Monta a lista de opções para o seletor do editor. */
  function options(query, options2 = {}) {
    const items = search(query, options2);
    return items.length
      ? items.map(optionHtml).join("")
      : '<p class="fontEmpty">Nenhuma fonte encontrada.</p>';
  }

  /** Pré-carrega fontes para as prévias do seletor. */
  function preview(query, limit = 40) {
    const families = search(query, { limit }).map((item) => item.family);
    ensure(families);
  }

  /**
   * Carrega famílias sob demanda via Google Fonts. Várias chamadas seguidas
   * são agrupadas em uma única requisição de stylesheet.
   */
  function ensure(families) {
    const valid = (Array.isArray(families) ? families : [families])
      .map((family) => root.VisionContent?.fontFamily?.(family) || "")
      .filter(Boolean)
      .slice(0, 40);

    valid.forEach((family) => queued.add(family));
    if (!queued.size || sheetTimer) return;

    sheetTimer = setTimeout(() => {
      sheetTimer = null;
      const list = [...queued];
      queued.clear();

      const url = new URL("https://fonts.googleapis.com/css2");
      list.forEach((family) => url.searchParams.append("family", family));
      url.searchParams.set("display", "swap");

      let link = document.getElementById("visionEditorFonts");
      if (!link) {
        link = document.createElement("link");
        link.id = "visionEditorFonts";
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      link.href = url.href;
    }, 60);
  }

  root.VisionFonts = {
    load,
    all,
    search,
    options,
    optionHtml,
    preview,
    ensure,
    get count() {
      return all().length;
    },
  };
})(globalThis);
