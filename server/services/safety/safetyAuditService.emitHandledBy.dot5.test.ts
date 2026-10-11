/**
 * doc 81 Đợt 5 task F fix 1 (R-5-f) + fix scan (R-5-h) — what the realtime SAFETY_EVENT carries, and that ONLY the
 * server's device-ingest door can make it safety-critical. Payload fields (detectedBy / handledBy / eventType) are what a
 * user can set through safety.recordEvent / evaluateZones / readSafetyPlc; they decide nothing.
 * Oracle: the emitted payload captured at the socket seam, judged by the rules engine's own predicate.
 * Census: who may call the trusted door / the mark, and that no router / route / API module imports either.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const E = vi.hoisted(() => ({
  emitted: [] as Array<Record<string, unknown>>,
  nextId: 9000,
  /** the verdict the rules engine would reach DURING the emit (it runs synchronously inside emitSafetyEvent) */
  atEmit: [] as boolean[],
  judge: null as null | ((e: Record<string, unknown>) => boolean),
}));
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: E.nextId++, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v }],
      }),
    }),
  })),
}));
vi.mock("../../_core/socket", () => ({
  emitSafetyEvent: vi.fn((e: Record<string, unknown>) => {
    E.emitted.push(e);
    E.atEmit.push(E.judge ? E.judge(e) : false);
  }),
}));

import { record, recordFromDeviceIngest } from "./safetyAuditService";
import { isSafetyCriticalSafetyEvent } from "../orchestration/rulesEngine";
import { _resetTrustedSafetyMarksForTests, TRUSTED_ROBOT_TELEMETRY_VENDORS } from "./trustedSafetyOrigin";

E.judge = isSafetyCriticalSafetyEvent;
const saved = process.env.SAFETY_AUDIT_ENABLED;
beforeEach(() => {
  E.emitted.length = 0;
  E.atEmit.length = 0;
  _resetTrustedSafetyMarksForTests();
  process.env.SAFETY_AUDIT_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SAFETY_AUDIT_ENABLED;
  else process.env.SAFETY_AUDIT_ENABLED = saved;
});

describe("Đợt 5 F fix scan (R-5-h) — provenance is derived on the server, never from payload fields", () => {
  it("★ a user records detectedBy 'plc', type e_stop / estop, handledBy advisory ⇒ NOT safety-critical", async () => {
    await record({ eventType: "e_stop" as never, detectedBy: "plc", handledBy: "advisory", outcome: "stopped", robotId: 3 });
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "stopped", robotId: 3 });
    await record({ eventType: "zone_intrusion", detectedBy: "vision", handledBy: "advisory", outcome: "stopped", robotId: 3 }); // evaluateZones source "vision"
    expect(E.emitted).toHaveLength(3);
    for (const e of E.emitted) expect(isSafetyCriticalSafetyEvent(e)).toBe(false);
  });

  it("the user-recorded marker is still emitted (handledBy) — informational only", async () => {
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "operator", outcome: "stopped", robotId: 3 });
    expect(E.emitted[0]).toMatchObject({ eventType: "estop", detectedBy: "plc", handledBy: "operator" });
    expect(isSafetyCriticalSafetyEvent(E.emitted[0])).toBe(false);
  });

  it("★ the device-ingest door (robot telemetry e-stop) ⇒ safety-critical, whatever detectedBy says", async () => {
    await recordFromDeviceIngest("robot_telemetry", { eventType: "estop", detectedBy: "telemetry", handledBy: "advisory", outcome: "logged_only", robotId: 4 });
    expect(E.atEmit[0]).toBe(true); // the mark is set BEFORE the emit (the rules engine decides inside it)
    expect(isSafetyCriticalSafetyEvent(E.emitted[0])).toBe(true);
    expect(isSafetyCriticalSafetyEvent({ ...E.emitted[0], isNearMiss: true })).toBe(false);
  });

  it("the trusted door with a type not allowed for its origin ⇒ NOT safety-critical; a payload re-using the id with another type gains nothing", async () => {
    await recordFromDeviceIngest("robot_telemetry", { eventType: "collision", detectedBy: "telemetry", handledBy: "advisory", robotId: 4 });
    expect(isSafetyCriticalSafetyEvent(E.emitted[0])).toBe(false);
    expect(isSafetyCriticalSafetyEvent({ ...E.emitted[0], eventType: "estop" })).toBe(false); // the server stored "collision"
  });

  it("a forged payload carrying an unmarked id, or an id of another type ⇒ NOT safety-critical", () => {
    expect(isSafetyCriticalSafetyEvent({ id: 123456, eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "stopped", isNearMiss: false })).toBe(false);
    expect(isSafetyCriticalSafetyEvent({ id: "9000", eventType: "estop" } as never)).toBe(false);
  });

  it("trusted robot vendors are the server-polled real controllers only", () => {
    expect([...TRUSTED_ROBOT_TELEMETRY_VENDORS].sort()).toEqual(["fanuc", "mitsubishi", "techman"]);
  });
});

