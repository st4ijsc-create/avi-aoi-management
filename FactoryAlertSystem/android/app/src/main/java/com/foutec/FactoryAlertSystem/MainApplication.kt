package com.foutec.FactoryAlertSystem

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceManager
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
// Wave 2D: Flipper is a debug-only dependency now; do NOT import its class
// directly (it is absent from the release classpath). It is loaded reflectively
// in onCreate() under a BuildConfig.DEBUG guard.
import com.facebook.soloader.SoLoader
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.drawee.backends.pipeline.Fresco

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    // Add FloatingBubblePackage
                    add(FloatingBubblePackage())
                    // Add DeviceInfoPackage for real device info (IP, name, etc.)
                    add(DeviceInfoPackage())
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(this.applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, false)
        
        // Configure Fresco image pipeline for low-end devices
        // - Downsampling reduces memory usage for large images
        // - Smaller disk cache prevents storage issues on low-spec devices
        // - Resize and rotate enabled for memory-efficient image loading
        val frescoConfig = ImagePipelineConfig.newBuilder(this)
            .setDownsampleEnabled(true)
            .setResizeAndRotateEnabledForNetwork(true)
            .setBitmapsConfig(android.graphics.Bitmap.Config.RGB_565)
            .build()
        Fresco.initialize(this, frescoConfig)
        
        // Create notification channel for foreground service
        createNotificationChannel()
        
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            load()
        }

        // Wave 2D: Flipper init, debug-only. flipper-integration is now a
        // debugImplementation dependency, so its class is not on the release
        // classpath. Load it reflectively behind BuildConfig.DEBUG so release
        // builds compile and never pay Flipper's cost. Any failure is a no-op —
        // Flipper is a developer profiling tool, never required at runtime.
        if (BuildConfig.DEBUG) {
            try {
                Class.forName("com.facebook.react.flipper.ReactNativeFlipper")
                    .getMethod(
                        "initializeFlipper",
                        Context::class.java,
                        ReactInstanceManager::class.java
                    )
                    .invoke(null, this, reactNativeHost.reactInstanceManager)
            } catch (e: Exception) {
                // Flipper absent (release) or signature drift — safe to ignore.
            }
        }
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "floating_bubble_channel",
                "Floating Bubble Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Dịch vụ hiển thị bubble nổi"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
}
