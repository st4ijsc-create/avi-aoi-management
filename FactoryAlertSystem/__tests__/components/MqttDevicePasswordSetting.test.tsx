/**
 * doc 81 Đợt 5 task G1 — Settings field for the device MQTT password (built-in broker).
 * Oracle: what the user can SEE (rendered text) and what reaches the service mock.
 */
import React from 'react';
import { NativeModules } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../src/context/ThemeContext', () => {
  const { LIGHT_THEME } = jest.requireActual('../../src/utils/constants');
  return { useTheme: () => ({ theme: LIGHT_THEME }) };
});

const mockService = {
  getDeviceInfo: jest.fn(() => ({ deviceId: 'tab-42', deviceName: 'Tab', deviceModel: 'M' })),
  hasLocalBrokerPassword: jest.fn(() => Promise.resolve(false)),
  setLocalBrokerPassword: jest.fn((_pw: string) => Promise.resolve()),
  clearLocalBrokerPassword: jest.fn(() => Promise.resolve()),
  resetAllRetriesExhausted: jest.fn(),
  connect: jest.fn(() => Promise.resolve(true)),
};
jest.mock('../../src/services/mqttService', () => ({
  get mqttService() {
    return mockService; // getter: the import below is hoisted above this const
  },
}));

import MqttDevicePasswordSetting from '../../src/components/MqttDevicePasswordSetting';

const SECRET = 'Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m';

function allText(tree: ReturnType<typeof render>): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as any).SecureCredentialModule = {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
  };
});
afterEach(() => {
  delete (NativeModules as any).SecureCredentialModule;
});

it('shows the device ID the admin screen lists, and "no password" initially', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored'));
  expect(tree.getByTestId('mqtt-device-password-device-id')).toHaveTextContent('Device ID: tab-42');
});

it('Save ⇒ password handed to the service, input emptied, secret never rendered, reconnect started', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored'));
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-save'));
  });
  expect(mockService.setLocalBrokerPassword).toHaveBeenCalledWith(SECRET);
  expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Password stored (secure storage)');
  expect(tree.getByTestId('mqtt-device-password-input').props.value).toBe('');
  expect(allText(tree)).not.toContain(SECRET);
  expect(mockService.resetAllRetriesExhausted).toHaveBeenCalled();
  expect(mockService.connect).toHaveBeenCalled();
});

it('a failed save is shown as an error, never as "stored", and does not reconnect', async () => {
  mockService.setLocalBrokerPassword.mockImplementationOnce(() => Promise.reject(new Error('E_SECURE_WRITE')));
  const tree = render(<MqttDevicePasswordSetting language="vi" />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Chưa có mật khẩu'));
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-save'));
  });
  expect(tree.getByTestId('mqtt-device-password-message')).toHaveTextContent(/Không lưu được mật khẩu/);
  expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Chưa có mật khẩu');
  expect(mockService.connect).not.toHaveBeenCalled();
});

it('no secure storage on the device ⇒ no input at all, an explicit message instead', async () => {
  delete (NativeModules as any).SecureCredentialModule;
  const tree = render(<MqttDevicePasswordSetting language="zh" />);
  expect(tree.getByTestId('mqtt-device-password-unavailable')).toHaveTextContent(/安全存储/);
  expect(tree.queryByTestId('mqtt-device-password-input')).toBeNull();
  await act(async () => {}); // flush the hasLocalBrokerPassword effect
});

it('Clear ⇒ service clears, status goes back to "no password"', async () => {
  mockService.hasLocalBrokerPassword.mockImplementationOnce(() => Promise.resolve(true));
  const tree = render(<MqttDevicePasswordSetting language="en" />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Password stored'));
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-clear'));
  });
  expect(mockService.clearLocalBrokerPassword).toHaveBeenCalled();
  expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored');
});
