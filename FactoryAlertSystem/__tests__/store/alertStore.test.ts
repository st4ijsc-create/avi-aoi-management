/**
 * Unit Tests - Alert Store
 */

import { act, renderHook } from '@testing-library/react-hooks';
import { useAlertStore } from '../../src/store/alertStore';
import { Alert } from '../../src/types';

// Mock alert for testing
const createMockAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: `test-${Date.now()}`,
  alertId: `ALT-2026-${Math.floor(Math.random() * 1000000)}`,
  timestamp: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  station: {
    id: 'ST-001',
    name: 'Test Station',
    line: 'Line A',
    area: 'Area 1',
  },
  product: {
    id: 'PRD-001',
    name: 'Test Product',
    customer: 'Customer 1',
  },
  error: {
    code: 'E-001',
    type: 'Test Error',
    description: 'Test error description',
  },
  severity: 'high',
  status: 'pending',
  ...overrides,
});

describe('Alert Store', () => {
  beforeEach(() => {
    // Reset store before each test
    const { result } = renderHook(() => useAlertStore());
    act(() => {
      result.current.clearAll();
    });
  });

  describe('addAlert', () => {
    it('should add a new alert to the store', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert();

      act(() => {
        result.current.addAlert(mockAlert);
      });

      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].alertId).toBe(mockAlert.alertId);
    });

    it('should not add duplicate alerts', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert();

      act(() => {
        result.current.addAlert(mockAlert);
        result.current.addAlert(mockAlert); // Try to add same alert
      });

      expect(result.current.alerts).toHaveLength(1);
    });

    it('should update pending count when adding pending alert', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'pending' });

      act(() => {
        result.current.addAlert(mockAlert);
      });

      expect(result.current.pendingCount).toBe(1);
    });

    it('should update total count when adding alert', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert(createMockAlert());
        result.current.addAlert(createMockAlert());
      });

      expect(result.current.totalCount).toBe(2);
    });
  });

  describe('removeAlert', () => {
    it('should remove alert by id', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert();

      act(() => {
        result.current.addAlert(mockAlert);
      });

      expect(result.current.alerts).toHaveLength(1);

      act(() => {
        result.current.removeAlert(mockAlert.id);
      });

      expect(result.current.alerts).toHaveLength(0);
    });

    it('should update counts after removal', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'pending' });

      act(() => {
        result.current.addAlert(mockAlert);
      });

      expect(result.current.pendingCount).toBe(1);

      act(() => {
        result.current.removeAlert(mockAlert.id);
      });

      expect(result.current.pendingCount).toBe(0);
      expect(result.current.totalCount).toBe(0);
    });
  });

  describe('acknowledgeAlert', () => {
    it('should change alert status to acknowledged', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'pending' });

      act(() => {
        result.current.addAlert(mockAlert);
      });

      act(() => {
        result.current.acknowledgeAlert(mockAlert.id);
      });

      const alert = result.current.alerts.find(a => a.id === mockAlert.id);
      expect(alert?.status).toBe('acknowledged');
    });

    it('should add acknowledgedAt timestamp', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'pending' });

      act(() => {
        result.current.addAlert(mockAlert);
        result.current.acknowledgeAlert(mockAlert.id);
      });

      const alert = result.current.alerts.find(a => a.id === mockAlert.id);
      expect(alert?.acknowledgedAt).toBeDefined();
    });

    it('should decrease pending count', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'pending' });

      act(() => {
        result.current.addAlert(mockAlert);
      });

      expect(result.current.pendingCount).toBe(1);

      act(() => {
        result.current.acknowledgeAlert(mockAlert.id);
      });

      expect(result.current.pendingCount).toBe(0);
    });
  });

  describe('resolveAlert', () => {
    it('should change alert status to resolved', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert({ status: 'acknowledged' });

      act(() => {
        result.current.addAlert(mockAlert);
        result.current.resolveAlert(mockAlert.id);
      });

      const alert = result.current.alerts.find(a => a.id === mockAlert.id);
      expect(alert?.status).toBe('resolved');
    });

    it('should add resolvedAt timestamp', () => {
      const { result } = renderHook(() => useAlertStore());
      const mockAlert = createMockAlert();

      act(() => {
        result.current.addAlert(mockAlert);
        result.current.resolveAlert(mockAlert.id);
      });

      const alert = result.current.alerts.find(a => a.id === mockAlert.id);
      expect(alert?.resolvedAt).toBeDefined();
    });
  });

  describe('clearAll', () => {
    it('should remove all alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert(createMockAlert());
        result.current.addAlert(createMockAlert());
        result.current.addAlert(createMockAlert());
      });

      expect(result.current.alerts).toHaveLength(3);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.alerts).toHaveLength(0);
      expect(result.current.pendingCount).toBe(0);
      expect(result.current.totalCount).toBe(0);
    });
  });

  describe('clearResolved', () => {
    it('should only remove resolved alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert(createMockAlert({ status: 'pending' }));
        result.current.addAlert(createMockAlert({ status: 'resolved' }));
        result.current.addAlert(createMockAlert({ status: 'acknowledged' }));
      });

      expect(result.current.alerts).toHaveLength(3);

      act(() => {
        result.current.clearResolved();
      });

      expect(result.current.alerts).toHaveLength(2);
      expect(result.current.alerts.every(a => a.status !== 'resolved')).toBe(true);
    });
  });

  describe('max queue size', () => {
    it('should not exceed max queue size (100)', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add 105 alerts
      act(() => {
        for (let i = 0; i < 105; i++) {
          result.current.addAlert(createMockAlert());
        }
      });

      expect(result.current.alerts.length).toBeLessThanOrEqual(100);
    });
  });
});
