/**
 * Secure credential store — the device MQTT password for the built-in (Aedes) broker.
 *
 * doc 81 Đợt 5 task G1 (items 4+9). The admin screen (`mqttClient.rotatePassword`) shows a device's new
 * password ONCE; the technician types it into this tablet's Settings. The value is kept ONLY in the
 * native SecureCredentialModule (Android Keystore AES-GCM, android/.../SecureCredentialModule.kt).
 *
 * Ruling R-5-a (doc 81 Đợt 5 G1 fix scan) — the password is PINNED to the broker endpoint it was saved for
 * (scheme from protocol+TLS, host, port), stored together in ONE secure entry. mqttService sends it only to
 * that exact endpoint, from connect() and testConnection() alike; any other endpoint (edited address, port,
 * TLS, protocol, or a "Test connection" override) gets no password. An entry without a valid pin (older or
 * corrupt format) counts as "no password".
 *
 * doc 81 Đợt 7 J2 — the certificate FINGERPRINT (SHA-256) of the built-in broker's TLS certificate is saved in the
 * SAME entry (format v2), entered by the technician next to the password. A v2 entry pins the password to MQTT over
 * TCP+TLS with exactly that certificate: brokerTransport.devicePasswordFor sends it ONLY over the pinned TLS socket
 * with that fingerprint — never over plain TCP/WS. Changing the fingerprint means saving the password again (an
 * attacker with the tablet in hand cannot re-point a stored password at their own certificate). A v2 entry with a
 * malformed fingerprint or a non-TLS endpoint counts as "no password" (fail closed). v1 entries (no fingerprint)
 * keep working as before during the migration.
 *
 * Fail-closed: when the native module is absent (iOS build without it, old native shell, tests) the
 * password is NOT written anywhere — `setMqttDevicePassword` throws SecureStorageUnavailableError. There is
 * deliberately NO fallback to AsyncStorage (plaintext JSON on disk).
 */
import { NativeModules } from 'react-native';

export const MQTT_DEVICE_PASSWORD_KEY = 'mqtt_device_password';

/** Upper bound accepted from the UI (server-issued passwords are 32 chars base64url). */
export const MQTT_DEVICE_PASSWORD_MAX_LEN = 256;

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super('Secure storage is not available on this device');
    this.name = 'SecureStorageUnavailableError';
  }
}

/** The broker endpoint a stored password belongs to. */
export interface MqttBrokerEndpoint {
  host: string;
  port: number;
  protocol: 'tcp' | 'ws';
  tls: boolean;
}

export interface StoredMqttDeviceCredential {
  password: string;
  endpoint: MqttBrokerEndpoint;
  /** doc 81 Đợt 7 J2 — SHA-256 of the broker certificate (64 lowercase hex), or null (v1 entry: no TLS pin). */
  certSha256: string | null;
}

/** doc 81 Đợt 7 J2 — same rule as pinnedTlsSocket.normalizeCertFingerprint / PinnedTlsCore (Kotlin). */
function normaliseFingerprint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.replace(/[\s:]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** A certificate fingerprint pins the password to MQTT over TCP + TLS (the only transport that can pin). */
function endpointCanPin(e: MqttBrokerEndpoint): boolean {
  return e.protocol === 'tcp' && e.tls === true;
}

/**
 * Endpoint identity of a broker config. null when it cannot be pinned (no host, no valid port) — then no
 * password is ever sent. Host comparison is case/edge-whitespace insensitive; nothing else is normalised.
 */
export function brokerEndpointOf(cfg: {
  brokerAddress?: string | null;
  port?: number | string | null;
  protocol?: string | null;
  useSSL?: boolean | null;
} | null | undefined): MqttBrokerEndpoint | null {
  if (!cfg) return null;
  const host = String(cfg.brokerAddress ?? '').trim().toLowerCase();
  const port = Number(cfg.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port, protocol: cfg.protocol === 'tcp' ? 'tcp' : 'ws', tls: cfg.useSSL === true };
}

export function sameBrokerEndpoint(a: MqttBrokerEndpoint | null, b: MqttBrokerEndpoint | null): boolean {
  return !!a && !!b && a.host === b.host && a.port === b.port && a.protocol === b.protocol && a.tls === b.tls;
}

/** Display form, e.g. `ws://192.168.1.10:8883` (no secret involved). */
export function brokerEndpointLabel(e: MqttBrokerEndpoint): string {
  const scheme = e.protocol === 'tcp' ? (e.tls ? 'mqtts' : 'mqtt') : e.tls ? 'wss' : 'ws';
  return `${scheme}://${e.host}:${e.port}`;
}

function parseStored(raw: unknown): StoredMqttDeviceCredential | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || (o.v !== 1 && o.v !== 2) || typeof o.password !== 'string' || !o.password) return null;
    const e = o.endpoint;
    const endpoint = brokerEndpointOf(
      e ? { brokerAddress: e.host, port: e.port, protocol: e.protocol, useSSL: e.tls } : null,
    );
    if (!endpoint || e.tls !== endpoint.tls || e.protocol !== endpoint.protocol || e.host !== endpoint.host) {
      return null;
    }
    if (o.v === 1) return { password: o.password, endpoint, certSha256: null };
    // v2 (doc 81 Đợt 7 J2): a well-formed fingerprint on a TCP+TLS endpoint, or nothing at all.
    const certSha256 = normaliseFingerprint(o.certSha256);
    if (!certSha256 || certSha256 !== o.certSha256 || !endpointCanPin(endpoint)) return null;
    return { password: o.password, endpoint, certSha256 };
  } catch {
    return null; // a bare string (pre-pin format) or garbage ⇒ unpinned ⇒ treated as not stored
  }
}

