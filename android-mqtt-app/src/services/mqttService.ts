/**
 * MQTT Service - Handles MQTT connection and message processing
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import MQTT from 'sp-react-native-mqtt';
import { showNotification, showBubbleNotification } from './notificationService';
import { useNotificationStore } from '../store/notificationStore';

// MQTT Client instance
let mqttClient: any = null;
let mqttConnected = false;
let reconnectTimer: NodeJS.Timeout | null = null;

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
      keepalive: 60,
      clean: true,
    });

    mqttClient.on('closed', () => {
      console.log('[MQTT] Connection closed');
      mqttConnected = false;
    });

    mqttClient.on('error', (msg: any) => {
      console.log('[MQTT] Error', msg);
    });

    mqttClient.on('connect', () => {
      console.log('[MQTT] Connected');
      mqttConnected = true;

      // Subscribe to configured topics when connected
      config.topics.forEach((topic) => {
        try {
          mqttClient.subscribe(topic, 0);
        } catch (err) {
          console.log('[MQTT] Subscribe error', topic, err);
        }
      });
    });

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
 * Schedule reconnection attempt
 */
function scheduleReconnect(config: MqttConfig): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  
  reconnectTimer = setTimeout(() => {
    console.log('Attempting MQTT reconnection...');
    connectMqtt(config);
  }, 5000); // Retry after 5 seconds
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
