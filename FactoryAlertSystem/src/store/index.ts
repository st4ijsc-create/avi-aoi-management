/**
 * Factory Alert System - Store Index
 * Export tất cả stores
 */

export { useAlertStore, default as alertStore, flushAlerts } from './alertStore';
export {
  selectAlerts,
  selectPendingAlerts,
  selectAlertsBySeverity,
  selectAlertsByStatus,
  selectAlertById,
  selectPendingCount,
  selectTotalCount,
  selectIsLoading as selectAlertsLoading,
  selectRecentAlerts,
  selectCriticalCount,
  selectCountBySeverity,
  selectEscalatedAlerts,
  selectEscalatedCount,
} from './alertStore';

export { useSettingsStore, default as settingsStore } from './settingsStore';
export {
  selectSettings,
  selectMqttConfig,
  selectNotificationConfig,
  selectAppSettings,
  selectLanguage,
  selectTheme,
  selectIsLoading as selectSettingsLoading,
} from './settingsStore';

export { useConnectionStore, default as connectionStore } from './connectionStore';
export {
  selectConnectionStatus,
  selectIsConnected,
  selectIsConnecting,
  selectLastConnected,
  selectReconnectAttempts,
  selectError as selectConnectionError,
} from './connectionStore';

export { useBulletinStore, default as bulletinStore, flushBulletins } from './bulletinStore';

export { useStationInspectionStore, default as stationInspectionStore } from './stationInspectionStore';
export {
  selectActiveStation,
  selectActiveStationPoints,
  selectSelectedPoint,
  selectStationKPI,
  selectAvailableStations,
  selectPointCounts,
  selectAlertedPointIds,
  selectLatestNgRateAlert,
} from './stationInspectionStore';
export {
  selectBulletins,
  selectUnreadCount,
  selectBulletinTotalCount,
  selectBulletinById,
  selectBulletinsLoading,
  selectBulletinsByStation,
  selectLatestBulletin,
} from './bulletinStore';
