/**
 * Unit Tests - Background Reliability Service (MB2/MB3, doc 27 Đợt 6)
 *
 * Verifies the AppState-driven foreground-service lifecycle with mocked
 * Notifee/notificationService/mqttService:
 *   • init() registers the AppState listener exactly once (idempotent);
 *   • active → background starts the FGS when keep-alive is on and MQTT is live;
 *   • background → active stops the FGS;
 *   • no FGS when MQTT is 'disconnected' or keep-alive is off;
 *   • setKeepAliveEnabled(false) persists and stops a running FGS;
 *   • battery-optimization helpers delegate to notifee;
 *   • bootHeadlessTask: no-broker → no connect; configured broker → connect + FGS.
 */
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';

jest.mock('@notifee/react-native', () => ({
  registerForegroundService: jest.fn(),
  stopForegroundService: jest.fn(() => Promise.resolve()),
  displayNotification: jest.fn(() => Promise.resolve('id')),
  cancelNotification: jest.fn(() => Promise.resolve()),
  isBatteryOptimizationEnabled: jest.fn(() => Promise.resolve(true)),
  openBatteryOptimizationSettings: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/services/notificationService', () => ({
  notificationService: {
    initialize: jest.fn(() => Promise.resolve()),
    startForegroundService: jest.fn(() => Promise.resolve()),
    stopForegroundService: jest.fn(() => Promise.resolve()),
    showAlert: jest.fn(() => Promise.resolve('nid')),
  },
}));

jest.mock('../../src/services/mqttService', () => ({
  mqttService: {
    getConnectionStatus: jest.fn(() => 'connected'),
    configure: jest.fn(),
    setOnMessage: jest.fn(),
    connect: jest.fn(() => Promise.resolve(true)),
  },
}));

