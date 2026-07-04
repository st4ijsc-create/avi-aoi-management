package com.foutec.FactoryAlertSystem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * BroadcastReceiver that restores factory-alert monitoring after a device reboot.
 *
 * MB3 (doc 27 Đợt 6): the previous implementation called startActivity() from
 * BOOT_COMPLETED, which Android 10+ (background activity start restrictions)
 * blocks silently — the app never auto-started. We now start
 * [BootHeadlessTaskService] instead: a HeadlessJsTaskService is a regular
 * Service, and an app that has just received BOOT_COMPLETED is on the system's
 * temporary power allowlist, so startService() is permitted for this window.
 * The headless JS task then re-establishes MQTT and promotes itself to a
 * Notifee foreground service for long-lived monitoring.
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON") {

            Log.d(TAG, "Boot completed — starting headless MQTT bootstrap")

            try {
                val serviceIntent = Intent(context, BootHeadlessTaskService::class.java).apply {
                    putExtra("reason", action)
                }
                context.startService(serviceIntent)
                // Keep the CPU awake long enough for the JS runtime to spin up.
                // The wake lock is released automatically when the headless task finishes.
                HeadlessJsTaskService.acquireWakeLockNow(context)
            } catch (e: Exception) {
                // Some OEM ROMs enforce stricter background-start rules even during
                // the BOOT_COMPLETED allowlist window. Nothing more we can do here
                // without a visible UI — log and give up gracefully.
                Log.e(TAG, "Failed to start BootHeadlessTaskService: ${e.message}", e)
            }
        }
    }
}
