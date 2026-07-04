/**
 * Factory Alert System - Network Monitor Service
 * Giám sát chất lượng mạng với 6 phương pháp:
 * 1. NetInfo - Loại mạng & tín hiệu
 * 2. Continuous Monitor - Theo dõi liên tục (rolling latency)
 * 3. Throughput Test - Kiểm tra băng thông
 * 4. MQTT RTT - Đo round-trip qua MQTT
 * 5. DNS Resolution - Thời gian phân giải DNS
 * 6. Server Health - Kiểm tra sức khỏe server
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { NetworkMethodResult, NetworkMonitorConfig } from '../types';
import { DEFAULT_NETWORK_MONITOR_CONFIG } from '../utils/constants';

// Lazy getter to avoid circular dependency
const getMqttService = () => require('./mqttService').mqttService;
const getSettingsStore = () => require('../store/settingsStore').useSettingsStore;

class NetworkMonitorService {
  private config: NetworkMonitorConfig = { ...DEFAULT_NETWORK_MONITOR_CONFIG };
  private rollingLatencies: number[] = [];
  private maxRollingSize = 50;

  /**
   * Update config from store
   */
  public updateConfig(config: NetworkMonitorConfig): void {
    this.config = { ...config };
  }

  /**
   * Run all enabled methods and return results
   */
  public async runAllMethods(config?: NetworkMonitorConfig): Promise<NetworkMethodResult[]> {
    const cfg = config || this.config;
    const results: NetworkMethodResult[] = [];

    const methods: Array<{ enabled: boolean; runner: () => Promise<NetworkMethodResult> }> = [
      { enabled: cfg.netInfoEnabled, runner: () => this.runNetInfo() },
      { enabled: cfg.continuousMonitorEnabled, runner: () => this.runContinuousMonitor(cfg) },
      { enabled: cfg.throughputTestEnabled, runner: () => this.runThroughputTest(cfg) },
      { enabled: cfg.mqttRttEnabled, runner: () => this.runMqttRtt(cfg) },
      { enabled: cfg.dnsTestEnabled, runner: () => this.runDnsTest(cfg) },
      { enabled: cfg.serverHealthEnabled, runner: () => this.runServerHealth() },
    ];

    for (const m of methods) {
      if (m.enabled) {
        try {
          const result = await m.runner();
          results.push(result);
        } catch (error: any) {
          results.push({
            method: 'unknown',
            status: 'failed',
            details: error?.message || 'Unknown error',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return results;
  }

  /**
   * Calculate overall quality score from results
   */
  public calculateOverallScore(results: NetworkMethodResult[]): {
    score: number;
    status: 'good' | 'fair' | 'poor' | 'failed';
  } {
    if (results.length === 0) return { score: 0, status: 'failed' };

    const activeResults = results.filter(r => r.status !== 'disabled');
    if (activeResults.length === 0) return { score: 0, status: 'failed' };

    const statusScores: Record<string, number> = {
      good: 100,
      fair: 60,
      poor: 30,
      failed: 0,
    };

    const totalScore = activeResults.reduce((sum, r) => sum + (statusScores[r.status] || 0), 0);
    const avgScore = Math.round(totalScore / activeResults.length);

    let status: 'good' | 'fair' | 'poor' | 'failed';
    if (avgScore >= 80) status = 'good';
    else if (avgScore >= 50) status = 'fair';
    else if (avgScore >= 20) status = 'poor';
    else status = 'failed';

    return { score: avgScore, status };
  }

  // ============================================================
  // Method 1: NetInfo - Network Type & Signal
  // ============================================================
  private async runNetInfo(): Promise<NetworkMethodResult> {
    try {
      const state: NetInfoState = await NetInfo.fetch();
      const ts = new Date().toISOString();

      if (!state.isConnected) {
        return {
          method: 'netInfo',
          status: 'failed',
          details: 'No network connection',
          timestamp: ts,
        };
      }

      const type = state.type || 'unknown';
      const isReachable = state.isInternetReachable;
      const detailParts: string[] = [`Type: ${type}`];

      if (state.details) {
        const d = state.details as any;
        if (d.strength !== undefined) detailParts.push(`Signal: ${d.strength}%`);
        if (d.ssid) detailParts.push(`SSID: ${d.ssid}`);
        if (d.frequency) detailParts.push(`Freq: ${d.frequency}MHz`);
        if (d.ipAddress) detailParts.push(`IP: ${d.ipAddress}`);
        if (d.cellularGeneration) detailParts.push(`Gen: ${d.cellularGeneration}`);
      }

      if (isReachable === false) detailParts.push('Internet: unreachable');

      let status: 'good' | 'fair' | 'poor' | 'failed';
      if (isReachable && (type === 'wifi' || type === 'ethernet')) {
        status = 'good';
      } else if (isReachable && type === 'cellular') {
        status = 'fair';
      } else if (state.isConnected && isReachable === null) {
        status = 'fair';
      } else {
        status = 'poor';
      }

      return {
        method: 'netInfo',
        status,
        details: detailParts.join(' | '),
        timestamp: ts,
      };
    } catch (error: any) {
      return {
        method: 'netInfo',
        status: 'failed',
        details: `NetInfo error: ${error?.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ============================================================
  // Method 2: Continuous Monitor - Rolling Latency
  // ============================================================
  private async runContinuousMonitor(cfg: NetworkMonitorConfig): Promise<NetworkMethodResult> {
    const ts = new Date().toISOString();
    const pingCount = cfg.pingCount || 5;

    try {
      const store = getSettingsStore();
      const settings = store.getState().settings;
      const baseUrl = settings.app.apiBaseUrl || 'http://localhost:5000';

      const latencies: number[] = [];
      let failed = 0;

      for (let i = 0; i < pingCount; i++) {
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          await fetch(`${baseUrl}/health`, { signal: controller.signal });
          clearTimeout(timeout);
          latencies.push(Date.now() - start);
        } catch {
          failed++;
        }
      }

      if (latencies.length === 0) {
        return { method: 'continuousMonitor', status: 'failed', details: `All ${pingCount} pings failed`, timestamp: ts };
      }

      // Add to rolling window
      this.rollingLatencies.push(...latencies);
      if (this.rollingLatencies.length > this.maxRollingSize) {
        this.rollingLatencies = this.rollingLatencies.slice(-this.maxRollingSize);
      }

      const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      const jitter = max - min;
      const lossRate = Math.round((failed / pingCount) * 100);

      let status: 'good' | 'fair' | 'poor' | 'failed';
      if (avg < cfg.latencyThresholdGood && jitter < 100 && lossRate < 10) status = 'good';
      else if (avg < cfg.latencyThresholdFair && jitter < 200 && lossRate < 30) status = 'fair';
      else status = 'poor';

      return {
        method: 'continuousMonitor',
        status,
        latencyMs: avg,
        details: `Avg: ${avg}ms | Min: ${min}ms | Max: ${max}ms | Jitter: ${jitter}ms | Loss: ${lossRate}% | Rolling: ${this.rollingLatencies.length}`,
        timestamp: ts,
      };
    } catch (error: any) {
      return { method: 'continuousMonitor', status: 'failed', details: error?.message, timestamp: ts };
    }
  }

  // ============================================================
  // Method 3: Throughput Test - Download Bandwidth
  // ============================================================
  private async runThroughputTest(cfg: NetworkMonitorConfig): Promise<NetworkMethodResult> {
    const ts = new Date().toISOString();
    try {
      const store = getSettingsStore();
      const settings = store.getState().settings;
      const baseUrl = settings.app.apiBaseUrl || 'http://localhost:5000';
      const sizeKB = cfg.throughputTestSizeKB || 100;

      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`${baseUrl}/api/network/speedtest?size=${sizeKB}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return { method: 'throughputTest', status: 'failed', details: `HTTP ${response.status}`, timestamp: ts };
      }

      const blob = await response.blob();
      const elapsed = Date.now() - start;
      const bytesReceived = blob.size;
      const speedKBps = Math.round((bytesReceived / 1024) / (elapsed / 1000));

      let status: 'good' | 'fair' | 'poor' | 'failed';
      if (speedKBps > 500) status = 'good';
      else if (speedKBps > 100) status = 'fair';
      else status = 'poor';

      return {
        method: 'throughputTest',
        status,
        latencyMs: elapsed,
        details: `Speed: ${speedKBps} KB/s | Size: ${Math.round(bytesReceived / 1024)} KB | Time: ${elapsed}ms`,
        timestamp: ts,
      };
    } catch (error: any) {
      return { method: 'throughputTest', status: 'failed', details: error?.message, timestamp: ts };
    }
  }

  // ============================================================
  // Method 4: MQTT RTT - Round-Trip Time
  // ============================================================
  private async runMqttRtt(cfg: NetworkMonitorConfig): Promise<NetworkMethodResult> {
    const ts = new Date().toISOString();
    try {
      const mqtt = getMqttService();
      const pingCount = cfg.pingCount || 5;
      const latencies: number[] = [];
      let failed = 0;

      if (!mqtt.isConnected()) {
        return { method: 'mqttRtt', status: 'failed', details: 'MQTT not connected', timestamp: ts };
      }

      for (let i = 0; i < pingCount; i++) {
        try {
          const rtt = await mqtt.measureRtt();
          latencies.push(rtt);
        } catch {
          failed++;
        }
      }

      if (latencies.length === 0) {
        return { method: 'mqttRtt', status: 'failed', details: `All ${pingCount} MQTT tests failed`, timestamp: ts };
      }

      const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      const jitter = max - min;
      const lossRate = Math.round((failed / pingCount) * 100);

      let status: 'good' | 'fair' | 'poor' | 'failed';
      if (avg < cfg.latencyThresholdGood && jitter < 100 && lossRate < 10) status = 'good';
      else if (avg < cfg.latencyThresholdFair && jitter < 200 && lossRate < 30) status = 'fair';
      else status = 'poor';

      return {
        method: 'mqttRtt',
        status,
        latencyMs: avg,
        details: `Avg: ${avg}ms | Min: ${min}ms | Max: ${max}ms | Jitter: ${jitter}ms | Loss: ${lossRate}% (${latencies.length}/${pingCount})`,
        timestamp: ts,
      };
    } catch (error: any) {
      return { method: 'mqttRtt', status: 'failed', details: error?.message, timestamp: ts };
    }
  }

  // ============================================================
  // Method 5: DNS Resolution Test
  // ============================================================
  private async runDnsTest(cfg: NetworkMonitorConfig): Promise<NetworkMethodResult> {
    const ts = new Date().toISOString();
    try {
      const store = getSettingsStore();
      const settings = store.getState().settings;
      const brokerHost = settings.mqtt.brokerAddress || 'localhost';

      // Use HTTP fetch to the broker host to measure DNS + TCP combined resolution time
      const pingCount = cfg.pingCount || 5;
      const latencies: number[] = [];
      let failed = 0;

      for (let i = 0; i < pingCount; i++) {
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          // Fetch a URL that requires DNS resolution
          await fetch(`http://${brokerHost}:${settings.mqtt.port || 8083}/`, {
            signal: controller.signal,
            mode: 'no-cors',
          }).catch(() => {
            // Even failed connections measure DNS+TCP time
          });
          clearTimeout(timeout);
          latencies.push(Date.now() - start);
        } catch {
          failed++;
          latencies.push(Date.now() - start); // Still log time for failed connections
        }
      }

      if (latencies.length === 0) {
        return { method: 'dnsTest', status: 'failed', details: 'DNS test failed', timestamp: ts };
      }

      const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);

      let status: 'good' | 'fair' | 'poor' | 'failed';
      if (avg < 50) status = 'good';
      else if (avg < 200) status = 'fair';
      else status = 'poor';

      return {
        method: 'dnsTest',
        status,
        latencyMs: avg,
        details: `Host: ${brokerHost} | Avg: ${avg}ms | Min: ${min}ms | Max: ${max}ms`,
        timestamp: ts,
      };
    } catch (error: any) {
      return { method: 'dnsTest', status: 'failed', details: error?.message, timestamp: ts };
    }
  }

  // ============================================================
  // Method 6: Server Health Check
  // ============================================================
  private async runServerHealth(): Promise<NetworkMethodResult> {
    const ts = new Date().toISOString();
    try {
      const store = getSettingsStore();
      const settings = store.getState().settings;
      const baseUrl = settings.app.apiBaseUrl || 'http://localhost:5000';

      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${baseUrl}/api/network/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const elapsed = Date.now() - start;

      if (!response.ok) {
        return { method: 'serverHealth', status: 'failed', latencyMs: elapsed, details: `HTTP ${response.status}`, timestamp: ts };
      }

      const data = await response.json();
      const detailParts: string[] = [];
      detailParts.push(`Uptime: ${data.uptime || '?'}`);
      detailParts.push(`Memory: ${data.memoryUsageMB || '?'}MB`);
      detailParts.push(`MQTT: ${data.mqttStatus || '?'}`);
      detailParts.push(`DB: ${data.dbStatus || '?'}`);
      detailParts.push(`Clients: ${data.mqttClients ?? '?'}`);

      let status: 'good' | 'fair' | 'poor' | 'failed';
      const mqttOk = data.mqttStatus === 'running';
      const dbOk = data.dbStatus === 'connected';

      if (mqttOk && dbOk && elapsed < 500) status = 'good';
      else if ((mqttOk || dbOk) && elapsed < 2000) status = 'fair';
      else status = 'poor';

      return {
        method: 'serverHealth',
        status,
        latencyMs: elapsed,
        details: detailParts.join(' | '),
        timestamp: ts,
      };
    } catch (error: any) {
      return { method: 'serverHealth', status: 'failed', details: error?.message, timestamp: ts };
    }
  }
}

export const networkMonitorService = new NetworkMonitorService();
