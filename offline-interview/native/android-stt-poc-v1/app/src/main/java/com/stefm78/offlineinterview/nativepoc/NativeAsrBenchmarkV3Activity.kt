package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.Instant
import java.util.Locale

class NativeAsrBenchmarkV3Activity : Activity(), RecognitionListener {
    companion object {
        private const val REQ_MIC = 1401
        private const val REQ_SAVE = 1402
        private const val CORPUS_ASSET = "fr-FR-v1.json"
        private const val SCORING_POLICY_ASSET = "fr-FR-v1-scoring-v3.json"
        private const val RESULT_SCHEMA = "offline-interview.native-asr-benchmark-result.v3"
        private const val MODE = "ANDROID_SYSTEM_DEFAULT"
        private const val COMPLETE_SILENCE_MS = 5000L
        private const val POSSIBLY_COMPLETE_SILENCE_MS = 3000L
        private const val REARM_DELAY_MS = 180L
        private const val BUSY_REARM_DELAY_MS = 400L
        private const val USER_FINISH_GRACE_MS = 900L
        private const val PASSAGE_WATCHDOG_MS = 180_000L
        private const val ERROR_SAFETY_WATCHDOG = -1101
        private const val ERROR_START_LISTENING = -1102
    }

    data class Alias(val canonical: String, val variants: List<String>)
    data class MeaningCheck(
        val id: String,
        val passageId: String,
        val expectedVariants: List<String>,
        val contradictionVariants: List<String>
    )
    data class Entity(val id: String, val category: String, val canonical: String, val variants: List<String>)
    data class Passage(
        val id: String,
        val level: Int,
        val category: String,
        val title: String,
        val reference: String,
        val entities: List<Entity>
    )
    data class EditCounts(val substitutions: Int, val deletions: Int, val insertions: Int, val refWords: Int) {
        val distance: Int get() = substitutions + deletions + insertions
        val wer: Double get() = if (refWords == 0) 0.0 else distance.toDouble() / refWords
    }
    data class EntityScore(val hits: Int, val total: Int) {
        val accuracy: Double? get() = if (total == 0) null else hits.toDouble() / total
    }
    data class SemanticDetail(
        val id: String,
        val state: String,
        val hit: Boolean,
        val contradiction: Boolean
    )
    data class SemanticScore(
        val present: Int,
        val missing: Int,
        val contradicted: Int,
        val total: Int,
        val details: List<SemanticDetail>
    ) {
        val accuracy: Double? get() = if (total == 0) null else present.toDouble() / total
    }
    data class PassageResult(
        val passage: Passage,
        val hypothesisRaw: String,
        val referenceNormalized: String,
        val hypothesisNormalized: String,
        val edits: EditCounts,
        val cer: Double,
        val entityScores: Map<String, EntityScore>,
        val semantic: SemanticScore,
        val firstPartialMs: Long?,
        val finalAfterUserFinishMs: Long?,
        val totalPassageMs: Long,
        val partialCount: Int,
        val sessionCount: Int,
        val segmentCallbackCount: Int,
        val autoRearmCount: Int,
        val prematureEndpointCount: Int,
        val recoverableErrorCount: Int,
        val restartGapsMs: List<Long>,
        val userFinished: Boolean,
        val errorCode: Int?,
        val errorName: String?,
        val sessions: List<RecognitionSessionAccumulator.SessionRecord>,
        val referencePunctuationMarks: Int,
        val hypothesisPunctuationMarks: Int
    )

    private val handler = Handler(Looper.getMainLooper())

    private lateinit var corpusRaw: JSONObject
    private lateinit var policyRaw: JSONObject
    private lateinit var corpusId: String
    private lateinit var corpusLanguage: String
    private lateinit var scoringPolicyId: String
    private lateinit var aliases: List<Alias>
    private lateinit var meaningChecks: List<MeaningCheck>
    private lateinit var passages: List<Passage>

    private var recognizer: SpeechRecognizer? = null
    private var currentIndex = 0
    private var passageActive = false
    private var sessionActive = false
    private var userFinishedRequested = false
    private var passageStartMs = 0L
    private var userFinishedAtMs: Long? = null
    private var firstPartialMs: Long? = null
    private var partialCount = 0
    private var sessionCount = 0
    private var segmentCallbackCount = 0
    private var autoRearmCount = 0
    private var prematureEndpointCount = 0
    private var recoverableErrorCount = 0
    private var lastSessionTerminalMs: Long? = null
    private val restartGapsMs = mutableListOf<Long>()
    private var accumulator = RecognitionSessionAccumulator()
    private val results = mutableListOf<PassageResult>()
    private var lastExportJson: String? = null
    private var watchdogRunnable: Runnable? = null
    private var userFinishGraceRunnable: Runnable? = null

