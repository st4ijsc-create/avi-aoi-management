/**
 * MQTT Store - Quản lý kết nối MQTT và state
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import mqtt, { MqttClient, IClientOptions } from 'mqtt';

// Types
export interface NGAlert {
  id: string;
  type: 'NG_ALERT';
  inspectionId: number;
  serialNumber: string;
  productName: string;
  machineName: string;
  stationName: string;
  timestamp: string;
  ngPoints: Array<{
    pointId: number;
    pointName: string;
    result: string;
    actualValue?: string;
    imageUrl?: string;
  }>;
  totalNG: number;
  imageUrl?: string;
  receivedAt: Date;
  dismissed: boolean;
}

export interface SummaryAlert {
  id: string;
  type: 'DAILY_SUMMARY' | 'WEEKLY_SUMMARY';
  stationId: number;
  stationName: string;
  period: {
    start: string;
    end: string;
  };
  statistics: {
    totalInspections: number;
    totalNG: number;
    totalNTF: number;
    ngRate: number;
  };
  topNGPoints: Array<{
    pointId: number;
    pointName: string;
    ngCount: number;
    percentage: number;
  }>;
  timestamp: string;
  receivedAt: Date;
  dismissed: boolean;
}

export type Alert = NGAlert | SummaryAlert;

interface MqttSettings {
  brokerUrl: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
  deviceId: string;
  stationId?: number;
  alertDisplayDuration: number; // seconds
  receiveNGAlerts: boolean;
  receiveDailySummary: boolean;
  receiveWeeklySummary: boolean;
}

interface MqttState {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  lastConnectedAt: Date | null;
  
  // Settings
  settings: MqttSettings;
  
  // Alerts
  alerts: Alert[];
  activeAlert: Alert | null;
  
  // Statistics
  todayStats: {
    totalInspections: number;
    totalNG: number;
    ngRate: number;
  };
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  updateSettings: (settings: Partial<MqttSettings>) => Promise<void>;
  dismissAlert: (alertId: string) => void;
  dismissActiveAlert: () => void;
  clearAlerts: () => void;
  loadSettings: () => Promise<void>;
}

// Default settings
const defaultSettings: MqttSettings = {
  brokerUrl: 'mqtt://localhost',
  port: 1883,
  username: '',
  password: '',
  clientId: '',
  deviceId: '',
  stationId: undefined,
  alertDisplayDuration: 60, // 1 minute default
  receiveNGAlerts: true,
  receiveDailySummary: true,
  receiveWeeklySummary: true,
};

// MQTT client instance
let mqttClient: MqttClient | null = null;

export const useMqttStore = create<MqttState>((set, get) => ({
  // Initial state
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  lastConnectedAt: null,
  settings: defaultSettings,
  alerts: [],
  activeAlert: null,
  todayStats: {
    totalInspections: 0,
    totalNG: 0,
    ngRate: 0,
  },

  // Load settings from AsyncStorage
  loadSettings: async () => {
    try {
      const stored = await AsyncStorage.getItem('mqtt_settings');
      if (stored) {
        const settings = JSON.parse(stored);
        set({ settings: { ...defaultSettings, ...settings } });
      }
    } catch (error) {
      console.error('Error loading MQTT settings:', error);
    }
  },

  // Update settings
  updateSettings: async (newSettings: Partial<MqttSettings>) => {
    const { settings } = get();
    const updated = { ...settings, ...newSettings };
    set({ settings: updated });
    
    try {
      await AsyncStorage.setItem('mqtt_settings', JSON.stringify(updated));
    } catch (error) {
      console.error('Error saving MQTT settings:', error);
    }
  },

  // Connect to MQTT broker
  connect: async () => {
    const { settings, isConnected, isConnecting } = get();
    
    if (isConnected || isConnecting) {
      return;
    }

    set({ isConnecting: true, connectionError: null });

    try {
      const options: IClientOptions = {
        clientId: settings.clientId || `avi_mobile_${Date.now()}`,
        username: settings.username,
        password: settings.password,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
      };

      const brokerUrl = `${settings.brokerUrl}:${settings.port}`;
      mqttClient = mqtt.connect(brokerUrl, options);

      mqttClient.on('connect', () => {
        console.log('[MQTT] Connected to broker');
        set({ 
          isConnected: true, 
          isConnecting: false,
          lastConnectedAt: new Date(),
          connectionError: null,
        });

        // Subscribe to topics based on settings
        const { stationId, receiveNGAlerts, receiveDailySummary, receiveWeeklySummary } = get().settings;
        
        if (stationId) {
          // Subscribe to station-specific topics
          if (receiveNGAlerts) {
            mqttClient?.subscribe(`avi/+/+/+/station/${stationId}/errors`, { qos: 1 });
          }
          if (receiveDailySummary) {
            mqttClient?.subscribe(`avi/+/+/+/station/${stationId}/summary/daily`, { qos: 1 });
          }
          if (receiveWeeklySummary) {
            mqttClient?.subscribe(`avi/+/+/+/station/${stationId}/summary/weekly`, { qos: 1 });
          }
        } else {
          // Subscribe to all stations
          if (receiveNGAlerts) {
            mqttClient?.subscribe('avi/+/+/+/station/+/errors', { qos: 1 });
          }
          if (receiveDailySummary) {
            mqttClient?.subscribe('avi/+/+/+/station/+/summary/daily', { qos: 1 });
          }
          if (receiveWeeklySummary) {
            mqttClient?.subscribe('avi/+/+/+/station/+/summary/weekly', { qos: 1 });
          }
        }
      });

      mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          handleMqttMessage(topic, payload, set, get);
        } catch (error) {
          console.error('[MQTT] Error parsing message:', error);
        }
      });

      mqttClient.on('error', (error) => {
        console.error('[MQTT] Connection error:', error);
        set({ 
          connectionError: error.message,
          isConnecting: false,
        });
      });

      mqttClient.on('close', () => {
        console.log('[MQTT] Connection closed');
        set({ isConnected: false });
      });

      mqttClient.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
        set({ isConnecting: true });
      });

    } catch (error: any) {
      console.error('[MQTT] Connection failed:', error);
      set({ 
        isConnecting: false, 
        connectionError: error.message,
      });
    }
  },

  // Disconnect from MQTT broker
  disconnect: () => {
    if (mqttClient) {
      mqttClient.end();
      mqttClient = null;
    }
    set({ isConnected: false, isConnecting: false });
  },

  // Dismiss specific alert
  dismissAlert: (alertId: string) => {
    const { alerts, activeAlert } = get();
    set({
      alerts: alerts.map(a => 
        a.id === alertId ? { ...a, dismissed: true } : a
      ),
      activeAlert: activeAlert?.id === alertId ? null : activeAlert,
    });
  },

  // Dismiss active alert
  dismissActiveAlert: () => {
    const { activeAlert, alerts } = get();
    if (activeAlert) {
      set({
        alerts: alerts.map(a => 
          a.id === activeAlert.id ? { ...a, dismissed: true } : a
        ),
        activeAlert: null,
      });
    }
  },

  // Clear all alerts
  clearAlerts: () => {
    set({ alerts: [], activeAlert: null });
  },
}));

// Handle incoming MQTT messages
function handleMqttMessage(
  topic: string, 
  payload: any, 
  set: (state: Partial<MqttState>) => void,
  get: () => MqttState
) {
  const { alerts, settings } = get();
  
  if (payload.type === 'NG_ALERT' && settings.receiveNGAlerts) {
    const alert: NGAlert = {
      ...payload,
      id: `ng_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      receivedAt: new Date(),
      dismissed: false,
    };
    
    // Add to alerts list and set as active
    set({
      alerts: [alert, ...alerts].slice(0, 100), // Keep last 100 alerts
      activeAlert: alert,
    });

    // Update today stats
    const { todayStats } = get();
    set({
      todayStats: {
        totalInspections: todayStats.totalInspections + 1,
        totalNG: todayStats.totalNG + payload.totalNG,
        ngRate: ((todayStats.totalNG + payload.totalNG) / (todayStats.totalInspections + 1)) * 100,
      },
    });

    // Auto-dismiss after configured duration
    setTimeout(() => {
      const { activeAlert } = get();
      if (activeAlert?.id === alert.id) {
        set({ activeAlert: null });
      }
    }, settings.alertDisplayDuration * 1000);
  }
  
  if ((payload.type === 'DAILY_SUMMARY' && settings.receiveDailySummary) ||
      (payload.type === 'WEEKLY_SUMMARY' && settings.receiveWeeklySummary)) {
    const alert: SummaryAlert = {
      ...payload,
      id: `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      receivedAt: new Date(),
      dismissed: false,
    };
    
    set({
      alerts: [alert, ...alerts].slice(0, 100),
      activeAlert: alert,
    });

    // Auto-dismiss after configured duration
    setTimeout(() => {
      const { activeAlert } = get();
      if (activeAlert?.id === alert.id) {
        set({ activeAlert: null });
      }
    }, settings.alertDisplayDuration * 1000);
  }
}
