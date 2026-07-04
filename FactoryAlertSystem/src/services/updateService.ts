/**
 * Factory Alert System - Update Service
 * Service cập nhật phiên bản qua MQTT push từ server
 * Chỉ hỗ trợ: MQTT push update từ server (qua tab Phần mềm)
 */

import { Alert, Linking, Platform, NativeModules, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// TYPES
// ============================================

export interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  apkUrl: string;
  changelog: string[];
  mandatory: boolean;
  minVersionCode?: number; // Phiên bản tối thiểu yêu cầu (nếu < thì bắt buộc cập nhật)
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latestVersion?: string;
  latestVersionCode?: number;
  changelog?: string[];
  apkUrl?: string;
  mandatory?: boolean;
  releaseDate?: string;
  error?: string;
}

export interface DownloadProgress {
  bytesWritten: number;
  contentLength: number;
  percent: number; // 0-100
}

export type UpdateEventType =
  | 'check_start'
  | 'check_done'
  | 'download_start'
  | 'download_progress'
  | 'download_complete'
  | 'download_error'
  | 'install_start';

export type UpdateEventListener = (event: UpdateEventType, data?: any) => void;

// ============================================
// CONSTANTS
// ============================================

// Current app version — MUST match build.gradle versionName/versionCode
// (bumped for doc 27 Đợt 6 — MB2/MB3/MB7/MB8/MB9; was stale at 1.0.9/10 while
// build.gradle had already reached 1.0.15)
const CURRENT_VERSION = '1.0.16';
const CURRENT_VERSION_CODE = 16;

const STORAGE_KEYS = {
  UPDATE_SERVER_URL: 'update_server_url',
  PENDING_UPDATE: 'pending_update',
  LAST_CHECK_TIME: 'update_last_check',
  SKIPPED_VERSION: 'update_skipped_version',
};

// ============================================
// UPDATE SERVICE
// ============================================

class UpdateService {
  private updateServerUrl: string = '';
  private lastCheckTime: number = 0;
  private listeners: UpdateEventListener[] = [];
  private isDownloading: boolean = false;
  private currentLanguage: 'vi' | 'en' | 'zh' = 'vi';

  // ============================================
  // EVENT SYSTEM
  // ============================================

