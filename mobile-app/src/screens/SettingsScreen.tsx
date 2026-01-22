/**
 * Settings Screen - Cấu hình MQTT và thông báo
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Switch,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useMqttStore } from '../stores/mqttStore';

export default function SettingsScreen() {
  const { settings, updateSettings, connect, disconnect, isConnected, isConnecting, connectionError } = useMqttStore();
  
  const [brokerUrl, setBrokerUrl] = useState(settings.brokerUrl);
  const [port, setPort] = useState(String(settings.port));
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState(settings.password);
  const [alertDuration, setAlertDuration] = useState(String(settings.alertDisplayDuration));

  useEffect(() => {
    setBrokerUrl(settings.brokerUrl);
    setPort(String(settings.port));
    setUsername(settings.username);
    setPassword(settings.password);
    setAlertDuration(String(settings.alertDisplayDuration));
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({
      brokerUrl,
      port: parseInt(port) || 1883,
      username,
      password,
      alertDisplayDuration: parseInt(alertDuration) || 60,
    });
    Alert.alert('Thành công', 'Đã lưu cài đặt');
  };

  const handleConnect = async () => {
    if (isConnected) {
      disconnect();
    } else {
      await handleSave();
      await connect();
    }
  };

  const handleToggleNotification = async (key: 'receiveNGAlerts' | 'receiveDailySummary' | 'receiveWeeklySummary', value: boolean) => {
    await updateSettings({ [key]: value });
  };

  return (
    <ScrollView style={styles.container}>
      {/* Connection Status */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? '#10b981' : '#ef4444' }]} />
          <Text style={styles.statusText}>
            {isConnecting ? 'Đang kết nối...' : isConnected ? 'Đã kết nối' : 'Chưa kết nối'}
          </Text>
        </View>
        {connectionError && (
          <Text style={styles.errorText}>{connectionError}</Text>
        )}
        <TouchableOpacity
          style={[styles.connectButton, isConnected && styles.disconnectButton]}
          onPress={handleConnect}
          disabled={isConnecting}
        >
          <Text style={styles.connectButtonText}>
            {isConnecting ? 'Đang kết nối...' : isConnected ? 'Ngắt kết nối' : 'Kết nối'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* MQTT Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cấu hình MQTT</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Broker URL</Text>
          <TextInput
            style={styles.input}
            value={brokerUrl}
            onChangeText={setBrokerUrl}
            placeholder="mqtt://localhost"
            placeholderTextColor="#666"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="1883"
            placeholderTextColor="#666"
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor="#666"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#666"
            secureTextEntry
          />
        </View>
      </View>

      {/* Alert Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cài đặt thông báo</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Thời gian hiển thị (giây)</Text>
          <TextInput
            style={styles.input}
            value={alertDuration}
            onChangeText={setAlertDuration}
            placeholder="60"
            placeholderTextColor="#666"
            keyboardType="numeric"
          />
          <Text style={styles.hint}>Thời gian popup hiển thị trước khi tự động đóng</Text>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Nhận cảnh báo NG</Text>
            <Text style={styles.switchHint}>Hiển thị popup khi có sản phẩm NG</Text>
          </View>
          <Switch
            value={settings.receiveNGAlerts}
            onValueChange={(value) => handleToggleNotification('receiveNGAlerts', value)}
            trackColor={{ false: '#333', true: '#3b82f6' }}
            thumbColor={settings.receiveNGAlerts ? '#fff' : '#888'}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Báo cáo hàng ngày</Text>
            <Text style={styles.switchHint}>Nhận tổng hợp lỗi mỗi ngày</Text>
          </View>
          <Switch
            value={settings.receiveDailySummary}
            onValueChange={(value) => handleToggleNotification('receiveDailySummary', value)}
            trackColor={{ false: '#333', true: '#3b82f6' }}
            thumbColor={settings.receiveDailySummary ? '#fff' : '#888'}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Báo cáo hàng tuần</Text>
            <Text style={styles.switchHint}>Nhận tổng hợp lỗi mỗi tuần</Text>
          </View>
          <Switch
            value={settings.receiveWeeklySummary}
            onValueChange={(value) => handleToggleNotification('receiveWeeklySummary', value)}
            trackColor={{ false: '#333', true: '#3b82f6' }}
            thumbColor={settings.receiveWeeklySummary ? '#fff' : '#888'}
          />
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>Lưu cài đặt</Text>
      </TouchableOpacity>

      {/* Device Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Thông tin thiết bị</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Device ID:</Text>
          <Text style={styles.infoValue}>{settings.deviceId || 'Chưa có'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Client ID:</Text>
          <Text style={styles.infoValue}>{settings.clientId || 'Chưa có'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Station ID:</Text>
          <Text style={styles.infoValue}>{settings.stationId || 'Tất cả'}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  statusCard: {
    backgroundColor: '#1a1a2e',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginBottom: 12,
  },
  connectButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#ef4444',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#1a1a2e',
    margin: 16,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  hint: {
    color: '#666',
    fontSize: 11,
    marginTop: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  switchInfo: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    color: '#fff',
    fontSize: 14,
  },
  switchHint: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  saveButton: {
    backgroundColor: '#10b981',
    margin: 16,
    marginTop: 0,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  infoLabel: {
    color: '#888',
    fontSize: 14,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },
});
