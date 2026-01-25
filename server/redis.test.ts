import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

describe('Redis Connection Test', () => {
  it('should check Redis URL configuration', async () => {
    const redisUrl = process.env.REDIS_URL;
    
    // If REDIS_URL is not set, test passes (fallback mode is acceptable)
    if (!redisUrl) {
      console.log('[Test] REDIS_URL not configured, using in-memory fallback');
      expect(true).toBe(true);
      return;
    }

    // If REDIS_URL is set, verify it's a valid format
    expect(redisUrl).toMatch(/^redis(s)?:\/\//);
    console.log('[Test] REDIS_URL format is valid');
  });

  it('should initialize Redis service without errors', async () => {
    // Dynamic import to test initialization
    const { redisService } = await import('./services/redisService');
    
    // Service should exist
    expect(redisService).toBeDefined();
    
    // Get stats should work
    const stats = await redisService.getStats();
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('isRedisConnected');
    expect(stats).toHaveProperty('uptime');
    
    console.log('[Test] Redis service initialized:', {
      isRedisConnected: stats.isRedisConnected,
      uptime: stats.uptime,
    });
  });

  it('should perform basic cache operations', async () => {
    const { redisService } = await import('./services/redisService');
    
    const testKey = 'test:validation';
    const testValue = { timestamp: Date.now(), test: true };
    
    // Set value
    await redisService.set(testKey, testValue, 60);
    
    // Get value
    const retrieved = await redisService.get<typeof testValue>(testKey);
    expect(retrieved).toEqual(testValue);
    
    // Delete value
    const deleted = await redisService.delete(testKey);
    expect(deleted).toBe(true);
    
    // Verify deletion
    const afterDelete = await redisService.get(testKey);
    expect(afterDelete).toBeNull();
    
    console.log('[Test] Basic cache operations successful');
  });

  it('should perform health check', async () => {
    const { redisService } = await import('./services/redisService');
    
    const health = await redisService.healthCheck();
    
    expect(health).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(health).toHaveProperty('memory');
    expect(health.memory).toBe(true);
    
    console.log('[Test] Health check result:', health);
  }, 30000); // Increase timeout to 30s for Redis health check
});
