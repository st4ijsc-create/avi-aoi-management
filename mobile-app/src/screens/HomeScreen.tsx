/**
 * Home Screen - Dashboard với thống kê lỗi và danh sách alerts
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useMqttStore, Alert, NGAlert, SummaryAlert } from '../stores/mqttStore';

export default function HomeScreen() {
  const { 
    isConnected, 
    alerts, 
    todayStats, 
    dismissAlert,
    clearAlerts,
  } = useMqttStore();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    // Simulate refresh
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const undismissedAlerts = alerts.filter(a => !a.dismissed);
  const ngAlerts = alerts.filter(a => a.type === 'NG_ALERT') as NGAlert[];
  const recentNGCount = ngAlerts.filter(a => {
    const receivedAt = new Date(a.receivedAt);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return receivedAt > hourAgo;
  }).length;

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
      }
    >
      {/* Connection Status */}
      <View style={[styles.statusBar, { backgroundColor: isConnected ? '#10b981' : '#ef4444' }]}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>
          {isConnected ? 'Đang kết nối MQTT' : 'Chưa kết nối'}
        </Text>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.totalInspections}</Text>
          <Text style={styles.statLabel}>Kiểm tra hôm nay</Text>
        </View>
        <View style={[styles.statCard, styles.ngCard]}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{todayStats.totalNG}</Text>
          <Text style={styles.statLabel}>Tổng NG</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>
            {todayStats.ngRate.toFixed(1)}%
          </Text>
          <Text style={styles.statLabel}>Tỷ lệ NG</Text>
        </View>
      </View>

      {/* Recent NG Alert */}
      <View style={styles.recentNGCard}>
        <View style={styles.recentNGHeader}>
          <Text style={styles.recentNGIcon}>⚠️</Text>
          <View>
            <Text style={styles.recentNGTitle}>NG trong 1 giờ qua</Text>
            <Text style={styles.recentNGSubtitle}>{recentNGCount} cảnh báo</Text>
          </View>
        </View>
        <Text style={styles.recentNGCount}>{recentNGCount}</Text>
      </View>

      {/* Alerts List */}
      <View style={styles.alertsSection}>
        <View style={styles.alertsHeader}>
          <Text style={styles.alertsTitle}>Thông báo gần đây</Text>
          {undismissedAlerts.length > 0 && (
            <TouchableOpacity onPress={clearAlerts}>
              <Text style={styles.clearButton}>Xóa tất cả</Text>
            </TouchableOpacity>
          )}
        </View>

        {undismissedAlerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>Chưa có thông báo mới</Text>
          </View>
        ) : (
          undismissedAlerts.slice(0, 10).map((alert) => (
            <AlertItem key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

// Alert Item Component
function AlertItem({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const isNG = alert.type === 'NG_ALERT';
  const ngAlert = alert as NGAlert;
  const summaryAlert = alert as SummaryAlert;

  return (
    <TouchableOpacity style={styles.alertItem} onPress={onDismiss}>
      <View style={[styles.alertIcon, { backgroundColor: isNG ? '#ef4444' : '#3b82f6' }]}>
        <Text style={styles.alertIconText}>{isNG ? '⚠️' : '📊'}</Text>
      </View>
      <View style={styles.alertContent}>
        <Text style={styles.alertTitle}>
          {isNG ? `NG Alert - ${ngAlert.stationName}` : 
            (alert.type === 'DAILY_SUMMARY' ? 'Báo cáo ngày' : 'Báo cáo tuần')}
        </Text>
        <Text style={styles.alertDescription}>
          {isNG 
            ? `${ngAlert.totalNG} điểm NG - ${ngAlert.machineName}`
            : `${summaryAlert.statistics.totalNG} NG / ${summaryAlert.statistics.totalInspections} kiểm tra`
          }
        </Text>
        <Text style={styles.alertTime}>
          {new Date(alert.receivedAt).toLocaleTimeString('vi-VN')}
        </Text>
      </View>
      <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss}>
        <Text style={styles.dismissBtnText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  ngCard: {
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  recentNGCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  recentNGHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentNGIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  recentNGTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  recentNGSubtitle: {
    color: '#888',
    fontSize: 12,
  },
  recentNGCount: {
    color: '#ef4444',
    fontSize: 36,
    fontWeight: 'bold',
  },
  alertsSection: {
    padding: 16,
  },
  alertsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  alertsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    color: '#3b82f6',
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
  },
  alertItem: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  alertIconText: {
    fontSize: 18,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  alertDescription: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  alertTime: {
    color: '#666',
    fontSize: 10,
    marginTop: 4,
  },
  dismissBtn: {
    padding: 8,
  },
  dismissBtnText: {
    color: '#888',
    fontSize: 16,
  },
});
