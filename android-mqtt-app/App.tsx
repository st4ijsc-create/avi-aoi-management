/**
 * AVI MQTT App - Android Application for Factory Monitoring
 * Receives MQTT notifications and displays them as bubble overlays
 */

import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import NotificationHistoryScreen from './src/screens/NotificationHistoryScreen';
import StationConfigScreen from './src/screens/StationConfigScreen';

// Services
import { initNotificationService } from './src/services/notificationService';

const Stack = createNativeStackNavigator();

// Custom dark theme for industrial look
const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#14b8a6', // Teal
    secondary: '#06b6d4', // Cyan
    background: '#0f172a', // Slate 900
    surface: '#1e293b', // Slate 800
    error: '#ef4444', // Red
    onBackground: '#f1f5f9',
    onSurface: '#f1f5f9',
  },
};

export default function App() {
  useEffect(() => {
    // Initialize notification service on app start.
    // MQTT connection is now started manually from the UI
    // to avoid errors before the user is ready.
    const initServices = async () => {
      await initNotificationService();
    };
    
    initServices();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: '#1e293b' },
              headerTintColor: '#f1f5f9',
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          >
            <Stack.Screen 
              name="Home" 
              component={HomeScreen}
              options={{ title: 'AVI MQTT Monitor' }}
            />
            <Stack.Screen 
              name="Settings" 
              component={SettingsScreen}
              options={{ title: 'Cài đặt' }}
            />
            <Stack.Screen 
              name="NotificationHistory" 
              component={NotificationHistoryScreen}
              options={{ title: 'Lịch sử thông báo' }}
            />
            <Stack.Screen 
              name="StationConfig" 
              component={StationConfigScreen}
              options={{ title: 'Cấu hình công trạm' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
