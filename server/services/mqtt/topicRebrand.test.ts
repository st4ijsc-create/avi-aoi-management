/**
 * doc 44 §11 R-3 — MQTT topic rebrand avi/ ↔ synapse/ (dual-publish + dual-subscribe).
 *
 * Pure unit tests — no broker, no DB. Locks the two invariants the field rollout depends on:
 *   • the topic map is a correct, round-tripping bijection on the leading segment;
 *   • the publish PLAN is byte-compatible by DEFAULT (legacy-only), emits BOTH under dual,
 *     and cuts to synapse-only ONLY when legacy-disable is set on top of dual.
 */
import { describe, it, expect, vi } from "vitest";

import {
  toSynapseTopic,
  toAviTopic,
  toSynapseExternalPrefix,
  isDualPublishEnabled,
  isLegacyDisabled,
  planPublishTopics,
  dualPublish,
  canonicalizeInboundTopic,
  resolveServerClientId,
  LEGACY_TOPIC_ROOT,
  SYNAPSE_TOPIC_ROOT,
  LEGACY_EXTERNAL_PREFIX,
  SYNAPSE_EXTERNAL_PREFIX,
  LEGACY_SERVER_CLIENT_ID,
  SYNAPSE_SERVER_CLIENT_ID,
} from "./topicRebrand";

const OFF: NodeJS.ProcessEnv = {};
const DUAL: NodeJS.ProcessEnv = { MQTT_TOPIC_DUAL_PUBLISH: "true" };
const CUTOVER: NodeJS.ProcessEnv = {
  MQTT_TOPIC_DUAL_PUBLISH: "true",
  MQTT_TOPIC_LEGACY_DISABLE: "true",
};

describe("topicRebrand — map avi/ ↔ synapse/ (bijection + round-trip)", () => {
  const cases = [
    "avi/factory/12/workshop/3/station/45/errors",
    "avi/client/dev-1/info",
    "avi/client/dev-1/commands",
    "avi/points-config-changed/PM-001",
    "avi/edge/dev-9/model-update",
    "avi/factory-alert/update",
    "avi", // exact root
  ];

  it("avi/… → synapse/… rewrites ONLY the leading segment", () => {
    expect(toSynapseTopic("avi/factory/12/errors")).toBe("synapse/factory/12/errors");
    expect(toSynapseTopic("avi")).toBe("synapse");
  });

  it("synapse/… → avi/… is the exact inverse", () => {
    expect(toAviTopic("synapse/factory/12/errors")).toBe("avi/factory/12/errors");
    expect(toAviTopic("synapse")).toBe("avi");
  });

  it("round-trips avi → synapse → avi for every real topic", () => {
    for (const t of cases) {
      expect(toAviTopic(toSynapseTopic(t))).toBe(t);
    }
  });

  it("round-trips synapse → avi → synapse", () => {
    for (const t of cases) {
      const s = toSynapseTopic(t);
      expect(toSynapseTopic(toAviTopic(s))).toBe(s);
    }
  });

  it("does NOT touch a topic that merely shares the root's characters", () => {
    expect(toSynapseTopic("aviator/x")).toBe("aviator/x"); // 'avi' is not a full segment
    expect(toSynapseTopic("syn/hn/aoi/telemetry")).toBe("syn/hn/aoi/telemetry"); // not avi-rooted
    expect(toAviTopic("synapseX/y")).toBe("synapseX/y");
  });

  it("is idempotent on the target namespace", () => {
    expect(toSynapseTopic("synapse/a/b")).toBe("synapse/a/b");
    expect(toAviTopic("avi/a/b")).toBe("avi/a/b");
  });

  it("root constants are the expected brand tokens", () => {
    expect(LEGACY_TOPIC_ROOT).toBe("avi");
    expect(SYNAPSE_TOPIC_ROOT).toBe("synapse");
  });
});

describe("topicRebrand — external prefix map (avi-aoi ↔ synapse)", () => {
  it("maps the default external prefix", () => {
    expect(toSynapseExternalPrefix(LEGACY_EXTERNAL_PREFIX)).toBe(SYNAPSE_EXTERNAL_PREFIX);
    expect(toSynapseExternalPrefix("avi-aoi")).toBe("synapse");
    expect(toSynapseExternalPrefix("avi")).toBe("synapse");
  });

  it("leaves a custom, non-brand prefix untouched (external mirror no-ops)", () => {
    expect(toSynapseExternalPrefix("prod")).toBe("prod");
    expect(toSynapseExternalPrefix("")).toBe("");
  });
});

describe("topicRebrand — flag readers", () => {
  it("dual-publish default OFF; true/1 enable", () => {
    expect(isDualPublishEnabled(OFF)).toBe(false);
    expect(isDualPublishEnabled({ MQTT_TOPIC_DUAL_PUBLISH: "true" })).toBe(true);
    expect(isDualPublishEnabled({ MQTT_TOPIC_DUAL_PUBLISH: "1" })).toBe(true);
    expect(isDualPublishEnabled({ MQTT_TOPIC_DUAL_PUBLISH: "yes" })).toBe(false);
  });

  it("legacy-disable default OFF; true/1 enable", () => {
    expect(isLegacyDisabled(OFF)).toBe(false);
    expect(isLegacyDisabled({ MQTT_TOPIC_LEGACY_DISABLE: "true" })).toBe(true);
    expect(isLegacyDisabled({ MQTT_TOPIC_LEGACY_DISABLE: "1" })).toBe(true);
  });
});

