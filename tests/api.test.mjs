import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import worker,{canAdmin,rssDraftInput,validateNews,validateSchedule} from '../dist/server/index.js';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync('drizzle/0000_news.sql','utf8').replace(/^\uFEFF/,''));
db.exec(readFileSync('drizzle/0001_editor_reviews_schedule.sql','utf8').replace(/^\uFEFF/,''));
db.exec(readFileSync('drizzle/0002_editorial_dashboard.sql','utf8'));
db.exec(readFileSync('drizzle/0003_news_feature.sql','utf8'));
db.exec(readFileSync('drizzle/0004_rss.sql','utf8'));
db.exec(readFileSync('drizzle/0006_rss_style.sql','utf8'));
const env={
 ADMIN_EMAIL:'editor@example.com',
 DB:{prepare(sql){
  let args=[];
  return {
   bind(...values){args=values;return this},
   async all(){return {results:db.prepare(sql).all(...args)}},
   async first(){return db.prepare(sql).get(...args)||null},
   async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}
  };
 }}
};
const sample={title:'Uma nova história para descobrir',summary:'Uma notícia de teste para verificar o fluxo da redação.',body:'Conteúdo de teste para confirmar que somente matérias publicadas entram no portal.',author:'Redação',category:'Notícias',status:'draft',cover:'',source_url:'https://example.com/noticia',source_label:'Fonte oficial'};
const headers={'oai-authenticated-user-id':'editor-id','oai-authenticated-user-email':'editor@example.com','Origin':'https://vision.test','Content-Type':'application/json'};
const request=(path,method='GET',body,extra={})=>new Request('https://vision.test'+path,{method,headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{})});
test('first published news retires demo and only the latest featured decision controls the banner',async()=>{
 const publicNews=async()=>await (await worker.fetch(request('/api/news'),env)).json();
 const create=async input=>{
  const response=await worker.fetch(request('/api/editor/news','POST',{...sample,...input}),env);
  assert.equal(response.status,201);
  return (await response.json()).item;
 };
 const edit=async(item,input)=>{
  const response=await worker.fetch(request('/api/editor/news/'+item.id,'PUT',{...sample,version:item.version,...input}),env);
  assert.equal(response.status,200);
  return (await response.json()).item;
 };
 assert.equal((await publicNews()).demo,true);
 let first=await create({featured:true});
 assert.equal((await publicNews()).demo,true);
 assert.equal((await publicNews()).featuredId,null);
 first=await edit(first,{status:'published',featured:true});
 assert.equal((await publicNews()).demo,false);
 assert.equal((await publicNews()).featuredId,first.id);
 let second=await create({status:'published',featured:true});
 assert.equal((await publicNews()).featuredId,second.id);
 second=await edit(second,{status:'archived',featured:true});
 assert.equal((await publicNews()).featuredId,null);
 await edit(first,{status:'archived',category:'Guias',featured:false});
 assert.equal((await publicNews()).demo,false);
 db.exec('DELETE FROM news');
});
test('authorization fails closed and does not expose drafts',async()=>{assert.equal(canAdmin(new Request('https://vision.test'),env),false);assert.equal(canAdmin(request('/'),{}),false);assert.equal((await worker.fetch(new Request('https://vision.test/api/admin/news'),env)).status,401);assert.equal((await worker.fetch(request('/api/admin/news','GET',null,{'oai-authenticated-user-email':'other@example.com'}),env)).status,403);assert.equal((await worker.fetch(request('/api/admin/news','POST',sample,{Origin:'https://other.test'}),env)).status,403);assert.equal((await worker.fetch(request('/admin'),env)).status,200)});
test('validation rejects unsafe links and unsourced published news',()=>{assert(validateNews({...sample,cover:'javascript:alert(1)'}).errors.length);assert(validateNews({...sample,status:'published',source_url:''}).errors.length);assert.equal(validateNews(sample).errors.length,0)});
test('create, publish, conflict, unpublish and archive with real SQLite schema',async()=>{let r=await worker.fetch(request('/api/admin/news','POST',sample),env);assert.equal(r.status,201);let {item}=await r.json();assert.equal(item.version,1);const list=async()=>{const r=await worker.fetch(request('/api/news'),env);return (await r.json()).items};assert.equal((await list()).length,0);r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'published',version:1}),env);assert.equal(r.status,200);item=(await r.json()).item;assert.equal(item.version,2);assert(item.published_at);assert.equal((await list()).length,1);assert(!('version' in (await list())[0]));r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'published',version:1}),env);assert.equal(r.status,409);r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'archived',version:2}),env);assert.equal(r.status,200);assert.equal((await list()).length,0);const admin=await worker.fetch(request('/api/admin/news'),env);assert.equal((await admin.json()).items[0].status,'archived')});
test('published records remain untrusted text and pages retain security headers',async()=>{const result=await worker.fetch(request('/api/admin/news','POST',{...sample,title:'<img src=x onerror=alert(1)>',status:'published'}),env);assert.equal(result.status,201);const page=await worker.fetch(request('/'),env);assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("object-src 'none'"));const r=await worker.fetch(request('/api/admin/news','POST',sample,{'Content-Type':'text/plain'}),env);assert.equal(r.status,403)});
test('rich text allows formatting but escapes HTML and rejects unsafe links',async()=>{const doc={type:'doc',blocks:[{type:'h2',children:[{text:'Um título editorial'}]},{type:'p',children:[{text:'Um conteúdo longo o bastante para validar a formatação. ',bold:true},{text:'<script>alert(1)</script>',italic:true}]},{type:'ul',items:[[{text:'Primeiro item'}],[{text:'Segundo item'}]]}]};const input={...sample,category:'Reviews',anime_title:'Frieren',review_score:9.5,review_verdict:'Uma jornada contemplativa.',body_format:'rich-v1',body:JSON.stringify(doc),status:'published',cover:'https://cdn.animenewsnetwork.com/thumbnails/max600x600/cms/news.10/243498/ovlb-igpost-1080x1350.jpeg'};assert.equal(validateNews(input).errors.length,0);const r=await worker.fetch(request('/api/admin/news','POST',input),env);assert.equal(r.status,201);const {item}=await r.json();assert.equal(item.review_score,9.5);assert.equal(item.body_format,'rich-v1');const html=globalThis.VisionContent.render(JSON.parse(item.body));assert(html.includes('<strong>'));assert(html.includes('<ul>'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));const bad={type:'doc',blocks:[{type:'p',children:[{text:'Unsafe link',href:'javascript:alert(1)'}]}]};assert.throws(()=>globalThis.VisionContent.render(bad));assert(validateNews({...input,review_score:11}).errors.length);assert(validateNews({...input,body:'{bad json'}).errors.length)});
test('calendar validates Brazilian season, official link, time and revision',async()=>{const input={title:'Anime em teste',summary:'Agenda de teste isolada do site real.',weekday:4,time:'19:30',platform:'Crunchyroll',official_url:'https://example.com/official',language:'Legendado',season_year:2026,season_quarter:4,cover:'',episode:'Episódio 1',status:'draft'};assert.equal(validateSchedule(input).errors.length,0);assert(validateSchedule({...input,time:'25:70'}).errors.length);assert(validateSchedule({...input,weekday:7}).errors.length);assert(validateSchedule({...input,status:'published',official_url:''}).errors.length);assert.equal((await worker.fetch(new Request('https://vision.test/api/admin/schedule'),env)).status,401);let r=await worker.fetch(request('/api/admin/schedule','POST',input),env);assert.equal(r.status,201);let item=(await r.json()).item;const list=async(q=4)=>{const r=await worker.fetch(request('/api/schedule?year=2026&quarter='+q),env);return (await r.json()).items};assert.equal((await list()).length,0);r=await worker.fetch(request('/api/admin/schedule/'+item.id,'PUT',{...input,status:'published',version:1}),env);assert.equal(r.status,200);assert.equal((await list()).length,1);assert.equal((await list(3)).length,0);assert.equal((await worker.fetch(request('/api/admin/schedule/'+item.id,'PUT',{...input,version:1}),env)).status,409);r=await worker.fetch(request('/api/admin/schedule/'+item.id,'PUT',{...input,status:'archived',version:2}),env);assert.equal(r.status,200);assert.equal((await list()).length,0)});

