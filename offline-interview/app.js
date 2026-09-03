import { detectSystemSpeech, createSystemSpeechSession } from './system-stt.js';

const BUILD_ID = '2026-09-03.interview-runtime-v24';
const SPEC_SCHEMA = 'offline-interview.interview-spec.v1';
const RESULT_SCHEMA = 'offline-interview.interview-result.v1';
const TRANSFORMERS_VERSION = '4.2.0';
const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;
const MODEL_ID = 'onnx-community/whisper-tiny';
const DB_NAME = 'offline-interview';
const DB_VERSION = 1;
const STATE_KEY = 'current-session';
const SPEC_KEY = 'last-interview-spec';

const $ = id => document.getElementById(id);
const ui = {
  setupView: $('setupView'), interviewView: $('interviewView'), doneView: $('doneView'), sttLabCard: $('sttLabCard'), authoringKitCard: $('authoringKitCard'), setupMeta: $('setupMeta'),
  networkBadge: $('networkBadge'), setupTitle: $('setupTitle'), setupContext: $('setupContext'), setupObjective: $('setupObjective'),
  interviewFile: $('interviewFile'), loadError: $('loadError'), setupParticipants: $('setupParticipants'), setupAddParticipantBtn: $('setupAddParticipantBtn'),
  swStatus: $('swStatus'), storageStatus: $('storageStatus'), modelStatus: $('modelStatus'), progressBlock: $('progressBlock'), progressLabel: $('progressLabel'), progressValue: $('progressValue'), modelProgress: $('modelProgress'), setupError: $('setupError'),
  prepareBtn: $('prepareBtn'), startBtn: $('startBtn'), resumeBtn: $('resumeBtn'),
  sectionTitle: $('sectionTitle'), questionCounter: $('questionCounter'), questionProgress: $('questionProgress'), questionText: $('questionText'), questionIntent: $('questionIntent'), questionIntentDetails: $('questionIntentDetails'), speakerHelp: $('speakerHelp'),
  questionSidebar: $('questionSidebar'), sidebarInterviewTitle: $('sidebarInterviewTitle'), sidebarProgressSummary: $('sidebarProgressSummary'), sidebarTimeSummary: $('sidebarTimeSummary'), sidebarTimeProgress: $('sidebarTimeProgress'), questionNav: $('questionNav'), pauseBtn: $('pauseBtn'), sidebarFinishBtn: $('sidebarFinishBtn'), interviewProgressSummary: $('interviewProgressSummary'), timeProgressLabel: $('timeProgressLabel'), timeProgress: $('timeProgress'), sessionClockText: $('sessionClockText'), sessionRemainingText: $('sessionRemainingText'),
  interviewParticipants: $('interviewParticipants'), interviewAddParticipantBtn: $('interviewAddParticipantBtn'), speakerButtons: $('speakerButtons'), activeSpeakerLabel: $('activeSpeakerLabel'),
  turnsSection: $('turnsSection'), turnsList: $('turnsList'),
  captureDock: $('captureDock'), captureModeLabel: $('captureModeLabel'), recordState: $('recordState'), timer: $('timer'), liveTranscriptPreview: $('liveTranscriptPreview'), transcribing: $('transcribing'),
  answerText: $('answerText'), answerMeta: $('answerMeta'), composerSpeaker: $('composerSpeaker'), addTurnBtn: $('addTurnBtn'), clearComposerBtn: $('clearComposerBtn'),
  followUpsPanel: $('followUpsPanel'), followUpsSummary: $('followUpsSummary'), plannedFollowUps: $('plannedFollowUps'), adHocFollowUpText: $('adHocFollowUpText'), addAdHocFollowUpBtn: $('addAdHocFollowUpBtn'),
  interviewError: $('interviewError'), prevBtn: $('prevBtn'), validateBtn: $('validateBtn'), homeBtn: $('homeBtn'),
  doneSummary: $('doneSummary'), doneQuestionStat: $('doneQuestionStat'), doneTurnStat: $('doneTurnStat'), doneTimeStat: $('doneTimeStat'), reviewBtn: $('reviewBtn'), exportTxtBtn: $('exportTxtBtn'), exportJsonBtn: $('exportJsonBtn'), newSessionBtn: $('newSessionBtn'),
  diagBuild: $('diagBuild'), diagNetwork: $('diagNetwork'), diagSw: $('diagSw'), diagPersist: $('diagPersist'), diagStt: $('diagStt'), copyDiagBtn: $('copyDiagBtn'), copyDiagStatus: $('copyDiagStatus'), diagnosticOutput: $('diagnosticOutput'),
  copyAuthoringKitBtn: $('copyAuthoringKitBtn'), authoringKitStatus: $('authoringKitStatus')
};

let interview = null;
let session = null;
let db = null;
let transcriber = null;
let recorder = null;
let stream = null;
let chunks = [];
let startedRecordingAt = 0;
let timerHandle = null;
let composerDurationSeconds = 0;
let composerSource = 'keyboard';
let composerRawTranscript = null;
let diagnosticError = null;
let systemSpeechCapability = { supported: false, mode: 'unavailable', localAvailability: null, availability: null };
let systemSpeechSession = null;
let sessionClockTimer = null;
let sessionClockLastMs = null;
let sessionClockPersistTicks = 0;
let recordingSpeakerId = null;
let recordingQuestionId = null;
let queuedSpeakerId = null;
let recordingCompletionPromise = null;
let resolveRecordingCompletion = null;
let captureFinalizing = false;
let queuedRecordingQuestionId = null;
let recordingCaptureId = null;

function show(el, visible = true) { if (el) el.classList.toggle('hidden', !visible); }
function showError(el, message = '') { if (!el) return; el.textContent = message; show(el, Boolean(message)); }
function nowIso() { return new Date().toISOString(); }
function uuid(prefix = 'id') { return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value) { return String(value ?? '').trim(); }
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function safeFilePart(value) { return String(value || 'interview').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'interview'; }

function setView(name) {
  show(ui.setupView, name === 'setup');
  show(ui.interviewView, name === 'interview');
  show(ui.doneView, name === 'done');
  show(ui.sttLabCard, name === 'setup');
  show(ui.authoringKitCard, name === 'setup');
  document.body.classList.toggle('interview-mode', name === 'interview');
  document.body.classList.toggle('setup-mode', name === 'setup');
  document.body.classList.toggle('done-mode', name === 'done');
  if (name === 'interview') startSessionClock();
  else stopSessionClock();
}