  addEventListener(listener: UpdateEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: UpdateEventType, data?: any): void {
    this.listeners.forEach(l => {
      try { l(event, data); } catch (e) { /* ignore listener errors */ }
    });
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  setUpdateServerUrl(url: string): void {
    this.updateServerUrl = url.replace(/\/$/, '');
    AsyncStorage.setItem(STORAGE_KEYS.UPDATE_SERVER_URL, this.updateServerUrl);
  }

  async getUpdateServerUrl(): Promise<string> {
    if (!this.updateServerUrl) {
      const saved = await AsyncStorage.getItem(STORAGE_KEYS.UPDATE_SERVER_URL);
      this.updateServerUrl = saved || '';
    }
    return this.updateServerUrl;
  }

  // ============================================
  // PULL UPDATE CHECK (version.json)
  // ============================================

  /**
   * W6-B (doc 27 Đợt 6): check the update server's version.json for a newer
   * build. This method was CALLED by mqttService's CHECK_UPDATE/FORCE_UPDATE
   * command handlers (via untyped require) but never existed — server-pushed
   * update commands silently failed with a caught TypeError. Restored here.
   *
   * @param force true = ignore the user's "skip this version" preference
   */
  async checkForUpdates(force: boolean = false): Promise<UpdateCheckResult> {
    const base: UpdateCheckResult = {
      hasUpdate: false,
      currentVersion: CURRENT_VERSION,
      currentVersionCode: CURRENT_VERSION_CODE,
    };

    this.emit('check_start');
    try {
      const serverUrl = await this.getUpdateServerUrl();
      if (!serverUrl) {
        const result = { ...base, error: 'No update server configured' };
        this.emit('check_done', result);
        return result;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(`${serverUrl}/version.json`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        const result = { ...base, error: `Update server returned HTTP ${resp.status}` };
        this.emit('check_done', result);
        return result;
      }

      const info: VersionInfo & { downloadToken?: string } = await resp.json();
      if (!info?.version || !info?.versionCode) {
        const result = { ...base, error: 'Invalid version info from server' };
        this.emit('check_done', result);
        return result;
      }

      await AsyncStorage.setItem(STORAGE_KEYS.LAST_CHECK_TIME, String(Date.now()));

      if (info.versionCode <= CURRENT_VERSION_CODE) {
        const result = { ...base };
        this.emit('check_done', result);
        return result;
      }

      // Respect "skip this version" unless forced
      if (!force) {
        const skipped = await AsyncStorage.getItem(STORAGE_KEYS.SKIPPED_VERSION);
        if (skipped && Number(skipped) === info.versionCode) {
          const result = { ...base };
          this.emit('check_done', result);
          return result;
        }
      }

      // Resolve relative apkUrl against the update server URL
      let apkUrl = info.apkUrl;
      if (apkUrl && !apkUrl.startsWith('http')) {
        apkUrl = `${serverUrl}/${apkUrl.replace(/^\//, '')}`;
      }
      // MB7: carry the short-lived signed token if the server minted one
      if (apkUrl && info.downloadToken && !apkUrl.includes('token=')) {
        const sep = apkUrl.includes('?') ? '&' : '?';
        apkUrl = `${apkUrl}${sep}token=${encodeURIComponent(info.downloadToken)}`;
      }

      const isMandatory =
        info.mandatory ||
        (info.minVersionCode !== undefined && CURRENT_VERSION_CODE < info.minVersionCode);

      const result: UpdateCheckResult = {
        hasUpdate: true,
        currentVersion: CURRENT_VERSION,
        currentVersionCode: CURRENT_VERSION_CODE,
        latestVersion: info.version,
        latestVersionCode: info.versionCode,
        changelog: info.changelog,
        apkUrl,
        mandatory: isMandatory,
        releaseDate: info.releaseDate,
      };
      this.emit('check_done', result);
      return result;
    } catch (error: any) {
      console.error('[UpdateService] checkForUpdates failed:', error?.message || error);
      const result = { ...base, error: error?.message || 'Update check failed' };
      this.emit('check_done', result);
      return result;
    }
  }

  // ============================================
  // MQTT PUSH UPDATE
  // ============================================

  /**
   * Handle MQTT push update from server.
   * Server broadcasts version info via MQTT topic — app compares versionCode.
   * If server versionCode > current → show update dialog.
   * If equal or lower → ignore.
   */
  async handleMqttPushUpdate(versionInfo: VersionInfo, language?: 'vi' | 'en' | 'zh'): Promise<void> {
    const lang = language || this.currentLanguage || 'vi';

    console.log('[UpdateService] Received MQTT push update:', versionInfo.version, 'versionCode:', versionInfo.versionCode);

    if (!versionInfo.version || !versionInfo.versionCode) {
      console.warn('[UpdateService] Invalid version info from MQTT push — missing version/versionCode');
      return;
    }

    if (versionInfo.versionCode <= CURRENT_VERSION_CODE) {
      console.log('[UpdateService] MQTT push version', versionInfo.versionCode, '<= current', CURRENT_VERSION_CODE, '— ignoring');
      return;
    }

    // Resolve APK URL
    let apkUrl = versionInfo.apkUrl;
    const serverUrl = await this.getUpdateServerUrl();
    if (apkUrl && !apkUrl.startsWith('http') && serverUrl) {
      apkUrl = `${serverUrl}/${apkUrl.replace(/^\//, '')}`;
    }

    const isMandatory = versionInfo.mandatory ||
      (versionInfo.minVersionCode !== undefined && CURRENT_VERSION_CODE < versionInfo.minVersionCode);

    const result: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: CURRENT_VERSION,
      currentVersionCode: CURRENT_VERSION_CODE,
      latestVersion: versionInfo.version,
      latestVersionCode: versionInfo.versionCode,
      changelog: versionInfo.changelog,
      apkUrl,
      mandatory: isMandatory,
      releaseDate: versionInfo.releaseDate,
    };

    // Save pending update info to storage
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_UPDATE, JSON.stringify(versionInfo));

    // Check autoUpdate setting via settingsStore
    const getSettingsStore = require('../store/settingsStore').useSettingsStore;
    const autoUpdate = getSettingsStore.getState()?.settings?.app?.autoUpdate ?? true;

    if (isMandatory || autoUpdate) {
      // AutoUpdate ON or mandatory → show dialog immediately (current behavior)
      this.showUpdateDialog(result, lang);
    } else {
      // AutoUpdate OFF → emit event so UI can show pending update badge, don't auto-show dialog
      console.log('[UpdateService] AutoUpdate OFF — stored pending update, not showing dialog');
      this.emit('check_done', result);
    }
  }

