/**
 * Dashboard Screen - Hiển thị KPI cards và thống kê từ API
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useMqttStore } from '../stores/mqttStore';

const { width } = Dimensions.get('window');

interface DashboardStats {
  totalOutput: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  fpy: number;
  yieldRate: number;
}

interface MachineStatus {
  online: number;
  offline: number;
  error: number;
  total: number;
}

interface YieldAlert {
  machineCode: string;
  machineName: string;
  yieldRate: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

export default function DashboardScreen() {
  const { isConnected, todayStats } = useMqttStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [machineStatus, setMachineStatus] = useState<MachineStatus>({
    online: 12,
    offline: 3,
    error: 1,
    total: 16
  });
  const [yieldAlerts, setYieldAlerts] = useState<YieldAlert[]>([]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  }, []);

  // Calculate stats from todayStats
  const stats: DashboardStats = {
    totalOutput: todayStats.totalInspections,
    okCount: todayStats.totalInspections - todayStats.totalNG,
    ngCount: todayStats.totalNG,
    ntfCount: 0,
    fpy: todayStats.totalInspections > 0 
      ? ((todayStats.totalInspections - todayStats.totalNG) / todayStats.totalInspections) * 100 
      : 100,
    yieldRate: 100 - todayStats.ngRate
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Đang tải dữ liệu...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3b82f6"
        />
      }
    >
      {/* Connection Status */}
      <View style={[styles.statusBar, { backgroundColor: isConnected ? '#10b981' : '#ef4444' }]}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>
          {isConnected ? 'MQTT Đang kết nối' : 'MQTT Chưa kết nối'}
        </Text>
      </View>

      {/* KPI Cards Row 1 */}
      <View style={styles.kpiRow}>
        <KPICard
          title="Tổng sản lượng"
          value={stats.totalOutput}
          icon="📦"
          color="#3b82f6"
        />
        <KPICard
          title="OK"
          value={stats.okCount}
          icon="✅"
          color="#10b981"
        />
      </View>

      {/* KPI Cards Row 2 */}
      <View style={styles.kpiRow}>
        <KPICard
          title="NG"
          value={stats.ngCount}
          icon="❌"
          color="#ef4444"
        />
        <KPICard
          title="NTF"
          value={stats.ntfCount}
          icon="⚠️"
          color="#f59e0b"
        />
      </View>

      {/* KPI Cards Row 3 - Rates */}
      <View style={styles.kpiRow}>
        <KPICard
          title="FPY"
          value={`${stats.fpy.toFixed(1)}%`}
          icon="📊"
          color="#8b5cf6"
          isPercentage
        />
        <KPICard
          title="Yield Rate"
          value={`${stats.yieldRate.toFixed(1)}%`}
          icon="📈"
          color="#06b6d4"
          isPercentage
        />
      </View>

      {/* Machine Status Card */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Trạng thái máy</Text>
        <View style={styles.machineStatusRow}>
          <View style={styles.machineStatusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#10b981' }]} />
            <Text style={styles.machineStatusValue}>{machineStatus.online}</Text>
            <Text style={styles.machineStatusLabel}>Online</Text>
          </View>
          <View style={styles.machineStatusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#6b7280' }]} />
            <Text style={styles.machineStatusValue}>{machineStatus.offline}</Text>
            <Text style={styles.machineStatusLabel}>Offline</Text>
          </View>
          <View style={styles.machineStatusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.machineStatusValue}>{machineStatus.error}</Text>
            <Text style={styles.machineStatusLabel}>Error</Text>
          </View>
        </View>
        
        {/* Availability Bar */}
        <View style={styles.availabilityContainer}>
          <Text style={styles.availabilityLabel}>Availability</Text>
          <View style={styles.availabilityBar}>
            <View
              style={[
                styles.availabilityFill,
                {
                  width: `${machineStatus.total ? (machineStatus.online / machineStatus.total) * 100 : 0}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.availabilityValue}>
            {machineStatus.total ? ((machineStatus.online / machineStatus.total) * 100).toFixed(0) : 0}%
          </Text>
        </View>
      </View>

      {/* Yield Alerts */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Cảnh báo Yield</Text>
        {yieldAlerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyText}>Không có cảnh báo</Text>
          </View>
        ) : (
          yieldAlerts.map((alert, index) => (
            <View
              key={index}
              style={[
                styles.alertItem,
                { borderLeftColor: alert.severity === 'critical' ? '#ef4444' : '#f59e0b' },
              ]}
            >
              <View style={styles.alertContent}>
                <Text style={styles.alertMachine}>{alert.machineName}</Text>
                <Text style={styles.alertCode}>{alert.machineCode}</Text>
              </View>
              <View style={styles.alertYield}>
                <Text
                  style={[
                    styles.alertYieldValue,
                    { color: alert.severity === 'critical' ? '#ef4444' : '#f59e0b' },
                  ]}
                >
                  {alert.yieldRate.toFixed(1)}%
                </Text>
                <Text style={styles.alertThreshold}>Ngưỡng: {alert.threshold}%</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Last Updated */}
      <Text style={styles.lastUpdated}>
        Cập nhật lúc: {new Date().toLocaleTimeString('vi-VN')}
      </Text>
    </ScrollView>
  );
}

// KPI Card Component
function KPICard({
  title,
  value,
  icon,
  color,
  isPercentage = false,
}: {
  title: string;
  value: number | string;
  icon: string;
  color: string;
  isPercentage?: boolean;
}) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <View style={styles.kpiHeader}>
        <Text style={styles.kpiIcon}>{icon}</Text>
        <Text style={styles.kpiTitle}>{title}</Text>
      </View>
      <Text style={[styles.kpiValue, { color }]}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
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
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderTopWidth: 3,
  },
  kpiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  kpiIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  kpiTitle: {
    color: '#888',
    fontSize: 12,
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  sectionCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  machineStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  machineStatusItem: {
    alignItems: 'center',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  machineStatusValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  machineStatusLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  availabilityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  availabilityLabel: {
    color: '#888',
    fontSize: 12,
    width: 80,
  },
  availabilityBar: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginHorizontal: 12,
  },
  availabilityFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 4,
  },
  availabilityValue: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    width: 40,
    textAlign: 'right',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
  },
  alertItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    borderLeftWidth: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    marginBottom: 8,
  },
  alertContent: {
    flex: 1,
  },
  alertMachine: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  alertCode: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  alertYield: {
    alignItems: 'flex-end',
    paddingRight: 12,
  },
  alertYieldValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  alertThreshold: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  lastUpdated: {
    color: '#666',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
