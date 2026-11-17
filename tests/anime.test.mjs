import test from "node:test";
import assert from "node:assert/strict";
import {
  brasiliaSlot,
  cleanDescription,
  normalizeAnime,
  recommendationFromAnime,
  scheduleFromAnime,
  seasonFromQuarter,
  streamLinks,
} from "../server/anime.mjs";

const airingAt = Math.floor(Date.UTC(2026, 10, 20, 12, 0, 0) / 1000);

const media = {
  id: 9001,
  idMal: 1234,
  title: {
    romaji: "Teste no Anime",
    english: "Test Anime",
    native: "テスト",
  },
  description:
    "Sinopse <i>com</i> HTML &amp; detalhes.<br>Segunda linha com <b>destaque</b>.",
  coverImage: { extraLarge: "https://s4.anilist.co/file/test.jpg" },
  bannerImage: "https://s4.anilist.co/file/banner.jpg",
  siteUrl: "https://anilist.co/anime/9001",
  format: "TV",
  status: "RELEASING",
  episodes: 12,
  season: "FALL",
  seasonYear: 2026,
  genres: ["Action", "Fantasy"],
  averageScore: 80,
  popularity: 1000,
  nextAiringEpisode: { airingAt, episode: 8 },
  externalLinks: [
    { site: "Twitter", url: "https://x.com/teste" },
    { site: "Crunchyroll", url: "https://www.crunchyroll.com/teste" },
    { site: "Netflix", url: "http://www.netflix.com/teste" },
    { site: "Official Site", url: "https://anime.example.com/" },
  ],
};

test("descriptions are cleaned and trimmed without HTML", () => {
  assert.equal(
    cleanDescription(media.description),
    "Sinopse com HTML & detalhes. Segunda linha com destaque.",
  );

  const long = cleanDescription("palavra ".repeat(120), 60);
  assert(long.length <= 60);
  assert(long.endsWith("…"));
  assert(!long.includes("<"));
});

test("Brasília slots use the Monday-first weekday and h23 time", () => {
  assert.deepEqual(brasiliaSlot(airingAt), { weekday: 4, time: "09:00" });
  assert.deepEqual(brasiliaSlot(null), { weekday: null, time: "" });
  assert.deepEqual(brasiliaSlot("invalid"), { weekday: null, time: "" });
});

test("stream links keep recognized HTTPS platforms in priority order", () => {
  assert.deepEqual(streamLinks(media), [
    { name: "Crunchyroll", url: "https://www.crunchyroll.com/teste" },
  ]);
});

test("AniList media becomes a calendar draft in the existing fields", () => {
  const anime = normalizeAnime(media);
  const draft = scheduleFromAnime(anime, { year: 2026, quarter: 4 });

  assert.equal(draft.title, "Teste no Anime");
  assert.equal(draft.weekday, 4);
  assert.equal(draft.time, "09:00");
  assert.equal(draft.platform, "Crunchyroll");
  assert.equal(draft.official_url, "https://www.crunchyroll.com/teste");
  assert.equal(draft.language, "Legendado");
  assert.equal(draft.season_year, 2026);
  assert.equal(draft.season_quarter, 4);
  assert.equal(draft.cover, "https://s4.anilist.co/file/test.jpg");
  assert.equal(draft.episode, "Episódio 8");
  assert.equal(draft.status, "draft");
  assert(draft.summary.length > 15);
});

test("titles without a weekly airing do not enter the calendar", () => {
  const anime = normalizeAnime({ ...media, nextAiringEpisode: null });
  assert.equal(scheduleFromAnime(anime, { year: 2026, quarter: 4 }), null);
});

test("the recommendation prefill stays a draft and carries streams", () => {
  const anime = normalizeAnime(media);
  const draft = recommendationFromAnime(anime, "2026-11-16");

  assert.equal(draft.feature_date, "2026-11-16");
  assert.equal(draft.status, "draft");
  assert.equal(draft.title, "Teste no Anime");
  assert.deepEqual(draft.streams, [
    { name: "Crunchyroll", url: "https://www.crunchyroll.com/teste" },
  ]);
  assert(draft.summary.length >= 15);
  assert(draft.summary.length <= 600);
});

test("quarter and season names map to AniList seasons", () => {
  assert.equal(seasonFromQuarter(1), "WINTER");
  assert.equal(seasonFromQuarter(2), "SPRING");
  assert.equal(seasonFromQuarter(3), "SUMMER");
  assert.equal(seasonFromQuarter(4), "FALL");
  assert.equal(seasonFromQuarter(0), null);
  assert.equal(seasonFromQuarter("x"), null);
});
