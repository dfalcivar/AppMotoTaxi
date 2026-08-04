package ec.atacames.mototaxi.mototaxi_atacames

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

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
                    else -> result.notImplemented()
                }
            }
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
