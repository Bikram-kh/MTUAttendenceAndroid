package com.mtu.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var credentialManager: CredentialManager

    private val locationRequestCode = 1001

    // This is generated from the Web OAuth client in google-services.json.
    private val webClientId: String by lazy {
        getString(R.string.default_web_client_id)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        credentialManager = CredentialManager.create(this)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            geolocationEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // The page only exposes one native action: starting Google Sign-In.
        webView.addJavascriptInterface(AndroidBridge(), "AndroidMTU")

        webView.webViewClient = WebViewClient()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.ACCESS_FINE_LOCATION
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ),
                        locationRequestCode
                    )
                }

                callback?.invoke(origin, true, false)
            }
        }

        requestLocationIfNeeded()
        webView.loadUrl("file:///android_asset/index.html")
    }

    private inner class AndroidBridge {

        @JavascriptInterface
        fun startGoogleSignIn() {
            beginGoogleSignIn()
        }
    }

    private fun beginGoogleSignIn() {
        lifecycleScope.launch {
            try {
                val googleIdOption = GetGoogleIdOption.Builder()
                    .setServerClientId(webClientId)
                    .setFilterByAuthorizedAccounts(false)
                    .build()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()

                val result = credentialManager.getCredential(
                    context = this@MainActivity,
                    request = request
                )

                val credential = result.credential

                if (
                    credential is CustomCredential &&
                    credential.type ==
                    GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    try {
                        val googleCredential =
                            GoogleIdTokenCredential.createFrom(credential.data)

                        val idToken = googleCredential.idToken
                        val quotedToken = JSONObject.quote(idToken)

                        webView.post {
                            webView.evaluateJavascript(
                                "window.nativeGoogleLogin($quotedToken);",
                                null
                            )
                        }
                    } catch (e: GoogleIdTokenParsingException) {
                        Log.e("MTU_AUTH", "Could not parse Google ID token", e)
                        showLoginError("Could not read the Google sign-in response.")
                    }
                } else {
                    Log.e("MTU_AUTH", "Unexpected credential type: ${credential.type}")
                    showLoginError("Google sign-in returned an unsupported credential.")
                }

            } catch (e: Exception) {
                Log.e("MTU_AUTH", "Google sign-in failed", e)
                showLoginError(
                    e.message ?: "Google sign-in was cancelled or failed."
                )
            }
        }
    }

    private fun showLoginError(message: String) {
        val quoted = JSONObject.quote(message)

        webView.post {
            webView.evaluateJavascript("alert($quoted);", null)
        }
    }

    private fun requestLocationIfNeeded() {
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                locationRequestCode
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        webView.reload()
    }

    @Deprecated("Deprecated in Android API 33")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