describe("Đợt 5 F fix scan — census: the trusted door and the mark are reachable only from the device-ingest paths", () => {
  const root = path.resolve(__dirname, "../..");
  const files: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|mjs|js)$/.test(e.name) && !/\.test\.(ts|mjs|js)$/.test(e.name)) {
        files.push({ rel: path.relative(root, full).split(path.sep).join("/"), src: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  /**
   * final wave P-F2 (F re-review N2) — files whose CODE references `name` in any way: a call, the function passed as a value
   * or aliased (`const f = name`, `cb(name)`, `{ name }`), an import. Whole-line comments do not count. (Was: only the call
   * syntax `name(` — a value reference escaped the census.)
   */
  const referencers = (name: string, srcs = files) => {
    const re = new RegExp(String.raw`\b${name}\b`);
    return srcs
      .filter((f) => f.src.split("\n").some((line) => {
        const t = line.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) && re.test(line);
      }))
      .map((f) => f.rel)
      .sort();
  };

  it("final wave P-F2: the census sees a reference passed as a VALUE / aliased, not only a call", () => {
    const fx = [
      { rel: "services/x/alias.ts", src: "import { recordFromDeviceIngest } from '../safety/safetyAuditService';\nconst door = recordFromDeviceIngest;\nvoid door;" },
      { rel: "services/x/cb.ts", src: "export const handlers = { mark: markTrustedSafetyEvent };" },
      { rel: "services/x/doc.ts", src: "/**\n * recordFromDeviceIngest is documented here only\n */\nexport const a = 1;" },
    ];
    expect(referencers("recordFromDeviceIngest", fx)).toEqual(["services/x/alias.ts"]);
    expect(referencers("markTrustedSafetyEvent", fx)).toEqual(["services/x/cb.ts"]);
  });

  // Re-pinned 2026-10-11 (doc 81 Đợt 8 N2, owner decision "background safety-PLC poller produces trusted events"): the
  // poller is the second device-ingest door user. It takes no request input (configs from the DB, its own timer).
  it("recordFromDeviceIngest is referenced only by robotIngest.ts + the background safety-PLC poller (and defined in safetyAuditService.ts)", () => {
    expect(referencers("recordFromDeviceIngest")).toEqual([
      "services/robot/robotIngest.ts",
      "services/safety/plc/safetyPlcPoller.ts",
      "services/safety/safetyAuditService.ts",
    ]);
  });

  it("markTrustedSafetyEvent is referenced only by safetyAuditService.ts (and defined in trustedSafetyOrigin.ts)", () => {
    expect(referencers("markTrustedSafetyEvent")).toEqual(["services/safety/safetyAuditService.ts", "services/safety/trustedSafetyOrigin.ts"]);
  });

  // doc 81 Đợt 8 N2 — also the background poller (its class takes injected deps; no request path may construct / drive it)
  it("no router / route / API module references the trusted door, the marker module or the background PLC poller", () => {
    const bad = files
      .filter((f) => /^(routers|routes|api)\//.test(f.rel))
      .filter((f) => /recordFromDeviceIngest|trustedSafetyOrigin|markTrustedSafetyEvent|safetyPlcPoller|SafetyPlcPoller/.test(f.src))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});

describe("doc 81 Đợt 8 N2 — census: who may construct / start the background safety-PLC poller", () => {
  const root = path.resolve(__dirname, "../..");
  const srcs: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|mjs|js)$/.test(e.name) && !/\.test\.(ts|mjs|js)$/.test(e.name)) srcs.push({ rel: path.relative(root, full).split(path.sep).join("/"), src: fs.readFileSync(full, "utf8") });
    }
  };
  walk(root);
  const refs = (re: RegExp) =>
    srcs
      .filter((f) => f.src.split("\n").some((l) => !/^\s*(\*|\/\/|\/\*)/.test(l) && re.test(l)))
      .map((f) => f.rel)
      .sort();

  it("`new SafetyPlcPoller(` only inside the poller module (production deps only; tests are excluded from this census)", () => {
    expect(refs(/\bnew SafetyPlcPoller\b/)).toEqual(["services/safety/plc/safetyPlcPoller.ts"]);
  });

  // doc 81 Đợt 8 N fix 1 (I1) — config writes go through the AUDITED, scope-checked, maker-checker path only.
  // re-pinned 2026-10-11 (doc 81 Đợt 8 final wave N-R7): the legacy writer was REMOVED — not even its definition remains (stricter).
  it("the legacy unaudited writer upsertPlcConfig no longer exists in production code", () => {
    expect(refs(/\bupsertPlcConfig\b/)).toEqual([]);
  });

  it("no code outside safetyPlcTrust.ts writes the maker-checker table", () => {
    expect(refs(/\bsafetyPlcConfigTrust\b/)).toEqual(["services/safety/plc/safetyPlcTrust.ts"]);
  });

  // doc 81 Đợt 8 N fix scan 3 (R-8-c) — the durable poll state is written only by its own module (no router / registry).
  it("only safetyPlcPollerHealth.ts references the durable poll-state table", () => {
    expect(refs(/safety_plc_poll_state/)).toEqual(["services/safety/plc/safetyPlcPollerHealth.ts"]);
  });

  it("the poller module is imported only by the server entry (start/stop)", () => {
    expect(refs(/safetyPlcPoller["']/)).toEqual(["_core/index.ts"]);
  });
});
