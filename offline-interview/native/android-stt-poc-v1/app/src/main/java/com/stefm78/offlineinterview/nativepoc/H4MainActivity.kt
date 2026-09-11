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
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
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
 * H4 physical-field successor.
 *
 * Critical invariant: the authoritative AudioRecord -> WAV loop NEVER performs a blocking
 * write into the SpeechRecognizer pipe. PCM for STT is offered into a bounded queue and a
 * disposable feeder thread owns the potentially blocking pipe write. A dead/disconnected STT
 * provider can therefore never hold the audio loop or the UI thread hostage.
 */
class H4MainActivity : Activity() {
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
        var lateEventCount: Int = 0,
        var droppedPcmChunks: Int = 0,
        var closed: Boolean = false
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

    private val questions: List<NativeQuestion>
        get() = interviewSpec.questions

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        interviewSpec = loadBundledSpec()
        handleIncomingSpec(intent, silent = true)
        buildUi()
        renderInterviewHeader()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
        } else {
            verifyRecognizerSupport()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent != null) handleIncomingSpec(intent, silent = false)
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        status = TextView(this).apply { text = "Initialisation H4…" }
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

        listOf(status, interviewTitle, questionMeta, question, liveTranscript, loadButton, startButton,
            nextButton, lockButton, stopButton, saveButton, exportView).forEach(root::addView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun renderInterviewHeader() {
        if (!::interviewTitle.isInitialized) return
        interviewTitle.text = interviewSpec.title
        currentTurn = currentTurn.coerceIn(0, questions.lastIndex)
        val q = questions[currentTurn]
        questionMeta.text = "${q.sectionTitle} · ${q.id} · ${currentTurn + 1}/${questions.size}${if (q.label.isNotBlank()) " · ${q.label}" else ""}"
        question.text = q.text
    }

    private fun loadBundledSpec(): NativeInterviewSpec =
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
            ?: throw IllegalArgumentException("Impossible de lire le fichier JSON.")
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
            REQ_OPEN_SPEC -> {
                val uri = data?.data ?: return
                try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
                try {
                    loadSpecFromUri(uri)
                    status.text = "Questionnaire chargé: ${interviewSpec.title} (${questions.size} questions)."
                } catch (e: Exception) {
                    status.text = "Questionnaire refusé: ${e.message}"
                }
            }
            REQ_SAVE_RESULT -> {
                val uri = data?.data ?: return
                val payload = lastExportJson ?: return
                executor.execute {
                    val message = try {
                        contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                        "Résultat JSON enregistré."
                    } catch (e: Exception) { "Échec export JSON: ${e.message}" }
                    runOnUiThread { status.text = message }
                }
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) verifyRecognizerSupport()
        else status.text = "Permission micro refusée — runtime bloqué."
    }

    private fun verifyRecognizerSupport() {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            status.text = "HOLD: reconnaissance on-device Android indisponible."
            return
        }
        val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        probe.checkRecognitionSupport(baseRecognizerIntent(null), mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(recognitionSupport: RecognitionSupport) {
                status.text = "Prêt H4 — ${questions.size} questions; STT on-device disponible."
                probe.destroy()
            }
            override fun onError(error: Int) {
                status.text = "STT on-device disponible; support détaillé non vérifiable (code $error)."
                probe.destroy()
            }
        })
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
        boundaries.clear(); boundaries += Boundary(0, 0L)
        transcriptEvents.clear(); canonicalText.clear(); latestPartialByTurn.clear(); durableDraftByTurn.clear()
        draftSourceByTurn.clear(); sttSessionHistory.clear(); sttSessions.clear()
        lastTelemetryPartialText.clear(); lastTelemetryPartialAt.clear()
        synchronized(pendingLock) { pendingPcm.clear(); pendingTurn = null }
        activeSttSession = null
        droppedTranscriptEventCount = 0; droppedSttPcmChunks = 0; sttDegraded = false; bytesWritten = 0L
        lastExportJson = null

        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        audioRecord = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, SAMPLE_RATE))
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
            status.text = "FAIL: impossible de démarrer AudioRecord: ${e.message}"
            cleanupCaptureOnly(); recording.set(false); return
        }

        createAndActivateSession(0, 0L, 0)
        renderInterviewHeader(); liveTranscript.text = "Écoute…"
        loadButton.isEnabled = false; startButton.isEnabled = false; nextButton.isEnabled = questions.size > 1
        lockButton.isEnabled = true; stopButton.isEnabled = true; saveButton.isEnabled = false
        status.text = "RUNNING H4 — WAV maître continu; STT découplé ${questions[0].id}."
    }

    private fun createAndActivateSession(turn: Int, startAtMs: Long, attempt: Int): TurnSttSession? {
        if (!recording.get() || turn != currentTurn) return null
        return try {
            val pipe = ParcelFileDescriptor.createPipe()
            val readFd = pipe[0]
            val sink = FileOutputStream(pipe[1].fileDescriptor)
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            val session = TurnSttSession(turn, attempt,
                "${questions[turn].id}-a$attempt-${SystemClock.elapsedRealtimeNanos()}", startAtMs,
                recognizer, readFd, sink)
            session.feederThread = Thread({ sttFeederLoop(session) }, "offline-interview-stt-${questions[turn].id}-a$attempt").also { it.start() }
            recognizer.setRecognitionListener(TurnRecognitionListener(session))
            recognizer.startListening(baseRecognizerIntent(readFd))
            sttSessions[turn] = session
            sttSessionHistory += session
            activeSttSession = session
            flushPendingPcm(session)
            session
        } catch (e: Exception) {
            sttDegraded = true
            status.text = "STT_DEGRADED: création session ${questions[turn].id}: ${e.message} — WAV continue."
            null
        }
    }

    private fun sttFeederLoop(session: TurnSttSession) {
        try {
            while (session.feederRunning.get()) {
                val chunk = session.pcmQueue.take()
                if (!session.feederRunning.get()) break
                session.sink.write(chunk)
            }
        } catch (_: InterruptedException) {
        } catch (_: IOException) {
            if (!session.closed) {
                session.feederRunning.set(false)
                runOnUiThread {
                    if (recording.get() && currentTurn == session.turn) {
                        status.text = "STT pipe ${questions[session.turn].id} fermé — WAV maître continue."
                    }
                }
            }
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
                runOnUiThread { status.text = "FAIL_MASTER: écriture WAV interrompue." }
                recording.set(false)
                break
            }

            val copy = buffer.copyOf(n)
            val session = activeSttSession
            if (session != null && !session.closed && session.turn == currentTurn) {
                if (!session.pcmQueue.offer(copy)) {
                    session.droppedPcmChunks++
                    droppedSttPcmChunks++
                }
            } else {
                synchronized(pendingLock) {
                    if (pendingTurn == currentTurn) {
                        if (pendingPcm.size >= PENDING_PCM_CHUNKS) pendingPcm.removeFirst()
                        pendingPcm.addLast(copy)
                    }
                }
            }
        }
    }

    private fun beginPendingWindow(turn: Int) {
        activeSttSession = null
        synchronized(pendingLock) { pendingPcm.clear(); pendingTurn = turn }
    }

    private fun flushPendingPcm(session: TurnSttSession) {
        val chunks = mutableListOf<ByteArray>()
        synchronized(pendingLock) {
            if (pendingTurn == session.turn) {
                while (pendingPcm.isNotEmpty()) chunks += pendingPcm.removeFirst()
                pendingTurn = null
            }
        }
        chunks.forEach { chunk ->
            if (!session.pcmQueue.offer(chunk)) {
                session.droppedPcmChunks++
                droppedSttPcmChunks++
            }
        }
    }

    private fun nextTurn() {
        if (!recording.get() || currentTurn >= questions.lastIndex) return
        val oldTurn = currentTurn
        val newTurn = currentTurn + 1
        val boundaryAt = elapsedMs()
        snapshotPartialAtClose(oldTurn)
        closeTurnSession(oldTurn, boundaryAt, "turn_boundary")

        currentTurn = newTurn
        boundaries += Boundary(newTurn, boundaryAt)
        beginPendingWindow(newTurn)
        renderInterviewHeader(); renderCurrentTurn()
        status.text = "H4 transition ${questions[newTurn].id} — WAV continu; reconnexion STT…"
        if (newTurn == questions.lastIndex) nextButton.isEnabled = false

        mainHandler.postDelayed({
            if (recording.get() && currentTurn == newTurn && activeSttSession == null) {
                createAndActivateSession(newTurn, boundaryAt, 0)
            }
        }, STT_HANDOFF_DELAY_MS)
    }

    private fun snapshotPartialAtClose(turn: Int) {
        if (durableDraftByTurn[turn].isNullOrBlank()) {
            latestPartialByTurn[turn].orEmpty().trim().takeIf { it.isNotEmpty() }?.let {
                durableDraftByTurn[turn] = it
                draftSourceByTurn[turn] = "partial_snapshot_at_turn_close"
            }
        }
    }

    private fun closeTurnSession(turn: Int, atMs: Long, reason: String) {
        val session = sttSessions[turn] ?: return
        if (session.closed) return
        if (activeSttSession === session) activeSttSession = null
        session.closed = true; session.endAtMs = atMs; session.closeReason = reason
        session.feederRunning.set(false)
        session.pcmQueue.clear()
        session.feederThread?.interrupt()
        try { session.sink.close() } catch (_: Exception) {}
        try { session.recognizer.cancel() } catch (_: Exception) {}
        try { session.readFd.close() } catch (_: Exception) {}
        try { session.recognizer.destroy() } catch (_: Exception) {}
    }

    private fun scheduleTransientRearm(session: TurnSttSession, error: Int): Boolean {
        if (!recording.get() || session.turn != currentTurn || session.attempt >= MAX_TRANSIENT_REARMS || session.closed) return false
        if (latestPartialByTurn[session.turn].orEmpty().isNotBlank() || durableDraftByTurn[session.turn].orEmpty().isNotBlank()) return false
        val now = elapsedMs()
        val reason = when (error) {
            SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "server_disconnected"
            else -> return false
        }
        session.providerError = error
        session.providerErrorClass = "recoverable_$reason"
        appendEvent(TranscriptEvent(now, null, session.turn, "recoverable_error", "stt_session_identity", "error=$error"))
        closeTurnSession(session.turn, now, "auto_rearm_$reason")
        beginPendingWindow(session.turn)
        status.text = "STT ${questions[session.turn].id}: reconnexion après $reason — WAV continue."
        mainHandler.postDelayed({
            if (recording.get() && currentTurn == session.turn && activeSttSession == null) {
                val replacement = createAndActivateSession(session.turn, now, session.attempt + 1)
                if (replacement == null) sttDegraded = true
            }
        }, TRANSIENT_REARM_DELAY_MS)
        return true
    }

    private fun lockCurrentDraft() {
        val draft = assembledDraft(currentTurn).trim()
        if (draft.isEmpty()) { status.text = "Aucun brouillon STT à valider pour cette question."; return }
        canonicalText[currentTurn] = draft
        status.text = "Texte humain validé pour ${questions[currentTurn].id}; human_lock reste prioritaire."
        renderCurrentTurn()
    }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        status.text = "Finalisation H4…"
        nextButton.isEnabled = false; lockButton.isEnabled = false; stopButton.isEnabled = false
        val stopAt = elapsedMs()
        snapshotPartialAtClose(currentTurn)
        closeTurnSession(currentTurn, stopAt, "interview_stop")
        synchronized(pendingLock) { pendingPcm.clear(); pendingTurn = null }
        try { audioRecord?.stop() } catch (_: Exception) {}

        executor.execute {
            try { captureThread?.join(1500) } catch (_: Exception) {}
            finalizeWav()
            try { Thread.sleep(FINAL_CALLBACK_GRACE_MS) } catch (_: InterruptedException) {}
            sessionCompletedAt = Instant.now().toString()
            val payload = buildProductResult().toString(2)
            lastExportJson = payload
            val answered = questions.indices.count { finalText(it).isNotBlank() }
            runOnUiThread {
                exportView.text = "Résultat prêt — ${InterviewContract.RESULT_SCHEMA} · $answered/${questions.size} réponses."
                loadButton.isEnabled = true; startButton.isEnabled = true; saveButton.isEnabled = true
                status.text = if (sttDegraded) "STOPPED — WAV finalisé; dégradation STT observée."
                    else "STOPPED — WAV maître local finalisé."
            }
        }
    }

    private fun assembledDraft(turn: Int): String = durableDraftByTurn[turn]?.takeIf { it.isNotBlank() } ?: latestPartialByTurn[turn].orEmpty()
    private fun finalText(turn: Int): String = canonicalText[turn] ?: assembledDraft(turn)
    private fun renderCurrentTurn() { liveTranscript.text = canonicalText[currentTurn] ?: assembledDraft(currentTurn).ifEmpty { "Écoute…" } }

    private fun appendEvent(event: TranscriptEvent, partial: Boolean = false) {
        if (transcriptEvents.size >= MAX_TRANSCRIPT_EVENTS) { droppedTranscriptEventCount++; return }
        if (partial) {
            val previousText = lastTelemetryPartialText[event.turn]
            val previousAt = lastTelemetryPartialAt[event.turn] ?: Long.MIN_VALUE
            if (previousText == event.text || event.callbackAtMs - previousAt < PARTIAL_TELEMETRY_MIN_INTERVAL_MS) {
                droppedTranscriptEventCount++; return
            }
            lastTelemetryPartialText[event.turn] = event.text
            lastTelemetryPartialAt[event.turn] = event.callbackAtMs
        }
        transcriptEvents += event
    }

    private fun recordPartial(session: TurnSttSession, text: String) {
        val clean = text.trim(); if (clean.isEmpty()) return
        session.partialCount++; if (session.closed) session.lateEventCount++
        latestPartialByTurn[session.turn] = clean
        appendEvent(TranscriptEvent(elapsedMs(), null, session.turn, "partial", "stt_session_identity", clean), true)
        if (session.turn == currentTurn && !canonicalText.containsKey(session.turn)) renderCurrentTurn()
    }

    private fun recognitionParts(bundle: Bundle?): List<RecognitionPart> {
        if (Build.VERSION.SDK_INT < 34 || bundle == null) return emptyList()
        return try { bundle.getParcelableArrayList(SpeechRecognizer.RECOGNITION_PARTS, RecognitionPart::class.java).orEmpty() }
        catch (_: Exception) { emptyList() }
    }

    private fun recordDurable(session: TurnSttSession, bundle: Bundle?, text: String, kind: String) {
        val clean = text.trim(); if (clean.isEmpty()) return
        if (session.closed) session.lateEventCount++
        val parts = recognitionParts(bundle); session.timedPartCount += parts.count { it.timestampMillis > 0L }
        when (kind) {
            "final" -> { session.finalCount++; durableDraftByTurn[session.turn] = clean; draftSourceByTurn[session.turn] = "final" }
            "segment" -> {
                session.segmentCount++
                val previous = durableDraftByTurn[session.turn].orEmpty().trim()
                durableDraftByTurn[session.turn] = if (previous.isEmpty() || previous == clean) clean else "$previous $clean"
                draftSourceByTurn[session.turn] = "segment"
            }
        }
        appendEvent(TranscriptEvent(elapsedMs(), parts.firstOrNull { it.timestampMillis > 0L }?.timestampMillis,
            session.turn, kind, "stt_session_identity", clean))
        if (session.turn == currentTurn && !canonicalText.containsKey(session.turn)) renderCurrentTurn()
    }

    private fun expectedTeardownError(session: TurnSttSession, error: Int): Boolean =
        session.closed && error == SpeechRecognizer.ERROR_CLIENT &&
            (session.closeReason == "turn_boundary" || session.closeReason == "interview_stop" || session.closeReason?.startsWith("auto_rearm_") == true)

    private inner class TurnRecognitionListener(private val session: TurnSttSession) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (session.turn == currentTurn && recording.get()) status.text = "STT ${questions[session.turn].id} prêt — parle normalement."
        }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onError(error: Int) {
            if (session.closed) session.lateEventCount++
            val expected = expectedTeardownError(session, error)
            if (expected) {
                if (session.providerError == null) {
                    session.providerError = error; session.providerErrorClass = "expected_teardown_error"
                }
                appendEvent(TranscriptEvent(elapsedMs(), null, session.turn, "teardown_error", "stt_session_identity", "error=$error"))
                return
            }
            if (scheduleTransientRearm(session, error)) return
            if (session.providerError == null) {
                session.providerError = error; session.providerErrorClass = "unexpected_provider_error"
            }
            appendEvent(TranscriptEvent(elapsedMs(), null, session.turn, "error", "stt_session_identity", "error=$error"))
            sttDegraded = true
            if (activeSttSession === session) activeSttSession = null
            session.feederRunning.set(false); session.feederThread?.interrupt()
            try { session.sink.close() } catch (_: Exception) {}
            if (session.turn == currentTurn && recording.get()) status.text = "STT_DEGRADED ${questions[session.turn].id}: error=$error — WAV continue."
        }
        override fun onResults(results: Bundle?) {
            recordDurable(session, results, results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty(), "final")
        }
        override fun onPartialResults(partialResults: Bundle?) {
            recordPartial(session, partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onSegmentResults(segmentResults: Bundle) {
            recordDurable(session, segmentResults, segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty(), "segment")
        }
        override fun onEndOfSegmentedSession() {}
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
            for (sIndex in 0 until sourceSections.length()) {
                val sourceSection = sourceSections.optJSONObject(sIndex) ?: continue
                val sectionOut = InterviewContract.cloneJson(sourceSection)
                val qs = sourceSection.optJSONArray("questions") ?: JSONArray()
                val qOutArray = JSONArray()
                for (qIndex in 0 until qs.length()) {
                    val sourceQuestion = qs.optJSONObject(qIndex) ?: continue
                    val qOut = InterviewContract.cloneJson(sourceQuestion)
                    val qId = sourceQuestion.optString("id")
                    val flat = questions.indexOfFirst { it.id == qId }
                    val turns = JSONArray()
                    if (flat >= 0) {
                        val text = finalText(flat).trim()
                        if (text.isNotEmpty()) turns.put(JSONObject().apply {
                            put("id", "native-$runtimeSessionId-$qId"); put("questionId", qId)
                            put("speakerId", interviewee.id); put("speakerName", interviewee.name); put("speakerRole", interviewee.role)
                            put("type", "answer"); put("source", "speech"); put("text", text); put("rawTranscript", assembledDraft(flat))
                            put("transcriptionSource", "android-on-device-per-turn"); put("draftSource", draftSourceByTurn[flat] ?: "live_partial")
                            put("canonicalSource", if (canonicalText.containsKey(flat)) "human_lock" else "draft_stt")
                            put("audioStartMs", boundaries.firstOrNull { it.turn == flat }?.atMs ?: JSONObject.NULL)
                            put("audioEndMs", sttSessionHistory.filter { it.turn == flat }.maxOfOrNull { it.endAtMs ?: durationMs } ?: JSONObject.NULL)
                        })
                    }
                    qOut.put("turns", turns); qOutArray.put(qOut)
                }
                sectionOut.put("questions", qOutArray); put(sectionOut)
            }
        }

        return JSONObject().apply {
            put("schema", InterviewContract.RESULT_SCHEMA); put("version", "1.0"); put("exportedAt", Instant.now().toString())
            put("provenance", JSONObject().apply {
                put("appBuild", "android-native-${BuildConfig.VERSION_NAME}"); put("inputSchema", InterviewContract.SPEC_SCHEMA)
                put("transcriptionDefault", "android-on-device-per-turn"); put("transcriptionFallback", JSONObject.NULL)
                put("privacy", "Audio remains local in the app-specific Android files area and is never embedded in this JSON export.")
            })
            put("interview", JSONObject().apply {
                put("id", interviewSpec.id); put("version", interviewSpec.version); put("title", interviewSpec.title)
                put("estimatedDurationMinutes", interviewSpec.estimatedDurationMinutes ?: JSONObject.NULL); put("context", interviewSpec.context)
                put("objective", interviewSpec.objective); put("language", interviewSpec.language); put("tags", interviewSpec.raw.optJSONArray("tags") ?: JSONArray())
            })
            put("participants", JSONArray().apply { interviewSpec.participants.forEach { p -> put(JSONObject().apply {
                put("id", p.id); put("name", p.name); put("role", p.role); put("active", true); put("removedAt", JSONObject.NULL)
            }) } })
            put("session", JSONObject().apply {
                put("id", runtimeSessionId); put("startedAt", sessionStartedAt ?: JSONObject.NULL); put("completedAt", sessionCompletedAt ?: JSONObject.NULL)
                put("completed", true); put("activeDurationSeconds", durationMs / 1000L)
                put("questionDurationSeconds", JSONObject().apply { questions.forEachIndexed { i, q -> put(q.id, questionDurationSeconds(i, durationMs)) } })
                put("completion", JSONObject().apply { put("answeredQuestions", answered); put("totalQuestions", questions.size); put("unansweredQuestions", questions.size - answered); put("followUpsUsed", 0) })
            })
            put("sections", sectionsOut)
            put("nativeCapture", JSONObject().apply {
                put("schema", "offline-interview.android-native-runtime.v4.3")
                put("appVersion", BuildConfig.VERSION_NAME)
                put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
                put("sttProvider", "Android SpeechRecognizer on-device via bounded nonblocking PCM feeder")
                put("routingAuthority", "stt_session_identity")
                put("wavPath", wavFile?.absolutePath ?: ""); put("pcmBytes", bytesWritten); put("audioDurationMs", durationMs)
                put("sttDegraded", sttDegraded); put("transientRearmMax", MAX_TRANSIENT_REARMS)
                put("droppedTranscriptEventCount", droppedTranscriptEventCount); put("droppedSttPcmChunks", droppedSttPcmChunks)
                put("turnBoundaries", JSONArray().apply { boundaries.forEach { b -> put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs)) } })
                put("sttSessions", JSONArray().apply { sttSessionHistory.forEach { s -> put(JSONObject().apply {
                    put("questionId", questions[s.turn].id); put("attempt", s.attempt); put("sessionId", s.sessionId); put("startAtMs", s.startAtMs)
                    put("endAtMs", s.endAtMs ?: JSONObject.NULL); put("closeReason", s.closeReason ?: JSONObject.NULL); put("partialCount", s.partialCount)
                    put("finalCount", s.finalCount); put("segmentCount", s.segmentCount); put("timedPartCount", s.timedPartCount)
                    put("providerError", s.providerError ?: JSONObject.NULL); put("providerErrorClass", s.providerErrorClass ?: JSONObject.NULL)
                    put("lateEventCount", s.lateEventCount); put("droppedPcmChunks", s.droppedPcmChunks)
                }) } })
                put("transcriptEvents", JSONArray().apply { transcriptEvents.forEach { e -> put(JSONObject().apply {
                    put("callbackAtMs", e.callbackAtMs); put("audioAtMs", e.audioAtMs ?: JSONObject.NULL); put("questionId", questions[e.turn].id)
                    put("kind", e.kind); put("routing", e.routing); put("text", e.text)
                }) } })
            })
        }
    }

    private fun saveResultJson() {
        val payload = lastExportJson ?: return
        val safeId = interviewSpec.id.replace(Regex("[^A-Za-z0-9._-]"), "-")
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "offline-interview-$safeId-$runtimeSessionId.json")
        }, REQ_SAVE_RESULT)
    }

    private fun cleanupCaptureOnly() {
        try { audioRecord?.release() } catch (_: Exception) {}; audioRecord = null
        try { wavRaf?.close() } catch (_: Exception) {}; wavRaf = null
        activeSttSession = null
    }

    private fun finalizeWav() {
        try { wavRaf?.let { raf -> raf.seek(0); raf.write(wavHeader(bytesWritten, SAMPLE_RATE, 1, 16)); raf.close() } } catch (_: Exception) {}
        wavRaf = null
        try { audioRecord?.release() } catch (_: Exception) {}; audioRecord = null
    }

    private fun elapsedMs(): Long = SystemClock.elapsedRealtime() - sessionStartMs

    override fun onDestroy() {
        recording.set(false); mainHandler.removeCallbacksAndMessages(null)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { captureThread?.join(500) } catch (_: Exception) {}
        sttSessionHistory.forEach { s ->
            s.feederRunning.set(false); s.feederThread?.interrupt(); try { s.sink.close() } catch (_: Exception) {}
            try { s.readFd.close() } catch (_: Exception) {}; try { s.recognizer.destroy() } catch (_: Exception) {}
        }
        cleanupCaptureOnly(); executor.shutdownNow(); super.onDestroy()
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val FINAL_CALLBACK_GRACE_MS = 700L
        private const val MAX_TRANSIENT_REARMS = 1
        private const val STT_HANDOFF_DELAY_MS = 250L
        private const val TRANSIENT_REARM_DELAY_MS = 350L
        private const val STT_QUEUE_CHUNKS = 24
        private const val PENDING_PCM_CHUNKS = 12
        private const val MAX_TRANSCRIPT_EVENTS = 400
        private const val PARTIAL_TELEMETRY_MIN_INTERVAL_MS = 250L
        private const val REQ_OPEN_SPEC = 41
        private const val REQ_SAVE_RESULT = 42

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
