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
  brokerEndpointOf,
  clearMqttDevicePassword,
  getMqttDeviceCredential,
  getMqttDevicePassword,
  sameBrokerEndpoint,
  isSecureStorageAvailable,
  setMqttDevicePassword,
} from '../../src/services/secureCredentialStore';

const SECRET = 'Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m'; // shape of a server-issued password (base64url, 32)
const PIN = { host: '192.168.10.20', port: 8883, protocol: 'ws' as const, tls: false };

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

// G fix 1 (review finding 6): the service logs a lot — keep the jest output pristine; the log test reads these spies.
// Installed at module load (the mqttService singleton logs from its constructor, at require time) and restored afterAll.
const CONSOLE_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const;
const consoleSpies = CONSOLE_METHODS.map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
afterAll(() => consoleSpies.forEach((s) => s.mockRestore()));

afterEach(async () => {
  removeFakeSecureModule();
  await AsyncStorage.clear();
});

describe('secureCredentialStore', () => {
  it('stores, reads back and clears the password ONLY in the native secure module', async () => {
    const store = installFakeSecureModule();
    expect(isSecureStorageAvailable()).toBe(true);

    const saved = await setMqttDevicePassword(`  ${SECRET}\n`, PIN); // pasted with edge whitespace
    expect(saved).toEqual({ password: SECRET, endpoint: PIN });
    // persisted as ONE entry: the password together with the endpoint it is pinned to (R-5-a)
    expect(JSON.parse(store.get(MQTT_DEVICE_PASSWORD_KEY)!)).toEqual({ v: 1, password: SECRET, endpoint: PIN });
    expect(await getMqttDevicePassword()).toBe(SECRET);
    expect(await asyncStorageContains(SECRET)).toBe(false);

    await clearMqttDevicePassword();
    expect(store.has(MQTT_DEVICE_PASSWORD_KEY)).toBe(false);
    expect(await getMqttDevicePassword()).toBeNull();
  });

  it('an empty value removes the stored password', async () => {
    const store = installFakeSecureModule();
    await setMqttDevicePassword(SECRET, PIN);
    expect(await setMqttDevicePassword('   ', PIN)).toBeNull();
    expect(store.has(MQTT_DEVICE_PASSWORD_KEY)).toBe(false);
  });

  it('fail-closed: no secure module ⇒ refuse to save, never fall back to AsyncStorage', async () => {
    removeFakeSecureModule();
    expect(isSecureStorageAvailable()).toBe(false);
    await expect(setMqttDevicePassword(SECRET, PIN)).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    await expect(clearMqttDevicePassword()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    expect(await getMqttDevicePassword()).toBeNull();
    expect(await asyncStorageContains(SECRET)).toBe(false);
  });

  it('a native write failure is NOT reported as success', async () => {
    installFakeSecureModule({ failWrite: true });
    await expect(setMqttDevicePassword(SECRET, PIN)).rejects.toThrow('E_SECURE_WRITE');
    expect(await getMqttDevicePassword()).toBeNull();
  });

  it('rejects an absurdly long value', async () => {
    installFakeSecureModule();
    await expect(setMqttDevicePassword('x'.repeat(257), PIN)).rejects.toThrow(/too long/);
  });

  it('R-5-a: no pinnable endpoint (no host / bad port) ⇒ refuse to save', async () => {
    const store = installFakeSecureModule();
    await expect(setMqttDevicePassword(SECRET, null)).rejects.toThrow(/cannot pin/);
    await expect(setMqttDevicePassword(SECRET, { ...PIN, port: 0 })).rejects.toThrow(/cannot pin/);
    await expect(setMqttDevicePassword(SECRET, { ...PIN, host: '  ' })).rejects.toThrow(/cannot pin/);
    expect(store.has(MQTT_DEVICE_PASSWORD_KEY)).toBe(false);
  });

  it('R-5-a: an entry without a valid pin (bare pre-pin string, garbage) counts as "no password"', async () => {
    const store = installFakeSecureModule();
    store.set(MQTT_DEVICE_PASSWORD_KEY, SECRET);
    expect(await getMqttDeviceCredential()).toBeNull();
    store.set(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify({ v: 1, password: SECRET }));
    expect(await getMqttDeviceCredential()).toBeNull();
    store.set(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify({ v: 1, password: SECRET, endpoint: { ...PIN, port: 'x' } }));
    expect(await getMqttDeviceCredential()).toBeNull();
  });

  it('endpoint identity: host case/edge-space insensitive; port, protocol and TLS all count', () => {
    const base = brokerEndpointOf({ brokerAddress: '192.168.10.20', port: 8883, protocol: 'ws', useSSL: false });
    expect(base).toEqual(PIN);
    expect(sameBrokerEndpoint(base, brokerEndpointOf({ brokerAddress: ' 192.168.10.20 ', port: '8883', protocol: 'ws', useSSL: false }))).toBe(true);
    expect(sameBrokerEndpoint(base, brokerEndpointOf({ brokerAddress: '192.168.10.21', port: 8883, protocol: 'ws', useSSL: false }))).toBe(false);
    expect(sameBrokerEndpoint(base, brokerEndpointOf({ brokerAddress: '192.168.10.20', port: 8884, protocol: 'ws', useSSL: false }))).toBe(false);
    expect(sameBrokerEndpoint(base, brokerEndpointOf({ brokerAddress: '192.168.10.20', port: 8883, protocol: 'tcp', useSSL: false }))).toBe(false);
    expect(sameBrokerEndpoint(base, brokerEndpointOf({ brokerAddress: '192.168.10.20', port: 8883, protocol: 'ws', useSSL: true }))).toBe(false);
    expect(sameBrokerEndpoint(null, null)).toBe(false);
    expect(sameBrokerEndpoint(base, null)).toBe(false);
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

  /** Technician flow: Settings shows the built-in broker LOCAL, then the password is typed and saved. */
  async function saveWhileConfigured(cfg: Record<string, unknown>, pw: string) {
    mqttService.configure(cfg);
    await mqttService.setLocalBrokerPassword(pw);
  }

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
    await saveWhileConfigured(LOCAL, SECRET);
    const opts = await connectAndCaptureOptions(LOCAL);
    const deviceId = mqttService.getDeviceInfo()?.deviceId;
    expect(deviceId).toBeTruthy();
    expect(String(opts.username).split(':')[0]).toBe(deviceId);
    expect(opts.password).toBe(SECRET);
  });

  it('a password stored in an EARLIER app session (only in the secure store) is sent after a restart', async () => {
    const store = installFakeSecureModule();
    // Written by a previous process, in the persisted format: the password PINNED to its broker endpoint.
    store.set(
      MQTT_DEVICE_PASSWORD_KEY,
      JSON.stringify({ v: 1, password: SECRET, endpoint: { host: '192.168.10.20', port: 8883, protocol: 'ws', tls: false } }),
    );
    (mqttService as any).localBrokerCredential = null; // fresh process: nothing cached in memory
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
    await saveWhileConfigured(LOCAL, SECRET);
    expect((await connectAndCaptureOptions(LOCAL)).password).toBe(SECRET);
    await mqttService.clearLocalBrokerPassword();
    expect((await connectAndCaptureOptions(LOCAL)).password).toBeUndefined();
  });

  it('external broker ⇒ the device password is NEVER sent there (only the broker config credentials)', async () => {
    installFakeSecureModule();
    await saveWhileConfigured(LOCAL, SECRET);
    const opts = await connectAndCaptureOptions(EXTERNAL);
    expect(opts.password).toBe('cloud-pass');
    expect(opts.password).not.toBe(SECRET);
  });

  it('hasLocalBrokerPassword reflects the secure store', async () => {
    installFakeSecureModule();
    expect(await mqttService.hasLocalBrokerPassword()).toBe(false);
    await saveWhileConfigured(LOCAL, SECRET);
    expect(await mqttService.hasLocalBrokerPassword()).toBe(true);
  });
});

/**
 * doc 81 Đợt 5 task G1 fix scan (ruling R-5-a) — the stored device password must never follow a
 * configured/overridden host. Both paths below leaked it on 08bdd8ea3.
 */
describe('R-5-a — the device password is PINNED to the broker endpoint it was saved for', () => {
  const { mqttService } = require('../../src/services/mqttService');
  const connectMock = mqtt.connect as unknown as jest.Mock;

  const LOCAL = { brokerAddress: '192.168.10.20', port: 8883, protocol: 'ws', useSSL: false };
  const ATTACKER = { ...LOCAL, brokerAddress: '10.6.6.6' }; // also an IP ⇒ also "local broker" mode

  async function pinToLocal() {
    installFakeSecureModule();
    mqttService.configure(LOCAL);
    await mqttService.setLocalBrokerPassword(SECRET);
  }

  async function connectWith(cfg: Record<string, unknown>) {
    connectMock.mockClear();
    mqttService.configure(cfg);
    mqttService.resetAllRetriesExhausted();
    (mqttService as any).lastConnectionAttempt = 0;
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

  /** "Test connection" with an override config; the fake client fails at once so the promise settles. */
  async function testConnectionWith(override: Record<string, unknown>) {
    connectMock.mockClear();
    connectMock.mockImplementationOnce(() => {
      const handlers: Record<string, (e?: any) => void> = {};
      const client: any = {
        on: jest.fn((ev: string, cb: (e?: any) => void) => {
          handlers[ev] = cb;
          if (ev === 'error') setImmediate(() => cb(new Error('refused')));
          return client;
        }),
        end: jest.fn((_f?: boolean, _o?: unknown, cb?: () => void) => cb && cb()),
        subscribe: jest.fn(),
        publish: jest.fn(),
        connected: false,
      };
      return client;
    });
    await mqttService.testConnection(override);
    expect(connectMock).toHaveBeenCalledTimes(1);
    return { url: connectMock.mock.calls[0][0], options: connectMock.mock.calls[0][1] };
  }

  it('(a) Test connection pointed at another host ⇒ the password is NOT sent there', async () => {
    await pinToLocal();
    mqttService.configure(LOCAL);
    const { url, options } = await testConnectionWith({ brokerAddress: '10.6.6.6' });
    expect(String(url)).toContain('10.6.6.6');
    expect(options.password).toBeUndefined();
  });

  it('(a) Test connection with another PORT or TLS setting on the same host ⇒ not sent either', async () => {
    await pinToLocal();
    mqttService.configure(LOCAL);
    expect((await testConnectionWith({ port: 9001 })).options.password).toBeUndefined();
    expect((await testConnectionWith({ useSSL: true })).options.password).toBeUndefined();
    expect((await testConnectionWith({ protocol: 'tcp', port: 1883 })).options.password).toBeUndefined();
  });

  it('(a) Test connection whose override equals the pinned endpoint ⇒ sent (legitimate re-test)', async () => {
    await pinToLocal();
    mqttService.configure(LOCAL);
    expect((await testConnectionWith({ ...LOCAL })).options.password).toBe(SECRET);
  });

  it('(b) broker address edited to another host ⇒ connect() does NOT send the password', async () => {
    await pinToLocal();
    const opts = await connectWith(ATTACKER);
    expect(opts.password).toBeUndefined();
  });

  it('(b) port or TLS edited ⇒ connect() does NOT send it; back to the pinned endpoint ⇒ sent again', async () => {
    await pinToLocal();
    expect((await connectWith({ ...LOCAL, port: 9001 })).password).toBeUndefined();
    expect((await connectWith({ ...LOCAL, useSSL: true })).password).toBeUndefined();
    // a target that cannot be identified (port unset ⇒ URL falls back to a default port) never matches a pin
    expect((await connectWith({ ...LOCAL, port: 0 })).password).toBeUndefined();
    expect((await connectWith(LOCAL)).password).toBe(SECRET);
  });

  it('the pin is exposed to the UI as an endpoint only — never the password or its length', async () => {
    await pinToLocal();
    const pinned = await mqttService.getLocalBrokerPasswordEndpoint();
    expect(pinned).toEqual({ host: '192.168.10.20', port: 8883, protocol: 'ws', tls: false });
    expect(JSON.stringify(pinned)).not.toContain(SECRET);
  });

  it('nothing logged mentions the password or its length', async () => {
    const spies = CONSOLE_METHODS.map((m) => console[m] as unknown as jest.Mock);
    spies.forEach((s) => s.mockClear());
    // G fix 1 (review finding 2): String.raw so `\b` is a regex word boundary, not a backspace character.
    const LEN = SECRET.length;
    const lengthLeak = new RegExp(String.raw`\b${LEN}\b.*(char|len)|(char|len).*\b${LEN}\b`, 'i');
    // the detector itself must fire on a real length leak and stay quiet on a harmless line
    expect(lengthLeak.test(`[MQTT] device password length: ${LEN}`)).toBe(true);
    expect(lengthLeak.test(`[MQTT] password (${LEN} chars) set`)).toBe(true);
    expect(lengthLeak.test('[MQTT] device password: sent')).toBe(false);
    {
      await pinToLocal();
      await connectWith(LOCAL);
      await connectWith(ATTACKER);
      mqttService.configure(LOCAL);
      await testConnectionWith({ brokerAddress: '10.6.6.6' });
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));
      for (const line of logged) {
        expect(line).not.toContain(SECRET);
        expect(line).not.toMatch(lengthLeak);
      }
      // the spies really captured the service's logging (otherwise the loop above would be vacuous)
      expect(logged.some((l) => l.includes('device password:'))).toBe(true);
    }
  });
});
