/**
 * Task 2 (BG-87, docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §5-6)
 * — BA lỗ toàn vẹn/kích thước cửa ZIP, đo bằng HÀNH VI THẬT (tRPC caller thật,
 * ZIP thật ghi xuống `LOCAL_STORAGE_DIR`, SELECT lại DB thật qua vai `avi_app`):
 *
 *   Lỗ 1 — `sha256` nhận rồi vứt (presign/commit đều nhận, KHÔNG BAO GIỜ kiểm).
 *   Lỗ 2 — `sizeBytes` client tự khai, KHÔNG trần, KHÔNG đối chiếu byte thật.
 *   Lỗ 3 — fallback tên trần `zip.file(imagePath) || zip.file(fileName)` ở
 *          đường ĐỌC ảnh — hai đường tìm cho cùng một tệp.
 *
 * Bốn mệnh đề (task-2-brief.md):
 *   1. sha256 LỆCH ⇒ gói bị từ chối (không commit im lặng).
 *   2. sizeBytes VƯỢT TRẦN ⇒ từ chối TRƯỚC KHI TẢI (ở presign).
 *   3. sizeBytes KHAI SAI so với byte THẬT ⇒ từ chối.
 *   4. Ảnh NGOÀI images/ ⇒ không tìm thấy (không còn fallback), thông điệp lỗi
 *      nói rõ đường mong đợi.
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279). Test "positive control" (mệnh đề 3, luồng hợp lệ đầy đủ) tạo ĐÚNG MỘT
 * hàng `product_inspections` — ở lại VĨNH VIỄN, cùng quy ước các file test AOI
 * package khác trong thư mục này (xem `aoiPackageZipCuaNoiDoi.test.ts` đầu
 * file). `afterAll` chỉ dọn `measurement_results`/`package_activity_logs`/
 * `inspection_packages` (KHÔNG WORM).
 *
 * ⚠ Mệnh đề 2 KHÔNG cấp phát buffer 200MB thật — `sizeBytes` ở `presign` chỉ
 * là một SỐ trong payload JSON, không phải byte thật; test dùng thẳng
 * `tranByteGoiZip() + 1` (mặc định 200*1024*1024+1) — presign phải từ chối
 * NGAY từ tầng schema, KHÔNG có ZIP nào được dựng/tải cho ca này.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, tranByteGoiZip } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  productInspections,
  measurementResults,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG87-PKG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG87-PKG-${STAMP}`,
    name: "Task 2 (BG-87) — sha256/sizeBytes/fallback test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
    }
    if (packageDbIds.length > 0) {
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
    // KHÔNG delete `productInspections` — WORM, xem docblock đầu file.
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg87-pkg-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_BYTES;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Payload v2.0 (cây) TỐI THIỂU hợp lệ — một surface/position/capture/component. */
function mauMetaHopLe(opts: {
  serial: string;
  captureId: string;
  fileName: string;
  shaZip?: string;
  shaAnh?: string;
}): any {
  return {
    identity: {
      station: "BG87-ST", machine: "BG87-MC", line: "BG87-LN", plant: "BG87-PL",
      country: "VN", solutionName: "BG87-SOL", appVersion: "1.0.0",
    },
    productId: `BG87-PID-${STAMP}`,
    serialNumber: opts.serial,
    productModel: `BG87-PM-${STAMP}`,
    overallResult: "OK",
    ntf: false,
    summary: {
      surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
      positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
      captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
      components: { total: 1, pass: 1, ng: 0, ntf: 0 },
    },
    surfaces: [{
      name: "TOP", result: "OK", ntf: false,
      positions: [{
        positionId: "P01", result: "OK", ntf: false,
        captures: [{
          captureId: opts.captureId, result: "OK", ntf: false,
          components: [{ componentId: "C01", result: "OK", ntf: false }],
        }],
      }],
    }],
    images: [{
      captureId: opts.captureId,
      fileName: opts.fileName,
      ...(opts.shaAnh ? { sha256: opts.shaAnh } : {}),
    }],
  };
}

