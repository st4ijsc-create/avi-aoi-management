/**
 * doc 81 Đợt 10 task A — the node protocol v2 contract is STRICT (design §2.3–2.5, §2.7 D6).
 *
 * Census: for every route's request and answer, a VALID sample parses; then an unknown key is injected into EVERY nested
 * plain object of the sample (walked mechanically, not listed by hand) and must be refused — except inside the declared
 * OPEN bags (definition / params / context / connectionOptions / result / patch / safety config / capabilities / values /
 * signed payloads), whose shape belongs to another module and is covered by a signature or a hash. Every request also
 * refuses every trust / identity key (EDGE_FORBIDDEN_BODY_KEYS) at the top level and in each record.
 */
import { describe, expect, it } from "vitest";
import {
  EDGE_ANSWER_SCHEMAS,
  EDGE_ERROR_CODES,
  EDGE_ERROR_HTTP,
  EDGE_FORBIDDEN_BODY_KEYS,
  EDGE_NODE_ROUTES,
  EDGE_REQUEST_SCHEMAS,
  EDGE_STREAM_RE,
  clampEdgeAuthTtlMs,
  edgeAuthClaimsSchema,
  edgeCommandSchema,
  edgeConfigHash,
  edgeConfigSnapshotSchema,
  edgeError,
  edgeLockAuthority,
  edgeRunPackageSchema,
  edgeRunPkgPayloadSchema,
  edgeRunStream,
  edgeRunStreamSchema,
  edgeSweepPictureSchema,
  newEdgeEpoch,
  parseEdgeBody,
  parseEdgeStream,
  type EdgeNodeRoute,
} from "./edgeProtocol";
import { EDGE_TYP_NAME, generateEdgeSigningKey, signEdgeObject } from "./edgeSigning";

const H64 = "a".repeat(64);
const PH = "sha256:" + "b".repeat(64);
const TOKEN = "ect_" + "Z".repeat(43);
const EPOCH = "0123456789abcdef0123456789abcdef";
const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const KID = "edk_" + "K".repeat(22);
const ENV = { typ: EDGE_TYP_NAME.cmd, alg: "EdDSA", kid: KID, payload: '{"anything":1}', sig: "A".repeat(86) };
const T = 1_790_000_000_000;
const programCheck = { adapterId: 3, status: "verified", checksum: "s7:abc", source: "s7", readAt: T };

const REQUESTS: Record<EdgeNodeRoute, Record<string, unknown>> = {
  config: { configHash: H64 },
  heartbeat: {
    protocolVersion: 2,
    status: "online",
    version: "10.0.0",
    capacity: { liveRuns: 1, maxRuns: 4 },
    journal: { epoch: EPOCH, backlog: 0, bytes: 1024, full: false },
    configHash: H64,
    keysetVersion: 3,
    wallClockMs: T,
    uptimeMs: 5000,
  },
  programChecks: { readings: [programCheck, { adapterId: 4, status: "unreadable", reason: "timeout", readAt: T }] },
  pull: {},
  claim: { claimSeq: 0, defHash: H64, programChecks: [programCheck] },
  progress: { claimSeq: 1, claimToken: TOKEN, seq: 3, status: "running", currentStepId: "m1" },
  authorize: {
    claimSeq: 1,
    claimToken: TOKEN,
    stepId: "m1",
    attempt: 1,
    idempotencyKey: "foe:9:m1:1",
    reqNonce: NONCE,
    command: { kind: "ot", adapterId: 3, machineId: 7, commandType: "start", writes: [{ tagKey: "run", value: true }] },
    payloadHash: PH,
    programChecks: [programCheck],
  },
  report: {
    claimSeq: 1,
    claimToken: TOKEN,
    epoch: EPOCH,
    stream: "run:9:1",
    records: [
      { kind: "step", seq: 4, stepId: "m1", stepType: "command", status: "completed", attempt: 1, startedAt: T, finishedAt: T + 5, error: null, result: { ok: true }, jti: JTI },
      { kind: "context", seq: 5, patch: { branch: "then" } },
      { kind: "abort_stop", seq: 6, stepId: "stop1", status: "completed", result: null, at: T },
      { kind: "ledger", seq: 7, stepId: "m1", attempt: 1, idempotencyKey: "foe:9:m1:1", jti: JTI, stop: false, target: { adapterId: 3, commandType: "start" }, status: "acked", result: null, at: T },
    ],
  },
  complete: { claimSeq: 1, claimToken: TOKEN, seq: 8, outcome: "paused", gateStepId: "gate2", epoch: EPOCH, reportedThrough: 7 },
  release: { claimSeq: 1, claimToken: TOKEN, seq: 9, reason: "local check failed" },
  interrupted: { claimSeq: 1 },
  telemetry: { samples: [{ adapterId: 3, tagKey: "temp", ts: T, tsSource: "device", value: 21.5, quality: "good", unit: "C" }] },
  robotsState: {
    epoch: EPOCH,
    stream: "robot_state",
    records: [{ seq: 1, robotId: 12, ts: T, link: "connected", mode: "auto", busy: false, estop: true, pose: { joints: [0, 1], cartesian: { x: 1, y: 2, z: 3 }, frame: "base" }, jointStates: [{ j: 1 }] }],
  },
  locksEvents: {
    epoch: EPOCH,
    stream: "events",
    records: [
      { kind: "lock", seq: 10, robotId: 12, event: "locked", generation: 4, reasonCode: "outcomeUnknown", since: T, clearedBy: null, requestId: null },
      { kind: "stop", seq: 11, target: { robotId: 12 }, source: "command", requestId: 5, outcome: "sent", at: T, detail: null },
      { kind: "refusal", seq: 12, runId: 9, stepId: "m2", reason: "auth_ttl", at: T },
      { kind: "anomaly", seq: 13, code: "bad_signature", runId: null, detail: "cmd", at: T },
      { kind: "command_ack", seq: 14, requestId: 5, outcome: "done", generation: 4, at: T },
    ],
  },
};

