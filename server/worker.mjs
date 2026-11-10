const categories=['Notícias','Reviews','Guias','Cultura'];
const statuses=['draft','published','archived'];
const platforms=['Crunchyroll','Disney+','Netflix','HBO Max','TV aberta'];
const newsColumns=['title','summary','body','category','author','cover','source_url','source_label','status','body_format','review_score','review_verdict','anime_title','topic','tags'];
const scheduleColumns=['title','summary','weekday','time','platform','official_url','language','season_year','season_quarter','cover','episode','status'];
const recommendationColumns=['feature_date','title','summary','cover','streams','status'];
const editorialTables = {
 news: { columns: newsColumns, validate: validateNews },
 schedule: { columns: scheduleColumns, validate: validateSchedule },
 recommendations: { columns: recommendationColumns, validate: validateRecommendation }
};
const todayInBrasilia = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date());

async function canEdit(request, env) {
 if (canAdmin(request, env)) return true;
 const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
 if (!env.DB || !request.headers.get('oai-authenticated-user-id') || !email) return false;
 return Boolean(await env.DB.prepare('SELECT email FROM editorial_accounts WHERE email=?').bind(email).first());
}

export function validateRecommendation(input) {
 const errors = [];
 const feature_date = text(input, 'feature_date', 10, 10, errors);
 const date = new Date(feature_date + 'T00:00:00Z');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(feature_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== feature_date)
  errors.push('Informe uma data válida.');
 const title = text(input, 'title', 2, 160, errors);
 const summary = text(input, 'summary', 15, 600, errors);
 const cover = validUrl(input, 'cover', errors);
 const status = statuses.includes(input.status) ? input.status : null;
 if (!status) errors.push('Status inválido.');
 const streams = [];
 if (!Array.isArray(input.streams) || input.streams.length > 5) {
  errors.push('Informe até cinco plataformas.');
 } else {
  for (const stream of input.streams) {
   if (!stream || typeof stream !== 'object' || Array.isArray(stream)) {
    errors.push('Plataforma inválida.');
    continue;
   }
   const name = text(stream, 'name', 2, 60, errors);
   const url = validUrl(stream, 'url', errors);
   if (!url) errors.push('Informe o link oficial de cada plataforma.');
   streams.push({name,url});
  }
 }
 if (status === 'published' && !streams.length) errors.push('Cadastre pelo menos um streaming oficial para publicar.');
 return {errors,value:{feature_date,title,summary,cover,streams:JSON.stringify(streams),status}};
}

