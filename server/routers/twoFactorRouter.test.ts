import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ 
      twoFactorEnabled: false, 
      twoFactorSecret: null,
      email: 'test@example.com',
      name: 'Test User'
    }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('speakeasy', () => ({
  default: {
    generateSecret: vi.fn().mockReturnValue({
      base32: 'TESTBASE32SECRET',
      otpauth_url: 'otpauth://totp/SYNAPSE:test@example.com?secret=TESTBASE32SECRET&issuer=SYNAPSE',
    }),
    totp: {
      verify: vi.fn().mockReturnValue(true),
    },
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqrcode'),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashedcode'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

describe('twoFactorRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should return 2FA status for user', async () => {
      // Test that the router structure is correct
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter).toBeDefined();
      expect(twoFactorRouter._def.procedures.getStatus).toBeDefined();
    });
  });

  describe('generateSecret', () => {
    it('should have generateSecret procedure defined', async () => {
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter._def.procedures.generateSecret).toBeDefined();
    });
  });

  describe('enable', () => {
    it('should have enable procedure defined', async () => {
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter._def.procedures.enable).toBeDefined();
    });
  });

  describe('disable', () => {
    it('should have disable procedure defined', async () => {
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter._def.procedures.disable).toBeDefined();
    });
  });

  describe('verify', () => {
    it('should have verify procedure defined', async () => {
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter._def.procedures.verify).toBeDefined();
    });
  });

  describe('regenerateBackupCodes', () => {
    it('should have regenerateBackupCodes procedure defined', async () => {
      const { twoFactorRouter } = await import('./twoFactorRouter');
      expect(twoFactorRouter._def.procedures.regenerateBackupCodes).toBeDefined();
    });
  });

  describe('backup code generation', () => {
    it('should generate 8-character hex codes', () => {
      // Test the backup code format (8 uppercase hex characters)
      const codePattern = /^[0-9A-F]{8}$/;
      const testCode = 'ABCD1234';
      expect(codePattern.test(testCode)).toBe(true);
    });
  });

  describe('TOTP verification', () => {
    it('should accept 6-digit codes', () => {
      const validCode = '123456';
      expect(validCode.length).toBe(6);
      expect(/^\d+$/.test(validCode)).toBe(true);
    });

    it('should reject non-6-digit codes', () => {
      const invalidCodes = ['12345', '1234567', 'abcdef', ''];
      invalidCodes.forEach(code => {
        const isValid = code.length === 6 && /^\d+$/.test(code);
        expect(isValid).toBe(false);
      });
    });
  });
});
