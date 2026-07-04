# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ============================================================================
# Wave 2D (perf): R8/Proguard is now ENABLED for release (minifyEnabled +
# shrinkResources). React Native itself ships consumer keep rules via
# react-android, but every native module that uses reflection / JNI must be kept
# explicitly. Rule of thumb here: when unsure, keep MORE. If a release build ever
# throws ClassNotFound / NoSuchMethod / NoSuchField, add a -keep for that package
# rather than disabling minification.
# ============================================================================

# ----- Core React Native / JSI / TurboModules / annotations -----------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.proguard.annotations.KeepGettersAndSetters *;
}
# Keep native methods and any class that declares them (JNI boundary)
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**

# ----- Hermes (JS engine, reflection + JNI) ---------------------------------
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.hermes.unicode.** { *; }
-dontwarn com.facebook.hermes.**

# ----- react-native-reanimated (worklets, reflection, JNI) ------------------
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-dontwarn com.swmansion.reanimated.**

# ----- react-native-gesture-handler -----------------------------------------
-keep class com.swmansion.gesturehandler.** { *; }
-dontwarn com.swmansion.gesturehandler.**

# ----- react-native-svg -----------------------------------------------------
-keep class com.horcrux.svg.** { *; }
-dontwarn com.horcrux.svg.**

# ----- react-native-vector-icons --------------------------------------------
-keep class com.oblador.vectoricons.** { *; }

# ----- @react-native-async-storage/async-storage ----------------------------
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# ----- @react-native-community/netinfo --------------------------------------
-keep class com.reactnativecommunity.netinfo.** { *; }

# ----- react-native-tcp-socket (MQTT transport over raw TCP) ----------------
-keep class com.asterinet.react.tcpsocket.** { *; }
-dontwarn com.asterinet.react.tcpsocket.**

# ----- MQTT (Eclipse Paho — kept from the pre-Wave-2 baseline) ---------------
-keep class org.eclipse.paho.** { *; }
-dontwarn org.eclipse.paho.**

# ----- @notifee/react-native (notifications, reflection) --------------------
-keep class io.invertase.notifee.** { *; }
-keep class app.notifee.** { *; }
-dontwarn io.invertase.notifee.**
-dontwarn app.notifee.**

# ----- Fresco / OkHttp / Okio (image pipeline + networking used by RN) -------
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.drawee.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# ----- App native modules (FloatingBubble, DeviceInfo, MainApplication) ------
# These are referenced by name (packages added manually + reflective Flipper
# init), so keep the app package to be safe.
-keep class com.foutec.FactoryAlertSystem.** { *; }

# ----- Enums / Parcelable / Serializable (commonly reflected) ---------------
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
