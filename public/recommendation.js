(async () => {
 const card = document.getElementById('dailyCard');
 const escape = VisionContent.escape;
 try {
  const response = await fetch('/api/recommendation');
  if (!response.ok) throw Error('Indisponível');
  const {item} = await response.json();
  if (!item) {
   card.innerHTML = '<p class="dailyPlaceholder">A redação ainda não publicou uma indicação para hoje. <a href="#descobrir">Explore outras sugestões ↗</a></p>';
   return;
  }
  const cover = VisionContent.https(item.cover);
  const streams = item.streams.map(({name,url}) => {
   const link = VisionContent.https(url);
   return link ? `<a href="${escape(link)}" target="_blank" rel="noopener noreferrer">${escape(name)} ↗</a>` : '';
  }).join('');
  card.innerHTML = `
   ${cover ? `<img class="dailyCover" src="${escape(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
   <div class="dailyCopy">
    <time class="eyebrow" datetime="${escape(item.feature_date)}">${escape(item.feature_date.split('-').reverse().join('/'))}</time>
    <h3>${escape(item.title)}</h3>
    <p>${escape(item.summary)}</p>
    <p class="tag">ONDE ASSISTIR NO BRASIL</p>
    <div class="dailyLinks">${streams}</div>
   </div>`;
  card.querySelector('img')?.addEventListener('error', event=>event.currentTarget.remove());
 } catch {
  card.innerHTML = '<p class="dailyPlaceholder">A recomendação está temporariamente indisponível. <a href="#temporada">Veja o calendário ↗</a></p>';
 }
})();
