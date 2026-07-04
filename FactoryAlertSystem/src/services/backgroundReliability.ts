/**
 * Factory Alert System - Background Reliability Service (MB2/MB3, doc 27 Đợt 6)
 *
 * Problem: notificationService.startForegroundService() existed but had ZERO
 * call sites, so when the app went to background / screen off, Android froze
 * the JS runtime and the MQTT connection died → missed alerts.
 *
 * This service (pattern ported from the legacy android-mqtt-app, which used
 * react-native-background-actions started from HomeScreen; here we use the
 * Notifee foreground service already declared in AndroidManifest.xml with
 * foregroundServiceType="dataSync"):
 *
 *  - AppState → 'background'/'inactive': start the Notifee foreground service
 *    (persistent low-priority notification "Đang giám sát cảnh báo nhà máy")
 *    which keeps the JS runtime + MQTT connection + reconnect timers alive.
 *  - AppState → 'active': stop the foreground service (the visible app itself
 *    keeps the runtime alive; no need for the persistent notification).
 *  - Keep-alive is ON by default; it can be toggled at runtime via
 *    setKeepAliveEnabled() (persisted in AsyncStorage under its own key so we
 *    do not touch the settings store owned by other modules).
 *  - Battery-optimization helpers are exported for the Settings UI to place a
 *    button (see isBatteryOptimizationEnabled / openBatteryOptimizationSettings).
 *
 * Boot path (MB3): BootReceiver.kt starts BootHeadlessTaskService after
 * BOOT_COMPLETED which runs bootHeadlessTask() (registered in index.js as
 * "FactoryAlertBootTask"): load settings → connect MQTT → start the foreground
 * service so monitoring survives beyond the headless-task window.
 *
 * Wiring: mqttService.startHealthCheck() calls init() (idempotent) — i.e. the
 * AppState listener is registered as soon as the MQTT lifecycle becomes active,
 * without requiring any screen/App.tsx change.
 */

import { AppState, AppStateStatus, NativeEventSubscription, Platform } from 'react-native';
import notifee from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Lazy getters — avoid circular imports (mqttService ⇄ backgroundReliability)
const getNotificationService = () =>
  require('./notificationService').notificationService;
const getMqttService = () => require('./mqttService').mqttService;

/** AsyncStorage key for the keep-alive preference (own key — settings store untouched). */
export const KEEP_ALIVE_STORAGE_KEY = '@factory_alert_keep_alive_in_background';

/** Name of the headless JS task registered in index.js (must match BootHeadlessTaskService.kt). */
export const BOOT_HEADLESS_TASK_NAME = 'FactoryAlertBootTask';

let foregroundServiceRunnerRegistered = false;

/**
 * Register the Notifee foreground-service runner. Notifee requires this to be
 * called OUTSIDE the component lifecycle (index.js) before any notification
 * with `asForegroundService: true` is displayed. The returned never-resolving
 * promise is what keeps the service (and thus the JS runtime) alive until
 * notifee.stopForegroundService() is called.
 */
export function registerForegroundServiceRunner(): void {
  if (foregroundServiceRunnerRegistered || Platform.OS !== 'android') return;
  try {
    notifee.registerForegroundService(() => {
      console.log('[BackgroundReliability] Foreground service runner started');
      return new Promise<void>(() => {
        // Intentionally never resolves — service lives until stopForegroundService().
      });
    });
    foregroundServiceRunnerRegistered = true;
  } catch (error) {
    console.error('[BackgroundReliability] registerForegroundService error:', error);
  }
}

class BackgroundReliabilityService {
  private static instance: BackgroundReliabilityService;

  private initialized = false;
  private appStateSubscription: NativeEventSubscription | null = null;
  private currentAppState: AppStateStatus = 'active';
  private fgsActive = false;
  /** Default TRUE: monitoring app — background keep-alive is the whole point. */
  private keepAliveEnabled = true;

  private constructor() {}

  public static getInstance(): BackgroundReliabilityService {
    if (!BackgroundReliabilityService.instance) {
      BackgroundReliabilityService.instance = new BackgroundReliabilityService();
    }
    return BackgroundReliabilityService.instance;
  }

