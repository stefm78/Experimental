package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognitionPart
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * H6 = physically-qualified H4 nonblocking audio stability + H5 bounded finalization shape,
 * corrected so end-of-audio is signalled by EOF on EXTRA_AUDIO_SOURCE rather than stopListening().
 * A short provider cooldown is enforced before the next recognizer is created.
 */
class H5MainActivity : Activity() {
    private lateinit var interviewSpec: NativeInterviewSpec
    private lateinit var status: TextView
    private lateinit var interviewTitle: TextView
    private lateinit var questionMeta: TextView
    private lateinit var question: TextView
    private lateinit var liveTranscript: TextView
    private lateinit var loadButton: Button
    private lateinit var startButton: Button
    private lateinit var nextButton: Button
    private lateinit var lockButton: Button
    private lateinit var stopButton: Button
    private lateinit var saveButton: Button
    private lateinit var exportView: TextView

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val recording = AtomicBoolean(false)
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var wavFile: File? = null
    private var wavRaf: RandomAccessFile? = null
    private var bytesWritten = 0L
    private var sessionStartMs = 0L
    private var sessionStartedAt: String? = null
    private var sessionCompletedAt: String? = null
    private var runtimeSessionId = ""
    private var currentTurn = 0
    private var sttDegraded = false
    private var lastExportJson: String? = null
    private var droppedTranscriptEventCount = 0
    private var droppedSttPcmChunks = 0
    private var finalizationFallbackCount = 0

    private data class Boundary(val turn: Int, val atMs: Long)
    private data class TranscriptEvent(
        val callbackAtMs: Long,
        val audioAtMs: Long?,
        val turn: Int,
        val kind: String,
        val routing: String,
        val text: String
    )
    private data class TurnSttSession(
        val turn: Int,
        val attempt: Int,
        val sessionId: String,
        val startAtMs: Long,
        val recognizer: SpeechRecognizer,
        val readFd: ParcelFileDescriptor,
        val sink: FileOutputStream,
        val pcmQueue: ArrayBlockingQueue<ByteArray> = ArrayBlockingQueue(STT_QUEUE_CHUNKS),
        val feederRunning: AtomicBoolean = AtomicBoolean(true),
        var feederThread: Thread? = null,
        var endAtMs: Long? = null,
        var closeReason: String? = null,
        var partialCount: Int = 0,
        var finalCount: Int = 0,
        var segmentCount: Int = 0,
        var timedPartCount: Int = 0,
        var providerError: Int? = null,
        var providerErrorClass: String? = null,
        var droppedPcmChunks: Int = 0,
        var closed: Boolean = false,
        var finalizing: Boolean = false,
        var finalizationRequestedAtMs: Long? = null,
        var finalizationCompletedAtMs: Long? = null,
        var finalizationOutcome: String? = null,
        var continuation: (() -> Unit)? = null
    )

