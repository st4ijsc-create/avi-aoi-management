/**
 * Factory Alert System - Dashboard Service
 * Service để lấy KPI dashboard summary từ server.
 *
 * Gaps: 11.4 (Dashboard KPI), 11.5 (Export/Report API), 11.8 (User Preferences)
 */

import {
  DashboardSummaryParams,
  DashboardSummaryResponse,
  UserPreferencesData,
  UserPreferencesResponse,
} from '../types';
// MB4 (doc 27): single config source — no hardcoded fallback IP.
// requireServerBaseUrl() throws when unconfigured; callers catch → return null.
import { requireServerBaseUrl, getConfiguredApiKey } from './serverConfig';

function getBaseUrl(): string {
  return requireServerBaseUrl();
}

function getApiKey(): string {
  return getConfiguredApiKey();
}

/**
 * Build headers for /api/external/* endpoints.
 * Only sends x-master-key — avoids stale Bearer/Cookie.
 */
function buildExternalHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['x-master-key'] = apiKey;
  }
  return headers;
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

class DashboardService {
  private static instance: DashboardService;

  static getInstance(): DashboardService {
    if (!DashboardService.instance) {
      DashboardService.instance = new DashboardService();
    }
    return DashboardService.instance;
  }

  /**
   * Lấy dashboard summary (KPI tổng quan)
   * GET /api/external/dashboard/summary
   */
  async fetchDashboardSummary(params: DashboardSummaryParams = {}): Promise<DashboardSummaryResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const query = new URLSearchParams();

      // Server only accepts 'since' param — convert period to a since date
      if (params.period) {
        const now = new Date();
        let since: Date;
        switch (params.period) {
          case 'today':
            since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          default:
            since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
        query.set('since', since.toISOString());
      }
      // Note: stationIds and shiftId are not supported by the server endpoint

      const url = `${baseUrl}/api/external/dashboard/summary?${query.toString()}`;
      console.log('[DashboardService] fetchDashboardSummary:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[DashboardService] fetchDashboardSummary HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      console.log('[DashboardService] fetchDashboardSummary OK');
      return result as DashboardSummaryResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[DashboardService] fetchDashboardSummary failed:', msg);
      return null;
    } finally {
      clear();
    }
  }

  // NOTE (doc 32, Wave R3, decision #5): the former `generateReport()` — which
  // POSTed to the stub `/api/external/reports/generate` to server-render a
  // report FILE for the phone to download — was removed. Mobile stays light:
  // FullReportModal now deep-links into the full WEB report (see
  // services/webReportLink.ts) instead of downloading a rendered file.

  /**
   * Lấy user preferences từ server
   * GET /api/external/user/preferences
   */
  async getUserPreferences(): Promise<UserPreferencesResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/external/user/preferences`;
      console.log('[DashboardService] getUserPreferences');

      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[DashboardService] getUserPreferences HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      console.log('[DashboardService] getUserPreferences OK');
      return result as UserPreferencesResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[DashboardService] getUserPreferences failed:', msg);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Cập nhật user preferences lên server
   * PUT /api/external/user/preferences
   */
  async updateUserPreferences(data: UserPreferencesData): Promise<UserPreferencesResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/external/user/preferences`;
      console.log('[DashboardService] updateUserPreferences');

      const response = await fetch(url, {
        method: 'PUT',
        headers: buildExternalHeaders(),
        body: JSON.stringify(data),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[DashboardService] updateUserPreferences HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      console.log('[DashboardService] updateUserPreferences OK');
      return result as UserPreferencesResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[DashboardService] updateUserPreferences failed:', msg);
      return null;
    } finally {
      clear();
    }
  }
}

export const dashboardService = DashboardService.getInstance();
