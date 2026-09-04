from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
style_path = root / 'offline-interview' / 'styles.css'
sw_path = root / 'offline-interview' / 'sw.js'


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# --- app.js: keep V29 capture mechanics, add responsive navigation only ---
app = app_path.read_text(encoding='utf-8')
app = once(app, "const BUILD_ID = '2026-09-04.interview-runtime-v29';", "const BUILD_ID = '2026-09-04.interview-runtime-v30';", 'build id')
app = once(
    app,
    "  questionSidebar: $('questionSidebar'), sidebarInterviewTitle: $('sidebarInterviewTitle'), sidebarProgressSummary: $('sidebarProgressSummary'), sidebarTimeSummary: $('sidebarTimeSummary'), sidebarTimeProgress: $('sidebarTimeProgress'), questionNav: $('questionNav'), pauseBtn: $('pauseBtn'), sidebarFinishBtn: $('sidebarFinishBtn'), interviewProgressSummary: $('interviewProgressSummary'), timeProgressLabel: $('timeProgressLabel'), timeProgress: $('timeProgress'), sessionClockText: $('sessionClockText'), sessionRemainingText: $('sessionRemainingText'), topOnAir: $('topOnAir'), topOnAirSpeaker: $('topOnAirSpeaker'),",
    "  questionSidebar: $('questionSidebar'), sidebarInterviewTitle: $('sidebarInterviewTitle'), sidebarProgressSummary: $('sidebarProgressSummary'), sidebarTimeSummary: $('sidebarTimeSummary'), sidebarTimeProgress: $('sidebarTimeProgress'), questionNav: $('questionNav'), mobileQuestionSelect: $('mobileQuestionSelect'), mobileInterviewParticipants: $('mobileInterviewParticipants'), mobileAddParticipantBtn: $('mobileAddParticipantBtn'), pauseBtn: $('pauseBtn'), sidebarFinishBtn: $('sidebarFinishBtn'), interviewProgressSummary: $('interviewProgressSummary'), timeProgressLabel: $('timeProgressLabel'), timeProgress: $('timeProgress'), sessionClockText: $('sessionClockText'), sessionRemainingText: $('sessionRemainingText'), topOnAir: $('topOnAir'), topOnAirSpeaker: $('topOnAirSpeaker'),",
    'mobile ui refs')
app = once(
    app,
    "function renderParticipantsEverywhere(skip = null) {\n  if (ui.setupParticipants !== skip) renderParticipantEditor(ui.setupParticipants);\n  if (session && ui.interviewParticipants !== skip) renderParticipantEditor(ui.interviewParticipants);\n}",
    "function renderParticipantsEverywhere(skip = null) {\n  if (ui.setupParticipants !== skip) renderParticipantEditor(ui.setupParticipants);\n  if (session && ui.interviewParticipants !== skip) renderParticipantEditor(ui.interviewParticipants);\n  if (session && ui.mobileInterviewParticipants && ui.mobileInterviewParticipants !== skip) renderParticipantEditor(ui.mobileInterviewParticipants);\n}",
    'mobile participants render')

marker = "  }\n}\n\n\nasync function rotateLiveSegment"
insert = """  }\n  if (ui.mobileQuestionSelect) {\n    ui.mobileQuestionSelect.innerHTML = '';\n    flattenedQuestions().forEach((entry, index) => {\n      const option = document.createElement('option');\n      option.value = String(index);\n      const answered = questionHasAnswer(entry.question.id);\n      option.textContent = `${index + 1}. ${questionNavLabel(entry.question)}${answered ? ' ✓' : ''}`;\n      option.selected = index === session.currentIndex;\n      ui.mobileQuestionSelect.append(option);\n    });\n  }\n}\n\n\nasync function rotateLiveSegment"""
app = once(app, marker, insert, 'mobile question select render')
app = once(app,
    "ui.interviewAddParticipantBtn.addEventListener('click', addParticipant);",
    "ui.interviewAddParticipantBtn.addEventListener('click', addParticipant);\nui.mobileAddParticipantBtn?.addEventListener('click', addParticipant);\nui.mobileQuestionSelect?.addEventListener('change', event => {\n  const index = Number(event.target.value);\n  if (Number.isInteger(index)) goToQuestion(index);\n});",
    'mobile nav listeners')
app = app.replace("register('./sw.js?v=29'", "register('./sw.js?v=30'")
app = app.replace("'actif · v29'", "'actif · v30'")
app = app.replace("'installé · v29'", "'installé · v30'")
app_path.write_text(app, encoding='utf-8')

