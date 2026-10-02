/**
 * server/routers/aoiPackageTimeOffset.dot1d.test.ts
 *
 * ★★★ doc 81 Đợt 1D Task 4 (ruling R-1D-j) — cửa ZIP (`aoiPackage.commit`): `completedAt`/`startedAt`
 * của `meta.json` (cấp bo VÀ cấp lá position/capture/component) theo cờ RIÊNG
 * `INGEST_REQUIRE_PACKAGE_TIME_OFFSET` (MẶC ĐỊNH TẮT). Cờ BẬT ⇒ CÙNG luật và CÙNG lỗi có mã với đường
 * trực tiếp v2.0 và `inspectionTime`: BAD_REQUEST · INVALID_VALUE {field: completedAt|startedAt,
 * reason: "timeOffsetRequired"} · câu chữ chứa `time_offset_required`. Cờ TẮT (mặc định / `false`)
 * ⇒ hành vi cũ: chuỗi trần đọc là UTC.
 *
 * Mệnh đề "0 hàng": từ chối xảy ra ở `metaJsonSchema.parse(metaRaw)` — TRƯỚC mọi lượt ghi cây/
 * bo/ảnh/trạng thái committed. Hàng `inspection_packages` của gói đã có TỪ BƯỚC PRESIGN (thiết kế
 * vòng Agent — không phải do commit), nên "0 hàng" được đo là: 0 hàng `inspection_packages` ở
 * trạng thái `committed` cho packageId đó (hàng presign ở lại `failed`, không `inspectionId`,
 * không `metaJson`), và 0 hàng `product_inspections` theo khoá idempotency `aoi-pkg:<packageId>`
 * LẪN theo serial duy nhất của gói.
 *
 * ⚠ WORM — `product_inspections` bị REVOKE DELETE (migration 0279): các ca đối chứng dương để lại
 * hàng bo vĩnh viễn; không viết DELETE FROM product_inspections ở đây. Cây + gói + máy được dọn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import { readAppErrorMeta } from "../_core/appError";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";

const DB_URL = process.env.DATABASE_URL;
const STAMP = `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `D1DT4-${STAMP}`;
const CO = "INGEST_REQUIRE_PACKAGE_TIME_OFFSET";
const ISO_FMT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

let sql: ReturnType<typeof postgres>;
let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  machineId = await db.createMachine({
    stationId: 1,
    code: `D1DT4-${STAMP}`,
    name: "Đợt 1D T4 — ZIP completedAt/startedAt theo INGEST_REQUIRE_PACKAGE_TIME_OFFSET",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(inspectionCaptures).where(inArray(inspectionCaptures.inspectionId, inspectionIds));
      await d.delete(inspectionPositions).where(inArray(inspectionPositions.inspectionId, inspectionIds));
      await d.delete(inspectionSurfaces).where(inArray(inspectionSurfaces.inspectionId, inspectionIds));
    }
    if (packageDbIds.length > 0) {
      await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
  }
  if (machineId) await db.deleteMachine(machineId);
  if (sql) await sql.end({ timeout: 5 });
});

let coTruoc: string | undefined;
beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `d1dt4-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  coTruoc = process.env[CO];
  delete process.env[CO]; // MẶC ĐỊNH (env VẮNG = TẮT) trừ khi ca tự đặt
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  if (coTruoc === undefined) delete process.env[CO];
  else process.env[CO] = coTruoc;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** meta.json cây v2.0 tối thiểu — mọi mốc mang "Z" (ca nào cần trần tự ghi đè). */