    @Volatile private var activeSttSession: TurnSttSession? = null
    private val pendingLock = Any()
    private var pendingTurn: Int? = null
    private val pendingPcm = ArrayDeque<ByteArray>()
    private val boundaries = mutableListOf<Boundary>()
    private val transcriptEvents = mutableListOf<TranscriptEvent>()
    private val canonicalText = mutableMapOf<Int, String>()
    private val latestPartialByTurn = mutableMapOf<Int, String>()
    private val durableDraftByTurn = mutableMapOf<Int, String>()
    private val draftSourceByTurn = mutableMapOf<Int, String>()
    private val sttSessions = mutableMapOf<Int, TurnSttSession>()
    private val sttSessionHistory = mutableListOf<TurnSttSession>()
    private val lastTelemetryPartialText = mutableMapOf<Int, String>()
    private val lastTelemetryPartialAt = mutableMapOf<Int, Long>()
    private val questions get() = interviewSpec.questions

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        interviewSpec = loadBundledSpec()
        handleIncomingSpec(intent, true)
        buildUi()
        renderInterviewHeader()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
        } else {
            status.text = if (SpeechRecognizer.isOnDeviceRecognitionAvailable(this))
                "Prêt H6 — STT on-device disponible."
            else "HOLD: reconnaissance on-device indisponible."
        }
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
        status = TextView(this).apply { text = "Initialisation H6…" }
        interviewTitle = TextView(this).apply { textSize = 22f }
        questionMeta = TextView(this).apply { textSize = 14f; setPadding(0, 16, 0, 4) }
        question = TextView(this).apply { textSize = 20f }
        liveTranscript = TextView(this).apply {
            text = "La transcription apparaîtra ici."
            setPadding(0, 24, 0, 24)
            setTextIsSelectable(true)
        }
        loadButton = Button(this).apply { text = "Charger un questionnaire JSON" }
        startButton = Button(this).apply { text = "Démarrer l'entretien" }
        nextButton = Button(this).apply { text = "Question suivante"; isEnabled = false }
        lockButton = Button(this).apply { text = "Valider le texte humain"; isEnabled = false }
        stopButton = Button(this).apply { text = "Terminer"; isEnabled = false }
        saveButton = Button(this).apply { text = "Enregistrer le résultat JSON"; isEnabled = false }
        exportView = TextView(this).apply { setTextIsSelectable(true); setPadding(0, 24, 0, 0) }
        loadButton.setOnClickListener { chooseInterviewSpec() }
        startButton.setOnClickListener { startSession() }
        nextButton.setOnClickListener { nextTurn() }
        lockButton.setOnClickListener { lockCurrentDraft() }
        stopButton.setOnClickListener { stopSession() }
        saveButton.setOnClickListener { saveResultJson() }
        listOf(
            status, interviewTitle, questionMeta, question, liveTranscript, loadButton,
            startButton, nextButton, lockButton, stopButton, saveButton, exportView
        ).forEach(root::addView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun renderInterviewHeader() {
        if (!::interviewTitle.isInitialized) return
        currentTurn = currentTurn.coerceIn(0, questions.lastIndex)
        val q = questions[currentTurn]
        interviewTitle.text = interviewSpec.title
        questionMeta.text = "${q.sectionTitle} · ${q.id} · ${currentTurn + 1}/${questions.size}${if (q.label.isNotBlank()) " · ${q.label}" else ""}"
        question.text = q.text
    }

    private fun loadBundledSpec() =
        InterviewContract.parse(assets.open("interview.json").bufferedReader().use { it.readText() })

    private fun chooseInterviewSpec() {
        if (recording.get()) {
            status.text = "Termine l'entretien avant de changer de questionnaire."
            return
        }
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
            if (!silent && ::status.isInitialized) status.text = "Questionnaire chargé depuis le lien/fichier externe."
        } catch (e: Exception) {
            if (!silent && ::status.isInitialized) status.text = "Questionnaire refusé: ${e.message}"
        }
    }

    private fun loadSpecFromUri(uri: Uri) {
        val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            ?: throw IllegalArgumentException("Impossible de lire le JSON.")
        interviewSpec = InterviewContract.parse(text)
        currentTurn = 0
        lastExportJson = null
        if (::saveButton.isInitialized) saveButton.isEnabled = false
        if (::exportView.isInitialized) exportView.text = ""
        renderInterviewHeader()
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
                lastExportJson?.let { payload ->
                    executor.execute {
                        val msg = try {
                            contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                            "Résultat JSON enregistré."
                        } catch (e: Exception) {
                            "Échec export JSON: ${e.message}"
                        }
                        runOnUiThread { status.text = msg }
                    }
                }
            }
        }
    }

    private fun baseRecognizerIntent(audioSource: ParcelFileDescriptor?): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, interviewSpec.language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            if (Build.VERSION.SDK_INT >= 34) {
                putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_TIMING, true)
                putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_CONFIDENCE, true)
            }
            if (audioSource != null) {
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audioSource)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, SAMPLE_RATE)
            }
        }

    private fun startSession() {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            status.text = "Recognizer on-device non prêt."
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
        transcriptEvents.clear()
        canonicalText.clear()
        latestPartialByTurn.clear()
        durableDraftByTurn.clear()
        draftSourceByTurn.clear()
        sttSessions.clear()
        sttSessionHistory.clear()
        lastTelemetryPartialText.clear()
        lastTelemetryPartialAt.clear()
        synchronized(pendingLock) {
            pendingPcm.clear()
            pendingTurn = null
        }
        activeSttSession = null
        droppedTranscriptEventCount = 0
        droppedSttPcmChunks = 0
        finalizationFallbackCount = 0
        sttDegraded = false
        bytesWritten = 0L
        lastExportJson = null

        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, SAMPLE_RATE)
        )
        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            status.text = "FAIL: AudioRecord non initialisé."
            recording.set(false)
            return
        }
        val dir = getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: filesDir
        wavFile = File(dir, "offline-interview-native-${System.currentTimeMillis()}.wav")
        wavRaf = RandomAccessFile(wavFile, "rw").apply { write(ByteArray(44)) }
        try {
            audioRecord?.startRecording()
            captureThread = Thread({ captureLoop() }, "offline-interview-master-capture").also { it.start() }
        } catch (e: Exception) {
            status.text = "FAIL capture: ${e.message}"
            recording.set(false)
            return
        }
        createAndActivateSession(0, 0L, 0)
        renderInterviewHeader()
        liveTranscript.text = "Écoute…"
        loadButton.isEnabled = false
        startButton.isEnabled = false
        nextButton.isEnabled = questions.size > 1
        lockButton.isEnabled = true
        stopButton.isEnabled = true
        saveButton.isEnabled = false
        status.text = "RUNNING H6 — WAV maître continu; finalisation STT par EOF."
    }

    private fun createAndActivateSession(turn: Int, startAtMs: Long, attempt: Int): TurnSttSession? {
        if (!recording.get() || turn != currentTurn) return null
        return try {
            val pipe = ParcelFileDescriptor.createPipe()
            val readFd = pipe[0]
            val sink = FileOutputStream(pipe[1].fileDescriptor)
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            val s = TurnSttSession(
                turn,
                attempt,
                "${questions[turn].id}-a$attempt-${SystemClock.elapsedRealtimeNanos()}",
                startAtMs,
                recognizer,
                readFd,
                sink
            )
            s.feederThread = Thread({ sttFeederLoop(s) }, "offline-interview-stt-${questions[turn].id}-a$attempt").also { it.start() }
            recognizer.setRecognitionListener(TurnRecognitionListener(s))
            recognizer.startListening(baseRecognizerIntent(readFd))
            sttSessions[turn] = s
            sttSessionHistory += s
            activeSttSession = s
            flushPendingPcm(s)
            s
        } catch (e: Exception) {
            sttDegraded = true
            status.text = "STT_DEGRADED ${questions[turn].id}: ${e.message} — WAV continue."
            null
        }
    }

    private fun sttFeederLoop(s: TurnSttSession) {
        try {
            while (true) {
                val chunk = s.pcmQueue.take()
                if (chunk.isEmpty()) break
                s.sink.write(chunk)
            }
        } catch (_: InterruptedException) {
        } catch (_: IOException) {
            if (!s.closed && !s.finalizing) {
                runOnUiThread { status.text = "STT pipe ${questions[s.turn].id} fermé — WAV continue." }
            }
        } finally {
            // Closing the write side is the H6 end-of-audio signal for EXTRA_AUDIO_SOURCE.
            // Do not call recognizer.stopListening(): physical H5 evidence mapped that path to ERROR_CLIENT(5).
            try { s.sink.flush() } catch (_: Exception) {}
            try { s.sink.close() } catch (_: Exception) {}
            s.feederRunning.set(false)
        }
    }

    private fun captureLoop() {
        val buffer = ByteArray(3200)
        while (recording.get()) {
            val n = try { audioRecord?.read(buffer, 0, buffer.size) ?: -1 } catch (_: Exception) { -1 }
            if (n <= 0) continue
            try {
                wavRaf?.write(buffer, 0, n)
                bytesWritten += n
            } catch (_: IOException) {
                runOnUiThread { status.text = "FAIL_MASTER: WAV interrompu." }
                recording.set(false)
                break
            }
            val copy = buffer.copyOf(n)
            val s = activeSttSession
            if (s != null && !s.closed && !s.finalizing && s.turn == currentTurn) {
                if (!s.pcmQueue.offer(copy)) {
                    s.droppedPcmChunks++
                    droppedSttPcmChunks++
                }
            } else synchronized(pendingLock) {
                if (pendingTurn == currentTurn) {
                    if (pendingPcm.size >= PENDING_PCM_CHUNKS) pendingPcm.removeFirst()
                    pendingPcm.addLast(copy)
                }
            }
        }
    }

    private fun beginPendingWindow(turn: Int) {
        activeSttSession = null
        synchronized(pendingLock) {
            pendingPcm.clear()
            pendingTurn = turn
        }
    }

    private fun flushPendingPcm(s: TurnSttSession) {
        val chunks = mutableListOf<ByteArray>()
        synchronized(pendingLock) {
            if (pendingTurn == s.turn) {
                while (pendingPcm.isNotEmpty()) chunks += pendingPcm.removeFirst()
                pendingTurn = null
            }
        }
        chunks.forEach {
            if (!s.pcmQueue.offer(it)) {
                s.droppedPcmChunks++
                droppedSttPcmChunks++
            }
        }
    }

    private fun nextTurn() {
        if (!recording.get() || currentTurn >= questions.lastIndex) return
        val old = activeSttSession ?: return
        val oldTurn = currentTurn
        val newTurn = currentTurn + 1
        val boundaryAt = elapsedMs()

        currentTurn = newTurn
        boundaries += Boundary(newTurn, boundaryAt)
        beginPendingWindow(newTurn)
        renderInterviewHeader()
        renderCurrentTurn()
        if (newTurn == questions.lastIndex) nextButton.isEnabled = false
        status.text = "H6 ${questions[newTurn].id} affichée — EOF ${questions[oldTurn].id} en arrière-plan."

        requestFinalization(old, boundaryAt, "turn_boundary") {
            if (recording.get() && currentTurn == newTurn && activeSttSession == null) {
                createAndActivateSession(newTurn, boundaryAt, 0)
            }
        }
    }

    private fun requestFinalization(
        s: TurnSttSession,
        boundaryAt: Long,
        reason: String,
        after: () -> Unit
    ) {
        if (s.closed || s.finalizing) {
            after()
            return
        }
        if (activeSttSession === s) activeSttSession = null
        s.finalizing = true
        s.endAtMs = boundaryAt
        s.closeReason = reason
        s.finalizationRequestedAtMs = elapsedMs()
        s.continuation = after

        // H6: let the feeder drain queued PCM, then close the write end of EXTRA_AUDIO_SOURCE.
        // The provider sees EOF naturally. No stopListening() call is made.
        if (!s.pcmQueue.offer(POISON)) {
            s.pcmQueue.poll()
            if (!s.pcmQueue.offer(POISON)) s.feederThread?.interrupt()
        }
        mainHandler.postDelayed({
            if (s.finalizing) completeFinalization(s, "eof_timeout_partial_fallback")
        }, FINALIZATION_GRACE_MS)
    }

    private fun completeFinalization(s: TurnSttSession, outcome: String) {
        if (!s.finalizing) return
        s.finalizing = false
        s.closed = true
        s.finalizationOutcome = outcome
        s.finalizationCompletedAtMs = elapsedMs()
        if (outcome.contains("fallback")) {
            finalizationFallbackCount++
            snapshotPartialAtClose(s.turn)
        }
        s.feederRunning.set(false)
        s.feederThread?.interrupt()
        try { s.recognizer.cancel() } catch (_: Exception) {}
        try { s.readFd.close() } catch (_: Exception) {}
        try { s.recognizer.destroy() } catch (_: Exception) {}
        val continuation = s.continuation
        s.continuation = null

        // Physical H5 showed that creating the next recognizer immediately after teardown
        // can produce ERROR_SERVER_DISCONNECTED(11). Reuse the H4 principle: bounded provider cooldown.
        if (continuation != null) {
            mainHandler.postDelayed({ continuation.invoke() }, PROVIDER_COOLDOWN_MS)
        }
    }

    private fun snapshotPartialAtClose(turn: Int) {
        if (durableDraftByTurn[turn].isNullOrBlank()) {
            latestPartialByTurn[turn].orEmpty().trim().takeIf { it.isNotEmpty() }?.let {
                durableDraftByTurn[turn] = it
                draftSourceByTurn[turn] = "partial_snapshot_at_eof_timeout"
            }
        }
    }

    private fun scheduleTransientRearm(s: TurnSttSession, error: Int): Boolean {
        if (!recording.get() || s.turn != currentTurn || s.attempt >= MAX_TRANSIENT_REARMS || s.closed || s.finalizing) return false
        if (latestPartialByTurn[s.turn].orEmpty().isNotBlank() || durableDraftByTurn[s.turn].orEmpty().isNotBlank()) return false
        val reason = when (error) {
            SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "server_disconnected"
            else -> return false
        }
        val now = elapsedMs()
        s.providerError = error
        s.providerErrorClass = "recoverable_$reason"
        activeSttSession = null
        s.closed = true
        s.feederThread?.interrupt()
        try { s.sink.close() } catch (_: Exception) {}
        try { s.recognizer.cancel() } catch (_: Exception) {}
        try { s.readFd.close() } catch (_: Exception) {}
        try { s.recognizer.destroy() } catch (_: Exception) {}
        beginPendingWindow(s.turn)
        status.text = "STT ${questions[s.turn].id}: reconnexion après $reason — WAV continue."
        mainHandler.postDelayed({
            if (recording.get() && currentTurn == s.turn && activeSttSession == null) {
                createAndActivateSession(s.turn, now, s.attempt + 1)
            }
        }, TRANSIENT_REARM_DELAY_MS)
        return true
    }

    private fun lockCurrentDraft() {
        val draft = assembledDraft(currentTurn).trim()
        if (draft.isEmpty()) {
            status.text = "Aucun brouillon STT à valider."
            return
        }
        canonicalText[currentTurn] = draft
        status.text = "Texte humain validé pour ${questions[currentTurn].id}."
        renderCurrentTurn()
    }

    private fun stopSession() {
        if (!recording.get()) return
        nextButton.isEnabled = false
        lockButton.isEnabled = false
        stopButton.isEnabled = false
        val s = activeSttSession
        val stopAt = elapsedMs()
        recording.set(false)
        activeSttSession = null
        try { audioRecord?.stop() } catch (_: Exception) {}
        if (s != null) {
            requestFinalization(s, stopAt, "interview_stop") { finalizeInterviewAsync() }
        } else {
            finalizeInterviewAsync()
        }
    }

    private fun finalizeInterviewAsync() {
        executor.execute {
            try { captureThread?.join(1500) } catch (_: Exception) {}
            finalizeWav()
            sessionCompletedAt = Instant.now().toString()
            val payload = buildProductResult().toString(2)
            lastExportJson = payload
            val answered = questions.indices.count { finalText(it).isNotBlank() }
            runOnUiThread {
                exportView.text = "Résultat prêt — $answered/${questions.size} réponses · finalisations fallback=$finalizationFallbackCount."
                loadButton.isEnabled = true
                startButton.isEnabled = true
                saveButton.isEnabled = true
                status.text = if (sttDegraded) "STOPPED — dégradation STT observée." else "STOPPED H6 — WAV finalisé."
            }
        }
    }

    private fun assembledDraft(turn: Int) =
        durableDraftByTurn[turn]?.takeIf { it.isNotBlank() } ?: latestPartialByTurn[turn].orEmpty()

    private fun finalText(turn: Int) = canonicalText[turn] ?: assembledDraft(turn)

    private fun renderCurrentTurn() {
        liveTranscript.text = canonicalText[currentTurn] ?: assembledDraft(currentTurn).ifEmpty { "Écoute…" }
    }

    private fun appendEvent(e: TranscriptEvent, partial: Boolean = false) {
        if (transcriptEvents.size >= MAX_TRANSCRIPT_EVENTS) {
            droppedTranscriptEventCount++
            return
        }
        if (partial) {
            val pt = lastTelemetryPartialText[e.turn]
            val pa = lastTelemetryPartialAt[e.turn] ?: Long.MIN_VALUE
            if (pt == e.text || e.callbackAtMs - pa < PARTIAL_TELEMETRY_MIN_INTERVAL_MS) {
                droppedTranscriptEventCount++
                return
            }
            lastTelemetryPartialText[e.turn] = e.text
            lastTelemetryPartialAt[e.turn] = e.callbackAtMs
        }
        transcriptEvents += e
    }

    private fun recordPartial(s: TurnSttSession, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        s.partialCount++
        latestPartialByTurn[s.turn] = clean
        appendEvent(
            TranscriptEvent(elapsedMs(), null, s.turn, "partial", "stt_session_identity", clean),
            true
        )
        if (s.turn == currentTurn && !canonicalText.containsKey(s.turn)) renderCurrentTurn()
    }

    private fun recognitionParts(bundle: Bundle?): List<RecognitionPart> {
        if (Build.VERSION.SDK_INT < 34 || bundle == null) return emptyList()
        return try {
            bundle.getParcelableArrayList(
                SpeechRecognizer.RECOGNITION_PARTS,
                RecognitionPart::class.java
            ).orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun recordDurable(s: TurnSttSession, bundle: Bundle?, text: String, kind: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        val parts = recognitionParts(bundle)
        s.timedPartCount += parts.count { it.timestampMillis > 0L }
        if (kind == "final") {
            s.finalCount++
            durableDraftByTurn[s.turn] = clean
            draftSourceByTurn[s.turn] = "final"
        } else {
            s.segmentCount++
            val previous = durableDraftByTurn[s.turn].orEmpty().trim()
            durableDraftByTurn[s.turn] = if (previous.isEmpty() || previous == clean) clean else "$previous $clean"
            draftSourceByTurn[s.turn] = "segment"
        }
        appendEvent(
            TranscriptEvent(
                elapsedMs(),
                parts.firstOrNull { it.timestampMillis > 0L }?.timestampMillis,
                s.turn,
                kind,
                "stt_session_identity",
                clean
            )
        )
    }

    private inner class TurnRecognitionListener(private val s: TurnSttSession) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (s.turn == currentTurn && recording.get()) status.text = "STT ${questions[s.turn].id} prêt."
        }

        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            if (s.finalizing) {
                s.providerError = error
                s.providerErrorClass = "eof_finalization_provider_error"
                appendEvent(
                    TranscriptEvent(
                        elapsedMs(),
                        null,
                        s.turn,
                        "finalization_error",
                        "stt_session_identity",
                        "error=$error"
                    )
                )
                // ERROR_CLIENT(5) was the systematic H5 stopListening symptom. In H6 we do not
                // turn it into an immediate teardown race: retain the bounded grace window.
                if (error != SpeechRecognizer.ERROR_CLIENT) {
                    completeFinalization(s, "provider_error_${error}_partial_fallback")
                }
                return
            }
            if (scheduleTransientRearm(s, error)) return
            s.providerError = error
            s.providerErrorClass = "unexpected_provider_error"
            sttDegraded = true
            appendEvent(
                TranscriptEvent(elapsedMs(), null, s.turn, "error", "stt_session_identity", "error=$error")
            )
            if (activeSttSession === s) activeSttSession = null
        }

        override fun onResults(results: Bundle?) {
            recordDurable(
                s,
                results,
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty(),
                "final"
            )
            if (s.finalizing) completeFinalization(s, "provider_final")
        }

        override fun onPartialResults(partialResults: Bundle?) {
            recordPartial(
                s,
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            )
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onSegmentResults(segmentResults: Bundle) {
            recordDurable(
                s,
                segmentResults,
                segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty(),
                "segment"
            )
        }

        override fun onEndOfSegmentedSession() {
            if (s.finalizing) {
                completeFinalization(
                    s,
                    if (s.segmentCount > 0) "provider_segment" else "segmented_end_partial_fallback"
                )
            }
        }
    }

    private fun questionDurationSeconds(index: Int, totalDurationMs: Long): Long {
        val start = boundaries.firstOrNull { it.turn == index }?.atMs ?: 0L
        val end = boundaries.firstOrNull { it.turn == index + 1 }?.atMs ?: totalDurationMs
        return (end - start).coerceAtLeast(0L) / 1000L
    }

    private fun buildProductResult(): JSONObject {
        val durationMs = bytesWritten * 1000L / (SAMPLE_RATE * 2L)
        val interviewee = interviewSpec.interviewee
        val answered = questions.indices.count { finalText(it).isNotBlank() }
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
                        val text = finalText(flat).trim()
                        if (text.isNotEmpty()) {
                            turns.put(JSONObject().apply {
                                put("id", "native-$runtimeSessionId-$qId")
                                put("questionId", qId)
                                put("speakerId", interviewee.id)
                                put("speakerName", interviewee.name)
                                put("speakerRole", interviewee.role)
                                put("type", "answer")
                                put("source", "speech")
                                put("text", text)
                                put("rawTranscript", assembledDraft(flat))
                                put("transcriptionSource", "android-on-device-per-turn")
                                put("draftSource", draftSourceByTurn[flat] ?: "live_partial")
                                put("canonicalSource", if (canonicalText.containsKey(flat)) "human_lock" else "draft_stt")
                                put("audioStartMs", boundaries.firstOrNull { it.turn == flat }?.atMs ?: JSONObject.NULL)
                                put(
                                    "audioEndMs",
                                    sttSessionHistory.filter { it.turn == flat }
                                        .maxOfOrNull { it.endAtMs ?: durationMs } ?: JSONObject.NULL
                                )
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
                put("transcriptionDefault", "android-on-device-per-turn")
                put("transcriptionFallback", "partial_snapshot_after_bounded_eof_finalization")
                put("privacy", "Audio remains local in the app-specific Android files area and is never embedded in this JSON export.")
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
                interviewSpec.participants.forEach { p ->
                    put(JSONObject().apply {
                        put("id", p.id)
                        put("name", p.name)
                        put("role", p.role)
                        put("active", true)
                        put("removedAt", JSONObject.NULL)
                    })
                }
            })
            put("session", JSONObject().apply {
                put("id", runtimeSessionId)
                put("startedAt", sessionStartedAt ?: JSONObject.NULL)
                put("completedAt", sessionCompletedAt ?: JSONObject.NULL)
                put("completed", true)
                put("activeDurationSeconds", durationMs / 1000L)
                put("questionDurationSeconds", JSONObject().apply {
                    questions.forEachIndexed { i, q -> put(q.id, questionDurationSeconds(i, durationMs)) }
                })
                put("completion", JSONObject().apply {
                    put("answeredQuestions", answered)
                    put("totalQuestions", questions.size)
                    put("unansweredQuestions", questions.size - answered)
                    put("followUpsUsed", 0)
                })
            })
            put("sections", sectionsOut)
            put("nativeCapture", JSONObject().apply {
                put("schema", "offline-interview.android-native-runtime.v6.0")
                put("appVersion", BuildConfig.VERSION_NAME)
                put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
                put("sttProvider", "Android SpeechRecognizer on-device via H4 bounded nonblocking feeder + H6 EOF finalization")
                put("routingAuthority", "stt_session_identity")
                put("wavPath", wavFile?.absolutePath ?: "")
                put("pcmBytes", bytesWritten)
                put("audioDurationMs", durationMs)
                put("sttDegraded", sttDegraded)
                put("transientRearmMax", MAX_TRANSIENT_REARMS)
                put("finalizationMethod", "pipe_eof_no_stopListening")
                put("finalizationGraceMs", FINALIZATION_GRACE_MS)
                put("providerCooldownMs", PROVIDER_COOLDOWN_MS)
                put("finalizationFallbackCount", finalizationFallbackCount)
                put("droppedTranscriptEventCount", droppedTranscriptEventCount)
                put("droppedSttPcmChunks", droppedSttPcmChunks)
                put("turnBoundaries", JSONArray().apply {
                    boundaries.forEach { b ->
                        put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs))
                    }
                })
                put("sttSessions", JSONArray().apply {
                    sttSessionHistory.forEach { s ->
                        put(JSONObject().apply {
                            put("questionId", questions[s.turn].id)
                            put("attempt", s.attempt)
                            put("sessionId", s.sessionId)
                            put("startAtMs", s.startAtMs)
                            put("endAtMs", s.endAtMs ?: JSONObject.NULL)
                            put("closeReason", s.closeReason ?: JSONObject.NULL)
                            put("partialCount", s.partialCount)
                            put("finalCount", s.finalCount)
                            put("segmentCount", s.segmentCount)
                            put("timedPartCount", s.timedPartCount)
                            put("providerError", s.providerError ?: JSONObject.NULL)
                            put("providerErrorClass", s.providerErrorClass ?: JSONObject.NULL)
                            put("droppedPcmChunks", s.droppedPcmChunks)
                            put("finalizationRequestedAtMs", s.finalizationRequestedAtMs ?: JSONObject.NULL)
                            put("finalizationCompletedAtMs", s.finalizationCompletedAtMs ?: JSONObject.NULL)
                            put("finalizationOutcome", s.finalizationOutcome ?: JSONObject.NULL)
                        })
                    }
                })
                put("transcriptEvents", JSONArray().apply {
                    transcriptEvents.forEach { e ->
                        put(JSONObject().apply {
                            put("callbackAtMs", e.callbackAtMs)
                            put("audioAtMs", e.audioAtMs ?: JSONObject.NULL)
                            put("questionId", questions[e.turn].id)
                            put("kind", e.kind)
                            put("routing", e.routing)
                            put("text", e.text)
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
            putExtra(Intent.EXTRA_TITLE, "offline-interview-$safeId-$runtimeSessionId.json")
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
        mainHandler.removeCallbacksAndMessages(null)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { captureThread?.join(500) } catch (_: Exception) {}
        sttSessionHistory.forEach { s ->
            s.feederRunning.set(false)
            s.feederThread?.interrupt()
            try { s.sink.close() } catch (_: Exception) {}
            try { s.readFd.close() } catch (_: Exception) {}
            try { s.recognizer.destroy() } catch (_: Exception) {}
        }
        try { wavRaf?.close() } catch (_: Exception) {}
        try { audioRecord?.release() } catch (_: Exception) {}
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private val POISON = ByteArray(0)
        private const val SAMPLE_RATE = 16000
        private const val FINALIZATION_GRACE_MS = 900L
        private const val PROVIDER_COOLDOWN_MS = 250L
        private const val MAX_TRANSIENT_REARMS = 1
        private const val TRANSIENT_REARM_DELAY_MS = 350L
        private const val STT_QUEUE_CHUNKS = 32
        private const val PENDING_PCM_CHUNKS = 20
        private const val MAX_TRANSCRIPT_EVENTS = 400
        private const val PARTIAL_TELEMETRY_MIN_INTERVAL_MS = 250L
        private const val REQ_OPEN_SPEC = 41
        private const val REQ_SAVE_RESULT = 42

        private fun wavHeader(
            dataBytes: Long,
            sampleRate: Int,
            channels: Int,
            bitsPerSample: Int
        ): ByteArray {
            val byteRate = sampleRate * channels * bitsPerSample / 8
            val blockAlign = channels * bitsPerSample / 8
            val totalDataLen = dataBytes + 36
            return ByteArray(44).also { h ->
                fun ascii(offset: Int, value: String) {
                    value.toByteArray(Charsets.US_ASCII).copyInto(h, offset)
                }
                fun le16(offset: Int, value: Int) {
                    h[offset] = (value and 0xff).toByte()
                    h[offset + 1] = ((value ushr 8) and 0xff).toByte()
                }
                fun le32(offset: Int, value: Long) {
                    h[offset] = (value and 0xff).toByte()
                    h[offset + 1] = ((value ushr 8) and 0xff).toByte()
                    h[offset + 2] = ((value ushr 16) and 0xff).toByte()
                    h[offset + 3] = ((value ushr 24) and 0xff).toByte()
                }
                ascii(0, "RIFF")
                le32(4, totalDataLen)
                ascii(8, "WAVE")
                ascii(12, "fmt ")
                le32(16, 16)
                le16(20, 1)
                le16(22, channels)
                le32(24, sampleRate.toLong())
                le32(28, byteRate.toLong())
                le16(32, blockAlign)
                le16(34, bitsPerSample)
                ascii(36, "data")
                le32(40, dataBytes)
            }
        }
    }
}
