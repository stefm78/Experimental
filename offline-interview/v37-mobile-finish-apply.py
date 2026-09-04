from pathlib import Path
import json

root = Path('offline-interview')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old, new, 1)

app_path = root / 'app.js'
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "const BUILD_ID = '2026-09-04.interview-runtime-v36';",
    "const BUILD_ID = '2026-09-04.interview-runtime-v37';",
    'build id'
)
app = replace_once(
    app,
    "pauseBtn: $('pauseBtn'), sidebarFinishBtn: $('sidebarFinishBtn'),",
    "pauseBtn: $('pauseBtn'), mobileFinishBtn: $('mobileFinishBtn'), sidebarFinishBtn: $('sidebarFinishBtn'),",
    'ui mobile finish'
)
app = replace_once(
    app,
    "ui.pauseBtn?.addEventListener('click', togglePause);\nui.moveCaptureBtn?.addEventListener('click', moveRecordingToViewedQuestion);",
    "ui.pauseBtn?.addEventListener('click', togglePause);\nui.mobileFinishBtn?.addEventListener('click', completeInterview);\nui.moveCaptureBtn?.addEventListener('click', moveRecordingToViewedQuestion);",
    'mobile finish event'
)
app_path.write_text(app, encoding='utf-8')

index_path = root / 'index.html'
index = index_path.read_text(encoding='utf-8')
index = replace_once(index, './styles.css?v=36', './styles.css?v=37', 'styles cache key')
index = replace_once(index, './app.js?v=36', './app.js?v=37', 'app cache key')
index = replace_once(
    index,
    '              <button id="pauseBtn" class="ghost small clock-button" type="button" aria-pressed="false">Ⅱ Pause</button>\n              <button id="homeBtn" class="ghost small home-button" title="Revenir à l’accueil" aria-label="Revenir à l’accueil">Accueil</button>',
    '              <button id="pauseBtn" class="ghost small clock-button" type="button" aria-pressed="false">Ⅱ Pause</button>\n              <button id="mobileFinishBtn" class="ghost small mobile-finish-button" type="button" title="Terminer l’entretien" aria-label="Terminer l’entretien et accéder à l’export">Terminer</button>\n              <button id="homeBtn" class="ghost small home-button" title="Revenir à l’accueil" aria-label="Revenir à l’accueil">Accueil</button>',
    'mobile finish button'
)
index_path.write_text(index, encoding='utf-8')

styles_path = root / 'styles.css'
styles = styles_path.read_text(encoding='utf-8')
marker = '/* V37 always-visible mobile completion */'
if marker in styles:
    raise SystemExit('V37 styles already present')
styles += "\n\n/* V37 always-visible mobile completion */\n.mobile-finish-button{display:none}\n@media(max-width:759px){.mobile-finish-button{display:inline-flex;align-items:center;justify-content:center;padding:7px 10px;white-space:nowrap;border-color:#a9b8cc;background:#fff;color:#172554}.mobile-finish-button:focus-visible{outline:3px solid rgba(37,99,235,.24);outline-offset:2px}}\n@media(max-width:420px){.mobile-finish-button{padding:7px 8px}.interview-clock{row-gap:6px}}\n"
styles_path.write_text(styles, encoding='utf-8')

sw_path = root / 'sw.js'
sw = sw_path.read_text(encoding='utf-8')
sw = replace_once(sw, "const VERSION = 'offline-interview-v36';", "const VERSION = 'offline-interview-v37';", 'sw version')
sw = replace_once(sw, "'./styles.css?v=36', './app.js?v=36'", "'./styles.css?v=37', './app.js?v=37'", 'sw assets')
sw_path.write_text(sw, encoding='utf-8')

spec = {
  "schema": "offline-interview.interview-spec.v1",
  "id": "test-ux-v37-mobile-finish",
  "version": "1.0",
  "title": "Test UX V37 — terminer en fenêtre très étroite",
  "context": "V36 est globalement validée mais, en fenêtre très étroite, l'action de fin d'entretien pouvait devenir inaccessible alors qu'Accueil restait visible. L'utilisateur devait élargir la fenêtre pour terminer et atteindre l'écran d'export.",
  "objective": "Vérifier que Terminer reste directement accessible en fenêtre très étroite, y compris pendant une prise de parole, et qu'il conduit correctement à l'écran d'export sans devoir élargir la fenêtre.",
  "language": "fr-FR",
  "tags": ["ux", "v37", "responsive", "completion", "export"],
  "estimatedDurationMinutes": 1,
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Testeur", "role": "interviewee"}
  ],
  "sections": [
    {
      "id": "S1",
      "title": "Fin d'entretien",
      "questions": [
        {
          "id": "Q1",
          "label": "Terminer sans élargir",
          "text": "Réduisez la fenêtre à une largeur très étroite. Vérifiez que le bouton « Terminer » reste visible dans l'en-tête à côté des commandes d'entretien. Lancez une courte prise de parole puis, sans élargir la fenêtre, utilisez « Terminer ». Confirmez si nécessaire. Vérifiez que la prise est finalisée, que l'écran « Entretien terminé » apparaît et que « Exporter pour une IA » est accessible. Dites simplement si le parcours fonctionne de bout en bout sans passer par Accueil ni agrandir la fenêtre.",
          "intent": "Fermer le défaut bloquant V36 : impossibilité pratique de terminer depuis une fenêtre très étroite.",
          "estimatedMinutes": 1,
          "required": True,
          "audience": ["P2"],
          "followUps": []
        }
      ]
    }
  ]
}
(root / 'test-interviews' / 'interview-test-ux-v37.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('V37 patch applied')
