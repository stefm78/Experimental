package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Isolated embedded-ASR experiment after H7 closed the durable Android SpeechRecognizer path.
 *
 * Protected invariant: AudioRecord -> WAV is authoritative and never waits for ASR.
 * Turn PCM is snapshotted in memory at exact UI boundaries and decoded later on a dedicated
 * single-threaded Vosk executor. ASR latency therefore cannot block capture or question changes.
 */
class EmbeddedAsrLabActivity : Activity() {
    private lateinit var interviewSpec: NativeInterviewSpec
    private lateinit var status: TextView
    private lateinit var interviewTitle: TextView
    private lateinit var questionMeta: TextView
    private lateinit var question: TextView
    private lateinit var transcriptView: TextView
    private lateinit var loadButton: Button
    private lateinit var startButton: Button
    private lateinit var nextButton: Button
    private lateinit var stopButton: Button
    private lateinit var saveButton: Button
    private lateinit var exportView: TextView

    private val backgroundExecutor = Executors.newSingleThreadExecutor()
    private val asrExecutor = Executors.newSingleThreadExecutor()
    private val recording = AtomicBoolean(false)
    private val turnPcmLock = Any()

    private var model: Model? = null
    @Volatile private var modelReady = false
    @Volatile private var modelError: String? = null

    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var wavFile: File? = null
    private var wavRaf: RandomAccessFile? = null
    private var bytesWritten = 0L
    private var sessionStartMs = 0L
    private var sessionStartedAt: String? = null
    private var sessionCompletedAt: String? = null
    private var runtimeSessionId = ""
    @Volatile private var currentTurn = 0
    private var lastExportJson: String? = null

    private data class Boundary(val turn: Int, val atMs: Long)
    private data class AsrMetric(
        val turn: Int,
        val inputBytes: Long,
        val inputAudioMs: Long,
        val decodeWallMs: Long,
        val endpointResultCount: Int,
        val finalResidualPresent: Boolean,
        val source: String,
        val text: String,
        val error: String?
    )

    private val boundaries = mutableListOf<Boundary>()
    private lateinit var turnPcmChunks: MutableList<MutableList<ByteArray>>
    private val transcriptByTurn = mutableMapOf<Int, String>()
    private val sourceByTurn = mutableMapOf<Int, String>()
    private val asrMetrics = mutableMapOf<Int, AsrMetric>()

