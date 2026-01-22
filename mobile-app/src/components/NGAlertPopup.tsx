/**
 * NG Alert Popup Component
 * Hiển thị popup ở trên cùng màn hình khi nhận được NG alert
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useMqttStore, NGAlert, SummaryAlert, Alert } from '../stores/mqttStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface NGAlertPopupProps {
  alert: Alert;
  onDismiss: () => void;
}

export default function NGAlertPopup({ alert, onDismiss }: NGAlertPopupProps) {
  const slideAnim = useRef(new Animated.Value(-300)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;
  const settings = useMqttStore(state => state.settings);

  useEffect(() => {
    // Slide in animation
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 8,
    }).start();

    // Progress bar animation
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: settings.alertDisplayDuration * 1000,
      useNativeDriver: false,
    }).start();

    // Auto dismiss
    const timer = setTimeout(() => {
      handleDismiss();
    }, settings.alertDisplayDuration * 1000);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onDismiss();
    });
  };

  const isNGAlert = alert.type === 'NG_ALERT';
  const ngAlert = alert as NGAlert;
  const summaryAlert = alert as SummaryAlert;

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* Progress bar */}
      <Animated.View
        style={[
          styles.progressBar,
          {
            width: progressAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
            backgroundColor: isNGAlert ? '#ef4444' : '#3b82f6',
          },
        ]}
      />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: isNGAlert ? '#ef4444' : '#3b82f6' }]}>
        <View style={styles.headerContent}>
          <Text style={styles.alertIcon}>{isNGAlert ? '⚠️' : '📊'}</Text>
          <View style={styles.headerText}>
            <Text style={styles.alertTitle}>
              {isNGAlert ? 'NG Alert' : (alert.type === 'DAILY_SUMMARY' ? 'Báo cáo ngày' : 'Báo cáo tuần')}
            </Text>
            <Text style={styles.alertSubtitle}>
              {isNGAlert ? ngAlert.stationName : summaryAlert.stationName}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleDismiss} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {isNGAlert ? (
          <NGAlertContent alert={ngAlert} />
        ) : (
          <SummaryContent alert={summaryAlert} />
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.timestamp}>
          {new Date(alert.receivedAt).toLocaleTimeString('vi-VN')}
        </Text>
        <TouchableOpacity onPress={handleDismiss} style={styles.dismissButton}>
          <Text style={styles.dismissButtonText}>Đóng</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// NG Alert Content
function NGAlertContent({ alert }: { alert: NGAlert }) {
  const ngPoints = alert.ngPoints.filter(p => p.result === 'NG');

  return (
    <View>
      {/* Machine & Product Info */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Máy</Text>
          <Text style={styles.infoValue}>{alert.machineName}</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Serial</Text>
          <Text style={styles.infoValue}>{alert.serialNumber}</Text>
        </View>
      </View>

      {/* NG Count */}
      <View style={styles.ngCountContainer}>
        <Text style={styles.ngCountLabel}>Số điểm NG</Text>
        <Text style={styles.ngCountValue}>{alert.totalNG}</Text>
      </View>

      {/* NG Points List */}
      <View style={styles.ngPointsContainer}>
        <Text style={styles.sectionTitle}>Điểm đo NG:</Text>
        {ngPoints.map((point, index) => (
          <View key={index} style={styles.ngPointItem}>
            <View style={styles.ngPointDot} />
            <View style={styles.ngPointInfo}>
              <Text style={styles.ngPointName}>{point.pointName}</Text>
              {point.actualValue && (
                <Text style={styles.ngPointValue}>Giá trị: {point.actualValue}</Text>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Image Preview */}
      {alert.imageUrl && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: alert.imageUrl }}
            style={styles.alertImage}
            resizeMode="contain"
          />
        </View>
      )}
    </View>
  );
}

// Summary Content
function SummaryContent({ alert }: { alert: SummaryAlert }) {
  const { statistics, topNGPoints } = alert;

  return (
    <View>
      {/* Period */}
      <View style={styles.periodContainer}>
        <Text style={styles.periodText}>
          {new Date(alert.period.start).toLocaleDateString('vi-VN')} - {new Date(alert.period.end).toLocaleDateString('vi-VN')}
        </Text>
      </View>

      {/* Statistics */}
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{statistics.totalInspections}</Text>
          <Text style={styles.statLabel}>Tổng kiểm tra</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{statistics.totalNG}</Text>
          <Text style={styles.statLabel}>Tổng NG</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>{statistics.ngRate.toFixed(1)}%</Text>
          <Text style={styles.statLabel}>Tỷ lệ NG</Text>
        </View>
      </View>

      {/* Top NG Points */}
      {topNGPoints.length > 0 && (
        <View style={styles.topNGContainer}>
          <Text style={styles.sectionTitle}>Top điểm NG:</Text>
          {topNGPoints.slice(0, 5).map((point, index) => (
            <View key={index} style={styles.topNGItem}>
              <Text style={styles.topNGRank}>#{index + 1}</Text>
              <Text style={styles.topNGName}>{point.pointName}</Text>
              <Text style={styles.topNGCount}>{point.ngCount} ({point.percentage.toFixed(1)}%)</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a2e',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    maxHeight: '70%',
    zIndex: 1000,
  },
  progressBar: {
    height: 3,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  alertIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  alertSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    padding: 16,
    maxHeight: 300,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  infoItem: {
    flex: 1,
  },
  infoLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  ngCountContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  ngCountLabel: {
    color: '#888',
    fontSize: 12,
  },
  ngCountValue: {
    color: '#ef4444',
    fontSize: 32,
    fontWeight: 'bold',
  },
  ngPointsContainer: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  ngPointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  ngPointDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 12,
  },
  ngPointInfo: {
    flex: 1,
  },
  ngPointName: {
    color: '#fff',
    fontSize: 14,
  },
  ngPointValue: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  imageContainer: {
    marginTop: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  alertImage: {
    width: '100%',
    height: 150,
  },
  periodContainer: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  periodText: {
    color: '#3b82f6',
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  topNGContainer: {
    marginTop: 8,
  },
  topNGItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  topNGRank: {
    color: '#888',
    fontSize: 12,
    width: 30,
  },
  topNGName: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
  topNGCount: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  timestamp: {
    color: '#888',
    fontSize: 12,
  },
  dismissButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  dismissButtonText: {
    color: '#fff',
    fontSize: 14,
  },
});
