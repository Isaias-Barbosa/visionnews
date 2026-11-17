/*
 * Sugestões de fontes RSS para o radar editorial.
 *
 * A lista não é uma configuração obrigatória: o editor pode cadastrar
 * qualquer feed RSS/Atom público. Os endereços abaixo são apenas atalhos
 * para agilizar o primeiro cadastro; feeds mudam de endereço com o tempo,
 * então a resposta do servidor sempre prevalece.
 */
(function (root) {
  'use strict';

  const sources = [
    {
      name: 'Anime News Network',
      url: 'https://www.animenewsnetwork.com/all/rss.xml',
      site: 'https://www.animenewsnetwork.com/',
      group: 'Internacional',
      note: 'Notícias, indústria e anúncios do mercado japonês.',
    },
    {
      name: 'ANN Interest',
      url: 'https://www.animenewsnetwork.com/interest/rss.xml',
      site: 'https://www.animenewsnetwork.com/interest/',
      group: 'Internacional',
      note: 'Pautas de interesse, curiosidades e cultura pop.',
    },
    {
      name: 'MyAnimeList News',
      url: 'https://myanimelist.net/rss/news.xml',
      site: 'https://myanimelist.net/news',
      group: 'Internacional',
      note: 'Anúncios de temporada, estreias e notas da comunidade.',
    },
    {
      name: 'Crunchyroll News',
      url: 'https://www.crunchyroll.com/newsrss',
      site: 'https://www.crunchyroll.com/news',
      group: 'Streaming',
      note: 'Novidades e estreias divulgadas pela Crunchyroll.',
    },
    {
      name: 'OtakuPT',
      url: 'https://www.otakupt.com/feed/',
      site: 'https://www.otakupt.com/',
      group: 'Brasil e Portugal',
      note: 'Cobertura em português de animes, mangás e eventos.',
    },
    {
      name: 'IntoxiAnime',
      url: 'https://intoxianime.com/feed/',
      site: 'https://intoxianime.com/',
      group: 'Brasil e Portugal',
      note: 'Notícias e listas de animes em português.',
    },
    {
      name: 'ANMTV',
      url: 'https://anmtv.com.br/feed/',
      site: 'https://anmtv.com.br/',
      group: 'Brasil e Portugal',
      note: 'Exibições, dublagem e programação de TV no Brasil.',
    },
    {
      name: 'Anime United',
      url: 'https://www.animeunited.com.br/feed/',
      site: 'https://www.animeunited.com.br/',
      group: 'Brasil e Portugal',
      note: 'Notícias, reviews e colunas da comunidade brasileira.',
    },
    {
      name: 'Você Sabia Anime',
      url: 'https://vocesabianime.com/feed/',
      site: 'https://vocesabianime.com/',
      group: 'Brasil e Portugal',
      note: 'Curiosidades, notícias e guias de temporada.',
    },
    {
      name: 'Jovem Nerd',
      url: 'https://jovemnerd.com.br/feed/',
      site: 'https://jovemnerd.com.br/',
      group: 'Cultura pop',
      note: 'Cultura pop e nerd com pautas que dialogam com anime.',
    },
    {
      name: 'Legião dos Heróis',
      url: 'https://legiaodosherois.com.br/feed/',
      site: 'https://legiaodosherois.com.br/',
      group: 'Cultura pop',
      note: 'Notícias de quadrinhos, cinema e animação.',
    },
  ];

  const frozen = sources.map((source) => Object.freeze({ ...source }));

  root.VisionRssSources = Object.freeze(frozen);
})(typeof window !== 'undefined' ? window : globalThis);
