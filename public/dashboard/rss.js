/*
 * Adaptador do radar RSS para o dashboard.
 *
 * A interface completa vive em /rss.js e é compartilhada com a página /rss.
 * Este arquivo mantém compatibilidade com quem incluir o script antigo:
 * ele monta o componente no painel #rssWorkspace e encaminha a ação
 * "Cadastrar notícia" para o editor do dashboard.
 */
(function () {
  'use strict';

  const root = document.getElementById('rssWorkspace');
  if (!root || !window.VisionRss || root.__visionRss) return;

  window.VisionRss.mount(root, {
    mode: 'dashboard',
    title: 'Radar de notícias',
    subtitle:
      'Gerencie as fontes, filtre as últimas notícias e envie uma matéria para os campos do editor.',
    onImport(item, feed) {
      if (window.VisionDashboard?.importRssItem) {
        window.VisionDashboard.importRssItem(item, feed);
        return;
      }

      window.location.href =
        '/dashboard?rssItem=' + encodeURIComponent(item.id);
    },
  });
})();
