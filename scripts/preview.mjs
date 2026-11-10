import http from 'node:http';import {mkdirSync,readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import worker from '../dist/server/index.js';
mkdirSync('.data',{recursive:true});const db=new DatabaseSync('.data/preview.sqlite');
// Local preview only; hosted schema changes are applied by the migration runner.
const exists=db.prepare("SELECT name FROM sqlite_master WHERE name='news'").get();if(!exists)db.exec(readFileSync('drizzle/0000_news.sql','utf8').replace(/^\uFEFF/,''));
if(!db.prepare('PRAGMA table_info(news)').all().some(c=>c.name==='body_format'))db.exec(readFileSync('drizzle/0001_editor_reviews_schedule.sql','utf8').replace(/^\uFEFF/,''));
if(!db.prepare('PRAGMA table_info(news)').all().some(c=>c.name==='topic'))db.exec(readFileSync('drizzle/0002_editorial_dashboard.sql','utf8'));
if(!db.prepare('PRAGMA table_info(news)').all().some(c=>c.name==='featured_at'))db.exec(readFileSync('drizzle/0003_news_feature.sql','utf8'));
const mock=process.argv.includes('--admin');
const env={
 ADMIN_EMAIL:mock?'local-editor@example.invalid':'',
 DB:{prepare(sql){
  let values=[];
  return {
   bind(...v){values=v;return this},
   async all(){return {results:db.prepare(sql).all(...values)}},
   async first(){return db.prepare(sql).get(...values)||null},
   async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}
  };
 }}
};
http.createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>900000){res.writeHead(413).end();return}chunks.push(chunk)}const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');if(mock){headers.set('oai-authenticated-user-id','local-preview-only');headers.set('oai-authenticated-user-email',env.ADMIN_EMAIL)}const method=req.method||'GET';const request=new Request('http://127.0.0.1:4173'+req.url,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(500).end('Preview failed')}}).listen(4173,'127.0.0.1',()=>{console.log('Local: http://127.0.0.1:4173');if(mock)console.log('Local-only admin simulation enabled. No hosted identity is used.')});
