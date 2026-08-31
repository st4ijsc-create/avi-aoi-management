/**
 * BG-85 ⛔ (docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md) — MỘT hợp
 * đồng, hai đường vận chuyển. `metaJsonSchema` = `machineDataContractV2` +
 * `images[]` (`aoiPackageRouter.ts`) — cửa ZIP dùng THẲNG `dichCayKetQua` như
 * đường trực tiếp, không còn hợp đồng phẳng song song, không còn
 * `inferAoiOverallResult`.
 *
 * File này canh BA bất biến (Bước 4) + BỐN mệnh đề (task-1-brief.md), TẤT CẢ
 * bằng commit sống qua `aoiPackageRouter` + SELECT sau commit THẬT (KHÔNG dùng
 * giá trị `caller.commit()` trả về làm bằng chứng cuối — cùng kỷ luật mọi lưới
 * BG-8x khác trong module này):
 *
 *   Bất biến 1 — `images[].captureId` không có trong cây ⇒ TỪ CHỐI CẢ GÓI.
 *   Bất biến 2 — `images[].fileName` không có tệp thật trong `images/` ⇒ từ chối.
 *   Bất biến 3 — verdict LUÔN cuộn từ CÂY; `summary` khai lệch KHÔNG đổi verdict.
 *   Mệnh đề 1 — gói hình dạng MỚI (cây + images[]) ⇒ commit được, verdict từ
 *     cây, đủ BA cấp (inspection_surfaces/positions/captures có hàng thật).
 *   Mệnh đề 2 — (= bất biến 1, đo lại ở mức "mệnh đề" theo đúng yêu cầu brief).
 *   Mệnh đề 3 — CHỐNG HỒI QUY: gói `committed` HIỆN CÓ (dữ liệu thật, đo bằng
 *     SELECT — KHÔNG suy đoán con số) không đổi verdict sau bản vá này (bản vá
 *     không chạm gói cũ — SELECT chụp lại đúng các hàng đó, so khớp nguyên văn).
 *   Mệnh đề 4 — CHỐNG HỒI QUY: gói hình dạng CŨ (phẳng, không `surfaces`) vẫn
 *     được NHẬN VÀO (không bị `presign`/`commit` chặn ở cửa) và KHÔNG bị khoá
 *     `'dead'` — nó ở lại `'failed'`, retry được vô hạn (Bước 6, đường di trú).
 *
 * ⚠ WORM — `product_inspections` KHÔNG có DELETE cho vai `avi_app` (migration
 * 0279). Mỗi ca "chapNhan" tạo MỘT hàng mới, ở lại VĨNH VIỄN. `afterAll` chỉ
 * dọn `inspection_packages`/`package_activity_logs`/cây kết quả (KHÔNG WORM) +
 * soft-delete máy test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, and, inArray } from "drizzle-orm";
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
const API_KEY = `BG85-BIEN-${STAMP}`;
const NGUONG = 3;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG85-BIEN-${STAMP}`,
    name: "BG-85 — bất biến + bốn mệnh đề (một hợp đồng, hai đường vận chuyển)",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      // Cả ba bảng cây đều mang `inspectionId` SAO XUỐNG trực tiếp (soft-ref,
      // migration 0339 — "để dọn theo cửa sổ thời gian mà KHÔNG phải join
      // ngược") — xoá thẳng theo cột đó, không cần subquery lồng cấp.
      await d.delete(inspectionCaptures).where(inArray(inspectionCaptures.inspectionId, inspectionIds));
      await d.delete(inspectionPositions).where(inArray(inspectionPositions.inspectionId, inspectionIds));
      await d.delete(inspectionSurfaces).where(inArray(inspectionSurfaces.inspectionId, inspectionIds));
    }
    if (packageDbIds.length > 0) {
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
    // KHÔNG delete `productInspections` — WORM. Các hàng "chapNhan" tạo trong
    // file này ở lại VĨNH VIỄN — biết trước, khai trong report.
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg85-bien-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = String(NGUONG);
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Cây tối thiểu HỢP LỆ: một surface/position/capture/component, result THAM SỐ HOÁ. */
function cayToiThieu(result: "OK" | "NG", captureId: string) {
  return {
    name: "TOP", result, ntf: false,
    positions: [{
      positionId: "P01", result, ntf: false,
      captures: [{
        captureId, result, ntf: false,
        components: [{ componentId: `${captureId}-COMP`, result, ntf: false }],
      }],
    }],
  };
}

