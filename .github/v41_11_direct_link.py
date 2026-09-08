from pathlib import Path
import json,re
ROOT=Path('offline-interview')
APP=ROOT/'app.js'; AUDIO=ROOT/'audio-window.js'; INDEX=ROOT/'index.html'; SW=ROOT/'sw.js'; KIT=ROOT/'INTERVIEW_AUTHORING_KIT.md'; CONTRACT=ROOT/'test-runtime-contract.mjs'

# 1) direct-link parser module
DIRECT=ROOT/'direct-interview-link.js'
DIRECT.write_text(r'''const CONTRACT_VERSION='1';
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
''')

# 2) audio recovery view: canonical identity unchanged; manual replay/retranscription use post-roll only
AUDIO.write_text("""export const AUDIO_CONTEXT_BEFORE_MS = 250;\nexport const AUDIO_CONTEXT_AFTER_MS = 250;\nexport const AUDIO_RECOVERY_AFTER_MS = 250;\nexport function turnAudioWindow(turn, mode='canonical', durationMs=null){\n  const r=turn?.audioRef;if(!r?.recordingId)return null;\n  const canonicalStartMs=Math.max(0,Number(r.startMs)||0),canonicalEndMs=Math.max(canonicalStartMs,Number(r.endMs)||canonicalStartMs);\n  const limit=Number.isFinite(Number(durationMs))?Math.max(0,Number(durationMs)):null;\n  if(mode==='canonical')return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:canonicalEndMs,canonicalStartMs,canonicalEndMs,mode:'canonical'};\n  if(mode==='recovery'){const afterMs=Math.max(0,Number(r.recoveryAfterMs??AUDIO_RECOVERY_AFTER_MS)||0),endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:Math.max(canonicalStartMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs:0,afterMs,mode:'recovery'};}\n  const beforeMs=Math.max(0,Number(r.contextBeforeMs??AUDIO_CONTEXT_BEFORE_MS)||0),afterMs=Math.max(0,Number(r.contextAfterMs??AUDIO_CONTEXT_AFTER_MS)||0),startMs=Math.max(0,canonicalStartMs-beforeMs),endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);\n  return{recordingId:r.recordingId,startMs,endMs:Math.max(startMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs,afterMs,mode:'context'};\n}\n""")

