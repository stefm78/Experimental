import { SAMPLE_RATE, blobTo16kMono, buildTransforms, scoreTranscript } from './stt-lab-audio.js?v=4';
import { ENGINES, experimentsForPack, availability, decodeOptions, loadEngine, modelIdFor, TRANSFORMERS_VERSION } from './stt-lab-engines.js?v=4';
import { FIXTURES, buildFixture } from './stt-lab-fixtures.js?v=1';

const BUILD_ID = '2026-08-31.stt-deep-matrix-v4';
const $ = id => document.getElementById(id);

const ui = {
  referenceText: $('referenceText'), recordState: $('recordState'), timer: $('timer'),
  recordBtn: $('recordBtn'), stopBtn: $('stopBtn'), audioMeta: $('audioMeta'), audioError: $('audioError'),
  fixtureShortBtn: $('fixtureShortBtn'), fixtureLongBtn: $('fixtureLongBtn'), fixtureNoiseBtn: $('fixtureNoiseBtn'), fixtureStatus: $('fixtureStatus'),
  webgpuStatus: $('webgpuStatus'), fp16Status: $('fp16Status'), testCount: $('testCount'),
  runError: $('runError'), runBtn: $('runBtn'), cancelBtn: $('cancelBtn'),
  progressCard: $('progressCard'), progressTitle: $('progressTitle'), progressBadge: $('progressBadge'),
  matrixProgress: $('matrixProgress'), progressDetail: $('progressDetail'),
  resultsCard: $('resultsCard'), resultsBody: $('resultsBody'), transcriptResults: $('transcriptResults'),
  runStatus: $('runStatus'), paretoBox: $('paretoBox'), paretoText: $('paretoText'),
  copyBtn: $('copyBtn'), rerunBtn: $('rerunBtn'), copyStatus: $('copyStatus'), reportOutput: $('reportOutput'),
  buildInfo: $('buildInfo'), platformInfo: $('platformInfo'), sourceInfo: $('sourceInfo'),
  browserInfo: $('browserInfo'), memoryInfo: $('memoryInfo'),
  networkInfo: $('networkInfo'), swInfo: $('swInfo'), storageInfo: $('storageInfo')
};

let recorder, stream, startedAt, timerHandle;
let chunks = [];
let sourceSamples = null;
let transforms = null;
let sourceDuration = 0;
let cancelRequested = false;
let latestReport = null;
let sourceMeta = { mode: 'none' };
let webgpuInfo = { available: false, shaderF16: false, adapterName: null };

