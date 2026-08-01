/**
 * Factory Alert System - Main App Component
 * Entry point của ứng dụng React Native
 */

import React, { useEffect, useState, useCallback, useRef, Component, ErrorInfo } from 'react';
import { StatusBar, View, Text, TouchableOpacity, StyleSheet as RNStyles, AppState, AppStateStatus } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  AlertDetailScreen,
  SettingsScreen,
  SimulatorScreen,
  BulletinDetailScreen,
  StationDetailScreen,
  NotificationCenterScreen,
  OnboardingScreen,
} from './src/screens';
import {
  useAlertStore,
  useSettingsStore,
  useConnectionStore,
  useBulletinStore,
  useStationInspectionStore,
  selectPendingCount,
  selectLanguage,
  selectUnreadCount,
  flushAlerts,
  flushBulletins,
} from './src/store';
import { ThemeProvider, useTheme } from './src/context';
import { RootStackParamList, BottomTabParamList } from './src/types';
import { TRANSLATIONS } from './src/utils/constants';
import { mqttService } from './src/services/mqttService';
import { notificationService } from './src/services/notificationService';
import { soundService } from './src/services/soundService';
import { keepAwakeService, useKeepAwakeConditional } from './src/services/keepAwakeService';
import { floatingBubbleService } from './src/services/floatingBubbleService';
import { alertFilterService } from './src/services/alertFilterService';
import { overlayAlertService } from './src/services/overlayAlertService';
import { hierarchyService } from './src/services/hierarchyService';
import { updateService } from './src/services/updateService';
import { authService } from './src/services/authService';
import { stationService } from './src/services/stationService';
import { isServerConfigured } from './src/services/serverConfig';
import { BulletinOverlayDialog, AlertOverlayDialog } from './src/components';
import { PeriodicBulletin, Alert as AlertType } from './src/types';

// Create navigators
const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<BottomTabParamList>();

// Navigation ref for navigating from outside NavigationContainer
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Error Boundary — prevents white screen crash from overlay render errors
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] Caught render error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.icon}>⚠️</Text>
          <Text style={errorStyles.title}>Đã xảy ra lỗi</Text>
          <Text style={errorStyles.message}>
            {this.state.error?.message || 'Unknown error'}
          </Text>
          <TouchableOpacity style={errorStyles.button} onPress={this.handleReset}>
            <Text style={errorStyles.buttonText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = RNStyles.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#1E293B', marginBottom: 8 },
  message: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});

/**
 * Bottom Tab Navigator
 */
const TabNavigator: React.FC = () => {
  const pendingCount = useAlertStore(selectPendingCount);
  const unreadBulletinCount = useBulletinStore(selectUnreadCount);
  const language = useSettingsStore(selectLanguage);
  // Wave 4B: the Simulator tab is a developer tool — only registered when Debug
  // Mode is ON (Settings → App Settings → Debug Mode). Hidden in production.
  const debugMode = useSettingsStore((s) => s.settings.app.debugMode);
  const isStationFullScreen = useStationInspectionStore((s) => s.isStationFullScreen);
  const { theme } = useTheme();
  const t = TRANSLATIONS[language];

  const totalBadge = pendingCount + unreadBulletinCount;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: isStationFullScreen
          ? { display: 'none' as const }
          : {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingBottom: 4,
              paddingTop: 4,
              height: 60,
            },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string;

          switch (route.name) {
            case 'NotificationCenter':
              iconName = focused ? 'bell' : 'bell-outline';
              break;
            case 'Stations':
              iconName = focused ? 'magnify-scan' : 'magnify-scan';
              break;
            case 'Settings':
              iconName = focused ? 'cog' : 'cog-outline';
              break;
            case 'Simulator':
              iconName = focused ? 'flask' : 'flask-outline';
              break;
            default:
              iconName = 'help-circle-outline';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
        options={{
          tabBarLabel: t.notificationCenter,
          tabBarBadge: totalBadge > 0 ? totalBadge : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.error,
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: '700',
          },
        }}
      />
      <Tab.Screen
        name="Stations"
        component={StationDetailScreen}
        options={{
          tabBarLabel: t.stations,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: t.settings,
        }}
      />
      {debugMode && (
        <Tab.Screen
          name="Simulator"
          component={SimulatorScreen}
          options={{
            tabBarLabel: t.simulator,
          }}
        />
      )}
    </Tab.Navigator>
  );
};

