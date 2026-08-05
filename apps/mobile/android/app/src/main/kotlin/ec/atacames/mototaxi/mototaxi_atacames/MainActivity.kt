package ec.atacames.mototaxi.mototaxi_atacames

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.hardware.fingerprint.FingerprintManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : FlutterFragmentActivity() {
    private val nativeChannel = "ec.atacames.mototaxi/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, nativeChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "dial" -> {
                        val phone = call.argument<String>("phone")?.trim().orEmpty()
                        if (phone.isBlank()) {
                            result.error("INVALID_PHONE", "El teléfono está vacío", null)
                            return@setMethodCallHandler
                        }
                        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")))
                        result.success(null)
                    }
                    "share" -> {
                        val text = call.argument<String>("text")?.trim().orEmpty()
                        if (text.isBlank()) {
                            result.error("INVALID_TEXT", "No hay información para compartir", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, text)
                        }
                        startActivity(Intent.createChooser(intent, "Compartir viaje"))
                        result.success(null)
                    }
                    "openUrl" -> {
                        val value = call.argument<String>("url")?.trim().orEmpty()
                        val uri = runCatching { Uri.parse(value) }.getOrNull()
                        if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank()) {
                            result.error("INVALID_URL", "El enlace de la campaña no es seguro", null)
                            return@setMethodCallHandler
                        }
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        result.success(null)
                    }
                    "authenticateFingerprintLegacy" -> authenticateFingerprintLegacy(result)
                    else -> result.notImplemented()
                }
            }
    }

    @Suppress("DEPRECATION")
    private fun authenticateFingerprintLegacy(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P) {
            result.error("USE_LOCAL_AUTH", "Usar autenticación biométrica moderna", null)
            return
        }

        val manager = getSystemService(Context.FINGERPRINT_SERVICE) as? FingerprintManager
        if (manager == null || !manager.isHardwareDetected) {
            result.error("NO_HARDWARE", "Este dispositivo no dispone de lector de huellas.", null)
            return
        }
        if (!manager.hasEnrolledFingerprints()) {
            result.error("NOT_ENROLLED", "No hay una huella registrada en el teléfono.", null)
            return
        }

        val cancellation = CancellationSignal()
        val completed = AtomicBoolean(false)
        var dialog: AlertDialog? = null

        fun finish(value: Boolean) {
            if (!completed.compareAndSet(false, true)) return
            cancellation.cancel()
            dialog?.takeIf { it.isShowing }?.dismiss()
            result.success(value)
        }

        dialog = AlertDialog.Builder(this)
            .setTitle("Confirmar huella")
            .setMessage("Coloca tu dedo en el lector del teléfono para habilitar el acceso biométrico.")
            .setNegativeButton("Cancelar") { _, _ -> finish(false) }
            .setOnCancelListener { finish(false) }
            .create()

        dialog?.show()
        manager.authenticate(
            null,
            cancellation,
            0,
            object : FingerprintManager.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    authenticationResult: FingerprintManager.AuthenticationResult?
                ) = finish(true)

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                    if (errorCode == FingerprintManager.FINGERPRINT_ERROR_CANCELED) return
                    if (!completed.compareAndSet(false, true)) return
                    dialog?.takeIf { it.isShowing }?.dismiss()
                    result.error("AUTH_ERROR", errString?.toString() ?: "No se pudo validar la huella.", null)
                }

                override fun onAuthenticationFailed() {
                    dialog?.takeIf { it.isShowing }
                        ?.setMessage("Huella no reconocida. Inténtalo nuevamente.")
                }
            },
            null
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "mototaxi_alerts_v2",
                "Alertas de viajes y mensajes",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Cambios del viaje, solicitudes cercanas y mensajes del chat"
                enableVibration(true)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
