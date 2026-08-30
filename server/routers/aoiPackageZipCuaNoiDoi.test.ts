/**
 * Pha 1E Task 2 (BG-65 + BG-68 ⛔) — "cửa ZIP nói dối ở hai chỗ".
 *
 * ── BG-68 (NẶNG NHẤT CẢ PHA) — header overallResult cuộn từ LỜI KHAI, không từ
 * DỮ LIỆU ─────────────────────────────────────────────────────────────────────
 * TRƯỚC bản vá: `inferAoiOverallResult({ngCount, ntfCount})` được gọi với
 * `ngCount = metaData.summary?.ng` (đường board-mới) hoặc `calculatedSummary.ng`
 * — mà `calculatedSummary` LẠI ưu tiên `metaData.summary` khi máy CÓ gửi nó
 * (`aoiPackageRouter.ts`, biểu thức `metaData?.summary || {đếm thật}`). `summary`
 * là LỜI KHAI THỨ HAI của CHÍNH máy, trong CÙNG tệp `meta.json`, trong CÙNG ZIP —
 * không phải dữ liệu độc lập. `verdictXauHon(khai, khai)` chỉ bắt được máy TỰ MÂU
 * THUẪN — máy khai NHẤT QUÁN SAI (`overallResult:"OK"` + `summary.ng:0` +
 * `measurements[]` có `result:"NG"`) đi lọt HOÀN TOÀN. Đúng lỗ mà `614245c0` vừa
 * đóng cho đường v1.x (`machineApiRouters.ts`, cuộn từ `measurementResults` THẬT
 * qua `rollupVerdict`) — vẫn mở nguyên ở cửa ZIP TRƯỚC bản vá này.
 * SAU bản vá: cả hai nơi suy overallResult (header board-mới VÀ
 * `finalOverallResult`/package row) đọc `ngNtfThat` — đếm THẬT từ
 * `measurements[].result` (tính MỘT LẦN, xem `aoiPackageRouter.ts` ngay sau khai
 * báo `normalizedMeasurements`) — KHÔNG còn đọc `metaData.summary` để quyết định
 * verdict.
 *
 * ── BG-65 — trạng thái CUỐI 'dead' KHÔNG cuối ───────────────────────────────
 * TRƯỚC bản vá: tuyến PUT `/api/aoi/upload/:packageId` (`server/_core/index.ts`)
 * chỉ ngắn mạch `status==='committed'` rồi GHI ĐÈ `status→'uploaded'` cho MỌI
 * gói khác — kể cả `'dead'` (trạng thái CUỐI, migration 0344, Pha 1D Task
 * 5/BG-52). Vòng Agent chuẩn `presign → upload → commit` chỉ cần LẶP LẠI là đủ
 * đưa một gói `'dead'` TRỞ VỀ `'uploaded'`, xoá tác dụng của cổng
 * `if (status === "dead")` ở `commit` — cổng đó không bao giờ còn thấy
 * `status='dead'` nữa lúc Agent gọi lại.
 * SAU bản vá: MỘT hàm thuần `laGoiDaChet(status)` (export từ
 * `aoiPackageRouter.ts`) là nguồn sự thật CHUNG cho cả ba cửa — `presign`/
 * `commit` gọi trực tiếp, tuyến upload gọi qua `await import("../routers/
 * aoiPackageRouter")` (cùng cách file đó tự import động mọi service khác).
 *
 * ── Vì sao mệnh đề 4 KHÔNG gọi tuyến HTTP PUT /api/aoi/upload/:packageId thật ──
 * `server/_core/index.ts` là MỘT hàm `startServer()` monolithic (registration
 * route + `.listen()` không tách rời) — KHÔNG có harness boot-app-không-listen
 * nào trong repo cho file này; tiền lệ DUY NHẤT test tuyến trong file đó
 * (`aoiPackageXacThuc.test.ts`) dùng CENSUS NGUỒN, không phải HTTP thật. Mệnh đề
 * 4 dưới đây vì vậy gọi THẲNG `laGoiDaChet` — hàm THẬT mà tuyến upload phụ thuộc
 * (không phải bản chép) — trên một hàng `'dead'` được tạo ra bởi ĐÚNG chuỗi
 * `presign` → (3 lượt) `commit` thật, rồi SELECT lại để chứng minh không có UPDATE
 * nào xảy ra. Giới hạn đã biết, ghi rõ trong report: đây KHÔNG phải một request
 * HTTP thật đi qua Express/`uploadGuard`/`express.raw` — nó là bằng chứng ở mức
 * "route gọi đúng hàm nào" (đã đối chiếu bằng đọc mã `_core/index.ts`) + "hàm đó
 * trả gì trên dữ liệu THẬT" (đo bằng SELECT).
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279). Mệnh đề 1-3 tạo MỖI ca đúng MỘT hàng `product_inspections` — MỘT lượt
 * chạy đầy đủ file này để lại ĐÚNG BA hàng vĩnh viễn (mệnh đề 1/2/3), cộng MỘT
 * hàng nữa nếu mệnh đề 5 chạy tới bước commit thành công (bốn hàng tổng). Không
 * `DELETE FROM product_inspections … .catch(() => {})` — chỉ dọn
 * `measurement_results`/`inspection_packages`/`package_activity_logs` (KHÔNG WORM)
 * trong `afterAll`. Máy dựng ở `beforeAll` được soft-delete qua `db.deleteMachine`
 * (UPDATE `isActive=false`, không phải DELETE — an toàn dù có FK từ
 * `product_inspections`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, laGoiDaChet } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  productInspections,
  measurementResults,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG65-68-PKG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG65-68-PKG-${STAMP}`,
    name: "Pha 1E Task 2 (BG-65+BG-68) test machine",
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
    // KHÔNG delete `productInspections` — WORM (migration 0279, avi_app không có
    // quyền DELETE trên bảng này). Các hàng tạo trong file này ở lại VĨNH VIỄN —
    // xem docblock đầu file.
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg65-68-pkg-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = "3";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Tạo hàng `inspection_packages` trực tiếp (status='uploaded') — cùng kỹ thuật `taoGoi` của aoiPackageZipChotChanRetry.test.ts. */
async function taoGoi(suffix: string, storageKey: string): Promise<number> {
  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({
      machineId,
      packageId: `BG65-68-PKG-${STAMP}-${suffix}`,
      storageKey,
      status: "uploaded",
    })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return pkg.id;
}