describe("topicRebrand — planPublishTopics (the rollout matrix)", () => {
  const t = "avi/factory/12/workshop/3/station/45/errors";
  const s = "synapse/factory/12/workshop/3/station/45/errors";

  it("DEFAULT (both flags off) → legacy ONLY (byte-compatible)", () => {
    expect(planPublishTopics(t, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, OFF)).toEqual([t]);
  });

  it("dual ON → BOTH, legacy PRIMARY (index 0)", () => {
    expect(planPublishTopics(t, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, DUAL)).toEqual([t, s]);
  });

  it("dual ON + legacy-disable ON → synapse ONLY (cutover)", () => {
    expect(planPublishTopics(t, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, CUTOVER)).toEqual([s]);
  });

  it("legacy-disable ALONE (no dual) is inert → still legacy only (fail-safe, never empty)", () => {
    const env = { MQTT_TOPIC_LEGACY_DISABLE: "true" };
    expect(planPublishTopics(t, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, env)).toEqual([t]);
  });

  it("a non-avi topic is never rebranded, in any flag state", () => {
    const other = "syn/hn/smt/l1/telemetry";
    for (const env of [OFF, DUAL, CUTOVER]) {
      expect(planPublishTopics(other, LEGACY_TOPIC_ROOT, SYNAPSE_TOPIC_ROOT, env)).toEqual([other]);
    }
  });

  it("works for the external prefix roots too (avi-aoi → synapse)", () => {
    const ext = "avi-aoi/factory/1/errors";
    expect(planPublishTopics(ext, LEGACY_EXTERNAL_PREFIX, SYNAPSE_EXTERNAL_PREFIX, OFF)).toEqual([ext]);
    expect(planPublishTopics(ext, LEGACY_EXTERNAL_PREFIX, SYNAPSE_EXTERNAL_PREFIX, DUAL)).toEqual([
      ext,
      "synapse/factory/1/errors",
    ]);
    expect(planPublishTopics(ext, LEGACY_EXTERNAL_PREFIX, SYNAPSE_EXTERNAL_PREFIX, CUTOVER)).toEqual([
      "synapse/factory/1/errors",
    ]);
  });
});

describe("dualPublish — emits on a MOCK broker per the matrix", () => {
  /** A minimal broker whose publish records the topic it was asked to send. */
  function makeBroker() {
    const publish = vi.fn((packet: { topic: string }, _cb?: unknown) => {});
    return { publish };
  }

  it("DEFAULT (off) → the broker sees ONLY the avi/ topic (single publish)", () => {
    const broker = makeBroker();
    dualPublish(
      { topic: "avi/client/dev-1/commands", payload: Buffer.from("x") },
      (p) => broker.publish(p),
      { env: OFF },
    );
    expect(broker.publish).toHaveBeenCalledTimes(1);
    expect(broker.publish.mock.calls[0][0].topic).toBe("avi/client/dev-1/commands");
  });

  it("dual ON → the broker sees BOTH topics, legacy first", () => {
    const broker = makeBroker();
    const seen: string[] = [];
    dualPublish(
      { topic: "avi/client/dev-1/commands", payload: Buffer.from("x") },
      (p) => {
        seen.push(p.topic);
        broker.publish(p);
      },
      { env: DUAL },
    );
    expect(broker.publish).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["avi/client/dev-1/commands", "synapse/client/dev-1/commands"]);
  });

  it("cutover → the broker sees ONLY the synapse/ topic", () => {
    const broker = makeBroker();
    const seen: string[] = [];
    dualPublish(
      { topic: "avi/factory/1/errors", payload: Buffer.from("x") },
      (p) => {
        seen.push(p.topic);
        broker.publish(p);
      },
      { env: CUTOVER },
    );
    expect(seen).toEqual(["synapse/factory/1/errors"]);
  });

  it("marks the FIRST emission as primary (keeps the real publish callback)", () => {
    const flags: boolean[] = [];
    dualPublish(
      { topic: "avi/a" },
      (_p, isPrimary) => flags.push(isPrimary),
      { env: DUAL },
    );
    expect(flags).toEqual([true, false]);
  });

  it("preserves the original packet object (payload Buffer) for the primary topic", () => {
    const buf = Buffer.from("payload");
    const original = { topic: "avi/a/b", payload: buf, qos: 1 as const };
    const emitted: Array<{ topic: string; payload: Buffer }> = [];
    dualPublish(original, (p) => emitted.push(p as any), { env: DUAL });
    // primary reuses the SAME object; mirror is a shallow clone sharing the Buffer.
    expect(emitted[0]).toBe(original);
    expect(emitted[1]).not.toBe(original);
    expect(emitted[1].payload).toBe(buf);
    expect(emitted[1].topic).toBe("synapse/a/b");
  });
});

describe("dual-subscribe — canonicalizeInboundTopic (synapse/ → avi/)", () => {
  it("normalises a migrated device's synapse/ topic back to the avi/ matcher shape", () => {
    expect(canonicalizeInboundTopic("synapse/client/dev-1/info")).toBe("avi/client/dev-1/info");
    expect(canonicalizeInboundTopic("synapse/client/dev-1/ack")).toBe("avi/client/dev-1/ack");
  });
  it("leaves a legacy avi/ inbound topic unchanged", () => {
    expect(canonicalizeInboundTopic("avi/client/dev-1/info")).toBe("avi/client/dev-1/info");
  });
});

describe("resolveServerClientId — brand flips only at cutover", () => {
  it("stays legacy through default + dual-publish grace (ACL-safe)", () => {
    expect(resolveServerClientId(OFF)).toBe(LEGACY_SERVER_CLIENT_ID);
    expect(resolveServerClientId(DUAL)).toBe(LEGACY_SERVER_CLIENT_ID);
  });
  it("flips to synapse only when legacy is disabled (final cutover)", () => {
    expect(resolveServerClientId(CUTOVER)).toBe(SYNAPSE_SERVER_CLIENT_ID);
  });
});
