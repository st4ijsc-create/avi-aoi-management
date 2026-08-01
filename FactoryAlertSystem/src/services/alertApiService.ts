/**
 * Factory Alert System - Alert API Service
 * Service để đồng bộ trạng thái alert với server (acknowledge/resolve)
 * và lấy lịch sử alert từ server.
 *
 * Gaps: 11.1 (Alert Acknowledge/Resolve Sync), 11.2 (Alert History API)
 */

import {
  Alert,
  AlertStatus,
  AlertAcknowledgeRequest,
  AlertResolveRequest,
  AlertActionResponse,
  AlertHistoryParams,
  AlertHistoryResponse,
  AlertDetailResponse,
} from '../types';
// MB4 (doc 27): single config source — no hardcoded fallback IP.
// requireServerBaseUrl() throws when unconfigured; every method catches and
// returns null, so an unconfigured app simply skips server sync.
import { requireServerBaseUrl, getConfiguredApiKey } from './serverConfig';
// Wave 1: reshape flat server rows → app shapes + ack/resolve source guard.
import {
  mapServerAlertRow,
  normalizePagination,
  isValidSourceForOperation,
  sourceOfAlertId,
  AckResolveOperation,
} from '../utils/serverMappers';

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

class AlertApiService {
  private static instance: AlertApiService;

  static getInstance(): AlertApiService {
    if (!AlertApiService.instance) {
      AlertApiService.instance = new AlertApiService();
    }
    return AlertApiService.instance;
  }

  /**
   * POST helper with v2 → legacy fallback: tries the v2 endpoint first (records
   * comment + real identity, doc 27 MB5/MB6); a 404 (older server without v2)
   * falls back to the legacy endpoint so acks never get lost during rollout.
   *
   * A1 source-guard: the server parses `alertId.split('-')[0]` as the source and
   * only accepts `alert`/`conn` for acknowledge and `mqtt`/`conn` for resolve.
   * Business ids (ALT-…/NGRATE-…/NG-…) are rejected with HTTP 400, so we skip the
   * network call entirely (one warning, no 400-spam) and return a local-only
   * success sentinel — the store has already updated local state.
   */
  private async postAction(
    alertId: string,
    operation: AckResolveOperation,
    v2Path: string,
    legacyPath: string,
    body: Record<string, unknown>,
  ): Promise<AlertActionResponse | null> {
    if (!isValidSourceForOperation(alertId, operation)) {
      const localStatus: AlertStatus = operation === 'acknowledge' ? 'acknowledged' : 'resolved';
      console.warn(
        `[AlertApiService] ${operation} skipped for "${alertId}" — source "${sourceOfAlertId(alertId)}" is not a valid ${operation} target on the server; local state updated only.`,
      );
      return { success: true, alertId, status: localStatus };
    }

    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const encodedId = encodeURIComponent(alertId);

      let response = await fetch(`${baseUrl}/api/external/alerts/${encodedId}/${v2Path}`, {
        method: 'POST',
        headers: buildExternalHeaders(),
        body: JSON.stringify(body),
        signal,
      });

      if (response.status === 404) {
        // Older server without the v2 endpoint — retry legacy (comment is dropped there)
        console.log(`[AlertApiService] ${v2Path} not available (404), falling back to ${legacyPath}`);
        response = await fetch(`${baseUrl}/api/external/alerts/${encodedId}/${legacyPath}`, {
          method: 'POST',
          headers: buildExternalHeaders(),
          body: JSON.stringify(body),
          signal,
        });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(
          `[AlertApiService] ${operation} failed for "${alertId}" (HTTP ${response.status}): ${text.substring(0, 160)}`,
        );
        return null;
      }

      const result = await response.json();
      console.log(`[AlertApiService] ${operation} OK:`, alertId);
      return result as AlertActionResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AlertApiService] ${operation} failed:`, msg);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Acknowledge alert trên server (kèm danh tính thật + ghi chú — MB5/MB6)
   * POST /api/external/alerts/{alertId}/acknowledge-v2 (fallback: /acknowledge)
   */
  async acknowledgeAlert(alertId: string, data: AlertAcknowledgeRequest): Promise<AlertActionResponse | null> {
    console.log('[AlertApiService] acknowledgeAlert:', alertId);
    return this.postAction(alertId, 'acknowledge', 'acknowledge-v2', 'acknowledge', { ...data });
  }

  /**
   * Resolve alert trên server (kèm danh tính thật + ghi chú — MB5/MB6)
   * POST /api/external/alerts/{alertId}/resolve-v2 (fallback: /resolve)
   */
  async resolveAlert(alertId: string, data: AlertResolveRequest): Promise<AlertActionResponse | null> {
    console.log('[AlertApiService] resolveAlert:', alertId);
    // Legacy endpoint reads resolutionNote/note — send both shapes for compatibility
    return this.postAction(alertId, 'resolve', 'resolve-v2', 'resolve', {
      ...data,
      resolutionNote: data.resolution || data.notes,
    });
  }

  /**
   * Lấy danh sách alert từ server (có phân trang + filter)
   * GET /api/external/alerts
   */
  async fetchAlerts(params: AlertHistoryParams = {}): Promise<AlertHistoryResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const query = new URLSearchParams();

      if (params.stationId) query.set('stationId', params.stationId);
      if (params.severity) query.set('severity', params.severity);
      if (params.status) query.set('status', params.status);
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);
      // Server uses offset-based pagination (not page)
      const limit = params.limit ?? 50;
      query.set('limit', String(limit));
      if (params.page != null && params.page > 1) {
        query.set('offset', String((params.page - 1) * limit));
      }

      const url = `${baseUrl}/api/external/alerts?${query.toString()}`;
      console.log('[AlertApiService] fetchAlerts:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[AlertApiService] fetchAlerts HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      // Server returns a FLAT array in `data` + top-level `pagination`
      // (A2/B2): reshape into the app's { data: { alerts, pagination } } shape.
      const rows: any[] = Array.isArray(result?.data) ? result.data : [];
      console.log('[AlertApiService] fetchAlerts OK, count:', rows.length);
      return {
        success: result?.success ?? true,
        data: {
          alerts: rows.map(mapServerAlertRow),
          pagination: normalizePagination(result?.pagination),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[AlertApiService] fetchAlerts failed:', msg);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Lấy chi tiết 1 alert từ server
   * GET /api/external/alerts/{alertId}
   */
  async fetchAlertById(alertId: string): Promise<AlertDetailResponse | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/external/alerts/${encodeURIComponent(alertId)}`;
      console.log('[AlertApiService] fetchAlertById:', alertId);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[AlertApiService] fetchAlertById HTTP ${response.status}:`, text.substring(0, 200));
        return null;
      }

      const result = await response.json();
      // Server returns the single row under `data` (A4): map it to an Alert.
      const row = result?.data;
      if (!row || typeof row !== 'object') {
        console.warn('[AlertApiService] fetchAlertById: no data in response');
        return null;
      }
      console.log('[AlertApiService] fetchAlertById OK:', alertId);
      return { success: result?.success ?? true, alert: mapServerAlertRow(row) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[AlertApiService] fetchAlertById failed:', msg);
      return null;
    } finally {
      clear();
    }
  }
}

export const alertApiService = AlertApiService.getInstance();
