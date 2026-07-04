/**
 * Unit Tests - Helper Functions
 */

// W6-B (doc 27 Đợt 6): test aligned with the ACTUAL helpers API — the old test
// imported functions that never existed in this app (validateAlertPayload,
// sortAlertsByTime, filterAlertsBySeverity, isInQuietHours, …) and could not
// run at all until the duplicate jest config was fixed.
import {
  generateUUID,
  generateAlertId,
  formatRelativeTime,
  formatDateTime,
  isValidBrokerAddress,
  isValidPort,
  isValidMqttTopic,
  isValidAlertPayload,
  getSeverityColor,
  getSeverityIcon,
  getSeverityLabel,
  compareSeverity,
  sortAlerts,
  filterAlerts,
  countAlertsBySeverity,
  isQuietHours,
} from '../../src/utils/helpers';

describe('UUID Generation', () => {
  test('generateUUID returns valid UUID format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('generateUUID returns unique values', () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    expect(uuid1).not.toBe(uuid2);
  });

  test('generateAlertId returns valid format', () => {
    const alertId = generateAlertId();
    expect(alertId).toMatch(/^ALT-\d{4}-\d{6}$/);
  });
});

describe('Date Formatting', () => {
  test('formatRelativeTime returns "Vừa xong" for recent times', () => {
    const now = new Date().toISOString();
    const result = formatRelativeTime(now);
    expect(result).toBe('Vừa xong');
  });

  test('formatRelativeTime returns minutes for times < 1 hour', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const result = formatRelativeTime(thirtyMinAgo);
    expect(result).toMatch(/\d+ phút trước/);
  });

  test('formatRelativeTime returns hours for times < 24 hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoHoursAgo);
    expect(result).toMatch(/\d+ giờ trước/);
  });

  test('formatDateTime returns formatted date string', () => {
    const date = '2026-01-17T14:30:00Z';
    const result = formatDateTime(date);
    expect(result).toContain('2026');
  });
});

