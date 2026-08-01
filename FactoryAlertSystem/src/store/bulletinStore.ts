/**
 * Factory Alert System - Bulletin Store
 * Zustand store quản lý state của periodic bulletins
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PeriodicBulletin,
  BulletinStoreState,
  BulletinStoreActions,
  BulletinListParams,
  BulletinListResponse,
} from '../types';
import { bulletinApiService } from '../services/bulletinApiService';
import { debounce, DebouncedFn } from '../utils/debounce';

const STORAGE_KEY = '@factory_bulletins';
const MAX_BULLETINS = 200;

// Combined store type
type BulletinStore = BulletinStoreState & BulletinStoreActions;

// Debounced disk writer (Wave 2A) — same rationale as alertStore: bulletins
// persisted the entire array on every change. Coalesce into one write; flush on
// app background/quit so nothing is lost.
const SAVE_DEBOUNCE_MS = 1800;
const debouncedSaveBulletins: DebouncedFn<[]> = debounce(() => {
  void useBulletinStore.getState().saveBulletins();
}, SAVE_DEBOUNCE_MS);

/** Force any pending debounced bulletin write to disk now (app background/quit). */
export function flushBulletins(): void {
  debouncedSaveBulletins.flush();
}

/**
 * Bulletin Store với Zustand
 */
export const useBulletinStore = create<BulletinStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    bulletins: [],
    unreadCount: 0,
    totalCount: 0,
    isLoading: false,
    error: null,

    /**
     * Thêm bulletin mới
     */
    addBulletin: (bulletin: PeriodicBulletin) => {
      set((state) => {
        // Check for duplicate
        const exists = state.bulletins.some(
          (b) => b.bulletinId === bulletin.bulletinId
        );

        if (exists) {
          if (__DEV__) console.log('[BulletinStore] Duplicate bulletin ignored:', bulletin.bulletinId);
          return state;
        }

        let bulletins = [bulletin, ...state.bulletins];

        // Limit max bulletins - remove oldest
        if (bulletins.length > MAX_BULLETINS) {
          bulletins = bulletins.slice(0, MAX_BULLETINS);
        }

        const unreadCount = bulletins.filter((b) => !b.isRead).length;

        if (__DEV__) console.log('[BulletinStore] Bulletin added:', bulletin.bulletinId);

        return {
          bulletins,
          unreadCount,
          totalCount: bulletins.length,
        };
      });

      // Save to storage — debounced (Wave 2A)
      debouncedSaveBulletins();
    },

    /**
     * Đánh dấu đã đọc
     */
    markAsRead: (bulletinId: string) => {
      set((state) => {
        const bulletins = state.bulletins.map((b) => {
          if (b.bulletinId === bulletinId && !b.isRead) {
            return { ...b, isRead: true };
          }
          return b;
        });

        const unreadCount = bulletins.filter((b) => !b.isRead).length;

        if (__DEV__) console.log('[BulletinStore] Bulletin marked as read:', bulletinId);

        return { bulletins, unreadCount };
      });

      debouncedSaveBulletins();
    },

    /**
     * Đánh dấu tất cả đã đọc
     */
    markAllAsRead: () => {
      set((state) => {
        const bulletins = state.bulletins.map((b) => ({ ...b, isRead: true }));

        if (__DEV__) console.log('[BulletinStore] All bulletins marked as read');

        return { bulletins, unreadCount: 0 };
      });

      debouncedSaveBulletins();
    },

    /**
     * Xóa bulletin
     */
    removeBulletin: (bulletinId: string) => {
      set((state) => {
        const bulletins = state.bulletins.filter(
          (b) => b.bulletinId !== bulletinId
        );
        const unreadCount = bulletins.filter((b) => !b.isRead).length;

        if (__DEV__) console.log('[BulletinStore] Bulletin removed:', bulletinId);

        return {
          bulletins,
          unreadCount,
          totalCount: bulletins.length,
        };
      });

      debouncedSaveBulletins();
    },

    /**
     * Xóa tất cả
     */
    clearAll: () => {
      set({
        bulletins: [],
        unreadCount: 0,
        totalCount: 0,
      });

      if (__DEV__) console.log('[BulletinStore] All bulletins cleared');
      // Rare user action — cancel any pending debounced write and persist now.
      debouncedSaveBulletins.cancel();
      get().saveBulletins();
    },

    /**
     * Load bulletins từ AsyncStorage
     */
    loadBulletins: async () => {
      set({ isLoading: true });
      try {
        const data = await AsyncStorage.getItem(STORAGE_KEY);
        if (data) {
          const bulletins: PeriodicBulletin[] = JSON.parse(data);
          const unreadCount = bulletins.filter((b) => !b.isRead).length;

          set({
            bulletins,
            unreadCount,
            totalCount: bulletins.length,
            isLoading: false,
          });

          if (__DEV__) console.log(`[BulletinStore] Loaded ${bulletins.length} bulletins`);
        } else {
          set({ isLoading: false });
        }
      } catch (error) {
        console.error('[BulletinStore] Error loading bulletins:', error);
        set({
          isLoading: false,
          error: 'Failed to load bulletins',
        });
      }
    },

    /**
     * Save bulletins vào AsyncStorage
     */
    saveBulletins: async () => {
      try {
        const { bulletins } = get();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bulletins));
      } catch (error) {
        console.error('[BulletinStore] Error saving bulletins:', error);
      }
    },

    /**
     * Set error
     */
    setError: (error: string | null) => {
      set({ error });
    },

    /**
     * Load bulletins từ server REST API (Gap 11.3)
     */
    loadBulletinsFromServer: async (params: BulletinListParams = {}) => {
      set({ isLoading: true, error: null });
      try {
        const result = await bulletinApiService.fetchBulletins(params);
        if (result?.success && result.data?.bulletins) {
          const serverBulletins = result.data.bulletins;

          set((state) => {
            // Merge: giữ local bulletins chưa có trên server
            const serverIds = new Set(serverBulletins.map((b) => b.bulletinId));
            const localOnly = state.bulletins.filter((b) => !serverIds.has(b.bulletinId));
            const merged = [...serverBulletins, ...localOnly].slice(0, MAX_BULLETINS);
            const unreadCount = merged.filter((b) => !b.isRead).length;

            return {
              bulletins: merged,
              unreadCount,
              totalCount: merged.length,
              isLoading: false,
            };
          });

          get().saveBulletins();
          if (__DEV__) console.log(`[BulletinStore] Loaded ${serverBulletins.length} bulletins from server`);
          return result;
        } else {
          set({ isLoading: false });
          return null;
        }
      } catch (error) {
        console.error('[BulletinStore] loadBulletinsFromServer error:', error);
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

export const selectBulletins = (state: BulletinStore) => state.bulletins;
export const selectUnreadCount = (state: BulletinStore) => state.unreadCount;
export const selectBulletinTotalCount = (state: BulletinStore) => state.totalCount;
export const selectBulletinById = (bulletinId: string) => (state: BulletinStore) =>
  state.bulletins.find((b) => b.bulletinId === bulletinId);
export const selectBulletinsLoading = (state: BulletinStore) => state.isLoading;
export const selectBulletinsByStation = (stationId: number) => (state: BulletinStore) =>
  state.bulletins.filter((b) => b.stationId === stationId);
export const selectLatestBulletin = (state: BulletinStore) =>
  state.bulletins.length > 0 ? state.bulletins[0] : null;

export default useBulletinStore;
