/**
 * doc 81 Đợt 5 task G1 (items 4+9) — the tablet sends its MQTT password to the built-in broker.
 *
 * Oracles independent of the product code:
 *   · the fake native module is a plain Map — what is "stored" is read straight from it;
 *   · what is sent to the broker is read from the arguments of the (jest-mocked) `mqtt.connect`,
 *     i.e. the exact IClientOptions the real connect() hands to mqtt.js;
 *   · AsyncStorage (plaintext on disk) is inspected for the secret through its own mock API.
 */
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import mqtt from 'mqtt';

// ESM-only native socket package (Android TCP path only — never reached here: Platform.OS is 'ios' in jest).
jest.mock('react-native-tcp-socket', () => ({ __esModule: true, default: { createConnection: jest.fn() } }));

import {
  MQTT_DEVICE_PASSWORD_KEY,
  SecureStorageUnavailableError,
  clearMqttDevicePassword,
  getMqttDevicePassword,
  isSecureStorageAvailable,
  setMqttDevicePassword,
} from '../../src/services/secureCredentialStore';

const SECRET = 'Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m'; // shape of a server-issued password (base64url, 32)

function installFakeSecureModule(opts: { failWrite?: boolean } = {}) {
  const store = new Map<string, string>();
  (NativeModules as any).SecureCredentialModule = {
    setItem: jest.fn(async (k: string, v: string) => {
      if (opts.failWrite) throw new Error('E_SECURE_WRITE');
      store.set(k, v);
      return true;
    }),
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
      return true;
    }),
  };
  return store;
}

function removeFakeSecureModule() {
  delete (NativeModules as any).SecureCredentialModule;
}

async function asyncStorageContains(needle: string): Promise<boolean> {
  const keys = await AsyncStorage.getAllKeys();
  const pairs = await AsyncStorage.multiGet(keys);
  return pairs.some(([k, v]) => k.includes(needle) || (v ?? '').includes(needle));
}

afterEach(async () => {
  removeFakeSecureModule();
  await AsyncStorage.clear();
});

describe('secureCredentialStore', () => {
  it('stores, reads back and clears the password ONLY in the native secure module', async () => {
    const store = installFakeSecureModule();
    expect(isSecureStorageAvailable()).toBe(true);

    const saved = await setMqttDevicePassword(`  ${SECRET}\n`); // pasted with edge whitespace
    expect(saved).toBe(SECRET);
    expect(store.get(MQTT_DEVICE_PASSWORD_KEY)).toBe(SECRET);
    expect(await getMqttDevicePassword()).toBe(SECRET);
    expect(await asyncStorageContains(SECRET)).toBe(false);

    await clearMqttDevicePassword();
    expect(store.has(MQTT_DEVICE_PASSWORD_KEY)).toBe(false);
    expect(await getMqttDevicePassword()).toBeNull();
  });

  it('an empty value removes the stored password', async () => {
    const store = installFakeSecureModule();
    await setMqttDevicePassword(SECRET);
    expect(await setMqttDevicePassword('   ')).toBeNull();
    expect(store.has(MQTT_DEVICE_PASSWORD_KEY)).toBe(false);
  });

  it('fail-closed: no secure module ⇒ refuse to save, never fall back to AsyncStorage', async () => {
    removeFakeSecureModule();
    expect(isSecureStorageAvailable()).toBe(false);
    await expect(setMqttDevicePassword(SECRET)).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    await expect(clearMqttDevicePassword()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    expect(await getMqttDevicePassword()).toBeNull();
    expect(await asyncStorageContains(SECRET)).toBe(false);
  });

  it('a native write failure is NOT reported as success', async () => {
    installFakeSecureModule({ failWrite: true });
    await expect(setMqttDevicePassword(SECRET)).rejects.toThrow('E_SECURE_WRITE');
    expect(await getMqttDevicePassword()).toBeNull();
  });

  it('rejects an absurdly long value', async () => {
    installFakeSecureModule();
    await expect(setMqttDevicePassword('x'.repeat(257))).rejects.toThrow(/too long/);
  });
});

describe('mqttService → built-in broker CONNECT carries the stored device password', () => {
  // Loaded lazily so the singleton's constructor runs inside the jest environment set up above.
  const { mqttService } = require('../../src/services/mqttService');
  const connectMock = mqtt.connect as unknown as jest.Mock;

  const LOCAL = { brokerAddress: '192.168.10.20', port: 8883, protocol: 'ws', useSSL: false };
  const EXTERNAL = {
    brokerAddress: 'broker.hivemq.com',
    port: 8884,
    protocol: 'ws',
    useSSL: true,
    username: 'cloud-user',
    password: 'cloud-pass',
  };

  async function connectAndCaptureOptions(cfg: Record<string, unknown>) {
    connectMock.mockClear();
    mqttService.configure(cfg);
    mqttService.resetAllRetriesExhausted();
    (mqttService as any).lastConnectionAttempt = 0; // bypass the 2 s anti-hammer throttle
    void mqttService.connect().catch(() => {});
    const t0 = Date.now();
    while (connectMock.mock.calls.length === 0 && Date.now() - t0 < 3000) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(connectMock).toHaveBeenCalledTimes(1);
    const options = connectMock.mock.calls[0][1];
    mqttService.disconnect();
    return options;
  }

  it('local broker + stored password ⇒ CONNECT has username deviceId:name:model AND that password', async () => {
    installFakeSecureModule();
    await mqttService.setLocalBrokerPassword(SECRET);
    const opts = await connectAndCaptureOptions(LOCAL);
    const deviceId = mqttService.getDeviceInfo()?.deviceId;
    expect(deviceId).toBeTruthy();
    expect(String(opts.username).split(':')[0]).toBe(deviceId);
    expect(opts.password).toBe(SECRET);
  });

  it('a password stored in an EARLIER app session (only in the secure store) is sent after a restart', async () => {
    const store = installFakeSecureModule();
    store.set(MQTT_DEVICE_PASSWORD_KEY, SECRET); // written by a previous process
    (mqttService as any).localBrokerPassword = null; // fresh process: nothing cached in memory
    const opts = await connectAndCaptureOptions(LOCAL);
    expect(opts.password).toBe(SECRET);
  });

  it('local broker, no stored password ⇒ CONNECT has NO password (unchanged legacy behaviour)', async () => {
    installFakeSecureModule();
    const opts = await connectAndCaptureOptions(LOCAL);
    expect(opts.password).toBeUndefined();
  });

  it('a password saved AFTER the first connect is used by the next connect (no restart needed)', async () => {
    installFakeSecureModule();
    expect((await connectAndCaptureOptions(LOCAL)).password).toBeUndefined();
    await mqttService.setLocalBrokerPassword(SECRET);
    expect((await connectAndCaptureOptions(LOCAL)).password).toBe(SECRET);
    await mqttService.clearLocalBrokerPassword();
    expect((await connectAndCaptureOptions(LOCAL)).password).toBeUndefined();
  });

  it('external broker ⇒ the device password is NEVER sent there (only the broker config credentials)', async () => {
    installFakeSecureModule();
    await mqttService.setLocalBrokerPassword(SECRET);
    const opts = await connectAndCaptureOptions(EXTERNAL);
    expect(opts.password).toBe('cloud-pass');
    expect(opts.password).not.toBe(SECRET);
  });

  it('hasLocalBrokerPassword reflects the secure store', async () => {
    installFakeSecureModule();
    expect(await mqttService.hasLocalBrokerPassword()).toBe(false);
    await mqttService.setLocalBrokerPassword(SECRET);
    expect(await mqttService.hasLocalBrokerPassword()).toBe(true);
  });
});
