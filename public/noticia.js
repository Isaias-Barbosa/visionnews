(async function() {
  const loadingNotice = document.getElementById('loadingNotice');
  const articleView = document.getElementById('articleView');
  const catalogView = document.getElementById('catalogView');

  // Elementos do artigo
  const articleTitle = document.getElementById('articleTitle');
  const articleCategoryTag = document.getElementById('articleCategoryTag');
  const articleOriginTag = document.getElementById('articleOriginTag');
  const articleAuthor = document.getElementById('articleAuthor');
  const articleReadingTime = document.getElementById('articleReadingTime');
  const articleDate = document.getElementById('articleDate');
  const articleLead = document.getElementById('articleLead');
  const articleContent = document.getElementById('articleContent');
  const articleCoverWrap = document.getElementById('articleCoverWrap');
  const articleCoverImg = document.getElementById('articleCoverImg');
  const reviewVerdictWrap = document.getElementById('reviewVerdictWrap');
  const reviewVerdictScore = document.getElementById('reviewVerdictScore');
  const reviewAnimeTitle = document.getElementById('reviewAnimeTitle');
  const reviewVerdictText = document.getElementById('reviewVerdictText');
  const articleSourceWrap = document.getElementById('articleSourceWrap');
  const articleSourceLink = document.getElementById('articleSourceLink');
  const btnSaveArticle = document.getElementById('btnSaveArticle');
  const btnCopyArticleLink = document.getElementById('btnCopyArticleLink');
  const actionFeedback = document.getElementById('actionFeedback');
  const relatedArticlesGrid = document.getElementById('relatedArticlesGrid');
  const readingProgress = document.getElementById('readingProgress');

  // Elementos do catálogo
  const catalogCards = document.getElementById('catalogCards');
  const catalogEmpty = document.getElementById('catalogEmpty');
  const catalogQuery = document.getElementById('catalogQuery');
  const filterButtons = document.querySelectorAll('.filter button[data-filter]');

  let savedIds = new Set();
  try {
    const val = JSON.parse(localStorage.getItem('visionnews.saved.v1') || '[]');
    if (Array.isArray(val)) {
      savedIds = new Set(val.filter(i => Number.isInteger(i) && i >= 0));
    }
  } catch {}

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  // Base demonstrativa de artigos padrão
  const baseArticles = [
    {
      id: 0,
      title: 'Seu próximo universo começa aqui: por que os animes continuam a nos surpreender',
      desc: 'Dos grandes encontros às pequenas despedidas: como a animação japonesa constrói mundos que nos acompanham.',
      category: 'Cultura',
      author: 'Redação VisionNews',
      topic: 'primeiros',
      img: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1200&q=80',
      body: [
        'Toda história de anime começa com um convite discreto. Uma estação de trem ao entardecer, o som distante de uma cigarra em um dia quente ou o silêncio de uma sala de aula vazia. Antes do primeiro golpe ou da primeira magia, existe um espaço para você respirar.',
        'É essa atenção aos intervalos da vida que torna a animação japonesa tão única. Não se trata apenas da velocidade das lutas ou da imaginação visual deslumbrante, mas da coragem de desacelerar quando qualquer outra produção correria para o próximo acontecimento.',
        'No VisionNews, nosso compromisso editorial é acompanhar essas histórias com a mesma atenção com que foram feitas. Explorar o que está além dos créditos, entender como a técnica se une à emoção e oferecer um espaço onde a conversa continua.'
      ],
      original: true
    },
    {
      id: 1,
      title: 'Frieren e a beleza de uma jornada sem pressa',
      desc: 'Uma fantasia sobre memória, afeto e o tempo que dedicamos a conhecer alguém.',
      category: 'Reviews',
      author: 'Redação VisionNews',
      topic: 'olhar',
      review_score: 9.5,
      anime_title: 'Sousou no Frieren',
      review_verdict: 'Uma obra-prima contemporânea sobre o peso do tempo e o afeto que sobrevive à despedida.',
      img: 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg',
      body: [
        'Sousou no Frieren inverte a lógica mais comum das grandes fantasias: ela começa quando a grande batalha final já foi vencida. O Rei Demônio foi derrotado, o reino está em paz e o grupo de heróis se despede sob uma chuva de estrelas que só acontece a cada meio século.',
        'Para os humanos do grupo, aquele momento marca o ápice de suas vidas. Para a elfa Frieren, cuja expectativa de vida se estende por milênios, foram apenas dez anos — um piscar de olhos.',
        'A verdadeira aventura de Frieren é aprender a valorizar o efêmero. Cada vilarejo visitado, cada feitiço banal aprendido e cada conversa simples se tornam tentativas de recuperar o que o tempo ameaça apagar.',
        'Com direção primorosa de Keiichirou Saitou e animação deslumbrante da Madhouse, a obra transcende os clichês do gênero e convida o espectador a refletir sobre suas próprias conexões.'
      ],
      original: true
    },
    {
      id: 2,
      title: 'Por onde começar a assistir One Piece sem medo dos mil episódios',
      desc: 'Um guia prático para embarcar na jornada de Luffy no seu próprio ritmo.',
      category: 'Guias',
      author: 'Redação VisionNews',
      topic: 'primeiros',
      img: 'https://cdn.myanimelist.net/images/anime/6/73245l.jpg',
      body: [
        'A marca de mais de mil episódios de One Piece costuma afastar quem deseja começar. No entanto, o segredo da obra de Eiichiro Oda não está na pressa de chegar ao fim, mas no prazer de viver cada arco.',
        'Não encare One Piece como uma maratona obrigatória. Comece pela saga East Blue (episódios 1 a 61). É nela que os laços fundamentais do bando dos Chapéus de Palha são construídos.',
        'Divida a jornada em blocos naturais: Alabasta, Skypiea, Water 7 / Enies Lobby. Cada grande saga tem início, meio e clímax próprios.',
        'Seja no anime clássico, no mangá ou nas versões remasterizadas, o que importa é permitir-se navegar sem a ansiedade de alcançar a exibição atual.'
      ],
      original: true
    },
    {
      id: 3,
      title: 'Muito além da luta: o poder da animação expressiva',
      desc: 'Como cortes de sakuga, timing e direção elevam o sentimento de uma cena.',
      category: 'Cultura',
      author: 'Redação VisionNews',
      topic: 'olhar',
      img: 'https://cdn.myanimelist.net/images/anime/1171/109222l.jpg',
      body: [
        'Quando pensamos em grandes cenas de ação, a contagem de golpes ou a intensidade dos efeitos visuais costumam ser os primeiros elementos lembrados.',
        'Contudo, o que realmente fixa uma cena na memória é a expressividade: a respiração pesada de um personagem, o tremor de uma lâmina ou a escolha precisa do ângulo de câmera.',
        'Animadores lendários usam distorção, sombras e pausas dramáticas para transmitir peso e consequência. O espetáculo visual só é pleno quando serve à narrativa emocional.'
      ],
      original: true
    }
  ];

  // Adiciona artigos extras de ensaios e guias
  const extraTitles = [
    { title: 'Como escolher um anime sem transformar o lazer em tarefa', category: 'Guias', topic: 'primeiros' },
    { title: 'O que observar em uma abertura além da música', category: 'Cultura', topic: 'olhar' },
    { title: 'Legendas ou dublagem? O melhor formato é o que aproxima você', category: 'Guias', topic: 'primeiros' },
    { title: 'O silêncio também conta uma história', category: 'Cultura', topic: 'olhar' },
    { title: 'Maratonar ou acompanhar toda semana?', category: 'Cultura', topic: 'conversa' },
    { title: 'Como conversar sobre anime sem entregar a surpresa', category: 'Guias', topic: 'conversa' },
    { title: 'Personagens secundários, emoções de primeira linha', category: 'Cultura', topic: 'conversa' },
    { title: 'Cores que contam: um exercício para o próximo episódio', category: 'Cultura', topic: 'olhar' },
    { title: 'Review sem spoilers: ação que precisa de espaço para respirar', category: 'Reviews', topic: 'olhar' },
    { title: 'Sua watchlist pode ser menor — e mais interessante', category: 'Guias', topic: 'primeiros' },
    { title: 'Como ler uma review e descobrir se ela serve para você', category: 'Guias', topic: 'primeiros' },
    { title: 'Rever um anime: quando conhecer o final muda o começo', category: 'Cultura', topic: 'conversa' }
  ];

  const artImages = [
    'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg',
    'https://cdn.myanimelist.net/images/anime/6/73245l.jpg',
    'https://cdn.myanimelist.net/images/anime/1171/109222l.jpg',
    'https://cdn.myanimelist.net/images/anime/1286/99889l.jpg'
  ];

  extraTitles.forEach((item, index) => {
    const id = index + 4;
    baseArticles.push({
      id,
      title: item.title,
      category: item.category,
      author: 'Redação VisionNews',
      topic: item.topic,
      img: artImages[index % 4],
      desc: 'Um ensaio aprofundado produzido pela redação do VisionNews.',
      body: [
        'A experiência de assistir a uma obra se transforma quando olhamos com calma para cada escolha de roteiro e direção.',
        'Nem toda resposta precisa ser óbvia; muitas vezes o que fica de mais valioso em uma história é a pergunta que ela deixa aberta para quem assiste.',
        'Acompanhe este e outros temas em nossa cobertura editorial contínua.'
      ],
      original: true
    });
  });

  const allArticlesMap = new Map();
  baseArticles.forEach(a => {
    a.minutes = Math.max(1, Math.ceil(a.body.join(' ').split(/\s+/).length / 200));
    allArticlesMap.set(a.id, a);
  });

  // Busca matérias publicadas no CMS
  try {
    const res = await fetch('/api/news', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];
      for (const item of items) {
        const id = 100 + item.id;
        let richHtml = '';
        let plainBody = item.body || '';

        if (item.body_format === 'rich-v1' && window.VisionContent) {
          try {
            const doc = window.VisionContent.validate(JSON.parse(item.body));
            richHtml = '<div class="formattedContent">' + window.VisionContent.render(doc) + '</div>';
            plainBody = window.VisionContent.plain(doc);
          } catch {
            plainBody = 'Este conteúdo está temporariamente indisponível.';
          }
        }

        const paragraphs = plainBody.split(/\n\s*\n/).filter(Boolean).map(escapeHtml);
        const cover = (window.VisionContent && window.VisionContent.https(item.cover)) ? item.cover : '';

        allArticlesMap.set(id, {
          id,
          cmsId: item.id,
          title: item.title,
          desc: item.summary,
          body: paragraphs,
          contentHtml: richHtml,
          category: item.category || 'Notícias',
          author: item.author || 'Redação VisionNews',
          cover,
          img: cover || artImages[0],
          source_url: item.source_url || '',
          source_label: item.source_label || '',
          review_score: item.review_score,
          review_verdict: item.review_verdict || '',
          anime_title: item.anime_title || '',
          topic: item.topic || '',
          tags: item.tags || '',
          minutes: Math.max(1, Math.ceil(plainBody.split(/\s+/).length / 200)),
          published_at: item.published_at,
          cms: true
        });
      }
    }
  } catch (e) {
    console.warn('Não foi possível carregar as notícias dinâmicas:', e);
  }

  // Identifica ID solicitado na URL
  const urlParams = new URLSearchParams(window.location.search);
  let targetId = urlParams.get('id');

  if (!targetId && window.location.hash) {
    const hashMatch = window.location.hash.match(/^#leitura-(\d+)$/);
    if (hashMatch) {
      targetId = hashMatch[1];
    }
  }

  loadingNotice.hidden = true;

  if (targetId !== null && targetId !== undefined && allArticlesMap.has(Number(targetId))) {
    // Renderiza página da notícia individual
    renderArticle(allArticlesMap.get(Number(targetId)));
  } else {
    // Renderiza catálogo geral de notícias
    renderCatalog();
  }

  function renderArticle(art) {
    articleView.hidden = false;
    catalogView.hidden = true;
    document.title = `${art.title} — VisionNews`;

    articleCategoryTag.textContent = (art.category || 'NOTÍCIAS').toUpperCase();
    articleOriginTag.textContent = art.cms
      ? 'REDAÇÃO VISIONNEWS'
      : (art.original ? 'ENSAIO ORIGINAL' : 'SELEÇÃO EDITORIAL');

    articleTitle.textContent = art.title;
    articleLead.textContent = art.desc || '';
    articleAuthor.textContent = `Por ${art.author || 'Redação VisionNews'}`;
    articleReadingTime.textContent = `${art.minutes} min de leitura`;

    if (art.published_at) {
      try {
        const d = new Date(art.published_at);
        articleDate.textContent = 'Publicado em ' + new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        }).format(d);
      } catch {
        articleDate.textContent = 'Publicado recentemente';
      }
    } else {
      articleDate.textContent = 'Edição VisionNews';
    }

    // Capa da matéria
    const coverUrl = art.cover || (art.img && !art.img.includes('unsplash') ? art.img : '');
    if (coverUrl) {
      articleCoverImg.src = coverUrl;
      articleCoverImg.alt = `Capa de: ${art.title}`;
      articleCoverWrap.hidden = false;
    } else {
      articleCoverWrap.hidden = true;
    }

    // Veredito de review (caso seja categoria Reviews)
    if (art.category === 'Reviews' && (art.review_score !== null && art.review_score !== undefined || art.review_verdict)) {
      reviewVerdictWrap.hidden = false;
      reviewVerdictScore.textContent = art.review_score !== null && art.review_score !== undefined
        ? `${art.review_score}/10`
        : 'REVIEW';
      reviewAnimeTitle.textContent = art.anime_title || '';
      reviewVerdictText.textContent = art.review_verdict || '';
    } else {
      reviewVerdictWrap.hidden = true;
    }

    // Conteúdo formatado
    if (art.contentHtml) {
      articleContent.innerHTML = art.contentHtml;
    } else if (Array.isArray(art.body)) {
      articleContent.innerHTML = art.body.map(p => `<p>${escapeHtml(p)}</p>`).join('');
    } else {
      articleContent.innerHTML = `<p>${escapeHtml(art.desc)}</p>`;
    }

    // Link da fonte
    if (art.source_url) {
      articleSourceWrap.hidden = false;
      articleSourceLink.href = art.source_url;
      articleSourceLink.textContent = `Fonte: ${art.source_label || 'Acessar fonte oficial'} ↗`;
    } else {
      articleSourceWrap.hidden = true;
    }

    // Botão de salvar leitura
    updateSaveButton(art.id);
    btnSaveArticle.onclick = () => {
      toggleSaveArticle(art.id);
    };

    // Botão de copiar link
    btnCopyArticleLink.onclick = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        actionFeedback.textContent = 'Link copiado para a área de transferência!';
        setTimeout(() => { actionFeedback.textContent = ''; }, 3000);
      } catch {
        actionFeedback.textContent = 'Copie o link na barra de endereços do navegador.';
      }
    };

    // Matérias relacionadas
    const allList = Array.from(allArticlesMap.values()).filter(x => x.id !== art.id);
    const sameCat = allList.filter(x => x.category === art.category);
    const otherCat = allList.filter(x => x.category !== art.category);
    const related = sameCat.concat(otherCat).slice(0, 3);

    relatedArticlesGrid.innerHTML = related.map(rel => `
      <a class="relatedCard" href="/noticia.html?id=${rel.id}">
        <div>
          <small>${(rel.category || 'NOTÍCIA').toUpperCase()} • ${rel.minutes} MIN</small>
          <h3>${escapeHtml(rel.title)}</h3>
        </div>
        <span class="readMore">LER MATÉRIA ↗</span>
      </a>
    `).join('');

    // Atualização da barra de leitura no scroll
    window.addEventListener('scroll', updateScrollProgress);
    updateScrollProgress();
  }

  function updateScrollProgress() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 0) {
      const scrolled = Math.min(100, Math.max(0, (window.scrollY / docHeight) * 100));
      readingProgress.style.width = scrolled + '%';
    } else {
      readingProgress.style.width = '100%';
    }
  }

  function toggleSaveArticle(id) {
    if (savedIds.has(id)) {
      savedIds.delete(id);
    } else {
      savedIds.add(id);
    }
    try {
      localStorage.setItem('visionnews.saved.v1', JSON.stringify(Array.from(savedIds)));
    } catch {}
    updateSaveButton(id);
  }

  function updateSaveButton(id) {
    const isSaved = savedIds.has(id);
    btnSaveArticle.textContent = isSaved ? '✓ Leitura salva na biblioteca' : '＋ Salvar leitura';
    btnSaveArticle.setAttribute('aria-pressed', String(isSaved));
  }

  // Visão de Catálogo de Notícias
  let catalogFilter = 'Todos';
  function renderCatalog() {
    articleView.hidden = true;
    catalogView.hidden = false;
    document.title = 'Todas as Notícias — VisionNews';

    function updateCatalogList() {
      const term = (catalogQuery.value || '').trim().toLowerCase();
      const list = Array.from(allArticlesMap.values()).filter(a => {
        const matchesCategory = (catalogFilter === 'Todos' || a.category === catalogFilter);
        const textBlob = `${a.title} ${a.desc} ${a.topic || ''} ${a.tags || ''}`.toLowerCase();
        const matchesSearch = textBlob.includes(term);
        return matchesCategory && matchesSearch;
      }).sort((a, b) => {
        if (a.cms && !b.cms) return -1;
        if (!a.cms && b.cms) return 1;
        return (b.published_at || '').localeCompare(a.published_at || '') || (b.id - a.id);
      });

      if (!list.length) {
        catalogCards.innerHTML = '';
        catalogEmpty.hidden = false;
        return;
      }

      catalogEmpty.hidden = true;
      catalogCards.innerHTML = list.map(a => `
        <a class="card" href="/noticia.html?id=${a.id}">
          <div class="cardImage">
            <img src="${escapeHtml(a.img)}" alt="Arte da matéria" loading="lazy">
          </div>
          <span class="tag">${escapeHtml((a.category || 'NOTÍCIAS').toUpperCase())} / ${a.cms ? 'REDAÇÃO' : 'EDITORIAL'}</span>
          <h3>${escapeHtml(a.title)}</h3>
          <p>${escapeHtml(a.desc)}</p>
          <span class="meta">${a.minutes} MIN DE LEITURA ${savedIds.has(a.id) ? '• SALVO' : ''}</span>
        </a>
      `).join('');
    }

    filterButtons.forEach(btn => {
      btn.onclick = () => {
        filterButtons.forEach(b => b.classList.toggle('selected', b === btn));
        catalogFilter = btn.dataset.filter;
        updateCatalogList();
      };
    });

    catalogQuery.oninput = updateCatalogList;
    updateCatalogList();
  }
})();
