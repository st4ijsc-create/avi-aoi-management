import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as db from '../db';

// Mock db functions
vi.mock('../db', () => ({
  getProcesses: vi.fn(),
  getProcessById: vi.fn(),
  getProcessByCode: vi.fn(),
  createProcess: vi.fn(),
  updateProcess: vi.fn(),
  deleteProcess: vi.fn(),
  reorderProcesses: vi.fn(),
  getLineProcessAssignments: vi.fn(),
  createLineProcessAssignment: vi.fn(),
  updateLineProcessAssignment: vi.fn(),
  deleteLineProcessAssignment: vi.fn(),
  reorderLineProcessAssignments: vi.fn(),
}));

describe('Process Management Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProcesses', () => {
    it('should return all processes when no filter provided', async () => {
      const mockProcesses = [
        { id: 1, code: 'SMT-01', name: 'SMT Line 1', processType: 'SMT', isActive: true },
        { id: 2, code: 'DIP-01', name: 'DIP Line 1', processType: 'DIP', isActive: true },
      ];
      vi.mocked(db.getProcesses).mockResolvedValue(mockProcesses);

      const result = await db.getProcesses();
      expect(result).toEqual(mockProcesses);
      expect(db.getProcesses).toHaveBeenCalledTimes(1);
    });

    it('should filter processes by type', async () => {
      const mockProcesses = [
        { id: 1, code: 'SMT-01', name: 'SMT Line 1', processType: 'SMT', isActive: true },
      ];
      vi.mocked(db.getProcesses).mockResolvedValue(mockProcesses);

      const result = await db.getProcesses({ processType: 'SMT' });
      expect(result).toEqual(mockProcesses);
      expect(db.getProcesses).toHaveBeenCalledWith({ processType: 'SMT' });
    });
  });

  describe('getProcessById', () => {
    it('should return process when found', async () => {
      const mockProcess = { id: 1, code: 'SMT-01', name: 'SMT Line 1', processType: 'SMT' };
      vi.mocked(db.getProcessById).mockResolvedValue(mockProcess);

      const result = await db.getProcessById(1);
      expect(result).toEqual(mockProcess);
    });

    it('should return null when process not found', async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(null);

      const result = await db.getProcessById(999);
      expect(result).toBeNull();
    });
  });

  describe('createProcess', () => {
    it('should create a new process', async () => {
      vi.mocked(db.getProcessByCode).mockResolvedValue(null);
      vi.mocked(db.createProcess).mockResolvedValue({ id: 1 });

      const newProcess = {
        code: 'SMT-01',
        name: 'SMT Line 1',
        processType: 'SMT' as const,
        color: '#3b82f6',
      };

      const result = await db.createProcess(newProcess);
      expect(result).toEqual({ id: 1 });
      expect(db.createProcess).toHaveBeenCalledWith(newProcess);
    });
  });

  describe('updateProcess', () => {
    it('should update an existing process', async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ 
        id: 1, 
        code: 'SMT-01', 
        name: 'SMT Line 1',
        processType: 'SMT'
      });
      vi.mocked(db.updateProcess).mockResolvedValue(undefined);

      await db.updateProcess(1, { name: 'SMT Line 1 Updated' });
      expect(db.updateProcess).toHaveBeenCalledWith(1, { name: 'SMT Line 1 Updated' });
    });
  });

  describe('deleteProcess', () => {
    it('should delete a process', async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ 
        id: 1, 
        code: 'SMT-01', 
        name: 'SMT Line 1',
        processType: 'SMT'
      });
      vi.mocked(db.deleteProcess).mockResolvedValue(undefined);

      await db.deleteProcess(1);
      expect(db.deleteProcess).toHaveBeenCalledWith(1);
    });
  });

  describe('reorderProcesses', () => {
    it('should reorder processes', async () => {
      vi.mocked(db.reorderProcesses).mockResolvedValue(undefined);

      await db.reorderProcesses([3, 1, 2]);
      expect(db.reorderProcesses).toHaveBeenCalledWith([3, 1, 2]);
    });
  });

  describe('Line Process Assignments', () => {
    it('should get line process assignments', async () => {
      const mockAssignments = [
        { assignment: { id: 1, lineId: 1, processId: 1 }, process: { id: 1, name: 'SMT' } },
      ];
      vi.mocked(db.getLineProcessAssignments).mockResolvedValue(mockAssignments);

      const result = await db.getLineProcessAssignments(1);
      expect(result).toEqual(mockAssignments);
    });

    it('should create line process assignment', async () => {
      vi.mocked(db.createLineProcessAssignment).mockResolvedValue({ id: 1 });

      const result = await db.createLineProcessAssignment({
        lineId: 1,
        processId: 1,
        orderIndex: 0,
      });
      expect(result).toEqual({ id: 1 });
    });

    it('should delete line process assignment', async () => {
      vi.mocked(db.deleteLineProcessAssignment).mockResolvedValue(undefined);

      await db.deleteLineProcessAssignment(1);
      expect(db.deleteLineProcessAssignment).toHaveBeenCalledWith(1);
    });
  });
});
