/**
 * Factory Alert System - Onboarding Screen (doc 27 MB4)
 *
 * First-run gate: the app ships with NO preset server (the old hardcoded
 * customer LAN IP was removed). Until a server URL / MQTT broker is saved,
 * App.tsx renders this screen instead of the main navigator.
 *
 * Manual entry only — no QR/barcode scanning library is present in the app
 * (checked package.json); QR-based provisioning is a possible follow-up.
 * The Settings screen keeps the full edit path afterwards.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../context';
import { useSettingsStore, selectLanguage } from '../store';
import { TRANSLATIONS } from '../utils/constants';
import {
  normalizeServerUrl,
  deriveMqttHostFromUrl,
  saveServerConfig,
  testServerConnection,
  TestConnectionResult,
} from '../services/serverConfig';

export interface OnboardingScreenProps {
  /** Called after the configuration is saved — App.tsx re-runs the server bootstrap. */
  onConfigured: () => void;
}

type TestState = 'idle' | 'testing' | 'ok' | 'auth-fail' | 'fail';

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onConfigured }) => {
  const { theme } = useTheme();
  const language = useSettingsStore(selectLanguage);
  const t = TRANSLATIONS[language];

  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mqttHost, setMqttHost] = useState('');
  const [mqttHostTouched, setMqttHostTouched] = useState(false);
  const [mqttPort, setMqttPort] = useState('1883');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testDetail, setTestDetail] = useState('');
  const [error, setError] = useState('');

  // Prefill the broker host from the server URL unless the user edited it
  const effectiveMqttHost = useMemo(() => {
    if (mqttHostTouched && mqttHost.trim()) return mqttHost.trim();
    return deriveMqttHostFromUrl(serverUrl) || mqttHost.trim();
  }, [serverUrl, mqttHost, mqttHostTouched]);

  const handleTest = useCallback(async () => {
    setError('');
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) {
      setError(serverUrl.trim() ? t.onboardingUrlInvalid : t.onboardingUrlRequired);
      return;
    }
    setTestState('testing');
    setTestDetail('');
    const result: TestConnectionResult = await testServerConnection(normalized, apiKey);
    if (result.reachable && result.authOk) {
      setTestState('ok');
    } else if (result.reachable) {
      setTestState('auth-fail');
      setTestDetail(`HTTP ${result.status ?? '?'}`);
    } else {
      setTestState('fail');
      setTestDetail(result.message);
    }
  }, [serverUrl, apiKey, t]);

  const handleSave = useCallback(() => {
    setError('');
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) {
      setError(serverUrl.trim() ? t.onboardingUrlInvalid : t.onboardingUrlRequired);
      return;
    }
    const port = parseInt(mqttPort, 10);
    try {
      saveServerConfig({
        serverUrl: normalized,
        apiKey: apiKey.trim() || undefined,
        mqttHost: effectiveMqttHost || undefined,
        mqttPort: Number.isFinite(port) && port > 0 && port <= 65535 ? port : 1883,
      });
      onConfigured();
    } catch (e: any) {
      setError(e?.message || t.onboardingUrlInvalid);
    }
  }, [serverUrl, apiKey, effectiveMqttHost, mqttPort, onConfigured, t]);

  const testColor =
    testState === 'ok' ? theme.colors.success :
    testState === 'auth-fail' ? theme.colors.warning :
    testState === 'fail' ? theme.colors.error : theme.colors.textSecondary;

  const testLabel =
    testState === 'testing' ? t.onboardingTesting :
    testState === 'ok' ? t.onboardingTestOk :
    testState === 'auth-fail' ? t.onboardingTestAuthFail :
    testState === 'fail' ? t.onboardingTestFail : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Icon name="server-network" size={56} color={theme.colors.primary} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{t.onboardingTitle}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              {t.onboardingSubtitle}
            </Text>
            <Text style={[styles.manualHint, { color: theme.colors.textMuted }]}>
              {t.onboardingManualHint}
            </Text>
          </View>

          {/* Server URL */}
          <Text style={[styles.label, { color: theme.colors.text }]}>{t.onboardingServerUrl} *</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
            placeholder={t.onboardingServerUrlPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={serverUrl}
            onChangeText={(v) => { setServerUrl(v); setTestState('idle'); }}
            testID="onboarding-server-url"
          />
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t.onboardingServerUrlHint}</Text>

          {/* API key */}
          <Text style={[styles.label, { color: theme.colors.text }]}>{t.onboardingApiKey}</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
            placeholder="••••••••"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={apiKey}
            onChangeText={(v) => { setApiKey(v); setTestState('idle'); }}
            testID="onboarding-api-key"
          />
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t.onboardingApiKeyHint}</Text>

          {/* MQTT broker */}
          <View style={styles.row}>
            <View style={styles.flexGrow}>
              <Text style={[styles.label, { color: theme.colors.text }]}>{t.onboardingMqttHost}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                placeholder={deriveMqttHostFromUrl(serverUrl) || '—'}
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                value={mqttHostTouched ? mqttHost : (deriveMqttHostFromUrl(serverUrl) || mqttHost)}
                onChangeText={(v) => { setMqttHost(v); setMqttHostTouched(true); }}
                testID="onboarding-mqtt-host"
              />
            </View>
            <View style={styles.portCol}>
              <Text style={[styles.label, { color: theme.colors.text }]}>{t.onboardingMqttPort}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                keyboardType="number-pad"
                value={mqttPort}
                onChangeText={setMqttPort}
                testID="onboarding-mqtt-port"
              />
            </View>
          </View>
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t.onboardingMqttHostHint}</Text>

          {/* Test connection */}
          <TouchableOpacity
            style={[styles.testButton, { borderColor: theme.colors.primary }]}
            onPress={handleTest}
            disabled={testState === 'testing'}
            testID="onboarding-test-button"
          >
            {testState === 'testing' ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Icon name="lan-connect" size={18} color={theme.colors.primary} />
            )}
            <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>
              {t.onboardingTestConnection}
            </Text>
          </TouchableOpacity>

          {testLabel ? (
            <View style={styles.testResultRow}>
              <Icon
                name={testState === 'ok' ? 'check-circle' : testState === 'testing' ? 'progress-clock' : 'alert-circle'}
                size={16}
                color={testColor}
              />
              <Text style={[styles.testResultText, { color: testColor }]}>
                {testLabel}{testDetail ? ` (${testDetail})` : ''}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
          ) : null}

          {/* Save & continue */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: theme.colors.primary, opacity: serverUrl.trim() ? 1 : 0.5 }]}
            onPress={handleSave}
            disabled={!serverUrl.trim()}
            testID="onboarding-save-button"
          >
            <Text style={styles.saveButtonText}>{t.onboardingContinue}</Text>
            <Icon name="arrow-right" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  flexGrow: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 24, marginTop: 16 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 12 },
  subtitle: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  manualHint: { fontSize: 12, marginTop: 6 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  hint: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', gap: 12 },
  portCol: { width: 110 },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 24,
  },
  testButtonText: { fontSize: 15, fontWeight: '600' },
  testResultRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, justifyContent: 'center' },
  testResultText: { fontSize: 13, fontWeight: '500' },
  errorText: { fontSize: 13, marginTop: 10, textAlign: 'center' },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 16,
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

export default OnboardingScreen;
