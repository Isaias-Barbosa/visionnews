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
  bulkVisible = [];
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

  return {
    title,
    summary,
    body,
    body_format: "plain",
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
  $('editorEmpty').hidden = false;
  $('categoryFilter').hidden = next !== 'news';
  $('adminSearch').value = '';
  $('statusFilter').value = 'all';

  $('newArticle').textContent =
    next === 'recommendations' ? '＋ Nova recomendação' :
    next === 'schedule' ? '＋ Nova exibição' :
    next === 'reviews' ? '＋ Nova review' :
    '＋ Novo conteúdo';

  renderList();
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
          const card = `<button class="newsItem ${current?.id === a.id ? "current" : ""}" data-edit="${a.id}"><span class="statusPill ${a.status}">${names[a.status]}</span>${a.featured && a.status === "published" && featuredDecision()?.id === a.id ? ' <span class="statusPill published">★ Principal</span>' : ""}<h3>${esc(a.title)}</h3><small>${module === "schedule" ? esc(dayNames[a.weekday] + " · " + (a.time || "Horário a confirmar") + " · " + a.platform) : module === "recommendations" ? esc(a.feature_date.split("-").reverse().join("/")) : esc([a.category, a.topic, a.author].filter(Boolean).join(" · "))}</small></button>`;
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

  if (!visible) {
    bulkSelected.clear();
    $("bulkStatus").textContent = "";
    return;
  }

  const visibleIds = new Set(bulkVisible.map((item) => item.id));
  for (const id of [...bulkSelected])
    if (!visibleIds.has(id)) bulkSelected.delete(id);

  const total = bulkSelected.size;
  $("bulkPublish").disabled = busy || total === 0;
  $("bulkPublish").textContent = total
    ? `Publicar ${total} selecionado${total === 1 ? "" : "s"}`
    : "Publicar selecionados";
  $("bulkAll").checked =
    bulkVisible.length > 0 &&
    bulkVisible.every((item) => bulkSelected.has(item.id));
  $("bulkAll").indeterminate =
    !$("bulkAll").checked &&
    bulkVisible.some((item) => bulkSelected.has(item.id));
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