function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function canAdmin(request,env){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');return Boolean(env.ADMIN_EMAIL&&id&&email&&email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase())}
function text(input,key,min,max,errors){const value=typeof input[key]==='string'?input[key].trim():'';if(value.length<min||value.length>max)errors.push(`${key}: use entre ${min} e ${max} caracteres.`);return value}
function validUrl(input,key,errors){const value=typeof input[key]==='string'?input[key].trim():'';if(!value)return '';const result=VisionContent.https(value);if(!result)errors.push(`${key}: informe um endereço HTTPS válido.`);return result}
export function validateNews(input){const errors=[];const title=text(input,'title',5,160,errors),summary=text(input,'summary',15,350,errors),author=text(input,'author',2,80,errors);const category=categories.includes(input.category)?input.category:null,status=statuses.includes(input.status)?input.status:null;if(!category)errors.push('Categoria inválida.');if(!status)errors.push('Status inválido.');const body_format=input.body_format||'plain';let body=typeof input.body==='string'?input.body:'';if(body_format==='rich-v1'){try{if(body.length>220000)throw Error('Conteúdo grande demais.');const doc=VisionContent.validate(JSON.parse(body));const length=VisionContent.plain(doc).trim().length;if(length<40)errors.push('O conteúdo precisa de ao menos 40 caracteres.');body=JSON.stringify(doc)}catch(e){errors.push(e.message)}}else if(body_format==='plain'){body=body.trim();if(body.length<40||body.length>50000)errors.push('O conteúdo deve ter entre 40 e 50.000 caracteres.')}else errors.push('Formato de conteúdo inválido.');const cover=validUrl(input,'cover',errors),source_url=validUrl(input,'source_url',errors),source_label=text(input,'source_label',0,120,errors),anime_title=text(input,'anime_title',0,160,errors),review_verdict=text(input,'review_verdict',0,400,errors);const topic=text(input,'topic',0,60,errors);
const tags=[...new Set(text(input,'tags',0,400,errors).split(',').map(tag=>tag.trim().toLocaleLowerCase('pt-BR')).filter(Boolean))];
if(tags.length>10||tags.some(tag=>tag.length>36))errors.push('Use até 10 tags de até 36 caracteres cada.');
let review_score=null;if(input.review_score!==''&&input.review_score!==null&&input.review_score!==undefined){if(typeof input.review_score!=='number'||!Number.isFinite(input.review_score)||input.review_score<0||input.review_score>10)errors.push('A nota deve ser um número de 0 a 10.');else review_score=Math.round(input.review_score*10)/10}if(status==='published'&&category==='Notícias'&&!source_url)errors.push('Notícias publicadas precisam de uma fonte oficial.');if(category==='Reviews'&&status==='published'&&!anime_title)errors.push('Informe o anime avaliado na review.');return {errors,value:{title,summary,body,author,category,status,cover,source_url,source_label,body_format,review_score,review_verdict,anime_title,topic,tags:tags.join(', ')}}}
export function validateSchedule(input){const errors=[];const title=text(input,'title',2,160,errors),summary=text(input,'summary',0,500,errors),episode=text(input,'episode',0,60,errors),time=text(input,'time',0,5,errors);if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))errors.push('Horário inválido. Use HH:mm de Brasília.');const weekday=input.weekday,season_year=input.season_year,season_quarter=input.season_quarter;if(!Number.isInteger(weekday)||weekday<0||weekday>6)errors.push('Dia da semana inválido.');if(!Number.isInteger(season_year)||season_year<2020||season_year>2100)errors.push('Ano inválido.');if(!Number.isInteger(season_quarter)||season_quarter<1||season_quarter>4)errors.push('Temporada inválida.');const platform=platforms.includes(input.platform)?input.platform:null,language=['Legendado','Dublado','TV aberta'].includes(input.language)?input.language:null,status=statuses.includes(input.status)?input.status:null;if(!platform)errors.push('Plataforma inválida.');if(!language)errors.push('Idioma/formato inválido.');if(!status)errors.push('Status inválido.');const official_url=validUrl(input,'official_url',errors),cover=validUrl(input,'cover',errors);if(status==='published'&&!official_url)errors.push('Informe o link oficial antes de publicar a exibição.');return {errors,value:{title,summary,weekday,time,platform,official_url,language,season_year,season_quarter,cover,episode,status}}}
async function bodyJson(request){if(Number(request.headers.get('Content-Length')||0)>300000)throw Error();const raw=await request.text();if(raw.length>300000)throw Error();const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value}
function securityHeaders(response){response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");return response}
export async function handle(request,env){const url=new URL(request.url),path=url.pathname;try{
if(path==='/api/health')return json({ok:true});
const privatePage = path.match(/^\/(admin|dashboard)(?:\/index\.html|\/)?$/)?.[1];
if (privatePage && ['GET','HEAD'].includes(request.method)) {
 const target = '/'+privatePage;
 if (!request.headers.get('oai-authenticated-user-id'))
  return Response.redirect(url.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(target),302);
 if (!(privatePage==='admin' ? canAdmin(request,env) : await canEdit(request,env)))
  return json({error:'Acesso restrito a esta área.'},403);
 return serve(target+'/index.html',request.method==='HEAD');
}
if (path==='/api/recommendation' && request.method==='GET') {
 if (!env.DB) return json({error:'Recomendação temporariamente indisponível.'},503);
 const date = todayInBrasilia();
 const item = await env.DB.prepare("SELECT feature_date,title,summary,cover,streams FROM recommendations WHERE status='published' AND feature_date=?").bind(date).first();
 return json({date,item:item ? {...item,streams:JSON.parse(item.streams)} : null});
}
if(path==='/api/news'&&request.method==='GET'){if(!env.DB)return json({error:'Redação temporariamente indisponível.'},503);const {results}=await env.DB.prepare("SELECT id,title,summary,body,body_format,category,author,cover,source_url,source_label,review_score,review_verdict,anime_title,topic,tags,published_at,updated_at FROM news WHERE status = 'published' ORDER BY published_at DESC,id DESC LIMIT 200").all();return json({items:results})}
if(path==='/api/schedule'&&request.method==='GET'){if(!env.DB)return json({error:'Calendário temporariamente indisponível.'},503);const now=new Date(),year=Number(url.searchParams.get('year')||new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'America/Sao_Paulo'}).format(now)),quarter=Number(url.searchParams.get('quarter')||Math.ceil(Number(new Intl.DateTimeFormat('en-US',{month:'numeric',timeZone:'America/Sao_Paulo'}).format(now))/3));if(!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(quarter)||quarter<1||quarter>4)return json({error:'Temporada inválida.'},422);const {results}=await env.DB.prepare("SELECT id,title,summary,weekday,time,platform,official_url,language,season_year,season_quarter,cover,episode,updated_at FROM schedule WHERE status='published' AND season_year=? AND season_quarter=? ORDER BY weekday,time,id LIMIT 500").bind(year,quarter).all();return json({items:results,year,quarter})}
if(path.startsWith('/api/admin/') || path.startsWith('/api/editor/')){const adminRoute=path.startsWith('/api/admin/');if(!(adminRoute ? canAdmin(request,env) : await canEdit(request,env)))return json({error:'Acesso restrito à administração.'},request.headers.get('oai-authenticated-user-id')?403:401);if(path==='/api/admin/session'&&request.method==='GET')return json({authorized:true});if(!env.DB)return json({error:'Banco de dados indisponível.'},503);if(request.method!=='GET'&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'Origem da solicitação não permitida.'},403);
if(path==='/api/admin/overview' && request.method==='GET') {
 const counts = await Promise.all(Object.keys(editorialTables).map(async table => {
  const {results} = await env.DB.prepare(`SELECT status,COUNT(*) AS total FROM ${table} GROUP BY status`).all();
  return [table,Object.fromEntries(results.map(row=>[row.status,row.total]))];
 }));
 const {results:editors} = await env.DB.prepare('SELECT email FROM editorial_accounts ORDER BY email').all();
 return json({counts:Object.fromEntries(counts),editors:editors.map(account=>account.email),database:'online',timezone:'America/Sao_Paulo'});
}
if(path==='/api/admin/editors' && ['POST','DELETE'].includes(request.method)) {
 let input;
 try { input=await bodyJson(request); } catch { return json({error:'Conteúdo inválido.'},400); }
 const email=typeof input.email==='string' ? input.email.trim().toLowerCase() : '';
 if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Informe um e-mail válido.'},422);
 if (email===env.ADMIN_EMAIL.toLowerCase()) return json({error:'A conta administradora é gerenciada na hospedagem.'},422);
 if (request.method==='POST') {
  await env.DB.prepare('INSERT INTO editorial_accounts (email,created_at) VALUES (?,?) ON CONFLICT(email) DO NOTHING').bind(email,new Date().toISOString()).run();
 } else {
  await env.DB.prepare('DELETE FROM editorial_accounts WHERE email=?').bind(email).run();
 }
 return json({ok:true});
}
const match=path.match(/^\/api\/(?:admin|editor)\/(news|schedule|recommendations)(?:\/([1-9]\d*))?$/);
if(!match)return json({error:'Rota não encontrada.'},404);
const table=match[1],id=match[2]?Number(match[2]):null,{columns,validate}=editorialTables[table];
if(request.method==='GET'&&!id){const {results}=await env.DB.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC,id DESC LIMIT 1000`).all();return json({items:results})}
if((request.method==='POST'&&!id)||(request.method==='PUT'&&id)){let input;try{input=await bodyJson(request)}catch{return json({error:'Conteúdo inválido ou grande demais.'},400)}const {errors,value:a}=validate(input);if(errors.length)return json({error:errors.join(' ')},422);const now=new Date().toISOString();let existing=null;if(id){if(!Number.isSafeInteger(id)||!Number.isInteger(input.version)||input.version<1)return json({error:'Versão inválida. Recarregue o item.'},422);existing=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!existing)return json({error:'Item não encontrado.'},404);if(existing.version!==input.version)return json({error:'Este item foi alterado em outra sessão. Recarregue antes de salvar.'},409)}
try {
const values=columns.map(c=>a[c]);if(table==='news'){values.push(a.status==='published'?(existing?.published_at||now):existing?.published_at||null)}const writeColumns=table==='news'?[...columns,'published_at']:columns;
if(!id){const cols=[...writeColumns,'created_at','updated_at'];const result=await env.DB.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).bind(...values,now,now).run();return json({item:await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(result.meta.last_row_id).first()},201)}
const result=await env.DB.prepare(`UPDATE ${table} SET ${writeColumns.map(c=>c+'=?').join(',')},updated_at=?,version=version+1 WHERE id=? AND version=?`).bind(...values,now,id,input.version).run();if(!result.meta.changes)return json({error:'Conflito de edição. Recarregue o item.'},409);return json({item:await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first()})
} catch (error) {
 if (table==='recommendations' && String(error).includes('recommendations.feature_date'))
  return json({error:'Já existe uma recomendação para esta data. Edite o item existente.'},409);
 throw error;
}}
return json({error:'Rota não encontrada.'},404)}
if(path.startsWith('/api/'))return json({error:'Rota não encontrada.'},404);if(!['GET','HEAD'].includes(request.method))return new Response('Método não permitido',{status:405});return serve(path==='/'?'/index.html':path,request.method==='HEAD');
}catch(error){console.error('VisionNews request failed',error?.name);return json({error:'Não foi possível concluir. Tente novamente.'},500)}}
function serve(path,head=false){const asset=assets[path];if(!asset)return new Response('Página não encontrada',{status:404});return securityHeaders(new Response(head?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':(path.includes('/admin/')||path.includes('/dashboard/'))?'no-store':'no-cache'}}))}
export default {fetch:handle};
