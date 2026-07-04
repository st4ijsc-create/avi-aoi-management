package com.foutec.FactoryAlertSystem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * FloatingBubbleModule
 * React Native Bridge để điều khiển Floating Bubble từ JavaScript
 */
class FloatingBubbleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var alertActionReceiver: BroadcastReceiver? = null
    private var listenerCount = 0

    override fun getName(): String = "FloatingBubbleModule"

    init {
        registerAlertActionReceiver()
    }

    /**
     * Required for NativeEventEmitter
     */
    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun addListener(eventName: String) {
        listenerCount++
    }

    /**
     * Required for NativeEventEmitter
     */
    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount -= count
        if (listenerCount < 0) listenerCount = 0
    }

    /**
     * Kiểm tra permission SYSTEM_ALERT_WINDOW
     */
    @ReactMethod
    fun checkPermission(promise: Promise) {
        try {
            val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(reactContext)
            } else {
                true
            }
            promise.resolve(hasPermission)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Mở settings để cấp permission
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Hiển thị bubble
     */
    @ReactMethod
    fun showBubble(promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_SHOW_BUBBLE
            }
            ContextCompat.startForegroundService(reactContext, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Ẩn bubble
     */
    @ReactMethod
    fun hideBubble(promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_HIDE_BUBBLE
            }
            reactContext.startService(intent)
            reactContext.stopService(Intent(reactContext, FloatingBubbleService::class.java))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Cập nhật badge count
     */
    @ReactMethod
    fun updateBadge(count: Int, promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_UPDATE_BUBBLE
                putExtra(FloatingBubbleService.EXTRA_PENDING_COUNT, count)
            }
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Hiển thị alert popup
     */
    @ReactMethod
    fun showAlert(options: ReadableMap, promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_SHOW_ALERT
                putExtra(FloatingBubbleService.EXTRA_ALERT_ID, options.getString("alertId") ?: "")
                putExtra(FloatingBubbleService.EXTRA_TITLE, options.getString("title") ?: "Alert")
                putExtra(FloatingBubbleService.EXTRA_MESSAGE, options.getString("message") ?: "")
                putExtra(FloatingBubbleService.EXTRA_SEVERITY, options.getString("severity") ?: "high")
                putExtra(FloatingBubbleService.EXTRA_PENDING_COUNT, options.getInt("pendingCount"))
            }
            ContextCompat.startForegroundService(reactContext, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Kiểm tra bubble có đang hiển thị không
     */
    @ReactMethod
    fun isShowing(promise: Promise) {
        try {
            promise.resolve(FloatingBubbleService.isRunning())
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Hiển thị overlay alert dialog (native overlay khi app ở background)
     */
    @ReactMethod
    fun showOverlayAlert(options: ReadableMap, promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_SHOW_OVERLAY_ALERT
                putExtra(FloatingBubbleService.EXTRA_ALERT_ID, options.getString("alertId") ?: "")
                putExtra(FloatingBubbleService.EXTRA_ALERT_TYPE, options.getString("alertType") ?: "")
                putExtra(FloatingBubbleService.EXTRA_SEVERITY, options.getString("severity") ?: "high")
                putExtra(FloatingBubbleService.EXTRA_STATION_NAME, options.getString("stationName") ?: "N/A")
                putExtra(FloatingBubbleService.EXTRA_STATION_LINE, options.getString("stationLine") ?: "")
                putExtra(FloatingBubbleService.EXTRA_PRODUCT_NAME, options.getString("productName") ?: "N/A")
                putExtra(FloatingBubbleService.EXTRA_PRODUCT_SERIAL, options.getString("productSerial") ?: "")
                putExtra(FloatingBubbleService.EXTRA_ERROR_CODE, options.getString("errorCode") ?: "")
                putExtra(FloatingBubbleService.EXTRA_ERROR_TYPE, options.getString("errorType") ?: "")
                putExtra(FloatingBubbleService.EXTRA_ERROR_DESC, options.getString("errorDesc") ?: "")
                putExtra(FloatingBubbleService.EXTRA_MACHINE_NAME, options.getString("machineName") ?: "")
                putExtra(FloatingBubbleService.EXTRA_TIMESTAMP, options.getString("timestamp") ?: "")
                putExtra(FloatingBubbleService.EXTRA_NG_POINT_COUNT,
                    if (options.hasKey("ngPointCount")) options.getInt("ngPointCount") else 0)
                putExtra(FloatingBubbleService.EXTRA_TOTAL_NG,
                    if (options.hasKey("totalNG")) options.getInt("totalNG") else 0)
                putExtra(FloatingBubbleService.EXTRA_INSPECTION_ID,
                    if (options.hasKey("inspectionId")) options.getInt("inspectionId") else 0)
                putExtra(FloatingBubbleService.EXTRA_DISPLAY_DURATION,
                    if (options.hasKey("displayDuration")) options.getDouble("displayDuration").toLong() else 15000L)
            }
            ContextCompat.startForegroundService(reactContext, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Ẩn overlay alert dialog
     */
    @ReactMethod
    fun hideOverlayAlert(promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_HIDE_OVERLAY_ALERT
            }
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Hiển thị bulletin overlay (native overlay khi app ở background)
     */
    @ReactMethod
    fun showBulletinOverlay(options: ReadableMap, promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_SHOW_BULLETIN
                putExtra(FloatingBubbleService.EXTRA_BULLETIN_ID, options.getString("bulletinId") ?: "")
                putExtra(FloatingBubbleService.EXTRA_STATION_NAME, options.getString("stationName") ?: "N/A")
                putExtra(FloatingBubbleService.EXTRA_LINE_NAME, options.getString("lineName") ?: "")
                putExtra(FloatingBubbleService.EXTRA_YIELD_RATE, 
                    if (options.hasKey("yieldRate")) options.getDouble("yieldRate").toFloat() else 0f)
                putExtra(FloatingBubbleService.EXTRA_PERIOD_START, options.getString("periodStart") ?: "")
                putExtra(FloatingBubbleService.EXTRA_PERIOD_END, options.getString("periodEnd") ?: "")
                putExtra(FloatingBubbleService.EXTRA_TOTAL_OUTPUT, 
                    if (options.hasKey("totalOutput")) options.getInt("totalOutput") else 0)
                putExtra(FloatingBubbleService.EXTRA_NG_COUNT, 
                    if (options.hasKey("ngCount")) options.getInt("ngCount") else 0)
                putExtra(FloatingBubbleService.EXTRA_TOTAL_ALERTS, 
                    if (options.hasKey("totalAlerts")) options.getInt("totalAlerts") else 0)
            }
            ContextCompat.startForegroundService(reactContext, intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Ẩn bulletin overlay
     */
    @ReactMethod
    fun hideBulletinOverlay(promise: Promise) {
        try {
            val intent = Intent(reactContext, FloatingBubbleService::class.java).apply {
                action = FloatingBubbleService.ACTION_HIDE_BULLETIN
            }
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Đăng ký receiver để nhận events từ bubble
     */
    private fun registerAlertActionReceiver() {
        alertActionReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    "com.foutec.FactoryAlertSystem.ALERT_ACKNOWLEDGED" -> {
                        val alertId = intent.getStringExtra("alertId") ?: return
                        sendEvent("onAlertAcknowledged", Arguments.createMap().apply {
                            putString("alertId", alertId)
                        })
                    }
                    "com.foutec.FactoryAlertSystem.ALERT_DISMISSED" -> {
                        val alertId = intent.getStringExtra("alertId") ?: return
                        sendEvent("onAlertDismissed", Arguments.createMap().apply {
                            putString("alertId", alertId)
                        })
                    }
                    "com.foutec.FactoryAlertSystem.BULLETIN_VIEW_DETAIL" -> {
                        val bulletinId = intent.getStringExtra("bulletinId") ?: return
                        sendEvent("onBulletinViewDetail", Arguments.createMap().apply {
                            putString("bulletinId", bulletinId)
                        })
                    }
                    "com.foutec.FactoryAlertSystem.BULLETIN_DISMISSED" -> {
                        val bulletinId = intent.getStringExtra("bulletinId") ?: return
                        sendEvent("onBulletinDismissed", Arguments.createMap().apply {
                            putString("bulletinId", bulletinId)
                        })
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction("com.foutec.FactoryAlertSystem.ALERT_ACKNOWLEDGED")
            addAction("com.foutec.FactoryAlertSystem.ALERT_DISMISSED")
            addAction("com.foutec.FactoryAlertSystem.BULLETIN_VIEW_DETAIL")
            addAction("com.foutec.FactoryAlertSystem.BULLETIN_DISMISSED")
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(alertActionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(alertActionReceiver, filter)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        alertActionReceiver?.let {
            try {
                reactContext.unregisterReceiver(it)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
