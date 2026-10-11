/**
 * doc 81 Đợt 7 task J2 — Settings: the broker certificate fingerprint next to the device password.
 * Oracle: what the user can SEE and what reaches the service mock (the real component, real connection store).
 */
import React from 'react';
import { NativeModules } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useConnectionStore } from '../../src/store/connectionStore';

jest.mock('../../src/context/ThemeContext', () => {
  const { LIGHT_THEME } = jest.requireActual('../../src/utils/constants');
  return { useTheme: () => ({ theme: LIGHT_THEME }) };
});

const mockService = {
  getDeviceInfo: jest.fn(() => ({ deviceId: 'tab-42', deviceName: 'Tab', deviceModel: 'M' })),
  getLocalBrokerPasswordEndpoint: jest.fn((): Promise<any> => Promise.resolve(null)),
  getLocalBrokerCertPin: jest.fn((): Promise<string | null> => Promise.resolve(null)),
  getLocalBrokerPasswordStatus: jest.fn((): Promise<string> => Promise.resolve('none')),
  setLocalBrokerPassword: jest.fn((..._a: unknown[]) => Promise.resolve()),
  clearLocalBrokerPassword: jest.fn(() => Promise.resolve()),
  resetAllRetriesExhausted: jest.fn(),
  connect: jest.fn(() => Promise.resolve(true)),
};
jest.mock('../../src/services/mqttService', () => ({
  get mqttService() {
    return mockService;
  },
}));

import MqttDevicePasswordSetting from '../../src/components/MqttDevicePasswordSetting';

const SECRET = 'Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m';
const FP = '3a9f00112233445566778899aabbccddeeff0123456789abcdef1032547698ba';
const FP_DISPLAY = FP.toUpperCase().match(/../g)!.join(':');
const TLS_CFG = { brokerAddress: '192.168.10.20', port: 8884, protocol: 'tcp' as const, useSSL: true };
const TLS_PIN = { host: '192.168.10.20', port: 8884, protocol: 'tcp', tls: true };
const WS_CFG = { brokerAddress: '192.168.10.20', port: 8883, protocol: 'websocket' as const, useSSL: false };

const realConsoleError = console.error;
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act(')) return;
  realConsoleError(...(args as []));
});
afterAll(() => consoleErrorSpy.mockRestore());

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as any).SecureCredentialModule = { setItem: jest.fn(), getItem: jest.fn(), removeItem: jest.fn() };
  (NativeModules as any).PinnedTlsSocket = { connect: jest.fn(), write: jest.fn(), close: jest.fn() };
  useConnectionStore.getState().setError(null);
});
afterEach(() => {
  delete (NativeModules as any).SecureCredentialModule;
  delete (NativeModules as any).PinnedTlsSocket;
});

const save = async (tree: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId('mqtt-device-password-save'));
  });
};

it('TCP+TLS: password + fingerprint ⇒ both handed to the service (normalised), inputs emptied, pinned fingerprint shown', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={TLS_CFG} />);
  await waitFor(() => expect(tree.getByTestId('mqtt-device-password-status')).toHaveTextContent('No password stored'));
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  fireEvent.changeText(tree.getByTestId('mqtt-device-cert-fp-input'), ` ${FP_DISPLAY.toLowerCase()} `);
  await save(tree);
  expect(mockService.setLocalBrokerPassword).toHaveBeenCalledWith(SECRET, TLS_PIN, FP);
  expect(tree.getByTestId('mqtt-device-password-input').props.value).toBe('');
  expect(tree.getByTestId('mqtt-device-cert-fp-input').props.value).toBe('');
  expect(tree.getByTestId('mqtt-device-cert-pinned')).toHaveTextContent(FP_DISPLAY);
  expect(tree.getByTestId('mqtt-device-password-pinned-tls')).toHaveTextContent(/encrypted \(TLS, certificate pinned/);
  expect(tree.queryByTestId('mqtt-device-password-plaintext')).toBeNull();
  expect(JSON.stringify(tree.toJSON())).not.toContain(SECRET);
  expect(mockService.connect).toHaveBeenCalled();
});

it('TCP+TLS without a fingerprint ⇒ Save disabled with "needs the fingerprint"; malformed fingerprint ⇒ Save disabled', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={TLS_CFG} />);
  await act(async () => {});
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  expect(tree.getByTestId('mqtt-device-cert-fp-missing')).toHaveTextContent(/needs the broker certificate fingerprint/);
  await save(tree);
  fireEvent.changeText(tree.getByTestId('mqtt-device-cert-fp-input'), FP.slice(4));
  expect(tree.getByTestId('mqtt-device-cert-fp-error')).toHaveTextContent(/exactly 64 hex digits/);
  await save(tree);
  expect(mockService.setLocalBrokerPassword).not.toHaveBeenCalled();
});

it('a fingerprint on a ws:// (non-TLS) broker ⇒ "only for TCP with TLS", Save disabled; without it the old flow is unchanged', async () => {
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={WS_CFG} />);
  await act(async () => {});
  fireEvent.changeText(tree.getByTestId('mqtt-device-password-input'), SECRET);
  fireEvent.changeText(tree.getByTestId('mqtt-device-cert-fp-input'), FP);
  expect(tree.getByTestId('mqtt-device-cert-fp-error')).toHaveTextContent(/only used for TCP with TLS/);
  await save(tree);
  expect(mockService.setLocalBrokerPassword).not.toHaveBeenCalled();
  fireEvent.changeText(tree.getByTestId('mqtt-device-cert-fp-input'), '');
  await save(tree);
  expect(mockService.setLocalBrokerPassword).toHaveBeenCalledWith(SECRET, { host: '192.168.10.20', port: 8883, protocol: 'ws', tls: false });
});

it('★ certificate mismatch reported by the connection ⇒ "certificate CHANGED … nothing was sent" (vi/en/zh)', async () => {
  mockService.getLocalBrokerPasswordEndpoint.mockImplementation(() => Promise.resolve(TLS_PIN));
  mockService.getLocalBrokerCertPin.mockImplementation(() => Promise.resolve(FP));
  for (const [lang, re] of [['en', /certificate has CHANGED.*NOTHING was sent/], ['vi', /Chứng chỉ broker đã THAY ĐỔI/], ['zh', /代理证书已更改/]] as const) {
    useConnectionStore.getState().setError(null);
    const tree = render(<MqttDevicePasswordSetting language={lang} mqttConfig={TLS_CFG} />);
    await act(async () => {});
    expect(tree.queryByTestId('mqtt-device-cert-changed')).toBeNull();
    act(() => useConnectionStore.getState().setError('CERT_CHANGED: broker certificate changed — the fingerprint does not match'));
    expect(tree.getByTestId('mqtt-device-cert-changed')).toHaveTextContent(re);
    tree.unmount();
  }
  mockService.getLocalBrokerPasswordEndpoint.mockImplementation(() => Promise.resolve(null));
  mockService.getLocalBrokerCertPin.mockImplementation(() => Promise.resolve(null));
});

it('TCP+TLS on a device without the pinned-TLS module ⇒ says TLS is not used (never "encrypted")', async () => {
  delete (NativeModules as any).PinnedTlsSocket;
  const tree = render(<MqttDevicePasswordSetting language="en" mqttConfig={TLS_CFG} />);
  await act(async () => {});
  expect(tree.getByTestId('mqtt-device-password-plaintext')).toHaveTextContent(/no certificate-pinned TLS/);
  expect(tree.queryByTestId('mqtt-device-password-pinned-tls')).toBeNull();
});