# --- index.html: compact navigation for layouts where the sidebar disappears ---
index = index_path.read_text(encoding='utf-8')
nav_markup = '''\n          <div class="compact-interview-nav" aria-label="Navigation compacte dans l’entretien">\n            <label class="sr-only" for="mobileQuestionSelect">Aller à une question</label>\n            <select id="mobileQuestionSelect" class="mobile-question-select" aria-label="Aller directement à une question"></select>\n            <details class="mobile-participants-panel">\n              <summary>Participants</summary>\n              <div id="mobileInterviewParticipants" class="participant-list"></div>\n              <button id="mobileAddParticipantBtn" class="ghost small" type="button">+ Ajouter</button>\n            </details>\n          </div>\n'''
index = once(index,
    '          <progress id="questionProgress" class="question-progress-mobile" max="5" value="1"></progress>\n\n          <p id="questionText" class="question"></p>',
    '          <progress id="questionProgress" class="question-progress-mobile" max="5" value="1"></progress>\n' + nav_markup + '\n          <p id="questionText" class="question"></p>',
    'compact nav insertion')

# Move capture ahead of history/manual controls. It remains in normal document flow and may
# be sticky, avoiding a fixed overlay while keeping capture directly beneath the question.
m = re.search(r'\n        <section id="captureDock" class="capture-dock".*?\n        </section>\n', index, flags=re.S)
if not m:
    raise RuntimeError('capture dock block not found')
capture = m.group(0)
index = index[:m.start()] + '\n' + index[m.end():]
needle = '        <div class="conversation-scroll">\n'
if index.count(needle) != 1:
    raise RuntimeError('conversation scroll insertion point not unique')
index = index.replace(needle, capture + '\n' + needle, 1)
index = once(index, '<script type="module" src="./app.js?v=29"></script>', '<script type="module" src="./app.js?v=30"></script>', 'app cache query')
index_path.write_text(index, encoding='utf-8')

# --- CSS: one responsive hierarchy below 980 px; no fixed capture overlay ---
styles = style_path.read_text(encoding='utf-8')
styles += r'''

/* V30 — responsive interview hierarchy. V29 capture semantics are deliberately unchanged. */
.compact-interview-nav{display:none}
@media(max-width:979px){
  .interview-mode .shell{width:min(860px,100%)!important;padding:8px!important;min-height:0!important}
  .interview-layout{display:block!important}
  .question-sidebar{display:none!important}
  .interview-main{min-height:0!important;border-radius:14px!important;padding:16px 14px 22px!important;margin:0!important}
  .question-sticky{position:relative!important;top:auto!important;z-index:auto!important;background:#fff;padding-bottom:8px;border-bottom:1px solid #edf1f5}
  .mobile-only-metrics{display:flex!important}
  .time-progress.mobile-only-metrics{display:block!important}
  .question-progress-mobile{display:block!important}
  .compact-interview-nav{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;margin:10px 0 4px}
  .mobile-question-select{width:100%;min-width:0;border:1px solid #cfd9e7;border-radius:10px;background:#fff;padding:9px 10px;font-weight:700;color:#334155}
  .mobile-participants-panel{position:relative;border:1px solid #dbe3ef;border-radius:10px;background:#fff;padding:8px 10px}
  .mobile-participants-panel>summary{cursor:pointer;font-weight:800;white-space:nowrap;color:#475569}
  .mobile-participants-panel[open]{grid-column:1/-1}
  .mobile-participants-panel .participant-list{margin:10px 0}
  .question{font-size:clamp(1.35rem,4vw,1.85rem)!important;line-height:1.3!important;margin:18px 0 10px!important}
  .question.question-long,.question.question-very-long{font-size:clamp(1.15rem,3.2vw,1.5rem)!important;max-height:min(30vh,260px)!important;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:8px}
  .capture-dock{position:sticky!important;left:auto!important;right:auto!important;bottom:8px!important;margin:12px 0!important;max-height:min(44vh,360px);overflow:hidden;z-index:20}
  .live-transcript{max-height:min(13vh,112px)!important;min-height:52px!important;overflow-y:auto!important}
  .conversation-scroll{overflow:visible!important}
  .manual-entry{margin:14px 0!important}
  .interview-nav-actions{position:static!important;margin-top:14px!important;padding-top:12px!important}
}
@media(max-width:640px){
  .question-header{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
  .interview-clock{justify-content:space-between;flex-wrap:wrap}
  .compact-interview-nav{grid-template-columns:1fr}
  .mobile-participants-panel[open]{grid-column:auto}
  .question.question-long,.question.question-very-long{max-height:min(27vh,220px)!important}
  .capture-dock{bottom:4px!important;padding:10px!important;max-height:min(46vh,330px)}
  .live-transcript{max-height:88px!important}
  .speaker-buttons{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important}
  .speaker-button{min-width:0!important;padding:10px 7px!important;white-space:normal!important;line-height:1.15!important}
  .capture-state-row{gap:8px!important}
  .timer{font-size:1.15rem!important}
}
'''
style_path.write_text(styles, encoding='utf-8')

# --- service worker identity ---
sw = sw_path.read_text(encoding='utf-8')
sw = once(sw, "const VERSION = 'offline-interview-v29';", "const VERSION = 'offline-interview-v30';", 'sw version')
sw = once(sw, "'./', './index.html', './styles.css', './app.js?v=29', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=30', './system-stt.js',", 'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V30 responsive shell patch applied')
