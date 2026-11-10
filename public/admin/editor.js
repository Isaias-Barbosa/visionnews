(function(){
const box=document.getElementById('richEditor');let selection=null;
function inline(node,marks={}){if(node.nodeType===3)return [{text:node.textContent,...marks}];if(node.nodeType!==1||['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName))return [];if(node.tagName==='BR')return [{text:'\n',...marks}];const next={...marks};if(['B','STRONG'].includes(node.tagName))next.bold=true;if(['I','EM'].includes(node.tagName))next.italic=true;if(node.tagName==='U')next.underline=true;if(['S','STRIKE','DEL'].includes(node.tagName))next.strike=true;if(node.tagName==='A'){const href=VisionContent.https(node.getAttribute('href'));if(href)next.href=href}return [...node.childNodes].flatMap(n=>inline(n,next))}
function documentValue(){const blocks=[];let pending=[];function flush(){if(pending.length){blocks.push({type:'p',children:pending});pending=[]}}function visit(node){if(node.nodeType===3){pending.push(...inline(node));return}if(node.nodeType!==1)return;const tag=node.tagName;if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(tag))return;if(['UL','OL'].includes(tag)){flush();blocks.push({type:tag.toLowerCase(),items:[...node.children].filter(n=>n.tagName==='LI').map(n=>inline(n))});return}if(['P','H2','H3','BLOCKQUOTE','DIV'].includes(tag)){flush();if([...node.children].some(n=>['P','DIV','H2','H3','UL','OL','BLOCKQUOTE'].includes(n.tagName))){[...node.childNodes].forEach(visit);flush()}else blocks.push({type:tag==='BLOCKQUOTE'?'quote':tag==='DIV'?'p':tag.toLowerCase(),children:inline(node)});return}pending.push(...inline(node))}[...box.childNodes].forEach(visit);flush();return VisionContent.validate({type:'doc',blocks})}
function count(){try{const text=VisionContent.plain(documentValue()).trim();document.getElementById('wordCount').textContent=(text?text.split(/\s+/).length:0)+' palavras · '+text.length+' caracteres'}catch(e){document.getElementById('wordCount').textContent=e.message}}
function saveSelection(){const s=window.getSelection();if(s.rangeCount&&box.contains(s.anchorNode))selection=s.getRangeAt(0).cloneRange()}
function command(name,value){box.focus();if(selection){const s=window.getSelection();s.removeAllRanges();s.addRange(selection)}document.execCommand(name,false,value);saveSelection();box.dispatchEvent(new Event('input',{bubbles:true}));count()}
box.addEventListener('keyup',saveSelection);box.addEventListener('mouseup',saveSelection);box.addEventListener('blur',saveSelection);box.addEventListener('input',count);box.addEventListener('paste',event=>{event.preventDefault();command('insertText',event.clipboardData.getData('text/plain'))});
document.querySelectorAll('[data-command],[data-block]').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>command(button.dataset.command||'formatBlock',button.dataset.block||null)});document.getElementById('insertLink').onmousedown=e=>e.preventDefault();const linkFields=document.getElementById('linkFields');
const editorLink=document.getElementById('editorLink');
const linkError=document.getElementById('editorLinkError');
const hideLink=()=>{linkFields.hidden=true;linkError.textContent='';};
document.getElementById('insertLink').onclick=()=>{
 if(!selection || selection.collapsed){
  linkFields.hidden=false;
  linkError.textContent='Selecione o trecho do texto que vai receber o link.';
  box.focus();
  return;
 }
 linkFields.hidden=false;
 linkError.textContent='';
 editorLink.value='';
 editorLink.focus();
};
function applyLink(){
 const href=VisionContent.https(editorLink.value.trim());
 if(!href){linkError.textContent='Informe um endereço HTTPS válido.';return;}
 if(!selection || selection.collapsed){linkError.textContent='Selecione um trecho do conteúdo.';return;}
 hideLink();
 command('createLink',href);
}
document.getElementById('applyLink').onclick=applyLink;
document.getElementById('cancelLink').onclick=()=>{hideLink();box.focus();};
editorLink.addEventListener('keydown',event=>{
 if(event.key==='Enter'){event.preventDefault();applyLink();}
 if(event.key==='Escape'){hideLink();box.focus();}
});
const expand=document.getElementById('expandEditor');
expand.onclick=()=>{
 const expanded=box.classList.toggle('richExpanded');
 expand.setAttribute('aria-expanded',String(expanded));
 expand.textContent=expanded?'Reduzir editor':'Ampliar editor';
};
window.VisionEditor={get:documentValue,set(body,format){let doc;try{doc=format==='rich-v1'?VisionContent.validate(JSON.parse(body)):VisionContent.fromPlain(body)}catch{doc=VisionContent.fromPlain(body)}box.innerHTML=VisionContent.render(doc);selection=null;hideLink();count()},text(){return VisionContent.plain(documentValue())}};
})();
