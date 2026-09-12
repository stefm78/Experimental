package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
import kotlin.math.max

class NativeAsrBenchmarkActivity : Activity(), RecognitionListener {
    companion object {
        private const val REQ_MIC = 1201
        private const val REQ_SAVE = 1202
        private const val CORPUS_ASSET = "fr-FR-v1.json"
        private const val RESULT_SCHEMA = "offline-interview.native-asr-benchmark-result.v1"
        private const val MODE = "ANDROID_SYSTEM_DEFAULT"
    }

    data class Alias(val canonical: String, val variants: List<String>)
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
    data class PassageResult(
        val passage: Passage,
        val hypothesisRaw: String,
        val referenceNormalized: String,
        val hypothesisNormalized: String,
        val edits: EditCounts,
        val cer: Double,
        val entityScores: Map<String, EntityScore>,
        val firstPartialMs: Long?,
        val finalAfterSpeechMs: Long?,
        val totalFinalMs: Long?,
        val partialCount: Int,
        val finalCount: Int,
        val errorCode: Int?,
        val errorName: String?,
        val referencePunctuationMarks: Int,
        val hypothesisPunctuationMarks: Int
    )

    private lateinit var corpusRaw: JSONObject
    private lateinit var corpusId: String
    private lateinit var corpusLanguage: String
    private lateinit var aliases: List<Alias>
    private lateinit var passages: List<Passage>

    private var recognizer: SpeechRecognizer? = null
    private var currentIndex = 0
    private var listening = false
    private var recognitionStartMs = 0L
    private var speechEndMs: Long? = null
    private var firstPartialMs: Long? = null
    private var partialCount = 0
    private var latestPartial = ""
    private val results = mutableListOf<PassageResult>()
    private var lastExportJson: String? = null

