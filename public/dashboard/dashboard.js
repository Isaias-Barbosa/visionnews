const $=id=>document.getElementById(id),fields=['title','summary','category','author','cover','source_url','source_label','status','anime_title','review_verdict','topic','tags'],calendarFields=['title','summary','weekday','time','platform','official_url','language','season_year','season_quarter','cover','episode','status'];let news=[],schedule=[],recommendations=[],current=null,dirty=false,busy=false,ready=false,module='news';const names={draft:'Rascunho',published:'Publicado',archived:'Arquivado'},dayNames=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];const esc=VisionContent.escape;
const recommendationFields = ['feature_date','title','summary','cover','status'];
const streamFields = Array.from({length:5}, (_, i) => i);
$('streamFields').innerHTML = streamFields.map(i => `<div class="formColumns"><label>Plataforma ${i+1}<input id="streamName${i}" maxlength="60" placeholder="Ex.: Crunchyroll"></label><label>Link oficial ${i+1}<input id="streamUrl${i}" type="url" maxlength="2000" placeholder="https://…"></label></div>`).join('');
const moduleItems = () => ({
 news: news.filter(item=>item.category!=='Reviews'),
 reviews: news.filter(item=>item.category==='Reviews'),
 schedule,
 recommendations
})[module];
const todayInBrasilia = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await r.json()}catch{throw Error('O servidor não respondeu como esperado. Tente novamente.')}if(!r.ok)throw Error(data.error||'Não foi possível concluir a operação.');return data}
function allowLeave(){return !dirty||confirm('Há alterações não salvas. Deseja descartá-las?')}
const featuredDecision=()=>news.filter(item=>item.featured_at).sort((a,b)=>b.featured_at.localeCompare(a.featured_at)||b.id-a.id)[0];
function reviewVisibility(){$('featuredFields').hidden=$('category').value!=='Notícias';$('reviewFields').hidden=$('category').value!=='Reviews';$('category').disabled=module==='reviews';$('category').querySelector('option[value=Reviews]').disabled=module!=='reviews'}
function buttonLabel(){$('saveButton').textContent=$('status').value==='published'?'Salvar e publicar':$('status').value==='archived'?'Salvar como arquivado':'Salvar rascunho'}
let coverTimer;function coverPreview(){clearTimeout(coverTimer);coverTimer=setTimeout(()=>{const raw=$('cover').value.trim(),url=VisionContent.https(raw);$('coverPreview').hidden=!raw;if(!raw){$('coverImage').removeAttribute('src');return}if(!url){$('coverImage').hidden=true;$('coverStatus').textContent='Use um endereço HTTPS de imagem.';return}$('coverImage').hidden=false;$('coverStatus').textContent='Carregando a capa…';$('coverImage').onload=()=>{$('coverStatus').textContent='Capa carregada. Ela aparecerá no card e na leitura.'};$('coverImage').onerror=()=>{$('coverImage').hidden=true;$('coverStatus').textContent='Não foi possível carregar esta imagem. Confira o endereço ou use outra fonte autorizada.'};$('coverImage').src=url},250)}
function edit(item){if(!ready||busy||!allowLeave())return;current=item?{...item}:null;$('editorEmpty').hidden=true;const calendar=module==='schedule', recommendation=module==='recommendations';
$('editorForm').hidden=calendar||recommendation;
$('scheduleForm').hidden=!calendar;
$('recommendationForm').hidden=!recommendation;
if(recommendation){
 for(const field of recommendationFields) $('recommendation_'+field).value=item?.[field]??({feature_date:todayInBrasilia(),status:'draft'}[field]??'');
 const streams=JSON.parse(item?.streams||'[]');
 for(const i of streamFields){
  $('streamName'+i).value=streams[i]?.name||'';
  $('streamUrl'+i).value=streams[i]?.url||'';
 }
 $('recommendationMode').textContent=item?'EDITANDO / #'+item.id:'NOVA RECOMENDAÇÃO';
 $('recommendationStatus').textContent='';
 $('recommendation_title').focus();
}else if(calendar){const now=new Date();for(const f of calendarFields)$('schedule_'+f).value=item?.[f]??({weekday:'0',platform:'Crunchyroll',language:'Legendado',season_year:now.getFullYear(),season_quarter:Math.ceil((now.getMonth()+1)/3),status:'draft'}[f]??'');$('scheduleMode').textContent=item?'EDITANDO EXIBIÇÃO / #'+item.id:'NOVA EXIBIÇÃO';$('scheduleStatus').textContent='';$('schedule_title').focus()}else{for(const f of fields)$(f).value=item?.[f]??({category:module==='reviews'?'Reviews':'Notícias',author:'Redação VisionNews',status:'draft'}[f]??'');$('review_score').value=item?.review_score??'';$('featured').checked=Boolean(item?.featured && (!item.featured_at || featuredDecision()?.id===item.id));VisionEditor.set(item?.body||'',item?.body_format||'plain');$('editorMode').textContent=item?'EDITANDO / #'+item.id:module==='reviews'?'NOVA REVIEW':'NOVO CONTEÚDO';$('editorStatus').textContent='';reviewVisibility();buttonLabel();coverPreview();$('title').focus()}dirty=false;renderList()}
function switchModule(next){if(busy||!allowLeave())return;module=next;dirty=false;current=null;$('editorForm').hidden=true;$('scheduleForm').hidden=true;$('recommendationForm').hidden=true;$('editorEmpty').hidden=false;$('categoryFilter').hidden=next!=='news';$('adminSearch').value='';$('statusFilter').value='all';$('newArticle').textContent=next==='recommendations'?'＋ Nova recomendação':next==='schedule'?'＋ Nova exibição':next==='reviews'?'＋ Nova review':'＋ Novo conteúdo';document.querySelectorAll('[data-module]').forEach(b=>{b.classList.toggle('selected',b.dataset.module===next);b.setAttribute('aria-pressed',String(b.dataset.module===next))});renderList()}
function renderList(){const term=$('adminSearch').value.trim().toLowerCase(),status=$('statusFilter').value,category=$('categoryFilter').value;const list=moduleItems();const rows=list.filter(a=>(status==='all'||a.status===status)&&(module!=='news'||category==='all'||a.category===category)&&([a.title,a.author,a.platform,a.feature_date,a.topic,a.tags].filter(Boolean).join(' ')).toLowerCase().includes(term));$('newsList').innerHTML=rows.length?rows.map(a=>`<button class="newsItem ${current?.id===a.id?'current':''}" data-edit="${a.id}"><span class="statusPill ${a.status}">${names[a.status]}</span>${a.featured&&a.status==='published'&&featuredDecision()?.id===a.id?' <span class="statusPill published">★ Principal</span>':''}<h3>${esc(a.title)}</h3><small>${module==='schedule'?esc(dayNames[a.weekday]+' · '+(a.time||'Horário a confirmar')+' · '+a.platform):module==='recommendations'?esc(a.feature_date.split('-').reverse().join('/')):esc([a.category,a.topic,a.author].filter(Boolean).join(' · '))}</small></button>`).join(''):'<p class="emptyList">Nenhum item encontrado. Crie um conteúdo ou ajuste os filtros.</p>';$('newsList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(list.find(a=>a.id===Number(b.dataset.edit))));$('stats').innerHTML=['draft','published','archived'].map(s=>`<div><strong>${list.filter(a=>a.status===s).length}</strong><span>${s==='draft'?'Rascunhos':s==='published'?'Publicados':'Arquivados'}</span></div>`).join('')}
async function load(){try{const [a,b,c]=await Promise.all([api('/api/editor/news'),api('/api/editor/schedule'),api('/api/editor/recommendations')]);news=a.items;schedule=b.items;recommendations=c.items;ready=true;$('newArticle').disabled=false;renderList();$('globalStatus').textContent='Redação conectada. Gerencie notícias, reviews, calendário e recomendações. Rascunhos ficam na redação.';return true}catch(error){$('globalStatus').textContent=error.message;return false}}
$('newArticle').disabled=true;$('newArticle').onclick=()=>edit(null);document.querySelectorAll('[data-module]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.module===module));b.onclick=()=>switchModule(b.dataset.module)});$('adminSearch').oninput=renderList;$('statusFilter').onchange=renderList;$('categoryFilter').onchange=renderList;$('status').onchange=buttonLabel;$('category').onchange=reviewVisibility;$('cover').addEventListener('input',coverPreview);for(const id of ['editorForm','scheduleForm','recommendationForm'])$(id).addEventListener('input',()=>{dirty=true;$(({editorForm:'editorStatus',scheduleForm:'scheduleStatus',recommendationForm:'recommendationStatus'})[id]).textContent='Alterações ainda não salvas.'});$('reloadButton').onclick=async()=>{if(busy||!allowLeave())return;const id=current?.id;if(await load()){dirty=false;edit(moduleItems().find(a=>a.id===id)||null)}};
async function save(event,calendar){event.preventDefault();if(!ready||busy)return;const form=$(calendar?'scheduleForm':'editorForm'),button=$(calendar?'saveSchedule':'saveButton'),feedback=$(calendar?'scheduleStatus':'editorStatus');if(!form.reportValidity())return;let values;if(calendar){values=Object.fromEntries(calendarFields.map(f=>[f,$('schedule_'+f).value]));for(const f of ['weekday','season_year','season_quarter'])values[f]=Number(values[f])}else{try{if(VisionEditor.text().trim().length<40)throw Error('Escreva ao menos 40 caracteres no conteúdo.');values=Object.fromEntries(fields.map(f=>[f,$(f).value]));values.featured=values.category==='Notícias'&&$('featured').checked;values.body=JSON.stringify(VisionEditor.get());values.body_format='rich-v1';values.review_score=$('review_score').value===''?null:Number($('review_score').value)}catch(error){feedback.textContent=error.message;return}}if(current)values.version=current.version;busy=true;button.disabled=true;$('newArticle').disabled=true;feedback.textContent='Salvando…';try{const {item}=await api('/api/editor/'+(calendar?'schedule':'news')+(current?'/'+current.id:''),{method:current?'PUT':'POST',body:JSON.stringify(values)});current=item;dirty=false;$(calendar?'scheduleMode':'editorMode').textContent='EDITANDO / #'+item.id;feedback.textContent=item.status==='published'?(calendar?'Exibição publicada no calendário da temporada.':'Conteúdo publicado no portal.'):item.status==='archived'?'Item arquivado e retirado do portal.':'Rascunho salvo no servidor.';await load();renderList()}catch(error){feedback.textContent=error.message}finally{busy=false;button.disabled=false;$('newArticle').disabled=false}}
$('editorForm').onsubmit=e=>save(e,false);$('scheduleForm').onsubmit=e=>save(e,true);
$('previewButton').onclick=()=>{const cover=VisionContent.https($('cover').value),source=VisionContent.https($('source_url').value);let html;try{html=VisionContent.render(VisionEditor.get())}catch(e){$('editorStatus').textContent=e.message;return}const score=$('review_score').value;$('previewContent').innerHTML=`<span class="tag">PRÉVIA / AINDA NÃO É PUBLICAÇÃO</span><h2>${esc($('title').value||'Título do conteúdo')}</h2><small class="previewMeta">${esc($('category').value)} · ${esc($('author').value)}</small>${cover?`<img class="previewCover" src="${esc(cover)}" referrerpolicy="no-referrer" alt="Imagem de capa">`:''}<p><strong>${esc($('summary').value)}</strong></p>${$('category').value==='Reviews'?`<div class="reviewVerdict"><b>${score!==''?esc(score)+'/10':'REVIEW'}</b><span>${esc($('anime_title').value)} · ${esc($('review_verdict').value)}</span></div>`:''}<div class="formattedContent">${html}</div>${source?`<p><a href="${esc(source)}" target="_blank" rel="noopener">Fonte: ${esc($('source_label').value||'Fonte oficial')} ↗</a></p>`:''}`;$('previewDialog').showModal()};$('closePreview').onclick=()=>$('previewDialog').close();window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});load();

api('/api/admin/session').then(()=>{$('adminLink').hidden=false}).catch(()=>{});

$('recommendationForm').onsubmit = async event => {
 event.preventDefault();
 if (!ready || busy) return;
 const values = Object.fromEntries(recommendationFields.map(field=>[field,$('recommendation_'+field).value]));
 values.streams = streamFields.map(i=>({name:$('streamName'+i).value.trim(),url:$('streamUrl'+i).value.trim()})).filter(stream=>stream.name||stream.url);
 if (current) values.version=current.version;
 const button=$('saveRecommendation'), feedback=$('recommendationStatus');
 busy=true;
 button.disabled=true;
 $('newArticle').disabled=true;
 feedback.textContent='Salvando…';
 try {
  const {item}=await api('/api/editor/recommendations'+(current?'/'+current.id:''),{method:current?'PUT':'POST',body:JSON.stringify(values)});
  current=item;
  dirty=false;
  $('recommendationMode').textContent='EDITANDO / #'+item.id;
  const date=item.feature_date.split('-').reverse().join('/');
  feedback.textContent=({draft:'Rascunho salvo.',published:'Publicação programada para '+date+' na home.',archived:'Recomendação arquivada.'})[item.status];
  await load();
 } catch(error) {
  feedback.textContent=error.message;
 } finally {
  busy=false;
  button.disabled=false;
  $('newArticle').disabled=false;
 }
};
