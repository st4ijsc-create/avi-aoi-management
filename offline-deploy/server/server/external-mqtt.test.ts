import { describe, it, expect } from 'vitest';

describe('External MQTT Configuration', () => {
  it('should have EXTERNAL_MQTT_ENABLED set', () => {
    const enabled = process.env.EXTERNAL_MQTT_ENABLED;
    expect(enabled).toBeDefined();
    expect(['true', 'false']).toContain(enabled);
    console.log('EXTERNAL_MQTT_ENABLED:', enabled);
  });

  it('should have valid EXTERNAL_MQTT_BROKER default', () => {
    const broker = process.env.EXTERNAL_MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
    expect(broker).toMatch(/^mqtt(s)?:\/\/.+/);
    console.log('EXTERNAL_MQTT_BROKER:', broker);
  });

  it('should have valid EXTERNAL_MQTT_TOPIC_PREFIX default', () => {
    const prefix = process.env.EXTERNAL_MQTT_TOPIC_PREFIX || 'avi-aoi';
    expect(prefix.length).toBeGreaterThan(0);
    console.log('EXTERNAL_MQTT_TOPIC_PREFIX:', prefix);
  });
});
