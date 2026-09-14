package com.stefm78.offlineinterview.host

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

class AndroidHostActivity : Activity() {
    companion object {
        private const val REQ_MIC = 1801
        private const val TRUSTED_SCHEME = "https"
        private const val TRUSTED_HOST = "appassets.androidplatform.net"
        private const val TRUSTED_ORIGIN = "https://appassets.androidplatform.net"
        private const val START_URL = "$TRUSTED_ORIGIN/assets/web/index.html"
        private const val BRIDGE_NAME = "OfflineInterviewNative"
    }

    private lateinit var webView: WebView
    private lateinit var speechProvider: AndroidSpeechDraftProvider
    private lateinit var nativeAudioCapture: NativeAudioCapture
    private var activeReplyProxy: JavaScriptReplyProxy? = null
    private lateinit var webProvenance: JSONObject

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webProvenance = loadWebProvenance()
        speechProvider = AndroidSpeechDraftProvider(this) { event -> runOnUiThread { sendToWeb(event) } }
        nativeAudioCapture = NativeAudioCapture(
            context = this,
            onPcm = { pcm -> speechProvider.offerPcm(pcm) },
            emit = { event -> runOnUiThread { sendToWeb(event) } }
        )

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/recordings/", RecordingPathHandler(nativeAudioCapture.recordingsDir))
            .build()