const ANSWERS: Record<EdgeNodeRoute, Record<string, unknown>> = {
  config: { config: ENV, configHash: H64 },
  heartbeat: { serverTimeMs: T, configVersion: 2, keysetVersion: 3, programCheckRequested: false },
  programChecks: { accepted: 1, refused: [4] },
  pull: {
    node: "edge-a",
    protocolVersion: 2,
    configVersion: 2,
    keysetVersion: 3,
    programCheckRequested: true,
    runs: [{ runId: 9, workflowId: 2, workflowRef: "wf", workflowVersion: 1, defHash: H64, claimSeq: 0 }],
    claims: [{ runId: 8, claimSeq: 2, status: "running", abortRequested: false, stale: false }],
    stopsUnconfirmed: [{ runId: 7, picture: ENV }],
    commands: [ENV],
  },
  claim: { runId: 9, claimSeq: 1, claimToken: TOKEN, package: ENV },
  progress: { abortRequested: false, status: "running", consistent: true, commands: [] },
  authorize: { authorization: ENV, ttlMs: 10_000 },
  report: { ackedSeq: 7, applied: 4, duplicates: 0 },
  complete: { abortRequested: false, status: "awaiting_confirm" },
  release: { status: "held" },
  interrupted: { status: "held" },
  telemetry: { accepted: 1, refused: 0 },
  robotsState: { ackedSeq: 1, applied: 1, duplicates: 0 },
  locksEvents: { ackedSeq: 14, applied: 5, duplicates: 0 },
};

