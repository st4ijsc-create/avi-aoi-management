/**
 * doc 51 P0 (R3) — MQTT TOPIC ACL.
 *
 * Regression guard for the verified gap: the broker had NO authorizePublish/authorizeSubscribe
 * (`grep` = 0 matches), so every authenticated client could pub/sub every topic — including
 * another device's COMMAND topics (`avi/client/{other}/configure`).
 *
 * These tests drive the PURE decision functions (canPublish / canSubscribe) with an explicit
 * `env` object, so nothing here mutates process.env and no broker/DB is required.
 *
 * The `synapse/` cases matter because of the doc 44 §11 R-3 rebrand: the ACL must not be
 * bypassable by simply addressing the twin namespace.
 */
import { describe, it, expect } from 'vitest';
import {
  canPublish,
  canSubscribe,
  matchesMqttFilter,
  aclContextFromClient,
  mqttTopicAclEnabled,
  mqttTopicAclWarnOnly,
  MQTT_ACL_DEVICE_ID_PROP,
  type MqttAclContext,
} from './services/mqttService';

/** Enforcing config (the production default). */
const ENFORCE: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv;
/** Rollout config: violations logged, but allowed. */
const WARN_ONLY: NodeJS.ProcessEnv = { MQTT_TOPIC_ACL_WARN_ONLY: 'true' } as NodeJS.ProcessEnv;
/** Escape hatch: enforcement off entirely. */
const DISABLED: NodeJS.ProcessEnv = { MQTT_TOPIC_ACL_ENABLED: 'false' } as NodeJS.ProcessEnv;

const deviceA: MqttAclContext = { clientId: 'tablet-a-1', deviceId: 'A' };
const deviceB: MqttAclContext = { clientId: 'tablet-b-1', deviceId: 'B' };
const server: MqttAclContext = { clientId: '<internal>', isServer: true };

