/**
 * doc 81 Đợt 10 task F1 — the shared harness of the TWO-PROCESS, NO-DB end-to-end suites (design §5a / §5b):
 *   edgeExecution.dot10.e2e.db · edgeAttack.dot10.e2e.db · edgeExecution.s3.dot9.db / s4.e2e.dot9.db (Đợt 9, adapted to v2).
 * Not a test file (no `.test.`): imported by those suites.
 *
 * PROCESS 1 = CENTRAL = the vitest process that imports this: the REAL `/api/v1` router (node protocol v2 + every central
 * service behind it) and the REAL tRPC `robot.*` router behind the real createContext, on its OWN port (127.0.0.1:0, never
 * :3000), against `aoi_management_test` only. Central's environment is set here (flags), never from .env.
 * PROCESS 2 = the EDGE = edgeE2eChild.dot10.test.ts, spawned with an ALLOW-LISTED environment (no DATABASE_URL / PG* /
 * JWT_SECRET / SECRET_ENCRYPTION_KEY) running `server/edge/edgeGatewayMain.ts`; its node settings come from its own env file
 * (DOTENV_CONFIG_PATH — the role of `.env.edge`).
 *
 * DEVICES (simulators, port 0, in THIS process; the edge reaches them over TCP like real field devices):
 *   • an OT Modbus TCP server (modbus-serial ServerTCP) = node A's adapter: a writable setpoint, a read-only telemetry tag and
 *     a PINNED stop coil — every write is logged with a timestamp (an oracle independent of the product);
 *   • a SAFETY PLC Modbus TCP server (e-stop coil) = the safety-PLC config guarding node A's station (R-10-aq: the preflight
 *     is ON on both sides and reads it);
 *   • the robot is the SIM robot driver in the EDGE process (counted there, see the child).
 *
 * PROVISIONING uses the operator CLIs in-process (runEdgeSigningKeyCli generate + pin; runEdgeCredentialCli issue), proven by a
 * real admin login (bcrypt password, 2FA off — the prompt answers it); ownership is set with the admin service
 * changeDeviceOwner (R-10-am factory check, relock). Edge nodes are inserted (no `register-node` CLI exists yet — F2 builds it).
 *
 * CENTRAL'S FRONT DOOR (in front of the real router, for the node routes only): a recorder, and switches the suites drive —
 *   mode "up" | "hang" (central does not answer: requests are held until the edge's timeout) | "drop" (connection reset);
 *   tamper hooks that rewrite an ANSWER of a node route (a hostile network / man in the middle — attack suite);
 *   a delay hook (late answers — the TTL is measured from the request).
 *
 * SHARED _test HYGIENE (final fix wave I-6): ONLY the seed SIM-SAFETY-PLC-1 (doc 48 R1) is DISABLED for the suite, through
 * __edgeSeedGuard (never another suite's untargeted fixture row; the last harness re-enables it; a crash is restored at exit and
 * caught by the safetySeedIntact census) — with them enabled every real-mode, preflight-on authorisation is refused (B fix 2 G5 /
 * R-10-aw: a row central applies to every target can never be given to an edge). This is the cutover action the owner was
 * asked about; the attack suite measures the refusal while it is enabled.
 */
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import * as ModbusSerialNs from "modbus-serial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 30_000, every = 100): Promise<T> {
  const until = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() > until) throw new Error(`timed out (${ms} ms) waiting for: ${what}${last ? ` — last error: ${(last as Error).message}` : ""}`);
    await sleep(every);
  }
}

// ── Modbus TCP simulator (an independent oracle of what reached the device) ─────────────────────────────────────────

export interface ModbusSim {
  port: number;
  coils: Map<number, boolean>;
  holding: Map<number, number>;
  writes: Array<{ kind: "coil" | "register"; addr: number; value: number | boolean; at: number }>;
  reads: number;
  close(): Promise<void>;
}
export async function startModbusSim(): Promise<ModbusSim> {
  const sim: ModbusSim = { port: 0, coils: new Map(), holding: new Map(), writes: [], reads: 0, close: async () => undefined };
  const srv = new ServerTCP(
    {
      getCoil: (addr: number) => {
        sim.reads++;
        return sim.coils.get(addr) ?? false;
      },
      getDiscreteInput: () => false,
      getHoldingRegister: (addr: number) => {
        sim.reads++;
        return sim.holding.get(addr) ?? 0;
      },
      getInputRegister: () => 0,
      setCoil: (addr: number, value: boolean) => {
        sim.coils.set(addr, !!value);
        sim.writes.push({ kind: "coil", addr, value: !!value, at: Date.now() });
      },
      setRegister: (addr: number, value: number) => {
        sim.holding.set(addr, value);
        sim.writes.push({ kind: "register", addr, value, at: Date.now() });
      },
    },
    // modbus-serial does `options.port || 502` ⇒ the STRING "0" asks the OS for a free port (numeric 0 would bind 502)
    { host: "127.0.0.1", port: "0", unitID: 1 },
  );
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  sim.port = srv._server.address().port;
  if (!(sim.port > 0) || sim.port === 502) throw new Error("modbus simulator did not get an OS-assigned port");
  sim.close = () =>
    new Promise<void>((resolve) => {
      for (const s of srv?.socks?.keys?.() ?? []) (s as { destroy: () => void }).destroy();
      srv.close(() => resolve());
    });
  return sim;
}

