from pathlib import Path
import json, re

APP=Path('offline-interview/app.js')
CSS=Path('offline-interview/styles.css')
INDEX=Path('offline-interview/index.html')
SW=Path('offline-interview/sw.js')
CONTRACT=Path('offline-interview/test-runtime-contract.mjs')

s=APP.read_text()
s=s.replace("const BUILD_ID = '2026-09-07.interview-runtime-v41.8';", "const BUILD_ID = '2026-09-07.interview-runtime-v41.9';", 1)
s=s.replace("const SPEC_KEY = 'last-interview-spec';\n", "const SPEC_KEY = 'last-interview-spec';\nconst AUDIO_CONTEXT_BEFORE_MS = 250;\nconst AUDIO_CONTEXT_AFTER_MS = 250;\n", 1)

anchor="function safeFilePart(value) { return String(value || 'interview').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'interview'; }\n"
extra="""
function turnAudioWindow(turn, mode = 'canonical', recordingDurationMs = null) {
  const ref = turn?.audioRef;
  if (!ref?.recordingId) return null;
  const canonicalStartMs = Math.max(0, Number(ref.startMs) || 0);
  const canonicalEndMs = Math.max(canonicalStartMs, Number(ref.endMs) || canonicalStartMs);
  if (mode !== 'context') return { recordingId: ref.recordingId, startMs: canonicalStartMs, endMs: canonicalEndMs, canonicalStartMs, canonicalEndMs, mode: 'canonical' };
  const beforeMs = Math.max(0, Number(ref.contextBeforeMs ?? AUDIO_CONTEXT_BEFORE_MS) || 0);
  const afterMs = Math.max(0, Number(ref.contextAfterMs ?? AUDIO_CONTEXT_AFTER_MS) || 0);
  const boundedDuration = Number.isFinite(Number(recordingDurationMs)) ? Math.max(0, Number(recordingDurationMs)) : null;
  const startMs = Math.max(0, canonicalStartMs - beforeMs);
  const endMs = boundedDuration == null ? canonicalEndMs + afterMs : Math.min(boundedDuration, canonicalEndMs + afterMs);
  return { recordingId: ref.recordingId, startMs, endMs: Math.max(startMs, endMs), canonicalStartMs, canonicalEndMs, beforeMs, afterMs, mode: 'context' };
}
"""
if anchor not in s: raise SystemExit('safeFilePart anchor missing')
s=s.replace(anchor, anchor+extra,1)

# Keep canonical windows for ordinary replay and system retranscription; context window is a derived recovery primitive only.
s=s.replace("  const ref = turn?.audioRef;\n  if (!ref?.recordingId) return;\n", "  const ref = turnAudioWindow(turn, 'canonical');\n  if (!ref?.recordingId) return;\n", 1)
s=s.replace("  const ref = turn?.audioRef;\n  if (!ref?.recordingId) throw new Error('Audio local absent pour cette prise.');\n", "  const ref = turnAudioWindow(turn, 'canonical');\n  if (!ref?.recordingId) throw new Error('Audio local absent pour cette prise.');\n", 1)

# Micro state becomes a calm status signal integrated in the compact control.
old="""  if (ui.micMeterFill) ui.micMeterFill.style.setProperty('--level', visual.toFixed(3));
  if (ui.micMeterState) { ui.micMeterState.textContent = state; ui.micMeterState.dataset.levelState = key; }
"""
new="""  if (ui.micMeterFill) ui.micMeterFill.style.setProperty('--level', visual.toFixed(3));
  if (ui.micMeterState) { ui.micMeterState.textContent = state === 'Bon niveau' ? 'Bon' : state; ui.micMeterState.dataset.levelState = key; }
  if (ui.micPreviewBtn) {
    ui.micPreviewBtn.dataset.levelState = key;
    ui.micPreviewBtn.title = `Niveau micro : ${state}`;
    ui.micPreviewBtn.setAttribute('aria-label', `Microphone — ${state}`);
  }
"""
if old not in s: raise SystemExit('mic state block missing')
s=s.replace(old,new,1)
s=s.replace("ui.micPreviewBtn.textContent = isRecording() ? 'Micro actif' : 'Couper le test micro';", "ui.micPreviewBtn.textContent = isRecording() ? 'Micro' : 'Micro';",1)
s=s.replace("ui.micPreviewBtn.textContent = 'Tester le micro';", "ui.micPreviewBtn.textContent = 'Micro';",1)

