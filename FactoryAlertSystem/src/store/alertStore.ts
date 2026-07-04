/**
 * Factory Alert System - Alert Store
 * Zustand store quản lý state của alerts
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  Alert, 
  AlertSeverity, 
  AlertStatus,
  AlertStoreState, 
  AlertStoreActions,
  AlertHistoryParams,
  AlertHistoryResponse,
} from '../types';
import { STORAGE_KEYS, DEFAULT_APP_SETTINGS } from '../utils/constants';
import { sortAlerts, countPendingAlerts } from '../utils/helpers';
import { notificationService } from '../services/notificationService';
import { alertApiService } from '../services/alertApiService';
import { authService } from '../services/authService';
import { debounce, DebouncedFn } from '../utils/debounce';

// Combined store type
type AlertStore = AlertStoreState & AlertStoreActions;

// ============================================
// Debounced disk writer (Wave 2A)
// ============================================
// saveAlerts() previously ran JSON.stringify(entire array) + AsyncStorage.setItem
// on EVERY mutation — i.e. on every incoming MQTT alert. On old <3GB tablets that
// run 24/7 that is a constant CPU + flash-wear cost. Coalesce the burst into one
// write ~1.8s after the last change. flushAlerts() forces a pending write out
// immediately and is wired to app background/quit (App.tsx) so nothing is lost.
const SAVE_DEBOUNCE_MS = 1800;
const debouncedSaveAlerts: DebouncedFn<[]> = debounce(() => {
  void useAlertStore.getState().saveAlerts();
}, SAVE_DEBOUNCE_MS);

/** Force any pending debounced alert write to disk now (app background/quit). */
export function flushAlerts(): void {
  debouncedSaveAlerts.flush();
}

// ============================================
// O(1) dedup index (Wave 2B)
// ============================================
// Mirrors mqttService.recentAlertIds: an id Set gives O(1) duplicate checks on
// the hot addAlert path instead of an O(n) Array.some scan per message. Kept in
// sync with the `alerts` array — incremental on addAlert (add/evict), rebuilt
// wholesale whenever the array is replaced (load/clear/remove).
const alertIdIndex = new Set<string>();
function rebuildAlertIdIndex(alerts: Alert[]): void {
  alertIdIndex.clear();
  for (const a of alerts) {
    if (a.alertId) alertIdIndex.add(a.alertId);
  }
}

/**
 * Alert Store với Zustand
 */
