/**
 * Factory Alert System - Simulator Screen
 * Màn hình mô phỏng tạo alerts để test
 * Responsive cho cả tablet và điện thoại
 */

import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert as RNAlert,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { SeverityBadge, MqttConnectionTest } from '../components';
import AlertOverlayDialog from '../components/AlertOverlayDialog';
import { useAlertStore, useSettingsStore, selectLanguage } from '../store';
import { Alert, AlertSeverity } from '../types';
import {
  TRANSLATIONS,
  SAMPLE_STATIONS,
  SAMPLE_PRODUCTS,
  SAMPLE_ERRORS,
  SEVERITY_CONFIG,
} from '../utils/constants';
import { useTheme, Theme } from '../context/ThemeContext';
import { generateUUID, generateAlertId } from '../utils/helpers';
import { notificationService } from '../services/notificationService';
import { soundService } from '../services/soundService';
import { floatingBubbleService } from '../services/floatingBubbleService';

const INTERVALS = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
];

// Sample error images for demonstration
const SAMPLE_ERROR_IMAGES = [
  'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400&h=300&fit=crop', // Industrial machine
  'https://images.unsplash.com/photo-1565793298595-6a879b1d9492?w=400&h=300&fit=crop', // Manufacturing
  'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400&h=300&fit=crop', // Factory equipment
  'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=400&h=300&fit=crop', // Machinery
  'https://images.unsplash.com/photo-1537462715879-360eeb61a0ad?w=400&h=300&fit=crop', // Production line
];

// Sample machines for AVI inspection
const SAMPLE_MACHINES = [
  { id: 1, name: 'AVI Machine 01', code: 'AVI-01' },
  { id: 2, name: 'AVI Machine 02', code: 'AVI-02' },
  { id: 3, name: 'AOI Scanner 01', code: 'AOI-01' },
  { id: 4, name: 'Vision Inspection 01', code: 'VIS-01' },
];

// Sample NG point names
const SAMPLE_NG_POINT_NAMES = [
  'POINT-001', 'POINT-002', 'POINT-003', 'POINT-004', 'POINT-005',
  'CONNECTOR-A', 'CONNECTOR-B', 'WIRE-SEAL', 'TERMINAL-01', 'LOCK-CHECK',
];

