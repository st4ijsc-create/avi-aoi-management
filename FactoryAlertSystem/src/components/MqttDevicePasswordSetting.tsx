/**
 * Settings → "Device MQTT password" (built-in broker).
 *
 * doc 81 Đợt 5 task G1 (items 4+9). The admin web screen (MQTT clients → Rotate password) shows the
 * device's new password ONCE; the technician types it here. The value goes to the secure store
 * (Android Keystore, secureCredentialStore) — it is never shown back, never put in AsyncStorage and never
 * logged. The screen shows only whether a password is stored. The device ID shown is the one the admin
 * screen lists, so the technician can match the two.
 *
 * R-5-a (G1 fix scan): the password is saved PINNED to the broker endpoint configured at that moment and is
 * sent only there. When the configured endpoint differs, the screen says which endpoint the stored password
 * belongs to and asks to re-enter it. When the connection to the broker is not encrypted, the screen says
 * the password crosses the LAN in clear.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme, Theme } from '../context/ThemeContext';
import { mqttService } from '../services/mqttService';
import type { MqttDeviceCredentialStatus } from '../services/secureCredentialStore';
import {
  MqttBrokerEndpoint,
  brokerEndpointLabel,
  brokerEndpointOf,
  isSecureStorageAvailable,
  sameBrokerEndpoint,
} from '../services/secureCredentialStore';
import type { MqttConfig } from '../types';

type Lang = 'vi' | 'en' | 'zh';

const TEXT: Record<Lang, Record<string, string>> = {
  vi: {
    title: 'Mật khẩu MQTT của thiết bị (broker nội bộ)',
    deviceId: 'Mã thiết bị',
    stored: 'Đã lưu mật khẩu (kho an toàn) cho',
    mismatch: 'Mật khẩu đã lưu thuộc về {old} — KHÔNG được gửi tới broker đang cấu hình ({cur}). Nhập lại mật khẩu cho broker này.',
    noEndpoint: 'Chưa cấu hình địa chỉ/cổng broker — cấu hình trước rồi mới lưu mật khẩu.',
    plaintext: '⚠ Kết nối tới broker này KHÔNG mã hoá: mật khẩu đi qua mạng LAN dạng rõ. Khuyến nghị dùng TLS.',
    notStored: 'Chưa có mật khẩu',
    storedUnreadable: 'Đã lưu mật khẩu — KHÔNG đọc được',
    unreadableNow: 'Đã lưu mật khẩu nhưng tạm thời KHÔNG đọc được (kho an toàn bận) — sẽ thử lại ở lần kết nối sau.',
    reentry: 'Mật khẩu đã lưu KHÔNG đọc được nữa trên máy này — hãy nhập lại mật khẩu (xin admin cấp mới nếu không còn). Mật khẩu cũ không bị xoá ngầm; có thể bấm Xoá.',
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
    stored: 'Password stored (secure storage) for',
    mismatch: 'The stored password belongs to {old} — it is NOT sent to the configured broker ({cur}). Re-enter the password for this broker.',
    noEndpoint: 'Broker address/port not configured — configure it first, then save the password.',
    plaintext: '⚠ The connection to this broker is NOT encrypted: the password crosses the LAN in clear. TLS is recommended.',
    notStored: 'No password stored',
    storedUnreadable: 'Password stored — NOT readable',
    unreadableNow: 'A password is stored but is temporarily unreadable (secure storage busy) — it will be retried on the next connect.',
    reentry: 'The stored password cannot be read on this device any more — please enter it again (ask the admin for a new one if needed). It was not deleted silently; you can Clear it.',
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
    stored: '已保存密码（安全存储），对应',
    mismatch: '已保存的密码属于 {old}——不会发送到当前配置的代理（{cur}）。请为此代理重新输入密码。',
    noEndpoint: '尚未配置代理地址/端口——请先配置，再保存密码。',
    plaintext: '⚠ 与此代理的连接未加密：密码以明文在局域网中传输。建议使用 TLS。',
    notStored: '未设置密码',
    storedUnreadable: '已保存密码——无法读取',
    unreadableNow: '已保存密码，但暂时无法读取（安全存储忙）——将在下次连接时重试。',
    reentry: '此设备上已保存的密码无法再读取——请重新输入密码（如没有，请管理员重新签发）。旧密码不会被静默删除；可点击清除。',
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
  /** The broker config shown in Settings — the password is pinned to (and only sent to) this endpoint. */
  mqttConfig: Pick<MqttConfig, 'brokerAddress' | 'port' | 'protocol' | 'useSSL'>;
}

