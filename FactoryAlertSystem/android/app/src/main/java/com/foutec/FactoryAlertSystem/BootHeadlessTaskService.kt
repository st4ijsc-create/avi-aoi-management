package com.foutec.FactoryAlertSystem

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Headless JS task service started by [BootReceiver] after BOOT_COMPLETED.
 *
 * MB3 (doc 27 Đợt 6): Android 10+ silently blocks startActivity() from a
 * BroadcastReceiver, so the old "launch MainActivity on boot" approach never
 * worked. Instead we spin up the React Native JS runtime WITHOUT any UI and run
 * the JS task registered in index.js as "FactoryAlertBootTask". That task:
 *   1. loads persisted settings (AsyncStorage),
 *   2. connects MQTT if a broker is configured + autoReconnect is enabled,
 *   3. starts the Notifee foreground service (dataSync) via
 *      backgroundReliability so the JS runtime + MQTT connection survive after
 *      the headless-task window ends.
 *
 * Timeout is 60s — enough for settings load + first MQTT connect attempt. The
 * long-lived part is handed over to the Notifee foreground service, not the
 * headless task itself.
 */
class BootHeadlessTaskService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val data = Arguments.createMap().apply {
            putString("reason", intent?.getStringExtra("reason") ?: "boot")
            putDouble("startedAt", System.currentTimeMillis().toDouble())
        }
        return HeadlessJsTaskConfig(
            "FactoryAlertBootTask", // must match AppRegistry.registerHeadlessTask in index.js
            data,
            60_000, // task timeout (ms)
            true    // allowedInForeground — still run if the user opens the app meanwhile
        )
    }
}
