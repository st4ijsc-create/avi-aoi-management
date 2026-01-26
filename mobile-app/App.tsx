/**
 * AVI/AOI Monitor Mobile App
 * React Native app để nhận thông báo NG qua MQTT
 */

import React, { useEffect } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import HomeScreen from './src/screens/HomeScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import AlertsScreen from './src/screens/AlertsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import NGAlertPopup from './src/components/NGAlertPopup';
import { useMqttStore } from './src/stores/mqttStore';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Tab = createBottomTabNavigator();

export default function App() {
  const { 
    activeAlert, 
    dismissActiveAlert, 
    loadSettings, 
    updateSettings,
    connect,
  } = useMqttStore();

  useEffect(() => {
    // Initialize app
    initializeApp();
  }, []);

  const initializeApp = async () => {
    // Load saved settings
    await loadSettings();

    // Generate device ID if not exists
    const deviceId = Device.deviceName || `device_${Date.now()}`;
    const clientId = `avi_mobile_${deviceId}_${Date.now()}`;
    
    await updateSettings({
      deviceId,
      clientId,
    });

    // Register for push notifications
    await registerForPushNotifications();

    // Auto-connect if settings are configured
    const { settings } = useMqttStore.getState();
    if (settings.brokerUrl && settings.brokerUrl !== 'mqtt://localhost') {
      await connect();
    }
  };

  const registerForPushNotifications = async () => {
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return;
    }

    // Get Expo push token (for Expo notifications)
    try {
      const token = await Notifications.getExpoPushTokenAsync();
      console.log('Expo push token:', token.data);
    } catch (error) {
      console.log('Error getting push token:', error);
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />
      <NavigationContainer>
        <View style={styles.container}>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                let iconName: keyof typeof Ionicons.glyphMap;

                if (route.name === 'Dashboard') {
                  iconName = focused ? 'stats-chart' : 'stats-chart-outline';
                } else if (route.name === 'Home') {
                  iconName = focused ? 'home' : 'home-outline';
                } else if (route.name === 'Alerts') {
                  iconName = focused ? 'notifications' : 'notifications-outline';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'settings' : 'settings-outline';
                } else {
                  iconName = 'help-outline';
                }

                return <Ionicons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: '#3b82f6',
              tabBarInactiveTintColor: '#888',
              tabBarStyle: {
                backgroundColor: '#1a1a2e',
                borderTopColor: '#333',
              },
              headerStyle: {
                backgroundColor: '#1a1a2e',
              },
              headerTintColor: '#fff',
            })}
          >
            <Tab.Screen 
              name="Dashboard" 
              component={DashboardScreen}
              options={{ 
                title: 'Dashboard',
                headerTitle: 'AVI/AOI Monitor',
              }}
            />
            <Tab.Screen 
              name="Home" 
              component={HomeScreen}
              options={{ 
                title: 'Home',
                headerTitle: 'Thống kê',
              }}
            />
            <Tab.Screen 
              name="Alerts" 
              component={AlertsScreen}
              options={{ 
                title: 'Cảnh báo',
                headerTitle: 'Cảnh báo',
              }}
            />
            <Tab.Screen 
              name="Settings" 
              component={SettingsScreen}
              options={{ 
                title: 'Cài đặt',
                headerTitle: 'Cài đặt',
              }}
            />
          </Tab.Navigator>

          {/* NG Alert Popup Overlay */}
          {activeAlert && (
            <NGAlertPopup
              alert={activeAlert}
              onDismiss={dismissActiveAlert}
            />
          )}
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
});
