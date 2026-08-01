/**
 * Factory Alert System - Keep Awake Service
 * Giữ màn hình sáng khi có alerts pending
 */

import { useEffect, useRef } from 'react';
import { Platform, NativeModules } from 'react-native';

// Flag to track if native module is available
let KeepAwakeModule: any = null;

try {
  // Try to get the native module if react-native-keep-awake is installed
  KeepAwakeModule = NativeModules.KCKeepAwake;
} catch (e) {
  console.log('[KeepAwake] Native module not available, using fallback');
}

/**
 * Activate keep awake
 */
export const activateKeepAwake = (tag?: string): void => {
  try {
    if (KeepAwakeModule) {
      KeepAwakeModule.activate();
      console.log('[KeepAwake] Activated');
    } else {
      // Fallback: log warning
      console.log('[KeepAwake] Native module not available - screen may dim');
    }
  } catch (error) {
    console.error('[KeepAwake] Error activating:', error);
  }
};

/**
 * Deactivate keep awake
 */
export const deactivateKeepAwake = (tag?: string): void => {
  try {
    if (KeepAwakeModule) {
      KeepAwakeModule.deactivate();
      console.log('[KeepAwake] Deactivated');
    }
  } catch (error) {
    console.error('[KeepAwake] Error deactivating:', error);
  }
};

/**
 * Hook to keep screen awake while component is mounted
 */
export const useKeepAwake = (tag?: string): void => {
  useEffect(() => {
    activateKeepAwake(tag);
    return () => {
      deactivateKeepAwake(tag);
    };
  }, [tag]);
};

/**
 * Hook to keep screen awake based on condition
 */
export const useKeepAwakeConditional = (
  shouldKeepAwake: boolean,
  tag?: string
): void => {
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (shouldKeepAwake && !isActiveRef.current) {
      activateKeepAwake(tag);
      isActiveRef.current = true;
    } else if (!shouldKeepAwake && isActiveRef.current) {
      deactivateKeepAwake(tag);
      isActiveRef.current = false;
    }

    return () => {
      if (isActiveRef.current) {
        deactivateKeepAwake(tag);
        isActiveRef.current = false;
      }
    };
  }, [shouldKeepAwake, tag]);
};

/**
 * Component to keep screen awake when rendered
 */
import React from 'react';

interface KeepAwakeProps {
  children?: React.ReactNode;
  tag?: string;
}

export const KeepAwake: React.FC<KeepAwakeProps> = ({ children, tag }) => {
  useKeepAwake(tag);
  return children ?? null;
};

/**
 * Keep awake service singleton
 */
class KeepAwakeService {
  private static instance: KeepAwakeService;
  private activeTags: Set<string> = new Set();
  private isEnabled: boolean = true;

  private constructor() {}

  static getInstance(): KeepAwakeService {
    if (!KeepAwakeService.instance) {
      KeepAwakeService.instance = new KeepAwakeService();
    }
    return KeepAwakeService.instance;
  }

  /**
   * Enable/disable keep awake globally
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      // Deactivate all
      this.activeTags.forEach(tag => {
        deactivateKeepAwake(tag);
      });
      this.activeTags.clear();
    }
  }

  /**
   * Activate for a specific tag
   */
  activate(tag: string = 'default'): void {
    if (!this.isEnabled) return;
    
    if (!this.activeTags.has(tag)) {
      activateKeepAwake(tag);
      this.activeTags.add(tag);
    }
  }

  /**
   * Deactivate for a specific tag
   */
  deactivate(tag: string = 'default'): void {
    if (this.activeTags.has(tag)) {
      deactivateKeepAwake(tag);
      this.activeTags.delete(tag);
    }
  }

  /**
   * Deactivate all
   */
  deactivateAll(): void {
    this.activeTags.forEach(tag => {
      deactivateKeepAwake(tag);
    });
    this.activeTags.clear();
  }

  /**
   * Check if any tag is active
   */
  isActive(): boolean {
    return this.activeTags.size > 0;
  }
}

export const keepAwakeService = KeepAwakeService.getInstance();
export default keepAwakeService;
