from pathlib import Path
import json

root=Path('.')
app=root/'offline-interview/app.js'
s=app.read_text()
s=s.replace("import { turnAudioWindow } from './audio-window.js';", "import { turnAudioWindow, sliceAudioBuffer } from './audio-window.js';")
s=s.replace("const BUILD_ID = '2026-09-08.interview-runtime-v41.11';", "const BUILD_ID = '2026-09-08.interview-runtime-v41.12';")
s=s.replace("let activeReplayButton = null;\nconst activeSystemRetranscriptions", "let activeReplayButton = null;\nlet activeReplayTimer = null;\nconst activeSystemRetranscriptions")
s=s.replace("function stopReplay() {\n  try { activeReplayAudio?.pause(); } catch {}", "function stopReplay() {\n  if (activeReplayTimer) clearTimeout(activeReplayTimer);\n  activeReplayTimer = null;\n  try { activeReplayAudio?.pause(); } catch {}")
old="""async function replayTurnAudio(turn, button) {
  const ref = turnAudioWindow(turn, 'recovery');
  if (!ref?.recordingId) return;
  if (activeReplayTurnId === turn.id && activeReplayAudio) {
    if (activeReplayAudio.paused) {
      await activeReplayAudio.play();
      updateReplayButton(activeReplayButton, true);
    } else {
      activeReplayAudio.pause();
      updateReplayButton(activeReplayButton, false);
    }
    return;
  }
  stopReplay();
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) { showError(ui.interviewError, 'Audio local introuvable pour cette prise de parole.'); return; }
  const url = URL.createObjectURL(record.blob);
  const audio = new Audio(url);
  activeReplayAudio = audio; activeReplayUrl = url; activeReplayTurnId = turn.id; activeReplayButton = button || null;
  const end = Math.max(0, Number(ref.endMs) || 0) / 1000;
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = Math.max(0, Number(ref.startMs) || 0) / 1000;
    audio.play().then(() => updateReplayButton(activeReplayButton, true)).catch(() => stopReplay());
  }, { once: true });
  audio.addEventListener('timeupdate', () => { if (end && audio.currentTime >= end) stopReplay(); });
  audio.addEventListener('ended', stopReplay, { once: true });
}
"""
new="""function armReplayStop(endSeconds) {
  if (activeReplayTimer) clearTimeout(activeReplayTimer);
  activeReplayTimer = null;
  if (!activeReplayAudio || activeReplayAudio.paused) return;
  const remainingMs = Math.max(0, (endSeconds - activeReplayAudio.currentTime) * 1000);
  activeReplayTimer = setTimeout(stopReplay, remainingMs + 20);
}

async function replayTurnAudio(turn, button) {
  const ref = turnAudioWindow(turn, 'recovery');
  if (!ref?.recordingId) return;
  const end = Math.max(0, Number(ref.endMs) || 0) / 1000;
  if (activeReplayTurnId === turn.id && activeReplayAudio) {
    if (activeReplayAudio.paused) {
      await activeReplayAudio.play();
      updateReplayButton(activeReplayButton, true);
      armReplayStop(end);
    } else {
      activeReplayAudio.pause();
      if (activeReplayTimer) clearTimeout(activeReplayTimer);
      activeReplayTimer = null;
      updateReplayButton(activeReplayButton, false);
    }
    return;
  }
  stopReplay();
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) { showError(ui.interviewError, 'Audio local introuvable pour cette prise de parole.'); return; }
  const url = URL.createObjectURL(record.blob);
  const audio = new Audio(url);
  activeReplayAudio = audio; activeReplayUrl = url; activeReplayTurnId = turn.id; activeReplayButton = button || null;
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = Math.max(0, Number(ref.startMs) || 0) / 1000;
    audio.play().then(() => { updateReplayButton(activeReplayButton, true); armReplayStop(end); }).catch(() => stopReplay());
  }, { once: true });
  audio.addEventListener('ended', stopReplay, { once: true });
}
"""
assert old in s
s=s.replace(old,new)
old2="""async function buildTurnRecognitionTrack(turn) {
  const ref = turnAudioWindow(turn, 'recovery');
  if (!ref?.recordingId) throw new Error('Audio local absent pour cette prise.');
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) throw new Error('Audio local introuvable pour cette prise.');
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Web Audio indisponible.');
  const context = new Context();
  await context.resume();
  const decoded = await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));
  const startSeconds = Math.max(0, Number(ref.startMs) || 0) / 1000;
  const requestedEnd = Math.max(startSeconds, Number(ref.endMs) || 0) / 1000;
  const endSeconds = Math.min(decoded.duration, requestedEnd > startSeconds ? requestedEnd : decoded.duration);
  const durationSeconds = Math.max(0.05, endSeconds - startSeconds);
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if ('contentHint' in track) track.contentHint = 'speech-recognition';
  let started = false;
  return {
    track,
    durationMs: Math.ceil(durationSeconds * 1000),
    start() { if (!started) { started = true; source.start(0, startSeconds, durationSeconds); } },
    cleanup() { try { if (started) source.stop(); } catch {} try { track.stop(); } catch {} context.close().catch(() => {}); }
  };
}
"""
new2="""async function buildTurnRecognitionTrack(turn) {
  const ref = turnAudioWindow(turn, 'recovery');
  if (!ref?.recordingId) throw new Error('Audio local absent pour cette prise.');
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) throw new Error('Audio local introuvable pour cette prise.');
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Web Audio indisponible.');
  const context = new Context();
  await context.resume();
  const decoded = await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));
  const segment = sliceAudioBuffer(context, decoded, ref.startMs, ref.endMs);
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource();
  source.buffer = segment;
  source.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if ('contentHint' in track) track.contentHint = 'speech-recognition';
  let started = false;
  source.addEventListener('ended', () => { try { track.stop(); } catch {} }, { once: true });
  return {
    track,
    durationMs: Math.ceil(segment.duration * 1000),
    start() { if (!started) { started = true; source.start(0); } },
    cleanup() { try { if (started) source.stop(); } catch {} try { track.stop(); } catch {} context.close().catch(() => {}); }
  };
}
"""
assert old2 in s
s=s.replace(old2,new2)
# Make the replay explanation explicit when capture is the reason for disabling it.
s=s.replace("replay.disabled = !audioReady;\n    replay.addEventListener", "replay.disabled = !audioReady;\n    if (hasAudio && (isRecording() || captureFinalizing)) replay.title = 'Réécoute disponible après la prise en cours';\n    replay.addEventListener")
app.write_text(s)