  // ============================================
  // UI DIALOGS
  // ============================================

  showUpdateDialog(
    result: UpdateCheckResult,
    language: 'vi' | 'en' | 'zh' = 'vi',
    onDownload?: () => void
  ): void {
    if (!result.hasUpdate || !result.latestVersion) {
      Alert.alert(
        language === 'vi' ? 'Kiểm tra cập nhật' : language === 'zh' ? '检查更新' : 'Check for Updates',
        language === 'vi'
          ? `Bạn đang sử dụng phiên bản mới nhất (${result.currentVersion})`
          : language === 'zh'
          ? `您正在使用最新版本 (${result.currentVersion})`
          : `You are using the latest version (${result.currentVersion})`,
        [{ text: 'OK' }]
      );
      return;
    }

    const changelogText = result.changelog?.length
      ? '\n\n' + result.changelog.map(c => `• ${c}`).join('\n')
      : '';

    const releaseDateText = result.releaseDate
      ? `\n${language === 'vi' ? 'Ngày phát hành' : language === 'zh' ? '发布日期' : 'Released'}: ${result.releaseDate}`
      : '';

    const message = language === 'vi'
      ? `Phiên bản mới ${result.latestVersion} đã sẵn sàng!${releaseDateText}\n\nThay đổi:${changelogText}`
      : language === 'zh'
      ? `新版本 ${result.latestVersion} 已准备就绪！${releaseDateText}\n\n更新内容：${changelogText}`
      : `Version ${result.latestVersion} is available!${releaseDateText}\n\nChanges:${changelogText}`;

    if (result.mandatory) {
      Alert.alert(
        language === 'vi' ? '⚠️ Cập nhật bắt buộc!' : language === 'zh' ? '⚠️ 必须更新！' : '⚠️ Required Update!',
        message,
        [
          {
            text: language === 'vi' ? 'Cập nhật ngay' : language === 'zh' ? '立即更新' : 'Update Now',
            onPress: () => this.downloadAndInstall(result.apkUrl!, onDownload),
          },
        ],
        { cancelable: false }
      );
    } else {
      Alert.alert(
        language === 'vi' ? 'Có phiên bản mới!' : language === 'zh' ? '有新版本可用！' : 'Update Available!',
        message,
        [
          {
            text: language === 'vi' ? 'Bỏ qua phiên bản này' : language === 'zh' ? '跳过此版本' : 'Skip This Version',
            style: 'destructive',
            onPress: () => {
              AsyncStorage.setItem(STORAGE_KEYS.SKIPPED_VERSION, String(result.latestVersionCode));
            },
          },
          {
            text: language === 'vi' ? 'Để sau' : language === 'zh' ? '稍后' : 'Later',
            style: 'cancel',
          },
          {
            text: language === 'vi' ? 'Cập nhật' : language === 'zh' ? '更新' : 'Update',
            onPress: () => this.downloadAndInstall(result.apkUrl!, onDownload),
          },
        ]
      );
    }
  }

  // ============================================
  // DOWNLOAD & INSTALL
  // ============================================

