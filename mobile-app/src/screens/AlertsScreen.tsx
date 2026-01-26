/**
 * Alerts Screen - Hiển thị danh sách cảnh báo và push notifications
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useMqttStore, Alert, NGAlert, SummaryAlert } from '../stores/mqttStore';

const { width, height } = Dimensions.get('window');

export default function AlertsScreen() {
  const { alerts, dismissAlert, clearAlerts } = useMqttStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<NGAlert | null>(null);
  const [filter, setFilter] = useState<'all' | 'ng' | 'summary'>('all');

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'ng') return alert.type === 'NG_ALERT';
    if (filter === 'summary') return alert.type === 'DAILY_SUMMARY' || alert.type === 'WEEKLY_SUMMARY';
    return true;
  });

  const undismissedCount = alerts.filter(a => !a.dismissed).length;

  const renderAlertItem = ({ item }: { item: Alert }) => {
    const isNG = item.type === 'NG_ALERT';
    const ngAlert = item as NGAlert;
    const summaryAlert = item as SummaryAlert;

    return (
      <TouchableOpacity
        style={[styles.alertCard, item.dismissed && styles.alertDismissed]}
        onPress={() => {
          if (isNG) {
            setSelectedAlert(ngAlert);
          }
        }}
        onLongPress={() => dismissAlert(item.id)}
      >
        <View style={[styles.alertBadge, { backgroundColor: isNG ? '#ef4444' : '#3b82f6' }]}>
          <Text style={styles.alertBadgeText}>
            {isNG ? 'NG' : item.type === 'DAILY_SUMMARY' ? 'Ngày' : 'Tuần'}
          </Text>
        </View>

        <View style={styles.alertContent}>
          {isNG ? (
            <>
              <Text style={styles.alertTitle}>{ngAlert.machineName}</Text>
              <Text style={styles.alertSubtitle}>{ngAlert.serialNumber}</Text>
              <View style={styles.alertMeta}>
                <Text style={styles.alertMetaText}>
                  {ngAlert.totalNG} điểm NG • {ngAlert.stationName}
                </Text>
              </View>
              {ngAlert.ngPoints && ngAlert.ngPoints.length > 0 && (
                <View style={styles.ngPointsPreview}>
                  {ngAlert.ngPoints.slice(0, 3).map((point, idx) => (
                    <Text key={idx} style={styles.ngPointText}>
                      • {point.pointName}: {point.result}
                    </Text>
                  ))}
                  {ngAlert.ngPoints.length > 3 && (
                    <Text style={styles.ngPointMore}>
                      +{ngAlert.ngPoints.length - 3} điểm khác
                    </Text>
                  )}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.alertTitle}>
                {item.type === 'DAILY_SUMMARY' ? 'Báo cáo ngày' : 'Báo cáo tuần'}
              </Text>
              <Text style={styles.alertSubtitle}>{summaryAlert.stationName}</Text>
              <View style={styles.summaryStats}>
                <View style={styles.summaryStatItem}>
                  <Text style={styles.summaryStatValue}>
                    {summaryAlert.statistics.totalInspections}
                  </Text>
                  <Text style={styles.summaryStatLabel}>Kiểm tra</Text>
                </View>
                <View style={styles.summaryStatItem}>
                  <Text style={[styles.summaryStatValue, { color: '#ef4444' }]}>
                    {summaryAlert.statistics.totalNG}
                  </Text>
                  <Text style={styles.summaryStatLabel}>NG</Text>
                </View>
                <View style={styles.summaryStatItem}>
                  <Text style={[styles.summaryStatValue, { color: '#f59e0b' }]}>
                    {summaryAlert.statistics.ngRate.toFixed(1)}%
                  </Text>
                  <Text style={styles.summaryStatLabel}>Tỷ lệ NG</Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={styles.alertRight}>
          <Text style={styles.alertTime}>
            {new Date(item.receivedAt).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <Text style={styles.alertDate}>
            {new Date(item.receivedAt).toLocaleDateString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
            })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Cảnh báo</Text>
          {undismissedCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{undismissedCount}</Text>
            </View>
          )}
        </View>
        {alerts.length > 0 && (
          <TouchableOpacity onPress={clearAlerts}>
            <Text style={styles.clearButton}>Xóa tất cả</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterTabs}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
            Tất cả ({alerts.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'ng' && styles.filterTabActive]}
          onPress={() => setFilter('ng')}
        >
          <Text style={[styles.filterTabText, filter === 'ng' && styles.filterTabTextActive]}>
            NG ({alerts.filter(a => a.type === 'NG_ALERT').length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'summary' && styles.filterTabActive]}
          onPress={() => setFilter('summary')}
        >
          <Text style={[styles.filterTabText, filter === 'summary' && styles.filterTabTextActive]}>
            Báo cáo ({alerts.filter(a => a.type !== 'NG_ALERT').length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Alerts List */}
      <FlatList
        data={filteredAlerts}
        renderItem={renderAlertItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>Không có cảnh báo</Text>
            <Text style={styles.emptySubtitle}>
              Các cảnh báo NG và báo cáo sẽ hiển thị ở đây
            </Text>
          </View>
        }
      />

      {/* NG Alert Detail Modal */}
      <Modal
        visible={selectedAlert !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedAlert(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chi tiết NG Alert</Text>
              <TouchableOpacity onPress={() => setSelectedAlert(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedAlert && (
              <ScrollView style={styles.modalBody}>
                {/* Image */}
                {selectedAlert.imageUrl && (
                  <Image
                    source={{ uri: selectedAlert.imageUrl }}
                    style={styles.ngImage}
                    resizeMode="contain"
                  />
                )}

                {/* Info */}
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Serial Number</Text>
                  <Text style={styles.infoValue}>{selectedAlert.serialNumber}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Sản phẩm</Text>
                  <Text style={styles.infoValue}>{selectedAlert.productName}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Máy</Text>
                  <Text style={styles.infoValue}>{selectedAlert.machineName}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Trạm</Text>
                  <Text style={styles.infoValue}>{selectedAlert.stationName}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Thời gian</Text>
                  <Text style={styles.infoValue}>
                    {new Date(selectedAlert.timestamp).toLocaleString('vi-VN')}
                  </Text>
                </View>

                {/* NG Points */}
                <Text style={styles.ngPointsTitle}>Điểm NG ({selectedAlert.totalNG})</Text>
                {selectedAlert.ngPoints?.map((point, idx) => (
                  <View key={idx} style={styles.ngPointItem}>
                    <View style={styles.ngPointHeader}>
                      <Text style={styles.ngPointName}>{point.pointName}</Text>
                      <Text style={styles.ngPointResult}>{point.result}</Text>
                    </View>
                    {point.actualValue && (
                      <Text style={styles.ngPointValue}>Giá trị: {point.actualValue}</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clearButton: {
    color: '#3b82f6',
    fontSize: 14,
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  filterTabActive: {
    backgroundColor: '#3b82f6',
  },
  filterTabText: {
    color: '#888',
    fontSize: 12,
  },
  filterTabTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  alertCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
  },
  alertDismissed: {
    opacity: 0.5,
  },
  alertBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginRight: 12,
  },
  alertBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  alertSubtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  alertMeta: {
    marginTop: 4,
  },
  alertMetaText: {
    color: '#666',
    fontSize: 11,
  },
  ngPointsPreview: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  ngPointText: {
    color: '#ef4444',
    fontSize: 11,
    marginBottom: 2,
  },
  ngPointMore: {
    color: '#888',
    fontSize: 10,
    fontStyle: 'italic',
  },
  summaryStats: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  summaryStatItem: {
    alignItems: 'center',
  },
  summaryStatValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  summaryStatLabel: {
    color: '#888',
    fontSize: 10,
  },
  alertRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  alertTime: {
    color: '#888',
    fontSize: 12,
  },
  alertDate: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.85,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalClose: {
    color: '#888',
    fontSize: 20,
    padding: 4,
  },
  modalBody: {
    padding: 16,
  },
  ngImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#000',
    borderRadius: 8,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  infoLabel: {
    color: '#888',
    fontSize: 13,
  },
  infoValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  ngPointsTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  ngPointItem: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  ngPointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ngPointName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  ngPointResult: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  ngPointValue: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
});