function metaCay(tag: string): Record<string, any> {
  const n = { total: 1, pass: 1, ng: 0, ntf: 0 };
  const captureId = `D1DT4-CAP-${STAMP}-${tag}`;
  return {
    identity: {
      station: "D1DT4-ST", machine: "D1DT4-MC", line: "D1DT4-LN", plant: "D1DT4-PL",
      country: "VN", solutionName: "D1DT4-SOL", appVersion: "1.0.0",
    },
    productId: `D1DT4-PID-${STAMP}-${tag}`,
    serialNumber: `D1DT4-SN-${STAMP}-${tag}`,
    overallResult: "OK",
    ntf: false,
    startedAt: "2026-09-03T01:59:00.000Z",
    completedAt: "2026-09-03T02:00:00.000Z",
    summary: { surfaces: n, positions: n, captures: n, components: n },
    images: [{ captureId, fileName: "p1.jpg" }],
    surfaces: [{
      name: "TOP", result: "OK", ntf: false,
      positions: [{
        positionId: "P01", result: "OK", ntf: false,
        captures: [{
          captureId, result: "OK", ntf: false, startedAt: "2026-09-03T01:59:00.000Z",
          components: [{ componentId: `D1DT4-COMP-${STAMP}-${tag}`, result: "OK", ntf: false }],
        }],
      }],
    }],
  };
}

/** presign THẬT → ghi ZIP xuống local storage đúng `storageKey` → gói ở lại 'pending'. */
async function presignRoiGhiZip(tag: string, meta: Record<string, unknown>): Promise<{ packageId: string; pkgDbId: number }> {
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  zip.file("images/p1.jpg", Buffer.from(`d1dt4-anh-${STAMP}-${tag}`));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const packageId = `D1DT4-${STAMP}-${tag}`;
  const caller = aoiPackageRouter.createCaller({ user: null } as never);
  const res = await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
  const storageKey = (res as { objectKey?: string }).objectKey!;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);
  const d = (await db.getDb())!;
  const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
  packageDbIds.push(row.id);
  return { packageId, pkgDbId: row.id };
}

async function commitLoi(packageId: string): Promise<unknown> {
  const caller = aoiPackageRouter.createCaller({ user: null } as never);
  return caller.commit({ apiKey: API_KEY, packageId }).then(
    () => null,
    (e: unknown) => e,
  );
}