        webView = WebView(this)
        setContentView(webView)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = false
            safeBrowsingEnabled = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return true
                if (!request.isForMainFrame) return false
                return !isTrustedProductUrl(url)
            }
        }

        // V0.9 invariant: the WebView is never a physical microphone owner. RECORD_AUDIO is
        // consumed only by NativeAudioCapture; any accidental Web getUserMedia request is denied.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.deny() }
            }
        }

        WebViewCompat.addWebMessageListener(
            webView,
            BRIDGE_NAME,
            setOf(TRUSTED_ORIGIN),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy
                ) {
                    if (!isMainFrame || !isTrustedOrigin(sourceOrigin)) return
                    activeReplyProxy = replyProxy
                    handleBridgeMessage(message.data, replyProxy)
                }
            }
        )

        if (!hasMicPermission()) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        webView.loadUrl(START_URL)
    }

    private fun handleBridgeMessage(raw: String?, replyProxy: JavaScriptReplyProxy) {
        val message = try { JSONObject(raw ?: "") } catch (error: Exception) {
            replyProxy.postMessage(errorEvent("INVALID_JSON", error.message ?: "Invalid bridge JSON").toString())
            return
        }

        val type = message.optString("type")
        val requestId = message.optString("requestId").takeIf { it.isNotBlank() }
        when (type) {
            "GET_AUDIO_CAPTURE_CAPABILITIES" -> {
                val response = nativeAudioCapture.capabilities(requestId)
                response.put("hostBuild", BuildConfig.VERSION_NAME)
                response.put("webBuildId", webProvenance.optString("webBuildId"))
                replyProxy.postMessage(response.toString())
            }

            "START_AUDIO_CAPTURE" -> {
                val sessionId = message.optString("sessionId")
                val captureId = message.optString("captureId")
                if (!hasMicPermission()) {
                    replyProxy.postMessage(audioErrorEvent("MIC_PERMISSION_REQUIRED", "RECORD_AUDIO is not granted", sessionId, captureId, requestId).toString())
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                } else {
                    replyProxy.postMessage(nativeAudioCapture.start(sessionId, captureId, requestId).toString())
                }
            }

            "STOP_AUDIO_CAPTURE" -> nativeAudioCapture.stop(message.optString("sessionId"), message.optString("captureId"))
            "CANCEL_AUDIO_CAPTURE" -> nativeAudioCapture.cancel(message.optString("sessionId"), message.optString("captureId"))

            "GET_TRANSCRIPTION_CAPABILITIES" -> {
                val response = speechProvider.capabilities(requestId)
                response.put("hostBuild", BuildConfig.VERSION_NAME)
                response.put("productSourceHead", BuildConfig.PRODUCT_SOURCE_HEAD)
                response.put("webBuildId", webProvenance.optString("webBuildId"))
                response.put("trustedOrigin", TRUSTED_ORIGIN)
                replyProxy.postMessage(response.toString())
            }

            "START_LIVE_DRAFT" -> {
                val sessionId = message.optString("sessionId")
                val turnId = message.optString("turnId")
                val language = message.optString("language", "fr-FR")
                if (!hasMicPermission()) {
                    replyProxy.postMessage(errorEvent("MIC_PERMISSION_REQUIRED", "RECORD_AUDIO is not granted", sessionId, turnId).toString())
                } else {
                    speechProvider.start(sessionId, turnId, language)
                }
            }

            "STOP_LIVE_DRAFT" -> speechProvider.stop(message.optString("sessionId"), message.optString("turnId"))
            "CANCEL_TRANSCRIPTION" -> speechProvider.cancel(message.optString("sessionId"), message.optString("turnId"))
            else -> replyProxy.postMessage(errorEvent("UNKNOWN_COMMAND", "Unsupported bridge command: $type").toString())
        }
    }

    private fun sendToWeb(event: JSONObject) {
        activeReplyProxy?.postMessage(event.toString())
    }

    private fun errorEvent(code: String, message: String, sessionId: String? = null, turnId: String? = null): JSONObject =
        JSONObject().apply {
            put("type", "TRANSCRIPTION_ERROR")
            put("providerId", BuildConfig.TRANSCRIPTION_PROVIDER_ID)
            put("providerMode", "android-system-default-v3-draft-pcm")
            put("status", "FAILED")
            put("code", code)
            put("message", message)
            if (!sessionId.isNullOrBlank()) put("sessionId", sessionId)
            if (!turnId.isNullOrBlank()) put("turnId", turnId)
        }

    private fun audioErrorEvent(code: String, message: String, sessionId: String?, captureId: String?, requestId: String?): JSONObject =
        JSONObject().apply {
            put("type", "AUDIO_CAPTURE_ERROR")
            if (!requestId.isNullOrBlank()) put("requestId", requestId)
            put("code", code)
            put("message", message)
            if (!sessionId.isNullOrBlank()) put("sessionId", sessionId)
            if (!captureId.isNullOrBlank()) put("captureId", captureId)
        }

    private fun loadWebProvenance(): JSONObject = try {
        assets.open("web/host-provenance.json").bufferedReader().use { JSONObject(it.readText()) }
    } catch (_: Exception) {
        JSONObject().put("webBuildId", "UNKNOWN")
    }

    private fun isTrustedOrigin(uri: Uri?): Boolean =
        uri != null && uri.scheme == TRUSTED_SCHEME && uri.host == TRUSTED_HOST && (uri.port == -1 || uri.port == 443)

    private fun isTrustedProductUrl(uri: Uri): Boolean =
        isTrustedOrigin(uri) && uri.path.orEmpty().startsWith("/assets/web/")

    private fun hasMicPermission(): Boolean = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        speechProvider.destroy()
        nativeAudioCapture.destroy()
        activeReplyProxy = null
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    private class RecordingPathHandler(private val root: File) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            if (!path.matches(Regex("[A-Za-z0-9._-]+\\.wav"))) return null
            val file = File(root, path)
            return try {
                val canonicalRoot = root.canonicalFile
                val canonicalFile = file.canonicalFile
                if (!canonicalFile.path.startsWith(canonicalRoot.path + File.separator)) return null
                if (!canonicalFile.exists() || !canonicalFile.isFile) return null
                WebResourceResponse("audio/wav", null, FileInputStream(canonicalFile)).apply {
                    responseHeaders = mapOf("Cache-Control" to "no-store")
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}
