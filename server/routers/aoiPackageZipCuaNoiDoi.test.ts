/**
 * Pha 1E Task 2 (BG-65 + BG-68 ⛔) — "cửa ZIP nói dối ở hai chỗ".
 *
 * ── BG-85 (2026-09-02) — describe BG-68 XOÁ, KHÔNG hoàn nguyên ──────────────
 * BG-68 pin hành vi của `calculatedSummary`/`inferAoiOverallResult` — CẢ HAI
 * đã XOÁ khỏi `aoiPackageRouter.ts` (BG-85: verdict LUÔN cuộn từ
 * `dichCayKetQua(...).verdictLuuTru`, `summary` khai chỉ còn dùng để ĐỐI CHIẾU/
 * GẮN CỜ — `coLechSummary`/`demBonNhomTuCay` — KHÔNG BAO GIỜ là nguồn quyết
 * định). Kịch bản BG-68 ("measurements[] có NG nhưng summary.ng=0, verdict đọc
 * summary nên bỏ sót") KHÔNG THỂ tái hiện được nữa bằng hợp đồng cây: không có
 * đường mã nào còn đọc `summary` để quyết định verdict — đây LÀ bằng chứng
 * "BG-68 tự tan", không phải lập luận. Bất biến 3 (verdict-từ-cây,
 * summary-chỉ-đối-chiếu) được canh lại đầy đủ ở
 * `aoiPackageBienBg85.test.ts` (lưới mới BG-85).
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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, laGoiDaChet } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
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
      // I-6 (review lượt 8) — `commit` GHI LẠI `package_images` cho gói hình dạng cây.
      // Dọn TRƯỚC `inspection_packages` (khoá ngoại mềm `packageId` → `inspection_packages.id`):
      // xoá gói trước sẽ để lại hàng ảnh MỒ CÔI — bảng đó đã có 774 hàng như thế.
      await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
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
    // BG-85 — meta.json giờ là hợp đồng CÂY (machineDataContractV2 + images[]),
    // KHÔNG còn measurements[]/points[] phẳng.
    const serial = `BG65-SN-${STAMP}-retry`;
    const zip = new JSZip();
    zip.file(
      "meta.json",
      JSON.stringify({
        identity: { station: "BG65-ST", machine: "BG65-MC", line: "BG65-LN", plant: "BG65-PL", country: "VN", solutionName: "BG65-SOL", appVersion: "1.0.0" },
        productId: `BG65-PID-${STAMP}`,
        serialNumber: serial,
        productModel: `BG65-PM-${STAMP}`,
        overallResult: "OK",
        ntf: false,
        summary: { surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 }, positions: { total: 1, pass: 1, ng: 0, ntf: 0 }, captures: { total: 1, pass: 1, ng: 0, ntf: 0 }, components: { total: 1, pass: 1, ng: 0, ntf: 0 } },
        surfaces: [{
          name: "TOP", result: "OK", ntf: false,
          positions: [{
            positionId: "P01", result: "OK", ntf: false,
            captures: [{ captureId: "BG65-CAP-01", result: "OK", ntf: false, components: [{ componentId: "BG65-COMP-01", result: "OK", ntf: false }] }],
          }],
        }],
        images: [{ captureId: "BG65-CAP-01", fileName: "p1.jpg" }],
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

// ══════════════════════════════════════════════════════════════════════════
// Khối C Task 13 (BG-98, spec QĐ-8), vòng sửa 1 — census QUÊN LẦN THỨ TƯ.
//
// Cùng LỚP LỖI đã xảy ra BA lần trước ở đúng cửa này: Đ-27 (evaluatePointResult
// mất khỏi cửa ZIP ở `df20b31c`, BG-85), rồi Task 3 Khối B (cấp component chưa
// nối ở cửa ZIP), rồi chính Task 13 vòng 0 (cổng "máy tự mâu thuẫn" chỉ bơm vào
// `submitInspectionTreeV2`, CÂM ở `aoiPackageRouter.ts commit` — review vòng 1
// bắt lại). BA lần cùng một hình dạng ("thêm cổng mới, chỉ nối MỘT trong HAI
// cửa v2.0") nghĩa là lưới theo-task không đủ — cần một BẤT BIẾN CẤU TRÚC độc
// lập với việc ai đang sửa gì: MỌI lời gọi `dichCayKetQua(` trong
// `server/routers/**` phải mang `demMauThuan`.
//
// Kỹ thuật: CÙNG khuôn `vungTuyenUploadZip` ở trên (đọc nguồn thật, cắt đúng
// vùng bằng mốc văn bản) — không dùng bộ suy AST nặng (`quetDuongGhiInspection`
// ở `ghiInspectionWalCensus.test.ts`) vì ở đây chỉ cần "chuỗi con có mặt trong
// đúng lời gọi", không cần hiểu luồng điều khiển. `server/routers/` là thư mục
// PHẲNG (không thư mục con) nên `readdirSync` không cần đệ quy.
// ══════════════════════════════════════════════════════════════════════════
const THU_MUC_ROUTERS = __dirname; // file này đã nằm trong server/routers
const CAC_TEP_ROUTERS_SAN_XUAT = readdirSync(THU_MUC_ROUTERS)
  .filter((ten) => ten.endsWith(".ts") && !ten.endsWith(".test.ts"))
  .sort();
const NGUON_TEP_ROUTERS = new Map<string, string>(
  CAC_TEP_ROUTERS_SAN_XUAT.map((ten) => [ten, readFileSync(join(THU_MUC_ROUTERS, ten), "utf-8")]),
);

/**
 * Trích NGUYÊN VĂN từng lời gọi `dichCayKetQua(...)` trong `source` — dò độ sâu
 * ngoặc tròn cân bằng từ dấu `(` mở đầu tới dấu `)` khớp lại (chịu được lời gọi
 * nhiều dòng, object literal `{}` lồng bên trong không ảnh hưởng vì chỉ đếm
 * `(`/`)`). KHÔNG khớp `function dichCayKetQua(` (định nghĩa) vì định nghĩa đó
 * sống ở `server/services/ingestCayKetQua.ts`, ngoài phạm vi quét.
 */
