package com.avimqttapp;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

/**
 * Native module for showing bubble/overlay notifications on Android
 */
public class BubbleModule extends ReactContextBaseJavaModule {
    private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1234;
    private WindowManager windowManager;
    private View bubbleView;

    public BubbleModule(ReactApplicationContext reactContext) {
        super(reactContext);
        windowManager = (WindowManager) reactContext.getSystemService(Activity.WINDOW_SERVICE);
    }

    @Override
    public String getName() {
        return "BubbleModule";
    }

    /**
     * Check if the app has overlay permission
     */
    @ReactMethod
    public void hasOverlayPermission(Promise promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(getReactApplicationContext()));
        } else {
            promise.resolve(true);
        }
    }

    /**
     * Request overlay permission from the user
     */
    @ReactMethod
    public void requestOverlayPermission(Promise promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(getReactApplicationContext())) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getReactApplicationContext().getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
                promise.resolve(false);
            } else {
                promise.resolve(true);
            }
        } else {
            promise.resolve(true);
        }
    }

    /**
     * Show a bubble notification overlay
     */
    @ReactMethod
    public void showBubble(ReadableMap options, Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(getReactApplicationContext())) {
                    promise.reject("PERMISSION_DENIED", "Overlay permission not granted");
                    return;
                }
            }

            String title = options.hasKey("title") ? options.getString("title") : "Alert";
            String message = options.hasKey("message") ? options.getString("message") : "";
            int duration = options.hasKey("duration") ? options.getInt("duration") : 5000;

            Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity");
                return;
            }

            activity.runOnUiThread(() -> {
                try {
                    // Remove existing bubble if any
                    if (bubbleView != null) {
                        windowManager.removeView(bubbleView);
                        bubbleView = null;
                    }

                    // Create bubble view
                    LayoutInflater inflater = LayoutInflater.from(getReactApplicationContext());
                    bubbleView = inflater.inflate(R.layout.bubble_notification, null);

                    TextView titleView = bubbleView.findViewById(R.id.bubble_title);
                    TextView messageView = bubbleView.findViewById(R.id.bubble_message);
                    
                    titleView.setText(title);
                    messageView.setText(message);

                    // Set up window parameters
                    int layoutFlag;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
                    } else {
                        layoutFlag = WindowManager.LayoutParams.TYPE_PHONE;
                    }

                    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        layoutFlag,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                        android.graphics.PixelFormat.TRANSLUCENT
                    );

                    params.gravity = Gravity.TOP | Gravity.END;
                    params.x = 20;
                    params.y = 100;

                    // Add view to window
                    windowManager.addView(bubbleView, params);

                    // Auto-dismiss after duration
                    bubbleView.postDelayed(() -> {
                        if (bubbleView != null) {
                            try {
                                windowManager.removeView(bubbleView);
                                bubbleView = null;
                            } catch (Exception e) {
                                // View already removed
                            }
                        }
                    }, duration);

                    // Click to dismiss
                    bubbleView.setOnClickListener(v -> {
                        if (bubbleView != null) {
                            try {
                                windowManager.removeView(bubbleView);
                                bubbleView = null;
                            } catch (Exception e) {
                                // View already removed
                            }
                        }
                    });

                    promise.resolve(true);
                } catch (Exception e) {
                    promise.reject("SHOW_ERROR", e.getMessage());
                }
            });
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Hide the current bubble notification
     */
    @ReactMethod
    public void hideBubble(Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.resolve(false);
            return;
        }

        activity.runOnUiThread(() -> {
            if (bubbleView != null) {
                try {
                    windowManager.removeView(bubbleView);
                    bubbleView = null;
                    promise.resolve(true);
                } catch (Exception e) {
                    promise.resolve(false);
                }
            } else {
                promise.resolve(false);
            }
        });
    }
}
