/**
 * Notification Service - Handles push notifications and bubble overlays
 */

import PushNotification from 'react-native-push-notification';
import { Platform, NativeModules } from 'react-native';
import BackgroundActions from 'react-native-background-actions';

// Bubble service module (native Android)
const { BubbleModule } = NativeModules;

// Notification channel IDs
const CHANNEL_ID_ERROR = 'avi-error-channel';
const CHANNEL_ID_WARNING = 'avi-warning-channel';
const CHANNEL_ID_INFO = 'avi-info-channel';

/**
 * Initialize notification service
 */
export async function initNotificationService(): Promise<void> {
  // Configure push notifications
  PushNotification.configure({
    onRegister: function (token) {
      console.log('Push notification token:', token);
    },
    onNotification: function (notification) {
      console.log('Notification received:', notification);
    },
    permissions: {
      alert: true,
      badge: true,
      sound: true,
    },
    popInitialNotification: true,
    requestPermissions: Platform.OS === 'ios',
  });

  // Create notification channels for Android
  if (Platform.OS === 'android') {
    PushNotification.createChannel(
      {
        channelId: CHANNEL_ID_ERROR,
        channelName: 'Cảnh báo lỗi',
        channelDescription: 'Thông báo cảnh báo lỗi sản xuất',
        playSound: true,
        // Use default system sound to avoid crashes if a custom
        // sound resource is not present or misconfigured
        soundName: 'default',
        importance: 5, // IMPORTANCE_HIGH
        vibrate: true,
      },
      (created) => console.log(`Error channel created: ${created}`)
    );

    PushNotification.createChannel(
      {
        channelId: CHANNEL_ID_WARNING,
        channelName: 'Cảnh báo',
        channelDescription: 'Thông báo cảnh báo hệ thống',
        playSound: true,
        soundName: 'default',
        importance: 4, // IMPORTANCE_DEFAULT
        vibrate: true,
      },
      (created) => console.log(`Warning channel created: ${created}`)
    );

    PushNotification.createChannel(
      {
        channelId: CHANNEL_ID_INFO,
        channelName: 'Thông tin',
        channelDescription: 'Thông báo thông tin chung',
        playSound: false,
        importance: 3, // IMPORTANCE_LOW
        vibrate: false,
      },
      (created) => console.log(`Info channel created: ${created}`)
    );
  }
}

/**
 * Show local notification
 */
export function showNotification(
  title: string,
  message: string,
  type: 'error' | 'warning' | 'info' = 'info'
): void {
  let channelId = CHANNEL_ID_INFO;
  let priority: 'high' | 'default' | 'low' = 'default';

  switch (type) {
    case 'error':
      channelId = CHANNEL_ID_ERROR;
      priority = 'high';
      break;
    case 'warning':
      channelId = CHANNEL_ID_WARNING;
      priority = 'high';
      break;
    default:
      channelId = CHANNEL_ID_INFO;
      priority = 'low';
  }

  PushNotification.localNotification({
    channelId,
    title,
    message,
    priority,
    visibility: 'public',
    autoCancel: true,
    largeIcon: 'ic_launcher',
    smallIcon: 'ic_notification',
    bigText: message,
    subText: 'AVI MQTT Monitor',
    vibrate: type !== 'info',
    vibration: 300,
    playSound: type !== 'info',
    // Use default sound for both error and warning to match
    // the channel configuration and avoid invalid custom names
    soundName: 'default',
    actions: ['Xem chi tiết', 'Bỏ qua'],
  });
}

/**
 * Show bubble notification (floating overlay)
 * This requires SYSTEM_ALERT_WINDOW permission on Android
 */
export async function showBubbleNotification(
  title: string,
  message: string
): Promise<void> {
  if (Platform.OS !== 'android') {
    console.log('Bubble notifications only supported on Android');
    return;
  }

  try {
    // Check if bubble module is available
    if (BubbleModule && BubbleModule.showBubble) {
      await BubbleModule.showBubble({
        title,
        message,
        icon: 'ic_bubble',
        backgroundColor: '#ef4444', // Red for errors
        textColor: '#ffffff',
        duration: 10000, // Show for 10 seconds
        position: 'top-right',
        onClick: () => {
          console.log('Bubble clicked');
        },
      });
    } else {
      // Fallback: Use heads-up notification
      PushNotification.localNotification({
        channelId: CHANNEL_ID_ERROR,
        title,
        message,
        priority: 'max',
        visibility: 'public',
        importance: 'high',
        autoCancel: false,
        ongoing: true,
        timeoutAfter: 10000,
      });
    }
  } catch (error) {
    console.error('Error showing bubble notification:', error);
  }
}

/**
 * Start background service for MQTT monitoring
 */
export async function startBackgroundService(): Promise<void> {
  const options = {
    taskName: 'AVI MQTT Monitor',
    taskTitle: 'Đang giám sát MQTT',
    taskDesc: 'Nhận thông báo lỗi từ hệ thống sản xuất',
    taskIcon: {
      name: 'ic_launcher',
      type: 'mipmap',
    },
    color: '#14b8a6',
    linkingURI: 'avimqtt://home',
    parameters: {
      delay: 1000,
    },
  };

  await BackgroundActions.start(backgroundTask, options);
}

/**
 * Stop background service
 */
export async function stopBackgroundService(): Promise<void> {
  await BackgroundActions.stop();
}

/**
 * Background task function
 */
const backgroundTask = async (taskData: any) => {
  const { delay } = taskData;
  
  await new Promise<void>((resolve) => {
    // Keep the service running
    const interval = setInterval(() => {
      // This keeps the background service alive
      // MQTT messages are handled by the MQTT client
    }, delay);

    // Clean up on stop
    BackgroundActions.on('expiration', () => {
      clearInterval(interval);
      resolve();
    });
  });
};

/**
 * Check if background service is running
 */
export function isBackgroundServiceRunning(): boolean {
  return BackgroundActions.isRunning();
}

/**
 * Clear all notifications
 */
export function clearAllNotifications(): void {
  PushNotification.cancelAllLocalNotifications();
}

/**
 * Request overlay permission (Android)
 */
export async function requestOverlayPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    if (BubbleModule && BubbleModule.requestOverlayPermission) {
      return await BubbleModule.requestOverlayPermission();
    }
  } catch (error) {
    console.error('Error requesting overlay permission:', error);
  }
  return false;
}

/**
 * Check overlay permission status
 */
export async function hasOverlayPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    if (BubbleModule && BubbleModule.hasOverlayPermission) {
      return await BubbleModule.hasOverlayPermission();
    }
  } catch (error) {
    console.error('Error checking overlay permission:', error);
  }
  return false;
}