aw=root/'offline-interview/audio-window.js'
a=aw.read_text()
if 'export function sliceAudioBuffer' not in a:
    a += """

export function sliceAudioBuffer(context, decoded, startMs, endMs){
  if(!context||!decoded)throw new Error('Buffer audio invalide.');
  const rate=Number(decoded.sampleRate)||0;if(!rate)throw new Error('Fréquence audio invalide.');
  const maxFrames=Number(decoded.length)||Math.round((Number(decoded.duration)||0)*rate);
  const startFrame=Math.max(0,Math.min(maxFrames,Math.floor((Math.max(0,Number(startMs)||0)/1000)*rate)));
  const requestedEnd=Math.max(Number(startMs)||0,Number(endMs)||0);
  const endFrame=Math.max(startFrame+1,Math.min(maxFrames,Math.ceil((requestedEnd/1000)*rate)));
  const length=Math.max(1,endFrame-startFrame);
  const segment=context.createBuffer(decoded.numberOfChannels,length,rate);
  for(let channel=0;channel<decoded.numberOfChannels;channel+=1){
    segment.copyToChannel(decoded.getChannelData(channel).subarray(startFrame,endFrame),0);
  }
  return segment;
}
"""
aw.write_text(a)

css=root/'offline-interview/styles.css'
c=css.read_text()
rule="""

/* V41.12: at intermediate widths the header already exposes question count, elapsed time and remaining estimate. */
@media (min-width:641px) and (max-width:979px){
  .mobile-only-metrics,.question-progress-mobile{display:none!important}
}
"""
if rule.strip() not in c:c+=rule
css.write_text(c)