s=APP.read_text()
s=s.replace("import { turnAudioWindow } from './audio-window.js';","import { turnAudioWindow } from './audio-window.js';\nimport { resolveDirectInterviewLink } from './direct-interview-link.js';",1)
s=s.replace("const BUILD_ID = '2026-09-08.interview-runtime-v41.10';","const BUILD_ID = '2026-09-08.interview-runtime-v41.11';",1)
# Replay and explicit recovery STT use post-roll only.
s=s.replace("const ref = turnAudioWindow(turn, 'canonical');","const ref = turnAudioWindow(turn, 'recovery');",2)
# Failed manual retranscription is retryable; success stays terminal.
s=s.replace("if (stable?.audioKey === audioKey && ['succeeded', 'failed'].includes(stable.status)) {\n    showError(ui.interviewError, stable.status === 'succeeded'\n      ? 'Cette prise a déjà une retranscription système stabilisée. Le texte reste modifiable manuellement.'\n      : 'La tentative système de cette prise a déjà échoué. Le texte reste modifiable manuellement.');\n    return;\n  }","if (stable?.audioKey === audioKey && stable.status === 'succeeded') {\n    showError(ui.interviewError, 'Cette prise a déjà une retranscription stabilisée. Le texte reste modifiable manuellement.');\n    return;\n  }",1)
s=s.replace("retranscribe.disabled = !audioReady || !trackSupported || systemSpeechCapability.mode === 'unavailable' || ['succeeded', 'failed'].includes(stableRetranscription);","retranscribe.disabled = !audioReady || !trackSupported || systemSpeechCapability.mode === 'unavailable' || stableRetranscription === 'succeeded';",1)
s=s.replace("? 'Transcription terminée sans texte : correction manuelle disponible'","? 'Aucun texte reconnu — réessayer'",1)
# Micro: retain meter only; accessible state lives on meter, no moving visible text/button.
s=s.replace("  if (ui.micMeterState) { ui.micMeterState.textContent = state === 'Bon niveau' ? 'Bon' : state; ui.micMeterState.dataset.levelState = key; }\n  if (ui.micPreviewBtn) {\n    ui.micPreviewBtn.dataset.levelState = key;\n    ui.micPreviewBtn.title = `Niveau micro : ${state}`;\n    ui.micPreviewBtn.setAttribute('aria-label', `Microphone — ${state}`);\n  }","  if (ui.micMeterState) { ui.micMeterState.textContent = ''; ui.micMeterState.dataset.levelState = key; }\n  const meter = ui.micMeterFill?.parentElement;\n  if (meter) { meter.dataset.levelState = key; meter.title = `Niveau micro : ${state}`; meter.setAttribute('aria-valuetext', state); meter.setAttribute('aria-valuenow', String(Math.round(visual * 100))); }",1)
s=s.replace("  if (ui.micPreviewBtn) { ui.micPreviewBtn.textContent = isRecording() ? 'Micro' : 'Micro'; ui.micPreviewBtn.setAttribute('aria-pressed', 'true'); }\n",'',1)
s=s.replace("  if (ui.micPreviewBtn) { ui.micPreviewBtn.textContent = 'Micro'; ui.micPreviewBtn.setAttribute('aria-pressed', 'false'); }\n",'',1)
# Direct-link loader helper and init integration.
helper=r'''
async function loadDirectInterviewFromLocation(){
  const direct=await resolveDirectInterviewLink(window.location);
  if(!direct)return null;
  interview=normalizeSpec(direct.raw);
  ensureInterviewParticipants();
  await persistSpec();
  session=null;
  return direct;
}
'''
marker='async function init() {'
if marker not in s: raise SystemExit('init marker missing')
s=s.replace(marker,helper+'\n'+marker,1)
# Resolve direct source before saved spec is allowed to win.
needle="  await ensureDb();\n\n  const [savedSpec, savedSession] = await Promise.all([dbGet(SPEC_KEY), dbGet(STATE_KEY)]);"
repl="  await ensureDb();\n\n  let directLaunch = null;\n  try { directLaunch = await loadDirectInterviewFromLocation(); }\n  catch (error) { showError(ui.loadError, error.message || String(error)); }\n  const [savedSpec, savedSession] = await Promise.all([dbGet(SPEC_KEY), dbGet(STATE_KEY)]);"
if needle not in s: raise SystemExit('init db anchor missing')
s=s.replace(needle,repl,1)
# If direct spec exists, do not overwrite it with saved spec/session.
s=s.replace("  if (savedSpec) {\n    try { interview = normalizeSpec(savedSpec); } catch { interview = null; }\n  }","  if (!directLaunch && savedSpec) {\n    try { interview = normalizeSpec(savedSpec); } catch { interview = null; }\n  }",1)
s=s.replace("  if (savedSession && interview) {","  if (!directLaunch && savedSession && interview) {",1)
# Auto-enter interview view only after setup/runtime boot; no microphone starts in startInterview.
anchor="  await Promise.allSettled([registerServiceWorker(), requestPersistentStorage(), detectRuntimeSystemSpeech()]);\n  renderSetup();"
if anchor not in s: raise SystemExit('init tail anchor missing')
s=s.replace(anchor,anchor+"\n  if (directLaunch?.view === 'interview') await startInterview();",1)
APP.write_text(s)

