package com.stefm78.offlineinterview.host

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sole physical microphone owner for the Android host.
 * Product semantics remain in the Web app; this class only owns AudioRecord -> PCM16 -> WAV.
 */
class NativeAudioCapture(
    private val context: Context,
    private val onPcm: (ByteArray) -> Unit,
    private val emit: (JSONObject) -> Unit
) {
    companion object {
        const val CAPTURE_ID = "ANDROID_AUDIORECORD_WAV_V1"
        const val SAMPLE_RATE = 16000
        private const val CHANNELS = 1
        private const val BITS_PER_SAMPLE = 16
    }

    data class Scope(val sessionId: String, val captureId: String)

    val recordingsDir: File = File(context.filesDir, "recordings").apply { mkdirs() }

    private val running = AtomicBoolean(false)
    private val finalizer = Executors.newSingleThreadExecutor()
    @Volatile private var scope: Scope? = null
    @Volatile private var audioRecord: AudioRecord? = null
    @Volatile private var captureThread: Thread? = null
    @Volatile private var wavFile: File? = null
    @Volatile private var wav: RandomAccessFile? = null
    @Volatile private var bytesWritten = 0L

    fun capabilities(requestId: String? = null): JSONObject = JSONObject().apply {
        put("type", "AUDIO_CAPTURE_CAPABILITIES")
        if (!requestId.isNullOrBlank()) put("requestId", requestId)
        put("captureId", CAPTURE_ID)
        put("available", true)
        put("sampleRate", SAMPLE_RATE)
        put("channels", CHANNELS)
        put("bitsPerSample", BITS_PER_SAMPLE)
        put("mimeType", "audio/wav")
        put("physicalMicrophoneAuthority", "ANDROID_AUDIORECORD")
    }

    @Synchronized
    fun start(sessionId: String, captureId: String, requestId: String? = null): JSONObject {
        if (sessionId.isBlank() || captureId.isBlank()) {
            return error("INVALID_SCOPE", "START_AUDIO_CAPTURE requires sessionId and captureId", sessionId, captureId, requestId)
        }
        if (running.get()) {
            return error("CAPTURE_BUSY", "A native audio capture is already active", sessionId, captureId, requestId)
        }

        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuffer <= 0) {
            return error("AUDIORECORD_BUFFER_UNAVAILABLE", "AudioRecord minimum buffer is unavailable", sessionId, captureId, requestId)
        }

        val record = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, SAMPLE_RATE)
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            return error("AUDIORECORD_NOT_INITIALIZED", "AudioRecord could not initialize", sessionId, captureId, requestId)
        }

        val file = fileForCapture(captureId)
        file.parentFile?.mkdirs()
        val raf = RandomAccessFile(file, "rw").apply {
            setLength(0)
            write(ByteArray(44))
        }

        return try {
            scope = Scope(sessionId, captureId)
            audioRecord = record
            wavFile = file
            wav = raf
            bytesWritten = 0L
            running.set(true)
            record.startRecording()
            captureThread = Thread({ captureLoop(record, raf) }, "offline-interview-native-audio").also { it.start() }
            JSONObject().apply {
                put("type", "AUDIO_CAPTURE_STARTED")
                if (!requestId.isNullOrBlank()) put("requestId", requestId)
                put("sessionId", sessionId)
                put("captureId", captureId)
                put("captureProviderId", CAPTURE_ID)
                put("sampleRate", SAMPLE_RATE)
                put("mimeType", "audio/wav")
            }
        } catch (error: Exception) {
            running.set(false)
            try { record.release() } catch (_: Exception) {}
            try { raf.close() } catch (_: Exception) {}
            scope = null
            audioRecord = null
            wav = null
            wavFile = null
            error("AUDIORECORD_START_FAILED", error.message ?: error.javaClass.simpleName, sessionId, captureId, requestId)
        }
    }

    private fun captureLoop(record: AudioRecord, raf: RandomAccessFile) {
        val buffer = ByteArray(3200)
        try {
            while (running.get()) {
                val n = try { record.read(buffer, 0, buffer.size) } catch (_: Exception) { -1 }
                if (n <= 0) continue
                raf.write(buffer, 0, n)
                bytesWritten += n
                onPcm(buffer.copyOf(n))
            }
        } catch (error: Exception) {
            scope?.let { active ->
                emit(error("AUDIO_CAPTURE_LOOP_FAILED", error.message ?: error.javaClass.simpleName, active.sessionId, active.captureId, null))
            }
        }
    }

    @Synchronized
    fun stop(sessionId: String, captureId: String) {
        val active = scope
        if (active == null || active.sessionId != sessionId || active.captureId != captureId) {
            emit(error("SCOPE_MISMATCH", "STOP_AUDIO_CAPTURE does not match active capture", sessionId, captureId, null))
            return
        }
        if (!running.compareAndSet(true, false)) return
        try { audioRecord?.stop() } catch (_: Exception) {}
        finalizer.execute { finalizeCapture(active) }
    }

    @Synchronized
    fun cancel(sessionId: String, captureId: String) {
        val active = scope ?: return
        if (active.sessionId != sessionId || active.captureId != captureId) return
        running.set(false)
        try { audioRecord?.stop() } catch (_: Exception) {}
        finalizer.execute {
            closeCapture(deleteFile = true)
            scope = null
        }
    }

    private fun finalizeCapture(active: Scope) {
        try { captureThread?.join(1200) } catch (_: Exception) {}
        val file = wavFile
        val bytes = bytesWritten
        try {
            wav?.let { raf ->
                raf.seek(0)
                raf.write(wavHeader(bytes))
                raf.fd.sync()
            }
        } catch (error: Exception) {
            emit(error("WAV_FINALIZE_FAILED", error.message ?: error.javaClass.simpleName, active.sessionId, active.captureId, null))
        }
        closeCapture(deleteFile = false)
        scope = null

        if (file == null || !file.exists() || file.length() <= 44L || bytes <= 0L) {
            emit(error("WAV_EMPTY", "Native WAV is empty", active.sessionId, active.captureId, null))
            return
        }
        val durationMs = bytes * 1000L / (SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8))
        emit(JSONObject().apply {
            put("type", "AUDIO_CAPTURE_FINALIZED")
            put("sessionId", active.sessionId)
            put("captureId", active.captureId)
            put("captureProviderId", CAPTURE_ID)
            put("pcmBytes", bytes)
            put("fileBytes", file.length())
            put("durationMs", durationMs)
            put("mimeType", "audio/wav")
            put("sampleRate", SAMPLE_RATE)
            put("audioUrl", "https://appassets.androidplatform.net/recordings/${active.captureId}.wav")
        })
    }

    private fun closeCapture(deleteFile: Boolean) {
        try { wav?.close() } catch (_: Exception) {}
        wav = null
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
        captureThread = null
        if (deleteFile) try { wavFile?.delete() } catch (_: Exception) {}
        wavFile = null
        bytesWritten = 0L
    }

    fun fileForCapture(captureId: String): File {
        val safe = captureId.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(recordingsDir, "$safe.wav")
    }

    fun destroy() {
        val active = scope
        if (active != null) cancel(active.sessionId, active.captureId)
        finalizer.shutdownNow()
    }

    private fun error(code: String, message: String, sessionId: String?, captureId: String?, requestId: String?): JSONObject =
        JSONObject().apply {
            put("type", "AUDIO_CAPTURE_ERROR")
            if (!requestId.isNullOrBlank()) put("requestId", requestId)
            put("code", code)
            put("message", message)
            if (!sessionId.isNullOrBlank()) put("sessionId", sessionId)
            if (!captureId.isNullOrBlank()) put("captureId", captureId)
        }

    private fun wavHeader(pcmBytes: Long): ByteArray {
        val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
        val blockAlign = CHANNELS * BITS_PER_SAMPLE / 8
        return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt((36L + pcmBytes).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1.toShort())
            putShort(CHANNELS.toShort())
            putInt(SAMPLE_RATE)
            putInt(byteRate)
            putShort(blockAlign.toShort())
            putShort(BITS_PER_SAMPLE.toShort())
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(pcmBytes.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        }.array()
    }
}
