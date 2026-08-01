/**
 * hotFolderRouter tests (doc 27 gap C1 · W2-A).
 *
 * Covers: config CRUD (validation of adapterKey / machine / absolute paths),
 * status + recentFiles reads, the flag gate on processNow, dryRun returning a
 * canonical preview WITHOUT persisting, and the RBAC machine_control gates —
 * all against the shared FakeDb (no real database, no real watchers).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: makeEq,
    and: makeAnd,
    desc: makeDesc,
    asc: (col: { name: string }) => ({ name: col.name, dir: "asc" }),
  };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control" });
    }
    return next({ ctx });
  },
}));

import { hotFolderConfigs, hotFolderFiles, machines } from "../../drizzle/schema";
import { hotFolderRouter } from "./hotFolderRouter";
import { __resetHotFolderRuntimeForTests } from "../services/vision/hotFolderService";

const ctx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const caller = hotFolderRouter.createCaller(ctx);

// Absolute path that exists on any OS (never actually watched in these tests —
// the flag is toggled per-test and no watcher is started by CRUD alone when
// startHotFolderIngest was never called).
const WATCH = os.tmpdir();

beforeEach(async () => {
  await __resetHotFolderRuntimeForTests();
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  process.env.HOT_FOLDER_INGEST_ENABLED = "false";
  fake.seed(machines, [{ id: 7, code: "AOI-07", name: "AOI 7" }]);
  fake.setUnique(hotFolderFiles, [["idempotencyKey"]]);
});

afterEach(async () => {
  await __resetHotFolderRuntimeForTests();
});

describe("createConfig", () => {
  it("creates a config with defaults applied", async () => {
    const created = await caller.createConfig({
      machineId: 7,
      adapterKey: "generic-json",
      watchPath: WATCH,
    });
    expect(created!.id).toBeGreaterThan(0);
    expect(created!.filePattern).toBe("*.{csv,xml,json}");
    expect(created!.stabilityWindowMs).toBe(2000);
    expect(created!.enabled).toBe(true);
  });

  it("rejects an unknown adapter key with BAD_REQUEST", async () => {
    await expect(
      caller.createConfig({ machineId: 7, adapterKey: "not-a-vendor", watchPath: WATCH }),
    ).rejects.toThrow(/No vision adapter registered/);
  });

  it("rejects a missing machine", async () => {
    await expect(
      caller.createConfig({ machineId: 999, adapterKey: "generic-json", watchPath: WATCH }),
    ).rejects.toThrow(/Machine id=999 not found/);
  });

  it("rejects a relative watchPath", async () => {
    await expect(
      caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: "relative/dir" }),
    ).rejects.toThrow(/absolute path/);
  });

  it("denies without machine_control permission", async () => {
    perm.allow = false;
    await expect(
      caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: WATCH }),
    ).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});

describe("update / delete / list", () => {
  it("updates a patch and normalizes values", async () => {
    const created = await caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: WATCH });
    const updated = await caller.updateConfig({
      id: created!.id,
      patch: { filePattern: "*.xml", stabilityWindowMs: 5000, enabled: false },
    });
    expect(updated!.filePattern).toBe("*.xml");
    expect(updated!.stabilityWindowMs).toBe(5000);
    expect(updated!.enabled).toBe(false);
  });

  it("update of a missing id → BAD_REQUEST", async () => {
    await expect(caller.updateConfig({ id: 424242, patch: { enabled: false } })).rejects.toThrow(/not found/);
  });

  it("deletes a config (ledger rows are kept)", async () => {
    const created = await caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: WATCH });
    fake.seed(hotFolderFiles, [
      { id: 1, configId: created!.id, machineId: 7, fileName: "a.csv", contentHash: "h", idempotencyKey: "k", status: "processed", processedAt: new Date() },
    ]);
    const removed = await caller.deleteConfig({ id: created!.id });
    expect(removed!.id).toBe(created!.id);
    expect(await caller.listConfigs()).toHaveLength(0);
    expect(fake.store.get("hot_folder_files")).toHaveLength(1); // audit trail preserved
  });

  it("delete denies without canDelete", async () => {
    perm.allow = false;
    await expect(caller.deleteConfig({ id: 1 })).rejects.toThrow(/FORBIDDEN|machine_control/i);
  });
});

describe("status + recentFiles", () => {
  it("status reports the flag and per-config runtime (not watching when never started)", async () => {
    await caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: WATCH });
    const s = await caller.status();
    expect(s.enabled).toBe(false);
    expect(s.configs).toHaveLength(1);
    expect(s.configs[0].watching).toBe(false);
    expect(s.configs[0].processedCount).toBe(0);
  });

  it("recentFiles returns the ledger tail for one config", async () => {
    fake.seed(hotFolderConfigs, [{ id: 3, machineId: 7, adapterKey: "generic-json", watchPath: WATCH, filePattern: "*", enabled: true, pollFallbackMs: 0, stabilityWindowMs: 2000, deleteAfterDays: 30 }]);
    fake.seed(hotFolderFiles, [
      { id: 1, configId: 3, machineId: 7, fileName: "a.csv", contentHash: "h1", idempotencyKey: "k1", status: "processed", inspectionId: 11, processedAt: new Date("2026-07-01T00:00:00Z") },
      { id: 2, configId: 3, machineId: 7, fileName: "b.csv", contentHash: "h2", idempotencyKey: "k2", status: "error", errorReason: "boom", processedAt: new Date("2026-07-02T00:00:00Z") },
      { id: 3, configId: 999, machineId: 8, fileName: "other.csv", contentHash: "h3", idempotencyKey: "k3", status: "processed", processedAt: new Date() },
    ]);
    const rows = await caller.recentFiles({ configId: 3 });
    expect(rows).toHaveLength(2);
    expect(rows[0].fileName).toBe("b.csv"); // newest first
  });
});

describe("processNow (flag-gated)", () => {
  it("is a no-op with enabled:false when the flag is off", async () => {
    const created = await caller.createConfig({ machineId: 7, adapterKey: "generic-json", watchPath: WATCH });
    const r = await caller.processNow({ configId: created!.id });
    expect(r).toMatchObject({ enabled: false });
  });

  it("unknown config id (flag on) → BAD_REQUEST", async () => {
    process.env.HOT_FOLDER_INGEST_ENABLED = "true";
    await expect(caller.processNow({ configId: 987654 })).rejects.toThrow(/not found/);
  });
});

describe("dryRun (persists nothing)", () => {
  it("returns a canonical preview for a valid generic-json sample", async () => {
    const r = await caller.dryRun({
      adapterKey: "generic-json",
      fileName: "sample.json",
      content: JSON.stringify({ serial: "SN77", results: [{ point: "MP1", value: 1.2, judged: "OK" }] }),
      machineCode: "AOI-07",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format).toBe("json");
      expect(r.canonical.serialNumber).toBe("SN77");
      expect(r.canonical.machineCode).toBe("AOI-07");
      expect(r.summary.measurementCount).toBe(1);
    }
    // nothing persisted anywhere
    expect(fake.store.get("hot_folder_files") ?? []).toHaveLength(0);
    expect(fake.store.get("product_inspections") ?? []).toHaveLength(0);
  });

  it("surfaces parse failures with the stage marker", async () => {
    const r = await caller.dryRun({ adapterKey: "generic-json", fileName: "x.xml", content: "<a><b></a>" });
    expect(r).toMatchObject({ ok: false, stage: "parse" });
  });

  it("works while the ingest flag is OFF (wizard can validate before enabling)", async () => {
    process.env.HOT_FOLDER_INGEST_ENABLED = "false";
    const r = await caller.dryRun({
      adapterKey: "generic-json",
      fileName: "s.json",
      content: '{"serial":"SN1","results":[]}',
    });
    expect(r.ok).toBe(true);
  });
});
