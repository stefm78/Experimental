const POLICY_ID = 'offline-interview.v41.22.core-product-stabilization';
const MISSING_SYSTEM_TEXT = 'La transcription système n’a rien renvoyé.';
const CALM_TEXT = 'Transcription en direct indisponible pour cette prise. L’audio a bien été enregistré : vous pouvez continuer l’entretien et le réécouter.';

document.documentElement.dataset.transcriptionPolicy = POLICY_ID;
let networkDegraded = false;

function suppressSavedAudioAction(root = document) {
  for (const button of root.querySelectorAll?.('.turn-retranscribe-button') || []) {
    button.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-hidden', 'true');
    button.dataset.v4122Suppressed = 'saved-audio-unqualified';
  }
}

function calmMissingLiveMessage(root = document) {
  const error = root.querySelector?.('#interviewError') || (root.id === 'interviewError' ? root : null);
  if (!error) return;
  const text = String(error.textContent || '');
  if (!text.includes(MISSING_SYSTEM_TEXT)) return;
  error.textContent = CALM_TEXT;
  error.classList.remove('error');
  error.classList.add('capture-integrity-alert');
  error.dataset.v4122LiveDegraded = networkDegraded ? 'network' : 'no-result';
  error.setAttribute('role', 'status');
}

function applyPolicy(root = document) {
  suppressSavedAudioAction(root);
  calmMissingLiveMessage(root);
}

window.addEventListener('offline-interview-stt-degraded', event => {
  if (event?.detail?.reason === 'network') networkDegraded = true;
  document.documentElement.dataset.liveTranscription = 'degraded';
  applyPolicy();
});

applyPolicy();
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') {
      applyPolicy(record.target.parentElement || document);
      continue;
    }
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) applyPolicy(node);
      else if (node.parentElement) applyPolicy(node.parentElement);
    }
  }
  applyPolicy();
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

console.info('[Offline Interview V41.22]', POLICY_ID, 'audio authoritative; LIVE best-effort; answer evidence includes valid audio.');
