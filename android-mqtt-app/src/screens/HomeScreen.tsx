/**
 * Home Screen - Main dashboard for MQTT monitoring
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Badge,
  IconButton,
  Surface,
  Text,
  Divider,
  List,
  Switch,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useNotificationStore, getNotificationStats } from '../store/notificationStore';
import {
  getMqttConfig,
  saveMqttConfig,
  isConnected,
  getStationConfig,
} from '../services/mqttService';
import {
  startBackgroundService,
  stopBackgroundService,
  isBackgroundServiceRunning,
  hasOverlayPermission,
  requestOverlayPermission,
} from '../services/notificationService';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { notifications, unreadCount, loadNotifications } = useNotificationStore();
  const [refreshing, setRefreshing] = useState(false);
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const [overlayPermission, setOverlayPermission] = useState(false);
  const [stationName, setStationName] = useState('Chưa cấu hình');

  const stats = getNotificationStats(notifications);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    await loadNotifications();
    
    const config = await getMqttConfig();
    setMqttEnabled(config.enabled);
    setConnected(isConnected());
    setBackgroundRunning(isBackgroundServiceRunning());
    setOverlayPermission(await hasOverlayPermission());
    
    const station = await getStationConfig();
    if (station) {
      setStationName(station.stationName);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInitialData();
    setRefreshing(false);
  };

  const toggleMqtt = async (value: boolean) => {
    setMqttEnabled(value);
    await saveMqttConfig({ enabled: value });
    
    if (value) {
      await startBackgroundService();
    } else {
      await stopBackgroundService();
    }
    
    setConnected(isConnected());
    setBackgroundRunning(isBackgroundServiceRunning());
  };

  const handleRequestOverlayPermission = async () => {
    const granted = await requestOverlayPermission();
    setOverlayPermission(granted);
  };

  const recentNotifications = notifications.slice(0, 5);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Status Card */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.statusHeader}>
            <View style={styles.statusInfo}>
              <Title style={styles.title}>Trạng thái kết nối</Title>
              <View style={styles.statusRow}>
                <Icon
                  name={connected ? 'wifi' : 'wifi-off'}
                  size={24}
                  color={connected ? '#22c55e' : '#ef4444'}
                />
                <Text style={[styles.statusText, { color: connected ? '#22c55e' : '#ef4444' }]}>
                  {connected ? 'Đã kết nối' : 'Chưa kết nối'}
                </Text>
              </View>
            </View>
            <Switch value={mqttEnabled} onValueChange={toggleMqtt} />
          </View>
          
          <Divider style={styles.divider} />
          
          <View style={styles.stationInfo}>
            <Icon name="factory" size={20} color="#94a3b8" />
            <Text style={styles.stationText}>Công trạm: {stationName}</Text>
            <IconButton
              icon="pencil"
              size={16}
              onPress={() => navigation.navigate('StationConfig')}
            />
          </View>
        </Card.Content>
      </Card>

      {/* Statistics Cards */}
      <View style={styles.statsRow}>
        <Surface style={[styles.statCard, { backgroundColor: '#1e293b' }]}>
          <Icon name="bell-ring" size={28} color="#14b8a6" />
          <Text style={styles.statNumber}>{stats.todayTotal}</Text>
          <Text style={styles.statLabel}>Hôm nay</Text>
        </Surface>
        
        <Surface style={[styles.statCard, { backgroundColor: '#1e293b' }]}>
          <Icon name="alert-circle" size={28} color="#ef4444" />
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>{stats.todayErrors}</Text>
          <Text style={styles.statLabel}>Lỗi</Text>
        </Surface>
        
        <Surface style={[styles.statCard, { backgroundColor: '#1e293b' }]}>
          <Icon name="alert" size={28} color="#f59e0b" />
          <Text style={[styles.statNumber, { color: '#f59e0b' }]}>{stats.todayWarnings}</Text>
          <Text style={styles.statLabel}>Cảnh báo</Text>
        </Surface>
        
        <Surface style={[styles.statCard, { backgroundColor: '#1e293b' }]}>
          <Icon name="email-outline" size={28} color="#3b82f6" />
          <Text style={[styles.statNumber, { color: '#3b82f6' }]}>{stats.unread}</Text>
          <Text style={styles.statLabel}>Chưa đọc</Text>
        </Surface>
      </View>

      {/* Overlay Permission Warning */}
      {!overlayPermission && (
        <Card style={[styles.card, { backgroundColor: '#7c2d12' }]}>
          <Card.Content>
            <View style={styles.warningRow}>
              <Icon name="alert-octagon" size={24} color="#fbbf24" />
              <View style={styles.warningText}>
                <Text style={styles.warningTitle}>Cần cấp quyền hiển thị Bubble</Text>
                <Text style={styles.warningDesc}>
                  Để hiển thị thông báo dạng Bubble trên các app khác
                </Text>
              </View>
            </View>
            <Button
              mode="contained"
              onPress={handleRequestOverlayPermission}
              style={styles.permissionButton}
            >
              Cấp quyền
            </Button>
          </Card.Content>
        </Card>
      )}

      {/* Recent Notifications */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.sectionHeader}>
            <Title style={styles.title}>Thông báo gần đây</Title>
            <Button
              mode="text"
              onPress={() => navigation.navigate('NotificationHistory')}
              labelStyle={{ color: '#14b8a6' }}
            >
              Xem tất cả
            </Button>
          </View>
          
          {recentNotifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="bell-sleep" size={48} color="#475569" />
              <Text style={styles.emptyText}>Chưa có thông báo</Text>
            </View>
          ) : (
            recentNotifications.map((notification) => (
              <List.Item
                key={notification.id}
                title={notification.title}
                description={notification.body}
                titleStyle={[
                  styles.notificationTitle,
                  !notification.read && styles.unreadTitle,
                ]}
                descriptionStyle={styles.notificationDesc}
                left={() => (
                  <Icon
                    name={
                      notification.type === 'error'
                        ? 'alert-circle'
                        : notification.type === 'warning'
                        ? 'alert'
                        : 'information'
                    }
                    size={24}
                    color={
                      notification.type === 'error'
                        ? '#ef4444'
                        : notification.type === 'warning'
                        ? '#f59e0b'
                        : '#3b82f6'
                    }
                    style={styles.notificationIcon}
                  />
                )}
                right={() => (
                  <Text style={styles.notificationTime}>
                    {formatTime(notification.timestamp)}
                  </Text>
                )}
                style={styles.notificationItem}
              />
            ))
          )}
        </Card.Content>
      </Card>

      {/* Quick Actions */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Thao tác nhanh</Title>
          <View style={styles.actionsRow}>
            <Button
              mode="outlined"
              icon="cog"
              onPress={() => navigation.navigate('Settings')}
              style={styles.actionButton}
              labelStyle={styles.actionLabel}
            >
              Cài đặt
            </Button>
            <Button
              mode="outlined"
              icon="history"
              onPress={() => navigation.navigate('NotificationHistory')}
              style={styles.actionButton}
              labelStyle={styles.actionLabel}
            >
              Lịch sử
            </Button>
            <Button
              mode="outlined"
              icon="factory"
              onPress={() => navigation.navigate('StationConfig')}
              style={styles.actionButton}
              labelStyle={styles.actionLabel}
            >
              Công trạm
            </Button>
          </View>
        </Card.Content>
      </Card>

      <View style={styles.footer} />
    </ScrollView>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút`;
  if (hours < 24) return `${hours} giờ`;
  return new Date(date).toLocaleDateString('vi-VN');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  card: {
    margin: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  title: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusInfo: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    marginVertical: 12,
    backgroundColor: '#334155',
  },
  stationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stationText: {
    color: '#94a3b8',
    marginLeft: 8,
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginVertical: 4,
  },
  statCard: {
    flex: 1,
    margin: 4,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  statNumber: {
    color: '#f1f5f9',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  warningText: {
    flex: 1,
    marginLeft: 12,
  },
  warningTitle: {
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: 'bold',
  },
  warningDesc: {
    color: '#fed7aa',
    fontSize: 14,
    marginTop: 4,
  },
  permissionButton: {
    marginTop: 12,
    backgroundColor: '#f59e0b',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#475569',
    marginTop: 8,
  },
  notificationItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  notificationIcon: {
    marginTop: 8,
  },
  notificationTitle: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  unreadTitle: {
    fontWeight: 'bold',
  },
  notificationDesc: {
    color: '#94a3b8',
    fontSize: 12,
  },
  notificationTime: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
    borderColor: '#334155',
  },
  actionLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  footer: {
    height: 24,
  },
});
