package ec.atacames.mototaxi.mototaxi_atacames

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.hardware.fingerprint.FingerprintManager
import android.net.Uri
import android.app.Notification
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
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
                    "showForegroundTripOffer" -> {
                        val title = call.argument<String>("title")?.trim().orEmpty()
                        val body = call.argument<String>("body")?.trim().orEmpty()
                        val tripId = call.argument<String>("tripId")?.trim().orEmpty()
                        result.success(showForegroundTripOffer(title, body, tripId))
                    }
                    "playDriverArrivalAlert" -> {
                        playDriverArrivalAlert()
                        result.success(null)
                    }
                    "authenticateFingerprintLegacy" -> authenticateFingerprintLegacy(result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun showForegroundTripOffer(title: String, body: String, tripId: String): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false

        val manager = getSystemService(NotificationManager::class.java)
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("notificationType", "TRIP_OFFER")
            putExtra("tripId", tripId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            tripId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, "mototaxi_trip_offers_v2")
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setPriority(Notification.PRIORITY_MAX)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
                .setVibrate(longArrayOf(0, 350, 180, 350))
        }
        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title.ifBlank { "Nuevo viaje disponible" })
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
        manager.notify(tripId.ifBlank { "trip-offer" }.hashCode(), builder.build())
        return true
    }

    private fun playDriverArrivalAlert() {
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90)
        tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 170)
        Handler(Looper.getMainLooper()).postDelayed({
            tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 170)
        }, 280)
        Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 650)
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
            val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            val alarmAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val offerChannel = NotificationChannel(
                "mototaxi_trip_offers_v2",
                "Nuevas solicitudes de viaje",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerta sonora para nuevas solicitudes disponibles"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 180, 350)
                setSound(alarmSound, alarmAttributes)
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val tripChannel = NotificationChannel(
                "mototaxi_trip_alerts_v4",
                "Solicitudes y estados del viaje",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Solicitudes cercanas y cambios importantes del viaje"
                enableVibration(true)
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val arrivalChannel = NotificationChannel(
                "mototaxi_driver_arrival_v1",
                "Llegada del conductor",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Aviso sonoro cuando el conductor llega al punto de encuentro"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 180, 120, 180)
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), alarmAttributes)
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val chatChannel = NotificationChannel(
                "mototaxi_chat_messages_v2",
                "Mensajes del viaje",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Mensajes entre pasajero y conductor"
                enableVibration(true)
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannels(listOf(offerChannel, tripChannel, arrivalChannel, chatChannel))
        }
    }
}