const prior = { completed: ["a"], settled: ["a"], attempted: ["a"], startOrder: ["a"], branches: [{ stepId: "b", branch: "then" }], abortSentBefore: [], unknown: false };
const SIGNED_PAYLOADS: Record<string, { schema: { safeParse: (v: unknown) => { success: boolean } }; sample: Record<string, unknown> }> = {
  auth: {
    schema: edgeAuthClaimsSchema,
    sample: {
      typ: EDGE_TYP_NAME.auth, kid: KID, jti: JTI, nodeId: 7, credentialId: 31, runId: 9, claimSeq: 1, stepId: "m1", attempt: 1, idempotencyKey: "k",
      kind: "ot", target: { adapterId: 3, writes: [{ tagKey: "run", address: "DB1.DBX0.0", dataType: "bool", scale: null, offset: null }] },
      payloadHash: PH, approval: { approvedBy: 4, gateStepId: "g" }, mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" },
      safetyConfigIds: [1], reqNonce: NONCE, iat: T, ttlMs: 10_000,
    },
  },
  cmd: { schema: edgeCommandSchema, sample: { kind: "clear", requestId: 5, nodeId: 7, issuedAt: T, expiresAt: T + 30_000, robotId: 12, expectedGeneration: 4, clearedBy: 2, reason: "inspected" } },
  config: {
    schema: edgeConfigSnapshotSchema,
    sample: {
      kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T,
      node: { id: 7, code: "edge-a", credentialId: 31, factoryCode: "F1", lineCodes: ["L1"] },
      adapters: [{ id: 3, code: "plc1", machineId: 7, protocol: "s7", endpoint: "10.0.0.5:102", connectionOptions: { rack: 0 }, pollIntervalMs: 1000, isEnabled: true, connectionFingerprint: H64, updatedAt: T,
        tags: [{ id: 1, tagKey: "run", address: "DB1.DBX0.0", dataType: "bool", scale: null, offset: null, writable: true, isEnabled: true, stopValue: false, updatedAt: T }] }],
      robots: [{ id: 12, code: "r1", name: "Robot 1", vendor: "sim", model: null, kind: "arm", endpoint: "sim://", connectionOptions: null, pollIntervalMs: 500, isEnabled: true, commissioned: true, lineId: 1, stationId: null,
        motionLock: { reasonCode: "ownerChanged", generation: 5, authority: "edge:7", lockedAt: T }, motionLockGenerationFloor: 4, updatedAt: T }],
      machines: [{ id: 7, machineType: "plc", capabilities: { x: 1 } }],
      safetyPlcConfigs: [{ id: 2, trustDigest: H64, approved: true, config: { backend: "modbus" } }],
      keyset: ENV,
      limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
    },
  },
  runpkg: {
    schema: edgeRunPackageSchema,
    sample: {
      kind: "run_package", runId: 9, nodeId: 7, defHash: H64, definition: { steps: [] }, machines: [{ id: 7, machineType: "plc", capabilities: null }],
      verifiedStops: [{ kind: "ot", stepId: "s1", adapterId: 3, pins: [{ tagKey: "run", value: false }] }, { kind: "robot", stepId: "s2", robotId: 12 }],
      stopsUnsure: [], prior, issuedAt: T, claimSeq: 1, workflowId: 2, workflowVersion: 1, params: {}, context: { foeDispatchedSteps: [] },
      owner: { id: 3, role: "engineer" }, startedViaApi: false, resolvedAdapters: [{ stepId: "m1", adapterId: 3 }], approvals: [{ gateStepId: "g", approvedBy: 4, approvedAt: T }], bindingDigest: null,
    },
  },
  sweep: {
    schema: edgeSweepPictureSchema,
    sample: { kind: "sweep_picture", runId: 9, nodeId: 7, defHash: H64, definition: { steps: [] }, machines: [], verifiedStops: [], stopsUnsure: ["x"], prior, issuedAt: T },
  },
};

/** Keys whose VALUE is an open bag (shape owned elsewhere, covered by a signature / hash). */
const OPEN = new Set(["definition", "params", "context", "connectionOptions", "result", "patch", "config", "capabilities", "value", "stopValue", "payload", "jointStates"]);

/** Every path (array of keys / indices) to a plain object inside v, skipping open bags. */
function objectPaths(v: unknown, path: Array<string | number> = []): Array<Array<string | number>> {
  if (!v || typeof v !== "object") return [];
  const out: Array<Array<string | number>> = [];
  if (Array.isArray(v)) {
    v.forEach((x, i) => out.push(...objectPaths(x, [...path, i])));
    return out;
  }
  out.push(path);
  for (const [k, x] of Object.entries(v)) if (!OPEN.has(k)) out.push(...objectPaths(x, [...path, k]));
  return out;
}
function withKeyAt(sample: unknown, path: Array<string | number>, key: string, value: unknown): unknown {
  const copy = structuredClone(sample) as Record<string | number, unknown>;
  let o: Record<string | number, unknown> = copy;
  for (const p of path) o = o[p] as Record<string | number, unknown>;
  o[key] = value;
  return copy;
}

