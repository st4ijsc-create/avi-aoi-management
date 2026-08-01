/**
 * W6-C (doc 27 MB4) — serverConfig resolution tests.
 *
 * Covers:
 *  - fresh install (no stored settings) → NO server URL, onboarding state,
 *    and the defaults contain NO hardcoded customer LAN IP / master key;
 *  - migration: legacy settings persisted in AsyncStorage (old installs that
 *    saved the previous default) are loaded unchanged → app stays configured;
 *  - saveServerConfig normalization + MQTT host derivation;
 *  - testServerConnection classification (ok / auth-fail / unreachable).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// settingsStore lazily requires mqttService on loadSettings — stub it out
jest.mock('../../src/services/mqttService', () => ({
  mqttService: {
    updateHealthCheckSettings: jest.fn(),
    configure: jest.fn(),
  },
}));

import { useSettingsStore } from '../../src/store/settingsStore';
import {
  getServerBaseUrl,
  requireServerBaseUrl,
  isServerConfigured,
  saveServerConfig,
  normalizeServerUrl,
  deriveMqttHostFromUrl,
  getMqttBroker,
  testServerConnection,
} from '../../src/services/serverConfig';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../src/utils/constants';

const LEGACY_IP_URL = 'http://192.168.8.7:3000';

function resetStore() {
  useSettingsStore.setState({
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    isLoading: false,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetStore();
});

describe('MB4 — defaults ship with no customer config', () => {
  it('has NO baked-in LAN IP or master key anywhere in the defaults', () => {
    const raw = JSON.stringify(DEFAULT_SETTINGS);
    expect(raw).not.toContain('192.168.8.7');
    expect(raw).not.toContain('master_avi_aoi');
    expect(DEFAULT_SETTINGS.app.apiBaseUrl).toBe('');
    expect(DEFAULT_SETTINGS.app.apiKey).toBe('');
    expect(DEFAULT_SETTINGS.mqtt.brokerAddress).toBe('');
  });

  it('fresh install resolves to null / onboarding state — never a stranger IP', () => {
    expect(getServerBaseUrl()).toBeNull();
    expect(getMqttBroker().host).toBeNull();
    expect(isServerConfigured()).toBe(false);
    expect(() => requireServerBaseUrl()).toThrow();
  });
});

describe('MB4 — migration from old stored settings', () => {
  it('keeps existing installs configured (persisted legacy server address survives)', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        app: { apiBaseUrl: LEGACY_IP_URL, apiKey: 'legacy-key' },
        mqtt: { brokerAddress: '192.168.8.7', port: 1883 },
      }),
    );

    await useSettingsStore.getState().loadSettings();

    expect(isServerConfigured()).toBe(true);
    expect(getServerBaseUrl()).toBe(LEGACY_IP_URL);
    expect(getMqttBroker()).toEqual({ host: '192.168.8.7', port: 1883 });
  });

  it('stored settings WITHOUT a server address still gate to onboarding', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ app: { language: 'vi' }, mqtt: { port: 1883 } }),
    );

    await useSettingsStore.getState().loadSettings();

    expect(getServerBaseUrl()).toBeNull();
    expect(isServerConfigured()).toBe(false);
  });
});

describe('saveServerConfig', () => {
  it('normalizes the URL, derives the MQTT host, persists through the settings store', () => {
    saveServerConfig({ serverUrl: '10.0.0.5:3000/', apiKey: ' secret ', mqttPort: 1884 });

    expect(getServerBaseUrl()).toBe('http://10.0.0.5:3000');
    expect(useSettingsStore.getState().settings.app.apiKey).toBe('secret');
    expect(getMqttBroker()).toEqual({ host: '10.0.0.5', port: 1884 });
    expect(isServerConfigured()).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(() => saveServerConfig({ serverUrl: '   ' })).toThrow();
    expect(isServerConfigured()).toBe(false);
  });
});

describe('URL helpers', () => {
  it('normalizeServerUrl', () => {
    expect(normalizeServerUrl('http://a.b:3000/')).toBe('http://a.b:3000');
    expect(normalizeServerUrl('https://a.b')).toBe('https://a.b');
    expect(normalizeServerUrl('10.1.2.3:3000')).toBe('http://10.1.2.3:3000');
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('   ')).toBeNull();
  });

  it('deriveMqttHostFromUrl', () => {
    expect(deriveMqttHostFromUrl('http://10.1.2.3:3000')).toBe('10.1.2.3');
    expect(deriveMqttHostFromUrl('https://factory.local')).toBe('factory.local');
    expect(deriveMqttHostFromUrl('nonsense')).toBeNull();
  });
});

describe('testServerConnection', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('200 → reachable + authOk', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as any;
    const r = await testServerConnection('http://x.y:3000', 'key');
    expect(r).toMatchObject({ reachable: true, authOk: true, status: 200 });
    // health endpoint + key headers were used
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://x.y:3000/api/external/health');
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers['x-master-key']).toBe('key');
  });

  it('401 → reachable but auth failed', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as any;
    const r = await testServerConnection('http://x.y:3000', 'bad');
    expect(r).toMatchObject({ reachable: true, authOk: false, status: 401 });
  });

  it('network error → unreachable', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network request failed'); }) as any;
    const r = await testServerConnection('http://x.y:3000');
    expect(r).toMatchObject({ reachable: false, authOk: false });
  });

  it('invalid URL short-circuits without fetching', async () => {
    global.fetch = jest.fn() as any;
    const r = await testServerConnection('');
    expect(r.reachable).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