interface SecureCredentialNative {
  setItem(key: string, value: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<boolean>;
  /** G fix 3 — "none" | "ok" | "unavailable" | "reentry"; absent on older native shells. */
  getStatus?(key: string): Promise<string>;
  /**
   * final wave P-G2 — the stored value read WITHOUT counting toward the native 5-failure streak (null = nothing stored or
   * not readable right now; never throws for a storage error, never deletes). For the Settings screen; absent on older shells.
   */
  peekItem?(key: string): Promise<string | null>;
}

/**
 * doc 81 Đợt 5 G fix 3 (R2-3) — what Settings shows about the stored password, WITHOUT reading it into JS:
 *   unsupported — no secure module; none — nothing stored; ok — stored and readable;
 *   unavailable — stored but not readable right now (key store busy…; kept, retried on the next connect);
 *   reentry — stored but unreadable for good or 5 times in a row: the user must enter it again (never deleted silently).
 */
export type MqttDeviceCredentialStatus = 'unsupported' | 'none' | 'ok' | 'unavailable' | 'reentry';

/** Read lazily so a late-registered module (and tests) are honoured. */
function nativeModule(): SecureCredentialNative | null {
  const m = (NativeModules as Record<string, unknown>).SecureCredentialModule as
    | Partial<SecureCredentialNative>
    | undefined;
  if (
    m &&
    typeof m.setItem === 'function' &&
    typeof m.getItem === 'function' &&
    typeof m.removeItem === 'function'
  ) {
    return m as SecureCredentialNative;
  }
  return null;
}

export function isSecureStorageAvailable(): boolean {
  return nativeModule() !== null;
}

/** Normalise what a technician typed or pasted: edge whitespace (copy/paste) is never part of a password. */
export function normaliseMqttDevicePassword(raw: string): string {
  return String(raw ?? '').trim();
}

/**
 * The stored credential (password + the endpoint it is pinned to), or null when none is stored, the store is
 * unavailable/unreadable, or the entry has no valid pin. Never throws (a connect must not crash on a storage
 * error — it simply connects without a password, and the broker decides).
 */
export async function getMqttDeviceCredential(): Promise<StoredMqttDeviceCredential | null> {
  const m = nativeModule();
  if (!m) return null;
  try {
    return parseStored(await m.getItem(MQTT_DEVICE_PASSWORD_KEY));
  } catch {
    return null;
  }
}

/**
 * doc 81 Đợt 5 final wave P-G2 — the stored credential for DISPLAY (Settings shows the endpoint it is pinned to): read with
 * the native UNCOUNTED read, so opening Settings never adds to the failure streak that leads to "re-enter the password"
 * (only connect()'s reads count). Never throws; null when nothing readable is stored. An older native shell without
 * peekItem falls back to the counted read (the JS ships with the native code, so that shell does not exist in practice).
 */
export async function getMqttDeviceCredentialForDisplay(): Promise<StoredMqttDeviceCredential | null> {
  const m = nativeModule();
  if (!m) return null;
  if (typeof m.peekItem !== 'function') return getMqttDeviceCredential();
  try {
    return parseStored(await m.peekItem(MQTT_DEVICE_PASSWORD_KEY));
  } catch {
    return null;
  }
}

export async function getMqttDeviceCredentialStatus(): Promise<MqttDeviceCredentialStatus> {
  const m = nativeModule();
  if (!m) return 'unsupported';
  try {
    if (typeof m.getStatus === 'function') {
      const st = await m.getStatus(MQTT_DEVICE_PASSWORD_KEY);
      return st === 'none' || st === 'ok' || st === 'unavailable' || st === 'reentry' ? st : 'unavailable';
    }
    // older native shell: derive from a read (a rejection never removes anything)
    return (await getMqttDeviceCredential()) ? 'ok' : 'none';
  } catch {
    return 'unavailable';
  }
}

/** Backwards-compatible accessor: the stored password regardless of its pin (tests / diagnostics only). */
export async function getMqttDevicePassword(): Promise<string | null> {
  return (await getMqttDeviceCredential())?.password ?? null;
}

/** Thrown when a certificate fingerprint is missing, malformed, or given for an endpoint that cannot pin it. */
export class CertFingerprintError extends Error {
  constructor(readonly code: 'CERT_FP_INVALID' | 'CERT_FP_NEEDS_TCP_TLS' | 'CERT_FP_REQUIRED') {
    super(
      code === 'CERT_FP_INVALID'
        ? 'The certificate fingerprint must be 64 hex digits (SHA-256)'
        : code === 'CERT_FP_NEEDS_TCP_TLS'
          ? 'A certificate fingerprint needs MQTT over TCP with TLS on'
          : 'MQTT over TCP with TLS needs the broker certificate fingerprint',
    );
    this.name = 'CertFingerprintError';
  }
}

/**
 * Store (or, for an empty value, remove) the device password PINNED to `endpoint` (and, doc 81 Đợt 7 J2, to the
 * broker certificate `certFingerprint` — required for a TCP+TLS endpoint, refused for any other). Throws
 * SecureStorageUnavailableError when the secure store is missing, an Error when there is no pinnable
 * endpoint, CertFingerprintError for a missing/malformed/misplaced fingerprint, and rethrows a native write failure —
 * the caller must not report success. Returns what was stored (null when removed).
 */
export async function setMqttDevicePassword(
  raw: string,
  endpoint: MqttBrokerEndpoint | null,
  certFingerprint?: string | null,
): Promise<StoredMqttDeviceCredential | null> {
  const m = nativeModule();
  if (!m) throw new SecureStorageUnavailableError();
  const value = normaliseMqttDevicePassword(raw);
  if (value.length > MQTT_DEVICE_PASSWORD_MAX_LEN) {
    throw new Error(`MQTT password too long (max ${MQTT_DEVICE_PASSWORD_MAX_LEN})`);
  }
  if (!value) {
    await m.removeItem(MQTT_DEVICE_PASSWORD_KEY);
    return null;
  }
  const pin = brokerEndpointOf(
    endpoint ? { brokerAddress: endpoint.host, port: endpoint.port, protocol: endpoint.protocol, useSSL: endpoint.tls } : null,
  );
  if (!pin) throw new Error('Broker address/port not configured — cannot pin the MQTT password');
  const fpRaw = String(certFingerprint ?? '').trim();
  if (fpRaw) {
    const certSha256 = normaliseFingerprint(fpRaw);
    if (!certSha256) throw new CertFingerprintError('CERT_FP_INVALID');
    if (!endpointCanPin(pin)) throw new CertFingerprintError('CERT_FP_NEEDS_TCP_TLS');
    await m.setItem(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify({ v: 2, password: value, endpoint: pin, certSha256 }));
    return { password: value, endpoint: pin, certSha256 };
  }
  // TCP+TLS without a fingerprint could never be used (no pinned socket without a pin) — refuse instead of storing it.
  if (endpointCanPin(pin)) throw new CertFingerprintError('CERT_FP_REQUIRED');
  await m.setItem(MQTT_DEVICE_PASSWORD_KEY, JSON.stringify({ v: 1, password: value, endpoint: pin }));
  return { password: value, endpoint: pin, certSha256: null };
}

export async function clearMqttDevicePassword(): Promise<void> {
  const m = nativeModule();
  if (!m) throw new SecureStorageUnavailableError();
  await m.removeItem(MQTT_DEVICE_PASSWORD_KEY);
}
