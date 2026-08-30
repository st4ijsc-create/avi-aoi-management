/**
 * Pha 1F Task 2 (BG-72 ⛔, lượt soát THỨ HAI) — bản vá BG-72 đầu tiên chỉ áp
 * cho MỘT trong HAI đường.
 *
 * `metaJsonSchema.inspectionTime` (`aoiPackageRouter.ts`, cửa ZIP) tự nhận là
 * "Alias for startedAt (submitInspection compat)" — nghĩa là cố ý khớp
 * `submitInspectionCoreObject.inspectionTime` (`machineApiRouters.ts`, đường
 * v1.x). Lượt vá BG-72 đầu tiên nới `.max(40)` → `.max(64)` ở v1.x nhưng BỎ
 * SÓT bản sao ở cửa ZIP, để nguyên `.max(40)`. Hậu quả — cùng payload
 * `DateTime.ToString()` 45-50 ký tự, hai đường hai số phận:
 *   - v1.x: được nhận (đúng sau bản vá đầu).
 *   - ZIP: `metaJsonSchema.parse()` ném `ZodError` (issue DUY NHẤT,
 *     `code:"too_big"`) — `laLoiVinhVienDemVaoNguongDeadZip` đếm VĨNH VIỄN
 *     (đúng — "too_big" LÀ payload quá cỡ thật, không phải lệch hình dạng
 *     kiểu BG-73) ⇒ gói chuyển `'dead'` sau `nguongLoiVinhVienZip()` lượt.
 * **Nặng hơn BG-73**: BG-73 để gói kẹt `'failed'` (retry được); ca này gói
 * CHẾT THẬT vì một trường timestamp không liên quan gì đến hình dạng
 * `measurements[]`.
 *
 * Sửa: `.max(40)` → `.max(64)` ở `metaJsonSchema.inspectionTime` — cùng con
 * số, cùng lý lẽ đã dùng cho v1.x (dư 14 ký tự trên mẫu dài nhất đo được, 50).
 *
 * Ba mệnh đề (đo LIVE, DB thật vai `avi_app`):
 *   1. Chuỗi 50/45 ký tự `DateTime.ToString()` ⇒ được nhận trên đường ZIP.
 *   2. Gói mang chuỗi đó ⇒ commit THÀNH CÔNG ngay lượt đầu (không hề chạm
 *      'failed', nói gì tới 'dead') — bằng chứng MẠNH hơn "không tiến tới
 *      dead dù thử nhiều lượt": nó còn chẳng cần thử lại.
 *   3. CHỐNG HỒI QUY: chuỗi thật sự quá cỡ (>64, KHÔNG phải ngày hợp lệ) vẫn
 *      bị từ chối VÀ vẫn tính vĩnh viễn — chạm 'dead' đúng ngưỡng, y hệt
 *      hành vi BG-64 dành cho payload quá cỡ thật.
 *
 * Đột biến bắt buộc (xem report): đặt lại `.max(40)` ⇒ mệnh đề 1 ĐỎ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, metaJsonSchema } from "./aoiPackageRouter";
import * as db from "../db";
import { inspectionPackages, packageActivityLogs, productInspections } from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG72ZIP-PKG-${STAMP}`;
const NGUONG = 3;

// Nguyên văn hai dòng bằng chứng từ review (giống machineApiThoiGianDaiThat.test.ts).
const CHUOI_50 = "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)";
const CHUOI_45 = "Sunday, August 30, 2026 12:00:00 PM GMT+07:00";

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG72ZIP-PKG-${STAMP}`,
    name: "Pha 1F Task 2 (BG-72 lượt 2) — inspectionTime alias ZIP",
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
  // (xem mệnh đề 1+2 ở trên) — các hàng do file này tạo ở lại VĨNH VIỄN.
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg72zip-${STAMP}-${Math.random().toString(36).slice(2)}`);
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
  const packageId = `BG72ZIP-PKG-${STAMP}-${suffix}`;
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

describe("metaJsonSchema.safeParse — inspectionTime alias khớp submitInspectionCoreObject (đơn vị, không DB)", () => {
  it.each([
    ["50 ký tự", CHUOI_50],
    ["45 ký tự", CHUOI_45],
  ])("chuỗi %s ĐƯỢC CHẤP NHẬN sau bản vá .max(64)", (_ten, chuoi) => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", inspectionTime: chuoi,
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("chuỗi 65 ký tự (quá .max(64) một ký tự) VẪN bị từ chối — không phải unbounded", () => {
    const r = metaJsonSchema.safeParse({
      serialNumber: "SN-X", productModel: "PM-X", inspectionTime: "x".repeat(65),
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("★★★ mệnh đề 1+2 — mẫu DateTime.ToString() 50 ký tự trên đường ZIP: commit THÀNH CÔNG ngay lượt đầu", () => {
  it("gói mang inspectionTime 50 ký tự ⇒ commit success:true, status='committed' (KHÔNG hề chạm 'failed'/'dead')", async () => {
    const serial = `BG72ZIP-SN-${STAMP}`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("ok", {
      serialNumber: serial,
      productModel: `BG72ZIP-PM-${STAMP}`,
      overallResult: "OK",
      inspectionTime: CHUOI_50,
      measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, "gói phải 'committed' NGAY lượt đầu — chuỗi 50 ký tự không được phép chặn commit").toBe("committed");
    expect(pkgRow.errorMessage, "commit thành công ⇒ không có lỗi nào ghi lại").toBeNull();

    // SELECT product_inspections — chuỗi DateTime.ToString() 50 ký tự phải
    // parse ĐÚNG qua new Date(...) và ghi xuống cột timestamp thật (không chỉ
    // "không bị Zod chặn" mà còn thật sự CÓ Ý NGHĨA khi tới DB). Không so
    // bằng-đúng-mili-giây với `new Date(CHUOI_50)` — router dịch thêm
    // `getTimezoneOffset()` (quy ước lưu "giờ tường" đã có từ trước, ngoài
    // phạm vi BG-72) — chỉ cần một Date HỢP LỆ (không NaN), đúng NĂM/THÁNG/NGÀY
    // của chuỗi gốc là đủ chứng minh chuỗi được parse, không bị âm thầm cắt cụt.
    expect(inspectionId, "phải tạo được inspection mới").toBeTruthy();
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    expect(inspRow.serialNumber).toBe(serial);
    expect(inspRow.inspectionTime, "product_inspections.inspectionTime phải được ghi (không NULL)").toBeTruthy();
    expect(
      Number.isNaN(inspRow.inspectionTime!.getTime()),
      "phải là Date HỢP LỆ — chuỗi 50 ký tự không bị parse hỏng",
    ).toBe(false);
    expect(inspRow.inspectionTime!.getUTCFullYear(), "năm phải khớp chuỗi gốc (2026)").toBe(2026);
  });
});

describe("★★★ mệnh đề 3 — CHỐNG HỒI QUY: chuỗi thật sự quá cỡ (>64, không phải ngày) vẫn từ chối VÀ vẫn tính vĩnh viễn", () => {
  it(`inspectionTime rác 100 ký tự (không phải ngày hợp lệ) lặp lại ${NGUONG} lượt ⇒ chạm 'dead' đúng ngưỡng — chốt chặn KHÔNG bị vô hiệu hoá`, async () => {
    const rac = "x".repeat(100);
    const meta = {
      serialNumber: `BG72ZIP-SN-${STAMP}-rac`,
      productModel: `BG72ZIP-PM-${STAMP}`,
      overallResult: "OK",
      inspectionTime: rac,
      measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
    };
    const packageId = `BG72ZIP-PKG-${STAMP}-rac`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
    const zip = new JSZip();
    zip.file("meta.json", JSON.stringify(meta));
    zip.file("images/p1.jpg", Buffer.from("bg72zip-rac"));
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
