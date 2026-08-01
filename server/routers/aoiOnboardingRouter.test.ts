/**
 * aoiOnboardingRouter tests (W2-D · doc 27 §3 gap C4 + §2 gap M8).
 *
 * Covers:
 *   • draft lifecycle — saveDraft creates ONE 'draft' row, updates in place,
 *     getDraft resumes it, deleteDraft removes it; secrets are deep-stripped
 *     from configSnapshot (only keyPrefix survives).
 *   • dryRun — valid generic-json sample → ok + canonical summary (counts,
 *     breakdown, warnings); bad payload / unknown adapter → ok:false + hints
 *     (a failed parse is a VALID outcome, not a thrown error).
 *   • signOff — requires a draft + passing dry-run; admin may override WITH a
 *     reason; writes the commissioned record (who/when) + an immutable
 *     control_audit_log row; provisions the hot-folder config via W2-A's router.
 *   • SOFT gate semantics — status flips commissioning → production on sign-off
 *     and back on decommission; the service lookup FAILS OPEN to "production".
 *   • RBAC — module-permission denial rejects.
 *
 * Uses the shared FakeDb (__otFakeDb) — no real DB needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq, type Row } from "./__otFakeDb";
import {
  machines,
  aoiCommissioningRecords,
  controlAuditLog,
} from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  // ne() is used by aoiCommissioningService (status != 'draft'); defined inline
  // because vi.mock factories are hoisted above top-level consts.
  const ne = (col: { name: string }, value: unknown) => (row: Row) => row[col.name] !== value;
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, ne };
});
vi.mock("../db", () => ({
  getDb: vi.fn(async () => fake),
  // consumed by the global fire-and-forget audit middleware (protectedProcedure)
  createAuditLog: vi.fn(async () => ({})),
}));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_monitoring" });
    }
    return next({ ctx });
  },
}));

// W2-A's hot-folder router — mocked at the tRPC boundary (bridge contract:
// listConfigs / createConfig / updateConfig). Keeps the test independent of the
// hot-folder service internals (chokidar, fs).
const hfCreate = vi.fn(async (input: any) => ({ id: 99, ...input }));
const hfUpdate = vi.fn(async (input: any) => ({ id: input.id }));
const hfList = vi.fn(async (): Promise<any[]> => []);
vi.mock("./hotFolderRouter", () => ({
  hotFolderRouter: {
    createCaller: () => ({ listConfigs: hfList, createConfig: hfCreate, updateConfig: hfUpdate }),
  },
}));

import { aoiOnboardingRouter } from "./aoiOnboardingRouter";
import {
  getAoiIngestMode,
  invalidateAoiCommissioningCache,
} from "../services/aoiCommissioningService";
import { getDb } from "../db";

const adminCtx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const engineerCtx = { user: { id: 8, role: "supervisor", name: "Eng" } } as any;
const admin = aoiOnboardingRouter.createCaller(adminCtx);
const engineer = aoiOnboardingRouter.createCaller(engineerCtx);

const MACHINE = {
  id: 1, code: "AOI-01", name: "AOI line 1", machineType: "AOI",
  stationId: 1, isActive: true, apiKey: "mach_secret", model: "X1",
  manufacturer: "ICT", lastHeartbeat: null,
};

const SAMPLE = JSON.stringify({
  serial: "SN-001",
  product: "BOARD-A",
  results: [
    { point: "MP1", value: 0.42, judged: "OK" },
    { point: "MP2", value: 9.1, judged: "NG", defect: "SOLDER_BRIDGE", severity: "major" },
    { point: "MP3", value: 1.0, judged: "RETEST" },
  ],
});

function tableRows(t: any): Row[] {
  return fake.store.get((t as any)[Symbol.for("drizzle:Name")]) ?? [];
}

async function seedDraft(passed: boolean) {
  await admin.saveDraft({
    machineId: 1,
    configSnapshot: {
      step: 4,
      vendor: { adapterKey: "generic-json", label: "Generic JSON" },
      ingestion: {
        mode: "hot-folder",
        hotFolder: { watchPath: "D:\\aoi\\export", filePattern: "*.json" },
      },
      dryRun: { passed, adapterKey: "generic-json" },
    },
  });
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  invalidateAoiCommissioningCache();
  fake.seed(machines, [MACHINE, { ...MACHINE, id: 2, code: "ROB-01", machineType: "ROBOT" }]);
  hfCreate.mockClear();
  hfUpdate.mockClear();
  hfList.mockClear();
  hfList.mockResolvedValue([]);
  vi.mocked(getDb).mockImplementation(async () => fake as any);
});

describe("listAoiMachines", () => {
  it("returns only inspection-family machines, never the apiKey, with status badge", async () => {
    const rows = await admin.listAoiMachines();
    expect(rows.map((r) => r.code)).toEqual(["AOI-01"]); // ROBOT filtered out
    expect((rows[0] as any).apiKey).toBeUndefined();
    expect(rows[0].hasApiKey).toBe(true);
    expect(rows[0].commissioningStatus).toBe("uncommissioned");
  });

  it("RBAC: denies without the module permission", async () => {
    perm.allow = false;
    await expect(admin.listAoiMachines()).rejects.toThrow(/FORBIDDEN|machine_monitoring/i);
  });
});

describe("draft lifecycle (resumable wizard)", () => {
  it("saveDraft creates ONE draft row and updates it in place on re-save", async () => {
    await seedDraft(false);
    let drafts = tableRows(aoiCommissioningRecords);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("draft");
    expect(drafts[0].createdBy).toBe(7);

    await admin.saveDraft({ machineId: 1, configSnapshot: { step: 2, notes: "updated" } });
    drafts = tableRows(aoiCommissioningRecords);
    expect(drafts).toHaveLength(1); // updated, not duplicated
    expect((drafts[0].configSnapshot as any).notes).toBe("updated");

    const resumed = await admin.getDraft({ machineId: 1 });
    expect((resumed?.configSnapshot as any).step).toBe(2);

    const del = await admin.deleteDraft({ machineId: 1 });
    expect(del.deleted).toBe(true);
    expect(tableRows(aoiCommissioningRecords)).toHaveLength(0);
  });

  it("deep-strips secret-shaped keys from the snapshot (keyPrefix survives)", async () => {
    await admin.saveDraft({
      machineId: 1,
      configSnapshot: {
        credential: { issued: true, keyPrefix: "mach_ab12" },
        apiKey: "LEAKED-TOP-LEVEL",
        nested: { plaintextKey: "LEAKED-NESTED", ok: 1 },
      } as any,
    });
    const snap = tableRows(aoiCommissioningRecords)[0].configSnapshot as any;
    expect(JSON.stringify(snap)).not.toMatch(/LEAKED/);
    expect(snap.apiKey).toBeUndefined();
    expect(snap.nested.plaintextKey).toBeUndefined();
    expect(snap.nested.ok).toBe(1);
    expect(snap.credential.keyPrefix).toBe("mach_ab12");
  });

  it("saveDraft rejects an unknown machine", async () => {
    await expect(admin.saveDraft({ machineId: 999, configSnapshot: {} })).rejects.toThrow(/không tồn tại|NOT_FOUND/i);
  });
});

describe("dryRun (persists nothing)", () => {
  it("valid generic-json sample → canonical summary with breakdown + warnings", async () => {
    const res = await admin.dryRun({ adapterKey: "generic-json", payload: SAMPLE, machineCode: "AOI-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.serialNumber).toBe("SN-001");
    expect(res.summary.productModel).toBe("BOARD-A");
    expect(res.summary.measurementCount).toBe(3);
    expect(res.summary.results).toEqual({ OK: 1, NG: 1, NTF: 1 });
    expect(res.summary.overallResult).toBe("NG"); // derived: any NG → NG
    expect(res.summary.machineCode).toBe("AOI-01");
    expect(res.summary.sample).toHaveLength(3);
    // nothing persisted
    expect(tableRows(aoiCommissioningRecords)).toHaveLength(0);
  });

  it("bad payload → ok:false with actionable hints (no throw)", async () => {
    const res = await admin.dryRun({ adapterKey: "generic-json", payload: "[1,2,3]" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/object/i);
    expect(res.hints.some((h) => h === "PAYLOAD_MUST_BE_OBJECT")).toBe(true);
    expect(res.hints.some((h) => h.startsWith("SEE_FEED_SPEC:"))).toBe(true);
  });

  it("unknown adapter → ok:false listing the registered adapters dynamically", async () => {
    const res = await admin.dryRun({ adapterKey: "no-such-vendor", payload: "{}" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.hints[0]).toMatch(/^AVAILABLE_ADAPTERS:.*generic-json/);
  });
});

describe("signOff (commissioning gate — SOFT, tag-only)", () => {
  it("rejects when no draft exists", async () => {
    await expect(admin.signOff({ machineId: 1 })).rejects.toThrow(/nháp|NOT_FOUND/i);
  });

  it("non-admin cannot sign without a passing dry-run (no override path)", async () => {
    await seedDraft(false);
    await expect(engineer.signOff({ machineId: 1 })).rejects.toThrow(/dry-run|PRECONDITION/i);
  });

  it("admin override requires a reason (≥5 chars)", async () => {
    await seedDraft(false);
    await expect(admin.signOff({ machineId: 1, overrideReason: "ok" })).rejects.toThrow(/lý do|BAD_REQUEST/i);
  });

  it("admin override with reason signs + writes sign_off_override audit", async () => {
    await seedDraft(false);
    const res = await admin.signOff({ machineId: 1, overrideReason: "golden sample pending, FAT on site OK" });
    expect(res.overridden).toBe(true);
    expect(res.record?.status).toBe("commissioned");
    const audits = tableRows(controlAuditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("sign_off_override");
    expect(audits[0].reason).toMatch(/golden sample/);
  });

  it("happy path: records who/when, writes audit, provisions hot-folder, flips status → production", async () => {
    await seedDraft(true);
    expect(await getAoiIngestMode(1)).toBe("commissioning"); // soft-tagged before sign-off
    invalidateAoiCommissioningCache(1);

    const res = await engineer.signOff({ machineId: 1, note: "FAT #123 passed" });
    expect(res.overridden).toBe(false);
    expect(res.ingestMode).toBe("production");
    expect(res.record?.status).toBe("commissioned");
    expect(res.record?.signedBy).toBe(8);
    expect(res.record?.signedAt).toBeTruthy();
    expect(res.record?.note).toBe("FAT #123 passed");

    // audit row (immutable ledger)
    const audits = tableRows(controlAuditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0].entityType).toBe("aoi_commissioning");
    expect(audits[0].entityId).toBe("1");
    expect(audits[0].action).toBe("sign_off");
    expect(audits[0].actorId).toBe(8);
    expect((audits[0].afterJson as any).status).toBe("commissioned");

    // hot-folder provisioned via W2-A's router bridge
    expect(res.provisioning.attempted).toBe(true);
    expect(res.provisioning.via).toBe("hotFolderRouter");
    expect(hfCreate).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 1, adapterKey: "generic-json", watchPath: "D:\\aoi\\export",
    }));

    // gate flipped (SOFT: only the tag changes — nothing is ever rejected)
    const status = await admin.status({ machineId: 1 });
    expect(status.commissioned).toBe(true);
    expect(status.ingestMode).toBe("production");
    expect(status.hasDraft).toBe(false);
  });

  it("updates (not duplicates) an existing hot-folder config for the machine", async () => {
    hfList.mockResolvedValue([{ id: 55, machineId: 1 }]);
    await seedDraft(true);
    await admin.signOff({ machineId: 1 });
    expect(hfUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 55 }));
    expect(hfCreate).not.toHaveBeenCalled();
  });
});

describe("decommission + fail-open lookup", () => {
  it("decommission flips the record + tags ingest again + audits", async () => {
    await seedDraft(true);
    await admin.signOff({ machineId: 1 });
    invalidateAoiCommissioningCache(1);

    const res = await admin.decommission({ machineId: 1, reason: "camera drift found" });
    expect(res.record.status).toBe("decommissioned");
    expect(res.ingestMode).toBe("commissioning");
    const audits = tableRows(controlAuditLog);
    expect(audits.map((a) => a.action)).toEqual(["sign_off", "decommission"]);

    const status = await admin.status({ machineId: 1 });
    expect(status.commissioned).toBe(false);
    expect(status.ingestMode).toBe("commissioning");
  });

  it("decommission without an active record → NOT_FOUND", async () => {
    await expect(admin.decommission({ machineId: 1, reason: "nothing there" })).rejects.toThrow(/không có|NOT_FOUND/i);
  });

  it("getAoiIngestMode FAILS OPEN to 'production' on DB errors (never throws)", async () => {
    invalidateAoiCommissioningCache();
    vi.mocked(getDb).mockRejectedValueOnce(new Error("db down"));
    await expect(getAoiIngestMode(1)).resolves.toBe("production");
  });
});