# Compact audio-to-text icon: concept is transcription, not implementation provider.
s=s.replace("    button.textContent = '⏳ Système…';", "    button.innerHTML = '<span class=\"audio-to-text-icon is-busy\" aria-hidden=\"true\">···</span>';",1)
old="""    retranscribe.type = 'button';
    retranscribe.className = 'ghost small turn-retranscribe-button';
    retranscribe.textContent = '↻ Système';
    const trackSupported = supportsSystemAudioTrackRecognition();
    const stableRetranscription = turn.systemRetranscription?.status;
    retranscribe.textContent = stableRetranscription === 'succeeded' ? '✓ Système' : stableRetranscription === 'failed' ? '× Système' : '↻ Système';
"""
new="""    retranscribe.type = 'button';
    retranscribe.className = 'ghost small turn-retranscribe-button';
    const trackSupported = supportsSystemAudioTrackRecognition();
    const stableRetranscription = turn.systemRetranscription?.status;
    const transcriptionGlyph = stableRetranscription === 'succeeded' ? '✓' : stableRetranscription === 'failed' ? '×' : '<svg class=\"audio-to-text-svg\" viewBox=\"0 0 28 18\" aria-hidden=\"true\"><path d=\"M2 9h2m2-4v8m3-11v14m3-9v4m4-5h10M16 10h10M16 14h7\"/></svg>';
    retranscribe.innerHTML = `<span class=\"audio-to-text-icon\" aria-hidden=\"true\">${transcriptionGlyph}</span>`;
"""
if old not in s: raise SystemExit('retranscribe visual block missing')
s=s.replace(old,new,1)
# Provider-neutral titles.
s=s.replace("'Retranscription système stabilisée pour cet audio'", "'Transcription de cet audio terminée'",1)
s=s.replace("'Tentative système terminée sans texte : correction manuelle disponible'", "'Transcription terminée sans texte : correction manuelle disponible'",1)
s=s.replace("'Transcrire une seule fois cet audio avec le système'", "'Transcrire cet audio en texte'",1)
s=s.replace("'Retranscription système depuis un audio enregistré non prise en charge sur ce navigateur mobile ou ancien'", "'Transcription depuis un audio enregistré non prise en charge sur ce navigateur'",1)

# Audio-only turns are meaningful but visually compact; empty artifacts without text/audio are not rendered.
needle="""  for (const turn of turns) {
    const card = document.createElement('article');
    card.className = `turn-card ${turn.type === 'follow_up' ? 'follow-up-turn' : ''}`;
"""
repl="""  for (const turn of turns) {
    const hasText = Boolean(cleanText(turn.text));
    const hasAudio = Boolean(turn.audioRef?.recordingId);
    if (turn.type === 'answer' && !hasText && !hasAudio) continue;
    const card = document.createElement('article');
    card.className = `turn-card ${turn.type === 'follow_up' ? 'follow-up-turn' : ''}${turn.type === 'answer' && !hasText && hasAudio ? ' audio-only-turn' : ''}`;
"""
if needle not in s: raise SystemExit('renderTurns loop anchor missing')
s=s.replace(needle,repl,1)
old="""    card.append(head, text);
    ui.turnsList.append(card);
    requestAnimationFrame(resizeTurnText);
"""
new="""    if (turn.type === 'answer' && !hasText && hasAudio) {
      card.append(head);
    } else {
      card.append(head, text);
      requestAnimationFrame(resizeTurnText);
    }
    ui.turnsList.append(card);
"""
if old not in s: raise SystemExit('renderTurns append block missing')
s=s.replace(old,new,1)

