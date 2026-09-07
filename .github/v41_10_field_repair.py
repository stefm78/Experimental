from pathlib import Path
import json,re
APP=Path('offline-interview/app.js'); CSS=Path('offline-interview/styles.css'); INDEX=Path('offline-interview/index.html'); SW=Path('offline-interview/sw.js'); CONTRACT=Path('offline-interview/test-runtime-contract.mjs')
s=APP.read_text()
s=s.replace("const BUILD_ID = '2026-09-07.interview-runtime-v41.9';","const BUILD_ID = '2026-09-08.interview-runtime-v41.10';",1)
# Immediate control refresh after capture finalization: the prior render happened while captureFinalizing=true.
needle="""    recorder = null;
    captureFinalizing = false;
    const keepMicrophoneOpen = Boolean(nextSpeakerId && participantById(nextSpeakerId));
"""
repl="""    recorder = null;
    captureFinalizing = false;
    renderTurns();
    const keepMicrophoneOpen = Boolean(nextSpeakerId && participantById(nextSpeakerId));
"""
if needle not in s: raise SystemExit('finalize anchor missing')
s=s.replace(needle,repl,1)
# Provider-neutral audio -> text glyph with explicit directional arrow.
old='''    const transcriptionGlyph = stableRetranscription === 'succeeded' ? '✓' : stableRetranscription === 'failed' ? '×' : '<svg class="audio-to-text-svg" viewBox="0 0 28 18" aria-hidden="true"><path d="M2 9h2m2-4v8m3-11v14m3-9v4m4-5h10M16 10h10M16 14h7"/></svg>';
'''
new='''    const transcriptionGlyph = stableRetranscription === 'succeeded' ? '✓' : stableRetranscription === 'failed' ? '×' : '<svg class="audio-to-text-svg" viewBox="0 0 34 18" aria-hidden="true"><path d="M2 9h2m2-4v8m3-11v14m3-9v4"/><path class="audio-to-text-arrow" d="M16 9h6m-2-2 2 2-2 2"/><path d="M25 5h7M25 9h7M25 13h5"/></svg>';
'''
if old not in s: raise SystemExit('glyph anchor missing')
s=s.replace(old,new,1)
APP.write_text(s)

# Move microphone indicator beside ON AIR / clock; keep one DOM instance and pre-record microphone test capability.
i=INDEX.read_text()
i=i.replace('styles.css?v=41.9','styles.css?v=41.10').replace('app.js?v=41.9','app.js?v=41.10')
block='''          <div class="mic-meter-row">
            <button id="micPreviewBtn" class="ghost small mic-preview-button" type="button" aria-pressed="false">Tester le micro</button>
            <div class="mic-meter" role="meter" aria-label="Niveau du microphone" aria-valuemin="0" aria-valuemax="100">
              <span class="mic-meter-recommended" aria-hidden="true"></span>
              <span id="micMeterFill" class="mic-meter-fill" style="--level:0" aria-hidden="true"></span>
            </div>
            <span id="micMeterState" class="mic-meter-state" data-level-state="silence">Silence</span>
          </div>
'''
if block not in i: raise SystemExit('mic block missing')
i=i.replace(block,'',1)
anchor='''              <div id="topOnAir" class="top-on-air hidden" aria-live="polite">
                <strong>ON AIR</strong>
                <span id="topOnAirSpeaker"></span>
              </div>
'''
if anchor not in i: raise SystemExit('onair anchor missing')
i=i.replace(anchor,anchor+'''              <div class="mic-meter-row" aria-label="État du microphone">
                <button id="micPreviewBtn" class="ghost small mic-preview-button" type="button" aria-pressed="false">Micro</button>
                <div class="mic-meter" role="meter" aria-label="Niveau du microphone" aria-valuemin="0" aria-valuemax="100">
                  <span class="mic-meter-recommended" aria-hidden="true"></span>
                  <span id="micMeterFill" class="mic-meter-fill" style="--level:0" aria-hidden="true"></span>
                </div>
                <span id="micMeterState" class="mic-meter-state" data-level-state="silence">Silence</span>
              </div>
''',1)
INDEX.write_text(i)
SW.write_text(SW.read_text().replace('41.9','41.10'))

