/**
 * Pha 1F Task 1 (BG-78 ⛔) — bo TỐT bị ghi NTF vào bảng WORM.
 *
 * `aoiPackageRouter.ts` cửa ZIP đếm NG/NTF THẬT từ `measurements[].result`
 * (BG-68, Pha 1E) vào hai chỗ:
 *   :850  `ngNtfThat.ntf`         — nuôi `finalOverallResult`/header (VERDICT thật)
 *   :1093 `calculatedSummary.ntf` — nuôi cột báo cáo (chỉ dùng khi `metaData.summary` vắng)
 *
 * TRƯỚC bản vá này, CẢ HAI dùng CÙNG biểu thức sai:
 *   `(p) => !p.result || p.result === "NTF"`
 * `!p.result` coi một điểm đo KHÔNG khai `result` là NTF. Nhưng `result` là
 * `.optional()` ở CẢ HAI nhánh (`measurements[]` VÀ `points[]`,
 * `metaJsonSchema` :454/:466) và cột đích `package_images.result`
 * (`drizzle/schema/inspection.ts:513`) là NULLABLE ⇒ manifest ảnh không kèm
 * phán quyết từng điểm là HÌNH DẠNG HỢP LỆ — máy chỉ gửi ảnh, chưa/không có
 * phán quyết per-point, KHÔNG phải "máy khai NTF". Trước bản vá, hình dạng đó
 * bị hồ sơ hoá thành `overallResult=NTF` — bo TỐT rơi vào hàng đợi xác nhận
 * NTF như lỗi giả, ghi vào `product_inspections`/`inspection_packages`
 * (bảng WORM, `avi_app` không có DELETE trên `product_inspections`,
 * migration 0279).
 *
 * SAU bản vá: `p.result === "NTF"` — chỉ đếm điểm ĐÃ KHAI `NTF`. Điểm không
 * khai `result` KHÔNG sinh ra một phán quyết (không rơi vào OK/NG/NTF nào).
 *
 * Bốn mệnh đề (đo bằng SELECT sau commit THẬT — KHÔNG dùng giá trị `caller.commit()` trả về):
 *  1. Lá KHÔNG khai `result`, `overallResult:"OK"` ⇒ header OK. (Trước bản vá: NTF.)
 *  2. CHỐNG-SIẾT-NGƯỢC: lá khai NTF THẬT ⇒ vẫn NTF (không được vá quá tay).
 *  3. Lá khai NG ⇒ NG.
 *  4. Cột báo cáo (`totalPoints`/`okCount`/`ngCount`) VẪN khớp `overallResult`
 *     sau khi công thức đổi — và không còn `!p.result ||` sót lại ở BẤT KỲ
 *     chỗ nào trong router (census nguồn — bắt cả hai vị trí :850 VÀ :1093
 *     bằng MỘT phép đo, không chỉ vị trí nuôi verdict).
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279, xem docblock `aoiPackageZipCuaNoiDoi.test.ts` — CÙNG kỹ thuật). Mỗi ca
 * mệnh đề 1-4(a) tạo ĐÚNG MỘT hàng `product_inspections` MỚI (serial riêng) —
 * một lượt chạy đầy đủ file này để lại 4 hàng vĩnh viễn. KHÔNG
 * `DELETE FROM product_inspections … .catch(() => {})` — chỉ dọn
 * `measurement_results`/`inspection_packages`/`package_activity_logs` (KHÔNG
 * WORM) ở `afterAll`. Máy dựng ở `beforeAll` được soft-delete qua
 * `db.deleteMachine` (UPDATE `isActive=false`, không phải DELETE).
 *
 * Đột biến bắt buộc (xem report): hoàn nguyên `!p.result ||` (CẢ HAI vị trí)
 * ⇒ mệnh đề 1 VÀ census mệnh đề 4(b) phải ĐỎ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  productInspections,
  measurementResults,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG78-PKG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG78-PKG-${STAMP}`,
    name: "Pha 1F Task 1 (BG-78) test machine",
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
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg78-pkg-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Ghi một ZIP HỢP LỆ (meta.json + images/) lên đĩa local, trả về packageId đã tạo hàng DB — cùng kỹ thuật `ghiZipHopLeVaTaoGoi` của `aoiPackageZipCuaNoiDoi.test.ts`. */
async function ghiZipHopLeVaTaoGoi(suffix: string, meta: Record<string, unknown>): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG78-PKG-${STAMP}-${suffix}`;
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

describe("BG-78 ⛔ — lá KHÔNG khai result KHÔNG được sinh ra một phán quyết (mệnh đề 1-3, đo bằng SELECT)", () => {
  it("mệnh đề 1: lá KHÔNG khai result + overallResult:'OK' ⇒ header OK (TRƯỚC bản vá: NTF)", async () => {
    const serial = `BG78-SN-${STAMP}-1`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m1", {
      serialNumber: serial,
      productModel: `BG78-PM-${STAMP}`,
      overallResult: "OK",
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        // ★ P2 KHÔNG khai `result` — manifest ảnh, chưa có phán quyết per-point.
        // Hình dạng HỢP LỆ (metaJsonSchema :454 `result` .optional(),
        // package_images.result NULLABLE) — KHÔNG phải "máy khai NTF".
        { pointId: "P2", fileName: "p2.jpg", measuredValue: 2 },
      ],
      // KHÔNG khai `summary` — calculatedSummary (:1093) phải TỰ đếm từ measurements[].
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
    expect(inspRow.overallResult, "SELECT product_inspections.overallResult (header) — lá thiếu result KHÔNG được đếm thành NTF").toBe("OK");
    expect(pkgRow.overallResult, "SELECT inspection_packages.overallResult (package row) cũng phải OK").toBe("OK");
    // Cột báo cáo: 1 OK khai rõ + 1 lá thiếu result (KHÔNG rơi vào ok/ng nào).
    expect(pkgRow.okCount, "SELECT — chỉ đếm lá KHAI RÕ result:'OK'").toBe(1);
    expect(pkgRow.ngCount).toBe(0);
    expect(pkgRow.totalPoints, "SELECT — totalPoints vẫn đếm MỌI lá (kể cả lá thiếu result)").toBe(2);
  });

  it("mệnh đề 2 (CHỐNG-SIẾT-NGƯỢC): lá khai NTF THẬT ⇒ vẫn NTF — không được vá quá tay thành 'không bao giờ NTF'", async () => {
    const serial = `BG78-SN-${STAMP}-2`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m2", {
      serialNumber: serial,
      productModel: `BG78-PM-${STAMP}`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        // ★ P2 khai NTF THẬT — không phải lá thiếu result.
        { pointId: "P2", fileName: "p2.jpg", result: "NTF", measuredValue: 2 },
      ],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT — lá khai NTF THẬT vẫn phải cuộn thành NTF").toBe("NTF");
    expect(pkgRow.overallResult).toBe("NTF");
  });

  it("mệnh đề 3: lá khai NG ⇒ NG (kể cả khi có lá khác thiếu result)", async () => {
    const serial = `BG78-SN-${STAMP}-3`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m3", {
      serialNumber: serial,
      productModel: `BG78-PM-${STAMP}`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "NG", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", measuredValue: 2 }, // thiếu result
      ],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT — máy khai NG phải luôn thắng").toBe("NG");
    expect(pkgRow.overallResult).toBe("NG");
  });
});

describe("BG-78 ⛔ — mệnh đề 4: cột báo cáo khớp overallResult, cả hai vị trí (:850 + :1093) cùng công thức", () => {
  it("mệnh đề 4a (SELECT): OK + NTF-thật + lá-thiếu-result (KHÔNG NG) ⇒ overall NTF, okCount/ngCount/totalPoints khớp đếm tay", async () => {
    const serial = `BG78-SN-${STAMP}-4a`;
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("m4a", {
      serialNumber: serial,
      productModel: `BG78-PM-${STAMP}`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "NTF", measuredValue: 2 }, // NTF thật
        { pointId: "P3", fileName: "p3.jpg", measuredValue: 3 }, // thiếu result
      ],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    // ngCount=0, có 1 NTF thật ⇒ overall NTF (NTF nghiêm trọng hơn OK, không có NG để cuộn nặng hơn).
    expect(inspRow.overallResult, "SELECT header — 1 NTF thật, 0 NG ⇒ NTF").toBe("NTF");
    expect(pkgRow.overallResult, "SELECT package row — khớp header, không còn 'hai cột cùng hàng bất đồng'").toBe(inspRow.overallResult);
    expect(pkgRow.okCount, "SELECT — đếm tay: 1 lá khai OK").toBe(1);
    expect(pkgRow.ngCount, "SELECT — đếm tay: 0 lá khai NG").toBe(0);
    expect(pkgRow.totalPoints, "SELECT — totalPoints đếm MỌI lá kể cả lá thiếu result").toBe(3);
  });

  // Census nguồn — bắt CẢ HAI vị trí (:850 ngNtfThat VÀ :1093 calculatedSummary)
  // bằng MỘT phép đo duy nhất, kể cả vị trí (:1093) không đổi verdict trực
  // tiếp nên mệnh đề 1 KHÔNG chạm tới nếu chỉ nó bị bỏ sót lúc vá.
  it("mệnh đề 4b (census): KHÔNG còn biểu thức `!p.result ||` (dạng cũ) Ở MÃ THẬT (loại trừ dòng chú thích — docblock của bản vá này TỰ TRÍCH nguyên văn biểu thức cũ để giải thích, không được tính là 'còn sót')", () => {
    const SOURCE_PATH = join(__dirname, "aoiPackageRouter.ts");
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source.length, "chống đọc-file-rỗng").toBeGreaterThan(1000);
    // Bỏ MỌI dòng chú thích `//…` (kể cả chú thích cuối dòng) trước khi soi —
    // file không chứa chuỗi `http://`/`https://` (đã xác nhận bằng grep) nên
    // cắt tại `//` đầu tiên trên mỗi dòng an toàn ở đây. ⚠ File dùng CRLF —
    // chuẩn hoá `\r\n` → `\n` TRƯỚC khi split, nếu không `$` (cuối dòng) không
    // khớp trước `\r` còn sót và `.replace` câm lặng KHÔNG cắt được gì (tự bắt
    // khi viết ca này: census vẫn đỏ dù dòng chú thích rõ ràng bắt đầu `//`).
    const maChiThat = source
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((dong) => dong.replace(/\/\/.*$/, ""))
      .join("\n");
    const soLanConSot = (maChiThat.match(/!p\.result\s*\|\|/g) ?? []).length;
    expect(soLanConSot, "BG-78: cả :850 (ngNtfThat.ntf) và :1093 (calculatedSummary.ntf) phải KHÔNG còn coi lá-thiếu-result là NTF, TRÊN MÃ THẬT").toBe(0);
  });
});