export const useAlertStore = create<AlertStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    alerts: [],
    pendingCount: 0,
    totalCount: 0,
    isLoading: false,
    error: null,

    /**
     * Thêm alert mới
     */
    addAlert: (alert: Alert) => {
      set((state) => {
        // O(1) duplicate check via the id index (Wave 2B)
        if (alert.alertId && alertIdIndex.has(alert.alertId)) {
          if (__DEV__) console.log('[AlertStore] Duplicate alert ignored:', alert.alertId);
          return state;
        }

        // Insert into the timestamp-desc sorted array in a single pass instead of
        // appending + re-sorting the whole array on every message (Wave 2B). New
        // alerts almost always carry the newest timestamp, so this is O(1) in the
        // common case and O(n) worst case — never the previous O(n log n) sort.
        const alerts = state.alerts.slice();
        const newTime = new Date(alert.timestamp).getTime();
        let insertIdx = 0;
        while (
          insertIdx < alerts.length &&
          new Date(alerts[insertIdx].timestamp).getTime() >= newTime
        ) {
          insertIdx++;
        }
        alerts.splice(insertIdx, 0, alert);
        if (alert.alertId) alertIdIndex.add(alert.alertId);

        // Cap the queue. The array is sorted desc, so the oldest items are at the
        // tail. Preserve the prior "evict oldest resolved first, else oldest
        // overall" semantics via a single tail scan (only runs when at the cap).
        if (alerts.length > DEFAULT_APP_SETTINGS.maxQueueSize) {
          let evictIdx = -1;
          for (let i = alerts.length - 1; i >= 0; i--) {
            if (alerts[i].status === 'resolved') {
              evictIdx = i;
              break;
            }
          }
          if (evictIdx === -1) evictIdx = alerts.length - 1;
          const [removed] = alerts.splice(evictIdx, 1);
          if (removed?.alertId) alertIdIndex.delete(removed.alertId);
        }

        const pendingCount = countPendingAlerts(alerts);

        if (__DEV__) console.log('[AlertStore] Alert added:', alert.alertId);

        return {
          alerts,
          pendingCount,
          totalCount: alerts.length,
        };
      });

      // Save to storage — debounced (Wave 2A)
      debouncedSaveAlerts();

      // Update badge
      notificationService.setBadgeCount(get().pendingCount);
    },

    /**
     * Xóa alert khỏi store
     */
    removeAlert: (id: string) => {
      set((state) => {
        const alerts = state.alerts.filter((a) => a.id !== id);
        const pendingCount = countPendingAlerts(alerts);

        if (__DEV__) console.log('[AlertStore] Alert removed:', id);

        return {
          alerts,
          pendingCount,
          totalCount: alerts.length,
        };
      });

      rebuildAlertIdIndex(get().alerts); // membership changed (Wave 2B)
      debouncedSaveAlerts();
      notificationService.setBadgeCount(get().pendingCount);
      notificationService.cancel(id);
    },

    /**
     * Acknowledge alert (đánh dấu đã xem) - cập nhật local + sync server.
     * MB5: dùng danh tính thật từ authService (không còn 'mobile_user').
     * MB6: kèm ghi chú (comment) tùy chọn — server acknowledge-v2 lưu lại.
     * Role gate (parity web): 'viewer' là read-only → bị chặn.
     */
    acknowledgeAlert: (id: string, comment?: string) => {
      if (!authService.canAcknowledgeAlerts()) {
        console.warn('[AlertStore] acknowledgeAlert blocked — role "viewer" is read-only');
        return;
      }
      const now = new Date().toISOString();

      // Tìm alert để lấy alertId
      const targetAlert = get().alerts.find((a) => a.id === id);

      set((state) => {
        const alerts = state.alerts.map((alert) => {
          if (alert.id === id && alert.status === 'pending') {
            return {
              ...alert,
              status: 'acknowledged' as AlertStatus,
              acknowledgedAt: now,
              ...(comment ? { ackComment: comment } : {}),
            };
          }
          return alert;
        });

        const pendingCount = countPendingAlerts(alerts);

        if (__DEV__) console.log('[AlertStore] Alert acknowledged:', id, comment ? `(comment: ${comment.substring(0, 50)})` : '');

        return {
          alerts,
          pendingCount,
        };
      });

      debouncedSaveAlerts();
      notificationService.setBadgeCount(get().pendingCount);

      // Sync với server (fire-and-forget) — danh tính thật, không phải placeholder.
      // Prefer serverAlertId (captured from live MQTT payloads) — it carries the
      // real "source-{n}" ack target the server expects; fall back to alertId.
      const alertId = targetAlert?.serverAlertId || targetAlert?.alertId || id;
      const actor = authService.getActorName();
      alertApiService.acknowledgeAlert(alertId, {
        acknowledgedBy: actor || 'unknown',
        acknowledgedAt: now,
        ...(comment ? { comment } : {}),
      }).catch((err) => {
        console.warn('[AlertStore] Server acknowledge sync failed:', err);
      });
    },

    /**
     * Resolve alert (đánh dấu đã xử lý) - cập nhật local + sync server.
     * MB5: danh tính thật + role gate (parity web: viewer read-only).
     */
    resolveAlert: (id: string, notes?: string) => {
      if (!authService.canResolveAlerts()) {
        console.warn('[AlertStore] resolveAlert blocked — role "viewer" is read-only');
        return;
      }
      const now = new Date().toISOString();

      // Tìm alert để lấy alertId
      const targetAlert = get().alerts.find((a) => a.id === id);

      set((state) => {
        const alerts = state.alerts.map((alert) => {
          if (alert.id === id) {
            return {
              ...alert,
              status: 'resolved' as AlertStatus,
              resolvedAt: now,
              notes: notes || alert.notes,
            };
          }
          return alert;
        });

        const pendingCount = countPendingAlerts(alerts);

        if (__DEV__) console.log('[AlertStore] Alert resolved:', id);

        return {
          alerts,
          pendingCount,
        };
      });

      debouncedSaveAlerts();
      notificationService.setBadgeCount(get().pendingCount);
      notificationService.cancel(id);

      // Sync với server (fire-and-forget) — danh tính thật, không phải placeholder.
      // Prefer serverAlertId (captured from live MQTT payloads) — it carries the
      // real "source-{n}" resolve target the server expects; fall back to alertId.
      const alertId = targetAlert?.serverAlertId || targetAlert?.alertId || id;
      const actor = authService.getActorName();
      alertApiService.resolveAlert(alertId, {
        resolvedBy: actor || 'unknown',
        resolvedAt: now,
        resolution: notes || 'Resolved from mobile app',
      }).catch((err) => {
        console.warn('[AlertStore] Server resolve sync failed:', err);
      });
    },

    /**
     * MB6: đánh dấu alert đã leo thang (từ MQTT ALERT_ESCALATION notice).
     * Idempotent — gọi lại với cùng alertId không thay đổi gì thêm.
     * Match theo alertId (server-side id, VD: 'conn-45' / 'mqtt-123' / 'ALT-...').
     */
    markEscalated: (alertId: string, escalatedAt?: string) => {
      const ts = escalatedAt || new Date().toISOString();
      let changed = false;

      set((state) => {
        const alerts = state.alerts.map((alert) => {
          if (alert.alertId === alertId && !alert.escalated) {
            changed = true;
            return { ...alert, escalated: true, escalatedAt: ts };
          }
          return alert;
        });
        return changed ? { alerts } : state;
      });

      if (changed) {
        if (__DEV__) console.log('[AlertStore] Alert escalated:', alertId);
        debouncedSaveAlerts();
      }
    },

    /**
     * Xóa tất cả alerts
     */
    clearAll: () => {
      set({
        alerts: [],
        pendingCount: 0,
        totalCount: 0,
      });

      if (__DEV__) console.log('[AlertStore] All alerts cleared');

      // Rare user action — cancel any pending debounced write and persist the
      // empty state immediately so a cleared list survives an abrupt kill.
      alertIdIndex.clear();
      debouncedSaveAlerts.cancel();
      get().saveAlerts();
      notificationService.setBadgeCount(0);
      notificationService.cancelAll();
    },

    /**
     * Xóa alerts đã resolved
     */
    clearResolved: () => {
      set((state) => {
        const alerts = state.alerts.filter((a) => a.status !== 'resolved');
        const pendingCount = countPendingAlerts(alerts);

        if (__DEV__) console.log('[AlertStore] Resolved alerts cleared');

        return {
          alerts,
          pendingCount,
          totalCount: alerts.length,
        };
      });

      rebuildAlertIdIndex(get().alerts); // membership changed (Wave 2B)
      debouncedSaveAlerts();
    },

    /**
     * Load alerts từ storage
     */
    loadAlerts: async () => {
      set({ isLoading: true, error: null });

      try {
        const data = await AsyncStorage.getItem(STORAGE_KEYS.ALERTS);
        
        if (data) {
          const alerts: Alert[] = JSON.parse(data);
          
          // Clean up old alerts based on retention
          const retentionDays = DEFAULT_APP_SETTINGS.alertRetentionDays;
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

          const validAlerts = alerts.filter((alert) => {
            const alertDate = new Date(alert.timestamp);
            return alertDate >= cutoffDate;
          });

          const sortedAlerts = sortAlerts(validAlerts, 'timestamp', 'desc');
          const pendingCount = countPendingAlerts(sortedAlerts);

          set({
            alerts: sortedAlerts,
            pendingCount,
            totalCount: sortedAlerts.length,
            isLoading: false,
          });
          rebuildAlertIdIndex(sortedAlerts); // Wave 2B

          // Update badge
          notificationService.setBadgeCount(pendingCount);

          if (__DEV__) console.log(`[AlertStore] Loaded ${sortedAlerts.length} alerts`);
        } else {
          set({ isLoading: false });
        }
      } catch (error) {
        console.error('[AlertStore] Load error:', error);
        set({
          isLoading: false,
          error: (error as Error).message,
        });
      }
    },

    /**
     * Save alerts to storage
     */
    saveAlerts: async () => {
      try {
        const { alerts } = get();
        await AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
        if (__DEV__) console.log('[AlertStore] Saved to storage');
      } catch (error) {
        console.error('[AlertStore] Save error:', error);
        set({ error: (error as Error).message });
      }
    },

    /**
     * Set error
     */
    setError: (error: string | null) => {
      set({ error });
    },

    /**
     * Load alert history từ server (Gap 11.2)
     */
    loadAlertsFromServer: async (params: AlertHistoryParams = {}) => {
      set({ isLoading: true, error: null });
      try {
        const result = await alertApiService.fetchAlerts(params);
        if (result?.success && result.data?.alerts) {
          const serverAlerts = result.data.alerts;
          
          set((state) => {
            // Merge: giữ local alerts chưa có trên server, cập nhật trùng lặp
            const serverIds = new Set(serverAlerts.map((a) => a.alertId));
            const localOnly = state.alerts.filter((a) => !serverIds.has(a.alertId));
            const merged = [...serverAlerts, ...localOnly];
            const sorted = sortAlerts(merged, 'timestamp', 'desc');
            const pendingCount = countPendingAlerts(sorted);

            return {
              alerts: sorted,
              pendingCount,
              totalCount: sorted.length,
              isLoading: false,
            };
          });

          rebuildAlertIdIndex(get().alerts); // membership changed (Wave 2B)
          get().saveAlerts();
          notificationService.setBadgeCount(get().pendingCount);

          if (__DEV__) console.log(`[AlertStore] Loaded ${serverAlerts.length} alerts from server`);
          return result;
        } else {
          set({ isLoading: false });
          console.warn('[AlertStore] Server returned no alerts');
          return null;
        }
      } catch (error) {
        console.error('[AlertStore] loadAlertsFromServer error:', error);
        set({
          isLoading: false,
          error: (error as Error).message,
        });
        return null;
      }
    },
  }))
);