    private lateinit var header: TextView
    private lateinit var referenceView: TextView
    private lateinit var hypothesisView: TextView
    private lateinit var metricsView: TextView
    private lateinit var statusView: TextView
    private lateinit var startButton: Button
    private lateinit var doneButton: Button
    private lateinit var nextButton: Button
    private lateinit var saveButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loadCorpusAndPolicy()
        buildUi()
        prepareRecognizer()
        ensureMicPermission()
        renderPassage()
    }

    private fun loadCorpusAndPolicy() {
        corpusRaw = JSONObject(assets.open(CORPUS_ASSET).bufferedReader().use { it.readText() })
        policyRaw = JSONObject(assets.open(SCORING_POLICY_ASSET).bufferedReader().use { it.readText() })
        corpusId = corpusRaw.getString("id")
        corpusLanguage = corpusRaw.getString("language")
        scoringPolicyId = policyRaw.getString("id")
        require(corpusRaw.getString("status") == "FROZEN") { "Benchmark corpus must remain FROZEN" }
        require(policyRaw.getString("corpusId") == corpusId) { "Scoring policy/corpus mismatch" }
        require(policyRaw.optString("basePolicyId") == "fr-FR-v1-scoring-v2") { "v3 must extend the v2 surface policy" }

        val corpusAliases = corpusRaw.getJSONObject("scoring").getJSONArray("aliases").toAliasList()
        val policyAliases = policyRaw.getJSONArray("surfaceAliases").toAliasList()
        aliases = corpusAliases + policyAliases

        val checks = policyRaw.getJSONArray("criticalMeaningChecks")
        meaningChecks = (0 until checks.length()).map { i ->
            val c = checks.getJSONObject(i)
            MeaningCheck(
                c.getString("id"), c.getString("passageId"),
                c.getJSONArray("expectedVariants").strings(),
                c.getJSONArray("contradictionVariants").strings()
            )
        }

        val passageArray = corpusRaw.getJSONArray("passages")
        passages = (0 until passageArray.length()).map { i ->
            val p = passageArray.getJSONObject(i)
            val entitiesJson = p.optJSONArray("entities") ?: JSONArray()
            val entities = (0 until entitiesJson.length()).map { j ->
                val e = entitiesJson.getJSONObject(j)
                Entity(e.getString("id"), e.getString("category"), e.getString("canonical"), e.getJSONArray("variants").strings())
            }
            Passage(p.getString("id"), p.getInt("level"), p.getString("category"), p.getString("title"), p.getString("reference"), entities)
        }
        require(passages.size == 6) { "Expected the six frozen fr-FR-v1 passages" }
    }

    private fun JSONArray.toAliasList(): List<Alias> = (0 until length()).map { i ->
        val a = getJSONObject(i)
        Alias(a.getString("canonical"), a.getJSONArray("variants").strings())
    }
    private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

    private fun buildUi() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 28, 32, 28) }
        header = TextView(this).apply { textSize = 21f }
        referenceView = TextView(this).apply { textSize = 19f; setPadding(0, 24, 0, 24) }
        hypothesisView = TextView(this).apply { textSize = 16f; setPadding(0, 12, 0, 12) }
        metricsView = TextView(this).apply { textSize = 15f; setPadding(0, 8, 0, 8) }
        statusView = TextView(this).apply { textSize = 14f; setPadding(0, 12, 0, 18) }
        startButton = Button(this).apply { text = "Démarrer la lecture"; setOnClickListener { startPassage() } }
        doneButton = Button(this).apply { text = "J'ai fini ce texte"; visibility = View.GONE; setOnClickListener { requestUserFinish() } }
        nextButton = Button(this).apply { text = "Suivant"; isEnabled = false; setOnClickListener { advance() } }
        saveButton = Button(this).apply { text = "Enregistrer le résultat JSON"; visibility = View.GONE; setOnClickListener { saveResult() } }
        listOf(header, referenceView, hypothesisView, metricsView, statusView, startButton, doneButton, nextButton, saveButton).forEach(root::addView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun prepareRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            statusView.text = "FAIL — aucun service de reconnaissance vocale système disponible."
            startButton.isEnabled = false
            return
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { it.setRecognitionListener(this) }
        statusView.text = systemRecognizerSummary()
    }

    private fun ensureMicPermission() {
        if (!hasMicPermission()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            startButton.isEnabled = false
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            startButton.isEnabled = granted && SpeechRecognizer.isRecognitionAvailable(this)
            if (!granted) statusView.text = "FAIL — permission microphone refusée."
        }
    }

    private fun systemRecognizerSummary(): String {
        val onDevice = SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        val candidates = packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
            .mapNotNull { it.serviceInfo?.packageName }.distinct().sorted()
        return "Mode: $MODE · on-device disponible=$onDevice · stitching lossless actif · services=${candidates.joinToString()}"
    }

    private fun renderPassage() {
        val p = passages[currentIndex]
        header.text = "${currentIndex + 1}/${passages.size} — ${p.title}"
        referenceView.text = p.reference
        hypothesisView.text = "Transcription Android : —"
        metricsView.text = "Les sous-sessions Android seront recousues. Seul « J'ai fini ce texte » termine normalement la lecture."
        statusView.text = systemRecognizerSummary()
        startButton.visibility = View.VISIBLE
        startButton.isEnabled = hasMicPermission() && SpeechRecognizer.isRecognitionAvailable(this)
        doneButton.visibility = View.GONE
        nextButton.isEnabled = false
    }

    private fun hasMicPermission(): Boolean = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun startPassage() {
        if (passageActive || !hasMicPermission()) return
        handler.removeCallbacksAndMessages(null)
        passageActive = true
        sessionActive = false
        userFinishedRequested = false
        passageStartMs = SystemClock.elapsedRealtime()
        userFinishedAtMs = null
        firstPartialMs = null
        partialCount = 0
        sessionCount = 0
        segmentCallbackCount = 0
        autoRearmCount = 0
        prematureEndpointCount = 0
        recoverableErrorCount = 0
        lastSessionTerminalMs = null
        restartGapsMs.clear()
        accumulator = RecognitionSessionAccumulator()

        startButton.visibility = View.GONE
        doneButton.visibility = View.VISIBLE
        doneButton.isEnabled = true
        nextButton.isEnabled = false
        hypothesisView.text = "Transcription Android : écoute en cours…"
        metricsView.text = "Lisez normalement. Une fermeture Android intermédiaire sera recousue puis réarmée."

        watchdogRunnable = Runnable {
            if (passageActive) {
                val now = SystemClock.elapsedRealtime()
                if (accumulator.hasActiveSession) accumulator.endWithFatalError(ERROR_SAFETY_WATCHDOG, "ERROR_SAFETY_WATCHDOG", now)
                sessionActive = false
                try { recognizer?.cancel() } catch (_: Exception) {}
                finishPassage(ERROR_SAFETY_WATCHDOG, "ERROR_SAFETY_WATCHDOG")
            }
        }.also { handler.postDelayed(it, PASSAGE_WATCHDOG_MS) }
        beginRecognizerSession(auto = false)
    }

    private fun recognizerIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, corpusLanguage)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, COMPLETE_SILENCE_MS)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, POSSIBLY_COMPLETE_SILENCE_MS)
        putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
        // Deliberately no EXTRA_AUDIO_SOURCE and no EXTRA_PREFER_OFFLINE.
    }

    private fun beginRecognizerSession(auto: Boolean) {
        if (!passageActive || userFinishedRequested || sessionActive) return
        val now = SystemClock.elapsedRealtime()
        if (auto) lastSessionTerminalMs?.let { restartGapsMs += (now - it).coerceAtLeast(0L) }
        sessionCount++
        sessionActive = true
        accumulator.startSession(sessionCount, now)
        statusView.text = if (auto) "Sous-session Android recousue — écoute réarmée, continuez à lire." else "Écoute active — lisez normalement jusqu'au bout."
        try {
            recognizer?.startListening(recognizerIntent())
        } catch (e: Exception) {
            sessionActive = false
            accumulator.endWithFatalError(ERROR_START_LISTENING, "START_LISTENING_EXCEPTION_${e.javaClass.simpleName}", SystemClock.elapsedRealtime())
            finishPassage(ERROR_START_LISTENING, "START_LISTENING_EXCEPTION_${e.javaClass.simpleName}")
        }
    }

    private fun requestUserFinish() {
        if (!passageActive || userFinishedRequested) return
        userFinishedRequested = true
        userFinishedAtMs = SystemClock.elapsedRealtime()
        doneButton.isEnabled = false
        watchdogRunnable?.let(handler::removeCallbacks)
        statusView.text = "Fin confirmée — attente brève du dernier résultat Android…"
        if (sessionActive) {
            try { recognizer?.stopListening() } catch (_: Exception) { finishWithUserFallback() ; return }
            userFinishGraceRunnable = Runnable {
                if (passageActive && userFinishedRequested) finishWithUserFallback()
            }.also { handler.postDelayed(it, USER_FINISH_GRACE_MS) }
        } else {
            finishPassage(null, null)
        }
    }

    private fun finishWithUserFallback() {
        if (!passageActive) return
        val now = SystemClock.elapsedRealtime()
        if (accumulator.hasActiveSession) accumulator.endUserFinishFallback(now)
        sessionActive = false
        try { recognizer?.cancel() } catch (_: Exception) {}
        finishPassage(null, null)
    }

    override fun onPartialResults(partialResults: Bundle?) {
        if (!passageActive || !sessionActive) return
        partialCount++
        if (firstPartialMs == null) firstPartialMs = SystemClock.elapsedRealtime() - passageStartMs
        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        accumulator.updatePartial(text)
        val shown = accumulator.displayTranscript()
        if (shown.isNotBlank()) hypothesisView.text = "Transcription Android : $shown"
    }

    override fun onEndOfSpeech() {
        if (passageActive) statusView.text = "Endpoint Android en cours — le texte restera actif et sera recousu."
    }

    override fun onSegmentResults(segmentResults: Bundle) {
        if (!passageActive || !sessionActive) return
        segmentCallbackCount++
        val text = segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        accumulator.addSegment(text)
        hypothesisView.text = "Transcription Android : ${accumulator.displayTranscript().ifBlank { "—" }}"
    }

    override fun onEndOfSegmentedSession() {
        if (!passageActive || !sessionActive) return
        val now = SystemClock.elapsedRealtime()
        accumulator.endSegmentedSession(now)
        sessionActive = false
        lastSessionTerminalMs = now
        if (userFinishedRequested) finishPassage(null, null) else {
            prematureEndpointCount++
            scheduleRearm(REARM_DELAY_MS)
        }
    }

    override fun onResults(bundle: Bundle?) {
        if (!passageActive || !sessionActive) return
        val now = SystemClock.elapsedRealtime()
        val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        accumulator.endWithFinal(text, now)
        sessionActive = false
        lastSessionTerminalMs = now
        hypothesisView.text = "Transcription Android : ${accumulator.transcriptRaw.ifBlank { "—" }}"
        if (userFinishedRequested) finishPassage(null, null) else {
            prematureEndpointCount++
            scheduleRearm(REARM_DELAY_MS)
        }
    }

    override fun onError(error: Int) {
        if (!passageActive || !sessionActive) return
        val now = SystemClock.elapsedRealtime()
        sessionActive = false
        lastSessionTerminalMs = now
        val name = errorName(error)
        val recoverable = error in setOf(
            SpeechRecognizer.ERROR_CLIENT,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED
        )
        if (recoverable) {
            recoverableErrorCount++
            accumulator.endWithRecoverableError(error, name, now)
            hypothesisView.text = "Transcription Android : ${accumulator.transcriptRaw.ifBlank { "—" }}"
            if (userFinishedRequested) finishPassage(null, null) else {
                prematureEndpointCount++
                scheduleRearm(if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) BUSY_REARM_DELAY_MS else REARM_DELAY_MS)
            }
        } else {
            accumulator.endWithFatalError(error, name, now)
            finishPassage(error, name)
        }
    }

    private fun scheduleRearm(delayMs: Long) {
        if (!passageActive || userFinishedRequested) return
        autoRearmCount++
        statusView.text = "Sous-session terminée — fragment conservé, réarmement automatique $autoRearmCount…"
        handler.postDelayed({ if (passageActive && !userFinishedRequested && !sessionActive) beginRecognizerSession(auto = true) }, delayMs)
    }

    private fun finishPassage(errorCode: Int?, errorName: String?) {
        if (!passageActive) return
        handler.removeCallbacksAndMessages(null)
        passageActive = false
        sessionActive = false
        val now = SystemClock.elapsedRealtime()
        val hypothesis = accumulator.transcriptRaw.trim()
        val result = scoreCurrent(hypothesis, errorCode, errorName, now - passageStartMs, userFinishedAtMs?.let { (now - it).coerceAtLeast(0L) })
        results.removeAll { it.passage.id == result.passage.id }
        results += result
        hypothesisView.text = "Transcription Android : ${result.hypothesisRaw.ifBlank { "∅" }}"
        metricsView.text = "WER ${(result.edits.wer * 100).format1()} % · sessions=${result.sessionCount} · réarmements=${result.autoRearmCount} · couverture=${(coverageRatio(result) * 100).format1()} %"
        statusView.text = if (result.errorCode == null) "Passage enregistré avec stitching inter-session." else "Passage terminé avec ${result.errorName}; l'erreur restera visible dans le verdict."
        doneButton.visibility = View.GONE
        nextButton.isEnabled = true
        if (currentIndex == passages.lastIndex) nextButton.text = "Terminer et calculer le verdict"
    }

    private fun scoreCurrent(hypothesis: String, errorCode: Int?, errorName: String?, totalPassageMs: Long, finalAfterUserFinishMs: Long?): PassageResult {
        val p = passages[currentIndex]
        val refNorm = normalizeForWer(p.reference)
        val hypNorm = normalizeForWer(hypothesis)
        val edits = wordEdits(refNorm, hypNorm)
        val entityScores = p.entities.groupBy { it.category }.mapValues { (_, entities) -> EntityScore(entities.count { entityHit(hypothesis, it) }, entities.size) }
        return PassageResult(
            passage = p,
            hypothesisRaw = hypothesis,
            referenceNormalized = refNorm,
            hypothesisNormalized = hypNorm,
            edits = edits,
            cer = charErrorRate(refNorm, hypNorm),
            entityScores = entityScores,
            semantic = semanticScore(p.id, hypothesis),
            firstPartialMs = firstPartialMs,
            finalAfterUserFinishMs = finalAfterUserFinishMs,
            totalPassageMs = totalPassageMs,
            partialCount = partialCount,
            sessionCount = sessionCount,
            segmentCallbackCount = segmentCallbackCount,
            autoRearmCount = autoRearmCount,
            prematureEndpointCount = prematureEndpointCount,
            recoverableErrorCount = recoverableErrorCount,
            restartGapsMs = restartGapsMs.toList(),
            userFinished = userFinishedRequested,
            errorCode = errorCode,
            errorName = errorName,
            sessions = accumulator.sessions,
            referencePunctuationMarks = punctuationCount(p.reference),
            hypothesisPunctuationMarks = punctuationCount(hypothesis)
        )
    }

    private fun coverageRatio(r: PassageResult): Double {
        val refWords = r.referenceNormalized.split(' ').count { it.isNotBlank() }
        val hypWords = r.hypothesisNormalized.split(' ').count { it.isNotBlank() }
        return if (refWords == 0) 1.0 else (hypWords.toDouble() / refWords).coerceAtMost(1.0)
    }

    private fun advance() {
        if (results.none { it.passage.id == passages[currentIndex].id }) return
        if (currentIndex < passages.lastIndex) { currentIndex++; nextButton.text = "Suivant"; renderPassage() } else finalizeBenchmark()
    }

    private fun finalizeBenchmark() {
        val output = buildResultJson()
        lastExportJson = output.toString(2)
        val aggregate = output.getJSONObject("aggregate")
        header.text = "Android Native ASR v3 — ${aggregate.getString("verdict")}"
        referenceView.text = "Corpus $corpusId terminé : ${aggregate.getInt("userConfirmedPassages")}/${passages.size} passages confirmés."
        hypothesisView.text = "WER global ${(aggregate.getDouble("globalWer") * 100).format1()} % · entités critiques ${(aggregate.getDouble("criticalEntityAccuracy") * 100).format1()} %"
        metricsView.text = "Couverture <95%=${aggregate.getInt("lowCoveragePassages")} · sens manquant=${aggregate.getInt("criticalMeaningMissing")} · contredit=${aggregate.getInt("criticalMeaningContradicted")}"
        statusView.text = "Benchmark terminé. Enregistrez le JSON et transmettez-le pour décision."
        startButton.visibility = View.GONE; doneButton.visibility = View.GONE; nextButton.visibility = View.GONE; saveButton.visibility = View.VISIBLE
    }

    private fun buildResultJson(): JSONObject {
        val ordered = passages.map { p -> results.first { it.passage.id == p.id } }
        val sumS = ordered.sumOf { it.edits.substitutions }
        val sumD = ordered.sumOf { it.edits.deletions }
        val sumI = ordered.sumOf { it.edits.insertions }
        val sumRef = ordered.sumOf { it.edits.refWords }
        val globalWer = if (sumRef == 0) 0.0 else (sumS + sumD + sumI).toDouble() / sumRef
        val allEntities = ordered.flatMap { r -> r.passage.entities.map { e -> r to e } }
        val criticalHits = allEntities.count { (r, e) -> entityHit(r.hypothesisRaw, e) }
        val criticalTotal = allEntities.size
        val criticalAccuracy = if (criticalTotal == 0) 1.0 else criticalHits.toDouble() / criticalTotal
        val meaningPresent = ordered.sumOf { it.semantic.present }
        val meaningMissing = ordered.sumOf { it.semantic.missing }
        val meaningContradicted = ordered.sumOf { it.semantic.contradicted }
        val meaningTotal = ordered.sumOf { it.semantic.total }
        val meaningAccuracy = if (meaningTotal == 0) 1.0 else meaningPresent.toDouble() / meaningTotal
        val userConfirmed = ordered.count { it.userFinished }
        val completed = ordered.count { it.userFinished && it.errorCode == null && it.hypothesisRaw.isNotBlank() }
        val blockingErrors = ordered.count { it.errorCode != null }
        val lowCoverage = ordered.count { coverageRatio(it) < 0.95 }
        val allCoverage = lowCoverage == 0
        val allUserConfirmed = userConfirmed == passages.size
        val noMeaningLoss = meaningMissing == 0 && meaningContradicted == 0
        val verdict = when {
            allUserConfirmed && blockingErrors == 0 && allCoverage && globalWer <= 0.10 && criticalAccuracy >= 0.90 && meaningAccuracy == 1.0 && noMeaningLoss -> "PASS_NATIVE_ASR"
            allUserConfirmed && blockingErrors == 0 && allCoverage && globalWer <= 0.15 && criticalAccuracy >= 0.80 && meaningAccuracy == 1.0 && noMeaningLoss -> "PASS_WITH_LIMITATIONS"
            allUserConfirmed && blockingErrors == 0 && (lowCoverage >= 2 || globalWer > 0.15 || !noMeaningLoss) -> "PIVOT_NATIVE_ENGINE"
            else -> "FAIL_NATIVE_ASR"
        }
        val reasons = JSONArray().apply {
            put("user_confirmed=$userConfirmed/${passages.size}")
            put("completion=$completed/${passages.size}")
            put("global_wer=${"%.4f".format(Locale.US, globalWer)}")
            put("critical_entity_accuracy=${"%.4f".format(Locale.US, criticalAccuracy)}")
            put("low_coverage_passages=$lowCoverage")
            put("critical_meaning_present=$meaningPresent/$meaningTotal")
            put("critical_meaning_missing=$meaningMissing")
            put("critical_meaning_contradicted=$meaningContradicted")
            if (blockingErrors > 0) put("blocking_errors=$blockingErrors")
        }
        return JSONObject().apply {
            put("schema", RESULT_SCHEMA)
            put("exportedAt", Instant.now().toString())
            put("candidateBuild", "android-native-${BuildConfig.VERSION_NAME}")
            put("corpus", JSONObject().put("id", corpusId).put("language", corpusLanguage).put("status", "FROZEN").put("passageCount", passages.size).put("scoringPolicyId", scoringPolicyId))
            put("platform", JSONObject().apply {
                put("name", "Android"); put("recognizerMode", MODE)
                put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(this@NativeAsrBenchmarkV3Activity))
                put("onDeviceRecognitionAvailable", SpeechRecognizer.isOnDeviceRecognitionAvailable(this@NativeAsrBenchmarkV3Activity))
                put("manufacturer", Build.MANUFACTURER); put("model", Build.MODEL); put("apiLevel", Build.VERSION.SDK_INT); put("osRelease", Build.VERSION.RELEASE)
                put("actualProviderPackageExposedByApi", false)
                put("recognitionServiceCandidates", JSONArray().apply { packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0).mapNotNull { it.serviceInfo?.packageName }.distinct().sorted().forEach { put(it) } })
            })
            put("endpointingPolicy", JSONObject().apply {
                put("completionAuthority", "USER_BUTTON")
                put("providerBoundaryHandling", "COMMIT_FINAL_OR_PARTIAL_FALLBACK_THEN_AUTO_REARM")
                put("segmentedSessionRequested", true)
                put("segmentedSessionRequired", false)
                put("completeSilenceMs", COMPLETE_SILENCE_MS); put("possiblyCompleteSilenceMs", POSSIBLY_COMPLETE_SILENCE_MS)
                put("rearmDelayMs", REARM_DELAY_MS); put("maxAutoRearmsPerPassage", JSONObject.NULL)
                put("userFinishGraceMs", USER_FINISH_GRACE_MS); put("passageSafetyWatchdogMs", PASSAGE_WATCHDOG_MS)
            })
            put("scoringPolicy", JSONObject().apply {
                put("id", scoringPolicyId); put("basePolicyId", "fr-FR-v1-scoring-v2")
                put("primary", "normalized_WER_v3"); put("surfaceEquivalentFormsNormalized", true)
                put("criticalMeaningStates", JSONArray(listOf("PRESENT_CORRECT", "MISSING", "CONTRADICTED")))
                put("missingCriticalMeaningBlocksPass", true); put("contradictedCriticalMeaningBlocksPass", true)
                put("punctuationExcludedFromWer", true)
            })
            put("passages", JSONArray().apply { ordered.forEach { put(resultToJson(it)) } })
            put("aggregate", JSONObject().apply {
                put("completedPassages", completed); put("userConfirmedPassages", userConfirmed); put("totalPassages", passages.size)
                put("substitutions", sumS); put("deletions", sumD); put("insertions", sumI); put("referenceWords", sumRef); put("globalWer", globalWer)
                put("criticalEntityHits", criticalHits); put("criticalEntityTotal", criticalTotal); put("criticalEntityAccuracy", criticalAccuracy)
                put("criticalMeaningPresent", meaningPresent); put("criticalMeaningMissing", meaningMissing); put("criticalMeaningContradicted", meaningContradicted); put("criticalMeaningTotal", meaningTotal); put("criticalMeaningAccuracy", meaningAccuracy)
                put("lowCoveragePassages", lowCoverage); put("allCoverageAtLeast95", allCoverage); put("blockingErrors", blockingErrors)
                put("prematureEndpointCount", ordered.sumOf { it.prematureEndpointCount }); put("autoRearmCount", ordered.sumOf { it.autoRearmCount })
                put("providerFinalSessionCount", ordered.sumOf { r -> r.sessions.count { it.finalText.isNotBlank() } })
                put("partialFallbackSessionCount", ordered.sumOf { r -> r.sessions.count { it.commitSource.contains("PARTIAL") } })
                put("emptyTerminalSessionCount", ordered.sumOf { r -> r.sessions.count { it.committedCandidate.isBlank() } })
                put("verdict", verdict); put("reasonCodes", reasons)
            })
        }
    }

    private fun resultToJson(r: PassageResult): JSONObject = JSONObject().apply {
        val refWords = r.referenceNormalized.split(' ').count { it.isNotBlank() }
        val hypWords = r.hypothesisNormalized.split(' ').count { it.isNotBlank() }
        val providerFinals = r.sessions.count { it.finalText.isNotBlank() }
        val partialFallbacks = r.sessions.count { it.commitSource.contains("PARTIAL") }
        val emptyTerminals = r.sessions.count { it.committedCandidate.isBlank() }
        put("id", r.passage.id); put("level", r.passage.level); put("category", r.passage.category); put("title", r.passage.title)
        put("referenceRaw", r.passage.reference); put("hypothesisRaw", r.hypothesisRaw); put("referenceNormalized", r.referenceNormalized); put("hypothesisNormalized", r.hypothesisNormalized)
        put("wer", JSONObject().put("substitutions", r.edits.substitutions).put("deletions", r.edits.deletions).put("insertions", r.edits.insertions).put("referenceWords", r.edits.refWords).put("value", r.edits.wer))
        put("cer", r.cer); put("referenceWordCount", refWords); put("transcriptWordCount", hypWords); put("wordCoverageRatio", coverageRatio(r))
        put("entityScores", JSONObject().apply { r.entityScores.forEach { (category, s) -> put(category, JSONObject().put("hits", s.hits).put("total", s.total).put("accuracy", s.accuracy ?: JSONObject.NULL)) } })
        put("semantic", JSONObject().apply {
            put("present", r.semantic.present); put("missing", r.semantic.missing); put("contradicted", r.semantic.contradicted); put("total", r.semantic.total); put("accuracy", r.semantic.accuracy ?: JSONObject.NULL)
            put("details", JSONArray().apply { r.semantic.details.forEach { d -> put(JSONObject().put("id", d.id).put("state", d.state).put("hit", d.hit).put("contradiction", d.contradiction)) } })
        })
        put("latency", JSONObject().apply {
            put("firstPartialMs", r.firstPartialMs ?: JSONObject.NULL); put("finalAfterUserFinishMs", r.finalAfterUserFinishMs ?: JSONObject.NULL); put("totalPassageMs", r.totalPassageMs)
            put("totalRestartGapMs", r.restartGapsMs.sum()); put("restartGapMaxMs", r.restartGapsMs.maxOrNull() ?: JSONObject.NULL); put("restartGapMeanMs", if (r.restartGapsMs.isEmpty()) JSONObject.NULL else r.restartGapsMs.average())
        })
        put("userFinished", r.userFinished); put("partialCount", r.partialCount); put("sessionCount", r.sessionCount); put("segmentCallbackCount", r.segmentCallbackCount)
        put("autoRearmCount", r.autoRearmCount); put("prematureEndpointCount", r.prematureEndpointCount); put("recoverableErrorCount", r.recoverableErrorCount)
        put("providerFinalSessionCount", providerFinals); put("partialFallbackSessionCount", partialFallbacks); put("emptyTerminalSessionCount", emptyTerminals)
        put("errorCode", r.errorCode ?: JSONObject.NULL); put("errorName", r.errorName ?: JSONObject.NULL)
        put("sessions", JSONArray().apply { r.sessions.forEach { s -> put(sessionToJson(s)) } })
        put("punctuation", JSONObject().put("referenceMarks", r.referencePunctuationMarks).put("hypothesisMarks", r.hypothesisPunctuationMarks))
    }

    private fun sessionToJson(s: RecognitionSessionAccumulator.SessionRecord): JSONObject = JSONObject().apply {
        put("sessionId", s.sessionId); put("startMs", s.startedAtMs - passageStartMs); put("endMs", s.endedAtMs - passageStartMs)
        put("terminalReason", s.terminalReason); put("finalText", s.finalText); put("lastPartialText", s.lastPartialText)
        put("segmentResults", JSONArray(s.segmentResults)); put("committedCandidate", s.committedCandidate); put("committedText", s.committedText); put("commitSource", s.commitSource)
        put("overlapTokensRemoved", s.overlapTokensRemoved); put("committedTokenCount", s.committedTokenCount)
        put("errorCode", s.errorCode ?: JSONObject.NULL); put("errorName", s.errorName ?: JSONObject.NULL)
    }

    private fun allAliases(): List<Alias> = aliases + passages.flatMap { p -> p.entities.map { Alias(it.canonical, it.variants) } }

    private fun normalizeBase(raw: String): String {
        val lower = raw.lowercase(Locale.FRANCE).replace('’', '\'').replace('-', ' ')
        val decomposed = Normalizer.normalize(lower, Normalizer.Form.NFD)
        return decomposed.replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9%]+"), " ").trim().replace(Regex("\\s+"), " ")
    }

    private fun normalizeForWer(raw: String): String {
        var value = " ${normalizeBase(raw)} "
        val replacements = allAliases().flatMap { a -> a.variants.map { v -> normalizeBase(v) to normalizeBase(a.canonical) } }
            .filter { it.first.isNotBlank() && it.second.isNotBlank() && it.first != it.second }.distinct().sortedByDescending { it.first.length }
        replacements.forEach { (variant, canonical) -> value = value.split(" $variant ").joinToString(" $canonical ") }
        return value.trim().replace(Regex("\\s+"), " ")
    }

    private fun containsNormalized(raw: String, variant: String): Boolean = " ${normalizeBase(raw)} ".contains(" ${normalizeBase(variant)} ")

    private fun entityHit(raw: String, entity: Entity): Boolean {
        if (entity.variants.any { containsNormalized(raw, it) }) return true
        return " ${normalizeForWer(raw)} ".contains(" ${normalizeForWer(entity.canonical)} ")
    }

    private fun semanticScore(passageId: String, raw: String): SemanticScore {
        val details = meaningChecks.filter { it.passageId == passageId }.map { c ->
            val hit = c.expectedVariants.any { containsNormalized(raw, it) }
            val contradiction = c.contradictionVariants.any { containsNormalized(raw, it) }
            val state = when { contradiction -> "CONTRADICTED"; hit -> "PRESENT_CORRECT"; else -> "MISSING" }
            SemanticDetail(c.id, state, hit, contradiction)
        }
        return SemanticScore(details.count { it.state == "PRESENT_CORRECT" }, details.count { it.state == "MISSING" }, details.count { it.state == "CONTRADICTED" }, details.size, details)
    }

    private fun wordEdits(ref: String, hyp: String): EditCounts {
        val r = if (ref.isBlank()) emptyList() else ref.split(' '); val h = if (hyp.isBlank()) emptyList() else hyp.split(' ')
        data class Cell(val cost: Int, val s: Int, val d: Int, val i: Int)
        val dp = Array(r.size + 1) { Array(h.size + 1) { Cell(0, 0, 0, 0) } }
        for (x in 1..r.size) dp[x][0] = Cell(x, 0, x, 0); for (y in 1..h.size) dp[0][y] = Cell(y, 0, 0, y)
        for (x in 1..r.size) for (y in 1..h.size) {
            if (r[x - 1] == h[y - 1]) dp[x][y] = dp[x - 1][y - 1] else {
                val s0 = dp[x - 1][y - 1]; val d0 = dp[x - 1][y]; val i0 = dp[x][y - 1]
                val sub = Cell(s0.cost + 1, s0.s + 1, s0.d, s0.i); val del = Cell(d0.cost + 1, d0.s, d0.d + 1, d0.i); val ins = Cell(i0.cost + 1, i0.s, i0.d, i0.i + 1)
                dp[x][y] = listOf(sub, del, ins).minWith(compareBy<Cell> { it.cost }.thenBy { it.i }.thenBy { it.d })
            }
        }
        val c = dp[r.size][h.size]; return EditCounts(c.s, c.d, c.i, r.size)
    }

    private fun charErrorRate(ref: String, hyp: String): Double {
        val r = ref.replace(" ", ""); val h = hyp.replace(" ", ""); if (r.isEmpty()) return if (h.isEmpty()) 0.0 else 1.0
        var prev = IntArray(h.length + 1) { it }
        for (i in 1..r.length) { val cur = IntArray(h.length + 1); cur[0] = i; for (j in 1..h.length) { val sub = prev[j - 1] + if (r[i - 1] == h[j - 1]) 0 else 1; cur[j] = minOf(sub, prev[j] + 1, cur[j - 1] + 1) }; prev = cur }
        return prev[h.length].toDouble() / r.length
    }

    private fun punctuationCount(s: String): Int = Regex("[,.!?;:]").findAll(s).count()
    private fun Double.format1(): String = "%.1f".format(Locale.FRANCE, this)

    private fun errorName(error: Int): String = when (error) {
        ERROR_SAFETY_WATCHDOG -> "ERROR_SAFETY_WATCHDOG"
        ERROR_START_LISTENING -> "ERROR_START_LISTENING"
        SpeechRecognizer.ERROR_AUDIO -> "ERROR_AUDIO"
        SpeechRecognizer.ERROR_CLIENT -> "ERROR_CLIENT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "ERROR_INSUFFICIENT_PERMISSIONS"
        SpeechRecognizer.ERROR_NETWORK -> "ERROR_NETWORK"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "ERROR_NETWORK_TIMEOUT"
        SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "ERROR_RECOGNIZER_BUSY"
        SpeechRecognizer.ERROR_SERVER -> "ERROR_SERVER"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "ERROR_SERVER_DISCONNECTED"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "ERROR_LANGUAGE_NOT_SUPPORTED"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "ERROR_LANGUAGE_UNAVAILABLE"
        else -> "ERROR_$error"
    }

    private fun saveResult() {
        lastExportJson ?: return
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"; putExtra(Intent.EXTRA_TITLE, "native-asr-benchmark-v3-$corpusId-${System.currentTimeMillis()}.json") }, REQ_SAVE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SAVE && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            contentResolver.openOutputStream(uri)?.use { it.write(lastExportJson.orEmpty().toByteArray(Charsets.UTF_8)) }
            statusView.text = "Résultat JSON v3 enregistré."
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        super.onDestroy()
    }

    override fun onReadyForSpeech(params: Bundle?) = Unit
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
}