  /**
   * Idempotent init — registers the AppState listener and loads the persisted
   * keep-alive preference. Called from mqttService.startHealthCheck() so it
   * activates automatically with the MQTT lifecycle.
   */
  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.currentAppState = AppState.currentState ?? 'active';
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);

    // Fire-and-forget preference load (default stays true on any failure).
    this.loadKeepAlivePreference().catch(() => {});

    console.log('[BackgroundReliability] Initialized (AppState listener registered)');
  }

  /** Tear down listener — used by tests; safe to call repeatedly. */
  public destroy(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.initialized = false;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public isForegroundServiceActive(): boolean {
    return this.fgsActive;
  }

  // ============================================
  // KEEP-ALIVE PREFERENCE
  // ============================================

  public isKeepAliveEnabled(): boolean {
    return this.keepAliveEnabled;
  }

  public async loadKeepAlivePreference(): Promise<boolean> {
    try {
      const stored = await AsyncStorage.getItem(KEEP_ALIVE_STORAGE_KEY);
      if (stored !== null) {
        this.keepAliveEnabled = stored === 'true';
      }
    } catch (error) {
      console.warn('[BackgroundReliability] Could not load keep-alive preference:', error);
    }
    return this.keepAliveEnabled;
  }

  /**
   * Toggle background keep-alive. Persisted under KEEP_ALIVE_STORAGE_KEY.
   * If disabled while the foreground service is running, it is stopped.
   */
  public async setKeepAliveEnabled(enabled: boolean): Promise<void> {
    this.keepAliveEnabled = enabled;
    try {
      await AsyncStorage.setItem(KEEP_ALIVE_STORAGE_KEY, String(enabled));
    } catch (error) {
      console.warn('[BackgroundReliability] Could not persist keep-alive preference:', error);
    }
    if (!enabled && this.fgsActive) {
      await this.stopForegroundService();
    }
    // If enabled while already in background, start immediately.
    if (enabled && this.currentAppState !== 'active') {
      await this.onEnterBackground();
    }
  }

  // ============================================
  // APPSTATE HANDLING
  // ============================================

  /** Public for unit tests — drives the same code path as the real listener. */
  public handleAppStateChange = (nextAppState: AppStateStatus): void => {
    const prev = this.currentAppState;
    this.currentAppState = nextAppState;

    if (prev === 'active' && /inactive|background/.test(nextAppState)) {
      void this.onEnterBackground();
    } else if (/inactive|background/.test(prev) && nextAppState === 'active') {
      void this.onEnterForeground();
    }
  };

  private async onEnterBackground(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!this.keepAliveEnabled) {
      console.log('[BackgroundReliability] Background — keep-alive disabled, not starting FGS');
      return;
    }

    // Only keep alive when there is something to keep alive: an MQTT session
    // that is connected or actively trying to (re)connect. A user who manually
    // disconnected (status 'disconnected') should not get a persistent notification.
    let mqttStatus = 'disconnected';
    try {
      mqttStatus = getMqttService().getConnectionStatus();
    } catch (error) {
      console.warn('[BackgroundReliability] Could not read MQTT status:', error);
    }
    if (mqttStatus === 'disconnected') {
      console.log('[BackgroundReliability] Background — MQTT disconnected, not starting FGS');
      return;
    }

    await this.startForegroundService();
  }

  private async onEnterForeground(): Promise<void> {
    if (this.fgsActive) {
      await this.stopForegroundService();
    }
  }

  // ============================================
  // FOREGROUND SERVICE CONTROL
  // ============================================

  public async startForegroundService(): Promise<void> {
    if (Platform.OS !== 'android' || this.fgsActive) return;
    try {
      await getNotificationService().startForegroundService();
      this.fgsActive = true;
      console.log('[BackgroundReliability] Foreground service STARTED (MQTT keep-alive)');
    } catch (error) {
      console.error('[BackgroundReliability] Failed to start foreground service:', error);
    }
  }

  public async stopForegroundService(): Promise<void> {
    if (!this.fgsActive) return;
    try {
      await getNotificationService().stopForegroundService();
      console.log('[BackgroundReliability] Foreground service STOPPED');
    } catch (error) {
      console.error('[BackgroundReliability] Failed to stop foreground service:', error);
    } finally {
      this.fgsActive = false;
    }
  }

  // ============================================
  // BATTERY OPTIMIZATION (helper for Settings UI)
  // ============================================

  /**
   * True when the OS battery optimization (Doze app standby) is still enabled
   * for this app — i.e. the user has NOT granted the exemption yet.
   * Android only; resolves false elsewhere.
   */
  public async isBatteryOptimizationEnabled(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      return await notifee.isBatteryOptimizationEnabled();
    } catch (error) {
      console.warn('[BackgroundReliability] isBatteryOptimizationEnabled error:', error);
      return false;
    }
  }

  /**
   * Opens the system "ignore battery optimizations" settings screen for this
   * app (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission is already declared
   * in the manifest). Returns true if the screen was opened.
   *
   * UI: the Settings screen should show a button when
   * isBatteryOptimizationEnabled() === true and call this on press.
   */
  public async openBatteryOptimizationSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      await notifee.openBatteryOptimizationSettings();
      return true;
    } catch (error) {
      console.error('[BackgroundReliability] openBatteryOptimizationSettings error:', error);
      return false;
    }
  }
}

