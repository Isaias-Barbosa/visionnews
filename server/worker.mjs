const categories=['Notícias','Reviews','Guias','Cultura'];
const statuses=['draft','published','archived'];
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function canAdmin(request,env){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');return Boolean(env.ADMIN_EMAIL&&id&&email&&email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase())}
export function validateNews(input){const errors=[];const str=(key,min,max)=>{const value=typeof input[key]==='string'?input[key].trim():'';if(value.length<min||value.length>max)errors.push(`${key}: use entre ${min} e ${max} caracteres.`);return value};const title=str('title',5,160),summary=str('summary',15,350),body=str('body',40,50000),author=str('author',2,80);const category=categories.includes(input.category)?input.category:null,status=statuses.includes(input.status)?input.status:null;if(!category)errors.push('Categoria inválida.');if(!status)errors.push('Status inválido.');function url(key){const value=typeof input[key]==='string'?input[key].trim():'';if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2000)throw Error();return u.href}catch{errors.push(`${key}: informe um endereço HTTPS válido.`);return ''}}const cover=url('cover'),source_url=url('source_url'),source_label=typeof input.source_label==='string'?input.source_label.trim().slice(0,120):'';if(status==='published'&&category==='Notícias'&&!source_url)errors.push('Notícias publicadas precisam de uma fonte oficial.');return {errors,value:{title,summary,body,author,category,status,cover,source_url,source_label}}}
async function bodyJson(request){const length=Number(request.headers.get('Content-Length')||0);if(length>80000)throw new Error('too-large');const raw=await request.text();if(raw.length>80000)throw new Error('too-large');const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('invalid');return value}
function securityHeaders(response){response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");return response}
export async function handle(request,env){const url=new URL(request.url),path=url.pathname;try{
if(path==='/api/health')return json({ok:true});
if(path==='/admin'||path==='/admin/'||path==='/admin/index.html'){
if(!request.headers.get('oai-authenticated-user-id'))return Response.redirect(url.origin+'/signin-with-chatgpt?return_to=%2Fadmin',302);
if(!canAdmin(request,env))return json({error:'Acesso restrito à administração.'},403);
return serve('/admin/index.html');}
if(path==='/api/news'&&request.method==='GET'){
if(!env.DB)return json({error:'Redação temporariamente indisponível.'},503);
const {results}=await env.DB.prepare("SELECT id,title,summary,body,category,author,cover,source_url,source_label,published_at,updated_at FROM news WHERE status = 'published' ORDER BY published_at DESC,id DESC LIMIT 200").all();return json({items:results});}
if(path.startsWith('/api/admin/')){
if(!canAdmin(request,env))return json({error:'Acesso restrito à administração.'},request.headers.get('oai-authenticated-user-id')?403:401);
if(path==='/api/admin/session'&&request.method==='GET')return json({authorized:true});
if(!env.DB)return json({error:'Banco de dados indisponível.'},503);
if(request.method!=='GET'&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'Origem da solicitação não permitida.'},403);
if(path==='/api/admin/news'&&request.method==='GET'){const {results}=await env.DB.prepare('SELECT * FROM news ORDER BY updated_at DESC,id DESC LIMIT 1000').all();return json({items:results})}
const match=path.match(/^\/api\/admin\/news\/(\d+)$/);
if((path==='/api/admin/news'&&request.method==='POST')||(match&&request.method==='PUT')){
let input;try{input=await bodyJson(request)}catch{return json({error:'Conteúdo inválido ou grande demais.'},400)}const {errors,value:a}=validateNews(input);if(errors.length)return json({error:errors.join(' ')},422);const now=new Date().toISOString();
if(request.method==='POST'){const result=await env.DB.prepare('INSERT INTO news (title,summary,body,category,author,cover,source_url,source_label,status,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(a.title,a.summary,a.body,a.category,a.author,a.cover,a.source_url,a.source_label,a.status,now,now,a.status==='published'?now:null).run();const item=await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(result.meta.last_row_id).first();return json({item},201)}
const id=Number(match[1]);if(!Number.isSafeInteger(id)||!Number.isInteger(input.version)||input.version<1)return json({error:'Versão inválida. Recarregue a matéria.'},422);
const existing=await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first();if(!existing)return json({error:'Matéria não encontrada.'},404);if(existing.version!==input.version)return json({error:'Esta matéria foi alterada em outra sessão. Recarregue antes de salvar.'},409);
const published=a.status==='published'?(existing.published_at||now):existing.published_at;
const result=await env.DB.prepare('UPDATE news SET title=?,summary=?,body=?,category=?,author=?,cover=?,source_url=?,source_label=?,status=?,updated_at=?,published_at=?,version=version+1 WHERE id=? AND version=?').bind(a.title,a.summary,a.body,a.category,a.author,a.cover,a.source_url,a.source_label,a.status,now,published,id,input.version).run();if(!result.meta.changes)return json({error:'Conflito de edição. Recarregue a matéria.'},409);return json({item:await env.DB.prepare('SELECT * FROM news WHERE id=?').bind(id).first()});}
return json({error:'Rota não encontrada.'},404);}
if(path.startsWith('/api/'))return json({error:'Rota não encontrada.'},404);
if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Método não permitido',{status:405});
return serve(path==='/'?'/index.html':path,request.method==='HEAD');
}catch(error){console.error('VisionNews request failed',error?.name);return json({error:'Não foi possível concluir. Tente novamente.'},500)}}
function serve(path,head=false){const asset=assets[path];if(!asset)return new Response('Página não encontrada',{status:404});return securityHeaders(new Response(head?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':path.includes('/admin/')?'no-store':'no-cache'}}))}
export default {fetch:handle};