// ── central ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CENTRAL_ENV: Record<string, string | undefined> = {
  EDGE_RUNTIME_ENABLED: "true",
  FOE_ENABLED: "true",
  FOE_SIM_GATE_REQUIRED: "false",
  EDGE_CLAIM_MIN_INTERVAL_MS: "0",
  EDGE_CONFIG_CACHE_MS: "0",
  EDGE_PULL_MS: "500",
  EDGE_HEARTBEAT_MS: "1000",
  EDGE_PROGRAM_REPORT_MS: "5000",
  EDGE_AUTH_TTL_MS: undefined,
  ROBOT_CONTROL_ENABLED: "true",
  OT_CONTROL_ENABLED: "true",
  ROBOT_COMMISSIONING_REQUIRED: undefined, // default ON — the cell carries real commissioning records
  OT_COMMISSIONING_REQUIRED: undefined,
  ROBOT_SAFETY_PREFLIGHT_ENABLED: undefined, // default ON (R-10-aq)
  OT_SAFETY_PREFLIGHT_ENABLED: undefined,
  SAFETY_PLC_ADAPTER_ENABLED: "true",
  SAFETY_AUDIT_ENABLED: "true",
  ROBOT_CONTROL_TIMEOUT_MS: "5000",
  OT_CONTROL_TIMEOUT_MS: "5000",
  SEC_PLATFORM: undefined,
  FIELD_V2_ENABLED: undefined,
  AUTH_CACHE_TTL_S: "0",
  EDGE_SIGNING_KEY_PEM: undefined,
  EDGE_SIGNING_KEY_FILE: undefined,
  EDGE_SIGNING_KEY_DIR: undefined,
  ROBOT_GATEWAY_ENABLED: undefined,
  OT_GATEWAY_ENABLED: undefined,
};

export type FrontMode = "up" | "hang" | "drop";
export interface Captured {
  path: string;
  body: any;
  auth: string | null;
  at: number;
  status?: number;
  answer?: any;
}
/** rewrite the JSON answer of a node route (path relative to /api/v1/edge/node, e.g. "/runs/12/authorize"); return undefined to keep it */
export type Tamper = (answer: any, req: { path: string; body: any; auth: string | null }) => any | Promise<any>;

export interface EdgeCounts {
  pid: number;
  bootMs: number;
  configVersion: number | null;
  configHash: string | null;
  journal: { epoch: string; backlog: number; full: boolean; healthy: boolean } | null;
  robots: Array<{ id: number; locked: boolean | null; generation: number | null; reasonCode: string | null }>;
  adapters: number[];
  motions: Array<{ jobType: string; robotId: number | null; at: number }>;
  stops: Array<{ jobType: string; robotId: number | null; at: number }>;
  trap: { count: number; byAccessor: Record<string, number> };
  pgConnects: number;
  pgConstructed: number;
  at: number;
}
export interface EdgeReport extends EdgeCounts {
  removedFromEnv: string[];
  connectsAll: number;
  probe: string;
  trapAfterProbe: number;
}
export interface EdgeProc {
  name: string;
  dir: string;
  journalDir: string;
  env: Record<string, string>;
  child: ChildProcess;
  exited: Promise<number | null>;
  counts(): EdgeCounts | null;
  waitCounts<T>(what: string, pred: (c: EdgeCounts) => T | null | undefined | false, ms?: number): Promise<T>;
  log(): string;
  /** graceful: the child measures, stops the gateway and writes report.json */
  stop(): Promise<EdgeReport>;
  /** a crash (TerminateProcess / SIGKILL): no measurement, no clean journal close */
  kill(): Promise<void>;
}

export interface SpawnOpts {
  node?: "A" | "B";
  journalDir?: string;
  /** extra lines for the node's env file */
  env?: Record<string, string>;
  waitRobot?: boolean;
}

export interface Central {
  DAU: string;
  sql: ReturnType<typeof postgres>;
  base: string;
  pgPort: number;
  dir: string;
  keyDir: string;
  pinFile: string;
  kid: string;
  ids: Record<string, number>;
  codes: Record<string, string>;
  u: { owner: number; approver: number; admin: number; engineer: number };
  adminLogin: { username: string; password: string };
  tokens: { A: string; B: string };
  credFiles: { A: string; B: string };
  credentialIds: { A: number; B: number };
  ot: ModbusSim;
  plc: ModbusSim;
  /** blocked: node routes of these callers ("A" | "B") are dropped (connection reset) — one node offline, the other not */
  front: { mode: FrontMode; captured: Captured[]; tamper: Map<string, Tamper>; delayMs: Map<string, number>; held: Set<Socket>; blocked: Set<string> };
  disabledGlobalPlc: number[];
  setMode(m: FrontMode): void;
  post(p: string, body: unknown, token?: string | null): Promise<{ status: number; json: any; text: string }>;
  trpc(proc: string, input: unknown, session: string): Promise<{ status: number; json: any }>;
  session(userId: number, openId: string): Promise<string>;
  steps: ReturnType<typeof stepsOf>;
  startRun(tag: string, steps: unknown[], node?: "A" | "B"): Promise<number>;
  approveAtGate(runId: number, gateId?: string, ms?: number): Promise<void>;
  continueHeld(runId: number, ms?: number): Promise<void>;
  abort(runId: number): Promise<void>;
  run(id: number): Promise<{ status: string; error: string | null; currentStepId: string | null; contextJson: any }>;
  assignment(id: number): Promise<any>;
  stepRows(id: number): Promise<Array<{ stepId: string; status: string; error: string | null; attempt: number; resultJson: any }>>;
  spawnEdge(name: string, opts?: SpawnOpts): Promise<EdgeProc>;
  /** the engineer's session cookie value (real JWT + user_sessions row), made once */
  engineerSession(): Promise<string>;
  /** the central mirror row of an edge robot's motion lock (authority edge:<node>), once present */
  edgeLockRow(robotId: number, ms?: number): Promise<{ generation: number; reasonCode: string; authority: string }>;
  /** the operator's clear through the REAL tRPC robot.clearMotionLock (queued as a signed command for the edge), then the edge unlocked */
  clearEdgeLock(robotId: number, edge: EdgeProc, ms?: number): Promise<{ requestId: number; generation: number }>;
  edges: EdgeProc[];
  teardown(): Promise<void>;
}