APP.write_text(s)

# Versioned assets.
INDEX.write_text(INDEX.read_text().replace('41.8','41.9'))
SW.write_text(SW.read_text().replace('41.8','41.9'))

# Refine CSS by removing the superseded microphone component rules and replacing them once.
css=CSS.read_text()
for selector in ['.mic-meter-row','.mic-meter','.mic-meter-fill','.mic-meter-recommended','.mic-meter-state','.turn-retranscribe-button','.audio-only-turn']:
    css=re.sub(re.escape(selector)+r'\{[^{}]*\}', '', css)
css=css.replace('.turns-list{gap:6px}', '.turns-list{gap:4px}')
css=css.replace('.turn-card{padding:10px 12px;', '.turn-card{padding:8px 10px;')
css=css.replace('.capture-dock{padding:14px 16px 13px;', '.capture-dock{padding:11px 13px 10px;')
css=css.replace('min-height:48px}', 'min-height:44px}')
css=css.replace('animation:micPulse 1.25s ease-in-out infinite;', 'animation:none;')
css=css.replace('animation:micPulse 1.1s ease-in-out infinite;', 'animation:none;')
css += """

/* V41.9 refined capture controls — single canonical component definitions. */
.mic-meter-row{display:flex;align-items:center;gap:7px;min-height:30px}
.mic-preview-button{position:relative;padding:6px 9px 6px 22px!important;min-height:30px;border-radius:999px!important;font-size:.76rem!important;color:#52627a!important;background:#f8fafc!important}
.mic-preview-button::before{content:\"\";position:absolute;left:9px;width:7px;height:7px;border-radius:50%;background:#94a3b8;transition:background .18s ease}
.mic-preview-button[data-level-state=good]::before{background:#4f8f67}.mic-preview-button[data-level-state=low]::before,.mic-preview-button[data-level-state=silence]::before{background:#a7b0bd}.mic-preview-button[data-level-state=hot]::before{background:#b94747}
.mic-meter{position:relative;width:42px;height:4px;border-radius:999px;background:#e5eaf0;overflow:hidden;flex:none}
.mic-meter-fill{position:absolute;inset:0 auto 0 0;width:calc(var(--level,0)*100%);background:#70849a;transition:width .18s ease-out}
.mic-meter-recommended{position:absolute;left:68%;top:0;bottom:0;width:1px;background:#334155;opacity:.35;z-index:2}
.mic-meter-state{min-width:34px;font-size:.68rem;font-weight:650;color:#7a8699;line-height:1;text-align:left}
.mic-meter-state[data-level-state=good]{color:#4f6f59}.mic-meter-state[data-level-state=hot]{color:#9f3f3f}
.turn-retranscribe-button{display:inline-grid;place-items:center;width:30px;height:30px;min-width:30px;padding:0!important;border-radius:9px!important}
.audio-to-text-icon{display:grid;place-items:center;width:18px;height:18px;font-size:.78rem;font-weight:900;line-height:1}.audio-to-text-icon.is-busy{letter-spacing:1px}.audio-to-text-svg{width:19px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.audio-only-turn{padding-block:6px;background:#fbfcfd}.audio-only-turn .turn-head{margin-bottom:0}
@media(max-width:560px){.mic-meter-row{gap:6px}.mic-meter{width:34px}.mic-meter-state{min-width:30px}.turn-retranscribe-button{width:34px;height:34px}}
"""
CSS.write_text(css)

