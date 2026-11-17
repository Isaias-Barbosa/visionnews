import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, validateFeedUrl } from '../server/rss.mjs';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Anime Radar &amp; Notícias</title>
    <link>https://example.com/</link>
    <description>Últimas do mundo anime</description>
    <item>
      <title>Novo anime &lt;strong&gt;anunciado&lt;/strong&gt;</title>
      <link>/noticias/novo-anime</link>
      <description><![CDATA[<p>Resumo com <strong>destaque</strong> e <script>alert(1)</script>.</p>]]></description>
      <content:encoded><![CDATA[<p>Conteúdo completo &amp; revisado.</p><img src="https://cdn.example.com/capa.jpg" alt="">]]></content:encoded>
      <guid>https://example.com/noticias/novo-anime</guid>
      <pubDate>Mon, 16 Nov 2026 12:00:00 GMT</pubDate>
      <dc:creator>Redação</dc:creator>
      <enclosure url="https://cdn.example.com/enclosure.jpg" type="image/jpeg" length="1234"/>
    </item>
    <item>
      <title>Segunda notícia do radar</title>
      <link>https://example.com/noticias/segunda</link>
      <description>Outro resumo para a listagem editorial.</description>
      <content:encoded><![CDATA[<div><p>Texto longo o bastante para o rascunho editorial funcionar.</p><img src="//cdn.example.com/segunda.jpg"></div>]]></content:encoded>
      <guid>https://example.com/noticias/segunda</guid>
      <pubDate>invalid date</pubDate>
    </item>
    <item>
      <title></title>
      <link>https://example.com/noticias/sem-titulo</link>
    </item>
  </channel>
</rss>`;

test('RSS 2.0 parser sanitizes HTML, decodes entities and extracts metadata', () => {
  const feed = parseFeed(rss, 'https://feeds.example.com/rss.xml');

  assert.equal(feed.format, 'rss');
  assert.equal(feed.title, 'Anime Radar & Notícias');
  assert.equal(feed.description, 'Últimas do mundo anime');
  assert.equal(feed.siteUrl, 'https://example.com/');
  assert.equal(feed.items.length, 2);

  const [first, second] = feed.items;

  // Tags literais e escapadas são removidas, inclusive script.
  assert.equal(first.title, 'Novo anime anunciado');
  assert.equal(
    first.summary,
    'Resumo com destaque e .',
  );
  assert.equal(first.content, 'Conteúdo completo & revisado.');
  // Links relativos são resolvidos a partir do endereço do feed.
  assert.equal(first.link, 'https://feeds.example.com/noticias/novo-anime');
  assert.equal(first.guid, 'https://example.com/noticias/novo-anime');
  assert.equal(first.image, 'https://cdn.example.com/enclosure.jpg');
  assert.equal(first.author, 'Redação');
  assert.equal(first.publishedAt, '2026-11-16T12:00:00.000Z');

  // Sem enclosure, a imagem é encontrada no HTML do conteúdo e normalizada.
  assert.equal(second.image, 'https://cdn.example.com/segunda.jpg');
  assert.equal(second.publishedAt, null);
  assert(!second.title.includes('<'));
  assert(!second.content.includes('<p>'));
});

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Temporada Anime</title>
  <subtitle>Guias e estreias</subtitle>
  <link href="https://atom.example.com/" rel="alternate"/>
  <entry>
    <title>Temporada de inverno</title>
    <link rel="alternate" href="https://atom.example.com/temporada"/>
    <id>tag:atom.example.com,2026:1</id>
    <updated>2026-11-16T09:30:00Z</updated>
    <summary type="html">&lt;p&gt;Resumo &lt;em&gt;escapado&lt;/em&gt;&lt;/p&gt;</summary>
    <content type="html">&lt;div&gt;&lt;p&gt;Texto completo do feed.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/div&gt;</content>
  </entry>
</feed>`;

test('Atom parser resolves links and strips escaped HTML in summary and content', () => {
  const feed = parseFeed(atom, 'https://mirror.example.com/atom.xml');

  assert.equal(feed.format, 'atom');
  assert.equal(feed.title, 'Temporada Anime');
  assert.equal(feed.description, 'Guias e estreias');
  assert.equal(feed.siteUrl, 'https://atom.example.com/');
  assert.equal(feed.items.length, 1);

  const [entry] = feed.items;

  assert.equal(entry.title, 'Temporada de inverno');
  assert.equal(entry.link, 'https://atom.example.com/temporada');
  assert.equal(entry.summary, 'Resumo escapado');
  assert.equal(entry.content, 'Texto completo do feed.');
  assert.equal(entry.publishedAt, '2026-11-16T09:30:00.000Z');
  assert(!entry.content.includes('script'));
});

const rdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns="http://purl.org/rss/1.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example.com/">
    <title>RDF Anime</title>
    <link>https://rdf.example.com/</link>
    <description>Feed RSS 1.0</description>
  </channel>
  <item rdf:about="https://rdf.example.com/item">
    <title>Item em RDF</title>
    <link>https://rdf.example.com/item</link>
    <description>Resumo do item em RDF.</description>
    <dc:date>2026-11-15T10:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

test('RSS 1.0 / RDF feeds are accepted', () => {
  const feed = parseFeed(rdf, 'https://rdf.example.com/');

  assert.equal(feed.format, 'rdf');
  assert.equal(feed.title, 'RDF Anime');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, 'Item em RDF');
  assert.equal(feed.items[0].publishedAt, '2026-11-15T10:00:00.000Z');
});

test('malformed, empty and unrecognized documents are rejected', () => {
  assert.throws(() => parseFeed(''), /Conteúdo XML inválido/);
  assert.throws(
    () => parseFeed('<rss><channel><item></channel></rss>'),
    /malformado/,
  );
  assert.throws(
    () => parseFeed('<root><child>texto</child></root>'),
    /Formato não reconhecido/,
  );
});

test('DOCTYPE and ENTITY declarations are refused before parsing', () => {
  assert.throws(
    () =>
      parseFeed(
        '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><title>x</title></channel></rss>',
      ),
    /declarações XML não permitidas/,
  );

  assert.throws(
    () =>
      parseFeed(
        '<rss><channel><title>&entity;</title></channel></rss><!ENTITY entity "value">',
      ),
    /declarações XML não permitidas/,
  );
});

test('validateFeedUrl refuses unsafe destinations without DNS lookups', async () => {
  const cases = [
    ['not-a-url', /URL válida/],
    ['https://localhost/feed', /feed não permitido/],
    ['https://127.0.0.1/feed', /IP direto/],
    ['https://[::1]/feed', /IP direto/],
    ['ftp://example.com/feed', /Protocolo não permitido/],
    ['https://user:secret@example.com/feed', /credenciais/],
    ['https://example.com:8080/feed', /Porta não permitida/],
  ];

  for (const [value, message] of cases) {
    await assert.rejects(() => validateFeedUrl(value), message);
  }
});
