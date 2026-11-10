import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import worker,{canAdmin,validateNews,validateSchedule} from '../dist/server/index.js';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync('drizzle/0000_news.sql','utf8').replace(/^\uFEFF/,''));
db.exec(readFileSync('drizzle/0001_editor_reviews_schedule.sql','utf8').replace(/^\uFEFF/,''));
db.exec(readFileSync('drizzle/0002_editorial_dashboard.sql','utf8'));
db.exec(readFileSync('drizzle/0003_news_feature.sql','utf8'));
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
