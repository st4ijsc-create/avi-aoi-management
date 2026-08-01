package com.foutec.FactoryAlertSystem

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * DeviceInfoModule - Native module cung cấp thông tin thật của thiết bị Android
 * Bao gồm: IP address, device name, screen resolution, network type, unique ID
 */
class DeviceInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeviceInfoModule"

    /**
     * Lấy toàn bộ thông tin thiết bị
     */
    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val map = WritableNativeMap()
            map.putString("ipAddress", getWifiIpAddress())
            map.putString("deviceName", getDeviceName())
            map.putString("deviceModel", Build.MODEL)
            map.putString("brand", Build.BRAND)
            map.putString("manufacturer", Build.MANUFACTURER)
            map.putString("osVersion", "Android ${Build.VERSION.RELEASE}")
            map.putString("screenResolution", getScreenResolution())
            map.putString("networkType", getNetworkType())
            map.putString("androidId", getAndroidId())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DEVICE_INFO_ERROR", e.message, e)
        }
    }

    /**
     * Lấy IP address thật của thiết bị qua WiFi hoặc network interface
     * Ưu tiên: WiFi IP → Network Interface IP → fallback
     */
    private fun getWifiIpAddress(): String {
        // Method 1: Try WifiManager (most reliable for WiFi)
        try {
            val wifiManager = reactApplicationContext
                .applicationContext
                .getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wifiManager != null) {
                val wifiInfo = wifiManager.connectionInfo
                val ipInt = wifiInfo.ipAddress
                if (ipInt != 0) {
                    val ip = String.format(
                        "%d.%d.%d.%d",
                        ipInt and 0xff,
                        ipInt shr 8 and 0xff,
                        ipInt shr 16 and 0xff,
                        ipInt shr 24 and 0xff
                    )
                    if (ip != "0.0.0.0") return ip
                }
            }
        } catch (_: Exception) {}

        // Method 2: Enumerate network interfaces (works for ethernet, cellular)
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            if (interfaces != null) {
                for (intf in interfaces) {
                    // Skip loopback and down interfaces
                    if (intf.isLoopback || !intf.isUp) continue
                    // Prefer wlan0 > eth0 > others
                    val addresses = intf.inetAddresses
                    for (addr in addresses) {
                        if (!addr.isLoopbackAddress && addr is Inet4Address) {
                            val hostAddress = addr.hostAddress
                            if (hostAddress != null && hostAddress != "0.0.0.0") {
                                return hostAddress
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        return "Unknown"
    }

    /**
     * Lấy tên thiết bị do user đặt (Settings > About > Device name)
     */
    private fun getDeviceName(): String {
        try {
            // Android 7.1+ (API 25+): Global setting
            val name = Settings.Global.getString(
                reactApplicationContext.contentResolver,
                Settings.Global.DEVICE_NAME
            )
            if (!name.isNullOrBlank()) return name
        } catch (_: Exception) {}

        try {
            // Fallback: Secure setting (bluetooth name)
            val btName = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                "bluetooth_name"
            )
            if (!btName.isNullOrBlank()) return btName
        } catch (_: Exception) {}

        // Fallback to model
        return Build.MODEL
    }

    /**
     * Lấy screen resolution thật
     */
    private fun getScreenResolution(): String {
        return try {
            val wm = reactApplicationContext
                .getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            "${metrics.widthPixels}x${metrics.heightPixels}"
        } catch (_: Exception) {
            "Unknown"
        }
    }

    /**
     * Lấy loại kết nối mạng hiện tại (wifi, cellular, ethernet)
     */
    private fun getNetworkType(): String {
        return try {
            val cm = reactApplicationContext
                .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork ?: return "none"
                val caps = cm.getNetworkCapabilities(network) ?: return "none"
                when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_USB) -> "usb"
                    else -> "other"
                }
            } else {
                @Suppress("DEPRECATION")
                when (cm.activeNetworkInfo?.type) {
                    ConnectivityManager.TYPE_WIFI -> "wifi"
                    ConnectivityManager.TYPE_MOBILE -> "cellular"
                    ConnectivityManager.TYPE_ETHERNET -> "ethernet"
                    else -> "other"
                }
            }
        } catch (_: Exception) {
            "Unknown"
        }
    }

    /**
     * Lấy Android ID (unique per device + app signing key, persists across reinstalls)
     */
    private fun getAndroidId(): String {
        return try {
            Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ANDROID_ID
            ) ?: "Unknown"
        } catch (_: Exception) {
            "Unknown"
        }
    }
}
