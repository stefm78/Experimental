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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
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
    private val recording = AtomicBoolean(false)
    private val sttSinkLock = Any()

    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var activeSttSink: FileOutputStream? = null
    private var activeSttTurn: Int? = null
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
        var endAtMs: Long? = null,
        var closeReason: String? = null,
        var partialCount: Int = 0,
        var finalCount: Int = 0,
        var segmentCount: Int = 0,
        var timedPartCount: Int = 0,
        var providerError: Int? = null,
        var providerErrorClass: String? = null,
        var lateEventCount: Int = 0,
        var closed: Boolean = false
    )

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
        status = TextView(this).apply { text = "Initialisation…" }
        interviewTitle = TextView(this).apply { textSize = 22f }
        questionMeta = TextView(this).apply { textSize = 14f; setPadding(0, 16, 0, 4) }
        question = TextView(this).apply { textSize = 20f }
        liveTranscript = TextView(this).apply {
            text = "La transcription apparaîtra ici. Aucun champ éditable : aucun clavier logiciel."
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

        root.addView(status)
        root.addView(interviewTitle)
        root.addView(questionMeta)
        root.addView(question)
        root.addView(liveTranscript)
        root.addView(loadButton)
        root.addView(startButton)
        root.addView(nextButton)
        root.addView(lockButton)
        root.addView(stopButton)
        root.addView(saveButton)
        root.addView(exportView)
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

    private fun loadBundledSpec(): NativeInterviewSpec {
        val text = assets.open("interview.json").bufferedReader().use { it.readText() }
        return InterviewContract.parse(text)
    }

    private fun chooseInterviewSpec() {
        if (recording.get()) {
            status.text = "Termine l'entretien avant de changer de questionnaire."
            return
        }
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
            },
            REQ_OPEN_SPEC
        )
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
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: Exception) {}
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
                    val result = try {
                        contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                        "Résultat JSON enregistré."
                    } catch (e: Exception) {
                        "Échec export JSON: ${e.message}"
                    }
                    runOnUiThread { status.text = result }
                }
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            verifyRecognizerSupport()
        } else {
            status.text = "Permission micro refusée — runtime bloqué."
        }
    }

    private fun verifyRecognizerSupport() {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            status.text = "HOLD: reconnaissance on-device Android indisponible."
            return
        }
        val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        probe.checkRecognitionSupport(
            baseRecognizerIntent(null),
            mainExecutor,
            object : RecognitionSupportCallback {
                override fun onSupportResult(recognitionSupport: RecognitionSupport) {
                    status.text = "Prêt — ${questions.size} questions; STT on-device disponible."
                    probe.destroy()
                }
                override fun onError(error: Int) {
                    status.text = "STT on-device disponible; support détaillé non vérifiable (code $error)."
                    probe.destroy()
                }
            }
        )
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
        transcriptEvents.clear()
        canonicalText.clear()
        latestPartialByTurn.clear()
        durableDraftByTurn.clear()
        draftSourceByTurn.clear()
        lastTelemetryPartialText.clear()
        lastTelemetryPartialAt.clear()
        destroyAllSttSessions()
        sttSessionHistory.clear()
        droppedTranscriptEventCount = 0
        sttDegraded = false
        bytesWritten = 0L
        lastExportJson = null
        boundaries += Boundary(0, 0L)

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

        // H2 invariant: start the authoritative audio path before the first recognizer,
        // matching the steady-state order used by subsequent turns.
        try {
            audioRecord?.startRecording()
            captureThread = Thread { captureLoop() }.also { it.start() }
        } catch (e: Exception) {
            status.text = "FAIL: impossible de démarrer AudioRecord: ${e.message}"
            cleanupCaptureOnly()
            recording.set(false)
            return
        }

        val firstSession = createTurnSttSession(0, 0L, 0)
        if (firstSession == null) {
            status.text = "STT_DEGRADED ${questions[0].id}: capture WAV continue sans STT."
            sttDegraded = true
        } else {
            activateSession(firstSession)
        }

        renderInterviewHeader()
        liveTranscript.text = "Écoute…"
        loadButton.isEnabled = false
        startButton.isEnabled = false
        nextButton.isEnabled = questions.size > 1
        lockButton.isEnabled = true
        stopButton.isEnabled = true
        saveButton.isEnabled = false
        status.text = "RUNNING H2 — WAV maître continu; STT dédié ${questions[0].id}."
    }

    private fun createTurnSttSession(turn: Int, startAtMs: Long, attempt: Int = 0): TurnSttSession? {
        return try {
            val pipe = ParcelFileDescriptor.createPipe()
            val readFd = pipe[0]
            val sink = FileOutputStream(pipe[1].fileDescriptor)
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            val session = TurnSttSession(
                turn = turn,
                attempt = attempt,
                sessionId = "${questions[turn].id}-a$attempt-${SystemClock.elapsedRealtimeNanos()}",
                startAtMs = startAtMs,
                recognizer = recognizer,
                readFd = readFd,
                sink = sink
            )
            recognizer.setRecognitionListener(TurnRecognitionListener(session))
            recognizer.startListening(baseRecognizerIntent(readFd))
            sttSessions[turn] = session
            sttSessionHistory += session
            session
        } catch (e: Exception) {
            status.text = "STT_DEGRADED: création session ${questions[turn].id}: ${e.message}"
            null
        }
    }

    private fun activateSession(session: TurnSttSession) {
        synchronized(sttSinkLock) {
            activeSttSink = session.sink
            activeSttTurn = session.turn
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

            synchronized(sttSinkLock) {
                activeSttSink?.let { sink ->
                    try {
                        sink.write(buffer, 0, n)
                    } catch (_: IOException) {
                        activeSttSink = null
                        sttDegraded = true
                        runOnUiThread {
                            status.text = "STT_DEGRADED: pipe ${activeSttTurn?.let { questions[it].id } ?: "?"} fermé; WAV continue."
                        }
                    }
                }
            }
        }
    }

    private fun nextTurn() {
        if (!recording.get() || currentTurn >= questions.lastIndex) return

        val oldTurn = currentTurn
        val newTurn = currentTurn + 1
        val boundaryAt = elapsedMs()
        val newSession = createTurnSttSession(newTurn, boundaryAt, 0)

        if (newSession == null) {
            snapshotPartialAtClose(oldTurn)
            closeTurnSession(oldTurn, boundaryAt, "turn_boundary_stt_degraded", clearActive = true)
            currentTurn = newTurn
            boundaries += Boundary(newTurn, boundaryAt)
            sttDegraded = true
            renderInterviewHeader()
            renderCurrentTurn()
            if (newTurn == questions.lastIndex) nextButton.isEnabled = false
            return
        }

        val oldSink: FileOutputStream?
        synchronized(sttSinkLock) {
            oldSink = activeSttSink
            activeSttSink = newSession.sink
            activeSttTurn = newTurn
        }

        snapshotPartialAtClose(oldTurn)
        closeTurnSession(oldTurn, boundaryAt, "turn_boundary", clearActive = false, sinkOverride = oldSink)

        currentTurn = newTurn
        boundaries += Boundary(newTurn, boundaryAt)
        renderInterviewHeader()
        renderCurrentTurn()
        status.text = "RUNNING H2 — WAV continu; STT basculé vers ${questions[newTurn].id}."
        if (newTurn == questions.lastIndex) nextButton.isEnabled = false
    }

    private fun snapshotPartialAtClose(turn: Int) {
        if (durableDraftByTurn[turn].isNullOrBlank()) {
            val partial = latestPartialByTurn[turn].orEmpty().trim()
            if (partial.isNotEmpty()) {
                durableDraftByTurn[turn] = partial
                draftSourceByTurn[turn] = "partial_snapshot_at_turn_close"
            }
        }
    }

    private fun closeSessionResources(session: TurnSttSession, sinkOverride: FileOutputStream? = null) {
        val sink = sinkOverride ?: session.sink
        try { sink.flush() } catch (_: Exception) {}
        try { sink.close() } catch (_: Exception) {}
        try { session.recognizer.stopListening() } catch (_: Exception) {}
    }

    private fun closeTurnSession(
        turn: Int,
        atMs: Long,
        reason: String,
        clearActive: Boolean,
        sinkOverride: FileOutputStream? = null
    ) {
        val session = sttSessions[turn] ?: return
        if (session.closed) return
        session.closed = true
        session.endAtMs = atMs
        session.closeReason = reason
        if (clearActive) {
            synchronized(sttSinkLock) {
                if (activeSttTurn == turn) {
                    activeSttSink = null
                    activeSttTurn = null
                }
            }
        }
        closeSessionResources(session, sinkOverride)
    }

    private fun rearmNoMatch(session: TurnSttSession): Boolean {
        if (!recording.get() || session.turn != currentTurn || session.attempt >= MAX_NO_MATCH_REARMS) return false
        if (latestPartialByTurn[session.turn].orEmpty().isNotBlank() || durableDraftByTurn[session.turn].orEmpty().isNotBlank()) return false
        if (session.closed) return false

        val now = elapsedMs()
        session.closed = true
        session.endAtMs = now
        session.closeReason = "auto_rearm_no_match"
        session.providerErrorClass = "recoverable_no_match"

        synchronized(sttSinkLock) {
            if (activeSttTurn == session.turn) {
                activeSttSink = null
                activeSttTurn = null
            }
        }
        closeSessionResources(session)
        try { session.readFd.close() } catch (_: Exception) {}
        try { session.recognizer.destroy() } catch (_: Exception) {}

        val replacement = createTurnSttSession(session.turn, now, session.attempt + 1)
        if (replacement == null) {
            sttDegraded = true
            return false
        }
        activateSession(replacement)
        status.text = "STT ${questions[session.turn].id} réarmé après absence de correspondance — WAV resté continu."
        return true
    }

    private fun lockCurrentDraft() {
        val draft = assembledDraft(currentTurn).trim()
        if (draft.isEmpty()) {
            status.text = "Aucun brouillon STT à valider pour cette question."
            return
        }
        canonicalText[currentTurn] = draft
        status.text = "Texte humain validé pour ${questions[currentTurn].id}; human_lock reste prioritaire."
        renderCurrentTurn()
    }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        status.text = "Finalisation H2…"
        nextButton.isEnabled = false
        lockButton.isEnabled = false
        stopButton.isEnabled = false

        val stopAt = elapsedMs()
        snapshotPartialAtClose(currentTurn)
        closeTurnSession(currentTurn, stopAt, "interview_stop", clearActive = true)

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
                exportView.text = "Résultat prêt — schema ${InterviewContract.RESULT_SCHEMA} · $answered/${questions.size} réponses · ${payload.length} caractères. Utilise Enregistrer le résultat JSON pour le fichier complet."
                destroyAllSttSessions()
                loadButton.isEnabled = true
                startButton.isEnabled = true
                saveButton.isEnabled = true
                status.text = if (sttDegraded) {
                    "STOPPED — résultat produit; dégradation STT non récupérée observée."
                } else {
                    "STOPPED — résultat produit; WAV maître local finalisé."
                }
            }
        }
    }

    private fun assembledDraft(turn: Int): String =
        durableDraftByTurn[turn]?.takeIf { it.isNotBlank() } ?: latestPartialByTurn[turn].orEmpty()

    private fun finalText(turn: Int): String = canonicalText[turn] ?: assembledDraft(turn)

    private fun renderCurrentTurn() {
        val canonical = canonicalText[currentTurn]
        liveTranscript.text = canonical ?: assembledDraft(currentTurn).ifEmpty { "Écoute…" }
    }

    private fun appendEvent(event: TranscriptEvent, partial: Boolean = false) {
        if (transcriptEvents.size >= MAX_TRANSCRIPT_EVENTS) {
            droppedTranscriptEventCount++
            return
        }
        if (partial) {
            val previousText = lastTelemetryPartialText[event.turn]
            val previousAt = lastTelemetryPartialAt[event.turn] ?: Long.MIN_VALUE
            if (previousText == event.text || event.callbackAtMs - previousAt < PARTIAL_TELEMETRY_MIN_INTERVAL_MS) {
                droppedTranscriptEventCount++
                return
            }
            lastTelemetryPartialText[event.turn] = event.text
            lastTelemetryPartialAt[event.turn] = event.callbackAtMs
        }
        transcriptEvents += event
    }

    private fun recordPartial(session: TurnSttSession, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        session.partialCount++
        if (session.closed) session.lateEventCount++
        latestPartialByTurn[session.turn] = clean
        appendEvent(
            TranscriptEvent(elapsedMs(), null, session.turn, "partial", "stt_session_identity", clean),
            partial = true
        )
        if (session.turn == currentTurn && !canonicalText.containsKey(session.turn)) renderCurrentTurn()
    }

    private fun recognitionParts(bundle: Bundle?): List<RecognitionPart> {
        if (Build.VERSION.SDK_INT < 34 || bundle == null) return emptyList()
        return try {
            bundle.getParcelableArrayList(SpeechRecognizer.RECOGNITION_PARTS, RecognitionPart::class.java).orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun recordDurable(session: TurnSttSession, bundle: Bundle?, text: String, kind: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        if (session.closed) session.lateEventCount++
        val parts = recognitionParts(bundle)
        session.timedPartCount += parts.count { it.timestampMillis > 0L }

        when (kind) {
            "final" -> {
                session.finalCount++
                durableDraftByTurn[session.turn] = clean
                draftSourceByTurn[session.turn] = "final"
            }
            "segment" -> {
                session.segmentCount++
                val previous = durableDraftByTurn[session.turn].orEmpty().trim()
                durableDraftByTurn[session.turn] = when {
                    previous.isEmpty() -> clean
                    previous == clean -> previous
                    else -> "$previous $clean"
                }
                draftSourceByTurn[session.turn] = "segment"
            }
        }

        appendEvent(
            TranscriptEvent(
                elapsedMs(),
                parts.firstOrNull { it.timestampMillis > 0L }?.timestampMillis,
                session.turn,
                kind,
                "stt_session_identity",
                clean
            )
        )
        if (session.turn == currentTurn && !canonicalText.containsKey(session.turn)) renderCurrentTurn()
    }

    private fun expectedTeardownError(session: TurnSttSession, error: Int): Boolean =
        session.closed && error == SpeechRecognizer.ERROR_CLIENT &&
            (session.closeReason == "turn_boundary" || session.closeReason == "interview_stop")

    private inner class TurnRecognitionListener(private val session: TurnSttSession) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (session.turn == currentTurn && recording.get()) {
                status.text = "STT ${questions[session.turn].id} prêt — parle normalement."
            }
        }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            session.providerError = error
            if (session.closed) session.lateEventCount++
            val expected = expectedTeardownError(session, error)
            val recoverableNoMatch = !expected && error == SpeechRecognizer.ERROR_NO_MATCH &&
                session.turn == currentTurn && recording.get() && session.attempt < MAX_NO_MATCH_REARMS &&
                latestPartialByTurn[session.turn].orEmpty().isBlank() && durableDraftByTurn[session.turn].orEmpty().isBlank()

            session.providerErrorClass = when {
                expected -> "expected_teardown_error"
                recoverableNoMatch -> "recoverable_no_match"
                else -> "unexpected_provider_error"
            }
            appendEvent(
                TranscriptEvent(
                    elapsedMs(), null, session.turn,
                    when {
                        expected -> "teardown_error"
                        recoverableNoMatch -> "recoverable_error"
                        else -> "error"
                    },
                    "stt_session_identity",
                    "error=$error"
                )
            )

            if (recoverableNoMatch && rearmNoMatch(session)) return
            if (!expected) sttDegraded = true
            if (!expected && session.turn == currentTurn && recording.get()) {
                status.text = "STT_DEGRADED ${questions[session.turn].id}: error=$error — WAV continue."
            }
        }

        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            recordDurable(session, results, text, "final")
        }
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            recordPartial(session, text)
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onSegmentResults(segmentResults: Bundle) {
            val text = segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            recordDurable(session, segmentResults, text, "segment")
        }
        override fun onEndOfSegmentedSession() {}
    }

    private fun questionDurationSeconds(index: Int, totalDurationMs: Long): Long {
        val start = boundaries.firstOrNull { it.turn == index }?.atMs ?: 0L
        val end = boundaries.firstOrNull { it.turn == index + 1 }?.atMs ?: totalDurationMs
        return (end - start).coerceAtLeast(0L) / 1000L
    }

    private fun buildProductResult(): JSONObject {
        val durationMs = if (SAMPLE_RATE > 0) bytesWritten * 1000L / (SAMPLE_RATE * 2L) else 0L
        val interviewee = interviewSpec.interviewee
        val answered = questions.indices.count { finalText(it).isNotBlank() }

        val participantJson = JSONArray().apply {
            interviewSpec.participants.forEach { p ->
                put(JSONObject().apply {
                    put("id", p.id); put("name", p.name); put("role", p.role); put("active", true); put("removedAt", JSONObject.NULL)
                })
            }
        }

        val questionDurations = JSONObject().apply {
            questions.forEachIndexed { index, q -> put(q.id, questionDurationSeconds(index, durationMs)) }
        }

        val sectionResults = JSONArray().apply {
            val sourceSections = interviewSpec.raw.optJSONArray("sections") ?: JSONArray()
            for (sIndex in 0 until sourceSections.length()) {
                val sourceSection = sourceSections.optJSONObject(sIndex) ?: continue
                val sectionOut = InterviewContract.cloneJson(sourceSection)
                val sourceQuestions = sourceSection.optJSONArray("questions") ?: JSONArray()
                val questionsOut = JSONArray()
                for (qIndex in 0 until sourceQuestions.length()) {
                    val sourceQuestion = sourceQuestions.optJSONObject(qIndex) ?: continue
                    val qOut = InterviewContract.cloneJson(sourceQuestion)
                    val qId = sourceQuestion.optString("id")
                    val flatIndex = questions.indexOfFirst { it.id == qId }
                    val turns = JSONArray()
                    if (flatIndex >= 0) {
                        val text = finalText(flatIndex).trim()
                        if (text.isNotEmpty()) {
                            val allSessions = sttSessionHistory.filter { it.turn == flatIndex }
                            turns.put(JSONObject().apply {
                                put("id", "native-$runtimeSessionId-$qId")
                                put("questionId", qId)
                                put("speakerId", interviewee.id)
                                put("speakerName", interviewee.name)
                                put("speakerRole", interviewee.role)
                                put("type", "answer")
                                put("source", "speech")
                                put("text", text)
                                put("rawTranscript", assembledDraft(flatIndex))
                                put("transcriptionSource", "android-on-device-per-turn")
                                put("draftSource", draftSourceByTurn[flatIndex] ?: "live_partial")
                                put("canonicalSource", if (canonicalText.containsKey(flatIndex)) "human_lock" else "draft_stt")
                                put("audioStartMs", boundaries.firstOrNull { it.turn == flatIndex }?.atMs ?: JSONObject.NULL)
                                put("audioEndMs", allSessions.maxOfOrNull { it.endAtMs ?: durationMs } ?: JSONObject.NULL)
                            })
                        }
                    }
                    qOut.put("turns", turns)
                    questionsOut.put(qOut)
                }
                sectionOut.put("questions", questionsOut)
                put(sectionOut)
            }
        }

        val nativeSessions = JSONArray().apply {
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
                    put("lateEventCount", s.lateEventCount)
                })
            }
        }

        val nativeEvents = JSONArray().apply {
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
        }

        return JSONObject().apply {
            put("schema", InterviewContract.RESULT_SCHEMA)
            put("version", "1.0")
            put("exportedAt", Instant.now().toString())
            put("provenance", JSONObject().apply {
                put("appBuild", "android-native-${BuildConfig.VERSION_NAME}")
                put("inputSchema", InterviewContract.SPEC_SCHEMA)
                put("transcriptionDefault", "android-on-device-per-turn")
                put("transcriptionFallback", JSONObject.NULL)
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
            put("participants", participantJson)
            put("session", JSONObject().apply {
                put("id", runtimeSessionId)
                put("startedAt", sessionStartedAt ?: JSONObject.NULL)
                put("completedAt", sessionCompletedAt ?: JSONObject.NULL)
                put("completed", true)
                put("activeDurationSeconds", durationMs / 1000L)
                put("questionDurationSeconds", questionDurations)
                put("completion", JSONObject().apply {
                    put("answeredQuestions", answered)
                    put("totalQuestions", questions.size)
                    put("unansweredQuestions", questions.size - answered)
                    put("followUpsUsed", 0)
                })
            })
            put("sections", sectionResults)
            put("nativeCapture", JSONObject().apply {
                put("schema", "offline-interview.android-native-runtime.v4.1")
                put("appVersion", BuildConfig.VERSION_NAME)
                put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
                put("sttProvider", "Android SpeechRecognizer on-device via per-question EXTRA_AUDIO_SOURCE")
                put("routingAuthority", "stt_session_identity")
                put("wavPath", wavFile?.absolutePath ?: "")
                put("pcmBytes", bytesWritten)
                put("audioDurationMs", durationMs)
                put("sttDegraded", sttDegraded)
                put("noMatchRearmMax", MAX_NO_MATCH_REARMS)
                put("droppedTranscriptEventCount", droppedTranscriptEventCount)
                put("turnBoundaries", JSONArray().apply {
                    boundaries.forEach { b -> put(JSONObject().put("questionId", questions[b.turn].id).put("atMs", b.atMs)) }
                })
                put("sttSessions", nativeSessions)
                put("transcriptEvents", nativeEvents)
            })
        }
    }

    private fun saveResultJson() {
        val payload = lastExportJson
        if (payload.isNullOrBlank()) {
            status.text = "Aucun résultat à enregistrer."
            return
        }
        val safeId = interviewSpec.id.replace(Regex("[^A-Za-z0-9._-]"), "-")
        startActivityForResult(
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, "offline-interview-$safeId-$runtimeSessionId.json")
            },
            REQ_SAVE_RESULT
        )
    }

    private fun cleanupCaptureOnly() {
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
        try { wavRaf?.close() } catch (_: Exception) {}
        wavRaf = null
        synchronized(sttSinkLock) {
            try { activeSttSink?.close() } catch (_: Exception) {}
            activeSttSink = null
            activeSttTurn = null
        }
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

    private fun destroyAllSttSessions() {
        synchronized(sttSinkLock) {
            try { activeSttSink?.close() } catch (_: Exception) {}
            activeSttSink = null
            activeSttTurn = null
        }
        sttSessionHistory.forEach { s ->
            try { s.sink.close() } catch (_: Exception) {}
            try { s.readFd.close() } catch (_: Exception) {}
            try { s.recognizer.destroy() } catch (_: Exception) {}
        }
        sttSessions.clear()
    }

    private fun elapsedMs(): Long = SystemClock.elapsedRealtime() - sessionStartMs

    override fun onDestroy() {
        recording.set(false)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { captureThread?.join(500) } catch (_: Exception) {}
        cleanupCaptureOnly()
        destroyAllSttSessions()
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val FINAL_CALLBACK_GRACE_MS = 900L
        private const val MAX_NO_MATCH_REARMS = 1
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
                fun le16(offset: Int, v: Int) {
                    h[offset] = (v and 0xff).toByte(); h[offset + 1] = ((v ushr 8) and 0xff).toByte()
                }
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
