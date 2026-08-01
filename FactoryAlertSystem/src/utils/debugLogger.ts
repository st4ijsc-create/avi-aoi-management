/**
 * Debug Logger for StationDetailScreen
 * Captures API requests/responses and user actions for debugging
 */

import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DebugLogType = 'API_REQUEST' | 'API_RESPONSE' | 'API_ERROR' | 'USER_ACTION' | 'SYSTEM' | 'MQTT';

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  type: DebugLogType;
  tag: string;
  message: string;
  data?: any;
  durationMs?: number;
}

const MAX_ENTRIES = 800;

class DebugLogger {
  private static instance: DebugLogger;
  private logs: DebugLogEntry[] = [];
  private idCounter = 0;
  private enabled = false;
  private listeners: Set<() => void> = new Set();

  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.notify();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private addEntry(type: DebugLogType, tag: string, message: string, data?: any, durationMs?: number) {
    if (!this.enabled) return;
    const entry: DebugLogEntry = {
      id: ++this.idCounter,
      timestamp: new Date().toISOString(),
      type,
      tag,
      message,
      data: data !== undefined ? this.truncateData(data) : undefined,
      durationMs,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_ENTRIES) {
      this.logs = this.logs.slice(-MAX_ENTRIES);
    }
    this.notify();
  }

  private truncateData(data: any): any {
    if (data === null || data === undefined) return data;
    // Pre-process: strip long base64 data URIs from objects before stringifying
    const sanitized = this.stripBase64(data);
    const str = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);
    if (str && str.length > 2000) {
      return str.substring(0, 2000) + `... [truncated, total ${str.length} chars]`;
    }
    return sanitized;
  }

  /** Recursively replace long base64 data URIs with a short placeholder */
  private stripBase64(obj: any, depth = 0): any {
    if (depth > 5 || obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      if (obj.startsWith('data:image/') && obj.length > 200) {
        return `[base64 image, ${Math.round(obj.length / 1024)}KB]`;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripBase64(item, depth + 1));
    }
    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        result[key] = this.stripBase64(obj[key], depth + 1);
      }
      return result;
    }
    return obj;
  }

  // API logging
  apiRequest(tag: string, method: string, url: string, params?: any) {
    this.addEntry('API_REQUEST', tag, `${method} ${url}`, params);
  }

  apiResponse(tag: string, status: number, data: any, durationMs?: number) {
    const summary = this.summarizeResponse(data);
    this.addEntry('API_RESPONSE', tag, `HTTP ${status} — ${summary}`, data, durationMs);
  }

  apiError(tag: string, error: any, durationMs?: number) {
    const msg = error instanceof Error ? error.message : String(error);
    this.addEntry('API_ERROR', tag, msg, undefined, durationMs);
  }

  // User action logging
  action(tag: string, message: string, data?: any) {
    this.addEntry('USER_ACTION', tag, message, data);
  }

  // System events
  system(tag: string, message: string, data?: any) {
    this.addEntry('SYSTEM', tag, message, data);
  }

  // MQTT events
  mqtt(tag: string, message: string, data?: any) {
    this.addEntry('MQTT', tag, message, data);
  }

  private summarizeResponse(data: any): string {
    if (!data) return 'null';
    if (typeof data === 'string') return `string(${data.length})`;
    if (data.success !== undefined) {
      const parts = [`success=${data.success}`];
      if (data.data) {
        if (Array.isArray(data.data)) parts.push(`items=${data.data.length}`);
        else if (data.data.points) parts.push(`points=${data.data.points.length}`);
        else if (data.data.totalInspections !== undefined) parts.push(`total=${data.data.totalInspections}`);
      }
      return parts.join(', ');
    }
    if (Array.isArray(data)) return `array(${data.length})`;
    return `object(${Object.keys(data).length} keys)`;
  }

  getLogs(): DebugLogEntry[] {
    return this.logs;
  }

  getLogCount(): number {
    return this.logs.length;
  }

  clear() {
    this.logs = [];
    this.idCounter = 0;
    this.notify();
  }

  async exportToFile(): Promise<string | null> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `debug_log_${timestamp}`;
      const content = this.formatFullLog();
      await AsyncStorage.setItem(key, content);
      // Also share immediately
      await Share.share({
        message: content,
        title: 'Factory Alert System — Debug Log',
      });
      return key;
    } catch (err) {
      console.error('[DebugLogger] exportToFile error:', err);
      return null;
    }
  }

  async shareLog(): Promise<void> {
    const content = this.formatFullLog();
    await Share.share({
      message: content,
      title: 'Factory Alert System — Debug Log',
    });
  }

  private formatFullLog(): string {
    const header = [
      '═══════════════════════════════════════════════════',
      ' Factory Alert System — Debug Log',
      ` Exported: ${new Date().toISOString()}`,
      ` Entries: ${this.logs.length}`,
      '═══════════════════════════════════════════════════',
      '',
    ].join('\n');

    const body = this.logs.map((e) => {
      const dur = e.durationMs !== undefined ? ` [${e.durationMs}ms]` : '';
      const dataStr = e.data !== undefined
        ? `\n    DATA: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)}`
        : '';
      return `[${e.timestamp}] [${e.type}] [${e.tag}]${dur}\n    ${e.message}${dataStr}`;
    }).join('\n\n');

    return header + body;
  }
}

export const debugLogger = DebugLogger.getInstance();
