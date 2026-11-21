import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const html = read('public/dashboard/index.html');
const dashboard = read('public/dashboard/dashboard.js');
const studio = read('public/dashboard/studio.js');
const css = read('public/dashboard/studio.css');

test('dashboard HTML loads the VisionNews Studio panel safely', () => {
  assert.match(html, /<title>VisionNews Studio<\/title>/);
  assert.match(html, /DASHBOARD EDITORIAL|VISIONNEWS STUDIO/);
  assert.match(html, /data-module="studio"/);
  assert.match(html, /id="studioPanel"/);
  assert.match(html, /id="studioWorkspace"/);
  assert.match(html, /href="\/dashboard\/studio\.css"/);
  assert.match(html, /src="\/dashboard\/studio\.js"/);
  // O módulo precisa existir antes de o dashboard tentar montá-lo.
  assert.ok(
    html.indexOf('/dashboard/studio.js') < html.indexOf('/dashboard/dashboard.js'),
  );
});

test('studio frontend reads the pipeline and never publishes automatically', () => {
  for (const route of [
    '/api/editor/pipeline/queue',
    '/api/editor/pipeline/enqueue',
    '/api/editor/pipeline/process',
    '/api/editor/pipeline/retry',
    '/api/editor/pipeline/suggestions',
  ]) {
    assert.ok(studio.includes(route), `rota ausente: ${route}`);
  }

  assert.ok(!studio.includes('/api/editor/news'));
  assert.ok(!studio.includes('javascript:'));
  assert.match(studio, /function esc\(/);
  assert.match(studio, /textContent/);
  assert.match(studio, /safeHttps/);
  assert.match(studio, /function hasRewriteSuggestion/);
  assert.match(studio, /function queueNote/);
  assert.match(studio, /não gerou sugestão/);
  assert.match(studio, /data-studio-action="retry"/);
  assert.match(studio, /Reprocessar falhas/);
  assert.match(studio, /limit: 20/);
});

test('dashboard integrates studio without changing editorial publication', () => {
  assert.match(dashboard, /studioWorkspace = null/);
  assert.match(dashboard, /function mountStudioWorkspace/);
  assert.match(dashboard, /function openStudioSuggestion/);
  assert.match(dashboard, /\$\('studioPanel'\)\.hidden = !isStudio/);
  assert.match(dashboard, /if \(isStudio\) \{[\s\S]*mountStudioWorkspace\(\);[\s\S]*return;/);
  assert.match(dashboard, /openStudioSuggestion,/);
  assert.match(dashboard, /openStudio\(\) \{\s*switchModule\("studio"\);\s*\}/);
  assert.match(dashboard, /body_format: "plain"/);
});

test('studio styles are scoped and responsive', () => {
  assert.match(css, /\.studioHead/);
  assert.match(css, /\.studioRow/);
  assert.match(css, /\.studioPreview/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.ok(!css.includes('/api/'));
});

test('administrative links use the new studio name', () => {
  for (const path of [
    'public/admin/index.html',
    'public/admin/rss.html',
    'public/admin/usuarios.html',
    'public/rss.html',
  ]) {
    assert.ok(!read(path).includes('Dashboard editorial'), path);
    assert.ok(read(path).includes('VisionNews Studio'), path);
  }
});

test('RSS radar supports batch selection for drafts and production queue', () => {
  const radar = read('public/rss.js');
  const radarCss = read('public/rss.css');

  assert.match(radar, /data-role="bulkAll"/);
  assert.match(radar, /data-action="bulk-draft"/);
  assert.match(radar, /data-action="bulk-queue"/);
  assert.match(radar, /data-pick="/);
  assert.match(radar, /\/rss-items\/\$\{id\}\/import/);
  assert.match(radar, /rssItemIds: ids/);
  assert.match(radar, /function isNew\(item\)/);
  assert.match(radarCss, /\.rssBulkBar/);
  assert.match(radarCss, /\.rssPickCheck/);
  assert.ok(!radar.includes('status: \'published\''));
});
