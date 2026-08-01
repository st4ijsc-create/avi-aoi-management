/**
 * Factory Alert System - Responsive Hook
 * Hook để detect screen size và điều chỉnh layout cho tablet/phone
 */

import { useWindowDimensions } from 'react-native';
import { useMemo } from 'react';

export interface ResponsiveValues {
  // Screen info
  width: number;
  height: number;
  isTablet: boolean;
  isLandscape: boolean;
  
  // Layout
  columns: number;
  contentMaxWidth: number;
  contentPadding: number;

  // Global font scale factor (~1.15 on tablet) — multiply base font sizes by this
  scale: number;
  
  // Spacing
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  
  // Font sizes
  fontSize: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  
  // Component sizes
  buttonHeight: number;
  inputHeight: number;
  iconSize: {
    sm: number;
    md: number;
    lg: number;
  };
  
  // Grid
  gridItemWidth: number;
  gridGap: number;
}

export const useResponsive = (): ResponsiveValues => {
  const { width, height } = useWindowDimensions();
  
  return useMemo(() => {
    // Tablet class is orientation-independent: use the SHORT edge so a tablet
    // stays "tablet" in both portrait and landscape (and a rotated phone in
    // landscape is never misdetected as a tablet).
    const shortEdge = Math.min(width, height);
    const isTablet = shortEdge >= 600;
    const isLandscape = width > height;

    // Columns based on screen width
    const columns = width >= 900 ? 3 : width >= 600 ? 2 : 1;
    
    // Content max width for tablets
    const contentMaxWidth = isTablet ? Math.min(width * 0.9, 1200) : width;
    const contentPadding = isTablet ? 24 : 16;
    
    // Responsive spacing
    const baseSpacing = isTablet ? 1.25 : 1;
    const spacing = {
      xs: Math.round(4 * baseSpacing),
      sm: Math.round(8 * baseSpacing),
      md: Math.round(12 * baseSpacing),
      lg: Math.round(16 * baseSpacing),
      xl: Math.round(24 * baseSpacing),
    };
    
    // Responsive font sizes — `scale` is also exported so screens can scale
    // arbitrary (non-token) sizes consistently.
    const baseFontScale = isTablet ? 1.15 : 1;
    const scale = baseFontScale;
    const fontSize = {
      xs: Math.round(10 * baseFontScale),
      sm: Math.round(12 * baseFontScale),
      md: Math.round(14 * baseFontScale),
      lg: Math.round(16 * baseFontScale),
      xl: Math.round(20 * baseFontScale),
      xxl: Math.round(24 * baseFontScale),
    };
    
    // Component sizes
    const buttonHeight = isTablet ? 52 : 44;
    const inputHeight = isTablet ? 52 : 44;
    const iconSize = {
      sm: isTablet ? 18 : 16,
      md: isTablet ? 24 : 20,
      lg: isTablet ? 32 : 28,
    };
    
    // Grid calculations
    const gridGap = isTablet ? 16 : 12;
    const availableWidth = contentMaxWidth - (contentPadding * 2);
    const gridColumns = isTablet && isLandscape ? 4 : isTablet ? 3 : 2;
    const gridItemWidth = (availableWidth - (gridGap * (gridColumns - 1))) / gridColumns;
    
    return {
      width,
      height,
      isTablet,
      isLandscape,
      columns,
      contentMaxWidth,
      contentPadding,
      scale,
      spacing,
      fontSize,
      buttonHeight,
      inputHeight,
      iconSize,
      gridItemWidth,
      gridGap,
    };
  }, [width, height]);
};

export default useResponsive;
