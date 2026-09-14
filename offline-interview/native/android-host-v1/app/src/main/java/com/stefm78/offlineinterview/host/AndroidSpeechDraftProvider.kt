package com.stefm78.offlineinterview.host

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileOutputStream
import java.util.ArrayDeque
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * LIVE_DRAFT_ONLY Android SpeechRecognizer provider using the authoritative NativeAudioCapture PCM.
 * The provider never opens the physical microphone itself.
 */
class AndroidSpeechDraftProvider(
    private val context: Context,
    private val emit: (JSONObject) -> Unit
) : RecognitionListener {
    companion object {
        const val PROVIDER_ID = "ANDROID_SYSTEM_DEFAULT_V3_DRAFT_PCM_BRIDGE"
        const val PROVIDER_MODE = "android-system-default-v3-draft-pcm"
        private const val COMPLETE_SILENCE_MS = 5000L
        private const val POSSIBLY_COMPLETE_SILENCE_MS = 3000L
        private const val REARM_DELAY_MS = 180L
        private const val BUSY_REARM_DELAY_MS = 400L
        private const val PRODUCT_STOP_GRACE_MS = 450L
        private const val ERROR_START_LISTENING = -2101
        private const val PCM_QUEUE_CHUNKS = 24
        private const val PCM_PREBUFFER_CHUNKS = 8
    }

    data class Scope(val sessionId: String, val turnId: String, val language: String)
    private data class Feed(
        val readFd: ParcelFileDescriptor,
        val sink: FileOutputStream,
        val queue: ArrayBlockingQueue<ByteArray> = ArrayBlockingQueue(PCM_QUEUE_CHUNKS),
        val running: AtomicBoolean = AtomicBoolean(true),
        var thread: Thread? = null
    )

    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var feed: Feed? = null
    private var scope: Scope? = null
    private var accumulator = RecognitionSessionAccumulator()
    private var recognizerSessionCount = 0
    private var recognizerSessionActive = false
    private var stopRequested = false
    private var restartRunnable: Runnable? = null
    private var finishRunnable: Runnable? = null
    private val pendingPcm = ArrayDeque<ByteArray>()
    private var droppedPcmChunks = 0

    fun capabilities(requestId: String? = null): JSONObject {
        val available = SpeechRecognizer.isRecognitionAvailable(context)
        val onDeviceAvailable = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        return JSONObject().apply {
            put("type", "CAPABILITIES")
            if (!requestId.isNullOrBlank()) put("requestId", requestId)
            put("providerId", PROVIDER_ID)
            put("providerMode", PROVIDER_MODE)
            put("role", "LIVE_DRAFT_ONLY")
            put("available", available)
            put("liveDraft", available)
            put("recordedAudioReplay", false)
            put("offline", JSONObject.NULL)
            put("onDeviceRecognitionAvailable", onDeviceAvailable)
            put("actualProviderPackageExposedByApi", false)
            put("productAudioAuthority", "ANDROID_AUDIORECORD")
            put("audioInput", "PCM16_PUSH_FROM_NATIVE_AUDIO_AUTHORITY")
        }
    }

    fun offerPcm(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val activeFeed = feed
        if (activeFeed != null && activeFeed.running.get()) {
            if (!activeFeed.queue.offer(bytes.copyOf())) {
                activeFeed.queue.poll()
                if (!activeFeed.queue.offer(bytes.copyOf())) droppedPcmChunks += 1
                else droppedPcmChunks += 1
            }
            return
        }
        if (scope != null && !stopRequested) {
            synchronized(pendingPcm) {
                while (pendingPcm.size >= PCM_PREBUFFER_CHUNKS) pendingPcm.removeFirst()
                pendingPcm.addLast(bytes.copyOf())
            }
        }
    }

    fun start(sessionId: String, turnId: String, language: String) {
        handler.post {
            if (sessionId.isBlank() || turnId.isBlank()) {
                emitUnscopedError("INVALID_SCOPE", "START_LIVE_DRAFT requires sessionId and turnId")
                return@post
            }
            cancelInternal(clearScope = true)
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                val rejected = Scope(sessionId, turnId, language)
                emitError(rejected, "PROVIDER_UNAVAILABLE", "Android SpeechRecognizer is unavailable", retryable = false)
                return@post
            }
            scope = Scope(sessionId, turnId, language.ifBlank { "fr-FR" })
            accumulator = RecognitionSessionAccumulator()
            recognizerSessionCount = 0
            droppedPcmChunks = 0
            stopRequested = false
            emitStatus("PENDING", "starting-pcm-provider")
            beginRecognizerSession(0L)
        }
    }

    fun stop(sessionId: String, turnId: String) {
        handler.post {
            val activeScope = scope
            if (activeScope == null || activeScope.sessionId != sessionId || activeScope.turnId != turnId) {
                emitUnscopedError("SCOPE_MISMATCH", "STOP_LIVE_DRAFT does not match the active Product scope", sessionId, turnId)
                return@post
            }
            stopRequested = true
            restartRunnable?.let(handler::removeCallbacks)
            restartRunnable = null
            closeFeed()
            if (recognizerSessionActive) {
                try { recognizer?.stopListening() } catch (_: Exception) {}
                finishRunnable = Runnable { finalizeProductStop() }.also {
                    handler.postDelayed(it, PRODUCT_STOP_GRACE_MS)
                }
            } else {
                finalizeProductStop()
            }
        }
    }

    fun cancel(sessionId: String, turnId: String) {
        handler.post {
            val activeScope = scope
            if (activeScope != null && activeScope.sessionId == sessionId && activeScope.turnId == turnId) {
                cancelInternal(clearScope = true)
            }
        }
    }

    fun destroy() {
        handler.post { cancelInternal(clearScope = true) }
    }

    private fun recognizerIntent(language: String, audioSource: ParcelFileDescriptor): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, COMPLETE_SILENCE_MS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, POSSIBLY_COMPLETE_SILENCE_MS)
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audioSource)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, NativeAudioCapture.SAMPLE_RATE)
        }

    private fun beginRecognizerSession(delayMs: Long) {
        if (stopRequested || scope == null || recognizerSessionActive) return
        val runnable = Runnable {
            val current = scope ?: return@Runnable
            if (stopRequested || recognizerSessionActive) return@Runnable
            try {
                closeFeed()
                try { recognizer?.destroy() } catch (_: Exception) {}
                recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { it.setRecognitionListener(this) }
                val pipe = ParcelFileDescriptor.createPipe()
                val nextFeed = Feed(readFd = pipe[0], sink = FileOutputStream(pipe[1].fileDescriptor))
                nextFeed.thread = Thread({ feederLoop(nextFeed) }, "offline-interview-stt-pcm").also { it.start() }
                feed = nextFeed
                synchronized(pendingPcm) {
                    while (pendingPcm.isNotEmpty()) nextFeed.queue.offer(pendingPcm.removeFirst())
                }
                recognizerSessionCount += 1
                recognizerSessionActive = true
                accumulator.startSession(recognizerSessionCount, SystemClock.elapsedRealtime())
                recognizer?.startListening(recognizerIntent(current.language, nextFeed.readFd))
                emitStatus("PENDING", if (delayMs > 0) "rearming-pcm" else "starting-pcm")
            } catch (error: Exception) {
                val now = SystemClock.elapsedRealtime()
                if (accumulator.hasActiveSession) {
                    accumulator.endWithFatalError(ERROR_START_LISTENING, "START_LISTENING_EXCEPTION_${error.javaClass.simpleName}", now)
                }
                recognizerSessionActive = false
                closeFeed()
                emitError(current, "START_LISTENING_EXCEPTION", error.message ?: error.javaClass.simpleName, retryable = false)
            }
        }
        restartRunnable = runnable
        handler.postDelayed(runnable, delayMs)
    }

    private fun feederLoop(activeFeed: Feed) {
        try {
            while (activeFeed.running.get()) {
                val chunk = try { activeFeed.queue.take() } catch (_: InterruptedException) { break }
                activeFeed.sink.write(chunk)
                activeFeed.sink.flush()
            }
        } catch (_: Exception) {
            // Provider pipe failure must never affect authoritative AudioRecord/WAV capture.
        } finally {
            try { activeFeed.sink.close() } catch (_: Exception) {}
        }
    }

    private fun closeFeed() {
        val activeFeed = feed ?: return
        feed = null
        activeFeed.running.set(false)
        try { activeFeed.sink.close() } catch (_: Exception) {}
        try { activeFeed.readFd.close() } catch (_: Exception) {}
        activeFeed.thread?.interrupt()
        activeFeed.queue.clear()
    }

    private fun scheduleRearm(error: Int? = null) {
        if (stopRequested || scope == null) return
        val delay = if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) BUSY_REARM_DELAY_MS else REARM_DELAY_MS
        beginRecognizerSession(delay)
    }

    private fun finalizeProductStop() {
        val activeScope = scope ?: return
        finishRunnable?.let(handler::removeCallbacks)
        finishRunnable = null
        closeFeed()
        if (accumulator.hasActiveSession) accumulator.endUserFinishFallback(SystemClock.elapsedRealtime())
        recognizerSessionActive = false
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        val text = accumulator.transcriptRaw.trim()
        if (text.isNotBlank()) {
            emit(baseEvent("TRANSCRIPT_FINAL", activeScope).apply {
                put("status", "DRAFT")
                put("text", text)
                put("providerFinal", true)
            })
        } else {
            emitError(activeScope, "NO_TEXT", "Android provider produced no transcript for this turn", retryable = true)
        }
        emit(baseEvent("PROVIDER_DIAGNOSTIC", activeScope).apply {
            put("recognizerSessionCount", recognizerSessionCount)
            put("committedTranscriptLength", text.length)
            put("providerRole", "LIVE_DRAFT_ONLY")
            put("audioInput", "PCM16_PUSH_FROM_NATIVE_AUDIO_AUTHORITY")
            put("droppedPcmChunks", droppedPcmChunks)
            put("sessions", JSONArray().apply {
                accumulator.sessions.forEach { record ->
                    put(JSONObject().apply {
                        put("sessionId", record.sessionId)
                        put("terminalReason", record.terminalReason)
                        put("commitSource", record.commitSource)
                        put("errorCode", record.errorCode ?: JSONObject.NULL)
                        put("errorName", record.errorName ?: JSONObject.NULL)
                    })
                }
            })
        })
        stopRequested = false
        scope = null
        synchronized(pendingPcm) { pendingPcm.clear() }
    }

    private fun cancelInternal(clearScope: Boolean) {
        restartRunnable?.let(handler::removeCallbacks)
        finishRunnable?.let(handler::removeCallbacks)
        restartRunnable = null
        finishRunnable = null
        stopRequested = false
        recognizerSessionActive = false
        closeFeed()
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        synchronized(pendingPcm) { pendingPcm.clear() }
        if (clearScope) scope = null
    }

    private fun emitPartial(text: String) {
        val activeScope = scope ?: return
        val clean = text.trim()
        if (clean.isBlank()) return
        emit(baseEvent("TRANSCRIPT_PARTIAL", activeScope).apply {
            put("status", "DRAFT")
            put("text", clean)
            put("providerFinal", false)
        })
    }

    private fun emitStatus(status: String, detail: String) {
        val activeScope = scope ?: return
        emit(baseEvent("TRANSCRIPTION_STATUS", activeScope).apply {
            put("status", status)
            put("detail", detail)
        })
    }

    private fun emitError(activeScope: Scope, code: String, message: String, retryable: Boolean) {
        emit(baseEvent("TRANSCRIPTION_ERROR", activeScope).apply {
            put("status", if (code == "PROVIDER_UNAVAILABLE") "UNAVAILABLE" else "FAILED")
            put("code", code)
            put("message", message)
            put("retryable", retryable)
        })
    }

    private fun emitUnscopedError(code: String, message: String, sessionId: String? = null, turnId: String? = null) {
        emit(JSONObject().apply {
            put("type", "TRANSCRIPTION_ERROR")
            put("providerId", PROVIDER_ID)
            put("providerMode", PROVIDER_MODE)
            if (sessionId != null) put("sessionId", sessionId)
            if (turnId != null) put("turnId", turnId)
            put("status", "FAILED")
            put("code", code)
            put("message", message)
            put("retryable", false)
        })
    }

    private fun baseEvent(type: String, activeScope: Scope): JSONObject = JSONObject().apply {
        put("type", type)
        put("sessionId", activeScope.sessionId)
        put("turnId", activeScope.turnId)
        put("providerId", PROVIDER_ID)
        put("providerMode", PROVIDER_MODE)
        put("language", activeScope.language)
    }

    private fun firstText(bundle: Bundle?): String =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()

    override fun onReadyForSpeech(params: Bundle?) { emitStatus("DRAFT", "listening-pcm") }
    override fun onBeginningOfSpeech() { emitStatus("DRAFT", "speech") }
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() { emitStatus("DRAFT", "provider-endpoint") }

    override fun onError(error: Int) {
        val activeScope = scope ?: return
        if (!recognizerSessionActive) return
        val now = SystemClock.elapsedRealtime()
        recognizerSessionActive = false
        closeFeed()
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        val name = errorName(error)
        val recoverable = error in setOf(
            SpeechRecognizer.ERROR_CLIENT,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED
        )
        if (recoverable) {
            if (accumulator.hasActiveSession) accumulator.endWithRecoverableError(error, name, now)
            emitPartial(accumulator.transcriptRaw)
            if (stopRequested) finalizeProductStop() else scheduleRearm(error)
        } else {
            if (accumulator.hasActiveSession) accumulator.endWithFatalError(error, name, now)
            emitPartial(accumulator.transcriptRaw)
            emitError(activeScope, name, "Android SpeechRecognizer error $error", retryable = false)
        }
    }

    override fun onResults(results: Bundle?) {
        if (scope == null || !recognizerSessionActive) return
        val now = SystemClock.elapsedRealtime()
        val text = firstText(results)
        if (accumulator.hasActiveSession) accumulator.endWithFinal(text, now)
        recognizerSessionActive = false
        closeFeed()
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        emitPartial(accumulator.transcriptRaw)
        if (stopRequested) finalizeProductStop() else scheduleRearm()
    }

    override fun onPartialResults(partialResults: Bundle?) {
        if (scope == null || !recognizerSessionActive) return
        val text = firstText(partialResults)
        accumulator.updatePartial(text)
        emitPartial(accumulator.displayTranscript())
    }

    override fun onSegmentResults(segmentResults: Bundle) {
        if (scope == null || !recognizerSessionActive) return
        accumulator.addSegment(firstText(segmentResults))
        emitPartial(accumulator.displayTranscript())
    }

    override fun onEndOfSegmentedSession() {
        if (scope == null || !recognizerSessionActive) return
        if (accumulator.hasActiveSession) accumulator.endSegmentedSession(SystemClock.elapsedRealtime())
        recognizerSessionActive = false
        closeFeed()
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        emitPartial(accumulator.transcriptRaw)
        if (stopRequested) finalizeProductStop() else scheduleRearm()
    }

    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    private fun errorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "ERROR_AUDIO"
        SpeechRecognizer.ERROR_CLIENT -> "ERROR_CLIENT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "ERROR_INSUFFICIENT_PERMISSIONS"
        SpeechRecognizer.ERROR_NETWORK -> "ERROR_NETWORK"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "ERROR_NETWORK_TIMEOUT"
        SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "ERROR_RECOGNIZER_BUSY"
        SpeechRecognizer.ERROR_SERVER -> "ERROR_SERVER"
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "ERROR_SERVER_DISCONNECTED"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "ERROR_TOO_MANY_REQUESTS"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "ERROR_LANGUAGE_NOT_SUPPORTED"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "ERROR_LANGUAGE_UNAVAILABLE"
        else -> "ERROR_$error"
    }
}
