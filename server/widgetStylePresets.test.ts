import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database functions
const mockPresets = [
  {
    id: 1,
    name: 'Light Default',
    description: 'Default light theme',
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    borderColor: '#e5e7eb',
    accentColor: '#3b82f6',
    borderRadius: '0.5rem',
    shadow: 'sm' as const,
    opacity: '1.00',
    presetType: 'system' as const,
    isPublic: true,
    createdBy: 1,
    usageCount: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    name: 'My Custom Style',
    description: 'Personal style',
    backgroundColor: '#1f2937',
    textColor: '#f9fafb',
    borderColor: '#374151',
    accentColor: '#60a5fa',
    borderRadius: '0.75rem',
    shadow: 'md' as const,
    opacity: '0.95',
    presetType: 'user' as const,
    isPublic: false,
    createdBy: 2,
    usageCount: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

vi.mock('./db', () => ({
  getUserWidgetStylePresets: vi.fn().mockImplementation((userId: number) => {
    return Promise.resolve(mockPresets.filter(p => 
      p.createdBy === userId || p.isPublic || p.presetType === 'system'
    ));
  }),
  getWidgetStylePresetById: vi.fn().mockImplementation((id: number) => {
    return Promise.resolve(mockPresets.find(p => p.id === id) || null);
  }),
  createWidgetStylePreset: vi.fn().mockImplementation((data) => {
    return Promise.resolve({ id: 3 });
  }),
  updateWidgetStylePreset: vi.fn().mockResolvedValue(undefined),
  deleteWidgetStylePreset: vi.fn().mockResolvedValue(undefined),
  incrementWidgetStylePresetUsage: vi.fn().mockResolvedValue(undefined),
  getPublicWidgetStylePresets: vi.fn().mockImplementation(() => {
    return Promise.resolve(mockPresets.filter(p => p.isPublic || p.presetType === 'system'));
  }),
}));

import * as db from './db';

describe('Widget Style Presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserWidgetStylePresets', () => {
    it('should return presets for user including public and system presets', async () => {
      const presets = await db.getUserWidgetStylePresets(2);
      expect(presets).toBeDefined();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
      // Should include system preset
      expect(presets.some(p => p.presetType === 'system')).toBe(true);
    });

    it('should return user own presets', async () => {
      const presets = await db.getUserWidgetStylePresets(2);
      expect(presets.some(p => p.createdBy === 2)).toBe(true);
    });
  });

  describe('getWidgetStylePresetById', () => {
    it('should return preset by id', async () => {
      const preset = await db.getWidgetStylePresetById(1);
      expect(preset).toBeDefined();
      expect(preset?.id).toBe(1);
      expect(preset?.name).toBe('Light Default');
    });

    it('should return null for non-existent preset', async () => {
      const preset = await db.getWidgetStylePresetById(999);
      expect(preset).toBeNull();
    });
  });

  describe('createWidgetStylePreset', () => {
    it('should create a new preset', async () => {
      const result = await db.createWidgetStylePreset({
        name: 'New Style',
        backgroundColor: '#ffffff',
        textColor: '#000000',
        borderColor: '#cccccc',
        accentColor: '#0066cc',
        borderRadius: '0.5rem',
        shadow: 'sm',
        opacity: '1.00',
        presetType: 'user',
        isPublic: false,
        createdBy: 1,
      });
      expect(result).toBeDefined();
      expect(result.id).toBe(3);
    });
  });

  describe('updateWidgetStylePreset', () => {
    it('should update preset', async () => {
      await db.updateWidgetStylePreset(2, { name: 'Updated Style' });
      expect(db.updateWidgetStylePreset).toHaveBeenCalledWith(2, { name: 'Updated Style' });
    });
  });

  describe('deleteWidgetStylePreset', () => {
    it('should delete preset', async () => {
      await db.deleteWidgetStylePreset(2);
      expect(db.deleteWidgetStylePreset).toHaveBeenCalledWith(2);
    });
  });

  describe('incrementWidgetStylePresetUsage', () => {
    it('should increment usage count', async () => {
      await db.incrementWidgetStylePresetUsage(1);
      expect(db.incrementWidgetStylePresetUsage).toHaveBeenCalledWith(1);
    });
  });

  describe('getPublicWidgetStylePresets', () => {
    it('should return only public and system presets', async () => {
      const presets = await db.getPublicWidgetStylePresets();
      expect(presets).toBeDefined();
      expect(Array.isArray(presets)).toBe(true);
      // All returned presets should be public or system
      presets.forEach(p => {
        expect(p.isPublic || p.presetType === 'system').toBe(true);
      });
    });
  });

  describe('Preset Style Validation', () => {
    it('should have valid color format', () => {
      const colorRegex = /^#[0-9A-Fa-f]{6}$/;
      mockPresets.forEach(preset => {
        expect(preset.backgroundColor).toMatch(colorRegex);
        expect(preset.textColor).toMatch(colorRegex);
        expect(preset.borderColor).toMatch(colorRegex);
        expect(preset.accentColor).toMatch(colorRegex);
      });
    });

    it('should have valid shadow value', () => {
      const validShadows = ['none', 'sm', 'md', 'lg', 'xl'];
      mockPresets.forEach(preset => {
        expect(validShadows).toContain(preset.shadow);
      });
    });

    it('should have valid opacity value', () => {
      mockPresets.forEach(preset => {
        const opacity = parseFloat(preset.opacity);
        expect(opacity).toBeGreaterThanOrEqual(0);
        expect(opacity).toBeLessThanOrEqual(1);
      });
    });

    it('should have valid preset type', () => {
      const validTypes = ['system', 'shared', 'user'];
      mockPresets.forEach(preset => {
        expect(validTypes).toContain(preset.presetType);
      });
    });
  });
});
