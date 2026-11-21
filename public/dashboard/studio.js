/*
 * VisionNews Studio — painel de acompanhamento do pipeline editorial.
 *
 * Este módulo apenas observa a fila, dispara o processamento e abre sugestões
 * no editor. Ele nunca escreve em `news` nem publica conteúdo: a decisão final
 * continua manual, no formulário editorial.
 */
(function () {
  'use strict';

  const STAGE_LABELS = {
    extraction: 'Extração',
    translation: 'Tradução',
    rewrite: 'Redação',
    review: 'Revisão',
  };

  const STATUS_LABELS = {
    pending: 'Aguardando',
    processing: 'Processando',
    done: 'Concluído',
    failed: 'Falhou',
    skipped: 'Ignorado',
    suggested: 'Sugestão',
    applied: 'Aplicado',
    rejected: 'Rejeitado',
    error: 'Erro',
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function safeHttps(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function safeUrl(value) {
    const viaContent = typeof window.VisionContent?.https === 'function'
      ? window.VisionContent.https(value)
      : '';
    return safeHttps(viaContent) || safeHttps(value);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('O servidor não respondeu como esperado. Tente novamente.');
    }

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível concluir a operação.');
    }

    return data;
  }

  function suggestionTitle(suggestion) {
    const payload = suggestion?.payload || {};
    return String(
      payload.title || payload.item?.title || `Item RSS #${suggestion?.rss_item_id || 0}`,
    ).slice(0, 160);
  }

  function mount(root) {
    if (!root || root.__visionStudio) return root ? root.__visionStudio : null;

    root.innerHTML = `
      <div class="studioHead">
        <div>
          <span class="studioEyebrow">PIPELINE EDITORIAL / REVISÃO HUMANA</span>
          <h2>Fila de produção</h2>
          <p>
            Acompanhe a extração, a tradução e a reescrita das fontes. O processamento
            cria apenas sugestões: nenhuma matéria é publicada automaticamente.
          </p>
        </div>
        <div class="studioActions">
          <button type="button" class="studioButton" data-studio-action="refresh">Atualizar</button>
          <button type="button" class="studioButton primary" data-studio-action="process">Processar lote</button>
          <button type="button" class="studioButton" data-studio-action="enqueue">Enfileirar pendentes</button>
        </div>
      </div>
      <p class="studioStatus" data-studio="status" role="status" aria-live="polite">Conectando ao pipeline…</p>
      <div class="studioAi" data-studio="ai"></div>
      <div class="studioStats" data-studio="stats"></div>
      <div class="studioLayout">
        <section class="studioCard">
          <div class="studioCardHead">
            <h3>Fila de ingestão</h3>
            <small data-studio="queue-count"></small>
          </div>
          <div class="studioFilters">
            <label>Status
              <select data-studio-filter="status">
                <option value="">Todos</option>
                <option value="pending">Aguardando</option>
                <option value="processing">Processando</option>
                <option value="done">Concluído</option>
                <option value="failed">Falhou</option>
                <option value="skipped">Ignorado</option>
              </select>
            </label>
            <label>Fonte
              <input type="search" data-studio-filter="source" placeholder="rss, twitter…" maxlength="40" />
            </label>
            <label>Busca
              <input type="search" data-studio-filter="search" placeholder="Título ou chave do item" maxlength="150" />
            </label>
          </div>
          <div class="studioList" data-studio="queue"></div>
        </section>
        <section class="studioCard">
          <div class="studioCardHead">
            <h3>Sugestões editoriais</h3>
            <small data-studio="suggestion-count"></small>
          </div>
          <div class="studioFilters">
            <label>Etapa
              <select data-studio-filter="stage">
                <option value="">Todas</option>
                <option value="extraction">Extração</option>
                <option value="translation">Tradução</option>
                <option value="rewrite">Redação</option>
                <option value="review">Revisão</option>
              </select>
            </label>
            <label>Texto
              <input type="search" data-studio-filter="suggestion-search" placeholder="Título ou fonte" maxlength="150" />
            </label>
          </div>
          <div class="studioList" data-studio="suggestions"></div>
        </section>
      </div>
      <dialog class="studioPreview" data-studio="preview" aria-labelledby="studioPreviewTitle">
        <div class="studioPreviewHead">
          <h4 id="studioPreviewTitle" data-studio="preview-title"></h4>
          <p data-studio="preview-meta"></p>
          <p data-studio="preview-summary"></p>
        </div>
        <pre class="studioPreviewBody" data-studio="preview-body"></pre>
        <p class="studioPreviewReason" data-studio="preview-reason" hidden></p>
        <a class="studioPreviewLink" data-studio="preview-link" target="_blank" rel="noopener noreferrer" hidden></a>
        <div class="studioPreviewFoot">
          <button type="button" class="studioButton" data-studio="preview-close">Fechar</button>
          <button type="button" class="studioButton primary" data-studio="preview-open">Abrir no editor</button>
        </div>
      </dialog>
    `;

    const node = (name) => root.querySelector(`[data-studio="${name}"]`);
    const filter = (name) => root.querySelector(`[data-studio-filter="${name}"]`);

    const state = {
      queue: { items: [], total: 0, counts: {} },
      suggestions: [],
      ai: null,
      opened: null,
      busy: false,
    };

    function status(message, isError = false) {
      const element = node('status');
      element.textContent = message;
      element.classList.toggle('error', Boolean(isError));
    }

    function syncButtons() {
      root.querySelectorAll('[data-studio-action]').forEach((button) => {
        button.disabled = state.busy;
      });
    }

    function hasRewriteSuggestion(item) {
      const rssId = Number(item?.payload?.rssItemId || 0);
      if (!rssId) return false;
      return state.suggestions.some(
        (entry) =>
          Number(entry.rss_item_id) === rssId && entry.stage === 'rewrite',
      );
    }

    function queueNote(item) {
      if (item.status !== 'done') return '';
      if (item.news_id) {
        return `Já cadastrado como rascunho #${Number(item.news_id)}: itens importados não passam pela IA.`;
      }
      if (!hasRewriteSuggestion(item)) {
        return 'Concluído sem sugestão de redação: a extração pode não ter produzido fatos suficientes.';
      }
      return 'Sugestão de redação disponível na coluna ao lado.';
    }

    function emptySuggestions() {
      const orphans = (state.queue.items || []).filter(
        (item) => item.status === 'done' && !hasRewriteSuggestion(item),
      );
      return `<p class="studioEmpty">Ainda não há sugestões para este filtro.</p>${
        orphans.length
          ? `<p class="studioNote">${orphans.length} item(ns) “Concluído” não gerou sugestão: itens já cadastrados como rascunho pulam a IA; os demais podem ter falhado na extração.</p>`
          : ''
      }`;
    }

    function renderAi() {
      const ai = state.ai || {};
      const translation = ai.translation || {};
      const editorial = ai.editorial || {};
      const chip = (label, value) =>
        `<span class="studioChip"><b>${esc(label)}</b>${esc(value)}</span>`;

      node('ai').innerHTML =
        chip(
          'Tradução',
          `${translation.provider || '—'}${
            translation.model ? ' · ' + translation.model : ''
          } · ${translation.configured ? 'configurada' : 'não configurada'}`,
        ) +
        chip(
          'Edição',
          `${editorial.provider || '—'}${
            editorial.model ? ' · ' + editorial.model : ''
          } · ${editorial.configured ? 'configurada' : 'não configurada'}`,
        ) +
        chip('Publicação', 'sempre manual');
    }

    function renderStats() {
      const counts = state.queue.counts || {};
      const order = ['pending', 'processing', 'done', 'failed', 'skipped'];
      node('stats').innerHTML = order
        .map(
          (key) => `
            <div class="studioStat">
              <strong>${Number(counts[key] || 0)}</strong>
              <span>${esc(STATUS_LABELS[key] || key)}</span>
            </div>`,
        )
        .join('');
    }

    function visibleQueue() {
      const statusFilter = filter('status').value;
      const source = filter('source').value.trim().toLowerCase();
      const term = filter('search').value.trim().toLowerCase();

      return (state.queue.items || []).filter((item) => {
        if (statusFilter && item.status !== statusFilter) return false;
        if (source && !String(item.source_type || '').toLowerCase().includes(source)) {
          return false;
        }
        if (!term) return true;

        const payload = item.payload || {};
        return [
          item.id,
          item.item_key,
          item.canonical_key,
          item.source_type,
          payload.title,
          payload.rssItemId,
          item.error,
        ]
          .filter((value) => value !== null && value !== undefined)
          .join(' ')
          .toLowerCase()
          .includes(term);
      });
    }

    function renderQueue() {
      const rows = visibleQueue();
      node('queue-count').textContent = `${rows.length} de ${state.queue.total || 0}`;
      node('queue').innerHTML = rows.length
        ? rows
            .map((item) => {
              const payload = item.payload || {};
              const title = String(payload.title || item.item_key || 'Item sem título');
              const note = queueNote(item);
              return `<article class="studioRow" data-queue-id="${Number(item.id)}">
                <div class="studioRowTop">
                  <strong class="studioTitle">${esc(title)}</strong>
                  <span class="studioBadge" data-status="${esc(item.status)}">${esc(
                    STATUS_LABELS[item.status] || item.status || '—',
                  )}</span>
                </div>
                <div class="studioMeta">
                  #${Number(item.id)} · ${esc(item.source_type || 'rss')} · prioridade ${Number(
                    item.priority || 0,
                  )} · tentativas ${Number(item.attempts || 0)}
                </div>
                ${note ? `<p class="studioNote">${esc(note)}</p>` : ''}
                ${item.error ? `<p class="studioError">${esc(item.error)}</p>` : ''}
              </article>`;
            })
            .join('')
        : '<p class="studioEmpty">Nenhum item na fila para este filtro.</p>';
    }

    function visibleSuggestions() {
      const stage = filter('stage').value;
      const term = filter('suggestion-search').value.trim().toLowerCase();

      return state.suggestions.filter((suggestion) => {
        if (stage && suggestion.stage !== stage) return false;
        if (!term) return true;

        const payload = suggestion.payload || {};
        return [
          suggestionTitle(suggestion),
          suggestion.rss_item_id,
          payload.item?.link,
          rssLabel(suggestion),
        ]
          .filter((value) => value !== null && value !== undefined)
          .join(' ')
          .toLowerCase()
          .includes(term);
      });
    }

    function rssLabel(suggestion) {
      const payload = suggestion?.payload || {};
      const rssItem = state.opened?.suggestion?.id === suggestion?.id
        ? state.opened.rssItem
        : null;
      return rssItem?.feed_name || payload.item?.feedName || '';
    }

    function renderSuggestions() {
      const rows = visibleSuggestions();
      node('suggestion-count').textContent = `${rows.length} de ${state.suggestions.length}`;
      node('suggestions').innerHTML = rows.length
        ? rows
            .map((suggestion) => {
              const payload = suggestion.payload || {};
              const reasons = Array.isArray(payload.reasons)
                ? payload.reasons.join('; ')
                : String(suggestion.error || '');
              return `<article class="studioRow" data-suggestion-id="${Number(suggestion.id)}">
                <div class="studioRowTop">
                  <strong class="studioTitle">${esc(suggestionTitle(suggestion))}</strong>
                  <span class="studioBadge" data-status="${esc(suggestion.status)}">${esc(
                    STATUS_LABELS[suggestion.status] || suggestion.status || '—',
                  )}</span>
                </div>
                <div class="studioMeta">
                  ${esc(STAGE_LABELS[suggestion.stage] || suggestion.stage || '—')} · ${esc(
                    suggestion.provider || 'extractor',
                  )}${suggestion.model ? ' · ' + esc(suggestion.model) : ''} · item RSS #${Number(
                    suggestion.rss_item_id || 0,
                  )}
                </div>
                ${reasons ? `<p class="studioError">${esc(reasons)}</p>` : ''}
                <button type="button" class="studioRowButton" data-suggestion-open="${Number(
                  suggestion.id,
                )}">Ver prévia</button>
              </article>`;
            })
            .join('')
        : emptySuggestions();
    }

    function render() {
      renderAi();
      renderStats();
      renderQueue();
      renderSuggestions();
    }

    function renderPreview() {
      const opened = state.opened;
      if (!opened) return;

      const suggestion = opened.suggestion;
      const rssItem = opened.rssItem;
      const payload = suggestion.payload || {};
      const summary = String(payload.summary || payload.item?.summary || '');
      const body = String(
        payload.body || payload.item?.content || rssItem?.content || rssItem?.summary || '',
      );
      const reasons = Array.isArray(payload.reasons)
        ? payload.reasons.join('; ')
        : String(suggestion.error || payload.notes || '');
      const source = safeUrl(
        payload.sourceUrl || payload.item?.link || rssItem?.link,
      );
      const label = String(
        rssItem?.feed_name || payload.item?.feedName || 'Fonte',
      );

      node('preview-title').textContent = suggestionTitle(suggestion);
      node('preview-meta').textContent = [
        STAGE_LABELS[suggestion.stage] || suggestion.stage || '—',
        STATUS_LABELS[suggestion.status] || suggestion.status || '—',
        suggestion.provider || 'extractor',
        suggestion.model,
      ]
        .filter(Boolean)
        .join(' · ');
      node('preview-summary').textContent = summary || 'Sem resumo sugerido.';
      node('preview-body').textContent = body || 'Sem texto sugerido.';

      const reason = node('preview-reason');
      reason.textContent = reasons;
      reason.hidden = !reasons;

      const link = node('preview-link');
      link.hidden = !source;
      if (source) {
        link.href = source;
        link.textContent = `Fonte: ${label} ↗`;
      }
    }

    async function refresh() {
      if (state.busy) return;
      state.busy = true;
      syncButtons();
      status('Atualizando fila e sugestões…');

      try {
        const [queue, suggestions, health] = await Promise.all([
          api('/api/editor/pipeline/queue?limit=100'),
          api('/api/editor/pipeline/suggestions?limit=100'),
          api('/api/health').catch(() => ({})),
        ]);

        state.queue = queue || { items: [], total: 0, counts: {} };
        state.suggestions = Array.isArray(suggestions?.items)
          ? suggestions.items
          : [];
        state.ai = suggestions?.ai || health?.ai || null;
        render();
        status(`Fila atualizada. ${state.queue.total || 0} item(ns) na listagem.`);
      } catch (error) {
        status(error.message, true);
      } finally {
        state.busy = false;
        syncButtons();
      }
    }

    async function runAction(name) {
      if (state.busy) return;

      let message = '';
      let failed = false;
      state.busy = true;
      syncButtons();
      status(name === 'process' ? 'Processando lote…' : 'Enfileirando itens pendentes…');

      try {
        if (name === 'process') {
          const result = await api('/api/editor/pipeline/process', {
            method: 'POST',
            body: JSON.stringify({ limit: 5 }),
          });
          message = `Lote processado: ${Number(result.claimed || 0)} item(ns) reservado(s), ${Number(
            result.processed || 0,
          )} resultado(s). Nenhuma publicação automática.`;
        } else {
          const result = await api('/api/editor/pipeline/enqueue', {
            method: 'POST',
            body: JSON.stringify({ all: true }),
          });
          message = `Enfileirados: ${Number(result.enqueued || 0)}. Já conhecidos: ${Number(
            result.skipped || 0,
          )}.`;
        }
      } catch (error) {
        message = error.message;
        failed = true;
      } finally {
        state.busy = false;
        syncButtons();
      }

      await refresh();
      status(message, failed);
    }

    async function openSuggestion(id) {
      if (state.busy) return;
      const suggestion = state.suggestions.find((entry) => Number(entry.id) === id);
      if (!suggestion) return;

      state.busy = true;
      syncButtons();
      status('Carregando prévia da sugestão…');

      let rssItem = null;
      try {
        if (suggestion.rss_item_id) {
          const response = await api(
            `/api/editor/rss-items/${Number(suggestion.rss_item_id)}`,
          );
          rssItem = response.item || null;
        }
      } catch (error) {
        status(`Prévia aberta sem metadados da fonte: ${error.message}`, true);
      } finally {
        state.busy = false;
        syncButtons();
      }

      state.opened = { suggestion, rssItem };
      renderSuggestions();
      renderPreview();
      node('preview').showModal();
    }

    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-studio-action]');
      if (action) {
        runAction(action.dataset.studioAction);
        return;
      }

      const open = event.target.closest('[data-suggestion-open]');
      if (open) openSuggestion(Number(open.dataset.suggestionOpen));
    });

    for (const name of ['status', 'source', 'stage', 'search', 'suggestion-search']) {
      filter(name).addEventListener('input', () => {
        renderQueue();
        renderSuggestions();
      });
      filter(name).addEventListener('change', () => {
        renderQueue();
        renderSuggestions();
      });
    }

    node('preview-close').onclick = () => node('preview').close();
    node('preview-open').onclick = () => {
      if (!state.opened) return;
      if (typeof window.VisionDashboard?.openStudioSuggestion !== 'function') {
        status('O editor não está disponível. Recarregue a página.', true);
        return;
      }
      node('preview').close();
      window.VisionDashboard.openStudioSuggestion(
        state.opened.suggestion,
        state.opened.rssItem,
      );
    };

    const handle = {
      root,
      refresh,
      close() {
        if (node('preview').open) node('preview').close();
      },
    };

    root.__visionStudio = handle;
    refresh();
    return handle;
  }

  window.VisionStudio = { mount };
})();
