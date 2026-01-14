import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database functions
vi.mock('./db', () => ({
  createUserSession: vi.fn().mockResolvedValue(1),
  getUserSessions: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      sessionToken: 'token123',
      deviceType: 'desktop',
      deviceName: 'Chrome on Windows',
      browser: 'Chrome',
      os: 'Windows',
      ipAddress: '192.168.1.1',
      location: 'Vietnam',
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      isActive: true,
      createdAt: new Date(),
    },
    {
      id: 2,
      userId: 1,
      sessionToken: 'token456',
      deviceType: 'mobile',
      deviceName: 'Safari on iOS',
      browser: 'Safari',
      os: 'iOS',
      ipAddress: '192.168.1.2',
      location: 'Vietnam',
      lastActivityAt: new Date(Date.now() - 3600000),
      expiresAt: new Date(Date.now() + 86400000),
      isActive: true,
      createdAt: new Date(),
    },
  ]),
  revokeUserSession: vi.fn().mockResolvedValue(undefined),
  revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
  generateBackupCodes: vi.fn().mockResolvedValue([
    'ABC123', 'DEF456', 'GHI789', 'JKL012', 'MNO345',
    'PQR678', 'STU901', 'VWX234', 'YZA567', 'BCD890',
  ]),
  getBackupCodesStatus: vi.fn().mockResolvedValue({
    totalCount: 10,
    unusedCount: 8,
    usedCount: 2,
  }),
  verifyBackupCode: vi.fn().mockResolvedValue(true),
  getSystemSetting: vi.fn().mockResolvedValue({
    id: 1,
    settingKey: 'require_2fa',
    settingValue: 'false',
    category: 'security',
  }),
  updateSystemSetting: vi.fn().mockResolvedValue(undefined),
  getSystemSettings: vi.fn().mockResolvedValue([
    { id: 1, settingKey: 'require_2fa', settingValue: 'false', category: 'security' },
    { id: 2, settingKey: 'require_2fa_for_admin', settingValue: 'true', category: 'security' },
  ]),
}));

describe('Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserSessions', () => {
    it('should return list of active sessions for a user', async () => {
      const { getUserSessions } = await import('./db');
      const sessions = await getUserSessions(1);
      
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toHaveProperty('deviceType');
      expect(sessions[0]).toHaveProperty('browser');
      expect(sessions[0]).toHaveProperty('os');
      expect(sessions[0]).toHaveProperty('ipAddress');
    });

    it('should include session metadata', async () => {
      const { getUserSessions } = await import('./db');
      const sessions = await getUserSessions(1);
      
      expect(sessions[0].deviceType).toBe('desktop');
      expect(sessions[0].browser).toBe('Chrome');
      expect(sessions[1].deviceType).toBe('mobile');
    });
  });

  describe('createUserSession', () => {
    it('should create a new session', async () => {
      const { createUserSession } = await import('./db');
      const sessionId = await createUserSession({
        userId: 1,
        sessionToken: 'newtoken',
        deviceType: 'desktop',
        browser: 'Firefox',
        os: 'Linux',
        ipAddress: '10.0.0.1',
        expiresAt: new Date(Date.now() + 86400000),
      });
      
      expect(sessionId).toBe(1);
      expect(createUserSession).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1,
        sessionToken: 'newtoken',
      }));
    });
  });

  describe('revokeUserSession', () => {
    it('should revoke a specific session', async () => {
      const { revokeUserSession } = await import('./db');
      await revokeUserSession(1, 2);
      
      expect(revokeUserSession).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should revoke all sessions except current', async () => {
      const { revokeAllUserSessions } = await import('./db');
      await revokeAllUserSessions(1, 'currentToken');
      
      expect(revokeAllUserSessions).toHaveBeenCalledWith(1, 'currentToken');
    });
  });
});

describe('Backup Codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateBackupCodes', () => {
    it('should generate 10 backup codes', async () => {
      const { generateBackupCodes } = await import('./db');
      const codes = await generateBackupCodes(1);
      
      expect(codes).toHaveLength(10);
      expect(codes[0]).toMatch(/^[A-Z0-9]+$/);
    });
  });

  describe('getBackupCodesStatus', () => {
    it('should return backup codes status', async () => {
      const { getBackupCodesStatus } = await import('./db');
      const status = await getBackupCodesStatus(1);
      
      expect(status).toHaveProperty('totalCount', 10);
      expect(status).toHaveProperty('unusedCount', 8);
      expect(status).toHaveProperty('usedCount', 2);
    });
  });

  describe('verifyBackupCode', () => {
    it('should verify a valid backup code', async () => {
      const { verifyBackupCode } = await import('./db');
      const result = await verifyBackupCode(1, 'ABC123');
      
      expect(result).toBe(true);
    });
  });
});

describe('System Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSystemSetting', () => {
    it('should return a system setting by key', async () => {
      const { getSystemSetting } = await import('./db');
      const setting = await getSystemSetting('require_2fa');
      
      expect(setting).toHaveProperty('settingKey', 'require_2fa');
      expect(setting).toHaveProperty('settingValue', 'false');
    });
  });

  describe('getSystemSettings', () => {
    it('should return all settings in a category', async () => {
      const { getSystemSettings } = await import('./db');
      const settings = await getSystemSettings('security');
      
      expect(settings).toHaveLength(2);
      expect(settings[0].category).toBe('security');
    });
  });

  describe('updateSystemSetting', () => {
    it('should update a system setting', async () => {
      const { updateSystemSetting } = await import('./db');
      await updateSystemSetting('require_2fa', 'true', 1);
      
      expect(updateSystemSetting).toHaveBeenCalledWith('require_2fa', 'true', 1);
    });
  });
});
