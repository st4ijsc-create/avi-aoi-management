/**
 * Factory Alert System
 * React Native Entry Point
 */

// Import polyfills first
import './shim';

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

/**
 * Register background event handler for Notifee
 * MUST be registered at the top level before app registration
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  console.log('[Background] Event type:', EventType[type]);

  switch (type) {
    case EventType.DISMISSED:
      console.log('[Background] Notification dismissed:', notification?.id);
      break;

    case EventType.PRESS:
      console.log('[Background] Notification pressed:', notification?.data?.alertId);
      // App will be launched, handle in App.tsx
      break;

    case EventType.ACTION_PRESS:
      const alertId = notification?.data?.alertId;
      const actionId = pressAction?.id;
      
      console.log('[Background] Action pressed:', actionId, alertId);

      if (actionId === 'dismiss' && notification?.id) {
        // Dismiss the notification
        await notifee.cancelNotification(notification.id);
      }
      // For 'acknowledge', the app will handle it when opened
      break;

    default:
      break;
  }
});

/**
 * Register Headless JS task for background processing
 * This allows the app to run JavaScript in the background
 */
AppRegistry.registerHeadlessTask('notifee_headless_task', () => async (taskData) => {
  console.log('[HeadlessTask] Running with data:', taskData);
  // Handle background tasks here if needed
});

/**
 * MB2 (doc 27 Đợt 6): register the Notifee foreground-service runner.
 * Notifee requires this OUTSIDE the component lifecycle, before any
 * notification with `asForegroundService: true` is displayed. The runner's
 * never-resolving promise keeps the service (and JS runtime + MQTT) alive
 * while the app is backgrounded — lifecycle driven by backgroundReliability.
 */
import {
  registerForegroundServiceRunner,
  bootHeadlessTask,
  BOOT_HEADLESS_TASK_NAME,
} from './src/services/backgroundReliability';

registerForegroundServiceRunner();

/**
 * MB3 (doc 27 Đợt 6): boot auto-start. BootReceiver.kt → BootHeadlessTaskService
 * runs this task after BOOT_COMPLETED (startActivity from boot is blocked on
 * Android 10+). It reconnects MQTT and hands monitoring to the foreground service.
 */
AppRegistry.registerHeadlessTask(BOOT_HEADLESS_TASK_NAME, () => bootHeadlessTask);

// Register the app
AppRegistry.registerComponent(appName, () => App);
