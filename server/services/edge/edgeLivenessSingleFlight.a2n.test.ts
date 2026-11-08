/**
 * Đĩa edge treo (a2n) — writeLiveness is single-flight. It was the root of the full pool: sendHeartbeat runs on a setInterval and every beat left one stuck `fs`
 * call behind, one libuv thread each, with no ceiling (measured in the a2n report, 3.1). REAL gateway boot, REAL sendHeartbeat, FakeCentral; the hand is on
 * fs.mkdir / fs.writeFile of the liveness path only. No DB (EDGE_DB_TRAP=throw). Measured:
 *   a write in flight ⇒ the next beats call no `fs`, and still reach central on time: a hung disk never holds the network heartbeat;
 *   the marker stays as it was (stale mtime: what the Dockerfile HEALTHCHECK reads, as on main);
 *   an error or the disk's return frees the flag: the next beat writes again.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG")) delete process.env[k];
  process.env.EDGE_DB_TRAP = "throw";
});
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => false,
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
  publishNormalized: () => undefined,
  publishSparkplugDData: () => undefined,
}));

import "../../edge/edgeRole";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";

type Gw = typeof import("./edgeGatewayRuntime");
const central = new FakeCentral(7, 31);
const KEYS = ["EDGE_CENTRAL_URL", "EDGE_NODE_CREDENTIAL_FILE", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_KEYSET_PIN_FILE", "EDGE_JOURNAL_DIR", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_UNS_STORE_FORWARD_FILE", "EDGE_EXECUTION_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
let alive = "";
let gw: Gw;

/** the hand on the liveness path; everything else goes to the real fs */
const hand = {
  treo: false,
  loiMkdir: false,
  loiWrite: false,
  mo: (() => undefined) as () => void,
  cho: Promise.resolve(),
  mkdir: 0,
  write: 0,
};
function treo() {
  hand.treo = true;
  hand.cho = new Promise<void>((r) => (hand.mo = r));
}
function tha() {
  hand.treo = false;
  hand.mo();
}
const mkdirGoc = fs.mkdir.bind(fs);
const writeGoc = fs.writeFile.bind(fs);

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-liveness-"));
  alive = path.join(dir, "live", "alive.json");
  await fs.writeFile(path.join(dir, "node.cred"), KIT_TOKEN, { mode: 0o600 });
  await fs.writeFile(path.join(dir, "pin.json"), JSON.stringify(central.pin));
  Object.assign(process.env, {
    EDGE_CENTRAL_URL: "https://central.test",
    EDGE_NODE_CREDENTIAL_FILE: path.join(dir, "node.cred"),
    EDGE_CENTRAL_NODE_ID: "7",
    EDGE_CENTRAL_CREDENTIAL_ID: "31",
    EDGE_KEYSET_PIN_FILE: path.join(dir, "pin.json"),
    EDGE_JOURNAL_DIR: path.join(dir, "journal"),
    EDGE_GATEWAY_LIVENESS_FILE: alive,
    EDGE_UNS_STORE_FORWARD_FILE: path.join(dir, "uns.jsonl"),
  });
  delete process.env.EDGE_EXECUTION_ENABLED;
  vi.spyOn(fs, "mkdir").mockImplementation((async (p: string, o: never) => {
    if (String(p) !== path.dirname(alive)) return mkdirGoc(p, o);
    hand.mkdir++;
    if (hand.loiMkdir) {
      hand.loiMkdir = false;
      throw new Error("EIO mkdir");
    }
    if (hand.treo) await hand.cho;
    return mkdirGoc(p, o);
  }) as never);
  vi.spyOn(fs, "writeFile").mockImplementation((async (p: string, d: string, o: never) => {
    if (String(p) !== alive) return writeGoc(p, d, o);
    hand.write++;
    if (hand.loiWrite) {
      hand.loiWrite = false;
      throw new Error("EIO write");
    }
    if (hand.treo) await hand.cho;
    return writeGoc(p, d, o);
  }) as never);
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  gw = await import("./edgeGatewayRuntime");
  const h = await gw.bootstrapEdgeGateway({ fetchImpl: central.fetchImpl });
  expect(h.runtime).not.toBeNull();
});