  /**
   * MB7 (doc 27 Đợt 6): fetch a short-lived signed download token from the
   * server's version.json endpoint and append it as ?token=. The APK download
   * route validates this token (HMAC, 15-min TTL). Best-effort: if the fetch
   * fails or the server predates tokens, the URL is returned unchanged — the
   * server keeps accepting token-less requests while
   * FACTORY_ALERT_DOWNLOAD_OPEN=true (its current default) so the existing
   * fleet can still update.
   */
  private async appendDownloadToken(apkUrl: string): Promise<string> {
    if (apkUrl.includes('token=')) return apkUrl;
    try {
      const serverUrl = await this.getUpdateServerUrl();
      if (!serverUrl) return apkUrl;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${serverUrl}/version.json`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return apkUrl;
      const info = await resp.json();
      if (info?.downloadToken) {
        const sep = apkUrl.includes('?') ? '&' : '?';
        return `${apkUrl}${sep}token=${encodeURIComponent(info.downloadToken)}`;
      }
    } catch (error) {
      console.warn('[UpdateService] Could not fetch download token (continuing without):', error);
    }
    return apkUrl;
  }

  /**
   * Download APK and trigger installation.
   * Uses Linking.openURL for reliable download via Android browser/download manager.
   */
  async downloadAndInstall(apkUrl: string, onDownload?: () => void): Promise<void> {
    if (this.isDownloading) {
      console.log('[UpdateService] Download already in progress');
      return;
    }

    try {
      if (Platform.OS !== 'android') {
        Alert.alert('Error', 'Updates are only available on Android');
        return;
      }

      this.isDownloading = true;
      this.emit('download_start', { url: apkUrl });
      console.log('[UpdateService] Starting download:', apkUrl);

      onDownload?.();

      // MB7: attach short-lived signed token (see appendDownloadToken)
      const tokenizedUrl = await this.appendDownloadToken(apkUrl);

      // Open APK URL — Android's DownloadManager will handle the download
      // and prompt user to install when complete
      // Encode spaces and special chars in URL
      const encodedUrl = tokenizedUrl.replace(/ /g, '%20');
      await Linking.openURL(encodedUrl);
      this.emit('download_complete');

      // Clear pending update after successful download initiation
      await this.clearPendingUpdate();
    } catch (error: any) {
      console.error('[UpdateService] Download failed:', error);
      this.emit('download_error', { error: error?.message });
      Alert.alert(
        'Lỗi tải cập nhật / Download Error',
        `Không thể tải cập nhật. Vui lòng thử lại.\nCannot download update.\n\nURL: ${apkUrl}\nError: ${error?.message || 'Unknown'}`
      );
    } finally {
      this.isDownloading = false;
    }
  }

  // ============================================
  // VERSION INFO
  // ============================================

  getCurrentVersion(): { version: string; versionCode: number } {
    return { version: CURRENT_VERSION, versionCode: CURRENT_VERSION_CODE };
  }

  async hasPendingUpdate(): Promise<boolean> {
    try {
      const pending = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_UPDATE);
      if (!pending) return false;
      const versionInfo: VersionInfo = JSON.parse(pending);
      return versionInfo.versionCode > CURRENT_VERSION_CODE;
    } catch {
      return false;
    }
  }

  async getPendingUpdateInfo(): Promise<VersionInfo | null> {
    try {
      const pending = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_UPDATE);
      if (!pending) return null;
      const versionInfo: VersionInfo = JSON.parse(pending);
      if (versionInfo.versionCode > CURRENT_VERSION_CODE) {
        return versionInfo;
      }
      return null;
    } catch {
      return null;
    }
  }

  async clearPendingUpdate(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_UPDATE);
  }

  /**
   * Manually show update dialog for pending update (used when autoUpdate is OFF).
   * User explicitly tapped the manual update button.
   */
  async showPendingUpdateDialog(language?: 'vi' | 'en' | 'zh'): Promise<void> {
    const pending = await this.getPendingUpdateInfo();
    if (!pending) return;

    const lang = language || this.currentLanguage || 'vi';
    let apkUrl = pending.apkUrl;
    const serverUrl = await this.getUpdateServerUrl();
    if (apkUrl && !apkUrl.startsWith('http') && serverUrl) {
      apkUrl = `${serverUrl}/${apkUrl.replace(/^\//, '')}`;
    }

    const isMandatory = pending.mandatory ||
      (pending.minVersionCode !== undefined && CURRENT_VERSION_CODE < pending.minVersionCode);

    const result: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: CURRENT_VERSION,
      currentVersionCode: CURRENT_VERSION_CODE,
      latestVersion: pending.version,
      latestVersionCode: pending.versionCode,
      changelog: pending.changelog,
      apkUrl,
      mandatory: isMandatory,
      releaseDate: pending.releaseDate,
    };

    this.showUpdateDialog(result, lang);
  }

  async clearSkippedVersion(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.SKIPPED_VERSION);
  }

  getIsDownloading(): boolean {
    return this.isDownloading;
  }

  // ============================================
  // CLEANUP
  // ============================================

  cleanup(): void {
    this.listeners = [];
  }
}

export const updateService = new UpdateService();
export default updateService;
