import { readFileSync } from 'node:fs';
import '../public/content.js';
import worker from '../server/worker.mjs';
import { createPool, postgresDatabase } from '../server/postgres.mjs';
import { createAuth } from '../server/accounts.mjs';
import { watchlist } from '../server/watchlist.mjs';

const unavailable = () => Response.json({error:'Contas temporariamente indisponíveis.'},{status:503,headers:{'Cache-Control':'no-store'}});
const origin = process.env.BETTER_AUTH_URL ||
 (process.env.VERCEL_ENV==='preview' && process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL :
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL : '');
const editorialAssets = {
 '/admin/index.html': {body:readFileSync(new URL('../public/admin/index.html',import.meta.url),'utf8'),type:'text/html; charset=utf-8'},
 '/dashboard/index.html': {body:readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8'),type:'text/html; charset=utf-8'}
};
let runtime;

function services() {
 if (!runtime && process.env.DATABASE_URL) {
  const pool = createPool();
  const auth = origin && process.env.BETTER_AUTH_SECRET ? createAuth(pool,origin,process.env.BETTER_AUTH_SECRET) : null;
  runtime = {pool,DB:postgresDatabase(pool),auth};
 }
 return runtime;
}

export async function dispatch(request) {
 const url=new URL(request.url);
 const service=services();
 if (url.pathname==='/api/readiness') {
  if (!service?.auth) return unavailable();
  await service.pool.query('SELECT 1 FROM anime_watchlist LIMIT 1');
  return Response.json({ok:true,database:'postgresql'},{headers:{'Cache-Control':'no-store'}});
 }
 if (url.pathname.startsWith('/api/auth/')) {
  return service?.auth ? service.auth.handler(request) : unavailable();
 }
 const listRoute=url.pathname==='/api/watchlist';
 const editorialRoute=/^\/(admin|dashboard)(?:\/|$)/.test(url.pathname) || /^\/api\/(admin|editor)\//.test(url.pathname);
 const session=(listRoute||editorialRoute) && service?.auth ? await service.auth.api.getSession({headers:request.headers}) : null;
 if (listRoute) return service?.auth ? watchlist(request,service.pool,session?.user) : unavailable();

 // The Sites implementation trusts its own gateway. On Vercel the only
 // identity accepted by that handler comes from a verified Better Auth session.
 const headers = new Headers(request.headers);
 headers.delete('oai-authenticated-user-id');
 headers.delete('oai-authenticated-user-email');
 if (session?.user.emailVerified) {
  headers.set('oai-authenticated-user-id',session.user.id);
  headers.set('oai-authenticated-user-email',session.user.email);
 }
 const protectedPage = url.pathname.match(/^\/(admin|dashboard)(?:\/index\.html|\/)?$/);
 if (session?.user && !session.user.emailVerified && protectedPage && ['GET','HEAD'].includes(request.method)) {
  const login = new URL('/login',url.origin);
  login.search = new URLSearchParams({next:'/'+protectedPage[1],reason:'verification'});
  return Response.redirect(login,302);
 }
 const forwarded = new Request(request,{headers});
 return worker.fetch(forwarded,{
  DB:service?.DB, ADMIN_EMAIL:process.env.ADMIN_EMAIL,
  SIGN_IN_PATH:'/login', ASSETS:editorialAssets
 });
}

export default async function handler(req,res) {
 try {
  const headers = new Headers(req.headers);
  const base = origin || 'https://' + headers.get('host');
  // Vercel rewrites these routes without changing the requested pathname.
  const url = new URL(req.url,base);
  const method = req.method || 'GET';
  const hasBody = !['GET','HEAD'].includes(method);
  const body = hasBody && req.body!==undefined ?
   (typeof req.body==='string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)) : undefined;
  const response = await dispatch(new Request(url,{method,headers,body}));
  res.statusCode=response.status;
  for (const [name,value] of response.headers) if (name!=='set-cookie') res.setHeader(name,value);
  const cookies=response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie',cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
 } catch (error) {
  console.error('VisionNews request failed',error?.name);
  res.statusCode=503;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({error:'Serviço temporariamente indisponível.'}));
 }
}