/**
 * App Content with Navigation
 */
const AppContent: React.FC = () => {
  const { theme } = useTheme();
  const pendingCount = useAlertStore(selectPendingCount);
  const keepScreenOn = useSettingsStore((state) => state.settings.app.keepScreenOn);

  // Keep screen awake when there are pending alerts and setting is enabled
  useKeepAwakeConditional(keepScreenOn && pendingCount > 0, 'pending-alerts');

  return (
    <>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen
            name="AlertDetail"
            component={AlertDetailScreen}
            options={{
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="BulletinDetail"
            component={BulletinDetailScreen}
            options={{
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="StationDetail"
            component={StationDetailScreen}
            options={{
              animation: 'slide_from_bottom',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

/**
 * Main App Component
 */
const App: React.FC = () => {
  const loadAlerts = useAlertStore((state) => state.loadAlerts);
  const addAlert = useAlertStore((state) => state.addAlert);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const setShowMqttDisconnectDialog = useConnectionStore((state) => state.setShowMqttDisconnectDialog);
  const loadBulletins = useBulletinStore((state) => state.loadBulletins);
  const addBulletin = useBulletinStore((state) => state.addBulletin);
  const markBulletinAsRead = useBulletinStore((state) => state.markAsRead);
  const language = useSettingsStore(selectLanguage);

  // Bulletin overlay state
  const [bulletinOverlayVisible, setBulletinOverlayVisible] = useState(false);
  const [overlayBulletin, setOverlayBulletin] = useState<PeriodicBulletin | null>(null);

  // Alert overlay dialog state (replaces native overlayAlertService in foreground)
  const [alertOverlayVisible, setAlertOverlayVisible] = useState(false);
  const [overlayAlertData, setOverlayAlertData] = useState<AlertType | null>(null);

  // Track app foreground/background state
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // Store pending bulletin to show when returning to foreground
  const pendingBulletinRef = useRef<PeriodicBulletin | null>(null);

  // MB4 (doc 27): onboarding gate — null = settings still loading,
  // false = no server configured → show OnboardingScreen, true = normal app
  const [configured, setConfigured] = useState<boolean | null>(null);

  /**
   * Server-dependent bootstrap: auto-login, MQTT configure, hierarchy topics,
   * connect. Runs at startup when a server is configured, and again right
   * after the user completes onboarding.
   */
  const bootstrapServer = useCallback(async () => {
    const currentSettings = useSettingsStore.getState().settings;

    // Auto-login if credentials are saved
    if (currentSettings.app.apiBaseUrl && currentSettings.app.apiUsername && currentSettings.app.apiPassword) {
      try {
        console.log('[App] Auto-login with saved credentials...');
        await authService.loadSession();
        const session = authService.getSession();
        if (!session) {
          const loginResult = await authService.login(
            currentSettings.app.apiBaseUrl,
            currentSettings.app.apiUsername,
            currentSettings.app.apiPassword,
            currentSettings.app.apiKey,
          );
          console.log('[App] Auto-login result:', loginResult.success ? 'success' : loginResult.message);
        } else {
          console.log('[App] Restored saved auth session');
        }
      } catch (error) {
        console.warn('[App] Auto-login failed:', (error as Error).message);
      }
    }

    // Configure MQTT service
    mqttService.configure(currentSettings.mqtt);

    // Resolve MQTT topics from API server if in hierarchy mode
    if (currentSettings.app.subscriptionMode === 'hierarchy'
        && currentSettings.app.apiBaseUrl
        && currentSettings.app.apiBaseUrl !== 'http://localhost:3000') {
      try {
        console.log('[App] Fetching hierarchy tree from API:', currentSettings.app.apiBaseUrl);
        const factories = await hierarchyService.fetchTree(currentSettings.app.apiBaseUrl, currentSettings.app.apiKey);
        console.log('[App] Hierarchy tree loaded:', factories.length, 'factories');

        // Populate station store directly from hierarchy data
        useStationInspectionStore.getState().populateFromHierarchy(factories);

        const savedKeys = currentSettings.app.hierarchySelectedKeys || [];
        if (savedKeys.length > 0) {
          const topics = hierarchyService.getTopicsFromSelection(savedKeys, factories);
          if (topics.length > 0) {
            // MB6: always keep the escalation feed alongside hierarchy topics
            if (!topics.includes('avi/escalations/#')) {
              topics.push('avi/escalations/#');
            }
            mqttService.configure({ topics });
            // Sync resolved topics to settings store so screens read correct topics
            useSettingsStore.getState().updateMqttConfig({ topics });
            console.log('[App] MQTT topics resolved from API hierarchy:', topics.length, 'topics');
          } else {
            console.log('[App] No topics generated from hierarchy selection, using saved topics');
          }
        } else {
          console.log('[App] No hierarchy keys selected, using saved/default topics');
        }
      } catch (error) {
        console.warn('[App] Failed to fetch hierarchy from API, using saved/default topics:', (error as Error).message);
      }
    } else if (currentSettings.app.subscriptionMode !== 'hierarchy') {
      console.log('[App] Subscription mode is manual, using configured topics');
    } else {
      console.log('[App] API Server URL not configured or is localhost, using default topics');
    }

    // Set update server URL for MQTT push updates
    if (currentSettings.app.updateServerUrl) {
      updateService.setUpdateServerUrl(currentSettings.app.updateServerUrl);
    }

    // Auto-connect if enabled
    if (currentSettings.app.autoReconnect) {
      try {
        await mqttService.connect();
        console.log('[App] MQTT connected');
      } catch (error) {
        console.log('[App] MQTT connection failed:', error);
      }
    }
  }, []);

  // Called by OnboardingScreen after the config is saved
  const handleConfigured = useCallback(() => {
    console.log('[App] Onboarding complete — bootstrapping server connection');
    setConfigured(true);
    bootstrapServer().catch((err) =>
      console.error('[App] Post-onboarding bootstrap failed:', err)
    );
  }, [bootstrapServer]);

  // Listen to AppState changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // App came back to foreground
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[App] App returned to foreground');
        // Show pending bulletin overlay if any
        if (pendingBulletinRef.current) {
          const bulletin = pendingBulletinRef.current;
          pendingBulletinRef.current = null;
          setOverlayBulletin(bulletin);
          setBulletinOverlayVisible(true);
          console.log('[App] Showing pending bulletin overlay for:', bulletin.bulletinId);
        }
      } else if (
        appStateRef.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // Wave 2A: app going to background/inactive — flush any debounced disk
        // writes immediately so nothing is lost if the OS suspends/kills us.
        flushAlerts();
        flushBulletins();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleBulletinOverlayMarkRead = useCallback(() => {
    if (overlayBulletin) {
      markBulletinAsRead(overlayBulletin.bulletinId);
    }
    setBulletinOverlayVisible(false);
    setOverlayBulletin(null);
  }, [overlayBulletin, markBulletinAsRead]);

  const handleBulletinOverlayDismiss = useCallback(() => {
    setBulletinOverlayVisible(false);
    setOverlayBulletin(null);
  }, []);

  // Navigate to BulletinDetail from overlay dialog
  const handleBulletinOverlayViewDetail = useCallback(() => {
    if (overlayBulletin) {
      const bulletinId = overlayBulletin.bulletinId;
      // Mark as read
      markBulletinAsRead(bulletinId);
      // Close overlay
      setBulletinOverlayVisible(false);
      setOverlayBulletin(null);
      // Navigate to detail screen
      if (navigationRef.isReady()) {
        navigationRef.navigate('BulletinDetail', { bulletinId });
        console.log('[App] Navigating to BulletinDetail:', bulletinId);
      }
    }
  }, [overlayBulletin, markBulletinAsRead]);

  // Alert overlay dialog handlers
  const handleAlertOverlayAcknowledge = useCallback(() => {
    setAlertOverlayVisible(false);
    setOverlayAlertData(null);
  }, []);

  const handleAlertOverlayDismiss = useCallback(() => {
    setAlertOverlayVisible(false);
    setOverlayAlertData(null);
  }, []);

  const handleAlertOverlayClose = useCallback(() => {
    setAlertOverlayVisible(false);
    setOverlayAlertData(null);
  }, []);

  // Initialize app
  useEffect(() => {
    const initApp = async () => {
      console.log('[App] Initializing Factory Alert System...');

      try {
        // Load settings first
        await loadSettings();
        console.log('[App] Settings loaded');

        // Lấy settings mới nhất sau khi load từ AsyncStorage
        const currentSettings = useSettingsStore.getState().settings;

        // Load alerts
        await loadAlerts();
        console.log('[App] Alerts loaded');

        // Load bulletins
        await loadBulletins();
        console.log('[App] Bulletins loaded');

        // Load station inspection data (restore after crash/restart)
        await useStationInspectionStore.getState().loadStationData();
        console.log('[App] Station inspection data loaded');

        // Initialize notification service
        await notificationService.initialize();
        console.log('[App] Notification service initialized');

        // Configure sound service
        soundService.setEnabled(currentSettings.notifications.sound);
        console.log('[App] Sound service configured');

        // Configure keep awake service
        keepAwakeService.setEnabled(currentSettings.app.keepScreenOn);
        console.log('[App] Keep awake service configured');

        // Check floating bubble permission — disable if no permission on first install
        if (currentSettings.notifications.floatingBubbleEnabled) {
          try {
            const hasBubblePermission = await floatingBubbleService.checkPermission();
            if (!hasBubblePermission) {
              console.log('[App] No overlay permission — disabling floatingBubbleEnabled');
              useSettingsStore.getState().updateNotificationConfig({ floatingBubbleEnabled: false });
            }
          } catch (err) {
            console.warn('[App] Bubble permission check failed:', err);
          }
        }

        // MB4: onboarding gate — decide BEFORE any server-dependent bootstrap
        const serverConfigured = isServerConfigured();
        setConfigured(serverConfigured);
        if (!serverConfigured) {
          console.log('[App] No server configured — showing onboarding, deferring server bootstrap');
        }

        // Setup MQTT callbacks
        // Note: mqttService.setConnectionStatus() now syncs directly to Zustand store,
        // but we keep this callback for App-level logging
        mqttService.setOnConnectionChange((status, error) => {
          console.log('[App] MQTT connection status:', status, error);
          // Store sync is handled inside mqttService.setConnectionStatus()
        });

        // Callback khi tất cả lần health retry thất bại
        mqttService.setOnAllRetriesFailed(() => {
          console.error('[App] MQTT all health retries failed - showing disconnect dialog');
          setShowMqttDisconnectDialog(true);
        });

        // Callback khi MQTT reconnect thành công — re-fetch dữ liệu station/workstation
        mqttService.setOnReconnectSuccess(() => {
          console.log('[App] ✅ MQTT reconnected — re-fetching station data and syncing server time');
          // Re-sync server time
          stationService.syncServerTime().catch((e) =>
            console.warn('[App] Server time re-sync after reconnect failed:', e instanceof Error ? e.message : e)
          );
          // Re-fetch station names from API
          useStationInspectionStore.getState().fetchStationNames();
        });

        mqttService.setOnMessage((alert) => {
          try {
          // Wave 2C: this callback fires on EVERY MQTT alert. All diagnostic logs
          // (incl. the JSON.stringify payload dump) are guarded by __DEV__ so Metro
          // dead-code-eliminates them from release — no per-message CPU/GC cost.
          if (__DEV__) {
            console.log('========================================');
            console.log('[App] 🔔 MQTT MESSAGE RECEIVED');
            console.log('[App] Alert ID:', alert.alertId);
            console.log('[App] Severity:', alert.severity);
            console.log('[App] Station:', alert.station?.name);
            console.log('[App] Error:', alert.error?.type);
            console.log('========================================');
          }

          // Lấy settings hiện tại
          const currentSettings = useSettingsStore.getState().settings;
          if (__DEV__) console.log('[App] Current notification settings:', JSON.stringify(currentSettings.notifications, null, 2));

          // Kiểm tra filter trước khi xử lý
          const shouldNotify = alertFilterService.shouldShowNotification(
            alert,
            currentSettings.notifications
          );

          if (__DEV__) console.log('[App] shouldNotify result:', shouldNotify);

          // Luôn thêm alert vào store để ghi log (chỉ khi notifications enabled)
          if (currentSettings.notifications.enabled) {
            addAlert(alert);
            if (__DEV__) console.log('[App] Alert added to store');
          } else {
            if (__DEV__) console.log('[App] Alert NOT stored — notifications disabled');
          }

          // Dispatch alert to station inspection store for real-time PCB updates
          useStationInspectionStore.getState().processAlert(alert);

          if (shouldNotify) {
            if (__DEV__) console.log('[App] ✅ Alert PASSED filter, showing notifications...');

            const isAppActive = appStateRef.current === 'active';
            const dialogOverlayEnabled = currentSettings.notifications.showAlertDialog !== false;

            // Khi dialogOverlay BẬT và app đang active → bỏ qua notification + overlay dialog
            // Chỉ hiển thị khi app ở background hoặc app khác đè lên
            const suppressNotification = dialogOverlayEnabled && isAppActive;

            // 1. Hiển thị push notification (bỏ qua khi app active + dialogOverlay bật)
            if (suppressNotification) {
              if (__DEV__) console.log('[App] Suppressing notification — app is active & dialogOverlay enabled');
            } else {
              if (__DEV__) console.log('[App] Calling notificationService.showAlert...');
              notificationService.showAlert(alert).then(id => {
                if (__DEV__) console.log('[App] Notification result:', id ? `Success (${id})` : 'Failed/Skipped');
              }).catch(err => {
                console.error('[App] Notification error:', err);
              });
            }

            // 2. Phát âm thanh nếu enabled
            if (currentSettings.notifications.sound) {
              if (__DEV__) console.log('[App] Playing sound for severity:', alert.severity);
              soundService.playAlertSound(alert.severity);
            }

            // 3. Hiển thị floating bubble nếu enabled
            if (currentSettings.notifications.floatingBubbleEnabled) {
              if (__DEV__) console.log('[App] Calling floatingBubbleService.showAlert...');
              floatingBubbleService.showAlert(alert, useAlertStore.getState().pendingCount)
                .then(() => { if (__DEV__) console.log('[App] Bubble shown successfully'); })
                .catch(err => console.error('[App] Bubble error:', err));
            } else {
              if (__DEV__) console.log('[App] Floating bubble is DISABLED in settings');
            }

            // 4. Hiển thị overlay alert cho critical/high — CHỈ khi app ở background
            if (dialogOverlayEnabled && (alert.severity === 'critical' || alert.severity === 'high')) {
              if (!isAppActive) {
                // Background: dùng native overlay alert (SYSTEM_ALERT_WINDOW via FloatingBubbleService)
                const displayDurationMs = (currentSettings.notifications.overlayDisplayDuration || 15) * 1000;
                if (__DEV__) console.log('[App] Critical/High alert - calling floatingBubbleService.showOverlayAlert (background), duration:', displayDurationMs);
                floatingBubbleService.showOverlayAlert(alert, displayDurationMs)
                  .then(() => { if (__DEV__) console.log('[App] Overlay alert shown successfully'); })
                  .catch(err => console.error('[App] Overlay alert error:', err));
              } else {
                if (__DEV__) console.log('[App] Critical/High alert - suppressed overlay dialog (app is active)');
              }
            }
          } else {
            if (__DEV__) console.log('[App] ❌ Alert FILTERED OUT, not showing notification');
          }
          } catch (err) {
            console.error('[App] ❌ CRITICAL: Error in onMessage callback:', err instanceof Error ? err.message : err);
          }
        });

        // Setup notification press callback
        notificationService.setOnNotificationPress((alertId) => {
          console.log('[App] Notification pressed:', alertId);
          // Navigation will be handled by deep linking in a production app
        });

        // MB6 (doc 27): server escalation notices → mark the alert escalated
        // (badge/filter in UI). Idempotent — retained messages re-applied on
        // reconnect are no-ops.
        mqttService.setOnEscalation((notice) => {
          if (__DEV__) console.log('[App] ⏫ ALERT_ESCALATION received:', notice.alertId);
          useAlertStore.getState().markEscalated(notice.alertId, notice.escalatedAt);
        });

        // Setup MQTT bulletin callback
        mqttService.setOnBulletin((bulletin) => {
          try {
            // Wave 2C: per-bulletin diagnostics guarded by __DEV__ (stripped in release).
            if (__DEV__) {
              console.log('========================================');
              console.log('[App] \uD83D\uDCCA PERIODIC BULLETIN RECEIVED');
              console.log('[App] Bulletin ID:', bulletin.bulletinId);
              console.log('[App] Station:', bulletin.stationId, '-', bulletin.stationName);
              console.log('[App] Period:', bulletin.period?.start, '->', bulletin.period?.end);
              console.log('[App] App state:', appStateRef.current);
              console.log('========================================');
            }

            // Kiểm tra notifications enabled trước khi lưu trữ và hiển thị bulletin
            const bulletinSettings = useSettingsStore.getState().settings;
            if (!bulletinSettings.notifications.enabled) {
              if (__DEV__) console.log('[App] Bulletin NOT stored — notifications disabled');
              // Still process for KPI updates but don't store or show UI
              const pollingEnabled = bulletinSettings.app.proactivePollingEnabled ?? false;
              if (!pollingEnabled) {
                useStationInspectionStore.getState().processBulletin(bulletin);
                if (__DEV__) console.log('[App] Bulletin KPI update applied (notifications disabled, polling disabled)');
              }
              return;
            }

            addBulletin(bulletin);
            if (__DEV__) console.log('[App] Bulletin added to store');

            // Dispatch bulletin to station inspection store for real-time KPI updates
            // Only update KPI from bulletin when proactive polling is disabled (mutual exclusion)
            const pollingEnabled = useSettingsStore.getState().settings.app.proactivePollingEnabled ?? false;
            if (!pollingEnabled) {
              useStationInspectionStore.getState().processBulletin(bulletin);
              if (__DEV__) console.log('[App] Bulletin KPI update applied (polling disabled)');
            } else {
              if (__DEV__) console.log('[App] Bulletin KPI update skipped — proactive polling is active');
            }

            if (appStateRef.current === 'active') {
              // App is in foreground — show React Native Modal overlay
              setOverlayBulletin(bulletin);
              setBulletinOverlayVisible(true);
              if (__DEV__) console.log('[App] Bulletin overlay dialog shown (foreground)');
            } else {
              // App is in background — show native overlay + store pending
              if (__DEV__) console.log('[App] App in background, showing native bulletin overlay');
              pendingBulletinRef.current = bulletin;
              floatingBubbleService.showBulletinOverlay(bulletin)
                .then((shown) => {
                  if (__DEV__) console.log(shown
                    ? '[App] Native bulletin overlay shown successfully'
                    : '[App] Native bulletin overlay failed (no permission?)');
                })
                .catch(err => console.error('[App] Native bulletin overlay error:', err));
            }
          } catch (error) {
            console.error('[App] Error processing bulletin:', error);
          }
        });

        // Setup bulletin action callback from native overlay
        floatingBubbleService.setOnBulletinAction((bulletinId, action) => {
          console.log('[App] Bulletin action from native:', action, bulletinId);
          if (action === 'viewDetail') {
            // Clear pending bulletin since user chose to view detail
            pendingBulletinRef.current = null;
            markBulletinAsRead(bulletinId);
            // Navigate to detail (app is brought to foreground by native side)
            setTimeout(() => {
              if (navigationRef.isReady()) {
                navigationRef.navigate('BulletinDetail', { bulletinId });
                console.log('[App] Navigated to BulletinDetail from native overlay:', bulletinId);
              }
            }, 500);
          } else if (action === 'dismissed') {
            // Clear pending bulletin
            pendingBulletinRef.current = null;
          }
        });

        // Server-dependent bootstrap (auto-login, MQTT configure + topics,
        // connect) — only when configured; otherwise deferred until the
        // onboarding screen calls handleConfigured().
        if (serverConfigured) {
          await bootstrapServer();
        }

        console.log('[App] Initialization complete ✓');
      } catch (error) {
        console.error('[App] Initialization error:', error);
      }
    };

    initApp();

    // Cleanup on unmount
    return () => {
      mqttService.disconnect();
      keepAwakeService.deactivateAll();
      floatingBubbleService.cleanup();
      updateService.cleanup();
    };
  }, []);

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            {/* MB4: gate the main navigator until a server is configured.
                configured === null → settings still loading (brief blank). */}
            {configured === false ? (
              <OnboardingScreen onConfigured={handleConfigured} />
            ) : configured === null ? null : (
              <AppContent />
            )}
            <BulletinOverlayDialog
              visible={bulletinOverlayVisible}
              bulletin={overlayBulletin}
              onMarkRead={handleBulletinOverlayMarkRead}
              onDismiss={handleBulletinOverlayDismiss}
              onViewDetail={handleBulletinOverlayViewDetail}
              language={language}
            />
            <AlertOverlayDialog
              visible={alertOverlayVisible}
              alert={overlayAlertData}
              onAcknowledge={handleAlertOverlayAcknowledge}
              onDismiss={handleAlertOverlayDismiss}
              onClose={handleAlertOverlayClose}
              language={language}
            />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
};

export default App;
