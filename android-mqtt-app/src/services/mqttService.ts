/**
 * MQTT Service - Handles MQTT connection and message processing
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import MQTT from 'sp-react-native-mqtt';
import { showNotification, showBubbleNotification } from './notificationService';
import { useNotificationStore } from '../store/notificationStore';

// MQTT Client instance
let mqttClient: any = null;
let mqttConnected = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000; // 60 seconds max backoff
const BASE_RECONNECT_DELAY = 3000; // 3 seconds initial

// Offline message queue
const OFFLINE_QUEUE_KEY = '@mqtt_offline_queue';
let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: any = null;

// Configuration keys
const MQTT_CONFIG_KEY = '@mqtt_config';
const STATION_CONFIG_KEY = '@station_config';

export interface MqttConfig {
  brokerUrl: string;
  port: number;
  username?: string;
  password?: string;
  clientId: string;
  topics: string[];
  enabled: boolean;
}

export interface StationConfig {
  stationId: string;
  stationName: string;
  lineId: string;
  lineName: string;
  factoryId: string;
  factoryName: string;
}

// Default configuration
const defaultConfig: MqttConfig = {
  brokerUrl: 'mqtt://your-broker-url',
  port: 1883,
  clientId: `avi-mqtt-app-${Date.now()}`,
  topics: [
    'avi/alerts/#',
    'avi/machines/+/status',
    'avi/production/+/error',
    'avi/quality/+/ng',
  ],
  enabled: false,
};

/**
 * Initialize MQTT service
 */
export async function initMqttService(): Promise<void> {
  const config = await getMqttConfig();
  
  if (config.enabled) {
    await connectMqtt(config);
  }
}

/**
 * Get MQTT configuration from storage
 */