    private val questions get() = interviewSpec.questions

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        interviewSpec = loadBundledSpec()
        handleIncomingSpec(intent, true)
        buildUi()
        renderInterviewHeader()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERMISSION)
        }
        prepareModelAsync()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent != null) handleIncomingSpec(intent, false)
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        status = TextView(this).apply { text = "Préparation du modèle Vosk français…" }
        interviewTitle = TextView(this).apply { textSize = 22f }
        questionMeta = TextView(this).apply { textSize = 14f; setPadding(0, 16, 0, 4) }
        question = TextView(this).apply { textSize = 20f }
        transcriptView = TextView(this).apply {
            text = "Le transcript durable est calculé localement en arrière-plan à chaque frontière."
            setPadding(0, 24, 0, 24)
            setTextIsSelectable(true)
        }
        loadButton = Button(this).apply { text = "Charger un questionnaire JSON" }
        startButton = Button(this).apply { text = "Démarrer l'entretien"; isEnabled = false }
        nextButton = Button(this).apply { text = "Question suivante"; isEnabled = false }
        stopButton = Button(this).apply { text = "Terminer"; isEnabled = false }
        saveButton = Button(this).apply { text = "Enregistrer le résultat JSON"; isEnabled = false }
        exportView = TextView(this).apply { setTextIsSelectable(true); setPadding(0, 24, 0, 0) }

        loadButton.setOnClickListener { chooseInterviewSpec() }
        startButton.setOnClickListener { startSession() }
        nextButton.setOnClickListener { nextTurn() }
        stopButton.setOnClickListener { stopSession() }
        saveButton.setOnClickListener { saveResultJson() }

        listOf(status, interviewTitle, questionMeta, question, transcriptView, loadButton,
            startButton, nextButton, stopButton, saveButton, exportView).forEach(root::addView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun prepareModelAsync() {
        backgroundExecutor.execute {
            try {
                LibVosk.setLogLevel(LogLevel.WARNINGS)
                val modelDir = File(filesDir, MODEL_ASSET_DIR)
                val marker = File(modelDir, ".offline-interview-model-$MODEL_ZIP_SHA256")
                if (!marker.exists()) {
                    if (modelDir.exists()) modelDir.deleteRecursively()
                    copyAssetTree(MODEL_ASSET_DIR, modelDir)
                    marker.writeText(MODEL_ZIP_SHA256)
                }
                model = Model(modelDir.absolutePath)
                modelReady = true
                runOnUiThread { refreshReadyState() }
            } catch (e: Exception) {
                modelError = e.message ?: e.javaClass.simpleName
                runOnUiThread { refreshReadyState() }
            }
        }
    }

    private fun copyAssetTree(assetPath: String, destination: File) {
        val children = assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            destination.parentFile?.mkdirs()
            assets.open(assetPath).use { input -> FileOutputStream(destination).use { input.copyTo(it) } }
        } else {
            destination.mkdirs()
            children.forEach { child -> copyAssetTree("$assetPath/$child", File(destination, child)) }
        }
    }

    private fun refreshReadyState() {
        val permission = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        startButton.isEnabled = modelReady && permission && !recording.get()
        status.text = when {
            modelError != null -> "FAIL modèle Vosk: $modelError"
            !permission -> "Permission micro requise. Modèle: ${if (modelReady) "prêt" else "chargement…"}"
            !modelReady -> "Préparation locale de $MODEL_ID…"
            else -> "Prêt — Vosk embarqué français; ${questions.size} questions."
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO_PERMISSION) refreshReadyState()
    }

    private fun loadBundledSpec() = InterviewContract.parse(
        assets.open("interview.json").bufferedReader().use { it.readText() }
    )

    private fun chooseInterviewSpec() {
        if (recording.get()) return
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
        }, REQ_OPEN_SPEC)
    }

    private fun handleIncomingSpec(intent: Intent, silent: Boolean) {
        val uri = intent.data ?: return
        if (recording.get()) return
        try {
            loadSpecFromUri(uri)
            if (!silent && ::status.isInitialized) status.text = "Questionnaire chargé."
        } catch (e: Exception) {
            if (!silent && ::status.isInitialized) status.text = "Questionnaire refusé: ${e.message}"
        }
    }

    private fun loadSpecFromUri(uri: Uri) {
        val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            ?: throw IllegalArgumentException("Impossible de lire le questionnaire.")
        interviewSpec = InterviewContract.parse(text)
        currentTurn = 0
        lastExportJson = null
        renderInterviewHeader()
        refreshReadyState()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        when (requestCode) {
            REQ_OPEN_SPEC -> data?.data?.let { uri ->
                try {
                    loadSpecFromUri(uri)
                    status.text = "Questionnaire chargé: ${interviewSpec.title}."
                } catch (e: Exception) {
                    status.text = "Questionnaire refusé: ${e.message}"
                }
            }
            REQ_SAVE_RESULT -> data?.data?.let { uri ->
                val payload = lastExportJson ?: return
                backgroundExecutor.execute {
                    val message = try {
                        contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                        "Résultat JSON enregistré."
                    } catch (e: Exception) { "Échec export JSON: ${e.message}" }
                    runOnUiThread { status.text = message }
                }
            }
        }
    }

    private fun renderInterviewHeader() {
        if (!::interviewTitle.isInitialized) return
        currentTurn = currentTurn.coerceIn(0, questions.lastIndex)
        val q = questions[currentTurn]
        interviewTitle.text = interviewSpec.title
        questionMeta.text = "${q.sectionTitle} · ${q.id} · ${currentTurn + 1}/${questions.size}${if (q.label.isNotBlank()) " · ${q.label}" else ""}"
        question.text = q.text
        transcriptView.text = transcriptByTurn[currentTurn]
            ?: "Capture WAV en cours. La transcription Vosk est calculée après la frontière de cette question."
    }

    private fun startSession() {
        if (!modelReady || model == null) {
            status.text = "Modèle Vosk non prêt."
            return
        }
        if (!recording.compareAndSet(false, true)) return

        sessionStartMs = SystemClock.elapsedRealtime()
        sessionStartedAt = Instant.now().toString()
        sessionCompletedAt = null
        runtimeSessionId = UUID.randomUUID().toString()
        currentTurn = 0
        boundaries.clear()
        boundaries += Boundary(0, 0L)
        transcriptByTurn.clear()
        sourceByTurn.clear()
        asrMetrics.clear()
        turnPcmChunks = MutableList(questions.size) { mutableListOf() }
        bytesWritten = 0L
        lastExportJson = null

        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, SAMPLE_RATE)
        )
        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            recording.set(false)
            status.text = "FAIL: AudioRecord non initialisé."
            return
        }

        val dir = getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: filesDir
        wavFile = File(dir, "offline-interview-embedded-${System.currentTimeMillis()}.wav")
        wavRaf = RandomAccessFile(wavFile, "rw").apply { write(ByteArray(44)) }
        try {
            audioRecord?.startRecording()
            captureThread = Thread({ captureLoop() }, "offline-interview-master-capture").also { it.start() }
        } catch (e: Exception) {
            recording.set(false)
            status.text = "FAIL capture: ${e.message}"
            return
        }

        renderInterviewHeader()
        loadButton.isEnabled = false
        startButton.isEnabled = false
        nextButton.isEnabled = questions.size > 1
        stopButton.isEnabled = true
        saveButton.isEnabled = false
        status.text = "RUNNING — WAV maître continu; Vosk totalement hors du chemin de capture."
    }

    private fun captureLoop() {
        val buffer = ByteArray(CAPTURE_CHUNK_BYTES)
        while (recording.get()) {
            val n = try { audioRecord?.read(buffer, 0, buffer.size) ?: -1 } catch (_: Exception) { -1 }
            if (n <= 0) continue
            try {
                wavRaf?.write(buffer, 0, n)
                bytesWritten += n
            } catch (_: Exception) {
                recording.set(false)
                runOnUiThread { status.text = "FAIL_MASTER: écriture WAV interrompue." }
                break
            }
            val copy = buffer.copyOf(n)
            synchronized(turnPcmLock) {
                if (::turnPcmChunks.isInitialized && currentTurn in turnPcmChunks.indices) {
                    turnPcmChunks[currentTurn].add(copy)
                }
            }
        }
    }

    private fun nextTurn() {
        if (!recording.get() || currentTurn >= questions.lastIndex) return
        val oldTurn: Int
        val newTurn: Int
        val boundaryAt: Long
        val chunks: List<ByteArray>
        synchronized(turnPcmLock) {
            oldTurn = currentTurn
            newTurn = oldTurn + 1
            boundaryAt = elapsedMs()
            chunks = turnPcmChunks[oldTurn].toList()
            turnPcmChunks[oldTurn].clear()
            currentTurn = newTurn
            boundaries += Boundary(newTurn, boundaryAt)
        }
        submitTranscription(oldTurn, chunks)
        renderInterviewHeader()
        if (newTurn == questions.lastIndex) nextButton.isEnabled = false
        status.text = "${questions[newTurn].id} — capture continue; ${questions[oldTurn].id} transcrite en arrière-plan."
    }

    private fun submitTranscription(turn: Int, chunks: List<ByteArray>) {
        asrExecutor.execute { transcribeTurn(turn, chunks) }
    }

    private fun transcribeTurn(turn: Int, chunks: List<ByteArray>) {
        val m = model
        val inputBytes = chunks.sumOf { it.size.toLong() }
        val inputAudioMs = inputBytes * 1000L / (SAMPLE_RATE * 2L)
        val start = SystemClock.elapsedRealtime()
        var endpointCount = 0
        var finalResidualPresent = false
        var latestPartial = ""
        val durablePieces = mutableListOf<String>()
        var error: String? = null

        if (m == null) {
            error = "model_not_ready"
        } else {
            try {
                Recognizer(m, SAMPLE_RATE.toFloat()).use { recognizer ->
                    recognizer.setWords(true)
                    for (chunk in chunks) {
                        if (recognizer.acceptWaveForm(chunk, chunk.size)) {
                            parseVoskText(recognizer.result).takeIf { it.isNotBlank() }?.let {
                                durablePieces += it
                                endpointCount++
                            }
                        } else {
                            latestPartial = parseVoskPartial(recognizer.partialResult).ifBlank { latestPartial }
                        }
                    }
                    val residual = parseVoskText(recognizer.finalResult)
                    if (residual.isNotBlank()) {
                        durablePieces += residual
                        finalResidualPresent = true
                    }
                }
            } catch (e: Exception) {
                error = e.message ?: e.javaClass.simpleName
            }
        }

        val durable = durablePieces.joinToString(" ").replace(Regex("\\s+"), " ").trim()
        val text = durable.ifBlank { latestPartial.trim() }
        val source = when {
            durable.isNotBlank() -> "embedded_vosk_final"
            latestPartial.isNotBlank() -> "embedded_vosk_partial_fallback"
            else -> "embedded_vosk_empty"
        }
        val decodeWallMs = SystemClock.elapsedRealtime() - start

        synchronized(asrMetrics) {
            transcriptByTurn[turn] = text
            sourceByTurn[turn] = source
            asrMetrics[turn] = AsrMetric(
                turn, inputBytes, inputAudioMs, decodeWallMs, endpointCount,
                finalResidualPresent, source, text, error
            )
        }
        runOnUiThread {
            if (!recording.get()) return@runOnUiThread
            status.text = "ASR ${questions[turn].id}: ${if (error == null) "OK" else "FAIL"} · ${decodeWallMs} ms · ${text.length} caractères."
        }
    }

    private fun parseVoskText(json: String): String = try { JSONObject(json).optString("text").trim() } catch (_: Exception) { "" }
    private fun parseVoskPartial(json: String): String = try { JSONObject(json).optString("partial").trim() } catch (_: Exception) { "" }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        nextButton.isEnabled = false
        stopButton.isEnabled = false
        status.text = "Finalisation WAV puis transcription locale…"
        try { audioRecord?.stop() } catch (_: Exception) {}

        backgroundExecutor.execute {
            try { captureThread?.join(1500) } catch (_: Exception) {}
            val lastTurn: Int
            val chunks: List<ByteArray>
            synchronized(turnPcmLock) {
                lastTurn = currentTurn
                chunks = turnPcmChunks[lastTurn].toList()
                turnPcmChunks[lastTurn].clear()
            }
            asrExecutor.execute {
                transcribeTurn(lastTurn, chunks)
                finalizeWav()
                sessionCompletedAt = Instant.now().toString()
                val payload = buildProductResult().toString(2)
                lastExportJson = payload
                val answered = questions.indices.count { transcriptByTurn[it].orEmpty().isNotBlank() }
                val failures = asrMetrics.values.count { it.error != null || it.text.isBlank() }
                runOnUiThread {
                    exportView.text = "Résultat prêt — $answered/${questions.size} réponses · ASR failures=$failures."
                    loadButton.isEnabled = true
                    startButton.isEnabled = modelReady
                    saveButton.isEnabled = true
                    status.text = "STOPPED — WAV maître + Vosk embarqué finalisés."
                }
            }
        }
    }

    private fun buildProductResult(): JSONObject {
        val durationMs = bytesWritten * 1000L / (SAMPLE_RATE * 2L)
        val interviewee = interviewSpec.interviewee
        val answered = questions.indices.count { transcriptByTurn[it].orEmpty().isNotBlank() }
        val sectionsOut = JSONArray().apply {
            val sourceSections = interviewSpec.raw.optJSONArray("sections") ?: JSONArray()
            for (si in 0 until sourceSections.length()) {
                val sourceSection = sourceSections.optJSONObject(si) ?: continue
                val sectionOut = InterviewContract.cloneJson(sourceSection)
                val sourceQs = sourceSection.optJSONArray("questions") ?: JSONArray()
                val qOuts = JSONArray()
                for (qi in 0 until sourceQs.length()) {
                    val sourceQ = sourceQs.optJSONObject(qi) ?: continue
                    val qOut = InterviewContract.cloneJson(sourceQ)
                    val qId = sourceQ.optString("id")
                    val flat = questions.indexOfFirst { it.id == qId }
                    val turns = JSONArray()
                    if (flat >= 0) {
                        val text = transcriptByTurn[flat].orEmpty().trim()
                        if (text.isNotEmpty()) {
                            turns.put(JSONObject().apply {
                                put("id", "embedded-$runtimeSessionId-$qId")
                                put("questionId", qId)
                                put("speakerId", interviewee.id)
                                put("speakerName", interviewee.name)
                                put("speakerRole", interviewee.role)
                                put("type", "answer")
                                put("source", "speech")
                                put("text", text)
                                put("rawTranscript", text)
                                put("transcriptionSource", "embedded-vosk-small-fr-0.22")
                                put("draftSource", sourceByTurn[flat] ?: "embedded_vosk_unknown")
                                put("canonicalSource", "draft_stt")
                                put("audioStartMs", boundaries.firstOrNull { it.turn == flat }?.atMs ?: JSONObject.NULL)
                                put("audioEndMs", boundaries.firstOrNull { it.turn == flat + 1 }?.atMs ?: durationMs)
                            })
                        }
                    }
                    qOut.put("turns", turns)
                    qOuts.put(qOut)
                }
                sectionOut.put("questions", qOuts)
                put(sectionOut)
            }
        }

        return JSONObject().apply {
            put("schema", InterviewContract.RESULT_SCHEMA)
            put("version", "1.0")
            put("exportedAt", Instant.now().toString())
            put("provenance", JSONObject().apply {
                put("appBuild", "android-native-${BuildConfig.VERSION_NAME}")
                put("inputSchema", InterviewContract.SPEC_SCHEMA)
                put("transcriptionDefault", "embedded-vosk-small-fr-0.22")
                put("transcriptionFallback", "embedded_vosk_partial_fallback")
                put("privacy", "Audio and ASR remain fully local; no network is used at runtime.")
            })
            put("interview", JSONObject().apply {
                put("id", interviewSpec.id)
                put("version", interviewSpec.version)
                put("title", interviewSpec.title)
                put("estimatedDurationMinutes", interviewSpec.estimatedDurationMinutes ?: JSONObject.NULL)
                put("context", interviewSpec.context)
                put("objective", interviewSpec.objective)
                put("language", interviewSpec.language)
                put("tags", interviewSpec.raw.optJSONArray("tags") ?: JSONArray())
            })
            put("participants", JSONArray().apply {
                interviewSpec.participants.forEach { p -> put(JSONObject().apply {
                    put("id", p.id); put("name", p.name); put("role", p.role); put("active", true); put("removedAt", JSONObject.NULL)
                }) }
            })
            put("session", JSONObject().apply {
                put("id", runtimeSessionId)
                put("startedAt", sessionStartedAt ?: JSONObject.NULL)
                put("completedAt", sessionCompletedAt ?: JSONObject.NULL)
                put("completed", true)
                put("activeDurationSeconds", durationMs / 1000L)
                put("completion", JSONObject().apply {
                    put("answeredQuestions", answered)
                    put("totalQuestions", questions.size)
                    put("unansweredQuestions", questions.size - answered)
                    put("followUpsUsed", 0)
                })
            })
            put("sections", sectionsOut)
            put("nativeCapture", JSONObject().apply {
                put("schema", "offline-interview.android-embedded-asr-lab.v1")
                put("appVersion", BuildConfig.VERSION_NAME)
                put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
                put("asrProvider", "Vosk Android 0.3.75")
                put("asrModel", MODEL_ID)
                put("asrModelZipSha256", MODEL_ZIP_SHA256)
                put("routingAuthority", "turn_pcm_snapshot_at_ui_boundary")
                put("runtimeNetworkRequired", false)
                put("wavPath", wavFile?.absolutePath ?: "")
                put("pcmBytes", bytesWritten)
                put("audioDurationMs", durationMs)
                put("turnBoundaries", JSONArray().apply {
                    boundaries.forEach { b -> put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs)) }
                })
                put("asrMetrics", JSONArray().apply {
                    questions.indices.forEach { turn ->
                        val m = asrMetrics[turn]
                        put(JSONObject().apply {
                            put("questionId", questions[turn].id)
                            put("inputBytes", m?.inputBytes ?: 0)
                            put("inputAudioMs", m?.inputAudioMs ?: 0)
                            put("decodeWallMs", m?.decodeWallMs ?: JSONObject.NULL)
                            put("realTimeFactor", if (m != null && m.inputAudioMs > 0) m.decodeWallMs.toDouble() / m.inputAudioMs else JSONObject.NULL)
                            put("endpointResultCount", m?.endpointResultCount ?: 0)
                            put("finalResidualPresent", m?.finalResidualPresent ?: false)
                            put("draftSource", m?.source ?: JSONObject.NULL)
                            put("textLength", m?.text?.length ?: 0)
                            put("error", m?.error ?: JSONObject.NULL)
                        })
                    }
                })
            })
        }
    }

    private fun saveResultJson() {
        val payload = lastExportJson ?: return
        val safeId = interviewSpec.id.replace(Regex("[^A-Za-z0-9._-]"), "-")
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "offline-interview-vosk-$safeId-$runtimeSessionId.json")
        }, REQ_SAVE_RESULT)
    }

    private fun finalizeWav() {
        try {
            wavRaf?.let { raf ->
                raf.seek(0)
                raf.write(wavHeader(bytesWritten, SAMPLE_RATE, 1, 16))
                raf.close()
            }
        } catch (_: Exception) {}
        wavRaf = null
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
    }

    private fun elapsedMs() = SystemClock.elapsedRealtime() - sessionStartMs

    override fun onDestroy() {
        recording.set(false)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { captureThread?.join(500) } catch (_: Exception) {}
        try { wavRaf?.close() } catch (_: Exception) {}
        try { audioRecord?.release() } catch (_: Exception) {}
        asrExecutor.shutdownNow()
        backgroundExecutor.shutdownNow()
        try { model?.close() } catch (_: Exception) {}
        model = null
        super.onDestroy()
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val CAPTURE_CHUNK_BYTES = 3200
        private const val MODEL_ID = "vosk-model-small-fr-0.22"
        private const val MODEL_ASSET_DIR = "vosk-model-small-fr-0.22"
        private const val MODEL_ZIP_SHA256 = "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"
        private const val REQ_AUDIO_PERMISSION = 7
        private const val REQ_OPEN_SPEC = 41
        private const val REQ_SAVE_RESULT = 42

        private fun wavHeader(dataBytes: Long, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
            val byteRate = sampleRate * channels * bitsPerSample / 8
            val blockAlign = channels * bitsPerSample / 8
            val totalDataLen = dataBytes + 36
            return ByteArray(44).also { h ->
                fun ascii(offset: Int, value: String) { value.toByteArray(Charsets.US_ASCII).copyInto(h, offset) }
                fun le16(offset: Int, value: Int) { h[offset] = (value and 0xff).toByte(); h[offset + 1] = ((value ushr 8) and 0xff).toByte() }
                fun le32(offset: Int, value: Long) {
                    h[offset] = (value and 0xff).toByte(); h[offset + 1] = ((value ushr 8) and 0xff).toByte()
                    h[offset + 2] = ((value ushr 16) and 0xff).toByte(); h[offset + 3] = ((value ushr 24) and 0xff).toByte()
                }
                ascii(0, "RIFF"); le32(4, totalDataLen); ascii(8, "WAVE"); ascii(12, "fmt ")
                le32(16, 16); le16(20, 1); le16(22, channels); le32(24, sampleRate.toLong())
                le32(28, byteRate.toLong()); le16(32, blockAlign); le16(34, bitsPerSample)
                ascii(36, "data"); le32(40, dataBytes)
            }
        }
    }
}
