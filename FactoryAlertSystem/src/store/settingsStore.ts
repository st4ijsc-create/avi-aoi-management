/**
 * Factory Alert System - Settings Store
 * Zustand store quản lý cài đặt ứng dụng
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Settings,
  MqttConfig,
  NotificationConfig,
  AppSettings,
  NetworkMonitorConfig,
  SettingsStoreState,
  SettingsStoreActions,
} from '../types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_MQTT_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_APP_SETTINGS,
  DEFAULT_NETWORK_MONITOR_CONFIG,
  STORAGE_KEYS,
} from '../utils/constants';

// Lazy getter to avoid circular dependency (mqttService imports settingsStore)
const getMqttService = () => require('../services/mqttService').mqttService;

// Combined store type
type SettingsStore = SettingsStoreState & SettingsStoreActions;

/**
 * Settings Store với Zustand
 */
export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Initial state
  settings: DEFAULT_SETTINGS,
  isLoading: false,

  /**
   * Update MQTT config
   */
  updateMqttConfig: (config: Partial<MqttConfig>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        mqtt: {
          ...state.settings.mqtt,
          ...config,
        },
      },
    }));

    // Auto save
    get().saveSettings();
  },

  /**
   * Update Notification config
   */
  updateNotificationConfig: (config: Partial<NotificationConfig>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        notifications: {
          ...state.settings.notifications,
          ...config,
        },
      },
    }));

    // Auto save
    get().saveSettings();
  },

  /**
   * Update App settings
   */
  updateAppSettings: (appSettings: Partial<AppSettings>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        app: {
          ...state.settings.app,
          ...appSettings,
        },
      },
    }));

    // Auto save
    get().saveSettings();
  },

  /**
   * Update Network Monitor config
   */
  updateNetworkMonitorConfig: (config: Partial<NetworkMonitorConfig>) => {
    set((state) => ({
      settings: {
        ...state.settings,
        networkMonitor: {
          ...(state.settings.networkMonitor || DEFAULT_NETWORK_MONITOR_CONFIG),
          ...config,
        },
      },
    }));

    // Auto save
    get().saveSettings();
  },

  /**
   * Load settings từ storage
   */
  loadSettings: async () => {
    set({ isLoading: true });

    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);

      if (data) {
        const savedSettings = JSON.parse(data) as Partial<Settings>;

        // Merge với defaults để đảm bảo có đủ fields
        const mqttConfig = { ...DEFAULT_MQTT_CONFIG, ...savedSettings.mqtt };
        
        // If username was never saved (empty), use default
        if (!mqttConfig.username) {
          mqttConfig.username = DEFAULT_MQTT_CONFIG.username;
          console.log('[SettingsStore] Using default username (empty saved value)');
        }

        // Merge app settings with defaults
        const appConfig = { ...DEFAULT_APP_SETTINGS, ...savedSettings.app };

        const settings: Settings = {
          mqtt: mqttConfig,
          notifications: { ...DEFAULT_NOTIFICATION_CONFIG, ...savedSettings.notifications },
          app: appConfig,
          networkMonitor: { ...DEFAULT_NETWORK_MONITOR_CONFIG, ...savedSettings.networkMonitor },
        };

        set({ settings, isLoading: false });
        console.log('[SettingsStore] Settings loaded successfully');
        console.log('[SettingsStore] MQTT broker:', mqttConfig.brokerAddress + ':' + mqttConfig.port);
        console.log('[SettingsStore] API URL:', appConfig.apiBaseUrl);

        // Sync health check settings to mqttService
        getMqttService().updateHealthCheckSettings({
          healthCheckInterval: appConfig.mqttHealthCheckInterval,
          retryMaxAttempts: appConfig.mqttRetryMaxAttempts,
          retryInterval: appConfig.mqttRetryInterval,
        });
      } else {
        set({ isLoading: false });
        console.log('[SettingsStore] No saved settings, using defaults');
      }
    } catch (error) {
      console.error('[SettingsStore] Load error:', error);
      set({ isLoading: false });
    }
  },

  /**
   * Save settings to storage
   */
  saveSettings: async () => {
    try {
      const { settings } = get();
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      console.log('[SettingsStore] Settings saved');
    } catch (error) {
      console.error('[SettingsStore] Save error:', error);
    }
  },

  /**
   * Reset to defaults
   */
  resetToDefaults: () => {
    set({ settings: DEFAULT_SETTINGS });
    get().saveSettings();
    console.log('[SettingsStore] Reset to defaults');
  },
}));

// ============================================
// SELECTORS
// ============================================

/**
 * Select all settings
 */
export const selectSettings = (state: SettingsStore) => state.settings;

/**
 * Select MQTT config
 */
export const selectMqttConfig = (state: SettingsStore) => state.settings.mqtt;

/**
 * Select Notification config
 */
export const selectNotificationConfig = (state: SettingsStore) => state.settings.notifications;

/**
 * Select App settings
 */
export const selectAppSettings = (state: SettingsStore) => state.settings.app;

/**
 * Select Network Monitor config
 */
export const selectNetworkMonitorConfig = (state: SettingsStore) => state.settings.networkMonitor;

/**
 * Select language
 */
export const selectLanguage = (state: SettingsStore) => state.settings.app.language;

/**
 * Select theme
 */
export const selectTheme = (state: SettingsStore) => state.settings.app.theme;

/**
 * Select loading state
 */
export const selectIsLoading = (state: SettingsStore) => state.isLoading;

export default useSettingsStore;