    private lateinit var header: TextView
    private lateinit var referenceView: TextView
    private lateinit var hypothesisView: TextView
    private lateinit var metricsView: TextView
    private lateinit var statusView: TextView
    private lateinit var startButton: Button
    private lateinit var nextButton: Button
    private lateinit var saveButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loadCorpus()
        buildUi()
        prepareRecognizer()
        ensureMicPermission()
        renderPassage()
    }

    private fun loadCorpus() {
        corpusRaw = JSONObject(assets.open(CORPUS_ASSET).bufferedReader().use { it.readText() })
        corpusId = corpusRaw.getString("id")
        corpusLanguage = corpusRaw.getString("language")
        require(corpusRaw.getString("status") == "FROZEN") { "Benchmark corpus must be FROZEN" }
        val aliasArray = corpusRaw.getJSONObject("scoring").getJSONArray("aliases")
        aliases = (0 until aliasArray.length()).map { i ->
            val a = aliasArray.getJSONObject(i)
            Alias(a.getString("canonical"), a.getJSONArray("variants").strings())
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
        require(passages.size in 5..6) { "Expected 5 or 6 frozen benchmark passages" }
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
            setOnClickListener { startRecognition() }
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
        return "Mode primaire: $MODE · reconnaissance disponible · on-device disponible=$onDevice · services=${candidates.joinToString()}"
    }

    private fun renderPassage() {
        val p = passages[currentIndex]
        header.text = "${currentIndex + 1}/${passages.size} — ${p.title}"
        referenceView.text = p.reference
        hypothesisView.text = "Transcription Android : —"
        metricsView.text = "Score : —"
        if (!listening) startButton.isEnabled = hasMicPermission() && SpeechRecognizer.isRecognitionAvailable(this)
        nextButton.isEnabled = false
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun startRecognition() {
        if (listening || !hasMicPermission()) return
        listening = true
        startButton.isEnabled = false
        nextButton.isEnabled = false
        partialCount = 0
        latestPartial = ""
        firstPartialMs = null
        speechEndMs = null
        recognitionStartMs = SystemClock.elapsedRealtime()
        hypothesisView.text = "Transcription Android : écoute en cours…"
        metricsView.text = "Lisez le texte normalement, puis attendez le résultat final."
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, corpusLanguage)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Deliberately no EXTRA_PREFER_OFFLINE and no EXTRA_AUDIO_SOURCE:
            // this benchmark measures the system-default native microphone path.
        }
        recognizer?.startListening(intent)
    }

    override fun onPartialResults(partialResults: Bundle?) {
        partialCount++
        if (firstPartialMs == null) firstPartialMs = SystemClock.elapsedRealtime() - recognitionStartMs
        latestPartial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        if (latestPartial.isNotBlank()) hypothesisView.text = "Partiel : $latestPartial"
    }

    override fun onEndOfSpeech() {
        speechEndMs = SystemClock.elapsedRealtime()
        statusView.text = "Fin de parole détectée — attente du résultat final Android…"
    }

    override fun onResults(bundle: Bundle?) {
        val now = SystemClock.elapsedRealtime()
        val hypothesis = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        val result = scoreCurrent(
            hypothesis = hypothesis,
            finalCount = if (hypothesis.isNotBlank()) 1 else 0,
            errorCode = null,
            errorName = null,
            totalFinalMs = now - recognitionStartMs,
            finalAfterSpeechMs = speechEndMs?.let { max(0L, now - it) }
        )
        finishPassage(result)
    }

    override fun onError(error: Int) {
        val result = scoreCurrent(
            hypothesis = latestPartial.trim(),
            finalCount = 0,
            errorCode = error,
            errorName = errorName(error),
            totalFinalMs = null,
            finalAfterSpeechMs = null
        )
        finishPassage(result)
    }

    private fun scoreCurrent(
        hypothesis: String,
        finalCount: Int,
        errorCode: Int?,
        errorName: String?,
        totalFinalMs: Long?,
        finalAfterSpeechMs: Long?
    ): PassageResult {
        val p = passages[currentIndex]
        val refNorm = normalizeForWer(p.reference)
        val hypNorm = normalizeForWer(hypothesis)
        val edits = wordEdits(refNorm, hypNorm)
        val cer = charErrorRate(refNorm, hypNorm)
        val entityScores = p.entities.groupBy { it.category }.mapValues { (_, entities) ->
            val hits = entities.count { e -> e.variants.any { variant -> containsNormalized(hypothesis, variant) } }
            EntityScore(hits, entities.size)
        }
        return PassageResult(
            p, hypothesis, refNorm, hypNorm, edits, cer, entityScores,
            firstPartialMs, finalAfterSpeechMs, totalFinalMs, partialCount, finalCount,
            errorCode, errorName, punctuationCount(p.reference), punctuationCount(hypothesis)
        )
    }

    private fun finishPassage(result: PassageResult) {
        listening = false
        results.removeAll { it.passage.id == result.passage.id }
        results += result
        hypothesisView.text = "Transcription Android : ${result.hypothesisRaw.ifBlank { "∅" }}"
        metricsView.text = "WER ${(result.edits.wer * 100).format1()} % · CER ${(result.cer * 100).format1()} % · " +
            "S=${result.edits.substitutions} D=${result.edits.deletions} I=${result.edits.insertions} · " +
            "final=${result.finalCount} · erreur=${result.errorName ?: "aucune"}"
        statusView.text = if (result.errorCode == null) "Passage enregistré. Passez au texte suivant." else
            "Erreur technique ${result.errorName}; elle comptera dans le benchmark. Passez au texte suivant."
        nextButton.isEnabled = true
        startButton.isEnabled = false
        if (currentIndex == passages.lastIndex) nextButton.text = "Terminer et calculer le verdict"
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
        header.text = "Android Native ASR — ${aggregate.getString("verdict")}"
        referenceView.text = "Corpus $corpusId terminé : ${aggregate.getInt("completedFinalPassages")}/${passages.size} résultats finaux."
        hypothesisView.text = "WER global ${(aggregate.getDouble("globalWer") * 100).format1()} % · entités critiques ${(aggregate.optDouble("criticalEntityAccuracy", 0.0) * 100).format1()} %"
        metricsView.text = aggregate.getJSONArray("reasonCodes").strings().joinToString(" · ")
        statusView.text = "Benchmark terminé. Enregistrez le JSON et transmettez-le pour analyse comparative."
        startButton.visibility = View.GONE
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
        val criticalHits = allEntities.count { (r, e) -> e.variants.any { containsNormalized(r.hypothesisRaw, it) } }
        val criticalTotal = allEntities.size
        val criticalAccuracy = if (criticalTotal == 0) 1.0 else criticalHits.toDouble() / criticalTotal
        val completedFinal = ordered.count { it.finalCount > 0 && it.errorCode == null }
        val everydayWer = ordered.firstOrNull { it.passage.category == "french_everyday" }?.edits?.wer ?: 1.0
        val blockingErrors = ordered.count { it.errorCode != null }
        val completionRatio = completedFinal.toDouble() / passages.size
        val verdict = when {
            completionRatio == 1.0 && blockingErrors == 0 && globalWer <= 0.10 && criticalAccuracy >= 0.90 && everydayWer <= 0.08 -> "PASS_NATIVE_ASR"
            completionRatio == 1.0 && blockingErrors == 0 && globalWer <= 0.15 && criticalAccuracy >= 0.80 -> "PASS_WITH_LIMITATIONS"
            completionRatio >= 0.80 -> "HOLD_NATIVE_ASR"
            else -> "FAIL_NATIVE_ASR"
        }
        val reasons = mutableListOf<String>()
        reasons += "completion=${completedFinal}/${passages.size}"
        reasons += "global_wer=${"%.4f".format(Locale.US, globalWer)}"
        reasons += "critical_entity_accuracy=${"%.4f".format(Locale.US, criticalAccuracy)}"
        reasons += "everyday_wer=${"%.4f".format(Locale.US, everydayWer)}"
        if (blockingErrors > 0) reasons += "blocking_errors=$blockingErrors"

        return JSONObject().apply {
            put("schema", RESULT_SCHEMA)
            put("exportedAt", Instant.now().toString())
            put("candidateBuild", "android-native-${BuildConfig.VERSION_NAME}")
            put("corpus", JSONObject().apply {
                put("id", corpusId); put("language", corpusLanguage); put("status", "FROZEN")
                put("passageCount", passages.size)
            })
            put("platform", JSONObject().apply {
                put("name", "Android")
                put("recognizerMode", MODE)
                put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(this@NativeAsrBenchmarkActivity))
                put("onDeviceRecognitionAvailable", SpeechRecognizer.isOnDeviceRecognitionAvailable(this@NativeAsrBenchmarkActivity))
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
            put("scoringPolicy", JSONObject().apply {
                put("primary", "normalized_WER")
                put("passGate", "all finals, no blocking errors, WER<=0.10, critical entities>=0.90, everyday WER<=0.08")
                put("limitationsGate", "all finals, no blocking errors, WER<=0.15, critical entities>=0.80")
                put("punctuationExcludedFromWer", true)
            })
            put("passages", JSONArray().apply { ordered.forEach { put(resultToJson(it)) } })
            put("aggregate", JSONObject().apply {
                put("completedFinalPassages", completedFinal)
                put("totalPassages", passages.size)
                put("completionRatio", completionRatio)
                put("substitutions", sumS); put("deletions", sumD); put("insertions", sumI); put("referenceWords", sumRef)
                put("globalWer", globalWer)
                put("criticalEntityHits", criticalHits); put("criticalEntityTotal", criticalTotal)
                put("criticalEntityAccuracy", criticalAccuracy)
                put("everydayWer", everydayWer)
                put("blockingErrors", blockingErrors)
                put("categoryMetrics", JSONArray().apply {
                    ordered.forEach { r -> put(JSONObject().put("category", r.passage.category).put("wer", r.edits.wer).put("cer", r.cer)) }
                })
                put("verdict", verdict)
                put("reasonCodes", JSONArray(reasons))
            })
        }
    }

    private fun resultToJson(r: PassageResult): JSONObject = JSONObject().apply {
        put("id", r.passage.id); put("level", r.passage.level); put("category", r.passage.category); put("title", r.passage.title)
        put("referenceRaw", r.passage.reference); put("hypothesisRaw", r.hypothesisRaw)
        put("referenceNormalized", r.referenceNormalized); put("hypothesisNormalized", r.hypothesisNormalized)
        put("wer", JSONObject().apply {
            put("substitutions", r.edits.substitutions); put("deletions", r.edits.deletions); put("insertions", r.edits.insertions)
            put("referenceWords", r.edits.refWords); put("value", r.edits.wer)
        })
        put("cer", r.cer)
        put("entityScores", JSONObject().apply {
            r.entityScores.forEach { (category, s) -> put(category, JSONObject().put("hits", s.hits).put("total", s.total).put("accuracy", s.accuracy ?: JSONObject.NULL)) }
        })
        put("latency", JSONObject().apply {
            put("firstPartialMs", r.firstPartialMs ?: JSONObject.NULL)
            put("finalAfterSpeechMs", r.finalAfterSpeechMs ?: JSONObject.NULL)
            put("totalFinalMs", r.totalFinalMs ?: JSONObject.NULL)
        })
        put("partialCount", r.partialCount); put("finalCount", r.finalCount)
        put("errorCode", r.errorCode ?: JSONObject.NULL); put("errorName", r.errorName ?: JSONObject.NULL)
        put("punctuation", JSONObject().put("referenceMarks", r.referencePunctuationMarks).put("hypothesisMarks", r.hypothesisPunctuationMarks))
    }

    private fun normalizeBase(raw: String): String {
        val lower = raw.lowercase(Locale.FRANCE).replace('’', '\'').replace('-', ' ')
        val decomposed = Normalizer.normalize(lower, Normalizer.Form.NFD)
        return decomposed.replace(Regex("\\p{M}+"), "")
            .replace(Regex("[^a-z0-9%]+"), " ")
            .trim().replace(Regex("\\s+"), " ")
    }

    private fun normalizeForWer(raw: String): String {
        var value = normalizeBase(raw)
        val replacements = aliases.flatMap { a -> a.variants.map { v -> normalizeBase(v) to normalizeBase(a.canonical) } }
            .sortedByDescending { it.first.length }
        replacements.forEach { (variant, canonical) -> if (variant.isNotBlank()) value = value.replace(variant, canonical) }
        return value.trim().replace(Regex("\\s+"), " ")
    }

    private fun containsNormalized(raw: String, variant: String): Boolean {
        val hay = " ${normalizeBase(raw)} "
        val needle = " ${normalizeBase(variant)} "
        return hay.contains(needle)
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
        val payload = lastExportJson ?: return
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "native-asr-benchmark-$corpusId-${System.currentTimeMillis()}.json")
        }, REQ_SAVE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SAVE && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            contentResolver.openOutputStream(uri)?.use { it.write(lastExportJson.orEmpty().toByteArray(Charsets.UTF_8)) }
            statusView.text = "Résultat JSON enregistré."
        }
    }

    override fun onDestroy() {
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
