/**
 * Factory Alert System - Connection Store
 * Zustand store quản lý trạng thái kết nối MQTT
 */

import { create } from 'zustand';
import {
  ConnectionStatus,
  ConnectionStoreState,
  ConnectionStoreActions,
} from '../types';

// Combined store type
type ConnectionStore = ConnectionStoreState & ConnectionStoreActions;

/**
 * Connection Store với Zustand
 */
export const useConnectionStore = create<ConnectionStore>((set) => ({
  // Initial state
  status: 'disconnected',
  lastConnected: null,
  reconnectAttempts: 0,
  error: null,
  showMqttDisconnectDialog: false,
  allRetriesFailed: false,

  /**
   * Set connection status
   */
  setStatus: (status: ConnectionStatus) => {
    set((state) => {
      // Update lastConnected if newly connected
      const lastConnected =
        status === 'connected'
          ? new Date().toISOString()
          : state.lastConnected;

      // Clear error if connected
      const error = status === 'connected' ? null : state.error;

      // Reset attempts and allRetriesFailed if connected
      const reconnectAttempts =
        status === 'connected' ? 0 : state.reconnectAttempts;
      const allRetriesFailed =
        status === 'connected' ? false : state.allRetriesFailed;

      return {
        status,
        lastConnected,
        error,
        reconnectAttempts,
        allRetriesFailed,
      };
    });
  },

  /**
   * Set error
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * Increment reconnect attempts
   */
  incrementReconnectAttempts: () => {
    set((state) => ({
      reconnectAttempts: state.reconnectAttempts + 1,
    }));
  },

  /**
   * Reset reconnect attempts
   */
  resetReconnectAttempts: () => {
    set({ reconnectAttempts: 0 });
  },

  /**
   * Set last connected time
   */
  setLastConnected: (timestamp: string) => {
    set({ lastConnected: timestamp });
  },

  /**
   * Show/hide MQTT disconnect dialog
   */
  setShowMqttDisconnectDialog: (show: boolean) => {
    set({ showMqttDisconnectDialog: show });
  },

  /**
   * Set all retries failed flag
   */
  setAllRetriesFailed: (failed: boolean) => {
    set({ allRetriesFailed: failed });
  },
}));

// ============================================
// SELECTORS
// ============================================

/**
 * Select connection status
 */
export const selectConnectionStatus = (state: ConnectionStore) => state.status;

/**
 * Select is connected
 */
export const selectIsConnected = (state: ConnectionStore) =>
  state.status === 'connected';

/**
 * Select is connecting
 */
export const selectIsConnecting = (state: ConnectionStore) =>
  state.status === 'connecting';

/**
 * Select last connected time
 */
export const selectLastConnected = (state: ConnectionStore) => state.lastConnected;

/**
 * Select reconnect attempts
 */
export const selectReconnectAttempts = (state: ConnectionStore) =>
  state.reconnectAttempts;

/**
 * Select error
 */
export const selectError = (state: ConnectionStore) => state.error;

/**
 * Select all retries failed
 */
export const selectAllRetriesFailed = (state: ConnectionStore) => state.allRetriesFailed;

export default useConnectionStore;
