package com.costago.alerts;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import java.time.Instant;
import java.util.*;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.embedding.engine.plugins.activity.*;
import io.flutter.plugin.common.*;

/** Registered in both the UI engine and Firebase's headless engine. */
public final class CostaGoAlertsPlugin implements FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware, PluginRegistry.NewIntentListener {
    private Context context;
    private MethodChannel channel;
    private ActivityPluginBinding binding;
    private Map<String,Object> pendingOpen;
    private static final String OFFER_CHANNEL = "costa_go_trip_offers_v3";
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static Ringtone feedback;
    private static String feedbackId;

    @Override public void onAttachedToEngine(FlutterPluginBinding b) {
        context=b.getApplicationContext();
        channel=new MethodChannel(b.getBinaryMessenger(), "ec.atacames.mototaxi/alerts");
        channel.setMethodCallHandler(this);
    }
    @Override public void onDetachedFromEngine(FlutterPluginBinding b) { channel.setMethodCallHandler(null); }
    private NotificationManager manager() { return context.getSystemService(NotificationManager.class); }
    private SharedPreferences store() { return context.getSharedPreferences("offer_lifecycle", Context.MODE_PRIVATE); }
    private String text(Map<?,?> data, String key) { Object v=data.get(key); return v==null?"":v.toString(); }
    private long expiry(Map<?,?> data) {
        try { return Instant.parse(text(data,"expiresAt")).toEpochMilli(); }
        catch (Exception e) { return 0; } // Never ring an offer without a server deadline.
    }
    private void stop(String tripId) {
        if (tripId.isEmpty()) return;
        store().edit().putLong("closed-"+tripId,System.currentTimeMillis()).apply();
        // A delayed offer timeout must never remove a newer trip-status notice.
        for (android.service.notification.StatusBarNotification item:manager().getActiveNotifications()) {
            if (("trip-"+tripId).equals(item.getTag()) &&
                    "TRIP_OFFER".equals(item.getNotification().extras.getString("costaGoEvent"))) {
                manager().cancel(item.getTag(),item.getId());
            }
        }
        manager().cancel(tripId.hashCode()); // Clear pre-protocol foreground alerts too.
        if (tripId.equals(feedbackId)) {
            if (feedback!=null) feedback.stop();
            context.getSystemService(Vibrator.class).cancel();
        }
    }
    private synchronized boolean showOffer(Map<?,?> data) {
        String tripId=text(data,"tripId");
        boolean offer="TRIP_OFFER".equals(text(data,"type"));
        long now=System.currentTimeMillis(), expires=offer?expiry(data):now+900000;
        if (tripId.isEmpty() || expires<=now || (offer && store().contains("closed-"+tripId))) return false;
        if (Build.VERSION.SDK_INT>=33 && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT>=24 && !manager().areNotificationsEnabled()) return false;
        String shownKey="shown-"+text(data,"type")+"-"+tripId;
        if (store().getLong(shownKey,0)>now-600000) return true;
        // Bound persistent tombstones; retries of the same trip must not re-alert.
        SharedPreferences.Editor editor=store().edit();
        for (Map.Entry<String,?> entry:store().getAll().entrySet()) {
            if (entry.getValue() instanceof Long && (Long)entry.getValue()<now-86400000L) editor.remove(entry.getKey());
        }
        editor.putLong(shownKey,now).apply();
        String channelId=offer?OFFER_CHANNEL:"costa_go_trip_updates_v2";
        if (Build.VERSION.SDK_INT>=26) {
            NotificationChannel c=new NotificationChannel(channelId,offer?"Nuevas solicitudes de viaje":"Estados del viaje",NotificationManager.IMPORTANCE_HIGH);
            c.enableVibration(true);
            c.setVibrationPattern(new long[]{0,350,180,350});
            c.setSound(RingtoneManager.getDefaultUri(offer?RingtoneManager.TYPE_ALARM:RingtoneManager.TYPE_NOTIFICATION),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            manager().createNotificationChannel(c); // Existing user preferences are preserved.
        }
        Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch==null) return false;
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launch.putExtra("costaGoType",text(data,"type"));
        launch.putExtra("tripId",tripId);
        launch.putExtra("internalNotificationId",text(data,"internalNotificationId"));
        PendingIntent intent=PendingIntent.getActivity(context,tripId.hashCode(),launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(context,channelId):new Notification.Builder(context);
        int icon=context.getResources().getIdentifier("ic_notification","drawable",context.getPackageName());
        Bundle extras=new Bundle();
        extras.putString("costaGoEvent",text(data,"type"));
        b.addExtras(extras).setSmallIcon(icon==0?context.getApplicationInfo().icon:icon)
            .setContentTitle(text(data,"title")).setContentText(text(data,"body"))
            .setStyle(new Notification.BigTextStyle().bigText(text(data,"body")))
            .setCategory(Notification.CATEGORY_EVENT).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(intent)
            .addAction(new Notification.Action.Builder(icon,"Ver",intent).build());
        if (Build.VERSION.SDK_INT>=26) b.setTimeoutAfter(expires-now);
        else b.setPriority(Notification.PRIORITY_HIGH).setSound(RingtoneManager.getDefaultUri(offer?RingtoneManager.TYPE_ALARM:RingtoneManager.TYPE_NOTIFICATION)).setVibrate(new long[]{0,350,180,350});
        manager().notify("trip-"+tripId,0,b.build());
        if(offer) handler.postDelayed(()->{ synchronized(CostaGoAlertsPlugin.class) { stop(tripId); } },expires-now);
        return true;
    }
    private void feedback(Map<?,?> data) {
        AudioManager audio=context.getSystemService(AudioManager.class);
        if (audio.getRingerMode()==AudioManager.RINGER_MODE_SILENT) return;
        String channelId=text(data,"channelId");
        NotificationChannel c=Build.VERSION.SDK_INT>=26?manager().getNotificationChannel(channelId):null;
        if (c!=null && c.getImportance()==NotificationManager.IMPORTANCE_NONE) return;
        if (c==null || c.shouldVibrate()) context.getSystemService(Vibrator.class).vibrate(180);
        if (audio.getRingerMode()!=AudioManager.RINGER_MODE_NORMAL) return;
        android.net.Uri sound=c==null?RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION):c.getSound();
        if (sound==null) return;
        if (feedback!=null) feedback.stop();
        Ringtone tone=RingtoneManager.getRingtone(context,sound);
        if (tone==null) return;
        feedback=tone; feedbackId=text(data,"tripId");
        tone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        tone.play(); handler.postDelayed(tone::stop,1600);
    }
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        try {
            Map<?,?> data=call.arguments instanceof Map?(Map<?,?>)call.arguments:Collections.emptyMap();
            // UI and Firebase headless engines have distinct plugin instances.
            synchronized(CostaGoAlertsPlugin.class) { switch(call.method) {
                case "showOffer": result.success(showOffer(data)); break;
                case "stop": stop(text(data,"tripId")); result.success(null); break;
                case "feedback": feedback(data); result.success(null); break;
                case "consumeOpen": result.success(pendingOpen); pendingOpen=null; break;
                default: result.notImplemented();
            } }
        } catch(Exception e) { result.error("ALERT_UNAVAILABLE","No se pudo actualizar la alerta",null); }
    }
    private void readIntent(Intent intent, boolean notify) {
        if (intent==null || !intent.hasExtra("costaGoType")) return;
        pendingOpen=new HashMap<>();
        pendingOpen.put("type",intent.getStringExtra("costaGoType"));
        pendingOpen.put("tripId",intent.getStringExtra("tripId"));
        pendingOpen.put("internalNotificationId",intent.getStringExtra("internalNotificationId"));
        intent.removeExtra("costaGoType");
        if (notify) channel.invokeMethod("opened",pendingOpen);
    }
    @Override public boolean onNewIntent(Intent intent) { readIntent(intent,true); return false; }
    @Override public void onAttachedToActivity(ActivityPluginBinding b) { binding=b; b.addOnNewIntentListener(this); readIntent(b.getActivity().getIntent(),false); }
    @Override public void onDetachedFromActivity() { if(binding!=null)binding.removeOnNewIntentListener(this); binding=null; }
    @Override public void onDetachedFromActivityForConfigChanges() { onDetachedFromActivity(); }
    @Override public void onReattachedToActivityForConfigChanges(ActivityPluginBinding b) { onAttachedToActivity(b); }
}