/** Dựng ZIP thật (meta.json cây hợp lệ + MỘT ảnh dưới `images/<fileName>`), trả về buffer + meta dùng để dựng lại chuỗi mong đợi. */
async function dungZipHopLe(opts: {
  serial: string;
  captureId: string;
  fileName: string;
  noiDungAnh: string;
  shaZipSai?: string; // nếu muốn TỰ ghi đè sha256 khai trong meta (không dùng ở đây — sha256 ZIP đi qua input.commit, không qua meta.json)
  shaAnhKhai?: string; // sha256 khai cho ẢNH trong images[] (tuỳ chọn)
}): Promise<{ zipBuffer: Buffer; shaAnhThuc: string }> {
  const zip = new JSZip();
  const noiDungAnhBuf = Buffer.from(opts.noiDungAnh);
  const shaAnhThuc = createHash("sha256").update(noiDungAnhBuf).digest("hex");
  const meta = mauMetaHopLe({
    serial: opts.serial,
    captureId: opts.captureId,
    fileName: opts.fileName,
    shaAnh: opts.shaAnhKhai,
  });
  zip.file("meta.json", JSON.stringify(meta));
  zip.file(`images/${opts.fileName}`, noiDungAnhBuf);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return { zipBuffer, shaAnhThuc };
}

async function ghiZipVaoStorage(storageKey: string, zipBuffer: Buffer): Promise<void> {
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);
}

function caller() {
  return aoiPackageRouter.createCaller({ user: null } as never);
}

async function layHang(pkgDbId: number) {
  const d = (await db.getDb())!;
  const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
  return row;
}

