/**
 * Notification Store - Zustand store for managing notifications
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Notification {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  body: string;
  topic: string;
  timestamp: Date;
  data: any;
  read: boolean;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  
  // Actions
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAll: () => void;
  loadNotifications: () => Promise<void>;
  saveNotifications: () => Promise<void>;
}

const STORAGE_KEY = '@notifications';
const MAX_NOTIFICATIONS = 500;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  addNotification: (notification: Notification) => {
    set((state) => {
      const newNotifications = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      const unreadCount = newNotifications.filter(n => !n.read).length;
      
      // Save to storage asynchronously
      setTimeout(() => get().saveNotifications(), 100);
      
      return {
        notifications: newNotifications,
        unreadCount,
      };
    });
  },

  markAsRead: (id: string) => {
    set((state) => {
      const notifications = state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      );
      const unreadCount = notifications.filter(n => !n.read).length;
      
      setTimeout(() => get().saveNotifications(), 100);
      
      return { notifications, unreadCount };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const notifications = state.notifications.map(n => ({ ...n, read: true }));
      
      setTimeout(() => get().saveNotifications(), 100);
      
      return { notifications, unreadCount: 0 };
    });
  },

  deleteNotification: (id: string) => {
    set((state) => {
      const notifications = state.notifications.filter(n => n.id !== id);
      const unreadCount = notifications.filter(n => !n.read).length;
      
      setTimeout(() => get().saveNotifications(), 100);
      
      return { notifications, unreadCount };
    });
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 });
    AsyncStorage.removeItem(STORAGE_KEY);
  },

  loadNotifications: async () => {
    set({ isLoading: true });
    
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const notifications = JSON.parse(stored).map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp),
        }));
        const unreadCount = notifications.filter((n: Notification) => !n.read).length;
        
        set({ notifications, unreadCount });
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  saveNotifications: async () => {
    try {
      const { notifications } = get();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    } catch (error) {
      console.error('Error saving notifications:', error);
    }
  },
}));

// Statistics helpers
export function getNotificationStats(notifications: Notification[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayNotifications = notifications.filter(
    n => new Date(n.timestamp) >= today
  );
  
  return {
    total: notifications.length,
    unread: notifications.filter(n => !n.read).length,
    todayTotal: todayNotifications.length,
    todayErrors: todayNotifications.filter(n => n.type === 'error').length,
    todayWarnings: todayNotifications.filter(n => n.type === 'warning').length,
    errorRate: todayNotifications.length > 0
      ? (todayNotifications.filter(n => n.type === 'error').length / todayNotifications.length * 100).toFixed(1)
      : '0',
  };
}