/** Ghi một ZIP HỢP LỆ (meta.json + images/) lên đĩa local, trả về packageId đã tạo hàng DB. */
async function ghiZipHopLeVaTaoGoi(suffix: string, meta: Record<string, unknown>): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG65-68-PKG-${STAMP}-${suffix}`;
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

describe("BG-68 ⛔ — header overallResult cuộn từ measurements[].result THẬT (mệnh đề 1-3, đo bằng SELECT)", () => {
  it("mệnh đề 1: khai OK + summary.ng=0 NHƯNG measurements[] có NG (máy khai NHẤT QUÁN SAI) ⇒ header ghi NG", async () => {
    const serial = `BG68-SN-${STAMP}-1`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m1", {
      serialNumber: serial,
      productModel: `BG68-PM-${STAMP}`,
      overallResult: "OK",
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "NG", measuredValue: 2 },
      ],
      // LỜI KHAI THỨ HAI — cố ý NHẤT QUÁN SAI với measurements[] ở trên (BG-68).
      summary: { totalPoints: 2, ok: 2, ng: 0 },
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    expect(inspectionId, "phải tạo được inspection mới (serialNumber mới hoàn toàn)").toBeTruthy();
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT product_inspections.overallResult (header) — TRƯỚC bản vá: 'OK' sai; SAU: 'NG'").toBe("NG");
    expect(pkgRow.overallResult, "SELECT inspection_packages.overallResult (package row) cũng phải NG").toBe("NG");
  });

  it("mệnh đề 2 (CHỐNG HỒI QUY): khai OK + summary.ng=0 + measurements[] TOÀN OK ⇒ vẫn OK", async () => {
    const serial = `BG68-SN-${STAMP}-2`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m2", {
      serialNumber: serial,
      productModel: `BG68-PM-${STAMP}`,
      overallResult: "OK",
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "OK", measuredValue: 2 },
      ],
      summary: { totalPoints: 2, ok: 2, ng: 0 },
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT — measurements[] toàn OK ⇒ header PHẢI vẫn OK").toBe("OK");
    expect(pkgRow.overallResult).toBe("OK");
  });

  it("mệnh đề 3 (CHỐNG HỒI QUY): khai NG ⇒ vẫn NG bất kể measurements/summary nói gì", async () => {
    const serial = `BG68-SN-${STAMP}-3`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m3", {
      serialNumber: serial,
      productModel: `BG68-PM-${STAMP}`,
      overallResult: "NG",
      measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
      summary: { totalPoints: 1, ok: 1, ng: 0 },
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT — máy khai NG PHẢI luôn thắng, kể cả measurements/summary sạch").toBe("NG");
    expect(pkgRow.overallResult).toBe("NG");
  });
});

describe("BG-65 ⛔ — trạng thái CUỐI 'dead' không sống lại qua vòng Agent thật presign → upload → commit (mệnh đề 4-5, đo bằng SELECT)", () => {
  it("mệnh đề 4: presign THẬT → 3 lượt commit lỗi VĨNH VIỄN (⇒ 'dead') → upload-gate (laGoiDaChet, HÀM THẬT route dùng) chặn → commit lại vẫn từ chối — SELECT xác nhận status KHÔNG rời 'dead'", async () => {
    const packageId = `BG65-PKG-${STAMP}-dead`;
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    // Bước 1 — presign THẬT (tRPC procedure Agent gọi đầu vòng): tạo hàng
    // inspection_packages với storageKey do MÁY CHỦ sinh, KHÔNG file thật trên
    // đĩa ⇒ mọi lượt commit sau đó sẽ ném NOT_FOUND (VĨNH VIỄN — cùng khuôn §1
    // của aoiPackageZipChotChanRetry.test.ts).
    const presigned = await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: 100 });
    expect(presigned.success, "presign thật phải thành công (tạo hàng inspection_packages)").toBe(true);

    const d = (await db.getDb())!;
    const [rowSauPresign] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    expect(rowSauPresign, "phải tìm thấy hàng vừa presign").toBeTruthy();
    packageDbIds.push(rowSauPresign.id);

    // Bước 2 — 3 lượt commit (ngưỡng AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS=3):
    // lượt 1-2 dưới ngưỡng ('failed'), lượt 3 đúng ngưỡng ⇒ 'dead'.
    for (let lan = 1; lan <= 2; lan++) {
      await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
    }
    let loiLuot3: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loiLuot3 = e;
    }
    expect(loiLuot3).toBeTruthy();
    const [rowDead] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, rowSauPresign.id));
    expect(rowDead.status, "SELECT thật: đúng lượt thứ 3 phải chuyển 'dead'").toBe("dead");

    // Bước 3 — "upload" của vòng Agent (giới hạn đã biết trong docblock đầu
    // file: không có harness HTTP thật cho _core/index.ts trong repo). Gọi
    // THẲNG `laGoiDaChet` — hàm THẬT tuyến upload phụ thuộc (đối chiếu bằng đọc
    // mã: `_core/index.ts` gọi `await import("../routers/aoiPackageRouter")`
    // rồi `laGoiDaChet(pkg.status)` TRƯỚC `storagePut`/UPDATE) — trên hàng THẬT
    // vừa SELECT.
    expect(laGoiDaChet(rowDead.status), "route upload PHẢI thấy gói này là dead và từ chối TRƯỚC storagePut/UPDATE").toBe(true);
    // Route trả về SỚM khi laGoiDaChet()===true ⇒ storagePut/UPDATE KHÔNG được
    // gọi. Không UPDATE nào chạy ⇒ SELECT lại phải thấy CÙNG giá trị — bằng
    // chứng bằng số cho "không có ghi nào xảy ra", không phải suy luận.
    const [rowSauBuocUpload] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, rowSauPresign.id));
    expect(rowSauBuocUpload.status).toBe("dead");

    // Bước 4 — commit lần cuối của vòng: cổng `if (laGoiDaChet(pkg.status))`
    // trong `commit` (đã CÓ TỪ Pha 1D Task 5, nay dùng CHUNG hàm với upload)
    // phải từ chối NGAY.
    let loiCommitCuoi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loiCommitCuoi = e;
    }
    expect(loiCommitCuoi).toBeTruthy();
    expect(String((loiCommitCuoi as { message?: string })?.message)).toContain("KHÔNG được thử lại");

    const [rowCuoiCung] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, rowSauPresign.id));
    expect(rowCuoiCung.status, "SAU CẢ VÒNG presign → upload(gate) → commit: vẫn 'dead', KHÔNG sống lại").toBe("dead");
  });

  it("mệnh đề 5 (CHỐNG HỒI QUY): gói 'failed' bình thường (1 lỗi < ngưỡng, KHÔNG 'dead') vẫn retry được — sửa ZIP rồi commit lại THÀNH CÔNG", async () => {
    // ⚠ PHẢI khớp NGUYÊN VĂN chuỗi packageId mà `taoGoi()` chèn vào DB (nó tự
    // ghép tiền tố `BG65-68-PKG-`, KHÔNG phải `BG65-PKG-`) — lệch một ký tự ở
    // đây khiến `commit()` 404 trên một packageId KHÔNG TỒN TẠI, không hề đụng
    // tới hàng thật (đã tự bắt lỗi này khi chạy thử: SELECT trả 'uploaded'
    // thay vì 'failed' vì `commit()` chưa từng tìm thấy hàng để sửa).
    const packageId = `BG65-68-PKG-${STAMP}-retry`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
    const pkgDbId = await taoGoi("retry", storageKey); // status='uploaded', KHÔNG có file trên đĩa
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const d = (await db.getDb())!;

    // Lượt 1: ZIP CHƯA có trên đĩa ⇒ NOT_FOUND (vĩnh viễn), nhưng CHỈ 1 lần
    // (< ngưỡng 3) ⇒ 'failed', KHÔNG 'dead'.
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
    const [rowFailed] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(rowFailed.status).toBe("failed");
    expect(laGoiDaChet(rowFailed.status), "'failed' KHÔNG phải 'dead' — route upload KHÔNG được chặn gói này").toBe(false);

    // "Agent" sửa lỗi: ghi ZIP HỢP LỆ vào ĐÚNG storageKey (mô phỏng bước upload
    // thành công của vòng thật — storagePut+UPDATE mà tuyến Express thực hiện
    // không đổi trong bản vá này, chỉ thêm cổng chặn 'dead').
    const serial = `BG65-SN-${STAMP}-retry`;
    const zip = new JSZip();
    zip.file(
      "meta.json",
      JSON.stringify({
        serialNumber: serial,
        productModel: `BG65-PM-${STAMP}`,
        overallResult: "OK",
        measurements: [{ pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 }],
        summary: { totalPoints: 1, ok: 1, ng: 0 },
      }),
    );
    zip.file("images/p1.jpg", Buffer.from("bg65-retry-fake-image"));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, zipBuffer);

    // Lượt 2: commit lại — route thật — PHẢI thành công.
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const [rowCommitted] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(rowCommitted.status, "gói 'failed' bình thường PHẢI retry được tới 'committed'").toBe("committed");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// BG-65 — census nguồn: tuyến PUT /api/aoi/upload/:packageId THẬT (server/
// _core/index.ts) PHẢI gọi `laGoiDaChet(` TRƯỚC `storagePut(`.
//
// Mệnh đề 4 ở trên gọi THẲNG `laGoiDaChet` (không qua HTTP — xem docblock đầu
// file, không có harness boot-app-không-listen cho `_core/index.ts` trong
// repo) — chứng minh HÀM đúng trên dữ liệu 'dead' THẬT. Nhưng nếu tuyến upload
// trong `_core/index.ts` KHÔNG THỰC SỰ gọi hàm đó (VD: đột biến gỡ bỏ khối
// `if (laGoiDaChet(pkg.status)) {...}`), mệnh đề 4 ở trên vẫn XANH — nó không
// hề chạm `_core/index.ts`. Census này đóng đúng khe hở đó: đọc NGUYÊN VĂN
// nguồn `_core/index.ts`, cắt đúng vùng thân tuyến upload (cùng kỹ thuật
// `vungTuyenUploadZip` của `aoiPackageXacThuc.test.ts`, KHÔNG viết bản thứ
// hai của phép cắt — chép lại TẠI ĐÂY vì import chéo giữa hai file test không
// mang lại lợi ích), rồi khẳng định `laGoiDaChet(` xuất hiện TRƯỚC
// `storagePut(` trong vùng đó. Đột biến (b) — gỡ chốt 'dead' ở đường upload —
// xoá lời gọi này ⇒ census dưới đây ĐỎ.
// ══════════════════════════════════════════════════════════════════════════
const CORE_INDEX_PATH = join(__dirname, "..", "_core", "index.ts");
const CORE_INDEX_SOURCE = readFileSync(CORE_INDEX_PATH, "utf-8");

/** Cắt vùng thân `app.put("/api/aoi/upload/:packageId", …)` — xem `aoiPackageXacThuc.test.ts`. */
function vungTuyenUploadZip(source: string): string {
  const MOC_MO = 'app.put("/api/aoi/upload/:packageId"';
  const batDau = source.indexOf(MOC_MO);
  if (batDau === -1) return "";
  const phanConLai = source.slice(batDau + MOC_MO.length);
  const mocTuyenKeTiep = /\n {2}app\.(get|put|post|delete|patch)\(/;
  const khop = phanConLai.match(mocTuyenKeTiep);
  const ketThuc = khop ? batDau + MOC_MO.length + (khop.index ?? phanConLai.length) : source.length;
  return source.slice(batDau, ketThuc);
}

const VUNG_UPLOAD = vungTuyenUploadZip(CORE_INDEX_SOURCE);

describe("BG-65 census — tuyến upload THẬT phải gọi laGoiDaChet( trước storagePut(", () => {
  it("chống đọc-file-rỗng + cầu chì vùng cắt (marker còn đúng chỗ)", () => {
    expect(CORE_INDEX_SOURCE.length).toBeGreaterThan(1000);
    expect(VUNG_UPLOAD.length, "không tìm thấy app.put(\"/api/aoi/upload/:packageId\" — marker đã đổi?").toBeGreaterThan(500);
    expect(VUNG_UPLOAD.length).toBeLessThan(CORE_INDEX_SOURCE.length / 2);
  });

  it("vùng tuyến upload CÓ gọi laGoiDaChet( — đột biến (b) gỡ chốt 'dead' phải làm ca này ĐỎ", () => {
    expect(VUNG_UPLOAD).toMatch(/laGoiDaChet\(/);
  });

  it("laGoiDaChet( xuất hiện TRƯỚC storagePut( trong vùng tuyến — chặn TRƯỚC khi ghi, không phải sau", () => {
    const viTriGate = VUNG_UPLOAD.indexOf("laGoiDaChet(");
    const viTriGhi = VUNG_UPLOAD.indexOf("storagePut(");
    expect(viTriGate, "laGoiDaChet( phải xuất hiện trong vùng tuyến").toBeGreaterThan(-1);
    expect(viTriGhi, "storagePut( phải xuất hiện trong vùng tuyến").toBeGreaterThan(-1);
    expect(viTriGate).toBeLessThan(viTriGhi);
  });
});
