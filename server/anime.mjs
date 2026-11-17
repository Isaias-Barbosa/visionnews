/**
 * Integração com a API pública do AniList.
 *
 * O AniChart (https://anichart.net) é uma SPA Vue que carrega os dados de
 * temporada de um Web Worker, e esse worker consulta exatamente
 * https://graphql.anilist.co. Usamos a mesma fonte oficial em vez de raspar
 * o HTML do AniChart.
 *
 * Nada aqui publica conteúdo: as funções apenas normalizam os dados para os
 * campos editoriais já existentes. A importação sempre cria rascunhos.
 */

const ANILIST_ENDPOINT = "https://graphql.anilist.co/";
const TRENDING_TTL = 10 * 60 * 1000;
const SEASON_TTL = 60 * 60 * 1000;
const MAX_PAGES = 5;
const PAGE_SIZE = 50;

// Plataformas aceitas pelo calendário. A ordem define a preferência quando o
// anime tem links em mais de um serviço.
export const animePlatforms = [
  "Crunchyroll",
  "Netflix",
  "Disney+",
  "HBO Max",
  "Prime Video",
  "HIDIVE",
  "TV aberta",
  "Outros",
];

const streamSites = [
  { match: /crunchyroll/i, name: "Crunchyroll" },
  { match: /netflix/i, name: "Netflix" },
  { match: /disney/i, name: "Disney+" },
  { match: /hbo|\bmax\b/i, name: "HBO Max" },
  { match: /amazon|\bprime video\b/i, name: "Prime Video" },
  { match: /hidive/i, name: "HIDIVE" },
  { match: /bilibili/i, name: "Bilibili" },
  { match: /youtube/i, name: "YouTube" },
];

export const seasonNames = ["WINTER", "SPRING", "SUMMER", "FALL"];

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large color }
  bannerImage
  siteUrl
  format
  status
  episodes
  duration
  season
  seasonYear
  genres
  averageScore
  popularity
  isAdult
  nextAiringEpisode { airingAt episode }
  externalLinks { site url type }
  studios(isMain: true) { nodes { name } }
