package com.stefm78.offlineinterview.nativepoc

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.concurrent.Executors

class DiagnosticExportActivity : Activity() {
    private lateinit var status: TextView
    private val executor = Executors.newSingleThreadExecutor()
    private var pendingPayload: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        val title = TextView(this).apply {
            text = "Offline Interview — diagnostic"
            textSize = 22f
        }
        val explanation = TextView(this).apply {
            text = "Exporte un seul fichier JSON avec les diagnostics runtime utiles. Aucun WAV, questionnaire, transcript ou secret n'est inclus."
            setPadding(0, 20, 0, 20)
        }
        status = TextView(this).apply {
            text = diagnosticAvailabilitySummary()
            setPadding(0, 0, 0, 20)
        }
        val exportButton = Button(this).apply {
            text = "Exporter le diagnostic JSON"
            setOnClickListener { prepareDiagnosticExport() }
        }
        root.addView(title)
        root.addView(explanation)
        root.addView(status)
        root.addView(exportButton)
        setContentView(root)
    }

    private fun healthDir(): File = File(filesDir, "runtime-health")

    private fun diagnosticAvailabilitySummary(): String {
        val available = DIAGNOSTIC_FILES.count { File(healthDir(), it).isFile }
        return if (available == 0) {
            "Aucun incident runtime enregistré pour le moment. L'export reste possible et contiendra l'identité du build/appareil."
        } else {
            "$available diagnostic(s) runtime disponible(s)."
        }
    }

    private fun prepareDiagnosticExport() {
        executor.execute {
            val payload = buildDiagnosticBundle().toString(2)
            pendingPayload = payload
            runOnUiThread {
                val stamp = Instant.now().toString().replace(Regex("[:.]"), "-")
                startActivityForResult(
                    Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "application/json"
                        putExtra(Intent.EXTRA_TITLE, "offline-interview-diagnostic-$stamp.json")
                    },
                    REQ_SAVE_DIAGNOSTIC
                )
            }
        }
    }

    private fun buildDiagnosticBundle(): JSONObject {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val diagnostics = JSONObject()
        DIAGNOSTIC_FILES.forEach { name ->
            val file = File(healthDir(), name)
            if (file.isFile) {
                diagnostics.put(name.removeSuffix(".json"), readDiagnostic(file))
            }
        }

        return JSONObject().apply {
            put("schema", "offline-interview.android-diagnostic-bundle.v1")
            put("exportedAt", Instant.now().toString())
            put("privacy", "No WAV, interview specification, transcript, result payload, signing material or secret is included.")
            put("app", JSONObject().apply {
                put("packageName", packageName)
                put("versionName", packageInfo.versionName ?: BuildConfig.VERSION_NAME)
                put("versionCode", packageInfo.longVersionCode)
                put("build", "android-native-${BuildConfig.VERSION_NAME}")
            })
            put("device", JSONObject().apply {
                put("manufacturer", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("sdkInt", Build.VERSION.SDK_INT)
                put("release", Build.VERSION.RELEASE)
            })
            put("diagnostics", diagnostics)
            put("diagnosticCount", diagnostics.length())
        }
    }

    private fun readDiagnostic(file: File): Any = try {
        JSONObject(file.readText())
    } catch (_: Exception) {
        JSONObject().apply {
            put("schema", "offline-interview.android-diagnostic-unparsed.v1")
            put("file", file.name)
            put("readable", false)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SAVE_DIAGNOSTIC || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        val payload = pendingPayload ?: return
        executor.execute {
            val message = try {
                contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(payload) }
                    ?: error("Impossible d'ouvrir la destination")
                "Diagnostic JSON enregistré."
            } catch (e: Exception) {
                "Échec export diagnostic: ${e.message}"
            }
            runOnUiThread { status.text = message }
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val REQ_SAVE_DIAGNOSTIC = 61
        private val DIAGNOSTIC_FILES = listOf(
            "last-ui-stall.json",
            "last-uncaught-crash.json",
            "previous-process-exit.json"
        )
    }
}
