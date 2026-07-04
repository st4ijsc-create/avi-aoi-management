/**
 * Factory Alert System - Bulletin API Service
 * Service để lấy danh sách bulletins từ server REST API.
 *
 * Gap: 11.3 (Bulletins REST API)
 */

import {
  BulletinListParams,
  BulletinListResponse,
} from '../types';
// MB4 (doc 27): single config source — no hardcoded fallback IP.
// requireServerBaseUrl() throws when unconfigured; callers catch → return null.
import { requireServerBaseUrl, getConfiguredApiKey } from './serverConfig';
// Wave 1 (A3/B2): reshape flat server bulletin rows → app PeriodicBulletin shape.
import { mapServerBulletinRow, normalizePagination } from '../utils/serverMappers';

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

class BulletinApiService {
  private static instance: BulletinApiService;

  static getInstance(): BulletinApiService {
    if (!BulletinApiService.instance) {
      BulletinApiService.instance = new BulletinApiService();
    }
    return BulletinApiService.instance;
  }

  /**
   * Lấy danh sách bulletins từ server (có phân trang + filter)
   * GET /api/external/bulletins
   */
  async fetchBulletins(params: BulletinListParams = {}): Promise<BulletinListResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const query = new URLSearchParams();

      if (params.stationId) query.set('stationId', params.stationId);
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);
      // Server uses offset-based pagination (not page)
      const limit = params.limit ?? 50;
      query.set('limit', String(limit));
      if (params.page != null && params.page > 1) {
        query.set('offset', String((params.page - 1) * limit));
      }

      const url = `${baseUrl}/api/external/bulletins?${query.toString()}`;
      console.log('[BulletinApiService] fetchBulletins:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[BulletinApiService] fetchBulletins HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      // Server returns a FLAT array in `data` + top-level `pagination`
      // (A3/B2): reshape into the app's { data: { bulletins, pagination } } shape.
      const rows: any[] = Array.isArray(result?.data) ? result.data : [];
      console.log('[BulletinApiService] fetchBulletins OK, count:', rows.length);
      return {
        success: result?.success ?? true,
        data: {
          bulletins: rows.map(mapServerBulletinRow),
          pagination: normalizePagination(result?.pagination),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[BulletinApiService] fetchBulletins failed:', msg);
      return null;
    } finally {
      clear();
    }
  }
}

export const bulletinApiService = BulletinApiService.getInstance();
