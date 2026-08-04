package ec.atacames.mototaxi.mototaxi_atacames

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val nativeChannel = "ec.atacames.mototaxi/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, nativeChannel)
            .setMethodCallHandler { call, result ->
                if (call.method != "dial") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val phone = call.argument<String>("phone")?.trim().orEmpty()
                if (phone.isBlank()) {
                    result.error("INVALID_PHONE", "El teléfono está vacío", null)
                    return@setMethodCallHandler
                }
                startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")))
                result.success(null)
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
