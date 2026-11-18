const $ = (id) => document.getElementById(id),
  fields = [
    "title",
    "summary",
    "category",
    "author",
    "cover",
    "source_url",
    "source_label",
    "status",
    "anime_title",
    "review_verdict",
    "topic",
    "tags",
  ],
  calendarFields = [
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
let news = [],
  schedule = [],
  recommendations = [],
  current = null,
  dirty = false,
  busy = false,
  ready = false,
  module = "news",
  pendingRss = null,
  rssWorkspace = null,
  bulkSelected = new Set(),
  bulkVisible = [],
  trendingItems = [],
  trendingLoading = false,
  seasonItems = [],
  seasonSelected = new Set(),
  seasonLoading = false;
const names = {
    draft: "Rascunho",
    published: "Publicado",
    archived: "Arquivado",
  },
  dayNames = [
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
    "Domingo",
  ];
const esc = VisionContent.escape;
const recommendationFields = [
  "feature_date",
  "title",
  "summary",
  "cover",
  "status",
];
const streamFields = Array.from({ length: 5 }, (_, i) => i);
$("streamFields").innerHTML = streamFields
  .map(
    (i) =>
      `<div class="formColumns"><label>Plataforma ${i + 1}<input id="streamName${i}" maxlength="60" placeholder="Ex.: Crunchyroll"></label><label>Link oficial ${i + 1}<input id="streamUrl${i}" type="url" maxlength="2000" placeholder="https://…"></label></div>`,
  )
  .join("");
const moduleItems = () =>
  ({
    news: news.filter((item) => item.category !== "Reviews"),
    reviews: news.filter((item) => item.category === "Reviews"),
    schedule,
    recommendations,
  })[module];
const todayInBrasilia = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
async function api(path, options = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error("O servidor não respondeu como esperado. Tente novamente.");
  }
  if (!r.ok) throw Error(data.error || "Não foi possível concluir a operação.");
  return data;
}
function allowLeave() {
  return !dirty || confirm("Há alterações não salvas. Deseja descartá-las?");
}
const featuredDecision = () =>
  news
    .filter((item) => item.featured_at)
    .sort(
      (a, b) => b.featured_at.localeCompare(a.featured_at) || b.id - a.id,
    )[0];
function reviewVisibility() {
  $("featuredFields").hidden = $("category").value !== "Notícias";
  $("reviewFields").hidden = $("category").value !== "Reviews";
  $("category").disabled = module === "reviews";
  $("category").querySelector("option[value=Reviews]").disabled =
    module !== "reviews";
}
function buttonLabel() {
  $("saveButton").textContent =
    $("status").value === "published"
      ? "Salvar e publicar"
      : $("status").value === "archived"
        ? "Salvar como arquivado"
        : "Salvar rascunho";
}
let coverTimer;
function coverPreview() {
  clearTimeout(coverTimer);
  coverTimer = setTimeout(() => {
    const raw = $("cover").value.trim(),
      url = VisionContent.https(raw);
    $("coverPreview").hidden = !raw;
    if (!raw) {
      $("coverImage").removeAttribute("src");
      return;
    }
    if (!url) {
      $("coverImage").hidden = true;
      $("coverStatus").textContent = "Use um endereço HTTPS de imagem.";
      return;
    }
    $("coverImage").hidden = false;
    $("coverStatus").textContent = "Carregando a capa…";
    $("coverImage").onload = () => {
      $("coverStatus").textContent =
        "Capa carregada. Ela aparecerá no card e na leitura.";
    };
    $("coverImage").onerror = () => {
      $("coverImage").hidden = true;
      $("coverStatus").textContent =
        "Não foi possível carregar esta imagem. Confira o endereço ou use outra fonte autorizada.";
    };
    $("coverImage").src = url;
  }, 250);
}
function showRssNote(pending) {
  const note = $("rssNote");

  if (!pending) {
    note.hidden = true;
    note.innerHTML = "";
    return;
  }

  note.hidden = false;
  note.innerHTML = `<strong>Importação RSS:</strong> ${esc(pending.title)}${
    pending.feedName ? " · " + esc(pending.feedName) : ""
  }. Revise o texto, confira a fonte e salve. O item será marcado como cadastrado depois que este rascunho for salvo.`;
}

function rssPrefill(item, feed) {
  const feedName = String(
    feed?.name || item?.feed_name || "Fonte RSS",
  ).slice(0, 120);
  const rawTitle = String(item?.title || "").trim();
  const title = (rawTitle || "Notícia recebida via RSS").slice(0, 160);
  let summary = String(item?.summary || item?.content || "").trim();

  if (summary.length > 350) summary = `${summary.slice(0, 347).trimEnd()}...`;
  if (summary.length < 15) {
    summary = `${title} — matéria recebida de ${feedName}.`.slice(0, 350);
  }

  let body = String(item?.content || item?.summary || "").trim().slice(0, 50000);
  if (body.length < 40) {
    body = `${body}\n\nNotícia recebida de ${feedName}. Revise, complemente e confira a fonte antes de publicar.`.trim();
  }

  const style = item?.style || null;
  const hasStyle = Boolean(
    style &&
      ((style.fonts || []).length ||
        (style.colors || []).length ||
        (style.backgrounds || []).length),
  );

  return {
    title,
    summary,
    style,
    body: hasStyle
      ? JSON.stringify(VisionContent.fromPlainStyled(body, style))
      : body,
    body_format: hasStyle ? "rich-v1" : "plain",
    category: "Notícias",
    author: "Redação VisionNews",
    cover: VisionContent.https(item?.image_url || item?.image) || "",
    source_url: VisionContent.https(item?.link) || "",
    source_label: feedName,
    status: "draft",
    featured: false,
    review_score: "",
  };
}

