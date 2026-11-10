(function(root){
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2000?u.href:''}catch{return ''}}
const maxImageLength=240000;
function imageSource(src){
 if(typeof src!=='string'||src.length>maxImageLength)return '';
 const match=/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
 if(!match || match[2].length%4!==0)return '';
 const header=atob(match[2].slice(0,16));
 return (match[1]==='webp'
  ? header.startsWith('RIFF')&&header.slice(8,12)==='WEBP'
  : header.startsWith('\xff\xd8\xff')) ? src : '';
}
function validate(value){let count=0,length=0,imageLength=0;if(!value||value.type!=='doc'||!Array.isArray(value.blocks)||value.blocks.length>1000)throw Error('Documento de texto inválido.');const blocks=value.blocks.map(b=>{if(!b||!['p','h2','h3','quote','ul','ol'].includes(b.type))throw Error('Bloco de texto inválido.');function inline(nodes){if(!Array.isArray(nodes)||nodes.length>2000)throw Error('Texto inválido.');return nodes.map(n=>{if(++count>10000||!n)throw Error('Texto inválido.');
 if(n.image!==undefined){
  const image=imageSource(n.image);
  if(!image)throw Error('Imagem inválida ou grande demais.');
  imageLength+=image.length;
  if(imageLength>600000)throw Error('O conjunto de imagens desta matéria excedeu o limite.');
  return {image};
 }
 if(typeof n.text!=='string')throw Error('Texto inválido.');length+=n.text.length;if(length>50000)throw Error('O conteúdo deve ter no máximo 50.000 caracteres.');const v={text:n.text};if(n.bold===true)v.bold=true;if(n.italic===true)v.italic=true;if(n.underline===true)v.underline=true;if(n.strike===true)v.strike=true;if(n.href){v.href=https(n.href);if(!v.href)throw Error('Use links HTTPS válidos no conteúdo.')}return v})}if(b.type==='ul'||b.type==='ol'){if(!Array.isArray(b.items)||b.items.length>500)throw Error('Lista inválida.');return {type:b.type,items:b.items.map(inline)}}return {type:b.type,children:inline(b.children)}});return {type:'doc',blocks}}
function plain(doc){doc=validate(doc);return doc.blocks.map(b=>b.items?b.items.map(a=>a.map(n=>n.text).join('')).join('\n'):b.children.map(n=>n.text).join('')).join('\n\n')}
function fromPlain(text){return {type:'doc',blocks:String(text||'').split(/\n\s*\n/).map(t=>({type:'p',children:[{text:t}]}))}}
function render(doc){doc=validate(doc);function inline(nodes){return nodes.map(n=>{if(n.image)return '<img class="articleInlineImage" src="'+escape(n.image)+'" alt="Imagem da matéria" loading="lazy">';let s=escape(n.text).replace(/\n/g,'<br>');if(n.bold)s='<strong>'+s+'</strong>';if(n.italic)s='<em>'+s+'</em>';if(n.underline)s='<u>'+s+'</u>';if(n.strike)s='<s>'+s+'</s>';if(n.href)s='<a href="'+escape(n.href)+'" target="_blank" rel="noopener">'+s+'</a>';return s}).join('')}return doc.blocks.map(b=>b.items?'<'+b.type+'>'+b.items.map(a=>'<li>'+inline(a)+'</li>').join('')+'</'+b.type+'>':'<'+({quote:'blockquote'}[b.type]||b.type)+'>'+inline(b.children)+'</'+({quote:'blockquote'}[b.type]||b.type)+'>').join('')}
root.VisionContent={escape,https,imageSource,maxImageLength,validate,plain,fromPlain,render};
})(globalThis);