// ============================================
// SELECTORS
// ============================================

/**
 * Select all alerts
 */
export const selectAlerts = (state: AlertStore) => state.alerts;

/**
 * Select pending alerts only
 */
export const selectPendingAlerts = (state: AlertStore) => 
  state.alerts.filter((a) => a.status === 'pending');

/**
 * Select alerts by severity
 */
export const selectAlertsBySeverity = (severity: AlertSeverity) => 
  (state: AlertStore) => state.alerts.filter((a) => a.severity === severity);

/**
 * Select alerts by status
 */
export const selectAlertsByStatus = (status: AlertStatus) => 
  (state: AlertStore) => state.alerts.filter((a) => a.status === status);

/**
 * Select alert by ID
 */
export const selectAlertById = (id: string) => 
  (state: AlertStore) => state.alerts.find((a) => a.id === id);

/**
 * Select pending count
 */
export const selectPendingCount = (state: AlertStore) => state.pendingCount;

/**
 * Select total count
 */
export const selectTotalCount = (state: AlertStore) => state.totalCount;

/**
 * Select loading state
 */
export const selectIsLoading = (state: AlertStore) => state.isLoading;

/**
 * Select recent alerts (last N)
 */
export const selectRecentAlerts = (count: number) => 
  (state: AlertStore) => state.alerts.slice(0, count);

/**
 * Select critical alerts count
 */
export const selectCriticalCount = (state: AlertStore) =>
  state.alerts.filter((a) => a.severity === 'critical' && a.status === 'pending').length;

/**
 * MB6: Select escalated alerts (badge + filter tab)
 */
export const selectEscalatedAlerts = (state: AlertStore) =>
  state.alerts.filter((a) => a.escalated === true);

/**
 * MB6: Select escalated count (unresolved only — resolved escalations are history)
 */
export const selectEscalatedCount = (state: AlertStore) =>
  state.alerts.filter((a) => a.escalated === true && a.status !== 'resolved').length;

/**
 * Select alerts count by severity
 */
export const selectCountBySeverity = (state: AlertStore) => {
  const counts: Record<AlertSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  state.alerts.forEach((alert) => {
    if (alert.status === 'pending') {
      counts[alert.severity]++;
    }
  });

  return counts;
};

export default useAlertStore;
