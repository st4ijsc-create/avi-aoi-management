/**
 * C-1 ⛔ (review lượt 8) — BO NG CÓ `serialNumber` RỖNG PHẢI ĐƯỢC GHI.
 *
 * ── Lỗi được đóng ở đây ────────────────────────────────────────────────────
 * `aoiPackageRouter.commit` bọc TOÀN BỘ khối `reserveInspectionId` +
 * `persistInspectionAtomic` trong `if (metaData.serialNumber) { … }`. Chuỗi
 * RỖNG là falsy trong JS ⇒ một gói cây HỢP LỆ, cuộn ra **NG**, mà `serialNumber`
 * rỗng sẽ:
 *   · trả `{ success: true }` cho Agent (máy nghe "THÀNH CÔNG"),
 *   · đặt `inspection_packages.status='committed'`, `overallResult='NG'`,
 *   · nhưng KHÔNG ghi một hàng `product_inspections` nào,
 *   · và vì mọi hook sau đều gác bằng `linkedInspectionId` ⇒ quality gate ·
 *     WIP ingest · inline AI gate · embedding ĐỀU bị bỏ.
 * `shared/kpiYield.ts` tính final yield trên `product_inspections.overallResult`
 * ⇒ **bo NG này không tồn tại với yield, với cảnh báo, với ERP.**
 *
 * ── Vì sao rỗng là hình dạng HỢP LỆ, không phải payload rác ────────────────
 * `machineDataContractV2.ts` khai `serialNumber: z.string().trim().max(100)` —
 * **CỐ Ý KHÔNG `.min(1)`** ("rỗng là hình dạng THẬT khi máy chưa gán serial …
 * ĐỪNG sửa lại cho chặt"). Cột `product_inspections.serialNumber` là NOT NULL
 * varchar nhưng chuỗi RỖNG hợp lệ với nó, và DB `aoi_management_test` đã có
 * **99 hàng serial rỗng** — ghi `''` KHÔNG phải hình mẫu mới, là hình mẫu ĐANG
 * CÓ. Bởi vậy bản vá là BỎ CỔNG, **không** siết hợp đồng (hướng (a) BG-73 đã
 * bị chủ dự án bác).
 *
 * ── Vì sao lưới cũ MÙ ──────────────────────────────────────────────────────
 * `duyetTruongOptional` (`hinhDangHopDongMetaJson.ts`) liệt kê các trường
 * `.optional()`; `serialNumber` là trường **BẮT BUỘC nhưng được phép RỖNG** nên
 * nằm NGOÀI tầm phát biểu của census đó theo cấu tạo. Cả 8 hình dạng trong
 * `BANG_HINH_DANG` lẫn 7 ca `aoiPackageBienBg85.test.ts` đều khai serial khác
 * rỗng ⇒ 0 lưới chạm ca này. Bất biến ĐÚNG là: *mọi giá trị hợp đồng CHẤP NHẬN
 * đều phải ghi được một hàng* — chính là điều file này đo, bằng commit SỐNG +
 * SELECT sau commit (KHÔNG dùng giá trị `caller.commit()` trả về làm bằng chứng
 * cuối, cùng kỷ luật mọi lưới BG-8x khác trong module này).
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279). Mỗi ca ở đây tạo MỘT hàng mới, ở lại VĨNH VIỄN. `afterAll` chỉ dọn
 * `inspection_packages`/`package_activity_logs`/cây kết quả (KHÔNG WORM) +
 * soft-delete máy test.
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
  productInspections,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `C1-SERIAL-RONG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `C1-SERIAL-RONG-${STAMP}`,
    name: "C-1 — serialNumber rỗng vẫn PHẢI ghi product_inspections",
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
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
    // KHÔNG delete `productInspections` — WORM (migration 0279).
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `c1-serial-rong-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** meta.json CÂY hợp lệ, tham số hoá `serialNumber` (kể cả rỗng) và verdict lá. */
function metaCay(opts: { serial: string; captureId: string; result: "OK" | "NG" }) {
  const { serial, captureId, result } = opts;
  const n = { total: 1, pass: result === "OK" ? 1 : 0, ng: result === "NG" ? 1 : 0, ntf: 0 };
  return {
    identity: {
      station: "C1-ST", machine: "C1-MC", line: "C1-LN", plant: "C1-PL",
      country: "VN", solutionName: "C1-SOL", appVersion: "1.0.0",
    },
    productId: `C1-PID-${captureId}`,
    serialNumber: serial,
    productModel: `C1-PM-${STAMP}`,
    overallResult: result,
    ntf: false,
    summary: { surfaces: n, positions: n, captures: n, components: n },
    surfaces: [{
      name: "TOP", result, ntf: false,
      positions: [{
        positionId: "P01", result, ntf: false,
        captures: [{
          captureId, result, ntf: false,
          components: [{ componentId: `${captureId}-COMP`, result, ntf: false }],
        }],
      }],
    }],
  };
}