test('editor access is limited to the editorial dashboard and its API', async () => {
 const collection='/api/admin/editors';
 assert.equal((await worker.fetch(request(collection,'POST',{email:'COLLEAGUE@example.com'}),env)).status,200);
 const delegated=env;
 const colleague = path => request(path,'GET',null,{'oai-authenticated-user-email':'colleague@example.com'});
 assert.equal((await worker.fetch(colleague('/dashboard'),delegated)).status,200);
 assert.equal((await worker.fetch(colleague('/api/editor/news'),delegated)).status,200);
 assert.equal((await worker.fetch(colleague('/admin'),delegated)).status,403);
 assert.equal((await worker.fetch(colleague('/api/admin/overview'),delegated)).status,403);
 assert.equal((await worker.fetch(new Request('https://vision.test/dashboard'),delegated)).status,302);
 const response = await worker.fetch(request('/api/admin/overview'),delegated);
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).editors,['colleague@example.com']);
 assert.equal((await worker.fetch(request(collection,'DELETE',{email:'colleague@example.com'}),env)).status,200);
 assert.equal((await worker.fetch(colleague('/api/editor/news'),env)).status,403);
});

test('daily recommendation respects date, status, official links and unique dates', async () => {
 const collection = '/api/editor/recommendations';
 const publicItem = async () => (await (await worker.fetch(request('/api/recommendation'),env)).json()).item;
 const feature_date = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
 const input = {
  feature_date,title:'Anime de teste',summary:'Uma indicação editorial de teste.',
  streams:[{name:'Plataforma oficial',url:'https://example.com/anime'}],status:'draft'
 };
 const write = (path,method,data) => worker.fetch(request(path,method,data),env);
 assert.equal((await write(collection,'POST',{...input,feature_date:'2026-02-30'})).status,422);
 assert.equal((await write(collection,'POST',{...input,streams:[{name:'Inválida',url:'javascript:alert(1)'}]})).status,422);
 assert.equal((await write(collection,'POST',{...input,streams:[],status:'published'})).status,422);
 const created = await write(collection,'POST',input);
 assert.equal(created.status,201);
 const {item} = await created.json();
 assert.equal(await publicItem(),null);
 assert.equal((await write(collection,'POST',input)).status,409);
 const path = collection+'/'+item.id;
 assert.equal((await write(path,'PUT',{...input,version:1,status:'published'})).status,200);
 assert.deepEqual((await publicItem()).streams,input.streams);
 assert.equal((await write(path,'PUT',{...input,version:1,status:'archived'})).status,409);
 assert.equal((await write(path,'PUT',{...input,version:2,status:'archived'})).status,200);
 assert.equal(await publicItem(),null);
 assert.equal((await write(collection,'POST',{...input,feature_date:'2099-01-01',status:'published'})).status,201);
 assert.equal(await publicItem(),null);
});


