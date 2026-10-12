/**
 * doc 81 Đợt 10 task E — TEST KIT: a scripted, in-process fake of central's node protocol v2 (no DB, no network) for the
 * edge-side suites (edgeExecutionAgent.dot10, edgeGatewayBoot.dot10). It signs exactly what central signs (Ed25519 via
 * edgeSigning — a key generated per kit), answers with the STRICT answer shapes of edgeProtocol, keeps report cursors per
 * stream, and records every call. Handlers can be overridden per route; "network" simulates central being unreachable.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  EDGE_NODE_ROUTES,
  EDGE_PROTOCOL_VERSION,
  edgeConfigHash,
  type EdgeConfigSnapshot,
  type EdgeNodeRoute,
  type EdgeRunPackage,
  type EdgeSweepPicture,
} from "./edgeProtocol";
import { EDGE_TYP_NAME, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject, type EdgeSignedEnvelope, type EdgeSignedTyp, type EdgeSigningKey } from "./edgeSigning";

export const KIT_TOKEN = `edn_0123456789ab.${"S".repeat(43)}`;
export const kitHashDefinition = (def: Record<string, unknown>): string => createHash("sha256").update(JSON.stringify(def)).digest("hex");

export type KitAnswer = { status: number; data?: unknown; code?: string; details?: unknown } | "network";
export type KitHandler = (body: any, runId: number | undefined) => KitAnswer | Promise<KitAnswer>;
export interface KitCall {
  route: EdgeNodeRoute;
  runId?: number;
  body: any;
  auth: string | null;
}

const ROUTE_RES: Array<[EdgeNodeRoute, RegExp]> = (Object.entries(EDGE_NODE_ROUTES) as Array<[EdgeNodeRoute, string]>).map(([k, p]) => [
  k,
  new RegExp(`^${p.replace(":runId", "([1-9][0-9]*)").replace(/\//g, "\\/")}$`),
]);

export class FakeCentral {
  readonly key: EdgeSigningKey;
  readonly pin: unknown;
  readonly calls: KitCall[] = [];
  readonly handlers: Partial<Record<EdgeNodeRoute, KitHandler>> = {};
  /** pull state */
  runs: Array<{ runId: number; workflowId: number; workflowRef: string | null; workflowVersion: number; defHash: string; claimSeq: number; refused?: "definitionChanged" }> = [];
  claims: Array<{ runId: number; claimSeq: number; status: "running" | "held" | "aborted"; abortRequested: boolean; stale: boolean }> = [];
  commands: EdgeSignedEnvelope[] = [];
  stopsUnconfirmed: Array<{ runId: number; picture: EdgeSignedEnvelope }> = [];
  progressAbort = false;
  progressCommands: EdgeSignedEnvelope[] = [];
  configVersion = 1;
  /** definitions by run id */
  readonly definitions = new Map<number, Record<string, unknown>>();
  readonly cursors = new Map<string, number>();
  readonly received: Record<string, any[]> = { report: [], locksEvents: [], robotsState: [], telemetry: [] };
  down = false;
  private config: EdgeConfigSnapshot;
  private keysetEnv: EdgeSignedEnvelope;

  constructor(
    readonly nodeId = 7,
    readonly credentialId = 31,
    configOver: Partial<EdgeConfigSnapshot> = {},
  ) {
    this.key = generateEdgeSigningKey().key;
    const t0 = Date.now() - 60_000;
    this.pin = edgePinnedKeyset([{ kid: this.key.kid, publicKeyPem: this.key.publicKeyPem, notBefore: t0 }], t0, 1);
    this.keysetEnv = signEdgeObject("keyset", { v: 1, version: 1, issuedAt: t0, keys: [{ kid: this.key.kid, publicKeyPem: this.key.publicKeyPem, status: "active", notBefore: t0, notAfter: null }] }, this.key);
    this.config = this.makeConfig(configOver);
  }

  makeConfig(over: Partial<EdgeConfigSnapshot> = {}): EdgeConfigSnapshot {
    return {
      kind: "config_snapshot",
      protocolVersion: EDGE_PROTOCOL_VERSION,
      configVersion: this.configVersion,
      issuedAt: Date.now() - 1_000,
      node: { id: this.nodeId, code: "edge-a", credentialId: this.credentialId, factoryCode: "F1", lineCodes: ["L1"] },
      adapters: [
        {
          id: 21,
          code: "plc-21",
          machineId: 5,
          protocol: "stub",
          endpoint: "stub://plc-21",
          connectionOptions: null,
          pollIntervalMs: 100,
          isEnabled: true,
          connectionFingerprint: "f".repeat(64),
          ownerEpoch: 2,
          updatedAt: 1,
          tags: [
            { id: 1, tagKey: "temp", address: "40001", dataType: "float", scale: null, offset: null, writable: false, isEnabled: true, stopValue: null, updatedAt: 1 },
            { id: 2, tagKey: "run", address: "coil:1", dataType: "bool", scale: null, offset: null, writable: true, isEnabled: true, stopValue: false, updatedAt: 1 },
          ],
        },
      ],
      robots: [
        {
          id: 12,
          code: "rb-12",
          name: "Robot 12",
          vendor: "sim",
          model: null,
          kind: "arm",
          endpoint: "sim://12",
          connectionOptions: null,
          pollIntervalMs: 500,
          isEnabled: true,
          commissioned: true,
          lineId: 1,
          stationId: null,
          motionLock: null,
          motionLockGenerationFloor: 0,
          ownerEpoch: 3,
          updatedAt: 1,
        },
      ],
      machines: [{ id: 5, machineType: "aoi", capabilities: {} }],
      safetyPlcConfigs: [],
      keyset: this.keysetEnv,
      limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 64 * 1024 * 1024, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 30_000, pullMs: 1_000 },
      ...over,
    };
  }
  setConfig(over: Partial<EdgeConfigSnapshot>): void {
    this.configVersion++;
    this.config = this.makeConfig({ ...over, configVersion: this.configVersion });
  }
  configEnvelope(): EdgeSignedEnvelope {
    return signEdgeObject("config", this.config, this.key);
  }

  sign(typ: EdgeSignedTyp, payload: unknown, key: EdgeSigningKey = this.key): EdgeSignedEnvelope {
    return signEdgeObject(typ, payload, key);
  }

  addRun(runId: number, definition: Record<string, unknown> = { steps: [{ id: "m1", type: "command" }] }, claimSeq = 0): void {
    this.definitions.set(runId, definition);
    this.runs.push({ runId, workflowId: 100 + runId, workflowRef: null, workflowVersion: 1, defHash: kitHashDefinition(definition), claimSeq });
  }

  runPackagePayload(runId: number, claimSeq: number, over: Partial<EdgeRunPackage> = {}): EdgeRunPackage {
    const def = this.definitions.get(runId) ?? {};
    return {
      kind: "run_package",
      runId,
      nodeId: this.nodeId,
      credentialId: this.credentialId,
      defHash: kitHashDefinition(def),
      definition: def,
      machines: [],
      verifiedStops: [{ kind: "robot", stepId: "stop1", robotId: 12 }],
      stopsUnsure: [],
      prior: { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: [], unknown: false },
      issuedAt: Date.now() - 100,
      claimSeq,
      workflowId: 100 + runId,
      workflowVersion: 1,
      params: {},
      context: {},
      owner: { id: 4, role: "engineer" },
      startedViaApi: false,
      resolvedAdapters: [],
      approvals: [],
      bindingDigest: null,
      ...over,
    } as EdgeRunPackage;
  }

  sweepPicture(runId: number, over: Partial<EdgeSweepPicture> = {}): EdgeSweepPicture {
    return {
      kind: "sweep_picture",
      runId,
      nodeId: this.nodeId,
      credentialId: this.credentialId,
      defHash: "d".repeat(64),
      definition: {},
      machines: [],
      verifiedStops: [
        { kind: "robot", stepId: "s-r", robotId: 12 },
        { kind: "ot", stepId: "s-o", adapterId: 21, pins: [{ tagKey: "run", value: false }] },
        { kind: "robot", stepId: "s-done", robotId: 12 },
      ],
      stopsUnsure: [],
      prior: { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: ["s-done"], unknown: false },
      issuedAt: Date.now() - 100,
      ...over,
    } as EdgeSweepPicture;
  }

  commandPayload(c: Record<string, unknown>): Record<string, unknown> {
    return { nodeId: this.nodeId, credentialId: this.credentialId, ownerEpoch: 3, issuedAt: Date.now() - 100, expiresAt: Date.now() + 60_000, ...c };
  }

  private claimTokens = new Map<number, string>();
  private claimSeqs = new Map<number, number>();
  claimTokenOf(runId: number): string | undefined {
    return this.claimTokens.get(runId);
  }

  private defaults(route: EdgeNodeRoute, body: any, runId: number | undefined): KitAnswer {
    switch (route) {
      case "config": {
        const env = this.configEnvelope();
        const h = edgeConfigHash(env);
        if (body?.configHash === h) return { status: 200, data: { notModified: true, configHash: h } };
        return { status: 200, data: { config: env, configHash: h } };
      }
      case "heartbeat":
        return { status: 200, data: { serverTimeMs: Date.now(), configVersion: this.configVersion, keysetVersion: 1, programCheckRequested: false } };
      case "programChecks":
        return { status: 200, data: { accepted: body.readings.length, refused: [] } };
      case "pull":
        return {
          status: 200,
          data: {
            node: "edge-a",
            protocolVersion: EDGE_PROTOCOL_VERSION,
            configVersion: this.configVersion,
            keysetVersion: 1,
            programCheckRequested: false,
            runs: this.runs,
            claims: this.claims,
            stopsUnconfirmed: this.stopsUnconfirmed,
            commands: this.commands,
          },
        };
      case "claim": {
        const seq = (this.claimSeqs.get(runId!) ?? 0) + 1;
        this.claimSeqs.set(runId!, seq);
        const tok = `ect_${randomUUID().replace(/-/g, "").padEnd(43, "x").slice(0, 43)}`;
        this.claimTokens.set(runId!, tok);
        this.runs = this.runs.filter((r) => r.runId !== runId);
        return { status: 200, data: { runId, claimSeq: seq, claimToken: tok, package: this.sign("runpkg", this.runPackagePayload(runId!, seq)) } };
      }
      case "progress":
        return { status: 200, data: { abortRequested: this.progressAbort, status: this.progressAbort ? "aborted" : "running", consistent: true, commands: this.progressCommands.splice(0) } };
      case "authorize": {
        const cmd = body.command;
        const claims = {
          typ: EDGE_TYP_NAME.auth,
          kid: this.key.kid,
          jti: randomUUID(),
          nodeId: this.nodeId,
          credentialId: this.credentialId,
          runId,
          claimSeq: body.claimSeq,
          stepId: body.stepId,
          attempt: body.attempt,
          idempotencyKey: body.idempotencyKey,
          payloadHash: body.payloadHash,
          approval: null,
          mode: "real",
          verdicts: { commissioned: true, policy: "allow", interlock: "pass" },
          safetyConfigIds: [],
          reqNonce: body.reqNonce,
          iat: Date.now(),
          ttlMs: 10_000,
          kind: cmd.kind,
          target: cmd.kind === "robot" ? { robotId: cmd.robotId, jobType: cmd.jobType } : { adapterId: cmd.adapterId, writes: cmd.writes.map((w: { tagKey: string }) => ({ tagKey: w.tagKey, address: "40001", dataType: "float", scale: null, offset: null })) },
        };
        return { status: 200, data: { authorization: this.sign("auth", claims), ttlMs: 10_000 } };
      }
      case "report":
      case "locksEvents":
      case "robotsState": {
        const stream = body.stream as string;
        const k = `${body.epoch}|${stream}`;
        const last = this.cursors.get(k) ?? 0;
        let applied = 0;
        let dup = 0;
        for (const r of body.records) {
          if (r.seq <= last + applied) dup++;
          else if (r.seq === last + applied + 1) {
            applied++;
            this.received[route].push(r);
          } else return { status: 409, code: "gap", details: { expectedSeq: last + applied + 1 } };
        }
        this.cursors.set(k, last + applied);
        return { status: 200, data: { ackedSeq: last + applied, applied, duplicates: dup } };
      }
      case "complete":
        return { status: 200, data: { abortRequested: false, status: body.outcome === "paused" ? "awaiting_confirm" : body.outcome } };
      case "release":
      case "interrupted":
        return { status: 200, data: { status: "held" } };
      case "telemetry":
        this.received.telemetry.push(...body.samples);
        return { status: 200, data: { accepted: body.samples.length, refused: 0 } };
    }
  }

  readonly fetchImpl = (async (url: string | URL, init?: { body?: unknown; headers?: Record<string, string> }) => {
    const u = new URL(String(url));
    const p = u.pathname.replace(/^\/api\/v1/, "");
    const hit = ROUTE_RES.find(([, re]) => re.test(p));
    if (!hit) return new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "no route" } }), { status: 404 });
    const [route, re] = hit;
    const m = re.exec(p)!;
    const runId = m[1] ? Number(m[1]) : undefined;
    const body = JSON.parse(String(init?.body ?? "{}"));
    this.calls.push({ route, runId, body, auth: init?.headers?.authorization ?? null });
    if (this.down) throw new TypeError("fetch failed");
    const h = this.handlers[route];
    const a = h ? await h(body, runId) : this.defaults(route, body, runId);
    if (a === "network") throw new TypeError("fetch failed");
    if (a.status >= 200 && a.status < 300) return new Response(JSON.stringify({ ok: true, data: a.data }), { status: a.status });
    return new Response(JSON.stringify({ ok: false, error: { code: a.code ?? "error", message: "refused", ...(a.details !== undefined ? { details: a.details } : {}) } }), { status: a.status });
  }) as unknown as typeof fetch;

  callsTo(route: EdgeNodeRoute): KitCall[] {
    return this.calls.filter((c) => c.route === route);
  }
}
