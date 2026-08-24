/**
 * W7-A (doc 27 Đợt 7.1 — V1) — INLINE AI gate on the aoiPackage.commit ingest
 * path, against the isolated test DB with a REAL ZIP package on local storage.
 *
 * Proves: commit ACK is never delayed by AI; the post-hook lazily extracts the
 * NG measurement's image FROM THE ZIP, runs the quality gate and stamps the
 * verdict on the inspection commit created — same write shape as the
 * on-demand path. Flag OFF ⇒ commit behavior unchanged.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";

vi.mock("../services/aiInferenceEngine");
vi.mock("../services/ai/ntfPredictorService", () => ({
  scoreInspectionNtf: vi.fn(async () => undefined),
}));

import * as engine from "../services/aiInferenceEngine";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  productInspections,
  measurementResults,
  measurementPointDefs,
  inspectionPackages,
  packageImages,
  packageActivityLogs,
} from "../../drizzle/schema";
import { invalidateConfigCache, _resetInlineGateBreaker } from "../services/aiQualityGate";

const STAMP = Date.now();
const API_KEY = `W7A-PKG-${STAMP}`;
const PM_CODE = `W7A-PKG-PM-${STAMP}`;
const POINT_CODE = `W7A-PKG-P-${STAMP}`;
const IMAGE_MARKER = `w7a-zip-defect-image-${STAMP}`;

let machineId: number;
let productModelId: number;
let configId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

const OK_INFERENCE = {
  modelCode: "w7a-pkg-mock",
  modelVersion: "v1",
  predictions: [{ label: "ok", confidence: 0.98 }],
  topLabel: "ok",
  confidence: 0.98,
  processingTimeMs: 2,
  status: "COMPLETED" as const,
};

/** Build a package ZIP (meta.json + images/) on local storage; returns packageId. */
async function seedPackage(suffix: string): Promise<{ packageId: string; serial: string }> {
  const packageId = `W7A-PKG-${STAMP}-${suffix}`;
  const serial = `SN-W7A-PKG-${STAMP}-${suffix}`;
  const zip = new JSZip();
  zip.file(
    "meta.json",
    JSON.stringify({
      serialNumber: serial,
      productModel: PM_CODE,
      overallResult: "NG",
      inspectionTime: new Date().toISOString(),
      measurements: [
        { pointId: POINT_CODE, fileName: "p1.jpg", result: "NG", measuredValue: 1.23 },
      ],
      summary: { totalPoints: 1, ok: 0, ng: 1 },
    }),
  );
  zip.file("images/p1.jpg", Buffer.from(IMAGE_MARKER));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({ machineId, packageId, storageKey, status: "uploaded" })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return { packageId, serial };
}

beforeAll(async () => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `w7a-pkg-inline-${STAMP}`);

  machineId = await db.createMachine({
    stationId: 1,
    code: `W7A-PKG-${STAMP}`,
    name: "W7-A package inline-gate test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
  productModelId = await db.createProductModel({ code: PM_CODE, name: "W7-A pkg inline PM" });

  const d = await db.getDb();
  const [cfg] = await d!
    .insert(aiQualityGateConfigs)
    .values({
      name: `W7A pkg inline gate ${STAMP}`,
      machineId,
      productModelId: null,
      modelId: 990_101,
      enabled: true,
      autoOkThreshold: "0.9",
      autoNgThreshold: "0.8",
      reviewThreshold: "0.5",
      ngLabels: ["defect"],
      okLabels: ["ok"],
    })
    .returning({ id: aiQualityGateConfigs.id });
  configId = cfg.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      await d.delete(aiQualityGateResults).where(inArray(aiQualityGateResults.inspectionId, inspectionIds));
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    if (packageDbIds.length > 0) {
      await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
    if (configId) await d.delete(aiQualityGateConfigs).where(eq(aiQualityGateConfigs.id, configId));
    await d.delete(measurementPointDefs).where(eq(measurementPointDefs.code, POINT_CODE));
  }
  if (productModelId) await db.deleteProductModel(productModelId).catch(() => undefined);
  if (machineId) await db.deleteMachine(machineId);
  invalidateConfigCache();
  delete process.env.AI_INLINE_GATE_ENABLED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

beforeEach(() => {
  vi.clearAllMocks();
  _resetInlineGateBreaker();
  invalidateConfigCache();
  process.env.AI_INLINE_GATE_ENABLED = "true";
  // ★★★ Task 10 (2026-08-24) — `commit` nay đi qua `authenticateMachine` thay vì
  // `db.getMachineByApiKey` thẳng. Máy seed ở đây dùng `apiKey` LEGACY (đường
  // shared-key), và mặc định `MACHINE_SHARED_KEY_ALLOWED` đã đổi thành `deny` từ
  // mig 0334 (2026-08-22) — thiếu dòng này thì mọi lượt `commit` bị TỪ CHỐI
  // đúng như thiết kế, chỉ là sai chỗ (test này canh cổng AI gate, không canh
  // cổng auth). Cùng quy ước với machineApiProcessResult.test.ts:189.
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  (engine.runInference as any).mockResolvedValue(OK_INFERENCE);
});

afterEach(() => {
  delete process.env.AI_INLINE_GATE_ENABLED;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
});

describe("aoiPackage.commit × inline AI gate (V1)", () => {
  it("commit ACK is not delayed; hook extracts the NG image FROM THE ZIP and stamps the verdict", async () => {
    let releaseGate!: () => void;
    let gateResolved = false;
    (engine.runInference as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGate = () => {
            gateResolved = true;
            resolve(OK_INFERENCE);
          };
        }),
    );

    const { packageId } = await seedPackage("a");
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const r = await caller.commit({ apiKey: API_KEY, packageId });
    expect(r.success).toBe(true);
    expect(r.inspectionId).toBeTruthy();
    inspectionIds.push(r.inspectionId!);

    // Commit ACK returned while the AI inference is still pending.
    expect(gateResolved).toBe(false);

    await vi.waitFor(() => expect(engine.runInference).toHaveBeenCalled(), { timeout: 10_000 });
    // The gate received the ACTUAL bytes from the ZIP's images/p1.jpg entry.
    const imageArg = (engine.runInference as any).mock.calls[0][1] as Buffer;
    expect(Buffer.isBuffer(imageArg)).toBe(true);
    expect(imageArg.toString()).toContain(IMAGE_MARKER);

    releaseGate();
    await vi.waitFor(
      async () => {
        const row = await db.getProductInspectionById(r.inspectionId!);
        expect(row?.aiDecision).toBe("AUTO_OK");
      },
      { timeout: 15_000, interval: 100 },
    );

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(Number(row!.aiConfidence)).toBeCloseTo(0.98, 3);
    expect(row!.aiModelId).toBe(990_101);
    expect(row!.aiProcessedAt).toBeTruthy();

    const d = await db.getDb();
    const qg = await d!
      .select()
      .from(aiQualityGateResults)
      .where(eq(aiQualityGateResults.inspectionId, r.inspectionId!));
    expect(qg).toHaveLength(1);
    expect(qg[0].decision).toBe("AUTO_OK");
  });

  it("flag OFF ⇒ commit unchanged, no inference, no AI fields", async () => {
    delete process.env.AI_INLINE_GATE_ENABLED;

    const { packageId } = await seedPackage("b");
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const r = await caller.commit({ apiKey: API_KEY, packageId });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(engine.runInference).not.toHaveBeenCalled();
    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.aiDecision ?? null).toBeNull();
  });
});
