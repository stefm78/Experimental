package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Isolated provider-quality benchmark after the embedded-ASR architecture passed physically.
 *
 * Protected invariant: one AudioRecord -> WAV master remains authoritative. The capture thread
 * only writes WAV bytes and appends PCM to the current turn. Vosk and Whisper both decode frozen
 * turn PCM later on a dedicated worker, so provider latency cannot block capture or the UI.
 *
 * No provider is promoted by this lab. The exported result contains both transcripts/metrics and
 * the qualification ZIP contains the master WAV so future providers can be replayed without a
 * new human recording.
 */
class DualAsrBenchmarkActivity : Activity() {
    private lateinit var interviewSpec: NativeInterviewSpec
    private lateinit var status: TextView
    private lateinit var interviewTitle: TextView
    private lateinit var questionMeta: TextView
    private lateinit var question: TextView
    private lateinit var benchmarkView: TextView
    private lateinit var startButton: Button
    private lateinit var nextButton: Button
    private lateinit var stopButton: Button
    private lateinit var saveJsonButton: Button
    private lateinit var saveBundleButton: Button

    private val recording = AtomicBoolean(false)
    private val backgroundExecutor = Executors.newSingleThreadExecutor()
    private val benchmarkExecutor = Executors.newSingleThreadExecutor()
    private val turnPcmLock = Any()

    private var voskModel: Model? = null
    private var whisperRecognizer: OfflineRecognizer? = null
    @Volatile private var modelsReady = false
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
    private data class ProviderMetric(
        val turn: Int,
        val provider: String,
        val model: String,
        val inputBytes: Long,
        val inputAudioMs: Long,
        val decodeWallMs: Long,
        val text: String,
        val source: String,
        val error: String?
    )

    private val boundaries = mutableListOf<Boundary>()
    private lateinit var turnPcmChunks: MutableList<MutableList<ByteArray>>
    private val providerMetrics = mutableMapOf<Int, MutableMap<String, ProviderMetric>>()