# 3) markup/css: meter only, stable width
idx=INDEX.read_text().replace('styles.css?v=41.10','styles.css?v=41.11').replace('app.js?v=41.10','app.js?v=41.11')
idx=idx.replace('''              <div class="mic-meter-row" aria-label="État du microphone">\n                <button id="micPreviewBtn" class="ghost small mic-preview-button" type="button" aria-pressed="false">Micro</button>\n                <div class="mic-meter" role="meter" aria-label="Niveau du microphone" aria-valuemin="0" aria-valuemax="100">\n                  <span class="mic-meter-recommended" aria-hidden="true"></span>\n                  <span id="micMeterFill" class="mic-meter-fill" style="--level:0" aria-hidden="true"></span>\n                </div>\n                <span id="micMeterState" class="mic-meter-state" data-level-state="silence">Silence</span>\n              </div>''','''              <div class="mic-meter-row">\n                <div class="mic-meter" role="meter" aria-label="Niveau du microphone" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Silence">\n                  <span class="mic-meter-recommended" aria-hidden="true"></span>\n                  <span id="micMeterFill" class="mic-meter-fill" style="--level:0" aria-hidden="true"></span>\n                </div>\n                <span id="micMeterState" class="mic-meter-state sr-only" data-level-state="silence"></span>\n              </div>''',1)
INDEX.write_text(idx)
SW.write_text(SW.read_text().replace('41.10','41.11'))
css=(ROOT/'styles.css').read_text()
css=css.replace('.mic-meter-row{display:flex;align-items:center;gap:6px;min-height:30px;align-self:center}','.mic-meter-row{display:flex;align-items:center;justify-content:center;width:14px;min-width:14px;height:30px;align-self:center}',1)
# existing button rules are now dead; delete component rules rather than override
css=re.sub(r'\.mic-preview-button\{[^}]*\}\n?', '', css, count=1)
css=re.sub(r'\.mic-preview-button::before\{[^}]*\}\n?', '', css, count=1)
css=re.sub(r'\.mic-preview-button\[data-level-state=good\]::before\{[^}]*\}\.mic-preview-button\[data-level-state=low\]::before,\.mic-preview-button\[data-level-state=silence\]::before\{[^}]*\}\.mic-preview-button\[data-level-state=hot\]::before\{[^}]*\}\n?', '', css, count=1)
css=re.sub(r'\.mic-meter-state\{[^}]*\}\n?', '', css, count=1)
css=re.sub(r'\.mic-meter-state\[data-level-state=good\]\{[^}]*\}\.mic-meter-state\[data-level-state=hot\]\{[^}]*\}\n?', '', css, count=1)
css=css.replace('@media(max-width:560px){.mic-meter-row{gap:5px}.mic-meter{width:5px;height:26px}.mic-meter-state{min-width:30px}}','@media(max-width:560px){.mic-meter-row{width:12px;min-width:12px}.mic-meter{width:5px;height:26px}}',1)
(ROOT/'styles.css').write_text(css)

# 4) Authoring kit v1.3: direct link first, JSON fallback
kit=KIT.read_text()
kit=kit.replace('kitVersion: "1.2"','kitVersion: "1.3"',1).replace('outputFormat: json','outputFormat: direct-link',1)
kit=kit.replace('## Réponse attendue\n\nRetourne uniquement le JSON final, sans Markdown, sans explication avant ou après.\n\nLe JSON doit respecter le contrat `offline-interview.interview-spec.v1`.','''## Réponse attendue\n\nLa cible canonique de l’application est `https://stefm78.github.io/Experimental/`.\n\nConstruis d’abord en interne un JSON conforme à `offline-interview.interview-spec.v1`, puis transforme ce JSON UTF-8 en Base64URL sans padding et produis un lien direct conforme au contrat `DIRECT_INTERVIEW_LINK v1` :\n\n`https://stefm78.github.io/Experimental/#oi=1&view=setup&spec=<BASE64URL_JSON>`\n\nPar défaut, retourne uniquement ce lien `view=setup`. Si l’utilisateur demande un démarrage direct, utilise `view=interview`. Ce mode ouvre directement l’interview mais ne doit jamais être interprété comme une autorisation de démarrer le microphone sans action utilisateur.\n\nSi le payload Base64URL dépasse environ 12000 caractères, préfère un JSON hébergé publiquement en HTTPS avec CORS puis utilise :\n\n`https://stefm78.github.io/Experimental/#oi=1&view=setup&url=<URL_HTTPS_ENCODEE>`\n\nSi tu ne peux pas publier le JSON, retourne alors le JSON lui-même comme fallback explicite.\n\nLe JSON sous-jacent doit respecter le contrat `offline-interview.interview-spec.v1`.''',1)
kit=kit.replace('Ensuite, retourne uniquement le JSON final.','Ensuite, retourne le lien direct demandé ; n’utilise le JSON brut qu’en fallback lorsque le lien ne peut pas être produit.',1)
KIT.write_text(kit)

