import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cacheService, getCachedOrFetch } from './services/cacheService';

describe('CacheService', () => {
  beforeEach(() => {
    cacheService.clear();
  });

  describe('basic operations', () => {
    it('should set and get cached values', () => {
      cacheService.set('test-key', { data: 'test-value' });
      const result = cacheService.get<{ data: string }>('test-key');
      expect(result).toEqual({ data: 'test-value' });
    });

    it('should return null for non-existent keys', () => {
      const result = cacheService.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete cached values', () => {
      cacheService.set('test-key', 'value');
      expect(cacheService.get('test-key')).toBe('value');
      
      cacheService.delete('test-key');
      expect(cacheService.get('test-key')).toBeNull();
    });

    it('should clear all cached values', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      cacheService.clear();
      
      expect(cacheService.get('key1')).toBeNull();
      expect(cacheService.get('key2')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should expire values after TTL', async () => {
      // Set with 100ms TTL
      cacheService.set('short-lived', 'value', 100);
      expect(cacheService.get('short-lived')).toBe('value');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(cacheService.get('short-lived')).toBeNull();
    });
  });

  describe('pattern invalidation', () => {
    it('should invalidate by pattern', () => {
      cacheService.set('stats:corporate:A', 'data1');
      cacheService.set('stats:corporate:B', 'data2');
      cacheService.set('stats:factory:A', 'data3');
      cacheService.set('other:key', 'data4');
      
      const count = cacheService.invalidateByPattern('stats:corporate:*');
      
      expect(count).toBe(2);
      expect(cacheService.get('stats:corporate:A')).toBeNull();
      expect(cacheService.get('stats:corporate:B')).toBeNull();
      expect(cacheService.get('stats:factory:A')).toBe('data3');
      expect(cacheService.get('other:key')).toBe('data4');
    });

    it('should invalidate all statistics', () => {
      cacheService.set('stats:test', 'data1');
      cacheService.set('yield:test', 'data2');
      cacheService.set('throughput:test', 'data3');
      cacheService.set('other:key', 'data4');
      
      cacheService.invalidateStatistics();
      
      expect(cacheService.get('stats:test')).toBeNull();
      expect(cacheService.get('yield:test')).toBeNull();
      expect(cacheService.get('throughput:test')).toBeNull();
      expect(cacheService.get('other:key')).toBe('data4');
    });
  });

  describe('cache stats', () => {
    it('should track hits and misses', () => {
      cacheService.set('key', 'value');
      
      cacheService.get('key'); // hit
      cacheService.get('key'); // hit
      cacheService.get('missing'); // miss
      
      const stats = cacheService.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(2);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });
  });

  describe('generateKey', () => {
    it('should generate consistent keys', () => {
      const key1 = cacheService.generateKey('prefix', { a: 1, b: 2 });
      const key2 = cacheService.generateKey('prefix', { b: 2, a: 1 });
      
      // Keys should be the same regardless of object property order
      expect(key1).toBe(key2);
    });

    it('should handle dates in keys', () => {
      const date = new Date('2024-01-15');
      const key = cacheService.generateKey('test', { date });
      
      expect(key).toContain('2024-01-15');
    });

    it('should filter out null and undefined values', () => {
      const key = cacheService.generateKey('test', { a: 1, b: null, c: undefined });
      
      expect(key).toBe('test:a=1');
    });
  });
});

describe('getCachedOrFetch', () => {
  beforeEach(() => {
    cacheService.clear();
  });

  it('should return cached value if exists', async () => {
    cacheService.set('test-key', 'cached-value');
    const fetchFn = vi.fn().mockResolvedValue('fresh-value');
    
    const result = await getCachedOrFetch('test-key', fetchFn);
    
    expect(result).toBe('cached-value');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('should fetch and cache if not exists', async () => {
    const fetchFn = vi.fn().mockResolvedValue('fresh-value');
    
    const result = await getCachedOrFetch('new-key', fetchFn);
    
    expect(result).toBe('fresh-value');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cacheService.get('new-key')).toBe('fresh-value');
  });
});
