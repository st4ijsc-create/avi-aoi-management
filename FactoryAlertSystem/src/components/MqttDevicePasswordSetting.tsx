/**
 * Settings → "Device MQTT password" (built-in broker).
 *
 * doc 81 Đợt 5 task G1 (items 4+9). The admin web screen (MQTT clients → Rotate password) shows the
 * device's new password ONCE; the technician types it here. The value goes to the secure store
 * (Android Keystore, secureCredentialStore) — it is never shown back, never put in AsyncStorage and never
 * logged. The screen shows only whether a password is stored. The device ID shown is the one the admin
 * screen lists, so the technician can match the two.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme, Theme } from '../context/ThemeContext';
import { mqttService } from '../services/mqttService';
import { isSecureStorageAvailable } from '../services/secureCredentialStore';

type Lang = 'vi' | 'en' | 'zh';

const TEXT: Record<Lang, Record<string, string>> = {
  vi: {
    title: 'Mật khẩu MQTT của thiết bị (broker nội bộ)',
    deviceId: 'Mã thiết bị',
    stored: 'Đã lưu mật khẩu (kho an toàn)',
    notStored: 'Chưa có mật khẩu',
    unavailable: 'Thiết bị này không có kho lưu an toàn — không lưu được mật khẩu. Cập nhật ứng dụng.',
    placeholder: 'Dán / gõ mật khẩu admin vừa cấp',
    save: 'Lưu',
    clear: 'Xoá',
    saved: 'Đã lưu. Đang kết nối lại bằng mật khẩu mới…',
    cleared: 'Đã xoá mật khẩu.',
    failed: 'Không lưu được mật khẩu',
    hint: 'Admin (web): Kết nối (MQTT / UNS) → Thiết bị → Cấp / xoay mật khẩu cho đúng mã thiết bị trên. Mật khẩu chỉ hiện MỘT lần; nhập vào đây rồi Lưu. Không bao giờ hiển thị lại.',
  },
  en: {
    title: 'Device MQTT password (built-in broker)',
    deviceId: 'Device ID',
    stored: 'Password stored (secure storage)',
    notStored: 'No password stored',
    unavailable: 'Secure storage is not available on this device — the password cannot be saved. Update the app.',
    placeholder: 'Paste / type the password issued by the admin',
    save: 'Save',
    clear: 'Clear',
    saved: 'Saved. Reconnecting with the new password…',
    cleared: 'Password cleared.',
    failed: 'Could not save the password',
    hint: 'Admin (web): Connectivity (MQTT / UNS) → Devices → Issue / rotate password for the device ID above. The password is shown ONCE; enter it here and Save. It is never shown again.',
  },
  zh: {
    title: '设备 MQTT 密码（内置代理）',
    deviceId: '设备 ID',
    stored: '已保存密码（安全存储）',
    notStored: '未设置密码',
    unavailable: '此设备没有安全存储，无法保存密码。请更新应用。',
    placeholder: '粘贴/输入管理员签发的密码',
    save: '保存',
    clear: '清除',
    saved: '已保存。正在使用新密码重新连接…',
    cleared: '已清除密码。',
    failed: '无法保存密码',
    hint: '管理员（网页）：连接 (MQTT / UNS) → 设备 → 为上面的设备 ID 签发 / 轮换密码。密码只显示一次；在此输入并保存。之后不会再显示。',
  },
};

interface Props {
  language: Lang;
}

const MqttDevicePasswordSetting: React.FC<Props> = ({ language }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tx = TEXT[language] ?? TEXT.en;

  const available = isSecureStorageAvailable();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const deviceId = mqttService.getDeviceInfo()?.deviceId ?? '—';

  useEffect(() => {
    let alive = true;
    mqttService
      .hasLocalBrokerPassword()
      .then((v: boolean) => alive && setHasPassword(v))
      .catch(() => alive && setHasPassword(null));
    return () => {
      alive = false;
    };
  }, []);

  const reconnect = useCallback(() => {
    // The admin's rotation disconnected this tablet; retries may be exhausted — start over now.
    mqttService.resetAllRetriesExhausted();
    mqttService.connect().catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    if (!input.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await mqttService.setLocalBrokerPassword(input);
      setInput('');
      setHasPassword(true);
      setMessage({ kind: 'ok', text: tx.saved });
      reconnect();
    } catch (e) {
      setMessage({ kind: 'error', text: `${tx.failed}: ${(e as Error)?.message ?? ''}` });
    } finally {
      setBusy(false);
    }
  }, [input, reconnect, tx]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await mqttService.clearLocalBrokerPassword();
      setInput('');
      setHasPassword(false);
      setMessage({ kind: 'ok', text: tx.cleared });
    } catch (e) {
      setMessage({ kind: 'error', text: `${tx.failed}: ${(e as Error)?.message ?? ''}` });
    } finally {
      setBusy(false);
    }
  }, [tx]);

  return (
    <View style={styles.container} testID="mqtt-device-password">
      <Text style={styles.label}>{tx.title}</Text>
      <Text style={styles.meta} testID="mqtt-device-password-device-id">
        {tx.deviceId}: <Text style={styles.mono}>{deviceId}</Text>
      </Text>
      {!available ? (
        <Text style={styles.error} testID="mqtt-device-password-unavailable">{tx.unavailable}</Text>
      ) : (
        <>
          <Text style={styles.meta} testID="mqtt-device-password-status">
            {hasPassword === null ? '…' : hasPassword ? tx.stored : tx.notStored}
          </Text>
          <TextInput
            testID="mqtt-device-password-input"
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={tx.placeholder}
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            editable={!busy}
          />
          <View style={styles.row}>
            <TouchableOpacity
              testID="mqtt-device-password-save"
              style={[styles.button, (!input.trim() || busy) && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!input.trim() || busy}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{tx.save}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="mqtt-device-password-clear"
              style={[styles.buttonSecondary, (!hasPassword || busy) && styles.buttonDisabled]}
              onPress={handleClear}
              disabled={!hasPassword || busy}
              accessibilityRole="button"
            >
              <Text style={styles.buttonSecondaryText}>{tx.clear}</Text>
            </TouchableOpacity>
            {busy ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
          </View>
        </>
      )}
      {message ? (
        <Text style={message.kind === 'ok' ? styles.ok : styles.error} testID="mqtt-device-password-message">
          {message.text}
        </Text>
      ) : null}
      <Text style={styles.hint}>{tx.hint}</Text>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    label: { fontSize: theme.fontSize.sm, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs },
    meta: { fontSize: theme.fontSize.sm, color: theme.colors.text, marginBottom: theme.spacing.xs },
    mono: { fontFamily: 'monospace' },
    input: {
      fontSize: theme.fontSize.md,
      color: theme.colors.text,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      marginBottom: theme.spacing.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    button: {
      backgroundColor: theme.colors.primary,
      borderRadius: 6,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
    },
    buttonText: { color: theme.colors.white, fontWeight: '600' },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
    },
    buttonSecondaryText: { color: theme.colors.text },
    buttonDisabled: { opacity: 0.5 },
    ok: { fontSize: theme.fontSize.sm, color: theme.colors.success, marginTop: theme.spacing.xs },
    error: { fontSize: theme.fontSize.sm, color: theme.colors.error, marginTop: theme.spacing.xs },
    hint: { fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: theme.spacing.xs, fontStyle: 'italic' },
  });

export default MqttDevicePasswordSetting;
