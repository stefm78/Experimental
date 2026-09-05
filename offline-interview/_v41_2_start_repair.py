from pathlib import Path
import re

app_p=Path('offline-interview/app.js'); app=app_p.read_text()
idx_p=Path('offline-interview/index.html'); idx=idx_p.read_text()
sw_p=Path('offline-interview/sw.js'); sw=sw_p.read_text()
test_p=Path('offline-interview/test-runtime-contract.mjs'); test=test_p.read_text()
field_p=Path('offline-interview/test-interviews/interview-test-ux-v41.json'); field=field_p.read_text()

def once(s, old, new, label):
    n=s.count(old)
    if n != 1: raise SystemExit(f'{label}: expected 1 occurrence, got {n}')
    return s.replace(old,new,1)

app=once(app,"const BUILD_ID = '2026-09-06.interview-runtime-v41.1';","const BUILD_ID = '2026-09-06.interview-runtime-v41.2';",'build')
app=once(app,"  prepareBtn: $('prepareBtn'), startBtn: $('startBtn'), resumeBtn: $('resumeBtn'),","  prepareBtn: $('prepareBtn'), startBtn: $('startBtn'), freeStartBtn: $('freeStartBtn'), resumeBtn: $('resumeBtn'),",'ui free start')

marker="""function defaultParticipants() {
  return [
    { id: 'P1', name: 'Interviewer', role: 'interviewer' },
    { id: 'P2', name: 'Interviewé', role: 'interviewee' }
  ];
}
"""
insert=marker+"""
function ensureInterviewParticipants() {
  if (!interview) return;
  if (!Array.isArray(interview.participants) || !interview.participants.length) interview.participants = defaultParticipants();
}

function freeInterviewSpec() {
  return normalizeSpec({
    schema: SPEC_SCHEMA,
    id: `free-interview-${Date.now()}`,
    version: '1.0',
    title: 'Entretien libre',
    context: 'Entretien démarré sans questionnaire chargé.',
    objective: 'Capturer librement la conversation, avec transcription et audio local.',
    language: navigator.language || 'fr-FR',
    estimatedDurationMinutes: 30,
    participants: defaultParticipants(),
    sections: [{
      id: 'S1', title: 'Entretien libre', questions: [{
        id: 'Q1', label: 'Conversation libre', text: 'Entretien libre',
        intent: 'Capturer la conversation sans questionnaire préparé.',
        estimatedMinutes: 30, required: false, audience: ['P2'], followUps: []
      }]
    }]
  });
}
"""
app=once(app,marker,insert,'participant/free helpers')

app=once(app,"""function renderSetup() {
  setView('setup');""","""function renderSetup() {
  ensureInterviewParticipants();
  setView('setup');""",'render participants invariant')

app=once(app,"""async function startInterview() {
  session = newSession();
  await persistSession();
  renderQuestion();
}
async function resumeInterview() {""","""async function startInterview() {
  showError(ui.setupError);
  try {
    if (!interview) interview = freeInterviewSpec();
    ensureInterviewParticipants();
    session = newSession();
    renderQuestion();
    try { await persistSession(); }
    catch (error) {
      diagnosticError = `Session storage: ${error?.message || error}`;
      showError(ui.interviewError, 'Entretien démarré, mais la sauvegarde locale est temporairement indisponible.');
    }
  } catch (error) {
    session = null;
    diagnosticError = `Start interview: ${error?.message || error}`;
    showError(ui.setupError, `Impossible de démarrer l’entretien : ${error?.message || error}`);
    renderSetup();
  }
}

async function startFreeInterview() {
  showError(ui.loadError);
  showError(ui.setupError);
  interview = freeInterviewSpec();
  session = null;
  renderSetup();
  try { await persistSpec(); } catch (error) { diagnosticError = `Free interview storage: ${error?.message || error}`; }
  await startInterview();
}
async function resumeInterview() {""",'start nonblocking/free mode')

