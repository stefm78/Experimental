package com.stefm78.offlineinterview.nativepoc

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
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
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    private val questions = listOf(
        "Présente-toi brièvement et explique le contexte de cet entretien.",
        "Décris un problème concret que tu voudrais résoudre.",
        "Quel serait pour toi un bon résultat à la fin de cet entretien ?"
    )

    private lateinit var status: TextView
    private lateinit var question: TextView
    private lateinit var liveTranscript: TextView
    private lateinit var startButton: Button
    private lateinit var nextButton: Button
    private lateinit var lockButton: Button
    private lateinit var stopButton: Button
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
    private var currentTurn = 0
    private var sttDegraded = false

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
        } else {
            verifyRecognizerSupport()
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        status = TextView(this).apply { text = "Initialisation…" }
        question = TextView(this).apply { textSize = 20f; text = questions[0] }
        liveTranscript = TextView(this).apply {
            text = "La transcription apparaîtra ici. Aucun champ éditable : aucun clavier logiciel."
            setPadding(0, 24, 0, 24)
            setTextIsSelectable(true)
        }
        startButton = Button(this).apply { text = "Démarrer capture + STT" }
        nextButton = Button(this).apply { text = "Question suivante"; isEnabled = false }
        lockButton = Button(this).apply { text = "Valider le texte humain"; isEnabled = false }
        stopButton = Button(this).apply { text = "Terminer"; isEnabled = false }
        exportView = TextView(this).apply { setTextIsSelectable(true) }

        startButton.setOnClickListener { startSession() }
        nextButton.setOnClickListener { nextTurn() }
        lockButton.setOnClickListener { lockCurrentDraft() }
        stopButton.setOnClickListener { stopSession() }

        root.addView(status)
        root.addView(question)
        root.addView(liveTranscript)
        root.addView(startButton)
        root.addView(nextButton)
        root.addView(lockButton)
        root.addView(stopButton)
        root.addView(exportView)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            verifyRecognizerSupport()
        } else {
            status.text = "Permission micro refusée — POC bloqué."
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
                    status.text = "Recognizer on-device disponible. Langues locales: ${recognitionSupport.installedOnDeviceLanguages.joinToString()}"
                    probe.destroy()
                }

                override fun onError(error: Int) {
                    status.text = "Recognizer on-device disponible; support détaillé non vérifiable (code $error)."
                    probe.destroy()
                }
            }
        )
    }

    private fun baseRecognizerIntent(audioSource: ParcelFileDescriptor?): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.FRANCE.toLanguageTag())
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
        currentTurn = 0
        boundaries.clear()
        transcriptEvents.clear()
        canonicalText.clear()
        latestPartialByTurn.clear()
        durableDraftByTurn.clear()
        draftSourceByTurn.clear()
        destroyAllSttSessions()
        sttDegraded = false
        bytesWritten = 0L
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

        val firstSession = createTurnSttSession(0, 0L)
        if (firstSession == null) {
            status.text = "FAIL: impossible d'initialiser STT T1; capture non démarrée."
            cleanupCaptureOnly()
            recording.set(false)
            return
        }
        synchronized(sttSinkLock) {
            activeSttSink = firstSession.sink
            activeSttTurn = 0
        }

        audioRecord?.startRecording()
        captureThread = Thread { captureLoop() }.also { it.start() }

        question.text = questions[0]
        liveTranscript.text = "Écoute…"
        startButton.isEnabled = false
        nextButton.isEnabled = true
        lockButton.isEnabled = true
        stopButton.isEnabled = true
        status.text = "RUNNING V3 — AudioRecord/WAV continu; STT session dédiée T1."
    }

    private fun createTurnSttSession(turn: Int, startAtMs: Long): TurnSttSession? {
        return try {
            val pipe = ParcelFileDescriptor.createPipe()
            val readFd = pipe[0]
            val sink = FileOutputStream(pipe[1].fileDescriptor)
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            val session = TurnSttSession(
                turn = turn,
                sessionId = "T${turn + 1}-${SystemClock.elapsedRealtimeNanos()}",
                startAtMs = startAtMs,
                recognizer = recognizer,
                readFd = readFd,
                sink = sink
            )
            recognizer.setRecognitionListener(TurnRecognitionListener(session))
            recognizer.startListening(baseRecognizerIntent(readFd))
            sttSessions[turn] = session
            session
        } catch (e: Exception) {
            status.text = "STT_DEGRADED: création session T${turn + 1}: ${e.message}"
            sttDegraded = true
            null
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
                val sink = activeSttSink
                if (sink != null) {
                    try {
                        sink.write(buffer, 0, n)
                    } catch (_: IOException) {
                        activeSttSink = null
                        sttDegraded = true
                        runOnUiThread { status.text = "STT_DEGRADED: pipe T${(activeSttTurn ?: -1) + 1} fermé; WAV continue." }
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
        val newSession = createTurnSttSession(newTurn, boundaryAt)

        if (newSession == null) {
            snapshotPartialAtClose(oldTurn)
            closeTurnSession(oldTurn, boundaryAt, "turn_boundary_stt_degraded", clearActive = true)
            currentTurn = newTurn
            boundaries += Boundary(newTurn, boundaryAt)
            question.text = questions[newTurn]
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
        question.text = questions[newTurn]
        renderCurrentTurn()
        status.text = "RUNNING V3 — WAV continu; STT basculé vers T${newTurn + 1}."
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

        val sink = sinkOverride ?: session.sink
        if (clearActive) {
            synchronized(sttSinkLock) {
                if (activeSttTurn == turn) {
                    activeSttSink = null
                    activeSttTurn = null
                }
            }
        }
        try { sink.flush() } catch (_: Exception) {}
        try { sink.close() } catch (_: Exception) {}
        try { session.recognizer.stopListening() } catch (_: Exception) {}
    }

    private fun lockCurrentDraft() {
        val draft = assembledDraft(currentTurn).trim()
        if (draft.isEmpty()) {
            status.text = "Aucun brouillon STT à valider pour cette question."
            return
        }
        canonicalText[currentTurn] = draft
        status.text = "Texte humain validé pour T${currentTurn + 1}; human_lock reste prioritaire."
        renderCurrentTurn()
    }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        status.text = "Finalisation V3…"
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
            runOnUiThread {
                renderExport()
                destroyAllSttSessions()
                startButton.isEnabled = true
                status.text = if (sttDegraded) {
                    "STOPPED — WAV maître finalisé; STT_DEGRADED observé, voir export."
                } else {
                    "STOPPED — WAV maître finalisé; vérifier isolation T1/T2/T3."
                }
            }
        }
    }

    private fun assembledDraft(turn: Int): String =
        durableDraftByTurn[turn]?.takeIf { it.isNotBlank() }
            ?: latestPartialByTurn[turn].orEmpty()

    private fun renderCurrentTurn() {
        val canonical = canonicalText[currentTurn]
        liveTranscript.text = canonical ?: assembledDraft(currentTurn).ifEmpty { "Écoute…" }
    }

    private fun recordPartial(session: TurnSttSession, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        session.partialCount++
        if (session.closed) session.lateEventCount++
        latestPartialByTurn[session.turn] = clean
        transcriptEvents += TranscriptEvent(
            callbackAtMs = elapsedMs(),
            audioAtMs = null,
            turn = session.turn,
            kind = "partial",
            routing = "stt_session_identity",
            text = clean
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
        val timed = parts.count { it.timestampMillis > 0L }
        session.timedPartCount += timed

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

        transcriptEvents += TranscriptEvent(
            callbackAtMs = elapsedMs(),
            audioAtMs = parts.firstOrNull { it.timestampMillis > 0L }?.timestampMillis,
            turn = session.turn,
            kind = kind,
            routing = "stt_session_identity",
            text = clean
        )
        if (session.turn == currentTurn && !canonicalText.containsKey(session.turn)) renderCurrentTurn()
    }

    private inner class TurnRecognitionListener(private val session: TurnSttSession) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (session.turn == currentTurn && recording.get()) {
                status.text = "STT T${session.turn + 1} prêt — parle normalement."
            }
        }

        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            session.providerError = error
            if (session.closed) session.lateEventCount++
            sttDegraded = true
            transcriptEvents += TranscriptEvent(
                callbackAtMs = elapsedMs(),
                audioAtMs = null,
                turn = session.turn,
                kind = "error",
                routing = "stt_session_identity",
                text = "error=$error"
            )
            if (session.turn == currentTurn && recording.get()) {
                status.text = "STT_DEGRADED T${session.turn + 1}: error=$error — WAV continue."
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

    private fun renderExport() {
        val durationMs = if (SAMPLE_RATE > 0) bytesWritten * 1000L / (SAMPLE_RATE * 2L) else 0L

        val sessionsJson = JSONArray().apply {
            sttSessions.toSortedMap().values.forEach { s ->
                put(JSONObject().apply {
                    put("turnId", "T${s.turn + 1}")
                    put("sessionId", s.sessionId)
                    put("startAtMs", s.startAtMs)
                    put("endAtMs", s.endAtMs ?: JSONObject.NULL)
                    put("closeReason", s.closeReason ?: JSONObject.NULL)
                    put("partialCount", s.partialCount)
                    put("finalCount", s.finalCount)
                    put("segmentCount", s.segmentCount)
                    put("timedPartCount", s.timedPartCount)
                    put("providerError", s.providerError ?: JSONObject.NULL)
                    put("lateEventCount", s.lateEventCount)
                })
            }
        }

        val eventsJson = JSONArray().apply {
            transcriptEvents.forEach { e ->
                put(JSONObject().apply {
                    put("callbackAtMs", e.callbackAtMs)
                    put("audioAtMs", e.audioAtMs ?: JSONObject.NULL)
                    put("turnId", "T${e.turn + 1}")
                    put("kind", e.kind)
                    put("routing", e.routing)
                    put("text", e.text)
                })
            }
        }

        val turnsJson = JSONArray().apply {
            questions.forEachIndexed { i, q ->
                val canonical = canonicalText[i]
                val draft = assembledDraft(i)
                put(JSONObject().apply {
                    put("turnId", "T${i + 1}")
                    put("question", q)
                    put("draft", draft)
                    put("draftSource", draftSourceByTurn[i] ?: if (draft.isNotBlank()) "live_partial" else JSONObject.NULL)
                    put("canonical", canonical ?: JSONObject.NULL)
                    put("canonicalSource", if (canonical != null) "human_lock" else "draft_stt")
                })
            }
        }

        val out = JSONObject().apply {
            put("schema", "offline-interview.android-native-stt-poc.v3")
            put("appVersion", "0.3.0")
            put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
            put("sttProvider", "Android SpeechRecognizer on-device via per-turn EXTRA_AUDIO_SOURCE")
            put("routingAuthority", "stt_session_identity")
            put("wavPath", wavFile?.absolutePath ?: "")
            put("pcmBytes", bytesWritten)
            put("audioDurationMs", durationMs)
            put("sttDegraded", sttDegraded)
            put("turnBoundaries", JSONArray().apply {
                boundaries.forEach { b -> put(JSONObject().put("turnId", "T${b.turn + 1}").put("atMs", b.atMs)) }
            })
            put("sttSessions", sessionsJson)
            put("transcriptEvents", eventsJson)
            put("turns", turnsJson)
        }
        exportView.text = out.toString(2)
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
        sttSessions.values.forEach { s ->
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
