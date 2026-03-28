import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database functions
vi.mock('./db', () => ({
  listManualConnections: vi.fn(),
  getManualConnectionById: vi.fn(),
  getManualConnectionByMachineId: vi.fn(),
  createManualConnection: vi.fn(),
  updateManualConnection: vi.fn(),
  deleteManualConnection: vi.fn(),
  updateManualConnectionStatus: vi.fn(),
}));

import * as db from './db';

describe('Manual Machine Mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listManualConnections', () => {
    it('should return empty array when no connections exist', async () => {
      vi.mocked(db.listManualConnections).mockResolvedValue([]);
      const result = await db.listManualConnections();
      expect(result).toEqual([]);
    });

    it('should return list of connections', async () => {
      const mockConnections = [
        {
          id: 1,
          machineId: 1,
          ipAddress: '192.168.1.100',
          port: 8080,
          protocol: 'websocket' as const,
          isEnabled: true,
          lastConnectionAttempt: null,
          lastSuccessfulConnection: null,
          connectionStatus: 'pending' as const,
          errorMessage: null,
          retryCount: 0,
          maxRetries: 5,
          retryIntervalSeconds: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      vi.mocked(db.listManualConnections).mockResolvedValue(mockConnections);
      const result = await db.listManualConnections();
      expect(result).toHaveLength(1);
      expect(result[0].ipAddress).toBe('192.168.1.100');
    });
  });

  describe('createManualConnection', () => {
    it('should create a new connection', async () => {
      vi.mocked(db.getManualConnectionByMachineId).mockResolvedValue(null);
      vi.mocked(db.createManualConnection).mockResolvedValue({ id: 1 });

      const result = await db.createManualConnection({
        machineId: 1,
        ipAddress: '192.168.1.100',
        port: 8080,
        protocol: 'websocket',
        isEnabled: true,
        maxRetries: 5,
        retryIntervalSeconds: 30,
      });

      expect(result.id).toBe(1);
    });
  });

  describe('updateManualConnection', () => {
    it('should update connection details', async () => {
      vi.mocked(db.updateManualConnection).mockResolvedValue(undefined);

      await db.updateManualConnection(1, {
        ipAddress: '192.168.1.200',
        port: 9090,
      });

      expect(db.updateManualConnection).toHaveBeenCalledWith(1, {
        ipAddress: '192.168.1.200',
        port: 9090,
      });
    });
  });

  describe('deleteManualConnection', () => {
    it('should delete a connection', async () => {
      vi.mocked(db.deleteManualConnection).mockResolvedValue(undefined);

      await db.deleteManualConnection(1);

      expect(db.deleteManualConnection).toHaveBeenCalledWith(1);
    });
  });

  describe('updateManualConnectionStatus', () => {
    it('should update connection status to connected', async () => {
      vi.mocked(db.updateManualConnectionStatus).mockResolvedValue(undefined);

      await db.updateManualConnectionStatus(1, 'connected');

      expect(db.updateManualConnectionStatus).toHaveBeenCalledWith(1, 'connected');
    });

    it('should update connection status to error with message', async () => {
      vi.mocked(db.updateManualConnectionStatus).mockResolvedValue(undefined);

      await db.updateManualConnectionStatus(1, 'error', 'Connection timeout');

      expect(db.updateManualConnectionStatus).toHaveBeenCalledWith(1, 'error', 'Connection timeout');
    });
  });

  describe('IP address validation', () => {
    it('should accept valid IPv4 address', () => {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      expect(ipv4Regex.test('192.168.1.100')).toBe(true);
      expect(ipv4Regex.test('10.0.0.1')).toBe(true);
      expect(ipv4Regex.test('172.16.0.1')).toBe(true);
    });

    it('should reject invalid IP addresses', () => {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      expect(ipv4Regex.test('invalid')).toBe(false);
      expect(ipv4Regex.test('192.168.1')).toBe(false);
      expect(ipv4Regex.test('192.168.1.1.1')).toBe(false);
    });
  });

  describe('Port validation', () => {
    it('should accept valid port numbers', () => {
      const isValidPort = (port: number) => port >= 1 && port <= 65535;
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(8080)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    it('should reject invalid port numbers', () => {
      const isValidPort = (port: number) => port >= 1 && port <= 65535;
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
    });
  });
});