# 5) direct-link tests + focused field questionnaire
(ROOT/'test-direct-interview-link.mjs').write_text(r'''import assert from 'node:assert/strict';
import {buildDirectInterviewLink,resolveDirectInterviewLink} from './direct-interview-link.js';
globalThis.atob ??= value=>Buffer.from(value,'base64').toString('binary');
globalThis.btoa ??= value=>Buffer.from(value,'binary').toString('base64');
const spec={schema:'offline-interview.interview-spec.v1',id:'x',version:'1.0',title:'T',context:'',objective:'O',language:'fr-FR',tags:[],participants:[{id:'P1',name:'A',role:'interviewer'}],sections:[{id:'S1',title:'S',questions:[{id:'Q1',text:'Ça va ?',intent:'I',required:true,audience:['P1'],followUps:[]}]}]};
const href=buildDirectInterviewLink('https://example.test/',spec,{view:'interview'});const u=new URL(href);const parsed=await resolveDirectInterviewLink(u);assert.deepEqual(parsed.raw,spec);assert.equal(parsed.view,'interview');
await assert.rejects(()=>resolveDirectInterviewLink(new URL('https://example.test/#oi=1&view=setup&url=http%3A%2F%2Finsecure.test%2Fx.json')),/HTTPS/);
await assert.rejects(()=>resolveDirectInterviewLink(new URL('https://example.test/#oi=1&view=setup&spec=***')),/invalide/);
console.log('PASS direct interview link v1');
''')
q={'schema':'offline-interview.interview-spec.v1','version':'1.0','id':'test-ux-v41-11-direct-link','title':'Test V41.11 — audio + lien direct','context':'Qualification ciblée après V41.10.','objective':'Vérifier fin de segment, retry transcription, micro stable et accès direct.','language':'fr-FR','estimatedDurationMinutes':5,'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],'sections':[{'id':'S1','title':'V41.11','questions':[{'id':'Q1','label':'Préflight','text':'Ouvrez Diagnostic. La version doit être exactement 2026-09-08.interview-runtime-v41.11. Sinon arrêtez le test.','intent':'Cible exacte.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},{'id':'Q2','label':'Fin des prises','text':'Faites six changements rapides de personne en terminant chaque phrase par un mot net. Réécoutez deux prises et dites si le dernier mot est présent sans que le mot suivant soit attribué à la mauvaise personne.','intent':'Qualifier le post-roll de récupération.','estimatedMinutes':1,'required':True,'audience':['P1','P2'],'followUps':[]},{'id':'Q3','label':'Réessayer transcription','text':'Sur une prise sans texte, lancez la transcription audio. Si elle échoue, vérifiez que vous pouvez réessayer manuellement sans recharger la page.','intent':'Échec non terminal.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},{'id':'Q4','label':'Micro stable','text':'Parlez faible puis normal puis fort et redimensionnez la fenêtre. Vérifiez que seule la petite jauge bouge et que le bandeau ne change pas de largeur.','intent':'Micro discret et stable.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},{'id':'Q5','label':'Liens directs','text':'Ouvrez le lien setup puis le lien interview fournis. Le premier doit montrer l’accueil avec cette interview déjà chargée ; le second doit ouvrir directement l’interview sans démarrer le micro. Revenez ensuite à l’accueil.','intent':'DIRECT_INTERVIEW_LINK.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]}]}]}
(ROOT/'test-interviews'/'interview-test-ux-v41-11.json').write_text(json.dumps(q,ensure_ascii=False,indent=2)+'\n')

# 6) Runtime contract updates and targeted invariants
c=CONTRACT.read_text().replace('41\\.10','41\\.11').replace('41.10','41.11')
insert="""\n// V41.11: direct-link and targeted field repair invariants.\nassert.match(app, /resolveDirectInterviewLink/);\nassert.match(app, /directLaunch\\?\\.view === 'interview'/);\nassert.match(app, /turnAudioWindow\\(turn, 'recovery'\\)/);\nassert.doesNotMatch(app, /\\['succeeded', 'failed'\\]\\.includes\\(stableRetranscription\\)/);\nassert.match(index, /class=\"mic-meter\" role=\"meter\"/);\nassert.doesNotMatch(index, />Micro<\\/button>/);\nassert.doesNotMatch(index, />Silence<\\/span>/);\n"""
pos=c.find('// Explicit anti-growth budgets.')
if pos<0: raise SystemExit('budget marker missing')
c=c[:pos]+insert+c[pos:]
CONTRACT.write_text(c)
