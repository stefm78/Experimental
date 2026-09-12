package com.stefm78.offlineinterview.nativepoc

import java.text.Normalizer
import java.util.Locale

/**
 * Passage-level transcript authority independent from SpeechRecognizer session lifetime.
 * Every provider terminal boundary becomes auditable and no non-empty partial is discarded
 * solely because the provider ended or errored a recoverable sub-session.
 */
class RecognitionSessionAccumulator(
    private val maxOverlapTokens: Int = 32
) {
    enum class CommitSource {
        PROVIDER_FINAL,
        PROVIDER_SEGMENT,
        PARTIAL_BOUNDARY_FALLBACK,
        USER_FINISH_PARTIAL_FALLBACK,
        NONE
    }

    data class SessionRecord(
        val sessionId: Int,
        val startedAtMs: Long,
        val endedAtMs: Long,
        val terminalReason: String,
        val finalText: String,
        val lastPartialText: String,
        val segmentResults: List<String>,
        val committedCandidate: String,
        val committedText: String,
        val commitSource: String,
        val overlapTokensRemoved: Int,
        val committedTokenCount: Int,
        val errorCode: Int?,
        val errorName: String?
    )

    data class MergeDecision(
        val candidate: String,
        val committedText: String,
        val overlapTokensRemoved: Int,
        val committedTokenCount: Int
    )

    private data class MutableSession(
        val sessionId: Int,
        val startedAtMs: Long,
        var latestPartial: String = "",
        var providerFinal: String = "",
        val segments: MutableList<String> = mutableListOf(),
        val committedCandidates: MutableList<String> = mutableListOf(),
        val committedTexts: MutableList<String> = mutableListOf(),
        val commitSources: MutableList<CommitSource> = mutableListOf(),
        var overlapTokensRemoved: Int = 0,
        var committedTokenCount: Int = 0
    )

    private data class WordToken(val normalized: String, val endExclusive: Int)

    private val completedSessions = mutableListOf<SessionRecord>()
    private var active: MutableSession? = null

    var transcriptRaw: String = ""
        private set

    val sessions: List<SessionRecord> get() = completedSessions.toList()
    val hasActiveSession: Boolean get() = active != null
    val currentPartial: String get() = active?.latestPartial.orEmpty()

    fun startSession(sessionId: Int, startedAtMs: Long) {
        check(active == null) { "A recognition session is already active" }
        active = MutableSession(sessionId = sessionId, startedAtMs = startedAtMs)
    }

    fun updatePartial(raw: String) {
        active?.latestPartial = raw.trim()
    }

    fun addSegment(raw: String): MergeDecision? {
        val session = active ?: return null
        val text = raw.trim()
        if (text.isBlank()) return null
        session.segments += text
        return commit(session, text, CommitSource.PROVIDER_SEGMENT)
    }

    fun endWithFinal(raw: String, endedAtMs: Long, terminalReason: String = "PROVIDER_FINAL"): SessionRecord? {
        val session = active ?: return null
        val text = raw.trim()
        session.providerFinal = text
        if (text.isNotBlank()) commit(session, text, CommitSource.PROVIDER_FINAL)
        return closeSession(session, endedAtMs, terminalReason, null, null)
    }

    fun endSegmentedSession(endedAtMs: Long): SessionRecord? {
        val session = active ?: return null
        if (session.committedCandidates.isEmpty() && session.latestPartial.isNotBlank()) {
            commit(session, session.latestPartial, CommitSource.PARTIAL_BOUNDARY_FALLBACK)
        }
        return closeSession(session, endedAtMs, "SEGMENTED_SESSION_END", null, null)
    }

    fun endWithRecoverableError(errorCode: Int, errorName: String, endedAtMs: Long): SessionRecord? {
        val session = active ?: return null
        if (session.latestPartial.isNotBlank()) {
            commit(session, session.latestPartial, CommitSource.PARTIAL_BOUNDARY_FALLBACK)
        }
        return closeSession(session, endedAtMs, "RECOVERABLE_ERROR", errorCode, errorName)
    }

    fun endWithFatalError(errorCode: Int, errorName: String, endedAtMs: Long): SessionRecord? {
        val session = active ?: return null
        if (session.latestPartial.isNotBlank()) {
            commit(session, session.latestPartial, CommitSource.PARTIAL_BOUNDARY_FALLBACK)
        }
        return closeSession(session, endedAtMs, "FATAL_ERROR", errorCode, errorName)
    }

    fun endUserFinishFallback(endedAtMs: Long): SessionRecord? {
        val session = active ?: return null
        if (session.latestPartial.isNotBlank()) {
            commit(session, session.latestPartial, CommitSource.USER_FINISH_PARTIAL_FALLBACK)
        }
        return closeSession(session, endedAtMs, "USER_FINISH_GRACE_TIMEOUT", null, null)
    }

    fun displayTranscript(): String {
        val partial = currentPartial.trim()
        return listOf(transcriptRaw.trim(), partial)
            .filter { it.isNotBlank() }
            .joinToString(" ")
    }

    private fun commit(session: MutableSession, candidate: String, source: CommitSource): MergeDecision {
        val decision = mergeCandidate(candidate)
        session.committedCandidates += candidate
        if (decision.committedText.isNotBlank()) session.committedTexts += decision.committedText
        session.commitSources += source
        session.overlapTokensRemoved += decision.overlapTokensRemoved
        session.committedTokenCount += decision.committedTokenCount
        return decision
    }

    private fun mergeCandidate(rawCandidate: String): MergeDecision {
        val candidate = rawCandidate.trim()
        if (candidate.isBlank()) return MergeDecision(candidate, "", 0, 0)
        if (transcriptRaw.isBlank()) {
            transcriptRaw = candidate
            return MergeDecision(candidate, candidate, 0, normalizedWords(candidate).size)
        }

        val existingTokens = tokenized(transcriptRaw)
        val candidateTokens = tokenized(candidate)
        if (candidateTokens.isEmpty()) return MergeDecision(candidate, "", 0, 0)
        val existingNorm = existingTokens.map { it.normalized }
        val candidateNorm = candidateTokens.map { it.normalized }

        if (containsContiguous(existingNorm, candidateNorm)) {
            return MergeDecision(candidate, "", candidateNorm.size, 0)
        }

        val maxOverlap = minOf(maxOverlapTokens, existingNorm.size, candidateNorm.size)
        var overlap = 0
        for (k in maxOverlap downTo 1) {
            if (existingNorm.takeLast(k) == candidateNorm.take(k)) {
                overlap = k
                break
            }
        }

        val appendRaw = if (overlap == 0) {
            candidate
        } else {
            val consumedEnd = candidateTokens[overlap - 1].endExclusive
            candidate.substring(consumedEnd).trimStart { it.isWhitespace() || it in ",.;:!?-–—" }
        }

        if (appendRaw.isNotBlank()) transcriptRaw = "${transcriptRaw.trim()} ${appendRaw.trim()}".trim()
        return MergeDecision(
            candidate = candidate,
            committedText = appendRaw,
            overlapTokensRemoved = overlap,
            committedTokenCount = normalizedWords(appendRaw).size
        )
    }

    private fun closeSession(
        session: MutableSession,
        endedAtMs: Long,
        terminalReason: String,
        errorCode: Int?,
        errorName: String?
    ): SessionRecord {
        check(active === session) { "Closing a non-active recognition session" }
        val sources = session.commitSources.distinct()
        val source = when {
            sources.isEmpty() -> CommitSource.NONE.name
            sources.size == 1 -> sources.single().name
            else -> "MIXED"
        }
        val record = SessionRecord(
            sessionId = session.sessionId,
            startedAtMs = session.startedAtMs,
            endedAtMs = endedAtMs,
            terminalReason = terminalReason,
            finalText = session.providerFinal,
            lastPartialText = session.latestPartial,
            segmentResults = session.segments.toList(),
            committedCandidate = session.committedCandidates.joinToString(" ").trim(),
            committedText = session.committedTexts.joinToString(" ").trim(),
            commitSource = source,
            overlapTokensRemoved = session.overlapTokensRemoved,
            committedTokenCount = session.committedTokenCount,
            errorCode = errorCode,
            errorName = errorName
        )
        completedSessions += record
        active = null
        return record
    }

    private fun containsContiguous(haystack: List<String>, needle: List<String>): Boolean {
        if (needle.isEmpty() || needle.size > haystack.size) return false
        for (start in 0..haystack.size - needle.size) {
            if (haystack.subList(start, start + needle.size) == needle) return true
        }
        return false
    }

    private fun tokenized(raw: String): List<WordToken> {
        val regex = Regex("[\\p{L}\\p{N}]+")
        return regex.findAll(raw).mapNotNull { match ->
            val normalized = normalizeToken(match.value)
            if (normalized.isBlank()) null else WordToken(normalized, match.range.last + 1)
        }.toList()
    }

    private fun normalizedWords(raw: String): List<String> = tokenized(raw).map { it.normalized }

    private fun normalizeToken(raw: String): String {
        val decomposed = Normalizer.normalize(raw.lowercase(Locale.FRANCE), Normalizer.Form.NFD)
        return decomposed.replace(Regex("\\p{M}+"), "")
            .replace(Regex("[^a-z0-9]+"), "")
    }
}