export const backgroundReliability = BackgroundReliabilityService.getInstance();

// ============================================
// BOOT HEADLESS TASK (MB3)
// ============================================

/**
 * Headless JS entry executed by BootHeadlessTaskService.kt after device boot
 * (registered in index.js via AppRegistry.registerHeadlessTask). No UI exists
 * at this point — App.tsx has NOT mounted — so this function wires a minimal
 * alert → notification pipeline itself. When the user later opens the app,
 * App.tsx re-registers its richer onMessage handler and takes over seamlessly.
 */
export async function bootHeadlessTask(taskData?: { reason?: string }): Promise<void> {
  console.log('[BackgroundReliability] Boot headless task started:', taskData?.reason ?? 'unknown');

  try {
    const notificationService = getNotificationService();
    await notificationService.initialize();

    // Load persisted settings (broker address, topics, notification filters).
    const { useSettingsStore } = require('../store/settingsStore');
    await useSettingsStore.getState().loadSettings();
    const settings = useSettingsStore.getState().settings;

    if (!settings?.mqtt?.brokerAddress) {
      console.log('[BackgroundReliability] Boot task: no broker configured — nothing to do');
      return;
    }
    if (settings?.app?.autoReconnect === false) {
      console.log('[BackgroundReliability] Boot task: autoReconnect disabled — not connecting');
      return;
    }

    const mqttService = getMqttService();
    mqttService.configure(settings.mqtt);

    // Minimal headless alert pipeline: store + push notification.
    mqttService.setOnMessage((alert: any) => {
      try {
        const { alertFilterService } = require('./alertFilterService');
        const current = useSettingsStore.getState().settings;
        if (current.notifications.enabled) {
          const { useAlertStore } = require('../store/alertStore');
          useAlertStore.getState().addAlert(alert);
        }
        if (alertFilterService.shouldShowNotification(alert, current.notifications)) {
          notificationService.showAlert(alert).catch(() => {});
        }
      } catch (error) {
        console.error('[BackgroundReliability] Headless onMessage error:', error);
      }
    });

    // Start the foreground service FIRST so the JS runtime survives past the
    // 60s headless window even if the first connect attempt is slow/failing
    // (the reconnect loop then keeps running under the FGS).
    backgroundReliability.init();
    // We are booting in background: mark state so a later foreground open stops the FGS.
    await backgroundReliability.startForegroundService();

    await mqttService.connect().catch((error: unknown) => {
      console.warn(
        '[BackgroundReliability] Boot connect failed (reconnect loop takes over):',
        error instanceof Error ? error.message : error,
      );
    });

    console.log('[BackgroundReliability] Boot headless task finished — monitoring handed to FGS');
  } catch (error) {
    console.error('[BackgroundReliability] Boot headless task error:', error);
  }
}

export default backgroundReliability;
