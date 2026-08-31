/**
 * Pha 1F Task 5 (BG-82 ⛔, review lượt 7 C-1) — `correctResult` ĐẢO NGƯỢC bản vá
 * Task 1 (BG-78).
 *
 * Gốc rễ: `measurement_results.result` là NOT NULL nên một lá KHÔNG khai
 * `result` vẫn bị `aoiPackageRouter.ts` (hàm `buildRecord`) ép ghi "NTF" — Task 1
 * (Pha 1F) đã sửa HEADER (`ngNtfThat`, đọc payload thô) để KHÔNG coi lá đó là NTF
 * ở thời điểm ingest. Nhưng `inspectionRouters.ts` (`correctResult`) TÍNH LẠI
 * header từ chính cột `result` của `measurement_results` mỗi khi một kiểm định
 * viên sửa MỘT điểm — và trước bản vá này, nó tin mù quáng cột đó:
 *   `hasNTF = allResults.some(r => r.result === "NTF")`
 * Cột đọc ra "NTF" cho CẢ HAI trường hợp (máy khai NTF thật / máy không khai gì
 * cả) — sau khi Task 1 đã tách được hai trường hợp đó ở TẦNG HEADER, chúng lại
 * bị GỘP LÀM MỘT ở tầng hàng. Hệ quả: kiểm định viên sửa MỘT điểm (khác) thành
 * OK khiến các lá "bị ép NTF" còn lại (chưa ai đụng tới) vẫn đọc `result==="NTF"`
 * ⇒ header bị lật OK→NTF — một thao tác chất lượng BÌNH THƯỜNG làm hồ sơ XẤU ĐI,
 * ghi vào bảng WORM (`product_inspections`). Và `ntfSource` vẫn NULL ⇒ NTF mà
 * không máy nào lẫn người nào khai — phá bất biến BG-41.
 *
 * Bản vá (Pha 1F Task 5): tái dùng hai cột PHỤ có sẵn từ Pha 1A/1B
 * (`measurement_results.ntf`/`.ntfSource`, cùng quy ước `ingestCayKetQua.ts`)
 * làm TÍN HIỆU phân biệt "NTF thật" (`ntfSource` khác NULL) với "NTF bị ép"
 * (`ntfSource` NULL) — KHÔNG cần migration:
 *   - `aoiPackageRouter.ts` (`buildRecord`) ghi `ntfSource='machine'` CHỈ khi
 *     máy THẬT SỰ khai `result:"NTF"`; NULL khi lá không khai gì.
 *   - `inspectionRouters.ts` (`correctResult`) ghi `ntfSource='human'` khi
 *     NGƯỜI sửa một điểm thành NTF, và XOÁ (null) khi sửa sang giá trị khác —
 *     rồi chỉ tính một dòng vào `hasNTF` khi `ntfSource !== null`.
 *   - Header (`product_inspections.ntfSource`) được TÍNH LẠI mỗi lượt sửa
 *     ('machine'/'human'/'both'), KHÔNG BAO GIỜ để NULL khi `overallResult`
 *     là NTF — mở rộng bất biến BG-41 sang `correctResult`.
 *
 * Bốn mệnh đề (đo bằng SELECT sau THAO TÁC THẬT — thao tác qua router thật,
 * KHÔNG dùng fixture viết tay giả lập trạng thái DB):
 *  1. Gói lá thiếu `result` ⇒ header OK; correctResult sửa MỘT lá (đang bị ép
 *     NTF) thành OK ⇒ header VẪN OK (trước bản vá: lật sang NTF).
 *  2. CHỐNG HỒI QUY: lá khai NTF THẬT ⇒ correctResult một điểm KHÁC vẫn suy ra
 *     header NTF đúng (không bị vá quá tay thành "không bao giờ NTF").
 *  3. CHỐNG HỒI QUY: lá khai NG ⇒ header NG; correctResult sửa thành OK ⇒
 *     header xuống OK đúng (hasNG không bị đụng bởi bản vá này).
 *  4. `ntfSource` nhất quán: header bị correctResult ĐƯA sang NTF phải có
 *     nguồn ('human'), không bao giờ NULL.
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279). Mỗi mệnh đề tạo ĐÚNG MỘT hàng `product_inspections` MỚI (serial
 * riêng) — một lượt chạy đầy đủ file này để lại 4 hàng vĩnh viễn. KHÔNG
 * `DELETE FROM product_inspections … .catch(() => {})` — chỉ dọn
 * `measurement_results`/`inspection_packages`/`package_activity_logs`/
 * `measurement_corrections`/`ai_label_queue` (KHÔNG WORM) ở `afterAll`.
 *
 * Đột biến bắt buộc (xem task-5-report.md): hoàn nguyên đoạn lọc `ntfSource`
 * trong `hasNTF` (`inspectionRouters.ts`) về `r.result === "NTF"` trần trụi ⇒
 * mệnh đề 1 phải ĐỎ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import { measurementResultRouter } from "./inspectionRouters";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  productInspections,
  measurementResults,
  measurementCorrections,
  aiLabelQueue,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG82-PKG-${STAMP}`;
const SERIAL_PREFIX = `BG82-SN-${STAMP}`;
const PRODUCT_PREFIX = `BG82-PM-${STAMP}`;
// id giả lập cho `qualityProcedure` — KHÔNG cần tồn tại thật trong bảng `users`
// (`chanKhiPhaiDoiMatKhau` SELECT theo id, không thấy hàng nào ⇒ coi như không
// bị chặn — cùng kỹ thuật `measurementCorrections.test.ts` (TEST_USER_ID=970101)).
const QC_USER_ID = 900_000 + (STAMP % 90_000);
const qcUser = {
  id: QC_USER_ID,
  name: `BG82 QC Tester ${STAMP}`,
  role: "quality_inspector",
  twoFactorEnabled: true,
};

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG82-PKG-${STAMP}`,
    name: "Pha 1F Task 5 (BG-82) test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(aiLabelQueue).where(inArray(aiLabelQueue.inspectionId, inspectionIds));
      await d.delete(measurementCorrections).where(inArray(measurementCorrections.inspectionId, inspectionIds));
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
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg82-pkg-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Ghi một ZIP HỢP LỆ (meta.json + images/) lên đĩa local, trả về packageId đã tạo hàng DB — cùng kỹ thuật `aoiPackageZipKetQuaVangMat.test.ts`. */
async function ghiZipHopLeVaTaoGoi(suffix: string, meta: Record<string, unknown>): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG82-PKG-${STAMP}-${suffix}`;
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

/** Commit một gói qua `aoiPackageRouter` thật, trả về inspectionId (đăng ký vào sổ dọn dẹp). */
async function commitVaLayInspectionId(packageId: string): Promise<number> {
  const caller = aoiPackageRouter.createCaller({ user: null } as never);
  const ket = await caller.commit({ apiKey: API_KEY, packageId });
  const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
  expect(inspectionId, "phải tạo được inspection mới (serialNumber mới hoàn toàn)").toBeTruthy();
  inspectionIds.push(inspectionId!);
  return inspectionId!;
}

const qcCaller = measurementResultRouter.createCaller({ user: qcUser } as never);

describe("BG-82 ⛔ — correctResult KHÔNG được lật header do các lá NTF-bị-ép chưa ai đụng tới", () => {
  it("mệnh đề 1: gói lá thiếu result ⇒ header OK; correctResult sửa MỘT lá (đang bị ép NTF) thành OK ⇒ header VẪN OK (TRƯỚC bản vá: lật sang NTF)", async () => {
    const serial = `${SERIAL_PREFIX}-1`;
    const { packageId } = await ghiZipHopLeVaTaoGoi("m1", {
      serialNumber: serial,
      productModel: `${PRODUCT_PREFIX}-1`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", measuredValue: 1 }, // thiếu result
        { pointId: "P2", fileName: "p2.jpg", measuredValue: 2 }, // thiếu result
      ],
    });
    const inspectionId = await commitVaLayInspectionId(packageId);

    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(truoc.overallResult, "TRƯỚC correctResult — header OK (bản vá Task 1)").toBe("OK");
    expect(truoc.ntfSource).toBeNull();

    const rows = await db.getMeasurementResultsByInspection(inspectionId);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.result, `lá ${r.pointCode} bị ép result='NTF' (cột NOT NULL)`).toBe("NTF");
      expect(r.ntfSource, `lá ${r.pointCode} KHÔNG có nguồn — máy không khai (buildRecord)`).toBeNull();
    }
    const p1 = rows.find((r) => r.pointCode === "P1")!;
    const p2 = rows.find((r) => r.pointCode === "P2")!;

    const ketSua = await qcCaller.correctResult({
      id: p1.id,
      result: "OK",
      reason: "Kiểm tra lại bằng mắt, điểm này đạt",
    });
    expect(ketSua.newOverallResult, "correctResult trả về đúng header mới").toBe("OK");

    const [sau] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(
      sau.overallResult,
      "SAU correctResult — header VẪN OK (BG-82: TRƯỚC bản vá lật sang NTF vì lá P2 chưa đụng tới vẫn đọc result='NTF')",
    ).toBe("OK");
    expect(sau.ntfSource, "không NTF ⇒ không nguồn").toBeNull();

    // P2 chưa ai đụng tới — VẪN mang result='NTF' bị ép, chứng minh header
    // không còn tin mù quáng cột result của các lá KHÁC.
    const [p2Sau] = await d.select().from(measurementResults).where(eq(measurementResults.id, p2.id));
    expect(p2Sau.result, "P2 chưa bị sửa — vẫn giữ nguyên giá trị bị ép").toBe("NTF");
    expect(p2Sau.ntfSource).toBeNull();
  });

  it("mệnh đề 2 (CHỐNG HỒI QUY): lá khai NTF THẬT ⇒ correctResult một điểm KHÁC (NG→OK) vẫn suy ra header NTF đúng", async () => {
    const serial = `${SERIAL_PREFIX}-2`;
    const { packageId } = await ghiZipHopLeVaTaoGoi("m2", {
      serialNumber: serial,
      productModel: `${PRODUCT_PREFIX}-2`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "NG", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "NTF", measuredValue: 2 }, // NTF THẬT
      ],
    });
    const inspectionId = await commitVaLayInspectionId(packageId);

    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(truoc.overallResult, "ingest — NG thắng NTF (verdictXauHon)").toBe("NG");

    const rows = await db.getMeasurementResultsByInspection(inspectionId);
    const p1 = rows.find((r) => r.pointCode === "P1")!;
    const p2 = rows.find((r) => r.pointCode === "P2")!;
    expect(p2.result).toBe("NTF");
    expect(p2.ntfSource, "lá khai NTF THẬT ⇒ nguồn 'machine' (buildRecord)").toBe("machine");

    const ketSua = await qcCaller.correctResult({
      id: p1.id,
      result: "OK",
      reason: "NG giả, board thực ra đạt",
    });
    expect(
      ketSua.newOverallResult,
      "hết NG ⇒ header rơi xuống NTF THẬT còn lại (P2), KHÔNG rơi xuống OK — không được vá quá tay",
    ).toBe("NTF");

    const [sau] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(sau.overallResult).toBe("NTF");
    expect(sau.ntfSource, "nguồn NTF của header = 'machine' (P2 chưa ai đụng tới)").toBe("machine");
  });

  it("mệnh đề 3 (CHỐNG HỒI QUY): lá khai NG ⇒ header NG; correctResult sửa thành OK ⇒ header xuống OK đúng", async () => {
    const serial = `${SERIAL_PREFIX}-3`;
    const { packageId } = await ghiZipHopLeVaTaoGoi("m3", {
      serialNumber: serial,
      productModel: `${PRODUCT_PREFIX}-3`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "NG", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "OK", measuredValue: 2 },
      ],
    });
    const inspectionId = await commitVaLayInspectionId(packageId);

    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(truoc.overallResult).toBe("NG");

    const rows = await db.getMeasurementResultsByInspection(inspectionId);
    const p1 = rows.find((r) => r.pointCode === "P1")!;

    const ketSua = await qcCaller.correctResult({ id: p1.id, result: "OK", reason: "Kiểm tra lại đạt" });
    expect(ketSua.newOverallResult).toBe("OK");

    const [sau] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(sau.overallResult).toBe("OK");
    expect(sau.ntfSource, "không còn NTF ⇒ nguồn phải về NULL, không được đứng lại lỗi thời").toBeNull();
  });

  it("mệnh đề 4: ntfSource nhất quán — header bị correctResult ĐƯA sang NTF phải có nguồn ('human'), không bao giờ NULL", async () => {
    const serial = `${SERIAL_PREFIX}-4`;
    const { packageId } = await ghiZipHopLeVaTaoGoi("m4", {
      serialNumber: serial,
      productModel: `${PRODUCT_PREFIX}-4`,
      measurements: [
        { pointId: "P1", fileName: "p1.jpg", result: "OK", measuredValue: 1 },
        { pointId: "P2", fileName: "p2.jpg", result: "OK", measuredValue: 2 },
      ],
    });
    const inspectionId = await commitVaLayInspectionId(packageId);

    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(truoc.overallResult).toBe("OK");
    expect(truoc.ntfSource).toBeNull();

    const rows = await db.getMeasurementResultsByInspection(inspectionId);
    const p1 = rows.find((r) => r.pointCode === "P1")!;

    const ketSua = await qcCaller.correctResult({
      id: p1.id,
      result: "NTF",
      reason: "Không xác định được, cần đo lại",
    });
    expect(ketSua.newOverallResult).toBe("NTF");

    const [sau] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId));
    expect(sau.overallResult).toBe("NTF");
    expect(sau.ntfSource, "header NTF do NGƯỜI sửa ⇒ nguồn 'human', KHÔNG NULL (bất biến BG-41 mở rộng)").toBe("human");

    const [p1Sau] = await d.select().from(measurementResults).where(eq(measurementResults.id, p1.id));
    expect(p1Sau.ntfSource, "dòng vừa sửa cũng phải mang nguồn 'human'").toBe("human");
  });
});
