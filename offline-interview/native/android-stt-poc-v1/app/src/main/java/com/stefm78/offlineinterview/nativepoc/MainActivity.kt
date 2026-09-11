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
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.View
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

class MainActivity : Activity(), RecognitionListener {
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
    private var speechRecognizer: SpeechRecognizer? = null
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var pipeRead: ParcelFileDescriptor? = null
    private var pipeWrite: ParcelFileDescriptor? = null
    private var wavFile: File? = null
    private var wavRaf: RandomAccessFile? = null
    private var bytesWritten = 0L
    private var sessionStartMs = 0L
    private var currentTurn = 0
    private var recognizerStarted = false

    private data class Boundary(val turn: Int, val atMs: Long)
    private data class TranscriptEvent(val atMs: Long, val text: String, val kind: String)

    private val boundaries = mutableListOf<Boundary>()
    private val transcriptEvents = mutableListOf<TranscriptEvent>()
    private val canonicalText = mutableMapOf<Int, String>()
    private val latestDraftByTurn = mutableMapOf<Int, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
        } else {
            configureRecognizer()
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
            configureRecognizer()
        } else {
            status.text = "Permission micro refusée — POC bloqué."
        }
    }

    private fun configureRecognizer() {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            status.text = "HOLD: reconnaissance on-device Android indisponible. Tester le fallback embarqué."
            return
        }
        speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this).also {
            it.setRecognitionListener(this)
        }
        val supportIntent = baseRecognizerIntent(includeAudioSource = false)
        speechRecognizer?.checkRecognitionSupport(
            supportIntent,
            mainExecutor,
            object : RecognitionSupportCallback {
                override fun onSupportResult(recognitionSupport: RecognitionSupport) {
                    val installed = recognitionSupport.installedOnDeviceLanguages
                    status.text = "Recognizer on-device disponible. Langues locales installées: ${installed.joinToString()}"
                }
                override fun onError(error: Int) {
                    status.text = "Recognizer on-device disponible; support détaillé non vérifiable (code $error)."
                }
            }
        )
    }

    private fun baseRecognizerIntent(includeAudioSource: Boolean): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.FRANCE.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            if (Build.VERSION.SDK_INT >= 34) {
                putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_TIMING, true)
                putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_CONFIDENCE, true)
            }
            if (includeAudioSource) {
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipeRead)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, SAMPLE_RATE)
                putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
            }
        }

    private fun startSession() {
        if (speechRecognizer == null) {
            status.text = "Recognizer non prêt."
            return
        }
        if (!recording.compareAndSet(false, true)) return

        sessionStartMs = SystemClock.elapsedRealtime()
        currentTurn = 0
        boundaries.clear()
        transcriptEvents.clear()
        canonicalText.clear()
        latestDraftByTurn.clear()
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
        val pipe = ParcelFileDescriptor.createPipe()
        pipeRead = pipe[0]
        pipeWrite = pipe[1]

        try {
            speechRecognizer?.startListening(baseRecognizerIntent(includeAudioSource = true))
            recognizerStarted = true
        } catch (e: Exception) {
            status.text = "FAIL: démarrage SpeechRecognizer: ${e.message}"
            cleanupCaptureOnly()
            return
        }

        audioRecord?.startRecording()
        captureThread = Thread { captureLoop() }.also { it.start() }

        question.text = questions[0]
        liveTranscript.text = "Écoute…"
        startButton.isEnabled = false
        nextButton.isEnabled = true
        lockButton.isEnabled = true
        stopButton.isEnabled = true
        status.text = "RUNNING — AudioRecord possède le micro; le même PCM alimente WAV + SpeechRecognizer."
    }

    private fun captureLoop() {
        val buffer = ByteArray(3200)
        val pipeOut = try { FileOutputStream(pipeWrite?.fileDescriptor) } catch (_: Exception) { null }
        var pipeAlive = pipeOut != null
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
            if (pipeAlive) {
                try {
                    pipeOut?.write(buffer, 0, n)
                    pipeOut?.flush()
                } catch (_: IOException) {
                    pipeAlive = false
                    runOnUiThread {
                        status.text = "STT pipe fermé par le provider; master WAV continue."
                    }
                }
            }
        }
        try { pipeOut?.close() } catch (_: Exception) {}
    }

    private fun nextTurn() {
        if (!recording.get() || currentTurn >= questions.lastIndex) return
        currentTurn += 1
        boundaries += Boundary(currentTurn, elapsedMs())
        question.text = questions[currentTurn]
        liveTranscript.text = latestDraftByTurn[currentTurn] ?: "Écoute…"
        if (currentTurn == questions.lastIndex) nextButton.isEnabled = false
    }

    private fun lockCurrentDraft() {
        val draft = latestDraftByTurn[currentTurn].orEmpty().trim()
        if (draft.isEmpty()) {
            status.text = "Aucun brouillon STT à valider pour cette question."
            return
        }
        canonicalText[currentTurn] = draft
        status.text = "Texte humain validé pour T${currentTurn + 1}. Les résultats STT suivants restent brouillon et ne l’écrasent pas."
    }

    private fun stopSession() {
        if (!recording.compareAndSet(true, false)) return
        status.text = "Finalisation…"
        nextButton.isEnabled = false
        lockButton.isEnabled = false
        stopButton.isEnabled = false
        executor.execute {
            try { audioRecord?.stop() } catch (_: Exception) {}
            try { captureThread?.join(1500) } catch (_: Exception) {}
            try { pipeWrite?.close() } catch (_: Exception) {}
            runOnUiThread {
                if (recognizerStarted) {
                    try { speechRecognizer?.stopListening() } catch (_: Exception) {}
                }
            }
            finalizeWav()
            runOnUiThread {
                startButton.isEnabled = true
                renderExport()
                status.text = "STOPPED — WAV maître finalisé; vérifier export et qualité de transcription."
            }
        }
    }

    private fun cleanupCaptureOnly() {
        recording.set(false)
        try { audioRecord?.release() } catch (_: Exception) {}
        try { wavRaf?.close() } catch (_: Exception) {}
        try { pipeRead?.close() } catch (_: Exception) {}
        try { pipeWrite?.close() } catch (_: Exception) {}
    }

    private fun finalizeWav() {
        try {
            wavRaf?.let { raf ->
                raf.seek(0)
                raf.write(wavHeader(bytesWritten, SAMPLE_RATE, 1, 16))
                raf.close()
            }
        } catch (_: Exception) {}
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
        try { pipeRead?.close() } catch (_: Exception) {}
        try { pipeWrite?.close() } catch (_: Exception) {}
        pipeRead = null
        pipeWrite = null
        recognizerStarted = false
    }

    private fun elapsedMs(): Long = SystemClock.elapsedRealtime() - sessionStartMs

    private fun recordTranscript(text: String, kind: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        val at = elapsedMs()
        transcriptEvents += TranscriptEvent(at, clean, kind)
        val derivedTurn = turnForTimestamp(at)
        latestDraftByTurn[derivedTurn] = clean
        if (derivedTurn == currentTurn) liveTranscript.text = clean
    }

    private fun turnForTimestamp(atMs: Long): Int {
        return boundaries.lastOrNull { it.atMs <= atMs }?.turn ?: 0
    }

    private fun renderExport() {
        val events = JSONArray().apply {
            transcriptEvents.forEach { e ->
                put(JSONObject().apply {
                    put("atMs", e.atMs)
                    put("turnId", "T${turnForTimestamp(e.atMs) + 1}")
                    put("kind", e.kind)
                    put("text", e.text)
                })
            }
        }
        val turns = JSONArray().apply {
            questions.forEachIndexed { i, q ->
                put(JSONObject().apply {
                    put("turnId", "T${i + 1}")
                    put("question", q)
                    put("draft", latestDraftByTurn[i] ?: "")
                    put("canonical", canonicalText[i] ?: JSONObject.NULL)
                    put("canonicalSource", if (canonicalText.containsKey(i)) "human_lock" else "draft_stt")
                })
            }
        }
        val out = JSONObject().apply {
            put("schema", "offline-interview.android-native-stt-poc.v1")
            put("audioAuthority", "single_AudioRecord_PCM_to_WAV")
            put("sttProvider", "Android SpeechRecognizer on-device via EXTRA_AUDIO_SOURCE")
            put("wavPath", wavFile?.absolutePath ?: "")
            put("pcmBytes", bytesWritten)
            put("turnBoundaries", JSONArray().apply {
                boundaries.forEach { b -> put(JSONObject().put("turnId", "T${b.turn + 1}").put("atMs", b.atMs)) }
            })
            put("transcriptEvents", events)
            put("turns", turns)
        }
        exportView.text = out.toString(2)
    }

    override fun onReadyForSpeech(params: Bundle?) { status.text = "STT prêt — parle normalement." }
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onError(error: Int) {
        status.text = "STT error=$error — le master audio reste autoritaire et continue si la capture est active."
    }
    override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        recordTranscript(text, "final")
    }
    override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        recordTranscript(text, "partial")
    }
    override fun onEvent(eventType: Int, params: Bundle?) {}
    override fun onSegmentResults(segmentResults: Bundle) {
        val text = segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        recordTranscript(text, "segment")
    }
    override fun onEndOfSegmentedSession() {
        status.text = "STT session segmentée terminée."
    }

    override fun onDestroy() {
        recording.set(false)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { captureThread?.join(500) } catch (_: Exception) {}
        cleanupCaptureOnly()
        speechRecognizer?.destroy()
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val SAMPLE_RATE = 16000

        private fun wavHeader(dataBytes: Long, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
            val byteRate = sampleRate * channels * bitsPerSample / 8
            val blockAlign = channels * bitsPerSample / 8
            val totalLen = dataBytes + 36
            return ByteArray(44).also { h ->
                fun ascii(offset: Int, s: String) = s.toByteArray(Charsets.US_ASCII).copyInto(h, offset)
                fun le16(offset: Int, v: Int) {
                    h[offset] = (v and 0xff).toByte(); h[offset + 1] = ((v shr 8) and 0xff).toByte()
                }
                fun le32(offset: Int, v: Long) {
                    h[offset] = (v and 0xff).toByte(); h[offset + 1] = ((v shr 8) and 0xff).toByte()
                    h[offset + 2] = ((v shr 16) and 0xff).toByte(); h[offset + 3] = ((v shr 24) and 0xff).toByte()
                }
                ascii(0, "RIFF"); le32(4, totalLen); ascii(8, "WAVE"); ascii(12, "fmt ")
                le32(16, 16); le16(20, 1); le16(22, channels); le32(24, sampleRate.toLong())
                le32(28, byteRate.toLong()); le16(32, blockAlign); le16(34, bitsPerSample)
                ascii(36, "data"); le32(40, dataBytes)
            }
        }
    }
}
