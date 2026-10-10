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
  getLocalBrokerPasswordEndpoint: jest.fn((): Promise<any> => Promise.resolve(null)),
  setLocalBrokerPassword: jest.fn((_pw: string, _endpoint?: unknown) => Promise.resolve()),
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
const CFG = { brokerAddress: '192.168.10.20', port: 8883, protocol: 'ws' as const, useSSL: false };
const PIN = { host: '192.168.10.20', port: 8883, protocol: 'ws', tls: false };

function allText(tree: ReturnType<typeof render>): string {
  return JSON.stringify(tree.toJSON());
}

// G fix 1 (review finding 6): TouchableOpacity's press animation (Animated timing on jest timers) emits React
// "not wrapped in act(...)" warnings after the assertions — swallow exactly those, let any other console.error through.
const realConsoleError = console.error;
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act(')) return;
  realConsoleError(...(args as []));
});
afterAll(() => consoleErrorSpy.mockRestore());

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
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={CFG} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored'));
  expect(tree.getByTestId('mqtt-device-password-device-id')).toHaveTextContent('Device ID: tab-42');
});

it('Save ⇒ password handed to the service, input emptied, secret never rendered, reconnect started', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={CFG} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored'));
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-save'));
  });
  // R-5-a: pinned to the endpoint shown in Settings at the moment of saving
  expect(mockService.setLocalBrokerPassword).toHaveBeenCalledWith(SECRET, PIN);
  expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Password stored (secure storage) for ws://192.168.10.20:8883');
  expect(tree.getByTestId('mqtt-device-password-input').props.value).toBe('');
  expect(allText(tree)).not.toContain(SECRET);
  expect(mockService.resetAllRetriesExhausted).toHaveBeenCalled();
  expect(mockService.connect).toHaveBeenCalled();
});

it('a failed save is shown as an error, never as "stored", and does not reconnect', async () => {
  mockService.setLocalBrokerPassword.mockImplementationOnce(() => Promise.reject(new Error('E_SECURE_WRITE')));
  const tree = render(<MqttDevicePasswordSetting language="vi" mqttConfig={CFG} />);
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
  const tree = render(<MqttDevicePasswordSetting language="zh" mqttConfig={CFG} />);
  expect(tree.getByTestId('mqtt-device-password-unavailable')).toHaveTextContent(/安全存储/);
  expect(tree.queryByTestId('mqtt-device-password-input')).toBeNull();
  await act(async () => {}); // flush the hasLocalBrokerPassword effect
});

it('Clear ⇒ service clears, status goes back to "no password"', async () => {
  mockService.getLocalBrokerPasswordEndpoint.mockImplementationOnce(() => Promise.resolve(PIN));
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={CFG} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Password stored'));
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-clear'));
  });
  expect(mockService.clearLocalBrokerPassword).toHaveBeenCalled();
  expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored');
});

it('R-5-a: the configured endpoint differs from the pin ⇒ "belongs to <old> — re-enter", password never shown', async () => {
  mockService.getLocalBrokerPasswordEndpoint.mockImplementationOnce(() => Promise.resolve(PIN));
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={{ ...CFG, brokerAddress: '10.6.6.6' }} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-mismatch')).toBeTruthy());
  expect(tree.getByTestId('mqtt-device-password-mismatch')).toHaveTextContent(
    /belongs to ws:\/\/192\.168\.10\.20:8883 .*NOT sent to the configured broker \(ws:\/\/10\.6\.6\.6:8883\)\. Re-enter/,
  );
  expect(allText(tree)).not.toContain(SECRET);
});

it('R-5-a: same endpoint ⇒ no mismatch warning', async () => {
  mockService.getLocalBrokerPasswordEndpoint.mockImplementationOnce(() => Promise.resolve(PIN));
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={CFG} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('Password stored'));
  expect(tree.queryByTestId('mqtt-device-password-mismatch')).toBeNull();
});

it('plaintext connection (ws://, no TLS) ⇒ explicit "crosses the LAN in clear" warning', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={CFG} />);
  expect(tree.getByTestId('mqtt-device-password-plaintext')).toHaveTextContent(/NOT encrypted.*in clear.*TLS is recommended/);
  await act(async () => {});
});

it('wss:// ⇒ no plaintext warning', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={{ ...CFG, useSSL: true }} />);
  expect(tree.queryByTestId('mqtt-device-password-plaintext')).toBeNull();
  await act(async () => {});
});

it('no broker address configured ⇒ Save disabled, nothing stored', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={{ ...CFG, brokerAddress: '' }} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-no-endpoint')).toBeTruthy());
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-save'));
  });
  expect(mockService.setLocalBrokerPassword).not.toHaveBeenCalled();
});
