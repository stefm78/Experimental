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

class AndroidHostActivity : Activity() {
    companion object {
        private const val REQ_MIC = 1801
        private const val TRUSTED_SCHEME = "https"
        private const val TRUSTED_HOST = "appassets.androidplatform.net"
        private const val TRUSTED_ORIGIN = "$TRUSTED_SCHEME://$TRUSTED_HOST"
        private const val START_URL = "$TRUSTED_ORIGIN/assets/web/index.html"
        private const val BRIDGE_NAME = "OfflineInterviewNative"
    }

    private lateinit var webView: WebView
    private lateinit var speechProvider: AndroidSpeechDraftProvider
    private var activeReplyProxy: JavaScriptReplyProxy? = null
    private var pendingWebPermission: PermissionRequest? = null
    private lateinit var webProvenance: JSONObject

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webProvenance = loadWebProvenance()
        speechProvider = AndroidSpeechDraftProvider(this) { event ->
            runOnUiThread { sendToWeb(event) }
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
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

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (!isTrustedOrigin(request.origin) || !wantsAudio) {
                        request.deny()
                        return@runOnUiThread
                    }
                    if (hasMicPermission()) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingWebPermission?.deny()
                        pendingWebPermission = request
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                    }
                }
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
        val message = try {
            JSONObject(raw ?: "")
        } catch (error: Exception) {
            replyProxy.postMessage(errorEvent("INVALID_JSON", error.message ?: "Invalid bridge JSON").toString())
            return
        }

        val type = message.optString("type")
        when (type) {
            "GET_TRANSCRIPTION_CAPABILITIES" -> {
                val response = speechProvider.capabilities(message.optString("requestId").takeIf { it.isNotBlank() })
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
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
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
            put("providerMode", "android-system-default-v3-draft")
            put("status", "FAILED")
            put("code", code)
            put("message", message)
            if (!sessionId.isNullOrBlank()) put("sessionId", sessionId)
            if (!turnId.isNullOrBlank()) put("turnId", turnId)
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        pendingWebPermission?.let { request ->
            if (granted && isTrustedOrigin(request.origin)) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            else request.deny()
        }
        pendingWebPermission = null
    }

    override fun onDestroy() {
        pendingWebPermission?.deny()
        pendingWebPermission = null
        speechProvider.destroy()
        activeReplyProxy = null
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
