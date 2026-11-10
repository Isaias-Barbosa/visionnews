(async()=>{
const notice=document.createElement('p');notice.className='liveNewsStatus';notice.setAttribute('role','status');document.querySelector('#noticias .sectionTitle').after(notice);
try{const response=await fetch('/api/news',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('offline');const {items,demo,featuredId}=await response.json();
if(demo===false){
 if(dialog.open && /^#leitura-\d+$/.test(location.hash) && Number(location.hash.slice(9))<100) dialog.close();
 for(const article of articles) if(article && !article.cms) delete articles[article.id];
 for(const id of savedIds) if(id<100) savedIds.delete(id);
 for(const selector of ['#demoNewsAside','#demoReview','#demoDiscovery','.heroIndex']) document.querySelector(selector).hidden=true;
 document.querySelector('#liveDiscovery').hidden=false;
 document.querySelector('#noticias .sectionNote').textContent='Seleção da redação';
 document.querySelector('#inicio .edition').textContent='REDAÇÃO VISIONNEWS';
 document.querySelector('.heroText .tag').textContent='VISIONNEWS / NOTÍCIAS DE ANIME';
 document.querySelector('.heroText p').textContent='Notícias, reviews e estreias do universo dos animes.';
 document.querySelector('.heroText .byline').textContent='REDAÇÃO VISIONNEWS';
 const action=document.querySelector('.heroText .primary');
 action.textContent='Explorar notícias ↗';
 action.onclick=()=>location.hash='noticias';
}
for(const item of items){const id=100+item.id;if(!Number.isSafeInteger(id)||id>1000000)continue;let richHtml='',plainBody=item.body;if(item.body_format==='rich-v1'){try{const doc=VisionContent.validate(JSON.parse(item.body));richHtml='<div class="formattedContent">'+VisionContent.render(doc)+'</div>';plainBody=VisionContent.plain(doc)}catch{plainBody='Este conteúdo está temporariamente indisponível.'}}const paragraphs=plainBody.split(/\n\s*\n/).filter(Boolean).map(escapeHtml);if(item.source_url){const sourceHtml=`<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener">Fonte: ${escapeHtml(item.source_label||'Fonte oficial')} ↗</a>`;paragraphs.push(sourceHtml);if(richHtml)richHtml+='<p>'+sourceHtml+'</p>';}articles[id]={id,title:escapeHtml(item.title),desc:escapeHtml(item.summary),body:paragraphs,contentHtml:richHtml,cover:VisionContent.https(item.cover),topic:item.topic||'',tags:item.tags||'',review_score:item.review_score,review_verdict:escapeHtml(item.review_verdict||''),anime_title:escapeHtml(item.anime_title||''),category:item.category,author:escapeHtml(item.author),img:VisionContent.https(item.cover)||artImages[0],minutes:Math.max(1,Math.ceil(plainBody.split(/\s+/).length/200)),original:true,cms:true,published_at:item.published_at};}
const featured=items.find(item=>item.id===featuredId);
if(featured && articles[100+featured.id]){
 const hero=document.querySelector('.hero');
 hero.classList.add('featuredHero');
 document.querySelector('.heroText .tag').textContent='NOTÍCIA PRINCIPAL / VISIONNEWS';
 document.querySelector('.heroText h1').textContent=featured.title;
 document.querySelector('.heroText p').textContent=featured.summary;
 document.querySelector('.heroText .byline').textContent=featured.author+' • '+articles[100+featured.id].minutes+' MIN DE LEITURA';
 const action=document.querySelector('.heroText .primary');
 action.textContent='Ler notícia ↗';
 action.onclick=()=>openArticle(100+featured.id);
 const cover=VisionContent.https(featured.cover);
 if(cover){
  const image=document.querySelector('.hero > img');
  image.addEventListener('error',()=>image.hidden=true,{once:true});
  image.src=cover;
  image.alt='';
 }
}
try{const ids=JSON.parse(localStorage.getItem('visionnews.saved.v1')||'[]');if(Array.isArray(ids))for(const id of ids)if(Number.isInteger(id)&&articles[id])savedIds.add(id)}catch{}
notice.textContent=items.length?`${items.length} ${items.length===1?'matéria publicada':'matérias publicadas'} pela redação.`:'Nenhuma matéria publicada no momento.';
render=function(){const term=query.value.trim().toLocaleLowerCase('pt-BR');const list=articles.filter(a=>(filter==='Todos'||a.category===filter)&&([a.title,a.desc,a.topic,a.tags].filter(Boolean).join(' ')).toLocaleLowerCase('pt-BR').includes(term)).sort((a,b)=>Number(!!b.cms)-Number(!!a.cms)||(b.cms&&a.cms?String(b.published_at).localeCompare(a.published_at)||b.id-a.id:0));cards.innerHTML=list.slice(0,visibleLimit).map(articleCard).join('');document.querySelector('#empty').hidden=!!list.length;document.querySelector('#loadMore').hidden=list.length<=visibleLimit;document.querySelector('#readingCount').textContent=`${Math.min(visibleLimit,list.length)} de ${list.length} leituras`};render();renderLibrary();const reviews=items.filter(a=>a.category==='Reviews');if(reviews.length){const section=document.createElement('div');section.className='publicReviews';section.innerHTML=reviews.map(a=>`<button onclick="openArticle(${100+a.id})"><span class="tag">REVIEW / ${escapeHtml(a.anime_title||'ANIME')}</span><h3>${escapeHtml(a.title)}</h3>${a.review_score!==null&&a.review_score!==undefined?`<strong>${a.review_score}/10</strong>`:''}<p>${escapeHtml(a.review_verdict||a.summary)}</p><span class="tag">LER REVIEW ↗</span></button>`).join('');document.querySelector('#reviews .sectionTitle').after(section)}const match=location.hash.match(/^#leitura-(\d+)$/);if(match&&articles[Number(match[1])])openArticle(Number(match[1]));
}catch{notice.textContent='As notícias da redação estão temporariamente indisponíveis. Os guias continuam disponíveis.'}
})();
