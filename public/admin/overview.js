const refresh = document.getElementById('refresh');
const feedback = document.getElementById('overviewStatus');
const inventory = document.getElementById('inventory');
const accounts = document.getElementById('editorAccounts');
const accessForm = document.getElementById('editorAccessForm');
const editorEmail = document.getElementById('editorEmail');
const accessStatus = document.getElementById('accessStatus');
const grant = accessForm.querySelector('button');
let savingAccess = false;

async function changeAccess(email, method) {
 if (savingAccess) return;
 savingAccess = true;
 grant.disabled = true;
 accessStatus.textContent = 'Atualizando acesso…';
 try {
  const response = await fetch('/api/admin/editors',{
   method,headers:{'Content-Type':'application/json'},body:JSON.stringify({email})
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Falha ao atualizar o acesso.');
  accessStatus.textContent = method==='POST' ? 'Acesso editorial autorizado.' : 'Acesso editorial removido.';
  if (method==='POST') accessForm.reset();
  await loadOverview();
 } catch (error) {
  accessStatus.textContent = error.message;
 } finally {
  savingAccess = false;
  grant.disabled = false;
 }
}

accessForm.addEventListener('submit',event=>{
 event.preventDefault();
 changeAccess(editorEmail.value,'POST');
});


async function loadOverview() {
 refresh.disabled = true;
 feedback.textContent = 'Consultando o portal…';
 try {
  const response = await fetch('/api/admin/overview');
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Falha ao consultar o portal.');
  const groups = {news:'Matérias e reviews',schedule:'Exibições',recommendations:'Recomendações'};
  inventory.innerHTML = Object.entries(groups).map(([key,label]) => {
   const {draft=0,published=0,archived=0} = data.counts[key];
   return `<article><h3>${label}</h3><p>${draft} rascunhos · ${published} publicados · ${archived} arquivados</p></article>`;
  }).join('');
  accounts.replaceChildren(...(data.editors.length ? data.editors : ['Nenhuma conta editorial adicional.']).map(email => {
   const item = document.createElement('li');
   item.textContent = email;
   if (data.editors.length) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'outlineButton';
    remove.textContent = 'Remover acesso';
    remove.setAttribute('aria-label','Remover acesso de '+email);
    remove.addEventListener('click',()=>changeAccess(email,'DELETE'));
    item.append(remove);
   }
   return item;
  }));
  grant.disabled = savingAccess;
  feedback.textContent = 'Banco de dados conectado · Horário de Brasília';
 } catch (error) {
  feedback.textContent = error.message;
 } finally {
  refresh.disabled = false;
 }
}
refresh.addEventListener('click', loadOverview);
loadOverview();