describe('Validation Functions', () => {
  describe('isValidBrokerAddress', () => {
    test('returns true for valid IP address', () => {
      expect(isValidBrokerAddress('192.168.1.100')).toBe(true);
    });

    test('returns true for valid hostname', () => {
      expect(isValidBrokerAddress('mqtt.factory.local')).toBe(true);
    });

    test('returns true for localhost', () => {
      expect(isValidBrokerAddress('localhost')).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(isValidBrokerAddress('')).toBe(false);
    });

    test('returns false for invalid IP', () => {
      expect(isValidBrokerAddress('999.999.999.999')).toBe(false);
    });
  });

  describe('isValidPort', () => {
    test('returns true for valid port numbers', () => {
      expect(isValidPort(8000)).toBe(true);
      expect(isValidPort(1883)).toBe(true);
      expect(isValidPort(1)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    test('returns false for invalid port numbers', () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
    });
  });

  describe('isValidMqttTopic', () => {
    test('returns true for valid topics', () => {
      expect(isValidMqttTopic('factory/+/station/+/alert')).toBe(true);
      expect(isValidMqttTopic('factory/#')).toBe(true);
      expect(isValidMqttTopic('test/topic')).toBe(true);
    });

    test('returns false for empty topic', () => {
      expect(isValidMqttTopic('')).toBe(false);
    });
  });

  describe('isValidAlertPayload (multi-format)', () => {
    const validPayload = {
      alertId: 'ALT-2026-001234',
      timestamp: '2026-01-17T14:30:00Z',
      station: { id: 'ST-001', name: 'Test Station', line: 'Line A' },
      product: { id: 'PRD-001', name: 'Test Product' },
      error: { code: 'E-001', type: 'Test Error', description: 'Test description' },
      severity: 'high',
    };

    test('accepts the standard app format', () => {
      expect(isValidAlertPayload(validPayload)).toBe(true);
    });

    test('rejects standard format with incomplete station/error', () => {
      expect(
        isValidAlertPayload({
          alertId: 'ALT-1',
          station: { id: 'ST-001' }, // missing name
          error: { code: 'E-1', description: 'x' },
        }),
      ).toBe(false);
      expect(
        isValidAlertPayload({
          alertId: 'ALT-1',
          station: { id: 'ST-001', name: 'S' },
          error: { code: 'E-1' }, // missing description
        }),
      ).toBe(false);
    });

    test('accepts MES format (message/error string)', () => {
      expect(isValidAlertPayload({ message: 'Máy dừng', stationId: 5 })).toBe(true);
    });

    test('accepts NG_RATE_THRESHOLD format', () => {
      expect(
        isValidAlertPayload({ alertType: 'NG_RATE_THRESHOLD', ngRate: { current: 5, threshold: 3 } }),
      ).toBe(true);
    });

    test('accepts NG_ALERT AOI format', () => {
      expect(
        isValidAlertPayload({ type: 'NG_ALERT', stationName: 'AOI-1', ngPoints: [{}] }),
      ).toBe(true);
    });

    test('rejects null / non-object / empty payloads', () => {
      expect(isValidAlertPayload(null)).toBe(false);
      expect(isValidAlertPayload('string')).toBe(false);
      expect(isValidAlertPayload({})).toBe(false);
    });
  });
});

describe('Severity Functions', () => {
  test('getSeverityColor returns correct colors', () => {
    expect(getSeverityColor('critical')).toBe('#DC2626');
    expect(getSeverityColor('high')).toBe('#EA580C');
    expect(getSeverityColor('medium')).toBe('#FBBF24');
    expect(getSeverityColor('low')).toBe('#2563EB');
    expect(getSeverityColor('info')).toBe('#6B7280');
  });

  test('getSeverityIcon returns the icons from SEVERITY_CONFIG', () => {
    expect(getSeverityIcon('critical')).toBe('alert-octagon');
    expect(getSeverityIcon('high')).toBe('alert-circle');
    expect(getSeverityIcon('medium')).toBe('alert');
  });

  test('getSeverityLabel returns correct labels', () => {
    expect(getSeverityLabel('critical', 'vi')).toBe('NGHIÊM TRỌNG');
    expect(getSeverityLabel('high', 'en')).toBe('HIGH');
  });

  test('compareSeverity sorts descending by priority (critical first)', () => {
    // compareSeverity(a, b) = priority(b) - priority(a) → Array.sort puts
    // the HIGHER-priority severity first.
    expect(compareSeverity('critical', 'high')).toBeLessThan(0);
    expect(compareSeverity('low', 'high')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });
});

describe('Alert Filtering and Sorting', () => {
  const mockAlerts = [
    {
      id: '1',
      alertId: 'ALT-001',
      timestamp: '2026-01-17T14:00:00Z',
      severity: 'high' as const,
      status: 'pending' as const,
      station: { id: 'ST-001', name: 'Station 1', line: 'Line A' },
      product: { id: 'PRD-001', name: 'Product 1' },
      error: { code: 'E-001', type: 'Error 1', description: 'Desc 1' },
    },
    {
      id: '2',
      alertId: 'ALT-002',
      timestamp: '2026-01-17T15:00:00Z',
      severity: 'critical' as const,
      status: 'acknowledged' as const,
      station: { id: 'ST-002', name: 'Station 2', line: 'Line B' },
      product: { id: 'PRD-002', name: 'Product 2' },
      error: { code: 'E-002', type: 'Error 2', description: 'Desc 2' },
    },
    {
      id: '3',
      alertId: 'ALT-003',
      timestamp: '2026-01-17T13:00:00Z',
      severity: 'low' as const,
      status: 'pending' as const,
      station: { id: 'ST-003', name: 'Station 3', line: 'Line A' },
      product: { id: 'PRD-003', name: 'Product 3' },
      error: { code: 'E-003', type: 'Error 3', description: 'Desc 3' },
    },
  ];

  test('sortAlerts by timestamp sorts correctly (desc)', () => {
    const sorted = sortAlerts(mockAlerts as any, 'timestamp', 'desc');
    expect(sorted[0].id).toBe('2'); // Latest first
    expect(sorted[2].id).toBe('3'); // Earliest last
  });

  test('sortAlerts by timestamp sorts correctly (asc)', () => {
    const sorted = sortAlerts(mockAlerts as any, 'timestamp', 'asc');
    expect(sorted[0].id).toBe('3'); // Earliest first
    expect(sorted[2].id).toBe('2'); // Latest last
  });

  test('sortAlerts by severity puts critical first', () => {
    const sorted = sortAlerts(mockAlerts as any, 'severity');
    expect(sorted[0].severity).toBe('critical');
    expect(sorted[2].severity).toBe('low');
  });

  test('filterAlerts filters by severity', () => {
    const filtered = filterAlerts(mockAlerts as any, { severity: ['high', 'critical'] });
    expect(filtered.length).toBe(2);
    expect(filtered.some(a => a.severity === 'low')).toBe(false);
  });

  test('filterAlerts filters by status', () => {
    const filtered = filterAlerts(mockAlerts as any, { status: ['pending'] });
    expect(filtered.length).toBe(2);
    expect(filtered.every(a => a.status === 'pending')).toBe(true);
  });

  test('filterAlerts filters by search text', () => {
    const filtered = filterAlerts(mockAlerts as any, { searchText: 'Station 2' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('2');
  });

  test('countAlertsBySeverity returns correct counts', () => {
    const counts = countAlertsBySeverity(mockAlerts);
    expect(counts.critical).toBe(1);
    expect(counts.high).toBe(1);
    expect(counts.low).toBe(1);
    expect(counts.medium).toBe(0);
  });
});

describe('Quiet Hours', () => {
  test('isQuietHours evaluates the current time against a start/end window', () => {
    // Window covering the whole day → always inside
    expect(isQuietHours('00:00', '24:00')).toBe(true);
    // Degenerate window (start === end) → never inside
    expect(isQuietHours('12:00', '12:00')).toBe(false);
  });
});
