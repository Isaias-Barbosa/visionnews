import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/content.js';

const V = globalThis.VisionContent;

test('style marks survive validation and render as escaped inline styles', () => {
  const doc = {
    type: 'doc',
    blocks: [
      {
        type: 'p',
        align: 'center',
        children: [
          {
            text: 'Destaque ',
            font: 'Noto Sans JP',
            size: '22px',
            color: '#123456',
            bg: 'rgb(255, 240, 221)',
            bold: true,
          },
          {
            text: 'Seguro',
            font: '"Roboto", sans-serif',
            color: 'red',
            href: 'https://example.com/materia',
          },
        ],
      },
      {
        type: 'ul',
        items: [[{ text: 'Item com fonte', font: 'M PLUS Rounded 1c', color: '#abc' }]],
      },
    ],
  };

  const value = V.validate(doc);
  assert.equal(value.blocks[0].align, 'center');
  assert.equal(value.blocks[0].children[0].font, 'Noto Sans JP');
  assert.equal(value.blocks[0].children[0].size, '22px');
  assert.equal(value.blocks[0].children[0].color, '#123456');
  assert.equal(value.blocks[0].children[0].bg, '#fff0dd');
  assert.equal(value.blocks[0].children[1].font, 'Roboto');
  assert.equal(value.blocks[0].children[1].color, '#ff0000');
  assert.equal(value.blocks[1].items[0][0].font, 'M PLUS Rounded 1c');
  assert.equal(value.blocks[1].items[0][0].color, '#aabbcc');

  const html = V.render(value);
  assert(html.includes('text-align:center'));
  assert(html.includes('font-family:&quot;Noto Sans JP&quot;'));
  assert(html.includes('font-size:22px'));
  assert(html.includes('background-color:#fff0dd'));
  assert(html.includes('<strong>'));
  assert(html.includes('<a href="https://example.com/materia"'));

  assert.throws(
    () => V.validate({ type: 'doc', blocks: [{ type: 'p', children: [{ text: 'x', font: 'Arial); color:red' }] }] }),
    /Fonte de texto inválida/,
  );
  assert.throws(
    () => V.validate({ type: 'doc', blocks: [{ type: 'p', children: [{ text: 'x', color: 'expression(alert(1))' }] }] }),
    /Cor de texto inválida/,
  );
  assert.throws(
    () => V.validate({ type: 'doc', blocks: [{ type: 'p', align: 'left; color:red', children: [{ text: 'x' }] }] }),
    /Alinhamento inválido/,
  );
});

test('extractStyle keeps only safe font and color hints and fromPlainStyled applies them', () => {
  const style = V.extractStyle(`
    <link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;700&family=Noto+Sans+JP&display=swap" rel="stylesheet">
    <style>.lead { font-family: 'M PLUS Rounded 1c', sans-serif; color: #123456; background-color: rgba(255,240,221,.8); }</style>
    <font face="Roboto Slab" color="rgb(12,34,56)">Texto</font>
    <script>font-family:Evil; color:url(javascript:alert(1))</script>
  `);

  assert.deepEqual(style.fonts.slice(0, 4), [
    'Zen Maru Gothic',
    'Noto Sans JP',
    'M PLUS Rounded 1c',
    'Roboto Slab',
  ]);
  assert.deepEqual(style.colors.slice(0, 2), ['#123456', '#0c2238']);
  assert.deepEqual(style.backgrounds, ['#fff0dd']);

  const doc = V.fromPlainStyled('Primeiro parágrafo.\n\nSegundo parágrafo.', style);
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0].children[0].font, 'Zen Maru Gothic');
  assert.equal(doc.blocks[0].children[0].color, '#123456');
  assert.equal(doc.blocks[0].children[0].bg, '#fff0dd');
  assert.equal(doc.blocks[1].children[0].font, 'Zen Maru Gothic');
  assert(!V.plain(doc).includes('script'));

  assert.deepEqual(V.fontFamilies(doc), ['Zen Maru Gothic']);
  const href = V.fontHref(doc);
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(href, /family=Zen\+Maru\+Gothic/);
  assert.match(href, /display=swap/);

  assert.equal(V.fontFamily('Arial); background:url(javascript:alert(1)'), '');
  assert.equal(V.color('url(javascript:alert(1))'), '');
  assert.equal(V.fontSize('999px'), '');
  assert.equal(V.textAlign('left; color:red'), '');
});

test('ensureFonts injects one stylesheet for the families used in the document', () => {
  const original = globalThis.document;
  const attributes = {};
  const link = {
    setAttribute(name, value) { attributes[name] = value; },
    getAttribute(name) { return attributes[name] ?? null; },
  };
  let appended = 0;

  globalThis.document = {
    head: { appendChild() { appended++; } },
    getElementById(id) { return id === 'visionContentFonts' ? link : null; },
    createElement() { return link; },
  };

  try {
    const doc = V.fromPlainStyled('Texto', { fonts: ['Roboto Slab'] });
    const href = V.ensureFonts(doc);
    assert.match(href, /family=Roboto\+Slab/);
    assert.equal(attributes.href, href);
    assert.equal(appended, 0);

    globalThis.document.getElementById = () => null;
    V.ensureFonts(doc);
    assert.equal(appended, 1);
  } finally {
    globalThis.document = original;
  }
});
