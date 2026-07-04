/**
 * Jest Setup File
 */

import '@testing-library/jest-native/extend-expect';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

// Mock Notifee (complete surface used by notificationService/backgroundReliability)
jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn(() => Promise.resolve('channel-id')),
  displayNotification: jest.fn(() => Promise.resolve('notification-id')),
  cancelNotification: jest.fn(() => Promise.resolve()),
  cancelAllNotifications: jest.fn(() => Promise.resolve()),
  setBadgeCount: jest.fn(() => Promise.resolve()),
  onForegroundEvent: jest.fn(() => jest.fn()),
  onBackgroundEvent: jest.fn(),
  requestPermission: jest.fn(() => Promise.resolve({ authorizationStatus: 1 })),
  getNotificationSettings: jest.fn(() => Promise.resolve({ authorizationStatus: 1 })),
  openNotificationSettings: jest.fn(() => Promise.resolve()),
  registerForegroundService: jest.fn(),
  stopForegroundService: jest.fn(() => Promise.resolve()),
  isBatteryOptimizationEnabled: jest.fn(() => Promise.resolve(false)),
  openBatteryOptimizationSettings: jest.fn(() => Promise.resolve()),
  EventType: {
    DISMISSED: 0,
    PRESS: 1,
    ACTION_PRESS: 2,
  },
  AuthorizationStatus: {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  },
  AndroidImportance: {
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
    MIN: 1,
  },
  AndroidVisibility: {
    PRIVATE: 0,
    PUBLIC: 1,
    SECRET: -1,
  },
  AndroidCategory: {
    ALARM: 'alarm',
    CALL: 'call',
    MESSAGE: 'msg',
  },
  AndroidStyle: {
    BIGPICTURE: 0,
    BIGTEXT: 1,
    INBOX: 2,
    MESSAGING: 3,
  },
}));

// Mock MQTT
jest.mock('mqtt', () => ({
  connect: jest.fn(() => ({
    on: jest.fn(),
    subscribe: jest.fn(),
    publish: jest.fn(),
    end: jest.fn(),
    connected: false,
  })),
}));

// Mock react-native modules
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

// Mock Vibration
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Vibration = {
    vibrate: jest.fn(),
    cancel: jest.fn(),
  };
  return RN;
});

// Global test timeout
jest.setTimeout(10000);

// Silence console warnings in tests
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('Animated: `useNativeDriver`')
  ) {
    return;
  }
  originalWarn.apply(console, args);
};