idx=root/'offline-interview/index.html'
i=idx.read_text().replace('v=41.11','v=41.12')
idx.write_text(i)

sw=root/'offline-interview/sw.js'
w=sw.read_text().replace("offline-interview-v41.11","offline-interview-v41.12").replace('v=41.11','v=41.12')
sw.write_text(w)

# Focused human field gate.
q={
  'schema':'offline-interview.interview-spec.v1','id':'test-ux-v41-12-segment-isolation','version':'1.0',
  'title':'Test V41.12 — segments audio isolés','estimatedDurationMinutes':4,
  'context':'Qualification ciblée après le terrain V41.11.','objective':'Vérifier isolation des segments, replay, live-first et vue intermédiaire.','language':'fr-FR','tags':[],
  'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],
  'sections':[{'id':'S1','title':'V41.12','questions':[
    {'id':'Q1','label':'Préflight','text':'Ouvrez Diagnostic. La version doit être exactement 2026-09-08.interview-runtime-v41.12. Sinon arrêtez le test.','intent':'Cible exacte.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q2','label':'Segments isolés','text':'Alternez rapidement six fois entre les deux personnes. Terminez chaque phrase par un nombre différent. Retranscrivez ensuite trois prises : chacune doit rester limitée à sa phrase, avec au plus un très court début de la suivante.','intent':'Vérifier que la retranscription audio ne déborde plus sur plusieurs interventions.','estimatedMinutes':1,'required':True,'audience':['P1','P2'],'followUps':[]},
    {'id':'Q3','label':'Replay après texte','text':'Après une retranscription réussie, arrêtez toute prise en cours puis appuyez sur lecture, pause et reprise de cette même ligne. Vérifiez que le son reste disponible et s’arrête à la fin attendue.','intent':'Séparer disponibilité audio et statut de transcription.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q4','label':'Vue intermédiaire','text':'Redimensionnez la fenêtre jusqu’à faire disparaître le menu de gauche sans passer en vue téléphone. Vérifiez que les barres bleues et rappels redondants de progression ont disparu, tandis que le numéro de question, le chrono et le temps restant restent visibles.','intent':'Densité responsive sans perte d’information.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]}
  ]}]
}
(root/'offline-interview/test-interviews/interview-test-ux-v41-12.json').write_text(json.dumps(q,ensure_ascii=False,indent=2)+'\n')

# Pure contract test: recovery bound + exact sample slicing.
t=(root/'offline-interview/test-audio-segment-window.mjs')
t.write_text("""import assert from 'node:assert/strict';
import {turnAudioWindow,sliceAudioBuffer} from './audio-window.js';
const turn={audioRef:{recordingId:'r1',startMs:1000,endMs:2000}};
const recovery=turnAudioWindow(turn,'recovery',10000);
assert.equal(recovery.startMs,1000);assert.equal(recovery.endMs,2250);assert.equal(recovery.canonicalEndMs,2000);
const source=[Float32Array.from({length:1000},(_,i)=>i),Float32Array.from({length:1000},(_,i)=>-i)];
const decoded={sampleRate:1000,length:1000,duration:1,numberOfChannels:2,getChannelData:i=>source[i]};
const context={createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return{numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,copyToChannel(src,ch){data[ch].set(src)},getChannelData:ch=>data[ch]}}};
const segment=sliceAudioBuffer(context,decoded,100,350);
assert.equal(segment.length,250);assert.equal(segment.duration,.25);assert.equal(segment.getChannelData(0)[0],100);assert.equal(segment.getChannelData(0)[249],349);
console.log('PASS isolated recovery audio window');
""")

# Cold-start authoring-kit E2E generated from an unrelated context, including Unicode and both views.
e=(root/'offline-interview/test-authoring-kit-e2e.mjs')
e.write_text("""import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildDirectInterviewLink,resolveDirectInterviewLink} from './direct-interview-link.js';
globalThis.atob ??= value=>Buffer.from(value,'base64').toString('binary');
globalThis.btoa ??= value=>Buffer.from(value,'binary').toString('base64');
const kit=fs.readFileSync(new URL('./INTERVIEW_AUTHORING_KIT.md',import.meta.url),'utf8');
assert.match(kit,/kitVersion: \"1\.3\"/);assert.match(kit,/https:\/\/stefm78\.github\.io\/Experimental\//);assert.match(kit,/outputFormat: direct-link/);
const spec={schema:'offline-interview.interview-spec.v1',id:'mediatheque-autonomie',version:'1.0',title:'Borne autonome — médiathèque',context:'Évaluer une borne de prêt autonome sans inventer de faits.',objective:'Comprendre flux, irritants, accessibilité et critères de succès.',language:'fr-FR',tags:['médiathèque'],estimatedDurationMinutes:12,participants:[{id:'P1',name:'Interviewer',role:'interviewer'},{id:'P2',name:'Responsable médiathèque',role:'interviewee'}],sections:[{id:'S1',title:'Usage',questions:[{id:'Q1',label:'Flux actuel',text:'Comment se déroule aujourd’hui un prêt, étape par étape ?',intent:'Établir le flux réel.',required:true,estimatedMinutes:3,audience:['P2'],followUps:[]},{id:'Q2',label:'Irritants',text:'Quels moments demandent le plus d’aide ou de temps ?',intent:'Identifier les irritants sans les présupposer.',required:true,estimatedMinutes:3,audience:['P2'],followUps:[]},{id:'Q3',label:'Accessibilité',text:'Quelles contraintes d’accessibilité la borne devrait-elle respecter ?',intent:'Faire émerger les contraintes.',required:true,estimatedMinutes:3,audience:['P2'],followUps:[]},{id:'Q4',label:'Succès',text:'Comment sauriez-vous après trois mois que la borne est utile ?',intent:'Définir les critères de succès.',required:true,estimatedMinutes:3,audience:['P2'],followUps:[]}]}]};
for(const view of ['setup','interview']){const href=buildDirectInterviewLink('https://stefm78.github.io/Experimental/',spec,{view});const parsed=await resolveDirectInterviewLink(new URL(href));assert.deepEqual(parsed.raw,spec);assert.equal(parsed.view,view);assert.equal(parsed.raw.participants[1].name,'Responsable médiathèque');assert.equal(parsed.raw.tags[0],'médiathèque');}
const huge={...spec,context:'é'.repeat(60000)};assert.throws(()=>buildDirectInterviewLink('https://stefm78.github.io/Experimental/',huge),/volumineuse/);
const remoteUrl='https://example.test/interview.json';const remote=new URL('https://stefm78.github.io/Experimental/#oi=1&view=setup&url='+encodeURIComponent(remoteUrl));const parsedRemote=await resolveDirectInterviewLink(remote,async()=>({ok:true,status:200,json:async()=>spec}));assert.deepEqual(parsedRemote.raw,spec);assert.equal(parsedRemote.source,'remote');
console.log('PASS authoring kit cold-start direct-link E2E');
""")

# Update runtime contract only for intentional versioned invariants, never budgets.
rt=root/'offline-interview/test-runtime-contract.mjs'
r=rt.read_text()
r=r.replace("contract: 'offline-interview.runtime-contract.v41.11'","contract: 'offline-interview.runtime-contract.v41.12'")
r=r.replace("assert.match(app, /turnAudioWindow\\(turn, 'recovery'\\)/);", "assert.match(app, /turnAudioWindow\\(turn, 'recovery'\\)/);\nassert.match(app, /sliceAudioBuffer\\(context, decoded, ref\\.startMs, ref\\.endMs\\)/);\nassert.match(app, /source\\.addEventListener\\('ended',[\\s\\S]*track\\.stop/);\nassert.match(app, /armReplayStop\\(end\\)/);\nassert.match(css, /min-width:641px[\\s\\S]*max-width:979px[\\s\\S]*mobile-only-metrics/);")
rt.write_text(r)
