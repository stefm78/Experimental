package com.stefm78.offlineinterview.nativepoc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecognitionSessionAccumulatorTest {
    @Test
    fun providerFinalCommitsNormally() {
        val a = RecognitionSessionAccumulator()
        a.startSession(1, 0)
        a.updatePartial("bonjour le monde")
        a.endWithFinal("bonjour le monde", 100)
        assertEquals("bonjour le monde", a.transcriptRaw)
        assertEquals("PROVIDER_FINAL", a.sessions.single().commitSource)
    }

    @Test
    fun recoverableErrorPreservesLastPartial() {
        val a = RecognitionSessionAccumulator()
        a.startSession(1, 0)
        a.updatePartial("un fragment visible ne doit pas disparaitre")
        a.endWithRecoverableError(7, "ERROR_NO_MATCH", 100)
        assertEquals("un fragment visible ne doit pas disparaitre", a.transcriptRaw)
        assertEquals("PARTIAL_BOUNDARY_FALLBACK", a.sessions.single().commitSource)
    }

    @Test
    fun overlapIsDeduplicatedAcrossSessions() {
        val a = RecognitionSessionAccumulator()
        a.startSession(1, 0)
        a.updatePartial("le rendez vous est fixé au 17 septembre")
        a.endWithRecoverableError(7, "ERROR_NO_MATCH", 100)
        a.startSession(2, 280)
        a.endWithFinal("17 septembre 2026 à 14 heures 35", 500)
        assertEquals("le rendez vous est fixé au 17 septembre 2026 à 14 heures 35", a.transcriptRaw)
        assertEquals(2, a.sessions.last().overlapTokensRemoved)
    }

    @Test
    fun moreThanEightProviderBoundariesRemainSupported() {
        val a = RecognitionSessionAccumulator()
        repeat(12) { index ->
            a.startSession(index + 1, index * 200L)
            a.updatePartial("fragment ${index + 1}")
            a.endWithRecoverableError(7, "ERROR_NO_MATCH", index * 200L + 100)
        }
        assertEquals(12, a.sessions.size)
        assertFalse(a.hasActiveSession)
        assertTrue(a.transcriptRaw.contains("fragment 12"))
    }

    @Test
    fun userFinishUsesProviderFinalWhenItArrives() {
        val a = RecognitionSessionAccumulator()
        a.startSession(1, 0)
        a.updatePartial("texte partiel")
        a.endWithFinal("texte final complet", 100, "USER_FINISH_PROVIDER_FINAL")
        assertEquals("texte final complet", a.transcriptRaw)
        assertEquals("PROVIDER_FINAL", a.sessions.single().commitSource)
    }

    @Test
    fun userFinishFallsBackToLastPartialWhenNoFinalArrives() {
        val a = RecognitionSessionAccumulator()
        a.startSession(1, 0)
        a.updatePartial("dernier texte partiel visible")
        a.endUserFinishFallback(900)
        assertEquals("dernier texte partiel visible", a.transcriptRaw)
        assertEquals("USER_FINISH_PARTIAL_FALLBACK", a.sessions.single().commitSource)
    }
}
