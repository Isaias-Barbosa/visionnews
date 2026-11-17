
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs';

import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');

if (out !== path.join(root, 'dist')) {
  throw new Error('Unexpected output path');
}

// Limpa a pasta de build
rmSync(out, { recursive: true, force: true });

// Cria as pastas necessárias
mkdirSync(path.join(out, 'server'), { recursive: true });
mkdirSync(path.join(out, '.openai'), { recursive: true });

// Copia os módulos do servidor para o dist.
// Isso mantém disponíveis os imports relativos,
// como ./rss.mjs, ./postgres.mjs e outros.
cpSync(
  path.join(root, 'server'),
  path.join(out, 'server'),
  { recursive: true }
);

const assets = {};

function walk(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const key = prefix + '/' + entry.name;

    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), key);
    } else {
      const ext = path.extname(entry.name);

      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      }[ext];

      if (!mime) {
        throw new Error('Unsupported asset ' + key);
      }

      assets[key] = {
        body: readFileSync(path.join(dir, entry.name), 'utf8')
          .replace(/^\uFEFF/, ''),
        type: mime,
      };
    }
  }
}

// Carrega os arquivos públicos
walk(path.join(root, 'public'));

// Monta o Worker principal
const source = readFileSync(
  path.join(root, 'server/worker.mjs'),
  'utf8'
);

writeFileSync(
  path.join(out, 'server/index.js'),
  'const assets=' +
    JSON.stringify(assets) +
    ';\n' +
    readFileSync(path.join(root, 'public/content.js'), 'utf8')
      .replace(/^\uFEFF/, '') +
    '\n' +
    source
);

// Copia a configuração de hospedagem
writeFileSync(
  path.join(out, '.openai/hosting.json'),
  readFileSync(path.join(root, '.openai/hosting.json'), 'utf8')
    .replace(/^\uFEFF/, '')
);

console.log(
  'Built VisionNews Worker with ' +
  Object.keys(assets).length +
  ' assets'
);
