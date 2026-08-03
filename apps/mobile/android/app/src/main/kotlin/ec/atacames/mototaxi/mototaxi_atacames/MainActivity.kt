package ec.atacames.mototaxi.mototaxi_atacames

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
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
