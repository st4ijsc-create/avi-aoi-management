/**
 * Factory Alert System - Settings Screen
 * Màn hình cài đặt ứng dụng
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  useWindowDimensions,
  AppState,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import SettingItem, { SettingSection } from '../components/SettingItem';
import HierarchyTreeSelector from '../components/HierarchyTreeSelector';
import {
  useSettingsStore,
  selectSettings,
  useAlertStore,
  useConnectionStore,
  selectConnectionStatus,
} from '../store';
import { useStationInspectionStore } from '../store/stationInspectionStore';
import { TRANSLATIONS, CONNECTION_STATUS_CONFIG, SEVERITY_CONFIG } from '../utils/constants';
import { useTheme, Theme } from '../context/ThemeContext';
import { mqttService } from '../services/mqttService';
import { notificationService } from '../services/notificationService';
import { alertFilterService } from '../services/alertFilterService';
import { floatingBubbleService } from '../services/floatingBubbleService';
import { updateService } from '../services/updateService';
import { hierarchyService } from '../services/hierarchyService';
import { authService } from '../services/authService';
import type { ApiTestResult } from '../services/authService';
import { networkMonitorService } from '../services/networkMonitorService';
// W8-C (doc 27 Đợt 6 leftover) — keep-alive toggle + battery-optimization exemption row.
import { backgroundReliability } from '../services/backgroundReliability';
import type { NetworkMethodResult } from '../types';
import { isValidBrokerAddress, isValidPort } from '../utils/helpers';

import { MqttProtocol, AlertSeverity } from '../types';
import type { CanvasImageMode } from '../types';

// Default topics theo format hệ thống MES
const DEFAULT_TOPICS = [
  'avi/+/workshop/+/station/+/errors',
  'avi/+/workshop/+/station/+/alerts',
  'avi/+/workshop/+/station/+/status',
  'avi-aoi/#',
];

// Preset broker configurations for AVI-AOI system
// ═══════════════════════════════════════════════════════════════
// LOCAL: Aedes MQTT Broker (Development)
// ONLINE: Mosquitto / HiveMQ / EMQX (Production)
// ═══════════════════════════════════════════════════════════════
const BROKER_PRESETS = {
  // ══════════════ LOCAL - AEDES (Development) ══════════════
  aedes_local_ws: {
    name: '🖥️ Aedes Local (WS)',
    brokerAddress: 'localhost',
    port: 8083,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: '⭐ Dev - Aedes broker trên máy local',
  },
  aedes_lan_ws: {
    name: '🌐 Aedes LAN (WS)',
    brokerAddress: '192.168.1.100', // Đổi IP máy chạy Aedes
    port: 8083,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: '⭐ Dev - Thiết bị kết nối qua LAN',
  },
  aedes_emulator_ws: {
    name: '📱 Aedes Emulator (WS)',
    brokerAddress: '10.0.2.2',
    port: 8083,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: 'Dev - Android Emulator → Host',
  },
  aedes_local_tcp: {
    name: '🖥️ Aedes Local (TCP)',
    brokerAddress: 'localhost',
    port: 1883,
    protocol: 'tcp' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: 'Dev - TCP cho thiết bị thật',
  },
  aedes_lan_tcp: {
    name: '🌐 Aedes LAN (TCP)',
    brokerAddress: '192.168.1.100',
    port: 1883,
    protocol: 'tcp' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: 'Dev - TCP qua LAN',
  },
  // ══════════════ ONLINE - MOSQUITTO (Production) ══════════════
  mosquitto_ws: {
    name: '🦟 Mosquitto Server (WS)',
    brokerAddress: '172.16.1.33', // Đổi IP Mosquitto server
    port: 8083,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: '🏭 Production - Mosquitto WebSocket',
  },
  mosquitto_tcp: {
    name: '🦟 Mosquitto Server (TCP)',
    brokerAddress: '172.16.1.33',
    port: 1883,
    protocol: 'tcp' as MqttProtocol,
    useSSL: false,
    topics: DEFAULT_TOPICS,
    description: '🏭 Production - Mosquitto TCP',
  },
  mosquitto_secure: {
    name: '🔒 Mosquitto Secure (WSS)',
    brokerAddress: 'mqtt.example.com',
    port: 8084,
    protocol: 'websocket' as MqttProtocol,
    useSSL: true,
    topics: DEFAULT_TOPICS,
    description: '🏭 Production - Mosquitto SSL/TLS',
  },
  // ══════════════ PUBLIC BROKERS (Testing) ══════════════
  hivemq_public: {
    name: '🐝 HiveMQ Public',
    brokerAddress: 'broker.hivemq.com',
    port: 8000,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: ['avi-aoi/#'],
    description: '🧪 Test - Free public broker',
  },
  emqx_public: {
    name: '☁️ EMQX Public',
    brokerAddress: 'broker.emqx.io',
    port: 8083,
    protocol: 'websocket' as MqttProtocol,
    useSSL: false,
    topics: ['avi-aoi/#'],
    description: '🧪 Test - Free public broker',
  },
};

const SettingsScreen: React.FC = () => {
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 600;
  const isLandscape = screenWidth > 800;

  const { theme, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const settings = useSettingsStore(selectSettings);
  const updateMqttConfig = useSettingsStore((state) => state.updateMqttConfig);
  const updateNotificationConfig = useSettingsStore((state) => state.updateNotificationConfig);
  const updateAppSettings = useSettingsStore((state) => state.updateAppSettings);
  const updateNetworkMonitorConfig = useSettingsStore((state) => state.updateNetworkMonitorConfig);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);

  const clearAllAlerts = useAlertStore((state) => state.clearAll);
  const connectionStatus = useConnectionStore(selectConnectionStatus);

  const [isTesting, setIsTesting] = useState(false);
  const [newStationCode, setNewStationCode] = useState('');
  const [showBrokerPresets, setShowBrokerPresets] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const [updateServerUrl, setUpdateServerUrl] = useState(settings.app.updateServerUrl || '');

  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(settings.app.apiBaseUrl || '');
  const [apiKeyInput, setApiKeyInput] = useState(settings.app.apiKey || '');
  const [apiUsernameInput, setApiUsernameInput] = useState(settings.app.apiUsername || '');
  const [apiPasswordInput, setApiPasswordInput] = useState(settings.app.apiPassword || '');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginStatus, setLoginStatus] = useState<string>('');
  const [useCustomApiIp, setUseCustomApiIp] = useState(settings.app.useCustomApiIp === true);
  const [useCustomUpdateIp, setUseCustomUpdateIp] = useState(settings.app.useCustomUpdateIp === true);
  const [pendingUpdate, setPendingUpdate] = useState<any>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugResults, setDebugResults] = useState<ApiTestResult[]>([]);
  const [isDebugRunning, setIsDebugRunning] = useState(false);
  // Network diagnostics state
  const [isNetworkTesting, setIsNetworkTesting] = useState(false);
  const [showNetworkPanel, setShowNetworkPanel] = useState(false);
  const [networkMethodResults, setNetworkMethodResults] = useState<NetworkMethodResult[]>([]);
  const [networkOverallScore, setNetworkOverallScore] = useState<{ score: number; status: 'good' | 'fair' | 'poor' | 'failed' } | null>(null);
  const [networkResults, setNetworkResults] = useState<{
    mqtt: { latencies: number[]; success: number; failed: number; avg: number; min: number; max: number; jitter: number } | null;
    http: { latencies: number[]; success: number; failed: number; avg: number; min: number; max: number; jitter: number } | null;
    overall: 'good' | 'fair' | 'poor' | 'failed' | null;
    stable: boolean | null;
  }>({ mqtt: null, http: null, overall: null, stable: null });
  // Subscription mode & hierarchy selection — read from persisted store
  const subscriptionMode = settings.app.subscriptionMode || 'hierarchy';
  const hierarchySelectedKeys = settings.app.hierarchySelectedKeys || [];

  const language = settings.app.language;
  const t = TRANSLATIONS[language];

  // ── W8-C: background keep-alive + battery-optimization exemption ──────────
  // Helpers live in backgroundReliability (W6-B exported them for exactly this
  // Settings slot). null = still checking (never a fabricated status).
  const [keepAliveEnabled, setKeepAliveEnabledState] = useState<boolean>(
    backgroundReliability.isKeepAliveEnabled(),
  );
  const [batteryOptimized, setBatteryOptimized] = useState<boolean | null>(null);

  const refreshBatteryStatus = useCallback(() => {
    backgroundReliability
      .isBatteryOptimizationEnabled()
      .then((enabled) => setBatteryOptimized(enabled))
      .catch(() => setBatteryOptimized(null));
  }, []);

  useEffect(() => {
    backgroundReliability
      .loadKeepAlivePreference()
      .then((v) => setKeepAliveEnabledState(v))
      .catch(() => {});
    refreshBatteryStatus();
    // Re-check when the user returns from the system battery-settings screen.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshBatteryStatus();
    });
    return () => sub.remove();
  }, [refreshBatteryStatus]);

  const handleKeepAliveToggle = useCallback(async (value: boolean) => {
    setKeepAliveEnabledState(value);
    try {
      await backgroundReliability.setKeepAliveEnabled(value);
    } catch {
      // Preference persist failure — reflect the real in-memory state.
      setKeepAliveEnabledState(backgroundReliability.isKeepAliveEnabled());
    }
  }, []);

  const handleOpenBatterySettings = useCallback(async () => {
    const opened = await backgroundReliability.openBatteryOptimizationSettings();
    if (!opened) {
      Alert.alert(t.batteryOptTitle, t.batteryOptOpenFailed);
    }
  }, [t]);


  // Responsive values
  const contentPadding = isTablet ? 20 : 12;
  const sectionSpacing = isTablet ? 16 : 10;
  const fontSize = {
    title: isTablet ? 22 : 18,
    sectionTitle: isTablet ? 17 : 14,
    normal: isTablet ? 15 : 13,
    small: isTablet ? 13 : 11,
  };
  const iconSize = isTablet ? 24 : 20;
  const severityGridColumns = isLandscape ? 5 : isTablet ? 4 : 3;

  // --- Auto MQTT Subscription khi thay đổi hierarchy selection ---
  const prevKeysRef = useRef<string>(JSON.stringify(hierarchySelectedKeys));
  useEffect(() => {
    const keysJson = JSON.stringify(hierarchySelectedKeys);
    // Chỉ chạy khi keys thực sự thay đổi (tránh loop vô hạn)
    if (keysJson === prevKeysRef.current) { return; }
    prevKeysRef.current = keysJson;

    if (subscriptionMode !== 'hierarchy' || hierarchySelectedKeys.length === 0) { return; }

    const topics = hierarchyService.getTopicsFromSelectionCached(hierarchySelectedKeys);
    if (topics.length === 0) { return; }

    console.log('[Settings] Auto-apply MQTT topics:', topics.length);
    updateMqttConfig({ topics });
  }, [hierarchySelectedKeys, subscriptionMode, updateMqttConfig]);
  
  // Get current app version
  const { version: currentVersion } = updateService.getCurrentVersion();

  // Check for pending update on mount and when autoUpdate changes
  useEffect(() => {
    updateService.getPendingUpdateInfo().then(info => setPendingUpdate(info));
    const unsub = updateService.addEventListener((event, data) => {
      if (event === 'check_done' && data?.hasUpdate) {
        updateService.getPendingUpdateInfo().then(info => setPendingUpdate(info));
      }
      if (event === 'download_complete') {
        setPendingUpdate(null);
      }
    });
    return unsub;
  }, [settings.app.autoUpdate]);
  
  // Get broker info
  const brokerInfo = mqttService.getBrokerInfo();

  // Helper: extract IP/hostname from broker address (strip protocol, port, path)
  const getBrokerIp = useCallback(() => {
    const broker = settings.mqtt.brokerAddress || '';
    // Remove protocol prefix if present
    const withoutProtocol = broker.replace(/^(wss?|mqtts?|tcp):\/\//, '');
    // Remove port and path
    const ip = withoutProtocol.split(':')[0].split('/')[0];
    return ip || '';
  }, [settings.mqtt.brokerAddress]);

  // Auto-derive API/Update URLs from MQTT broker when not using custom IP
  // Skip initial mount to avoid overwriting loaded saved settings
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const brokerIp = getBrokerIp();
    if (!brokerIp) return;

    if (!useCustomApiIp) {
      const autoApiUrl = `http://${brokerIp}:3000`;
      setApiBaseUrlInput(autoApiUrl);
      updateAppSettings({ apiBaseUrl: autoApiUrl });
    }
    if (!useCustomUpdateIp) {
      const autoUpdateUrl = `http://${brokerIp}:3000/api/factory-alert`;
      setUpdateServerUrl(autoUpdateUrl);
      updateService.setUpdateServerUrl(autoUpdateUrl);
      updateAppSettings({ updateServerUrl: autoUpdateUrl });
    }
  }, [settings.mqtt.brokerAddress, useCustomApiIp, useCustomUpdateIp, getBrokerIp, updateAppSettings]);

  // Protocol options
  const protocolOptions = [
    { value: 'websocket', label: 'WebSocket', sublabel: 'ws:// / wss://' },
    { value: 'tcp', label: 'TCP', sublabel: 'mqtt:// / mqtts://' },
  ];

  // MQTT handlers
  const handleBrokerChange = useCallback(
    (value: string) => {
      updateMqttConfig({ brokerAddress: value });
    },
    [updateMqttConfig]
  );

  const handleProtocolChange = useCallback(
    (value: MqttProtocol) => {
      // Auto-adjust port when switching protocol
      const newPort = value === 'tcp' 
        ? (settings.mqtt.useSSL ? 8883 : 1883)
        : (settings.mqtt.useSSL ? 8884 : 8883);
      updateMqttConfig({ protocol: value, port: newPort });
    },
    [updateMqttConfig, settings.mqtt.useSSL]
  );

  const handlePortChange = useCallback(
    (value: string) => {
      const port = parseInt(value, 10);
      if (!isNaN(port)) {
        updateMqttConfig({ port });
      }
    },
    [updateMqttConfig]
  );

  const handleUsernameChange = useCallback(
    (value: string) => {
      updateMqttConfig({ username: value });
    },
    [updateMqttConfig]
  );

  const handlePasswordChange = useCallback(
    (value: string) => {
      updateMqttConfig({ password: value });
    },
    [updateMqttConfig]
  );

  const handleSSLToggle = useCallback(
    (value: boolean) => {
      updateMqttConfig({ useSSL: value });
    },
    [updateMqttConfig]
  );

  const handleSelectBrokerPreset = useCallback(
    (presetKey: keyof typeof BROKER_PRESETS) => {
      const preset = BROKER_PRESETS[presetKey];
      updateMqttConfig({
        brokerAddress: preset.brokerAddress,
        port: preset.port,
        protocol: preset.protocol,
        useSSL: preset.useSSL,
        topics: preset.topics,
      });
      setShowBrokerPresets(false);
      Alert.alert(
        language === 'vi' ? 'Đã áp dụng' : language === 'zh' ? '已应用' : 'Applied',
        language === 'vi' 
          ? `${preset.name}\n\n${preset.description}\n\nTopics: ${preset.topics.length} topic(s)\n\nNhớ nhập Username/Password nếu cần.`
          : language === 'zh'
          ? `${preset.name}\n\n${preset.description}\n\nTopics: ${preset.topics.length} topic(s)\n\n如需要请输入用户名/密码。`
          : `${preset.name}\n\n${preset.description}\n\nTopics: ${preset.topics.length} topic(s)\n\nRemember to enter Username/Password if required.`
      );
    },
    [updateMqttConfig, language]
  );

  const handleTestConnection = useCallback(async () => {
    // Validate
    if (!isValidBrokerAddress(settings.mqtt.brokerAddress)) {
      Alert.alert(t.connectionError, t.invalidBrokerAddress);
      return;
    }

    if (!isValidPort(settings.mqtt.port)) {
      Alert.alert(t.connectionError, t.invalidPort);
      return;
    }

    setIsTesting(true);

    try {
      mqttService.configure(settings.mqtt);
      
      // Check circuit breaker status first
      const cbStatus = mqttService.getCircuitBreakerStatus();
      console.log('[Settings] Circuit breaker status before test:', cbStatus);
      
      if (cbStatus.isOpen) {
        const remainingTime = Math.ceil(cbStatus.remainingTimeMs / 1000);
        Alert.alert(
          t.connectionError,
          `Circuit Breaker đang mở!\n\nThử lại sau ${remainingTime} giây hoặc reset Circuit Breaker.\n\nLỗi liên tiếp: ${cbStatus.consecutiveFailures}`,
          [
            { text: 'OK', style: 'cancel' },
            { 
              text: 'Reset Circuit Breaker', 
              onPress: async () => {
                mqttService.resetCircuitBreakerManually();
                Alert.alert('Thành công', 'Circuit Breaker đã được reset. Có thể thử kết nối lại.');
              }
            },
            {
              text: 'Test Legacy Method',
              onPress: async () => {
                try {
                  // Use legacy testConnection method (bypasses circuit breaker but less reliable)
                  console.log('[Settings] Using legacy testConnection() method (bypasses circuit breaker)...');
                  const startTime = Date.now();
                  const success = await mqttService.testConnection();
                  const duration = Date.now() - startTime;
                  
                  if (success) {
                    Alert.alert(t.connected, `${t.connectionSuccess}\n\nServer: ${settings.mqtt.brokerAddress}:${settings.mqtt.port}\nProtocol: ${settings.mqtt.protocol.toUpperCase()}\nTime: ${duration}ms\nMethod: Legacy testConnection() (Direct mqtt.connect)\n\nNote: Bypassed circuit breaker but this method is less reliable`);
                  } else {
                    Alert.alert(t.connectionError, `${t.connectionFailed}\n\nTime: ${duration}ms\nMethod: Legacy testConnection() (Direct mqtt.connect)\n\nLegacy method failed despite bypassing circuit breaker`);
                  }
                } catch (error) {
                  Alert.alert(t.connectionError, `Legacy test failed: ${(error as Error).message}`);
                } finally {
                  setIsTesting(false);
                }
              }
            }
          ]
        );
        return;
      }
      
      // Use main connect method (giống kết nối chính của app)
      // và GIỮ kết nối sau khi test thành công để app sử dụng
      console.log('[Settings] Using main connect() method (Custom TCP wrapper) for persistent connection...');
      const startTime = Date.now();
      
      try {
        await mqttService.connect();
        const duration = Date.now() - startTime;
        
        Alert.alert(
          t.connected, 
          `${t.connectionSuccess}\n\nServer: ${settings.mqtt.brokerAddress}:${settings.mqtt.port}\nProtocol: ${settings.mqtt.protocol.toUpperCase()}\nTime: ${duration}ms\nMethod: Main connect() (Custom TCP wrapper)\n\nLưu ý: Kết nối này sẽ được giữ để app sử dụng\nCircuit Breaker: ${cbStatus.consecutiveFailures} lỗi liên tiếp`
        );
      } catch (connectError) {
        const duration = Date.now() - startTime;
        Alert.alert(
          t.connectionError, 
          `${t.connectionFailed}\n\nServer: ${settings.mqtt.brokerAddress}:${settings.mqtt.port}\nProtocol: ${settings.mqtt.protocol.toUpperCase()}\nTime: ${duration}ms\nMethod: Main connect() (Custom TCP wrapper)\nError: ${(connectError as Error).message}\n\nVui lòng kiểm tra:\n• MQTT broker đang chạy\n• Địa chỉ IP chính xác\n• Cổng đúng (${settings.mqtt.port})\n• Username/Password nếu cần`
        );
        throw connectError; // Re-throw to trigger outer catch
      }
    } catch (error) {
      Alert.alert(
        t.connectionError, 
        `${(error as Error).message}\n\nConfig: ${settings.mqtt.brokerAddress}:${settings.mqtt.port} (${settings.mqtt.protocol})`
      );
    } finally {
      setIsTesting(false);
    }
  }, [settings.mqtt, t]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      language === 'vi' ? 'Ngắt kết nối' : language === 'zh' ? '断开' : 'Disconnect',
      language === 'vi'
        ? 'Bạn có chắc muốn NGẮT kết nối MQTT hiện tại?'
        : language === 'zh'
        ? '确定要断开当前MQTT连接吗？'
        : 'Are you sure you want to DISCONNECT the current MQTT connection?',
      [
        { text: language === 'vi' ? 'Hủy' : language === 'zh' ? '取消' : 'Cancel', style: 'cancel' },
        {
          text: language === 'vi' ? 'Ngắt kết nối' : language === 'zh' ? '断开' : 'Disconnect',
          style: 'destructive',
          onPress: () => {
            console.log('[Settings] Manual MQTT disconnect requested from Settings screen');
            mqttService.disconnect();
          },
        },
      ]
    );
  }, [language]);

  // Notification handlers
  const handleNotificationsToggle = useCallback(
    (value: boolean) => {
      updateNotificationConfig({ enabled: value });
      notificationService.configure({ enabled: value });
    },
    [updateNotificationConfig]
  );

  const handleSoundToggle = useCallback(
    (value: boolean) => {
      updateNotificationConfig({ sound: value });
      notificationService.configure({ sound: value });
    },
    [updateNotificationConfig]
  );

  const handleVibrationToggle = useCallback(
    (value: boolean) => {
      updateNotificationConfig({ vibration: value });
      notificationService.configure({ vibration: value });
    },
    [updateNotificationConfig]
  );

  const handleQuietHoursToggle = useCallback(
    (value: boolean) => {
      updateNotificationConfig({ quietHoursEnabled: value });
    },
    [updateNotificationConfig]
  );

  // Station Filter handlers
  const handleStationFilterToggle = useCallback(
    (value: boolean) => {
      updateNotificationConfig({ stationFilterEnabled: value });
    },
    [updateNotificationConfig]
  );

  // Severity Filter handlers
  const handleSeverityToggle = useCallback((severity: AlertSeverity) => {
    const currentFilter = settings.notifications.severityFilter || [];
    let newFilter: AlertSeverity[];
    
    if (currentFilter.includes(severity)) {
      // Remove severity
      newFilter = currentFilter.filter(s => s !== severity);
    } else {
      // Add severity
      newFilter = [...currentFilter, severity];
    }
    
    updateNotificationConfig({ severityFilter: newFilter });
    notificationService.configure({ severityFilter: newFilter });
  }, [settings.notifications.severityFilter, updateNotificationConfig]);

  const handleSelectAllSeverities = useCallback(() => {
    const allSeverities: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    updateNotificationConfig({ severityFilter: allSeverities });
    notificationService.configure({ severityFilter: allSeverities });
  }, [updateNotificationConfig]);

  const handleDeselectAllSeverities = useCallback(() => {
    updateNotificationConfig({ severityFilter: [] });
    notificationService.configure({ severityFilter: [] });
  }, [updateNotificationConfig]);

  const handleAddStation = useCallback(() => {
    const code = newStationCode.trim().toUpperCase();
    
    if (!alertFilterService.isValidStationCode(code)) {
      Alert.alert(
        language === 'vi' ? 'Mã không hợp lệ' : language === 'zh' ? '无效代码' : 'Invalid Code',
        language === 'vi' 
          ? 'Mã công trạm phải có ít nhất 2 ký tự và chỉ chứa chữ, số, dấu gạch ngang'
          : language === 'zh'
          ? '工站代码至少2个字符，只能包含字母、数字、连字符'
          : 'Station code must be at least 2 characters and contain only letters, numbers, hyphens'
      );
      return;
    }

    const currentFilters = settings.notifications.stationFilters || [];
    
    if (currentFilters.includes(code)) {
      Alert.alert(
        language === 'vi' ? 'Đã tồn tại' : language === 'zh' ? '已存在' : 'Already exists',
        language === 'vi' 
          ? `Mã "${code}" đã có trong danh sách`
          : language === 'zh'
          ? `代码 "${code}" 已在列表中`
          : `Code "${code}" is already in the list`
      );
      return;
    }

    updateNotificationConfig({ 
      stationFilters: [...currentFilters, code] 
    });
    setNewStationCode('');
  }, [newStationCode, settings.notifications.stationFilters, updateNotificationConfig, language]);

  const handleRemoveStation = useCallback((code: string) => {
    const currentFilters = settings.notifications.stationFilters || [];
    updateNotificationConfig({ 
      stationFilters: currentFilters.filter(c => c !== code) 
    });
  }, [settings.notifications.stationFilters, updateNotificationConfig]);

  // Floating Bubble handler
  const handleFloatingBubbleToggle = useCallback(
    async (value: boolean) => {
      if (value) {
        const hasPermission = await floatingBubbleService.checkPermission();
        if (!hasPermission) {
          const granted = await floatingBubbleService.requestPermission();
          if (!granted) {
            Alert.alert(
              language === 'vi' ? 'Cần cấp quyền' : language === 'zh' ? '需要权限' : 'Permission needed',
              language === 'vi'
                ? 'Vui lòng cấp quyền "Hiển thị trên ứng dụng khác" trong Cài đặt'
                : language === 'zh'
                ? '请在设置中授予"显示在其他应用上方"权限'
                : 'Please grant "Display over other apps" permission in Settings'
            );
            return;
          }
        }
      }
      updateNotificationConfig({ floatingBubbleEnabled: value });
    },
    [updateNotificationConfig, language]
  );

  // Panel section toggle handler
  const handlePanelSectionToggle = useCallback(
    (section: keyof import('../types').FloatingPanelSections, value: boolean) => {
      const current = settings.notifications.floatingPanelSections || {
        statistics: true, trend: true, defects: true, captures: true, measurements: true, events: true,
      };
      updateNotificationConfig({
        floatingPanelSections: { ...current, [section]: value },
      });
    },
    [settings.notifications.floatingPanelSections, updateNotificationConfig]
  );

  // App settings handlers
  const handleLanguageToggle = useCallback(() => {
    const newLanguage = language === 'vi' ? 'en' : language === 'en' ? 'zh' : 'vi';
    updateAppSettings({ language: newLanguage });
  }, [language, updateAppSettings]);

  const handleAutoReconnectToggle = useCallback(
    (value: boolean) => {
      updateAppSettings({ autoReconnect: value });
    },
    [updateAppSettings]
  );

  const handleHealthCheckIntervalChange = useCallback(
    (seconds: number) => {
      const ms = Math.max(5, Math.min(60, seconds)) * 1000;
      updateAppSettings({ mqttHealthCheckInterval: ms });
      mqttService.updateHealthCheckSettings({ healthCheckInterval: ms });
    },
    [updateAppSettings]
  );

  const handleRetryMaxAttemptsChange = useCallback(
    (value: number) => {
      const clamped = Math.max(1, Math.min(20, value));
      updateAppSettings({ mqttRetryMaxAttempts: clamped });
      mqttService.updateHealthCheckSettings({ retryMaxAttempts: clamped });
    },
    [updateAppSettings]
  );

  const handleRetryIntervalChange = useCallback(
    (seconds: number) => {
      const ms = Math.max(3, Math.min(60, seconds)) * 1000;
      updateAppSettings({ mqttRetryInterval: ms });
      mqttService.updateHealthCheckSettings({ retryInterval: ms });
    },
    [updateAppSettings]
  );

  const handleKeepScreenOnToggle = useCallback(
    (value: boolean) => {
      updateAppSettings({ keepScreenOn: value });
    },
    [updateAppSettings]
  );

  const handleProactivePollingToggle = useCallback(
    (value: boolean) => {
      updateAppSettings({ proactivePollingEnabled: value });
    },
    [updateAppSettings]
  );

  const handleNgFlashDurationChange = useCallback(
    (seconds: number) => {
      updateAppSettings({ ngFlashDurationMs: Math.max(1, seconds) * 1000 });
    },
    [updateAppSettings]
  );

  const handleNgBubbleDismissChange = useCallback(
    (seconds: number) => {
      updateAppSettings({ ngBubbleDismissSec: Math.max(0, seconds) });
    },
    [updateAppSettings]
  );

  const handleNgExplosionDismissChange = useCallback(
    (seconds: number) => {
      updateAppSettings({ ngExplosionDismissSec: Math.max(1, seconds) });
    },
    [updateAppSettings]
  );

  const handleAlertAnimToggle = useCallback(
    (value: boolean) => {
      updateAppSettings({ alertAnimationEnabled: value });
    },
    [updateAppSettings]
  );

  const handleAlertAnimTypeChange = useCallback(() => {
    const types: Array<'bomb' | 'alarm' | 'triangle'> = ['bomb', 'alarm', 'triangle'];
    const current = settings.app.alertAnimationType || 'bomb';
    const idx = types.indexOf(current);
    const next = types[(idx + 1) % types.length];
    updateAppSettings({ alertAnimationType: next });
  }, [settings.app.alertAnimationType, updateAppSettings]);

  const handleAlertAnimDurationChange = useCallback(() => {
    const options = [1, 2, 3, 4, 5];
    const current = settings.app.alertAnimationDurationSec || 3;
    const idx = options.indexOf(current);
    const next = options[(idx + 1) % options.length];
    updateAppSettings({ alertAnimationDurationSec: next });
  }, [settings.app.alertAnimationDurationSec, updateAppSettings]);

  // Data management handlers
  const handleClearAllAlerts = useCallback(() => {
    Alert.alert(
      language === 'vi' ? 'Xác nhận' : language === 'zh' ? '确认' : 'Confirm',
      t.confirmClearAll,
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.yes,
          style: 'destructive',
          onPress: () => {
            clearAllAlerts();
            Alert.alert('', t.allAlertsCleared);
          },
        },
      ]
    );
  }, [clearAllAlerts, t, language]);

  const handleResetToDefaults = useCallback(() => {
    Alert.alert(
      language === 'vi' ? 'Xác nhận' : language === 'zh' ? '确认' : 'Confirm',
      t.confirmReset,
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.yes,
          style: 'destructive',
          onPress: () => {
            resetToDefaults();
            Alert.alert('', t.settingsSaved);
          },
        },
      ]
    );
  }, [resetToDefaults, t, language]);

  // API Server URL handler
  const handleApiBaseUrlChange = useCallback((url: string) => {
    setApiBaseUrlInput(url);
    updateAppSettings({ apiBaseUrl: url });
  }, [updateAppSettings]);

  // Toggle custom API IP
  const handleCustomApiIpToggle = useCallback((enabled: boolean) => {
    setUseCustomApiIp(enabled);
    updateAppSettings({ useCustomApiIp: enabled });
    if (!enabled) {
      const brokerIp = getBrokerIp();
      if (brokerIp) {
        const autoUrl = `http://${brokerIp}:3000`;
        setApiBaseUrlInput(autoUrl);
        updateAppSettings({ apiBaseUrl: autoUrl, useCustomApiIp: false });
      }
    }
  }, [updateAppSettings, getBrokerIp]);

  // Toggle custom Update Server IP
  const handleCustomUpdateIpToggle = useCallback((enabled: boolean) => {
    setUseCustomUpdateIp(enabled);
    updateAppSettings({ useCustomUpdateIp: enabled });
    if (!enabled) {
      const brokerIp = getBrokerIp();
      if (brokerIp) {
        const autoUrl = `http://${brokerIp}:3000/api/factory-alert`;
        setUpdateServerUrl(autoUrl);
        updateService.setUpdateServerUrl(autoUrl);
        updateAppSettings({ updateServerUrl: autoUrl, useCustomUpdateIp: false });
      }
    }
  }, [updateAppSettings, getBrokerIp]);

  // API Key handler
  const handleApiKeyChange = useCallback((key: string) => {
    setApiKeyInput(key);
    updateAppSettings({ apiKey: key });
  }, [updateAppSettings]);

  // API Username handler
  const handleApiUsernameChange = useCallback((val: string) => {
    setApiUsernameInput(val);
    updateAppSettings({ apiUsername: val });
  }, [updateAppSettings]);

  // API Password handler
  const handleApiPasswordChange = useCallback((val: string) => {
    setApiPasswordInput(val);
    updateAppSettings({ apiPassword: val });
  }, [updateAppSettings]);

  // Login handler
  const handleLogin = useCallback(async () => {
    const baseUrl = settings.app.apiBaseUrl;
    if (!baseUrl || !apiUsernameInput || !apiPasswordInput) {
      Alert.alert(
        t.apiLoginFailed,
        language === 'vi' ? 'Vui lòng nhập đầy đủ URL, username và password' : language === 'zh' ? '请输入完整的URL、用户名和密码' : 'Please enter URL, username and password',
      );
      return;
    }

    setIsLoggingIn(true);
    setLoginStatus('');
    try {
      const result = await authService.login(baseUrl, apiUsernameInput, apiPasswordInput, settings.app.apiKey);
      if (result.success) {
        setLoginStatus(t.apiLoginSuccess);
        Alert.alert(t.apiLoginSuccess, result.message);
      } else {
        setLoginStatus(`${t.apiLoginFailed}: ${result.message}`);
        Alert.alert(t.apiLoginFailed, result.message);
      }
    } catch (error: any) {
      setLoginStatus(`Error: ${error.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  }, [settings.app.apiBaseUrl, settings.app.apiKey, apiUsernameInput, apiPasswordInput, t, language]);

  // Logout handler
  const handleLogout = useCallback(async () => {
    await authService.logout();
    setLoginStatus(t.apiNotLoggedIn);
  }, [t]);

  // Debug test handler
  const handleDebugTest = useCallback(async () => {
    setIsDebugRunning(true);
    setDebugResults([]);
    try {
      const results = await authService.testConnection(
        settings.app.apiBaseUrl,
        settings.app.apiKey,
      );
      setDebugResults(results);
    } catch (error: any) {
      setDebugResults([{
        step: 'Error',
        success: false,
        message: error.message,
        duration: 0,
      }]);
    } finally {
      setIsDebugRunning(false);
    }
  }, [settings.app.apiBaseUrl, settings.app.apiKey]);

  // Network diagnostics handler (uses networkMonitorService with all enabled methods)
  const handleNetworkDiagnostics = useCallback(async () => {
    setIsNetworkTesting(true);
    setShowNetworkPanel(true);
    setNetworkMethodResults([]);
    setNetworkOverallScore(null);
    setNetworkResults({ mqtt: null, http: null, overall: null, stable: null });

    const PING_COUNT = settings.networkMonitor.pingCount || 5;

    // Helper: calculate stats
    const calcStats = (latencies: number[], failCount: number) => {
      if (latencies.length === 0) {
        return { latencies: [], success: 0, failed: failCount, avg: 0, min: 0, max: 0, jitter: 0 };
      }
      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const min = Math.round(Math.min(...latencies));
      const max = Math.round(Math.max(...latencies));
      const jitter = latencies.length > 1
        ? Math.round(latencies.reduce((sum, l) => sum + Math.abs(l - avg), 0) / latencies.length)
        : 0;
      return { latencies, success: latencies.length, failed: failCount, avg, min, max, jitter };
    };

    try {
      // Run all enabled network monitor methods
      networkMonitorService.updateConfig(settings.networkMonitor);
      const methodResults = await networkMonitorService.runAllMethods();
      setNetworkMethodResults(methodResults);
      const overall = networkMonitorService.calculateOverallScore(methodResults);
      setNetworkOverallScore(overall);

      // Also run legacy MQTT + HTTP tests for backward compatibility
      const mqttLatencies: number[] = [];
      let mqttFailed = 0;
      for (let i = 0; i < PING_COUNT; i++) {
        try {
          const start = Date.now();
          const result = await mqttService.testConnection();
          const elapsed = Date.now() - start;
          if (result) mqttLatencies.push(elapsed);
          else mqttFailed++;
        } catch { mqttFailed++; }
      }
      const mqttStats = calcStats(mqttLatencies, mqttFailed);

      const httpLatencies: number[] = [];
      let httpFailed = 0;
      const apiUrl = settings.app.apiBaseUrl || '';
      for (let i = 0; i < PING_COUNT; i++) {
        try {
          const start = Date.now();
          // AbortSignal.timeout is unavailable in this RN/TS lib — use AbortController
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(`${apiUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
          }).finally(() => clearTimeout(timeoutId));
          const elapsed = Date.now() - start;
          if (response.ok || response.status === 401 || response.status === 404) httpLatencies.push(elapsed);
          else httpFailed++;
        } catch { httpFailed++; }
      }
      const httpStats = calcStats(httpLatencies, httpFailed);

      const totalSuccess = mqttStats.success + httpStats.success;
      const totalTests = PING_COUNT * 2;
      const avgLatency = totalSuccess > 0
        ? Math.round((mqttStats.avg * mqttStats.success + httpStats.avg * httpStats.success) / totalSuccess)
        : 0;
      const maxJitter = Math.max(mqttStats.jitter, httpStats.jitter);
      const packetLossRate = (totalTests - totalSuccess) / totalTests;

      let legacyOverall: 'good' | 'fair' | 'poor' | 'failed';
      if (totalSuccess === 0) legacyOverall = 'failed';
      else if (avgLatency < 200 && maxJitter < 100 && packetLossRate < 0.1) legacyOverall = 'good';
      else if (avgLatency < 500 && maxJitter < 200 && packetLossRate < 0.3) legacyOverall = 'fair';
      else legacyOverall = 'poor';

      setNetworkResults({
        mqtt: mqttStats,
        http: httpStats,
        overall: legacyOverall,
        stable: packetLossRate < 0.2 && maxJitter < 150,
      });
    } catch (error: any) {
      console.error('[Settings] Network diagnostics error:', error);
      setNetworkResults({ mqtt: null, http: null, overall: 'failed', stable: false });
    } finally {
      setIsNetworkTesting(false);
    }
  }, [settings.app.apiBaseUrl, settings.app.apiKey, settings.networkMonitor]);

  // Update server URL handler
  const handleUpdateServerUrlChange = useCallback((url: string) => {
    setUpdateServerUrl(url);
    updateService.setUpdateServerUrl(url);
    updateAppSettings({ updateServerUrl: url });
  }, [updateAppSettings]);

  // AutoUpdate toggle handler
  const handleAutoUpdateToggle = useCallback((enabled: boolean) => {
    updateAppSettings({ autoUpdate: enabled });
  }, [updateAppSettings]);

  // Manual update button handler (when autoUpdate is OFF)
  const handleManualUpdate = useCallback(() => {
    updateService.showPendingUpdateDialog(language);
  }, [language]);

  const connectionStatusConfig = CONNECTION_STATUS_CONFIG[connectionStatus];
  const stationFilters = settings.notifications.stationFilters || [];
  const stationsMap = useStationInspectionStore((s) => s.stations);

  // Dynamic styles for responsive
  const dynamicStyles = {
    contentContainer: {
      padding: contentPadding,
    },
    header: {
      paddingVertical: isTablet ? 16 : 12,
    },
    headerTitle: {
      fontSize: fontSize.title,
    },
    sectionTitle: {
      fontSize: fontSize.sectionTitle,
    },
    settingLabel: {
      fontSize: fontSize.normal,
    },
    settingDescription: {
      fontSize: fontSize.small,
    },
    severityGrid: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: isTablet ? 10 : 6,
    },
    severityItem: {
      width: `${Math.floor(100 / severityGridColumns) - 2}%` as const,
      paddingVertical: isTablet ? 12 : 8,
      paddingHorizontal: isTablet ? 14 : 10,
    },
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.background} />

      {/* Header */}
      <View style={[styles.header, dynamicStyles.header, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={[styles.headerTitle, dynamicStyles.headerTitle]}>{t.settings}</Text>
        <TouchableOpacity
          style={[
            styles.saveButton,
            { marginTop: 0, paddingVertical: 8, paddingHorizontal: 16 },
            isSaving && { opacity: 0.7 },
            saveSuccess && { backgroundColor: theme.colors.success },
          ]}
          onPress={async () => {
            setIsSaving(true);
            setSaveSuccess(false);
            try {
              await saveSettings();
              setSaveSuccess(true);
              setTimeout(() => setSaveSuccess(false), 2000);
              Alert.alert(
                language === 'vi' ? 'Thành công' : language === 'zh' ? '成功' : 'Success',
                language === 'vi' ? 'Đã lưu toàn bộ cài đặt thành công!' : language === 'zh' ? '所有设置保存成功！' : 'All settings saved successfully!',
              );
            } catch (err) {
              Alert.alert(
                language === 'vi' ? 'Lỗi' : language === 'zh' ? '错误' : 'Error',
                language === 'vi' ? 'Không thể lưu cài đặt' : language === 'zh' ? '无法保存设置' : 'Failed to save settings',
              );
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={isSaving}
        >
          <Icon
            name={saveSuccess ? 'check-circle' : 'content-save'}
            size={18}
            color="#FFFFFF"
          />
          <Text style={[styles.saveButtonText, { fontSize: theme.fontSize.sm }]}>
            {isSaving
              ? (language === 'vi' ? 'Đang lưu...' : language === 'zh' ? '保存中...' : 'Saving...')
              : saveSuccess
                ? (language === 'vi' ? 'Đã lưu!' : language === 'zh' ? '已保存！' : 'Saved!')
                : (language === 'vi' ? 'Lưu cài đặt' : language === 'zh' ? '保存设置' : 'Save')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, dynamicStyles.contentContainer]}
        showsVerticalScrollIndicator={false}
      >
        {/* Connection Status */}
        <View style={[styles.connectionStatus, { padding: isTablet ? 14 : 10, marginBottom: isTablet ? 20 : 12 }]}>
          <View
            style={[
              styles.connectionDot,
              { backgroundColor: connectionStatusConfig.color, width: isTablet ? 12 : 10, height: isTablet ? 12 : 10 },
            ]}
          />
          <Icon
            name={connectionStatusConfig.icon}
            size={iconSize}
            color={connectionStatusConfig.color}
          />
          <Text style={[styles.connectionText, { color: connectionStatusConfig.color, fontSize: fontSize.normal }]}>
            {language === 'vi' ? connectionStatusConfig.label : language === 'zh' ? (connectionStatusConfig.labelZh || connectionStatusConfig.labelEn) : connectionStatusConfig.labelEn}
          </Text>
        </View>

        {/* MQTT Settings */}
        <SettingSection title={t.mqttSettings}>
          {/* Broker Type Indicator */}
          <View style={styles.brokerTypeContainer}>
            <View style={styles.brokerTypeRow}>
              <Icon name="server" size={20} color={theme.colors.primary} />
              <Text style={styles.brokerTypeLabel}>
                {language === 'vi' ? 'Loại Broker:' : language === 'zh' ? 'Broker类型:' : 'Broker Type:'}
              </Text>
              <View style={styles.brokerTypeBadge}>
                <Text style={styles.brokerTypeBadgeText}>
                  {brokerInfo.type.toUpperCase()}
                </Text>
              </View>
              <View style={[styles.brokerTypeBadge, { backgroundColor: theme.colors.info + '20', marginLeft: 4 }]}>
                <Text style={[styles.brokerTypeBadgeText, { color: theme.colors.info }]}>
                  {brokerInfo.protocol}
                </Text>
              </View>
            </View>
            <Text style={styles.brokerUrlText} numberOfLines={1}>
              {brokerInfo.url}
            </Text>
          </View>

          {/* Broker Presets */}
          <TouchableOpacity
            style={styles.presetButton}
            onPress={() => setShowBrokerPresets(!showBrokerPresets)}
          >
            <Icon name="lightning-bolt" size={20} color={theme.colors.warning} />
            <Text style={styles.presetButtonText}>
              {language === 'vi' ? 'Cấu hình nhanh' : language === 'zh' ? '快速设置' : 'Quick Setup'}
            </Text>
            <Icon 
              name={showBrokerPresets ? 'chevron-up' : 'chevron-down'} 
              size={20} 
              color={theme.colors.textSecondary} 
            />
          </TouchableOpacity>

          {showBrokerPresets && (
            <View style={styles.presetsContainer}>
              {Object.entries(BROKER_PRESETS).map(([key, preset]) => (
                <TouchableOpacity
                  key={key}
                  style={styles.presetItem}
                  onPress={() => handleSelectBrokerPreset(key as keyof typeof BROKER_PRESETS)}
                >
                  <View style={styles.presetItemContent}>
                    <Text style={styles.presetItemName}>{preset.name}</Text>
                    <Text style={styles.presetItemAddress}>
                      {preset.protocol === 'tcp' ? 'mqtt://' : 'ws://'}{preset.brokerAddress}:{preset.port} {preset.useSSL ? '🔒' : ''}
                    </Text>
                    <Text style={styles.presetItemDescription} numberOfLines={1}>
                      {preset.description}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t.brokerAddress}</Text>
            <TextInput
              style={styles.textInput}
              value={settings.mqtt.brokerAddress}
              onChangeText={handleBrokerChange}
              placeholder="broker.hivemq.com hoặc 192.168.1.100"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t.port}</Text>
            <TextInput
              style={styles.textInput}
              value={settings.mqtt.port.toString()}
              onChangeText={handlePortChange}
              placeholder="8884 (HiveMQ) / 8000 (Local)"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
            />
          </View>

          {/* Protocol Selection – compact */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {language === 'vi' ? 'Giao thức kết nối' : language === 'zh' ? '连接协议' : 'Connection Protocol'}
            </Text>
            <View style={styles.protocolSelector}>
              {protocolOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.protocolOptionCompact,
                    settings.mqtt.protocol === option.value && styles.protocolOptionActive,
                  ]}
                  onPress={() => handleProtocolChange(option.value as MqttProtocol)}
                >
                  <Text style={[
                    styles.protocolOptionText,
                    settings.mqtt.protocol === option.value && styles.protocolOptionTextActive,
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.inputHint}>
              {language === 'vi' 
                ? 'TCP (mqtt://) dùng cho kết nối trực tiếp. WebSocket (ws://) dùng cho kết nối qua trình duyệt.' 
                : 'TCP (mqtt://) for direct connection. WebSocket (ws://) for browser-compatible connection.'}
            </Text>
          </View>

          <SettingItem
            icon="shield-lock"
            title={t.useSSL}
            subtitle={
              settings.mqtt.protocol === 'tcp'
                ? (settings.mqtt.useSSL ? "mqtts:// (bảo mật)" : "mqtt:// (không mã hóa)")
                : (settings.mqtt.useSSL ? "wss:// (bảo mật)" : "ws:// (không mã hóa)")
            }
            type="switch"
            switchValue={settings.mqtt.useSSL}
            onSwitchChange={handleSSLToggle}
          />

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t.username}</Text>
            <TextInput
              style={styles.textInput}
              value={settings.mqtt.username}
              onChangeText={handleUsernameChange}
              placeholder={language === 'vi' ? 'Tùy chọn' : language === 'zh' ? '可选' : 'Optional'}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t.password}</Text>
            <TextInput
              style={styles.textInput}
              value={settings.mqtt.password}
              onChangeText={handlePasswordChange}
              placeholder={language === 'vi' ? 'Tùy chọn' : language === 'zh' ? '可选' : 'Optional'}
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Subscription Mode Toggle – compact */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t.mqttSubscriptionMode}</Text>
            <View style={styles.protocolSelector}>
              <TouchableOpacity
                style={[
                  styles.protocolOptionCompact,
                  subscriptionMode === 'hierarchy' && styles.protocolOptionActive,
                ]}
                onPress={() => updateAppSettings({ subscriptionMode: 'hierarchy' })}
              >
                <Text style={[
                  styles.protocolOptionText,
                  subscriptionMode === 'hierarchy' && styles.protocolOptionTextActive,
                ]}>
                  {t.mqttSubscriptionModeHierarchy}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.protocolOptionCompact,
                  subscriptionMode === 'manual' && styles.protocolOptionActive,
                ]}
                onPress={() => updateAppSettings({ subscriptionMode: 'manual' })}
              >
                <Text style={[
                  styles.protocolOptionText,
                  subscriptionMode === 'manual' && styles.protocolOptionTextActive,
                ]}>
                  {t.mqttSubscriptionModeManual}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Hierarchy Tree Selector (from API) */}
          {subscriptionMode === 'hierarchy' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>{t.mqttSubscriptions}</Text>
              <Text style={[styles.inputHint, { marginTop: 0, marginBottom: 8 }]}>
                {t.mqttSubscriptionsDescription}
              </Text>
              <HierarchyTreeSelector
                apiBaseUrl={settings.app.apiBaseUrl}
                apiKey={settings.app.apiKey}
                selectedKeys={hierarchySelectedKeys}
                onSelectionChange={(keys: string[]) => updateAppSettings({ hierarchySelectedKeys: keys })}
                language={language}
              />
              {hierarchySelectedKeys.length > 0 && (
                <TouchableOpacity
                  style={styles.applySubscriptionButton}
                  onPress={() => {
                    const topics = hierarchyService.getTopicsFromSelectionCached(
                      hierarchySelectedKeys,
                    );
                    if (topics.length === 0) {
                      Alert.alert(t.mqttNoSelection, t.mqttNoSelectionHint);
                      return;
                    }
                    updateMqttConfig({ topics });
                    Alert.alert(
                      t.mqttSubscriptionsApplied,
                      t.mqttSubscriptionsAppliedMsg.replace('{count}', String(topics.length)),
                    );
                  }}
                >
                  <Icon name="check-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.applySubscriptionText}>{t.mqttApplySubscriptions}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Manual Topics Input (legacy) */}
          {subscriptionMode === 'manual' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>{t.topics}</Text>
              <TextInput
                style={styles.textInput}
                value={settings.mqtt.topics?.join(', ') || 'avi-aoi/#'}
                onChangeText={(value) => {
                  const topics = value.split(',').map(t => t.trim()).filter(t => t.length > 0);
                  updateMqttConfig({ topics: topics.length > 0 ? topics : ['avi-aoi/#'] });
                }}
                placeholder="avi-aoi/#"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.inputHint}>
                {language === 'vi'
                  ? 'Dùng # để subscribe tất cả. VD: avi-aoi/#'
                  : 'Use # to subscribe all. Ex: avi-aoi/#'}
              </Text>
            </View>
          )}

          {/* Current topics display */}
          {settings.mqtt.topics && settings.mqtt.topics.length > 0 && (
            <View style={styles.currentTopicsContainer}>
              <Text style={styles.currentTopicsTitle}>
                {language === 'vi' ? `Topics hiện tại (${settings.mqtt.topics.length}):` : language === 'zh' ? `当前Topics (${settings.mqtt.topics.length}):` : `Current topics (${settings.mqtt.topics.length}):`}
              </Text>
              {settings.mqtt.topics.map((topic, idx) => (
                <Text key={idx} style={styles.currentTopicItem} numberOfLines={1}>
                  • {topic}
                </Text>
              ))}
            </View>
          )}


          <SettingItem
            icon="connection"
            iconColor={theme.colors.success}
            title={t.testConnection}
            type="button"
            onPress={handleTestConnection}
            disabled={isTesting}
          />
          <SettingItem
            icon="lan-disconnect"
            iconColor={theme.colors.error}
            title={language === 'vi' ? 'Ngắt kết nối MQTT' : language === 'zh' ? '断开MQTT' : 'Disconnect MQTT'}
            type="button"
            onPress={handleDisconnect}
            disabled={connectionStatus !== 'connected'}
            danger
          />
          {isTesting && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.loadingText}>
                {language === 'vi' ? 'Đang kiểm tra...' : language === 'zh' ? '测试中...' : 'Testing...'}
              </Text>
            </View>
          )}
        </SettingSection>

        {/* Notification Settings */}
        <SettingSection title={t.notificationSettings}>
          <SettingItem
            icon="bell"
            title={t.enableNotifications}
            type="switch"
            switchValue={settings.notifications.enabled}
            onSwitchChange={handleNotificationsToggle}
          />

          <SettingItem
            icon="volume-high"
            title={t.enableSound}
            type="switch"
            switchValue={settings.notifications.sound}
            onSwitchChange={handleSoundToggle}
            disabled={!settings.notifications.enabled}
          />

          <SettingItem
            icon="vibrate"
            title={t.enableVibration}
            type="switch"
            switchValue={settings.notifications.vibration}
            onSwitchChange={handleVibrationToggle}
            disabled={!settings.notifications.enabled}
          />

          <SettingItem
            icon="moon-waning-crescent"
            title={t.quietHours}
            subtitle={`${settings.notifications.quietHoursStart} - ${settings.notifications.quietHoursEnd}`}
            type="switch"
            switchValue={settings.notifications.quietHoursEnabled}
            onSwitchChange={handleQuietHoursToggle}
            disabled={!settings.notifications.enabled}
          />

          <SettingItem
            icon="chat-processing"
            title={t.floatingBubble}
            subtitle={t.floatingBubbleEnabled}
            type="switch"
            switchValue={settings.notifications.floatingBubbleEnabled}
            onSwitchChange={handleFloatingBubbleToggle}
            disabled={!settings.notifications.enabled}
          />

          <SettingItem
            icon="message-alert"
            title={t.showAlertDialog}
            subtitle={t.showAlertDialogDesc}
            type="switch"
            switchValue={settings.notifications.showAlertDialog !== false}
            onSwitchChange={(value: boolean) => updateNotificationConfig({ showAlertDialog: value })}
            disabled={!settings.notifications.enabled}
          />

          {settings.notifications.showAlertDialog !== false && (
            <SettingItem
              icon="timer-outline"
              title={t.overlayDisplayDuration}
              subtitle={`${settings.notifications.overlayDisplayDuration || 15}s — ${t.overlayDisplayDurationDesc}`}
              type="slider"
              sliderValue={settings.notifications.overlayDisplayDuration || 15}
              sliderMin={5}
              sliderMax={60}
              sliderStep={5}
              sliderSuffix="s"
              onSliderChange={(value: number) => updateNotificationConfig({ overlayDisplayDuration: value })}
              disabled={!settings.notifications.enabled}
            />
          )}
        </SettingSection>

        {/* Severity Filter Section */}
        <SettingSection title={t.severityFilter}>
          <Text style={[styles.severityFilterDescription, { fontSize: fontSize.small }]}>{t.severityFilterDescription}</Text>
          
          {/* Quick Actions */}
          <View style={[styles.severityQuickActions, { gap: isTablet ? 16 : 10 }]}>
            <TouchableOpacity 
              style={[styles.quickActionButton, { paddingVertical: isTablet ? 10 : 8, paddingHorizontal: isTablet ? 14 : 10 }]} 
              onPress={handleSelectAllSeverities}
              disabled={!settings.notifications.enabled}
            >
              <Icon name="checkbox-multiple-marked" size={isTablet ? 18 : 15} color={theme.colors.primary} />
              <Text style={[styles.quickActionText, { fontSize: fontSize.small }]}>{t.selectAll}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.quickActionButton, { paddingVertical: isTablet ? 10 : 8, paddingHorizontal: isTablet ? 14 : 10 }]} 
              onPress={handleDeselectAllSeverities}
              disabled={!settings.notifications.enabled}
            >
              <Icon name="checkbox-multiple-blank-outline" size={isTablet ? 18 : 15} color={theme.colors.textSecondary} />
              <Text style={[styles.quickActionText, { fontSize: fontSize.small }]}>{t.deselectAll}</Text>
            </TouchableOpacity>
          </View>

          {/* Severity Checkboxes */}
          <View style={dynamicStyles.severityGrid}>
            {(['critical', 'high', 'medium', 'low', 'info'] as AlertSeverity[]).map((severity) => {
              const isChecked = settings.notifications.severityFilter?.includes(severity) ?? false;
              const config = SEVERITY_CONFIG[severity];
              const labels: Record<AlertSeverity, string> = {
                critical: t.severityCritical,
                high: t.severityHigh,
                medium: t.severityMedium,
                low: t.severityLow,
                info: t.severityInfo,
              };
              
              return (
                <TouchableOpacity
                  key={severity}
                  style={[
                    styles.severityCheckbox,
                    dynamicStyles.severityItem,
                    isChecked && styles.severityCheckboxChecked,
                    { borderColor: config.color },
                  ]}
                  onPress={() => handleSeverityToggle(severity)}
                  disabled={!settings.notifications.enabled}
                >
                  <View style={[styles.severityIndicator, { backgroundColor: config.color, width: isTablet ? 5 : 4 }]} />
                  <Text style={[
                    styles.severityLabel,
                    { fontSize: fontSize.small },
                    isChecked && styles.severityLabelChecked,
                  ]}>
                    {labels[severity]}
                  </Text>
                  <Icon 
                    name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'} 
                    size={isTablet ? 24 : 20} 
                    color={isChecked ? config.color : theme.colors.textMuted} 
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </SettingSection>

        {/* Station Filter Section */}
        <SettingSection title={t.stationFilter}>
          <SettingItem
            icon="filter"
            title={t.stationFilterEnabled}
            subtitle={t.stationFilterDescription}
            type="switch"
            switchValue={settings.notifications.stationFilterEnabled}
            onSwitchChange={handleStationFilterToggle}
            disabled={!settings.notifications.enabled}
          />

          {settings.notifications.stationFilterEnabled && (
            <View style={styles.stationFilterContainer}>
              {/* Add Station Input */}
              <View style={styles.addStationRow}>
                <TextInput
                  style={styles.stationInput}
                  value={newStationCode}
                  onChangeText={setNewStationCode}
                  placeholder={t.stationCodePlaceholder}
                  placeholderTextColor={theme.colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={handleAddStation}
                  disabled={!newStationCode.trim()}
                >
                  <Icon name="plus" size={20} color="#FFFFFF" />
                  <Text style={styles.addButtonText}>{t.addStation}</Text>
                </TouchableOpacity>
              </View>

              {/* Quick-add from known stations */}
              {(() => {
                const available = Object.keys(stationsMap).filter(
                  (sid) => !stationFilters.includes(sid),
                );
                if (available.length === 0) return null;
                return (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {available.map((sid) => {
                      const name = stationsMap[sid]?.config?.stationName;
                      return (
                        <TouchableOpacity
                          key={sid}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 4,
                            backgroundColor: `${theme.colors.primary}10`,
                            borderWidth: 1, borderColor: `${theme.colors.primary}30`,
                            borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
                          }}
                          onPress={() => {
                            updateNotificationConfig({
                              stationFilters: [...stationFilters, sid],
                            });
                          }}
                        >
                          <Icon name="plus-circle-outline" size={14} color={theme.colors.primary} />
                          <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '600' }}>
                            {sid}{name ? ` — ${name}` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })()}

              {/* Station List */}
              {stationFilters.length > 0 ? (
                <View style={styles.stationList}>
                  {stationFilters.map((code) => {
                    const stationData = stationsMap[code];
                    const stationName = stationData?.config?.stationName;
                    return (
                    <View key={code} style={styles.stationChip}>
                      <Icon name="factory" size={16} color={theme.colors.primary} />
                      <Text style={styles.stationChipText}>
                        {code}{stationName ? ` — ${stationName}` : ''}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleRemoveStation(code)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Icon name="close-circle" size={18} color={theme.colors.error} />
                      </TouchableOpacity>
                    </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyStationList}>
                  <Icon name="filter-off" size={32} color={theme.colors.textMuted} />
                  <Text style={styles.emptyStationText}>{t.noStationFilter}</Text>
                  <Text style={styles.emptyStationHint}>{t.noStationFilterHint}</Text>
                </View>
              )}
            </View>
          )}
        </SettingSection>

        {/* API Server Settings */}
        <SettingSection title={t.apiServerSettings}>
          {/* Custom IP toggle */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => handleCustomApiIpToggle(!useCustomApiIp)}
            activeOpacity={0.7}
          >
            <Icon
              name={useCustomApiIp ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={useCustomApiIp ? theme.colors.primary : theme.colors.textMuted}
            />
            <View style={styles.checkboxTextContainer}>
              <Text style={styles.checkboxLabel}>{t.useCustomIp}</Text>
              <Text style={styles.checkboxHint}>
                {useCustomApiIp ? '' : `${t.autoFromMqtt}: ${getBrokerIp() || '—'}:3000`}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {t.apiBaseUrl}
            </Text>
            <TextInput
              style={[styles.textInput, !useCustomApiIp && styles.textInputDisabled]}
              value={apiBaseUrlInput}
              onChangeText={handleApiBaseUrlChange}
              placeholder="http://192.168.1.100:3000"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={useCustomApiIp}
            />
            <Text style={styles.inputHint}>
              {t.apiBaseUrlHint}
            </Text>
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {t.apiKey}
            </Text>
            <TextInput
              style={styles.textInput}
              value={apiKeyInput}
              onChangeText={handleApiKeyChange}
              placeholder="Enter API Key"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.inputHint}>
              {t.apiKeyHint}
            </Text>
          </View>

          {/* Username */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {t.apiUsername}
            </Text>
            <TextInput
              style={styles.textInput}
              value={apiUsernameInput}
              onChangeText={handleApiUsernameChange}
              placeholder={language === 'vi' ? 'Nhập tên đăng nhập' : language === 'zh' ? '输入用户名' : 'Enter username'}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.inputHint}>
              {t.apiUsernameHint}
            </Text>
          </View>

          {/* Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {t.apiPassword}
            </Text>
            <TextInput
              style={styles.textInput}
              value={apiPasswordInput}
              onChangeText={handleApiPasswordChange}
              placeholder={language === 'vi' ? 'Nhập mật khẩu' : language === 'zh' ? '输入密码' : 'Enter password'}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.inputHint}>
              {t.apiPasswordHint}
            </Text>
          </View>

          {/* Login / Logout buttons */}
          <View style={styles.loginButtonRow}>
            <TouchableOpacity
              style={[styles.loginButton, isLoggingIn && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>{t.apiLogin}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.loginButton, styles.logoutButton]}
              onPress={handleLogout}
            >
              <Text style={styles.loginButtonText}>{t.apiLogout}</Text>
            </TouchableOpacity>
          </View>

          {/* Login status */}
          {loginStatus !== '' && (
            <View style={styles.loginStatusContainer}>
              <Text style={[
                styles.loginStatusText,
                loginStatus.includes('Success') || loginStatus.includes('thành công')
                  ? styles.loginStatusSuccess
                  : styles.loginStatusError,
              ]}>
                {loginStatus}
              </Text>
            </View>
          )}

          {/* Debug Panel Toggle */}
          <TouchableOpacity
            style={styles.debugToggle}
            onPress={() => setShowDebugPanel(!showDebugPanel)}
          >
            <Icon name="bug-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.debugToggleText}>{t.apiDebugPanel}</Text>
            <Icon
              name={showDebugPanel ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={theme.colors.textMuted}
            />
          </TouchableOpacity>

          {/* Debug Panel */}
          {showDebugPanel && (
            <View style={styles.debugPanel}>
              <TouchableOpacity
                style={[styles.debugRunButton, isDebugRunning && styles.loginButtonDisabled]}
                onPress={handleDebugTest}
                disabled={isDebugRunning}
              >
                {isDebugRunning ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.loginButtonText}>{t.apiTestConnection}</Text>
                )}
              </TouchableOpacity>

              {debugResults.length > 0 && (
                <View style={styles.debugResultsList}>
                  <Text style={styles.debugResultsTitle}>{t.apiDebugResults}</Text>
                  {debugResults.map((result, index) => (
                    <View key={index} style={styles.debugResultItem}>
                      <View style={styles.debugResultHeader}>
                        <Icon
                          name={result.success ? 'check-circle' : 'close-circle'}
                          size={18}
                          color={result.success ? '#4CAF50' : '#F44336'}
                        />
                        <Text style={styles.debugResultStep}>{result.step}</Text>
                        <Text style={styles.debugResultDuration}>{result.duration}ms</Text>
                      </View>
                      <Text style={styles.debugResultMessage}>{result.message}</Text>
                      {result.details && (
                        <Text style={styles.debugResultDetails}>
                          {result.details}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </SettingSection>

        {/* App Settings */}
        <SettingSection title={t.appSettings}>
          <SettingItem
            icon="bug-outline"
            title={language === 'vi' ? 'Chế độ Debug' : language === 'zh' ? '调试模式' : 'Debug Mode'}
            subtitle={language === 'vi' ? 'Hiển thị nút và cửa sổ debug trong màn hình trạm' : language === 'zh' ? '在工站屏幕显示调试按钮和面板' : 'Show debug button and panel in station screen'}
            type="switch"
            switchValue={settings.app.debugMode ?? false}
            onSwitchChange={(val) => updateAppSettings({ debugMode: val })}
          />
          <SettingItem
            icon="translate"
            title={t.language}
            value={language === 'vi' ? 'Tiếng Việt' : language === 'zh' ? '中文' : 'English'}
            type="navigate"
            onPress={handleLanguageToggle}
          />

          {/* Theme Mode Toggle */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            backgroundColor: theme.colors.surface,
          }}>
            <Icon name="theme-light-dark" size={22} color={theme.colors.textSecondary} />
            <Text style={{
              flex: 1,
              marginLeft: theme.spacing.md,
              fontSize: theme.fontSize.md,
              color: theme.colors.text,
              fontWeight: '500',
            }}>
              {language === 'vi' ? 'Giao diện' : language === 'zh' ? '主题' : 'Theme'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setThemeMode(mode)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: theme.borderRadius.full,
                    backgroundColor: themeMode === mode
                      ? `${theme.colors.primary}20`
                      : 'transparent',
                    borderWidth: themeMode === mode ? 1 : 0,
                    borderColor: theme.colors.primary,
                    gap: 4,
                  }}>
                  <Icon
                    name={
                      mode === 'light'
                        ? 'weather-sunny'
                        : mode === 'dark'
                        ? 'weather-night'
                        : 'cellphone'
                    }
                    size={16}
                    color={
                      themeMode === mode
                        ? theme.colors.primary
                        : theme.colors.textMuted
                    }
                  />
                  <Text
                    style={{
                      fontSize: theme.fontSize.xs,
                      fontWeight: themeMode === mode ? '600' : '400',
                      color:
                        themeMode === mode
                          ? theme.colors.primary
                          : theme.colors.textMuted,
                    }}>
                    {mode === 'light'
                      ? (language === 'vi' ? 'Sáng' : language === 'zh' ? '浅色' : 'Light')
                      : mode === 'dark'
                      ? (language === 'vi' ? 'Tối' : language === 'zh' ? '深色' : 'Dark')
                      : (language === 'vi' ? 'Hệ thống' : language === 'zh' ? '系统' : 'System')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <SettingItem
            icon="refresh-auto"
            title={t.autoReconnect}
            type="switch"
            switchValue={settings.app.autoReconnect}
            onSwitchChange={handleAutoReconnectToggle}
          />

          {settings.app.autoReconnect && (
            <>
              <SettingItem
                icon="timer-outline"
                title={t.mqttHealthCheckInterval}
                description={t.mqttHealthCheckIntervalDesc}
                type="slider"
                sliderMin={5}
                sliderMax={60}
                sliderStep={5}
                sliderValue={Math.round((settings.app.mqttHealthCheckInterval ?? 15000) / 1000)}
                onSliderChange={handleHealthCheckIntervalChange}
                sliderSuffix="s"
              />
              <SettingItem
                icon="repeat"
                title={t.mqttRetryMaxAttempts}
                description={t.mqttRetryMaxAttemptsDesc}
                type="slider"
                sliderMin={1}
                sliderMax={20}
                sliderStep={1}
                sliderValue={settings.app.mqttRetryMaxAttempts ?? 5}
                onSliderChange={handleRetryMaxAttemptsChange}
              />
              <SettingItem
                icon="clock-outline"
                title={t.mqttRetryInterval}
                description={t.mqttRetryIntervalDesc}
                type="slider"
                sliderMin={3}
                sliderMax={60}
                sliderStep={1}
                sliderValue={Math.round((settings.app.mqttRetryInterval ?? 10000) / 1000)}
                onSliderChange={handleRetryIntervalChange}
                sliderSuffix="s"
              />
            </>
          )}

          <SettingItem
            icon="cellphone-screenshot"
            title={t.keepScreenOn}
            type="switch"
            switchValue={settings.app.keepScreenOn}
            onSwitchChange={handleKeepScreenOnToggle}
          />
        </SettingSection>

        {/* W8-C (doc 27 Đợt 6 leftover) — Background & battery: keep-alive toggle +
            battery-optimization exemption (Android-only mechanics — FGS/Doze). */}
        {Platform.OS === 'android' && (
          <SettingSection title={t.backgroundAndBattery}>
            <SettingItem
              icon="radio-tower"
              title={t.keepAliveTitle}
              description={t.keepAliveDesc}
              type="switch"
              switchValue={keepAliveEnabled}
              onSwitchChange={handleKeepAliveToggle}
            />
            <SettingItem
              icon={batteryOptimized === false ? 'battery-check' : 'battery-alert'}
              iconColor={batteryOptimized === false ? theme.colors.success : theme.colors.warning}
              title={t.batteryOptTitle}
              description={
                batteryOptimized === null
                  ? undefined
                  : batteryOptimized
                  ? t.batteryOptDescActive
                  : t.batteryOptDescExempt
              }
              value={
                batteryOptimized === null
                  ? t.batteryOptStatusChecking
                  : batteryOptimized
                  ? t.batteryOptStatusActive
                  : t.batteryOptStatusExempt
              }
              type="navigate"
              onPress={handleOpenBatterySettings}
            />
          </SettingSection>
        )}

        {/* Network Monitoring */}
        <SettingSection title={t.networkMonitoring}>
          {/* Run diagnostics button */}
          <SettingItem
            icon="play-circle-outline"
            iconColor={theme.colors.primary}
            title={t.runFullDiagnostics}
            type="button"
            onPress={handleNetworkDiagnostics}
            disabled={isNetworkTesting}
          />

          {/* Diagnostics results panel */}
          {(showNetworkPanel || isNetworkTesting) && (
            <View style={{ padding: 12, backgroundColor: theme.colors.surface }}>
              {isNetworkTesting && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={{ marginLeft: 8, fontSize: 13, color: theme.colors.textSecondary }}>
                    {t.diagnosing}
                  </Text>
                </View>
              )}

              {!isNetworkTesting && networkOverallScore && (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: networkOverallScore.status === 'good' ? '#4CAF5020' : networkOverallScore.status === 'fair' ? '#FF980020' : '#F4433620',
                  borderLeftWidth: 4,
                  borderLeftColor: networkOverallScore.status === 'good' ? '#4CAF50' : networkOverallScore.status === 'fair' ? '#FF9800' : '#F44336',
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 12,
                }}>
                  <Icon
                    name={networkOverallScore.status === 'good' ? 'check-circle' : networkOverallScore.status === 'fair' ? 'alert-circle' : 'close-circle'}
                    size={24}
                    color={networkOverallScore.status === 'good' ? '#4CAF50' : networkOverallScore.status === 'fair' ? '#FF9800' : '#F44336'}
                  />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>
                      {t.networkQualityScore}: {networkOverallScore.score}/100
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                      {networkOverallScore.status === 'good' ? t.networkGood : networkOverallScore.status === 'fair' ? t.networkFair : t.networkPoor}
                      {networkResults.stable !== null && (networkResults.stable ? ` • ✅ ${t.networkStable}` : ` • ⚠️ ${t.networkUnstable}`)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Per-method results */}
              {!isNetworkTesting && networkMethodResults.length > 0 && (
                <View>
                  {networkMethodResults.map((result, idx) => {
                    const statusColor = result.status === 'good' ? '#4CAF50' : result.status === 'fair' ? '#FF9800' : result.status === 'poor' ? '#F44336' : result.status === 'disabled' ? '#9E9E9E' : '#F44336';
                    const statusIcon = result.status === 'good' ? 'check-circle' : result.status === 'fair' ? 'alert-circle' : result.status === 'disabled' ? 'minus-circle' : 'close-circle';
                    return (
                      <View
                        key={idx}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          backgroundColor: theme.colors.background,
                          borderRadius: 6,
                          padding: 10,
                          marginBottom: 6,
                        }}
                      >
                        <Icon name={statusIcon} size={18} color={statusColor} style={{ marginTop: 1 }} />
                        <View style={{ marginLeft: 8, flex: 1 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text }}>{result.method}</Text>
                            {result.latencyMs !== undefined && (
                              <Text style={{ fontSize: 12, fontWeight: '600', color: statusColor }}>{result.latencyMs} ms</Text>
                            )}
                          </View>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 }}>{result.details}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Legacy MQTT/HTTP detail results */}
              {!isNetworkTesting && networkResults.overall !== null && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 6 }}>
                    {t.networkDiagnostics}
                  </Text>

                  {networkResults.mqtt && (
                    <View style={{ marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.text, marginBottom: 4 }}>
                        🔌 {t.networkTestMqtt}
                      </Text>
                      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: theme.colors.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkAvgLatency}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: networkResults.mqtt.avg < 200 ? '#4CAF50' : networkResults.mqtt.avg < 500 ? '#FF9800' : '#F44336' }}>
                            {networkResults.mqtt.avg} ms
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkMinLatency}/{t.networkMaxLatency}</Text>
                          <Text style={{ fontSize: 11, color: theme.colors.text }}>{networkResults.mqtt.min}/{networkResults.mqtt.max} ms</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkJitter}</Text>
                          <Text style={{ fontSize: 11, color: networkResults.mqtt.jitter < 100 ? '#4CAF50' : '#FF9800' }}>{networkResults.mqtt.jitter} ms</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkSuccess}/{t.networkFailed}</Text>
                          <Text style={{ fontSize: 11, color: theme.colors.text }}>{networkResults.mqtt.success}/{networkResults.mqtt.failed}</Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {networkResults.http && (
                    <View style={{ marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.text, marginBottom: 4 }}>
                        🌐 {t.networkTestHttp}
                      </Text>
                      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: theme.colors.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkAvgLatency}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: networkResults.http.avg < 200 ? '#4CAF50' : networkResults.http.avg < 500 ? '#FF9800' : '#F44336' }}>
                            {networkResults.http.avg} ms
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkMinLatency}/{t.networkMaxLatency}</Text>
                          <Text style={{ fontSize: 11, color: theme.colors.text }}>{networkResults.http.min}/{networkResults.http.max} ms</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkJitter}</Text>
                          <Text style={{ fontSize: 11, color: networkResults.http.jitter < 100 ? '#4CAF50' : '#FF9800' }}>{networkResults.http.jitter} ms</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{t.networkSuccess}/{t.networkFailed}</Text>
                          <Text style={{ fontSize: 11, color: theme.colors.text }}>{networkResults.http.success}/{networkResults.http.failed}</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Re-run button */}
              {!isNetworkTesting && (networkMethodResults.length > 0 || networkResults.overall !== null) && (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.colors.primary,
                    borderRadius: 6,
                    paddingVertical: 8,
                    marginTop: 10,
                  }}
                  onPress={handleNetworkDiagnostics}
                  disabled={isNetworkTesting}
                >
                  <Icon name="refresh" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginLeft: 6 }}>
                    {t.runDiagnostics}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </SettingSection>

        {/* Data Management */}
        <SettingSection title={t.dataManagement}>
          <SettingItem
            icon="delete-sweep"
            iconColor={theme.colors.error}
            title={t.clearAllAlerts}
            type="button"
            onPress={handleClearAllAlerts}
            danger
          />

          <SettingItem
            icon="restore"
            iconColor={theme.colors.warning}
            title={t.resetToDefaults}
            type="button"
            onPress={handleResetToDefaults}
            danger
          />
        </SettingSection>

        {/* App Update Section */}
        <SettingSection title={language === 'vi' ? 'Cập nhật ứng dụng' : language === 'zh' ? '应用更新' : 'App Updates'}>
          {/* AutoUpdate toggle */}
          <SettingItem
            icon="update"
            iconColor={theme.colors.primary}
            title={language === 'vi' ? 'Tự động cập nhật' : language === 'zh' ? '自动更新' : 'Auto Update'}
            subtitle={language === 'vi'
              ? 'Bật: tự động hiện dialog cập nhật. Tắt: chỉ cảnh báo, cập nhật thủ công.'
              : language === 'zh'
              ? '开：自动弹出更新对话框。关：仅提示，手动更新。'
              : 'On: auto-show update dialog. Off: warn only, update manually.'}
            type="switch"
            switchValue={settings.app.autoUpdate !== false}
            onSwitchChange={handleAutoUpdateToggle}
          />

          {/* Pending update banner — shown when autoUpdate is OFF and there's a pending update */}
          {!settings.app.autoUpdate && pendingUpdate && (
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.warning + '20',
                borderLeftWidth: 4,
                borderLeftColor: theme.colors.warning,
                padding: 12,
                marginHorizontal: 0,
              }}
              onPress={handleManualUpdate}
              activeOpacity={0.7}
            >
              <Icon name="alert-circle-outline" size={22} color={theme.colors.warning} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>
                  {language === 'vi'
                    ? `Có phiên bản mới ${pendingUpdate.version}`
                    : language === 'zh'
                    ? `有新版本 ${pendingUpdate.version}`
                    : `Version ${pendingUpdate.version} available`}
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {language === 'vi'
                    ? 'Nhấn để cập nhật thủ công'
                    : language === 'zh'
                    ? '点击手动更新'
                    : 'Tap to update manually'}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Custom Update IP toggle */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => handleCustomUpdateIpToggle(!useCustomUpdateIp)}
            activeOpacity={0.7}
          >
            <Icon
              name={useCustomUpdateIp ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={useCustomUpdateIp ? theme.colors.primary : theme.colors.textMuted}
            />
            <View style={styles.checkboxTextContainer}>
              <Text style={styles.checkboxLabel}>{t.useCustomIp}</Text>
              <Text style={styles.checkboxHint}>
                {useCustomUpdateIp ? '' : `${t.autoFromMqtt}: ${getBrokerIp() || '—'}:3900`}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {language === 'vi' ? 'URL Server cập nhật' : language === 'zh' ? '更新服务器URL' : 'Update Server URL'}
            </Text>
            <TextInput
              style={[styles.textInput, !useCustomUpdateIp && styles.textInputDisabled]}
              value={updateServerUrl}
              onChangeText={handleUpdateServerUrlChange}
              placeholder="http://192.168.1.100:3900"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={useCustomUpdateIp}
            />
            <Text style={styles.inputHint}>
              {language === 'vi' 
                ? 'Nhập địa chỉ server LAN chứa file cập nhật' 
                : language === 'zh'
                ? '输入包含更新文件的局域网服务器地址'
                : 'Enter LAN server address containing update files'}
            </Text>
          </View>


        </SettingSection>

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appName}>Factory Alert System</Text>
          <Text style={styles.appVersion}>Version {currentVersion}</Text>
          <Text style={styles.appCopyright}>© 2026 Jacky</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.lg,
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: theme.spacing.sm,
  },
  connectionText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    marginLeft: theme.spacing.sm,
  },
  inputContainer: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  inputLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  textInput: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    padding: 0,
  },
  textInputDisabled: {
    opacity: 0.5,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: `${theme.colors.primary}08`,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  checkboxTextContainer: {
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  checkboxLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: '500',
  },
  checkboxHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  inputHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  loadingText: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.textSecondary,
  },
  // Broker Type Styles
  brokerTypeContainer: {
    padding: theme.spacing.md,
    backgroundColor: `${theme.colors.primary}10`,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  brokerTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  brokerTypeLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.sm,
  },
  brokerTypeBadge: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.sm,
  },
  brokerTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
  },
  brokerUrlText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  // Preset Styles
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  presetButtonText: {
    flex: 1,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
    fontWeight: '600',
  },
  presetsContainer: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  presetItemContent: {
    flex: 1,
    marginLeft: theme.spacing.sm,
  },
  presetItemName: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  presetItemAddress: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontFamily: 'monospace',
  },
  presetItemDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  // Protocol Selector Styles
  protocolSelector: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  protocolOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  protocolOptionCompact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  protocolOptionActive: {
    backgroundColor: theme.colors.primary,
  },
  protocolOptionText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.primary,
    marginTop: 4,
  },
  protocolOptionTextActive: {
    color: theme.colors.white,
  },
  protocolOptionSubtext: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  protocolOptionSubtextActive: {
    color: theme.colors.white,
  },
  // Station Filter Styles
  stationFilterContainer: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  addStationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  stationInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    height: 44,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    marginLeft: 4,
  },
  stationList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  stationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${theme.colors.primary}15`,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    gap: 6,
  },
  stationChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary,
    fontFamily: 'monospace',
  },
  emptyStationList: {
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  emptyStationText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
  emptyStationHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  // Severity Filter Styles
  severityFilterDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  severityQuickActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickActionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  severityGrid: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  severityCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  severityCheckboxChecked: {
    backgroundColor: `${theme.colors.primary}08`,
  },
  severityIndicator: {
    width: 4,
    height: 24,
    borderRadius: 2,
    marginRight: theme.spacing.md,
  },
  severityLabel: {
    flex: 1,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  severityLabelChecked: {
    fontWeight: '600',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: theme.borderRadius.lg,
    marginTop: 16,
    marginBottom: 8,
    gap: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  appName: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
  },
  appVersion: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  appCopyright: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 8,
  },
  checkingUpdateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.sm,
  },
  checkingUpdateText: {
    marginLeft: theme.spacing.sm,
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
  },
  // Subscription Hierarchy Styles
  applySubscriptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.success,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.md,
    gap: 6,
  },
  applySubscriptionText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.md,
    fontWeight: '600',
  },
  currentTopicsContainer: {
    padding: theme.spacing.md,
    backgroundColor: `${theme.colors.info}08`,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  currentTopicsTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  currentTopicItem: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
    paddingVertical: 1,
  },
  // Login & Debug styles
  loginButtonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  loginButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  logoutButton: {
    backgroundColor: theme.colors.textMuted,
    flex: 0.5,
  },
  loginButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: theme.fontSize.sm,
  },
  loginStatusContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  loginStatusText: {
    fontSize: theme.fontSize.xs,
  },
  loginStatusSuccess: {
    color: '#4CAF50',
  },
  loginStatusError: {
    color: theme.colors.error,
  },
  debugToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: 8,
  },
  debugToggleText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '500',
  },
  debugPanel: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  debugRunButton: {
    backgroundColor: '#FF9800',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    marginBottom: theme.spacing.sm,
  },
  debugResultsList: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: theme.spacing.sm,
  },
  debugResultsTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: theme.fontSize.sm,
    marginBottom: 8,
  },
  debugResultItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingVertical: 8,
  },
  debugResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  debugResultStep: {
    flex: 1,
    color: '#fff',
    fontWeight: '500',
    fontSize: theme.fontSize.xs,
  },
  debugResultDuration: {
    color: '#aaa',
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
  },
  debugResultMessage: {
    color: '#ccc',
    fontSize: theme.fontSize.xs,
    marginLeft: 24,
  },
  debugResultDetails: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
    marginLeft: 24,
    marginTop: 4,
  },
});

export default SettingsScreen;
