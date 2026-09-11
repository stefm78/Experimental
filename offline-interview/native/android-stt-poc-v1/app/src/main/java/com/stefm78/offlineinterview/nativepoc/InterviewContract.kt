package com.stefm78.offlineinterview.nativepoc

import org.json.JSONArray
import org.json.JSONObject

internal data class NativeParticipant(
    val id: String,
    val name: String,
    val role: String
)

internal data class NativeQuestion(
    val id: String,
    val text: String,
    val sectionId: String,
    val sectionTitle: String,
    val label: String,
    val intent: String,
    val required: Boolean,
    val estimatedMinutes: Int?,
    val audience: List<String>
)

internal data class NativeInterviewSpec(
    val schema: String,
    val id: String,
    val version: String,
    val title: String,
    val context: String,
    val objective: String,
    val language: String,
    val estimatedDurationMinutes: Int?,
    val participants: List<NativeParticipant>,
    val questions: List<NativeQuestion>,
    val raw: JSONObject
) {
    val interviewee: NativeParticipant
        get() = participants.firstOrNull { it.role == "interviewee" }
            ?: participants.firstOrNull()
            ?: NativeParticipant("P2", "Interviewé", "interviewee")
}

internal object InterviewContract {
    const val SPEC_SCHEMA = "offline-interview.interview-spec.v1"
    const val RESULT_SCHEMA = "offline-interview.interview-result.v1"

    fun parse(text: String): NativeInterviewSpec {
        val raw = JSONObject(text)
        val schema = raw.optString("schema")
        require(schema == SPEC_SCHEMA) {
            "Schema interview non supporté: '$schema' (attendu: '$SPEC_SCHEMA')."
        }

        val participants = mutableListOf<NativeParticipant>()
        raw.optJSONArray("participants")?.let { array ->
            for (i in 0 until array.length()) {
                val p = array.optJSONObject(i) ?: continue
                val id = p.optString("id").trim()
                if (id.isBlank()) continue
                participants += NativeParticipant(
                    id = id,
                    name = p.optString("name", id).ifBlank { id },
                    role = p.optString("role", "other").ifBlank { "other" }
                )
            }
        }

        val questions = mutableListOf<NativeQuestion>()
        val sections = raw.optJSONArray("sections")
            ?: throw IllegalArgumentException("Interview invalide: sections manquantes.")
        for (sIndex in 0 until sections.length()) {
            val section = sections.optJSONObject(sIndex) ?: continue
            val sectionId = section.optString("id", "S${sIndex + 1}").ifBlank { "S${sIndex + 1}" }
            val sectionTitle = section.optString("title", sectionId).ifBlank { sectionId }
            val sectionQuestions = section.optJSONArray("questions") ?: JSONArray()
            for (qIndex in 0 until sectionQuestions.length()) {
                val q = sectionQuestions.optJSONObject(qIndex) ?: continue
                val textValue = q.optString("text").trim()
                if (textValue.isBlank()) continue
                val questionId = q.optString("id", "Q${questions.size + 1}").ifBlank { "Q${questions.size + 1}" }
                val audience = mutableListOf<String>()
                q.optJSONArray("audience")?.let { audienceArray ->
                    for (aIndex in 0 until audienceArray.length()) {
                        audienceArray.optString(aIndex).trim().takeIf { it.isNotBlank() }?.let(audience::add)
                    }
                }
                questions += NativeQuestion(
                    id = questionId,
                    text = textValue,
                    sectionId = sectionId,
                    sectionTitle = sectionTitle,
                    label = q.optString("label", "").trim(),
                    intent = q.optString("intent", "").trim(),
                    required = q.optBoolean("required", false),
                    estimatedMinutes = if (q.has("estimatedMinutes") && !q.isNull("estimatedMinutes")) q.optInt("estimatedMinutes") else null,
                    audience = audience
                )
            }
        }

        require(questions.isNotEmpty()) { "Interview invalide: aucune question exploitable." }

        return NativeInterviewSpec(
            schema = schema,
            id = raw.optString("id", "native-interview").ifBlank { "native-interview" },
            version = raw.optString("version", "1.0").ifBlank { "1.0" },
            title = raw.optString("title", "Offline Interview").ifBlank { "Offline Interview" },
            context = raw.optString("context", ""),
            objective = raw.optString("objective", ""),
            language = raw.optString("language", "fr-FR").ifBlank { "fr-FR" },
            estimatedDurationMinutes = if (raw.has("estimatedDurationMinutes") && !raw.isNull("estimatedDurationMinutes")) raw.optInt("estimatedDurationMinutes") else null,
            participants = participants,
            questions = questions,
            raw = raw
        )
    }

    fun cloneJson(value: JSONObject): JSONObject = JSONObject(value.toString())
}
