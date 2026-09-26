/**
 * ⛔ M-8 (re-review lượt 8) — ZIP KHÔNG có `meta.json` vẫn `committed` +
 * `overallResult='OK'` + **0 bo được ghi**.
 *
 * ── Vì sao đây là mục đáng vá, dù 0 ca hôm nay ────────────────────────────
 * Đây là HÌNH DẠNG CUỐI CÙNG còn lại của ĐÚNG lớp lỗi C-1: *"commit thành
 * công, không bo nào được ghi, Agent nghe THÀNH CÔNG"*. Chú thích C-1 mới
 * (`aoiPackageRouter.ts`, thông điệp `commit_success`) đã CHỈ ĐÍCH DANH nó.
 *
 * Trước bản vá: `metaData` = null ⇒ không nhánh nào ghi đè `finalOverallResult`
 * (khởi tạo `"OK"`), không `product_inspections` nào được tạo, không hàng
 * `package_images` nào (khối I-6 nằm trong `if (metaData)`), `demTuCayBaoCao`
 * rơi về `{ total: imageFiles.length, ok: 0, ng: 0 }` — và hàng vẫn chuyển
 * `'committed'`. Agent nhận `success: true` cho một gói mà máy chủ KHÔNG ghi
 * lấy một bo.
 *
 * ── Hộ tiêu thụ ĐÃ ĐO TRƯỚC KHI ĐỔI (không đổi mù) ────────────────────────
 * SQL, vai `avi_app`, kèm `current_database()` (luật Đ-28):
 *   `aoi_management`      : inspection_packages = 0 hàng ⇒ committed & metaJson
 *                           IS NULL = **0**
 *   `aoi_management_test` : 296 hàng, TẤT CẢ `committed`, `metaJson IS NULL`
 *                           = **0** (⇒ `committed` + OK + không meta = **0**)
 * Mã: 0 lưới nào commit một ZIP thiếu `meta.json` qua thủ tục `commit`. Hai ca
 * `aoiPackageBaLoToanVenBg87.test.ts:470,:488` CÓ dựng ZIP không `meta.json`,
 * nhưng chúng INSERT thẳng hàng `status:'committed'` (helper
 * `taoGoiDaCommitVoiZipTuyChinh`) — KHÔNG đi qua `commit`, nên không phải hộ
 * tiêu thụ của cổng này. ⇒ Từ chối không lấy mất năng lực nào đang được dùng.
 *
 * ── Bất biến được khôi phục ───────────────────────────────────────────────
 * *"`commit` thành công ⇔ có bo được ghi."* Một gói KHÔNG manifest không thể
 * thoả bất biến 1/2 (§4 chuẩn gói ảnh) — nó không mang serial, không mang cây
 * kết quả, không mang `images[]` — nên TỪ CHỐI không mất gì.
 *
 * ── Cách chữa được kê có THI HÀNH ĐƯỢC không? (bài học N-1) ───────────────
 * CÓ. Thông điệp nói Agent phải tải lên một ZIP CÓ `meta.json` — và đường đó
 * đi được trên CÙNG `packageId`: gói ở lại `'failed'` (vẫn `presign`/upload/
 * `commit` lại được; `presign` gọi lại nay còn LÀM MỚI lời khai toàn vẹn —
 * N-1). Chỉ SAU `nguongLoiVinhVienZip()` lượt lỗi vĩnh viễn LIÊN TIẾP gói mới
 * thành `'dead'`, và thông điệp lúc đó kê đúng cách chữa còn lại (`packageId`
 * MỚI). Đây là khác biệt với N-1: ở đó cách chữa được kê ("tải lại ZIP") KHÔNG
 * THỂ hiệu quả dù thử bao nhiêu lần.
 *
 * ⚠ WORM — ca đối chứng dương tạo MỘT hàng `product_inspections` ở lại vĩnh viễn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `M8-NOMETA-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `M8-NOMETA-${STAMP}`,
    name: "M-8 — ZIP thiếu meta.json phải bị TỪ CHỐI",
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
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `m8-nometa-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

function metaCayToiThieu(serial: string, captureId: string, fileName: string) {
  const n = { total: 1, pass: 1, ng: 0, ntf: 0 };
  return {
    identity: {
      station: "M8-ST", machine: "M8-MC", line: "M8-LN", plant: "M8-PL",
      country: "VN", solutionName: "M8-SOL", appVersion: "1.0.0",
    },
    productId: `M8-PID-${serial}`,
    serialNumber: serial,
    overallResult: "OK",
    ntf: false,
    summary: { surfaces: n, positions: n, captures: n, components: n },
    images: [{ captureId, fileName }],
    surfaces: [{
      name: "TOP", result: "OK", ntf: false,
      positions: [{
        positionId: "P01", result: "OK", ntf: false,
        captures: [{ captureId, result: "OK", ntf: false, components: [{ componentId: `M8-COMP-${STAMP}`, result: "OK", ntf: false }] }],
      }],
    }],
  };
}

/** presign THẬT → ghi ZIP xuống local storage đúng `storageKey` → gói ở lại 'pending'. */
async function presignRoiGhiZip(suffix: string, zipBuffer: Buffer): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `M8-NOMETA-${STAMP}-${suffix}`;
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