function stepsOf(ids: Record<string, number>) {
  return {
    gate: (id = "g0") => ({ id, type: "hitl_gate", prompt: "go?" }),
    move: (id: string, robotId = ids.robotA) => ({ id, type: "command", machineId: robotId === ids.robotB ? ids.mRobotB : ids.mRobotA, command: "start", args: { robotId } }),
    stop: (id: string, robotId = ids.robotA) => ({ id, type: "command", machineId: robotId === ids.robotB ? ids.mRobotB : ids.mRobotA, command: "abort", args: { robotId } }),
    delay: (id: string, ms: number) => ({ id, type: "delay", ms }),
    otWrite: (id: string, value: number) => ({ id, type: "command", machineId: ids.mOtA, command: "write_tag", args: { adapterId: ids.adapterA, tagKey: "speed_sp", value } }),
    otStop: (id: string) => ({ id, type: "command", machineId: ids.mOtA, command: "stop", args: { adapterId: ids.adapterA, writes: [{ tagKey: "stop_cmd", value: true }] } }),
  };
}

const REPO = path.resolve(__dirname, "../../..");

/**
 * What only a TEST file may hold (the session / route censuses scan product code — `*.test.ts` is test-only by construction):
 * the composed tRPC router central mounts for the console (the robot router under the key "robot") and the minting of a real
 * user session (the session JWT + its ledger row). Each suite passes these; see edgeExecution.dot10.e2e.db.test.ts.
 */
export interface CentralTestHooks {
  trpcRouter(): Promise<unknown>;
  mintSession(sql: ReturnType<typeof postgres>, userId: number, openId: string): Promise<string>;
}