describe("edge protocol v2 — strict census", () => {
  it("one request + one answer schema per route, and the routes are the design's §2.3 list", () => {
    expect(Object.keys(EDGE_REQUEST_SCHEMAS).sort()).toEqual(Object.keys(EDGE_NODE_ROUTES).sort());
    expect(Object.keys(EDGE_ANSWER_SCHEMAS).sort()).toEqual(Object.keys(EDGE_NODE_ROUTES).sort());
    expect(Object.values(EDGE_NODE_ROUTES).every((p) => p.startsWith("/edge/node/"))).toBe(true);
    expect(Object.keys(EDGE_NODE_ROUTES).length).toBe(14);
  });

  for (const route of Object.keys(EDGE_NODE_ROUTES) as EdgeNodeRoute[]) {
    it(`${route}: valid request + answer parse; an unknown key in ANY nested object is refused`, () => {
      for (const [label, schema, sample] of [
        ["request", EDGE_REQUEST_SCHEMAS[route], REQUESTS[route]],
        ["answer", EDGE_ANSWER_SCHEMAS[route], ANSWERS[route]],
      ] as const) {
        const ok = schema.safeParse(sample);
        expect(ok.success, `${route} ${label}: ${JSON.stringify((ok as { error?: { issues?: unknown } }).error?.issues ?? null)}`).toBe(true);
        const paths = objectPaths(sample);
        expect(paths.length).toBeGreaterThanOrEqual(1);
        for (const p of paths) {
          expect(schema.safeParse(withKeyAt(sample, p, "__unknown", 1)).success, `${route} ${label} at ${p.join(".") || "(root)"}`).toBe(false);
        }
      }
    });

    it(`${route}: every trust / identity key is refused at the root and inside each record / nested object`, () => {
      const schema = EDGE_REQUEST_SCHEMAS[route];
      for (const p of objectPaths(REQUESTS[route])) {
        for (const k of EDGE_FORBIDDEN_BODY_KEYS) {
          expect(schema.safeParse(withKeyAt(REQUESTS[route], p, k, k === "trusted" || k === "safetyCritical" ? true : 1)).success, `${route} ${k} at ${p.join(".")}`).toBe(false);
        }
      }
    });
  }

  for (const [name, { schema, sample }] of Object.entries(SIGNED_PAYLOADS)) {
    it(`signed payload ${name}: valid parses; an unknown key in ANY nested object is refused`, () => {
      expect(schema.safeParse(sample).success).toBe(true);
      for (const p of objectPaths(sample)) expect(schema.safeParse(withKeyAt(sample, p, "__unknown", 1)).success, `${name} at ${p.join(".")}`).toBe(false);
    });
  }
});

