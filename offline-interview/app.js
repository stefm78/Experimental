import { detectSystemSpeech, createSystemSpeechSession } from './system-stt.js';

const BUILD_ID = '2026-09-03.interview-runtime-v18';
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
  setupView: $('setupView'), interviewView: $('interviewView'), doneView: $('doneView'), sttLabCard: $('sttLabCard'), authoringKitCard: $('authoringKitCard'),
  networkBadge: $('networkBadge'), setupTitle: $('setupTitle'), setupContext: $('setupContext'), setupObjective: $('setupObjective'),
  interviewFile: $('interviewFile'), loadError: $('loadError'), setupParticipants: $('setupParticipants'), setupAddParticipantBtn: $('setupAddParticipantBtn'),
  swStatus: $('swStatus'), storageStatus: $('storageStatus'), modelStatus: $('modelStatus'), progressBlock: $('progressBlock'), progressLabel: $('progressLabel'), progressValue: $('progressValue'), modelProgress: $('modelProgress'), setupError: $('setupError'),
  prepareBtn: $('prepareBtn'), startBtn: $('startBtn'), resumeBtn: $('resumeBtn'),
  sectionTitle: $('sectionTitle'), questionCounter: $('questionCounter'), questionProgress: $('questionProgress'), questionText: $('questionText'), questionIntent: $('questionIntent'),
  questionSidebar: $('questionSidebar'), sidebarInterviewTitle: $('sidebarInterviewTitle'), sidebarTimeSummary: $('sidebarTimeSummary'), questionNav: $('questionNav'), pauseBtn: $('pauseBtn'), sidebarFinishBtn: $('sidebarFinishBtn'), interviewProgressSummary: $('interviewProgressSummary'), timeProgressLabel: $('timeProgressLabel'), timeProgress: $('timeProgress'),
  interviewParticipants: $('interviewParticipants'), interviewAddParticipantBtn: $('interviewAddParticipantBtn'), speakerButtons: $('speakerButtons'), activeSpeakerLabel: $('activeSpeakerLabel'),
  turnsSection: $('turnsSection'), turnsList: $('turnsList'),
  recordState: $('recordState'), timer: $('timer'), recordBtn: $('recordBtn'), stopBtn: $('stopBtn'), transcribing: $('transcribing'),
  answerText: $('answerText'), answerMeta: $('answerMeta'), composerSpeaker: $('composerSpeaker'), addTurnBtn: $('addTurnBtn'), clearComposerBtn: $('clearComposerBtn'),
  followUpsPanel: $('followUpsPanel'), followUpsSummary: $('followUpsSummary'), plannedFollowUps: $('plannedFollowUps'), adHocFollowUpText: $('adHocFollowUpText'), addAdHocFollowUpBtn: $('addAdHocFollowUpBtn'),
  interviewError: $('interviewError'), prevBtn: $('prevBtn'), validateBtn: $('validateBtn'), homeBtn: $('homeBtn'),
  doneSummary: $('doneSummary'), reviewBtn: $('reviewBtn'), exportTxtBtn: $('exportTxtBtn'), exportJsonBtn: $('exportJsonBtn'), newSessionBtn: $('newSessionBtn'),
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
  if (session && !session.activeSpeakerId) session.activeSpeakerId = participant.id;
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
      const used = session ? Object.values(session.responses || {}).some(r => (r.turns || []).some(t => t.speakerId === participant.id)) : false;
      if (used && !confirm(`${participant.name} est déjà associé à des prises de parole. Supprimer quand même ce participant ?`)) return;
      const arr = participantsSource();
      const index = arr.findIndex(p => p.id === participant.id);
      if (index >= 0) arr.splice(index, 1);
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
  if (entry) session.questionSeconds[entry.question.id] = activeQuestionSeconds(entry.question.id) + delta;
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
  if (ui.timeProgressLabel) ui.timeProgressLabel.textContent = elapsedMinutesLabel(elapsedSeconds) + ' écoulées · ~' + Math.max(0, Math.round(remaining)) + ' min prévues restantes';
  if (ui.sidebarTimeSummary) ui.sidebarTimeSummary.textContent = elapsedMinutesLabel(elapsedSeconds) + ' / ~' + Math.round(totalEstimate) + ' min';
  if (ui.timeProgress) {
    ui.timeProgress.max = Math.max(1, totalEstimate);
    ui.timeProgress.value = Math.min(totalEstimate, elapsedMinutes);
  }
  if (ui.pauseBtn) {
    ui.pauseBtn.textContent = session.paused ? '▶ Reprendre' : 'Ⅱ Pause';
    ui.pauseBtn.setAttribute('aria-pressed', session.paused ? 'true' : 'false');
  }
}

