package com.foutec.FactoryAlertSystem

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * PinnedTlsSocketPackage — registers PinnedTlsSocketModule (doc 81 Đợt 7 task J2: MQTT over TLS to the built-in
 * broker, certificate pinned by SHA-256 fingerprint).
 */
class PinnedTlsSocketPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(PinnedTlsSocketModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
