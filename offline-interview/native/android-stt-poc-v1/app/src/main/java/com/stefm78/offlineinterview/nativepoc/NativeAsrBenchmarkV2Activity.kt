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

class NativeAsrBenchmarkV2Activity : Activity(), RecognitionListener {
    companion object {
        private const val REQ_MIC = 1301
        private const val REQ_SAVE = 1302
        private const val CORPUS_ASSET = "fr-FR-v1.json"
        private const val SCORING_POLICY_ASSET = "fr-FR-v1-scoring-v2.json"
        private const val RESULT_SCHEMA = "offline-interview.native-asr-benchmark-result.v2"
        private const val MODE = "ANDROID_SYSTEM_DEFAULT"
        private const val COMPLETE_SILENCE_MS = 5000L
        private const val POSSIBLY_COMPLETE_SILENCE_MS = 3000L
        private const val REARM_DELAY_MS = 180L
        private const val BUSY_REARM_DELAY_MS = 400L
        private const val MAX_AUTO_REARMS = 8
        private const val ERROR_REARM_LIMIT = -1001
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
    data class SemanticDetail(val id: String, val hit: Boolean, val contradiction: Boolean)
    data class SemanticScore(
        val hits: Int,
        val total: Int,
        val contradictions: Int,
        val details: List<SemanticDetail>
    ) {
        val accuracy: Double? get() = if (total == 0) null else hits.toDouble() / total
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
        val finalCount: Int,
        val sessionCount: Int,
        val segmentCallbackCount: Int,
        val autoRearmCount: Int,
        val prematureEndpointCount: Int,
        val recoverableErrorCount: Int,
        val restartGapsMs: List<Long>,
        val userFinished: Boolean,
        val errorCode: Int?,
        val errorName: String?,
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
    private var latestPartial = ""
    private var sessionCount = 0
    private var segmentCallbackCount = 0
    private var autoRearmCount = 0
    private var prematureEndpointCount = 0
    private var recoverableErrorCount = 0
    private var lastSessionTerminalMs: Long? = null
    private val restartGapsMs = mutableListOf<Long>()
    private val finalSegments = mutableListOf<String>()
    private val results = mutableListOf<PassageResult>()
    private var lastExportJson: String? = null

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

        val corpusAliases = corpusRaw.getJSONObject("scoring").getJSONArray("aliases").toAliasList()
        val policyAliases = policyRaw.getJSONArray("surfaceAliases").toAliasList()
        aliases = corpusAliases + policyAliases

        val checks = policyRaw.getJSONArray("criticalMeaningChecks")
        meaningChecks = (0 until checks.length()).map { i ->
            val c = checks.getJSONObject(i)
            MeaningCheck(
                c.getString("id"),
                c.getString("passageId"),
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
                Entity(
                    e.getString("id"), e.getString("category"), e.getString("canonical"),
                    e.getJSONArray("variants").strings()
                )
            }
            Passage(
                p.getString("id"), p.getInt("level"), p.getString("category"),
                p.getString("title"), p.getString("reference"), entities
            )
        }
        require(passages.size == 6) { "Expected the six frozen fr-FR-v1 passages" }
    }

    private fun JSONArray.toAliasList(): List<Alias> = (0 until length()).map { i ->
        val a = getJSONObject(i)
        Alias(a.getString("canonical"), a.getJSONArray("variants").strings())
    }

    private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 28, 32, 28)
        }
        header = TextView(this).apply { textSize = 21f }
        referenceView = TextView(this).apply { textSize = 19f; setPadding(0, 24, 0, 24) }
        hypothesisView = TextView(this).apply { textSize = 16f; setPadding(0, 12, 0, 12) }
        metricsView = TextView(this).apply { textSize = 15f; setPadding(0, 8, 0, 8) }
        statusView = TextView(this).apply { textSize = 14f; setPadding(0, 12, 0, 18) }
        startButton = Button(this).apply {
            text = "Démarrer la lecture"
            setOnClickListener { startPassage() }
        }
        doneButton = Button(this).apply {
            text = "J'ai fini ce texte"
            visibility = View.GONE
            setOnClickListener { requestUserFinish() }
        }
        nextButton = Button(this).apply {
            text = "Suivant"
            isEnabled = false
            setOnClickListener { advance() }
        }
        saveButton = Button(this).apply {
            text = "Enregistrer le résultat JSON"
            visibility = View.GONE
            setOnClickListener { saveResult() }
        }
        root.addView(header)
        root.addView(referenceView)
        root.addView(hypothesisView)
        root.addView(metricsView)
        root.addView(statusView)
        root.addView(startButton)
        root.addView(doneButton)
        root.addView(nextButton)
        root.addView(saveButton)
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
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
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
        val serviceIntent = Intent(RecognitionService.SERVICE_INTERFACE)
        val candidates = packageManager.queryIntentServices(serviceIntent, 0)
            .mapNotNull { it.serviceInfo?.packageName }.distinct().sorted()
        return "Mode: $MODE · on-device disponible=$onDevice · fin de texte contrôlée par l'utilisateur · services=${candidates.joinToString()}"
    }

    private fun renderPassage() {
        val p = passages[currentIndex]
        header.text = "${currentIndex + 1}/${passages.size} — ${p.title}"
        referenceView.text = p.reference
        hypothesisView.text = "Transcription Android : —"
        metricsView.text = "Le texte ne changera pas tant que vous n'aurez pas appuyé sur « J'ai fini ce texte »."
        statusView.text = systemRecognizerSummary()
        startButton.visibility = View.VISIBLE
        startButton.isEnabled = hasMicPermission() && SpeechRecognizer.isRecognitionAvailable(this)
        doneButton.visibility = View.GONE
        nextButton.isEnabled = false
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

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
        latestPartial = ""
        sessionCount = 0
        segmentCallbackCount = 0
        autoRearmCount = 0
        prematureEndpointCount = 0
        recoverableErrorCount = 0
        lastSessionTerminalMs = null
        restartGapsMs.clear()
        finalSegments.clear()

        startButton.visibility = View.GONE
        doneButton.visibility = View.VISIBLE
        doneButton.isEnabled = true
        nextButton.isEnabled = false
        hypothesisView.text = "Transcription Android : écoute en cours…"
        metricsView.text = "Lisez jusqu'au bout. Si Android ferme une sous-session, l'écoute est réarmée automatiquement."
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
        // This remains the Android system-default microphone recognizer.
    }

    private fun beginRecognizerSession(auto: Boolean) {
        if (!passageActive || userFinishedRequested) return
        val now = SystemClock.elapsedRealtime()
        if (auto) lastSessionTerminalMs?.let { restartGapsMs += (now - it).coerceAtLeast(0L) }
        sessionCount++
        sessionActive = true
        latestPartial = ""
        statusView.text = if (auto) {
            "Android avait clos une sous-session. Écoute réarmée automatiquement — continuez à lire."
        } else {
            "Écoute active — lisez normalement jusqu'au bout, puis appuyez sur « J'ai fini ce texte »."
        }
        try {
            recognizer?.startListening(recognizerIntent())
        } catch (e: Exception) {
            sessionActive = false
            finishPassage(ERROR_REARM_LIMIT, "START_LISTENING_EXCEPTION_${e.javaClass.simpleName}")
        }
    }

    private fun requestUserFinish() {
        if (!passageActive || userFinishedRequested) return
        userFinishedRequested = true
        userFinishedAtMs = SystemClock.elapsedRealtime()
        doneButton.isEnabled = false
        handler.removeCallbacksAndMessages(null)
        statusView.text = "Fin de texte confirmée — attente du dernier résultat Android…"
        if (sessionActive) {
            try {
                recognizer?.stopListening()
            } catch (_: Exception) {
                finishPassage(null, null)
            }
        } else {
            finishPassage(null, null)
        }
    }

    override fun onPartialResults(partialResults: Bundle?) {
        if (!passageActive) return
        partialCount++
        if (firstPartialMs == null) firstPartialMs = SystemClock.elapsedRealtime() - passageStartMs
        latestPartial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        val shown = buildDisplayTranscript(latestPartial)
        if (shown.isNotBlank()) hypothesisView.text = "Transcription Android : $shown"
    }

    override fun onEndOfSpeech() {
        if (!passageActive) return
        statusView.text = "Pause détectée par Android — ne changez rien : l'application garde ce texte actif."
    }

    override fun onSegmentResults(segmentResults: Bundle) {
        if (!passageActive) return
        segmentCallbackCount++
        val text = segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        appendFinalText(text)
        hypothesisView.text = "Transcription Android : ${finalSegments.joinToString(" ").ifBlank { "—" }}"
    }

    override fun onEndOfSegmentedSession() {
        if (!passageActive) return
        sessionActive = false
        lastSessionTerminalMs = SystemClock.elapsedRealtime()
        if (userFinishedRequested) {
            finishPassage(null, null)
        } else {
            prematureEndpointCount++
            scheduleRearm(REARM_DELAY_MS)
        }
    }

    override fun onResults(bundle: Bundle?) {
        if (!passageActive) return
        val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        appendFinalText(text)
        sessionActive = false
        lastSessionTerminalMs = SystemClock.elapsedRealtime()
        hypothesisView.text = "Transcription Android : ${finalSegments.joinToString(" ").ifBlank { "—" }}"
        if (userFinishedRequested) {
            finishPassage(null, null)
        } else {
            prematureEndpointCount++
            scheduleRearm(REARM_DELAY_MS)
        }
    }

    override fun onError(error: Int) {
        if (!passageActive) return
        sessionActive = false
        lastSessionTerminalMs = SystemClock.elapsedRealtime()
        val name = errorName(error)
        val recoverable = error in setOf(
            SpeechRecognizer.ERROR_CLIENT,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED
        )

        if (userFinishedRequested) {
            if (recoverable && finalSegments.isNotEmpty()) finishPassage(null, null)
            else finishPassage(error, name)
            return
        }

        if (recoverable) {
            recoverableErrorCount++
            prematureEndpointCount++
            scheduleRearm(if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) BUSY_REARM_DELAY_MS else REARM_DELAY_MS)
        } else {
            finishPassage(error, name)
        }
    }

    private fun scheduleRearm(delayMs: Long) {
        if (!passageActive) return
        if (userFinishedRequested) {
            finishPassage(null, null)
            return
        }
        if (autoRearmCount >= MAX_AUTO_REARMS) {
            finishPassage(ERROR_REARM_LIMIT, "ERROR_REARM_LIMIT")
            return
        }
        autoRearmCount++
        statusView.text = "Sous-session terminée trop tôt — réarmement automatique ${autoRearmCount}/$MAX_AUTO_REARMS…"
        handler.postDelayed({
            if (passageActive && !userFinishedRequested && !sessionActive) beginRecognizerSession(auto = true)
        }, delayMs)
    }

    private fun appendFinalText(raw: String) {
        val text = raw.trim()
        if (text.isBlank()) return
        val normalized = normalizeBase(text)
        val combined = normalizeBase(finalSegments.joinToString(" "))
        when {
            combined.isBlank() -> finalSegments += text
            normalized == combined -> Unit
            combined.endsWith(" $normalized") || combined == normalized -> Unit
            normalized.startsWith("$combined ") -> {
                finalSegments.clear()
                finalSegments += text
            }
            finalSegments.any { normalizeBase(it) == normalized } -> Unit
            else -> finalSegments += text
        }
    }

    private fun buildDisplayTranscript(partial: String): String {
        val finals = finalSegments.joinToString(" ").trim()
        return listOf(finals, partial.trim()).filter { it.isNotBlank() }.joinToString(" ")
    }

    private fun finishPassage(errorCode: Int?, errorName: String?) {
        if (!passageActive) return
        handler.removeCallbacksAndMessages(null)
        passageActive = false
        sessionActive = false
        val now = SystemClock.elapsedRealtime()
        val hypothesis = finalSegments.joinToString(" ").trim()
        val result = scoreCurrent(
            hypothesis = hypothesis,
            errorCode = errorCode,
            errorName = errorName,
            totalPassageMs = now - passageStartMs,
            finalAfterUserFinishMs = userFinishedAtMs?.let { (now - it).coerceAtLeast(0L) }
        )
        results.removeAll { it.passage.id == result.passage.id }
        results += result

        hypothesisView.text = "Transcription Android : ${result.hypothesisRaw.ifBlank { "∅" }}"
        metricsView.text = "WER ${(result.edits.wer * 100).format1()} % · sessions=${result.sessionCount} · réarmements=${result.autoRearmCount} · fins prématurées=${result.prematureEndpointCount}"
        statusView.text = if (result.errorCode == null) {
            "Passage enregistré après confirmation utilisateur."
        } else {
            "Passage terminé avec ${result.errorName}; l'erreur restera visible dans le verdict."
        }
        doneButton.visibility = View.GONE
        nextButton.isEnabled = true
        if (currentIndex == passages.lastIndex) nextButton.text = "Terminer et calculer le verdict"
    }

    private fun scoreCurrent(
        hypothesis: String,
        errorCode: Int?,
        errorName: String?,
        totalPassageMs: Long,
        finalAfterUserFinishMs: Long?
    ): PassageResult {
        val p = passages[currentIndex]
        val refNorm = normalizeForWer(p.reference)
        val hypNorm = normalizeForWer(hypothesis)
        val edits = wordEdits(refNorm, hypNorm)
        val entityScores = p.entities.groupBy { it.category }.mapValues { (_, entities) ->
            val hits = entities.count { entityHit(hypothesis, it) }
            EntityScore(hits, entities.size)
        }
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
            finalCount = finalSegments.size,
            sessionCount = sessionCount,
            segmentCallbackCount = segmentCallbackCount,
            autoRearmCount = autoRearmCount,
            prematureEndpointCount = prematureEndpointCount,
            recoverableErrorCount = recoverableErrorCount,
            restartGapsMs = restartGapsMs.toList(),
            userFinished = userFinishedRequested,
            errorCode = errorCode,
            errorName = errorName,
            referencePunctuationMarks = punctuationCount(p.reference),
            hypothesisPunctuationMarks = punctuationCount(hypothesis)
        )
    }

    private fun advance() {
        if (results.none { it.passage.id == passages[currentIndex].id }) return
        if (currentIndex < passages.lastIndex) {
            currentIndex++
            nextButton.text = "Suivant"
            renderPassage()
        } else {
            finalizeBenchmark()
        }
    }

    private fun finalizeBenchmark() {
        val output = buildResultJson()
        lastExportJson = output.toString(2)
        val aggregate = output.getJSONObject("aggregate")
        header.text = "Android Native ASR v2 — ${aggregate.getString("verdict")}"
        referenceView.text = "Corpus $corpusId terminé : ${aggregate.getInt("completedFinalPassages")}/${passages.size} passages finalisés après confirmation utilisateur."
        hypothesisView.text = "WER global ${(aggregate.getDouble("globalWer") * 100).format1()} % · entités critiques ${(aggregate.getDouble("criticalEntityAccuracy") * 100).format1()} %"
        metricsView.text = "Fins provider prématurées=${aggregate.getInt("prematureEndpointCount")} · réarmements=${aggregate.getInt("autoRearmCount")} · contradictions sémantiques=${aggregate.getInt("semanticContradictions")}"
        statusView.text = "Benchmark terminé. Enregistrez le JSON et transmettez-le pour analyse."
        startButton.visibility = View.GONE
        doneButton.visibility = View.GONE
        nextButton.visibility = View.GONE
        saveButton.visibility = View.VISIBLE
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
        val semanticHits = ordered.sumOf { it.semantic.hits }
        val semanticTotal = ordered.sumOf { it.semantic.total }
        val semanticContradictions = ordered.sumOf { it.semantic.contradictions }
        val criticalMeaningAccuracy = if (semanticTotal == 0) 1.0 else semanticHits.toDouble() / semanticTotal
        val completedFinal = ordered.count { it.userFinished && it.finalCount > 0 && it.errorCode == null }
        val userConfirmed = ordered.count { it.userFinished }
        val everydayWer = ordered.firstOrNull { it.passage.category == "french_everyday" }?.edits?.wer ?: 1.0
        val blockingErrors = ordered.count { it.errorCode != null }
        val completionRatio = completedFinal.toDouble() / passages.size
        val allUserConfirmed = userConfirmed == passages.size
        val noContradiction = semanticContradictions == 0
        val verdict = when {
            allUserConfirmed && completionRatio == 1.0 && blockingErrors == 0 && globalWer <= 0.10 && criticalAccuracy >= 0.90 && everydayWer <= 0.08 && noContradiction -> "PASS_NATIVE_ASR"
            allUserConfirmed && completionRatio == 1.0 && blockingErrors == 0 && globalWer <= 0.15 && criticalAccuracy >= 0.80 && noContradiction -> "PASS_WITH_LIMITATIONS"
            completionRatio >= 0.80 -> "HOLD_NATIVE_ASR"
            else -> "FAIL_NATIVE_ASR"
        }
        val reasons = mutableListOf<String>()
        reasons += "user_confirmed=$userConfirmed/${passages.size}"
        reasons += "completion=$completedFinal/${passages.size}"
        reasons += "global_wer=${"%.4f".format(Locale.US, globalWer)}"
        reasons += "critical_entity_accuracy=${"%.4f".format(Locale.US, criticalAccuracy)}"
        reasons += "semantic_contradictions=$semanticContradictions"
        reasons += "everyday_wer=${"%.4f".format(Locale.US, everydayWer)}"
        if (blockingErrors > 0) reasons += "blocking_errors=$blockingErrors"

        return JSONObject().apply {
            put("schema", RESULT_SCHEMA)
            put("exportedAt", Instant.now().toString())
            put("candidateBuild", "android-native-${BuildConfig.VERSION_NAME}")
            put("corpus", JSONObject().apply {
                put("id", corpusId); put("language", corpusLanguage); put("status", "FROZEN")
                put("passageCount", passages.size); put("scoringPolicyId", scoringPolicyId)
            })
            put("platform", JSONObject().apply {
                put("name", "Android")
                put("recognizerMode", MODE)
                put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(this@NativeAsrBenchmarkV2Activity))
                put("onDeviceRecognitionAvailable", SpeechRecognizer.isOnDeviceRecognitionAvailable(this@NativeAsrBenchmarkV2Activity))
                put("manufacturer", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("apiLevel", Build.VERSION.SDK_INT)
                put("osRelease", Build.VERSION.RELEASE)
                put("actualProviderPackageExposedByApi", false)
                put("recognitionServiceCandidates", JSONArray().apply {
                    packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
                        .mapNotNull { it.serviceInfo?.packageName }.distinct().sorted().forEach { put(it) }
                })
            })
            put("endpointingPolicy", JSONObject().apply {
                put("completionAuthority", "USER_BUTTON")
                put("providerEarlyFinalHandling", "APPEND_AND_AUTO_REARM")
                put("segmentedSessionRequested", true)
                put("segmentedSessionKey", "EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS")
                put("completeSilenceMs", COMPLETE_SILENCE_MS)
                put("possiblyCompleteSilenceMs", POSSIBLY_COMPLETE_SILENCE_MS)
                put("rearmDelayMs", REARM_DELAY_MS)
                put("maxAutoRearmsPerPassage", MAX_AUTO_REARMS)
            })
            put("scoringPolicy", JSONObject().apply {
                put("id", scoringPolicyId)
                put("primary", "normalized_WER_v2")
                put("surfaceEquivalentFormsNormalized", true)
                put("semanticContradictionGate", true)
                put("passGate", "all user-confirmed finals, no blocking errors, WER<=0.10, critical entities>=0.90, everyday WER<=0.08, no semantic contradiction")
                put("limitationsGate", "all user-confirmed finals, no blocking errors, WER<=0.15, critical entities>=0.80, no semantic contradiction")
                put("punctuationExcludedFromWer", true)
            })
            put("passages", JSONArray().apply { ordered.forEach { put(resultToJson(it)) } })
            put("aggregate", JSONObject().apply {
                put("completedFinalPassages", completedFinal)
                put("userConfirmedPassages", userConfirmed)
                put("totalPassages", passages.size)
                put("completionRatio", completionRatio)
                put("substitutions", sumS); put("deletions", sumD); put("insertions", sumI); put("referenceWords", sumRef)
                put("globalWer", globalWer)
                put("criticalEntityHits", criticalHits); put("criticalEntityTotal", criticalTotal)
                put("criticalEntityAccuracy", criticalAccuracy)
                put("criticalMeaningHits", semanticHits); put("criticalMeaningTotal", semanticTotal)
                put("criticalMeaningAccuracy", criticalMeaningAccuracy)
                put("semanticContradictions", semanticContradictions)
                put("everydayWer", everydayWer)
                put("blockingErrors", blockingErrors)
                put("prematureEndpointCount", ordered.sumOf { it.prematureEndpointCount })
                put("autoRearmCount", ordered.sumOf { it.autoRearmCount })
                put("categoryMetrics", JSONArray().apply {
                    ordered.forEach { r -> put(JSONObject().put("category", r.passage.category).put("wer", r.edits.wer).put("cer", r.cer)) }
                })
                put("verdict", verdict)
                put("reasonCodes", JSONArray(reasons))
            })
        }
    }

    private fun resultToJson(r: PassageResult): JSONObject = JSONObject().apply {
        val refWords = r.referenceNormalized.split(' ').filter { it.isNotBlank() }.size
        val hypWords = r.hypothesisNormalized.split(' ').filter { it.isNotBlank() }.size
        put("id", r.passage.id); put("level", r.passage.level); put("category", r.passage.category); put("title", r.passage.title)
        put("referenceRaw", r.passage.reference); put("hypothesisRaw", r.hypothesisRaw)
        put("referenceNormalized", r.referenceNormalized); put("hypothesisNormalized", r.hypothesisNormalized)
        put("wer", JSONObject().apply {
            put("substitutions", r.edits.substitutions); put("deletions", r.edits.deletions); put("insertions", r.edits.insertions)
            put("referenceWords", r.edits.refWords); put("value", r.edits.wer)
        })
        put("cer", r.cer)
        put("wordCoverageRatio", if (refWords == 0) 1.0 else (hypWords.toDouble() / refWords).coerceAtMost(1.0))
        put("entityScores", JSONObject().apply {
            r.entityScores.forEach { (category, s) -> put(category, JSONObject().put("hits", s.hits).put("total", s.total).put("accuracy", s.accuracy ?: JSONObject.NULL)) }
        })
        put("semantic", JSONObject().apply {
            put("hits", r.semantic.hits); put("total", r.semantic.total); put("accuracy", r.semantic.accuracy ?: JSONObject.NULL)
            put("contradictions", r.semantic.contradictions)
            put("details", JSONArray().apply { r.semantic.details.forEach { d -> put(JSONObject().put("id", d.id).put("hit", d.hit).put("contradiction", d.contradiction)) } })
        })
        put("latency", JSONObject().apply {
            put("firstPartialMs", r.firstPartialMs ?: JSONObject.NULL)
            put("finalAfterUserFinishMs", r.finalAfterUserFinishMs ?: JSONObject.NULL)
            put("totalPassageMs", r.totalPassageMs)
            put("restartGapMaxMs", r.restartGapsMs.maxOrNull() ?: JSONObject.NULL)
            put("restartGapMeanMs", if (r.restartGapsMs.isEmpty()) JSONObject.NULL else r.restartGapsMs.average())
        })
        put("userFinished", r.userFinished)
        put("partialCount", r.partialCount); put("finalCount", r.finalCount)
        put("sessionCount", r.sessionCount); put("segmentCallbackCount", r.segmentCallbackCount)
        put("autoRearmCount", r.autoRearmCount); put("prematureEndpointCount", r.prematureEndpointCount)
        put("recoverableErrorCount", r.recoverableErrorCount)
        put("errorCode", r.errorCode ?: JSONObject.NULL); put("errorName", r.errorName ?: JSONObject.NULL)
        put("punctuation", JSONObject().put("referenceMarks", r.referencePunctuationMarks).put("hypothesisMarks", r.hypothesisPunctuationMarks))
    }

    private fun allAliases(): List<Alias> {
        val entityAliases = passages.flatMap { p -> p.entities.map { Alias(it.canonical, it.variants) } }
        return aliases + entityAliases
    }

    private fun normalizeBase(raw: String): String {
        val lower = raw.lowercase(Locale.FRANCE).replace('’', '\'').replace('-', ' ')
        val decomposed = Normalizer.normalize(lower, Normalizer.Form.NFD)
        return decomposed.replace(Regex("\\p{M}+"), "")
            .replace(Regex("[^a-z0-9%]+"), " ")
            .trim().replace(Regex("\\s+"), " ")
    }

    private fun normalizeForWer(raw: String): String {
        var value = " ${normalizeBase(raw)} "
        val replacements = allAliases().flatMap { a -> a.variants.map { v -> normalizeBase(v) to normalizeBase(a.canonical) } }
            .filter { it.first.isNotBlank() && it.second.isNotBlank() && it.first != it.second }
            .distinct()
            .sortedByDescending { it.first.length }
        replacements.forEach { (variant, canonical) ->
            val needle = " $variant "
            val replacement = " $canonical "
            value = value.replace(needle, replacement)
        }
        return value.trim().replace(Regex("\\s+"), " ")
    }

    private fun containsNormalized(raw: String, variant: String): Boolean {
        val hay = " ${normalizeBase(raw)} "
        val needle = " ${normalizeBase(variant)} "
        return hay.contains(needle)
    }

    private fun entityHit(raw: String, entity: Entity): Boolean {
        if (entity.variants.any { containsNormalized(raw, it) }) return true
        val hyp = " ${normalizeForWer(raw)} "
        val canonical = " ${normalizeForWer(entity.canonical)} "
        return hyp.contains(canonical)
    }

    private fun semanticScore(passageId: String, raw: String): SemanticScore {
        val checks = meaningChecks.filter { it.passageId == passageId }
        val details = checks.map { c ->
            val hit = c.expectedVariants.any { containsNormalized(raw, it) }
            val contradiction = c.contradictionVariants.any { containsNormalized(raw, it) }
            SemanticDetail(c.id, hit, contradiction)
        }
        return SemanticScore(details.count { it.hit }, details.size, details.count { it.contradiction }, details)
    }

    private fun wordEdits(ref: String, hyp: String): EditCounts {
        val r = if (ref.isBlank()) emptyList() else ref.split(' ')
        val h = if (hyp.isBlank()) emptyList() else hyp.split(' ')
        data class Cell(val cost: Int, val s: Int, val d: Int, val i: Int)
        val dp = Array(r.size + 1) { Array(h.size + 1) { Cell(0, 0, 0, 0) } }
        for (x in 1..r.size) dp[x][0] = Cell(x, 0, x, 0)
        for (y in 1..h.size) dp[0][y] = Cell(y, 0, 0, y)
        for (x in 1..r.size) for (y in 1..h.size) {
            if (r[x - 1] == h[y - 1]) {
                dp[x][y] = dp[x - 1][y - 1]
            } else {
                val sub0 = dp[x - 1][y - 1]; val sub = Cell(sub0.cost + 1, sub0.s + 1, sub0.d, sub0.i)
                val del0 = dp[x - 1][y]; val del = Cell(del0.cost + 1, del0.s, del0.d + 1, del0.i)
                val ins0 = dp[x][y - 1]; val ins = Cell(ins0.cost + 1, ins0.s, ins0.d, ins0.i + 1)
                dp[x][y] = listOf(sub, del, ins).minWith(compareBy<Cell> { it.cost }.thenBy { it.i }.thenBy { it.d })
            }
        }
        val c = dp[r.size][h.size]
        return EditCounts(c.s, c.d, c.i, r.size)
    }

    private fun charErrorRate(ref: String, hyp: String): Double {
        val r = ref.replace(" ", "")
        val h = hyp.replace(" ", "")
        if (r.isEmpty()) return if (h.isEmpty()) 0.0 else 1.0
        var prev = IntArray(h.length + 1) { it }
        for (i in 1..r.length) {
            val cur = IntArray(h.length + 1); cur[0] = i
            for (j in 1..h.length) {
                val sub = prev[j - 1] + if (r[i - 1] == h[j - 1]) 0 else 1
                cur[j] = minOf(sub, prev[j] + 1, cur[j - 1] + 1)
            }
            prev = cur
        }
        return prev[h.length].toDouble() / r.length
    }

    private fun punctuationCount(s: String): Int = Regex("[,.!?;:]").findAll(s).count()
    private fun Double.format1(): String = "%.1f".format(Locale.FRANCE, this)

    private fun errorName(error: Int): String = when (error) {
        ERROR_REARM_LIMIT -> "ERROR_REARM_LIMIT"
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
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "native-asr-benchmark-v2-$corpusId-${System.currentTimeMillis()}.json")
        }, REQ_SAVE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SAVE && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            contentResolver.openOutputStream(uri)?.use { it.write(lastExportJson.orEmpty().toByteArray(Charsets.UTF_8)) }
            statusView.text = "Résultat JSON v2 enregistré."
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        super.onDestroy()
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
}
