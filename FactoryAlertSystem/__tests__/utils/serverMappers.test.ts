/**
 * Unit Tests - Server Response Mappers (Wave 1 · A1/A2/A3/B2)
 *
 * Fixtures mirror the VERIFIED server row shapes for /api/external/alerts and
 * /api/external/bulletins (flat rows discriminated by `source`).
 */

import {
  mapServerAlertRow,
  mapServerBulletinRow,
  normalizePagination,
  isValidSourceForOperation,
  sourceOfAlertId,
} from '../../src/utils/serverMappers';

// ============================================
// FIXTURES (real server row shapes)
// ============================================

const alertRow = {
  id: 'alert-45',
  source: 'alert',
  alertType: 'NG_RATE_THRESHOLD',
  settingName: 'NG Rate Setting',
  message: 'NG rate exceeded threshold',
  triggeredValue: 12.3,
  status: 'pending',
  acknowledgedAt: null,
  acknowledgedBy: null,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const mqttRow = {
  id: 'mqtt-123',
  source: 'mqtt',
  ruleId: 5,
  ruleName: 'High Temperature Rule',
  ruleType: 'threshold',
  message: 'Temperature too high',
  triggeredValue: 80,
  thresholdValue: 75,
  status: 'resolved',
  isResolved: true,
  resolvedAt: '2026-07-01T11:30:00.000Z',
  resolvedBy: 'operator1',
  resolutionNote: 'cooled down',
  createdAt: '2026-07-01T11:00:00.000Z',
};

const connRow = {
  id: 'conn-9',
  source: 'connection',
  alertType: 'CONNECTION_LOST',
  severity: 'critical',
  title: 'Station offline',
  message: 'Station 3 lost connection',
  status: 'acknowledged',
  isAcknowledged: true,
  acknowledgedAt: '2026-07-01T12:05:00.000Z',
  acknowledgedBy: 'admin',
  isResolved: false,
  resolvedAt: null,
  createdAt: '2026-07-01T12:00:00.000Z',
};

describe('mapServerAlertRow', () => {
  it('maps an alert row — id becomes both id and alertId (ack target)', () => {
    const a = mapServerAlertRow(alertRow);
    expect(a.id).toBe('alert-45');
    expect(a.alertId).toBe('alert-45');
    expect(a.timestamp).toBe('2026-07-01T10:00:00.000Z');
    expect(a.receivedAt).toBeDefined();
    expect(a.status).toBe('pending');
    expect(a.severity).toBe('high'); // no severity on alert rows → default 'high'
    expect(a.station.id).toBe('server'); // no stationId present
    expect(a.station.name).toBe('NG Rate Setting'); // settingName fallback
    expect(a.station.line).toBe('');
    expect(a.product).toEqual({ id: 'N/A', name: 'N/A' });
    expect(a.error.code).toBe('alert'); // row.source
    expect(a.error.type).toBe('NG_RATE_THRESHOLD'); // alertType
    expect(a.error.description).toBe('NG rate exceeded threshold');
  });

  it('maps an mqtt row — ruleName as station name, ruleType as error type', () => {
    const a = mapServerAlertRow(mqttRow);
    expect(a.id).toBe('mqtt-123');
    expect(a.alertId).toBe('mqtt-123');
    expect(a.station.name).toBe('High Temperature Rule'); // ruleName fallback
    expect(a.error.code).toBe('mqtt');
    expect(a.error.type).toBe('threshold'); // ruleType
    expect(a.status).toBe('resolved');
    expect(a.resolvedAt).toBe('2026-07-01T11:30:00.000Z');
  });

  it('maps a conn row — carries severity, title, acknowledgedAt', () => {
    const a = mapServerAlertRow(connRow);
    expect(a.id).toBe('conn-9');
    expect(a.severity).toBe('critical');
    expect(a.station.name).toBe('Station offline'); // title fallback
    expect(a.error.type).toBe('CONNECTION_LOST');
    expect(a.status).toBe('acknowledged');
    expect(a.acknowledgedAt).toBe('2026-07-01T12:05:00.000Z');
  });

  it('consumes stationId/stationName when the server provides them', () => {
    const a = mapServerAlertRow({ ...alertRow, stationId: 42, stationName: 'Assembly A1' });
    expect(a.station.id).toBe('42');
    expect(a.station.name).toBe('Assembly A1');
  });

  it('coerces an unknown status/severity to safe defaults', () => {
    const a = mapServerAlertRow({ ...mqttRow, status: 'active', severity: 'weird' });
    expect(a.status).toBe('pending'); // 'active' is not a valid AlertStatus
    expect(a.severity).toBe('high'); // 'weird' is not a valid AlertSeverity
  });

  it('produces alertIds that pass the ack/resolve source guard', () => {
    expect(isValidSourceForOperation(mapServerAlertRow(alertRow).alertId, 'acknowledge')).toBe(true);
    expect(isValidSourceForOperation(mapServerAlertRow(mqttRow).alertId, 'resolve')).toBe(true);
    expect(isValidSourceForOperation(mapServerAlertRow(connRow).alertId, 'acknowledge')).toBe(true);
    expect(isValidSourceForOperation(mapServerAlertRow(connRow).alertId, 'resolve')).toBe(true);
  });
});

// ============================================
// BULLETIN ROW MAPPER
// ============================================

const bulletinRow = {
  id: 7,
  stationId: 3,
  bulletinType: 'PERIODIC',
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:30:00.000Z',
  totalCount: 100,
  okCount: 95,
  ngCount: 4,
  ntfCount: 1,
  yieldRate: 95,
  failPoints: '[{"pointId":1,"pointName":"P1","pointCode":"FP-1","ngCount":4,"percentage":100}]',
  deliveryStatus: 'sent',
  createdAt: '2026-07-01T00:31:00.000Z',
};

describe('mapServerBulletinRow', () => {
  it('maps a bulletin row with failPoints as a JSON string', () => {
    const b = mapServerBulletinRow(bulletinRow);
    expect(b.bulletinId).toBe('srv-blt-7');
    expect(b.type).toBe('PERIODIC_BULLETIN');
    expect(b.stationId).toBe(3);
    expect(b.stationName).toBe('Station 3');
    expect(b.period).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-01T00:30:00.000Z',
      intervalMinutes: 0,
    });
    expect(b.statistics).toEqual({
      totalCount: 100,
      okCount: 95,
      ngCount: 4,
      ntfCount: 1,
      yieldRate: 95,
      avgCycleTime: 0,
    });
    expect(b.failPoints).toHaveLength(1);
    expect(b.failPoints[0].pointId).toBe(1);
    expect(b.failPoints[0].pointName).toBe('P1');
    expect(b.failPoints[0].ngCount).toBe(4);
    expect(b.machines).toEqual([]);
    expect(b.timestamp).toBe('2026-07-01T00:31:00.000Z');
    expect(b.receivedAt).toBeDefined();
    expect(b.isRead).toBe(false);
  });

  it('maps a bulletin row with failPoints as an array', () => {
    const b = mapServerBulletinRow({
      ...bulletinRow,
      failPoints: [{ pointId: 2, pointName: 'P2' }],
    });
    expect(b.failPoints).toHaveLength(1);
    expect(b.failPoints[0].pointId).toBe(2);
    expect(b.failPoints[0].pointCode).toBe('N/A'); // default when absent
  });

  it('defaults failPoints to [] on invalid JSON string / missing', () => {
    expect(mapServerBulletinRow({ ...bulletinRow, failPoints: 'not-json' }).failPoints).toEqual([]);
    expect(mapServerBulletinRow({ ...bulletinRow, failPoints: undefined }).failPoints).toEqual([]);
  });

  it('uses stationName when the server provides it', () => {
    const b = mapServerBulletinRow({ ...bulletinRow, stationName: 'AOI Station 01' });
    expect(b.stationName).toBe('AOI Station 01');
  });
});