app=once(app,"""    interview = normalizeSpec(raw);""","""    interview = normalizeSpec(raw);
    ensureInterviewParticipants();""",'loaded participants invariant')

app=once(app,"ui.startBtn.addEventListener('click', startInterview);","ui.startBtn.addEventListener('click', startInterview);\nui.freeStartBtn?.addEventListener('click', startFreeInterview);",'free start event')

idx=once(idx,'./styles.css?v=41.1','./styles.css?v=41.2','css version')
idx=once(idx,'./app.js?v=41.1','./app.js?v=41.2','app version')
idx=once(idx,"""        <button id="resumeBtn" class="link-button hidden">Voir le dernier entretien</button>
        <button id="startBtn" class="primary setup-start">Commencer l’entretien →</button>""","""        <button id="resumeBtn" class="link-button hidden">Voir le dernier entretien</button>
        <button id="freeStartBtn" class="ghost setup-start" type="button">Entretien libre</button>
        <button id="startBtn" class="primary setup-start">Commencer l’entretien →</button>""",'free start button')
idx=once(idx,"La voix est transcrite automatiquement. Le texte de l’entretien reste dans ce navigateur ; l’audio n’est pas conservé par l’application.","La voix est transcrite automatiquement. Le texte et l’audio de la session restent localement dans ce navigateur ; l’audio peut être supprimé depuis l’écran de fin.",'privacy copy')

sw=once(sw,"const VERSION = 'offline-interview-v41.1';","const VERSION = 'offline-interview-v41.2';",'sw version')
sw=sw.replace("'./styles.css?v=41', './app.js?v=41'","'./styles.css?v=41.2', './app.js?v=41.2'")

field=field.replace('2026-09-06.interview-runtime-v41','2026-09-06.interview-runtime-v41.2')

# Canonical regression contract: setup participants are rendered deterministically, start does not wait for storage,
# and a questionnaire is optional via the explicit free-interview path.
test=test.replace("assert.match(app, /interview-runtime-v41/);","assert.match(app, /interview-runtime-v41\\.2/);")
test=test.replace("assert.match(sw, /offline-interview-v41/);","assert.match(sw, /offline-interview-v41\\.2/);")
test=test.replace("assert.match(index, /styles\\.css\\?v=41/);\nassert.match(index, /app\\.js\\?v=41/);","assert.match(index, /styles\\.css\\?v=41\\.2/);\nassert.match(index, /app\\.js\\?v=41\\.2/);")
needle="assert.doesNotMatch(app, /base64.*audio/i);"
extra=needle+"""

// V41.2: loading/start path cannot lose participants, and free interview is a first-class path.
assert.match(app, /function ensureInterviewParticipants\\(\\)/);
assert.match(app, /function renderSetup\\(\\) \\{\\s+ensureInterviewParticipants\\(\\)/);
assert.match(app, /interview = normalizeSpec\\(raw\\);\\s+ensureInterviewParticipants\\(\\)/);
assert.match(app, /session = newSession\\(\\);\\s+renderQuestion\\(\\);\\s+try \\{ await persistSession\\(\\); \\}/);
assert.match(app, /function freeInterviewSpec\\(\\)/);
assert.match(app, /async function startFreeInterview\\(\\)/);
assert.match(index, /id="freeStartBtn"/);
"""
test=once(test,needle,extra,'contract additions')
test=test.replace("contract: 'offline-interview.runtime-contract.v41.1'","contract: 'offline-interview.runtime-contract.v41.2'")
# Small, explicit budget lift for the bounded free-mode/recovery code.
test=test.replace('bytes(app) <= 98_000','bytes(app) <= 101_000').replace('coreBytes <= 196_000','coreBytes <= 200_000')

for p,s in [(app_p,app),(idx_p,idx),(sw_p,sw),(test_p,test),(field_p,field)]: p.write_text(s)
print('V41.2 start/participants/free-mode repair applied')