describe("⛔ M-8 — ZIP KHÔNG có `meta.json` phải bị TỪ CHỐI, không `committed` im lặng", () => {
  it("★★★ mệnh đề 1 — ZIP có ảnh nhưng KHÔNG có meta.json ⇒ commit TỪ CHỐI; SELECT: không 'committed', không overallResult='OK', 0 bo", async () => {
    const zip = new JSZip();
    zip.file("images/p1.jpg", Buffer.from(`m8-anh-that-${STAMP}`));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const { packageId, pkgDbId } = await presignRoiGhiZip("md1", zipBuffer);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    let loi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(
      loi,
      "TRƯỚC bản vá: commit trả success:true cho một gói mà máy chủ KHÔNG ghi lấy một bo — đúng lớp lỗi C-1, " +
        "hình dạng cuối cùng còn lại",
    ).toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toMatch(/meta\.json/);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status, "SELECT thật — gói KHÔNG được chuyển 'committed'").not.toBe("committed");
    expect(row.overallResult, "và KHÔNG được mang phán quyết 'OK' của một lượt kiểm chưa từng diễn ra").not.toBe("OK");
    expect(row.inspectionId, "0 bo được ghi ⇒ không có inspection nào để nối").toBeNull();

    const anh = await d.select().from(packageImages).where(eq(packageImages.packageId, pkgDbId));
    expect(anh.length, "0 hàng package_images — gói bị từ chối không để lại dấu vết ảnh").toBe(0);
  });

  it("mệnh đề 2 — ZIP có `meta.json` RỖNG BYTE (tệp tồn tại nhưng không phải JSON) vẫn bị từ chối bằng đường CŨ, không lẫn với M-8", async () => {
    const zip = new JSZip();
    zip.file("meta.json", "");
    zip.file("images/p1.jpg", Buffer.from(`m8-anh-that-${STAMP}`));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const { packageId, pkgDbId } = await presignRoiGhiZip("md2", zipBuffer);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    let loi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "meta.json rỗng ⇒ JSON.parse ném SyntaxError ⇒ commit hỏng (hành vi CÓ SẴN, không do M-8)").toBeTruthy();
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).not.toBe("committed");
  });

  it("ĐỐI CHỨNG DƯƠNG — CÙNG ZIP đó nhưng CÓ meta.json hợp lệ ⇒ commit thành công (cổng M-8 không chặn nhầm gói tốt)", async () => {
    const serial = `M8-MD3-SN-${STAMP}`;
    const capture = `M8-MD3-CAP-${STAMP}`;
    const zip = new JSZip();
    zip.file("meta.json", JSON.stringify(metaCayToiThieu(serial, capture, "p1.jpg")));
    zip.file("images/p1.jpg", Buffer.from(`m8-anh-that-${STAMP}`));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const { packageId, pkgDbId } = await presignRoiGhiZip("md3", zipBuffer);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success, "đối chứng dương — happy path chưa gãy").toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).toBe("committed");
    expect(row.inspectionId, "cổng M-8 tồn tại để bảo đảm ĐÚNG điều này: commit thành công ⇒ CÓ bo được ghi").not.toBeNull();
  });
});
