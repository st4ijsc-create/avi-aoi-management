/**
 * Pha 1F Task 6 (review lượt 7, C-2 ⛔) — `startedAt`/`finishedAt` cửa ZIP còn
 * `.max(40)` SAU KHI `inspectionTime` (alias) đã được vá ở BG-91 (`6082df2f`).
 *
 * `startedAt` KHÔNG PHẢI một trường "vệ sinh" ngang hàng `inspectionTime` —
 * nó là TRƯỜNG GỐC THẬT:
 *   - `aoiPackageRouter.ts:1009-1013` đọc `metaData?.inspectionTime ??
 *     metaData?.startedAt` — `startedAt` là nguồn khi máy KHÔNG gửi `inspectionTime`.
 *   - Schema tự khai `inspectionTime` là "Alias for startedAt (submitInspection
 *     compat)" — nghĩa là `startedAt` mới là trường GỐC, `inspectionTime` mới
 *     là bí danh.
 *   - Mẫu máy THẬT (`D:\SOURCES\AOIData\aoipackage-meta-sample.json:17`) dùng
 *     ĐÚNG `startedAt`, KHÔNG hề khai `inspectionTime`.
 *
 * VÌ SAO LỌT HAI LẦN TRƯỚC — vòng 1 (BG-72) chỉ vá đường v1.x
 * (`submitInspectionCoreObject`); vòng 2 (BG-91) quét lại cửa ZIP nhưng với
 * tiêu chí "trường này có alias ở v1.x không?" — `startedAt` KHÔNG có alias
 * (v1.x không khai trường này) ⇒ tiêu chí đó CẤU TRÚC KHÔNG THỂ tìm ra nó.
 * File này đo LẠI đúng ba dòng bằng chứng của review (độ dài, `new Date()` có
 * parse được không, và hành vi THẬT của `metaJsonSchema.safeParse()`/commit
 * sống) — cùng khuôn `aoiPackageZipInspectionTimeDaiThat.test.ts` (Task 2).
 *
 * Sửa: `.max(40)` → `.max(64)` ở CẢ HAI `startedAt`/`finishedAt` — cùng con
 * số, cùng lý lẽ đã dùng cho `inspectionTime`.
 *
 * Bốn mệnh đề (đo LIVE, DB thật vai `avi_app`):
 *   1. Chuỗi 50/45 ký tự `DateTime.ToString()` ở CẢ `startedAt` VÀ
 *      `finishedAt` ⇒ được nhận ở cửa ZIP (`metaJsonSchema.safeParse`).
 *   2. Gói mang `startedAt` = chuỗi đó ⇒ commit THÀNH CÔNG ngay lượt đầu
 *      (`status='committed'`, KHÔNG hề chạm 'failed'/'dead') — bằng chứng
 *      MẠNH hơn "không tiến tới dead dù thử nhiều lượt": không cần thử lại.
 *      `product_inspections.inspectionTime` phải được ghi (nguồn = `startedAt`,
 *      vì gói KHÔNG khai `inspectionTime`).
 *   3. `machineDataContractV2.startedAt`/`completedAt` ⇒ được nhận (đối chứng
 *      schema thuần — phần DB-verify đầy đủ nằm ở
 *      `capChuoiThoiGianCensus.test.ts` §5 + `capChuoiVarcharCensus.test.ts` §2).
 *   4. CHỐNG HỒI QUY: chuỗi thật sự quá cỡ (>64, không phải ngày hợp lệ) vẫn
 *      bị từ chối VÀ vẫn tính vĩnh viễn — chạm 'dead' đúng ngưỡng, chốt chặn
 *      BG-64 còn nguyên tác dụng.
 *
 * Đột biến bắt buộc (xem report task-6): đặt lại `.max(40)` cho `startedAt`
 * ⇒ mệnh đề 1 ĐỎ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, metaJsonSchema } from "./aoiPackageRouter";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";
import * as db from "../db";
import { inspectionPackages, packageActivityLogs, productInspections } from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG91B-PKG-${STAMP}`;
const NGUONG = 3;

// Nguyên văn hai dòng bằng chứng từ review (giống machineApiThoiGianDaiThat.test.ts
// / aoiPackageZipInspectionTimeDaiThat.test.ts).
const CHUOI_50 = "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)";
const CHUOI_45 = "Sunday, August 30, 2026 12:00:00 PM GMT+07:00";

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG91B-PKG-${STAMP}`,
    name: "Pha 1F Task 6 (review lượt 7, C-2 ⛔) — startedAt/finishedAt ZIP",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && packageDbIds.length > 0) {
    await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
    await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
  }
  // KHÔNG delete productInspections — WORM (avi_app không có quyền DELETE trên
  // bảng này, migration 0279). `inspectionIds` chỉ giữ lại để SELECT xác nhận
  // (mệnh đề 2) — các hàng do file này tạo ở lại VĨNH VIỄN.
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg91b-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = String(NGUONG);
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** ZIP HỢP LỆ (meta.json + images/ khớp measurements[].fileName). */
async function ghiZipHopLeVaTaoGoi(suffix: string, meta: Record<string, unknown>): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG91B-PKG-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  const measurements = (meta.measurements as Array<{ fileName: string }>) ?? [];
  for (const m of measurements) {
    zip.file(`images/${m.fileName}`, Buffer.from(`fake-image-${m.fileName}`));
  }
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({ machineId, packageId, storageKey, status: "uploaded" })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return { packageId, pkgDbId: pkg.id };
}