// ============================================
// PAGINATION MAPPER
// ============================================

describe('normalizePagination', () => {
  it('converts offset-based → page-based', () => {
    expect(normalizePagination({ limit: 50, offset: 100, count: 230 })).toEqual({
      page: 3,
      limit: 50,
      total: 230,
      totalPages: 5,
    });
  });

  it('returns page 1 for the first page', () => {
    expect(normalizePagination({ limit: 20, offset: 0, count: 10 })).toEqual({
      page: 1,
      limit: 20,
      total: 10,
      totalPages: 1,
    });
  });

  it('falls back to safe defaults when pagination is missing', () => {
    expect(normalizePagination(undefined)).toEqual({
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
    });
  });
});

// ============================================
// ACK/RESOLVE SOURCE GUARD (matrix)
// ============================================

describe('ack/resolve source guard', () => {
  it('sourceOfAlertId extracts the prefix before the first dash', () => {
    expect(sourceOfAlertId('alert-45')).toBe('alert');
    expect(sourceOfAlertId('mqtt-123')).toBe('mqtt');
    expect(sourceOfAlertId('conn-9')).toBe('conn');
    expect(sourceOfAlertId('ALT-2026-001234')).toBe('ALT');
    expect(sourceOfAlertId('NGRATE-999')).toBe('NGRATE');
    expect(sourceOfAlertId('NG-142')).toBe('NG');
  });

  // acknowledge accepts source ∈ {alert, conn}; resolve accepts source ∈ {mqtt, conn, ngrate}.
  const matrix: Array<{ id: string; ack: boolean; resolve: boolean }> = [
    { id: 'alert-45', ack: true, resolve: false },
    { id: 'mqtt-123', ack: false, resolve: true },
    { id: 'conn-9', ack: true, resolve: true },
    { id: 'ALT-2026-001234', ack: false, resolve: false },
    { id: 'NGRATE-999', ack: false, resolve: false }, // uppercase business id → local-only
    { id: 'ngrate-7', ack: false, resolve: true }, // lowercase server id (serverAlertId) → resolves server-side
    { id: 'NG-142', ack: false, resolve: false },
  ];

  matrix.forEach(({ id, ack, resolve }) => {
    it(`"${id}" → acknowledge=${ack}, resolve=${resolve}`, () => {
      expect(isValidSourceForOperation(id, 'acknowledge')).toBe(ack);
      expect(isValidSourceForOperation(id, 'resolve')).toBe(resolve);
    });
  });
});
