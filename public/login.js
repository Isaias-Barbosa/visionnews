const query = new URLSearchParams(location.search);
const requested = query.get('next');
const destination = ['/admin','/dashboard','/#biblioteca','/'].includes(requested) ? requested : '/#biblioteca';
const form = document.getElementById('accountForm');
const password = form.elements.password;
const submit = form.querySelector('[type=submit]');
const signIn = document.getElementById('modeSignIn');
const signUp = document.getElementById('modeSignUp');
const toggle = document.getElementById('passwordToggle');
const status = document.getElementById('accountStatus');
let creating = false;

function mode(signup) {
 creating = signup;
 signIn.setAttribute('aria-pressed',String(!creating));
 signUp.setAttribute('aria-pressed',String(creating));
 document.getElementById('accountTitle').textContent = creating ? 'Crie seu perfil.' : 'Bom te ver por aqui.';
 document.getElementById('accountDescription').textContent = creating ? 'Comece sua lista e organize os animes que quer assistir.' : 'Entre para continuar de onde parou.';
 document.getElementById('accountNameField').hidden = !creating;
 document.getElementById('passwordHint').hidden = !creating;
 form.elements.name.required = creating;
 password.minLength = creating ? 12 : 1;
 password.autocomplete = creating ? 'new-password' : 'current-password';
 submit.firstChild.textContent = creating ? 'Criar conta ' : 'Entrar ';
 status.textContent = '';
}

signIn.addEventListener('click',()=>mode(false));
signUp.addEventListener('click',()=>mode(true));
toggle.addEventListener('click',()=>{
 const visible = password.type==='password';
 password.type = visible ? 'text' : 'password';
 toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
 toggle.setAttribute('aria-label',visible ? 'Ocultar senha' : 'Mostrar senha');
 toggle.setAttribute('aria-pressed',String(visible));
});

const notice = document.getElementById('accountNotice');
if (query.get('reason')==='verification') {
 notice.textContent = 'Sua conta ainda precisa de verificação para acessar a redação.';
 notice.hidden = false;
} else if (destination==='/admin'||destination==='/dashboard') {
 notice.textContent = 'Entre com a conta autorizada para acessar a redação.';
 notice.hidden = false;
}

mode(query.get('mode')==='cadastro');
submit.disabled = false;
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if (submit.disabled) return;
 const data = new FormData(form);
 const input = {email:data.get('email').trim(),password:data.get('password')};
 if (creating) input.name = data.get('name').trim();
 if (creating && !input.name) {
  status.textContent = 'Informe seu nome.';
  form.elements.name.focus();
  return;
 }
 submit.disabled = signIn.disabled = signUp.disabled = true;
 submit.firstChild.textContent = creating ? 'Criando conta… ' : 'Entrando… ';
 status.textContent = '';
 try {
  const endpoint = creating ? 'sign-up' : 'sign-in';
  const response = await fetch('/api/auth/'+endpoint+'/email',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)
  });
  if (response.status===429) throw Error('Muitas tentativas. Aguarde um pouco e tente de novo.');
  if (response.status>=500) throw Error('O acesso está temporariamente indisponível. Tente de novo em instantes.');
  if (!response.ok) throw Error(creating ? 'Não deu para criar a conta. Confira os dados ou entre se você já tem cadastro.' : 'E-mail ou senha incorretos. Confira os dados e tente novamente.');
  location.assign(destination);
 } catch (error) {
  status.textContent = error instanceof TypeError ? 'Confira sua conexão e tente novamente.' : error.message;
  submit.disabled = signIn.disabled = signUp.disabled = false;
  submit.firstChild.textContent = creating ? 'Criar conta ' : 'Entrar ';
 }
});
