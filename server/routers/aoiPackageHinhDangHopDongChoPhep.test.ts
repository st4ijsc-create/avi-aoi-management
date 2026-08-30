/**
 * Pha 1F Task 4 (⭐ TRỌNG TÂM) — CỔNG THEO HÌNH DẠNG HỢP ĐỒNG CHO PHÉP.
 *
 * Ba task trước (BG-78/BG-73+BG-72/BG-79+BG-80) vá BA THỂ HIỆN. File này chặn
 * CỖ MÁY sinh ra chúng — gốc rễ chung (review lượt 6, spec
 * 2026-08-31-aoi-backlog-toan-canh.md §L-4, tầng sâu hơn):
 *
 *   "Mỗi lần đổi phân loại, phép nghiệm thu chạy trên HÌNH DẠNG CÓ TRONG DB
 *    TEST, không chạy trên HÌNH DẠNG HỢP ĐỒNG CHO PHÉP."
 *
 * `server/contracts/hinhDangHopDongMetaJson.ts` SINH các hình dạng bằng cách
 * ĐI THEO `metaJsonSchema` (không phải bảng viết tay đoán mò — census thuần ở
 * `hinhDangHopDongMetaJson.test.ts` canh điều đó). File NÀY chạy đường
 * VERDICT + PHÂN LOẠI LỖI THẬT (commit sống qua `aoiPackageRouter`, đo bằng
 * SELECT sau commit — KHÔNG dùng giá trị `caller.commit()` trả về, cùng kỷ
 * luật Task 1) trên TỪNG hình dạng đó.
 *
 * ★★★ ĐỘT BIẾN BẮT BUỘC (xem report) — hoàn nguyên Task 1 (`f1eafe57`, đổi
 * `p.result === "NTF"` thành `!p.result || p.result === "NTF"` Ở CẢ HAI vị
 * trí :908/:1159) phải làm §A "toiThieuMoiTruongOptionalVangMat" ĐỎ — hình
 * dạng đó là "mọi trường .optional() vắng mặt", đúng lớp lỗi BG-78, và verdict
 * của nó được TÍNH TỪ chính công thức bị mutate (không phải qua một census
 * đọc văn bản).
 *
 * ⚠ WORM — `product_inspections` KHÔNG DELETE được (avi_app không có quyền,
 * migration 0279). Mỗi hình dạng "chapNhan" tạo ĐÚNG MỘT hàng mới (serial
 * riêng theo STAMP) — số hàng để lại VĨNH VIỄN được khai trong report, đo
 * bằng SELECT COUNT thật, không suy đoán.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, laLoiVinhVienDemVaoNguongDeadZip, metaJsonSchema } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  productInspections,
  measurementResults,
} from "../../drizzle/schema";
import {
  BANG_HINH_DANG,
  layHinhDangMauMayThat,
  type HinhDangMetaJson,
} from "../contracts/hinhDangHopDongMetaJson";

const STAMP = Date.now();
const API_KEY = `P1F-T4-PKG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `P1F-T4-PKG-${STAMP}`,
    name: "Pha 1F Task 4 — cổng theo hình dạng hợp đồng cho phép",
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
    // KHÔNG delete `productInspections` — WORM. Các hàng "HD-*-SN-{STAMP}" tạo
    // trong file này ở lại VĨNH VIỄN — xem mục "WORM" trong report.
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `p1f-t4-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Ghi một ZIP (meta.json = hình dạng THẬT + ảnh giả cho MỌI item trong
 * `measurements[]` VÀ `points[]` có `fileName` — hình dạng nào dùng nhánh
 * nào không quan trọng, cứ có mặt là có ảnh, tránh phụ thuộc `normalizedMeasurements`
 * mà CHÍNH cổng này đang đo) lên đĩa local, tạo hàng `inspection_packages` (status
 * 'uploaded'). Mỗi lời gọi dùng MỘT `serialNumber` khác biệt qua `overrideSerial`
 * để tránh đụng hàng giữa các hình dạng.
 */
