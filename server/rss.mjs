
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const MAX_FEED_SIZE = 2 * 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 12000;
const FEED_HEADERS = {
  'User-Agent': 'VisionNewsRSS/1.0',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
};
const ARTICLE_HEADERS = {
  'User-Agent': 'VisionNewsExtractor/1.0',
  'Accept': 'text/html, application/xhtml+xml, */*'
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  removeNSPrefix: false,
  allowBooleanAttributes: false,
  maxNestedTags: 100
});

const array = value => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

function getValue(value) {
  if (value === undefined || value === null) return '';

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    return String(
      value['#text'] ??
      value['#cdata'] ??
      value['@_href'] ??
      ''
    );
  }

  return '';
}

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return '';

  for (const key of keys) {
    const value = getValue(object[key]);
    if (value.trim()) return value;
  }

  return '';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = parseInt(code, 16);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function cleanText(value, maxLength = 100000) {
  // Alguns feeds Atom entregam HTML escapado (&lt;p&gt;...). Removemos as
  // tags uma vez antes e outra depois de decodificar as entidades, de modo
  // que nem a marcação literal nem a escapada cheguem ao texto editorial.
  return stripTags(decodeEntities(stripTags(value)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

const genericFonts = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset']);

function normalizeFont(value) {
  const family = String(value || '')
    .split(',')[0]
    .replace(/^["']|["']$/g, '')
    .trim()
    .slice(0, 80);

  return family && !genericFonts.has(family.toLowerCase()) && /^[\p{L}\p{N} ._'&-]+$/u.test(family)
    ? family
    : '';
}

function normalizeColor(value) {
  const input = String(value || '').trim();
  if (/^#[\da-f]{6}$/i.test(input)) return input.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(input)) {
    return '#' + [...input.slice(1)].map(char => char + char).join('').toLowerCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(input);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    return parts.every(n => n <= 255)
      ? '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('')
      : '';
  }
  return '';
}

/** Extrai apenas dicas de estilo do HTML do feed; o HTML em si é descartado. */
export function extractStyleHints(values) {
  const html = decodeEntities(values.map(getValue).join(' '))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .slice(0, 200000);
  if (!html.trim()) return null;

  const fonts = [];
  const colors = [];
  const backgrounds = [];
  const push = (list, value, limit) => {
    if (value && !list.includes(value) && list.length < limit) list.push(value);
  };

  let match;
  const familyPattern = /family=([^&"'\s]+)/gi;
  while ((match = familyPattern.exec(html))) {
    decodeURIComponent(match[1])
      .split('|')
      .forEach(part => push(fonts, normalizeFont(part.split(':')[0].replace(/\+/g, ' ')), 12));
  }

  // O nome da família pode vir entre aspas, como em CSS publicado por editores.
  const fontFamilyPattern = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/gi;
  while ((match = fontFamilyPattern.exec(html))) {
    push(fonts, normalizeFont(match[1] || match[2] || match[3]), 12);
  }

  const facePattern = /\bface\s*=\s*["']([^"']+)["']/gi;
  while ((match = facePattern.exec(html))) push(fonts, normalizeFont(match[1]), 12);

  const colorPattern = /(?:^|[;"'\s])color\s*:\s*([^;"'}]+)/gi;
  while ((match = colorPattern.exec(html))) push(colors, normalizeColor(match[1]), 16);

  const backgroundPattern = /background(?:-color)?\s*:\s*([^;"'}]+)/gi;
  while ((match = backgroundPattern.exec(html))) {
    push(backgrounds, normalizeColor(match[1]), 12);
  }

  const fontColorPattern = /\bcolor\s*=\s*["']([^"']+)["']/gi;
  while ((match = fontColorPattern.exec(html))) push(colors, normalizeColor(match[1]), 16);

  return fonts.length || colors.length || backgrounds.length
    ? { fonts, colors, backgrounds }
    : null;
}

function extractImage(value, baseUrl = '') {
  const html = getValue(value);

  const match = html.match(
    /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i
  );

  if (!match) return '';

  return normalizeUrl(match[1], baseUrl);
}

function normalizeUrl(value, baseUrl = '') {
  if (!value) return '';

  try {
    const url = new URL(value, baseUrl);

    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';

    return url.href;
  } catch {
    return '';
  }
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);

  if (parts.length !== 4 || parts.some(n => n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIPv6(address) {
  const ip = address.toLowerCase();

  return (
    ip === '::' ||
    ip === '::1' ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe8') ||
    ip.startsWith('fe9') ||
    ip.startsWith('fea') ||
    ip.startsWith('feb') ||
    ip.startsWith('ff') ||
    ip.startsWith('2001:db8:')
  );
}

function isPublicAddress(address) {
  const version = isIP(address);

  if (version === 4) return !isPrivateIPv4(address);

  if (version === 6) {
    if (address.toLowerCase().startsWith('::ffff:')) {
      const mapped = address.slice(7);
      if (isIP(mapped) === 4) return !isPrivateIPv4(mapped);
    }

    return !isPrivateIPv6(address);
  }

  return false;
}

/**
 * Valida a URL e resolve o domínio para evitar destinos privados.
 * A conexão utiliza o IP validado para reduzir riscos de DNS rebinding.
 */
async function resolvePublicHost(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (!hostname || hostname === 'localhost') {
    throw new Error('Endereço de feed não permitido.');
  }

  if (isIP(hostname)) {
    throw new Error('Feeds com endereço IP direto não são permitidos.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Protocolo não permitido.');
  }

  if (url.username || url.password) {
    throw new Error('URL com credenciais não permitida.');
  }

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Porta não permitida.');
  }

  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true
  });

  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('O domínio aponta para um endereço não permitido.');
  }

  return addresses[0];
}

export async function validateFeedUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Informe uma URL válida para o feed.');
  }

  await resolvePublicHost(url);

  return url.href;
}

function requestOnce(url, address, options = {}) {
  const maxBytes = options.maxBytes || MAX_FEED_SIZE;
  const headers = options.headers || FEED_HEADERS;
  const sizeError = options.sizeError || 'O feed ultrapassou o limite de 2 MB.';

  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;

    const request = transport.request(url, {
      method: 'GET',
      agent: false,
      lookup: (_hostname, options, callback) => {
        const family = isIP(address.address);

        // Node 22+ pede todos os endereços (options.all) ao conectar com happy eyeballs.
        if (options && options.all) {
          callback(null, [{ address: address.address, family }]);
          return;
        }

        callback(null, address.address, family);
      },
      headers
    }, response => {
      const chunks = [];
      let size = 0;

      response.on('data', chunk => {
        size += chunk.length;

        if (size > maxBytes) {
          request.destroy(new Error(sizeError));
          return;
        }

        chunks.push(chunk);
      });

      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });

      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT, () => {
      request.destroy(new Error('Tempo limite ao consultar o feed.'));
    });

    request.on('error', reject);
    request.end();
  });
}

async function downloadPublic(initialUrl, options = {}) {
  let currentUrl = new URL(initialUrl);

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const address = await resolvePublicHost(currentUrl);
    const response = await requestOnce(currentUrl, address, options);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;

      if (!location) {
        throw new Error('Redirecionamento sem destino.');
      }

      currentUrl = new URL(location, currentUrl);

      if (attempt === MAX_REDIRECTS) {
        throw new Error(options.redirectError || 'O feed excedeu o limite de redirecionamentos.');
      }

      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      const label = options.statusLabel || 'O feed';
      throw new Error(`${label} respondeu com HTTP ${response.status}.`);
    }

    if (!response.body.trim()) {
      throw new Error(options.emptyError || 'O feed retornou conteúdo vazio.');
    }

    return {
      body: response.body,
      finalUrl: currentUrl.href,
      etag: response.headers.etag || null,
      lastModified: response.headers['last-modified'] || null
    };
  }

  throw new Error(options.finalError || 'Não foi possível acessar o feed.');
}

async function downloadFeed(initialUrl) {
  const result = await downloadPublic(initialUrl, {
    headers: FEED_HEADERS,
    sizeError: 'O feed ultrapassou o limite de 2 MB.',
    emptyError: 'O feed retornou conteúdo vazio.'
  });

  return {
    xml: result.body,
    finalUrl: result.finalUrl,
    etag: result.etag,
    lastModified: result.lastModified
  };
}

/** Busca HTML público usando a mesma política SSRF do coletor RSS. */
export async function fetchPublicHtml(value) {
  const safeUrl = await validateFeedUrl(value);
  const downloaded = await downloadPublic(safeUrl, {
    headers: ARTICLE_HEADERS,
    sizeError: 'A página ultrapassou o limite de 2 MB.',
    emptyError: 'A página retornou conteúdo vazio.',
    statusLabel: 'A página',
    redirectError: 'A página excedeu o limite de redirecionamentos.',
    finalError: 'Não foi possível acessar a página.'
  });

  return {
    requestedUrl: safeUrl,
    url: downloaded.finalUrl,
    html: downloaded.body,
    etag: downloaded.etag,
    lastModified: downloaded.lastModified,
    fetchedAt: new Date().toISOString()
  };
}

function getAtomLink(item, baseUrl) {
  const links = array(item.link);

  const preferred =
    links.find(link => link['@_rel'] === 'alternate') ||
    links.find(link => !link['@_rel']) ||
    links[0];

  return normalizeUrl(
    preferred?.['@_href'] || getValue(preferred),
    baseUrl
  );
}

function getImage(item, baseUrl) {
  const enclosure = array(item.enclosure).find(entry => {
    const type = String(entry['@_type'] || '');
    return type.startsWith('image/');
  });

  const mediaContent =
    item['media:content'] ||
    item['media:thumbnail'] ||
    item['media:group']?.['media:content'];

  const media = array(mediaContent)[0];

  const candidates = [
    enclosure?.['@_url'],
    media?.['@_url'],
    item.image?.url,
    extractImage(item['content:encoded'], baseUrl),
    extractImage(item.description, baseUrl),
    extractImage(item.content, baseUrl),
    extractImage(item.summary, baseUrl)
  ];

  for (const candidate of candidates) {
    const image = normalizeUrl(getValue(candidate), baseUrl);
    if (image) return image;
  }

  return '';
}

function normalizeItem(item, baseUrl, atom = false) {
  const title = cleanText(firstValue(item, ['title']), 500);

  const link = atom
    ? getAtomLink(item, baseUrl)
    : normalizeUrl(firstValue(item, ['link']), baseUrl);

  const contentSource = firstValue(item, [
    'content:encoded',
    'content',
    'description',
    'summary'
  ]);

  const summarySource = firstValue(item, [
    'description',
    'summary',
    'subtitle',
    'content:encoded',
    'content'
  ]);

  const guid = firstValue(item, ['guid', 'id']);
  const publishedRaw = firstValue(item, [
    'pubDate',
    'published',
    'updated',
    'dc:date'
  ]);

  const parsedDate = publishedRaw
    ? new Date(publishedRaw)
    : null;

  const publishedAt =
    parsedDate && Number.isFinite(parsedDate.getTime())
      ? parsedDate.toISOString()
      : null;

  const author = cleanText(
    firstValue(item, ['author', 'dc:creator']),
    160
  );

  return {
    guid: cleanText(guid || link || title, 1000),
    title,
    summary: cleanText(summarySource, 5000),
    content: cleanText(contentSource, 100000),
    style: extractStyleHints([contentSource, summarySource]),
    link,
    image: getImage(item, baseUrl),
    author,
    publishedAt
  };
}

export function parseFeed(xml, baseUrl = '') {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('Conteúdo XML inválido.');
  }

  if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_SIZE) {
    throw new Error('O feed ultrapassou o limite permitido.');
  }

  // Não processamos DTD ou declarações de entidades externas.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('O feed contém declarações XML não permitidas.');
  }

  const validation = XMLValidator.validate(xml);

  if (validation !== true) {
    throw new Error('O XML do feed está malformado.');
  }

  const parsed = parser.parse(xml);

  const atomFeed = parsed.feed;
  const rssChannel = parsed.rss?.channel;

  // RSS 2.0
  if (rssChannel) {
    const items = array(rssChannel.item)
      .slice(0, MAX_ITEMS)
      .map(item => normalizeItem(item, baseUrl));

    return {
      format: 'rss',
      title: cleanText(getValue(rssChannel.title), 200),
      description: cleanText(getValue(rssChannel.description), 1000),
      siteUrl: normalizeUrl(getValue(rssChannel.link), baseUrl),
      items: items.filter(item => item.title)
    };
  }

  // Atom
  if (atomFeed) {
    const items = array(atomFeed.entry)
      .slice(0, MAX_ITEMS)
      .map(item => normalizeItem(item, baseUrl, true));

    return {
      format: 'atom',
      title: cleanText(getValue(atomFeed.title), 200),
      description: cleanText(getValue(atomFeed.subtitle), 1000),
      siteUrl: getAtomLink(atomFeed, baseUrl),
      items: items.filter(item => item.title)
    };
  }

  // RSS 1.0 / RDF
  const rdfKey = Object.keys(parsed).find(key =>
    key.toLowerCase().endsWith(':rdf')
  );

  if (rdfKey) {
    const rdf = parsed[rdfKey];
    const channel = rdf.channel || {};

    const items = array(rdf.item)
      .slice(0, MAX_ITEMS)
      .map(item => normalizeItem(item, baseUrl));

    return {
      format: 'rdf',
      title: cleanText(getValue(channel.title), 200),
      description: cleanText(getValue(channel.description), 1000),
      siteUrl: normalizeUrl(getValue(channel.link), baseUrl),
      items: items.filter(item => item.title)
    };
  }

  throw new Error('Formato não reconhecido. Esperado RSS ou Atom.');
}

/**
 * Consulta e interpreta um feed.
 * Retorna os dados normalizados para o worker persistir no PostgreSQL.
 */
export async function fetchAndParseFeed(feedUrl) {
  const safeUrl = await validateFeedUrl(feedUrl);
  const downloaded = await downloadFeed(safeUrl);

  const feed = parseFeed(downloaded.xml, downloaded.finalUrl);

  return {
    ...feed,
    requestedUrl: safeUrl,
    finalUrl: downloaded.finalUrl,
    etag: downloaded.etag,
    lastModified: downloaded.lastModified,
    fetchedAt: new Date().toISOString()
  };
}
