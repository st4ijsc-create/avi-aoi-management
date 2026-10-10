/**
 * Secure credential store — the device MQTT password for the built-in (Aedes) broker.
 *
 * doc 81 Đợt 5 task G1 (items 4+9). The admin screen (`mqttClient.rotatePassword`) shows a device's new
 * password ONCE; the technician types it into this tablet's Settings. The value is kept ONLY in the
 * native SecureCredentialModule (Android Keystore AES-GCM, android/.../SecureCredentialModule.kt).
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

interface SecureCredentialNative {
  setItem(key: string, value: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<boolean>;
}

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
 * The stored password, or null when none is stored, the store is unavailable or unreadable.
 * Never throws (a connect must not crash on a storage error — it simply connects without a password,
 * and the broker decides).
 */
export async function getMqttDevicePassword(): Promise<string | null> {
  const m = nativeModule();
  if (!m) return null;
  try {
    const v = await m.getItem(MQTT_DEVICE_PASSWORD_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Store (or, for an empty value, remove) the device password. Throws SecureStorageUnavailableError when
 * the secure store is missing, and rethrows a native write failure — the caller must not report success.
 * Returns the value actually stored (null when removed).
 */
export async function setMqttDevicePassword(raw: string): Promise<string | null> {
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
  await m.setItem(MQTT_DEVICE_PASSWORD_KEY, value);
  return value;
}

export async function clearMqttDevicePassword(): Promise<void> {
  const m = nativeModule();
  if (!m) throw new SecureStorageUnavailableError();
  await m.removeItem(MQTT_DEVICE_PASSWORD_KEY);
}