export async function getMqttConfig(): Promise<MqttConfig> {
  try {
    const stored = await AsyncStorage.getItem(MQTT_CONFIG_KEY);
    if (stored) {
      return { ...defaultConfig, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Error loading MQTT config:', error);
  }
  return defaultConfig;
}

/**
 * Save MQTT configuration
 */
export async function saveMqttConfig(config: Partial<MqttConfig>): Promise<void> {
  try {
    const current = await getMqttConfig();
    const updated = { ...current, ...config };
    await AsyncStorage.setItem(MQTT_CONFIG_KEY, JSON.stringify(updated));
    
    // Reconnect if enabled
    if (updated.enabled) {
      await disconnectMqtt();
      await connectMqtt(updated);
    } else {
      await disconnectMqtt();
    }
  } catch (error) {
    console.error('Error saving MQTT config:', error);
    throw error;
  }
}

/**
 * Get station configuration
 */
export async function getStationConfig(): Promise<StationConfig | null> {
  try {
    const stored = await AsyncStorage.getItem(STATION_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading station config:', error);
  }
  return null;
}

/**
 * Save station configuration
 */
export async function saveStationConfig(config: StationConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(STATION_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Error saving station config:', error);
    throw error;
  }
}

/**
 * Connect to MQTT broker
 */
export async function connectMqtt(config: MqttConfig): Promise<void> {
  try {
    console.log('Connecting to MQTT broker:', config.brokerUrl, 'port', config.port);

    // Disconnect any existing client first
    await disconnectMqtt();

    // Build URI: allow full mqtt://host:port or just host
    const hasProtocol = config.brokerUrl.startsWith('mqtt://') || config.brokerUrl.startsWith('mqtts://');
    let uri = hasProtocol
      ? config.brokerUrl
      : `mqtt://${config.brokerUrl}:${config.port}`;

    // On Android emulator, "localhost"/"127.0.0.1" trỏ vào chính device,
    // không phải máy chạy broker. Dùng 10.0.2.2 để truy cập host machine.
    if (
      Platform.OS === 'android' &&
      (uri.includes('://localhost') || uri.includes('://127.0.0.1'))
    ) {
      uri = uri.replace('://localhost', '://10.0.2.2').replace('://127.0.0.1', '://10.0.2.2');
    }

    mqttClient = await MQTT.createClient({
      uri,
      clientId: config.clientId,
      user: config.username,
      pass: config.password,
      auth: !!(config.username || config.password),
      keepalive: 120, // Increased from 60s for poor WiFi tolerance
      clean: true,
    });

    mqttClient.on('closed', () => {
      console.log('[MQTT] Connection closed');
      mqttConnected = false;
      scheduleReconnect(config);
    });

    mqttClient.on('error', (msg: any) => {
      console.log('[MQTT] Error', msg);
      mqttConnected = false;
      scheduleReconnect(config);
    });

    mqttClient.on('connect', () => {
      console.log('[MQTT] Connected');
      mqttConnected = true;
      reconnectAttempts = 0; // Reset backoff on successful connect

      // Subscribe to configured topics with QoS 1 for reliable delivery
      config.topics.forEach((topic) => {
        try {
          mqttClient.subscribe(topic, 1);
        } catch (err) {
          console.log('[MQTT] Subscribe error', topic, err);
        }
      });

      // Flush any queued offline messages
      flushOfflineQueue();
    });

    // Setup network change detection
    setupNetworkMonitoring(config);

    mqttClient.on('message', (msg: any) => {
      try {
        const topic = msg.topic;
        const message = msg.data;
        handleMqttMessage(topic, message);
      } catch (err) {
        console.error('Error handling MQTT message from client:', err);
      }
    });

    mqttClient.connect();
    console.log('MQTT connect initiated with URI:', uri);
    
  } catch (error) {
    console.error('MQTT connection error:', error);
    scheduleReconnect(config);
  }
}

/**
 * Disconnect from MQTT broker
 */
export async function disconnectMqtt(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  if (mqttClient) {
    try {
      mqttClient.disconnect();
    } catch (error) {
      console.error('Error disconnecting MQTT:', error);
    }
    mqttClient = null;
    mqttConnected = false;
  }
}

/**
 * Schedule reconnection with exponential backoff
 */
function scheduleReconnect(config: MqttConfig): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  // Exponential backoff: 3s, 6s, 12s, 24s, 48s, 60s (capped)
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  reconnectAttempts++;

  console.log(`[MQTT] Scheduling reconnect in ${delay / 1000}s (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    console.log('[MQTT] Attempting reconnection...');
    connectMqtt(config);
  }, delay);
}

/**
 * Monitor network state changes to auto-reconnect on WiFi recovery
 */
function setupNetworkMonitoring(config: MqttConfig): void {
  // Clean up previous listeners
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
  }

  let wasConnected = true;

  // Listen for network state changes (WiFi drop/recovery)
  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const isOnline = state.isConnected && state.isInternetReachable !== false;
    console.log(`[MQTT] Network changed: type=${state.type}, connected=${isOnline}`);

    if (isOnline && !mqttConnected && wasConnected) {
      // Network recovered - reconnect immediately
      console.log('[MQTT] Network recovered, reconnecting immediately...');
      reconnectAttempts = 0; // Reset backoff for network recovery
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connectMqtt(config);
    }
    wasConnected = !!isOnline;
  });

  // Listen for app returning to foreground
  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && !mqttConnected && config.enabled) {
      console.log('[MQTT] App returned to foreground, checking connection...');
      reconnectAttempts = 0;
      connectMqtt(config);
    }
  });
}

/**
 * Queue a message for delivery when back online
 */
export async function queueOfflineMessage(topic: string, message: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: Array<{ topic: string; message: string; timestamp: number }> = stored ? JSON.parse(stored) : [];
    queue.push({ topic, message, timestamp: Date.now() });
    // Keep max 200 messages, drop oldest
    const trimmed = queue.slice(-200);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('[MQTT] Error queuing offline message:', error);
  }
}

/**
 * Flush offline message queue on reconnect
 */
async function flushOfflineQueue(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!stored) return;
    const queue: Array<{ topic: string; message: string; timestamp: number }> = JSON.parse(stored);
    if (queue.length === 0) return;

    console.log(`[MQTT] Flushing ${queue.length} queued offline messages`);
    // Process queued messages as notifications (they were received while offline)
    for (const item of queue) {
      // Only process messages less than 24 hours old
      if (Date.now() - item.timestamp < 24 * 60 * 60 * 1000) {
        handleMqttMessage(item.topic, item.message);
      }
    }
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch (error) {
    console.error('[MQTT] Error flushing offline queue:', error);
  }
}

/**
 * Handle incoming MQTT message
 */
export function handleMqttMessage(topic: string, message: string): void {
  try {
    const data = JSON.parse(message);
    
    // Determine notification type based on topic
    let notificationType: 'error' | 'warning' | 'info' = 'info';
    let title = 'Thông báo';
    let body = message;
    
    if (topic.includes('/error') || topic.includes('/ng')) {
      notificationType = 'error';
      title = '⚠️ Cảnh báo lỗi';
      body = data.message || data.error || 'Phát hiện lỗi sản xuất';
    } else if (topic.includes('/status')) {
      if (data.status === 'offline' || data.status === 'error') {
        notificationType = 'warning';
        title = '🔴 Máy ngừng hoạt động';
        body = `${data.machineName || 'Máy'} - ${data.status}`;
      } else {
        notificationType = 'info';
        title = '🟢 Cập nhật trạng thái';
        body = `${data.machineName || 'Máy'} - ${data.status}`;
      }
    } else if (topic.includes('/alerts')) {
      notificationType = 'error';
      title = '🚨 Cảnh báo hệ thống';
      body = data.message || data.alert || 'Cảnh báo từ hệ thống';
    }
    
    // Add to notification store
    const { addNotification } = useNotificationStore.getState();
    addNotification({
      id: Date.now().toString(),
      type: notificationType,
      title,
      body,
      topic,
      timestamp: new Date(),
      data,
      read: false,
    });
    
    // Show notification
    showNotification(title, body, notificationType);
    
    // Show bubble overlay for errors
    if (notificationType === 'error') {
      showBubbleNotification(title, body);
    }
    
  } catch (error) {
    console.error('Error handling MQTT message:', error);
  }
}

/**
 * Get connection status
 */
export function isConnected(): boolean {
  try {
    if (mqttClient && typeof mqttClient.isConnected === 'function') {
      return mqttClient.isConnected();
    }
  } catch (err) {
    console.log('[MQTT] isConnected error', err);
  }
  return mqttConnected;
}

/**
 * Subscribe to additional topic
 */
export function subscribeTopic(topic: string): void {
  if (mqttClient && isConnected()) {
    mqttClient.subscribe(topic, 0);
  }
}

/**
 * Unsubscribe from topic
 */
export function unsubscribeTopic(topic: string): void {
  if (mqttClient && isConnected()) {
    mqttClient.unsubscribe(topic);
  }
}