# Replace only V41.9 component definitions, no override stacking.
css=CSS.read_text()
repls={
'.mic-meter-row{display:flex;align-items:center;gap:7px;min-height:30px}':'.mic-meter-row{display:flex;align-items:center;gap:6px;min-height:30px;align-self:center}',
'.mic-preview-button{position:relative;padding:6px 9px 6px 22px!important;min-height:30px;border-radius:999px!important;font-size:.76rem!important;color:#52627a!important;background:#f8fafc!important}':'.mic-preview-button{position:relative;padding:5px 8px 5px 20px!important;min-height:30px;border-radius:999px!important;font-size:.74rem!important;color:#52627a!important;background:#f8fafc!important}',
'.mic-meter{position:relative;width:42px;height:4px;border-radius:999px;background:#e5eaf0;overflow:hidden;flex:none}':'.mic-meter{position:relative;width:5px;height:28px;border-radius:999px;background:#e5eaf0;overflow:hidden;flex:none}',
'.mic-meter-fill{position:absolute;inset:0 auto 0 0;width:calc(var(--level,0)*100%);background:#70849a;transition:width .18s ease-out}':'.mic-meter-fill{position:absolute;inset:auto 0 0 0;height:calc(var(--level,0)*100%);background:#70849a;transition:height .18s ease-out}',
'.mic-meter-recommended{position:absolute;left:68%;top:0;bottom:0;width:1px;background:#334155;opacity:.35;z-index:2}':'.mic-meter-recommended{position:absolute;left:0;right:0;bottom:68%;height:1px;background:#334155;opacity:.35;z-index:2}',
'.turn-retranscribe-button{display:inline-grid;place-items:center;width:30px;height:30px;min-width:30px;padding:0!important;border-radius:9px!important}':'.turn-retranscribe-button{display:inline-grid;place-items:center;width:34px;height:34px;min-width:34px;padding:0!important;border-radius:9px!important}',
'.audio-to-text-svg{width:19px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}':'.audio-to-text-svg{width:23px;height:14px;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}.audio-to-text-arrow{stroke-width:1.35}'
}
for a,b in repls.items():
    if a not in css: raise SystemExit('css anchor missing: '+a[:30])
    css=css.replace(a,b,1)
css=css.replace('@media(max-width:560px){.mic-meter-row{gap:6px}.mic-meter{width:34px}.mic-meter-state{min-width:30px}.turn-retranscribe-button{width:34px;height:34px}}','@media(max-width:560px){.mic-meter-row{gap:5px}.mic-meter{width:5px;height:26px}.mic-meter-state{min-width:30px}}',1)
CSS.write_text(css)

# Runtime contract: update version and add only discriminating repair assertions.
t=CONTRACT.read_text().replace('41\\.9','41\\.10').replace('41.9','41.10')
anchor="assert.match(app, /audio-to-text-svg/);\n"
extra="""assert.match(app, /captureFinalizing = false;\\n    renderTurns\\(\\);/);\nassert.match(app, /audio-to-text-arrow/);\nassert.match(css, /turn-retranscribe-button\\{[^}]*width:34px;height:34px;min-width:34px/);\nassert.match(css, /turn-replay-button\\{min-width:34px/);\nassert.match(index, /top-on-air[\\s\\S]*mic-meter-row/);\n"""
if anchor not in t: raise SystemExit('contract anchor missing')
t=t.replace(anchor,anchor+extra,1)
CONTRACT.write_text(t)

q={'schema':'offline-interview.interview-spec.v1','version':'1.0','id':'test-ux-v41-10-field-repair','title':'Test V41.10 — réparation ciblée','context':'Qualification exact-head des réparations terrain V41.9.','objective':'Vérifier disponibilité immédiate des contrôles, pictogramme audio vers texte et micro compact près de ON AIR.','language':'fr-FR','estimatedDurationMinutes':4,'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],'sections':[{'id':'S1','title':'Réparations V41.10','questions':[
{'id':'Q1','label':'Préflight','text':'Ouvrez Diagnostic. La version doit être exactement 2026-09-08.interview-runtime-v41.10. Sinon arrêtez le test.','intent':'Vérifier la bonne candidate.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
{'id':'Q2','label':'Contrôles immédiatement disponibles','text':'Enregistrez une réponse puis arrêtez. Sans changer de question et sans recharger la page, vérifiez que lecture et transcription audio sont utilisables dès que la prise est prête.','intent':'Vérifier la réparation principale.','estimatedMinutes':1,'required':True,'audience':['P1','P2'],'followUps':[]},
{'id':'Q3','label':'Audio vers texte','text':'Regardez les boutons lecture et transcription. Dites si le second fait clairement comprendre son vers texte, avec une flèche, et si les deux boutons ont exactement la même taille.','intent':'Qualifier le contrôle audio vers texte.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
{'id':'Q4','label':'Micro et live-first','text':'Observez le petit indicateur de micro près de ON AIR en parlant faible, normalement puis fort. Faites aussi deux changements de personne. Dites si le micro est discret et lisible, et si les textes reconnus apparaissent sans attente de retraitement audio.','intent':'Qualifier le nouveau placement du micro et surveiller le live-first.','estimatedMinutes':1,'required':True,'audience':['P1','P2'],'followUps':[]}
]}]}
Path('offline-interview/test-interviews/interview-test-ux-v41-10.json').write_text(json.dumps(q,ensure_ascii=False,indent=2)+'\n')