function timLoiGoiDichCayKetQua(source: string): string[] {
  const doanGoi: string[] = [];
  const MOC = "dichCayKetQua(";
  let tuViTri = 0;
  while (true) {
    const idx = source.indexOf(MOC, tuViTri);
    if (idx === -1) break;
    let doSau = 1;
    let i = idx + MOC.length;
    while (i < source.length && doSau > 0) {
      if (source[i] === "(") doSau++;
      else if (source[i] === ")") doSau--;
      i++;
    }
    doanGoi.push(source.slice(idx, i));
    tuViTri = i;
  }
  return doanGoi;
}

function layTatCaLoiGoi(nguon: Map<string, string>): { tep: string; doanGoi: string }[] {
  const ket: { tep: string; doanGoi: string }[] = [];
  for (const [tep, ma] of nguon) {
    for (const doanGoi of timLoiGoiDichCayKetQua(ma)) ket.push({ tep, doanGoi });
  }
  return ket;
}

const TAT_CA_LOI_GOI = layTatCaLoiGoi(NGUON_TEP_ROUTERS);

describe("Khối C Task 13 (BG-98) census — mọi lời gọi dichCayKetQua( trong server/routers/** phải mang demMauThuan", () => {
  it("chống đọc-thư-mục-rỗng: quét được > 150 file production (.ts, không .test.ts) trong server/routers", () => {
    // Đo thật (2026-09-03): 210 file production trong server/routers (390 tổng trừ
    // *.test.ts/*.db.test.ts). Trần 150 chừa dư địa cho tăng/giảm số file tự nhiên,
    // chỉ canh việc readdirSync trả về gần-rỗng (thư mục sai/đường dẫn hỏng).
    expect(CAC_TEP_ROUTERS_SAN_XUAT.length).toBeGreaterThan(150);
  });

  it("cầu chì trích đoạn: số lời gọi trích được KHỚP số lần chuỗi 'dichCayKetQua(' xuất hiện thô trong toàn bộ nguồn đã quét", () => {
    const demTho = [...NGUON_TEP_ROUTERS.values()].reduce(
      (tong, ma) => tong + (ma.match(/dichCayKetQua\(/g)?.length ?? 0),
      0,
    );
    expect(TAT_CA_LOI_GOI.length, "bộ trích ngoặc-cân-bằng lệch với đếm thô — logic trích đã hỏng?").toBe(demTho);
    expect(TAT_CA_LOI_GOI.length, "0 lời gọi tìm được — census đang canh một tập rỗng (giấy vô can giả)").toBeGreaterThanOrEqual(2);
  });

  it("ĐÚNG hai cửa v2.0 hôm nay mang lời gọi: machineApiRouters.ts (trực tiếp) + aoiPackageRouter.ts (ZIP)", () => {
    const tepMangLoiGoi = [...new Set(TAT_CA_LOI_GOI.map((g) => g.tep))].sort();
    expect(tepMangLoiGoi).toEqual(["aoiPackageRouter.ts", "machineApiRouters.ts"]);
  });

  it("★★★ BẤT BIẾN: MỌI lời gọi dichCayKetQua( trong server/routers/** phải mang demMauThuan — cấm cửa mới CÂM (quên lần thứ 4)", () => {
    const thieu = TAT_CA_LOI_GOI.filter((g) => !g.doanGoi.includes("demMauThuan"));
    expect(
      thieu.map((g) => `${g.tep}: ${g.doanGoi}`),
      "lời gọi dichCayKetQua( sau đây KHÔNG bơm demMauThuan — cổng máy-tự-mâu-thuẫn (BG-98) sẽ CÂM ở cửa này",
    ).toEqual([]);
  });

  it("★★★ ĐỘT BIẾN THẬT: gỡ demMauThuan khỏi lời gọi cửa ZIP ⇒ census phải ĐỎ (không chạm đĩa)", () => {
    const goc = NGUON_TEP_ROUTERS.get("aoiPackageRouter.ts")!;
    const DONG_GOC = "cay = dichCayKetQua(metaData, { cong: congSpec, demMauThuan });";
    expect(goc.includes(DONG_GOC), "không tìm thấy dòng gọi ĐÃ VÁ — bộ suy đã đổi neo?").toBe(true);

    const DONG_DOT_BIEN = "cay = dichCayKetQua(metaData, { cong: congSpec });";
    const maDotBien = goc.replace(DONG_GOC, DONG_DOT_BIEN);
    expect(maDotBien).not.toBe(goc);

    const loiGoiDotBien = timLoiGoiDichCayKetQua(maDotBien);
    const thieuSauDotBien = loiGoiDotBien.filter((doan) => !doan.includes("demMauThuan"));
    expect(
      thieuSauDotBien.length,
      "đột biến bỏ demMauThuan PHẢI làm census bắt được — nếu đây là [] thì census KHÔNG canh được gì",
    ).toBeGreaterThan(0);

    // Đột biến chỉ sống trong biến `maDotBien` — chưa từng `writeFileSync`. Đọc lại
    // đĩa xác nhận file thật không đổi (cùng kỹ thuật "cả hai đột biến KHÔNG chạm
    // đĩa" ở mệnh đề BG-65 phía trên).
    const docLai = readFileSync(join(THU_MUC_ROUTERS, "aoiPackageRouter.ts"), "utf-8");
    expect(docLai).toBe(goc);
  });
});