    private val questions get() = interviewSpec.questions

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        interviewSpec = InterviewContract.parse(assets.open("interview.json").bufferedReader().use { it.readText() })
        buildUi()
        renderQuestion()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERMISSION)
        }
        prepareModelsAsync()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        status = TextView(this).apply { text = "Préparation Vosk + Whisper…" }
        interviewTitle = TextView(this).apply { textSize = 22f }
        questionMeta = TextView(this).apply { textSize = 14f; setPadding(0, 16, 0, 4) }
        question = TextView(this).apply { textSize = 20f }
        benchmarkView = TextView(this).apply {
            text = "Benchmark non promu : les deux moteurs transcriront le même PCM."
            setPadding(0, 24, 0, 24)
            setTextIsSelectable(true)
        }
        startButton = Button(this).apply { text = "Démarrer l'entretien benchmark"; isEnabled = false }
        nextButton = Button(this).apply { text = "Question suivante"; isEnabled = false }
        stopButton = Button(this).apply { text = "Terminer"; isEnabled = false }
        saveJsonButton = Button(this).apply { text = "Enregistrer le résultat JSON"; isEnabled = false }
        saveBundleButton = Button(this).apply { text = "Enregistrer le bundle qualification ZIP"; isEnabled = false }

        startButton.setOnClickListener { startSession() }
        nextButton.setOnClickListener { nextTurn() }
        stopButton.setOnClickListener { stopSession() }
        saveJsonButton.setOnClickListener { requestSaveJson() }
        saveBundleButton.setOnClickListener { requestSaveBundle() }

        listOf(status, interviewTitle, questionMeta, question, benchmarkView, startButton, nextButton,
            stopButton, saveJsonButton, saveBundleButton).forEach(root::addView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun renderQuestion() {
        interviewTitle.text = interviewSpec.title
        val q = questions[currentTurn]
        questionMeta.text = "${q.sectionTitle} · ${q.id} · ${currentTurn + 1}/${questions.size}"
        question.text = q.text
    }

    private fun prepareModelsAsync() {
        backgroundExecutor.execute {
            try {
                LibVosk.setLogLevel(LogLevel.WARNINGS)
                val voskDir = File(filesDir, VOSK_ASSET_DIR)
                val marker = File(voskDir, ".offline-interview-$VOSK_ZIP_SHA256")
                if (!marker.exists()) {
                    if (voskDir.exists()) voskDir.deleteRecursively()
                    copyAssetTree(VOSK_ASSET_DIR, voskDir)
                    marker.writeText(VOSK_ZIP_SHA256)
                }
                voskModel = Model(voskDir.absolutePath)

                whisperRecognizer = OfflineRecognizer(
                    assetManager = assets,
                    config = OfflineRecognizerConfig(
                        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
                        modelConfig = OfflineModelConfig(
                            whisper = OfflineWhisperModelConfig(
                                encoder = "$WHISPER_ASSET_DIR/tiny-encoder.int8.onnx",
                                decoder = "$WHISPER_ASSET_DIR/tiny-decoder.int8.onnx",
                                language = "fr",
                                task = "transcribe"
                            ),
                            tokens = "$WHISPER_ASSET_DIR/tiny-tokens.txt",
                            numThreads = 2,
                            debug = false,
                            provider = "cpu"
                        )
                    )
                )
                modelsReady = true
            } catch (e: Exception) {
                modelError = e.message ?: e.javaClass.simpleName
            }
            runOnUiThread { refreshReadyState() }
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
        startButton.isEnabled = modelsReady && permission && !recording.get()
        status.text = when {
            modelError != null -> "FAIL préparation modèles : $modelError"
            !permission -> "Permission micro requise."
            !modelsReady -> "Préparation locale Vosk + Whisper…"
            else -> "Prêt — Vosk + Whisper tiny multilingue, entièrement offline."
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO_PERMISSION) refreshReadyState()
    }

    private fun startSession() {
        if (!modelsReady || !recording.compareAndSet(false, true)) return
        runtimeSessionId = UUID.randomUUID().toString()
        sessionStartMs = SystemClock.elapsedRealtime()
        sessionStartedAt = Instant.now().toString()
        sessionCompletedAt = null
        currentTurn = 0
        bytesWritten = 0L
        boundaries.clear(); boundaries += Boundary(0, 0L)
        providerMetrics.clear()
        turnPcmChunks = MutableList(questions.size) { mutableListOf() }
        lastExportJson = null

        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, SAMPLE_RATE)
        )
        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            recording.set(false)
            status.text = "FAIL : AudioRecord non initialisé."
            return
        }
        val dir = getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: filesDir
        wavFile = File(dir, "offline-interview-asr-benchmark-${System.currentTimeMillis()}.wav")
        wavRaf = RandomAccessFile(wavFile, "rw").apply { write(ByteArray(44)) }
        try {
            audioRecord?.startRecording()
            captureThread = Thread({ captureLoop() }, "offline-interview-benchmark-capture").also { it.start() }
        } catch (e: Exception) {
            recording.set(false)
            status.text = "FAIL démarrage capture : ${e.message}"
            return
        }
        renderQuestion()
        startButton.isEnabled = false
        nextButton.isEnabled = questions.size > 1
        stopButton.isEnabled = true
        saveJsonButton.isEnabled = false
        saveBundleButton.isEnabled = false
        status.text = "RUNNING — WAV maître continu; ASR uniquement après frontière de question."
    }

    private fun captureLoop() {
        val buffer = ByteArray(3200)
        while (recording.get()) {
            val n = try { audioRecord?.read(buffer, 0, buffer.size) ?: -1 } catch (_: Exception) { -1 }
            if (n <= 0) continue
            try {
                wavRaf?.write(buffer, 0, n)
                bytesWritten += n
            } catch (_: Exception) {
                recording.set(false)
                runOnUiThread { status.text = "FAIL_MASTER : écriture WAV interrompue." }
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
        val chunks: List<ByteArray>
        synchronized(turnPcmLock) {
            oldTurn = currentTurn
            newTurn = oldTurn + 1
            val boundaryAt = elapsedMs()
            chunks = turnPcmChunks[oldTurn].toList()
            turnPcmChunks[oldTurn].clear()
            currentTurn = newTurn
            boundaries += Boundary(newTurn, boundaryAt)
        }
        submitBenchmark(oldTurn, chunks)
        renderQuestion()
        if (newTurn == questions.lastIndex) nextButton.isEnabled = false
        status.text = "${questions[newTurn].id} — capture continue; benchmark ${questions[oldTurn].id} en arrière-plan."
    }

    private fun submitBenchmark(turn: Int, chunks: List<ByteArray>) {
        benchmarkExecutor.execute { benchmarkTurn(turn, chunks) }
    }

    private fun benchmarkTurn(turn: Int, chunks: List<ByteArray>) {
        val vosk = transcribeVosk(turn, chunks)
        val whisper = transcribeWhisper(turn, chunks)
        synchronized(providerMetrics) {
            providerMetrics.getOrPut(turn) { mutableMapOf() }[PROVIDER_VOSK] = vosk
            providerMetrics.getOrPut(turn) { mutableMapOf() }[PROVIDER_WHISPER] = whisper
        }
        runOnUiThread {
            val q = questions[turn].id
            status.text = "Benchmark $q : Vosk ${vosk.decodeWallMs} ms · Whisper ${whisper.decodeWallMs} ms."
            benchmarkView.text = "Dernier résultat $q\nVosk: ${vosk.text}\n\nWhisper: ${whisper.text}"
        }
    }

    private fun transcribeVosk(turn: Int, chunks: List<ByteArray>): ProviderMetric {
        val inputBytes = chunks.sumOf { it.size.toLong() }
        val inputAudioMs = inputBytes * 1000L / (SAMPLE_RATE * 2L)
        val start = SystemClock.elapsedRealtime()
        var text = ""
        var source = "vosk_empty"
        var error: String? = null
        try {
            val model = voskModel ?: error("vosk_model_not_ready")
            val pieces = mutableListOf<String>()
            var latestPartial = ""
            Recognizer(model, SAMPLE_RATE.toFloat()).use { recognizer ->
                for (chunk in chunks) {
                    if (recognizer.acceptWaveForm(chunk, chunk.size)) {
                        parseVoskText(recognizer.result).takeIf { it.isNotBlank() }?.let(pieces::add)
                    } else {
                        latestPartial = parseVoskPartial(recognizer.partialResult).ifBlank { latestPartial }
                    }
                }
                parseVoskText(recognizer.finalResult).takeIf { it.isNotBlank() }?.let(pieces::add)
            }
            val durable = pieces.joinToString(" ").replace(Regex("\\s+"), " ").trim()
            text = durable.ifBlank { latestPartial.trim() }
            source = if (durable.isNotBlank()) "embedded_vosk_final" else if (text.isNotBlank()) "embedded_vosk_partial_fallback" else "embedded_vosk_empty"
        } catch (e: Exception) {
            error = e.message ?: e.javaClass.simpleName
        }
        return ProviderMetric(turn, PROVIDER_VOSK, VOSK_MODEL_ID, inputBytes, inputAudioMs,
            SystemClock.elapsedRealtime() - start, text, source, error)
    }

    private fun transcribeWhisper(turn: Int, chunks: List<ByteArray>): ProviderMetric {
        val inputBytes = chunks.sumOf { it.size.toLong() }
        val inputAudioMs = inputBytes * 1000L / (SAMPLE_RATE * 2L)
        val start = SystemClock.elapsedRealtime()
        var text = ""
        var error: String? = null
        try {
            val recognizer = whisperRecognizer ?: error("whisper_model_not_ready")
            val pcm = mergeChunks(chunks)
            val samples = FloatArray(pcm.size / 2)
            var p = 0
            for (i in samples.indices) {
                val lo = pcm[p++].toInt() and 0xff
                val hi = pcm[p++].toInt()
                samples[i] = (((hi shl 8) or lo).toShort().toInt()) / 32768.0f
            }
            val stream = recognizer.createStream()
            try {
                stream.acceptWaveform(samples, SAMPLE_RATE)
                recognizer.decode(stream)
                text = recognizer.getResult(stream).text.trim()
            } finally {
                stream.release()
            }
        } catch (e: Exception) {
            error = e.message ?: e.javaClass.simpleName
        }
        return ProviderMetric(turn, PROVIDER_WHISPER, WHISPER_MODEL_ID, inputBytes, inputAudioMs,
            SystemClock.elapsedRealtime() - start, text, if (text.isNotBlank()) "embedded_whisper_final" else "embedded_whisper_empty", error)
    }

    private fun mergeChunks(chunks: List<ByteArray>): ByteArray {
        val total = chunks.sumOf { it.size }
        val out = ByteArray(total)
        var offset = 0
        for (chunk in chunks) {
            chunk.copyInto(out, offset)
            offset += chunk.size
        }
        return out
    }

    private fun parseVoskText(json: String): String = try { JSONObject(json).optString("text").trim() } catch (_: Exception) { "" }
    private fun parseVoskPartial(json: String): String = try { JSONObject(json).optString("partial").trim() } catch (_: Exception) { "" }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        nextButton.isEnabled = false
        stopButton.isEnabled = false
        status.text = "Finalisation WAV + benchmark des deux moteurs…"
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
            submitBenchmark(lastTurn, chunks)
            val barrier = benchmarkExecutor.submit { }
            var benchmarkTimedOut = false
            try { barrier.get(BENCHMARK_WAIT_SECONDS, TimeUnit.SECONDS) } catch (_: Exception) { benchmarkTimedOut = true }
            finalizeWav()
            sessionCompletedAt = Instant.now().toString()
            val payload = buildProductResult(benchmarkTimedOut).toString(2)
            lastExportJson = payload
            runOnUiThread {
                val complete = questions.indices.count { providerMetrics[it]?.values?.count { m -> m.text.isNotBlank() } == 2 }
                benchmarkView.text = "Résultat prêt : $complete/${questions.size} questions avec les deux moteurs.\nLe ZIP de qualification contient le WAV maître pour rejouer d'autres providers sans nouvel enregistrement."
                startButton.isEnabled = modelsReady
                saveJsonButton.isEnabled = true
                saveBundleButton.isEnabled = true
                status.text = if (benchmarkTimedOut) "HOLD — benchmark timeout partiel; WAV sauvegardé." else "STOPPED — Vosk + Whisper benchmark terminé."
            }
        }
    }

    private fun buildProductResult(benchmarkTimedOut: Boolean): JSONObject {
        val durationMs = bytesWritten * 1000L / (SAMPLE_RATE * 2L)
        val interviewee = interviewSpec.interviewee
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
                        val candidate = providerMetrics[flat]?.get(PROVIDER_VOSK)
                        val text = candidate?.text.orEmpty().trim()
                        if (text.isNotEmpty()) {
                            turns.put(JSONObject().apply {
                                put("id", "benchmark-$runtimeSessionId-$qId")
                                put("questionId", qId)
                                put("speakerId", interviewee.id)
                                put("speakerName", interviewee.name)
                                put("speakerRole", interviewee.role)
                                put("type", "answer")
                                put("source", "speech")
                                put("text", text)
                                put("rawTranscript", text)
                                put("transcriptionSource", "benchmark-unpromoted-vosk-display")
                                put("draftSource", candidate?.source ?: "benchmark_missing")
                                put("canonicalSource", "benchmark_unpromoted")
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
        val completeTurns = questions.indices.count { providerMetrics[it]?.values?.count { m -> m.text.isNotBlank() } == 2 }

        return JSONObject().apply {
            put("schema", InterviewContract.RESULT_SCHEMA)
            put("version", "1.0")
            put("exportedAt", Instant.now().toString())
            put("provenance", JSONObject().apply {
                put("appBuild", "android-native-${BuildConfig.VERSION_NAME}")
                put("inputSchema", InterviewContract.SPEC_SCHEMA)
                put("transcriptionDefault", "benchmark_unpromoted")
                put("providerCandidates", JSONArray().put(PROVIDER_VOSK).put(PROVIDER_WHISPER))
                put("privacy", "Audio and both ASR providers remain fully local at runtime. The WAV leaves the device only if the user explicitly exports the qualification ZIP.")
            })
            put("interview", JSONObject().apply {
                put("id", interviewSpec.id); put("version", interviewSpec.version); put("title", interviewSpec.title)
                put("estimatedDurationMinutes", interviewSpec.estimatedDurationMinutes ?: JSONObject.NULL)
                put("context", interviewSpec.context); put("objective", interviewSpec.objective); put("language", interviewSpec.language)
                put("tags", interviewSpec.raw.optJSONArray("tags") ?: JSONArray())
            })
            put("participants", JSONArray().apply {
                interviewSpec.participants.forEach { p -> put(JSONObject().apply {
                    put("id", p.id); put("name", p.name); put("role", p.role); put("active", true); put("removedAt", JSONObject.NULL)
                }) }
            })
            put("session", JSONObject().apply {
                put("id", runtimeSessionId); put("startedAt", sessionStartedAt ?: JSONObject.NULL); put("completedAt", sessionCompletedAt ?: JSONObject.NULL)
                put("completed", true); put("activeDurationSeconds", durationMs / 1000L)
                put("completion", JSONObject().apply {
                    put("answeredQuestions", completeTurns); put("totalQuestions", questions.size)
                    put("unansweredQuestions", questions.size - completeTurns); put("followUpsUsed", 0)
                })
            })
            put("sections", sectionsOut)
            put("nativeCapture", JSONObject().apply {
                put("schema", RUNTIME_SCHEMA)
                put("appVersion", BuildConfig.VERSION_NAME)
                put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
                put("routingAuthority", "turn_pcm_snapshot_at_ui_boundary")
                put("runtimeNetworkRequired", false)
                put("providerPromotion", "NONE_BENCHMARK_ONLY")
                put("wavPath", wavFile?.absolutePath ?: "")
                put("pcmBytes", bytesWritten); put("audioDurationMs", durationMs)
                put("benchmarkTimedOut", benchmarkTimedOut)
                put("turnBoundaries", JSONArray().apply {
                    boundaries.forEach { b -> put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs)) }
                })
                put("providerBenchmarks", JSONArray().apply {
                    questions.indices.forEach { turn ->
                        listOf(PROVIDER_VOSK, PROVIDER_WHISPER).forEach { provider ->
                            val m = providerMetrics[turn]?.get(provider)
                            put(JSONObject().apply {
                                put("questionId", questions[turn].id); put("provider", provider); put("model", m?.model ?: JSONObject.NULL)
                                put("inputBytes", m?.inputBytes ?: 0); put("inputAudioMs", m?.inputAudioMs ?: 0)
                                put("decodeWallMs", m?.decodeWallMs ?: JSONObject.NULL)
                                put("realTimeFactor", if (m != null && m.inputAudioMs > 0) m.decodeWallMs.toDouble() / m.inputAudioMs else JSONObject.NULL)
                                put("text", m?.text ?: ""); put("textLength", m?.text?.length ?: 0)
                                put("source", m?.source ?: JSONObject.NULL); put("error", m?.error ?: JSONObject.NULL)
                            })
                        }
                    }
                })
            })
        }
    }

    private fun requestSaveJson() {
        if (lastExportJson == null) return
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "offline-interview-asr-benchmark-$runtimeSessionId.json")
        }, REQ_SAVE_JSON)
    }

    private fun requestSaveBundle() {
        if (lastExportJson == null || wavFile?.isFile != true) return
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/zip"
            putExtra(Intent.EXTRA_TITLE, "offline-interview-asr-benchmark-$runtimeSessionId.zip")
        }, REQ_SAVE_BUNDLE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQ_SAVE_JSON -> {
                val payload = lastExportJson ?: return
                backgroundExecutor.execute {
                    try {
                        contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                        runOnUiThread { status.text = "Résultat JSON enregistré." }
                    } catch (e: Exception) { runOnUiThread { status.text = "Échec JSON : ${e.message}" } }
                }
            }
            REQ_SAVE_BUNDLE -> backgroundExecutor.execute { writeQualificationBundle(uri) }
        }
    }

    private fun writeQualificationBundle(uri: android.net.Uri) {
        val payload = lastExportJson ?: return
        val wav = wavFile ?: return
        try {
            val wavSha = sha256File(wav)
            val jsonSha = sha256Bytes(payload.toByteArray(Charsets.UTF_8))
            val manifest = JSONObject().apply {
                put("schema", BUNDLE_SCHEMA); put("appBuild", BuildConfig.VERSION_NAME); put("runtimeSessionId", runtimeSessionId)
                put("runtimeNetworkRequired", false); put("providerPromotion", "NONE_BENCHMARK_ONLY")
                put("providers", JSONArray().put(JSONObject().put("id", PROVIDER_VOSK).put("model", VOSK_MODEL_ID))
                    .put(JSONObject().put("id", PROVIDER_WHISPER).put("model", WHISPER_MODEL_ID)))
                put("resultJson", JSONObject().put("path", "result.json").put("sha256", jsonSha))
                put("masterWav", JSONObject().put("path", "audio/master.wav").put("bytes", wav.length()).put("sha256", wavSha)
                    .put("sampleRate", SAMPLE_RATE).put("channels", 1).put("bitsPerSample", 16))
                put("turnBoundaries", JSONArray().apply {
                    boundaries.forEach { b -> put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs)) }
                })
                put("replaySemantics", "Use master WAV + turnBoundaries to decode the exact same human recording with future ASR providers; no new recording is required.")
            }.toString(2)
            contentResolver.openOutputStream(uri, "w")?.use { raw ->
                ZipOutputStream(raw.buffered()).use { zip ->
                    zip.putNextEntry(ZipEntry("manifest.json")); zip.write(manifest.toByteArray()); zip.closeEntry()
                    zip.putNextEntry(ZipEntry("result.json")); zip.write(payload.toByteArray()); zip.closeEntry()
                    zip.putNextEntry(ZipEntry("audio/master.wav")); wav.inputStream().use { it.copyTo(zip) }; zip.closeEntry()
                }
            } ?: error("Impossible d'ouvrir la destination ZIP")
            runOnUiThread { status.text = "Bundle qualification ZIP enregistré — WAV rejouable inclus." }
        } catch (e: Exception) {
            runOnUiThread { status.text = "Échec bundle ZIP : ${e.message}" }
        }
    }

    private fun sha256File(file: File): String = file.inputStream().use { input ->
        val md = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536)
        while (true) { val n = input.read(buffer); if (n <= 0) break; md.update(buffer, 0, n) }
        md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256Bytes(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun finalizeWav() {
        try {
            wavRaf?.let { raf -> raf.seek(0); raf.write(wavHeader(bytesWritten, SAMPLE_RATE, 1, 16)); raf.close() }
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
        try { voskModel?.close() } catch (_: Exception) {}
        try { whisperRecognizer?.release() } catch (_: Exception) {}
        benchmarkExecutor.shutdownNow(); backgroundExecutor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val VOSK_ASSET_DIR = "vosk-model-small-fr-0.22"
        private const val VOSK_MODEL_ID = "vosk-model-small-fr-0.22"
        private const val VOSK_ZIP_SHA256 = "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"
        private const val WHISPER_ASSET_DIR = "sherpa-onnx-whisper-tiny-int8"
        private const val WHISPER_MODEL_ID = "sherpa-onnx-whisper-tiny-int8-multilingual"
        private const val PROVIDER_VOSK = "vosk-android-0.3.75"
        private const val PROVIDER_WHISPER = "sherpa-onnx-1.13.8-whisper"
        private const val RUNTIME_SCHEMA = "offline-interview.android-embedded-asr-benchmark.v1"
        private const val BUNDLE_SCHEMA = "offline-interview.asr-benchmark-bundle.v1"
        private const val BENCHMARK_WAIT_SECONDS = 180L
        private const val REQ_AUDIO_PERMISSION = 71
        private const val REQ_SAVE_JSON = 72
        private const val REQ_SAVE_BUNDLE = 73

        private fun wavHeader(dataBytes: Long, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
            val byteRate = sampleRate * channels * bitsPerSample / 8
            val blockAlign = channels * bitsPerSample / 8
            val totalDataLen = dataBytes + 36
            return ByteArray(44).also { h ->
                fun ascii(offset: Int, s: String) = s.toByteArray(Charsets.US_ASCII).copyInto(h, offset)
                fun le16(offset: Int, v: Int) { h[offset] = (v and 0xff).toByte(); h[offset + 1] = ((v ushr 8) and 0xff).toByte() }
                fun le32(offset: Int, v: Long) {
                    h[offset] = (v and 0xff).toByte(); h[offset + 1] = ((v ushr 8) and 0xff).toByte()
                    h[offset + 2] = ((v ushr 16) and 0xff).toByte(); h[offset + 3] = ((v ushr 24) and 0xff).toByte()
                }
                ascii(0, "RIFF"); le32(4, totalDataLen); ascii(8, "WAVE"); ascii(12, "fmt ")
                le32(16, 16); le16(20, 1); le16(22, channels); le32(24, sampleRate.toLong())
                le32(28, byteRate.toLong()); le16(32, blockAlign); le16(34, bitsPerSample)
                ascii(36, "data"); le32(40, dataBytes)
            }
        }
    }
}
