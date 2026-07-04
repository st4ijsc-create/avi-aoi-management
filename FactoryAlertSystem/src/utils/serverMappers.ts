/**
 * Factory Alert System - Server Response Mappers (Wave 1 · A2/A3/B2)
 *
 * The Express server's /api/external endpoints return FLAT rows discriminated by
 * a `source` field, wrapped as `{ success, data: [rows], pagination }`. The app,
 * however, works with the richer `Alert` / `PeriodicBulletin` shapes and expects
 * `{ success, data: { alerts|bulletins, pagination } }`. These pure mappers bridge
 * the two so the existing stores (loadAlertsFromServer / loadBulletinsFromServer)
 * keep working unchanged.
 *
 * Also hosts the ack/resolve source-guard helpers (A1 app-side): the server only
 * accepts certain `source` prefixes for acknowledge vs resolve, so the app skips
 * network calls that would be rejected with HTTP 400 (stops the 400-spam).
 */

import {
  Alert,
  AlertSeverity,
  AlertStatus,
  ApiPagination,
  BulletinFailPoint,
  PeriodicBulletin,
} from '../types';

// ============================================
// COERCION HELPERS (defensive — server rows are loosely typed)
// ============================================

const VALID_SEVERITIES: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_STATUSES: AlertStatus[] = ['pending', 'acknowledged', 'resolved'];

/** Coerce an arbitrary server value into a valid AlertSeverity (default 'high'). */
function toSeverity(value: unknown): AlertSeverity {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if ((VALID_SEVERITIES as string[]).includes(lower)) {
      return lower as AlertSeverity;
    }
  }
  return 'high';
}

/** Coerce an arbitrary server value into a valid AlertStatus (default 'pending'). */
function toStatus(value: unknown): AlertStatus {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if ((VALID_STATUSES as string[]).includes(lower)) {
      return lower as AlertStatus;
    }
  }
  return 'pending';
}

/** Coerce to a finite number, falling back to `fallback`. */
function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ============================================
// ALERT ROW MAPPER (A2)
// ============================================

/**
 * Map one flat server alert/mqtt/conn row into the app's `Alert` shape.
 *
 * KEY: `id = alertId = row.id` — the row id (e.g. "alert-45"/"mqtt-123"/"conn-9")
 * carries the `source-{n}` form the server needs to ack/resolve, so keeping it as
 * `alertId` makes those sync calls target the right server record.
 */
export function mapServerAlertRow(row: any): Alert {
  const r = row || {};
  return {
    id: String(r.id),
    alertId: String(r.id),
    alertType: r.alertType ?? r.ruleType ?? undefined,
    timestamp: r.createdAt ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    station: {
      // stationId/stationName are being added server-side; fall back gracefully.
      id: r.stationId != null ? String(r.stationId) : 'server',
      name: r.stationName ?? r.settingName ?? r.ruleName ?? r.title ?? 'Server Alert',
      line: '',
    },
    product: { id: 'N/A', name: 'N/A' },
    error: {
      code: String(r.source ?? 'server'),
      type: r.alertType ?? r.ruleType ?? 'Alert',
      description: r.message ?? '',
    },
    severity: toSeverity(r.severity),
    status: toStatus(r.status),
    acknowledgedAt: r.acknowledgedAt ?? undefined,
    resolvedAt: r.resolvedAt ?? undefined,
    message: r.message ?? undefined,
  };
}

// ============================================
// BULLETIN ROW MAPPER (A3)
// ============================================

/** Defensively parse a server `failPoints` value (JSON string | array | missing). */
function parseFailPoints(raw: any): BulletinFailPoint[] {
  let arr: any[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      arr = [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }
  return arr.map((fp: any) => ({
    pointId: toNumber(fp?.pointId),
    pointName: fp?.pointName || 'Unknown',
    pointCode: fp?.pointCode || 'N/A',
    ngCount: toNumber(fp?.ngCount),
    percentage: toNumber(fp?.percentage),
    imageUrl: fp?.imageUrl ?? null,
    referenceImageUrl: fp?.referenceImageUrl ?? null,
    latestInspectionId: toNumber(fp?.latestInspectionId),
    latestSerialNumber: fp?.latestSerialNumber || 'N/A',
    workstationId: fp?.workstationId,
  }));
}

/** Map one flat server bulletin row into the app's `PeriodicBulletin` shape. */
export function mapServerBulletinRow(row: any): PeriodicBulletin {
  const r = row || {};
  const stationId = toNumber(r.stationId);
  return {
    bulletinId: `srv-blt-${r.id}`,
    type: 'PERIODIC_BULLETIN',
    stationId,
    stationName: r.stationName ?? `Station ${r.stationId}`,
    factoryName: r.factoryName ?? 'N/A',
    workshopName: r.workshopName ?? 'N/A',
    lineName: r.lineName ?? 'N/A',
    period: {
      start: r.periodStart ?? new Date().toISOString(),
      end: r.periodEnd ?? new Date().toISOString(),
      intervalMinutes: 0,
    },
    statistics: {
      totalCount: toNumber(r.totalCount),
      okCount: toNumber(r.okCount),
      ngCount: toNumber(r.ngCount),
      ntfCount: toNumber(r.ntfCount),
      yieldRate: toNumber(r.yieldRate),
      avgCycleTime: 0,
    },
    failPoints: parseFailPoints(r.failPoints),
    machines: [],
    timestamp: r.createdAt ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    isRead: false,
  };
}

// ============================================
// PAGINATION MAPPER (B2)
// ============================================

/**
 * Convert the server's offset-based pagination `{ limit, offset, count }` into the
 * app's page-based `ApiPagination` `{ page, limit, total, totalPages }`.
 */
export function normalizePagination(p: any): ApiPagination {
  const limit = toNumber(p?.limit, 50) > 0 ? toNumber(p?.limit, 50) : 50;
  const total = toNumber(p?.count ?? p?.total, 0);
  const offset = toNumber(p?.offset, 0);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  return { page, limit, total, totalPages };
}

// ============================================
// ACK/RESOLVE SOURCE GUARD (A1 app-side)
// ============================================

/** Server accepts these `source` prefixes for the acknowledge operation. */
export const ACK_SOURCES: readonly string[] = ['alert', 'conn'];
/**
 * Server accepts these `source` prefixes for the resolve operation.
 * `ngrate` = NG-rate threshold alerts: the server pre-persists an
 * mqtt_ng_rate_alert_history row and embeds its id as serverAlertId=`ngrate-{id}`
 * in the MQTT payload, which the resolve-v2 endpoint updates. (Lowercase only —
 * the ephemeral business id `NGRATE-…` stays local-only.)
 */
export const RESOLVE_SOURCES: readonly string[] = ['mqtt', 'conn', 'ngrate'];

export type AckResolveOperation = 'acknowledge' | 'resolve';

/** Extract the server `source` prefix the server parses from an id (`source-{n}`). */
export function sourceOfAlertId(alertId: string): string {
  return (alertId || '').split('-')[0];
}

/**
 * True when `alertId`'s source prefix is a valid target for `operation` on the
 * server. Business ids (ALT-…/NGRATE-…/NG-…) return false — the server rejects
 * them with HTTP 400, so the app skips the call and only updates local state.
 */
export function isValidSourceForOperation(alertId: string, operation: AckResolveOperation): boolean {
  const source = sourceOfAlertId(alertId);
  return operation === 'acknowledge'
    ? ACK_SOURCES.includes(source)
    : RESOLVE_SOURCES.includes(source);
}
