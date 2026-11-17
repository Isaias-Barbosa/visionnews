/*
 * VisionNews — Radar de Notícias RSS
 *
 * Componente único usado pela página /rss e pelo dashboard editorial.
 * Ele concentra a lista de fontes, os filtros, a busca, a paginação e o
 * diálogo de detalhe com a ação "Cadastrar notícia".
 */
(function (global) {
  'use strict';

  const API = '/api/editor';
  const DEFAULT_LIMIT = 24;
  const dateFormat = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  const html = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);

  function safeImage(value) {
    if (global.VisionContent?.https) return global.VisionContent.https(value) || '';

    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function safeHttp(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function host(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return String(value || '');
    }
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    try {
      return dateFormat.format(date);
    } catch {
      return '';
    }
  }

  function initialOf(value) {
    const text = String(value || '').trim();
    return text ? text.charAt(0).toLocaleUpperCase('pt-BR') : 'R';
  }

  function request(path, options = {}) {
    return fetch(API + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    }).then(async (response) => {
      const raw = await response.text();
      let data = {};

      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error('O servidor respondeu em um formato inesperado.');
        }
      }

      if (!response.ok) {
        const error = new Error(
          data.error || 'Não foi possível concluir a operação.',
        );
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    });
  }

  function template(title, subtitle, mode) {
    return `
      <section class="rssWorkspace rssWorkspace--${mode}" aria-label="Radar de notícias RSS">
        <header class="rssHead">
          <div>
            <span class="rssEyebrow">RADAR DE FONTES</span>
            <h2>${html(title)}</h2>
            <p>${html(subtitle)}</p>
          </div>
          <div class="rssActions">
            <button type="button" class="rssButton" data-action="refresh-all">Atualizar fontes</button>
            <button type="button" class="rssButton primary" data-action="add-feed">Adicionar fonte</button>
          </div>
        </header>

        <p class="rssStatus" data-role="status" role="status" aria-live="polite"></p>

        <section aria-label="Fontes cadastradas">
          <div class="rssBlockHead">
            <h3>Fontes cadastradas</h3>
            <span data-role="feedCount"></span>
          </div>
          <div class="rssSources" data-role="feeds"></div>
        </section>

        <section aria-label="Últimas notícias RSS">
          <div class="rssFilters">
            <label>
              <span>Buscar</span>
              <input type="search" data-role="search" placeholder="Título ou resumo" autocomplete="off" />
            </label>
            <label>
              <span>Fonte</span>
              <select data-role="feed"><option value="all">Todas as fontes</option></select>
            </label>
            <label>
              <span>Situação</span>
              <select data-role="imported">
                <option value="all">Todas as notícias</option>
                <option value="pending">Ainda não cadastradas</option>
                <option value="imported">Já cadastradas</option>
              </select>
            </label>
            <button type="button" class="rssButton" data-action="reload">Atualizar lista</button>
          </div>

          <div class="rssListHead">
            <h3>Últimas notícias</h3>
            <span data-role="total"></span>
          </div>
          <div class="rssList" data-role="list" aria-live="polite"></div>
          <nav class="rssPager" data-role="pager" aria-label="Paginação das notícias RSS"></nav>
        </section>

        <dialog class="rssDialog" data-role="detail">
          <div class="rssDialogCard" data-role="detailBody"></div>
        </dialog>

        <dialog class="rssDialog" data-role="feedDialog">
          <form class="rssDialogCard rssFeedForm" data-role="feedForm">
            <div class="rssDialogHead">
              <h3 data-role="feedDialogTitle">Adicionar fonte RSS</h3>
              <button type="button" class="rssIconButton" data-action="close-feed-dialog" aria-label="Fechar">×</button>
            </div>

            <label class="rssField">
              <span>Nome da fonte</span>
              <input name="name" type="text" minlength="2" maxlength="120" placeholder="Ex.: Anime News Network" required />
            </label>

            <label class="rssField">
              <span>URL do feed RSS/Atom</span>
              <input name="feed_url" type="url" maxlength="2048" placeholder="https://exemplo.com/feed.xml" required />
            </label>

            <label class="rssCheck">
              <input name="auto_import" type="checkbox" />
              Criar rascunhos automaticamente para novos itens
            </label>

            <p class="rssHint">
              O servidor consulta o feed agora para validar o endereço. Novos itens
              entram para revisão editorial; nada é publicado automaticamente.
            </p>

            <details class="rssSuggest" data-role="suggestBox">
              <summary>Sugestões de fontes de anime</summary>
              <div class="rssChips" data-role="suggestions"></div>
            </details>

            <p class="rssFormStatus" data-role="feedFormStatus" role="status" aria-live="polite"></p>

            <div class="rssDialogActions">
              <button type="button" class="rssButton" data-action="close-feed-dialog">Cancelar</button>
              <button type="submit" class="rssButton primary" data-role="feedSubmit">Adicionar fonte</button>
            </div>
          </form>
        </dialog>
      </section>
    `;
  }

  function mount(root, options = {}) {
    if (!root) throw new Error('Área do radar RSS não encontrada.');
    if (root.__visionRss) return root.__visionRss;

    const mode = options.mode === 'dashboard' ? 'dashboard' : 'page';
    const title =
      options.title ||
      (mode === 'dashboard' ? 'Radar de notícias' : 'Notícias RSS');
    const subtitle =
      options.subtitle ||
      (mode === 'dashboard'
        ? 'Receba as últimas notícias das fontes cadastradas e envie uma matéria para o editor.'
        : 'Acompanhe as últimas notícias das fontes cadastradas e cadastre uma matéria no editor do VisionNews.');

    root.innerHTML = template(title, subtitle, mode);

    const find = (role) => root.querySelector(`[data-role="${role}"]`);
    const status = find('status');
    const feedsBox = find('feeds');
    const feedCount = find('feedCount');
    const list = find('list');
    const total = find('total');
    const pager = find('pager');
    const search = find('search');
    const feedSelect = find('feed');
    const importedSelect = find('imported');
    const detailDialog = find('detail');
    const detailBody = find('detailBody');
    const feedDialog = find('feedDialog');
    const feedForm = find('feedForm');
    const feedDialogTitle = find('feedDialogTitle');
    const feedFormStatus = find('feedFormStatus');
    const feedSubmit = find('feedSubmit');
    const suggestions = find('suggestions');
    const suggestBox = find('suggestBox');

    const state = {
      feeds: [],
      items: [],
      page: 1,
      pages: 0,
      total: 0,
      limit: DEFAULT_LIMIT,
      feed: 'all',
      imported: 'all',
      q: '',
      loading: false,
      busy: false,
      editingFeed: null,
      openItem: null,
    };

    let searchTimer;

    // -------------------------------------------------------------- mensagens

    function setStatus(message, kind = '') {
      status.textContent = message || '';
      status.className = 'rssStatus' + (kind ? ` ${kind}` : '');
    }

    // -------------------------------------------------------------- fontes

    function renderFeeds() {
      feedCount.textContent = state.feeds.length
        ? `${state.feeds.length} fonte(s) no radar`
        : '';

      feedSelect.innerHTML =
        '<option value="all">Todas as fontes</option>' +
        state.feeds
          .map(
            (feed) =>
              `<option value="${Number(feed.id)}">${html(feed.name)}</option>`,
          )
          .join('');
      feedSelect.value = state.feed;

      if (!state.feeds.length) {
        feedsBox.innerHTML = `
          <div class="rssEmpty">
            <strong>Nenhuma fonte no radar</strong>
            Adicione um feed RSS/Atom ou escolha uma sugestão para começar a importar notícias.
          </div>
        `;
        return;
      }

      feedsBox.innerHTML = state.feeds.map(feedCard).join('');
    }

    function feedCard(feed) {
      const active = Boolean(feed.is_active);
      const error = String(feed.last_error || '').trim();
      const refreshed = formatDate(feed.last_fetched_at);
      const totalItems = Number(feed.total_items || 0);
      const importedItems = Number(feed.imported_items || 0);

      return `
        <article class="rssSource ${active ? '' : 'inactive'}" data-feed="${Number(feed.id)}">
          <div class="rssSourceTop">
            <div class="rssSourceName">
              <button
                type="button"
                class="rssSwitch ${active ? 'on' : ''}"
                data-feed-action="toggle"
                aria-pressed="${active}"
                title="${active ? 'Desativar fonte' : 'Ativar fonte'}"
                aria-label="${active ? 'Desativar fonte' : 'Ativar fonte'} ${html(feed.name)}"
              ><span></span></button>
              <div>
                <strong>${html(feed.name)}</strong>
                <small>${html(host(feed.feed_url))}</small>
              </div>
            </div>
            <div class="rssSourceBadges">
              ${feed.auto_import ? '<span class="rssPill auto">Auto</span>' : ''}
              ${error ? '<span class="rssPill error">Erro</span>' : ''}
            </div>
          </div>

          <p class="rssSourceMeta">
            ${totalItems} item(ns) · ${importedItems} cadastrado(s)
            ${refreshed ? ` · atualizado em ${html(refreshed)}` : ''}
          </p>

          ${error ? `<p class="rssSourceError">${html(error)}</p>` : ''}

          <div class="rssSourceActions">
            <button type="button" class="rssButton small" data-feed-action="refresh">Atualizar</button>
            <button type="button" class="rssButton small" data-feed-action="auto">
              ${feed.auto_import ? 'Desligar auto' : 'Ligar auto'}
            </button>
            <button type="button" class="rssButton small" data-feed-action="edit">Editar</button>
            <button type="button" class="rssButton small danger" data-feed-action="delete">Excluir</button>
          </div>
        </article>
      `;
    }

    function findFeed(id) {
      return state.feeds.find((feed) => Number(feed.id) === Number(id)) || null;
    }

    async function loadFeeds() {
      const data = await request('/rss-feeds');
      state.feeds = Array.isArray(data.items) ? data.items : [];

      if (
        state.feed !== 'all' &&
        !state.feeds.some((feed) => String(feed.id) === String(state.feed))
      ) {
        state.feed = 'all';
      }

      renderFeeds();
    }

    // -------------------------------------------------------------- notícias

    function itemCard(item) {
      const title = item.title || 'Sem título';
      const feedName = item.feed_name || 'Fonte RSS';
      const image = safeImage(item.image_url);
      const imported = Boolean(item.imported_at || item.imported_news_id);
      const summary = String(item.summary || '').slice(0, 240);
      const date = formatDate(item.published_at || item.created_at);

      return `
        <button type="button" class="rssCard" data-item="${Number(item.id)}" aria-label="Abrir notícia: ${html(title)}">
          <span class="rssCardCover">
            ${
              image
                ? `<img src="${html(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : `<span class="rssCardFallback">${html(initialOf(feedName || title))}</span>`
            }
          </span>
          <span class="rssCardBody">
            <span class="rssCardTop">
              <span class="rssCardFeed">${html(feedName)}</span>
              ${
                imported
                  ? '<span class="rssPill imported">Cadastrada</span>'
                  : '<span class="rssPill">Nova</span>'
              }
            </span>
            <span class="rssCardTitle">${html(title)}</span>
            ${summary ? `<span class="rssCardSummary">${html(summary)}</span>` : ''}
            ${date ? `<span class="rssCardFoot">${html(date)}</span>` : ''}
          </span>
        </button>
      `;
    }

    function renderPager() {
      const pages = Math.max(1, state.pages);

      if (!state.total) {
        pager.innerHTML = '';
        return;
      }

      pager.innerHTML = `
        <button type="button" class="rssButton small" data-action="page-prev" ${state.page <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span>Página ${state.page} de ${pages}</span>
        <button type="button" class="rssButton small" data-action="page-next" ${state.page >= state.pages ? 'disabled' : ''}>Próxima →</button>
      `;
    }

    function renderItems() {
      total.textContent = state.total
        ? `${state.total} notícia(s) no radar`
        : '';

      if (!state.items.length) {
        list.innerHTML = `
          <div class="rssEmpty">
            <strong>Nenhuma notícia encontrada</strong>
            Cadastre uma fonte e use “Atualizar fontes”, ou ajuste os filtros da busca.
          </div>
        `;
        renderPager();
        return;
      }

      list.innerHTML = state.items.map(itemCard).join('');
      renderPager();
    }

    async function loadItems() {
      if (state.loading) return;

      state.loading = true;
      list.setAttribute('aria-busy', 'true');

      if (!state.items.length) {
        list.innerHTML =
          '<div class="rssEmpty">Carregando as notícias do radar…</div>';
      }

      try {
        const params = new URLSearchParams({
          page: String(state.page),
          limit: String(state.limit),
        });

        if (state.feed !== 'all') params.set('feed', state.feed);
        if (state.imported !== 'all') {
          params.set(
            'imported',
            state.imported === 'imported' ? 'true' : 'false',
          );
        }
        if (state.q) params.set('q', state.q);

        const data = await request('/rss-items?' + params.toString());
        state.items = Array.isArray(data.items) ? data.items : [];
        state.page = Number(data.page || state.page);
        state.pages = Number(data.pages || 0);
        state.total = Number(data.total || 0);

        if (state.pages && state.page > state.pages) {
          state.page = state.pages;
          state.loading = false;
          list.removeAttribute('aria-busy');
          return loadItems();
        }

        renderItems();
      } catch (error) {
        list.innerHTML = `
          <div class="rssEmpty">
            <strong>Não foi possível carregar</strong>
            ${html(error.message)}
          </div>
        `;
        setStatus(error.message, 'error');
      } finally {
        state.loading = false;
        list.removeAttribute('aria-busy');
      }
    }

    // -------------------------------------------------------------- detalhe

    function renderDetail(item) {
      const link = safeHttp(item.link);
      const image = safeImage(item.image_url);
      const imported = Boolean(item.imported_at || item.imported_news_id);
      const summary = String(item.summary || '').trim();
      const content = String(item.content || '').trim();
      const hasLongContent = content.length > 520;

      detailBody.innerHTML = `
        <div class="rssDialogHead">
          <h3>${html(item.title || 'Notícia RSS')}</h3>
          <button type="button" class="rssIconButton" data-action="close-detail" aria-label="Fechar">×</button>
        </div>

        <p class="rssDialogMeta">
          <span class="rssPill">${html(item.feed_name || 'Fonte RSS')}</span>
          ${
            item.published_at
              ? `<span>${html(formatDate(item.published_at))}</span>`
              : ''
          }
          ${
            imported
              ? '<span class="rssPill imported">Já cadastrada</span>'
              : '<span class="rssPill">Nova</span>'
          }
        </p>

        ${
          image
            ? `<img class="rssDialogImage" src="${html(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : ''
        }

        ${summary ? `<p class="rssDialogSummary">${html(summary)}</p>` : ''}
        ${
          content
            ? `<div class="rssDialogContent ${hasLongContent ? 'clamped' : ''}" data-role="detailContent">${html(content)}</div>`
            : ''
        }

        <div class="rssDialogActions">
          ${
            imported
              ? '<a class="rssButton" href="/dashboard">Ver no dashboard</a>'
              : '<button type="button" class="rssButton primary" data-action="import-item">Cadastrar notícia</button>'
          }
          ${
            link
              ? `<a class="rssButton" href="${html(link)}" target="_blank" rel="noopener noreferrer">Abrir original ↗</a>`
              : ''
          }
          ${
            hasLongContent
              ? '<button type="button" class="rssButton" data-action="toggle-content">Ver texto completo</button>'
              : ''
          }
          <p class="rssDialogHint">
            A matéria entra como rascunho nos campos do editor para revisão antes
            da publicação.
          </p>
        </div>
      `;
    }

    async function openItem(id) {
      if (!Number.isSafeInteger(id) || id < 1) return;

      try {
        setStatus('Carregando a notícia…');
        const { item } = await request('/rss-items/' + id);
        state.openItem = item;
        renderDetail(item);
        detailDialog.showModal();
        setStatus('');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }

    function closeDetail() {
      if (detailDialog.open) detailDialog.close();
    }

    async function importOpenItem() {
      const item = state.openItem;
      if (!item) return;

      const feed = findFeed(item.feed_id) || {
        id: item.feed_id,
        name: item.feed_name || 'Fonte RSS',
      };

      closeDetail();

      if (typeof options.onImport === 'function') {
        try {
          await options.onImport(item, feed);
        } catch (error) {
          setStatus(error.message, 'error');
        }
        return;
      }

      const target =
        typeof options.importHref === 'function'
          ? options.importHref(item, feed)
          : '/dashboard?rssItem=' + encodeURIComponent(item.id);

      global.location.href = target;
    }

    // -------------------------------------------------------------- diálogo de fonte

    function renderSuggestions() {
      const sources = Array.isArray(global.VisionRssSources)
        ? global.VisionRssSources
        : [];

      if (!sources.length) {
        suggestBox.hidden = true;
        return;
      }

      suggestions.innerHTML = sources
        .map(
          (source, index) => `
            <button
              type="button"
              class="rssChip"
              data-suggest="${index}"
              title="${html(source.note || source.url || '')}"
            >
              ${html(source.name)}
              <small>${html(source.group || host(source.url))}</small>
            </button>
          `,
        )
        .join('');
    }

    function openFeedDialog(feed = null) {
      state.editingFeed = feed;
      feedForm.reset();
      feedFormStatus.textContent = '';
      feedFormStatus.className = 'rssFormStatus';

      feedDialogTitle.textContent = feed ? 'Editar fonte RSS' : 'Adicionar fonte RSS';
      feedSubmit.textContent = feed ? 'Salvar alterações' : 'Adicionar fonte';

      if (feed) {
        feedForm.elements.name.value = feed.name || '';
        feedForm.elements.feed_url.value = feed.feed_url || '';
        feedForm.elements.auto_import.checked = Boolean(feed.auto_import);
      }

      feedDialog.showModal();
      feedForm.elements.name.focus();
    }

    function closeFeedDialog() {
      if (feedDialog.open) feedDialog.close();
    }

    // -------------------------------------------------------------- ações

    async function refreshAll() {
      if (state.busy) return;

      if (!state.feeds.length) {
        setStatus('Cadastre uma fonte antes de atualizar o radar.', 'error');
        return;
      }

      state.busy = true;
      setStatus('Consultando as fontes cadastradas…');

      try {
        const data = await request('/rss/refresh', { method: 'POST' });
        const failures = Number(data.failures || 0);
        const parts = [
          `${Number(data.inserted || 0)} nova(s)`,
          `${Number(data.updated || 0)} atualizada(s)`,
        ];

        if (data.autoImported) {
          parts.push(
            `${Number(data.autoImported)} rascunho(s) automático(s)`,
          );
        }

        setStatus(
          `${Number(data.total || 0)} fonte(s) consultada(s): ${parts.join(' · ')}${
            failures ? ` · ${failures} falha(s)` : ''
          }.`,
          failures ? 'error' : 'success',
        );

        await loadFeeds();
        await loadItems();
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        state.busy = false;
      }
    }

    async function handleFeedAction(action, id) {
      const feed = findFeed(id);
      if (!feed || state.busy) return;

      state.busy = true;

      try {
        if (action === 'toggle') {
          setStatus(
            feed.is_active ? 'Desativando a fonte…' : 'Ativando a fonte…',
          );
          await request('/rss-feeds/' + feed.id, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !feed.is_active }),
          });
          await loadFeeds();
          setStatus('Fonte atualizada.', 'success');
        } else if (action === 'auto') {
          setStatus(
            feed.auto_import
              ? 'Desligando a criação automática…'
              : 'Ligando a criação automática…',
          );
          await request('/rss-feeds/' + feed.id, {
            method: 'PUT',
            body: JSON.stringify({ auto_import: !feed.auto_import }),
          });
          await loadFeeds();
          setStatus(
            feed.auto_import
              ? 'Criação automática desligada.'
              : 'Criação automática ligada: novos itens viram rascunhos.',
            'success',
          );
        } else if (action === 'refresh') {
          setStatus('Consultando “' + feed.name + '”…');
          const data = await request('/rss-feeds/' + feed.id + '/refresh', {
            method: 'POST',
          });
          setStatus(
            `“${feed.name}”: ${Number(data.inserted || 0)} nova(s) e ${Number(
              data.updated || 0,
            )} atualizada(s).`,
            'success',
          );
          await loadFeeds();
          await loadItems();
        } else if (action === 'edit') {
          openFeedDialog(feed);
        } else if (action === 'delete') {
          if (
            !global.confirm(
              `Excluir a fonte “${feed.name}” e todas as notícias RSS vinculadas a ela?`,
            )
          ) {
            return;
          }

          setStatus('Excluindo a fonte…');
          await request('/rss-feeds/' + feed.id, { method: 'DELETE' });
          await loadFeeds();
          await loadItems();
          setStatus('Fonte excluída.', 'success');
        }
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        state.busy = false;
      }
    }

    async function submitFeed(event) {
      event.preventDefault();
      if (!feedForm.reportValidity()) return;

      const payload = {
        name: feedForm.elements.name.value.trim(),
        feed_url: feedForm.elements.feed_url.value.trim(),
        auto_import: feedForm.elements.auto_import.checked,
      };

      feedSubmit.disabled = true;
      feedFormStatus.className = 'rssFormStatus';
      feedFormStatus.textContent = 'Consultando o feed para validar o endereço…';

      try {
        if (state.editingFeed) {
          await request('/rss-feeds/' + state.editingFeed.id, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          setStatus('Fonte atualizada com sucesso.', 'success');
        } else {
          const data = await request('/rss-feeds', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          if (data.item?.id) state.feed = String(data.item.id);

          setStatus(
            `Fonte cadastrada${
              data.inserted
                ? ` com ${Number(data.inserted)} notícia(s) importada(s)`
                : ''
            }.`,
            'success',
          );
        }

        closeFeedDialog();
        await loadFeeds();
        await loadItems();
      } catch (error) {
        feedFormStatus.textContent = error.message;
        feedFormStatus.className = 'rssFormStatus error';
      } finally {
        feedSubmit.disabled = false;
      }
    }

    // -------------------------------------------------------------- eventos

    root.addEventListener('click', (event) => {
      const suggest = event.target.closest('[data-suggest]');
      if (suggest) {
        const source = global.VisionRssSources?.[Number(suggest.dataset.suggest)];
        if (source) {
          feedForm.elements.name.value = source.name || '';
          feedForm.elements.feed_url.value = source.url || '';
          feedFormStatus.textContent = source.note
            ? `${source.note} Confirme o endereço antes de salvar.`
            : '';
          feedFormStatus.className = 'rssFormStatus';
          feedForm.elements.feed_url.focus();
        }
        return;
      }

      const feedAction = event.target.closest('[data-feed-action]');
      if (feedAction) {
        const card = feedAction.closest('[data-feed]');
        handleFeedAction(
          feedAction.dataset.feedAction,
          Number(card?.dataset.feed),
        );
        return;
      }

      const actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        const action = actionButton.dataset.action;

        if (action === 'add-feed') openFeedDialog();
        else if (action === 'close-feed-dialog') closeFeedDialog();
        else if (action === 'close-detail') closeDetail();
        else if (action === 'refresh-all') refreshAll();
        else if (action === 'reload') loadItems();
        else if (action === 'page-prev') {
          state.page = Math.max(1, state.page - 1);
          loadItems();
        } else if (action === 'page-next') {
          state.page = Math.min(state.pages, state.page + 1);
          loadItems();
        } else if (action === 'import-item') importOpenItem();
        else if (action === 'toggle-content') {
          const content = detailBody.querySelector('[data-role="detailContent"]');
          if (content) {
            const clamped = content.classList.toggle('clamped');
            actionButton.textContent = clamped
              ? 'Ver texto completo'
              : 'Recolher texto';
          }
        }

        return;
      }

      const itemButton = event.target.closest('[data-item]');
      if (itemButton) openItem(Number(itemButton.dataset.item));
    });

    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = search.value.trim();
        state.page = 1;
        loadItems();
      }, 320);
    });

    feedSelect.addEventListener('change', () => {
      state.feed = feedSelect.value;
      state.page = 1;
      loadItems();
    });

    importedSelect.addEventListener('change', () => {
      state.imported = importedSelect.value;
      state.page = 1;
      loadItems();
    });

    feedForm.addEventListener('submit', submitFeed);

    for (const dialog of [detailDialog, feedDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    detailDialog.addEventListener('close', () => {
      state.openItem = null;
    });

    // -------------------------------------------------------------- inicialização

    const instance = {
      root,
      state,
      loadFeeds,
      loadItems,
      openItem,
      close() {
        closeDetail();
        closeFeedDialog();
      },
      refresh: async () => {
        await loadFeeds();
        await loadItems();
      },
      setFeed(feedId) {
        state.feed =
          feedId === null || feedId === undefined ? 'all' : String(feedId);
        state.page = 1;
        feedSelect.value = state.feed;
        return loadItems();
      },
    };

    root.__visionRss = instance;

    renderSuggestions();

    (async () => {
      setStatus('Carregando o radar de fontes…');

      try {
        await loadFeeds();
      } catch (error) {
        setStatus(error.message, 'error');
      }

      await loadItems();

      if (!state.feeds.length) {
        setStatus(
          'Nenhuma fonte cadastrada ainda. Use “Adicionar fonte” ou escolha uma sugestão.',
        );
      } else if (status.textContent === 'Carregando o radar de fontes…') {
        setStatus('');
      }
    })();

    return instance;
  }

  function autoMount() {
    document
      .querySelectorAll('[data-rss-workspace][data-rss-auto]')
      .forEach((root) => {
        if (root.__visionRss) return;

        mount(root, {
          mode: root.dataset.rssAuto || 'page',
          title: root.dataset.rssTitle || undefined,
          subtitle: root.dataset.rssSubtitle || undefined,
        });
      });
  }

  global.VisionRss = { mount };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoMount, { once: true });
    } else {
      autoMount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