// settingsStore is only required inside bootHeadlessTask — mock it lazily-safe.
const mockSettingsState: any = {
  loadSettings: jest.fn(() => Promise.resolve()),
  settings: {
    mqtt: { brokerAddress: '', port: 1883, topics: [] },
    app: { autoReconnect: true },
    notifications: { enabled: true },
  },
};
jest.mock('../../src/store/settingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));

import {
  backgroundReliability,
  bootHeadlessTask,
  registerForegroundServiceRunner,
  KEEP_ALIVE_STORAGE_KEY,
} from '../../src/services/backgroundReliability';
import { notificationService } from '../../src/services/notificationService';
import { mqttService } from '../../src/services/mqttService';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('BackgroundReliabilityService', () => {
  beforeAll(() => {
    // react-native jest preset defaults Platform.OS to 'ios' — this service is Android-only.
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Normalize singleton state: foreground, FGS off, keep-alive on.
    backgroundReliability.handleAppStateChange('active');
    await flush();
    await backgroundReliability.stopForegroundService();
    await backgroundReliability.setKeepAliveEnabled(true);
    jest.clearAllMocks();
    (mqttService.getConnectionStatus as jest.Mock).mockReturnValue('connected');
  });

  afterEach(() => {
    backgroundReliability.destroy();
  });

  describe('init', () => {
    it('registers the AppState listener once (idempotent)', () => {
      const spy = jest
        .spyOn(AppState, 'addEventListener')
        .mockReturnValue({ remove: jest.fn() } as any);

      backgroundReliability.destroy();
      backgroundReliability.init();
      backgroundReliability.init();
      backgroundReliability.init();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('change', expect.any(Function));
      expect(backgroundReliability.isInitialized()).toBe(true);
      spy.mockRestore();
    });
  });

  describe('AppState transitions', () => {
    it('starts the foreground service on active → background (keep-alive on, MQTT live)', async () => {
      backgroundReliability.handleAppStateChange('background');
      await flush();

      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
      expect(backgroundReliability.isForegroundServiceActive()).toBe(true);
    });

    it('starts the foreground service on active → inactive as well', async () => {
      backgroundReliability.handleAppStateChange('inactive');
      await flush();

      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
    });

    it('stops the foreground service on background → active', async () => {
      backgroundReliability.handleAppStateChange('background');
      await flush();
      expect(backgroundReliability.isForegroundServiceActive()).toBe(true);

      backgroundReliability.handleAppStateChange('active');
      await flush();

      expect(notificationService.stopForegroundService).toHaveBeenCalledTimes(1);
      expect(backgroundReliability.isForegroundServiceActive()).toBe(false);
    });

    it('does NOT start the FGS when MQTT is disconnected (user turned it off)', async () => {
      (mqttService.getConnectionStatus as jest.Mock).mockReturnValue('disconnected');

      backgroundReliability.handleAppStateChange('background');
      await flush();

      expect(notificationService.startForegroundService).not.toHaveBeenCalled();
      expect(backgroundReliability.isForegroundServiceActive()).toBe(false);
    });

    it('starts the FGS while MQTT is reconnecting (status "connecting")', async () => {
      (mqttService.getConnectionStatus as jest.Mock).mockReturnValue('connecting');

      backgroundReliability.handleAppStateChange('background');
      await flush();

      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
    });

    it('does not double-start the FGS on repeated background events', async () => {
      backgroundReliability.handleAppStateChange('background');
      await flush();
      backgroundReliability.handleAppStateChange('active');
      await flush();
      (notificationService.stopForegroundService as jest.Mock).mockClear();
      (notificationService.startForegroundService as jest.Mock).mockClear();

      backgroundReliability.handleAppStateChange('background');
      await flush();
      // background → background (no-op transition)
      backgroundReliability.handleAppStateChange('background');
      await flush();

      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
    });
  });

  describe('keep-alive preference', () => {
    it('defaults to enabled', () => {
      expect(backgroundReliability.isKeepAliveEnabled()).toBe(true);
    });

    it('does NOT start the FGS when keep-alive is disabled', async () => {
      await backgroundReliability.setKeepAliveEnabled(false);

      backgroundReliability.handleAppStateChange('background');
      await flush();

      expect(notificationService.startForegroundService).not.toHaveBeenCalled();
    });

    it('persists the preference to AsyncStorage under its own key', async () => {
      await backgroundReliability.setKeepAliveEnabled(false);
      expect(await AsyncStorage.getItem(KEEP_ALIVE_STORAGE_KEY)).toBe('false');

      await backgroundReliability.setKeepAliveEnabled(true);
      expect(await AsyncStorage.getItem(KEEP_ALIVE_STORAGE_KEY)).toBe('true');
    });

    it('stops a running FGS when keep-alive is disabled mid-background', async () => {
      backgroundReliability.handleAppStateChange('background');
      await flush();
      expect(backgroundReliability.isForegroundServiceActive()).toBe(true);

      await backgroundReliability.setKeepAliveEnabled(false);

      expect(notificationService.stopForegroundService).toHaveBeenCalled();
      expect(backgroundReliability.isForegroundServiceActive()).toBe(false);
    });

    it('loadKeepAlivePreference reads the persisted value', async () => {
      await AsyncStorage.setItem(KEEP_ALIVE_STORAGE_KEY, 'false');
      const result = await backgroundReliability.loadKeepAlivePreference();
      expect(result).toBe(false);
      expect(backgroundReliability.isKeepAliveEnabled()).toBe(false);
    });
  });

  describe('battery optimization helpers (for the Settings UI button)', () => {
    it('isBatteryOptimizationEnabled delegates to notifee', async () => {
      (notifee.isBatteryOptimizationEnabled as jest.Mock).mockResolvedValueOnce(true);
      expect(await backgroundReliability.isBatteryOptimizationEnabled()).toBe(true);
      expect(notifee.isBatteryOptimizationEnabled).toHaveBeenCalled();
    });

    it('openBatteryOptimizationSettings opens the system screen and reports success', async () => {
      expect(await backgroundReliability.openBatteryOptimizationSettings()).toBe(true);
      expect(notifee.openBatteryOptimizationSettings).toHaveBeenCalled();
    });

    it('openBatteryOptimizationSettings reports failure without throwing', async () => {
      (notifee.openBatteryOptimizationSettings as jest.Mock).mockRejectedValueOnce(new Error('nope'));
      expect(await backgroundReliability.openBatteryOptimizationSettings()).toBe(false);
    });
  });

  describe('registerForegroundServiceRunner', () => {
    it('registers the never-resolving runner with notifee (once)', () => {
      registerForegroundServiceRunner();
      registerForegroundServiceRunner();
      expect(notifee.registerForegroundService).toHaveBeenCalledTimes(1);
    });
  });

  describe('bootHeadlessTask (MB3 boot auto-start)', () => {
    it('does nothing when no broker is configured', async () => {
      mockSettingsState.settings.mqtt.brokerAddress = '';

      await bootHeadlessTask({ reason: 'boot' });

      expect(mqttService.connect).not.toHaveBeenCalled();
      expect(notificationService.startForegroundService).not.toHaveBeenCalled();
    });

    it('connects MQTT and starts the FGS when a broker is configured', async () => {
      mockSettingsState.settings.mqtt.brokerAddress = '192.168.1.50';

      await bootHeadlessTask({ reason: 'android.intent.action.BOOT_COMPLETED' });

      expect(notificationService.initialize).toHaveBeenCalled();
      expect(mockSettingsState.loadSettings).toHaveBeenCalled();
      expect(mqttService.configure).toHaveBeenCalledWith(mockSettingsState.settings.mqtt);
      expect(mqttService.setOnMessage).toHaveBeenCalledWith(expect.any(Function));
      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
      expect(mqttService.connect).toHaveBeenCalledTimes(1);
    });

    it('respects autoReconnect=false (does not connect)', async () => {
      mockSettingsState.settings.mqtt.brokerAddress = '192.168.1.50';
      mockSettingsState.settings.app.autoReconnect = false;

      await bootHeadlessTask({ reason: 'boot' });

      expect(mqttService.connect).not.toHaveBeenCalled();
      mockSettingsState.settings.app.autoReconnect = true;
    });

    it('survives a failing first connect (reconnect loop takes over)', async () => {
      mockSettingsState.settings.mqtt.brokerAddress = '192.168.1.50';
      (mqttService.connect as jest.Mock).mockRejectedValueOnce(new Error('broker down'));

      await expect(bootHeadlessTask({ reason: 'boot' })).resolves.toBeUndefined();
      expect(notificationService.startForegroundService).toHaveBeenCalledTimes(1);
    });
  });
});
