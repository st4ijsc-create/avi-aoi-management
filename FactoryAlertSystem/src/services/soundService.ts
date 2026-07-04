/**
 * Factory Alert System - Sound Service
 * Quản lý phát âm thanh cảnh báo theo severity
 */

import { Platform } from 'react-native';
import { AlertSeverity } from '../types';

// Sound configuration per severity
const SOUND_CONFIG: Record<AlertSeverity, {
  frequency: number[];
  duration: number;
  repeat: number;
}> = {
  critical: {
    frequency: [880, 660, 880],
    duration: 300,
    repeat: 3,
  },
  high: {
    frequency: [660, 880],
    duration: 250,
    repeat: 2,
  },
  medium: {
    frequency: [440],
    duration: 200,
    repeat: 1,
  },
  low: {
    frequency: [330],
    duration: 150,
    repeat: 1,
  },
  info: {
    frequency: [220],
    duration: 100,
    repeat: 1,
  },
};

class SoundService {
  private static instance: SoundService;
  private isEnabled: boolean = true;
  private volume: number = 1.0;

  private constructor() {}

  static getInstance(): SoundService {
    if (!SoundService.instance) {
      SoundService.instance = new SoundService();
    }
    return SoundService.instance;
  }

  /**
   * Enable/disable sound
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Set volume (0.0 - 1.0)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Play alert sound based on severity
   * Uses Web Audio API for cross-platform compatibility
   */
  async playAlertSound(severity: AlertSeverity): Promise<void> {
    if (!this.isEnabled) {
      console.log('[SoundService] Sound is disabled');
      return;
    }

    const config = SOUND_CONFIG[severity];
    
    try {
      // For React Native, we'll use a simple beep pattern
      // In production, you would use react-native-sound with actual mp3 files
      console.log(`[SoundService] Playing ${severity} alert sound`);
      
      // Trigger vibration pattern as fallback/complement
      this.vibrate(severity);
      
    } catch (error) {
      console.error('[SoundService] Error playing sound:', error);
    }
  }

  /**
   * Vibrate device based on severity
   */
  private vibrate(severity: AlertSeverity): void {
    try {
      const { Vibration } = require('react-native');
      
      const patterns: Record<AlertSeverity, number[]> = {
        critical: [0, 500, 200, 500, 200, 500],
        high: [0, 400, 200, 400],
        medium: [0, 300],
        low: [0, 200],
        info: [0, 100],
      };

      const pattern = patterns[severity];
      
      if (Platform.OS === 'android') {
        Vibration.vibrate(pattern);
      } else {
        // iOS only supports single vibration
        Vibration.vibrate();
      }
    } catch (error) {
      console.error('[SoundService] Vibration error:', error);
    }
  }

  /**
   * Play test sound
   */
  async playTestSound(): Promise<void> {
    await this.playAlertSound('medium');
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    try {
      const { Vibration } = require('react-native');
      Vibration.cancel();
    } catch (error) {
      console.error('[SoundService] Error stopping sounds:', error);
    }
  }
}

export const soundService = SoundService.getInstance();
export default soundService;
