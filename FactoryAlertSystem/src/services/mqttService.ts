/**
 * Factory Alert System - MQTT Service
 * Singleton service quản lý kết nối MQTT
 * Hỗ trợ: Local Broker, HiveMQ Cloud, EMQX, Mosquitto
 */

import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { Platform, NativeModules, Dimensions, AppState, AppStateStatus } from 'react-native';
import { MqttConfig, NotificationConfig, AppSettings, ConnectionStatus, AlertPayload, Alert, PeriodicBulletin } from '../types';

// Lazy getter to avoid circular dependency (settingsStore imports mqttService)
const getSettingsStore = () => require('../store/settingsStore').useSettingsStore;

// Native module for real device info (IP, device name, screen resolution, etc.)
const { DeviceInfoModule } = NativeModules;
import { useConnectionStore } from '../store/connectionStore';
import { 
  DEFAULT_MQTT_CONFIG, 
  RECONNECT_CONFIG, 
  MQTT_QOS,
  STORAGE_KEYS 
} from '../utils/constants';
import { generateUUID, isValidAlertPayload, normalizeAlertPayload } from '../utils/helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import TCP socket for React Native
// @ts-ignore - react-native-tcp-socket types may not be perfect
import TcpSocket from 'react-native-tcp-socket';

// Device info interface for local broker authentication
interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceModel: string;
  // Extended hardware info - collected and sent to server
  brand?: string;
  manufacturer?: string;
  osVersion?: string;
  appVersion?: string;
  ipAddress?: string;
  screenResolution?: string;
  networkType?: string;
}

// Configure command received from server via MQTT
interface ConfigureCommand {
  type: 'CONFIGURE';
  commandId: string;
  stationId?: number;
  processId?: number;
  topics?: string[];
  settings?: {
    mqtt?: Partial<MqttConfig>;
    notification?: Partial<NotificationConfig>;
    app?: Partial<AppSettings>;
    // Legacy: server-side commands (kept for backward compatibility)
    _command?: string;
    // Legacy fields (backward compatibility)
    receiveNGAlerts?: boolean;
    receiveDailySummary?: boolean;
    receiveWeeklySummary?: boolean;
    workstationId?: number;
  };
  timestamp: string;
}

// Software update command — dedicated message type, separate from CONFIGURE
interface SoftwareUpdateCommand {
  type: 'SOFTWARE_UPDATE';
  commandId: string;
  command: 'CHECK_UPDATE' | 'FORCE_UPDATE';
  timestamp: string;
}

// MB6 (doc 27): escalation notice published by the server scheduler on
// avi/escalations/{source}/{id} (retained) when an alert stays unhandled
// past an escalation-rule threshold.
export interface EscalationNotice {
  type: 'ALERT_ESCALATION';
  alertId: string;          // e.g. 'conn-45' | 'mqtt-123'
  source: string;           // 'conn' | 'mqtt'
  severity: string;
  title: string;
  message?: string;
  ruleId?: number;
  ruleName?: string;
  escalateAfterMin?: number;
  triggeredAt?: string;
  escalatedAt: string;
}

// Type definitions for callbacks
type ConnectionCallback = (status: ConnectionStatus, error?: string) => void;
type MessageCallback = (alert: Alert) => void;
type BulletinCallback = (bulletin: PeriodicBulletin) => void;
type ErrorCallback = (error: Error) => void;

// Broker type detection
type BrokerType = 'local' | 'hivemq' | 'emqx' | 'mosquitto' | 'custom';

/**
 * MQTT Service Class - Singleton Pattern
 * Hỗ trợ nhiều loại MQTT Broker
 */
class MqttService {
  private static instance: MqttService;
  private client: MqttClient | null = null;
  private config: MqttConfig = DEFAULT_MQTT_CONFIG;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private deviceInfoPromise: Promise<void> | null = null;
  
  // Circuit breaker for preventing infinite connection loops
  private lastConnectionAttempt: number = 0;
  private circuitBreakerOpenUntil: number = 0;
  private consecutiveFailures: number = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 10;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

  // Timer for setupEventHandlers connection timeout (must be instance property so disconnect can clear it)
  private connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Periodic health check (monitors connection, passive recovery when retries exhausted)
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private healthCheckInterval: number = 15000; // 15s
  private healthCheckConsecutiveFailures: number = 0;
  private readonly HEALTH_CHECK_FAIL_THRESHOLD = 2; // require 2 consecutive failures before triggering reconnect
  private passiveRecoveryAttempts: number = 0; // track passive recovery attempts for backoff

  // Unified reconnect tracking
  private isReconnecting: boolean = false; // true while scheduleReconnect() is running

  // Debounce: prevent error/close/offline from overlapping into multiple scheduleReconnect calls
  private lastReconnectTriggerTime: number = 0;

  // AppState management — handle background/foreground transitions (Doze mode)
  private appStateSubscription: any = null;
  private currentAppState: string = 'active';
  private wasConnectedBeforeBackground: boolean = false;

  // Track connection history for reconnect flow
  private wasConnectedBefore: boolean = false;
  private allRetriesExhausted: boolean = false;

  // Alert deduplication — prevent retained/duplicate messages from being processed twice
  private recentAlertIds: Set<string> = new Set();
  private readonly MAX_RECENT_ALERT_IDS = 200;

  // Static flag to track if global error handlers are set up
  private static globalErrorHandlersSetup = false;

  // Callbacks
  private onConnectionChange: ConnectionCallback | null = null;
  private onMessage: MessageCallback | null = null;
  private onBulletin: BulletinCallback | null = null;
  private onError: ErrorCallback | null = null;
  private onAllRetriesFailed: (() => void) | null = null;
  private onReconnectSuccess: (() => void) | null = null;
  // MB6 (doc 27): server-side escalation notice (retained message on avi/escalations/#)
  private onEscalation: ((notice: EscalationNotice) => void) | null = null;

  // Message counter for debugging
  private messageCount: number = 0;
  private alertCount: number = 0;
  private lastMessageAt: number = 0;

  /**
   * Cập nhật cài đặt health check từ Settings
   */
  public updateHealthCheckSettings(settings: {
    healthCheckInterval?: number;
    retryMaxAttempts?: number;
    retryInterval?: number;
  }): void {
    if (settings.healthCheckInterval !== undefined) {
      this.healthCheckInterval = settings.healthCheckInterval;
    }
    // retryMaxAttempts and retryInterval are kept in settings UI but no longer used —
    // all retries go through scheduleReconnect() which uses RECONNECT_CONFIG
    console.log(`[MQTT] Health check settings updated: interval=${this.healthCheckInterval}ms`);
  }

  /**
   * Private constructor (Singleton)
   */
  private constructor() {
    // Start async init and save promise for later await
    this.deviceInfoPromise = this.initDeviceInfo();
    
    // Set up global error handlers once
    this.setupGlobalErrorHandlers();

    // Set up AppState listener for background/foreground transitions
    this.setupAppStateManagement();
  }

  /**
   * Set up global error handlers to catch unhandled errors
   */
  private setupGlobalErrorHandlers(): void {
    if (MqttService.globalErrorHandlersSetup) {
      return;
    }

    // Handle unhandled promise rejections
    if (typeof process !== 'undefined' && process.on) {
      process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
        if (reason && reason.message && reason.message.includes('socket')) {
          console.warn('[MQTT] Unhandled socket promise rejection caught:', reason.message);
        } else {
          console.error('[MQTT] Unhandled promise rejection:', reason);
        }
      });

