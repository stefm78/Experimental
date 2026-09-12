package com.stefm78.offlineinterview.nativepoc

/**
 * Shared boundary between Offline Interview Product Stream and Speech Engine Stream.
 *
 * Product owns microphone/session/audio durability and human text authority. Providers are
 * replaceable consumers/producers across this boundary and must never become the authority for
 * whether product audio exists or for human-locked text.
 */
object SpeechEngineContract {
    const val VERSION = "offline-interview.speech-engine-contract.v1"

    enum class InputMode {
        /** Provider owns its microphone path. Draft-only unless separately qualified. */
        SYSTEM_MICROPHONE,

        /** Provider consumes PCM16 owned by the product and is eligible for replay qualification. */
        PCM16_PUSH
    }

    enum class TranscriptRole {
        /** Convenience text. Never overrides master audio or a human lock. */
        DRAFT,

        /** Replayable provider result produced from product-owned audio. */
        DURABLE_PROVIDER
    }

    enum class EventKind { PARTIAL, FINAL, ERROR }

    data class Capabilities(
        val inputMode: InputMode,
        val supportsStreaming: Boolean,
        val supportsOffline: Boolean,
        val supportsReplay: Boolean,
        val supportsWordTimings: Boolean,
        val requiresNetwork: Boolean
    )

    data class Descriptor(
        val providerId: String,
        val providerVersion: String,
        val language: String,
        val role: TranscriptRole,
        val capabilities: Capabilities
    )

    data class TurnContext(
        val interviewSessionId: String,
        val turnId: String,
        val questionId: String,
        val startedAtMs: Long,
        val sampleRateHz: Int = 16_000,
        val channelCount: Int = 1,
        val encoding: String = "PCM16_LE"
    )

    data class PcmChunk(
        val turnId: String,
        val sequence: Long,
        val audioAtMs: Long,
        val bytes: ByteArray
    )

    data class TranscriptEvent(
        val kind: EventKind,
        val turnId: String,
        val text: String,
        val providerId: String,
        val providerVersion: String,
        val emittedAtMs: Long,
        val confidence: Float? = null,
        val errorCode: String? = null
    )

    enum class PcmOfferResult { ACCEPTED, BACKPRESSURE_DROP, UNSUPPORTED }

    interface Listener {
        fun onTranscriptEvent(event: TranscriptEvent)
    }

    interface Provider {
        val descriptor: Descriptor

        fun startTurn(context: TurnContext, listener: Listener)

        /**
         * Product remains owner of the bytes. A SYSTEM_MICROPHONE provider returns UNSUPPORTED.
         * Implementations must not block the product's authoritative audio write path.
         */
        fun offerPcm(chunk: PcmChunk): PcmOfferResult = PcmOfferResult.UNSUPPORTED

        fun endTurn(turnId: String)
        fun cancelTurn(turnId: String)
        fun close()
    }
}
