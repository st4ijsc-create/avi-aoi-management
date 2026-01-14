import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db functions
const mockCreateAuditLog = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetAuditLogStats = vi.fn();

vi.mock('./db', () => ({
  createAuditLog: (...args: any[]) => mockCreateAuditLog(...args),
  getAuditLogs: (...args: any[]) => mockGetAuditLogs(...args),
  getAuditLogStats: (...args: any[]) => mockGetAuditLogStats(...args),
}));

describe('Audit Log Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAuditLog', () => {
    it('should create a login audit log', async () => {
      mockCreateAuditLog.mockResolvedValue({ id: 1 });
      
      const { createAuditLog } = await import('./db');
      const result = await createAuditLog({
        userId: 1,
        userName: 'admin',
        action: 'login',
        status: 'success',
        ipAddress: '192.168.1.1',
      });
      
      expect(result).toEqual({ id: 1 });
      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        userId: 1,
        userName: 'admin',
        action: 'login',
        status: 'success',
        ipAddress: '192.168.1.1',
      });
    });

    it('should create a failed login audit log', async () => {
      mockCreateAuditLog.mockResolvedValue({ id: 2 });
      
      const { createAuditLog } = await import('./db');
      const result = await createAuditLog({
        userName: 'unknown_user',
        action: 'login_failed',
        status: 'failure',
        ipAddress: '192.168.1.100',
        details: { reason: 'Invalid password' },
      });
      
      expect(result).toEqual({ id: 2 });
    });

    it('should create a CRUD audit log', async () => {
      mockCreateAuditLog.mockResolvedValue({ id: 3 });
      
      const { createAuditLog } = await import('./db');
      const result = await createAuditLog({
        userId: 1,
        userName: 'admin',
        action: 'create',
        entityType: 'user',
        entityId: 5,
        entityName: 'New User',
        status: 'success',
      });
      
      expect(result).toEqual({ id: 3 });
    });
  });

  describe('getAuditLogs', () => {
    it('should return paginated audit logs', async () => {
      const mockLogs = [
        { id: 1, action: 'login', userName: 'admin', createdAt: new Date() },
        { id: 2, action: 'create', userName: 'admin', createdAt: new Date() },
      ];
      mockGetAuditLogs.mockResolvedValue({ logs: mockLogs, total: 2 });
      
      const { getAuditLogs } = await import('./db');
      const result = await getAuditLogs({ limit: 10, offset: 0 });
      
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by action', async () => {
      mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });
      
      const { getAuditLogs } = await import('./db');
      await getAuditLogs({ action: 'login', limit: 10, offset: 0 });
      
      expect(mockGetAuditLogs).toHaveBeenCalledWith({ action: 'login', limit: 10, offset: 0 });
    });

    it('should filter by entity type', async () => {
      mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });
      
      const { getAuditLogs } = await import('./db');
      await getAuditLogs({ entityType: 'user', limit: 10, offset: 0 });
      
      expect(mockGetAuditLogs).toHaveBeenCalledWith({ entityType: 'user', limit: 10, offset: 0 });
    });

    it('should filter by status', async () => {
      mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });
      
      const { getAuditLogs } = await import('./db');
      await getAuditLogs({ status: 'failure', limit: 10, offset: 0 });
      
      expect(mockGetAuditLogs).toHaveBeenCalledWith({ status: 'failure', limit: 10, offset: 0 });
    });
  });

  describe('getAuditLogStats', () => {
    it('should return stats for last 7 days', async () => {
      const mockStats = {
        totalActions: 100,
        loginCount: 50,
        failedLogins: 5,
        createCount: 20,
        updateCount: 15,
        deleteCount: 10,
        topUsers: [{ userName: 'admin', count: 80 }],
        actionsByDay: [{ date: '2024-01-01', count: 20 }],
      };
      mockGetAuditLogStats.mockResolvedValue(mockStats);
      
      const { getAuditLogStats } = await import('./db');
      const result = await getAuditLogStats(7);
      
      expect(result.totalActions).toBe(100);
      expect(result.loginCount).toBe(50);
      expect(result.failedLogins).toBe(5);
      expect(result.topUsers).toHaveLength(1);
    });

    it('should handle custom day range', async () => {
      mockGetAuditLogStats.mockResolvedValue({
        totalActions: 200,
        loginCount: 100,
        failedLogins: 10,
        createCount: 40,
        updateCount: 30,
        deleteCount: 20,
        topUsers: [],
        actionsByDay: [],
      });
      
      const { getAuditLogStats } = await import('./db');
      const result = await getAuditLogStats(30);
      
      expect(mockGetAuditLogStats).toHaveBeenCalledWith(30);
      expect(result.totalActions).toBe(200);
    });
  });
});
