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
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useMqttStore } from '../stores/mqttStore';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function SettingsScreen() {
  const { settings, updateSettings, connect, disconnect, isConnected, isConnecting, connectionError } = useMqttStore();
  
  const [brokerUrl, setBrokerUrl] = useState(settings.brokerUrl);
  const [port, setPort] = useState(String(settings.port));
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState(settings.password);
  const [alertDuration, setAlertDuration] = useState(String(settings.alertDisplayDuration));
  
  // Notification test states
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<string>('unknown');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setBrokerUrl(settings.brokerUrl);
    setPort(String(settings.port));
    setUsername(settings.username);
    setPassword(settings.password);
    setAlertDuration(String(settings.alertDisplayDuration));
    
    // Check notification permissions and get token
    checkNotificationSetup();
  }, [settings]);

  const checkNotificationSetup = async () => {
    try {
      // Check permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      setNotificationPermission(existingStatus);
      
      if (existingStatus === 'granted') {
        // Get push token
        if (Device.isDevice) {
          const token = await Notifications.getExpoPushTokenAsync({
            projectId: 'your-project-id', // Replace with actual project ID
          });
          setFcmToken(token.data);
        } else {
          setFcmToken('Simulator - No token available');
        }
      }
    } catch (error) {
      console.error('Error checking notification setup:', error);
    }
  };

  const requestNotificationPermission = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationPermission(status);
      
      if (status === 'granted') {
        await checkNotificationSetup();
        Alert.alert('Thành công', 'Đã cấp quyền thông báo');
      } else {
        Alert.alert('Lỗi', 'Không thể cấp quyền thông báo. Vui lòng kiểm tra cài đặt thiết bị.');
      }
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể yêu cầu quyền thông báo');
    }
  };

  const sendLocalTestNotification = async () => {
    setIsSendingTest(true);
    setTestResult(null);
    
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🔔 Test Notification',
          body: 'Đây là thông báo test local từ AVI/AOI Management App',
          data: { type: 'test', timestamp: Date.now() },
          sound: true,
          badge: 1,
        },
        trigger: { seconds: 1 },
      });
      
      setTestResult({ success: true, message: 'Đã gửi thông báo local thành công!' });
    } catch (error: any) {
      setTestResult({ success: false, message: `Lỗi: ${error.message}` });
    } finally {
      setIsSendingTest(false);
    }
  };

  const sendRemoteTestNotification = async () => {
    if (!settings.apiUrl) {
      Alert.alert('Lỗi', 'Vui lòng cấu hình API URL trước');
      return;
    }
    
    setIsSendingTest(true);
    setTestResult(null);
    
    try {
      const response = await fetch(`${settings.apiUrl}/api/trpc/fcm.sendTestNotification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          json: {
            deviceToken: fcmToken,
            title: '🔔 Test Push Notification',
            body: 'Đây là thông báo test từ server AVI/AOI',
          },
        }),
      });
      
      if (response.ok) {
        setTestResult({ success: true, message: 'Đã gửi yêu cầu push notification đến server!' });
      } else {
        const errorData = await response.json();
        setTestResult({ success: false, message: `Server error: ${errorData.error?.message || 'Unknown error'}` });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: `Network error: ${error.message}` });
    } finally {
      setIsSendingTest(false);
    }
  };

  const sendNGAlertTest = async () => {
    setIsSendingTest(true);
    setTestResult(null);
    
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ NG Alert - Test',
          body: 'Phát hiện sản phẩm NG tại Line 1, Machine AVI-001\nSerial: TEST-001\nDefect: Scratch on surface',
          data: { 
            type: 'ng_alert', 
            machineId: 'AVI-001',
            serial: 'TEST-001',
            defectType: 'Scratch',
            timestamp: Date.now(),
          },
          sound: true,
          badge: 1,
          categoryIdentifier: 'ng_alert',
        },
        trigger: { seconds: 1 },
      });
      
      setTestResult({ success: true, message: 'Đã gửi NG Alert test thành công!' });
    } catch (error: any) {
      setTestResult({ success: false, message: `Lỗi: ${error.message}` });
    } finally {
      setIsSendingTest(false);
    }
  };

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

      {/* Test Notification Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔔 Test Thông báo</Text>
        
        {/* Permission Status */}
        <View style={styles.permissionRow}>
          <View style={styles.permissionInfo}>
            <Text style={styles.permissionLabel}>Quyền thông báo</Text>
            <View style={styles.permissionStatus}>
              <View style={[
                styles.permissionDot, 
                { backgroundColor: notificationPermission === 'granted' ? '#10b981' : '#f59e0b' }
              ]} />
              <Text style={[
                styles.permissionText,
                { color: notificationPermission === 'granted' ? '#10b981' : '#f59e0b' }
              ]}>
                {notificationPermission === 'granted' ? 'Đã cấp quyền' : 
                 notificationPermission === 'denied' ? 'Bị từ chối' : 'Chưa xác định'}
              </Text>
            </View>
          </View>
          {notificationPermission !== 'granted' && (
            <TouchableOpacity 
              style={styles.permissionButton}
              onPress={requestNotificationPermission}
            >
              <Text style={styles.permissionButtonText}>Cấp quyền</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* FCM Token */}
        <View style={styles.tokenSection}>
          <Text style={styles.tokenLabel}>Push Token:</Text>
          <Text style={styles.tokenValue} numberOfLines={2} ellipsizeMode="middle">
            {fcmToken || 'Chưa có token'}
          </Text>
        </View>

        {/* Test Buttons */}
        <View style={styles.testButtonsContainer}>
          <TouchableOpacity
            style={[styles.testButton, styles.testButtonLocal]}
            onPress={sendLocalTestNotification}
            disabled={isSendingTest || notificationPermission !== 'granted'}
          >
            {isSendingTest ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.testButtonIcon}>📱</Text>
                <Text style={styles.testButtonText}>Test Local</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.testButton, styles.testButtonRemote]}
            onPress={sendRemoteTestNotification}
            disabled={isSendingTest || notificationPermission !== 'granted' || !fcmToken}
          >
            {isSendingTest ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.testButtonIcon}>☁️</Text>
                <Text style={styles.testButtonText}>Test Remote</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.testButton, styles.testButtonNG]}
            onPress={sendNGAlertTest}
            disabled={isSendingTest || notificationPermission !== 'granted'}
          >
            {isSendingTest ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.testButtonIcon}>⚠️</Text>
                <Text style={styles.testButtonText}>Test NG Alert</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Test Result */}
        {testResult && (
          <View style={[
            styles.testResultBox,
            { backgroundColor: testResult.success ? '#10b98120' : '#ef444420' }
          ]}>
            <Text style={[
              styles.testResultText,
              { color: testResult.success ? '#10b981' : '#ef4444' }
            ]}>
              {testResult.success ? '✓ ' : '✗ '}{testResult.message}
            </Text>
          </View>
        )}
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
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Platform:</Text>
          <Text style={styles.infoValue}>{Platform.OS} {Platform.Version}</Text>
        </View>
      </View>
      
      {/* Bottom padding */}
      <View style={{ height: 40 }} />
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
  // Test Notification Styles
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  permissionInfo: {
    flex: 1,
  },
  permissionLabel: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
  permissionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  permissionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  permissionButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  tokenSection: {
    backgroundColor: '#0f0f1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  tokenLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4,
  },
  tokenValue: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  testButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  testButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
  },
  testButtonLocal: {
    backgroundColor: '#3b82f6',
  },
  testButtonRemote: {
    backgroundColor: '#8b5cf6',
  },
  testButtonNG: {
    backgroundColor: '#f59e0b',
  },
  testButtonIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  testResultBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  testResultText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
