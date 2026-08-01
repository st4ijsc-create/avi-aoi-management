/**
 * W6-C (doc 27 MB5/MB6) — real identity in ack/resolve payloads, ack comment,
 * viewer role gate, and escalation badge/filter logic.
 */

import { act, renderHook } from '@testing-library/react-hooks';

// Server sync is mocked — we assert on the exact payload shape (MB5/MB6)
jest.mock('../../src/services/alertApiService', () => ({
  alertApiService: {
    acknowledgeAlert: jest.fn(() => Promise.resolve(null)),
    resolveAlert: jest.fn(() => Promise.resolve(null)),
  },
}));

import { useAlertStore, selectEscalatedCount, selectEscalatedAlerts } from '../../src/store/alertStore';
import { alertApiService } from '../../src/services/alertApiService';
import { authService } from '../../src/services/authService';
import { Alert } from '../../src/types';

const ackMock = alertApiService.acknowledgeAlert as jest.Mock;
const resolveMock = alertApiService.resolveAlert as jest.Mock;

const createMockAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: `test-${Math.random().toString(36).slice(2)}`,
  alertId: `ALT-2026-${Math.floor(Math.random() * 1000000)}`,
  timestamp: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  station: { id: 'ST-001', name: 'Test Station', line: 'Line A', area: 'Area 1' },
  product: { id: 'PRD-001', name: 'Test Product', customer: 'Customer 1' },
  error: { code: 'E-001', type: 'Test Error', description: 'Test error description' },
  severity: 'high',
  status: 'pending',
  ...overrides,
});

function setSession(user: { id: number | null; name: string | null; role: string | null } | undefined) {
  (authService as any).session = user === undefined
    ? null
    : { token: 'tok', username: 'op1', loginAt: new Date().toISOString(), user };
}

beforeEach(() => {
  ackMock.mockClear();
  resolveMock.mockClear();
  setSession(undefined);
  const { result } = renderHook(() => useAlertStore());
  act(() => result.current.clearAll());
});

afterAll(() => {
  (authService as any).session = null;
});

describe('MB5 — real identity (no more mobile_user)', () => {
  it('ack payload carries the logged-in user name + comment', () => {
    setSession({ id: 5, name: 'Nguyen Van A', role: 'operator' });
    const { result } = renderHook(() => useAlertStore());
    const alert = createMockAlert();

    act(() => {
      result.current.addAlert(alert);
      result.current.acknowledgeAlert(alert.id, 'Báo động giả — đã kiểm tra');
    });

    expect(ackMock).toHaveBeenCalledTimes(1);
    const [sentAlertId, payload] = ackMock.mock.calls[0];
    expect(sentAlertId).toBe(alert.alertId);
    expect(payload.acknowledgedBy).toBe('Nguyen Van A');
    expect(payload.acknowledgedBy).not.toBe('mobile_user');
    expect(payload.comment).toBe('Báo động giả — đã kiểm tra');

    // local state: acknowledged + comment stored
    const stored = result.current.alerts.find((a) => a.id === alert.id)!;
    expect(stored.status).toBe('acknowledged');
    expect(stored.ackComment).toBe('Báo động giả — đã kiểm tra');
  });

  it('resolve payload carries the real identity', () => {
    setSession({ id: 5, name: 'Nguyen Van A', role: 'supervisor' });
    const { result } = renderHook(() => useAlertStore());
    const alert = createMockAlert();

    act(() => {
      result.current.addAlert(alert);
      result.current.resolveAlert(alert.id, 'thay cảm biến');
    });

    expect(resolveMock).toHaveBeenCalledTimes(1);
    const [, payload] = resolveMock.mock.calls[0];
    expect(payload.resolvedBy).toBe('Nguyen Van A');
    expect(payload.resolvedBy).not.toBe('mobile_user');
    expect(payload.resolution).toBe('thay cảm biến');
  });

  it('falls back to the login username, never mobile_user, when the server sent no user object', () => {
    (authService as any).session = { token: 'tok', username: 'op1', loginAt: new Date().toISOString() };
    const { result } = renderHook(() => useAlertStore());
    const alert = createMockAlert();

    act(() => {
      result.current.addAlert(alert);
      result.current.acknowledgeAlert(alert.id);
    });

    expect(ackMock.mock.calls[0][1].acknowledgedBy).toBe('op1');
  });

  it("role gate: 'viewer' cannot ack or resolve (parity: read-only role)", () => {
    setSession({ id: 9, name: 'Viewer', role: 'viewer' });
    const { result } = renderHook(() => useAlertStore());
    const alert = createMockAlert();

    act(() => {
      result.current.addAlert(alert);
      result.current.acknowledgeAlert(alert.id, 'should not happen');
      result.current.resolveAlert(alert.id);
    });

    expect(ackMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(result.current.alerts.find((a) => a.id === alert.id)!.status).toBe('pending');
  });

  it('operators and unknown-role (master-key mode) keep access', () => {
    expect(authService.canAcknowledgeAlerts()).toBe(true); // no session at all
    setSession({ id: 5, name: 'Op', role: 'operator' });
    expect(authService.canAcknowledgeAlerts()).toBe(true);
    expect(authService.canResolveAlerts()).toBe(true);
  });
});

describe('MB6 — escalation badge/filter logic', () => {
  it('markEscalated flags the matching alert by alertId (idempotent)', () => {
    const { result } = renderHook(() => useAlertStore());
    const a1 = createMockAlert({ alertId: 'conn-45' });
    const a2 = createMockAlert({ alertId: 'mqtt-9' });

    act(() => {
      result.current.addAlert(a1);
      result.current.addAlert(a2);
      result.current.markEscalated('conn-45', '2026-07-04T10:00:00.000Z');
      result.current.markEscalated('conn-45', '2026-07-04T11:00:00.000Z'); // retained replay — no-op
      result.current.markEscalated('does-not-exist');
    });

    const escalated = selectEscalatedAlerts(result.current as any);
    expect(escalated).toHaveLength(1);
    expect(escalated[0].alertId).toBe('conn-45');
    // idempotency: first escalatedAt wins
    expect(escalated[0].escalatedAt).toBe('2026-07-04T10:00:00.000Z');
    expect(result.current.alerts.find((a) => a.alertId === 'mqtt-9')!.escalated).toBeUndefined();
  });

  it('selectEscalatedCount counts only unresolved escalated alerts', () => {
    const { result } = renderHook(() => useAlertStore());
    const open = createMockAlert({ alertId: 'conn-1' });
    const resolved = createMockAlert({ alertId: 'conn-2', status: 'resolved' });

    act(() => {
      result.current.addAlert(open);
      result.current.addAlert(resolved);
      result.current.markEscalated('conn-1');
      result.current.markEscalated('conn-2');
    });

    expect(selectEscalatedCount(result.current as any)).toBe(1);
    expect(selectEscalatedAlerts(result.current as any)).toHaveLength(2);
  });
});
