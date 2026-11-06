import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import worker,{canAdmin,validateNews} from '../dist/server/index.js';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync('drizzle/0000_news.sql','utf8').replace(/^\uFEFF/,''));
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
test('authorization fails closed and does not expose drafts',async()=>{assert.equal(canAdmin(new Request('https://vision.test'),env),false);assert.equal(canAdmin(request('/'),{}),false);assert.equal((await worker.fetch(new Request('https://vision.test/api/admin/news'),env)).status,401);assert.equal((await worker.fetch(request('/api/admin/news','GET',null,{'oai-authenticated-user-email':'other@example.com'}),env)).status,403);assert.equal((await worker.fetch(request('/api/admin/news','POST',sample,{Origin:'https://other.test'}),env)).status,403);assert.equal((await worker.fetch(request('/admin'),env)).status,200)});
test('validation rejects unsafe links and unsourced published news',()=>{assert(validateNews({...sample,cover:'javascript:alert(1)'}).errors.length);assert(validateNews({...sample,status:'published',source_url:''}).errors.length);assert.equal(validateNews(sample).errors.length,0)});
test('create, publish, conflict, unpublish and archive with real SQLite schema',async()=>{let r=await worker.fetch(request('/api/admin/news','POST',sample),env);assert.equal(r.status,201);let {item}=await r.json();assert.equal(item.version,1);const list=async()=>{const r=await worker.fetch(request('/api/news'),env);return (await r.json()).items};assert.equal((await list()).length,0);r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'published',version:1}),env);assert.equal(r.status,200);item=(await r.json()).item;assert.equal(item.version,2);assert(item.published_at);assert.equal((await list()).length,1);assert(!('version' in (await list())[0]));r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'published',version:1}),env);assert.equal(r.status,409);r=await worker.fetch(request('/api/admin/news/'+item.id,'PUT',{...sample,status:'archived',version:2}),env);assert.equal(r.status,200);assert.equal((await list()).length,0);const admin=await worker.fetch(request('/api/admin/news'),env);assert.equal((await admin.json()).items[0].status,'archived')});
test('published records remain untrusted text and pages retain security headers',async()=>{const result=await worker.fetch(request('/api/admin/news','POST',{...sample,title:'<img src=x onerror=alert(1)>',status:'published'}),env);assert.equal(result.status,201);const page=await worker.fetch(request('/'),env);assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("object-src 'none'"));const r=await worker.fetch(request('/api/admin/news','POST',sample,{'Content-Type':'text/plain'}),env);assert.equal(r.status,403)});