export async function setupCentral(prefix: string, opts: { env?: Record<string, string | undefined>; hooks: CentralTestHooks }): Promise<Central> {
  const DB_URL = process.env.DATABASE_URL ?? "";
  if (!/_test\b/.test(new URL(DB_URL).pathname)) throw new Error("the F1 E2E harness runs on the _test DB only");
  const pgPort = Number(new URL(DB_URL).port || 5432);
  const DAU = `${prefix}-${Date.now()}`;
  const saved: Record<string, string | undefined> = {};
  const envAll = { ...CENTRAL_ENV, ...(opts.env ?? {}) };
  for (const [k, v] of Object.entries(envAll)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), `f1-${prefix}-`));
  const sql = postgres(DB_URL, { max: 3, connect_timeout: 30, onnotice: () => {} });
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
  const ids: Record<string, number> = {};
  const codes: Record<string, string> = {};
  const edges: EdgeProc[] = [];

  // ── people ──
  const adminLogin = { username: `${DAU}-admin`, password: `F1-${Math.random().toString(36).slice(2)}-pw!` };
  const u = { owner: 0, approver: 0, admin: 0, engineer: 0 };
  u.owner = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-owner`}, ${`${DAU}-owner`}, 'F1 owner', 'admin', true) RETURNING id`);
  u.approver = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-approver`}, ${`${DAU}-approver`}, 'F1 approver', 'admin', true) RETURNING id`);
  u.admin = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive", two_factor_enabled) VALUES (${`${DAU}-admin`}, ${adminLogin.username}, 'F1 admin', 'admin', true, false) RETURNING id`);
  await sql`INSERT INTO user_secrets ("userId", "passwordHash", "twoFactorSecret") VALUES (${u.admin}, ${await bcrypt.hash(adminLogin.password, 4)}, NULL)`;
  u.engineer = await one(sql`INSERT INTO users ("openId", name, role, "isActive", two_factor_enabled, "loginMethod") VALUES (${`${DAU}-engineer`}, 'F1 engineer', 'engineer', true, true, 'local') RETURNING id`);
  const [{ c: permCategory }] = await sql`SELECT e.enumlabel AS c FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = (SELECT udt_name FROM information_schema.columns WHERE table_name = 'permissions' AND column_name = 'category') ORDER BY e.enumsortorder LIMIT 1`;
  await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.engineer}, ${permCategory}, 'machine_control', true, true)`;

  // ── plant: two factories, a cell per factory ──
  for (const f of ["A", "B"] as const) {
    codes[`factory${f}`] = `F${f}-${DAU}`;
    ids[`factory${f}`] = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${codes[`factory${f}`]}, ${`F1 ${f}`}, true) RETURNING id`);
    ids[`ws${f}`] = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids[`factory${f}`]}, ${`W${f}-${DAU}`}, 'F1 ws') RETURNING id`);
    ids[`line${f}`] = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids[`ws${f}`]}, ${`L${f}-${DAU}`}, 'F1 line') RETURNING id`);
    ids[`st${f}`] = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids[`line${f}`]}, ${`S${f}-${DAU}`}, 'F1 st') RETURNING id`);
    ids[`mRobot${f}`] = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids[`st${f}`]}, ${`MR${f}-${DAU}`}, 'F1 robot cell', 'ROBOT', true) RETURNING id`);
    ids[`mOt${f}`] = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids[`st${f}`]}, ${`MO${f}-${DAU}`}, 'F1 OT cell', 'AUTOMATION', true) RETURNING id`);
    codes[`node${f}`] = `N${f}-${DAU}`;
    ids[`node${f}`] = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${codes[`node${f}`]}, ${`F1 node ${f}`}, ${codes[`factory${f}`]}, 'offline') RETURNING id`);
  }
  await sql`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id IN ${sql([ids.nodeA, ids.nodeB])}`;
  await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.engineer}, ${codes.factoryA})`;

  // ── devices ──
  const ot = await startModbusSim();
  const plc = await startModbusSim();
  const { encryptSecret } = await import("../security/secretBox");
  codes.robotA = `RA-${DAU}`;
  codes.robotB = `RB-${DAU}`;
  codes.robotC = `RC-${DAU}`;
  ids.robotA = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "pollIntervalMs") VALUES (${codes.robotA}, 'F1 robot A', 'sim', 'sim://pending', true, ${ids.lineA}, ${ids.stA}, 500) RETURNING id`);
  ids.robotB = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "connectionOptions") VALUES (${codes.robotB}, 'F1 robot B', 'sim', 'sim://pending', true, ${ids.lineB}, ${ids.stB}, ${sql.json({ password: `B-ROBOT-SECRET-${DAU}` })}) RETURNING id`);
  ids.robotC = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${codes.robotC}, 'F1 robot C (central)', 'sim', 'sim://pending', true, ${ids.lineA}, ${ids.stA}) RETURNING id`);
  // the robot id in the endpoint lets the edge's SIM driver say which robot a job reached (device simulation only)
  for (const r of ["robotA", "robotB", "robotC"]) await sql`UPDATE robots SET endpoint = ${`sim://f1-${DAU}#${ids[r]}`} WHERE id = ${ids[r]}`;
  codes.adapterA = `AA-${DAU}`;
  codes.adapterB = `AB-${DAU}`;
  ids.adapterA = await one(
    sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions", "pollIntervalMs") VALUES (${codes.adapterA}, 'F1 adapter A', 'modbus', ${`tcp://127.0.0.1:${ot.port}`}, true, ${ids.mOtA}, ${sql.json({ unitId: 1, timeoutMs: 1500, password: encryptSecret(`A-PLC-SECRET-${DAU}`) })}, 500) RETURNING id`,
  );
  ids.adapterB = await one(
    sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions") VALUES (${codes.adapterB}, 'F1 adapter B', 'stub', 'stub://b', true, ${ids.mOtB}, ${sql.json({ password: encryptSecret(`B-PLC-SECRET-${DAU}`) })}) RETURNING id`,
  );
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${ids.adapterA}, 'speed_sp', 'holding:40001', 'int', true), (${ids.adapterA}, 'temp', 'holding:40010', 'int', false), (${ids.adapterB}, 'speed_sp', 'holding:40001', 'int', true)`;
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value, stop_pinned_by, stop_pinned_at) VALUES (${ids.adapterA}, 'stop_cmd', 'coil:1', 'bool', true, ${sql.json(true)}, ${String(u.admin)}, now())`;
  ot.holding.set(9, 215); // temp (holding:40010 → register 9)
  // commissioned cell (commissioning ON by default)
  for (const r of ["robotA", "robotB", "robotC"]) await sql`INSERT INTO robot_commissioning_records ("robotId", status, "fatReference", "signedBy") VALUES (${ids[r]}, 'active', ${`FAT-${DAU}`}, ${u.admin})`;
  await sql`INSERT INTO commissioning_records ("adapterId", status, "fatReference", "signedBy") VALUES (${ids.adapterA}, 'active', ${`FAT-${DAU}`}, ${u.admin})`;
  // final fix wave I-6 (R-10-br) — ONLY the seed SIM-SAFETY-PLC-1, through the seed guard (shared advisory lock across harnesses,
  // re-enabled by the last one, crash-restored at exit); never other suites' untargeted fixture rows
  const { acquireSeedGuard } = await import("./__edgeSeedGuard.dot10");
  const seedGuard = await acquireSeedGuard(DB_URL);
  const disabledGlobalPlc = seedGuard.disabledIds;
  // the safety PLC guarding node A's station (factory A) — read by central's preflight AND, from the signed config, the edge's.
  // doc 81 Đợt 12 final fix wave (R-12-e open item b): inserted only AFTER the seed guard is held — a suite holding the seed lock
  // EXCLUSIVELY (safetySimOnly.dot1c, acquireSeedExclusive) never sees this foreign real row
  ids.plcA = await one(
    sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", "stationId", "factoryId", enabled) VALUES (${`SPLC-${DAU}`}, 'F1 safety PLC A', 'pilz', 'modbus', ${`tcp://127.0.0.1:${plc.port}`}, ${sql.json({ estop: { address: "coil:1" } })}, ${ids.stA}, ${ids.factoryA}, true) RETURNING id`,
  );

  // ── provisioning through the operator CLIs (proven admin) ──
  const io = (out: string[], err: string[]) => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {}, promptSecret: async (label: string) => (/password/i.test(label) ? adminLogin.password : null) });
  const keyDir = path.join(dir, "edge-keys");
  mkdirSync(keyDir, { recursive: true });
  const { runEdgeSigningKeyCli } = await import("../../../scripts/edge-signing-key");
  {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEdgeSigningKeyCli(["generate", "--dir", keyDir, "--actor", adminLogin.username], io(out, err), { mirrorDb: null, audit: null });
    if (code !== 0) throw new Error(`edge-signing-key generate refused (${code}): ${err.join(" | ")}`);
  }
  const keyring = JSON.parse(readFileSync(path.join(keyDir, "keyring.json"), "utf8")) as { keys: Array<{ kid: string; root: boolean }> };
  const kid = keyring.keys.find((k) => k.root)!.kid;
  const pinFile = path.join(dir, "edge-keyset.json");
  {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEdgeSigningKeyCli(["pin", "--dir", keyDir, "--out", pinFile, "--actor", adminLogin.username], io(out, err), { mirrorDb: null, audit: null });
    if (code !== 0) throw new Error(`edge-signing-key pin refused (${code}): ${err.join(" | ")}`);
  }
  process.env.EDGE_SIGNING_KEY_FILE = path.join(keyDir, `${kid}.pem`);
  process.env.EDGE_SIGNING_KEY_DIR = keyDir;
  (await import("./edgeSigning")).__resetCentralEdgeSigningKeyForTests();
  (await import("./edgeCentralCommon")).__resetCentralSignerCacheForTests();
  (await import("./edgeConfigCentral")).__resetEdgeConfigCacheForTests();
  (await import("./edgeExecutionCentral")).__resetClaimRateForTests();

  const { runEdgeCredentialCli } = await import("../../../scripts/edge-node-credential");
  const credFiles = { A: path.join(dir, "node-a.cred"), B: path.join(dir, "node-b.cred") };
  for (const n of ["A", "B"] as const) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEdgeCredentialCli(["issue", "--node", codes[`node${n}`], "--actor", adminLogin.username, "--reason", `F1 e2e provision ${n}`, "--out", credFiles[n]], io(out, err));
    if (code !== 0) throw new Error(`edge-node-credential issue ${n} refused (${code}): ${err.join(" | ")}`);
  }
  const tokens = { A: readFileSync(credFiles.A, "utf8").trim(), B: readFileSync(credFiles.B, "utf8").trim() };
  const credentialIds = { A: 0, B: 0 };
  for (const n of ["A", "B"] as const) credentialIds[n] = Number((await sql`SELECT id FROM edge_node_credentials WHERE "edgeNodeId" = ${ids[`node${n}`]} AND status = 'active'`)[0].id);

  // ── ownership (admin service, R-10-am factory check; each change relocks the robot ownerChanged) ──
  const { changeDeviceOwner } = await import("../robot/deviceOwnershipService");
  for (const [kind, dev, node] of [["robot", "robotA", "nodeA"], ["adapter", "adapterA", "nodeA"], ["robot", "robotB", "nodeB"], ["adapter", "adapterB", "nodeB"]] as const) {
    const r = await changeDeviceOwner({ kind, deviceId: ids[dev], toEdgeNodeId: ids[node], actorUserId: u.admin, actorName: "F1 admin" });
    if (!r.ok) throw new Error(`changeDeviceOwner ${dev} → ${node}: ${JSON.stringify(r)}`);
  }

  // ── central's HTTP server: front door → the real /api/v1 router; the real tRPC robot router ──
  // the device drivers are registered as the real server does at boot (server/_core/index.ts imports both); nothing is started
  await import("../ot");
  await import("../robot");
  const front: Central["front"] = { mode: "up", captured: [], tamper: new Map(), delayMs: new Map(), held: new Set(), blocked: new Set() };
  const { createV1Router } = await import("../../api/v1/router");
  const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
  const { createContext } = await import("../../_core/context");
  const app = express();
  app.use("/api/v1/edge/node", express.json({ limit: "8mb" }), (req, res, next) => {
    if (front.mode === "drop") {
      req.socket.destroy();
      return;
    }
    if (front.mode === "hang") {
      front.held.add(req.socket); // never answered; destroyed when central comes back
      return;
    }
    const auth = req.headers.authorization ?? null;
    const cap: Captured = { path: req.path, body: req.body, auth: auth ? `${auth.slice(0, 20)}…` : null, at: Date.now() };
    if (auth === `Bearer ${tokens.A}`) cap.auth = "A";
    else if (auth === `Bearer ${tokens.B}`) cap.auth = "B";
    if (cap.auth && front.blocked.has(cap.auth)) {
      req.socket.destroy();
      return;
    }
    front.captured.push(cap);
    if (front.captured.length > 20_000) front.captured.splice(0, 5_000);
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      cap.status = res.statusCode;
      cap.answer = body;
      const key = [...front.tamper.keys()].find((k) => new RegExp(k).test(cap.path)); // cap.path: req.path is rewritten by the nested router by now
      const delay = [...front.delayMs.entries()].find(([k]) => new RegExp(k).test(cap.path))?.[1] ?? 0;
      void (async () => {
        let out = body;
        if (key) {
          const t = await front.tamper.get(key)!(body, { path: cap.path, body: req.body, auth: cap.auth });
          if (t !== undefined) out = t;
        }
        if (delay > 0) await sleep(delay);
        json(out);
      })();
      return res;
    }) as typeof res.json;
    next();
  });
  app.use("/api/v1", createV1Router());
  app.use("/api/trpc", express.json(), createExpressMiddleware({ router: (await opts.hooks.trpcRouter()) as never, createContext: createContext as never }));
  const srv: Server = await new Promise((resolve) => {
    const s = createServer(app).listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  if (/:3000$/.test(base)) throw new Error("never :3000");

  const steps = stepsOf(ids);
  const wfIds: number[] = [];
  let engSession: string | null = null;

  const c: Central = {
    DAU,
    sql,
    base,
    pgPort,
    dir,
    keyDir,
    pinFile,
    kid,
    ids,
    codes,
    u,
    adminLogin,
    tokens,
    credFiles,
    credentialIds,
    ot,
    plc,
    front,
    disabledGlobalPlc,
    edges,
    steps,
    setMode(m) {
      front.mode = m;
      if (m === "up") {
        for (const s of front.held) s.destroy();
        front.held.clear();
      }
    },
    async post(p, body, token) {
      const res = await fetch(`${base}/api/v1${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body ?? {}),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: res.status, json, text };
    },
    async trpc(proc, input, session) {
      const { COOKIE_NAME } = await import("@shared/const");
      const res = await fetch(`${base}/api/trpc/${proc}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${COOKIE_NAME}=${session}` },
        body: JSON.stringify({ json: input }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    async session(userId, openId) {
      return opts.hooks.mintSession(sql, userId, openId);
    },
    async engineerSession() {
      if (!engSession) engSession = await c.session(u.engineer, `${DAU}-engineer`);
      return engSession;
    },
    async edgeLockRow(robotId, ms = 30_000) {
      return waitFor(`the mirror lock row of robot ${robotId} (written from the edge's lock event)`, async () => {
        const [row] = await sql`SELECT generation, "reasonCode", authority FROM robot_motion_locks WHERE "robotId" = ${robotId} AND authority LIKE 'edge:%'`;
        return row ? { generation: Number(row.generation), reasonCode: String(row.reasonCode), authority: String(row.authority) } : null;
      }, ms);
    },
    async clearEdgeLock(robotId, edgeProc, ms = 30_000) {
      const lock = await edgeProc.waitCounts(`robot ${robotId} known on the edge`, (cc) => cc.robots.find((r) => r.id === robotId), ms);
      if (lock.locked === false) return { requestId: 0, generation: lock.generation ?? 0 };
      const row = await waitFor(`the mirror row at the edge's generation ${lock.generation}`, async () => {
        const r = await c.edgeLockRow(robotId, ms);
        return r.generation === lock.generation ? r : null;
      }, ms);
      const r = await c.trpc("robot.clearMotionLock", { robotId, reason: "F1 e2e: cell checked, resume", expectedGeneration: row.generation }, await c.engineerSession());
      const q = r.json?.result?.data?.json?.queuedOnEdge;
      if (r.status !== 200 || !q) throw new Error(`clearMotionLock ${robotId}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 600)}`);
      await edgeProc.waitCounts(`robot ${robotId} unlocked on the edge`, (cc) => cc.robots.find((x) => x.id === robotId)?.locked === false, ms);
      return { requestId: Number(q.requestId), generation: row.generation };
    },
    async startRun(tag, stepList, node = "A") {
      const ref = `${DAU}-${tag}`;
      const def = { ref, name: ref, steps: stepList };
      const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global') RETURNING id`;
      wfIds.push(Number(wf.id));
      const { startRun } = await import("../orchestration/foe/foeEngine");
      const r = await startRun(ref, {}, { id: u.owner, role: "admin", name: "F1 owner" }, { edgeNodeId: ids[`node${node}`] });
      if (!r.ok || r.status !== "queued") throw new Error(`startRun ${tag}: ${JSON.stringify(r)}`);
      return r.runId!;
    },
    async approveAtGate(runId, gateId = "g0", ms = 60_000) {
      await waitFor(`run ${runId} paused at ${gateId} on the edge and reported`, async () => {
        const r = await c.run(runId);
        const a = await c.assignment(runId);
        return r.status === "awaiting_confirm" && r.currentStepId === gateId && a?.claimTokenHash === null;
      }, ms);
      const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
      const view = await getRun(runId, { bindingDigest: true });
      const res = await resumeRun(runId, { approved: true, expectedStepId: gateId, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "F1 approver" });
      if (!res.ok) throw new Error(`approve ${runId}: ${JSON.stringify(res)}`);
    },
    async continueHeld(runId, ms = 60_000) {
      await waitFor(`run ${runId} held and its claim released`, async () => (await c.run(runId)).status === "held" && (await c.assignment(runId))?.claimTokenHash === null, ms);
      const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
      const view = await getRun(runId, { bindingDigest: true });
      const res = await resumeRun(runId, { approved: true, expectedStepId: view!.run.currentStepId ?? undefined, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "F1 approver" });
      if (!res.ok) throw new Error(`continue ${runId}: ${JSON.stringify(res)}`);
    },
    async abort(runId) {
      const { abortRun } = await import("../orchestration/foe/foeEngine");
      const r = await abortRun(runId, { id: u.admin, role: "admin", name: "F1 central operator" }, "stop the cell");
      if (r.status !== "aborted") throw new Error(`abort ${runId}: ${JSON.stringify(r)}`);
    },
    async run(id) {
      return (await sql`SELECT status, error, "currentStepId", "contextJson" FROM orchestration_runs WHERE id = ${id}`)[0] as never;
    },
    async assignment(id) {
      return (await sql`SELECT * FROM orchestration_run_edge_assignments WHERE "runId" = ${id}`)[0];
    },
    async stepRows(id) {
      return (await sql`SELECT "stepId", status, error, attempt, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${id} ORDER BY id`) as never;
    },
    async spawnEdge(name, so = {}) {
      const node = so.node ?? "A";
      const edir = mkdtempSync(path.join(dir, `edge-${name}-`));
      const journalDir = so.journalDir ?? path.join(dir, `journal-${name}`);
      mkdirSync(journalDir, { recursive: true });
      // the node's OWN env file (the role of .env.edge): identity from the provisioning bundle, no DB, no central secret
      const nodeEnv: Record<string, string> = {
        EDGE_CENTRAL_URL: base,
        EDGE_NODE_CREDENTIAL_FILE: credFiles[node],
        EDGE_CENTRAL_NODE_ID: String(ids[`node${node}`]),
        EDGE_CENTRAL_CREDENTIAL_ID: String(credentialIds[node]),
        EDGE_KEYSET_PIN_FILE: pinFile,
        EDGE_JOURNAL_DIR: journalDir,
        EDGE_GATEWAY_NODE_CODE: codes[`node${node}`],
        EDGE_EXECUTION_ENABLED: "true",
        EDGE_RUNTIME_ENABLED: "true",
        FOE_ENABLED: "true",
        OT_GATEWAY_ENABLED: "true",
        ROBOT_GATEWAY_ENABLED: "true",
        ROBOT_CONTROL_ENABLED: "true",
        OT_CONTROL_ENABLED: "true",
        SAFETY_PLC_ADAPTER_ENABLED: "true",
        ROBOT_CONTROL_TIMEOUT_MS: "5000",
        OT_CONTROL_TIMEOUT_MS: "5000",
        EDGE_PULL_INTERVAL_MS: "200",
        EDGE_ABORT_POLL_MS: "200",
        EDGE_REQUEST_TIMEOUT_MS: "2000",
        EDGE_STOP_RESEND_MIN_MS: "1000",
        EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS: "1000",
        EDGE_RECONCILE_RETRY_MS: "1000",
        EDGE_GATEWAY_LIVENESS_FILE: path.join(edir, "alive.json"),
        EDGE_UNS_STORE_FORWARD_FILE: path.join(edir, "uns.jsonl"),
        EDGE_CLAIM_BACKOFF_MAX_MS: "2000",
        ...(so.env ?? {}),
      };
      const envFile = path.join(edir, "edge.env");
      writeFileSync(envFile, Object.entries(nodeEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
      // the spawn environment: an ALLOW-LIST (OS basics + where the env file is + the child's markers) — nothing else
      const ALLOW = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"];
      const env: Record<string, string> = {};
      for (const k of ALLOW) if (process.env[k] !== undefined) env[k] = process.env[k]!;
      Object.assign(env, { NODE_ENV: "test", DOTENV_CONFIG_PATH: envFile, F1_EDGE_CHILD: "1", F1_EDGE_DIR: edir, F1_EDGE_PG_PORT: String(pgPort), F1_EDGE_WAIT_ROBOT: so.waitRobot === false ? "0" : "1" });
      const forbidden = Object.keys(env).filter((k) => k === "DATABASE_URL" || k.startsWith("PG") || k === "JWT_SECRET" || k === "SECRET_ENCRYPTION_KEY" || k === "TEST_DATABASE_URL");
      if (forbidden.length) throw new Error(`spawn env carries ${forbidden.join(", ")}`);
      const logFd = openSync(path.join(edir, "edge.log"), "w");
      const child = spawn(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", "server/services/edge/edgeE2eChild.dot10.test.ts", "--pool=threads", "--no-file-parallelism"], {
        cwd: REPO,
        env,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
      closeSync(logFd);
      const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
      const readJson = <T>(f: string): T | null => {
        try {
          return JSON.parse(readFileSync(path.join(edir, f), "utf8")) as T;
        } catch {
          return null;
        }
      };
      const proc: EdgeProc = {
        name,
        dir: edir,
        journalDir,
        env: nodeEnv,
        child,
        exited,
        counts: () => readJson<EdgeCounts>("counts.json"),
        waitCounts: (what, pred, ms = 30_000) =>
          waitFor(what, () => {
            const cc = readJson<EdgeCounts>("counts.json");
            return cc ? pred(cc) : null;
          }, ms),
        log: () => {
          try {
            return readFileSync(path.join(edir, "edge.log"), "utf8");
          } catch {
            return "";
          }
        },
        async stop() {
          writeFileSync(path.join(edir, "stop"), "1");
          const code = await Promise.race([exited, sleep(90_000).then(() => "timeout" as const)]);
          if (code === "timeout") {
            child.kill("SIGKILL");
            throw new Error(`edge ${name} did not stop in time\n${proc.log().slice(-4000)}`);
          }
          const rep = readJson<EdgeReport>("report.json");
          if (!rep) throw new Error(`edge ${name} wrote no report (exit ${code})\n${proc.log().slice(-4000)}`);
          return rep;
        },
        async kill() {
          child.kill("SIGKILL");
          await Promise.race([exited, sleep(15_000)]);
        },
      };
      edges.push(proc);
      await waitFor(`edge ${name} up (verified config${so.waitRobot === false ? "" : " + robot attached"})`, async () => {
        if (child.exitCode !== null) throw new Error(`edge ${name} exited ${child.exitCode}\n${proc.log().slice(-4000)}`);
        return existsSync(path.join(edir, "ready"));
      }, 180_000, 200);
      return proc;
    },
    async teardown() {
      for (const e of edges) {
        if (e.child.exitCode === null) {
          writeFileSync(path.join(e.dir, "stop"), "1");
          const code = await Promise.race([e.exited, sleep(60_000).then(() => "timeout" as const)]);
          if (code === "timeout") e.child.kill("SIGKILL");
        }
      }
      c.setMode("up");
      await new Promise<void>((r) => srv.close(() => r()));
      await ot.close().catch(() => undefined);
      await plc.close().catch(() => undefined);
      await seedGuard.release().catch((e) => console.warn(`[F1] seed guard NOT released (the census / the exit hook restores it): ${(e as Error).message}`));
      await cleanupRows(sql, ids, u, wfIds).catch((e) => console.warn(`[F1] cleanup: ${(e as Error).message}`));
      await sql.end();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      if (process.env.F1_KEEP !== "1") rmSync(dir, { recursive: true, force: true });
      else console.warn(`[F1] kept ${dir}`);
    },
  };
  return c;
}

async function cleanupRows(sql: ReturnType<typeof postgres>, ids: Record<string, number>, u: Central["u"], wfIds: number[]): Promise<void> {
  const warn = (what: string) => (e: unknown) => console.warn(`[F1] ${what}: ${(e as Error).message}`);
  for (const w of wfIds) {
    for (const r of await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`) {
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`foe-run${r.id}-%`}`.catch(() => undefined);
      await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`.catch(warn(`steps of run ${r.id}`));
      await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`.catch(warn(`run ${r.id}`));
    }
    await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${w}`.catch(() => undefined);
    await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`.catch(warn(`workflow ${w}`));
  }
  const robotsAll = [ids.robotA, ids.robotB, ids.robotC].filter(Boolean);
  const adaptersAll = [ids.adapterA, ids.adapterB].filter(Boolean);
  // pending STOP requests block a device delete (0374 R-10-i): closed through the guarded human resolution
  await sql`SELECT public.edge_stop_resolve(q.id, ${u.admin}, 'F1 e2e teardown') FROM robot_motion_lock_requests q
            WHERE (q."robotId" IN ${sql(robotsAll)} OR q."adapterId" IN ${sql(adaptersAll)}) AND q."ackedAt" IS NULL AND q.kind = 'stop'`.catch(warn("STOP resolution"));
  await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE ("robotId" IN ${sql(robotsAll)}) AND "ackedAt" IS NULL AND kind <> 'stop'`.catch(() => undefined);
  const { getDb } = await import("../../db/connection");
  const d = await getDb().catch(() => null);
  if (d) {
    const { clearEdgeMotionLock } = await import("./edgeControlSchema");
    for (const r of robotsAll) {
      for (const row of await sql`SELECT "authorityNodeId", "ownerEpoch" FROM robot_motion_locks WHERE "robotId" = ${r} AND "authorityNodeId" IS NOT NULL`) {
        await clearEdgeMotionLock(d as never, { robotId: r, nodeId: Number(row.authorityNodeId), ownerEpoch: Number(row.ownerEpoch), generation: 2_147_483_647 }).catch(() => undefined);
      }
    }
  }
  for (const r of robotsAll) {
    await sql`DELETE FROM robot_jobs WHERE "robotId" = ${r}`.catch(() => undefined);
    await sql`DELETE FROM robot_telemetry WHERE "robotId" = ${r}`.catch(() => undefined);
    await sql`DELETE FROM safety_events WHERE "robotId" = ${r}`.catch(() => undefined);
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${r} AND authority = 'central'`.catch(() => undefined);
    await sql`DELETE FROM robot_commissioning_records WHERE "robotId" = ${r}`.catch(() => undefined);
    await sql`DELETE FROM safety_plc_configs WHERE "robotId" = ${r}`.catch(() => undefined);
    await sql`DELETE FROM robots WHERE id = ${r}`.catch(warn(`robot ${r} not removed`));
  }
  if (ids.plcA) await sql`DELETE FROM safety_plc_configs WHERE id = ${ids.plcA}`.catch(warn("plc config"));
  for (const a of adaptersAll) {
    await sql`DELETE FROM command_log WHERE "adapterId" = ${a}`.catch(() => undefined);
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${a}`.catch(() => undefined);
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${a}`.catch(() => undefined);
    await sql`DELETE FROM device_adapters WHERE id = ${a}`.catch(warn(`adapter ${a} not removed`));
  }
  for (const n of ["nodeA", "nodeB"]) if (ids[n]) await sql`DELETE FROM edge_nodes WHERE id = ${ids[n]}`.catch(warn(`node ${n} not removed (WORM evidence references it)`));
  for (const f of ["A", "B"]) {
    for (const m of [`mRobot${f}`, `mOt${f}`]) if (ids[m]) await sql`DELETE FROM machines WHERE id = ${ids[m]}`.catch(() => undefined);
    if (ids[`st${f}`]) await sql`DELETE FROM stations WHERE id = ${ids[`st${f}`]}`.catch(() => undefined);
    if (ids[`line${f}`]) await sql`DELETE FROM production_lines WHERE id = ${ids[`line${f}`]}`.catch(() => undefined);
    if (ids[`ws${f}`]) await sql`DELETE FROM workshops WHERE id = ${ids[`ws${f}`]}`.catch(() => undefined);
    if (ids[`factory${f}`]) await sql`DELETE FROM factories WHERE id = ${ids[`factory${f}`]}`.catch(() => undefined);
  }
  const people = Object.values(u).filter(Boolean);
  await sql`DELETE FROM user_sessions WHERE "userId" IN ${sql(people)}`.catch(() => undefined);
  await sql`DELETE FROM permissions WHERE "userId" IN ${sql(people)}`.catch(() => undefined);
  await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(people)}`.catch(() => undefined);
  await sql`DELETE FROM user_secrets WHERE "userId" IN ${sql(people)}`.catch(() => undefined);
  await sql`DELETE FROM users WHERE id IN ${sql(people)}`.catch(() => undefined); // audit rows may reference them (WORM)
}

/** The PG tripwires of an edge report, as one object (asserted by every suite). */
export function noDbEvidence(r: EdgeReport) {
  return { trap: r.trap.count, pgConnects: r.pgConnects, pgConstructed: r.pgConstructed, probe: r.probe, removedFromEnv: r.removedFromEnv.filter((k) => k === "DATABASE_URL") };
}

export function listDir(d: string): string[] {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