test('RSS radar lists sources, filters items and imports drafts without bypassing review', async () => {
 const now = new Date().toISOString();
 const insertFeed = db.prepare('INSERT INTO rss_feeds (name,feed_url,site_url,is_active,auto_import,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
 const insertItem = db.prepare('INSERT INTO rss_items (feed_id,item_key,guid,link,title,summary,content,image_url,author,published_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 const idOf = (table, url) => db.prepare(`SELECT id FROM ${table} WHERE feed_url=?`).get(url).id;

 insertFeed.run('Feed Principal','https://feeds.example.com/a.xml','https://anime.example.com/',1,0,now,now);
 const feedA = idOf('rss_feeds','https://feeds.example.com/a.xml');
 insertFeed.run('Feed Secundário','https://feeds.example.com/b.xml','https://manga.example.com/',1,0,now,now);
 const feedB = idOf('rss_feeds','https://feeds.example.com/b.xml');

 insertItem.run(feedA,'key-1','guid-1','https://anime.example.com/primeira','Primeira notícia do radar','Resumo editorial número um para a listagem.','Conteúdo completo da primeira notícia para o rascunho editorial.','https://cdn.example.com/1.jpg','Redação','2026-11-16T12:00:00.000Z',now);
 insertItem.run(feedA,'key-2','guid-2','https://anime.example.com/segunda','Segunda notícia do radar','Outro resumo para testar a busca por texto.','Conteúdo completo da segunda notícia para o rascunho editorial.','','Equipe','2026-11-15T09:00:00.000Z',now);
 insertItem.run(feedB,'key-3','guid-3','https://manga.example.com/terceira','Notícia de outra fonte','Resumo vindo do segundo feed cadastrado.','Conteúdo completo da notícia do segundo feed para o rascunho.','','Redação','2026-11-14T08:00:00.000Z',now);

 const anon = await worker.fetch(new Request('https://vision.test/rss'),env);
 assert.equal(anon.status,302);
 const rssPage = await worker.fetch(request('/rss'),env);
 assert.equal(rssPage.status,200);
 assert((await rssPage.text()).includes('rssWorkspace'));
 assert.equal((await worker.fetch(request('/admin/rss'),env)).status,200);
 assert.equal((await worker.fetch(request('/rss','GET',null,{'oai-authenticated-user-email':'other@example.com'}),env)).status,403);
 assert.equal((await worker.fetch(request('/admin/rss','GET',null,{'oai-authenticated-user-email':'other@example.com'}),env)).status,403);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds'),env)).status,200);
 assert.equal((await worker.fetch(request('/api/rss/sources'),env)).status,200);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds','POST',{name:'A',feed_url:'https://feeds.example.com/c.xml'}),env)).status,422);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds','POST',{name:'Feed inválido',feed_url:'not-a-url'}),env)).status,422);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds','POST',{name:'Feed privado',feed_url:'http://127.0.0.1/feed.xml'}),env)).status,422);

 let feeds = await (await worker.fetch(request('/api/editor/rss-feeds'),env)).json();
 assert.equal(feeds.items.length,2);
 const feedAResponse = feeds.items.find(feed => feed.id === feedA);
 assert.equal(feedAResponse.is_active,true);
 assert.equal(feedAResponse.auto_import,false);
 assert.equal(feedAResponse.total_items,2);
 assert.equal(feedAResponse.imported_items,0);

 let list = await (await worker.fetch(request('/api/editor/rss-items'),env)).json();
 assert.equal(list.total,3);
 assert.deepEqual(list.items.map(item => item.title),['Primeira notícia do radar','Segunda notícia do radar','Notícia de outra fonte']);
 assert.equal(list.items[0].feed_name,'Feed Principal');
 assert.equal(list.page,1);

 list = await (await worker.fetch(request(`/api/editor/rss-items?feed=${feedB}`),env)).json();
 assert.equal(list.total,1);
 assert.equal(list.items[0].feed_id,feedB);

 list = await (await worker.fetch(request('/api/editor/rss-items?q=SEGUNDA'),env)).json();
 assert.equal(list.total,1);
 assert.equal(list.items[0].title,'Segunda notícia do radar');

 list = await (await worker.fetch(request('/api/editor/rss-items?limit=1&page=2'),env)).json();
 assert.equal(list.total,3);
 assert.equal(list.pages,3);
 assert.equal(list.page,2);
 assert.equal(list.items.length,1);

 list = await (await worker.fetch(request('/api/editor/rss-items?imported=false'),env)).json();
 assert.equal(list.total,3);

 const itemId = list.items[0].id;
 let detail = await (await worker.fetch(request('/api/editor/rss-items/'+itemId),env)).json();
 assert.equal(detail.item.imported,false);
 assert.equal((await worker.fetch(request('/api/editor/rss-items/999999'),env)).status,404);
 assert.equal((await worker.fetch(request('/api/rss/articles/'+itemId),env)).status,200);

 let update = await worker.fetch(request('/api/editor/rss-feeds/'+feedA,'PUT',{name:'Feed Principal Editado',auto_import:true}),env);
 assert.equal(update.status,200);
 let updated = (await update.json()).item;
 assert.equal(updated.name,'Feed Principal Editado');
 assert.equal(updated.auto_import,true);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/'+feedA,'PUT',{name:'x'}),env)).status,422);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/999999','PUT',{name:'Inexistente'}),env)).status,404);

 // Importação direta cria rascunho e marca o item como cadastrado.
 const imported = await worker.fetch(request('/api/editor/rss-items/'+itemId+'/import','POST'),env);
 assert.equal(imported.status,201);
 const importedData = await imported.json();
 assert.equal(importedData.item.status,'draft');
 assert.equal(importedData.item.source_label,'Feed Principal Editado');
 assert.equal(importedData.newsId,importedData.item.id);
 assert.equal((await worker.fetch(request('/api/editor/rss-items/'+itemId+'/import','POST'),env)).status,409);
 assert.equal((await worker.fetch(request('/api/editor/rss-items/999999/import','POST'),env)).status,404);

 detail = await (await worker.fetch(request('/api/editor/rss-items/'+itemId),env)).json();
 assert.equal(detail.item.imported,true);
 assert.equal(detail.item.imported_news_id,importedData.newsId);

 list = await (await worker.fetch(request('/api/editor/rss-items?imported=true'),env)).json();
 assert.equal(list.total,1);

 // Depois de salvar no editor, o dashboard confirma o vínculo pelo /imported.
 let draft = await (await worker.fetch(request('/api/editor/news','POST',{...sample,title:'Rascunho vindo do radar RSS'}),env)).json();
 const otherItem = db.prepare('SELECT id FROM rss_items WHERE item_key=?').get('key-2').id;
 assert.equal((await worker.fetch(request('/api/editor/rss-items/'+otherItem+'/imported','POST',{news_id:'x'}),env)).status,422);
 assert.equal((await worker.fetch(request('/api/editor/rss-items/'+otherItem+'/imported','POST',{news_id:999999}),env)).status,404);
 const marked = await worker.fetch(request('/api/editor/rss-items/'+otherItem+'/imported','POST',{news_id:draft.item.id}),env);
 assert.equal(marked.status,200);
 detail = await (await worker.fetch(request('/api/editor/rss-items/'+otherItem),env)).json();
 assert.equal(detail.item.imported,true);
 assert.equal(detail.item.imported_news_id,draft.item.id);

 // Fontes desativadas não são consultadas e a atualização em massa não sai à rede.
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/'+feedA,'PUT',{is_active:false}),env)).status,200);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/'+feedB,'PUT',{is_active:false}),env)).status,200);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/'+feedB+'/refresh','POST'),env)).status,422);
 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/999999/refresh','POST'),env)).status,404);
 const refreshed = await worker.fetch(request('/api/rss/fetch','POST'),env);
 assert.equal(refreshed.status,200);
 const refreshedData = await refreshed.json();
 assert.equal(refreshedData.total,0);
 assert.equal(refreshedData.inserted,0);

 assert.equal((await worker.fetch(request('/api/editor/rss-feeds/'+feedB,'DELETE'),env)).status,200);
 feeds = await (await worker.fetch(request('/api/editor/rss-feeds'),env)).json();
 assert.equal(feeds.items.length,1);

 db.exec('DELETE FROM rss_items');
 db.exec('DELETE FROM rss_feeds');
 db.exec('DELETE FROM news');
});