/** Is the app's connection to this endpoint actually encrypted? The Android TCP path is a plain socket. */
function encryptedOnThisDevice(e: MqttBrokerEndpoint): boolean {
  return e.tls && !(e.protocol === 'tcp' && Platform.OS === 'android');
}

const MqttDevicePasswordSetting: React.FC<Props> = ({ language, mqttConfig }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tx = TEXT[language] ?? TEXT.en;

  const available = isSecureStorageAvailable();
  // undefined = still loading; null = nothing stored; endpoint = stored and pinned there.
  const [pinned, setPinned] = useState<MqttBrokerEndpoint | null | undefined>(undefined);
  // G fix 3 (R2-3): readable-or-not state of the stored password (an unreadable one has no known pin).
  const [credStatus, setCredStatus] = useState<MqttDeviceCredentialStatus | undefined>(undefined);
  const storedButUnreadable = credStatus === 'unavailable' || credStatus === 'reentry';
  const hasPassword = pinned === undefined ? null : pinned !== null || storedButUnreadable;
  const current = brokerEndpointOf(mqttConfig);
  const mismatch = !!pinned && !sameBrokerEndpoint(pinned, current);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const deviceId = mqttService.getDeviceInfo()?.deviceId ?? '—';

  useEffect(() => {
    let alive = true;
    mqttService
      .getLocalBrokerPasswordEndpoint()
      .then((e: MqttBrokerEndpoint | null) => alive && setPinned(e))
      .catch(() => alive && setPinned(null));
    mqttService
      .getLocalBrokerPasswordStatus()
      .then((st: MqttDeviceCredentialStatus) => alive && setCredStatus(st))
      .catch(() => alive && setCredStatus('unavailable'));
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
    if (!input.trim() || !current) return;
    setBusy(true);
    setMessage(null);
    try {
      await mqttService.setLocalBrokerPassword(input, current);
      setInput('');
      setPinned(current);
      setCredStatus('ok');
      setMessage({ kind: 'ok', text: tx.saved });
      reconnect();
    } catch (e) {
      setMessage({ kind: 'error', text: `${tx.failed}: ${(e as Error)?.message ?? ''}` });
    } finally {
      setBusy(false);
    }
  }, [input, current, reconnect, tx]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await mqttService.clearLocalBrokerPassword();
      setInput('');
      setPinned(null);
      setCredStatus('none');
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
            {pinned === undefined
              ? '…'
              : pinned
                ? `${tx.stored} ${brokerEndpointLabel(pinned)}`
                : credStatus === 'unavailable'
                  ? tx.unreadableNow
                  : credStatus === 'reentry'
                    ? tx.storedUnreadable
                    : tx.notStored}
          </Text>
          {credStatus === 'reentry' ? (
            <Text style={styles.error} testID="mqtt-device-password-reentry">{tx.reentry}</Text>
          ) : null}
          {mismatch ? (
            <Text style={styles.error} testID="mqtt-device-password-mismatch">
              {tx.mismatch
                .replace('{old}', brokerEndpointLabel(pinned as MqttBrokerEndpoint))
                .replace('{cur}', current ? brokerEndpointLabel(current) : '—')}
            </Text>
          ) : null}
          {!current ? (
            <Text style={styles.error} testID="mqtt-device-password-no-endpoint">{tx.noEndpoint}</Text>
          ) : !encryptedOnThisDevice(current) ? (
            <Text style={styles.warn} testID="mqtt-device-password-plaintext">{tx.plaintext}</Text>
          ) : null}
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
              style={[styles.button, (!input.trim() || busy || !current) && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!input.trim() || busy || !current}
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
    warn: { fontSize: theme.fontSize.sm, color: theme.colors.warning, marginBottom: theme.spacing.xs },
    hint: { fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: theme.spacing.xs, fontStyle: 'italic' },
  });

export default MqttDevicePasswordSetting;
