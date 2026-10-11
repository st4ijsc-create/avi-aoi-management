/**
 * doc 81 Đợt 7 task J2 — app 1.0.18: MQTT over TLS to the built-in broker with the certificate PINNED by its SHA-256
 * fingerprint, entered next to the device password (still pinned to its endpoint, R-5-a).
 *
 * Oracles independent of the product code:
 *   · what is stored = the fake native secure module's Map;
 *   · what is dialled = the arguments the fake native PinnedTlsSocket / react-native-tcp-socket / mqtt mocks receive;
 *   · what goes on the wire = the base64 handed to the native `write`, decoded here;
 *   · native events are injected through the real DeviceEventEmitter, as the Kotlin module emits them.
 * Platform.OS is set to 'android' (the TCP/TLS transports are Android-only).
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';
import mqtt from 'mqtt';

jest.mock('react-native-tcp-socket', () => ({ __esModule: true, default: { createConnection: jest.fn() } }));
jest.mock('mqtt', () => ({
  connect: jest.fn(() => ({ on: jest.fn(), subscribe: jest.fn(), publish: jest.fn(), end: jest.fn(), connected: false })),
  MqttClient: jest.fn(function (this: any, streamBuilder: unknown, options: unknown) {
    this.streamBuilder = streamBuilder;
    this.options = options;
    this.on = jest.fn(() => this);
    this.end = jest.fn((_f?: boolean, _o?: unknown, cb?: () => void) => cb && cb());
    this.subscribe = jest.fn();
    this.publish = jest.fn();
    this.removeAllListeners = jest.fn();
    this.connected = false;
  }),
}));

import TcpSocket from 'react-native-tcp-socket';
import {
  CertFingerprintError,
  MQTT_DEVICE_PASSWORD_KEY,
  getMqttDeviceCredential,
  setMqttDevicePassword,
} from '../../src/services/secureCredentialStore';
import { devicePasswordFor, planBrokerTransport } from '../../src/services/brokerTransport';
import { PINNED_TLS_EVENT, formatCertFingerprint, normalizeCertFingerprint } from '../../src/services/pinnedTlsSocket';
import { useConnectionStore } from '../../src/store/connectionStore';

const SECRET = 'Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m';
const FP = '3a9f00112233445566778899aabbccddeeff0123456789abcdef1032547698ba';
const FP_DISPLAY = FP.toUpperCase().match(/../g)!.join(':');
const OTHER_FP = 'ff'.repeat(32);
const TLS_EP = { host: '192.168.10.20', port: 8884, protocol: 'tcp' as const, tls: true };
const TLS_CFG = { brokerAddress: '192.168.10.20', port: 8884, protocol: 'tcp', useSSL: true };

const CONSOLE = ['log', 'warn', 'error', 'info', 'debug'] as const;
const spies = CONSOLE.map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
afterAll(() => spies.forEach((s) => s.mockRestore()));

const realOS = Platform.OS;
beforeAll(() => {
  (Platform as any).OS = 'android';
});
afterAll(() => {
  (Platform as any).OS = realOS;
});

function installSecure() {
  const store = new Map<string, string>();
  (NativeModules as any).SecureCredentialModule = {
    setItem: jest.fn(async (k: string, v: string) => { store.set(k, v); return true; }),
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    peekItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    removeItem: jest.fn(async (k: string) => { store.delete(k); return true; }),
  };
  return store;
}
function installPinnedTls() {
  const native = { connect: jest.fn(), write: jest.fn(), close: jest.fn() };
  (NativeModules as any).PinnedTlsSocket = native;
  return native;
}
afterEach(() => {
  delete (NativeModules as any).SecureCredentialModule;
  delete (NativeModules as any).PinnedTlsSocket;
  jest.clearAllMocks();
  useConnectionStore.getState().setError(null);
});

const decodeWrites = (native: { write: jest.Mock }) =>
  Buffer.concat(native.write.mock.calls.map((c) => Buffer.from(c[1], 'base64'))).toString('latin1');

describe('secure store — the fingerprint is saved WITH the password (format v2)', () => {
  it('TCP+TLS endpoint + fingerprint (any form) ⇒ one v2 entry with the normalised fingerprint', async () => {
    const store = installSecure();
    const saved = await setMqttDevicePassword(SECRET, TLS_EP, ` ${FP_DISPLAY} `);
    expect(saved).toEqual({ password: SECRET, endpoint: TLS_EP, certSha256: FP });
    expect(JSON.parse(store.get(MQTT_DEVICE_PASSWORD_KEY)!)).toEqual({ v: 2, password: SECRET, endpoint: TLS_EP, certSha256: FP });
    expect(await getMqttDeviceCredential()).toEqual({ password: SECRET, endpoint: TLS_EP, certSha256: FP });
  });

  it('refuses (stores nothing): malformed fingerprint, fingerprint on a non-TLS/ws endpoint, TCP+TLS without fingerprint', async () => {
    const store = installSecure();
    const codeOf = async (p: Promise<unknown>) => { try { await p; return 'stored'; } catch (e) { return (e as CertFingerprintError).code; } };
    expect(await codeOf(setMqttDevicePassword(SECRET, TLS_EP, FP.slice(1)))).toBe('CERT_FP_INVALID');
    expect(await codeOf(setMqttDevicePassword(SECRET, TLS_EP, FP.replace('a', 'g')))).toBe('CERT_FP_INVALID');
    expect(await codeOf(setMqttDevicePassword(SECRET, { ...TLS_EP, tls: false }, FP))).toBe('CERT_FP_NEEDS_TCP_TLS');
    expect(await codeOf(setMqttDevicePassword(SECRET, { ...TLS_EP, protocol: 'ws' }, FP))).toBe('CERT_FP_NEEDS_TCP_TLS');
    expect(await codeOf(setMqttDevicePassword(SECRET, TLS_EP))).toBe('CERT_FP_REQUIRED');
    expect(await codeOf(setMqttDevicePassword(SECRET, TLS_EP, '   '))).toBe('CERT_FP_REQUIRED');
    expect(store.size).toBe(0);
  });

  it('a v2 entry that is malformed or not TCP+TLS counts as "no password" (fail closed)', async () => {
    const store = installSecure();
    const put = (o: unknown) => store.set(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify(o));
    put({ v: 2, password: SECRET, endpoint: TLS_EP, certSha256: 'nope' });
    expect(await getMqttDeviceCredential()).toBeNull();
    put({ v: 2, password: SECRET, endpoint: TLS_EP, certSha256: FP_DISPLAY }); // not the normalised form ⇒ tampered
    expect(await getMqttDeviceCredential()).toBeNull();
    put({ v: 2, password: SECRET, endpoint: { ...TLS_EP, tls: false }, certSha256: FP });
    expect(await getMqttDeviceCredential()).toBeNull();
    put({ v: 2, password: SECRET, endpoint: TLS_EP });
    expect(await getMqttDeviceCredential()).toBeNull();
    put({ v: 3, password: SECRET, endpoint: TLS_EP, certSha256: FP });
    expect(await getMqttDeviceCredential()).toBeNull();
  });
});

describe('transport plan + password decision (pure)', () => {
  const v2 = { password: SECRET, endpoint: TLS_EP, certSha256: FP };
  const v1Plain = { password: SECRET, endpoint: { ...TLS_EP, port: 1883, tls: false }, certSha256: null };
  const base = { platformOS: 'android', protocol: 'tcp', useSSL: true, host: '192.168.10.20', port: 8884, target: TLS_EP, pinnedTlsAvailable: true };

  it('TCP+TLS ⇒ ONLY the pinned TLS socket, and only with a fingerprint saved for exactly this endpoint', () => {
    expect(planBrokerTransport({ ...base, credential: v2 })).toEqual({ kind: 'pinned-tls', host: '192.168.10.20', port: 8884, pinSha256: FP });
    expect(planBrokerTransport({ ...base, credential: null })).toEqual({ kind: 'refuse', code: 'TLS_PIN_REQUIRED' });
    expect(planBrokerTransport({ ...base, credential: { ...v2, certSha256: null } })).toEqual({ kind: 'refuse', code: 'TLS_PIN_REQUIRED' });
    expect(planBrokerTransport({ ...base, credential: { ...v2, endpoint: { ...TLS_EP, host: '10.6.6.6' } } })).toEqual({ kind: 'refuse', code: 'TLS_PIN_REQUIRED' });
    expect(planBrokerTransport({ ...base, credential: v2, pinnedTlsAvailable: false })).toEqual({ kind: 'refuse', code: 'TLS_PIN_UNSUPPORTED' });
    expect(planBrokerTransport({ ...base, credential: v2, platformOS: 'ios', pinnedTlsAvailable: false })).toEqual({ kind: 'refuse', code: 'TLS_PIN_UNSUPPORTED' });
  });

  it('non-TLS TCP on Android ⇒ plaintext socket (kept until migration); ws/wss ⇒ url', () => {
    expect(planBrokerTransport({ ...base, useSSL: false, port: 1883, credential: null }).kind).toBe('tcp-plain');
    expect(planBrokerTransport({ ...base, useSSL: false, platformOS: 'ios', credential: null }).kind).toBe('url');
    expect(planBrokerTransport({ ...base, protocol: 'websocket', credential: v2 }).kind).toBe('url');
    expect(planBrokerTransport({ ...base, protocol: 'websocket', useSSL: false, credential: v2 }).kind).toBe('url');
  });

  it('★ once a fingerprint is stored, the password goes ONLY over the pinned TLS socket with that fingerprint', () => {
    const pinned = { kind: 'pinned-tls' as const, host: 'h', port: 8884, pinSha256: FP };
    expect(devicePasswordFor(pinned, v2, TLS_EP)).toEqual({ state: 'sent', password: SECRET });
    // every other transport to the very same endpoint identity is refused the password (defence in depth)
    expect(devicePasswordFor({ kind: 'tcp-plain', host: 'h', port: 8884 }, v2, TLS_EP)).toEqual({ state: 'withheld', reason: 'needs-pinned-tls' });
    expect(devicePasswordFor({ kind: 'url' }, v2, TLS_EP)).toEqual({ state: 'withheld', reason: 'needs-pinned-tls' });
    expect(devicePasswordFor({ ...pinned, pinSha256: OTHER_FP }, v2, TLS_EP)).toEqual({ state: 'withheld', reason: 'needs-pinned-tls' });
    expect(devicePasswordFor({ kind: 'refuse', code: 'TLS_PIN_REQUIRED' }, v2, TLS_EP).state).toBe('withheld');
    expect(devicePasswordFor(pinned, v2, { ...TLS_EP, port: 9999 })).toEqual({ state: 'withheld', reason: 'endpoint' });
    expect(devicePasswordFor(pinned, null, TLS_EP)).toEqual({ state: 'none' });
    // v1 (no fingerprint, migration): R-5-a only
    expect(devicePasswordFor({ kind: 'tcp-plain', host: 'h', port: 1883 }, v1Plain, v1Plain.endpoint).state).toBe('sent');
  });
});

describe('mqttService on Android — connect() over the pinned TLS socket', () => {
  const { mqttService } = require('../../src/services/mqttService');
  const MqttClientMock = (mqtt as any).MqttClient as jest.Mock;
  const connectMock = mqtt.connect as unknown as jest.Mock;
  const tcpCreate = (TcpSocket as any).createConnection as jest.Mock;

  async function connectWith(cfg: Record<string, unknown>) {
    mqttService.configure(cfg);
    mqttService.resetAllRetriesExhausted();
    (mqttService as any).lastConnectionAttempt = 0;
    const p = mqttService.connect().then(() => 'ok', (e: any) => e);
    const t0 = Date.now();
    while (MqttClientMock.mock.calls.length + connectMock.mock.calls.length === 0 && Date.now() - t0 < 1500) {
      const settled = await Promise.race([p.then((v: unknown) => ({ v })), new Promise((r) => setTimeout(() => r(null), 5))]);
      if (settled) return { settled: (settled as any).v, client: null, options: null };
    }
    const client = MqttClientMock.mock.instances[0] ?? null;
    return { settled: null, client, options: client ? MqttClientMock.mock.calls[0][1] : connectMock.mock.calls[0]?.[1] };
  }
  afterEach(() => mqttService.disconnect());

  it('★ TCP+TLS with the saved fingerprint ⇒ pinned socket dialled with that pin; CONNECT (with password) held until the certificate is verified', async () => {
    installSecure();
    const native = installPinnedTls();
    mqttService.configure(TLS_CFG);
    await mqttService.setLocalBrokerPassword(SECRET, undefined, FP_DISPLAY);
    const { client, options } = await connectWith(TLS_CFG);
    expect(connectMock).not.toHaveBeenCalled();
    expect(client).toBeTruthy();
    expect(options.password).toBe(SECRET);

    const stream = client.streamBuilder();
    expect(tcpCreate).not.toHaveBeenCalled();
    expect(native.connect).toHaveBeenCalledTimes(1);
    const [id, host, port, pin] = native.connect.mock.calls[0];
    expect([host, port, pin]).toEqual(['192.168.10.20', 8884, FP]);

    // mqtt.js writes the CONNECT before the handshake finished ⇒ nothing reaches the native socket yet
    stream.write(Buffer.from(`CONNECT user pw=${SECRET}`, 'latin1'));
    expect(native.write).not.toHaveBeenCalled();
    // the native side reports the VERIFIED handshake ⇒ the buffered CONNECT goes out, over TLS
    DeviceEventEmitter.emit(PINNED_TLS_EVENT, { id, type: 'connect' });
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(native.write.mock.calls[0][0]).toBe(id);
    expect(decodeWrites(native)).toBe(`CONNECT user pw=${SECRET}`);
    // data back from the broker reaches mqtt.js
    const got: Buffer[] = [];
    stream.on('data', (d: Buffer) => got.push(d));
    DeviceEventEmitter.emit(PINNED_TLS_EVENT, { id, type: 'data', data: Buffer.from([0x20, 0x02, 0x00, 0x00]).toString('base64') });
    expect(Buffer.concat(got)).toEqual(Buffer.from([0x20, 0x02, 0x00, 0x00]));
  });

  it('★ certificate mismatch ⇒ refused, NOTHING written, "CERT_CHANGED" shown', async () => {
    installSecure();
    const native = installPinnedTls();
    mqttService.configure(TLS_CFG);
    await mqttService.setLocalBrokerPassword(SECRET, undefined, FP);
    const { client } = await connectWith(TLS_CFG);
    const setSpy = jest.spyOn(global, 'setTimeout');
    const stream = client.streamBuilder();
    const connectTimer = setSpy.mock.results.map((r) => r.value)[0]; // the wrapper's JS connect timer
    setSpy.mockRestore();
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    const errors: any[] = [];
    stream.on('error', (e: any) => errors.push(e));
    const [id] = native.connect.mock.calls[0];
    stream.write(Buffer.from(`CONNECT pw=${SECRET}`, 'latin1'));
    DeviceEventEmitter.emit(PINNED_TLS_EVENT, { id, type: 'error', code: 'CERT_CHANGED', message: 'broker certificate changed' });
    DeviceEventEmitter.emit(PINNED_TLS_EVENT, { id, type: 'close', hadError: true });
    // a late/forged 'connect' after the close is ignored (the socket is gone)
    DeviceEventEmitter.emit(PINNED_TLS_EVENT, { id, type: 'connect' });
    expect(native.write).not.toHaveBeenCalled();
    expect(errors.map((e) => e.code)).toEqual(['CERT_CHANGED']);
    expect(mqttService.getTlsProblem()).toBe('CERT_CHANGED');
    expect(String(useConnectionStore.getState().error)).toMatch(/^CERT_CHANGED: broker certificate changed/);
    // the close cleared the JS connect timer: no misleading "TCP connection timeout" 30 s later replaces CERT_CHANGED
    expect(connectTimer).toBeTruthy();
    expect(clearSpy.mock.calls.some((c) => c[0] === connectTimer)).toBe(true);
    clearSpy.mockRestore();
    stream.destroy();
  });

  it('★ the password never goes over plain TCP/WS once a fingerprint is set (config edited back to plaintext)', async () => {
    installSecure();
    const native = installPinnedTls();
    mqttService.configure(TLS_CFG);
    await mqttService.setLocalBrokerPassword(SECRET, undefined, FP);
    for (const cfg of [
      { ...TLS_CFG, useSSL: false }, // same host + port, TLS switched off
      { ...TLS_CFG, useSSL: false, port: 1883 },
      { ...TLS_CFG, protocol: 'websocket', useSSL: false, port: 8883 },
      { ...TLS_CFG, protocol: 'websocket', useSSL: true },
    ]) {
      MqttClientMock.mockClear();
      connectMock.mockClear();
      const { options } = await connectWith(cfg);
      expect(options).toBeTruthy();
      expect(options.password).toBeUndefined();
      mqttService.disconnect();
    }
    expect(native.connect).not.toHaveBeenCalled();
  });

  it('TCP+TLS without a fingerprint ⇒ refused before dialling anything (no "trust any certificate" path)', async () => {
    installSecure();
    const native = installPinnedTls();
    const { settled } = await connectWith(TLS_CFG);
    expect(String(settled?.message ?? settled)).toMatch(/^TLS_PIN_REQUIRED/);
    expect(native.connect).not.toHaveBeenCalled();
    expect(tcpCreate).not.toHaveBeenCalled();
    expect(MqttClientMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(mqttService.getTlsProblem()).toBe('TLS_PIN_REQUIRED');
  });

  it('no native pinned-TLS module ⇒ TLS refused (TLS_PIN_UNSUPPORTED), never a plaintext fallback', async () => {
    const store = installSecure();
    store.set(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify({ v: 2, password: SECRET, endpoint: TLS_EP, certSha256: FP }));
    const { settled } = await connectWith(TLS_CFG);
    expect(String(settled?.message ?? settled)).toMatch(/^TLS_PIN_UNSUPPORTED/);
    expect(tcpCreate).not.toHaveBeenCalled();
    expect(MqttClientMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('"Test connection" uses the same pinned TLS path (never mqtt.connect / the tls shim); refused ⇒ false, nothing dialled', async () => {
    installSecure();
    const native = installPinnedTls();
    mqttService.configure(TLS_CFG);
    await mqttService.setLocalBrokerPassword(SECRET, undefined, FP);
    MqttClientMock.mockImplementationOnce(function (this: any, sb: any, opts: any) {
      this.streamBuilder = sb;
      this.options = opts;
      this.on = jest.fn((ev: string, cb: (e?: any) => void) => {
        if (ev === 'error') setTimeout(() => cb(new Error('refused')), 0);
        return this;
      });
      this.end = jest.fn((_f?: boolean, _o?: unknown, cb?: () => void) => cb && cb());
    });
    expect(await mqttService.testConnection(TLS_CFG)).toBe(false);
    expect(connectMock).not.toHaveBeenCalled();
    expect(MqttClientMock).toHaveBeenCalledTimes(1);
    expect(MqttClientMock.mock.calls[0][1].password).toBe(SECRET);
    const testStream = MqttClientMock.mock.instances[0].streamBuilder();
    expect(native.connect.mock.calls[0].slice(1, 4)).toEqual(['192.168.10.20', 8884, FP]);
    testStream.destroy(); // clear the wrapper's JS connect timer

    MqttClientMock.mockClear();
    native.connect.mockClear();
    await mqttService.clearLocalBrokerPassword();
    expect(await mqttService.testConnection(TLS_CFG)).toBe(false);
    expect(MqttClientMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });
});

describe('pinnedTlsSocket helpers + no TLS-bypass anywhere in the app source', () => {
  it('fingerprint normalise/format (same rule as the Kotlin core)', () => {
    expect(normalizeCertFingerprint(FP_DISPLAY)).toBe(FP);
    expect(normalizeCertFingerprint(` ${FP.match(/.{8}/g)!.join(' ')}\n`)).toBe(FP);
    expect(normalizeCertFingerprint(FP.slice(2))).toBeNull();
    expect(normalizeCertFingerprint('a'.repeat(40))).toBeNull(); // SHA-1 length
    expect(normalizeCertFingerprint(null)).toBeNull();
    expect(formatCertFingerprint(FP)).toBe(FP_DISPLAY);
  });

  it('★ census: no option that skips certificate checks in src/ (the Đợt 5 code had two)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js)$/.test(f)) files.push(p);
      }
    };
    walk(path.join(__dirname, '../../src'));
    expect(files.length).toBeGreaterThan(50); // fuse: the walk really saw the source tree
    const hits = files.flatMap((p) => {
      const src = fs.readFileSync(p, 'utf8');
      return [/rejectUnauthorized\s*[:=]\s*false/, /tlsCheckValidity/, /checkServerIdentity\s*[:=]/]
        .filter((re) => re.test(src))
        .map((re) => `${path.relative(path.join(__dirname, '../..'), p)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