function updateNetwork() {
  const offline = !navigator.onLine;
  ui.networkBadge.textContent = offline ? 'Hors connexion' : 'En ligne';
  ui.networkBadge.className = `badge ${offline ? 'offline' : 'online'}`;
  ui.diagNetwork.textContent = offline ? 'hors connexion' : 'en ligne';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbGet(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function persistSession() { if (session) await dbPut(STATE_KEY, session); }
async function persistSpec() { if (interview) await dbPut(SPEC_KEY, interview); }

function defaultParticipants() {
  return [
    { id: 'P1', name: 'Interviewer', role: 'interviewer' },
    { id: 'P2', name: 'Interviewé', role: 'interviewee' }
  ];
}

function normalizeRole(role) {
  return ['interviewer', 'interviewee', 'other'].includes(role) ? role : 'other';
}

function normalizeQuestion(q, fallback) {
  const followUps = Array.isArray(q?.followUps) ? q.followUps.map((f, index) => ({
    id: cleanText(f?.id) || `Q${fallback}-R${index + 1}`,
    text: cleanText(f?.text),
    kind: f?.kind === 'ad_hoc' ? 'ad_hoc' : 'planned'
  })).filter(f => f.text) : [];
  return {
    id: cleanText(q?.id) || `Q${fallback}`,
    label: cleanText(q?.label),
    text: cleanText(q?.text),
    intent: cleanText(q?.intent),
    required: q?.required !== false,
    estimatedMinutes: Number.isFinite(Number(q?.estimatedMinutes)) && Number(q.estimatedMinutes) > 0 ? Number(q.estimatedMinutes) : null,
    audience: Array.isArray(q?.audience) ? q.audience.map(cleanText).filter(Boolean) : [],
    followUps
  };
}

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Le fichier JSON doit contenir un objet.');
  const participants = Array.isArray(raw.participants) && raw.participants.length
    ? raw.participants.map((p, index) => ({
        id: cleanText(p?.id) || `P${index + 1}`,
        name: cleanText(p?.name) || `Participant ${index + 1}`,
        role: normalizeRole(p?.role)
      }))
    : defaultParticipants();

  let sections = [];
  if (Array.isArray(raw.sections)) {
    sections = raw.sections.map((section, sectionIndex) => ({
      id: cleanText(section?.id) || `S${sectionIndex + 1}`,
      title: cleanText(section?.title) || `Section ${sectionIndex + 1}`,
      questions: Array.isArray(section?.questions) ? section.questions.map((q, questionIndex) => normalizeQuestion(q, `${sectionIndex + 1}-${questionIndex + 1}`)) : []
    }));
  } else if (Array.isArray(raw.questions)) {
    sections = [{ id: 'S1', title: 'Questions', questions: raw.questions.map((q, questionIndex) => normalizeQuestion(q, String(questionIndex + 1))) }];
  }

  const normalized = {
    schema: SPEC_SCHEMA,
    id: cleanText(raw.id) || `interview-${Date.now()}`,
    version: cleanText(raw.version) || '1.0',
    title: cleanText(raw.title) || 'Interview sans titre',
    context: cleanText(raw.context),
    objective: cleanText(raw.objective),
    language: cleanText(raw.language) || 'fr-FR',
    tags: Array.isArray(raw.tags) ? raw.tags.map(cleanText).filter(Boolean) : [],
    estimatedDurationMinutes: Number.isFinite(Number(raw.estimatedDurationMinutes)) && Number(raw.estimatedDurationMinutes) > 0 ? Number(raw.estimatedDurationMinutes) : null,
    participants,
    sections
  };
  validateSpec(normalized);
  return normalized;
}

function validateSpec(spec) {
  if (!spec.id) throw new Error('Le champ id est obligatoire.');
  const participantIds = new Set();
  for (const p of spec.participants) {
    if (participantIds.has(p.id)) throw new Error(`Identifiant participant dupliqué : ${p.id}`);
    participantIds.add(p.id);
  }
  const questions = (spec.sections || []).flatMap(s => s.questions || []);
  if (!questions.length) throw new Error("L'interview doit contenir au moins une question.");
  const questionIds = new Set();
  const followUpIds = new Set();
  for (const q of questions) {
    if (!q.text) throw new Error(`Question ${q.id} sans texte.`);
    if (questionIds.has(q.id)) throw new Error(`Identifiant question dupliqué : ${q.id}`);
    questionIds.add(q.id);
    for (const f of q.followUps || []) {
      if (followUpIds.has(f.id)) throw new Error(`Identifiant relance dupliqué : ${f.id}`);
      followUpIds.add(f.id);
    }
  }
}

function flattenedQuestions() {
  if (!interview) return [];
  const result = [];
  for (const section of interview.sections) {
    for (const question of section.questions) result.push({ section, question });
  }
  return result;
}
function currentEntry() { return flattenedQuestions()[session?.currentIndex ?? 0] || null; }
function responseFor(questionId) {
  if (!session.responses[questionId]) session.responses[questionId] = { status: 'draft', turns: [], validatedAt: null };
  return session.responses[questionId];
}
function participantsSource() { return session?.participants || interview?.participants || []; }
function participantById(id) { return participantsSource().find(p => p.id === id) || null; }
function interviewerId() { return participantsSource().find(p => p.role === 'interviewer')?.id || participantsSource()[0]?.id || null; }
function defaultActiveSpeakerId() { return participantsSource().find(p => p.role === 'interviewee')?.id || participantsSource()[0]?.id || null; }

function newSession() {
  return {
    id: uuid('session'),
    interviewId: interview.id,
    interviewVersion: interview.version,
    interviewSpec: clone(interview),
    participants: clone(interview.participants),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completed: false,
    completedAt: null,
    currentIndex: 0,
    activeSpeakerId: interview.participants.find(p => p.role === 'interviewee')?.id || interview.participants[0]?.id || null,
    activeSeconds: 0,
    questionSeconds: {},
    paused: false,
    participantHistory: Object.fromEntries(interview.participants.map(p => [p.id, { ...clone(p), removedAt: null }])),
    responses: {}
  };
}

function roleLabel(role) {
  return role === 'interviewer' ? 'Interviewer' : role === 'interviewee' ? 'Interviewé' : 'Autre';
}
function nextParticipantId() {
  const used = new Set(participantsSource().map(p => p.id));
  let index = 1;
  while (used.has(`P${index}`)) index += 1;
  return `P${index}`;
}
async function persistRuntimeMetadata() {
  if (session) {
    session.updatedAt = nowIso();
    await persistSession();
  } else {
    await persistSpec();
  }
}
async function addParticipant() {
  const target = participantsSource();
  const participant = { id: nextParticipantId(), name: 'Nouveau participant', role: 'interviewee' };
  target.push(participant);
  if (!session) interview.participants = target;
  if (session) {
    if (!session.participantHistory || typeof session.participantHistory !== 'object') session.participantHistory = {};
    session.participantHistory[participant.id] = { ...clone(participant), removedAt: null };
    if (!session.activeSpeakerId) session.activeSpeakerId = participant.id;
  }
  await persistRuntimeMetadata();
  renderParticipantsEverywhere();
  if (session) renderSpeakerButtons();
}

function renderParticipantEditor(container) {
  container.innerHTML = '';
  for (const participant of participantsSource()) {
    const row = document.createElement('div');
    row.className = 'participant-row';
    row.dataset.participantId = participant.id;

    const name = document.createElement('input');
    name.type = 'text';
    name.value = participant.name;
    name.setAttribute('aria-label', `Nom de ${participant.id}`);
    name.addEventListener('change', async () => {
      participant.name = cleanText(name.value) || participant.id;
      name.value = participant.name;
      if (session?.participantHistory?.[participant.id]) {
        session.participantHistory[participant.id].name = participant.name;
      }
      if (session) {
        for (const response of Object.values(session.responses || {})) {
          for (const turn of response.turns || []) {
            if (turn.speakerId === participant.id) turn.speakerNameSnapshot = participant.name;
          }
        }
      }
      await persistRuntimeMetadata();
      renderParticipantsEverywhere(container);
      if (session) { renderSpeakerButtons(); renderTurns(); }
    });

    const role = document.createElement('select');
    role.setAttribute('aria-label', `Rôle de ${participant.id}`);
    for (const value of ['interviewer', 'interviewee', 'other']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = roleLabel(value);
      option.selected = participant.role === value;
      role.append(option);
    }
    role.addEventListener('change', async () => {
      participant.role = normalizeRole(role.value);
      if (session?.participantHistory?.[participant.id]) {
        session.participantHistory[participant.id].role = participant.role;
      }
      if (session) {
        for (const response of Object.values(session.responses || {})) {
          for (const turn of response.turns || []) {
            if (turn.speakerId === participant.id) turn.speakerRoleSnapshot = participant.role;
          }
        }
      }
      await persistRuntimeMetadata();
      renderParticipantsEverywhere(container);
      if (session) renderSpeakerButtons();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small icon-button';
    remove.textContent = '×';
    remove.title = 'Supprimer le participant';
    remove.disabled = participantsSource().length <= 1;
    remove.addEventListener('click', async () => {
      if (session && (recordingSpeakerId === participant.id || queuedSpeakerId === participant.id)) {
        alert(`Terminez d’abord la prise de parole de ${participant.name} avant de supprimer ce participant.`);
        return;
      }
      const used = session ? Object.values(session.responses || {}).some(r => (r.turns || []).some(t => t.speakerId === participant.id)) : false;
      if (used && !confirm(`${participant.name} est déjà associé à des prises de parole. Son nom restera conservé dans l’historique. Supprimer ce participant de la liste active ?`)) return;
      const arr = participantsSource();
      const index = arr.findIndex(p => p.id === participant.id);
      if (index >= 0) arr.splice(index, 1);
      if (session?.participantHistory?.[participant.id]) {
        session.participantHistory[participant.id].removedAt = nowIso();
      }
      if (session?.activeSpeakerId === participant.id) session.activeSpeakerId = defaultActiveSpeakerId();
      await persistRuntimeMetadata();
      renderParticipantsEverywhere();
      if (session) { renderSpeakerButtons(); renderTurns(); }
    });

    const id = document.createElement('span');
    id.className = 'participant-id';
    id.textContent = participant.id;
    row.append(id, name, role, remove);
    container.append(row);
  }
}

function renderParticipantsEverywhere(skip = null) {
  if (ui.setupParticipants !== skip) renderParticipantEditor(ui.setupParticipants);
  if (session && ui.interviewParticipants !== skip) renderParticipantEditor(ui.interviewParticipants);
}

function estimatedTotalMinutes() {
  const explicit = Number(interview?.estimatedDurationMinutes);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const all = flattenedQuestions();
  const sum = all.reduce((total, entry) => total + (Number(entry.question.estimatedMinutes) > 0 ? Number(entry.question.estimatedMinutes) : 0), 0);
  return sum > 0 ? sum : Math.max(10, all.length * 3);
}

function estimatedQuestionMinutes(question) {
  const explicit = Number(question?.estimatedMinutes);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = estimatedTotalMinutes();
  const count = Math.max(1, flattenedQuestions().length);
  return Math.max(1, Math.round((total / count) * 2) / 2);
}

function questionHasAnswer(questionId) {
  return (session?.responses?.[questionId]?.turns || []).some(turn => turn.type === 'answer' && cleanText(turn.text));
}

function activeQuestionSeconds(questionId) {
  return Math.max(0, Number(session?.questionSeconds?.[questionId]) || 0);
}

function elapsedMinutesLabel(seconds) {
  const mins = Math.max(0, seconds) / 60;
  if (mins < 1) return '<1 min';
  return Math.round(mins) + ' min';
}

function remainingEstimatedMinutes() {
  if (!session) return estimatedTotalMinutes();
  return flattenedQuestions().reduce((total, entry) => {
    const question = entry.question;
    if (questionHasAnswer(question.id)) return total;
    const estimate = estimatedQuestionMinutes(question);
    const spent = activeQuestionSeconds(question.id) / 60;
    return total + Math.max(0, estimate - spent);
  }, 0);
}

function flushSessionClock() {
  if (!session || session.paused || !sessionClockLastMs || ui.interviewView?.classList.contains('hidden')) {
    sessionClockLastMs = Date.now();
    return;
  }
  const now = Date.now();
  const delta = Math.max(0, Math.min(5, (now - sessionClockLastMs) / 1000));
  sessionClockLastMs = now;
  if (!delta) return;
  session.activeSeconds = Math.max(0, Number(session.activeSeconds) || 0) + delta;
  if (!session.questionSeconds || typeof session.questionSeconds !== 'object') session.questionSeconds = {};
  const entry = currentEntry();
  const questionId = (isRecording() || captureFinalizing) && recordingQuestionId ? recordingQuestionId : entry?.question?.id;
  if (questionId) session.questionSeconds[questionId] = activeQuestionSeconds(questionId) + delta;
  session.updatedAt = nowIso();
}

function startSessionClock() {
  if (!session || session.completed) return;
  sessionClockLastMs = Date.now();
  if (sessionClockTimer) return;
  sessionClockTimer = setInterval(() => {
    if (!session || session.paused || document.visibilityState !== 'visible') {
      sessionClockLastMs = Date.now();
      renderInterviewMetrics();
      return;
    }
    flushSessionClock();
    renderInterviewMetrics();
    sessionClockPersistTicks += 1;
    if (sessionClockPersistTicks >= 10) {
      sessionClockPersistTicks = 0;
      renderQuestionNav();
      persistSession().catch(() => {});
    }
  }, 1000);
}

function stopSessionClock() {
  if (sessionClockTimer) {
    flushSessionClock();
    clearInterval(sessionClockTimer);
    sessionClockTimer = null;
  }
  sessionClockLastMs = null;
  sessionClockPersistTicks = 0;
  if (session) persistSession().catch(() => {});
}

function renderInterviewMetrics() {
  if (!session || !interview) return;
  const all = flattenedQuestions();
  const answered = all.filter(entry => questionHasAnswer(entry.question.id)).length;
  const elapsedSeconds = Math.max(0, Number(session.activeSeconds) || 0);
  const elapsedMinutes = elapsedSeconds / 60;
  const totalEstimate = estimatedTotalMinutes();
  const remaining = remainingEstimatedMinutes();
  if (ui.interviewProgressSummary) ui.interviewProgressSummary.textContent = answered + ' / ' + all.length + ' abordées';
  if (ui.sidebarProgressSummary) ui.sidebarProgressSummary.textContent = answered + ' / ' + all.length + ' abordées';
  if (ui.timeProgressLabel) ui.timeProgressLabel.textContent = elapsedMinutesLabel(elapsedSeconds) + ' écoulées · ~' + Math.max(0, Math.round(remaining)) + ' min prévues restantes';
  if (ui.sidebarTimeSummary) ui.sidebarTimeSummary.textContent = '~' + Math.max(0, Math.round(remaining)) + ' min restantes';
  if (ui.sessionClockText) ui.sessionClockText.textContent = formatTime(elapsedSeconds);
  if (ui.sessionRemainingText) ui.sessionRemainingText.textContent = '~' + Math.max(0, Math.round(remaining)) + ' min restantes';
  if (ui.timeProgress) {
    ui.timeProgress.max = Math.max(1, totalEstimate);
    ui.timeProgress.value = Math.min(totalEstimate, elapsedMinutes);
  }
  if (ui.sidebarTimeProgress) {
    ui.sidebarTimeProgress.max = Math.max(1, totalEstimate);
    ui.sidebarTimeProgress.value = Math.min(totalEstimate, elapsedMinutes);
  }
  if (ui.pauseBtn) {
    ui.pauseBtn.textContent = session.paused ? '▶ Reprendre' : 'Ⅱ Pause';
    ui.pauseBtn.setAttribute('aria-pressed', session.paused ? 'true' : 'false');
  }
}

function questionNavLabel(question) {
  const explicit = cleanText(question.label);
  if (explicit) return explicit;
  return cleanText(question.text);
}

function renderQuestionNav() {
  if (!ui.questionNav || !session) return;
  ui.questionNav.innerHTML = '';
  let flatIndex = 0;
  for (const section of interview.sections) {
    const group = document.createElement('section');
    group.className = 'question-nav-section';
    const title = document.createElement('div');
    title.className = 'question-nav-section-title';
    title.textContent = section.title;
    group.append(title);
    for (const question of section.questions) {
      const index = flatIndex++;
      const answered = questionHasAnswer(question.id);
      const current = index === session.currentIndex;
      const recordingTarget = Boolean(isRecording() && recordingQuestionId === question.id);
      const finalizingTarget = Boolean(captureFinalizing && recordingQuestionId === question.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'question-nav-item' + (answered ? ' answered' : '') + (current ? ' current' : '') + (recordingTarget ? ' on-air' : '') + (finalizingTarget ? ' finalizing' : '');
      row.title = question.text;
      if (current) row.setAttribute('aria-current', 'step');
      const state = document.createElement('span');
      state.className = 'question-nav-state';
      state.textContent = recordingTarget ? '🎙' : finalizingTarget ? '…' : current ? '›' : answered ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'question-nav-label';
      label.textContent = (index + 1) + '. ' + questionNavLabel(question);
      const duration = document.createElement('span');
      duration.className = 'question-nav-duration';
      const spent = activeQuestionSeconds(question.id);
      duration.textContent = recordingTarget ? 'ON AIR' : finalizingTarget ? 'TRAITEMENT' : (spent >= 30 ? elapsedMinutesLabel(spent) : '~' + estimatedQuestionMinutes(question) + ' min');
      row.append(state, label, duration);
      row.addEventListener('click', () => goToQuestion(index));
      group.append(row);
    }
    ui.questionNav.append(group);
  }
}


async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {
  if (!isRecording() || !recordingSpeakerId || !recordingQuestionId) return false;
  if (!nextSpeakerId || !nextQuestionId) return false;
  if (nextSpeakerId === recordingSpeakerId && nextQuestionId === recordingQuestionId) return true;
  if (!systemSpeechSession?.takeSegment) return false;

  const snapshot = systemSpeechSession.takeSegment();
  const text = cleanText(snapshot?.text);
  if (!meaningfulTranscript(text)) return false;

  const previousSpeakerId = recordingSpeakerId;
  const previousQuestionId = recordingQuestionId;
  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);
  const source = snapshot.mode === 'local' ? 'system-local' : 'system';
  const rawTranscript = snapshot.finalText || text;

  recordingSpeakerId = nextSpeakerId;
  recordingQuestionId = nextQuestionId;
  session.activeSpeakerId = nextSpeakerId;
  session.updatedAt = nowIso();
  startedRecordingAt = performance.now();
  composerDurationSeconds = 0;
  chunks = [];
  ui.timer.textContent = '00:00';
  if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';

  renderSpeakerButtons();
  renderQuestionNav();
  updateCaptureUi();

  await appendAnswerTurn({
    questionId: previousQuestionId,
    speakerId: previousSpeakerId,
    text,
    source,
    rawTranscript,
    durationSeconds
  });
  await persistSession();
  return true;
}

async function togglePause() {
  if (!session) return;
  if (!session.paused) flushSessionClock();
  session.paused = !session.paused;
  session.updatedAt = nowIso();
  sessionClockLastMs = Date.now();
  await persistSession();
  renderInterviewMetrics();
}

async function goToQuestion(index) {
  const all = flattenedQuestions();
  if (!session || index < 0 || index >= all.length || index === session.currentIndex) return;
  flushSessionClock();
  const targetQuestionId = all[index]?.question?.id || null;

  if (isRecording() && targetQuestionId && targetQuestionId !== recordingQuestionId) {
    const rotated = await rotateLiveSegment(recordingSpeakerId, targetQuestionId);
    if (!rotated) {
      queuedSpeakerId = recordingSpeakerId;
      queuedRecordingQuestionId = targetQuestionId;
      ui.recordState.textContent = 'Changement de question…';
      stopRecording();
    }
  } else if (!isRecording() && !captureFinalizing) {
    await addComposerTurn();
  }

  session.currentIndex = index;
  session.completed = false;
  session.completedAt = null;
  session.updatedAt = nowIso();
  sessionClockLastMs = Date.now();
  await persistSession();
  renderQuestion();
}

async function finishActiveCaptureBeforeLeaving(message) {
  if (isRecording()) {
    if (!confirm(message)) return false;
    queuedSpeakerId = null;
    queuedRecordingQuestionId = null;
    stopRecording();
  }
  if (captureFinalizing || recordingCompletionPromise) {
    if (recordingCompletionPromise) await recordingCompletionPromise;
  }
  return true;
}

async function returnToSetup() {
  const ok = await finishActiveCaptureBeforeLeaving('Un enregistrement est en cours. L’arrêter, conserver sa transcription puis revenir à l’accueil ?');
  if (!ok) return;
  flushSessionClock();
  await addComposerTurn();
  await persistSession();
  renderSetup();
}

async function completeInterview() {
  if (!session) return;
  const ok = await finishActiveCaptureBeforeLeaving('Un enregistrement est en cours. L’arrêter, conserver sa transcription puis terminer l’entretien ?');
  if (!ok) return;
  flushSessionClock();
  await addComposerTurn();
  session.completed = true;
  session.completedAt = nowIso();
  session.updatedAt = nowIso();
  await persistSession();
  finishInterview();
}
function renderSetup() {
  setView('setup');
  ui.setupTitle.textContent = interview.title;
  if (ui.setupMeta) ui.setupMeta.textContent = `Interview · ~${Math.round(estimatedTotalMinutes())} min`;
  ui.setupContext.textContent = interview.context || 'Aucun contexte renseigné.';
  ui.setupObjective.textContent = interview.objective || 'Objectif non renseigné.';
  renderParticipantsEverywhere();
  refreshResumeButton();
}
function refreshResumeButton() {
  const resumable = session && session.interviewId === interview?.id && session.interviewVersion === interview?.version;
  if (!resumable) { show(ui.resumeBtn, false); return; }
  const total = flattenedQuestions().length;
  ui.resumeBtn.textContent = session.completed ? 'Voir le dernier entretien' : `Reprendre · question ${Math.min(session.currentIndex + 1, total)}/${total}`;
  show(ui.resumeBtn, true);
}

async function loadInterviewFile(file) {
  showError(ui.loadError);
  try {
    const raw = JSON.parse(await file.text());
    interview = normalizeSpec(raw);
    session = null;
    await persistSpec();
    await detectRuntimeSystemSpeech();
    renderSetup();
    ui.interviewFile.value = '';
  } catch (error) {
    showError(ui.loadError, `Questionnaire refusé : ${error.message || error}`);
  }
}

function isRecording() {
  return Boolean(recorder && recorder.state !== 'inactive');
}

async function selectSpeaker(participantId) {
  if (!session || !participantById(participantId)) return;
  session.activeSpeakerId = participantId;
  session.updatedAt = nowIso();
  await persistSession();
  renderSpeakerButtons();
  updateComposerSpeaker();
}

async function handleSpeakerButtonClick(participantId) {
  if (!session || !participantById(participantId)) return;
  showError(ui.interviewError);

  if (captureFinalizing) {
    queuedSpeakerId = participantId;
    queuedRecordingQuestionId = queuedRecordingQuestionId || recordingQuestionId;
    await selectSpeaker(participantId);
    ui.recordState.textContent = 'Finalisation du propos précédent…';
    return;
  }

  if (isRecording()) {
    if (participantId === recordingSpeakerId) {
      queuedSpeakerId = null;
      stopRecording();
      return;
    }
    const rotated = await rotateLiveSegment(participantId, recordingQuestionId);
    if (!rotated) {
      queuedSpeakerId = participantId;
      queuedRecordingQuestionId = recordingQuestionId;
      await selectSpeaker(participantId);
      ui.recordState.textContent = 'Changement de locuteur…';
      stopRecording();
    }
    return;
  }

  if (cleanText(ui.answerText.value)) await addComposerTurn();
  await selectSpeaker(participantId);
  await startRecording(participantId);
}

function updateCaptureUi() {
  const recording = isRecording();
  const active = participantById(recordingSpeakerId || session?.activeSpeakerId);
  ui.captureDock?.classList.toggle('is-recording', recording);
  ui.captureDock?.classList.toggle('is-finalizing', captureFinalizing && !recording);

  if (recording) {
    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'ON AIR';
    ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';
  } else if (captureFinalizing) {
    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'FINALISATION';
    ui.recordState.textContent = 'Enregistrement terminé · préparation du texte…';
  } else {
    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'PRÊT';
    ui.recordState.textContent = 'Cliquez sur la personne qui parle';
  }
}

function renderSpeakerButtons() {
  const participants = participantsSource();
  if (!participants.length) return;
  if (!participantById(session.activeSpeakerId)) session.activeSpeakerId = defaultActiveSpeakerId();
  ui.speakerButtons.innerHTML = '';
  for (const participant of participants) {
    const button = document.createElement('button');
    button.type = 'button';
    const recording = isRecording() && participant.id === recordingSpeakerId;
    const queued = (isRecording() || captureFinalizing) && participant.id === queuedSpeakerId;
    const active = participant.id === session.activeSpeakerId;
    button.className = `speaker-button${active ? ' active' : ''}${recording ? ' recording' : ''}${queued ? ' queued' : ''}`;
    button.textContent = participant.name;
    button.dataset.captureState = recording ? 'recording' : queued ? 'queued' : 'idle';
    button.title = recording
      ? `Arrêter la prise de parole de ${participant.name}`
      : `Enregistrer une prise de parole de ${participant.name}`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', recording ? 'true' : 'false');
    button.addEventListener('click', () => handleSpeakerButtonClick(participant.id));
    ui.speakerButtons.append(button);
  }
  const active = participantById(recordingSpeakerId || session.activeSpeakerId);
  ui.activeSpeakerLabel.textContent = active
    ? (isRecording() ? `${active.name} · enregistrement en cours` : `${active.name} · prêt`)
    : '';
  if (ui.speakerHelp) {
    const hasTurns = Object.values(session.responses || {}).some(r => (r.turns || []).some(t => t.type === 'answer'));
    ui.speakerHelp.classList.toggle('hidden', hasTurns || isRecording() || captureFinalizing);
  }
  updateCaptureUi();
  updateComposerSpeaker();
}
function updateComposerSpeaker() {
  const active = session ? participantById(session.activeSpeakerId) : null;
  ui.composerSpeaker.textContent = active?.name || 'Locuteur non défini';
}
function resetComposer() {
  try { systemSpeechSession?.abort(); } catch {}
  systemSpeechSession = null;
  ui.answerText.value = '';
  ui.answerMeta.textContent = '';
  composerDurationSeconds = 0;
  composerSource = 'keyboard';
  composerRawTranscript = null;
  ui.timer.textContent = '00:00';
  if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';
  updateCaptureUi();
}

function renderQuestion() {
  const entry = currentEntry();
  if (!entry) return finishInterview();
  setView('interview');
  renderParticipantsEverywhere();
  renderSpeakerButtons();

  const all = flattenedQuestions();
  const section = entry.section;
  const question = entry.question;
  if (ui.sidebarInterviewTitle) ui.sidebarInterviewTitle.textContent = interview.title;
  ui.sectionTitle.textContent = section.title.toUpperCase();
  ui.questionCounter.textContent = (session.currentIndex + 1) + ' / ' + all.length + (question.label ? ' · ' + question.label : '');
  ui.questionProgress.max = all.length;
  ui.questionProgress.value = session.currentIndex + 1;
  ui.questionText.textContent = question.text;
  ui.questionIntent.textContent = question.intent || '';
  show(ui.questionIntentDetails, Boolean(question.intent));
  if (ui.questionIntentDetails) ui.questionIntentDetails.open = false;
  ui.prevBtn.disabled = session.currentIndex === 0;
  ui.validateBtn.textContent = session.currentIndex === all.length - 1 ? 'Terminer l’entretien' : 'Question suivante →';
  showError(ui.interviewError);
  if (!isRecording() && !captureFinalizing) resetComposer();
  renderTurns();
  renderFollowUps();
  renderQuestionNav();
  renderInterviewMetrics();
}

function createTurn({ type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, followUpId = null, followUpKind = null }) {
  const speaker = participantById(speakerId) || session?.participantHistory?.[speakerId] || null;
  return {
    id: uuid('turn'),
    type,
    speakerId: speakerId || null,
    speakerNameSnapshot: speaker?.name || null,
    speakerRoleSnapshot: speaker?.role || null,
    text: cleanText(text),
    source,
    rawTranscript: rawTranscript == null ? null : String(rawTranscript),
    durationSeconds: Math.round((durationSeconds || 0) * 10) / 10,
    followUpId,
    followUpKind,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function meaningfulTranscript(value) {
  const text = cleanText(value);
  return Boolean(text && /[\p{L}\p{N}]/u.test(text));
}

function comparableTranscript(value) {
  return cleanText(value)
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

async function appendAnswerTurn({ questionId, speakerId, text, source, rawTranscript = null, durationSeconds = 0 }) {
  const clean = cleanText(text);
  if (!meaningfulTranscript(clean) || !questionId || !speakerId) return false;
  const response = responseFor(questionId);
  const last = [...(response.turns || [])].reverse().find(turn => turn.type === 'answer');
  if (last && last.speakerId === speakerId) {
    const previous = cleanText(last.text);
    const previousComparable = comparableTranscript(previous);
    const cleanComparable = comparableTranscript(clean);
    const same = previousComparable === cleanComparable;
    const nearDuplicate = previousComparable.length > 20 && cleanComparable.length > 20 &&
      (cleanComparable.startsWith(previousComparable) || previousComparable.startsWith(cleanComparable));
    const recent = last.createdAt && (Date.now() - new Date(last.createdAt).getTime()) < 7000;
    if (recent && (same || nearDuplicate)) {
      if (cleanComparable.length > previousComparable.length) {
        last.text = clean;
        last.rawTranscript = rawTranscript || clean;
        last.updatedAt = nowIso();
        last.durationSeconds = Math.max(Number(last.durationSeconds) || 0, Number(durationSeconds) || 0);
        const speaker = participantById(speakerId) || session?.participantHistory?.[speakerId] || null;
        last.speakerNameSnapshot = last.speakerNameSnapshot || speaker?.name || null;
        last.speakerRoleSnapshot = last.speakerRoleSnapshot || speaker?.role || null;
        await persistSession();
        renderTurns();
      }
      return false;
    }
  }
  response.turns.push(createTurn({
    type: 'answer',
    speakerId,
    text: clean,
    source,
    rawTranscript,
    durationSeconds
  }));
  response.status = 'answered';
  session.updatedAt = nowIso();
  await persistSession();
  renderTurns();
  renderQuestionNav();
  renderInterviewMetrics();
  requestAnimationFrame(() => {
    ui.turnsList?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  return true;
}

async function addComposerTurn() {
  const entry = currentEntry();
  if (!entry) return false;
  const text = cleanText(ui.answerText.value);
  if (!text) return false;
  const added = await appendAnswerTurn({
    questionId: entry.question.id,
    speakerId: session.activeSpeakerId,
    text,
    source: composerSource,
    rawTranscript: composerRawTranscript,
    durationSeconds: composerDurationSeconds
  });
  if (added) resetComposer();
  return added;
}

function renderTurns() {
  const entry = currentEntry();
  if (!entry) return;
  const response = responseFor(entry.question.id);
  const turns = response.turns || [];
  ui.turnsList.innerHTML = '';
  show(ui.turnsSection, turns.length > 0);

  for (const turn of turns) {
    const card = document.createElement('article');
    card.className = `turn-card ${turn.type === 'follow_up' ? 'follow-up-turn' : ''}`;
    const head = document.createElement('div');
    head.className = 'turn-head';

    const select = document.createElement('select');
    select.className = 'turn-speaker-select';
    select.setAttribute('aria-label', 'Locuteur de la prise de parole');
    for (const p of participantsSource()) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      option.selected = p.id === turn.speakerId;
      select.append(option);
    }
    if (!participantById(turn.speakerId) && turn.speakerId) {
      const option = document.createElement('option');
      option.value = turn.speakerId;
      option.textContent = turn.speakerNameSnapshot || session?.participantHistory?.[turn.speakerId]?.name || 'Participant supprimé';
      option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      turn.speakerId = select.value;
      const speaker = participantById(turn.speakerId) || session?.participantHistory?.[turn.speakerId] || null;
      turn.speakerNameSnapshot = speaker?.name || turn.speakerNameSnapshot || null;
      turn.speakerRoleSnapshot = speaker?.role || turn.speakerRoleSnapshot || null;
      turn.updatedAt = nowIso();
      await persistSession();
    });

    const type = document.createElement('span');
    type.className = 'turn-type';
    type.textContent = turn.type === 'follow_up' ? (turn.followUpKind === 'ad_hoc' ? 'Relance spontanée' : 'Relance') : (/system|whisper|speech/.test(turn.source || '') ? 'Voix' : 'Texte');

    const meta = document.createElement('span');
    meta.className = 'turn-meta-inline';
    const metaBits = [];
    if (turn.durationSeconds) metaBits.push(Math.round(turn.durationSeconds) + ' s');
    if (turn.createdAt) metaBits.push(new Date(turn.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    meta.textContent = metaBits.join(' · ');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small icon-button';
    remove.textContent = '×';
    remove.title = 'Supprimer cette prise de parole';
    remove.addEventListener('click', async () => {
      response.turns = response.turns.filter(t => t.id !== turn.id);
      session.updatedAt = nowIso();
      await persistSession();
      renderTurns();
      renderFollowUps();
      renderQuestionNav();
      renderInterviewMetrics();
    });
    head.append(select, type, meta, remove);

    const text = document.createElement('textarea');
    text.className = 'turn-text';
    text.rows = turn.type === 'follow_up' ? 2 : 1;
    text.value = turn.text;
    const resizeTurnText = () => {
      text.style.height = 'auto';
      text.style.height = Math.min(280, Math.max(34, text.scrollHeight)) + 'px';
    };
    text.addEventListener('input', resizeTurnText);
    text.addEventListener('change', async () => {
      turn.text = cleanText(text.value);
      turn.updatedAt = nowIso();
      text.value = turn.text;
      await persistSession();
      renderQuestionNav();
      renderInterviewMetrics();
    });

    card.append(head, text);
    ui.turnsList.append(card);
    requestAnimationFrame(resizeTurnText);
  }
}

function usedFollowUpIds() {
  const entry = currentEntry();
  if (!entry) return new Set();
  const response = responseFor(entry.question.id);
  return new Set((response.turns || []).filter(t => t.type === 'follow_up' && t.followUpId).map(t => t.followUpId));
}
function renderFollowUps() {
  const entry = currentEntry();
  if (!entry) return;
  const followUps = entry.question.followUps || [];
  const used = usedFollowUpIds();
  ui.followUpsSummary.textContent = followUps.length ? `Relances possibles · ${followUps.length}` : 'Relances possibles';
  ui.plannedFollowUps.innerHTML = '';
  for (const followUp of followUps) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'followup-button';
    button.textContent = used.has(followUp.id) ? `✓ ${followUp.text}` : followUp.text;
    button.disabled = used.has(followUp.id);
    button.addEventListener('click', () => addFollowUpTurn(followUp.text, followUp.id, 'planned'));
    ui.plannedFollowUps.append(button);
  }
  if (!followUps.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Aucune relance préparée.';
    ui.plannedFollowUps.append(empty);
  }
}
async function addFollowUpTurn(text, followUpId = null, followUpKind = 'ad_hoc') {
  const clean = cleanText(text);
  if (!clean) return;
  const entry = currentEntry();
  const response = responseFor(entry.question.id);
  response.turns.push(createTurn({
    type: 'follow_up',
    speakerId: interviewerId(),
    text: clean,
    source: 'keyboard',
    followUpId,
    followUpKind
  }));
  session.updatedAt = nowIso();
  await persistSession();
  renderTurns();
  renderFollowUps();
}

async function goNextQuestion() {
  const all = flattenedQuestions();
  if (!session) return;
  if (session.currentIndex >= all.length - 1) {
    await completeInterview();
    return;
  }
  await goToQuestion(session.currentIndex + 1);
}

async function goPrevious() {
  if (!session || session.currentIndex <= 0) return;
  await goToQuestion(session.currentIndex - 1);
}

function finishInterview() {
  setView('done');
  const all = flattenedQuestions();
  const answered = all.filter(({ question }) => (session.responses[question.id]?.turns || []).some(t => t.type === 'answer' && cleanText(t.text))).length;
  const turns = Object.values(session.responses || {}).reduce((sum, r) => sum + (r.turns?.length || 0), 0);
  const activeMinutes = Math.max(1, Math.round((Number(session.activeSeconds) || 0) / 60));
  ui.doneSummary.textContent = answered === all.length
    ? 'Toutes les questions ont été abordées.'
    : `${all.length - answered} question${all.length - answered > 1 ? 's' : ''} reste${all.length - answered > 1 ? 'nt' : ''} non abordée${all.length - answered > 1 ? 's' : ''}.`;
  if (ui.doneQuestionStat) ui.doneQuestionStat.textContent = `${answered} / ${all.length}`;
  if (ui.doneTurnStat) ui.doneTurnStat.textContent = String(turns);
  if (ui.doneTimeStat) ui.doneTimeStat.textContent = `${activeMinutes} min`;
}

function exportPayload() {
  const activeIds = new Set((session.participants || []).map(p => p.id));
  const historyValues = Object.values(session.participantHistory || {});
  const participants = historyValues.length
    ? historyValues.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        active: activeIds.has(p.id),
        removedAt: p.removedAt || null
      }))
    : clone(session.participants || []).map(p => ({ ...p, active: true, removedAt: null }));
  const participantMap = new Map(participants.map(p => [p.id, p]));
  let answeredQuestions = 0;
  let followUpsUsed = 0;
  const sections = interview.sections.map(section => ({
    id: section.id,
    title: section.title,
    questions: section.questions.map(question => {
      const response = session.responses[question.id] || { status: 'unanswered', turns: [], validatedAt: null };
      const turns = (response.turns || []).map((turn, index) => {
        const p = participantMap.get(turn.speakerId);
        if (turn.type === 'follow_up') followUpsUsed += 1;
        return {
          order: index + 1,
          id: turn.id,
          type: turn.type,
          speakerId: turn.speakerId,
          speakerName: turn.speakerNameSnapshot || p?.name || null,
          speakerRole: turn.speakerRoleSnapshot || p?.role || null,
          text: turn.text,
          source: turn.source,
          rawTranscript: turn.rawTranscript,
          durationSeconds: turn.durationSeconds || 0,
          followUpId: turn.followUpId,
          followUpKind: turn.followUpKind,
          createdAt: turn.createdAt,
          updatedAt: turn.updatedAt
        };
      });
      if (turns.some(t => t.type === 'answer' && cleanText(t.text))) answeredQuestions += 1;
      return {
        id: question.id,
        label: question.label || null,
        text: question.text,
        intent: question.intent || null,
        estimatedMinutes: estimatedQuestionMinutes(question),
        required: question.required !== false,
        audience: question.audience || [],
        plannedFollowUps: question.followUps || [],
        status: response.status || (turns.length ? 'draft' : 'unanswered'),
        validatedAt: response.validatedAt || null,
        turns
      };
    })
  }));
  const totalQuestions = flattenedQuestions().length;
  return {
    schema: RESULT_SCHEMA,
    version: '1.0',
    exportedAt: nowIso(),
    provenance: {
      appBuild: BUILD_ID,
      inputSchema: interview.schema,
      transcriptionDefault: 'system',
      transcriptionFallback: 'whisper-local',
      privacy: 'The app does not persist or export audio. System speech recognition may be processed locally or remotely depending on the browser/OS.'
    },
    interview: {
      id: interview.id,
      version: interview.version,
      title: interview.title,
      estimatedDurationMinutes: estimatedTotalMinutes(),
      context: interview.context || null,
      objective: interview.objective || null,
      language: interview.language,
      tags: interview.tags || []
    },
    participants,
    session: {
      id: session.id,
      startedAt: session.startedAt,
      completedAt: session.completedAt || null,
      completed: Boolean(session.completed),
      activeDurationSeconds: Math.round(Number(session.activeSeconds) || 0),
      questionDurationSeconds: Object.fromEntries(Object.entries(session.questionSeconds || {}).map(([id, value]) => [id, Math.round(Number(value) || 0)])),
      completion: {
        answeredQuestions,
        totalQuestions,
        unansweredQuestions: totalQuestions - answeredQuestions,
        followUpsUsed
      }
    },
    sections
  };
}
function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJson() {
  const payload = exportPayload();
  download(`${safeFilePart(interview.id)}-${safeFilePart(session.id)}.json`, 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
}
function exportTxt() {
  const payload = exportPayload();
  const lines = [payload.interview.title, '', payload.interview.context || '', payload.interview.objective ? `Objectif : ${payload.interview.objective}` : '', '', 'Participants :'];
  for (const p of payload.participants) lines.push(`- ${p.name}${p.active === false ? ' [ancien participant]' : ''}`);
  lines.push('');
  for (const section of payload.sections) {
    lines.push(`# ${section.title}`, '');
    for (const question of section.questions) {
      lines.push(`## ${question.text}`);
      if (question.intent) lines.push(`Intention : ${question.intent}`);
      lines.push('');
      if (!question.turns.length) lines.push('[Sans réponse]');
      for (const turn of question.turns) {
        const prefix = turn.type === 'follow_up' ? 'RELANCE' : (turn.speakerName || turn.speakerId || 'LOCUTEUR');
        lines.push(`${prefix} : ${turn.text}`);
      }
      lines.push('', '---', '');
    }
  }
  download(`${safeFilePart(interview.id)}-${safeFilePart(session.id)}.txt`, 'text/plain;charset=utf-8', lines.join('\n'));
}

async function resetSession() {
  if (!confirm('Effacer la session courante ? Le questionnaire chargé reste disponible sur cet appareil.')) return;
  await dbDelete(STATE_KEY);
  session = null;
  renderSetup();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    ui.swStatus.textContent = 'Non supporté';
    ui.diagSw.textContent = 'non supporté';
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=23', { scope: './' });
    await navigator.serviceWorker.ready;
    ui.swStatus.textContent = 'Mis en cache';
    ui.diagSw.textContent = reg.active ? 'actif · v23' : 'installé · v23';
    return true;
  } catch (error) {
    diagnosticError = String(error?.message || error);
    ui.swStatus.textContent = 'Erreur';
    ui.diagSw.textContent = diagnosticError;
    return false;
  }
}
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    ui.storageStatus.textContent = 'Standard';
    ui.diagPersist.textContent = 'API indisponible';
    return false;
  }
  try {
    const persisted = await navigator.storage.persisted() || await navigator.storage.persist();
    ui.storageStatus.textContent = persisted ? 'Persistant' : 'Navigateur';
    ui.diagPersist.textContent = persisted ? 'accordé' : 'non garanti';
    return persisted;
  } catch (error) {
    ui.storageStatus.textContent = 'Navigateur';
    ui.diagPersist.textContent = String(error?.message || error);
    return false;
  }
}

function systemSpeechLabel() {
  if (systemSpeechCapability.mode === 'local') return 'Système local';
  if (systemSpeechCapability.mode === 'standard') return 'Système';
  return 'Whisper local';
}

function refreshSttStatus() {
  if (systemSpeechCapability.mode === 'local') {
    ui.modelStatus.textContent = transcriber ? 'Automatique · secours local prêt' : 'Automatique · secours local';
    if (ui.diagStt) ui.diagStt.textContent = 'Système local · Whisper secours';
    return;
  }
  if (systemSpeechCapability.mode === 'standard') {
    ui.modelStatus.textContent = transcriber ? 'Automatique · secours local prêt' : 'Automatique · secours local';
    if (ui.diagStt) ui.diagStt.textContent = 'Système (réseau possible) · Whisper secours';
    return;
  }
  ui.modelStatus.textContent = transcriber ? 'Local prêt' : 'Secours local disponible';
  if (ui.diagStt) ui.diagStt.textContent = 'Système indisponible · Whisper secours';
}

async function detectRuntimeSystemSpeech() {
  try {
    systemSpeechCapability = await detectSystemSpeech(interview?.language || navigator.language || 'fr-FR');
  } catch (error) {
    diagnosticError = String(error?.message || error);
    systemSpeechCapability = { supported: false, mode: 'unavailable', localAvailability: 'error', availability: 'error' };
  }
  refreshSttStatus();
  return systemSpeechCapability;
}

function applySystemText({ text }) {
  if (!text || !ui.liveTranscriptPreview) return;
  ui.liveTranscriptPreview.textContent = text;
  ui.liveTranscriptPreview.scrollTop = ui.liveTranscriptPreview.scrollHeight;
}
function progressCallback(item) {
  show(ui.progressBlock, true);
  if (item.status === 'progress' && typeof item.progress === 'number') {
    const value = Math.max(0, Math.min(100, item.progress));
    ui.modelProgress.value = value;
    ui.progressValue.textContent = `${Math.round(value)} %`;
    ui.progressLabel.textContent = item.file ? `Chargement ${item.file.split('/').pop()}` : 'Chargement du modèle';
  } else if (item.status === 'ready') {
    ui.progressLabel.textContent = 'Ressource prête';
  }
}
async function prepareModel() {
  if (transcriber) return transcriber;
  showError(ui.setupError);
  showError(ui.interviewError);
  ui.prepareBtn.disabled = true;
  ui.modelStatus.textContent = navigator.onLine ? 'Téléchargement…' : 'Chargement depuis cache…';
  show(ui.progressBlock, true);
  try {
    const {
      AutoTokenizer,
      AutoProcessor,
      WhisperForConditionalGeneration,
      AutomaticSpeechRecognitionPipeline,
      env
    } = await import(TRANSFORMERS_URL);
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.allowRemoteModels = true;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
    const progress = { progress_callback: progressCallback };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, progress);
    const processor = await AutoProcessor.from_pretrained(MODEL_ID, progress);
    if (!processor?.feature_extractor) throw new Error('feature_extractor Whisper absent');
    const model = await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      device: 'wasm',
      dtype: 'q4',
      session_options: { graphOptimizationLevel: 'basic' },
      progress_callback: progressCallback
    });
    transcriber = new AutomaticSpeechRecognitionPipeline({ task: 'automatic-speech-recognition', model, tokenizer, processor });
    ui.modelProgress.value = 100;
    ui.progressValue.textContent = '100 %';
    ui.progressLabel.textContent = 'Moteur prêt';
    refreshSttStatus();
    return transcriber;
  } catch (error) {
    diagnosticError = String(error?.message || error);
    ui.modelStatus.textContent = 'Échec';
    const target = session ? ui.interviewError : ui.setupError;
    showError(target, `Impossible de préparer la transcription locale : ${error.message || error}`);
    throw error;
  } finally {
    ui.prepareBtn.disabled = false;
  }
}