afterAll(async () => {
  tha();
  await gw.stopEdgeGateway();
  gw._resetForTests();
  vi.restoreAllMocks();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

beforeEach(() => {
  hand.mkdir = 0;
  hand.write = 0;
  hand.loiMkdir = false;
  hand.loiWrite = false;
});
afterEach(async () => {
  tha();
  const m = hand.mkdir;
  // whatever flew has landed: a beat reaches `fs` again, the next case starts from a free flag
  await vi.waitFor(
    async () => {
      await gw.sendHeartbeat();
      expect(hand.mkdir).toBeGreaterThan(m);
    },
    { timeout: 2_000, interval: 5 },
  );
});

const nhipMang = () => central.callsTo("heartbeat").length;
const luiNhip = () => new Promise((r) => setTimeout(r, 0));
/** one beat with the shape the interval gives it: not awaited by anyone */
function dapNhip(): Promise<unknown> {
  return gw.sendHeartbeat();
}

describe("a2n — writeLiveness is single-flight", () => {
  it("★ a write in flight: 10 more beats call no fs at all", async () => {
    treo();
    void dapNhip();
    await vi.waitFor(() => expect(hand.mkdir).toBe(1), { timeout: 2_000, interval: 2 });
    for (let i = 0; i < 10; i++) await dapNhip();
    await luiNhip();
    expect(hand.mkdir).toBe(1);
    expect(hand.write).toBe(0);
  });

  it("★ the network heartbeat keeps its beat while the marker hangs: each beat reaches central and answers, none waits on the disk", async () => {
    treo();
    const n0 = nhipMang();
    void dapNhip();
    await vi.waitFor(() => expect(hand.mkdir).toBe(1), { timeout: 2_000, interval: 2 });
    expect(nhipMang()).toBe(n0 + 1); // the beat whose own marker hangs went out first
    for (let i = 1; i <= 5; i++) {
      const h = await Promise.race([dapNhip(), new Promise((r) => setTimeout(() => r("held by the disk"), 1_000))]);
      expect(h).not.toBe("held by the disk");
      expect(nhipMang()).toBe(n0 + 1 + i);
    }
  });

  it("★ a skipped beat leaves the marker as it was: same bytes, same mtime (the healthcheck ages it, as on main)", async () => {
    await gw.sendHeartbeat();
    const truoc = await fs.stat(alive);
    const noiDung = await fs.readFile(alive, "utf8");
    treo();
    void dapNhip();
    await vi.waitFor(() => expect(hand.mkdir).toBe(1), { timeout: 2_000, interval: 2 });
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 5; i++) await dapNhip();
    const sau = await fs.stat(alive);
    expect(sau.mtimeMs).toBe(truoc.mtimeMs);
    expect(await fs.readFile(alive, "utf8")).toBe(noiDung);
  });

  it("★ the disk returns: the write in flight lands, the flag is free, the next beat writes a fresh marker", async () => {
    treo();
    void dapNhip();
    await vi.waitFor(() => expect(hand.mkdir).toBe(1), { timeout: 2_000, interval: 2 });
    await dapNhip();
    tha();
    await vi.waitFor(() => expect(hand.write).toBe(1), { timeout: 2_000, interval: 2 });
    const truoc = hand.mkdir;
    await vi.waitFor(
      async () => {
        await dapNhip();
        expect(hand.mkdir).toBe(truoc + 1);
      },
      { timeout: 2_000, interval: 5 },
    );
    await vi.waitFor(() => expect(hand.write).toBe(2), { timeout: 2_000, interval: 2 });
    expect(JSON.parse(await fs.readFile(alive, "utf8")).status).toBeTypeOf("string");
    const m = await fs.stat(alive);
    expect(Date.now() - m.mtimeMs).toBeLessThan(5_000);
  });

  it("★ an mkdir that fails frees the flag: the next beat writes", async () => {
    hand.loiMkdir = true;
    await dapNhip();
    expect(hand.mkdir).toBe(1);
    expect(hand.write).toBe(0);
    await dapNhip();
    expect(hand.mkdir).toBe(2);
    expect(hand.write).toBe(1);
  });

  it("★ a writeFile that fails frees the flag: the next beat writes", async () => {
    hand.loiWrite = true;
    await dapNhip();
    expect(hand.write).toBe(1);
    await dapNhip();
    expect(hand.mkdir).toBe(2);
    expect(hand.write).toBe(2);
  });

  it("nothing in flight: every beat writes, none is skipped", async () => {
    for (let i = 0; i < 3; i++) await dapNhip();
    expect(hand.mkdir).toBe(3);
    expect(hand.write).toBe(3);
  });
});
