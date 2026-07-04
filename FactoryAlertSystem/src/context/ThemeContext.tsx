/**
 * Factory Alert System - Theme Provider
 * Quản lý Light/Dark theme cho toàn app
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_THEME, DARK_THEME } from '../utils/constants';

// Theme type
export type ThemeMode = 'light' | 'dark' | 'system';

import type { TextStyle } from 'react-native';

export interface Theme {
  colors: {
    primary: string;
    primaryDark: string;
    secondary: string;
    background: string;
    white: string;
    surface: string;
    surfaceVariant: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    error: string;
    success: string;
    warning: string;
    info: string;
    critical: string;
    high: string;
    medium: string;
    mediumText: string;
    low: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
    full: number;
  };
  fontSize: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
  };
  fontWeight: {
    regular: TextStyle['fontWeight'];
    medium: TextStyle['fontWeight'];
    semibold: TextStyle['fontWeight'];
    bold: TextStyle['fontWeight'];
    heavy: TextStyle['fontWeight'];
  };
  elevation: {
    none: number;
    sm: number;
    md: number;
  };
  isDark: boolean;
}

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@factory_alert_theme';

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
          setThemeModeState(savedTheme as ThemeMode);
        }
      } catch (error) {
        console.error('[ThemeProvider] Error loading theme:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  // Save theme preference
  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('[ThemeProvider] Error saving theme:', error);
    }
  };

  // Toggle between light and dark
  const toggleTheme = () => {
    const newMode = themeMode === 'light' ? 'dark' : 'light';
    setThemeMode(newMode);
  };

  // Determine actual theme based on mode
  const getActualTheme = (): Theme => {
    let isDark = false;
    
    if (themeMode === 'system') {
      isDark = systemColorScheme === 'dark';
    } else {
      isDark = themeMode === 'dark';
    }

    const baseTheme = isDark ? DARK_THEME : LIGHT_THEME;
    
    return {
      ...baseTheme,
      isDark,
    };
  };

  const theme = getActualTheme();

  if (!isLoaded) {
    return null; // Or a loading spinner
  }

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// HOC to inject theme
export const withTheme = <P extends object>(
  WrappedComponent: React.ComponentType<P & { theme: Theme }>
) => {
  return (props: P) => {
    const { theme } = useTheme();
    return <WrappedComponent {...props} theme={theme} />;
  };
};

export default ThemeProvider;
