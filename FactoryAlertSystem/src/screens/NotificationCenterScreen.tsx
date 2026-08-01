/**
 * Factory Alert System - Notification Center Screen
 * Trung tâm thông báo gộp Cảnh báo + Bản tin + KPI Dashboard
 */

import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  StatusBar,
  Modal,
  RefreshControl,
  Alert as RNAlert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';

import {
  SwipeableAlertCard,
  BulletinCard,
  EmptyState,
  SeverityBadge,
  KPICard,
  ConnectionStatus,
  ConnectionBanner,
  PulseView,
} from '../components';
import {
  useAlertStore,
  selectAlerts,
  selectPendingCount,
  selectTotalCount,
  selectCountBySeverity,
  selectEscalatedCount,
  useBulletinStore,
  selectBulletins,
  selectUnreadCount,
  selectBulletinTotalCount,
  useSettingsStore,
  selectLanguage,
} from '../store';
import { Alert, AlertSeverity, AlertStatus, PeriodicBulletin, RootStackParamList } from '../types';
import { TRANSLATIONS, SEVERITY_CONFIG } from '../utils/constants';
import { filterAlerts, sortAlerts, getSeverityLabel } from '../utils/helpers';
import { useTheme, Theme } from '../context/ThemeContext';
import { useResponsive } from '../utils/useResponsive';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ALL_SEVERITIES: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * 3E: memoized swipeable row. Binds the per-alert callbacks with useCallback so the
 * SwipeableAlertCard's Wave-2 memo stays effective (stable refs while the alert is
 * unchanged); re-binds only when the alert or a screen handler changes.
 */
interface AlertRowProps {
  alert: Alert;
  onPress: (a: Alert) => void;
  onAcknowledge: (a: Alert) => void;
  onDismiss: (a: Alert) => void;
}

const AlertRow = React.memo(function AlertRow({ alert, onPress, onAcknowledge, onDismiss }: AlertRowProps) {
  const handlePress = useCallback(() => onPress(alert), [alert, onPress]);
  const handleAck = useCallback(() => onAcknowledge(alert), [alert, onAcknowledge]);
  const handleDismiss = useCallback(() => onDismiss(alert), [alert, onDismiss]);
  return (
    <SwipeableAlertCard
      alert={alert}
      onPress={handlePress}
      onAcknowledge={handleAck}
      onDismiss={handleDismiss}
    />
  );
});

// MB6: 'escalated' tab shows only server-escalated alerts
type TabType = 'all' | 'alerts' | 'bulletins' | 'escalated';

type UnifiedItem =
  | { type: 'alert'; data: Alert; sortTime: number }
  | { type: 'bulletin'; data: PeriodicBulletin; sortTime: number };

const NotificationCenterScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const language = useSettingsStore(selectLanguage);
  const t = TRANSLATIONS[language];
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Wave 4A: responsive multi-column on tablets/wide screens (reacts to rotation).
  // Keep it to 2 columns max for this mixed alert/bulletin card list.
  const { isTablet } = useResponsive();
  const numColumns = isTablet ? 2 : 1;

  // Alert store
  const alerts = useAlertStore(selectAlerts);
  const pendingCount = useAlertStore(selectPendingCount);
  const totalCount = useAlertStore(selectTotalCount);
  // Wave 2E: selectCountBySeverity builds a fresh object every call, which would
  // bypass Zustand's Object.is() equality and re-render on every store change.
  // useShallow compares the counts shallowly so we only re-render when a value
  // actually changes.
  const countBySeverity = useAlertStore(useShallow(selectCountBySeverity));
  const escalatedCount = useAlertStore(selectEscalatedCount); // MB6
  const acknowledgeAlert = useAlertStore((state) => state.acknowledgeAlert);
  const removeAlert = useAlertStore((state) => state.removeAlert);
  const clearAllAlerts = useAlertStore((state) => state.clearAll);
  const loadAlerts = useAlertStore((state) => state.loadAlerts);
  const loadAlertsFromServer = useAlertStore((state) => state.loadAlertsFromServer);

  // Bulletin store
  const bulletins = useBulletinStore(selectBulletins);
  const unreadBulletinCount = useBulletinStore(selectUnreadCount);
  const bulletinTotalCount = useBulletinStore(selectBulletinTotalCount);
  const loadBulletins = useBulletinStore((state) => state.loadBulletins);
  const loadBulletinsFromServer = useBulletinStore((state) => state.loadBulletinsFromServer);
  const markAllBulletinsRead = useBulletinStore((state) => state.markAllAsRead);
  const clearAllBulletins = useBulletinStore((state) => state.clearAll);

  // Local state
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedSeverities, setSelectedSeverities] = useState<AlertSeverity[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<AlertStatus[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortBy, setSortBy] = useState<'timestamp' | 'severity'>('timestamp');
  const [refreshing, setRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);

  // Load data on mount
  useEffect(() => {
    loadAlerts();
    loadBulletins();
    loadAlertsFromServer({ limit: 50 }).catch(() => {});
    loadBulletinsFromServer({ limit: 50 }).catch(() => {});
  }, []);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    let result = filterAlerts(alerts, {
      severity: selectedSeverities.length > 0 ? selectedSeverities : undefined,
      status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
      searchText: searchText.trim() || undefined,
    });
    return sortAlerts(result, sortBy, 'desc');
  }, [alerts, selectedSeverities, selectedStatuses, searchText, sortBy]);

  // Filter bulletins by search
  const filteredBulletins = useMemo(() => {
    if (!searchText.trim()) return bulletins;
    const q = searchText.trim().toLowerCase();
    return bulletins.filter(
      (b) =>
        (b.stationName || '').toLowerCase().includes(q) ||
        String(b.stationId || '').toLowerCase().includes(q) ||
        (b.bulletinId || '').toLowerCase().includes(q)
    );
  }, [bulletins, searchText]);

  // Unified items for "all" tab
  const unifiedItems = useMemo((): UnifiedItem[] => {
    if (activeTab === 'alerts') {
      return filteredAlerts.map((a) => ({
        type: 'alert' as const,
        data: a,
        sortTime: new Date(a.timestamp).getTime(),
      }));
    }
    // MB6: escalated tab — only alerts flagged by the server escalation sweep
    if (activeTab === 'escalated') {
      return filteredAlerts
        .filter((a) => a.escalated === true)
        .map((a) => ({
          type: 'alert' as const,
          data: a,
          sortTime: new Date(a.escalatedAt || a.timestamp).getTime(),
        }));
    }
    if (activeTab === 'bulletins') {
      return filteredBulletins.map((b) => ({
        type: 'bulletin' as const,
        data: b,
        sortTime: new Date(b.receivedAt || b.period?.end || Date.now()).getTime(),
      }));
    }
    // "all" tab: merge and sort by time
    const alertItems: UnifiedItem[] = filteredAlerts.map((a) => ({
      type: 'alert' as const,
      data: a,
      sortTime: new Date(a.timestamp).getTime(),
    }));
    const bulletinItems: UnifiedItem[] = filteredBulletins.map((b) => ({
      type: 'bulletin' as const,
      data: b,
      sortTime: new Date(b.receivedAt || b.period?.end || Date.now()).getTime(),
    }));
    return [...alertItems, ...bulletinItems].sort((a, b) => b.sortTime - a.sortTime);
  }, [activeTab, filteredAlerts, filteredBulletins]);

  // Handlers
  const handleAlertPress = useCallback(
    (alert: Alert) => {
      navigation.navigate('AlertDetail', { alertId: alert.id });
    },
    [navigation]
  );

  const handleAcknowledge = useCallback(
    (alert: Alert) => {
      acknowledgeAlert(alert.id);
    },
    [acknowledgeAlert]
  );

  const handleDismiss = useCallback(
    (alert: Alert) => {
      removeAlert(alert.id);
    },
    [removeAlert]
  );

  const handleBulletinPress = useCallback(
    (bulletin: PeriodicBulletin) => {
      navigation.navigate('BulletinDetail', { bulletinId: bulletin.bulletinId });
    },
    [navigation]
  );

  const handleClearAll = useCallback(() => {
    if (activeTab === 'bulletins') {
      RNAlert.alert(
        language === 'vi' ? 'Xóa tất cả' : language === 'zh' ? '全部删除' : 'Clear All',
        language === 'vi' ? 'Bạn có chắc muốn xóa tất cả bản tin?' : language === 'zh' ? '确定要删除所有公告吗？' : 'Are you sure you want to clear all bulletins?',
        [
          { text: t.no, style: 'cancel' },
          { text: t.yes, style: 'destructive', onPress: () => clearAllBulletins() },
        ]
      );
    } else if (activeTab === 'alerts') {
      RNAlert.alert(
        t.clearAll,
        t.confirmClearAll,
        [
          { text: t.no, style: 'cancel' },
          { text: t.yes, style: 'destructive', onPress: () => clearAllAlerts() },
        ]
      );
    } else {
      RNAlert.alert(
        t.clearAll,
        language === 'vi' ? 'Bạn có chắc muốn xóa tất cả cảnh báo và bản tin?' : language === 'zh' ? '确定要删除所有警报和公告吗？' : 'Are you sure you want to clear all alerts and bulletins?',
        [
          { text: t.no, style: 'cancel' },
          {
            text: t.yes,
            style: 'destructive',
            onPress: () => {
              clearAllAlerts();
              clearAllBulletins();
            },
          },
        ]
      );
    }
  }, [activeTab, clearAllAlerts, clearAllBulletins, t, language]);

  const handleMarkAllRead = useCallback(() => {
    markAllBulletinsRead();
  }, [markAllBulletinsRead]);

  const toggleSeverityFilter = useCallback((severity: AlertSeverity) => {
    setSelectedSeverities((prev) =>
      prev.includes(severity) ? prev.filter((s) => s !== severity) : [...prev, severity]
    );
  }, []);

  const toggleStatusFilter = useCallback((status: AlertStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedSeverities([]);
    setSelectedStatuses([]);
    setSearchText('');
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAlerts(), loadBulletins()]);
    loadAlertsFromServer({ limit: 50 }).catch(() => {});
    loadBulletinsFromServer({ limit: 50 }).catch(() => {});
    setRefreshing(false);
  }, [loadAlerts, loadBulletins, loadAlertsFromServer, loadBulletinsFromServer]);

  const hasActiveFilters =
    selectedSeverities.length > 0 || selectedStatuses.length > 0 || searchText.trim().length > 0;

  const urgentCount = countBySeverity.critical + countBySeverity.high;
  const hasCritical = countBySeverity.critical > 0; // 3F: drives the badge pulse

  // Navigate to settings
  const handleConnectionPress = useCallback(() => {
    navigation.navigate('Main', { screen: 'Settings' } as any);
  }, [navigation]);

  // Render item — 3E: live alert rows use the swipeable card (swipe → ack/dismiss).
  // 3F: rows fade+slide in and animate layout changes (transform+opacity, native-driver).
  const renderItem = useCallback(
    ({ item }: { item: UnifiedItem }) => {
      const content =
        item.type === 'alert' ? (
          <AlertRow
            alert={item.data}
            onPress={handleAlertPress}
            onAcknowledge={handleAcknowledge}
            onDismiss={handleDismiss}
          />
        ) : (
          <BulletinCard bulletin={item.data} onPress={handleBulletinPress} />
        );
      return (
        <Animated.View
          entering={FadeInDown.duration(220)}
          layout={LinearTransition.duration(220)}
          style={numColumns > 1 ? styles.gridCell : undefined}
        >
          {content}
        </Animated.View>
      );
    },
    [handleAlertPress, handleAcknowledge, handleDismiss, handleBulletinPress, numColumns, styles.gridCell]
  );

  const keyExtractor = useCallback(
    (item: UnifiedItem) => (item.type === 'alert' ? item.data.id : item.data.bulletinId),
    []
  );

  // Dashboard section
  const renderDashboard = () => {
    if (!showDashboard) return null;
    return (
      <View style={styles.dashboardContainer}>
        {/* KPI Row */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <KPICard
              title={t.totalAlerts}
              value={totalCount}
              icon="alert-circle-outline"
              iconColor={theme.colors.info}
            />
          </View>
          <View style={styles.kpiItem}>
            <KPICard
              title={t.pendingAlerts}
              value={pendingCount}
              icon="clock-alert-outline"
              iconColor={pendingCount > 0 ? theme.colors.warning : theme.colors.success}
            />
          </View>
        </View>

        {/* Urgent Banner — 3F: pulsing icon draws the eye when urgent alerts exist */}
        {urgentCount > 0 && (
          <View style={styles.urgentBanner}>
            <PulseView active>
              <Icon name="alert-octagon" size={20} color={theme.colors.error} />
            </PulseView>
            <Text style={styles.urgentText}>
              {urgentCount}{' '}
              {language === 'vi' ? 'cảnh báo khẩn cấp cần xử lý!' : language === 'zh' ? '个紧急警报需要处理！' : 'urgent alerts need attention!'}
            </Text>
          </View>
        )}

        {/* Severity stats — 3D: all 5 tiers, localized labels (getSeverityLabel),
            and the readable mediumText token instead of the ad-hoc '#B45309' patch. */}
        <View style={styles.severityStats}>
          {ALL_SEVERITIES.map((sev) => {
            const valueColor = sev === 'medium' ? theme.colors.mediumText : theme.colors[sev];
            return (
              <View key={sev} style={[styles.severityStat, { backgroundColor: `${theme.colors[sev]}15` }]}>
                <Text style={[styles.severityValue, { color: valueColor }]}>
                  {countBySeverity[sev]}
                </Text>
                <Text style={styles.severityLabel} numberOfLines={1} adjustsFontSizeToFit>
                  {getSeverityLabel(sev, language)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bulletin stats */}
        {bulletinTotalCount > 0 && (
          <View style={styles.bulletinStatsRow}>
            <Icon name="newspaper-variant-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.bulletinStatsText}>
              {bulletinTotalCount} {language === 'vi' ? 'bản tin' : language === 'zh' ? '公告' : 'bulletins'}
              {unreadBulletinCount > 0 && (
                <Text style={styles.bulletinUnreadText}>
                  {' '}• {unreadBulletinCount} {language === 'vi' ? 'chưa đọc' : language === 'zh' ? '未读' : 'unread'}
                </Text>
              )}
            </Text>
          </View>
        )}
      </View>
    );
  };

  // List header
  const renderListHeader = () => (
    <View>
      {renderDashboard()}
      <View style={styles.listHeader}>
        <Text style={styles.resultCount}>
          {unifiedItems.length}{' '}
          {activeTab === 'alerts'
            ? language === 'vi' ? 'cảnh báo' : language === 'zh' ? '警报' : 'alerts'
            : activeTab === 'bulletins'
            ? language === 'vi' ? 'bản tin' : language === 'zh' ? '公告' : 'bulletins'
            : language === 'vi' ? 'thông báo' : language === 'zh' ? '通知' : 'notifications'}
          {hasActiveFilters && ` (${language === 'vi' ? 'đã lọc' : language === 'zh' ? '已筛选' : 'filtered'})`}
        </Text>
        <View style={styles.listHeaderActions}>
          {activeTab !== 'alerts' && unreadBulletinCount > 0 && (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.actionButton}>
              <Icon name="check-all" size={18} color={theme.colors.primary} />
            </TouchableOpacity>
          )}
          {unifiedItems.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} style={styles.actionButton}>
              <Icon name="delete-sweep" size={18} color={theme.colors.error} />
              <Text style={styles.clearAllText}>{t.clearAll}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="factory" size={24} color={theme.colors.primary} />
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>
              {language === 'vi' ? 'Trung tâm thông báo' : language === 'zh' ? '通知中心' : 'Notification Center'}
            </Text>
            <Text style={styles.headerSubtitle}>{t.appSubtitle}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setShowDashboard(!showDashboard)}
            style={styles.headerIconBtn}
          >
            <Icon
              name={showDashboard ? 'chart-box' : 'chart-box-outline'}
              size={22}
              color={theme.colors.textSecondary}
            />
          </TouchableOpacity>
          <ConnectionStatus onPress={handleConnectionPress} size="small" />
        </View>
      </View>

      {/* 3D: persistent full-width DISCONNECTED / error banner pinned under the header */}
      <ConnectionBanner />

      {/* Quick Filter Chips (MB6: + escalated tab) */}
      <View style={styles.filterChipBar}>
        {(['all', 'alerts', 'escalated', 'bulletins'] as TabType[]).map((tab) => {
          const isActive = activeTab === tab;
          const label =
            tab === 'all'
              ? language === 'vi' ? 'Tất cả' : language === 'zh' ? '全部' : 'All'
              : tab === 'alerts'
              ? t.alerts
              : tab === 'escalated'
              ? t.escalatedFilter
              : t.bulletins;
          const badge =
            tab === 'alerts'
              ? pendingCount
              : tab === 'escalated'
              ? escalatedCount
              : tab === 'bulletins'
              ? unreadBulletinCount
              : pendingCount + unreadBulletinCount;

          const badgeView = badge > 0 && (
            <View
              style={[
                styles.filterChipBadge,
                { backgroundColor: isActive ? theme.colors.white : (tab === 'bulletins' ? theme.colors.info : theme.colors.error) },
              ]}
            >
              <Text style={[styles.filterChipBadgeText, isActive && { color: theme.colors.primary }]}>
                {badge > 99 ? '99+' : badge}
              </Text>
            </View>
          );
          return (
            <Pressable
              key={tab}
              style={({ pressed }) => [
                styles.filterChip,
                isActive && styles.filterChipActive,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setActiveTab(tab)}
              android_ripple={{ color: `${theme.colors.primary}22`, borderless: false }}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{label}</Text>
              {/* 3F: pulse the alert-bearing badges when a critical is live */}
              {badge > 0 &&
                (hasCritical && tab !== 'bulletins' ? (
                  <PulseView active>{badgeView}</PulseView>
                ) : (
                  badgeView
                ))}
            </Pressable>
          );
        })}
      </View>

      {/* Search and Filter Bar */}
      <View style={styles.searchBar}>
        <View style={styles.searchInputContainer}>
          <Icon name="magnify" size={20} color={theme.colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={language === 'vi' ? 'Tìm kiếm...' : language === 'zh' ? '搜索...' : 'Search...'}
            placeholderTextColor={theme.colors.textMuted}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Icon name="close-circle" size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {activeTab !== 'bulletins' && (
          <TouchableOpacity
            style={[styles.filterButton, hasActiveFilters && styles.filterButtonActive]}
            onPress={() => setShowFilterModal(true)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Icon
              name="filter-variant"
              size={22}
              color={hasActiveFilters ? theme.colors.primary : theme.colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {activeTab !== 'bulletins' && (
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortBy(sortBy === 'timestamp' ? 'severity' : 'timestamp')}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Icon
              name={sortBy === 'timestamp' ? 'sort-clock-descending' : 'sort-descending'}
              size={22}
              color={theme.colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <View style={styles.activeFilters}>
          {selectedSeverities.map((severity) => (
            <TouchableOpacity
              key={severity}
              style={[styles.filterChip, { backgroundColor: SEVERITY_CONFIG[severity].bgColor }]}
              onPress={() => toggleSeverityFilter(severity)}
            >
              <Text style={[styles.filterChipText, { color: SEVERITY_CONFIG[severity].color }]}>
                {language === 'vi' ? SEVERITY_CONFIG[severity].label : language === 'zh' ? SEVERITY_CONFIG[severity].labelZh : SEVERITY_CONFIG[severity].labelEn}
              </Text>
              <Icon name="close" size={14} color={SEVERITY_CONFIG[severity].color} />
            </TouchableOpacity>
          ))}
          {selectedStatuses.map((status) => (
            <TouchableOpacity
              key={status}
              style={styles.filterChip}
              onPress={() => toggleStatusFilter(status)}
            >
              <Text style={styles.filterChipText}>{status}</Text>
              <Icon name="close" size={14} color={theme.colors.text} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
            <Text style={styles.clearFiltersText}>
              {language === 'vi' ? 'Xóa bộ lọc' : language === 'zh' ? '清除筛选' : 'Clear filters'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Unified List */}
      <FlatList
        data={unifiedItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        // Wave 4A: multi-column on tablets. numColumns changes require a fresh
        // `key` to force a remount, otherwise FlatList throws.
        key={`cols-${numColumns}`}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
        // Wave 2E: virtualization tuning for the main live list on low-RAM tablets.
        // Rows are variable height (alert vs bulletin cards), so getItemLayout is
        // intentionally omitted to avoid layout bugs.
        removeClippedSubviews
        windowSize={5}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          <EmptyState
            icon={hasActiveFilters ? 'filter-remove-outline' : 'check-circle-outline'}
            title={
              hasActiveFilters
                ? language === 'vi' ? 'Không tìm thấy kết quả' : language === 'zh' ? '未找到结果' : 'No results found'
                : activeTab === 'bulletins'
                ? language === 'vi' ? 'Chưa có bản tin nào' : language === 'zh' ? '暂无公告' : 'No bulletins yet'
                : t.noAlerts
            }
            description={
              hasActiveFilters
                ? language === 'vi' ? 'Thử điều chỉnh bộ lọc' : language === 'zh' ? '请尝试调整筛选条件' : 'Try adjusting your filters'
                : activeTab === 'bulletins'
                ? language === 'vi'
                  ? 'Các bản tin định kỳ từ hệ thống sẽ hiển thị ở đây'
                  : language === 'zh'
                  ? '系统定期公告将显示在这里'
                  : 'Periodic bulletins will appear here'
                : t.noAlertsDescription
            }
            iconColor={hasActiveFilters ? theme.colors.textMuted : theme.colors.success}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Filter Modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {language === 'vi' ? 'Bộ lọc' : language === 'zh' ? '筛选' : 'Filters'}
              </Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Icon name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            {/* Severity Filter */}
            <Text style={styles.filterSectionTitle}>
              {language === 'vi' ? 'Mức độ' : language === 'zh' ? '严重程度' : 'Severity'}
            </Text>
            <View style={styles.filterOptions}>
              {(['critical', 'high', 'medium', 'low', 'info'] as AlertSeverity[]).map((severity) => (
                <TouchableOpacity
                  key={severity}
                  style={[
                    styles.filterOption,
                    selectedSeverities.includes(severity) && styles.filterOptionSelected,
                    { borderColor: SEVERITY_CONFIG[severity].bgColor },
                  ]}
                  onPress={() => toggleSeverityFilter(severity)}
                >
                  <SeverityBadge severity={severity} size="small" />
                </TouchableOpacity>
              ))}
            </View>

            {/* Status Filter */}
            <Text style={styles.filterSectionTitle}>
              {language === 'vi' ? 'Trạng thái' : language === 'zh' ? '状态' : 'Status'}
            </Text>
            <View style={styles.filterOptions}>
              {(['pending', 'acknowledged', 'resolved'] as AlertStatus[]).map((status) => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.filterOption,
                    selectedStatuses.includes(status) && styles.filterOptionSelected,
                  ]}
                  onPress={() => toggleStatusFilter(status)}
                >
                  <Text style={styles.filterOptionText}>
                    {status === 'pending' ? t.pending : status === 'acknowledged' ? t.acknowledged : t.resolved}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalClearButton} onPress={clearFilters}>
                <Text style={styles.modalClearText}>
                  {language === 'vi' ? 'Xóa bộ lọc' : language === 'zh' ? '全部清除' : 'Clear all'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalApplyButton}
                onPress={() => setShowFilterModal(false)}
              >
                <Text style={styles.modalApplyText}>
                  {language === 'vi' ? 'Áp dụng' : language === 'zh' ? '应用' : 'Apply'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    // Header
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    headerTitles: {
      marginLeft: theme.spacing.sm,
    },
    headerTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: '700',
      color: theme.colors.text,
    },
    headerSubtitle: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textSecondary,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerIconBtn: {
      padding: 6,
    },
    // Quick Filter Chips
    filterChipBar: {
      flexDirection: 'row',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
      gap: 8,
      backgroundColor: theme.colors.background,
    },
    // NOTE: duplicate filterChip/filterChipText definitions removed (TS1117);
    // the surviving definitions below match the previous runtime (last-wins).
    filterChipActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    filterChipTextActive: {
      color: theme.colors.white,
    },
    filterChipBadge: {
      borderRadius: 8,
      paddingHorizontal: 5,
      paddingVertical: 1,
      marginLeft: 6,
      minWidth: 18,
      alignItems: 'center',
    },
    filterChipBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '700',
    },
    // Dashboard
    dashboardContainer: {
      padding: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    kpiRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    kpiItem: {
      flex: 1,
    },
    urgentBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: `${theme.colors.error}12`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    urgentText: {
      flex: 1,
      marginLeft: theme.spacing.sm,
      fontSize: theme.fontSize.sm,
      fontWeight: '600',
      color: theme.colors.error,
    },
    severityStats: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    severityStat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: theme.borderRadius.md,
    },
    severityValue: {
      fontSize: theme.fontSize.lg,
      fontWeight: '700',
    },
    severityLabel: {
      fontSize: 10,
      color: theme.colors.textSecondary,
      fontWeight: '500',
    },
    bulletinStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
    },
    bulletinStatsText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.primary,
      fontWeight: '500',
    },
    bulletinUnreadText: {
      color: theme.colors.error,
      fontWeight: '700',
    },
    // Search & Filter
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    searchInputContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing.sm,
    },
    searchIcon: {
      marginRight: theme.spacing.xs,
    },
    searchInput: {
      flex: 1,
      height: 38,
      fontSize: theme.fontSize.md,
      color: theme.colors.text,
    },
    filterButton: {
      // 3F: ≥48dp-ish touch target (was 38) for gloved use
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surfaceVariant,
    },
    filterButtonActive: {
      backgroundColor: `${theme.colors.primary}20`,
    },
    sortButton: {
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: theme.spacing.xs,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surfaceVariant,
    },
    activeFilters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.full,
      marginRight: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
      backgroundColor: theme.colors.surfaceVariant,
    },
    filterChipText: {
      fontSize: theme.fontSize.sm,
      fontWeight: '600',
      marginRight: 4,
    },
    clearFiltersButton: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
    },
    clearFiltersText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    // List
    listContent: {
      padding: theme.spacing.md,
      flexGrow: 1,
    },
    // Wave 4A: tablet multi-column grid — each cell shares the row width evenly;
    // columnWrapper adds the inter-column gutter.
    gridCell: {
      flex: 1,
      minWidth: 0,
    },
    columnWrapper: {
      gap: theme.spacing.md,
    },
    listHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    listHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    resultCount: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.textSecondary,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    clearAllText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.error,
      fontWeight: '600',
      marginLeft: 4,
    },
    // Filter Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.borderRadius.xl,
      borderTopRightRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      maxHeight: '80%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    modalTitle: {
      fontSize: theme.fontSize.xl,
      fontWeight: '700',
      color: theme.colors.text,
    },
    filterSectionTitle: {
      fontSize: theme.fontSize.md,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    filterOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    filterOption: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    filterOptionSelected: {
      backgroundColor: `${theme.colors.primary}15`,
      borderColor: theme.colors.primary,
    },
    filterOptionText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: theme.spacing.xl,
    },
    modalClearButton: {
      flex: 1,
      paddingVertical: theme.spacing.md,
      marginRight: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
    },
    modalClearText: {
      fontSize: theme.fontSize.md,
      fontWeight: '600',
      color: theme.colors.textSecondary,
    },
    modalApplyButton: {
      flex: 1,
      paddingVertical: theme.spacing.md,
      marginLeft: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
    },
    modalApplyText: {
      fontSize: theme.fontSize.md,
      fontWeight: '600',
      color: '#FFFFFF',
    },
  });

export default NotificationCenterScreen;