// ════════════════════════════════════════════════════════════════════════
// Mệnh đề 1 — sha256 LỆCH ⇒ từ chối (không commit im lặng).
// ════════════════════════════════════════════════════════════════════════
describe("BG-87 mệnh đề 1 — sha256 KIỂM THẬT", () => {
  it("sha256 CẤP-ZIP (input.sha256 tại commit) LỆCH ⇒ commit ném lỗi, status KHÔNG 'committed'", async () => {
    const packageId = `BG87-SHA-ZIP-LECH-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const { zipBuffer } = await dungZipHopLe({
      serial: `BG87-SN-SHAZIP-LECH-${STAMP}`,
      captureId: "BG87-CAP-01",
      fileName: "p1.jpg",
      noiDungAnh: "bg87-sha-zip-lech-image",
    });
    const c = caller();
    const presigned = await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    expect(presigned.success).toBe(true);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    let loi: unknown;
    try {
      await c.commit({ apiKey: API_KEY, packageId, sha256: "0".repeat(64) /* chắc chắn SAI */ });
    } catch (e) {
      loi = e;
    }
    expect(loi, "sha256 lệch PHẢI ném lỗi").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toContain("sha256");

    const sau = await layHang(row.id);
    expect(sau.status, "sha256 lệch ⇒ KHÔNG được commit im lặng").not.toBe("committed");
  });

  it("sha256 CẤP-ẢNH (images[].sha256 trong meta.json) LỆCH ⇒ commit ném lỗi, status KHÔNG 'committed'", async () => {
    const packageId = `BG87-SHA-ANH-LECH-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const { zipBuffer } = await dungZipHopLe({
      serial: `BG87-SN-SHAANH-LECH-${STAMP}`,
      captureId: "BG87-CAP-02",
      fileName: "p2.jpg",
      noiDungAnh: "bg87-sha-anh-lech-image",
      shaAnhKhai: "1".repeat(64), // chắc chắn SAI so với nội dung ảnh thật
    });
    const c = caller();
    const presigned = await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    expect(presigned.success).toBe(true);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    let loi: unknown;
    try {
      await c.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "images[].sha256 lệch PHẢI ném lỗi").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toContain("images[].sha256");

    const sau = await layHang(row.id);
    expect(sau.status).not.toBe("committed");
    // 0 hàng product_inspections cho serial này — từ chối xảy ra TRƯỚC ghi nghiệp vụ.
    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, `BG87-SN-SHAANH-LECH-${STAMP}`));
    expect(rows.length).toBe(0);
  });

  it("sha256 ĐÚNG (cấp-ZIP + cấp-ảnh, kể cả khai HOA — .NET Convert.ToHexString) ⇒ commit THÀNH CÔNG (đối chứng dương, không tự thoả)", async () => {
    const packageId = `BG87-SHA-DUNG-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const serial = `BG87-SN-SHADUNG-${STAMP}`;
    const noiDungAnhTruoc = "bg87-sha-dung-image";
    // Băm TRƯỚC khi dựng ZIP — helper `dungZipHopLe` cũng tự băm nội bộ và trả
    // lại CÙNG giá trị này qua `shaAnhThuc`; tính trước ở đây để có sha256
    // ĐÚNG cần khai vào `images[].sha256` NGAY từ lúc dựng meta.json (đối
    // xứng với cách một Agent thật tính sha256 ảnh TRƯỚC khi ghi meta.json).
    const shaAnhTruoc = createHash("sha256").update(Buffer.from(noiDungAnhTruoc)).digest("hex");
    const { zipBuffer, shaAnhThuc } = await dungZipHopLe({
      serial,
      captureId: "BG87-CAP-03",
      fileName: "p3.jpg",
      noiDungAnh: noiDungAnhTruoc,
      shaAnhKhai: shaAnhTruoc.toUpperCase(), // HOA có chủ đích — .NET mặc định trả hoa
    });
    expect(shaAnhThuc).toBe(shaAnhTruoc); // cầu chì: helper phải băm ĐÚNG nội dung đã truyền
    const shaZipThuc = createHash("sha256").update(zipBuffer).digest("hex");
    const c = caller();
    await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    const ket = await c.commit({ apiKey: API_KEY, packageId, sha256: shaZipThuc.toUpperCase() });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId?: number }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const sau = await layHang(row.id);
    expect(sau.status, "sha256 ĐÚNG (hoa hay thường) KHÔNG được bị từ chối nhầm").toBe("committed");
  });
});

// ════════════════════════════════════════════════════════════════════════
// Mệnh đề 2 — sizeBytes VƯỢT TRẦN ⇒ từ chối TRƯỚC KHI TẢI (ở presign).
// ════════════════════════════════════════════════════════════════════════
describe("BG-87 mệnh đề 2 — trần sizeBytes tại presign, TRƯỚC khi có byte ZIP nào", () => {
  it("sizeBytes = trần + 1 ⇒ presign ném lỗi NGAY, KHÔNG hàng inspection_packages nào được tạo", async () => {
    const packageId = `BG87-CAP-VUOT-${STAMP}`;
    const c = caller();
    let loi: unknown;
    try {
      await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: tranByteGoiZip() + 1 });
    } catch (e) {
      loi = e;
    }
    expect(loi, "sizeBytes vượt trần PHẢI bị presign từ chối").toBeTruthy();

    const d = (await db.getDb())!;
    const rows = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    expect(rows.length, "KHÔNG hàng nào được INSERT — từ chối xảy ra TRƯỚC ghi DB").toBe(0);
  });

  it("sizeBytes = ĐÚNG trần (biên) ⇒ presign THÀNH CÔNG (đối chứng dương — .max() không chặn nhầm biên hợp lệ)", async () => {
    const packageId = `BG87-CAP-BIEN-${STAMP}`;
    const c = caller();
    const res = await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: tranByteGoiZip() });
    expect(res.success).toBe(true);
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    expect(row).toBeTruthy();
    packageDbIds.push(row.id);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Mệnh đề 3 — sizeBytes KHAI SAI so với byte THẬT ⇒ từ chối.
// ════════════════════════════════════════════════════════════════════════
describe("BG-87 mệnh đề 3 — sizeBytes ĐỐI CHIẾU byte THẬT tại commit", () => {
  it("3a — input.sizeBytes khai LẠI ở commit LỆCH với byte ZIP thật ⇒ từ chối", async () => {
    const packageId = `BG87-SIZE-COMMIT-LECH-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const { zipBuffer } = await dungZipHopLe({
      serial: `BG87-SN-SIZECOMMIT-${STAMP}`,
      captureId: "BG87-CAP-04",
      fileName: "p4.jpg",
      noiDungAnh: "bg87-size-commit-lech-image",
    });
    const c = caller();
    await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    let loi: unknown;
    try {
      await c.commit({ apiKey: API_KEY, packageId, sizeBytes: zipBuffer.length + 999 });
    } catch (e) {
      loi = e;
    }
    expect(loi, "sizeBytes khai lại ở commit lệch với byte thật PHẢI bị từ chối").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toContain("sizeBytes");
    const sau = await layHang(row.id);
    expect(sau.status).not.toBe("committed");
  });

  it("3b — pkg.fileSizeBytes khai ở PRESIGN lệch với byte ZIP thật (KHÔNG khai lại ở commit) ⇒ từ chối", async () => {
    const packageId = `BG87-SIZE-PRESIGN-LECH-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const { zipBuffer } = await dungZipHopLe({
      serial: `BG87-SN-SIZEPRESIGN-${STAMP}`,
      captureId: "BG87-CAP-05",
      fileName: "p5.jpg",
      noiDungAnh: "bg87-size-presign-lech-image",
    });
    const c = caller();
    // Khai SAI ngay tại presign — cố ý khác byte thật sẽ ghi xuống storage.
    await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length + 500 });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    expect(row.fileSizeBytes, "presign phải lưu lời khai gốc").toBe(zipBuffer.length + 500);
    expect(row.status, "gói CHƯA qua tuyến upload thật ⇒ vẫn 'pending'").toBe("pending");
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    let loi: unknown;
    try {
      await c.commit({ apiKey: API_KEY, packageId }); // KHÔNG khai lại sizeBytes
    } catch (e) {
      loi = e;
    }
    expect(loi, "presign khai sai so với byte thật (status vẫn 'pending') PHẢI bị commit từ chối").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toContain("sizeBytes");
    const sau = await layHang(row.id);
    expect(sau.status).not.toBe("committed");
  });

  it("3c — trần cứng BACKSTOP trên byte ZIP THẬT (AOI_PACKAGE_ZIP_MAX_BYTES hạ thấp qua ENV, không cần buffer 200MB)", async () => {
    const packageId = `BG87-SIZE-CAP-BACKSTOP-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const { zipBuffer } = await dungZipHopLe({
      serial: `BG87-SN-CAPBACKSTOP-${STAMP}`,
      captureId: "BG87-CAP-06",
      fileName: "p6.jpg",
      noiDungAnh: "bg87-cap-backstop-image",
    });
    const c = caller();
    // Khai ĐÚNG byte thật ở presign (default 200MB cap vẫn áp — zipBuffer.length << 200MB) —
    // cô lập ca này CHỈ kiểm nhánh (1) trần cứng, không chạm nhánh (2) đối chiếu.
    await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    // Hạ trần XUỐNG DƯỚI kích thước ZIP thật (vài trăm byte) — commit() gọi
    // tranByteGoiZip() TƯƠI (per-request, không cache) nên thấy ENV mới ngay.
    process.env.AOI_PACKAGE_ZIP_MAX_BYTES = "50";
    expect(zipBuffer.length).toBeGreaterThan(50);

    let loi: unknown;
    try {
      await c.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "ZIP thật vượt trần (đã hạ qua ENV) PHẢI bị từ chối TRƯỚC khi parse meta.json").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toMatch(/vượt trần|too large|PAYLOAD_TOO_LARGE/i);
    const sau = await layHang(row.id);
    expect(sau.status).not.toBe("committed");
  });

  it("3d — sizeBytes khai ĐÚNG (presign + commit + byte thật đều khớp) ⇒ commit THÀNH CÔNG (đối chứng dương)", async () => {
    const packageId = `BG87-SIZE-DUNG-${STAMP}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const serial = `BG87-SN-SIZEDUNG-${STAMP}`;
    const { zipBuffer } = await dungZipHopLe({
      serial,
      captureId: "BG87-CAP-07",
      fileName: "p7.jpg",
      noiDungAnh: "bg87-size-dung-image",
    });
    const c = caller();
    await c.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipBuffer.length });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);
    await ghiZipVaoStorage(storageKey, zipBuffer);
    await d.update(inspectionPackages).set({ storageKey }).where(eq(inspectionPackages.id, row.id));

    const ket = await c.commit({ apiKey: API_KEY, packageId, sizeBytes: zipBuffer.length });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId?: number }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);
    const sau = await layHang(row.id);
    expect(sau.status, "sizeBytes khai ĐÚNG ở mọi bước KHÔNG được bị từ chối nhầm").toBe("committed");
  });
});

// ════════════════════════════════════════════════════════════════════════
// Mệnh đề 4 — ảnh NGOÀI images/ ⇒ KHÔNG tìm thấy (bỏ fallback tên trần),
// thông điệp lỗi nói rõ đường mong đợi.
// ════════════════════════════════════════════════════════════════════════
describe("BG-87 mệnh đề 4 — bỏ fallback tên trần ở đường ĐỌC ảnh (getImage)", () => {
  /** Chèn thẳng một hàng 'committed' trỏ tới ZIP tự dựng — KHÔNG đi qua commit()
   *  (bất biến 2 của commit() đòi images/<fileName> tồn tại, nên không thể tạo
   *  qua đường commit() thật một gói mà ảnh CHỈ nằm ở gốc — đây chính là bằng
   *  chứng bất biến 2 đã đóng lỗ này Ở CỬA GHI; mệnh đề 4 đo lỗ Ở CỬA ĐỌC, cho
   *  một gói ĐÃ committed từ trước theo hình dạng cũ/khác — cùng kỹ thuật
   *  `taoGoi()` của aoiPackageZipCuaNoiDoi.test.ts). */
  async function taoGoiDaCommitVoiZipTuyChinh(suffix: string, zipBuffer: Buffer): Promise<{ pkgDbId: number; packageId: string }> {
    const packageId = `BG87-FALLBACK-${STAMP}-${suffix}`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    await ghiZipVaoStorage(storageKey, zipBuffer);
    const d = (await db.getDb())!;
    const [pkg] = await d
      .insert(inspectionPackages)
      .values({ machineId, packageId, storageKey, status: "committed" })
      .returning({ id: inspectionPackages.id });
    packageDbIds.push(pkg.id);
    return { pkgDbId: pkg.id, packageId };
  }

  it("ảnh CHỈ nằm ở GỐC gói (không có images/<fileName>) ⇒ getImage 404, thông điệp nêu ĐÚNG đường mong đợi", async () => {
    const zip = new JSZip();
    zip.file("p8.jpg", Buffer.from("bg87-fallback-root-only-image")); // KHÔNG dưới images/
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const { packageId } = await taoGoiDaCommitVoiZipTuyChinh("root-only", zipBuffer);

    const c = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin", name: "BG87 Tester" } } as never);
    let loi: unknown;
    try {
      await c.getImage({ packageId, fileName: "p8.jpg" });
    } catch (e) {
      loi = e;
    }
    expect(loi, "ảnh chỉ ở gốc gói (không fallback nữa) PHẢI bị từ chối 'không tìm thấy'").toBeTruthy();
    const msg = String((loi as { message?: string })?.message);
    expect(msg, "thông điệp PHẢI nêu đường mong đợi images/<fileName>").toContain("images/p8.jpg");
  });

  it("ĐỐI CHỨNG DƯƠNG — ảnh đặt ĐÚNG dưới images/<fileName> vẫn ĐỌC ĐƯỢC bình thường (không tự thoả — happy path chưa gãy)", async () => {
    const zip = new JSZip();
    const noiDung = "bg87-fallback-correct-path-image";
    zip.file("images/p9.jpg", Buffer.from(noiDung));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const { packageId } = await taoGoiDaCommitVoiZipTuyChinh("correct-path", zipBuffer);

    const c = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin", name: "BG87 Tester" } } as never);
    const ket = await c.getImage({ packageId, fileName: "p9.jpg" });
    expect(ket.fileName).toBe("p9.jpg");
    expect(Buffer.from(ket.imageBase64, "base64").toString("utf-8")).toContain(noiDung);
  });
});