test('RSS drafts keep the feed cover and can be published in bulk', async () => {
  const feed = { name: 'Feed Capa' };
  const rawItem = {
    title: 'Notícia com imagem do feed',
    summary: 'Resumo do item RSS para o rascunho editorial.',
    content: 'Conteúdo completo do item RSS para validar o rascunho editorial.',
  };

  // O parser entrega `image`; o banco entrega `image_url`. Ambos viram capa.
  assert.equal(rssDraftInput({ ...rawItem, image: 'https://cdn.example.com/capa.jpg' }, feed).cover, 'https://cdn.example.com/capa.jpg');
  assert.equal(rssDraftInput({ ...rawItem, image_url: 'https://cdn.example.com/capa-2.jpg' }, feed).cover, 'https://cdn.example.com/capa-2.jpg');

  const now = new Date().toISOString();
  const feedRow = db.prepare('INSERT INTO rss_feeds (name,feed_url,site_url,is_active,auto_import,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('Feed Capa','https://feeds.example.com/cover.xml','https://anime.example.com/',1,0,now,now);
  const feedId = Number(feedRow.lastInsertRowid);

  let response = await worker.fetch(request('/api/editor/news','POST',{...sample,title:'Rascunho com capa vinda do RSS',cover:''}),env);
  assert.equal(response.status,201);
  const coverDraft = (await response.json()).item;

  response = await worker.fetch(request('/api/editor/news','POST',{...sample,title:'Rascunho sem fonte para publicar',source_url:''}),env);
  assert.equal(response.status,201);
  const invalidDraft = (await response.json()).item;

  db.prepare('INSERT INTO rss_items (feed_id,item_key,guid,link,title,summary,content,image_url,author,published_at,created_at,imported_at,imported_news_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(feedId,'cover-key','cover-guid','https://anime.example.com/capa','Rascunho com capa vinda do RSS','Resumo do item RSS para o rascunho editorial.','Conteúdo completo do item RSS para validar o rascunho editorial.','https://cdn.example.com/rss-cover.jpg','Redação',now,now,now,coverDraft.id);

  assert.equal((await worker.fetch(request('/api/editor/news/bulk-publish','POST',{ids:[]}),env)).status,422);

  response = await worker.fetch(request('/api/editor/news/bulk-publish','POST',{ids:[coverDraft.id,invalidDraft.id,999999,coverDraft.id]}),env);
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.published.length,1);
  assert.equal(result.published[0].id,coverDraft.id);
  assert.equal(result.published[0].cover,'https://cdn.example.com/rss-cover.jpg');
  assert.equal(result.skipped.length,2);
  assert(result.skipped.some(item => item.id === invalidDraft.id && item.reason.includes('fonte')));
  assert(result.skipped.some(item => item.id === 999999));

  const publicList = await (await worker.fetch(request('/api/news'),env)).json();
  assert(publicList.items.some(item => item.id === coverDraft.id && item.cover === 'https://cdn.example.com/rss-cover.jpg'));
  assert(!publicList.items.some(item => item.id === invalidDraft.id));

  const again = await (await worker.fetch(request('/api/editor/news/bulk-publish','POST',{ids:[coverDraft.id]}),env)).json();
  assert.equal(again.published.length,0);
  assert.equal(again.skipped[0].reason,'Já está publicado.');

  db.exec('DELETE FROM rss_items');
  db.exec('DELETE FROM rss_feeds');
  db.exec('DELETE FROM news');
});

test('admin users page and users api list users and protect routes', async () => {
  // 1. API /api/admin/users
  const unauth = await worker.fetch(new Request('https://vision.test/api/admin/users'), env);
  assert.equal(unauth.status, 401);

  const nonAdmin = await worker.fetch(request('/api/admin/users', 'GET', null, { 'oai-authenticated-user-email': 'other@example.com' }), env);
  assert.equal(nonAdmin.status, 403);

  const adminRes = await worker.fetch(request('/api/admin/users'), env);
  assert.equal(adminRes.status, 200);
  const data = await adminRes.json();
  assert(Array.isArray(data.users));
  assert(data.stats);
  assert(data.users.some(u => u.role === 'admin' && u.email === env.ADMIN_EMAIL));

  // Concede acesso a um novo editor e confere retorno
  const addEditor = await worker.fetch(request('/api/admin/editors', 'POST', { email: 'novoeditor@example.com' }), env);
  assert.equal(addEditor.status, 200);

  const afterAdd = await (await worker.fetch(request('/api/admin/users'), env)).json();
  assert(afterAdd.users.some(u => u.email === 'novoeditor@example.com' && u.role === 'editor'));

  // Remove editor
  await worker.fetch(request('/api/admin/editors', 'DELETE', { email: 'novoeditor@example.com' }), env);

  // 2. Proteção da página /admin/usuarios
  const anonPage = await worker.fetch(new Request('https://vision.test/admin/usuarios'), env);
  assert.equal(anonPage.status, 302);

  const nonAdminPage = await worker.fetch(request('/admin/usuarios', 'GET', null, { 'oai-authenticated-user-email': 'other@example.com' }), env);
  assert.equal(nonAdminPage.status, 403);

  const adminPage = await worker.fetch(request('/admin/usuarios'), env);
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert(adminHtml.includes('Gestão de Usuários'));
  assert(adminHtml.includes('newEditorEmail'));

  // 3. Rota de notícias (página pública de leitura)
  const newsPage = await worker.fetch(new Request('https://vision.test/noticia'), env);
  assert.equal(newsPage.status, 200);
  const newsHtml = await newsPage.text();
  assert(newsHtml.includes('articleMainTitle'));
  assert(newsHtml.includes('noticia.js'));

  const newsPlural = await worker.fetch(new Request('https://vision.test/noticias'), env);
  assert.equal(newsPlural.status, 200);
});

test('font catalog proxy serves the git-sourced catalog with at least 500 families', async () => {
  const originalFetch = globalThis.fetch;
  const items = Array.from({ length: 600 }, (_, index) => ({
    family: `Font ${index + 1}`,
    category: 'sans-serif',
    variants: ['400', '700'],
    subsets: ['latin'],
  }));

  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\//);
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = await worker.fetch(request('/api/fonts/catalog'), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.count, 600);
    assert.equal(data.items.length, 600);
    assert([
      'https://fonts.grida.co/webfonts.json',
      'https://raw.githubusercontent.com/gridaco/fonts/master/webfonts.json',
    ].includes(data.source));
    assert.equal(data.items[0].family, 'Font 1');
    assert.deepEqual(data.items[0].variants, ['400', '700']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RSS style hints persist in style_json and import as a rich draft', async () => {
  const now = new Date().toISOString();
  const feedUrl = 'https://feeds.example.com/style.xml';
  const feedId = Number(db.prepare(
    'INSERT INTO rss_feeds (name,feed_url,site_url,is_active,auto_import,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run('Feed Estilizado', feedUrl, 'https://styled.example.com/', 1, 0, now, now).lastInsertRowid);

  const style = {
    fonts: ['Zen Maru Gothic'],
    colors: ['#123456'],
    backgrounds: ['#fff0dd'],
  };
  const content = 'Conteúdo completo da notícia com tipografia detectada no feed para gerar o rascunho.';
  const itemId = Number(db.prepare(
    'INSERT INTO rss_items (feed_id,item_key,guid,link,title,summary,content,image_url,author,published_at,style_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    feedId, 'style-key', 'style-guid', 'https://styled.example.com/noticia',
    'Notícia com estilo do feed', 'Resumo da notícia com estilo do feed.', content,
    '', 'Redação', now, JSON.stringify(style), now,
  ).lastInsertRowid);

  const detail = await (await worker.fetch(request('/api/editor/rss-items/' + itemId), env)).json();
  assert.deepEqual(detail.item.style, style);
  assert(!('style_json' in detail.item));

  const imported = await worker.fetch(request('/api/editor/rss-items/' + itemId + '/import', 'POST'), env);
  assert.equal(imported.status, 201);
  const { item } = await imported.json();
  assert.equal(item.body_format, 'rich-v1');

  const doc = JSON.parse(item.body);
  assert.equal(doc.blocks[0].children[0].font, 'Zen Maru Gothic');
  assert.equal(doc.blocks[0].children[0].color, '#123456');
  assert.equal(doc.blocks[0].children[0].bg, '#fff0dd');

  const html = globalThis.VisionContent.render(doc);
  assert(html.includes('font-family:&quot;Zen Maru Gothic&quot;'));
  assert(html.includes('background-color:#fff0dd'));

  const stored = db.prepare('SELECT style_json FROM rss_items WHERE id=?').get(itemId);
  assert.deepEqual(JSON.parse(stored.style_json), style);

  db.exec('DELETE FROM rss_items');
  db.exec('DELETE FROM rss_feeds');
  db.exec('DELETE FROM news');
});
