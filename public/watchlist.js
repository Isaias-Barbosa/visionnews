(() => {
 const get = id => document.getElementById(id);
 const account = get('watchAccount');
 const member = get('watchMember');
 const feedback = get('watchFeedback');
 const authForm = get('watchAuthForm');
 const addForm = get('watchAddForm');
 const filter = get('watchFilter');
 const list = get('watchItems');
 const statuses = {
  planned:'Quero assistir',watching:'Assistindo',completed:'Concluído',paused:'Pausado',dropped:'Abandonado'
 };
 let creating = false;
 let items = [];
 let busy = false;

 function addOptions(select) {
  for (const [value,label] of Object.entries(statuses)) select.add(new Option(label,value));
 }

 addOptions(addForm.elements.status);
 filter.add(new Option('Todos os status','all'));
 addOptions(filter);
 filter.addEventListener('change', render);

 async function api(path, method='GET', body) {
  const options = {method,cache:'no-store'};
  if (body) {
   options.headers = {'Content-Type':'application/json'};
   options.body = JSON.stringify(body);
  }
  const response = await fetch(path,options);
  const data = await response.json().catch(()=>null);
  if (!response.ok) {
   if (response.status===401 && path==='/api/watchlist') showAccount();
   throw Error(response.status===429 ? 'Muitas tentativas. Aguarde um pouco e tente novamente.' :
    data?.error || 'Não foi possível concluir. Verifique seus dados e tente novamente.');
  }
  return data;
 }

 async function act(action) {
  if (busy) return;
  busy = true;
  feedback.textContent = '';
  member.setAttribute('aria-busy','true');
  account.setAttribute('aria-busy','true');
  try {
   await action();
  } catch (error) {
   feedback.textContent = error.message;
  } finally {
   busy = false;
   member.removeAttribute('aria-busy');
   account.removeAttribute('aria-busy');
  }
 }

 function showAccount() {
  items = [];
  list.replaceChildren();
  get('watchWelcome').textContent = '';
  member.hidden = true;
  account.hidden = false;
 }

 function render() {
  const visible = items.filter(item=>filter.value==='all'||item.status===filter.value);
  if (!visible.length) {
   const empty = document.createElement('li');
   empty.textContent = items.length ? 'Nenhum anime nesse status.' : 'Sua lista está vazia. Adicione o primeiro anime acima.';
   list.replaceChildren(empty);
   return;
  }
  list.replaceChildren(...visible.map(item => {
   const row = document.createElement('li');
   const title = document.createElement('strong');
   title.textContent = item.title;
   const status = document.createElement('select');
   status.setAttribute('aria-label','Status de '+item.title);
   addOptions(status);
   status.value = item.status;
   status.addEventListener('change',() => {
    const next = status.value;
    status.value = item.status;
    act(async () => {
     const updated = await api('/api/watchlist','PUT',{id:item.id,status:next});
     items = [updated.item,...items.filter(entry=>entry.id!==item.id)];
     render();
     feedback.textContent = 'Status atualizado.';
    });
   });
   const remove = document.createElement('button');
   remove.type = 'button';
   remove.className = 'outlineButton';
   remove.textContent = 'Remover';
   remove.setAttribute('aria-label','Remover '+item.title);
   remove.addEventListener('click',() => act(async () => {
    await api('/api/watchlist','DELETE',{id:item.id});
    items = items.filter(entry=>entry.id!==item.id);
    render();
    feedback.textContent = 'Anime removido da watchlist.';
   }));
   row.append(title,status,remove);
   return row;
  }));
 }

 async function loadAccount() {
  const session = await api('/api/auth/get-session').catch(()=>{
   throw Error('As contas estão temporariamente indisponíveis. Tente novamente mais tarde.');
  });
  if (!session?.user) {
   showAccount();
   return;
  }
  const data = await api('/api/watchlist');
  items = data.items;
  account.hidden = true;
  member.hidden = false;
  get('watchWelcome').textContent = 'Olá, '+session.user.name+'.';
  render();
 }

 get('watchAuthToggle').addEventListener('click',() => {
  if (busy) return;
  creating = !creating;
  get('watchNameField').hidden = !creating;
  authForm.elements.name.required = creating;
  authForm.elements.password.autocomplete = creating ? 'new-password' : 'current-password';
  get('watchAuthTitle').textContent = creating ? 'Crie sua conta VisionNews' : 'Entre para ver sua watchlist';
  authForm.querySelector('[type=submit]').textContent = creating ? 'Criar conta' : 'Entrar';
  get('watchAuthToggle').textContent = creating ? 'Já tenho conta' : 'Criar conta';
  feedback.textContent = '';
 });

 authForm.addEventListener('submit',event => {
  event.preventDefault();
  const values = new FormData(authForm);
  act(async () => {
   const input = {email:values.get('email'),password:values.get('password')};
   if (creating) input.name = values.get('name').trim();
   try {
    await api(creating ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email','POST',input);
   } catch (error) {
    if (error.message.startsWith('Muitas tentativas')) throw error;
    throw Error(creating ? 'Não foi possível criar a conta. Confira o e-mail e use uma senha de pelo menos 12 caracteres.' : 'Não foi possível entrar. Confira o e-mail e a senha.');
   }
   authForm.reset();
   await loadAccount();
  });
 });

 get('watchSignOut').addEventListener('click',() => act(async () => {
  await api('/api/auth/sign-out','POST',{});
  showAccount();
 }));

 addForm.addEventListener('submit',event => {
  event.preventDefault();
  const values = new FormData(addForm);
  act(async () => {
   const {item} = await api('/api/watchlist','PUT',{title:values.get('title'),status:values.get('status')});
   items = [item,...items];
   filter.value = 'all';
   addForm.reset();
   render();
   feedback.textContent = 'Anime adicionado à watchlist.';
  });
 });

 act(loadAccount);
})();