function show(el, yes = true) { el.classList.toggle('hidden', !yes); }
function error(el, text = '') { el.textContent = text; show(el, Boolean(text)); }
function time(s) { return `${Math.floor(s / 60).toString().padStart(2,'0')}:${Math.floor(s % 60).toString().padStart(2,'0')}`; }
function bytes(n) {
  if (n == null) return '—';
  const u = ['o','Ko','Mo','Go']; let v = Math.abs(n), i = 0;
  while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return `${n < 0 ? '-' : ''}${v.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}
function mime() {
  return ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x => MediaRecorder.isTypeSupported?.(x)) || '';
}
function pack() { return document.querySelector('input[name="pack"]:checked')?.value || 'deep'; }

function detectPlatformClass() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone-ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return 'windows';
  if (/Mac/i.test(platform)) return 'macos';
  return 'other';
}

function setFixtureButtonsDisabled(disabled) {
  for (const button of [ui.fixtureShortBtn, ui.fixtureLongBtn, ui.fixtureNoiseBtn]) {
    if (button) button.disabled = disabled;
  }
}

function useSource(samples, referenceText, meta) {
  sourceSamples = samples;
  sourceDuration = sourceSamples.length / SAMPLE_RATE;
  transforms = buildTransforms(sourceSamples);
  sourceMeta = meta;
  ui.referenceText.textContent = referenceText;
  ui.recordState.textContent = meta.mode === 'fixture' ? 'Fixture canonique prêt' : 'Audio micro prêt';
  ui.timer.textContent = time(sourceDuration);
  ui.audioMeta.textContent = `${sourceDuration.toFixed(2)} s · VAD conserve ${(transforms.vad.meta.vadStats.keptRatio*100).toFixed(1)} % · variantes WSOLA prêtes`;
  ui.sourceInfo.textContent = meta.mode === 'fixture'
    ? `${meta.fixtureId} · sha256:${meta.sha256.slice(0,12)}…`
    : 'micro réel';
  refreshCount();
}

async function prepareFixture(key) {
  error(ui.audioError);
  latestReport = null;
  sourceSamples = null;
  transforms = null;
  ui.runBtn.disabled = true;
  setFixtureButtonsDisabled(true);
  ui.recordBtn.disabled = true;
  try {
    const fixture = await buildFixture(key, stage => {
      ui.fixtureStatus.textContent = stage;
    });
    useSource(fixture.samples, fixture.referenceText, {
      mode: 'fixture',
      fixtureKey: key,
      fixtureId: fixture.id,
      sha256: fixture.sha256,
      generator: fixture.generator,
      description: fixture.description
    });
    ui.fixtureStatus.textContent = `${fixture.label} · ${fixture.durationSeconds.toFixed(2)} s · SHA-256 ${fixture.sha256}`;
  } catch (e) {
    sourceMeta = { mode: 'none' };
    ui.fixtureStatus.textContent = 'Échec du fixture.';
    error(ui.audioError, `Fixture impossible : ${e.message || e}`);
  } finally {
    setFixtureButtonsDisabled(false);
    ui.recordBtn.disabled = false;
  }
}


async function storage() {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage ?? null, quota: e?.quota ?? null, caches: e?.usageDetails?.caches ?? null };
  } catch { return { usage: null, quota: null, caches: null }; }
}

async function detectWebGpu() {
  if (!navigator.gpu) {
    webgpuInfo = { available:false, shaderF16:false, adapterName:null };
  } else {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      webgpuInfo = {
        available: Boolean(adapter),
        shaderF16: Boolean(adapter?.features?.has('shader-f16')),
        adapterName: adapter?.info?.description || adapter?.info?.vendor || null
      };
    } catch {}
  }
  ui.webgpuStatus.textContent = webgpuInfo.available ? 'Disponible' : 'Indisponible';
  ui.fp16Status.textContent = webgpuInfo.shaderF16 ? 'Disponible' : 'Indisponible';
  refreshCount();
}

function refreshCount() {
  const list = experimentsForPack(pack());
  const ok = list.filter(x => availability(x, webgpuInfo).ok).length;
  ui.testCount.textContent = ok === list.length ? String(ok) : `${ok} + ${list.length-ok} ignoré(s)`;
  ui.runBtn.disabled = !sourceSamples || ok === 0;
}

async function startRecording() {
  error(ui.audioError);
  sourceSamples = null; transforms = null; latestReport = null; sourceMeta = { mode: 'micro' }; ui.runBtn.disabled = true;
  ui.referenceText.textContent = FIXTURES.shortClean.referenceText;
  ui.fixtureStatus.textContent = 'Mode micro réel.';
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});
    const m = mime();
    recorder = m ? new MediaRecorder(stream,{mimeType:m}) : new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.start(500);
    startedAt = performance.now();
    ui.recordState.textContent = 'Enregistrement en cours…';
    show(ui.recordBtn,false); show(ui.stopBtn,true);
    timerHandle = setInterval(() => ui.timer.textContent = time((performance.now()-startedAt)/1000),250);
  } catch(e) { error(ui.audioError,`Microphone indisponible : ${e.message || e}`); }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  clearInterval(timerHandle); recorder.stop(); stream?.getTracks().forEach(t => t.stop());
  show(ui.stopBtn,false); show(ui.recordBtn,true); ui.recordState.textContent = 'Préparation du signal…';
}

async function finishRecording() {
  try {
    const blob = new Blob(chunks,{type:recorder.mimeType || 'audio/webm'});
    sourceSamples = await blobTo16kMono(blob);
    sourceDuration = sourceSamples.length / SAMPLE_RATE;
    if (sourceDuration < 8) throw new Error('Enregistrement trop court.');
    useSource(sourceSamples, FIXTURES.shortClean.referenceText, {
      mode: 'micro',
      capturedAt: new Date().toISOString()
    });
  } catch(e) {
    sourceSamples = null; transforms = null; error(ui.audioError,`Préparation impossible : ${e.message || e}`);
  }
}

function rowFor(item) {
  let row = document.getElementById(`row-${item.id}`);
  if (row) return row;
  row = document.createElement('tr');
  row.id = `row-${item.id}`;
  row.innerHTML = `<td><strong>${item.label}</strong></td><td data-k="wer">—</td><td data-k="cer">—</td><td data-k="time">—</td><td data-k="rtf">—</td><td data-k="words">—</td><td data-k="status">En attente</td>`;
  ui.resultsBody.appendChild(row); return row;
}

function updateRow(item,r) {
  const row = rowFor(item);
  row.querySelector('[data-k="wer"]').textContent = r.wer == null ? '—' : `${(r.wer*100).toFixed(1)} %`;
  row.querySelector('[data-k="cer"]').textContent = r.cer == null ? '—' : `${(r.cer*100).toFixed(1)} %`;
  row.querySelector('[data-k="time"]').textContent = r.inferenceMs == null ? '—' : `${(r.inferenceMs/1000).toFixed(1)} s`;
  row.querySelector('[data-k="rtf"]').textContent = r.rtf == null ? '—' : `${r.rtf.toFixed(2)}×`;
  row.querySelector('[data-k="words"]').textContent = r.hypothesisWords == null ? '—' : String(r.hypothesisWords);
  row.querySelector('[data-k="status"]').textContent = r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL';
}

function addCard(item,r) {
  const card = document.createElement('article');
  card.className = 'benchmark-result';
  const status = r.ok ? 'Terminé' : r.skipped ? 'Ignoré' : 'Échec';
  card.innerHTML = `
    <div class="benchmark-result-head"><div><strong>${item.label}</strong><small>${r.engineLabel || ''} · ${r.transformLabel || ''} · ${r.decode || ''}</small></div><span class="badge">${status}</span></div>
    <div class="benchmark-metrics">
      <div><span>WER</span><strong>${r.wer == null ? '—' : (r.wer*100).toFixed(1)+' %'}</strong></div>
      <div><span>CER</span><strong>${r.cer == null ? '—' : (r.cer*100).toFixed(1)+' %'}</strong></div>
      <div><span>Inférence</span><strong>${r.inferenceMs == null ? '—' : (r.inferenceMs/1000).toFixed(1)+' s'}</strong></div>
      <div><span>RTF</span><strong>${r.rtf == null ? '—' : r.rtf.toFixed(2)+'×'}</strong></div>
      <div><span>Ratio mots</span><strong>${r.wordRatio == null ? '—' : r.wordRatio.toFixed(2)+'×'}</strong></div>
    </div>
    <p class="hint">${r.error || r.skipReason || ''}</p>
    <label>Transcription</label><textarea rows="5" readonly spellcheck="false"></textarea>`;
  card.querySelector('textarea').value = r.transcript || '';
  ui.transcriptResults.appendChild(card);
}

function frontier(results) {
  const ok = results.filter(r => r.ok && r.wer != null && r.inferenceMs != null);
  return ok.filter(a => !ok.some(b => b.id !== a.id && b.wer <= a.wer && b.inferenceMs <= a.inferenceMs && (b.wer < a.wer || b.inferenceMs < a.inferenceMs)));
}

async function runMatrix() {
  if (!sourceSamples || !transforms) return;
  cancelRequested = false; latestReport = null; error(ui.runError);
  const items = experimentsForPack(pack());
  items.forEach(rowFor);
  ui.transcriptResults.innerHTML = '';
  show(ui.resultsCard,true); show(ui.progressCard,true); show(ui.cancelBtn,true); show(ui.paretoBox,false);
  ui.runBtn.disabled = true; ui.recordBtn.disabled = true; ui.runStatus.textContent = 'En cours';
  const runnableTotal = items.filter(x => availability(x,webgpuInfo).ok).length;
  ui.matrixProgress.max = Math.max(1,runnableTotal); ui.matrixProgress.value = 0;
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.engineKey)) groups.set(item.engineKey,[]);
    groups.get(item.engineKey).push(item);
  }

  const results = []; let done = 0;
  for (const [engineKey, group] of groups) {
    if (cancelRequested) break;
    const spec = ENGINES[engineKey], avail = availability(group[0],webgpuInfo);

    if (!avail.ok) {
      for (const item of group) {
        const r = {id:item.id,label:item.label,ok:false,skipped:true,skipReason:avail.reason,engineLabel:spec.label,transformLabel:transforms[item.transformKey]?.label,decode:item.decode};
        results.push(r); updateRow(item,r); addCard(item,r);
      }
      continue;
    }

    let pipe = null; const before = await storage(); let loadMs = null;
    try {
      ui.progressTitle.textContent = `Chargement · ${spec.label}`; ui.progressDetail.textContent = 'Téléchargement ou cache local…';
      const t0 = performance.now(); let bucket = -1;
      pipe = await loadEngine(spec,x => {
        if (x.status === 'progress' && typeof x.progress === 'number') {
          const b = Math.floor(x.progress/10)*10;
          if (b !== bucket) { bucket = b; ui.progressDetail.textContent = `${x.file ? x.file.split('/').pop() : 'ressource'} · ${b} %`; }
        }
      });
      loadMs = performance.now()-t0;

      for (const item of group) {
        if (cancelRequested) break;
        const tr = transforms[item.transformKey], signal = tr.samples, seconds = signal.length/SAMPLE_RATE;
        ui.progressTitle.textContent = item.label; ui.progressDetail.textContent = `${seconds.toFixed(2)} s · ${spec.label}`;
        ui.progressBadge.textContent = `${done} / ${runnableTotal}`;

        const r = {
          id:item.id,label:item.label,ok:false,skipped:false,engineKey,engineLabel:spec.label,
          modelId:modelIdFor(spec),dtype:spec.dtype,device:spec.device,
          graphOptimizationLevel:spec.graphOptimizationLevel,
          transformKey:item.transformKey,transformLabel:tr.label,transformMeta:tr.meta,decode:item.decode,
          signalSeconds:seconds,loadMs,inferenceMs:null,rtf:null,transcript:'',wer:null,cer:null,error:null
        };
        try {
          const t = performance.now();
          const out = await pipe(signal,decodeOptions(item.decode,seconds));
          r.inferenceMs = performance.now()-t; r.rtf = (r.inferenceMs/1000)/seconds;
          r.transcript = String(out?.text || '').trim(); Object.assign(r,scoreTranscript(ui.referenceText.textContent,r.transcript)); r.ok = true;
        } catch(e) { r.error = `${e.name || 'Error'}: ${e.message || e}`; }
        results.push(r); updateRow(item,r); addCard(item,r); done++; ui.matrixProgress.value = done; ui.progressBadge.textContent = `${done} / ${runnableTotal}`;
      }
    } catch(e) {
      for (const item of group) {
        if (results.some(r => r.id === item.id)) continue;
        const r = {id:item.id,label:item.label,ok:false,skipped:false,engineKey,engineLabel:spec.label,modelId:modelIdFor(spec),device:spec.device,dtype:spec.dtype,graphOptimizationLevel:spec.graphOptimizationLevel,transformLabel:transforms[item.transformKey]?.label,decode:item.decode,error:`Engine load failed: ${e.name || 'Error'}: ${e.message || e}`};
        results.push(r); updateRow(item,r); addCard(item,r); done++; ui.matrixProgress.value = done;
      }
    } finally {
      if (pipe) { try { await pipe.dispose(); } catch {} }
      await new Promise(resolve => setTimeout(resolve,500));
      const after = await storage();
      if (before.usage != null && after.usage != null) results.filter(r => r.engineKey === engineKey).forEach(r => r.engineCacheDeltaBytes = after.usage-before.usage);
    }
  }

  const pf = frontier(results);
  if (pf.length) {
    ui.paretoText.textContent = pf.sort((a,b)=>a.wer-b.wer).map(r => `${r.label} (WER ${(r.wer*100).toFixed(1)} %, ${(r.inferenceMs/1000).toFixed(1)} s)`).join(' · ');
    show(ui.paretoBox,true);
  }
  latestReport = {
    schema:'offline-interview.stt-deep-benchmark.v1',build:BUILD_ID,generatedAt:new Date().toISOString(),pack:pack(),
    privacy:'No audio included. Reference text and transcripts are included.',
    environment:{deviceClass:detectPlatformClass(),userAgent:navigator.userAgent,platform:navigator.userAgentData?.platform || navigator.platform,mobile:navigator.userAgentData?.mobile ?? null,hardwareConcurrency:navigator.hardwareConcurrency ?? null,deviceMemoryGB:navigator.deviceMemory ?? null,online:navigator.onLine,crossOriginIsolated:window.crossOriginIsolated,transformersVersion:TRANSFORMERS_VERSION,webgpu:webgpuInfo},
    source:sourceMeta,
    audio:{sourceDurationSeconds:sourceDuration,sampleRate:SAMPLE_RATE,vad:transforms.vad.meta.vadStats,variants:Object.fromEntries(Object.entries(transforms).map(([k,v])=>[k,{label:v.label,durationSeconds:v.samples.length/SAMPLE_RATE,meta:v.meta}]))},
    referenceText:ui.referenceText.textContent.trim(),results,pareto:pf.map(r=>r.id),finalStorage:await storage()
  };
  ui.runStatus.textContent = cancelRequested ? 'Arrêté' : 'Terminé';
  ui.progressTitle.textContent = cancelRequested ? 'Arrêté' : 'Matrice terminée';
  ui.progressDetail.textContent = `${results.filter(r=>r.ok).length} PASS · ${results.filter(r=>r.skipped).length} SKIP · ${results.filter(r=>!r.ok&&!r.skipped).length} FAIL`;
  show(ui.cancelBtn,false); ui.recordBtn.disabled = false; refreshCount();
}

async function copyReport() {
  if (!latestReport) return;
  const text = `OFFLINE_STT_DEEP_BENCHMARK\n${JSON.stringify(latestReport,null,2)}`;
  ui.reportOutput.value = text; show(ui.reportOutput,true);
  try { await navigator.clipboard.writeText(text); ui.copyStatus.textContent = 'Rapport copié. Collez-le tel quel dans ChatGPT.'; }
  catch { ui.reportOutput.focus(); ui.reportOutput.select(); ui.copyStatus.textContent = document.execCommand?.('copy') ? 'Rapport copié.' : 'Copiez le rapport manuellement.'; }
}

async function registerSw() {
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=8',{scope:'./'}); try { await reg.update(); } catch {}
    await navigator.serviceWorker.ready; ui.swInfo.textContent = navigator.serviceWorker.controller?.scriptURL?.includes('v=8') ? 'actif · v8' : 'actif';
  } catch(e) { ui.swInfo.textContent = `erreur · ${e.message || e}`; }
}

async function tech() {
  ui.buildInfo.textContent = BUILD_ID;
  ui.platformInfo.textContent = detectPlatformClass();
  ui.sourceInfo.textContent = sourceMeta.mode === 'none' ? 'aucune' : sourceMeta.mode;
  ui.browserInfo.textContent = navigator.userAgentData?.brands?.map(x=>`${x.brand} ${x.version}`).join(' · ') || navigator.userAgent;
  ui.memoryInfo.textContent = `${navigator.deviceMemory || '?'} Go · ${navigator.hardwareConcurrency || '?'} threads`;
  ui.networkInfo.textContent = navigator.onLine ? 'en ligne' : 'hors connexion';
  const s = await storage(); ui.storageInfo.textContent = s.usage == null ? 'indisponible' : `${bytes(s.usage)} / ${bytes(s.quota)}`;
}

ui.fixtureShortBtn.addEventListener('click',()=>prepareFixture('shortClean'));
ui.fixtureLongBtn.addEventListener('click',()=>prepareFixture('longSilence'));
ui.fixtureNoiseBtn.addEventListener('click',()=>prepareFixture('shortNoisy'));
ui.recordBtn.addEventListener('click',startRecording);
ui.stopBtn.addEventListener('click',stopRecording);
ui.runBtn.addEventListener('click',runMatrix);
ui.rerunBtn.addEventListener('click',runMatrix);
ui.copyBtn.addEventListener('click',copyReport);
ui.cancelBtn.addEventListener('click',()=>{cancelRequested=true;ui.cancelBtn.disabled=true;ui.progressDetail.textContent='Arrêt demandé après l’essai en cours.';});
document.querySelectorAll('input[name="pack"]').forEach(r=>r.addEventListener('change',refreshCount));
window.addEventListener('online',tech); window.addEventListener('offline',tech);

tech(); registerSw(); detectWebGpu(); refreshCount();