function trendingSummary(anime) {
  let summary = String(anime?.summary || "").trim();

  if (summary.length < 15) {
    const genres = (anime?.genres || []).slice(0, 3).join(", ");
    summary = `${anime?.title || "Este anime"} está entre os animes em alta no AniList${
      genres ? ` (${genres})` : ""
    }. Revise a sinopse oficial e escreva por que vale a pena assistir.`;
  }

  if (summary.length > 600) summary = summary.slice(0, 597).trimEnd() + "…";
  return summary;
}

function renderTrending() {
  $("trendingList").innerHTML = trendingItems.length
    ? trendingItems
        .map(
          (anime) => `<article class="animeSuggestCard">
            ${
              anime.cover
                ? `<img src="${esc(anime.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : ""
            }
            <div class="animeSuggestBody">
              <small>${esc(
                [anime.format, anime.score ? `Nota ${anime.score}` : ""]
                  .filter(Boolean)
                  .join(" · ") || "Anime",
              )}</small>
              <h3>${esc(anime.title)}</h3>
              <p>${esc(String(anime.summary || "").slice(0, 150))}</p>
              <button type="button" class="outlineButton" data-trending="${esc(
                anime.anime_id,
              )}">Usar sugestão</button>
            </div>
          </article>`,
        )
        .join("")
    : '<p class="animeSuggestEmpty">Nenhuma sugestão carregada ainda.</p>';
}

async function loadTrending(force = false) {
  if (trendingLoading) return;
  if (!force && trendingItems.length) return;

  trendingLoading = true;
  $("trendingRefresh").disabled = true;
  $("trendingStatus").textContent = "Carregando sugestões do AniList…";

  try {
    const { items } = await api("/api/editor/anime/trending?limit=12");
    trendingItems = Array.isArray(items) ? items : [];
    renderTrending();
    $("trendingStatus").textContent = trendingItems.length
      ? "Sugestões do AniList. A publicação continua manual e passa pela revisão."
      : "O AniList não retornou animes em alta agora.";
  } catch (error) {
    $("trendingStatus").textContent = error.message;
    renderTrending();
  } finally {
    trendingLoading = false;
    $("trendingRefresh").disabled = false;
  }
}

function applyTrending(animeId) {
  if (!ready || busy) return;

  const anime = trendingItems.find(
    (item) => String(item.anime_id) === String(animeId),
  );
  if (!anime) return;
  if (!allowLeave()) return;

  edit(null);

  $("recommendation_title").value = String(anime.title || "").slice(0, 160);
  $("recommendation_summary").value = trendingSummary(anime);
  $("recommendation_cover").value = anime.cover || "";
  $("recommendation_status").value = "draft";

  const streams = Array.isArray(anime.stream_links)
    ? anime.stream_links.slice(0, streamFields.length)
    : [];

  for (const i of streamFields) {
    $("streamName" + i).value = streams[i]?.name || "";
    $("streamUrl" + i).value = streams[i]?.url || "";
  }

  dirty = true;
  $("recommendationStatus").textContent =
    "Sugestão do AniList carregada como rascunho. Confira a sinopse, os links e salve quando estiver pronto.";
  $("recommendationForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSeasonImport() {
  const dayNamesShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  $("seasonImportList").innerHTML = seasonItems.length
    ? seasonItems
        .map((item) => {
          const checked = seasonSelected.has(item.anime_id);
          const disabled = Boolean(item.imported);
          return `<label class="animeSuggestCard seasonImportCard${
            disabled ? " imported" : ""
          }">
            <span class="seasonImportCheck">
              <input type="checkbox" data-season="${esc(
                item.anime_id,
              )}" aria-label="Selecionar ${esc(item.title)}" ${
                checked ? "checked" : ""
              } ${disabled ? "disabled" : ""}>
            </span>
            ${
              item.cover
                ? `<img src="${esc(item.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : ""
            }
            <div class="animeSuggestBody">
              <small>${esc(dayNamesShort[item.weekday] || "Dia a confirmar")}${
                item.time ? ` · ${esc(item.time)} BRT` : ""
              } · ${esc(item.platform || "Plataforma a confirmar")}</small>
              <h3>${esc(item.title)}</h3>
              <p>${esc(
                [item.episode, String(item.summary || "").slice(0, 140)]
                  .filter(Boolean)
                  .join(" · "),
              )}</p>
              ${
                disabled
                  ? '<span class="animeTag">Já no calendário</span>'
                  : '<span class="animeTag suggest">Pronto para importar</span>'
              }
            </div>
          </label>`;
        })
        .join("")
    : '<p class="animeSuggestEmpty">Clique em “Buscar temporada” para consultar o AniList.</p>';

  $("seasonImportList")
    .querySelectorAll("[data-season]")
    .forEach((box) => {
      box.onchange = () => {
        const id = String(box.dataset.season);
        if (box.checked) seasonSelected.add(id);
        else seasonSelected.delete(id);
        updateSeasonImportBar();
      };
    });

  updateSeasonImportBar();
}