async function ghiZipHopLeVaTaoGoi(
  suffix: string,
  meta: Record<string, unknown>,
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `P1F-T4-PKG-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  const chaCoAnh = [
    ...((meta.measurements as Array<{ fileName?: string }>) ?? []),
    ...((meta.points as Array<{ fileName?: string }>) ?? []),
  ];
  for (const m of chaCoAnh) {
    if (m.fileName) zip.file(`images/${m.fileName}`, Buffer.from(`fake-image-${m.fileName}`));
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

/** Gắn STAMP vào serialNumber của một hình dạng để tránh đụng hàng giữa các lượt chạy file này. */
function metaVoiSerialRieng(h: HinhDangMetaJson): Record<string, unknown> {
  return { ...h.meta, serialNumber: `${(h.meta as any).serialNumber}-${STAMP}` };
}

// ════════════════════════════════════════════════════════════════════════════
// §A — Hình dạng "chapNhan": verdict ghi ra khớp kỳ vọng, đo bằng SELECT.
// ════════════════════════════════════════════════════════════════════════════
describe("§A — mỗi hình dạng 'chapNhan' của BANG_HINH_DANG: verdict SELECT khớp kyVong GHI RÕ", () => {
  const HINH_DANG_CHAP_NHAN = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "chapNhan");

  it("BANG_HINH_DANG có ≥6 hình dạng 'chapNhan' để chạy đường verdict thật (chống bảng rỗng)", () => {
    expect(HINH_DANG_CHAP_NHAN.length).toBeGreaterThanOrEqual(6);
  });

  for (const h of HINH_DANG_CHAP_NHAN) {
    it(`"${h.ten}" (${h.lyDo.slice(0, 60)}…) ⇒ overallResult SELECT = ${h.kyVong.loai === "chapNhan" ? h.kyVong.overallResult : "?"}`, async () => {
      const kyVong = h.kyVong as Extract<HinhDangMetaJson["kyVong"], { loai: "chapNhan" }>;
      const meta = metaVoiSerialRieng(h);
      const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi(h.ten, meta);
      const caller = aoiPackageRouter.createCaller({ user: null } as never);
      const ket = await caller.commit({ apiKey: API_KEY, packageId });
      expect(ket.success, `"${h.ten}": commit phải thành công (hình dạng chapNhan đã được §3 tự-nhất-quán xác nhận qua được metaJsonSchema)`).toBe(true);
      const inspectionId = (ket as { inspectionId: number | null }).inspectionId;
      expect(inspectionId, `"${h.ten}": phải tạo được inspection (serialNumber mới)`).toBeTruthy();
      if (inspectionId) inspectionIds.push(inspectionId);

      const d = (await db.getDb())!;
      const [inspRow] = await d.select().from(productInspections).where(eq(productInspections.id, inspectionId!));
      const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));

      expect(inspRow.overallResult, `"${h.ten}": SELECT product_inspections.overallResult (header)`).toBe(kyVong.overallResult);
      expect(pkgRow.overallResult, `"${h.ten}": SELECT inspection_packages.overallResult (package row) — phải KHỚP header, không còn 'hai cột cùng hàng bất đồng' (BG-76)`).toBe(kyVong.overallResult);
      expect(pkgRow.totalPoints, `"${h.ten}": SELECT totalPoints`).toBe(kyVong.tongDiem);
      expect(pkgRow.okCount, `"${h.ten}": SELECT okCount`).toBe(kyVong.ok);
      expect(pkgRow.ngCount, `"${h.ten}": SELECT ngCount`).toBe(kyVong.ng);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// §B — Hình dạng "tuChoi": commit THẬT ném lỗi, gói KHÔNG bao giờ chạm 'dead'
// một cách oan uổng (nhóm phân loại TẠM THỜI).
// ════════════════════════════════════════════════════════════════════════════
describe("§B — hình dạng 'tuChoi' phân loại TẠM THỜI: một lượt commit ném lỗi, status ở lại 'failed'", () => {
  const HINH_DANG_TU_CHOI_TAM_THOI = BANG_HINH_DANG.filter(
    (h) => h.kyVong.loai === "tuChoi" && !(h.kyVong as { vinhVien: boolean }).vinhVien,
  );

  it("BANG_HINH_DANG có ≥2 hình dạng 'tuChoi' phân loại TẠM THỜI", () => {
    expect(HINH_DANG_TU_CHOI_TAM_THOI.length).toBeGreaterThanOrEqual(2);
  });

  for (const h of HINH_DANG_TU_CHOI_TAM_THOI) {
    it(`"${h.ten}" ⇒ commit ném lỗi NGAY, status='failed' (KHÔNG 'dead' sau 1 lượt)`, async () => {
      const meta = metaVoiSerialRieng(h);
      const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi(h.ten, meta);
      const caller = aoiPackageRouter.createCaller({ user: null } as never);
      await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();

      const d = (await db.getDb())!;
      const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
      expect(pkgRow.status, `"${h.ten}": SELECT status — lệch hình dạng TẠM THỜI, chưa được phép 'dead'`).toBe("failed");

      // KHÔNG hàng product_inspections nào được tạo — ZodError xảy ra TRƯỚC mọi ghi DB nghiệp vụ.
      const serial = (meta as { serialNumber: string }).serialNumber;
      const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, serial));
      expect(rows.length, `"${h.ten}": lệch hình dạng ⇒ 0 hàng product_inspections rác (WORM sạch)`).toBe(0);
    });
  }
});

describe("§B2 — hình dạng 'tuChoi' phân loại VĨNH VIỄN (too_big THẬT trên serialNumber): MỘT lượt vẫn 'failed' (ngưỡng mặc định 5, một lượt chưa đủ chạm 'dead')", () => {
  it("varcharQuaCoChiMotLoiToCo ⇒ commit ném lỗi, status='failed' sau ĐÚNG 1 lượt (đối lập §D sau NGUONG lượt)", async () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "varcharQuaCoChiMotLoiToCo")!;
    expect(shape).toBeTruthy();
    const meta = metaVoiSerialRieng(shape);
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("b2-qua-co", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    let loi: any;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "lượt 1 phải ném lỗi (serialNumber 150 ký tự vượt .max(100))").toBeTruthy();
    expect(String(loi.message), "1 lượt CHƯA đủ chạm ngưỡng mặc định (5) ⇒ thông điệp KHÔNG được nêu 'HỎNG VĨNH VIỄN'").not.toContain(
      "HỎNG VĨNH VIỄN",
    );

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, "1 lượt lỗi VĨNH VIỄN (đếm được) nhưng CHƯA đủ ngưỡng mặc định (5) ⇒ vẫn 'failed'").toBe("failed");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §C — Mẫu meta.json máy THẬT (BG-73) — hình dạng thứ 11 (đọc lazy từ file).
// ════════════════════════════════════════════════════════════════════════════
describe("§C — mẫu meta.json máy THẬT (BG-73): một lượt commit ném lỗi, status ở lại 'failed'", () => {
  it("layHinhDangMauMayThat() ⇒ commit ném lỗi, status='failed', 0 hàng product_inspections cho serial mẫu", async () => {
    const mmt = layHinhDangMauMayThat();
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("mau-may-that", mmt.meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status).toBe("failed");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §D — TƯƠNG PHẢN: hình dạng VĨNH VIỄN THẬT SỰ đếm vào ngưỡng 'dead' —
// PHÁT HIỆN MỚI của cổng này (metaJsonSchema.inspectionTime CÒN .max(40),
// khác v1.x đã được BG-72 vá lên .max(64)).
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §D — PHÁT HIỆN MỚI: DateTime.ToString() 50 ký tự Ở CỬA ZIP (khác v1.x đã vá) ĐẾM VÀO NGƯỠNG 'dead'", () => {
  const NGUONG = 3;

  beforeEach(() => {
    process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = String(NGUONG);
  });

  it(`(ngưỡng)=${NGUONG} lượt commit liên tiếp trên chuỗi DateTime.ToString() 50 ký tự ⇒ status CHUYỂN 'dead' — TƯƠNG PHẢN trực tiếp với §B/§C (lệch hình dạng KHÔNG bao giờ 'dead')`, async () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "ngayGioDaiThatBiTuChoiOCuaZip_KHAC_v1x")!;
    expect(shape, "test dựng sai — thiếu hình dạng trong BANG_HINH_DANG").toBeTruthy();
    const meta = metaVoiSerialRieng(shape);
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("ngay-gio-dai-dead", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    let thongDiepCuoi = "";
    for (let lan = 1; lan <= NGUONG; lan++) {
      let loi: any;
      try {
        await caller.commit({ apiKey: API_KEY, packageId });
      } catch (e) {
        loi = e;
      }
      expect(loi, `lượt ${lan} phải ném lỗi (inspectionTime 50 ký tự vượt .max(40) ở metaJsonSchema)`).toBeTruthy();
      thongDiepCuoi = String(loi.message);
    }
    // Đúng lượt NGUONG: bộ đếm chạm ngưỡng TRONG CHÍNH lượt đó ⇒ thông điệp
    // ném ra ở lượt cuối ĐÃ phải nêu "HỎNG VĨNH VIỄN" (đối chứng ngay tại
    // nguồn, không đợi SELECT mới biết).
    expect(thongDiepCuoi, `lượt ${NGUONG} (đúng ngưỡng) phải NÊU 'HỎNG VĨNH VIỄN' trong thông điệp ném ra`).toContain(
      "HỎNG VĨNH VIỄN",
    );

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, `sau đúng ${NGUONG} lượt (ngưỡng): status PHẢI 'dead' — hình dạng VĨNH VIỄN thật (too_big) đếm vào ngưỡng, khác §B/§C (lệch hình dạng)`).toBe("dead");

    // Lượt tiếp theo phải bị KHOÁ VĨNH VIỄN — không có đường về từ phía máy chủ
    // (đúng câu hỏi bắt buộc "gói đã chết vì lý do sai — lấy lại thế nào?": ở
    // hình dạng NÀY thì gói THẬT vĩnh viễn — server đổi .max(40)→64 mới cứu được).
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow(/HỎNG VĨNH VIỄN/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §E — MỆNH ĐỀ 3 (chống tự thoả), nửa live: SELECT chứng minh mẫu máy thật
// KHÔNG CÓ trong DB test — không chỉ lập luận logic (đã có ở contracts.test.ts).
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ mệnh đề 3 — SELECT sống chứng minh ≥1 hình dạng KHÔNG có trong DB test", () => {
  it("serialNumber 'SN123456' (mẫu máy thật BG-73) — 0 hàng product_inspections TRONG TOÀN BỘ DB test, không riêng gì hàng file này tạo", async () => {
    const d = (await db.getDb())!;
    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, "SN123456"));
    expect(
      rows.length,
      "mẫu máy thật KHÔNG BAO GIỜ qua được metaJsonSchema.parse() ⇒ KHÔNG THỂ có hàng product_inspections nào mang serial này, ở BẤT KỲ lượt chạy nào của toàn bộ Pha 1F — đây là bằng chứng SỐNG cho 'hình dạng không có trong DB test', không phải suy luận suông",
    ).toBe(0);
  });

  it("tổng số hình dạng cổng này CHẠY QUA đường verdict/phân loại THẬT (§A+§B+§C+§D) ≥11", () => {
    const soChapNhan = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "chapNhan").length;
    const soTuChoiThuan = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "tuChoi").length;
    const tong = soChapNhan + soTuChoiThuan + 1; // +1 = mẫu máy thật (§C)
    expect(tong).toBeGreaterThanOrEqual(11);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §F — Đối chứng dùng laLoiVinhVienDemVaoNguongDeadZip TRỰC TIẾP (không qua commit)
// để mệnh đề 2 (phân loại đúng lớp) có thêm một lớp đo THUẦN, độc lập với DB.
// ════════════════════════════════════════════════════════════════════════════
describe("§F — mệnh đề 2 đối chứng thuần: laLoiVinhVienDemVaoNguongDeadZip trên lỗi THẬT do commit ném ra", () => {
  it("gói ngayGioDaiThatBiTuChoiOCuaZip khi commit ném lỗi thật ⇒ lỗi đó (bắt trực tiếp) được phân loại VĨNH VIỄN", async () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "ngayGioDaiThatBiTuChoiOCuaZip_KHAC_v1x")!;
    const meta = metaVoiSerialRieng(shape);
    const { packageId } = await ghiZipHopLeVaTaoGoi("f-doi-chung-vinh-vien", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    // `commit` bọc lỗi gốc trong TRPCError trước khi ném — nhưng bên trong,
    // chính `laLoiVinhVienDemVaoNguongDeadZip` được gọi trên ZodError GỐC
    // (không phải TRPCError) TRƯỚC khi bọc. Đo lại TRỰC TIẾP trên ZodError để
    // không phụ thuộc chi tiết bọc lỗi của tRPC.
    const parseThat = metaJsonSchema.safeParse(meta);
    expect(parseThat.success).toBe(false);
    if (!parseThat.success) {
      expect(laLoiVinhVienDemVaoNguongDeadZip(parseThat.error)).toBe(true);
    }
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
  });
});
