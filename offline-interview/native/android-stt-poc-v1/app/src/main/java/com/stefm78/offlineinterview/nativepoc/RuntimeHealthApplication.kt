package com.stefm78.offlineinterview.nativepoc

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class RuntimeHealthApplication : Application() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val watchdogExecutor = Executors.newSingleThreadExecutor()
    private val lastMainPulseMs = AtomicLong(0L)
    private var previousExitSummary: String? = null
    private var previousDefaultHandler: Thread.UncaughtExceptionHandler? = null

    override fun onCreate() {
        super.onCreate()
        recordPreviousProcessExit()
        installCrashRecorder()
        installUiWatchdog()
        installDiagnosticNotice()
    }

    private fun healthDir(): File = File(filesDir, "runtime-health").apply { mkdirs() }

    private fun installCrashRecorder() {
        previousDefaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val payload = JSONObject().apply {
                    put("schema", "offline-interview.android-runtime-crash.v1")
                    put("at", Instant.now().toString())
                    put("thread", thread.name)
                    put("exception", throwable.javaClass.name)
                    put("message", throwable.message ?: JSONObject.NULL)
                    put("stack", JSONArray(throwable.stackTrace.map { it.toString() }))
                }
                File(healthDir(), "last-uncaught-crash.json").writeText(payload.toString(2))
            } catch (_: Exception) {
            } finally {
                previousDefaultHandler?.uncaughtException(thread, throwable)
            }
        }
    }

    private fun installUiWatchdog() {
        lastMainPulseMs.set(SystemClock.elapsedRealtime())
        val pulse = object : Runnable {
            override fun run() {
                lastMainPulseMs.set(SystemClock.elapsedRealtime())
                mainHandler.postDelayed(this, MAIN_PULSE_INTERVAL_MS)
            }
        }
        mainHandler.post(pulse)

        watchdogExecutor.execute {
            var stallAlreadyRecorded = false
            while (!Thread.currentThread().isInterrupted) {
                try {
                    Thread.sleep(WATCHDOG_SAMPLE_MS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
                val lagMs = SystemClock.elapsedRealtime() - lastMainPulseMs.get()
                if (lagMs >= UI_STALL_THRESHOLD_MS) {
                    if (!stallAlreadyRecorded) {
                        recordUiStall(lagMs)
                        stallAlreadyRecorded = true
                    }
                } else {
                    stallAlreadyRecorded = false
                }
            }
        }
    }

    private fun recordUiStall(lagMs: Long) {
        try {
            val mainThread = Looper.getMainLooper().thread
            val payload = JSONObject().apply {
                put("schema", "offline-interview.android-ui-stall.v1")
                put("at", Instant.now().toString())
                put("detectedLagMs", lagMs)
                put("thresholdMs", UI_STALL_THRESHOLD_MS)
                put("mainThreadState", mainThread.state.name)
                put("mainThreadStack", JSONArray(mainThread.stackTrace.map { it.toString() }))
            }
            File(healthDir(), "last-ui-stall.json").writeText(payload.toString(2))
        } catch (_: Exception) {
        }
    }

    private fun recordPreviousProcessExit() {
        try {
            val manager = getSystemService(ActivityManager::class.java) ?: return
            val exits = manager.getHistoricalProcessExitReasons(packageName, 0, 3)
            val latest = exits.firstOrNull() ?: return
            val payload = JSONObject().apply {
                put("schema", "offline-interview.android-process-exit.v1")
                put("observedAt", Instant.now().toString())
                put("timestamp", latest.timestamp)
                put("reason", reasonName(latest.reason))
                put("reasonCode", latest.reason)
                put("description", latest.description ?: JSONObject.NULL)
                put("importance", latest.importance)
                put("pssKb", latest.pss)
                put("rssKb", latest.rss)
            }
            File(healthDir(), "previous-process-exit.json").writeText(payload.toString(2))
            if (latest.reason == ActivityManager.ApplicationExitInfo.REASON_ANR ||
                latest.reason == ActivityManager.ApplicationExitInfo.REASON_CRASH ||
                latest.reason == ActivityManager.ApplicationExitInfo.REASON_CRASH_NATIVE ||
                latest.reason == ActivityManager.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE ||
                latest.reason == ActivityManager.ApplicationExitInfo.REASON_LOW_MEMORY
            ) {
                previousExitSummary = "Dernier arrêt Android: ${reasonName(latest.reason)}"
            }
        } catch (_: Exception) {
        }
    }

    private fun installDiagnosticNotice() {
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            private var shown = false

            override fun onActivityResumed(activity: Activity) {
                val summary = previousExitSummary ?: return
                if (shown) return
                shown = true
                Toast.makeText(activity, "$summary — diagnostic local enregistré", Toast.LENGTH_LONG).show()
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    private fun reasonName(reason: Int): String = when (reason) {
        ActivityManager.ApplicationExitInfo.REASON_ANR -> "ANR"
        ActivityManager.ApplicationExitInfo.REASON_CRASH -> "CRASH"
        ActivityManager.ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
        ActivityManager.ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
        ActivityManager.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
        ActivityManager.ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
        ActivityManager.ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
        ActivityManager.ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
        ActivityManager.ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
        ActivityManager.ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
        ActivityManager.ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
        ActivityManager.ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
        else -> "OTHER"
    }

    override fun onTerminate() {
        watchdogExecutor.shutdownNow()
        super.onTerminate()
    }

    companion object {
        private const val MAIN_PULSE_INTERVAL_MS = 1_000L
        private const val WATCHDOG_SAMPLE_MS = 1_000L
        private const val UI_STALL_THRESHOLD_MS = 5_000L
    }
}