function updateSeasonImportBar() {
  const available = seasonItems.filter((item) => !item.imported);
  const availableIds = new Set(available.map((item) => item.anime_id));

  for (const id of [...seasonSelected])
    if (!availableIds.has(id)) seasonSelected.delete(id);

  const total = seasonSelected.size;
  $("seasonImportActions").hidden = !seasonItems.length;
  $("seasonImportSubmit").disabled = seasonLoading || total === 0;
  $("seasonImportSubmit").textContent = total
    ? `Importar ${total} selecionado${total === 1 ? "" : "s"}`
    : "Importar selecionados";
  $("seasonImportAll").checked =
    available.length > 0 &&
    available.every((item) => seasonSelected.has(item.anime_id));
  $("seasonImportAll").indeterminate =
    !$("seasonImportAll").checked &&
    available.some((item) => seasonSelected.has(item.anime_id));
}

async function loadSeasonImport() {
  if (seasonLoading) return;

  const year = Number($("seasonImportYear").value);
  const quarter = Number($("seasonImportQuarter").value);

  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    $("seasonImportStatus").textContent = "Informe um ano entre 2020 e 2100.";
    return;
  }

  seasonLoading = true;
  $("seasonImportFetch").disabled = true;
  $("seasonImportSubmit").disabled = true;
  $("seasonImportStatus").textContent =
    "Consultando a temporada no AniList (mesma fonte do AniChart)…";

  try {
    const data = await api(
      `/api/editor/anime/season?year=${year}&quarter=${quarter}`,
    );
    seasonItems = Array.isArray(data.items) ? data.items : [];
    seasonSelected.clear();
    renderSeasonImport();
    $("seasonImportStatus").textContent = seasonItems.length
      ? `${seasonItems.length} títulos com exibição semanal. Selecione os que deseja importar; todos entram como rascunho.`
      : "Nenhum título com exibição semanal foi encontrado nessa temporada.";
  } catch (error) {
    seasonItems = [];
    seasonSelected.clear();
    renderSeasonImport();
    $("seasonImportStatus").textContent = error.message;
  } finally {
    seasonLoading = false;
    $("seasonImportFetch").disabled = false;
    updateSeasonImportBar();
  }
}

async function importSeason() {
  if (seasonLoading || !seasonSelected.size) return;

  const year = Number($("seasonImportYear").value);
  const quarter = Number($("seasonImportQuarter").value);
  const ids = [...seasonSelected];

  if (
    !confirm(
      `Importar ${ids.length} exibição${ids.length === 1 ? "" : "ões"} como rascunho${
        ids.length === 1 ? "" : "s"
      }? Nada será publicado sem a sua revisão.`,
    )
  )
    return;

  seasonLoading = true;
  $("seasonImportSubmit").disabled = true;
  $("seasonImportAll").disabled = true;
  $("seasonImportStatus").textContent = "Importando para o calendário…";

  try {
    const result = await api("/api/editor/anime/season/import", {
      method: "POST",
      body: JSON.stringify({ year, quarter, ids }),
    });
    const created = Array.isArray(result.created) ? result.created : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    const createdTitles = new Set(
      created.map((item) => String(item.title || "").trim().toLowerCase()),
    );

    seasonItems = seasonItems.map((item) =>
      createdTitles.has(item.title.trim().toLowerCase())
        ? { ...item, imported: true }
        : item,
    );
    seasonSelected.clear();
    renderSeasonImport();

    await load();

    $("seasonImportStatus").textContent = `${created.length} exibição${
      created.length === 1 ? "" : "ões"
    } importada${created.length === 1 ? "" : "s"} como rascunho${
      created.length === 1 ? "" : "s"
    }. Revise e publique no calendário.${
      skipped.length
        ? ` ${skipped.length} ignorada${skipped.length === 1 ? "" : "s"}: ` +
          skipped
            .slice(0, 2)
            .map(
              (item) =>
                `${item.title || "item"} (${String(item.reason || "").slice(0, 120)})`,
            )
            .join("; ") +
          (skipped.length > 2 ? "…" : "")
        : ""
    }`;
  } catch (error) {
    $("seasonImportStatus").textContent = error.message;
  } finally {
    seasonLoading = false;
    $("seasonImportAll").disabled = false;
    updateSeasonImportBar();
  }
}