`;

const cache = new Map();

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function httpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function cleanDescription(value, max = 600) {
  let text = String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp|ndash|mdash|hellip);/gi, (entity) => {
      const map = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&#x27;": "'",
        "&nbsp;": " ",
        "&ndash;": "–",
        "&mdash;": "—",
        "&hellip;": "…",
      };
      return map[entity.toLowerCase()] || " ";
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Corta em um limite de palavra para não terminar no meio de uma frase.
  if (text.length > max) {
    text = text.slice(0, max - 1);
    const space = text.lastIndexOf(" ");
    if (space > max * 0.6) text = text.slice(0, space);
    text = text.trimEnd() + "…";
  }

  return text;
}

export function animeTitle(media) {
  const title = media?.title || {};
  return String(title.romaji || title.english || title.native || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function streamLinks(media) {
  const links = [];
  const seen = new Set();

  for (const link of media?.externalLinks || []) {
    const url = httpsUrl(link?.url);
    if (!url) continue;

    const site = String(link?.site || "");
    const match = streamSites.find((item) => item.match.test(site));
    if (!match) continue;

    const key = `${match.name}:${url}`;
    if (seen.has(key)) continue;

    seen.add(key);
    links.push({ name: match.name, url });
  }

  return links.slice(0, 5);
}

function pickStream(links) {
  return (
    animePlatforms
      .map((name) => (links || []).find((link) => link.name === name))
      .find(Boolean) || null
  );
}

function primaryStream(media) {
  return pickStream(streamLinks(media));
}

export function brasiliaSlot(airingAt) {
  const timestamp = Number(airingAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0)
    return { weekday: null, time: "" };

  const date = new Date(timestamp * 1000);
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  }).format(date);
  const weekdays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  return {
    weekday: weekdays[weekdayName] ?? null,
    time: /^\d{2}:\d{2}$/.test(time) ? time : "",
  };
}

export function normalizeAnime(media) {
  const title = animeTitle(media);
  const next = media?.nextAiringEpisode;

  return {
    anime_id: String(media?.id ?? ""),
    mal_id: media?.idMal ? String(media.idMal) : "",
    title,
    romaji: String(media?.title?.romaji || "").trim(),
    english: String(media?.title?.english || "").trim(),
    native: String(media?.title?.native || "").trim(),
    summary: cleanDescription(media?.description, 1000),
    cover: httpsUrl(media?.coverImage?.extraLarge || media?.coverImage?.large),
    banner: httpsUrl(media?.bannerImage),
    site_url: httpsUrl(media?.siteUrl),
    format: media?.format || "",
    status: media?.status || "",
    episodes: Number.isFinite(media?.episodes) ? media.episodes : null,
    season: media?.season || "",
    season_year: Number.isFinite(media?.seasonYear) ? media.seasonYear : null,
    genres: Array.isArray(media?.genres) ? media.genres.slice(0, 8) : [],
    score: Number.isFinite(media?.averageScore) ? media.averageScore : null,
    popularity: Number.isFinite(media?.popularity) ? media.popularity : 0,
    next_airing_at: Number.isFinite(next?.airingAt) ? next.airingAt : null,
    next_episode: Number.isFinite(next?.episode) ? next.episode : null,
    stream_links: streamLinks(media),
    studios: (media?.studios?.nodes || [])
      .map((studio) => String(studio?.name || "").trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

export function seasonFromQuarter(quarter) {
  const value = Number(quarter);
  return Number.isInteger(value) && value >= 1 && value <= 4
    ? seasonNames[value - 1]
    : null;
}

/**
 * Converte um anime normalizado em uma exibição do calendário. Retorna null
 * quando não há um próximo episódio semanal, pois o calendário do portal é
 * uma grade semanal (filmes e títulos encerrados ficam fora).
 */
export function scheduleFromAnime(anime, { year, quarter } = {}) {
  const seasonYear = Number(year);
  const seasonQuarter = Number(quarter);

  if (!anime?.title || !anime.next_airing_at) return null;
  if (!Number.isInteger(seasonYear) || !Number.isInteger(seasonQuarter))
    return null;

  const slot = brasiliaSlot(anime.next_airing_at);
  if (slot.weekday === null || !slot.time) return null;

  const stream = pickStream(anime.stream_links || []);

  return {
    anime_id: anime.anime_id,
    title: anime.title.slice(0, 160),
    summary: cleanDescription(anime.summary, 500),
    weekday: slot.weekday,
    time: slot.time,
    platform: stream?.name && animePlatforms.includes(stream.name)
      ? stream.name
      : "Outros",
    official_url: stream?.url || "",
    language: "Legendado",
    season_year: seasonYear,
    season_quarter: seasonQuarter,
    cover: anime.cover,
    episode: anime.next_episode ? `Episódio ${anime.next_episode}` : "",
    status: "draft",
  };
}

export function recommendationFromAnime(anime, featureDate) {
  if (!anime?.title) return null;

  const genres = (anime.genres || []).slice(0, 3).join(", ");
  let summary = cleanDescription(anime.summary, 600);

  if (summary.length < 15) {
    summary = `${anime.title} está entre os animes em alta no AniList${genres ? ` (${genres})` : ""}. Reveja a sinopse oficial e escreva por que vale a pena assistir.`;
  }

  return {
    anime_id: anime.anime_id,
    feature_date: featureDate,
    title: anime.title.slice(0, 160),
    summary: summary.slice(0, 600),
    cover: anime.cover,
    streams: (anime.stream_links || []).slice(0, 5),
    status: "draft",
  };
}

async function anilistRequest(query, variables, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload || (payload.errors && payload.errors.length)) {
      const message =
        payload?.errors?.[0]?.message ||
        `O AniList respondeu com o status ${response.status}.`;
      throw new Error(message);
    }

    return payload.data;
  } catch (error) {
    if (error?.name === "AbortError")
      throw new Error("O AniList demorou para responder. Tente novamente.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const TRENDING_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage total }
      media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const SEASON_QUERY = `
  query ($page: Int, $perPage: Int, $season: MediaSeason, $year: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage total }
      media(
        type: ANIME
        season: $season
        seasonYear: $year
        isAdult: false
        sort: POPULARITY_DESC
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const CONTINUING_QUERY = `
  query ($page: Int, $perPage: Int, $season: MediaSeason, $year: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage total }
      media(
        type: ANIME
        season: $season
        seasonYear: $year
        status: RELEASING
        episodes_greater: 16
        isAdult: false
        sort: POPULARITY_DESC
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export async function fetchTrendingAnime(limit = 12) {
  const perPage = Math.min(Math.max(Number(limit) || 12, 1), 25);

  return cached(`trending:${perPage}`, TRENDING_TTL, async () => {
    const data = await anilistRequest(TRENDING_QUERY, { page: 1, perPage });
    return (data?.Page?.media || [])
      .filter((media) => media && !media.isAdult && animeTitle(media))
      .map(normalizeAnime);
  });
}

async function fetchPages(query, variables, maxPages) {
  const items = [];
  const limit = Math.min(Math.max(Number(maxPages) || 1, 1), MAX_PAGES);

  for (let page = 1; page <= limit; page += 1) {
    const data = await anilistRequest(query, {
      ...variables,
      page,
      perPage: PAGE_SIZE,
    });
    const media = data?.Page?.media || [];
    items.push(...media);

    if (!data?.Page?.pageInfo?.hasNextPage || media.length < PAGE_SIZE) break;
  }

  return items;
}

/**
 * Temporada + longas continuções da temporada anterior, como o AniChart faz.
 * Mantém apenas títulos com exibição semanal futura.
 */
export async function fetchSeasonAnime({ year, season, maxPages = 3 } = {}) {
  const seasonYear = Number(year);
  const seasonName = String(season || "").toUpperCase();
  if (!Number.isInteger(seasonYear) || !seasonNames.includes(seasonName))
    return [];

  return cached(
    `season:${seasonYear}:${seasonName}:${maxPages}`,
    SEASON_TTL,
    async () => {
      const media = await fetchPages(
        SEASON_QUERY,
        { season: seasonName, year: seasonYear },
        maxPages,
      );

      // Continuções de 16+ episódios que começaram na temporada anterior e
      // continuam no ar (por exemplo, One Piece e séries de longa duração).
      const index = seasonNames.indexOf(seasonName);
      const previousSeason = seasonNames[(index + 3) % 4];
      const previousYear = index === 0 ? seasonYear - 1 : seasonYear;
      const continuing = await fetchPages(
        CONTINUING_QUERY,
        { season: previousSeason, year: previousYear },
        1,
      );

      const byId = new Map();
      for (const item of [...media, ...continuing]) {
        if (!item || item.isAdult) continue;
        if (!item.nextAiringEpisode) continue;
        if (!["TV", "TV_SHORT", "ONA", "SPECIAL"].includes(item.format))
          continue;
        byId.set(String(item.id), item);
      }

      return [...byId.values()]
        .map(normalizeAnime)
        .sort((a, b) => b.popularity - a.popularity);
    },
  );
}

export async function fetchSeasonSchedule(options = {}) {
  const season =
    options.season || seasonFromQuarter(options.quarter);
  const anime = await fetchSeasonAnime({ ...options, season });
  return anime
    .map((item) =>
      scheduleFromAnime(item, {
        year: options.year,
        quarter: options.quarter,
      }),
    )
    .filter(Boolean);
}