function preferredMimeType() {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}
async function startRecording(speakerId = session?.activeSpeakerId, questionId = currentEntry()?.question?.id || null) {
  showError(ui.interviewError);
  if (isRecording() || captureFinalizing || !speakerId) return;
  try {
    try { systemSpeechSession?.abort(); } catch {}
    systemSpeechSession = null;
    recordingSpeakerId = speakerId;
    recordingQuestionId = questionId;
    recordingCaptureId = uuid('capture');
    recordingCompletionPromise = new Promise(resolve => { resolveRecordingCompletion = resolve; });
    const reusableStream = stream && stream.getAudioTracks?.().some(track => track.readyState === 'live');
    if (!reusableStream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    }
    const mimeType = preferredMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = handleRecordingStopped;
    recorder.start(500);

    systemSpeechSession = createSystemSpeechSession({
      lang: interview?.language || 'fr-FR',
      mode: systemSpeechCapability.mode,
      onText: applySystemText,
      onState: () => {
        const active = participantById(recordingSpeakerId);
        ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';
      },
      onError: error => { diagnosticError = `SpeechRecognition: ${error}`; }
    });
    const usingSystem = Boolean(systemSpeechSession?.start());

    startedRecordingAt = performance.now();
    if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';
    if (!usingSystem) ui.recordState.textContent = `Enregistrement · ${participantById(recordingSpeakerId)?.name || 'locuteur'}`;
    renderSpeakerButtons();
    timerHandle = setInterval(() => { ui.timer.textContent = formatTime((performance.now() - startedRecordingAt) / 1000); }, 250);
  } catch (error) {
    diagnosticError = String(error?.message || error);
    showError(ui.interviewError, `Accès au microphone impossible : ${error.message || error}`);
    recordingSpeakerId = null;
    recordingQuestionId = null;
    try { resolveRecordingCompletion?.(); } catch {}
    resolveRecordingCompletion = null;
    recordingCompletionPromise = null;
    renderSpeakerButtons();
  }
}
function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  composerDurationSeconds = (performance.now() - startedRecordingAt) / 1000;
  clearInterval(timerHandle);
  try { systemSpeechSession?.stop(); } catch {}
  ui.recordState.textContent = 'Finalisation…';
  updateCaptureUi();
  setTimeout(() => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, 280);
}
async function blobTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextCtor();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = new Float32Array(rendered.getChannelData(0));
  await context.close();
  return samples;
}
async function handleRecordingStopped() {
  const captureId = recordingCaptureId;
  if (!captureId) return;
  recordingCaptureId = null;
  captureFinalizing = true;
  const speakerId = recordingSpeakerId;
  const questionId = recordingQuestionId;
  const durationSeconds = composerDurationSeconds;
  const nextSpeakerId = queuedSpeakerId;
  const nextQuestionId = queuedRecordingQuestionId || questionId;
  queuedSpeakerId = null;
  queuedRecordingQuestionId = null;

  ui.addTurnBtn.disabled = true;
  ui.validateBtn.disabled = true;
  updateCaptureUi();
  renderQuestionNav();
  try {
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const systemSnapshot = systemSpeechSession?.snapshot() || { text: '', finalText: '', mode: systemSpeechCapability.mode };
    let text = cleanText(systemSnapshot.text);
    let source = systemSnapshot.mode === 'local' ? 'system-local' : 'system';
    let rawTranscript = systemSnapshot.finalText || text;

    if (!text) {
      show(ui.transcribing, true);
      ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'
        ? 'Transcription Whisper locale…'
        : 'Aucun texte système · secours Whisper…';
      if (!transcriber) await prepareModel();
      const samples = await blobTo16kMono(blob);
      const result = await transcriber(samples, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      text = cleanText(result?.text);
      source = 'whisper-local';
      rawTranscript = text;
    }

    if (text) {
      await appendAnswerTurn({
        questionId,
        speakerId,
        text,
        source,
        rawTranscript,
        durationSeconds
      });
      ui.recordState.textContent = `Propos enregistré · ${participantById(speakerId)?.name || 'locuteur'}`;
      ui.answerText.value = '';
      ui.answerMeta.textContent = '';
      composerRawTranscript = null;
      composerSource = 'keyboard';
      composerDurationSeconds = 0;
    } else {
      ui.recordState.textContent = 'Aucun texte reconnu';
      showError(ui.interviewError, 'Aucun texte n’a été reconnu pour cette prise de parole.');
    }
  } catch (error) {
    diagnosticError = String(error?.message || error);
    showError(ui.interviewError, `La transcription a échoué : ${error.message || error}`);
    ui.recordState.textContent = 'Transcription en échec';
  } finally {
    chunks = [];
    show(ui.transcribing, false);
    ui.addTurnBtn.disabled = false;
    ui.validateBtn.disabled = false;
    recordingSpeakerId = null;
    recordingQuestionId = null;
    recorder = null;
    captureFinalizing = false;
    const keepMicrophoneOpen = Boolean(nextSpeakerId && participantById(nextSpeakerId));
    if (!keepMicrophoneOpen) {
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
    }
    try { resolveRecordingCompletion?.(); } catch {}
    resolveRecordingCompletion = null;
    recordingCompletionPromise = null;
    if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';
    ui.timer.textContent = '00:00';
    renderSpeakerButtons();
    renderQuestionNav();

    if (nextSpeakerId && participantById(nextSpeakerId)) {
      await selectSpeaker(nextSpeakerId);
      await startRecording(nextSpeakerId, nextQuestionId);
    }
  }
}
async function startInterview() {
  session = newSession();
  await persistSession();
  renderQuestion();
}
async function resumeInterview() {
  if (!session) return;
  interview = normalizeSpec(session.interviewSpec || interview);
  session.interviewSpec = clone(interview);
  if (!Array.isArray(session.participants) || !session.participants.length) session.participants = clone(interview.participants);
  if (!session.participantHistory || typeof session.participantHistory !== 'object') {
    session.participantHistory = Object.fromEntries(session.participants.map(p => [p.id, { ...clone(p), removedAt: null }]));
    for (const response of Object.values(session.responses || {})) {
      for (const turn of response.turns || []) {
        if (!turn.speakerId || session.participantHistory[turn.speakerId]) continue;
        session.participantHistory[turn.speakerId] = {
          id: turn.speakerId,
          name: turn.speakerNameSnapshot || turn.speakerId,
          role: turn.speakerRoleSnapshot || 'other',
          removedAt: null
        };
      }
    }
  }
  if (!session.responses || typeof session.responses !== 'object') session.responses = {};
  if (!session.questionSeconds || typeof session.questionSeconds !== 'object') session.questionSeconds = {};
  if (!Number.isFinite(Number(session.activeSeconds))) session.activeSeconds = 0;
  if (typeof session.paused !== 'boolean') session.paused = false;
  session.paused = false;
  if (session.completed) finishInterview(); else renderQuestion();
}

async function copyAuthoringKit() {
  ui.copyAuthoringKitBtn.disabled = true;
  ui.authoringKitStatus.textContent = 'Chargement du kit…';
  try {
    const response = await fetch('./INTERVIEW_AUTHORING_KIT.md');
    if (!response.ok) throw new Error('Kit IA introuvable');
    const text = await response.text();
    try {
      await navigator.clipboard.writeText(text);
      ui.authoringKitStatus.textContent = 'Instructions copiées. Collez-les dans votre IA avec votre contexte.';
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand?.('copy') || false;
      area.remove();
      ui.authoringKitStatus.textContent = copied ? 'Instructions copiées.' : 'Copie automatique refusée : téléchargez le kit IA.';
    }
  } catch (error) {
    ui.authoringKitStatus.textContent = `Impossible de copier le kit : ${error.message || error}`;
  } finally {
    ui.copyAuthoringKitBtn.disabled = false;
  }
}

async function copyDiagnosticReport() {
  const report = {
    schema: 'offline-interview.diagnostic.v2',
    build: BUILD_ID,
    generatedAt: nowIso(),
    privacy: 'No audio or interview answer text included.',
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      crossOriginIsolated: window.crossOriginIsolated
    },
    app: {
      interviewSchema: interview?.schema || null,
      interviewId: interview?.id || null,
      sessionPresent: Boolean(session),
      serviceWorkerController: navigator.serviceWorker?.controller?.scriptURL || null,
      modelReady: Boolean(transcriber),
      systemSpeech: systemSpeechCapability,
      systemSpeechLastError: systemSpeechSession?.snapshot?.().lastError || null,
      lastError: diagnosticError
    },
    storage: navigator.storage?.estimate ? await navigator.storage.estimate() : null
  };
  const text = `OFFLINE_INTERVIEW_DIAGNOSTIC\n${JSON.stringify(report, null, 2)}`;
  ui.diagnosticOutput.value = text;
  show(ui.diagnosticOutput, true);
  try {
    await navigator.clipboard.writeText(text);
    ui.copyDiagStatus.textContent = 'Diagnostic copié.';
  } catch {
    ui.copyDiagStatus.textContent = 'Copiez manuellement le rapport ci-dessous.';
  }
}

