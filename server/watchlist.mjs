const statuses = ['planned','watching','completed','paused','dropped'];
const reply = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});

export async function watchlist(request, pool, user) {
 if (!user) return reply({error:'Entre na sua conta para acessar Meus Animes.'},401);
 const owner=user.id;
 if (request.method==='GET') {
  const {rows} = await pool.query(
   'SELECT id,title,status FROM anime_watchlist WHERE user_id=$1 ORDER BY updated_at DESC,id DESC',[owner]
  );
  return reply({items:rows});
 }
 if (!['PUT','DELETE'].includes(request.method)) return reply({error:'Método não permitido.'},405);
 if (request.headers.get('origin')!==new URL(request.url).origin ||
     !request.headers.get('content-type')?.startsWith('application/json')) {
  return reply({error:'Origem da solicitação não permitida.'},403);
 }
 let input;
 try {
  const raw = await request.text();
  if (raw.length>4000) throw Error();
  input = JSON.parse(raw);
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Error();
 } catch {
  return reply({error:'Dados inválidos.'},400);
 }
 if (request.method==='DELETE') {
  if (!Number.isInteger(input.id) || input.id<1 || input.id>2147483647) return reply({error:'Item inválido.'},422);
  const result=await pool.query('DELETE FROM anime_watchlist WHERE id=$1 AND user_id=$2',[input.id,owner]);
  return result.rowCount ? reply({ok:true}) : reply({error:'Anime não encontrado.'},404);
 }
 if (!statuses.includes(input.status)) return reply({error:'Status inválido.'},422);
 if (input.id!==undefined) {
  if (!Number.isInteger(input.id) || input.id<1 || input.id>2147483647) return reply({error:'Item inválido.'},422);
  const {rows}=await pool.query(
   'UPDATE anime_watchlist SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id,title,status',
   [input.status,input.id,owner]
  );
  return rows.length ? reply({item:rows[0]}) : reply({error:'Anime não encontrado.'},404);
 }
 const title = typeof input.title==='string' ? input.title.normalize('NFKC').trim().replace(/\s+/g,' ') : '';
 if (title.length<1 || title.length>160 || title.includes('\0')) return reply({error:'Informe um título de até 160 caracteres.'},422);
 const {rows}=await pool.query(
  'INSERT INTO anime_watchlist (user_id,title,title_key,status) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,title_key) DO NOTHING RETURNING id,title,status',
  [owner,title,title.toLocaleLowerCase('pt-BR'),input.status]
 );
 return rows.length ? reply({item:rows[0]},201) : reply({error:'Esse anime já está na sua lista.'},409);
}