function questionNavLabel(question) {
  const explicit = cleanText(question.label);
  if (explicit) return explicit;
  const text = cleanText(question.text);
  return text.length > 46 ? text.slice(0, 43) + '…' : text;
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
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'question-nav-item' + (answered ? ' answered' : '') + (current ? ' current' : '');
      if (current) row.setAttribute('aria-current', 'step');
      const state = document.createElement('span');
      state.className = 'question-nav-state';
      state.textContent = current ? '●' : answered ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'question-nav-label';
      label.textContent = (index + 1) + '. ' + questionNavLabel(question);
      const duration = document.createElement('span');
      duration.className = 'question-nav-duration';
      const spent = activeQuestionSeconds(question.id);
      duration.textContent = spent >= 30 ? elapsedMinutesLabel(spent) : '~' + estimatedQuestionMinutes(question) + ' min';
      row.append(state, label, duration);
      row.addEventListener('click', () => goToQuestion(index));
      group.append(row);
    }
    ui.questionNav.append(group);
  }
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
  await addComposerTurn();
  session.currentIndex = index;
  session.completed = false;
  session.completedAt = null;
  session.updatedAt = nowIso();
  sessionClockLastMs = Date.now();
  await persistSession();
  renderQuestion();
}

async function completeInterview() {
  if (!session) return;
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
  ui.setupContext.textContent = interview.context || 'Aucun contexte renseigné.';
  ui.setupObjective.textContent = interview.objective ? `Objectif : ${interview.objective} · ~${Math.round(estimatedTotalMinutes())} min` : `Durée prévue : ~${Math.round(estimatedTotalMinutes())} min`;
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

function renderSpeakerButtons() {
  const participants = participantsSource();
  if (!participants.length) return;
  if (!participantById(session.activeSpeakerId)) session.activeSpeakerId = defaultActiveSpeakerId();
  ui.speakerButtons.innerHTML = '';
  for (const participant of participants) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `speaker-button ${participant.id === session.activeSpeakerId ? 'active' : ''}`;
    button.textContent = participant.name;
    button.title = roleLabel(participant.role);
    button.addEventListener('click', async () => {
      session.activeSpeakerId = participant.id;
      session.updatedAt = nowIso();
      await persistSession();
      renderSpeakerButtons();
      updateComposerSpeaker();
    });
    ui.speakerButtons.append(button);
  }
  const active = participantById(session.activeSpeakerId);
  ui.activeSpeakerLabel.textContent = active ? `${active.name} · ${roleLabel(active.role)}` : '';
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
  ui.recordState.textContent = 'Prêt à enregistrer';
  ui.timer.textContent = '00:00';
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
  ui.questionIntent.textContent = question.intent ? 'Pourquoi cette question : ' + question.intent : '';
  show(ui.questionIntent, Boolean(question.intent));
  ui.prevBtn.disabled = session.currentIndex === 0;
  ui.validateBtn.textContent = session.currentIndex === all.length - 1 ? 'Terminer l’entretien' : 'Question suivante →';
  showError(ui.interviewError);
  resetComposer();
  renderTurns();
  renderFollowUps();
  renderQuestionNav();
  renderInterviewMetrics();
}

