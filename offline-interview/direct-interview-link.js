const CONTRACT_VERSION='1';
const MAX_EMBEDDED_CHARS=48000;
function base64UrlToUtf8(value){
  const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export function utf8ToBase64Url(value){
  const bytes=new TextEncoder().encode(String(value));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function resolveDirectInterviewLink(locationLike=window.location,fetchImpl=fetch){
  const hash=String(locationLike.hash||'').replace(/^#/,'');if(!hash)return null;
  const p=new URLSearchParams(hash);if(p.get('oi')!==CONTRACT_VERSION)return null;
  const view=p.get('view')==='interview'?'interview':'setup';const embedded=p.get('spec');const remote=p.get('url');
  if(Boolean(embedded)===Boolean(remote))throw new Error('Lien interview invalide : indiquez exactement une source spec ou url.');
  let raw;
  if(embedded){if(embedded.length>MAX_EMBEDDED_CHARS)throw new Error('Interview embarquée trop volumineuse.');try{raw=JSON.parse(base64UrlToUtf8(embedded));}catch{throw new Error('Interview embarquée invalide.');}}
  else {let target;try{target=new URL(remote);}catch{throw new Error('URL d’interview invalide.');}if(target.protocol!=='https:')throw new Error('L’URL d’interview doit utiliser HTTPS.');let response;try{response=await fetchImpl(target.href,{mode:'cors',credentials:'omit',cache:'no-store'});}catch{throw new Error('Impossible de charger l’interview distante (réseau ou CORS).');}if(!response.ok)throw new Error(`Impossible de charger l’interview distante (${response.status}).`);try{raw=await response.json();}catch{throw new Error('Le lien distant ne contient pas un JSON valide.');}}
  return {raw,view,source:embedded?'embedded':'remote'};
}
export function buildDirectInterviewLink(appUrl,spec,{view='setup'}={}){
  const base=new URL(appUrl);base.hash='';const payload=utf8ToBase64Url(JSON.stringify(spec));if(payload.length>MAX_EMBEDDED_CHARS)throw new Error('Interview trop volumineuse pour un lien embarqué.');
  base.hash=new URLSearchParams({oi:CONTRACT_VERSION,view:view==='interview'?'interview':'setup',spec:payload}).toString();return base.href;
}