function edit(item, prefill = null, force = false) {
  if (!ready || busy || (!force && !allowLeave())) return;
  // Ao abrir uma matéria existente (ou uma matéria nova manual), o vínculo
  // pendente com o radar RSS deixa de valer.
  if (item || !prefill) pendingRss = null;

  current = item ? { ...item } : null;
  $("editorEmpty").hidden = true;
  const calendar = module === "schedule",
    recommendation = module === "recommendations";
  $("editorForm").hidden = calendar || recommendation;
  $("scheduleForm").hidden = !calendar;
  $("recommendationForm").hidden = !recommendation;
  if (recommendation) {
    for (const field of recommendationFields)
      $("recommendation_" + field).value =
        item?.[field] ??
        { feature_date: todayInBrasilia(), status: "draft" }[field] ??
        "";
    const streams = JSON.parse(item?.streams || "[]");
    for (const i of streamFields) {
      $("streamName" + i).value = streams[i]?.name || "";
      $("streamUrl" + i).value = streams[i]?.url || "";
    }
    $("recommendationMode").textContent = item
      ? "EDITANDO / #" + item.id
      : "NOVA RECOMENDAÇÃO";
    $("recommendationStatus").textContent = "";
    $("recommendation_title").focus();
  } else if (calendar) {
    const now = new Date();
    for (const f of calendarFields)
      $("schedule_" + f).value =
        item?.[f] ??
        {
          weekday: "0",
          platform: "Crunchyroll",
          language: "Legendado",
          season_year: now.getFullYear(),
          season_quarter: Math.ceil((now.getMonth() + 1) / 3),
          status: "draft",
        }[f] ??
        "";
    $("scheduleMode").textContent = item
      ? "EDITANDO EXIBIÇÃO / #" + item.id
      : "NOVA EXIBIÇÃO";
    $("scheduleStatus").textContent = "";
    $("schedule_title").focus();
  } else {
    const source = item || prefill;

    for (const f of fields)
      $(f).value =
        source?.[f] ??
        {
          category: module === "reviews" ? "Reviews" : "Notícias",
          author: "Redação VisionNews",
          status: "draft",
        }[f] ??
        "";
    $("review_score").value = source?.review_score ?? "";
    $("featured").checked = Boolean(
      source?.featured &&
      (!source.featured_at || featuredDecision()?.id === source.id),
    );
    VisionEditor.set(source?.body || "", source?.body_format || "plain");

    // Notícias vindas do radar podem trazer a tipografia da fonte original.
    if (prefill?.style && !item) {
      VisionEditor.importStyle(
        prefill.style,
        pendingRss ? "Radar RSS · " + pendingRss.feedName : "Fonte original",
      );
    }

    $("editorMode").textContent = item
      ? "EDITANDO / #" + item.id
      : prefill
        ? "NOVA NOTÍCIA / RADAR RSS" +
          (pendingRss ? " #" + pendingRss.id : "")
        : module === "reviews"
          ? "NOVA REVIEW"
          : "NOVO CONTEÚDO";
    $("editorStatus").textContent = "";
    showRssNote(prefill ? pendingRss : null);
    reviewVisibility();
    buttonLabel();
    coverPreview();
    $("title").focus();
  }
  dirty = false;
  renderList();
}

function mountRssWorkspace() {
  if (rssWorkspace) return rssWorkspace;

  if (!window.VisionRss) {
    $("rssWorkspace").innerHTML =
      '<p class="emptyList">O radar RSS não pôde ser carregado. Recarregue a página.</p>';
    return null;
  }

  rssWorkspace = window.VisionRss.mount($("rssWorkspace"), {
    mode: "dashboard",
    title: "Radar de notícias",
    subtitle:
      "Gerencie as fontes, filtre as últimas notícias e envie uma matéria para os campos do editor.",
    onImport: (item, feed) => importRssItem(item, feed),
  });

  return rssWorkspace;
}