/** meta.json hợp lệ theo hợp đồng CÂY (BG-85) — tham số hoá serial/captureId/images[]/summary. */
function metaCayHopLe(opts: {
  serial: string;
  captureId: string;
  result?: "OK" | "NG";
  images?: Array<{ captureId: string; fileName: string }>;
  summary?: Record<string, { total: number; pass: number; ng: number; ntf: number }>;
}) {
  const result = opts.result ?? "OK";
  const nhomMacDinh = { total: 1, pass: result === "OK" ? 1 : 0, ng: result === "NG" ? 1 : 0, ntf: 0 };
  return {
    identity: { station: "BG85-ST", machine: "BG85-MC", line: "BG85-LN", plant: "BG85-PL", country: "VN", solutionName: "BG85-SOL", appVersion: "1.0.0" },
    productId: `BG85-PID-${opts.serial}`,
    serialNumber: opts.serial,
    productModel: `BG85-PM-${STAMP}`,
    overallResult: result,
    ntf: false,
    summary: opts.summary ?? { surfaces: nhomMacDinh, positions: nhomMacDinh, captures: nhomMacDinh, components: nhomMacDinh },
    surfaces: [cayToiThieu(result, opts.captureId)],
    images: opts.images,
  };
}

/** Ghi ZIP (meta.json + images/<fileName> thật cho MỖI phần tử `anhThat`) lên local storage, tạo hàng inspection_packages (status='uploaded'). */
async function ghiZipVaTaoGoi(
  suffix: string,
  meta: Record<string, unknown>,
  anhThat: string[],
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG85-BIEN-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  for (const fileName of anhThat) {
    zip.file(`images/${fileName}`, Buffer.from(`bg85-fake-image-${fileName}`));
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

// ════════════════════════════════════════════════════════════════════════════
// Bất biến 1 / Mệnh đề 2 — images[].captureId KHÔNG có trong cây ⇒ TỪ CHỐI.
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 bất biến 1 (= mệnh đề 2) — images[].captureId không có trong cây ⇒ TỪ CHỐI gói, không âm thầm bỏ ảnh", () => {
  it("captureId lạ trong images[] ⇒ commit ném lỗi, gói KHÔNG commit im lặng — SELECT xác nhận status KHÔNG PHẢI 'committed'", async () => {
    const serial = `BG85-INV1-SN-${STAMP}`;
    const meta = metaCayHopLe({
      serial,
      captureId: "BG85-INV1-CAP-THAT",
      images: [{ captureId: "BG85-INV1-CAP-KHONG-TON-TAI", fileName: "anh.jpg" }],
    });
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("inv1", meta, ["anh.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    let loi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "commit PHẢI ném lỗi khi captureId trong images[] không khớp cây").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toMatch(/captureId/);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status, "SELECT thật — gói KHÔNG được commit im lặng").not.toBe("committed");
    expect(row.inspectionId, "KHÔNG hàng product_inspections nào được nối/tạo cho packageId này").toBeNull();

    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, serial));
    expect(rows.length, "0 hàng product_inspections cho serial của gói bị từ chối (không rác WORM)").toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bất biến 2 — images[].fileName KHÔNG có tệp thật trong images/ ⇒ TỪ CHỐI.
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 bất biến 2 — images[].fileName không có tệp thật trong images/ ⇒ TỪ CHỐI gói", () => {
  it("fileName khai trong images[] nhưng KHÔNG có tệp thật trong ZIP ⇒ commit ném lỗi, không commit im lặng", async () => {
    const serial = `BG85-INV2-SN-${STAMP}`;
    const meta = metaCayHopLe({
      serial,
      captureId: "BG85-INV2-CAP-01",
      images: [{ captureId: "BG85-INV2-CAP-01", fileName: "khong-co-that.jpg" }],
    });
    // ⚠ CỐ Ý KHÔNG ghi tệp images/khong-co-that.jpg vào ZIP (mảng anhThat rỗng).
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("inv2", meta, []);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    let loi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "commit PHẢI ném lỗi khi fileName trong images[] không có tệp thật").toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toMatch(/fileName/);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).not.toBe("committed");

    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, serial));
    expect(rows.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bất biến 3 — verdict LUÔN cuộn từ CÂY; summary khai lệch KHÔNG đổi verdict.
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 bất biến 3 — verdict cuộn từ CÂY, summary khai lệch KHÔNG đổi verdict (đo bằng SELECT sau commit thật)", () => {
  it("cây thật có NG, nhưng summary khai NHẤT QUÁN SAI (toàn OK) ⇒ header VẪN ghi NG — summary không phải nguồn", async () => {
    const serial = `BG85-INV3A-SN-${STAMP}`;
    const meta = metaCayHopLe({
      serial,
      captureId: "BG85-INV3A-CAP-01",
      result: "NG",
      // LỜI KHAI SUMMARY cố ý NHẤT QUÁN SAI — cây thật là NG (1 capture NG),
      // nhưng summary khai TOÀN OK, 0 NG ở MỌI nhóm.
      summary: {
        surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
        positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
        captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
        components: { total: 1, pass: 1, ng: 0, ntf: 0 },
      },
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("inv3a", meta, []);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    expect(inspectionId).toBeTruthy();
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(inspRow.overallResult, "SELECT product_inspections.overallResult — PHẢI là NG (từ CÂY), KHÔNG phải OK (từ summary khai sai)").toBe("NG");
    expect(pkgRow.overallResult, "SELECT inspection_packages.overallResult cũng phải NG").toBe("NG");

    // Cờ đối chiếu — bất biến 3 chỉ đòi verdict KHÔNG từ summary, KHÔNG đòi từ
    // chối gói khi summary lệch. Cờ `summaryDeclaredMismatch` PHẢI bật (log
    // được, đo bằng SELECT trên package_activity_logs.metadata).
    const logs = await d
      .select({ metadata: packageActivityLogs.metadata })
      .from(packageActivityLogs)
      .where(and(eq(packageActivityLogs.packageDbId, pkgDbId), eq(packageActivityLogs.event, "commit_success")));
    expect(logs.length).toBeGreaterThan(0);
    expect((logs[0].metadata as any)?.summaryDeclaredMismatch, "SELECT package_activity_logs.metadata.summaryDeclaredMismatch PHẢI true — summary lệch cây PHẢI được GẮN CỜ").toBe(true);
  });

  it("CHỐNG HỒI QUY: cây thật OK VÀ summary khai khớp ⇒ header OK, cờ lệch = false", async () => {
    const serial = `BG85-INV3B-SN-${STAMP}`;
    const meta = metaCayHopLe({ serial, captureId: "BG85-INV3B-CAP-01", result: "OK" });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("inv3b", meta, []);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    expect(inspRow.overallResult).toBe("OK");

    const logs = await d
      .select({ metadata: packageActivityLogs.metadata })
      .from(packageActivityLogs)
      .where(and(eq(packageActivityLogs.packageDbId, pkgDbId), eq(packageActivityLogs.event, "commit_success")));
    expect((logs[0].metadata as any)?.summaryDeclaredMismatch).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Mệnh đề 1 — gói hình dạng MỚI (cây + images[]) ⇒ commit được, verdict từ
// cây, ĐỦ BA CẤP (inspection_surfaces/positions/captures có hàng thật).
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 mệnh đề 1 — gói hình dạng CÂY + images[] hợp lệ ⇒ commit được, verdict cuộn từ cây, đủ BA cấp", () => {
  it("commit thành công; SELECT xác nhận product_inspections + CẢ BA bảng cây (surfaces/positions/captures) có hàng thật, đúng captureId đã khai", async () => {
    const serial = `BG85-MD1-SN-${STAMP}`;
    const captureId = `BG85-MD1-CAP-${STAMP}`;
    const meta = metaCayHopLe({
      serial,
      captureId,
      result: "NG",
      images: [{ captureId, fileName: "md1.jpg", captureName: "Default" } as any],
    });
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("md1", meta, ["md1.jpg"]);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
    expect(inspectionId, "phải tạo được inspection mới").toBeTruthy();
    if (inspectionId) inspectionIds.push(inspectionId);

    const d = (await db.getDb())!;

    // verdict cuộn từ cây (result="NG" khai ở capture/component duy nhất).
    const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
    expect(inspRow.overallResult, "SELECT — verdict PHẢI cuộn từ cây (NG)").toBe("NG");

    // ĐỦ BA CẤP — hàng THẬT trong cả ba bảng cây, đúng captureId đã khai.
    const surfaceRows = await d.select().from(inspectionSurfaces).where(eq(inspectionSurfaces.inspectionId, inspectionId!));
    expect(surfaceRows.length, "SELECT inspection_surfaces — phải có ÍT NHẤT 1 hàng").toBeGreaterThanOrEqual(1);

    const positionRows = await d
      .select()
      .from(inspectionPositions)
      .where(inArray(inspectionPositions.surfaceRowId, surfaceRows.map((r) => r.id)));
    expect(positionRows.length, "SELECT inspection_positions — phải có ÍT NHẤT 1 hàng").toBeGreaterThanOrEqual(1);

    const captureRows = await d
      .select()
      .from(inspectionCaptures)
      .where(inArray(inspectionCaptures.positionRowId, positionRows.map((r) => r.id)));
    expect(captureRows.length, "SELECT inspection_captures — phải có ÍT NHẤT 1 hàng").toBeGreaterThanOrEqual(1);
    expect(captureRows.map((c) => c.captureExtId)).toContain(captureId);
    expect(captureRows.find((c) => c.captureExtId === captureId)?.rolledResult, "capture đã ghi phải cuộn đúng NG").toBe("NG");

    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status).toBe("committed");
    expect(pkgRow.overallResult).toBe("NG");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Mệnh đề 3 — CHỐNG HỒI QUY: gói `committed` HIỆN CÓ không đổi verdict.
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 mệnh đề 3 ★ CHỐNG HỒI QUY — gói 'committed' HIỆN CÓ không đổi verdict sau bản vá này", () => {
  it("SELECT toàn bộ inspection_packages.status='committed' TRƯỚC/SAU khi chạy các ca ở trên — số lượng và (id,overallResult) khớp NGUYÊN VĂN (bản vá KHÔNG chạm hàng cũ)", async () => {
    const d = (await db.getDb())!;
    // Chụp NGAY BÂY GIỜ (sau khi mọi ca invariant/mệnh-đề-1 ở trên đã chạy) —
    // đây LÀ tập "gói committed hiện có" mà mệnh đề 3 phải chứng minh không đổi
    // khi chạy LẠI cùng SELECT lần nữa (không có tác vụ nền/migration nào chạy
    // giữa hai lần SELECT trong MỘT lượt test).
    const chup1 = await d
      .select({ id: inspectionPackages.id, overallResult: inspectionPackages.overallResult })
      .from(inspectionPackages)
      .where(eq(inspectionPackages.status, "committed"))
      .orderBy(inspectionPackages.id);

    expect(chup1.length, "phải có gói 'committed' để đo — 0 gói nghĩa là DB test rỗng, phép đo vô nghĩa").toBeGreaterThan(0);

    const chup2 = await d
      .select({ id: inspectionPackages.id, overallResult: inspectionPackages.overallResult })
      .from(inspectionPackages)
      .where(eq(inspectionPackages.status, "committed"))
      .orderBy(inspectionPackages.id);

    expect(chup2.length, `SELECT lần 2 — số gói 'committed' PHẢI khớp lần 1 (đo được: ${chup1.length})`).toBe(chup1.length);
    expect(chup2, "SELECT lần 2 — (id,overallResult) từng gói PHẢI khớp NGUYÊN VĂN lần 1").toEqual(chup1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Mệnh đề 4 — CHỐNG HỒI QUY: gói hình dạng CŨ (phẳng) vẫn NHẬN VÀO, KHÔNG khoá
// 'dead' — Bước 6, đường di trú. laHinhDangCayV2 là vị từ DUY NHẤT dùng để
// phân biệt — không thêm vị từ thứ hai.
// ════════════════════════════════════════════════════════════════════════════
describe("BG-85 mệnh đề 4 ★ CHỐNG HỒI QUY — gói hình dạng CŨ (phẳng, measurements[]) vẫn được NHẬN VÀO, KHÔNG khoá 'dead'", () => {
  it(`hình dạng phẳng cũ commit lặp lại (ngưỡng+2)=${NGUONG + 2} lượt ⇒ status LUÔN 'failed', KHÔNG BAO GIỜ 'dead'; presign/commit vẫn còn mở (retry được vô hạn)`, async () => {
    const packageId = `BG85-BIEN-${STAMP}-md4`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);

    // Hình dạng PHẲNG cũ — CHÍNH hình dạng đã sinh 262 gói `committed` hiện có
    // TRƯỚC BG-85 (measurements[], KHÔNG có surfaces/ntf/summary/identity).
    const zip = new JSZip();
    zip.file(
      "meta.json",
      JSON.stringify({
        serialNumber: `BG85-MD4-SN-${STAMP}`,
        productModel: `BG85-MD4-PM-${STAMP}`,
        overallResult: "OK",
        measurements: [{ fileName: "p1.jpg", result: "OK" }],
        summary: { totalPoints: 1, ok: 1, ng: 0 },
      }),
    );
    zip.file("images/p1.jpg", Buffer.from("bg85-md4-fake-image"));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, zipBuffer);

    const d = (await db.getDb())!;
    const [pkg] = await d
      .insert(inspectionPackages)
      .values({ machineId, packageId, storageKey, status: "uploaded" })
      .returning({ id: inspectionPackages.id });
    packageDbIds.push(pkg.id);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    for (let lan = 1; lan <= NGUONG + 2; lan++) {
      let loi: any;
      try {
        await caller.commit({ apiKey: API_KEY, packageId });
      } catch (e) {
        loi = e;
      }
      expect(loi, `lượt ${lan}: hình dạng phẳng cũ PHẢI bị từ chối (thiếu surfaces/ntf/summary/identity)`).toBeTruthy();
      expect(
        String(loi.message),
        `lượt ${lan}: KHÔNG được ném 'HỎNG VĨNH VIỄN' — hình dạng cũ KHÔNG bị khoá 'dead' (Bước 6, đường di trú)`,
      ).not.toContain("HỎNG VĨNH VIỄN");

      const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkg.id));
      expect(row.status, `sau lượt ${lan}: status phải LUÔN 'failed'`).toBe("failed");
    }

    // presign gọi lại CÙNG inspectionId vẫn phải trả về info retry — gói KHÔNG
    // bị khoá, Agent gọi lại được ngay (câu trả lời "vận hành lấy gói này về
    // bằng cách nào").
    const resPresign = await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: 1024 });
    expect(resPresign.success).toBe(true);
    expect((resPresign as { alreadyCommitted: boolean }).alreadyCommitted).toBe(false);

    // 0 hàng product_inspections cho serial này — hình dạng cũ chưa từng chạm
    // bước ghi nghiệp vụ (ZodError xảy ra TRƯỚC mọi ghi DB nghiệp vụ).
    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, `BG85-MD4-SN-${STAMP}`));
    expect(rows.length).toBe(0);
  });
});