/** Ghi ZIP + hàng `inspection_packages` (status='uploaded') — cùng khuôn `aoiPackageBienBg85.test.ts`. */
async function ghiZipVaTaoGoi(
  suffix: string,
  meta: Record<string, unknown>,
  anhThat: string[] = [],
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `C1-SERIAL-RONG-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  for (const fileName of anhThat) zip.file(`images/${fileName}`, Buffer.from(`c1-fake-${fileName}`));
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

/**
 * Tra hàng `product_inspections` bằng SỔ IDEMPOTENCY (`aoi-pkg:<packageId>`) —
 * KHÔNG tra bằng `serialNumber` (rỗng thì tra theo serial là vô nghĩa: nó sẽ
 * khớp cả 99 hàng serial-rỗng có sẵn trong DB test) và KHÔNG tra bằng
 * `inspectionId` mà `commit` trả về (chính giá trị đó là thứ đang bị nghi ngờ).
 */
async function timHangTheoGoi(packageId: string) {
  const d = (await db.getDb())!;
  const rows = await d
    .select()
    .from(productInspections)
    .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// C-1 — cây hợp lệ + serialNumber RỖNG + cuộn NG ⇒ PHẢI có hàng product_inspections.
// ════════════════════════════════════════════════════════════════════════════
describe("C-1 ⛔ — gói cây HỢP LỆ với serialNumber RỖNG cuộn ra NG PHẢI ghi product_inspections (bo NG không được biến mất)", () => {
  it('serialNumber:"" + cây NG ⇒ SELECT product_inspections theo idempotencyKey có ĐÚNG 1 hàng, overallResult="NG", đủ ba cấp cây', async () => {
    const captureId = `C1-RONG-CAP-${STAMP}`;
    const meta = metaCay({ serial: "", captureId, result: "NG" });
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("rong-ng", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success, "commit phải thành công — hợp đồng CHẤP NHẬN serial rỗng").toBe(true);

    // ★ Bằng chứng CHÍNH: hàng header phải TỒN TẠI trên đĩa, tra bằng sổ idempotency.
    const rows = await timHangTheoGoi(packageId);
    expect(
      rows.length,
      "SELECT product_inspections WHERE idempotencyKey='aoi-pkg:<packageId>' — bo NG có serial RỖNG " +
        "PHẢI để lại ĐÚNG MỘT hàng. 0 hàng nghĩa là NG đã BIẾN MẤT khỏi mọi bảng yield/cảnh báo/ERP đọc, " +
        "trong khi Agent nhận được success:true.",
    ).toBe(1);
    const insp = rows[0];
    if (insp) inspectionIds.push(insp.id);

    expect(insp.overallResult, "verdict cuộn từ CÂY phải được lưu là NG").toBe("NG");
    expect(insp.serialNumber, "cột serialNumber ghi NGUYÊN VĂN chuỗi rỗng — KHÔNG bịa giá trị thay thế").toBe("");
    expect(insp.machineId, "header phải thuộc đúng máy đã xác thực").toBe(machineId);

    // Cây kết quả PHẢI đi cùng header (persistInspectionAtomic ghi cùng một tx).
    const d = (await db.getDb())!;
    const surfaceRows = await d.select().from(inspectionSurfaces).where(eq(inspectionSurfaces.inspectionId, insp.id));
    expect(surfaceRows.length, "SELECT inspection_surfaces — cây phải được ghi cùng header").toBeGreaterThanOrEqual(1);
    const positionRows = await d
      .select().from(inspectionPositions)
      .where(inArray(inspectionPositions.surfaceRowId, surfaceRows.map((r) => r.id)));
    expect(positionRows.length, "SELECT inspection_positions").toBeGreaterThanOrEqual(1);
    const captureRows = await d
      .select().from(inspectionCaptures)
      .where(inArray(inspectionCaptures.positionRowId, positionRows.map((r) => r.id)));
    expect(captureRows.map((c) => c.captureExtId), "SELECT inspection_captures — đúng captureId đã khai").toContain(captureId);

    // Gói phải nối được về header — `inspectionId` KHÔNG được để NULL.
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status).toBe("committed");
    expect(pkgRow.overallResult).toBe("NG");
    expect(
      pkgRow.inspectionId,
      "inspection_packages.inspectionId — gói ĐÃ commit phải trỏ về header, NULL = dấu vết duy nhất của bo NG nằm " +
        "ở một bảng mà dashboard sản xuất không đếm yield từ đó",
    ).toBe(insp.id);

    // Giá trị `commit` TRẢ VỀ cũng phải nhất quán với đĩa (hộ tiêu thụ Agent đọc trường này).
    expect((ket as { inspectionId?: number }).inspectionId, "commit().inspectionId phải khớp hàng vừa SELECT").toBe(insp.id);
  });

  it('serialNumber:"   " (toàn khoảng trắng, .trim() ⇒ "") cùng số phận ⇒ vẫn PHẢI ghi header NG', async () => {
    const captureId = `C1-TRIM-CAP-${STAMP}`;
    const meta = metaCay({ serial: "   ", captureId, result: "NG" });
    const { packageId } = await ghiZipVaTaoGoi("trim-ng", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);

    const rows = await timHangTheoGoi(packageId);
    expect(
      rows.length,
      "chuỗi toàn khoảng trắng đi qua `.trim()` của hợp đồng thành \"\" — cùng lớp lỗi, phải cùng cách xử lý",
    ).toBe(1);
    if (rows[0]) inspectionIds.push(rows[0].id);
    expect(rows[0].overallResult).toBe("NG");
    expect(rows[0].serialNumber).toBe("");
  });

  it("ĐỐI CHỨNG — serial KHÁC RỖNG vẫn ghi header như trước (bản vá KHÔNG đổi nhánh đang đúng)", async () => {
    const captureId = `C1-CO-SERIAL-CAP-${STAMP}`;
    const meta = metaCay({ serial: `C1-CO-SERIAL-${STAMP}`, captureId, result: "NG" });
    const { packageId } = await ghiZipVaTaoGoi("co-serial-ng", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);

    const rows = await timHangTheoGoi(packageId);
    expect(rows.length, "nhánh có serial vốn đã đúng — đối chứng chống 'vá chỗ này, gãy chỗ kia'").toBe(1);
    if (rows[0]) inspectionIds.push(rows[0].id);
    expect(rows[0].overallResult).toBe("NG");
    expect(rows[0].serialNumber).toBe(`C1-CO-SERIAL-${STAMP}`);
  });

  it("IDEMPOTENCY — commit LẶP LẠI gói serial-rỗng KHÔNG sinh hàng thứ hai (khoá là packageId, không phải serial)", async () => {
    const captureId = `C1-IDEM-CAP-${STAMP}`;
    const meta = metaCay({ serial: "", captureId, result: "NG" });
    const { packageId } = await ghiZipVaTaoGoi("idem-rong", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    await caller.commit({ apiKey: API_KEY, packageId });
    const sauLan1 = await timHangTheoGoi(packageId);
    expect(sauLan1.length).toBe(1);
    if (sauLan1[0]) inspectionIds.push(sauLan1[0].id);

    // Lượt hai: gói đã 'committed' ⇒ commit trả về nhánh alreadyCommitted, KHÔNG ghi thêm.
    await caller.commit({ apiKey: API_KEY, packageId });
    const sauLan2 = await timHangTheoGoi(packageId);
    expect(
      sauLan2.length,
      "sổ idempotency `aoi-pkg:<packageId>` là khoá hội tụ — bỏ cổng serial KHÔNG được mở đường đếm trùng " +
        "(đây CHÍNH là lỗ BG-23 mà đường trực tiếp v2.0 đã đóng bằng cùng cơ chế)",
    ).toBe(1);
    expect(sauLan2[0].id).toBe(sauLan1[0].id);
  });
});