describe('flag defaults (doc 51 P0 — secure by default)', () => {
  it('ACL is ENABLED by default (no env set)', () => {
    expect(mqttTopicAclEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('ACL can be disabled only by an explicit off value', () => {
    for (const v of ['false', '0', 'off', 'FALSE', 'Off']) {
      expect(mqttTopicAclEnabled({ MQTT_TOPIC_ACL_ENABLED: v } as NodeJS.ProcessEnv)).toBe(false);
    }
    // Anything else (including junk) stays SAFE = enabled.
    for (const v of ['true', '1', '', 'yes', 'nope']) {
      expect(mqttTopicAclEnabled({ MQTT_TOPIC_ACL_ENABLED: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it('warn-only is OFF by default (enforce), on only for explicit truthy values', () => {
    expect(mqttTopicAclWarnOnly({} as NodeJS.ProcessEnv)).toBe(false);
    for (const v of ['true', '1', 'on', 'TRUE']) {
      expect(mqttTopicAclWarnOnly({ MQTT_TOPIC_ACL_WARN_ONLY: v } as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const v of ['false', '0', '']) {
      expect(mqttTopicAclWarnOnly({ MQTT_TOPIC_ACL_WARN_ONLY: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});

describe('matchesMqttFilter', () => {
  it('matches exact topics', () => {
    expect(matchesMqttFilter('avi/client/A/info', 'avi/client/A/info')).toBe(true);
    expect(matchesMqttFilter('avi/client/A/info', 'avi/client/B/info')).toBe(false);
  });

  it('+ matches exactly one level', () => {
    expect(matchesMqttFilter('avi/client/+/info', 'avi/client/A/info')).toBe(true);
    expect(matchesMqttFilter('avi/client/+/info', 'avi/client/A/deep/info')).toBe(false);
  });

  it('# matches the remainder, including zero levels', () => {
    expect(matchesMqttFilter('avi/#', 'avi/client/A/info')).toBe(true);
    expect(matchesMqttFilter('avi/#', 'avi')).toBe(true);
    expect(matchesMqttFilter('avi/client/#', 'synapse/client/A/info')).toBe(false);
  });

  it('does not match a shorter/longer topic than a wildcard-free filter', () => {
    expect(matchesMqttFilter('avi/client/A', 'avi/client/A/info')).toBe(false);
    expect(matchesMqttFilter('avi/client/A/info', 'avi/client/A')).toBe(false);
  });
});

describe('canPublish — device may only write its OWN branch', () => {
  it('device A CANNOT publish on device B branch (impersonation)', () => {
    const d = canPublish(deviceA, 'avi/client/B/info', ENFORCE);
    expect(d.allow).toBe(false);
    expect(d.violation).toBe(true);
    expect(d.reason).toContain('another device');
  });

  it('device A CANNOT publish device B ack', () => {
    expect(canPublish(deviceA, 'avi/client/B/ack', ENFORCE).allow).toBe(false);
  });

  it('device A CAN publish on its own branch (info + ack — the real inbound path)', () => {
    expect(canPublish(deviceA, 'avi/client/A/info', ENFORCE).allow).toBe(true);
    expect(canPublish(deviceA, 'avi/client/A/ack', ENFORCE).allow).toBe(true);
    expect(canPublish(deviceA, 'avi/client/A/info', ENFORCE).violation).toBe(false);
  });

  it('edge device CAN publish its own edge branch but NOT another edge device branch', () => {
    expect(canPublish(deviceA, 'avi/edge/A/status', ENFORCE).allow).toBe(true);
    expect(canPublish(deviceA, 'avi/edge/B/status', ENFORCE).allow).toBe(false);
  });
});

describe('canPublish — command/broadcast topics are SERVER-ONLY', () => {
  it('device CANNOT publish avi/client/*/configure — not even on its own branch', () => {
    expect(canPublish(deviceA, 'avi/client/B/configure', ENFORCE).allow).toBe(false);
    // Own-branch too: a device must never forge a CONFIGURE command.
    const own = canPublish(deviceA, 'avi/client/A/configure', ENFORCE);
    expect(own.allow).toBe(false);
    expect(own.reason).toContain('server-only');
  });

  it('device CANNOT publish avi/client/*/commands', () => {
    expect(canPublish(deviceA, 'avi/client/A/commands', ENFORCE).allow).toBe(false);
  });

  it('device CANNOT publish avi/edge/*/model-update', () => {
    expect(canPublish(deviceA, 'avi/edge/A/model-update', ENFORCE).allow).toBe(false);
  });

  it('device CANNOT forge NG alerts / summaries / bulletins on the factory branch', () => {
    const topics = [
      'avi/factory/1/workshop/2/station/3/errors',
      'avi/factory/1/workshop/2/station/3/summary/daily',
      'avi/factory/1/workshop/2/station/3/bulletin/periodic',
    ];
    for (const t of topics) {
      const d = canPublish(deviceA, t, ENFORCE);
      expect(d.allow).toBe(false);
      expect(d.reason).toContain('server-only');
    }
  });

  it('device CANNOT publish other server-only namespaces', () => {
    for (const t of [
      'avi/escalations/alert/9',
      'avi/system/broadcast',
      'avi/points-config-changed/MODEL-X',
      'avi/factory-alert/update',
    ]) {
      expect(canPublish(deviceA, t, ENFORCE).allow).toBe(false);
    }
  });

  it('SERVER may publish every branch', () => {
    for (const t of [
      'avi/factory/1/workshop/2/station/3/errors',
      'avi/client/A/configure',
      'avi/client/B/configure',
      'avi/edge/A/model-update',
      'avi/system/broadcast',
      'synapse/factory/1/workshop/2/station/3/errors',
    ]) {
      const d = canPublish(server, t, ENFORCE);
      expect(d.allow).toBe(true);
      expect(d.violation).toBe(false);
    }
  });
});

describe('canPublish — scope + hardening', () => {
  it('allows topics outside the brand namespace (sensor ingest / syn contracts stay working)', () => {
    // Deliberate scope call (QĐ#1): tightening these is a separate step.
    expect(canPublish(deviceA, 'factory/1/MC-01/sensor/temp', ENFORCE).allow).toBe(true);
    expect(canPublish(deviceA, 'syn/l1/dev0/telemetry', ENFORCE).allow).toBe(true);
    expect(canPublish(deviceA, 'avi-aoi/factory/1/x', ENFORCE).allow).toBe(true);
  });

  it('allows the explicit test namespace', () => {
    expect(canPublish(deviceA, 'avi/test/anything', ENFORCE).allow).toBe(true);
  });

  it('re-implements the aedes default $SYS guard we overrode', () => {
    expect(canPublish(deviceA, '$SYS/broker/uptime', ENFORCE).allow).toBe(false);
  });

  it('rejects wildcards in a PUBLISH topic (defence in depth)', () => {
    expect(canPublish(deviceA, 'avi/client/+/info', ENFORCE).allow).toBe(false);
    expect(canPublish(deviceA, 'avi/client/#', ENFORCE).allow).toBe(false);
  });

  it('an UNAUTHENTICATED client (no deviceId) owns no branch', () => {
    const anon: MqttAclContext = { clientId: 'spoofer' };
    expect(canPublish(anon, 'avi/client/A/info', ENFORCE).allow).toBe(false);
  });

  it('does NOT confuse a same-prefix root (aviator/) with the avi/ root', () => {
    expect(canPublish(deviceA, 'aviator/client/B/info', ENFORCE).allow).toBe(true);
  });
});

describe('canSubscribe — device may not read another device branch', () => {
  it('device A CANNOT subscribe to avi/client/B/* (literal foreign id)', () => {
    const d = canSubscribe(deviceA, 'avi/client/B/configure', ENFORCE);
    expect(d.allow).toBe(false);
    expect(d.violation).toBe(true);
  });

  it('device A CANNOT wildcard across device branches', () => {
    for (const f of [
      'avi/client/+/configure',
      'avi/client/#',
      'avi/edge/+/model-update',
      'avi/#',
      '#',
      '+/client/B/info',
    ]) {
      expect(canSubscribe(deviceA, f, ENFORCE).allow).toBe(false);
    }
  });

  it('device A CAN subscribe to its OWN branch (configure — required to be commandable)', () => {
    expect(canSubscribe(deviceA, 'avi/client/A/configure', ENFORCE).allow).toBe(true);
    expect(canSubscribe(deviceA, 'avi/client/A/#', ENFORCE).allow).toBe(true);
    expect(canSubscribe(deviceA, 'avi/edge/A/model-update', ENFORCE).allow).toBe(true);
  });

  it('device B sees the mirror image of device A rights', () => {
    expect(canSubscribe(deviceB, 'avi/client/B/configure', ENFORCE).allow).toBe(true);
    expect(canSubscribe(deviceB, 'avi/client/A/configure', ENFORCE).allow).toBe(false);
  });

  it('KEEPS the real FactoryAlertSystem broadcast subscriptions working', () => {
    // Straight from FactoryAlertSystem/src/utils/constants.ts — these MUST NOT break.
    for (const f of [
      'avi/factory/+/workshop/+/station/+/errors',
      'avi/factory/+/workshop/+/station/+/alerts',
      'avi/factory/+/workshop/+/station/+/bulletin/periodic',
      'avi/factory/+/workshop/+/station/+/ng-rate-alert',
      'avi-aoi/factory/+/workshop/+/station/+/ng-rate-alert',
      'avi/+/workshop/+/station/+/errors',
      'avi-aoi/#',
      'avi/test/#',
      'avi/escalations/#',
      'avi/factory-alert/update',
    ]) {
      expect(canSubscribe(deviceA, f, ENFORCE), `filter ${f} must stay allowed`).toMatchObject({
        allow: true,
        violation: false,
      });
    }
  });

  it('a wildcarded BRANCH slot cannot be used to bypass the id check', () => {
    // `avi/+/B/info` really does match `avi/client/B/info` → must be denied.
    expect(canSubscribe(deviceA, 'avi/+/B/info', ENFORCE).allow).toBe(false);
    expect(canSubscribe(deviceA, 'avi/+/B/configure', ENFORCE).allow).toBe(false);
    expect(canSubscribe(deviceA, 'avi/+/+/configure', ENFORCE).allow).toBe(false);
    expect(canSubscribe(deviceA, 'avi/+/#', ENFORCE).allow).toBe(false);
    // …but the same wildcarded slot on the device's OWN id is fine.
    expect(canSubscribe(deviceA, 'avi/+/A/info', ENFORCE).allow).toBe(true);
  });

  it('does not over-deny the APK legacy broadcast filter (regression: caught in review)', () => {
    // `avi/+/workshop/+/station/+/errors` wildcards the branch slot but is 7 levels deep, so
    // it can only reach a *private* topic of a device literally named "workshop" — no such
    // topic exists. Over-denying here would break shipping tablets (QĐ#1).
    const d = canSubscribe(deviceA, 'avi/+/workshop/+/station/+/errors', ENFORCE);
    expect(d.allow).toBe(true);
    expect(d.violation).toBe(false);
  });

  it('an unauthenticated client cannot subscribe to any per-device branch', () => {
    const anon: MqttAclContext = { clientId: 'spoofer' };
    expect(canSubscribe(anon, 'avi/client/A/configure', ENFORCE).allow).toBe(false);
    // …but broadcast alert topics are not per-device, so they remain allowed.
    expect(canSubscribe(anon, 'avi/factory/+/workshop/+/station/+/errors', ENFORCE).allow).toBe(true);
  });

  it('SERVER may subscribe anywhere', () => {
    expect(canSubscribe(server, 'avi/client/+/ack', ENFORCE).allow).toBe(true);
    expect(canSubscribe(server, '#', ENFORCE).allow).toBe(true);
  });
});

describe('rebrand — the synapse/ twin must NOT bypass the ACL (doc 44 §11 R-3)', () => {
  it('blocks impersonation via the synapse/ prefix', () => {
    expect(canPublish(deviceA, 'synapse/client/B/info', ENFORCE).allow).toBe(false);
    expect(canPublish(deviceA, 'synapse/client/A/configure', ENFORCE).allow).toBe(false);
    expect(canPublish(deviceA, 'synapse/factory/1/workshop/2/station/3/errors', ENFORCE).allow).toBe(false);
    expect(canSubscribe(deviceA, 'synapse/client/B/configure', ENFORCE).allow).toBe(false);
    expect(canSubscribe(deviceA, 'synapse/#', ENFORCE).allow).toBe(false);
  });

  it('still allows a migrated device its own synapse/ branch', () => {
    expect(canPublish(deviceA, 'synapse/client/A/info', ENFORCE).allow).toBe(true);
    expect(canSubscribe(deviceA, 'synapse/client/A/configure', ENFORCE).allow).toBe(true);
    expect(canSubscribe(deviceA, 'synapse/factory/+/workshop/+/station/+/errors', ENFORCE).allow).toBe(true);
  });
});

describe('rollout modes (QĐ#1 — migration, not a sudden flip)', () => {
  it('WARN-ONLY lets the violation through but still FLAGS it', () => {
    const d = canPublish(deviceA, 'avi/client/B/configure', WARN_ONLY);
    expect(d.allow).toBe(true); // tablets keep working…
    expect(d.violation).toBe(true); // …but ops sees it in the log
    expect(d.reason).toContain('warn-only');
  });

  it('WARN-ONLY applies to subscribe too', () => {
    const d = canSubscribe(deviceA, 'avi/client/B/#', WARN_ONLY);
    expect(d.allow).toBe(true);
    expect(d.violation).toBe(true);
  });

  it('WARN-ONLY does not invent violations for legitimate traffic', () => {
    expect(canPublish(deviceA, 'avi/client/A/info', WARN_ONLY)).toMatchObject({
      allow: true,
      violation: false,
    });
  });

  it('DISABLED allows everything and reports no violation', () => {
    expect(canPublish(deviceA, 'avi/client/B/configure', DISABLED)).toMatchObject({
      allow: true,
      violation: false,
      reason: 'acl-disabled',
    });
    expect(canSubscribe(deviceA, '#', DISABLED).allow).toBe(true);
  });
});

describe('aclContextFromClient — trust binding', () => {
  it('treats a missing client (aedes.publish from server code) as the SERVER', () => {
    expect(aclContextFromClient(null)).toMatchObject({ isServer: true });
    expect(aclContextFromClient(undefined)).toMatchObject({ isServer: true });
  });

  it('reads the deviceId stamped at authenticate, NOT the client-supplied clientId', () => {
    const client = { id: 'some-client-id', [MQTT_ACL_DEVICE_ID_PROP]: 'A' };
    expect(aclContextFromClient(client)).toEqual({ clientId: 'some-client-id', deviceId: 'A' });
  });

  it('a client that spoofs a server-ish clientId gains NO privilege', () => {
    // The external bridge uses clientId `avi-aoi-server-*`; a device could claim it.
    const spoofer = { id: 'avi-aoi-server-999', [MQTT_ACL_DEVICE_ID_PROP]: 'A' };
    const ctx = aclContextFromClient(spoofer);
    expect(ctx.isServer).toBeUndefined();
    expect(canPublish(ctx, 'avi/client/B/configure', ENFORCE).allow).toBe(false);
    expect(canPublish(ctx, 'avi/factory/1/workshop/2/station/3/errors', ENFORCE).allow).toBe(false);
  });

  it('ignores a non-string / empty stamped deviceId', () => {
    expect(aclContextFromClient({ id: 'x', [MQTT_ACL_DEVICE_ID_PROP]: '' }).deviceId).toBeUndefined();
    expect(aclContextFromClient({ id: 'x', [MQTT_ACL_DEVICE_ID_PROP]: 42 }).deviceId).toBeUndefined();
  });
});