describe("★★★ mệnh đề 1 — metaJsonSchema.safeParse: startedAt VÀ finishedAt khớp submitInspectionCoreObject/inspectionTime (đơn vị, không DB)", () => {
  it.each([
    ["50 ký tự", CHUOI_50],
    ["45 ký tự", CHUOI_45],
  ])("startedAt = chuỗi %s ĐƯỢC CHẤP NHẬN sau bản vá .max(64)", (_ten, chuoi) => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", startedAt: chuoi,
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it.each([
    ["50 ký tự", CHUOI_50],
    ["45 ký tự", CHUOI_45],
  ])("finishedAt = chuỗi %s ĐƯỢC CHẤP NHẬN sau bản vá .max(64)", (_ten, chuoi) => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", finishedAt: chuoi,
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("startedAt VÀ finishedAt CÙNG có mặt trên MỘT payload, cả hai 50 ký tự ⇒ ĐƯỢC CHẤP NHẬN", () => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", startedAt: CHUOI_50, finishedAt: CHUOI_50,
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("startedAt chuỗi 65 ký tự (quá .max(64) một ký tự) VẪN bị từ chối — không phải unbounded", () => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", startedAt: "x".repeat(65),
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("★★★ mệnh đề 2 — mẫu DateTime.ToString() 50 ký tự trên startedAt (đường ZIP THẬT SỰ đọc): commit THÀNH CÔNG ngay lượt đầu", () => {
  it("gói mang startedAt 50 ký tự, KHÔNG khai inspectionTime ⇒ commit success:true, status='committed' (KHÔNG hề chạm 'failed'/'dead')", async () => {
    const serial = `BG91B-SN-${STAMP}`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("ok", {
      serialNumber: serial,
      productModel: `BG91B-PM-${STAMP}`,
      overallResult: "OK",
      startedAt: CHUOI_50, // KHÔNG inspectionTime — mẫu ĐÚNG hình dạng máy thật (aoipackage-meta-sample.json:17)
      finishedAt: CHUOI_50,
      measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, "gói phải 'committed' NGAY lượt đầu — startedAt 50 ký tự không được phép chặn commit").toBe("committed");
    expect(pkgRow.errorMessage, "commit thành công ⇒ không có lỗi nào ghi lại").toBeNull();

    // SELECT product_inspections — vì gói KHÔNG khai inspectionTime, cột
    // inspectionTime PHẢI được suy từ startedAt (":1009" — inspectionTime ??
    // startedAt) — chuỗi DateTime.ToString() 50 ký tự phải parse ĐÚNG qua
    // new Date(...) và ghi xuống cột timestamp thật. Không so bằng-đúng-mili-giây
    // với `new Date(CHUOI_50)` — router dịch thêm getTimezoneOffset() (quy ước
    // lưu "giờ tường" đã có từ trước, ngoài phạm vi Task 6) — chỉ cần một Date
    // HỢP LỆ (không NaN), đúng NĂM/THÁNG/NGÀY của chuỗi gốc là đủ chứng minh
    // startedAt (không phải server-now-fallback) được dùng làm nguồn.
    expect(inspectionId, "phải tạo được inspection mới").toBeTruthy();
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    expect(inspRow.serialNumber).toBe(serial);
    expect(inspRow.inspectionTime, "product_inspections.inspectionTime phải được ghi (không NULL) — nguồn startedAt").toBeTruthy();
    expect(
      Number.isNaN(inspRow.inspectionTime!.getTime()),
      "phải là Date HỢP LỆ — chuỗi 50 ký tự không bị parse hỏng",
    ).toBe(false);
    expect(inspRow.inspectionTime!.getUTCFullYear(), "năm phải khớp chuỗi gốc (2026) — chứng minh nguồn là startedAt, không phải new Date() (server-now) fallback").toBe(2026);
  });
});

describe("★★★ mệnh đề 3 — machineDataContractV2.startedAt/completedAt ĐƯỢC CHẤP NHẬN (đối chứng schema thuần, cùng Agent/cùng định dạng)", () => {
  it("chuỗi 50 ký tự ở startedAt/completedAt gốc ⇒ safeParse thành công", () => {
    const mau = {
      identity: { station: "S", machine: "M", line: "L", plant: "P", country: "VN", solutionName: "SOL", appVersion: "1.0" },
      productId: "PID-1",
      serialNumber: "SN-1",
      overallResult: "OK",
      ntf: false,
      startedAt: CHUOI_50,
      completedAt: CHUOI_50,
      summary: {
        surfaces: { total: 0, pass: 0, ng: 0, ntf: 0 },
        positions: { total: 0, pass: 0, ng: 0, ntf: 0 },
        captures: { total: 0, pass: 0, ng: 0, ntf: 0 },
        components: { total: 0, pass: 0, ng: 0, ntf: 0 },
      },
      surfaces: [],
    };
    const r = machineDataContractV2.safeParse(mau);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe("★★★ mệnh đề 4 — CHỐNG HỒI QUY: chuỗi thật sự quá cỡ (>64, không phải ngày) vẫn từ chối VÀ vẫn tính vĩnh viễn", () => {
  it(`startedAt rác 100 ký tự (không phải ngày hợp lệ) lặp lại ${NGUONG} lượt ⇒ chạm 'dead' đúng ngưỡng — chốt chặn BG-64 KHÔNG bị vô hiệu hoá`, async () => {
    const rac = "x".repeat(100);
    const meta = {
      serialNumber: `BG91B-SN-${STAMP}-rac`,
      productModel: `BG91B-PM-${STAMP}`,
      overallResult: "OK",
      startedAt: rac,
      measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
    };
    const packageId = `BG91B-PKG-${STAMP}-rac`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
    const zip = new JSZip();
    zip.file("meta.json", JSON.stringify(meta));
    zip.file("images/p1.jpg", Buffer.from("bg91b-rac"));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, zipBuffer);

    const d = await db.getDb();
    const [pkg] = await d!
      .insert(inspectionPackages)
      .values({ machineId, packageId, storageKey, status: "uploaded" })
      .returning({ id: inspectionPackages.id });
    packageDbIds.push(pkg.id);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    let loiCuoi: any;
    for (let lan = 1; lan <= NGUONG; lan++) {
      try {
        await caller.commit({ apiKey: API_KEY, packageId });
      } catch (e) {
        loiCuoi = e;
      }
    }
    expect(loiCuoi).toBeTruthy();
    expect(String(loiCuoi.message)).toContain("HỎNG VĨNH VIỄN");
    const [row] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkg.id));
    expect(row.status, "chuỗi rác 100 ký tự vẫn LÀ payload quá cỡ thật — phải vẫn chạm 'dead' đúng ngưỡng").toBe("dead");
  });
});