const SimulatorScreen: React.FC = () => {
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 600;
  const isLandscape = screenWidth > 800;
  
  const language = useSettingsStore(selectLanguage);
  const t = TRANSLATIONS[language];
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const addAlert = useAlertStore((state) => state.addAlert);
  const acknowledgeAlert = useAlertStore((state) => state.acknowledgeAlert);
  const removeAlert = useAlertStore((state) => state.removeAlert);
  const clearAll = useAlertStore((state) => state.clearAll);
  const totalCount = useAlertStore((state) => state.totalCount);

  // Responsive values
  const gridColumns = isLandscape ? 4 : isTablet ? 3 : 2;
  const contentPadding = isTablet ? 20 : 12;
  const sectionSpacing = isTablet ? 20 : 14;

  // Local state
  const [generateType, setGenerateType] = useState<'random' | 'specific'>('random');
  const [selectedStation, setSelectedStation] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(0);
  const [selectedError, setSelectedError] = useState(0);
  const [selectedSeverity, setSelectedSeverity] = useState<AlertSeverity>('high');
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState(5000);
  const [generatedCount, setGeneratedCount] = useState(0);

  // Overlay dialog state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayAlert, setOverlayAlert] = useState<Alert | null>(null);
  const [bubbleEnabled, setBubbleEnabled] = useState(false);

  const autoGenerateRef = useRef<NodeJS.Timeout | null>(null);

  // Check bubble status on mount
  useEffect(() => {
    const checkBubble = async () => {
      if (floatingBubbleService.isAvailable()) {
        const showing = await floatingBubbleService.isShowing();
        setBubbleEnabled(showing);
      }
    };
    checkBubble();
  }, []);

  // Generate random alert
  const generateRandomAlert = useCallback((): Alert => {
    const station = SAMPLE_STATIONS[Math.floor(Math.random() * SAMPLE_STATIONS.length)];
    const product = SAMPLE_PRODUCTS[Math.floor(Math.random() * SAMPLE_PRODUCTS.length)];
    const error = SAMPLE_ERRORS[Math.floor(Math.random() * SAMPLE_ERRORS.length)];
    const severities: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const severity = severities[Math.floor(Math.random() * severities.length)];
    
    // Randomly include an error image (70% chance for critical/high severity)
    const shouldIncludeImage = (severity === 'critical' || severity === 'high') 
      ? Math.random() > 0.3 
      : Math.random() > 0.7;
    const imageUrl = shouldIncludeImage 
      ? SAMPLE_ERROR_IMAGES[Math.floor(Math.random() * SAMPLE_ERROR_IMAGES.length)]
      : undefined;

    // Generate machine info (50% chance)
    const shouldIncludeMachine = Math.random() > 0.5;
    const machine = shouldIncludeMachine
      ? SAMPLE_MACHINES[Math.floor(Math.random() * SAMPLE_MACHINES.length)]
      : undefined;

    // Generate NG points for high/critical severity (60% chance)
    const shouldIncludeNgPoints = (severity === 'critical' || severity === 'high') && Math.random() > 0.4;
    const ngPointCount = shouldIncludeNgPoints ? Math.floor(Math.random() * 3) + 1 : 0;
    const ngPoints = shouldIncludeNgPoints ? Array.from({ length: ngPointCount }, (_, idx) => ({
      pointId: idx,
      pointName: SAMPLE_NG_POINT_NAMES[Math.floor(Math.random() * SAMPLE_NG_POINT_NAMES.length)],
      result: 'NG' as const,
      actualValue: String(Math.floor(Math.random() * 200) + 100),
      imageUrl: Math.random() > 0.5 ? SAMPLE_ERROR_IMAGES[Math.floor(Math.random() * SAMPLE_ERROR_IMAGES.length)] : undefined,
    })) : undefined;

    const now = new Date().toISOString();
    const inspectionId = Math.floor(Math.random() * 1000) + 1;

    return {
      id: generateUUID(),
      alertId: generateAlertId(),
      timestamp: now,
      receivedAt: now,
      station: {
        ...station,
        area: station.area || 'Workshop Zone 1',
      },
      product: {
        ...product,
        serialNumber: `SN-${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`,
        model: `WH-${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`,
      },
      error: {
        ...error,
        imageUrl: shouldIncludeImage ? imageUrl : undefined,
      },
      severity,
      status: 'pending',
      imageUrl,
      machine,
      ngPoints,
      totalNG: ngPoints?.length,
      inspectionId: machine ? inspectionId : undefined,
    };
  }, []);

  // Generate specific alert
  const generateSpecificAlert = useCallback((): Alert => {
    const station = SAMPLE_STATIONS[selectedStation];
    const product = SAMPLE_PRODUCTS[selectedProduct];
    const error = SAMPLE_ERRORS[selectedError];
    const now = new Date().toISOString();
    
    // Include sample image for critical/high severity alerts
    const imageUrl = (selectedSeverity === 'critical' || selectedSeverity === 'high')
      ? SAMPLE_ERROR_IMAGES[Math.floor(Math.random() * SAMPLE_ERROR_IMAGES.length)]
      : undefined;

    // Always include machine for specific alerts
    const machine = SAMPLE_MACHINES[Math.floor(Math.random() * SAMPLE_MACHINES.length)];
    const inspectionId = Math.floor(Math.random() * 1000) + 1;

    // Generate NG points for high/critical severity
    const shouldIncludeNgPoints = selectedSeverity === 'critical' || selectedSeverity === 'high';
    const ngPointCount = shouldIncludeNgPoints ? Math.floor(Math.random() * 3) + 1 : 0;
    const ngPoints = shouldIncludeNgPoints ? Array.from({ length: ngPointCount }, (_, idx) => ({
      pointId: idx,
      pointName: SAMPLE_NG_POINT_NAMES[idx % SAMPLE_NG_POINT_NAMES.length],
      result: 'NG' as const,
      actualValue: String(Math.floor(Math.random() * 200) + 100),
      imageUrl: idx === 0 ? imageUrl : undefined,
    })) : undefined;

    return {
      id: generateUUID(),
      alertId: generateAlertId(),
      timestamp: now,
      receivedAt: now,
      station: {
        ...station,
        area: station.area || 'Workshop Zone 1',
      },
      product: {
        ...product,
        serialNumber: `SN-${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}-ABC`,
        model: `WH-${product.id.split('-')[1] || '12345'}`,
      },
      error: {
        ...error,
        imageUrl,
      },
      severity: selectedSeverity,
      status: 'pending',
      imageUrl,
      machine,
      ngPoints,
      totalNG: ngPoints?.length,
      inspectionId,
    };
  }, [selectedStation, selectedProduct, selectedError, selectedSeverity]);

  // Handle generate alert
  const handleGenerateAlert = useCallback(() => {
    const alert = generateType === 'random' ? generateRandomAlert() : generateSpecificAlert();
    addAlert(alert);
    notificationService.showAlert(alert);
    soundService.playAlertSound(alert.severity);
    setGeneratedCount((prev) => prev + 1);
  }, [generateType, generateRandomAlert, generateSpecificAlert, addAlert]);

  // Handle auto generate toggle
  const handleAutoGenerateToggle = useCallback(() => {
    if (autoGenerateEnabled) {
      if (autoGenerateRef.current) {
        clearInterval(autoGenerateRef.current);
        autoGenerateRef.current = null;
      }
      setAutoGenerateEnabled(false);
    } else {
      setAutoGenerateEnabled(true);
      autoGenerateRef.current = setInterval(() => {
        const alert = generateRandomAlert();
        addAlert(alert);
        notificationService.showAlert(alert);
        soundService.playAlertSound(alert.severity);
        setGeneratedCount((prev) => prev + 1);
      }, selectedInterval);
    }
  }, [autoGenerateEnabled, selectedInterval, generateRandomAlert, addAlert]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoGenerateRef.current) {
        clearInterval(autoGenerateRef.current);
      }
    };
  }, []);

  // Update interval when changed
  useEffect(() => {
    if (autoGenerateEnabled && autoGenerateRef.current) {
      clearInterval(autoGenerateRef.current);
      autoGenerateRef.current = setInterval(() => {
        const alert = generateRandomAlert();
        addAlert(alert);
        notificationService.showAlert(alert);
        soundService.playAlertSound(alert.severity);
        setGeneratedCount((prev) => prev + 1);
      }, selectedInterval);
    }
  }, [selectedInterval, autoGenerateEnabled, generateRandomAlert, addAlert]);

  // Handle clear all
  const handleClearAll = useCallback(() => {
    clearAll();
    setGeneratedCount(0);
  }, [clearAll]);

  // ============ TEST FUNCTIONS ============

  // Test Push Notification
  const handleTestNotification = useCallback(async () => {
    const result = await notificationService.showTestNotification();
    if (result) {
      RNAlert.alert(
        '✅ Thành công',
        'Notification đã được gửi! Kiểm tra thanh thông báo.',
        [{ text: 'OK' }]
      );
    } else {
      RNAlert.alert(
        '❌ Lỗi',
        'Không thể gửi notification. Vui lòng kiểm tra permission.',
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Mở Settings', onPress: () => notificationService.openSettings() },
        ]
      );
    }
  }, []);

  // Test Overlay Dialog
  const handleTestOverlay = useCallback(() => {
    const alert = generateType === 'random' ? generateRandomAlert() : generateSpecificAlert();
    setOverlayAlert(alert);
    setOverlayVisible(true);
    soundService.playAlertSound(alert.severity);
  }, [generateType, generateRandomAlert, generateSpecificAlert]);

  // Test Critical Alert (Full Screen)
  const handleTestCritical = useCallback(async () => {
    const now = new Date().toISOString();
    const criticalAlert: Alert = {
      id: generateUUID(),
      alertId: generateAlertId(),
      timestamp: now,
      receivedAt: now,
      station: SAMPLE_STATIONS[0],
      product: SAMPLE_PRODUCTS[0],
      error: {
        code: 'E-CRIT-001',
        type: 'EMERGENCY STOP',
        description: 'Máy đã dừng khẩn cấp! Cần kiểm tra ngay lập tức.',
      },
      severity: 'critical',
      status: 'pending',
    };

    // Add to store
    addAlert(criticalAlert);

    // Show notification
    await notificationService.showAlert(criticalAlert);

    // Show overlay dialog
    setOverlayAlert(criticalAlert);
    setOverlayVisible(true);

    // Play sound
    soundService.playAlertSound('critical');

    setGeneratedCount((prev) => prev + 1);
  }, [addAlert]);

  // Test Sound
  const handleTestSound = useCallback((severity: AlertSeverity) => {
    soundService.playAlertSound(severity);
  }, []);

  // Check notification permission
  const handleCheckPermission = useCallback(async () => {
    const hasPermission = await notificationService.hasPermission();
    RNAlert.alert(
      'Trạng thái Permission',
      hasPermission 
        ? '✅ Đã được cấp quyền thông báo'
        : '❌ Chưa được cấp quyền thông báo',
      [
        { text: 'OK' },
        !hasPermission && { 
          text: 'Mở Settings', 
          onPress: () => notificationService.openSettings() 
        },
      ].filter(Boolean) as any[]
    );
  }, []);

  // Debug all services status
  const handleDebugServices = useCallback(async () => {
    console.log('====== DEBUG SERVICES ======');
    
    // 1. Check notification service
    const notifPermission = await notificationService.hasPermission();
    const notifConfig = notificationService.getConfig ? notificationService.getConfig() : null;
    console.log('[DEBUG] Notification permission:', notifPermission);
    console.log('[DEBUG] Notification config:', notifConfig);

    // 2. Check floating bubble service
    const bubbleAvailable = floatingBubbleService.isAvailable();
    let bubblePermission = false;
    let bubbleShowing = false;
    if (bubbleAvailable) {
      bubblePermission = await floatingBubbleService.checkPermission();
      bubbleShowing = await floatingBubbleService.isShowing();
    }
    console.log('[DEBUG] Bubble available:', bubbleAvailable);
    console.log('[DEBUG] Bubble permission:', bubblePermission);
    console.log('[DEBUG] Bubble showing:', bubbleShowing);

    // 3. Build debug message
    const debugInfo = [
      '=== NOTIFICATION SERVICE ===',
      `• Permission: ${notifPermission ? '✅' : '❌'}`,
      `• Config enabled: ${notifConfig?.enabled ? '✅' : '❌ (DISABLED!)'}`,
      `• Severity filter: ${notifConfig?.severityFilter?.join(', ') || 'N/A'}`,
      `• Quiet hours: ${notifConfig?.quietHoursEnabled ? 'ON' : 'OFF'}`,
      '',
      '=== FLOATING BUBBLE ===',
      `• Available (Android): ${bubbleAvailable ? '✅' : '❌'}`,
      `• Overlay permission: ${bubblePermission ? '✅' : '❌'}`,
      `• Currently showing: ${bubbleShowing ? '✅' : '❌'}`,
      '',
      '=== SUGGESTION ===',
      !notifPermission ? '⚠️ Cần cấp quyền notification' : '',
      !notifConfig?.enabled ? '⚠️ Notification bị TẮT trong config!' : '',
      !bubblePermission && bubbleAvailable ? '⚠️ Cần cấp quyền overlay' : '',
    ].filter(Boolean).join('\n');

    RNAlert.alert('🔍 Debug Services', debugInfo, [{ text: 'OK' }]);
  }, []);

  // Direct test notification (bypass filters)
  const handleDirectTestNotification = useCallback(async () => {
    console.log('[DEBUG] Testing direct notification...');
    
    try {
      // Import notifee directly
      const notifee = require('@notifee/react-native').default;
      
      // Display a simple notification
      const notificationId = await notifee.displayNotification({
        title: '🔔 Test trực tiếp',
        body: 'Notification này bỏ qua mọi filter. Nếu thấy = Notifee hoạt động.',
        android: {
          channelId: 'factory_high',
          smallIcon: 'ic_notification',
          importance: 4, // HIGH
          pressAction: {
            id: 'default',
          },
        },
      });

      console.log('[DEBUG] Notification sent:', notificationId);
      RNAlert.alert(
        '✅ Đã gửi',
        `Notification ID: ${notificationId}\n\nKiểm tra thanh thông báo!`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('[DEBUG] Direct notification error:', error);
      RNAlert.alert(
        '❌ Lỗi',
        `Error: ${error.message}\n\nCó thể channel chưa được tạo.`,
        [{ text: 'OK' }]
      );
    }
  }, []);

  // Reset notification settings to include all severities
  const handleResetSeverityFilter = useCallback(() => {
    const settingsStore = useSettingsStore.getState();
    const currentSettings = settingsStore.settings;
    
    // Update severity filter to include all
    const newNotificationConfig = {
      ...currentSettings.notifications,
      severityFilter: ['critical', 'high', 'medium', 'low', 'info'] as AlertSeverity[],
    };
    
    settingsStore.updateNotificationConfig(newNotificationConfig);
    
    RNAlert.alert(
      '✅ Đã Reset',
      'Severity Filter đã được reset để bao gồm TẤT CẢ các mức (critical, high, medium, low, info).\n\nBây giờ mọi bản tin MQTT sẽ được hiển thị thông báo.',
      [{ text: 'OK' }]
    );
  }, []);

  // Direct test floating bubble
  const handleDirectTestBubble = useCallback(async () => {
    console.log('[DEBUG] Testing direct bubble...');
    
    if (!floatingBubbleService.isAvailable()) {
      RNAlert.alert('Không hỗ trợ', 'Chỉ Android');
      return;
    }

    try {
      // Check permission first
      const hasPermission = await floatingBubbleService.checkPermission();
      if (!hasPermission) {
        const granted = await floatingBubbleService.requestPermission();
        if (!granted) {
          RNAlert.alert('Cần quyền', 'Vui lòng cấp quyền overlay');
          return;
        }
      }

      // Try to show bubble
      console.log('[DEBUG] Calling floatingBubbleService.show()...');
      await floatingBubbleService.show();
      
      // Then show an alert via bubble
      const testAlert = generateRandomAlert();
      console.log('[DEBUG] Calling floatingBubbleService.showAlert()...', testAlert.alertId);
      await floatingBubbleService.showAlert(testAlert, 1);
      
      setBubbleEnabled(true);
      
      RNAlert.alert(
        '✅ Đã gửi',
        'Bubble đã được kích hoạt. Thu nhỏ app để xem!',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('[DEBUG] Direct bubble error:', error);
      RNAlert.alert(
        '❌ Lỗi Bubble',
        `Error: ${error.message}`,
        [{ text: 'OK' }]
      );
    }
  }, [generateRandomAlert]);

  // ============ FLOATING BUBBLE FUNCTIONS ============

  // Toggle Floating Bubble
  const handleToggleBubble = useCallback(async () => {
    if (!floatingBubbleService.isAvailable()) {
      RNAlert.alert('Không hỗ trợ', 'Tính năng này chỉ hỗ trợ trên Android');
      return;
    }

    const hasPermission = await floatingBubbleService.checkPermission();
    if (!hasPermission) {
      const granted = await floatingBubbleService.requestPermission();
      if (!granted) return;
    }

    if (bubbleEnabled) {
      await floatingBubbleService.hide();
      setBubbleEnabled(false);
      RNAlert.alert('✅ Đã tắt', 'Floating Bubble đã được tắt');
    } else {
      await floatingBubbleService.show();
      setBubbleEnabled(true);
      RNAlert.alert('✅ Đã bật', 'Floating Bubble đã hiển thị trên màn hình. Bạn có thể thu nhỏ app để xem.');
    }
  }, [bubbleEnabled]);

  // Test Floating Bubble Alert
  const handleTestBubbleAlert = useCallback(async () => {
    if (!floatingBubbleService.isAvailable()) {
      RNAlert.alert('Không hỗ trợ', 'Tính năng này chỉ hỗ trợ trên Android');
      return;
    }

    const hasPermission = await floatingBubbleService.checkPermission();
    if (!hasPermission) {
      const granted = await floatingBubbleService.requestPermission();
      if (!granted) return;
    }

    const alert = generateType === 'random' ? generateRandomAlert() : generateSpecificAlert();
    addAlert(alert);
    
    // Show via floating bubble
    await floatingBubbleService.showAlert(alert, totalCount + 1);
    setBubbleEnabled(true);
    
    // Also play sound
    soundService.playAlertSound(alert.severity);
    setGeneratedCount((prev) => prev + 1);

    RNAlert.alert(
      '✅ Alert đã gửi',
      'Alert đã hiển thị qua Floating Bubble. Thu nhỏ app để xem popup nổi trên màn hình!',
      [{ text: 'OK' }]
    );
  }, [generateType, generateRandomAlert, generateSpecificAlert, addAlert, totalCount]);

  // Check Bubble Permission
  const handleCheckBubblePermission = useCallback(async () => {
    if (!floatingBubbleService.isAvailable()) {
      RNAlert.alert('Không hỗ trợ', 'Tính năng này chỉ hỗ trợ trên Android');
      return;
    }

    const hasPermission = await floatingBubbleService.checkPermission();
    RNAlert.alert(
      'Trạng thái Permission Overlay',
      hasPermission 
        ? '✅ Đã được cấp quyền hiển thị đè lên ứng dụng khác'
        : '❌ Chưa được cấp quyền',
      [
        { text: 'OK' },
        !hasPermission && { 
          text: 'Cấp quyền', 
          onPress: () => floatingBubbleService.requestPermission() 
        },
      ].filter(Boolean) as any[]
    );
  }, []);

  // Handle overlay actions
  const handleOverlayAcknowledge = useCallback(() => {
    if (overlayAlert) {
      addAlert(overlayAlert);
      acknowledgeAlert(overlayAlert.id);
    }
    setOverlayVisible(false);
    setOverlayAlert(null);
  }, [overlayAlert, addAlert, acknowledgeAlert]);

  const handleOverlayDismiss = useCallback(() => {
    if (overlayAlert) {
      removeAlert(overlayAlert.id);
    }
    setOverlayVisible(false);
    setOverlayAlert(null);
  }, [overlayAlert, removeAlert]);

  const handleOverlayClose = useCallback(() => {
    setOverlayVisible(false);
    setOverlayAlert(null);
  }, []);

  // Dynamic styles based on screen size
  const testButtonWidth = isLandscape ? '23%' : isTablet ? '31%' : '48%';
  const severityItemWidth = isLandscape ? '18%' : isTablet ? '30%' : '48%';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="flask" size={isTablet ? 28 : 24} color={theme.colors.primary} />
          <Text style={[styles.headerTitle, { fontSize: isTablet ? 22 : 18 }]}>{t.alertSimulator}</Text>
        </View>
        <View style={styles.statsContainer}>
          <Text style={[styles.statsText, { fontSize: isTablet ? 14 : 12 }]}>
            {t.generated}: {generatedCount}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { padding: contentPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* MQTT CONNECTION TEST SECTION */}
        <MqttConnectionTest />

        {/* TEST SECTION - NEW */}
        <View style={[styles.section, { marginBottom: sectionSpacing }]}>
          <Text style={[styles.sectionTitle, { fontSize: isTablet ? 18 : 15 }]}>🧪 Kiểm tra Thông báo</Text>
          
          <View style={[styles.testGrid, { gap: isTablet ? 12 : 8 }]}>
            {/* Test Push Notification */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#3B82F6' }]}
              onPress={handleTestNotification}
            >
              <Icon name="bell-ring" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Test Push{'\n'}Notification</Text>
            </TouchableOpacity>

            {/* Test Overlay Dialog */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#8B5CF6' }]}
              onPress={handleTestOverlay}
            >
              <Icon name="message-alert" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Test Overlay{'\n'}Dialog</Text>
            </TouchableOpacity>

            {/* Test Critical Alert */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#DC2626' }]}
              onPress={handleTestCritical}
            >
              <Icon name="alert-octagon" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Test Critical{'\n'}Alert</Text>
            </TouchableOpacity>

            {/* Check Permission */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#059669' }]}
              onPress={handleCheckPermission}
            >
              <Icon name="shield-check" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Kiểm tra{'\n'}Permission</Text>
            </TouchableOpacity>
          </View>

          {/* Test Sound by Severity */}
          <Text style={styles.subSectionTitle}>🔊 Test Âm thanh theo Severity</Text>
          <View style={styles.soundTestRow}>
            {(['critical', 'high', 'medium', 'low', 'info'] as AlertSeverity[]).map((sev) => (
              <TouchableOpacity
                key={sev}
                style={[
                  styles.soundButton,
                  // 3A: severity SURFACE colour, not the on-badge text colour (.color)
                  { paddingVertical: isTablet ? 12 : 8, backgroundColor: SEVERITY_CONFIG[sev].bgColor },
                ]}
                onPress={() => handleTestSound(sev)}
              >
                <Icon name="volume-high" size={isTablet ? 18 : 14} color="#FFFFFF" />
                <Text style={[styles.soundButtonText, { fontSize: isTablet ? 14 : 11 }]}>
                  {sev.charAt(0).toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* DEBUG SECTION */}
          <Text style={styles.subSectionTitle}>🔧 Debug Tools</Text>
          <View style={[styles.testGrid, { gap: isTablet ? 12 : 8 }]}>
            {/* Debug All Services */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#F59E0B' }]}
              onPress={handleDebugServices}
            >
              <Icon name="bug" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Debug{'\n'}Services</Text>
            </TouchableOpacity>

            {/* Direct Notification Test */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#6366F1' }]}
              onPress={handleDirectTestNotification}
            >
              <Icon name="bell-plus" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Direct{'\n'}Notif Test</Text>
            </TouchableOpacity>

            {/* Direct Bubble Test */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#EC4899' }]}
              onPress={handleDirectTestBubble}
            >
              <Icon name="message-plus" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Direct{'\n'}Bubble Test</Text>
            </TouchableOpacity>

            {/* Reset Severity Filter */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#14B8A6' }]}
              onPress={handleResetSeverityFilter}
            >
              <Icon name="refresh" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Reset{'\n'}Filter</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* FLOATING BUBBLE SECTION - NEW */}
        <View style={[styles.section, { marginBottom: sectionSpacing }]}>
          <Text style={[styles.sectionTitle, { fontSize: isTablet ? 18 : 15 }]}>💬 Floating Bubble (Chat Head)</Text>
          <Text style={styles.sectionDescription}>
            Hiển thị icon nổi trên màn hình khi app chạy nền, giống Messenger
          </Text>
          
          <View style={[styles.testGrid, { gap: isTablet ? 12 : 8 }]}>
            {/* Toggle Bubble */}
            <TouchableOpacity
              style={[
                styles.testButton, 
                { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: bubbleEnabled ? '#EF4444' : '#10B981' }
              ]}
              onPress={handleToggleBubble}
            >
              <Icon 
                name={bubbleEnabled ? 'close-circle' : 'chat-processing'} 
                size={isTablet ? 26 : 22} 
                color="#FFFFFF" 
              />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>
                {bubbleEnabled ? 'Tắt Bubble' : 'Bật Bubble'}
              </Text>
            </TouchableOpacity>

            {/* Test Bubble Alert */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#F59E0B' }]}
              onPress={handleTestBubbleAlert}
            >
              <Icon name="message-badge" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Test Bubble{'\n'}Alert</Text>
            </TouchableOpacity>

            {/* Check Overlay Permission */}
            <TouchableOpacity
              style={[styles.testButton, { width: testButtonWidth as any, padding: isTablet ? 14 : 10, backgroundColor: '#6366F1' }]}
              onPress={handleCheckBubblePermission}
            >
              <Icon name="layers" size={isTablet ? 26 : 22} color="#FFFFFF" />
              <Text style={[styles.testButtonText, { fontSize: isTablet ? 13 : 11 }]}>Kiểm tra{'\n'}Overlay</Text>
            </TouchableOpacity>
          </View>

          {bubbleEnabled && (
            <View style={styles.bubbleHint}>
              <Icon name="information" size={16} color="#059669" />
              <Text style={styles.bubbleHintText}>
                Floating Bubble đang bật. Thu nhỏ app để xem icon nổi trên màn hình!
              </Text>
            </View>
          )}
        </View>

        {/* Generate Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.generateType}</Text>
          <View style={styles.typeButtons}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                generateType === 'random' && styles.typeButtonActive,
              ]}
              onPress={() => setGenerateType('random')}
            >
              <Icon
                name="dice-multiple"
                size={20}
                color={
                  generateType === 'random'
                    ? theme.colors.primary
                    : theme.colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.typeButtonText,
                  generateType === 'random' && styles.typeButtonTextActive,
                ]}
              >
                {t.random}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.typeButton,
                generateType === 'specific' && styles.typeButtonActive,
              ]}
              onPress={() => setGenerateType('specific')}
            >
              <Icon
                name="tune"
                size={20}
                color={
                  generateType === 'specific'
                    ? theme.colors.primary
                    : theme.colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.typeButtonText,
                  generateType === 'specific' && styles.typeButtonTextActive,
                ]}
              >
                {t.specific}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Specific Options */}
        {generateType === 'specific' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t.station}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SAMPLE_STATIONS.map((station, index) => (
                  <TouchableOpacity
                    key={station.id}
                    style={[
                      styles.optionChip,
                      selectedStation === index && styles.optionChipActive,
                    ]}
                    onPress={() => setSelectedStation(index)}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        selectedStation === index && styles.optionChipTextActive,
                      ]}
                    >
                      {station.id}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t.product}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SAMPLE_PRODUCTS.map((product, index) => (
                  <TouchableOpacity
                    key={product.id}
                    style={[
                      styles.optionChip,
                      selectedProduct === index && styles.optionChipActive,
                    ]}
                    onPress={() => setSelectedProduct(index)}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        selectedProduct === index && styles.optionChipTextActive,
                      ]}
                    >
                      {product.id}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t.errorType}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SAMPLE_ERRORS.map((error, index) => (
                  <TouchableOpacity
                    key={error.code}
                    style={[
                      styles.optionChip,
                      selectedError === index && styles.optionChipActive,
                    ]}
                    onPress={() => setSelectedError(index)}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        selectedError === index && styles.optionChipTextActive,
                      ]}
                    >
                      {error.code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t.severity}</Text>
              <View style={styles.severityOptions}>
                {(['critical', 'high', 'medium', 'low', 'info'] as AlertSeverity[]).map(
                  (severity) => (
                    <TouchableOpacity
                      key={severity}
                      style={[
                        styles.severityOption,
                        selectedSeverity === severity && {
                          // 3A: surface colour for the selected border (not on-badge text colour)
                          borderColor: SEVERITY_CONFIG[severity].bgColor,
                        },
                      ]}
                      onPress={() => setSelectedSeverity(severity)}
                    >
                      <SeverityBadge severity={severity} size="small" />
                    </TouchableOpacity>
                  )
                )}
              </View>
            </View>
          </>
        )}

        {/* Auto Generate Interval */}
        <View style={[styles.section, { marginBottom: sectionSpacing }]}>
          <Text style={[styles.sectionTitle, { fontSize: isTablet ? 18 : 15 }]}>{t.autoGenerateInterval}</Text>
          <View style={[styles.intervalOptions, { flexWrap: 'wrap' }]}>
            {INTERVALS.map((interval) => (
              <TouchableOpacity
                key={interval.value}
                style={[
                  styles.intervalOption,
                  { paddingHorizontal: isTablet ? 16 : 12, paddingVertical: isTablet ? 10 : 8 },
                  selectedInterval === interval.value && styles.intervalOptionActive,
                ]}
                onPress={() => setSelectedInterval(interval.value)}
              >
                <Text
                  style={[
                    styles.intervalOptionText,
                    { fontSize: isTablet ? 14 : 12 },
                    selectedInterval === interval.value &&
                      styles.intervalOptionTextActive,
                  ]}
                >
                  {interval.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={[styles.actions, { gap: isTablet ? 12 : 8 }]}>
          <TouchableOpacity 
            style={[styles.generateButton, { padding: isTablet ? 16 : 12 }]} 
            onPress={handleGenerateAlert}
          >
            <Icon name="lightning-bolt" size={isTablet ? 26 : 22} color="#FFFFFF" />
            <Text style={[styles.generateButtonText, { fontSize: isTablet ? 16 : 14 }]}>{t.generateAlert}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.autoButton, 
              { padding: isTablet ? 16 : 12 },
              autoGenerateEnabled && styles.autoButtonActive
            ]}
            onPress={handleAutoGenerateToggle}
          >
            <Icon
              name={autoGenerateEnabled ? 'stop' : 'play'}
              size={isTablet ? 26 : 22}
              color={autoGenerateEnabled ? '#FFFFFF' : theme.colors.primary}
            />
            <Text
              style={[
                styles.autoButtonText,
                { fontSize: isTablet ? 16 : 14 },
                autoGenerateEnabled && styles.autoButtonTextActive,
              ]}
            >
              {autoGenerateEnabled ? t.stopAutoGenerate : t.autoGenerate}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.clearButton, { padding: isTablet ? 16 : 12 }]} 
            onPress={handleClearAll}
          >
            <Icon name="delete-sweep" size={isTablet ? 26 : 22} color={theme.colors.error} />
            <Text style={[styles.clearButtonText, { fontSize: isTablet ? 16 : 14 }]}>{t.clearAll}</Text>
          </TouchableOpacity>
        </View>

        {/* Queue info */}
        <View style={[styles.queueInfo, { padding: isTablet ? 16 : 12, marginTop: isTablet ? 20 : 12 }]}>
          <Icon name="clipboard-list" size={isTablet ? 22 : 18} color={theme.colors.textSecondary} />
          <Text style={[styles.queueInfoText, { fontSize: isTablet ? 14 : 12 }]}>
            {language === 'vi' ? 'Hiện tại:' : 'Current:'} {totalCount}{' '}
            {language === 'vi' ? 'alerts trong hàng đợi' : 'alerts in queue'}
          </Text>
        </View>
      </ScrollView>

      {/* Overlay Dialog */}
      <AlertOverlayDialog
        visible={overlayVisible}
        alert={overlayAlert}
        onAcknowledge={handleOverlayAcknowledge}
        onDismiss={handleOverlayDismiss}
        onClose={handleOverlayClose}
        language={language}
      />
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
  },
  statsContainer: {
    backgroundColor: theme.colors.surfaceVariant,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
  },
  statsText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  sectionDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  subSectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  // Test section styles
  testGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  testButton: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    gap: 8,
  },
  testButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  soundTestRow: {
    flexDirection: 'row',
    gap: 8,
  },
  soundButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: theme.borderRadius.md,
    gap: 4,
  },
  soundButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Type buttons
  typeButtons: {
    flexDirection: 'row',
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginRight: theme.spacing.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  typeButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: `${theme.colors.primary}10`,
  },
  typeButtonText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    fontWeight: '600',
    marginLeft: theme.spacing.sm,
  },
  typeButtonTextActive: {
    color: theme.colors.primary,
  },
  // Options
  optionChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginRight: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionChipActive: {
    backgroundColor: `${theme.colors.primary}15`,
    borderColor: theme.colors.primary,
  },
  optionChipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
  },
  optionChipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  severityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  severityOption: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginRight: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  intervalOptions: {
    flexDirection: 'row',
  },
  intervalOption: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginRight: theme.spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  intervalOptionActive: {
    backgroundColor: `${theme.colors.primary}15`,
    borderColor: theme.colors.primary,
  },
  intervalOptionText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  intervalOptionTextActive: {
    color: theme.colors.primary,
  },
  // Actions
  actions: {
    marginTop: theme.spacing.md,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  generateButtonText: {
    fontSize: theme.fontSize.md,
    color: '#FFFFFF',
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
  },
  autoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  autoButtonActive: {
    backgroundColor: theme.colors.error,
    borderColor: theme.colors.error,
  },
  autoButtonText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.primary,
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
  },
  autoButtonTextActive: {
    color: '#FFFFFF',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.colors.error}15`,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  clearButtonText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
  },
  queueInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.md,
  },
  queueInfoText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.sm,
  },
  bubbleHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.md,
  },
  bubbleHintText: {
    fontSize: theme.fontSize.sm,
    color: '#059669',
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
});

export default SimulatorScreen;
