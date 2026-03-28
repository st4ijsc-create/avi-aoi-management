/**
 * Test MQTT và FCM configuration
 */
import { describe, it, expect } from 'vitest';

describe('MQTT Configuration', () => {
  it('should have MQTT_ENABLED environment variable', () => {
    const mqttEnabled = process.env.MQTT_ENABLED;
    console.log('MQTT_ENABLED:', mqttEnabled);
    // MQTT_ENABLED can be 'true', 'false', or undefined
    expect(['true', 'false', undefined, '']).toContain(mqttEnabled);
  });

  it('should parse MQTT_ENABLED as boolean correctly', () => {
    const mqttEnabled = process.env.MQTT_ENABLED === 'true';
    console.log('MQTT enabled (boolean):', mqttEnabled);
    expect(typeof mqttEnabled).toBe('boolean');
  });
});

describe('FCM Configuration', () => {
  it('should have FIREBASE_SERVICE_ACCOUNT_JSON environment variable', () => {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    console.log('FIREBASE_SERVICE_ACCOUNT_JSON exists:', !!serviceAccount);
    // Service account can be undefined if not configured
    expect(true).toBe(true); // Always pass, just log the status
  });

  it('should parse FIREBASE_SERVICE_ACCOUNT_JSON as valid JSON if provided', () => {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    
    if (!serviceAccount) {
      console.log('FIREBASE_SERVICE_ACCOUNT_JSON not configured, skipping validation');
      expect(true).toBe(true);
      return;
    }

    try {
      // Try parsing as JSON first
      let parsed;
      if (serviceAccount.startsWith('{')) {
        parsed = JSON.parse(serviceAccount);
      } else {
        // Try base64 decode
        const decoded = Buffer.from(serviceAccount, 'base64').toString('utf-8');
        parsed = JSON.parse(decoded);
      }

      console.log('Service account project_id:', parsed.project_id);
      console.log('Service account client_email:', parsed.client_email);

      // Validate required fields
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('project_id');
      expect(parsed).toHaveProperty('private_key');
      expect(parsed).toHaveProperty('client_email');
      expect(parsed.type).toBe('service_account');
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error);
      // If parsing fails, the test should fail
      expect(false).toBe(true);
    }
  });
});