function createTurn(
function createTurn({ type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, followUpId = null, followUpKind = null }) {
  return {
    id: uuid('turn'),
    type,
    speakerId: speakerId || null,
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
async function addComposerTurn() {
  const entry = currentEntry();
  if (!entry) return false;
  const text = cleanText(ui.answerText.value);
  if (!text) return false;
  const response = responseFor(entry.question.id);
  response.turns.push(createTurn({
    type: 'answer',
    speakerId: session.activeSpeakerId,
    text,
    source: composerSource,
    rawTranscript: composerRawTranscript,
    durationSeconds: composerDurationSeconds
  }));
  response.status = 'draft';
  session.updatedAt = nowIso();
  await persistSession();
  resetComposer();
  renderTurns();
  renderQuestionNav();
  renderInterviewMetrics();
  return true;
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
    select.setAttribute('aria-label', 'Locuteur de la prise de parole');
    for (const p of participantsSource()) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} · ${roleLabel(p.role)}`;
      option.selected = p.id === turn.speakerId;
      select.append(option);
    }
    if (!participantById(turn.speakerId) && turn.speakerId) {
      const option = document.createElement('option');
      option.value = turn.speakerId;
      option.textContent = `${turn.speakerId} · participant supprimé`;
      option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      turn.speakerId = select.value;
      turn.updatedAt = nowIso();
      await persistSession();
    });

    const type = document.createElement('span');
    type.className = 'turn-type';
    type.textContent = turn.type === 'follow_up' ? (turn.followUpKind === 'ad_hoc' ? 'Relance spontanée' : 'Relance') : (turn.source === 'speech' ? 'Voix' : 'Texte');

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
    head.append(select, type, remove);

    const text = document.createElement('textarea');
    text.rows = turn.type === 'follow_up' ? 2 : 4;
    text.value = turn.text;
    text.addEventListener('change', async () => {
      turn.text = cleanText(text.value);
      turn.updatedAt = nowIso();
      text.value = turn.text;
      await persistSession();
    });

    const meta = document.createElement('p');
    meta.className = 'hint turn-meta';
    const bits = [];
    if (turn.durationSeconds) bits.push(`${Math.round(turn.durationSeconds)} s`);
    if (turn.createdAt) bits.push(new Date(turn.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    meta.textContent = bits.join(' · ');
    card.append(head, text, meta);
    ui.turnsList.append(card);
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
function finishInterview() {
  setView('done');
  const all = flattenedQuestions();
  const answered = all.filter(({ question }) => (session.responses[question.id]?.turns || []).some(t => t.type === 'answer' && cleanText(t.text))).length;
  const turns = Object.values(session.responses || {}).reduce((sum, r) => sum + (r.turns?.length || 0), 0);
  ui.doneSummary.textContent = `${answered} question${answered > 1 ? 's' : ''} répondue${answered > 1 ? 's' : ''} sur ${all.length} · ${turns} prise${turns > 1 ? 's' : ''} de parole structurée${turns > 1 ? 's' : ''}.`;
}

function exportPayload() {
  const participants = clone(session.participants || []);
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
          speakerName: p?.name || null,
          speakerRole: p?.role || null,
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
  for (const p of payload.participants) lines.push(`- ${p.name} (${roleLabel(p.role)})`);
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
    const reg = await navigator.serviceWorker.register('./sw.js?v=18', { scope: './' });
    await navigator.serviceWorker.ready;
    ui.swStatus.textContent = 'Mis en cache';
    ui.diagSw.textContent = reg.active ? 'actif · v18' : 'installé · v18';
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
    ui.modelStatus.textContent = transcriber ? 'Système local · secours prêt' : 'Système local · secours Whisper';
    if (ui.diagStt) ui.diagStt.textContent = 'Système local · Whisper secours';
    return;
  }
  if (systemSpeechCapability.mode === 'standard') {
    ui.modelStatus.textContent = transcriber ? 'Système · secours prêt' : 'Système · secours Whisper';
    if (ui.diagStt) ui.diagStt.textContent = 'Système (réseau possible) · Whisper secours';
    return;
  }
  ui.modelStatus.textContent = transcriber ? 'Whisper local prêt' : 'Whisper de secours';
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

function applySystemText({ text, finalText, mode }) {
  if (!text) return;
  ui.answerText.value = text;
  composerSource = mode === 'local' ? 'system-local' : 'system';
  composerRawTranscript = finalText || text;
  ui.answerMeta.textContent = mode === 'local'
    ? 'Transcription système locale · vérifiez puis ajoutez la prise de parole'
    : 'Transcription système · vérifiez puis ajoutez la prise de parole';
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
  ui.recordBtn.disabled = true;
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
    ui.recordBtn.disabled = false;
  }
}

function preferredMimeType() {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}
async function startRecording() {
  showError(ui.interviewError);
  try {
    try { systemSpeechSession?.abort(); } catch {}
    systemSpeechSession = null;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
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
      onState: state => {
        if (state === 'listening-local') ui.recordState.textContent = `Écoute système locale · ${participantById(session.activeSpeakerId)?.name || 'locuteur'}`;
        else if (state === 'listening') ui.recordState.textContent = `Écoute système · ${participantById(session.activeSpeakerId)?.name || 'locuteur'}`;
        else if (state === 'speech-local') ui.recordState.textContent = 'Transcription système locale…';
        else if (state === 'speech') ui.recordState.textContent = 'Transcription système…';
      },
      onError: error => { diagnosticError = `SpeechRecognition: ${error}`; }
    });
    const usingSystem = Boolean(systemSpeechSession?.start());

    startedRecordingAt = performance.now();
    ui.recordBtn.setAttribute('aria-pressed', 'true');
    show(ui.recordBtn, false);
    show(ui.stopBtn, true);
    if (!usingSystem) ui.recordState.textContent = `Enregistrement pour Whisper · ${participantById(session.activeSpeakerId)?.name || 'locuteur'}`;
    timerHandle = setInterval(() => { ui.timer.textContent = formatTime((performance.now() - startedRecordingAt) / 1000); }, 250);
  } catch (error) {
    diagnosticError = String(error?.message || error);
    showError(ui.interviewError, `Accès au microphone impossible : ${error.message || error}`);
  }
}
function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  composerDurationSeconds = (performance.now() - startedRecordingAt) / 1000;
  clearInterval(timerHandle);
  try { systemSpeechSession?.stop(); } catch {}
  ui.recordState.textContent = 'Finalisation…';
  show(ui.stopBtn, false);
  ui.recordBtn.setAttribute('aria-pressed', 'false');
  setTimeout(() => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    show(ui.recordBtn, true);
  }, 450);
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
  if (!chunks.length) return;
  ui.recordBtn.disabled = true;
  ui.addTurnBtn.disabled = true;
  ui.validateBtn.disabled = true;
  try {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const systemSnapshot = systemSpeechSession?.snapshot() || { text: '', finalText: '', mode: systemSpeechCapability.mode };
    const systemText = cleanText(systemSnapshot.text);

    if (systemText) {
      ui.answerText.value = systemText;
      composerSource = systemSnapshot.mode === 'local' ? 'system-local' : 'system';
      composerRawTranscript = systemSnapshot.finalText || systemText;
      ui.answerMeta.textContent = `${systemSnapshot.mode === 'local' ? 'Transcription système locale' : 'Transcription système'} · ${Math.round(composerDurationSeconds)} s · vérifiez puis ajoutez la prise de parole`;
      ui.recordState.textContent = 'Transcription terminée';
      return;
    }

    show(ui.transcribing, true);
    ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'
      ? 'Transcription Whisper locale…'
      : 'Aucun texte système · secours Whisper…';
    if (!transcriber) await prepareModel();
    const samples = await blobTo16kMono(blob);
    const result = await transcriber(samples, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const text = cleanText(result?.text);
    ui.answerText.value = text;
    composerSource = 'whisper-local';
    composerRawTranscript = text;
    ui.answerMeta.textContent = `Whisper local (secours) · ${Math.round(composerDurationSeconds)} s · vérifiez puis ajoutez la prise de parole`;
    ui.recordState.textContent = text ? 'Transcription terminée' : 'Aucun texte reconnu';
  } catch (error) {
    diagnosticError = String(error?.message || error);
    showError(ui.interviewError, `La transcription a échoué : ${error.message || error}`);
    ui.recordState.textContent = 'Transcription en échec';
  } finally {
    chunks = [];
    show(ui.transcribing, false);
    ui.recordBtn.disabled = false;
    ui.addTurnBtn.disabled = false;
    ui.validateBtn.disabled = false;
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
  if (!session.responses || typeof session.responses !== 'object') session.responses = {};
  if (!session.questionSeconds || typeof session.questionSeconds !== 'object') session.questionSeconds = {};
  if (!Number.isFinite(Number(session.activeSeconds))) session.activeSeconds = 0;
  if (typeof session.paused !== 'boolean') session.paused = false;
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
ui.homeBtn.addEventListener('click', async () => { flushSessionClock(); await addComposerTurn(); await persistSession(); renderSetup(); });
ui.recordBtn.addEventListener('click', startRecording);
ui.stopBtn.addEventListener('click', stopRecording);
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
ui.answerText.addEventListener('input', () => {
  if (composerSource !== 'speech') composerSource = 'keyboard';
});

window.addEventListener('error', event => { diagnosticError = String(event.error?.message || event.message || 'window error'); });
window.addEventListener('unhandledrejection', event => { diagnosticError = String(event.reason?.message || event.reason || 'unhandled rejection'); });

init().catch(error => {
  diagnosticError = String(error?.message || error);
  showError(ui.setupError, `Initialisation impossible : ${error.message || error}`);
});