describe("edge protocol v2 — semantic refinements", () => {
  it("D6: a robot state can never carry trusted / origin / safetyCritical (record or pose)", () => {
    const s = edgeRobotState();
    for (const k of ["trusted", "origin", "safetyCritical"]) {
      expect(EDGE_REQUEST_SCHEMAS.robotsState.safeParse(withKeyAt(s, ["records", 0], k, true)).success).toBe(false);
      expect(EDGE_REQUEST_SCHEMAS.robotsState.safeParse(withKeyAt(s, ["records", 0, "pose"], k, true)).success).toBe(false);
    }
  });

  it("telemetry: machineId / deviceId / protocol / meta are central's — refused; a non-finite value is refused", () => {
    for (const k of ["machineId", "deviceId", "protocol", "meta"]) {
      expect(EDGE_REQUEST_SCHEMAS.telemetry.safeParse(withKeyAt(REQUESTS.telemetry, ["samples", 0], k, 1)).success, k).toBe(false);
    }
    expect(EDGE_REQUEST_SCHEMAS.telemetry.safeParse(withKeyAt(REQUESTS.telemetry, ["samples", 0], "value", Number.NaN)).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.telemetry.safeParse(withKeyAt(REQUESTS.telemetry, ["samples", 0], "value", { o: 1 })).success).toBe(false);
  });

  it("stream records must be consecutive; the report stream must be run:<runId>:<claimSeq> of THIS claim", () => {
    const gap = structuredClone(REQUESTS.report) as { records: Array<{ seq: number }> };
    gap.records[2].seq = 9;
    expect(EDGE_REQUEST_SCHEMAS.report.safeParse(gap).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.report.safeParse({ ...REQUESTS.report, stream: "run:9:2" }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.report.safeParse({ ...REQUESTS.report, stream: "events" }).success).toBe(false);
    const ev = structuredClone(REQUESTS.locksEvents) as { records: Array<{ seq: number }> };
    ev.records[1].seq = 10;
    expect(EDGE_REQUEST_SCHEMAS.locksEvents.safeParse(ev).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.locksEvents.safeParse({ ...REQUESTS.locksEvents, stream: "robot_state" }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.report.safeParse({ ...REQUESTS.report, records: [] }).success).toBe(false);
  });

  it("complete: gateStepId iff paused, heldReason iff held (D5 reasons only)", () => {
    const c = REQUESTS.complete;
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, gateStepId: undefined }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, outcome: "completed" }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, outcome: "completed", gateStepId: undefined }).success).toBe(true);
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, outcome: "held", gateStepId: undefined, heldReason: "centralUnreachable" }).success).toBe(true);
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, outcome: "held", gateStepId: undefined }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.complete.safeParse({ ...c, outcome: "held", gateStepId: undefined, heldReason: "whatever" }).success).toBe(false);
  });

  it("program checks: checksum iff verified, reason iff unreadable", () => {
    const bad = [
      { adapterId: 3, status: "verified", readAt: T },
      { adapterId: 3, status: "unsupported", checksum: "x", readAt: T },
      { adapterId: 3, status: "unreadable", readAt: T },
      { adapterId: 3, status: "verified", checksum: "x", reason: "timeout", readAt: T },
    ];
    for (const r of bad) expect(EDGE_REQUEST_SCHEMAS.programChecks.safeParse({ readings: [r] }).success, JSON.stringify(r)).toBe(false);
  });

  it("authorize: the command kinds do not mix; claims of one kind cannot carry the other's target", () => {
    const a = REQUESTS.authorize as { command: Record<string, unknown> };
    expect(EDGE_REQUEST_SCHEMAS.authorize.safeParse({ ...a, command: { ...a.command, robotId: 12 } }).success).toBe(false);
    expect(EDGE_REQUEST_SCHEMAS.authorize.safeParse({ ...a, command: { kind: "robot", robotId: 12, jobType: "move", params: {} } }).success).toBe(true);
    expect(EDGE_REQUEST_SCHEMAS.authorize.safeParse({ ...a, command: { kind: "robot", robotId: 12, jobType: "teleport", params: {} } }).success).toBe(false);
    const claims = SIGNED_PAYLOADS.auth.sample;
    expect(edgeAuthClaimsSchema.safeParse({ ...claims, target: { robotId: 12, jobType: "move" } }).success).toBe(false);
    expect(edgeAuthClaimsSchema.safeParse({ ...claims, kind: "robot", target: { robotId: 12, jobType: "move" } }).success).toBe(true);
    expect(edgeAuthClaimsSchema.safeParse({ ...claims, typ: EDGE_TYP_NAME.config }).success).toBe(false);
    for (const ttlMs of [2_999, 30_001, 10_000.5]) expect(edgeAuthClaimsSchema.safeParse({ ...claims, ttlMs }).success, String(ttlMs)).toBe(false);
  });

  it("commands: a stop names exactly one target; a clear needs expectedGeneration", () => {
    const base = { requestId: 5, nodeId: 7, issuedAt: T, expiresAt: T + 1 };
    expect(edgeCommandSchema.safeParse({ ...base, kind: "stop", target: { robotId: 1 } }).success).toBe(true);
    expect(edgeCommandSchema.safeParse({ ...base, kind: "stop", target: { adapterId: 1 } }).success).toBe(true);
    expect(edgeCommandSchema.safeParse({ ...base, kind: "stop", target: { robotId: 1, adapterId: 1 } }).success).toBe(false);
    expect(edgeCommandSchema.safeParse({ ...base, kind: "stop", target: {} }).success).toBe(false);
    expect(edgeCommandSchema.safeParse({ ...base, kind: "clear", robotId: 1, clearedBy: 2, reason: "x" }).success).toBe(false);
  });

  it("open bags are JSON OBJECTS (never a string / array / null); the run stream schema is exact", () => {
    for (const k of ["definition", "params", "context"]) {
      for (const bad of ["x", [], null, 1]) {
        expect(edgeRunPackageSchema.safeParse({ ...SIGNED_PAYLOADS.runpkg.sample, [k]: bad }).success, `${k}=${JSON.stringify(bad)}`).toBe(false);
      }
    }
    for (const bad of ["run:09:1", "run:0:1", "run:1:0", "run:1:01", "run:1", "run:12345678901:1"]) expect(edgeRunStreamSchema.safeParse(bad).success, bad).toBe(false);
    expect(edgeRunStreamSchema.safeParse("run:9:1").success).toBe(true);
    expect(EDGE_REQUEST_SCHEMAS.claim.safeParse({ ...REQUESTS.claim, programChecks: [] }).success).toBe(true);
    // a signed envelope's payload is the canonical TEXT, never an object
    expect(EDGE_ANSWER_SCHEMAS.authorize.safeParse({ ...ANSWERS.authorize, authorization: { ...ENV, payload: { a: 1 } } }).success).toBe(false);
  });

  it("runpkg payload: run_package and sweep_picture are told apart by kind and never parse as each other", () => {
    expect(edgeRunPkgPayloadSchema.safeParse(SIGNED_PAYLOADS.runpkg.sample).success).toBe(true);
    expect(edgeRunPkgPayloadSchema.safeParse(SIGNED_PAYLOADS.sweep.sample).success).toBe(true);
    expect(edgeSweepPictureSchema.safeParse({ ...SIGNED_PAYLOADS.runpkg.sample, kind: "sweep_picture" }).success).toBe(false);
    expect(edgeRunPackageSchema.safeParse({ ...SIGNED_PAYLOADS.sweep.sample, kind: "run_package" }).success).toBe(false);
  });
});