function importRssItem(item, feed) {
  if (!item || busy || !ready || !allowLeave()) return;

  pendingRss = {
    id: Number(item.id),
    title: item.title || "Notícia RSS",
    feedName: feed?.name || item.feed_name || "Fonte RSS",
  };

  module = "news";
  current = null;
  bulkSelected.clear();

  $("rssPanel").hidden = true;
  $("globalStatus").hidden = false;
  $("stats").hidden = false;
  document.querySelector(".adminWorkspace").hidden = false;
  $("newArticle").hidden = false;
  $("editorEmpty").hidden = true;
  $("recommendationSuggest").hidden = true;
  $("scheduleSuggest").hidden = true;
  $("categoryFilter").hidden = false;

  document.querySelectorAll("[data-module]").forEach((button) => {
    const selected = button.dataset.module === "news";
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  edit(null, rssPrefill(item, feed), true);

  if (pendingRss) {
    $("editorStatus").textContent =
      "Notícia importada do RSS. Revise os campos e salve o rascunho.";
    $("editorForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function switchModule(next) {
  if (busy || !allowLeave()) return;

  if (next !== "rss" && rssWorkspace) rssWorkspace.close();

  module = next;
  dirty = false;
  current = null;
  pendingRss = null;
  bulkSelected.clear();

  const isRss = next === 'rss';

  // Fecha os formulários editoriais
  $('editorForm').hidden = true;
  $('scheduleForm').hidden = true;
  $('recommendationForm').hidden = true;
  $('editorEmpty').hidden = true;

  // Alterna entre o painel RSS e o painel editorial
  $('rssPanel').hidden = !isRss;
  $('globalStatus').hidden = isRss;
  $('stats').hidden = isRss;
  document.querySelector('.adminWorkspace').hidden = isRss;
  $('newArticle').hidden = isRss;

  // Atualiza a navegação
  document.querySelectorAll('[data-module]').forEach(button => {
    const selected = button.dataset.module === next;

    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  // No módulo RSS, o componente compartilhado cuida de todo o painel.
  if (isRss) {
    mountRssWorkspace();
    return;
  }

  // Configura a área editorial selecionada
  const suggestionModule = next === 'recommendations' || next === 'schedule';
  $('editorEmpty').hidden = suggestionModule;
  $('recommendationSuggest').hidden = next !== 'recommendations';
  $('scheduleSuggest').hidden = next !== 'schedule';
  $('categoryFilter').hidden = next !== 'news';
  $('adminSearch').value = '';
  $('statusFilter').value = 'all';

  $('newArticle').textContent =
    next === 'recommendations' ? '＋ Nova recomendação' :
    next === 'schedule' ? '＋ Nova exibição' :
    next === 'reviews' ? '＋ Nova review' :
    '＋ Novo conteúdo';

  renderList();

  // As sugestões externas só são consultadas quando a aba é aberta.
  if (next === 'recommendations' && !trendingItems.length) loadTrending();
  if (next === 'schedule' && !seasonItems.length) loadSeasonImport();
}

const styleHintCache = new Map();

function newsStyleHints(item) {
  const key = `${item.id}:${item.updated_at || ""}`;
  if (styleHintCache.has(key)) return styleHintCache.get(key);

  const result = { fonts: [], colors: [] };

  if (item.body_format === "rich-v1" && typeof item.body === "string") {
    try {
      const doc = JSON.parse(item.body);
      result.fonts = VisionContent.fontFamilies(doc).slice(0, 2);

      const colors = new Set();
      const matches = item.body.match(/"(?:color|bg)":"#[0-9a-f]{6}"/g) || [];
      matches.forEach((entry) => {
        const hex = entry.match(/#[0-9a-f]{6}/)?.[0];
        if (hex) colors.add(hex);
      });
      result.colors = [...colors].slice(0, 3);
    } catch {
      // Conteúdo antigo inválido não deve quebrar a listagem.
    }
  }

  if (styleHintCache.size > 500) styleHintCache.clear();
  styleHintCache.set(key, result);
  return result;
}

function newsDate(item) {
  const value = item.published_at || item.updated_at || item.created_at;
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "";
}

function renderList() {
  const term = $("adminSearch").value.trim().toLowerCase(),
    status = $("statusFilter").value,
    category = $("categoryFilter").value;
  const list = moduleItems();
  const rows = list.filter(
    (a) =>
      (status === "all" || a.status === status) &&
      (module !== "news" || category === "all" || a.category === category) &&
      [a.title, a.author, a.platform, a.feature_date, a.topic, a.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
  );
  const selectable = module === "news" || module === "reviews";
  $("newsList").innerHTML = rows.length
    ? rows
        .map((a) => {
          const hints = selectable ? newsStyleHints(a) : null;
          const date = newsDate(a);
          const meta =
            module === "schedule"
              ? esc(dayNames[a.weekday] + " · " + (a.time || "Horário a confirmar") + " · " + a.platform)
              : module === "recommendations"
                ? esc(String(a.feature_date || "").split("-").reverse().join("/"))
                : esc([a.category, a.topic, a.author].filter(Boolean).join(" · "));
          const badges = [
            `<span class="statusPill ${a.status}">${names[a.status]}</span>`,
            a.featured && a.status === "published" && featuredDecision()?.id === a.id
              ? '<span class="statusPill published">★ Principal</span>'
              : "",
            a.source_label && module === "news"
              ? '<span class="newsItemSource">RSS</span>'
              : "",
            date && module !== "recommendations"
              ? `<span class="newsItemDate">${esc(date)}</span>`
              : "",
          ].join("");
          const dots = hints?.colors.length
            ? `<span class="newsStyleDots" title="${esc(hints.fonts.join(", "))}">${hints.colors.map((hex) => `<i style="background:${esc(hex)}"></i>`).join("")}</span>`
            : "";
          const card = `<button class="newsItem ${current?.id === a.id ? "current" : ""}" data-edit="${a.id}"><span class="newsItemMeta">${badges}</span><h3>${esc(a.title)}</h3><small>${meta}${dots}</small></button>`;
          if (!selectable) return card;
          const check =
            a.status === "draft"
              ? `<input type="checkbox" class="bulkCheck" data-bulk="${a.id}" aria-label="Selecionar ${esc(a.title)}"${bulkSelected.has(a.id) ? " checked" : ""}>`
              : '<span class="bulkCheckPlaceholder" aria-hidden="true"></span>';
          return `<div class="newsRow">${check}${card}</div>`;
        })
        .join("")
    : '<p class="emptyList">Nenhum item encontrado. Crie um conteúdo ou ajuste os filtros.</p>';
  $("newsList")
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          edit(list.find((a) => a.id === Number(b.dataset.edit)))),
    );
  $("newsList")
    .querySelectorAll("[data-bulk]")
    .forEach((box) => {
      box.onchange = () => {
        const id = Number(box.dataset.bulk);
        if (box.checked) bulkSelected.add(id);
        else bulkSelected.delete(id);
        updateBulkBar();
      };
    });
  bulkVisible = selectable
    ? rows.filter((a) => a.status === "draft")
    : [];
  updateBulkBar();
  $("stats").innerHTML = ["draft", "published", "archived"]
    .map(
      (s) =>
        `<div><strong>${list.filter((a) => a.status === s).length}</strong><span>${s === "draft" ? "Rascunhos" : s === "published" ? "Publicados" : "Arquivados"}</span></div>`,
    )
    .join("");
}

function updateBulkBar() {
  const visible = module === "news" || module === "reviews";
  $("bulkBar").hidden = !visible;

  $("bulkTranslate").hidden = module !== "news";

  if (!visible) {
    bulkSelected.clear();
    $("bulkStatus").textContent = "";
    return;
  }

  const visibleIds = new Set(bulkVisible.map((item) => item.id));

  for (const id of [...bulkSelected]) {
    if (!visibleIds.has(id)) bulkSelected.delete(id);
  }

  const total = bulkSelected.size;

  $("bulkPublish").disabled = busy || total === 0;

  $("bulkPublish").textContent = total
    ? `Publicar ${total} selecionado${total === 1 ? "" : "s"}`
    : "Publicar selecionados";

  $("bulkTranslate").disabled =
    busy || total === 0 || total > 5;

  $("bulkTranslate").textContent = total
    ? `Traduzir ${total} notícia${total === 1 ? "" : "s"}`
    : "Traduzir notícias";

  $("bulkAll").checked =
    bulkVisible.length > 0 &&
    bulkVisible.every((item) => bulkSelected.has(item.id));

  $("bulkAll").indeterminate =
    !$("bulkAll").checked &&
    bulkVisible.some((item) => bulkSelected.has(item.id));
}


function renderTranslationBody(body, format) {
  if (!body) return "<p>Conteúdo vazio.</p>";

  if (format === "rich-v1") {
    try {
      const document = VisionContent.validate(
        typeof body === "string" ? JSON.parse(body) : body,
      );

      VisionContent.ensureFonts(document);
      return VisionContent.render(document);
    } catch {
      return "<p>Não foi possível renderizar este conteúdo.</p>";
    }
  }

  return `<p>${esc(String(body)).replace(/\n/g, "<br>")}</p>`;
}

async function translateSelectedNews() {
  if (busy || !ready) return;

  if (dirty) {
    $("globalStatus").textContent =
      "Salve ou descarte as alterações abertas no editor antes de traduzir.";
    return;
  }

  const ids = [...bulkSelected];

  if (!ids.length) return;

  if (ids.length > 5) {
    $("bulkStatus").textContent =
      "Selecione no máximo 5 notícias por tradução.";
    return;
  }

  const selected = ids
    .map((id) => news.find((item) => item.id === id))
    .filter(Boolean);

  if (selected.length !== ids.length) {
    $("bulkStatus").textContent =
      "Não foi possível localizar todas as notícias selecionadas. Atualize a lista.";
    return;
  }

  const versions = Object.fromEntries(
    selected.map((item) => [item.id, item.version]),
  );

  busy = true;
  $("bulkTranslate").disabled = true;
  $("bulkPublish").disabled = true;
  $("bulkStatus").textContent =
    "Traduzindo notícias com inteligência artificial…";

  try {
    const result = await api("/api/editor/news/translate-preview", {
      method: "POST",
      body: JSON.stringify({ ids, versions }),
    });

    const items = Array.isArray(result.items) ? result.items : [];
window.translationPreviewItems = items;
    if (!items.length) {
      throw Error("O servidor não retornou nenhuma tradução.");
    }

    $("previewContent").innerHTML = `
      <span class="tag">VISIONNEWS / TRADUÇÃO</span>
      <h2>Revisão das traduções</h2>
      <p>
        Compare o conteúdo original com a versão traduzida.
        Nenhuma alteração foi salva no banco de dados.
      </p>

      ${items.map((item) => `
        <section class="translationPreviewItem"
          style="border-top:1px solid var(--line);padding-top:22px;margin-top:22px">

          <small>NOTÍCIA #${esc(item.id)}</small>

          <h3>${esc(item.translated.title)}</h3>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">

            <div>
              <span class="tag">ORIGINAL</span>
              <h3>${esc(item.original.title)}</h3>
              <p>${esc(item.original.summary || "")}</p>
              <div class="formattedContent">
                ${renderTranslationBody(item.original.body, item.body_format)}
              </div>
            </div>

            <div>
              <span class="tag">TRADUÇÃO</span>
              <h3>${esc(item.translated.title)}</h3>
              <p>${esc(item.translated.summary || "")}</p>
              <div class="formattedContent">
                ${renderTranslationBody(item.translated.body, item.body_format)}
              </div>
            </div>

          </div>

          <button
            type="button"
            class="primary"
            data-translation-apply="${esc(item.id)}"
          >
            Revisar no editor
          </button>

        </section>
      `).join("")}
    `;

    $("previewDialog").showModal();

    $("bulkStatus").textContent =
      `${items.length} tradução${items.length === 1 ? "" : "ões"} pronta${items.length === 1 ? "" : "s"} para revisão.`;

  } catch (error) {
    $("bulkStatus").textContent = error.message;
  } finally {
    busy = false;
    renderList();
  }
}


async function publishSelectedDrafts() {
  if (busy || !ready) return;

  if (dirty) {
    $("globalStatus").textContent =
      "Salve ou descarte as alterações abertas no editor antes de publicar em lote.";
    return;
  }

  const ids = [...bulkSelected];

  if (!ids.length) return;

  const count = ids.length;
  const confirmed = confirm(
    `Publicar ${count} rascunho${count === 1 ? "" : "s"} agora? ` +
      "O conteúdo ficará visível no portal imediatamente.",
  );

  if (!confirmed) return;

  const openId = current?.id;
  busy = true;
  $("bulkPublish").disabled = true;
  $("bulkStatus").textContent = "Publicando…";

  try {
    const result = await api("/api/editor/news/bulk-publish", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    const published = result.published || [];
    const skipped = result.skipped || [];

    bulkSelected.clear();
    dirty = false;
    await load();
    busy = false;

    if (openId)
      edit(
        moduleItems().find((item) => item.id === openId) || null,
        null,
        true,
      );

    $("globalStatus").textContent = `${published.length} rascunho${
      published.length === 1 ? "" : "s"
    } publicado${published.length === 1 ? "" : "s"}.${
      skipped.length
        ? ` ${skipped.length} não publicado${skipped.length === 1 ? "" : "s"}: ` +
          skipped
            .slice(0, 3)
            .map(
              (item) =>
                `${item.title || "#" + item.id} (${String(item.reason || "").slice(0, 140)})`,
            )
            .join("; ") +
          (skipped.length > 3 ? "…" : "")
        : ""
    }`;
  } catch (error) {
    $("globalStatus").textContent = error.message;
  } finally {
    busy = false;
    $("bulkStatus").textContent = "";
    renderList();
  }
}
async function load() {
  try {
    const [a, b, c] = await Promise.all([
      api("/api/editor/news"),
      api("/api/editor/schedule"),
      api("/api/editor/recommendations"),
    ]);
    news = a.items;
    schedule = b.items;
    recommendations = c.items;
    ready = true;
    $("newArticle").disabled = false;
    renderList();
    $("globalStatus").textContent =
      "Redação conectada. Gerencie notícias, reviews, calendário e recomendações. Rascunhos ficam na redação.";
    return true;
  } catch (error) {
    $("globalStatus").textContent = error.message;
    return false;
  }
}
$("newArticle").disabled = true;
$("newArticle").onclick = () => {
  pendingRss = null;
  showRssNote(null);
  edit(null);
};
document.querySelectorAll("[data-module]").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.dataset.module === module));
  b.onclick = () => switchModule(b.dataset.module);
});
$("adminSearch").oninput = renderList;
$("statusFilter").onchange = renderList;
$("categoryFilter").onchange = renderList;
$("bulkAll").onchange = () => {
  for (const item of bulkVisible) {
    if ($("bulkAll").checked) bulkSelected.add(item.id);
    else bulkSelected.delete(item.id);
  }
  renderList();
};
$("bulkPublish").onclick = publishSelectedDrafts;

$("bulkTranslate").onclick = translateSelectedNews;

$("previewContent").addEventListener("click", (event) => {
  const button = event.target.closest("[data-translation-apply]");

  if (!button) return;

  const id = Number(button.dataset.translationApply);

  // Recupera a tradução exibida na prévia.
  const preview = window.translationPreviewItems?.find(
    (item) => Number(item.id) === id,
  );

  if (!preview) {
    $("bulkStatus").textContent =
      "Não foi possível recuperar esta tradução. Gere uma nova prévia.";
    return;
  }

  const original = news.find((item) => item.id === id);

  if (!original || original.version !== preview.version) {
    $("previewDialog").close();
    $("bulkStatus").textContent =
      "Esta notícia foi modificada. Gere uma nova tradução.";
    return;
  }

  if (!allowLeave()) return;

  $("previewDialog").close();

  edit(original);

  $("title").value = preview.translated.title || "";
  $("summary").value = preview.translated.summary || "";
  $("topic").value = preview.translated.topic || "";

  VisionEditor.set(
    preview.translated.body || "",
    preview.body_format || "plain",
  );

  dirty = true;

  $("editorStatus").textContent =
    "Tradução aplicada ao editor. Revise o conteúdo e salve quando estiver pronto.";

  $("editorForm").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
});


const seasonToday = todayInBrasilia().split("-").map(Number);
$("seasonImportYear").value = seasonToday[0];
$("seasonImportQuarter").value = String(
  Math.min(4, Math.max(1, Math.ceil(seasonToday[1] / 3))),
);
$("trendingRefresh").onclick = () => loadTrending(true);
$("trendingList").onclick = (event) => {
  const button = event.target.closest("[data-trending]");
  if (button) applyTrending(button.dataset.trending);
};
$("seasonImportFetch").onclick = loadSeasonImport;
$("seasonImportSubmit").onclick = importSeason;
$("seasonImportAll").onchange = () => {
  for (const item of seasonItems)
    if (!item.imported) {
      if ($("seasonImportAll").checked) seasonSelected.add(item.anime_id);
      else seasonSelected.delete(item.anime_id);
    }
  renderSeasonImport();
};
$("seasonImportQuarter").onchange = () => {
  seasonItems = [];
  seasonSelected.clear();
  renderSeasonImport();
  $("seasonImportStatus").textContent =
    "Clique em “Buscar temporada” para consultar o novo período.";
};

$("status").onchange = buttonLabel;
$("category").onchange = reviewVisibility;
$("cover").addEventListener("input", coverPreview);
for (const id of ["editorForm", "scheduleForm", "recommendationForm"])
  $(id).addEventListener("input", () => {
    dirty = true;
    $(
      {
        editorForm: "editorStatus",
        scheduleForm: "scheduleStatus",
        recommendationForm: "recommendationStatus",
      }[id],
    ).textContent = "Alterações ainda não salvas.";
  });
$("reloadButton").onclick = async () => {
  if (busy || !allowLeave()) return;
  const id = current?.id;
  if (await load()) {
    dirty = false;
    edit(moduleItems().find((a) => a.id === id) || null);
  }
};
async function save(event, calendar) {
  event.preventDefault();
  if (!ready || busy) return;
  const form = $(calendar ? "scheduleForm" : "editorForm"),
    button = $(calendar ? "saveSchedule" : "saveButton"),
    feedback = $(calendar ? "scheduleStatus" : "editorStatus");
  if (!form.reportValidity()) return;
  let values;
  if (calendar) {
    values = Object.fromEntries(
      calendarFields.map((f) => [f, $("schedule_" + f).value]),
    );
    for (const f of ["weekday", "season_year", "season_quarter"])
      values[f] = Number(values[f]);
  } else {
    try {
      if (VisionEditor.text().trim().length < 40)
        throw Error("Escreva ao menos 40 caracteres no conteúdo.");
      values = Object.fromEntries(fields.map((f) => [f, $(f).value]));
      values.featured = values.category === "Notícias" && $("featured").checked;
      values.body = JSON.stringify(VisionEditor.get());
      values.body_format = "rich-v1";
      values.review_score =
        $("review_score").value === "" ? null : Number($("review_score").value);
    } catch (error) {
      feedback.textContent = error.message;
      return;
    }
  }
  if (current) values.version = current.version;
  busy = true;
  button.disabled = true;
  $("newArticle").disabled = true;
  feedback.textContent = "Salvando…";
  try {
    const { item } = await api(
      "/api/editor/" +
        (calendar ? "schedule" : "news") +
        (current ? "/" + current.id : ""),
      { method: current ? "PUT" : "POST", body: JSON.stringify(values) },
    );
    current = item;
    dirty = false;
    $(calendar ? "scheduleMode" : "editorMode").textContent =
      "EDITANDO / #" + item.id;
    feedback.textContent =
      item.status === "published"
        ? calendar
          ? "Exibição publicada no calendário da temporada."
          : "Conteúdo publicado no portal."
        : item.status === "archived"
          ? "Item arquivado e retirado do portal."
          : "Rascunho salvo no servidor.";
    await load();
    renderList();

    if (!calendar && pendingRss) {
      const rssItem = pendingRss;
      pendingRss = null;
      showRssNote(null);

      try {
        await api(`/api/editor/rss-items/${rssItem.id}/imported`, {
          method: "POST",
          body: JSON.stringify({ news_id: item.id }),
        });
        feedback.textContent += " Item RSS marcado como cadastrado.";
      } catch (error) {
        feedback.textContent +=
          " O rascunho foi salvo, mas não foi possível marcar o item RSS: " +
          error.message;
      }

      if (rssWorkspace) rssWorkspace.refresh();
    }
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    busy = false;
    button.disabled = false;
    $("newArticle").disabled = false;
  }
}
$("editorForm").onsubmit = (e) => save(e, false);
$("scheduleForm").onsubmit = (e) => save(e, true);
$("previewButton").onclick = () => {
  const cover = VisionContent.https($("cover").value),
    source = VisionContent.https($("source_url").value);
  let html;
  try {
    html = VisionContent.render(VisionEditor.get());
  } catch (e) {
    $("editorStatus").textContent = e.message;
    return;
  }
  const score = $("review_score").value;
  $("previewContent").innerHTML =
    `<span class="tag">PRÉVIA / AINDA NÃO É PUBLICAÇÃO</span><h2>${esc($("title").value || "Título do conteúdo")}</h2><small class="previewMeta">${esc($("category").value)} · ${esc($("author").value)}</small>${cover ? `<img class="previewCover" src="${esc(cover)}" referrerpolicy="no-referrer" alt="Imagem de capa">` : ""}<p><strong>${esc($("summary").value)}</strong></p>${$("category").value === "Reviews" ? `<div class="reviewVerdict"><b>${score !== "" ? esc(score) + "/10" : "REVIEW"}</b><span>${esc($("anime_title").value)} · ${esc($("review_verdict").value)}</span></div>` : ""}<div class="formattedContent">${html}</div>${source ? `<p><a href="${esc(source)}" target="_blank" rel="noopener">Fonte: ${esc($("source_label").value || "Fonte oficial")} ↗</a></p>` : ""}`;
  $("previewDialog").showModal();
};
$("closePreview").onclick = () => $("previewDialog").close();
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
const initialRssItem = Number(
  new URLSearchParams(location.search).get("rssItem"),
);

load().then((connected) => {
  if (
    !connected ||
    !Number.isSafeInteger(initialRssItem) ||
    initialRssItem < 1
  )
    return;

  api("/api/editor/rss-items/" + initialRssItem)
    .then(({ item }) => {
      importRssItem(item, { name: item.feed_name || "Fonte RSS" });
      history.replaceState(null, "", "/dashboard");
    })
    .catch((error) => {
      $("globalStatus").textContent = error.message;
    });
});

api("/api/admin/session")
  .then(() => {
    $("adminLink").hidden = false;
  })
  .catch(() => {});

$("recommendationForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!ready || busy) return;
  const values = Object.fromEntries(
    recommendationFields.map((field) => [
      field,
      $("recommendation_" + field).value,
    ]),
  );
  values.streams = streamFields
    .map((i) => ({
      name: $("streamName" + i).value.trim(),
      url: $("streamUrl" + i).value.trim(),
    }))
    .filter((stream) => stream.name || stream.url);
  if (current) values.version = current.version;
  const button = $("saveRecommendation"),
    feedback = $("recommendationStatus");
  busy = true;
  button.disabled = true;
  $("newArticle").disabled = true;
  feedback.textContent = "Salvando…";
  try {
    const { item } = await api(
      "/api/editor/recommendations" + (current ? "/" + current.id : ""),
      { method: current ? "PUT" : "POST", body: JSON.stringify(values) },
    );
    current = item;
    dirty = false;
    $("recommendationMode").textContent = "EDITANDO / #" + item.id;
    const date = item.feature_date.split("-").reverse().join("/");
    feedback.textContent = {
      draft: "Rascunho salvo.",
      published: "Publicação programada para " + date + " na home.",
      archived: "Recomendação arquivada.",
    }[item.status];
    await load();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    busy = false;
    button.disabled = false;
    $("newArticle").disabled = false;
  }
};

// Superfície pública usada pelo adaptador /dashboard/rss.js e por outros
// módulos que queiram enviar um item RSS para o editor.
window.VisionDashboard = {
  importRssItem,
  openRss() {
    switchModule("rss");
  },
  refreshRss() {
    return rssWorkspace ? rssWorkspace.refresh() : Promise.resolve();
  },
};
