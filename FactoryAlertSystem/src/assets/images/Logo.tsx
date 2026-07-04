/**
 * Factory Alert System - Logo Component
 * SVG Logo for the app
 */

import React from 'react';
import Svg, { Path, Circle, G, Rect } from 'react-native-svg';

interface LogoProps {
  width?: number;
  height?: number;
  color?: string;
}

export const FactoryLogo: React.FC<LogoProps> = ({
  width = 100,
  height = 100,
  color = '#2563EB',
}) => {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100">
      {/* Factory building */}
      <G>
        {/* Main building */}
        <Rect x="10" y="40" width="35" height="50" fill={color} rx="2" />
        <Rect x="55" y="30" width="35" height="60" fill={color} rx="2" />
        
        {/* Chimneys */}
        <Rect x="15" y="25" width="8" height="20" fill={color} />
        <Rect x="32" y="20" width="8" height="25" fill={color} />
        <Rect x="60" y="10" width="10" height="25" fill={color} />
        
        {/* Windows */}
        <Rect x="18" y="50" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="30" y="50" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="18" y="68" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="30" y="68" width="10" height="12" fill="#FFFFFF" rx="1" />
        
        <Rect x="62" y="40" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="77" y="40" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="62" y="58" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="77" y="58" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="62" y="76" width="10" height="12" fill="#FFFFFF" rx="1" />
        <Rect x="77" y="76" width="10" height="12" fill="#FFFFFF" rx="1" />
        
        {/* Alert circle */}
        <Circle cx="80" cy="20" r="15" fill="#DC2626" />
        <Path
          d="M80 10 L80 22 M80 26 L80 28"
          stroke="#FFFFFF"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
};

export const AlertIcon: React.FC<LogoProps> = ({
  width = 24,
  height = 24,
  color = '#DC2626',
}) => {
  return (
    <Svg width={width} height={height} viewBox="0 0 24 24">
      <Path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
        fill={color}
      />
    </Svg>
  );
};

export const ConnectedIcon: React.FC<LogoProps> = ({
  width = 24,
  height = 24,
  color = '#22C55E',
}) => {
  return (
    <Svg width={width} height={height} viewBox="0 0 24 24">
      <Path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
        fill={color}
      />
    </Svg>
  );
};

export const DisconnectedIcon: React.FC<LogoProps> = ({
  width = 24,
  height = 24,
  color = '#EF4444',
}) => {
  return (
    <Svg width={width} height={height} viewBox="0 0 24 24">
      <Path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"
        fill={color}
      />
    </Svg>
  );
};

export default FactoryLogo;