# Runtime contract: preserve old invariants and add discriminant V41.9 assertions.
t=CONTRACT.read_text().replace('41\\.8','41\\.9').replace('41.8','41.9')
anchor="assert.match(app, /boundary_audio_ready/);\n"
extra="""
// V41.9 hybrid audio: master remains authoritative; context is a derived window only.
assert.match(app, /const AUDIO_CONTEXT_BEFORE_MS = 250/);
assert.match(app, /const AUDIO_CONTEXT_AFTER_MS = 250/);
assert.match(app, /function turnAudioWindow\\(turn, mode = 'canonical'/);
assert.match(app, /canonicalStartMs/);
assert.match(app, /mode !== 'context'/);
assert.doesNotMatch(app, /recorder\\.stop\\(\\).*selectSpeaker/);
// Live-first remains intact: no automatic saved-audio recovery is reintroduced.
assert.doesNotMatch(app, /recoverBoundaryTurnsWithSystem/);
assert.doesNotMatch(app, /await retranscribeTurnWithSystem\\(turn, null, 'boundary-recovery'\\)/);
// UX: audio-only turns are retained but compact; transcription action is provider-neutral.
assert.match(app, /audio-only-turn/);
assert.match(app, /Transcrire cet audio en texte/);
assert.doesNotMatch(app, /↻ Système/);
assert.doesNotMatch(app, /✓ Système/);
assert.doesNotMatch(app, /× Système/);
assert.match(css, /mic-preview-button\[data-level-state=good\]/);
assert.match(css, /audio-to-text-svg/);
"""
if anchor not in t: raise SystemExit('contract V41.8 anchor missing')
t=t.replace(anchor,anchor+extra,1)
CONTRACT.write_text(t)

# Focused human field questionnaire.
q={
  'schema':'offline-interview.interview-spec.v1','version':'1.0','id':'test-ux-v41-9-hybrid-refined','title':'Test V41.9 — audio hybride et interface affinée',
  'context':'Qualification humaine exact-head avant toute promotion.','objective':'Vérifier que live-first reste fluide, que les prises audio sans texte restent utiles, et que les nouveaux contrôles sont plus discrets et compréhensibles.','language':'fr-FR','estimatedDurationMinutes':6,
  'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],
  'sections':[{'id':'S1','title':'Qualification V41.9','questions':[
    {'id':'Q1','label':'Préflight exact-head','text':'Ouvrez Diagnostic et vérifiez exactement 2026-09-07.interview-runtime-v41.9. Si une autre version apparaît, arrêtez immédiatement et répondez INVALID_TEST_TARGET.','intent':'Empêcher un test sur la mauvaise version.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q2','label':'Live-first et changements de personne','text':'Dans une seule captation, changez de personne plusieurs fois. Vérifiez que le texte déjà reconnu apparaît rapidement dans la conversation, sans retraitement audio automatique ni attente perceptible. Réécoutez deux prises et confirmez qu’il n’y a pas de trou évident au changement.','intent':'Préserver le chemin live-first et le master continu.','estimatedMinutes':2,'required':True,'audience':['P1','P2'],'followUps':[]},
    {'id':'Q3','label':'Prise audio sans texte','text':'Provoquez si possible une prise très courte ou silencieuse. Si aucun texte n’est obtenu mais que du son existe, vérifiez que la ligne reste compacte avec lecture et action de transcription, sans grande zone de texte vide. Si vous obtenez du texte partout, dites-le simplement.','intent':'Absence de texte ne doit pas supprimer un audio réel ni créer une ligne visuellement vide.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q4','label':'Micro discret et lisible','text':'Observez le contrôle du micro pendant quelques secondes en parlant doucement, normalement puis fort. Dites s’il indique encore clairement faible, bon ou trop fort tout en restant discret et peu agité.','intent':'Qualifier la nouvelle représentation du niveau sonore.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q5','label':'Audio vers texte et densité','text':'Regardez les prises de parole. L’action qui transforme un audio en texte doit être compréhensible sans afficher le mot Système. Dites aussi si la conversation paraît plus dense, plus calme et toujours facile à utiliser.','intent':'Qualifier l’icône audio-vers-texte et la densité générale.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]}
  ]}]
}
Path('offline-interview/test-interviews/interview-test-ux-v41-9.json').write_text(json.dumps(q,ensure_ascii=False,indent=2)+'\n')