describe("edge protocol v2 — helpers", () => {
  it("parseEdgeBody: 400 bad_request naming the path, never echoing a value", () => {
    const r = parseEdgeBody(EDGE_REQUEST_SCHEMAS.progress, { ...REQUESTS.progress, claimToken: "ect_SECRET-should-not-leak" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.answer.http).toBe(400);
    expect(r.answer.code).toBe("bad_request");
    expect(r.answer.message).toContain("claimToken");
    expect(r.answer.message).not.toContain("SECRET");
    const u = parseEdgeBody(EDGE_REQUEST_SCHEMAS.pull, { trusted: true });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.answer.message).toContain("trusted");
    expect(parseEdgeBody(EDGE_REQUEST_SCHEMAS.pull, undefined)).toEqual({ ok: true, data: {} });
  });

  it("error codes: every code has an HTTP status; edgeError builds the answer", () => {
    expect(EDGE_ERROR_CODES.length).toBe(Object.keys(EDGE_ERROR_HTTP).length);
    for (const c of EDGE_ERROR_CODES) expect([400, 401, 404, 409, 429, 503]).toContain(EDGE_ERROR_HTTP[c]);
    expect(edgeError("claim_stale", "m", { abortRequested: true })).toEqual({ http: 409, code: "claim_stale", message: "m", data: { abortRequested: true } });
    expect(edgeError("stop_needs_no_authorization", "m")).toEqual({ http: 400, code: "stop_needs_no_authorization", message: "m" });
    for (const c of ["gap", "unauthorised_actuation", "payload_mismatch", "already_authorized", "gate_required", "device_refused", "not_owned", "stopped", "epoch_rejected"]) {
      expect(EDGE_ERROR_CODES).toContain(c);
    }
  });

  it("streams, epochs, lock authority, TTL clamp, config hash", () => {
    expect(edgeRunStream(9, 1)).toBe("run:9:1");
    expect(() => edgeRunStream(0, 1)).toThrow();
    expect(parseEdgeStream("run:9:1")).toEqual({ kind: "run", runId: 9, claimSeq: 1 });
    expect(parseEdgeStream("events")).toEqual({ kind: "events" });
    expect(parseEdgeStream("robot_state")).toEqual({ kind: "robot_state" });
    for (const bad of ["run:0:1", "run:9:0", "run:09:1", "run:9", "Events", "run:9:1:2", "run:99999999999:1", "run:3000000000:1", "", null]) {
      expect(parseEdgeStream(bad), String(bad)).toBeNull();
    }
    expect(EDGE_STREAM_RE.test("run:1:1")).toBe(true);
    const e = newEdgeEpoch();
    expect(e).toMatch(/^[0-9a-f]{32}$/);
    expect(newEdgeEpoch()).not.toBe(e);
    expect(edgeLockAuthority(null)).toBe("central");
    expect(edgeLockAuthority(7)).toBe("edge:7");
    expect(() => edgeLockAuthority(0)).toThrow();
    expect(clampEdgeAuthTtlMs(undefined)).toBe(10_000);
    expect(clampEdgeAuthTtlMs("1")).toBe(3_000);
    expect(clampEdgeAuthTtlMs(999_999)).toBe(30_000);
    expect(clampEdgeAuthTtlMs("12000")).toBe(12_000);
    const key = generateEdgeSigningKey().key;
    const env = signEdgeObject("config", { a: 1 }, key);
    expect(edgeConfigHash(env)).toMatch(/^[0-9a-f]{64}$/);
    expect(edgeConfigHash({ ...env })).toBe(edgeConfigHash(env));
    expect(edgeConfigHash({ ...env, payload: { a: 2 } })).not.toBe(edgeConfigHash(env));
  });
});

function edgeRobotState() {
  return structuredClone(REQUESTS.robotsState);
}
