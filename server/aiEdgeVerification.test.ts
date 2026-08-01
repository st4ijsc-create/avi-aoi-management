/**
 * W7-D (doc 27 gap V19) — edge deployment verification tests.
 *
 * Covers:
 *  - packageModelForEdge (aiEdgeDeployment): FAIL LOUD + actionable message when
 *    the artifact is missing on disk / has no storage key / checksum-mismatches
 *    the version's recorded fileHash; success embeds artifactHash in the meta.
 *  - packageModelForDeployment (aiEdgeEnhanced): same pre-package gates.
 *  - confirmDeployment: hash match stamps deployConfig.deployVerifiedAt +
 *    verifiedHash (delivery verification record); mismatch does NOT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

vi.mock("../server/db/aiAdvanced");
vi.mock("../server/db/ai");
vi.mock("../server/db/hierarchy");
vi.mock("../server/db/connection");
vi.mock("../server/storage");
// fs: pass-through mock (the ESM namespace of the builtin is frozen, so spyOn
// cannot redefine existsSync — provide controllable fns that default to real).
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mocked = {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    promises: { ...actual.promises, readFile: vi.fn(actual.promises.readFile) },
  };
  return { ...mocked, default: mocked };
});

import fsMocked from "fs";
import * as aiAdvancedDb from "../server/db/aiAdvanced";
import * as storage from "../server/storage";
import { packageModelForEdge } from "../server/services/aiEdgeDeployment";
import { packageModelForDeployment, confirmDeployment } from "../server/services/aiEdgeEnhanced";

const MODEL_BYTES = Buffer.from("REAL-MODEL-BYTES-abcdef-0123456789");
const MODEL_SHA = crypto.createHash("sha256").update(MODEL_BYTES).digest("hex");

const DEPLOYMENT = {
  id: 7,
  modelId: 10,
  modelVersion: "v2",
  deviceId: "AOI-01",
  machineId: 3,
  status: "PENDING",
  deployConfig: { quantization: "fp32" },
  offlineResultsPending: 0,
  packageHash: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("packageModelForEdge — pre-package artifact verification (V19)", () => {
  function mockDeploymentAndUpdates() {
    const updates: Array<Record<string, unknown>> = [];
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({ ...DEPLOYMENT });
    (aiAdvancedDb.updateEdgeDeployment as any).mockImplementation(async (_id: number, data: any) => {
      updates.push(data);
      return { ...DEPLOYMENT, ...data };
    });
    return updates;
  }

  it("fails LOUD with an actionable message when the version has NO storage key", async () => {
    const updates = mockDeploymentAndUpdates();
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", // no fileKey/storageKey/filePath
    });

    await expect(packageModelForEdge(7)).rejects.toThrow(/NO storage key.*never uploaded.*Re-upload/is);
    // deployment ends FAILED with the actionable message persisted
    const failed = updates.find((u) => u.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(String(failed!.errorMessage)).toContain("Re-upload");
  });

  it("fails LOUD when the artifact file is missing on disk", async () => {
    const updates = mockDeploymentAndUpdates();
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", fileKey: "models/10/v2.onnx",
    });
    (storage.storageGet as any).mockResolvedValue({ url: "/uploads/models/10/v2.onnx" });
    (fsMocked.existsSync as any).mockReturnValue(false);

    await expect(packageModelForEdge(7)).rejects.toThrow(/MISSING on disk.*re-upload the model version/is);
    const failed = updates.find((u) => u.status === "FAILED");
    expect(String(failed!.errorMessage)).toMatch(/MISSING on disk/);
  });

  it("fails LOUD on checksum mismatch against model_versions.fileHash", async () => {
    mockDeploymentAndUpdates();
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", fileKey: "models/10/v2.onnx",
      fileHash: "deadbeef".repeat(8), // ≠ sha256(MODEL_BYTES)
    });
    (storage.storageGet as any).mockResolvedValue({ url: "/uploads/models/10/v2.onnx" });
    (fsMocked.existsSync as any).mockReturnValue(true);
    (fsMocked.promises.readFile as any).mockResolvedValue(MODEL_BYTES);

    await expect(packageModelForEdge(7)).rejects.toThrow(/CHECKSUM MISMATCH/);
  });

  it("packages successfully when the artifact exists and matches its recorded hash", async () => {
    const updates = mockDeploymentAndUpdates();
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", fileKey: "models/10/v2.onnx",
      fileHash: MODEL_SHA, labels: ["ok", "ng"],
    });
    (storage.storageGet as any).mockResolvedValue({ url: "/uploads/models/10/v2.onnx" });
    (storage.storagePut as any).mockResolvedValue({ url: "/uploads/edge-packages/x.bin" });
    (fsMocked.existsSync as any).mockReturnValue(true);
    (fsMocked.promises.readFile as any).mockResolvedValue(MODEL_BYTES);

    const r = await packageModelForEdge(7);
    expect(r.packageHash).toMatch(/^[0-9a-f]{64}$/);
    const ready = updates.find((u) => u.status === "READY");
    expect(ready).toBeTruthy();

    // artifactHash embedded in package meta (first storagePut arg is the buffer)
    const putBuffer: Buffer = (storage.storagePut as any).mock.calls[0][1];
    const metaLen = putBuffer.readUInt32LE(0);
    const meta = JSON.parse(putBuffer.subarray(4, 4 + metaLen).toString());
    expect(meta.artifactHash).toBe(MODEL_SHA);
  });
});

describe("packageModelForDeployment (WS-2 path) — pre-package gates (V19)", () => {
  it("wraps a missing artifact in an actionable error (not a raw ENOENT)", async () => {
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({ ...DEPLOYMENT });
    (aiAdvancedDb.updateEdgeDeployment as any).mockResolvedValue({});
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", fileKey: "models/10/v2.onnx",
    });
    (storage.storageGet as any).mockResolvedValue({ url: "/uploads/models/10/v2.onnx" });
    (fsMocked.promises.readFile as any).mockRejectedValue(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }));

    await expect(packageModelForDeployment(7)).rejects.toThrow(/MISSING\/unreadable.*re-upload/is);
  });

  it("rejects a corrupt artifact whose bytes mismatch model_versions.fileHash", async () => {
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({ ...DEPLOYMENT });
    (aiAdvancedDb.updateEdgeDeployment as any).mockResolvedValue({});
    (aiAdvancedDb.getModelVersionForDeployment as any).mockResolvedValue({
      id: 100, modelId: 10, version: "v2", fileKey: "models/10/v2.onnx",
      fileHash: "deadbeef".repeat(8),
    });
    (storage.storageGet as any).mockResolvedValue({ url: "/uploads/models/10/v2.onnx" });
    (fsMocked.promises.readFile as any).mockResolvedValue(MODEL_BYTES);

    await expect(packageModelForDeployment(7)).rejects.toThrow(/CHECKSUM MISMATCH/);
  });
});

describe("confirmDeployment — delivery verification record (V19)", () => {
  it("stamps deployConfig.deployVerifiedAt + verifiedHash on hash match", async () => {
    const updates: Array<Record<string, unknown>> = [];
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      ...DEPLOYMENT, status: "DOWNLOADING", packageHash: MODEL_SHA,
    });
    (aiAdvancedDb.updateEdgeDeployment as any).mockImplementation(async (_id: number, data: any) => {
      updates.push(data);
      return data;
    });

    const r = await confirmDeployment(7, MODEL_SHA.toUpperCase()); // case-insensitive
    expect(r).toEqual({ deploymentId: 7, status: "DEPLOYED", matched: true });

    const u = updates[0] as any;
    expect(u.status).toBe("DEPLOYED");
    expect(u.deployedAt).toBeInstanceOf(Date);
    expect(u.deployConfig.deployVerifiedAt).toBeTruthy();
    expect(new Date(u.deployConfig.deployVerifiedAt).getTime()).toBeGreaterThan(0);
    expect(u.deployConfig.verifiedHash).toBe(MODEL_SHA);
    expect(u.deployConfig.quantization).toBe("fp32"); // existing config preserved
  });

  it("does NOT stamp verification on mismatch — deployment FAILED", async () => {
    const updates: Array<Record<string, unknown>> = [];
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      ...DEPLOYMENT, status: "DOWNLOADING", packageHash: MODEL_SHA,
    });
    (aiAdvancedDb.updateEdgeDeployment as any).mockImplementation(async (_id: number, data: any) => {
      updates.push(data);
      return data;
    });

    const r = await confirmDeployment(7, "0".repeat(64));
    expect(r.matched).toBe(false);
    const u = updates[0] as any;
    expect(u.status).toBe("FAILED");
    expect(u.deployConfig).toBeUndefined(); // no verification stamp
    expect(String(u.errorMessage)).toContain("hash mismatch");
  });
});