async function init() {
  ui.diagBuild.textContent = BUILD_ID;
  updateNetwork();
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  db = await openDb();

  const [savedSpec, savedSession] = await Promise.all([dbGet(SPEC_KEY), dbGet(STATE_KEY)]);
  if (savedSpec) {
    try { interview = normalizeSpec(savedSpec); } catch { interview = null; }
  }
  if (!interview) {
    interview = normalizeSpec(await fetch('./interview.json').then(r => {
      if (!r.ok) throw new Error('Questionnaire par défaut introuvable');
      return r.json();
    }));
    await persistSpec();
  }
  if (savedSession && savedSession.interviewId === interview.id && savedSession.interviewVersion === interview.version) {
    session = savedSession;
  }

  await Promise.allSettled([registerServiceWorker(), requestPersistentStorage(), detectRuntimeSystemSpeech()]);
  renderSetup();
}

ui.interviewFile.addEventListener('change', () => {
  const file = ui.interviewFile.files?.[0];
  if (file) loadInterviewFile(file);
});
ui.setupAddParticipantBtn.addEventListener('click', addParticipant);
ui.interviewAddParticipantBtn.addEventListener('click', addParticipant);
ui.prepareBtn.addEventListener('click', () => prepareModel().catch(() => {}));
ui.startBtn.addEventListener('click', startInterview);
ui.resumeBtn.addEventListener('click', resumeInterview);
ui.homeBtn.addEventListener('click', returnToSetup);
ui.addTurnBtn.addEventListener('click', async () => {
  const added = await addComposerTurn();
  if (!added) showError(ui.interviewError, 'La prise de parole est vide.');
  else showError(ui.interviewError);
});
ui.clearComposerBtn.addEventListener('click', resetComposer);
ui.addAdHocFollowUpBtn.addEventListener('click', async () => {
  const text = cleanText(ui.adHocFollowUpText.value);
  if (!text) return;
  await addFollowUpTurn(text, `adhoc-${uuid('followup')}`, 'ad_hoc');
  ui.adHocFollowUpText.value = '';
});
ui.adHocFollowUpText.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); ui.addAdHocFollowUpBtn.click(); }
});
ui.validateBtn.addEventListener('click', goNextQuestion);
ui.prevBtn.addEventListener('click', goPrevious);
ui.pauseBtn?.addEventListener('click', togglePause);
ui.sidebarFinishBtn?.addEventListener('click', completeInterview);
ui.reviewBtn.addEventListener('click', async () => {
  session.completed = false;
  session.completedAt = null;
  session.currentIndex = 0;
  await persistSession();
  renderQuestion();
});
ui.exportTxtBtn.addEventListener('click', exportTxt);
ui.exportJsonBtn.addEventListener('click', exportJson);
ui.newSessionBtn.addEventListener('click', resetSession);
ui.copyDiagBtn.addEventListener('click', copyDiagnosticReport);
ui.copyAuthoringKitBtn.addEventListener('click', copyAuthoringKit);

document.addEventListener('keydown', event => {
  if (ui.interviewView?.classList.contains('hidden')) return;
  if (event.key === 'Escape' && isRecording()) {
    event.preventDefault();
    queuedSpeakerId = null;
    stopRecording();
    return;
  }
  if (!event.altKey) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    goNextQuestion();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    goPrevious();
  }
});
ui.answerText.addEventListener('input', () => {
  if (composerSource !== 'speech') composerSource = 'keyboard';
});

window.addEventListener('error', event => { diagnosticError = String(event.error?.message || event.message || 'window error'); });
window.addEventListener('unhandledrejection', event => { diagnosticError = String(event.reason?.message || event.reason || 'unhandled rejection'); });

init().catch(error => {
  diagnosticError = String(error?.message || error);
  showError(ui.setupError, `Initialisation impossible : ${error.message || error}`);
});
