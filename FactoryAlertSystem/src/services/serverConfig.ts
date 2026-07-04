/**
 * Factory Alert System - Server Config (doc 27 MB4)
 *
 * SINGLE source of truth for "which server does this app talk to".
 * There is NO baked-in default any more — the old hardcoded customer LAN IP
 * (192.168.8.7) was removed from every service. A missing configuration
 * returns null and the App gates on the first-run Onboarding screen instead
 * of silently calling a stranger's network.
 *
 * Persistence: the values live inside the existing settings store
 * (settings.app.apiBaseUrl / apiKey + settings.mqtt.brokerAddress / port),
 * persisted by settingsStore in AsyncStorage under STORAGE_KEYS.SETTINGS —
 * so every install that ever saved a server address keeps working unchanged
 * (automatic migration path), while fresh installs land on onboarding.
 */

import { useSettingsStore } from '../store/settingsStore';

export interface ServerConfigInput {
  serverUrl: string;
  apiKey?: string;
  mqttHost?: string;
  mqttPort?: number;
}

export interface TestConnectionResult {
  reachable: boolean;   // TCP/HTTP round-trip worked
  authOk: boolean;      // health endpoint accepted our credentials
  status?: number;
  message: string;
}

/** Normalize a user-entered server URL (adds http://, strips trailing slashes). */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const cleaned = withScheme.replace(/\/+$/, '');
  // Minimal sanity: scheme://host — reject empty hosts and whitespace
  if (!/^https?:\/\/[^\s/]+/i.test(cleaned)) return null;
  return cleaned;
}

/** Extract the hostname from a server URL — used to prefill the MQTT broker host. */
export function deriveMqttHostFromUrl(url: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/i.exec((url || '').trim());
  return m ? m[1] : null;
}

/**
 * The configured API base URL, or null when the app has never been configured.
 * NEVER returns a hardcoded fallback address.
 */
export function getServerBaseUrl(): string | null {
  const url = useSettingsStore.getState().settings.app.apiBaseUrl;
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

/** Base URL or throw — for call sites that build URLs inside try/catch. */
export function requireServerBaseUrl(): string {
  const url = getServerBaseUrl();
  if (!url) {
    throw new Error('Server chưa được cấu hình — mở màn hình thiết lập / Server not configured');
  }
  return url;
}

export function getConfiguredApiKey(): string {
  return useSettingsStore.getState().settings.app.apiKey || '';
}

export function getMqttBroker(): { host: string | null; port: number } {
  const mqtt = useSettingsStore.getState().settings.mqtt;
  const host = (mqtt.brokerAddress || '').trim();
  return { host: host ? host : null, port: mqtt.port || 1883 };
}

/**
 * Onboarding gate: the app counts as configured when EITHER channel has a
 * target (API base URL or MQTT broker host). Existing installs that persisted
 * a server address before this change pass automatically (migration path);
 * fresh installs (both empty defaults) are gated to onboarding.
 */
export function isServerConfigured(): boolean {
  return getServerBaseUrl() !== null || getMqttBroker().host !== null;
}

/**
 * Persist a server configuration (from onboarding or Settings).
 * Writes through the settings store, which auto-saves to AsyncStorage.
 */
export function saveServerConfig(input: ServerConfigInput): void {
  const normalized = normalizeServerUrl(input.serverUrl);
  if (!normalized) {
    throw new Error('Server URL không hợp lệ / invalid server URL');
  }
  const store = useSettingsStore.getState();
  store.updateAppSettings({
    apiBaseUrl: normalized,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey.trim() } : {}),
  });
  const mqttHost = (input.mqttHost || '').trim() || deriveMqttHostFromUrl(normalized) || '';
  if (mqttHost) {
    store.updateMqttConfig({
      brokerAddress: mqttHost,
      ...(input.mqttPort ? { port: input.mqttPort } : {}),
    });
  }
}

/**
 * Cheap health probe for the onboarding "test connection" button.
 * GET /api/external/health — 200 = reachable + credentials OK;
 * 401/403 = server reachable but the API key is wrong/missing;
 * network error/timeout = unreachable.
 */
export async function testServerConnection(rawUrl: string, apiKey?: string, timeoutMs = 8000): Promise<TestConnectionResult> {
  const url = normalizeServerUrl(rawUrl);
  if (!url) {
    return { reachable: false, authOk: false, message: 'invalid-url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const key = (apiKey || '').trim();
    if (key) {
      headers['x-master-key'] = key;
      headers['x-api-key'] = key;
    }
    const response = await fetch(`${url}/api/external/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (response.ok) {
      return { reachable: true, authOk: true, status: response.status, message: 'ok' };
    }
    if (response.status === 401 || response.status === 403) {
      return { reachable: true, authOk: false, status: response.status, message: 'auth-failed' };
    }
    return { reachable: true, authOk: false, status: response.status, message: `http-${response.status}` };
  } catch (error: any) {
    const msg = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'network-error');
    return { reachable: false, authOk: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
}