      process.on('uncaughtException', (error: Error) => {
        if (error.message && error.message.includes('socket')) {
          console.warn('[MQTT] Unhandled socket exception caught:', error.message);
        } else {
          console.error('[MQTT] Uncaught exception:', error.message);
        }
      });
    }

    // React Native specific error handling
    if (typeof global !== 'undefined' && (global as any).ErrorUtils) {
      const originalHandler = (global as any).ErrorUtils.getGlobalHandler();
      (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
        if (error && error.message && 
            (error.message.includes('socket') || error.message.includes('Unhandled error'))) {
          console.warn('[MQTT] React Native global error caught (socket-related):', error.message);
          // Don't call original handler for socket errors to prevent red screen
          return;
        }
        // Call original handler for other errors
        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });
    }

    MqttService.globalErrorHandlersSetup = true;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MqttService {
    if (!MqttService.instance) {
      MqttService.instance = new MqttService();
    }
    return MqttService.instance;
  }

  /**
   * Initialize device info for local broker authentication
   * Format: deviceId:deviceName:deviceModel
   */
  private async initDeviceInfo(): Promise<void> {
    try {
      // Try to load cached device info first (only for deviceId persistence)
      const cachedInfo = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS + '_device_info');
      let cachedDeviceId: string | null = null;
      if (cachedInfo) {
        const parsed = JSON.parse(cachedInfo);
        cachedDeviceId = parsed.deviceId || null;
      }

      // Always regenerate to get fresh IP, network type, etc.
      this.deviceInfo = await this.generateDeviceInfo(cachedDeviceId);
      
      // Cache device info (preserves deviceId across sessions)
      await AsyncStorage.setItem(
        STORAGE_KEYS.SETTINGS + '_device_info',
        JSON.stringify(this.deviceInfo)
      );
      console.log('[MQTT] Device info initialized:', this.deviceInfo);
    } catch (error) {
      console.error('[MQTT] Error initializing device info:', error);
      // Fallback to basic device info
      this.deviceInfo = {
        deviceId: `device_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`,
        deviceName: 'FactoryAlertApp',
        deviceModel: Platform.OS === 'android' ? 'Android' : 'iOS',
      };
    }
  }

  /**
   * Generate device info using native DeviceInfoModule for real hardware data
   * Falls back to Platform APIs if native module is unavailable
   */
  private async generateDeviceInfo(existingDeviceId?: string | null): Promise<DeviceInfo> {
    // Use existing deviceId if available, otherwise generate new persistent one
    let deviceId = existingDeviceId;

    // Try native module first (provides real IP, device name, screen resolution, network type)
    if (DeviceInfoModule && typeof DeviceInfoModule.getDeviceInfo === 'function') {
      try {
        const nativeInfo = await DeviceInfoModule.getDeviceInfo();
        
        // Use Android ID as stable device identifier if no cached ID
        if (!deviceId) {
          const androidId = nativeInfo.androidId || 'unknown';
          deviceId = `${Platform.OS}_${androidId}`;
        }

        // Get dynamic version from updateService
        const { updateService } = require('./updateService');
        const versionInfo = updateService.getCurrentVersion();

        return {
          deviceId,
          deviceName: nativeInfo.deviceName || nativeInfo.deviceModel || 'FactoryAlertApp',
          deviceModel: nativeInfo.deviceModel || `Android_${Platform.Version}`,
          brand: nativeInfo.brand || 'Unknown',
          manufacturer: nativeInfo.manufacturer || 'Unknown',
          osVersion: nativeInfo.osVersion || `Android ${Platform.Version}`,
          appVersion: versionInfo.version,
          ipAddress: nativeInfo.ipAddress || 'Unknown',
          screenResolution: nativeInfo.screenResolution || 'Unknown',
          networkType: nativeInfo.networkType || 'Unknown',
        };
      } catch (error) {
        console.warn('[MQTT] Native DeviceInfoModule failed, falling back to Platform APIs:', error);
      }
    }

    // Fallback: use Platform APIs + Dimensions
    if (!deviceId) {
      deviceId = `${Platform.OS}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    }

    const osVersion = `${Platform.OS === 'android' ? 'Android' : 'iOS'} ${Platform.Version}`;
    const brand = Platform.OS === 'android' 
      ? (Platform.constants as any)?.Brand || 'Unknown'
      : 'Apple';
    const manufacturer = Platform.OS === 'android'
      ? (Platform.constants as any)?.Manufacturer || 'Unknown'
      : 'Apple';
    const deviceModel = Platform.OS === 'android'
      ? (Platform.constants as any)?.Model || `Android_${Platform.Version}`
      : `iOS_${Platform.Version}`;

    // Screen resolution from Dimensions API (fallback)
    const { width, height } = Dimensions.get('screen');
    const screenResolution = `${Math.round(width)}x${Math.round(height)}`;

    // Get dynamic version from updateService
    const { updateService: updateSvc } = require('./updateService');
    const verInfo = updateSvc.getCurrentVersion();

    return {
      deviceId,
      deviceName: deviceModel, // Use model name instead of hardcoded string
      deviceModel,
      brand,
      manufacturer,
      osVersion,
      appVersion: verInfo.version,
      screenResolution,
    };
  }

  /**
   * Get device info (for display/debugging)
   */
  public getDeviceInfo(): DeviceInfo | null {
    return this.deviceInfo;
  }

  /**
   * Set custom device info (optional - for manual configuration)
   */
  public async setDeviceInfo(info: Partial<DeviceInfo>): Promise<void> {
    this.deviceInfo = {
      deviceId: info.deviceId || this.deviceInfo?.deviceId || `device_${Date.now()}`,
      deviceName: info.deviceName || this.deviceInfo?.deviceName || 'FactoryAlertApp',
      deviceModel: info.deviceModel || this.deviceInfo?.deviceModel || Platform.OS,
    };
    
    // Cache the updated info
    await AsyncStorage.setItem(
      STORAGE_KEYS.SETTINGS + '_device_info',
      JSON.stringify(this.deviceInfo)
    );
    console.log('[MQTT] Updated device info:', this.deviceInfo);
  }

  /**
   * Cấu hình MQTT
   */
  public configure(config: Partial<MqttConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset warning flag when broker address changes
    if (config.brokerAddress) {
      this.localhostWarningShown = false;
    }
  }

  /**
   * Lấy config hiện tại
   */
  public getConfig(): MqttConfig {
    return { ...this.config };
  }

  /**
   * Lấy trạng thái kết nối
   */
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Đăng ký callback khi connection thay đổi
   */
  public setOnConnectionChange(callback: ConnectionCallback): void {
    this.onConnectionChange = callback;
  }

  /**
   * Đăng ký callback khi nhận message
   */
  public setOnMessage(callback: MessageCallback): void {
    this.onMessage = callback;
  }

  /**
   * Đăng ký callback khi nhận periodic bulletin
   */
  public setOnBulletin(callback: BulletinCallback): void {
    this.onBulletin = callback;
  }

  /**
   * Đăng ký callback khi có error
   */
  public setOnError(callback: ErrorCallback): void {
    this.onError = callback;
  }

  /**
   * MB6 (doc 27): callback khi nhận ALERT_ESCALATION notice từ server
   */
  public setOnEscalation(callback: (notice: EscalationNotice) => void): void {
    this.onEscalation = callback;
  }

  /**
   * Cập nhật trạng thái và notify callback + sync to Zustand store
   */
  private setConnectionStatus(status: ConnectionStatus, error?: string): void {
    const prevStatus = this.connectionStatus;
    this.connectionStatus = status;
    console.log(`[MQTT-RECONNECT] Status: ${prevStatus} → ${status}${error ? ` (error: ${error})` : ''}`);

    // Sync to Zustand store so UI always reflects current state
    const store = useConnectionStore.getState();
    store.setStatus(status);
    if (error) {
      store.setError(error);
    }
    if (status === 'connected') {
      store.setShowMqttDisconnectDialog(false);
      store.setAllRetriesFailed(false);
    }

    if (this.onConnectionChange) {
      this.onConnectionChange(status, error);
    }

    // Fire reconnect success callback when transitioning to 'connected'
    // after having been connected before (i.e., this is a RE-connection, not the first connection)
    if (status === 'connected' && prevStatus !== 'connected' && this.wasConnectedBefore) {
      console.log('[MQTT-RECONNECT] ✅ Reconnection detected — firing onReconnectSuccess callback');
      if (this.onReconnectSuccess) {
        try {
          this.onReconnectSuccess();
        } catch (e) {
          console.error('[MQTT-RECONNECT] onReconnectSuccess callback error:', e);
        }
      }
    }

    // Track connection history AFTER the callback so first connection doesn't trigger reconnect callback
    if (status === 'connected') {
      this.wasConnectedBefore = true;
    }
  }

  /**
   * Detect broker type from address
   */
  private detectBrokerType(): BrokerType {
    const address = this.config.brokerAddress.toLowerCase();
    
    if (address.includes('hivemq')) {
      return 'hivemq';
    }
    if (address.includes('emqx') || address.includes('emqxsl')) {
      return 'emqx';
    }
    if (address.includes('mosquitto') || address.includes('test.mosquitto')) {
      return 'mosquitto';
    }
    if (address.match(/^(\d{1,3}\.){3}\d{1,3}$/) || address === 'localhost' || address === '127.0.0.1') {
      return 'local';
    }
    
    return 'custom';
  }

  /**
   * Build authentication username for local Aedes broker
   * Format: deviceId:deviceName:deviceModel
   */
  private buildLocalBrokerUsername(): string {
    if (!this.deviceInfo) {
      // Fallback if device info not ready
      const fallbackId = `device_${Date.now()}`;
      return `${fallbackId}:FactoryAlertApp:${Platform.OS}`;
    }
    return `${this.deviceInfo.deviceId}:${this.deviceInfo.deviceName}:${this.deviceInfo.deviceModel}`;
  }

  /**
   * Tạo MQTT client options - hỗ trợ nhiều broker types và protocols
   * 
   * Authentication modes:
   * 1. Local Aedes broker: username = deviceId:deviceName:deviceModel (password optional)
   * 2. External broker (HiveMQ, EMQX, etc.): standard username/password
   */
  private createClientOptions(): IClientOptions {
    const brokerType = this.detectBrokerType();
    const useTcp = this.config.protocol === 'tcp';
    
    const options: IClientOptions = {
      clientId: this.config.clientId || `avi_aoi_app_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`,
      keepalive: this.config.keepAlive || 60,
      reconnectPeriod: 0, // Disable auto-reconnect, we handle it manually
      connectTimeout: this.config.connectTimeout || 30000,
      clean: true,
      resubscribe: true,
    };

    // Handle authentication based on broker type
    if (brokerType === 'local') {
      // Local Aedes broker: use deviceId:deviceName:deviceModel format
      // ALWAYS use buildLocalBrokerUsername() which uses the unique per-device deviceInfo
      // (generated once and cached in AsyncStorage). This ensures each physical device
      // gets a unique deviceId on the server, even when multiple devices share the same APK.
      // Previously used this.config.username which was the hardcoded default
      // 'factory-alert-app-001:FactoryAlertApp:Mobile' for ALL devices — causing the server
      // to see multiple devices as a single client.
      options.username = this.buildLocalBrokerUsername();
      // Password is NOT required for local Aedes broker - don't send it
      // Server only validates username format, not password
      console.log('[MQTT] Using local broker auth format - username:', options.username);
    } else {
      // External brokers (HiveMQ, EMQX, Mosquitto): standard username/password
      if (this.config.username) {
        options.username = this.config.username;
      }
      if (this.config.password) {
        options.password = this.config.password;
      }
      console.log('[MQTT] Using external broker auth - username:', options.username ? '***' : 'none');
    }

    // Set protocol based on config
    if (useTcp) {
      options.protocol = this.config.useSSL ? 'mqtts' : 'mqtt';
      options.protocolVersion = 4;
      if (this.config.useSSL) {
        options.rejectUnauthorized = false; // Allow self-signed certs for local
      }
      console.log(`[MQTT] Using TCP protocol: ${options.protocol}`);
    } else {
      // WebSocket protocol - Broker-specific configurations
      switch (brokerType) {
        case 'hivemq':
          options.protocol = this.config.useSSL ? 'wss' : 'ws';
          options.protocolVersion = 4; // MQTT 3.1.1
          if (this.config.useSSL) {
            options.rejectUnauthorized = true;
          }
          console.log('[MQTT] Detected HiveMQ broker');
          break;
          
        case 'emqx':
          options.protocol = this.config.useSSL ? 'wss' : 'ws';
          options.protocolVersion = 5; // MQTT 5.0 supported
          console.log('[MQTT] Detected EMQX broker');
          break;
          
        case 'mosquitto':
          options.protocol = this.config.useSSL ? 'wss' : 'ws';
          options.protocolVersion = 4;
          console.log('[MQTT] Detected Mosquitto broker');
          break;
          
        case 'local':
          options.protocol = this.config.useSSL ? 'wss' : 'ws';
          options.protocolVersion = 4;
          options.rejectUnauthorized = false; // Allow self-signed certs
          console.log('[MQTT] Detected local AVI-AOI broker');
          break;
          
        default:
          options.protocol = this.config.useSSL ? 'wss' : 'ws';
          options.protocolVersion = 4;
          console.log('[MQTT] Using custom broker configuration');
      }
    }

    return options;
  }

  /**
   * Check if running on physical device (not emulator)
   */
  private isPhysicalDevice(): boolean {
    if (Platform.OS === 'android') {
      // Check common emulator fingerprints
      // On physical devices, these are usually different
      const brand = (Platform as any).constants?.Brand?.toLowerCase() || '';
      const model = (Platform as any).constants?.Model?.toLowerCase() || '';
      const fingerprint = (Platform as any).constants?.Fingerprint?.toLowerCase() || '';
      
      const emulatorIndicators = ['generic', 'sdk', 'emulator', 'genymotion', 'vbox'];
      const isEmulator = emulatorIndicators.some(indicator => 
        brand.includes(indicator) || 
        model.includes(indicator) || 
        fingerprint.includes(indicator)
      );
      
      return !isEmulator;
    }
    return false; // iOS simulator detection would be different
  }

  // Track if localhost warning has been shown to avoid spam
  private localhostWarningShown: boolean = false;

  /**
   * Convert localhost to appropriate address based on device type
   * - Android Emulator: uses 10.0.2.2 to access host machine's localhost
   * - Physical Device: CANNOT access localhost - needs real IP address
   */
  private convertAddressForAndroid(address: string, logWarning: boolean = false): string {
    // Only process on Android
    if (Platform.OS === 'android') {
      const lowerAddress = address.toLowerCase();
      if (lowerAddress === 'localhost' || lowerAddress === '127.0.0.1') {
        if (this.isPhysicalDevice()) {
          // Physical device - warn user that localhost won't work (only once)
          if (logWarning && !this.localhostWarningShown) {
            this.localhostWarningShown = true;
            console.warn('[MQTT] ⚠️ WARNING: Using localhost on physical Android device!');
            console.warn('[MQTT] Physical devices CANNOT access localhost/127.0.0.1 of your computer.');
            console.warn('[MQTT] Please configure the real IP address of your MQTT server in Settings.');
            console.warn('[MQTT] Example: 192.168.x.x or your server\'s actual IP address');
          }
          // Return as-is, but it will likely fail - user needs to change settings
          return address;
        } else {
          // Emulator - convert to special IP
          if (logWarning) {
            console.log('[MQTT] Converting localhost to 10.0.2.2 for Android emulator');
          }
          return '10.0.2.2';
        }
      }
    }
    
    return address;
  }

  /**
   * Reset localhost warning flag when config changes
   */
  private resetLocalhostWarning(): void {
    this.localhostWarningShown = false;
  }

  /**
   * Tạo broker URL - hỗ trợ nhiều formats
   * AVI-AOI Config:
   * - MQTT_PORT=1883 (TCP)
   * - MQTT_WS_PORT=8883 (WebSocket)
   * @param logWarning - whether to log warnings for localhost on physical device
   */
  private getBrokerUrl(logWarning: boolean = false): string {
    const brokerType = this.detectBrokerType();
    // Convert localhost for Android emulator
    const address = this.convertAddressForAndroid(this.config.brokerAddress, logWarning);
    const port = this.config.port;
    const useTcp = this.config.protocol === 'tcp';
    
    // Check if address already includes protocol
    if (address.startsWith('mqtt://') || address.startsWith('mqtts://') ||
        address.startsWith('ws://') || address.startsWith('wss://')) {
      // Also convert localhost in full URL
      return address
        .replace('://localhost:', '://' + this.convertAddressForAndroid('localhost', logWarning) + ':')
        .replace('://127.0.0.1:', '://' + this.convertAddressForAndroid('127.0.0.1', logWarning) + ':');
    }
    
    // TCP protocol: mqtt:// or mqtts://
    if (useTcp) {
      const tcpProtocol = this.config.useSSL ? 'mqtts' : 'mqtt';
      const tcpPort = port || (this.config.useSSL ? 8883 : 1883);
      if (logWarning) {
        console.log(`[MQTT] Building TCP URL: ${tcpProtocol}://${address}:${tcpPort}`);
      }
      return `${tcpProtocol}://${address}:${tcpPort}`;
    }
    
    // WebSocket protocol: ws:// or wss://
    // Check if address already includes port
    if (address.includes(':')) {
      const protocol = this.config.useSSL ? 'wss' : 'ws';
      // Check if has path
      if (address.includes('/')) {
        return `${protocol}://${address}`;
      }
      return `${protocol}://${address}/mqtt`;
    }

    // Build URL based on broker type (WebSocket only)
    switch (brokerType) {
      case 'hivemq':
        // HiveMQ Public: ws://broker.hivemq.com:8000/mqtt (no SSL)
        // HiveMQ Public: wss://broker.hivemq.com:8884/mqtt (SSL)
        // HiveMQ Cloud: wss://xxxxx.s1.eu.hivemq.cloud:8884/mqtt
        if (this.config.useSSL) {
          return `wss://${address}:${port || 8884}/mqtt`;
        } else {
          return `ws://${address}:${port || 8000}/mqtt`;
        }
        
      case 'emqx':
        // EMQX format: ws://broker.emqx.io:8083/mqtt (no SSL)
        // EMQX format: wss://broker.emqx.io:8084/mqtt (SSL)
        const emqxProtocol = this.config.useSSL ? 'wss' : 'ws';
        const emqxPort = this.config.useSSL ? (port || 8084) : (port || 8083);
        return `${emqxProtocol}://${address}:${emqxPort}/mqtt`;
        
      case 'mosquitto':
        // Mosquitto test: ws://test.mosquitto.org:8080/mqtt
        // or wss://test.mosquitto.org:8081/mqtt
        const mosquittoProtocol = this.config.useSSL ? 'wss' : 'ws';
        const mosquittoPort = this.config.useSSL ? (port || 8081) : (port || 8080);
        return `${mosquittoProtocol}://${address}:${mosquittoPort}/mqtt`;
        
      case 'local':
        // AVI-AOI Local: ws://localhost:8883/mqtt (WebSocket port from config)
        const localProtocol = this.config.useSSL ? 'wss' : 'ws';
        return `${localProtocol}://${address}:${port || 8883}/mqtt`;
        
      default:
        // Default WebSocket format
        const protocol = this.config.useSSL ? 'wss' : 'ws';
        return `${protocol}://${address}:${port}/mqtt`;
    }
  }

  /**
   * Ensure device info is ready before connecting
   */
  private async ensureDeviceInfoReady(): Promise<void> {
    if (this.deviceInfoPromise) {
      await this.deviceInfoPromise;
    }
    // Double check - if still null, generate sync fallback
    if (!this.deviceInfo) {
      console.log('[MQTT] Device info not ready, generating fallback...');
      this.deviceInfo = {
        deviceId: `device_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`,
        deviceName: 'FactoryAlertApp',
        deviceModel: Platform.OS === 'android' ? `Android_${Platform.Version}` : `iOS_${Platform.Version}`,
      };
    }
  }

  /**
   * Check circuit breaker status
   */
  private isCircuitBreakerOpen(): boolean {
    const now = Date.now();
    return now < this.circuitBreakerOpenUntil;
  }

  /**
   * Open circuit breaker after too many failures
   */
  private openCircuitBreaker(): void {
    const now = Date.now();
    this.circuitBreakerOpenUntil = now + this.CIRCUIT_BREAKER_TIMEOUT;
    console.warn(`[MQTT] Circuit breaker opened for ${this.CIRCUIT_BREAKER_TIMEOUT/1000}s after ${this.consecutiveFailures} failures`);
  }

  /**
   * Reset circuit breaker on successful connection
   */
  private resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.circuitBreakerOpenUntil = 0;
  }

  /**
   * Dọn dẹp MQTT client hiện tại mà KHÔNG reset các bộ đếm reconnect,
   * circuit breaker, hay health check. Dùng nội bộ trong connect() để tránh
   * reset state khi đang trong vòng scheduleReconnect hoặc health retry.
   */
  /**
   * Clean up MQTT client.
   * @param force - true = immediate kill (default, used during reconnect where old connection is dead).
   *                false = graceful DISCONNECT packet + 3s fallback force-close.
   */
  private cleanupClient(force: boolean = true): void {
    // Clear connection timeout timer
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }

    if (this.client) {
      const client = this.client;
      this.client = null; // Detach immediately to prevent re-use

      try {
        if (force) {
          client.end(true);
        } else {
          // Graceful close: send DISCONNECT packet, with 3s fallback
          const forceCloseTimer = setTimeout(() => {
            try { client.end(true); } catch (_) { /* ignore */ }
          }, 3000);
          client.end(false, {}, () => {
            clearTimeout(forceCloseTimer);
          });
        }
      } catch (e) {
        console.warn('[MQTT] Error ending client during cleanup:', (e as Error).message);
      }
    }
  }

  /**
   * Kết nối đến MQTT broker
   * @param options.skipSubscribe - nếu true, KHÔNG subscribe topics sau khi connect (dùng cho test connection)
   */
  public async connect(options?: { skipSubscribe?: boolean }): Promise<boolean> {
    const skipSubscribe = options?.skipSubscribe ?? false;

    // MB4 (doc 27): no baked-in broker default — refuse to connect until configured
    if (!this.config.brokerAddress || !this.config.brokerAddress.trim()) {
      console.warn('[MQTT] Connect skipped — broker address not configured (onboarding required)');
      this.setConnectionStatus('disconnected', 'Broker not configured');
      return false;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      const remainingTime = Math.ceil((this.circuitBreakerOpenUntil - Date.now()) / 1000);
      console.warn(`[MQTT] Connection blocked by circuit breaker (${remainingTime}s remaining)`);
      this.setConnectionStatus('error', 'Circuit breaker open');
      return false;
    }

    // Prevent too frequent connection attempts
    const now = Date.now();
    const timeSinceLastAttempt = now - this.lastConnectionAttempt;
    if (timeSinceLastAttempt < 2000) { // Minimum 2 seconds between attempts
      console.warn('[MQTT] Connection attempt too soon, throttling');
      return false;
    }
    this.lastConnectionAttempt = now;

    // IMPORTANT: Wait for device info to be ready first
    await this.ensureDeviceInfoReady();
    
    return new Promise((resolve, reject) => {
      // Clean up existing client WITHOUT resetting reconnect counters, circuit breaker, or health check.
      // This is critical: disconnect() resets reconnectAttempts/circuitBreaker/healthCheck,
      // which would make scheduleReconnect() loop infinitely (never reaching MAX_ATTEMPTS).
      if (this.client) {
        this.cleanupClient();
      }

      // Clear any pending reconnect timer (the current timer already fired if we're in scheduleReconnect)
      this.clearReconnectTimer();

      // Update status
      this.setConnectionStatus('connecting');

      try {
        const brokerUrl = this.getBrokerUrl(true);
        const options = this.createClientOptions();

        console.log(`[MQTT] Connecting to ${brokerUrl}...`);
        const brokerType = this.detectBrokerType();
        console.log(`[MQTT] Options:`, {
          clientId: options.clientId,
          protocol: options.protocol,
          protocolVersion: options.protocolVersion,
          brokerType: brokerType,
          // Show username format for local broker (deviceId:name:model), hide for external
          authMode: brokerType === 'local' ? 'device-id-format' : 'standard',
          username: brokerType === 'local' ? options.username : (options.username ? '***' : undefined),
        });

        // Check if using TCP protocol on React Native
        const useTcp = this.config.protocol === 'tcp';
        
        if (useTcp && Platform.OS === 'android') {
          // Use custom streamBuilder with react-native-tcp-socket for TCP connections
          console.log('[MQTT] Using react-native-tcp-socket for TCP connection');
          const address = this.convertAddressForAndroid(this.config.brokerAddress, false);
          const port = this.config.port || 1883;
          
          // Validate TCP connection parameters
          if (!address || !port) {
            throw new Error('Invalid TCP connection parameters: address or port missing');
          }
          
          // Create MQTT client with custom streamBuilder
          const streamBuilder = () => {
            console.log(`[MQTT] StreamBuilder creating socket to ${address}:${port}`);

            // Create wrapper placeholder so the connect callback can access it
            let wrappedSocket: any = null;
            
            // Add connection timeout
            let connectionTimeout: NodeJS.Timeout | null = null;
            const timeoutMs = this.config.connectTimeout || 30000;

            // Error throttling to prevent infinite loops
            let errorCount = 0;
            let errorThrottleTime = 0;
            const MAX_ERRORS_PER_SECOND = 5;
            const ERROR_THROTTLE_DURATION = 1000;

            // Create the actual TCP socket with timeout
            const socket = TcpSocket.createConnection(
              { 
                host: address, 
                port: port,
                timeout: timeoutMs, // Native Java socket connect timeout
              } as any,
              () => {
                console.log('[MQTT] TcpSocket connected!');
                errorCount = 0; // Reset error count on successful connection
                if (connectionTimeout) {
                  clearTimeout(connectionTimeout);
                  connectionTimeout = null;
                }
                if (!wrappedSocket) {
                  return;
                }
                // Mark as connected and flush any buffered writes
                wrappedSocket._tcpConnected = true;
                if (Array.isArray(wrappedSocket._writeBuffer)) {
                  wrappedSocket._writeBuffer.forEach((chunk: any) => {
                    try {
                      socket.write(chunk);
                    } catch (e) {
                      console.error('[MQTT] Error flushing buffered chunk:', (e as Error).message);
                    }
                  });
                  wrappedSocket._writeBuffer = [];
                }
                // NOTE: Do NOT re-emit 'connect' here!
                // The native TcpSocket already emits 'connect' which reaches mqtt.js
                // through registered listeners. Re-emitting causes duplicate MQTT CONNECT packets.
              }
            );
            
            // Set up connection timeout (JS-side safety net in case native timeout doesn't fire)
            connectionTimeout = setTimeout(() => {
              console.error('[MQTT] TCP connection timeout (JS timer)');
              if (wrappedSocket && typeof wrappedSocket.emit === 'function') {
                const err = new Error('TCP connection timeout');
                (err as any).code = 'ETIMEDOUT'; // Required for mqtt.js v5 streamErrorHandler
                wrappedSocket.emit('error', err);
              }
              socket.destroy();
            }, timeoutMs);

            // Wrap socket immediately with all required properties/methods
            wrappedSocket = socket as any;
            // Ensure compatibility with mqtt.js expectations
            if (typeof wrappedSocket.setMaxListeners !== 'function') {
              wrappedSocket.setMaxListeners = function(_n?: number) {
                // No-op implementation; React Native sockets don't emit the same warnings
                return this;
              };
            }
            wrappedSocket._tcpConnected = false;
            wrappedSocket._writeBuffer = [];
            wrappedSocket.writable = true;
            wrappedSocket.readable = true;
            wrappedSocket.destroyed = false;
            
            // Add EventEmitter-style listener management
            wrappedSocket._eventListeners = new Map();
            wrappedSocket.listenerCount = function(eventName: string) {
              const listeners = this._eventListeners.get(eventName);
              return listeners ? listeners.length : 0;
            };
            
            // Override the original socket's on/emit methods to track listeners
            const originalOn = socket.on.bind(socket);
            wrappedSocket.on = function(eventName: string, listener: any) {
              if (!this._eventListeners.has(eventName)) {
                this._eventListeners.set(eventName, []);
              }
              this._eventListeners.get(eventName).push(listener);
              return originalOn(eventName as any, listener);
            };
            
            const originalEmit = socket.emit.bind(socket);
            wrappedSocket.emit = function(eventName: string, ...args: any[]) {
              try {
                // Always delegate to original EventEmitter — do NOT gate on _eventListeners.
                // react-native-tcp-socket calls destroy() before emit('error'), and
                // eventemitter3 does not throw on unhandled 'error' events (unlike Node.js).
                return originalEmit(eventName as any, ...args);
              } catch (emitError) {
                console.error(`[MQTT] Error in emit(${eventName}):`, (emitError as Error).message);
                return false;
              }
            };
            
            // Clean up timeout on socket destruction
            const originalDestroy = socket.destroy.bind(socket);
            wrappedSocket.destroy = function(err?: Error) {
              console.log('[MQTT] Socket.destroy() called', err?.message);
              if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
              }
              if (socketTimeoutTimer) {
                clearInterval(socketTimeoutTimer);
                socketTimeoutTimer = null;
              }
              wrappedSocket.destroyed = true;
              wrappedSocket.writable = false;
              wrappedSocket.readable = false;
              // Do NOT clear _eventListeners here!
              // react-native-tcp-socket calls destroy() BEFORE emit('error') in its
              // internal error handler. Clearing listeners would silence the error
              // and leave mqtt.js hanging forever waiting for CONNACK.
              return originalDestroy();
            };

            // Provide a write implementation that buffers until connected
            const originalWrite = socket.write.bind(socket);
            wrappedSocket.write = (chunk: any, encoding?: any, cb?: any) => {
              const dataToWrite = chunk;
              if (!wrappedSocket._tcpConnected) {
                console.log('[MQTT] Socket.write() before connect - buffering');
                wrappedSocket._writeBuffer.push(dataToWrite);
                if (typeof cb === 'function') cb();
                return true;
              }
              try {
                const result = originalWrite(dataToWrite);
                if (typeof cb === 'function') cb();
                return result;
              } catch (e) {
                console.error('[MQTT] Socket.write() error:', (e as Error).message);
                if (typeof cb === 'function') cb(e);
                return false;
              }
            };

            // Handle socket errors — update state only, do NOT re-emit.
            // mqtt.js registers its own error listener on the native socket (via
            // the overridden 'on' method) and will receive the error event directly.
            // Re-emitting via wrappedSocket.emit() calls socket.emit() which
            // re-dispatches to ALL listeners, causing mqtt.js to see each error TWICE.
            socket.on('error', (err: Error | undefined) => {
              const now = Date.now();
              if (now - errorThrottleTime > ERROR_THROTTLE_DURATION) {
                errorCount = 0;
                errorThrottleTime = now;
              }
              errorCount++;
              
              if (errorCount <= MAX_ERRORS_PER_SECOND) {
                console.error(`[MQTT] TcpSocket error (${errorCount}/${MAX_ERRORS_PER_SECOND}):`, err?.message || 'Unknown socket error');
              } else if (errorCount === MAX_ERRORS_PER_SECOND + 1) {
                console.error('[MQTT] Too many socket errors, throttling logs...');
              }

              // Ensure the error has a .code property so mqtt.js v5's
              // streamErrorHandler actually propagates it to the client.
              // Without .code, mqtt.js silently drops the error via noop().
              if (err && !('code' in err)) {
                (err as any).code = 'SOCKET_ERROR';
              }
              
              if (!wrappedSocket.destroyed) {
                wrappedSocket.destroyed = true;
                wrappedSocket.writable = false;
                wrappedSocket.readable = false;
              }
            });
            
            // Same principle for 'close' — do NOT re-emit.
            socket.on('close', (hadError: boolean | undefined) => {
              if (errorCount <= MAX_ERRORS_PER_SECOND) {
                console.log('[MQTT] TcpSocket closed, hadError:', hadError || false);
              }
              if (!wrappedSocket.destroyed) {
                wrappedSocket.writable = false;
                wrappedSocket.readable = false;
                wrappedSocket.destroyed = true;
              }
            });
            
            // Add pipe() method required by MQTT.js
            wrappedSocket.pipe = function(destination: any) {
              console.log('[MQTT] Socket.pipe() called');
              this.on('data', (data: any) => {
                if (destination.writable !== false) {
                  destination.write(data);
                }
              });
              this.on('end', () => {
                if (destination.end) {
                  destination.end();
                }
              });
              // NOTE: Do NOT forward socket errors to the destination (parser).
              // mqtt.js registers its own error listener on the socket (via our
              // overridden 'on' method) and handles errors directly. Forwarding
              // errors here causes mqtt.js to see each error TWICE — once from
              // its own socket listener and once from the parser — which inflates
              // consecutiveFailures and can trigger premature circuit breaker.
              return destination;
            };
            
            // Track last data activity for socket idle timeout (Fix #5)
            let lastDataActivity = Date.now();
            let socketTimeoutTimer: NodeJS.Timeout | null = null;

            socket.on('data' as any, () => {
              lastDataActivity = Date.now();
            });

            // Add setNoDelay() method
            wrappedSocket.setNoDelay = function(_noDelay?: boolean) {
              // No-op: TcpSocket doesn't expose TCP_NODELAY
              return this;
            };
            
            // Add setKeepAlive() method
            wrappedSocket.setKeepAlive = function(_enable?: boolean, _initialDelay?: number) {
              // No-op: MQTT-level keepalive handles connection liveness
              return this;
            };
            
            // Socket idle timeout — mirrors Node.js net.Socket.setTimeout().
            // mqtt.js calls this with keepalive * 1000 * 1.5 to detect dead connections.
            // We track last data activity and emit 'timeout' when idle too long.
            wrappedSocket.setTimeout = function(timeout?: number, callback?: () => void) {
              // Clear previous timer
              if (socketTimeoutTimer) {
                clearInterval(socketTimeoutTimer);
                socketTimeoutTimer = null;
              }

              if (callback) {
                wrappedSocket.on('timeout', callback);
              }

              if (!timeout || timeout <= 0) {
                return this;
              }

              console.log(`[MQTT] Socket.setTimeout(${timeout}ms)`);
              lastDataActivity = Date.now();

              // Check every 5s (or timeout/3, whichever is smaller) if idle limit exceeded
              const checkInterval = Math.min(Math.floor(timeout / 3), 5000);
              socketTimeoutTimer = setInterval(() => {
                if (wrappedSocket.destroyed) {
                  if (socketTimeoutTimer) { clearInterval(socketTimeoutTimer); socketTimeoutTimer = null; }
                  return;
                }
                if (Date.now() - lastDataActivity >= timeout) {
                  console.warn(`[MQTT] Socket idle timeout (${timeout}ms since last data)`);
                  if (socketTimeoutTimer) { clearInterval(socketTimeoutTimer); socketTimeoutTimer = null; }
                  wrappedSocket.emit('timeout');
                }
              }, checkInterval);

              return this;
            };
            
            // Add end() method - graceful close
            wrappedSocket.end = function(data?: any, _encoding?: string, callback?: () => void) {
              console.log('[MQTT] Socket.end() called');
              if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
              }
              if (socketTimeoutTimer) {
                clearInterval(socketTimeoutTimer);
                socketTimeoutTimer = null;
              }
              if (data) {
                try {
                  socket.write(data);
                } catch (e) {
                  console.error('[MQTT] Error writing final data:', (e as Error).message);
                }
              }
              wrappedSocket.writable = false;
              socket.destroy();
              if (callback) callback();
              return this;
            };
            
            return wrappedSocket;
          };
          
          // Use mqtt.Client constructor directly with streamBuilder
          // Remove URL-related options since we're providing our own stream
          const tcpOptions = {
            ...options,
            // Don't pass URL options when using streamBuilder
            servers: undefined,
          };
          this.client = new mqtt.MqttClient(streamBuilder as any, tcpOptions);
        } else {
          // Standard connection for WebSocket or non-Android
          this.client = mqtt.connect(brokerUrl, options);
        }

        // Add global error handling to prevent unhandled errors
        if (this.client) {
          // Set up error handling immediately
          this.client.on('error', () => {
            // This will be overridden by setupEventHandlers, but ensures no unhandled errors during setup
          });
          
          // Handle any stream errors that might not be caught
          try {
            if (this.client.stream && typeof this.client.stream.on === 'function') {
              this.client.stream.on('error', (err: Error) => {
                console.error('[MQTT] Stream error caught:', err.message);
              });
            }
          } catch (streamSetupError) {
            console.warn('[MQTT] Could not set up stream error handling:', (streamSetupError as Error).message);
          }
        }

        // Setup event handlers
        this.setupEventHandlers(resolve, reject, { skipSubscribe });

      } catch (error) {
        console.error('[MQTT] Connection error:', error);
        const errorMsg = (error as Error)?.message || 'Unknown connection error';
        this.setConnectionStatus('error', errorMsg);
        reject(error);
      }
    });
  }

  /**
   * Setup MQTT event handlers
   */
  private setupEventHandlers(
    resolve: (value: boolean) => void,
    reject: (reason?: any) => void,
    options?: { skipSubscribe?: boolean }
  ): void {
    if (!this.client) return;

    // Timeout for connection — stored as instance property so disconnect() can clear it
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
    }
    this.connectionTimeoutTimer = setTimeout(() => {
      if (this.connectionStatus === 'connecting') {
        console.error('[MQTT] Connection timeout');
        this.setConnectionStatus('error', 'Connection timeout');
        reject(new Error('Connection timeout'));
      }
    }, this.config.connectTimeout || 30000);

    // On connect
    this.client.on('connect', () => {
      if (this.connectionTimeoutTimer) {
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
      }
      console.log('[MQTT] Connected successfully');
      console.log(`[MQTT-RECONNECT] ✅ Connection established (wasConnectedBefore=${this.wasConnectedBefore}, isReconnecting=${this.isReconnecting}, allRetriesExhausted=${this.allRetriesExhausted})`);
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.resetCircuitBreaker(); // Reset circuit breaker on successful connection
      
      // Reset reconnect tracking flags
      this.allRetriesExhausted = false;
      
      this.setConnectionStatus('connected');
      
      // Bắt đầu health check định kỳ (monitor connection)
      this.startHealthCheck();
      
      // Subscribe to topics (trừ khi skipSubscribe cho test connection)
      if (!options?.skipSubscribe) {
        this.subscribeToTopics();
        // Subscribe to device-specific configure topic
        this.subscribeToConfigureTopic();
        // Publish device info to server on every connect
        this.publishDeviceInfo();
      } else {
        console.log('[MQTT] Skipping topic subscriptions for this connection (test mode)');
      }
      
      resolve(true);
    });

    // On message — include packet to detect retained messages
    this.client.on('message', (topic: string, message: Buffer, packet: any) => {
      if (packet?.retain) {
        console.log(`[MQTT] Received RETAINED message on ${topic}`);
      }
      this.handleMessage(topic, message);
    });

    // On error
    this.client.on('error', (error: Error | undefined) => {
      if (this.connectionTimeoutTimer) {
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
      }
      const errorMsg = error?.message || 'Unknown MQTT error';
      console.error('[MQTT] Error:', errorMsg);
      
      // Diagnostic: log timing relative to last message for correlating message-triggered disconnects
      const timeSinceLastMsg = this.lastMessageAt ? `${Date.now() - this.lastMessageAt}ms ago` : 'never';
      console.log(`[MQTT-DIAG] Error after ${this.messageCount} messages (last message: ${timeSinceLastMsg}, alerts: ${this.alertCount})`);
      
      // Capture previous status BEFORE changing it — needed to detect connection-drop-while-connected
      const prevStatus = this.connectionStatus;
      console.log(`[MQTT-RECONNECT] Error event (prevStatus=${prevStatus}, consecutiveFailures=${this.consecutiveFailures + 1}, isReconnecting=${this.isReconnecting})`);
      
      // Track consecutive failures for circuit breaker
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.openCircuitBreaker();
      }
      
      // Don't set status to 'error' during reconnect — keep current status so banner stays amber
      if (!this.isReconnecting) {
        this.setConnectionStatus('error', errorMsg);
      }
      
      const mqttError = error || new Error(errorMsg);
      if (this.onError) {
        this.onError(mqttError);
      }

      // Use prevStatus to decide: if we WERE connected, schedule reconnect;
      // otherwise reject the pending connect() promise AND start reconnect loop
      if (prevStatus !== 'connected') {
        reject(mqttError);
        // Initial connection failed — start health check + reconnect loop
        // so the app automatically retries (same behavior as connection drop)
        if (!this.isReconnecting && !this.isCircuitBreakerOpen()) {
          console.log('[MQTT-RECONNECT] Initial connection failed, starting health check + reconnect...');
          this.startHealthCheck();
          this.scheduleReconnect();
        }
      } else {
        // Connection was established and we lost it — attempt reconnection
        if (!this.isReconnecting && !this.isCircuitBreakerOpen()) {
          console.log('[MQTT-RECONNECT] Connection lost (error while connected), scheduling reconnect...');
          this.scheduleReconnect();
        } else {
          console.log(`[MQTT-RECONNECT] Skipping scheduleReconnect (isReconnecting=${this.isReconnecting}, circuitBreaker=${this.isCircuitBreakerOpen()})`);
        }
      }
    });

    // On close
    this.client.on('close', () => {
      console.log('[MQTT] Connection closed');
      const timeSinceLastMsg = this.lastMessageAt ? `${Date.now() - this.lastMessageAt}ms ago` : 'never';
      console.log(`[MQTT-DIAG] Close after ${this.messageCount} messages (last message: ${timeSinceLastMsg}, alerts: ${this.alertCount})`);
      console.log(`[MQTT-RECONNECT] Close event (prevStatus=${this.connectionStatus}, isReconnecting=${this.isReconnecting})`);
      if (this.connectionStatus === 'connecting') {
        // Connection closed during handshake (broker rejected or TCP reset)
        if (this.connectionTimeoutTimer) {
          clearTimeout(this.connectionTimeoutTimer);
          this.connectionTimeoutTimer = null;
        }
        const err = new Error('Connection closed before CONNACK');
        // During reconnect, just reject without changing status to error
        if (!this.isReconnecting) {
          this.setConnectionStatus('error', err.message);
        }
        reject(err);
        // Initial handshake failed — start health check + reconnect loop if not already running
        if (!this.isReconnecting && !this.isCircuitBreakerOpen() && !this.healthCheckTimer) {
          console.log('[MQTT-RECONNECT] Handshake failed, starting health check + reconnect...');
          this.startHealthCheck();
          this.scheduleReconnect();
        }
      } else if (this.connectionStatus === 'connected') {
        console.log('[MQTT-RECONNECT] ⚠️ Connection lost! Setting disconnected status');
        this.setConnectionStatus('disconnected');
        // Start reconnect if not already running
        if (!this.isReconnecting) {
          this.scheduleReconnect();
        }
      }
    });

    // On offline
    this.client.on('offline', () => {
      console.log('[MQTT] Client offline');
      console.log(`[MQTT-RECONNECT] Offline event (isReconnecting=${this.isReconnecting})`);
      if (!this.isReconnecting) {
        this.setConnectionStatus('disconnected');
      }
    });

    // NOTE: No 'reconnect' event handler — reconnectPeriod is 0 (manual reconnect via scheduleReconnect).
    // mqtt.js only emits 'reconnect' when its built-in auto-reconnect is enabled.
  }

  /**
   * Subscribe vào các topics
   */
  private subscribeToTopics(): void {
    if (!this.client || this.connectionStatus !== 'connected') return;

    this.config.topics.forEach((topic) => {
      this.client!.subscribe(topic, { qos: MQTT_QOS.AT_LEAST_ONCE }, (error) => {
        if (error) {
          console.error(`[MQTT] Subscribe error for ${topic}:`, error);
        } else {
          console.log(`[MQTT] Subscribed to ${topic}`);
        }
      });
    });
  }

  /**
   * Subscribe to device-specific configure topic to receive server commands
   * Topic: avi/client/{deviceId}/configure
   */
  private subscribeToConfigureTopic(): void {
    if (!this.client || !this.deviceInfo || this.connectionStatus !== 'connected') return;

    const configureTopic = `avi/client/${this.deviceInfo.deviceId}/configure`;
    this.client.subscribe(configureTopic, { qos: MQTT_QOS.AT_LEAST_ONCE }, (error) => {
      if (error) {
        console.error(`[MQTT] Subscribe error for configure topic:`, error);
      } else {
        console.log(`[MQTT] Subscribed to configure topic: ${configureTopic}`);
      }
    });

    // Subscribe to broadcast update topic for server-pushed OTA updates
    const updateTopic = 'avi/factory-alert/update';
    this.client.subscribe(updateTopic, { qos: MQTT_QOS.AT_LEAST_ONCE }, (error) => {
      if (error) {
        console.error(`[MQTT] Subscribe error for update topic:`, error);
      } else {
        console.log(`[MQTT] Subscribed to update broadcast topic: ${updateTopic}`);
      }
    });
  }

  /**
   * Publish device info to server on every connect
   * Topic: avi/client/{deviceId}/info
   * Server sẽ lưu thông tin thiết bị vào database
   */
  private publishDeviceInfo(): void {
    if (!this.client || !this.deviceInfo || this.connectionStatus !== 'connected') return;

    const infoTopic = `avi/client/${this.deviceInfo.deviceId}/info`;
    const payload = {
      type: 'DEVICE_INFO',
      deviceId: this.deviceInfo.deviceId,
      deviceName: this.deviceInfo.deviceName,
      deviceModel: this.deviceInfo.deviceModel,
      brand: this.deviceInfo.brand || 'Unknown',
      manufacturer: this.deviceInfo.manufacturer || 'Unknown',
      osVersion: this.deviceInfo.osVersion || `${Platform.OS} ${Platform.Version}`,
      appVersion: this.deviceInfo.appVersion || require('./updateService').updateService.getCurrentVersion().version,
      ipAddress: this.deviceInfo.ipAddress || 'Unknown',
      screenResolution: this.deviceInfo.screenResolution || 'Unknown',
      networkType: this.deviceInfo.networkType || 'Unknown',
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      timestamp: new Date().toISOString(),
    };

    this.client.publish(infoTopic, JSON.stringify(payload), { qos: MQTT_QOS.AT_LEAST_ONCE }, (error) => {
      if (error) {
        console.error('[MQTT] Error publishing device info:', error);
      } else {
        console.log('[MQTT] Device info published to server:', infoTopic);
      }
    });
  }

  /**
   * Handle SOFTWARE_UPDATE command from server (dedicated message type)
   */
  private handleSoftwareUpdateCommand(command: SoftwareUpdateCommand): void {
    console.log('[MQTT] Processing SOFTWARE_UPDATE command:', command.command);

    try {
      // Send ACK first
      if (this.client && this.deviceInfo) {
        const ackTopic = `avi/client/${this.deviceInfo.deviceId}/ack`;
        const ack = {
          type: 'UPDATE_ACK',
          commandId: command.commandId,
          deviceId: this.deviceInfo.deviceId,
          status: 'received',
          timestamp: new Date().toISOString(),
        };
        this.client.publish(ackTopic, JSON.stringify(ack), { qos: MQTT_QOS.AT_LEAST_ONCE });
      }

      // Execute update command after short delay (to ensure ACK is sent)
      setTimeout(async () => {
        try {
          const { updateService } = require('./updateService');
          const result = await updateService.checkForUpdates(true);
          if (result.hasUpdate) {
            if (command.command === 'FORCE_UPDATE') {
              console.log('[MQTT] Force updating...');
              await updateService.downloadAndInstall(result.apkUrl!);
            } else {
              console.log('[MQTT] Showing update dialog...');
              updateService.showUpdateDialog(result);
            }
          } else {
            console.log('[MQTT] No update available');
          }
        } catch (err) {
          console.error('[MQTT] Error executing software update:', err);
        }
      }, 500);
    } catch (error) {
      console.error('[MQTT] Error handling SOFTWARE_UPDATE command:', error);
    }
  }

  /**
   * Handle CONFIGURE command from server
   * Allows server to remotely update station assignment, topics, and settings
   */
  private handleConfigureCommand(command: ConfigureCommand, topic: string): void {
    console.log('[MQTT] Processing CONFIGURE command:', JSON.stringify(command));

    try {
      const settingsStore = getSettingsStore().getState();
      const appliedSections: string[] = [];
      let needsReconnect = false;

      // Apply topic changes if provided
      if (command.topics && command.topics.length > 0) {
        console.log('[MQTT] Updating subscribed topics:', command.topics);
        this.config.topics = command.topics;
        this.subscribeToTopics();
        appliedSections.push('topics');
      }

      if (command.settings) {
        // --- Handle server commands (RESTART_APP, CHECK_UPDATE, FORCE_UPDATE) ---
        if (command.settings._command) {
          const cmd = command.settings._command;
          console.log('[MQTT] Received server command:', cmd);
          appliedSections.push(`command:${cmd}`);

          // Send ACK first before executing command
          if (this.client && this.deviceInfo) {
            const ackTopic = `avi/client/${this.deviceInfo.deviceId}/ack`;
            const ack = {
              type: 'CONFIGURE_ACK',
              commandId: command.commandId,
              deviceId: this.deviceInfo.deviceId,
              status: 'applied',
              appliedSections,
              timestamp: new Date().toISOString(),
            };
            this.client.publish(ackTopic, JSON.stringify(ack), { qos: MQTT_QOS.AT_LEAST_ONCE });
          }

          // Execute command after short delay (to ensure ACK is sent)
          setTimeout(async () => {
            try {
              if (cmd === 'RESTART_APP') {
                console.log('[MQTT] Executing RESTART_APP...');
                const { DevSettings } = require('react-native');
                if (DevSettings && typeof DevSettings.reload === 'function') {
                  DevSettings.reload();
                } else {
                  console.warn('[MQTT] No restart mechanism available (DevSettings.reload not supported in release)');
                }
              } else if (cmd === 'CHECK_UPDATE' || cmd === 'FORCE_UPDATE') {
                console.log(`[MQTT] Executing ${cmd}...`);
                const { updateService } = require('./updateService');
                const result = await updateService.checkForUpdates(true);
                if (result.hasUpdate) {
                  if (cmd === 'FORCE_UPDATE') {
                    await updateService.downloadAndInstall(result.apkUrl!);
                  } else {
                    updateService.showUpdateDialog(result);
                  }
                }
              }
            } catch (cmdError) {
              console.error('[MQTT] Error executing command:', cmd, cmdError);
            }
          }, 500);
          return; // Command handled — skip normal configure flow
        }

        // --- MQTT config ---
        if (command.settings.mqtt && Object.keys(command.settings.mqtt).length > 0) {
          const currentMqtt = settingsStore.settings.mqtt;
          const mqttPatch = command.settings.mqtt;
          // Detect broker change that requires reconnection
          if (
            (mqttPatch.brokerAddress !== undefined && mqttPatch.brokerAddress !== currentMqtt.brokerAddress) ||
            (mqttPatch.port !== undefined && mqttPatch.port !== currentMqtt.port) ||
            (mqttPatch.protocol !== undefined && mqttPatch.protocol !== currentMqtt.protocol) ||
            (mqttPatch.useSSL !== undefined && mqttPatch.useSSL !== currentMqtt.useSSL) ||
            (mqttPatch.username !== undefined && mqttPatch.username !== currentMqtt.username) ||
            (mqttPatch.password !== undefined && mqttPatch.password !== currentMqtt.password)
          ) {
            needsReconnect = true;
          }
          settingsStore.updateMqttConfig(mqttPatch);
          console.log('[MQTT] Applied MQTT config:', Object.keys(mqttPatch).join(', '));
          appliedSections.push('mqtt');
        }

        // --- Notification config ---
        if (command.settings.notification && Object.keys(command.settings.notification).length > 0) {
          settingsStore.updateNotificationConfig(command.settings.notification);
          console.log('[MQTT] Applied notification config:', Object.keys(command.settings.notification).join(', '));
          appliedSections.push('notification');
        }

        // --- App settings ---
        if (command.settings.app && Object.keys(command.settings.app).length > 0) {
          const appPatch = command.settings.app;
          settingsStore.updateAppSettings(appPatch);
          console.log('[MQTT] Applied app settings:', Object.keys(appPatch).join(', '));
          appliedSections.push('app');

          // Sync health check settings if changed
          if (appPatch.mqttHealthCheckInterval || appPatch.mqttRetryMaxAttempts || appPatch.mqttRetryInterval) {
            this.updateHealthCheckSettings({
              healthCheckInterval: appPatch.mqttHealthCheckInterval,
              retryMaxAttempts: appPatch.mqttRetryMaxAttempts,
              retryInterval: appPatch.mqttRetryInterval,
            });
          }
        }

        // --- Legacy: workstationId at top level ---
        if (command.settings.workstationId !== undefined && !command.settings.app) {
          settingsStore.updateAppSettings({ workstationId: command.settings.workstationId });
          console.log('[MQTT] Updated workstationId (legacy):', command.settings.workstationId);
          appliedSections.push('workstationId');
        }
      }

      // Send ACK back to server
      if (this.client && this.deviceInfo) {
        const ackTopic = `avi/client/${this.deviceInfo.deviceId}/ack`;
        const ack = {
          type: 'CONFIGURE_ACK',
          commandId: command.commandId,
          deviceId: this.deviceInfo.deviceId,
          status: 'applied',
          appliedSections,
          timestamp: new Date().toISOString(),
        };
        this.client.publish(ackTopic, JSON.stringify(ack), { qos: MQTT_QOS.AT_LEAST_ONCE });
        console.log('[MQTT] Sent CONFIGURE_ACK for command:', command.commandId, 'sections:', appliedSections);
      }

      // Reconnect if broker settings changed (after sending ACK on old connection)
      if (needsReconnect) {
        console.log('[MQTT] Broker settings changed — scheduling reconnect...');
        setTimeout(() => {
          const newSettings = getSettingsStore().getState().settings.mqtt;
          this.disconnect();
          this.config = { ...this.config, ...newSettings };
          this.connect();
        }, 1000);
      }
    } catch (error) {
      console.error('[MQTT] Error handling CONFIGURE command:', error);
      // Send NACK
      if (this.client && this.deviceInfo) {
        const ackTopic = `avi/client/${this.deviceInfo.deviceId}/ack`;
        const nack = {
          type: 'CONFIGURE_ACK',
          commandId: command.commandId,
          deviceId: this.deviceInfo.deviceId,
          status: 'failed',
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        };
        this.client.publish(ackTopic, JSON.stringify(nack), { qos: MQTT_QOS.AT_LEAST_ONCE });
      }
    }
  }

  /**
   * Non-alert message types to ignore
   */
  private static readonly NON_ALERT_TYPES = [
    'DAILY_SUMMARY',
    'HOURLY_SUMMARY', 
    'WEEKLY_SUMMARY',
    'MONTHLY_SUMMARY',
    'HEARTBEAT',
    'STATUS_UPDATE',
    'STATISTICS',
  ];

  /**
   * Xử lý message nhận được
   */
  private handleMessage(topic: string, message: Buffer): void {
    this.messageCount++;
    this.lastMessageAt = Date.now();
    try {
      const messageStr = message.toString();
      // Wave 2C: this fires on EVERY inbound MQTT message and dumped the full raw
      // payload. Guard behind __DEV__ so Metro strips it (incl. the toString arg
      // interpolation) from release — a major per-message CPU/GC win.
      if (__DEV__) console.log(`[MQTT] Message #${this.messageCount} received on ${topic}:`, messageStr);

      // Parse JSON payload
      const payload = JSON.parse(messageStr);

      // Handle CONFIGURE command from server
      if (payload.type === 'CONFIGURE') {
        console.log(`[MQTT] Received CONFIGURE command: ${payload.commandId}`);
        this.handleConfigureCommand(payload as ConfigureCommand, topic);
        return;
      }

      // Handle SOFTWARE_UPDATE command (dedicated message type)
      if (payload.type === 'SOFTWARE_UPDATE') {
        console.log(`[MQTT] Received SOFTWARE_UPDATE command: ${payload.commandId} (${payload.command})`);
        this.handleSoftwareUpdateCommand(payload as SoftwareUpdateCommand);
        return;
      }

      // Handle FACTORY_ALERT_UPDATE - broadcast push update from server
      if (payload.type === 'FACTORY_ALERT_UPDATE') {
        console.log(`[MQTT] Received FACTORY_ALERT_UPDATE push from server`);
        try {
          const { updateService } = require('./updateService');
          updateService.handleMqttPushUpdate(payload);
        } catch (err) {
          console.error('[MQTT] Error handling push update:', err);
        }
        return;
      }

      // MB6 (doc 27): server-side escalation notice (retained on avi/escalations/#)
      if (payload.type === 'ALERT_ESCALATION') {
        console.log(`[MQTT] Received ALERT_ESCALATION: ${payload.alertId}`);
        try {
          if (this.onEscalation && payload.alertId) {
            this.onEscalation(payload as EscalationNotice);
          }
        } catch (escErr) {
          console.error('[MQTT] Error processing escalation notice:', escErr);
        }
        return;
      }

      // Handle PERIODIC_BULLETIN message type
      if (payload.type === 'PERIODIC_BULLETIN') {
        console.log(`[MQTT] Received PERIODIC_BULLETIN: ${payload.bulletinId}`);
        try {
          // Validate and provide defaults for required fields
          const bulletin: PeriodicBulletin = {
            bulletinId: payload.bulletinId || `BLT-${Date.now()}`,
            type: 'PERIODIC_BULLETIN',
            stationId: payload.stationId ?? 0,
            stationName: payload.stationName || 'Unknown Station',
            factoryName: payload.factoryName || 'N/A',
            workshopName: payload.workshopName || 'N/A',
            lineName: payload.lineName || 'N/A',
            period: {
              start: payload.period?.start || new Date().toISOString(),
              end: payload.period?.end || new Date().toISOString(),
              intervalMinutes: payload.period?.intervalMinutes ?? 30,
            },
            statistics: {
              totalCount: payload.statistics?.totalCount ?? 0,
              okCount: payload.statistics?.okCount ?? 0,
              ngCount: payload.statistics?.ngCount ?? 0,
              ntfCount: payload.statistics?.ntfCount ?? 0,
              yieldRate: payload.statistics?.yieldRate ?? 0,
              avgCycleTime: payload.statistics?.avgCycleTime ?? 0,
            },
            failPoints: Array.isArray(payload.failPoints) ? payload.failPoints.map((fp: any) => ({
              pointId: fp.pointId ?? 0,
              pointName: fp.pointName || 'Unknown',
              pointCode: fp.pointCode || 'N/A',
              ngCount: fp.ngCount ?? 0,
              percentage: fp.percentage ?? 0,
              imageUrl: fp.imageUrl || null,
              referenceImageUrl: fp.referenceImageUrl || null,
              latestInspectionId: fp.latestInspectionId ?? 0,
              latestSerialNumber: fp.latestSerialNumber || 'N/A',
              workstationId: fp.workstationId,
            })) : [],
            machines: Array.isArray(payload.machines) ? payload.machines.map((m: any) => ({
              machineId: m.machineId ?? 0,
              machineName: m.machineName || 'Unknown',
              machineCode: m.machineCode || 'N/A',
              totalCount: m.totalCount ?? 0,
              ngCount: m.ngCount ?? 0,
            })) : [],
            timestamp: payload.timestamp || new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            isRead: false,
          };
          // Filter failPoints by workstationId setting
          const wsIdSetting = getSettingsStore().getState().settings.app.workstationId;
          if (wsIdSetting != null && bulletin.failPoints.length > 0) {
            bulletin.failPoints = bulletin.failPoints.filter(
              fp => fp.workstationId == null || fp.workstationId === wsIdSetting
            );
            console.log(`[MQTT] Bulletin failPoints filtered by workstationId=${wsIdSetting}, remaining: ${bulletin.failPoints.length}`);
          }

          if (this.onBulletin) {
            this.onBulletin(bulletin);
          }
        } catch (bulletinError) {
          console.error('[MQTT] Error processing bulletin:', bulletinError);
        }
        return;
      }

      // Check if this is a non-alert message type (summary, heartbeat, etc.)
      if (payload.type && MqttService.NON_ALERT_TYPES.includes(payload.type)) {
        if (__DEV__) console.log(`[MQTT] Ignoring non-alert message type: ${payload.type}`);
        return;
      }

      // Validate payload as alert (flexible validation)
      if (!isValidAlertPayload(payload)) {
        if (__DEV__) console.log('[MQTT] Message is not an alert, skipping:', payload.type || 'unknown');
        return;
      }

      // Normalize payload to standard format
      const normalizedPayload = normalizeAlertPayload(payload, topic);

      // Deduplicate alerts — skip if we've already processed this alertId recently
      // This prevents retained messages from being shown twice after reconnect
      if (normalizedPayload.alertId && this.recentAlertIds.has(normalizedPayload.alertId)) {
        if (__DEV__) console.log(`[MQTT] Duplicate alert skipped: ${normalizedPayload.alertId} (already processed)`);
        return;
      }

      // Filter by workstationId setting (payload-level only)
      // NOTE: Không filter từng ngPoint theo workstationId vì sẽ làm mất điểm NG
      // Chỉ filter cả alert nếu payload-level workstationId không khớp
      const wsIdSetting = getSettingsStore().getState().settings.app.workstationId;
      if (wsIdSetting != null) {
        const payloadWsId = payload.workstationId;
        if (payloadWsId != null && payloadWsId !== wsIdSetting) {
          if (__DEV__) console.log(`[MQTT] Alert skipped: workstationId=${payloadWsId} does not match setting=${wsIdSetting}`);
          return;
        }
      }

      // Create Alert object with all fields including new ones
      const alert: Alert = {
        id: generateUUID(),
        alertId: normalizedPayload.alertId,
        // Wave 1: prefer this server ack/resolve target id for ack/resolve HTTP calls.
        serverAlertId: normalizedPayload.serverAlertId,
        alertType: normalizedPayload.alertType,
        timestamp: normalizedPayload.timestamp,
        receivedAt: new Date().toISOString(),
        station: normalizedPayload.station,
        product: normalizedPayload.product,
        error: normalizedPayload.error,
        severity: normalizedPayload.severity,
        status: 'pending',
        // New fields for extended alert info
        imageUrl: normalizedPayload.imageUrl || normalizedPayload.error?.imageUrl,
        machine: normalizedPayload.machine,
        ngPoints: normalizedPayload.ngPoints,
        totalNG: normalizedPayload.totalNG,
        inspectionId: normalizedPayload.inspectionId,
        message: normalizedPayload.message,
        measurementPoint: normalizedPayload.measurementPoint,
        productModel: normalizedPayload.productModel,
        ngRate: normalizedPayload.ngRate,
        thresholdConfig: normalizedPayload.thresholdConfig,
        period: normalizedPayload.period,
      };

      if (__DEV__) console.log(`[MQTT] Alert created:`, alert.alertId, alert.severity, alert.error.description);

      // Track alertId for deduplication
      if (alert.alertId) {
        this.recentAlertIds.add(alert.alertId);
        // Evict oldest entries when set grows too large
        if (this.recentAlertIds.size > this.MAX_RECENT_ALERT_IDS) {
          const first = this.recentAlertIds.values().next().value;
          if (first) this.recentAlertIds.delete(first);
        }
      }

      // Notify callback
      if (this.onMessage) {
        this.alertCount++;
        if (__DEV__) console.log(`[MQTT] Dispatching alert #${this.alertCount} to onMessage callback (total messages: ${this.messageCount})`);
        this.onMessage(alert);
      } else {
        console.warn('[MQTT] No onMessage callback registered, alert dropped!');
      }

    } catch (error) {
      console.error('[MQTT] Error processing message:', error);
    }
  }

  /**
   * Schedule reconnect với exponential backoff
   * Đây là cơ chế reconnect DUY NHẤT. Khi hết MAX_ATTEMPTS → chuyển sang passive recovery (health check).
   */
  private scheduleReconnect(): void {
    // Debounce: if error/close/offline fire in rapid succession, only honour the first one
    const now = Date.now();
    if (now - this.lastReconnectTriggerTime < 500) {
      console.log('[MQTT-RECONNECT] scheduleReconnect debounced (called <500ms after last trigger)');
      return;
    }
    this.lastReconnectTriggerTime = now;

    // Check circuit breaker first
    if (this.isCircuitBreakerOpen()) {
      const remainingTime = Math.ceil((this.circuitBreakerOpenUntil - Date.now()) / 1000);
      console.log(`[MQTT-RECONNECT] Reconnect blocked by circuit breaker (${remainingTime}s remaining)`);
      return;
    }

    if (this.reconnectAttempts >= RECONNECT_CONFIG.MAX_ATTEMPTS) {
      console.log(`[MQTT-RECONNECT] 🚫 All ${RECONNECT_CONFIG.MAX_ATTEMPTS} reconnect attempts exhausted`);
      this.isReconnecting = false;
      this.allRetriesExhausted = true;
      this.setConnectionStatus('error', `All ${RECONNECT_CONFIG.MAX_ATTEMPTS} reconnect attempts failed`);

      // Set permanent error state in Zustand store
      const store = useConnectionStore.getState();
      store.setAllRetriesFailed(true);

      if (this.onAllRetriesFailed) {
        this.onAllRetriesFailed();
      }
      // Health check continues running — will do passive recovery (1 connect per interval)
      console.log('[MQTT-RECONNECT] Health check will attempt passive recovery each interval');
      return;
    }

    this.isReconnecting = true;
    this.clearReconnectTimer();

    // Calculate delay with exponential backoff
    const delay = Math.min(
      RECONNECT_CONFIG.BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_CONFIG.MAX_DELAY
    );

    console.log(`[MQTT-RECONNECT] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${RECONNECT_CONFIG.MAX_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      // Update Zustand store so UI banner shows reconnect attempt count
      useConnectionStore.getState().incrementReconnectAttempts();
      try {
        await this.connect();
        // Connect succeeded — stop reconnecting
        this.isReconnecting = false;
      } catch (error) {
        console.error('[MQTT-RECONNECT] scheduleReconnect failed:', (error as Error).message);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Ngắt kết nối
   */
  public disconnect(): void {
    this.clearReconnectTimer();
    this.stopHealthCheck(); // Dừng health check + retry khi disconnect

    // Clear the setupEventHandlers connection timeout to prevent leaked timers
    // from firing during a subsequent connect() attempt
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }

    if (this.client) {
      console.log('[MQTT] Disconnecting (graceful)...');
      this.cleanupClient(false); // Graceful: send DISCONNECT packet before closing
    }

    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.resetCircuitBreaker(); // Reset circuit breaker on manual disconnect
    this.recentAlertIds.clear(); // Clear dedup set so retained messages are processed on next connect
    this.setConnectionStatus('disconnected');
  }

  /**
   * Measure MQTT round-trip time by publishing a QoS 1 message
   * and timing how long until the PUBACK is received.
   * Uses the existing connection — does NOT create a new client.
   * Returns latency in milliseconds, or throws if not connected.
   */
  public async measureRtt(): Promise<number> {
    if (!this.client || this.connectionStatus !== 'connected') {
      throw new Error('MQTT not connected');
    }
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const topic = `avi/test/rtt/${start}`;
      const timeout = setTimeout(() => {
        reject(new Error('RTT measurement timeout'));
      }, 10000);
      this.client!.publish(topic, JSON.stringify({ t: start }), { qos: 1 }, (err) => {
        clearTimeout(timeout);
        if (err) {
          reject(err);
        } else {
          resolve(Date.now() - start);
        }
      });
    });
  }

  /**
   * Test kết nối - Sử dụng client riêng để không ảnh hưởng kết nối hiện tại
   * Bypasses circuit breaker for testing purposes
   */
  public async testConnection(config?: Partial<MqttConfig>): Promise<boolean> {
    // Sử dụng config test hoặc config hiện tại
    const testConfig = config ? { ...this.config, ...config } : { ...this.config };
    
    // NOTE: testConnection() intentionally BYPASSES circuit breaker for testing
    // This is why Settings connection test works even when circuit breaker is open
    const cbStatus = this.getCircuitBreakerStatus();
    console.log(`[MQTT] testConnection() BYPASSING circuit breaker - Status:`, cbStatus);
    
    // Tạo client test riêng biệt với ID khác
    const testClientId = `test_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;
    
    return new Promise((resolve) => {
      try {
        // Build test URL - tạm thời dùng testConfig
        const originalConfig = this.config;
        this.config = testConfig;
        const testUrl = this.getBrokerUrl(true);
        const testOptions = this.createClientOptions();
        testOptions.clientId = testClientId;
        testOptions.reconnectPeriod = 0; // Không reconnect cho test
        
        console.log(`[MQTT] Testing connection to ${testUrl}...`);
        console.log(`[MQTT] testConnection() uses direct mqtt.connect() - no TCP wrapper`);
        
        this.config = originalConfig; // Restore lại config gốc
        
        // Timeout cho test (10 giây)
        const timeout = setTimeout(() => {
          console.log('[MQTT] Test connection timeout');
          if (testClient) {
            testClient.end(true);
          }
          resolve(false);
        }, 10000);
        
        // Tạo test client riêng
        const testClient = mqtt.connect(testUrl, testOptions);
        
        testClient.on('connect', () => {
          clearTimeout(timeout);
          console.log('[MQTT] Test connection successful ✓');
          testClient.end(false, {}, () => resolve(true)); // Proper DISCONNECT
        });
        
        testClient.on('error', (error: Error) => {
          clearTimeout(timeout);
          console.log('[MQTT] Test connection failed:', error.message);
          testClient.end(false, {}, () => resolve(false));
        });
        
      } catch (error) {
        console.error('[MQTT] Test connection error:', error);
        resolve(false);
      }
    });
  }

  /**
   * Publish message (for testing/simulator)
   */
  public publish(topic: string, payload: object): boolean {
    if (!this.client || this.connectionStatus !== 'connected') {
      console.error('[MQTT] Cannot publish: not connected');
      return false;
    }

    try {
      const message = JSON.stringify(payload);
      this.client.publish(topic, message, { qos: MQTT_QOS.AT_LEAST_ONCE });
      console.log(`[MQTT] Published to ${topic}:`, message);
      return true;
    } catch (error) {
      console.error('[MQTT] Publish error:', error);
      return false;
    }
  }

  /**
   * Kiểm tra đã kết nối chưa
   */
  public isConnected(): boolean {
    return this.connectionStatus === 'connected' && this.client !== null;
  }

  /**
   * Load config từ storage
   */
  public async loadConfig(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) {
        const settings = JSON.parse(data);
        if (settings.mqtt) {
          this.configure(settings.mqtt);
        }
      }
    } catch (error) {
      console.error('[MQTT] Error loading config:', error);
    }
  }

  /**
   * Save config to storage
   */
  public async saveConfig(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      const settings = data ? JSON.parse(data) : {};
      settings.mqtt = this.config;
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('[MQTT] Error saving config:', error);
    }
  }

  /**
   * Get broker info for display
   */
  public getBrokerInfo(): { type: string; url: string; protocol: string } {
    const connectionProtocol = this.config.protocol === 'tcp' 
      ? (this.config.useSSL ? 'MQTTS (TCP+SSL)' : 'MQTT (TCP)')
      : (this.config.useSSL ? 'WSS (WebSocket+SSL)' : 'WS (WebSocket)');
    
    return {
      type: this.detectBrokerType(),
      url: this.getBrokerUrl(false),
      protocol: connectionProtocol,
    };
  }

  /**
   * Manually reset circuit breaker (for testing/admin purposes)
   */
  public resetCircuitBreakerManually(): void {
    this.resetCircuitBreaker();
    console.log('[MQTT] Circuit breaker manually reset');
  }

  /**
   * Get circuit breaker status
   */
  public getCircuitBreakerStatus(): {
    isOpen: boolean;
    consecutiveFailures: number;
    remainingTimeMs: number;
  } {
    const now = Date.now();
    return {
      isOpen: this.isCircuitBreakerOpen(),
      consecutiveFailures: this.consecutiveFailures,
      remainingTimeMs: Math.max(0, this.circuitBreakerOpenUntil - now),
    };
  }

  // ============================================
  // APPSTATE MANAGEMENT (background / foreground)
  // ============================================

  /**
   * Set up AppState listener to handle Android Doze mode.
   * - Background: stop health check to save battery (connection may be killed by OS).
   * - Foreground: immediate health check → reconnect if connection was lost in background.
   */
  private setupAppStateManagement(): void {
    if (this.appStateSubscription) return;

    this.currentAppState = AppState.currentState;
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const prevState = this.currentAppState;
      this.currentAppState = nextAppState;

      if (prevState.match(/inactive|background/) && nextAppState === 'active') {
        this.handleForegroundReturn();
      } else if (prevState === 'active' && nextAppState.match(/inactive|background/)) {
        this.handleBackgroundEntry();
      }
    });
    console.log('[MQTT-APPSTATE] AppState management initialized');
  }

  /**
   * App entering background.
   *
   * MB2 (doc 27 Đợt 6): when background keep-alive is active (foreground
   * service will run — see backgroundReliability), the JS runtime stays alive,
   * so we KEEP the health check running: this is what actually keeps MQTT
   * connected/reconnecting with the screen off. Only when keep-alive is
   * disabled do we fall back to the old battery-saving behaviour (stop the
   * health check; foreground return recovers the connection).
   */
  private handleBackgroundEntry(): void {
    this.wasConnectedBeforeBackground =
      this.client?.connected === true && this.connectionStatus === 'connected';

    let keepAlive = false;
    try {
      const { backgroundReliability } = require('./backgroundReliability');
      keepAlive =
        backgroundReliability.isKeepAliveEnabled() &&
        this.connectionStatus !== 'disconnected';
    } catch (e) {
      console.warn('[MQTT-APPSTATE] backgroundReliability unavailable:', (e as Error)?.message);
    }

    if (keepAlive) {
      console.log(
        `[MQTT-APPSTATE] Background (wasConnected=${this.wasConnectedBeforeBackground}) — keep-alive ON, health check continues under foreground service`,
      );
      return;
    }

    this.stopHealthCheck();
    console.log(`[MQTT-APPSTATE] Background (wasConnected=${this.wasConnectedBeforeBackground})`);
  }

  /**
   * App returning to foreground — verify connection and recover if needed.
   */
  private handleForegroundReturn(): void {
    console.log('[MQTT-APPSTATE] Foreground return');

    // Restart health check regardless of status
    this.startHealthCheck();

    const isStillConnected =
      this.client?.connected === true && this.connectionStatus === 'connected';

    if (isStillConnected) {
      // Connection survived background — force an immediate health check cycle
      console.log('[MQTT-APPSTATE] Connection appears alive, verifying with health check...');
      this.performHealthCheck();
    } else if (this.wasConnectedBeforeBackground) {
      // Was connected before background but lost it — fresh reconnect
      console.log('[MQTT-APPSTATE] Connection lost during background, reconnecting...');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.allRetriesExhausted = false;
      this.resetCircuitBreaker();
      this.lastReconnectTriggerTime = 0; // clear debounce so scheduleReconnect fires immediately
      this.scheduleReconnect();
    }
    // If was not connected before background, do nothing (user manually disconnected or never connected)
  }

  // ============================================
  // PERIODIC HEALTH CHECK & RETRY
  // ============================================

  /**
   * Set callback khi kết nối MQTT được phục hồi (reconnect thành công)
   */
  public setOnReconnectSuccess(cb: (() => void) | null): void {
    this.onReconnectSuccess = cb;
  }

  /**
   * Reset trạng thái allRetriesExhausted + reconnect counters — gọi khi user bấm nút retry thủ công.
   * Cũng reset reconnectAttempts và circuit breaker để retry từ đầu.
   */
  public resetAllRetriesExhausted(): void {
    this.allRetriesExhausted = false;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.resetCircuitBreaker();
    console.log('[MQTT-RECONNECT] allRetriesExhausted, reconnectAttempts, isReconnecting, and circuit breaker reset manually');
  }

  /**
   * Set callback khi tất cả lần retry thất bại
   */
  public setOnAllRetriesFailed(cb: (() => void) | null): void {
    this.onAllRetriesFailed = cb;
  }

  /**
   * Bắt đầu kiểm tra kết nối MQTT định kỳ
   */
  public startHealthCheck(): void {
    this.stopHealthCheck();

    // MB2 (doc 27 Đợt 6): the health-check start is the seam where the MQTT
    // lifecycle becomes active → register the background-reliability AppState
    // listener here (idempotent). It starts the Notifee foreground service when
    // the app goes to background so this very health-check timer (and the MQTT
    // socket) keep running with the screen off. Lazy require: avoids a circular
    // import (backgroundReliability ⇄ mqttService).
    try {
      require('./backgroundReliability').backgroundReliability.init();
    } catch (e) {
      console.warn('[MQTT] backgroundReliability init failed:', (e as Error)?.message);
    }

    console.log(`[MQTT-RECONNECT] Health check started (interval: ${this.healthCheckInterval}ms)`);
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * Dừng kiểm tra kết nối MQTT định kỳ
   */
  public stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[MQTT-RECONNECT] Health check stopped');
    }
  }

  /**
   * Kiểm tra sức khỏe kết nối
   * Flow thống nhất:
   * - Connected → OK
   * - scheduleReconnect đang chạy → skip (để nó xử lý)
   * - allRetriesExhausted → passive recovery (1 connect per interval)
   * - Mất kết nối mà không ai xử lý → safety net: gọi scheduleReconnect()
   */
  private performHealthCheck(): void {
    const isConnected = this.client?.connected === true && this.connectionStatus === 'connected';

    // Case 1: Connected — everything OK
    if (isConnected) {
      this.healthCheckConsecutiveFailures = 0;
      if (this.allRetriesExhausted) {
        console.log('[MQTT-RECONNECT] ✅ Health check: connection recovered after all retries were exhausted!');
        this.allRetriesExhausted = false;
        this.passiveRecoveryAttempts = 0;
        this.setConnectionStatus('connected');
      }
      return;
    }

    // Case 2: scheduleReconnect is running — let it finish
    if (this.isReconnecting) {
      console.log(`[MQTT-RECONNECT] Health check: skipped (scheduleReconnect in progress, attempt ${this.reconnectAttempts}/${RECONNECT_CONFIG.MAX_ATTEMPTS})`);
      return;
    }

    // Case 3: All retries exhausted — passive recovery with exponential backoff
    if (this.allRetriesExhausted) {
      // Exponential backoff: skip N health check cycles based on attempt count
      const skipCycles = Math.min(Math.pow(2, this.passiveRecoveryAttempts), 16); // max skip 16 cycles (~4 min at 15s interval)
      this.healthCheckConsecutiveFailures++;
      if (this.healthCheckConsecutiveFailures < skipCycles) {
        console.log(`[MQTT-RECONNECT] Health check: passive recovery waiting (${this.healthCheckConsecutiveFailures}/${skipCycles} cycles)`);
        return;
      }
      this.healthCheckConsecutiveFailures = 0;
      this.passiveRecoveryAttempts++;
      console.log(`[MQTT-RECONNECT] Health check: passive recovery attempt #${this.passiveRecoveryAttempts}...`);
      this.resetCircuitBreaker();
      this.connect().then((result) => {
        if (result && this.connectionStatus === 'connected') {
          console.log('[MQTT-RECONNECT] ✅ Passive recovery succeeded!');
          this.allRetriesExhausted = false;
          this.passiveRecoveryAttempts = 0;
        }
      }).catch(() => {
        console.log('[MQTT-RECONNECT] Passive recovery failed, will try again with backoff');
      });
      return;
    }

    // Case 4: Safety net — connection lost but no reconnect running (close/error event missed)
    // Require consecutive failures to avoid reacting to transient network glitches
    this.healthCheckConsecutiveFailures++;
    if (this.healthCheckConsecutiveFailures < this.HEALTH_CHECK_FAIL_THRESHOLD) {
      console.log(`[MQTT-RECONNECT] Health check: disconnected detected (${this.healthCheckConsecutiveFailures}/${this.HEALTH_CHECK_FAIL_THRESHOLD}), waiting for confirmation...`);
      return;
    }
    if (this.connectionStatus !== 'connecting') {
      console.warn(`[MQTT-RECONNECT] ⚠️ Health check: confirmed connection lost after ${this.healthCheckConsecutiveFailures} checks (status=${this.connectionStatus}), safety net → scheduleReconnect`);
      this.healthCheckConsecutiveFailures = 0;
      this.setConnectionStatus('disconnected');
      this.scheduleReconnect();
    }
  }
}

// Export singleton instance
export const mqttService = MqttService.getInstance();
export default mqttService;