/** Bất biến "0 hàng" của một gói bị từ chối (xem docblock đầu file). */
async function khangDinhKhongGhiGi(packageId: string, pkgDbId: number, serial: string): Promise<void> {
  const [{ n: nCommitted }] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM inspection_packages WHERE "packageId" = ${packageId} AND status = 'committed'`;
  expect(Number(nCommitted), "0 hàng inspection_packages 'committed' cho gói bị từ chối").toBe(0);
  const [{ n: nKhoa }] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM product_inspections WHERE "idempotencyKey" = ${"aoi-pkg:" + packageId}`;
  expect(Number(nKhoa), "0 hàng product_inspections theo khoá idempotency của gói").toBe(0);
  const [{ n: nSerial }] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM product_inspections WHERE "serialNumber" = ${serial}`;
  expect(Number(nSerial), "0 hàng product_inspections theo serial duy nhất của gói").toBe(0);
  const d = (await db.getDb())!;
  const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
  expect(row.inspectionId, "không bo nào được nối").toBeNull();
  expect(row.metaJson, "meta.json bị từ chối không được lưu lên hàng gói").toBeNull();
  const anh = await d.select().from(packageImages).where(eq(packageImages.packageId, pkgDbId));
  expect(anh.length, "0 hàng package_images").toBe(0);
}

describe.skipIf(!DB_URL)("★★★ Đợt 1D Task 4 — cửa ZIP: completedAt/startedAt theo INGEST_REQUIRE_PACKAGE_TIME_OFFSET", () => {
  it("cờ BẬT: metaData.completedAt TRẦN ⇒ BAD_REQUEST INVALID_VALUE {field: completedAt}; 0 hàng committed/product_inspections", async () => {
    process.env[CO] = "true";
    const meta = metaCay("Z1");
    meta.completedAt = "2026-09-03T02:00:00.000";
    const { packageId, pkgDbId } = await presignRoiGhiZip("Z1", meta);
    const err = await commitLoi(packageId);
    expect(err, "chuỗi trần phải bị TỪ CHỐI khi cờ gói BẬT").toBeTruthy();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "completedAt", reason: "timeOffsetRequired" },
    });
    expect(String((err as Error).message)).toContain("time_offset_required");
    await khangDinhKhongGhiGi(packageId, pkgDbId, meta.serialNumber);
  });

  it("cờ BẬT: capture.startedAt cấp LÁ TRẦN (bo mang Z) ⇒ từ chối, field startedAt; 0 hàng", async () => {
    process.env[CO] = "true";
    const meta = metaCay("Z2");
    meta.surfaces[0].positions[0].captures[0].startedAt = "2026-09-03T01:59:00.000";
    const { packageId, pkgDbId } = await presignRoiGhiZip("Z2", meta);
    const err = await commitLoi(packageId);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "startedAt", reason: "timeOffsetRequired" },
    });
    await khangDinhKhongGhiGi(packageId, pkgDbId, meta.serialNumber);
  });

  it("cờ BẬT: gói bị từ chối vì thiếu múi giờ ở lại 'failed' (KHÔNG 'dead') — sửa máy/tắt cờ rồi commit lại được", async () => {
    process.env[CO] = "true";
    const meta = metaCay("Z5");
    meta.completedAt = "2026-09-03T02:00:00.000";
    const { packageId, pkgDbId } = await presignRoiGhiZip("Z5", meta);
    await commitLoi(packageId);
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).toBe("failed");
    expect(String(row.errorMessage)).toContain("time_offset_required");
  });

  it("ĐỐI CHỨNG DƯƠNG — cờ BẬT: mốc '+07:00' ⇒ commit thành công, inspection_packages.inspectionTime = ĐÚNG instant 02:00Z", async () => {
    process.env[CO] = "true";
    const meta = metaCay("Z3");
    meta.completedAt = "2026-09-03T09:00:00.000+07:00";
    meta.surfaces[0].positions[0].captures[0].startedAt = "Thu Sep 03 2026 08:59:00 GMT+0700 (Indochina Time)";
    const { packageId, pkgDbId } = await presignRoiGhiZip("Z3", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const idBo = (ket as { inspectionId?: number }).inspectionId;
    expect(idBo, "commit thành công ⇒ có bo được ghi").toBeTruthy();
    inspectionIds.push(idBo!);
    const [r] = await sql<{ iso: string; st: string }[]>`
      SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso, status AS st FROM inspection_packages WHERE id = ${pkgDbId}`;
    expect(r.st).toBe("committed");
    expect(r.iso).toBe("2026-09-03T02:00:00.000Z");
    const [b] = await sql<{ iso: string }[]>`
      SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso FROM product_inspections WHERE id = ${idBo!}`;
    expect(b.iso).toBe("2026-09-03T02:00:00.000Z");
  });

  for (const [nhan, gia] of [["MẶC ĐỊNH (env VẮNG)", undefined], ["cờ =false TƯỜNG MINH", "false"]] as const) {
    it(`${nhan}: hình dạng MẪU MÁY THẬT — completedAt/startedAt TRẦN ở bo VÀ lá ⇒ NHẬN như cũ, đọc là UTC`, async () => {
      if (gia !== undefined) process.env[CO] = gia;
      const tag = gia === undefined ? "Z4" : "Z6";
      const meta = metaCay(tag);
      meta.startedAt = "2026-09-03T01:59:00.000";
      meta.completedAt = "2026-09-03T02:00:00.000";
      const pos = meta.surfaces[0].positions[0];
      pos.startedAt = "2026-09-03T01:59:00.000";
      pos.completedAt = "2026-09-03T01:59:59.000";
      pos.captures[0].startedAt = "2026-09-03T01:59:00.000";
      pos.captures[0].completedAt = "2026-09-03T01:59:30.000";
      pos.captures[0].components[0].startedAt = "2026-09-03T01:59:00.000";
      pos.captures[0].components[0].completedAt = "2026-09-03T01:59:30.000";
      const { packageId, pkgDbId } = await presignRoiGhiZip(tag, meta);
      const caller = aoiPackageRouter.createCaller({ user: null } as never);
      const ket = await caller.commit({ apiKey: API_KEY, packageId });
      expect(ket.success).toBe(true);
      const idBo = (ket as { inspectionId?: number }).inspectionId;
      expect(idBo).toBeTruthy();
      inspectionIds.push(idBo!);
      const [r] = await sql<{ iso: string }[]>`
        SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso FROM inspection_packages WHERE id = ${pkgDbId}`;
      expect(r.iso).toBe("2026-09-03T02:00:00.000Z");
    });
  }
});
