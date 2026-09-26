/**
 * Pha 1F Task 4 (⭐ TRỌNG TÂM) — CỔNG THEO HÌNH DẠNG HỢP ĐỒNG CHO PHÉP.
 *
 * `server/contracts/hinhDangHopDongMetaJson.ts` SINH các hình dạng bằng cách ĐI
 * THEO `metaJsonSchema` (census THUẦN ở `hinhDangHopDongMetaJson.test.ts` canh
 * điều đó). File NÀY chạy đường VERDICT + PHÂN LOẠI LỖI THẬT (commit sống qua
 * `aoiPackageRouter`, đo bằng SELECT sau commit — KHÔNG dùng giá trị
 * `caller.commit()` trả về làm bằng chứng cuối) trên TỪNG hình dạng đó. Gốc rễ
 * nó chặn (review lượt 6, §L-4):
 *
 *   "Mỗi lần đổi phân loại, phép nghiệm thu chạy trên HÌNH DẠNG CÓ TRONG DB
 *    TEST, không chạy trên HÌNH DẠNG HỢP ĐỒNG CHO PHÉP."
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★★★ KHÔI PHỤC (I-1, review lượt 8) — VÌ SAO FILE NÀY QUAY LẠI
 * ══════════════════════════════════════════════════════════════════════════
 * `df20b31c` (BG-85) XOÁ file này — 345 dòng — trong CÙNG lô đổi hợp đồng, mà
 * BA nơi vẫn trỏ vào nó như "cổng verdict SỐNG" (`hinhDangHopDongMetaJson.ts`
 * ×2, `hinhDangHopDongMetaJson.test.ts` ×1). Hậu quả: kỳ vọng
 * `overallResult`/`tongDiem`/`ok`/`ng` của MỌI hình dạng `chapNhan` — kể cả HAI
 * chiều Đ-21 (`cayRongVaLoiKhaiNgThang` = bo XẤU đi lọt;
 * `cuonTuCayNangHonLoiKhaiOk` = bo TỐT giả) và ca NTF — trở thành VĂN BẢN KHÔNG
 * AI ĐỐI CHIẾU. Census còn lại chỉ kiểm `kyVong.loai` khớp `safeParse` — nó
 * thoái hoá thành census parse thuần, đúng thứ nó được dựng ra để KHÔNG phải là.
 *
 * Bản khôi phục này KHÔNG phải `git revert`: nó viết lại theo hợp đồng ĐÃ HỢP
 * NHẤT.  Ba khác biệt so với bản bị xoá, mỗi cái một lý do đo được:
 *   1. Bộ dựng ZIP ghi ảnh từ `images[]` (hợp đồng CÂY) thay vì
 *      `measurements[]`/`points[]` (hợp đồng PHẲNG đã xoá — hai mảng đó không
 *      còn tồn tại, bộ dựng cũ sẽ luôn ghi 0 ảnh và bất biến 2 sẽ từ chối gói).
 *   2. `images[].sha256` khai trong bảng bị THAY bằng digest THẬT của byte ảnh
 *      mà chính bộ dựng này ghi ra — xem `metaChoGoiThat()`.
 *   3. §E không còn đếm hàng `product_inspections` TOÀN DB cho serial mẫu —
 *      xem docblock §E.
 *
 * ⚠ WORM — `product_inspections` KHÔNG DELETE được (avi_app, migration 0279).
 * Mỗi hình dạng "chapNhan" tạo ĐÚNG MỘT hàng mới, ở lại VĨNH VIỄN.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter, laLoiVinhVienDemVaoNguongDeadZip, metaJsonSchema } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  productInspections,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";
import {
  BANG_HINH_DANG,
  layHinhDangMauMayThat,
  giaTriQuanSatDuoc,
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
    name: "Pha 1F Task 4 — cổng theo hình dạng hợp đồng cho phép (khôi phục I-1)",
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
    // KHÔNG delete `productInspections` — WORM.
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

type AnhKhai = { captureId: string; fileName: string; captureName?: string; sha256?: string };

/** Byte ảnh giả TẤT ĐỊNH cho một `fileName` — cùng công thức ở cả hai chỗ dùng. */
function byteAnhGia(fileName: string): Buffer {
  return Buffer.from(`p1f-t4-fake-image-${fileName}`);
}

/**
 * `meta.json` sẽ ĐƯỢC GHI vào ZIP cho một hình dạng — với `images[].sha256`
 * THAY bằng digest THẬT của byte ảnh mà bộ dựng này ghi ra.
 *
 * ⚠ Vì sao PHẢI thay: `BANG_HINH_DANG` là bảng THUẦN (không fs) nên giá trị
 * `sha256` trong đó chỉ là chuỗi hình-dạng-hợp-lệ (`"a".repeat(64)`), tồn tại
 * để census "đủ đường .optional()" chứng minh trường này CÓ MẶT ĐƯỢC. Bất biến
 * cấp-ảnh của `commit` (BG-87) băm nội dung ảnh THẬT và so — giữ nguyên chuỗi
 * giả sẽ làm gói bị TỪ CHỐI vì một lý do KHÔNG PHẢI thứ cổng này đo (verdict +
 * phân loại lỗi). Phép kiểm `sha256` có cổng RIÊNG của nó
 * (`aoiPackageBaLoToanVenBg87.test.ts` mệnh đề 1, và
 * `aoiPackageSha256PresignKiemThat.test.ts` cho nhánh presign) — không đo hai
 * lần ở hai nơi bằng hai cách khác nhau.
 */
function metaChoGoiThat(meta: Record<string, unknown>): Record<string, unknown> {
  const images = meta.images as AnhKhai[] | undefined;
  if (!Array.isArray(images) || images.length === 0) return meta;
  return {
    ...meta,
    images: images.map((img) =>
      img.sha256
        ? { ...img, sha256: createHash("sha256").update(byteAnhGia(img.fileName)).digest("hex") }
        : img,
    ),
  };
}

/**
 * Ghi một ZIP (meta.json = hình dạng THẬT + MỘT tệp ảnh cho MỖI phần tử
 * `images[]` — bất biến 2 của `commit` đòi `images/<fileName>` tồn tại) lên đĩa
 * local, tạo hàng `inspection_packages` (status 'uploaded').
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
  for (const img of (meta.images as AnhKhai[] | undefined) ?? []) {
    if (img.fileName) zip.file(`images/${img.fileName}`, byteAnhGia(img.fileName));
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

/**
 * Gắn STAMP vào `serialNumber` để hai lượt chạy file này không đụng hàng nhau.
 * ⚠ Serial RỖNG giữ NGUYÊN RỖNG — hình dạng `serialRongVanPhaiGhiDuoc_C1` tồn
 * tại CHÍNH VÌ chuỗi rỗng; gắn STAMP vào đó là xoá mất thứ đang đo. Không cần
 * chống đụng hàng cho ca đó: sổ idempotency hội tụ theo `packageId` (đã có
 * STAMP), và chỉ số tự nhiên `uq_inspection_natural` MIỄN TRỪ serial rỗng.
 */
function metaVoiSerialRieng(h: HinhDangMetaJson): Record<string, unknown> {
  const serial = (h.meta as { serialNumber?: unknown }).serialNumber;
  if (typeof serial !== "string" || serial.trim() === "") return metaChoGoiThat(h.meta);
  return metaChoGoiThat({ ...h.meta, serialNumber: `${serial}-${STAMP}` });
}

// ════════════════════════════════════════════════════════════════════════════
// §A — Hình dạng "chapNhan": verdict + BA cột báo cáo, đo bằng SELECT.
// ════════════════════════════════════════════════════════════════════════════
describe("§A — mỗi hình dạng 'chapNhan' của BANG_HINH_DANG: verdict + cột báo cáo SELECT khớp kyVong GHI RÕ", () => {
  const HINH_DANG_CHAP_NHAN = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "chapNhan");

  it("BANG_HINH_DANG có ≥6 hình dạng 'chapNhan' để chạy đường verdict thật (chống bảng rỗng)", () => {
    expect(HINH_DANG_CHAP_NHAN.length).toBeGreaterThanOrEqual(6);
  });

  for (const h of HINH_DANG_CHAP_NHAN) {
    const kyVongTruoc = h.kyVong as Extract<HinhDangMetaJson["kyVong"], { loai: "chapNhan" }>;
    const giaTriDoDuocKyVong = giaTriQuanSatDuoc(kyVongTruoc.overallResult);
    const ghiChuNo =
      kyVongTruoc.overallResult.dang === "ghiNhanNoDaDuyet"
        ? ` [★ NỢ ĐÃ DUYỆT ${kyVongTruoc.overallResult.maBacklog} — hành vi ĐÚNG là "${kyVongTruoc.overallResult.hanhViDung}", cổng CHỈ khoá hành vi hiện tại, KHÔNG khẳng định nó đúng]`
        : "";
    it(`"${h.ten}" (${h.lyDo.slice(0, 60)}…) ⇒ overallResult SELECT = ${giaTriDoDuocKyVong}${ghiChuNo}`, async () => {
      const kyVong = h.kyVong as Extract<HinhDangMetaJson["kyVong"], { loai: "chapNhan" }>;
      const meta = metaVoiSerialRieng(h);
      const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi(h.ten, meta);
      const caller = aoiPackageRouter.createCaller({ user: null } as never);
      const ket = await caller.commit({ apiKey: API_KEY, packageId });
      expect(ket.success, `"${h.ten}": commit phải thành công (hình dạng chapNhan đã qua metaJsonSchema)`).toBe(true);

      const d = (await db.getDb())!;
      // Tra header bằng SỔ IDEMPOTENCY, không bằng `serialNumber` (một hình dạng
      // của bảng CỐ Ý mang serial RỖNG) và không bằng giá trị `commit()` trả về.
      const inspRows = await d
        .select()
        .from(productInspections)
        .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
      expect(
        inspRows.length,
        `"${h.ten}": MỌI hình dạng hợp đồng CHẤP NHẬN phải ghi được ĐÚNG MỘT hàng product_inspections ` +
          `(bất biến C-1: hợp đồng nhận thì đường ghi phải ghi được)`,
      ).toBe(1);
      const inspRow = inspRows[0];
      inspectionIds.push(inspRow.id);
      const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));

      // ★ Assert bằng `giaTriQuanSatDuoc` — với 'khangDinh' đây LÀ giá trị đúng
      // (lệch = lỗi thật); với 'ghiNhanNoDaDuyet' đây là giá trị SANCTIONED để
      // treo (lệch = hành vi vừa đổi — fix chưa cập nhật kyVong HOẶC hồi quy).
      const giaTriKyVong = giaTriQuanSatDuoc(kyVong.overallResult);
      expect(inspRow.overallResult, `"${h.ten}": SELECT product_inspections.overallResult (header)${ghiChuNo}`).toBe(giaTriKyVong);
      expect(pkgRow.overallResult, `"${h.ten}": SELECT inspection_packages.overallResult — phải KHỚP header (BG-76)`).toBe(giaTriKyVong);
      expect(pkgRow.totalPoints, `"${h.ten}": SELECT totalPoints (đếm CAPTURES từ cây)`).toBe(kyVong.tongDiem);
      expect(pkgRow.okCount, `"${h.ten}": SELECT okCount`).toBe(kyVong.ok);
      expect(pkgRow.ngCount, `"${h.ten}": SELECT ngCount`).toBe(kyVong.ng);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// §B — Hình dạng "tuChoi" phân loại TẠM THỜI: commit ném lỗi, gói ở lại 'failed'.
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

      // KHÔNG hàng product_inspections nào cho GÓI NÀY — ZodError xảy ra TRƯỚC
      // mọi ghi DB nghiệp vụ. Tra theo SỔ IDEMPOTENCY (khoá của chính gói này),
      // không theo serial: một hình dạng lệch có thể mang serial trùng dữ liệu
      // có sẵn trong DB test và làm phép đếm nói về gói của NGƯỜI KHÁC.
      const rows = await d
        .select()
        .from(productInspections)
        .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
      expect(rows.length, `"${h.ten}": lệch hình dạng ⇒ 0 hàng product_inspections rác (WORM sạch)`).toBe(0);
    });
  }
});

describe("§B2 — hình dạng 'tuChoi' phân loại VĨNH VIỄN (too_big THẬT trên serialNumber): MỘT lượt vẫn 'failed'", () => {
  it("varcharQuaCoChiMotLoiToCo ⇒ commit ném lỗi, status='failed' sau ĐÚNG 1 lượt (ngưỡng mặc định 5)", async () => {
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
    expect(String(loi.message), "1 lượt CHƯA đủ chạm ngưỡng mặc định (5) ⇒ KHÔNG được nêu 'HỎNG VĨNH VIỄN'").not.toContain(
      "HỎNG VĨNH VIỄN",
    );

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, "1 lượt lỗi VĨNH VIỄN (đếm được) nhưng CHƯA đủ ngưỡng ⇒ vẫn 'failed'").toBe("failed");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §C — Mẫu meta.json máy THẬT (BG-73) — hình dạng đọc lazy từ file.
// ════════════════════════════════════════════════════════════════════════════
describe("§C — mẫu meta.json máy THẬT (BG-73): một lượt commit ném lỗi, status ở lại 'failed'", () => {
  it("layHinhDangMauMayThat() ⇒ commit ném lỗi, status='failed'", async () => {
    const mmt = layHinhDangMauMayThat();
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("mau-may-that", metaChoGoiThat(mmt.meta));
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();

    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status).toBe("failed");
    const rows = await d
      .select()
      .from(productInspections)
      .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
    expect(rows.length, "mẫu máy thật không parse được ⇒ 0 hàng cho GÓI NÀY").toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §D — BG-91 ĐÃ VÁ: chuỗi DateTime.ToString() 50 ký tự Ở CỬA ZIP được CHẤP NHẬN.
//
// ★★★ LỊCH SỬ — TRƯỚC 2026-08-30, describe này khẳng định NGƯỢC LẠI ("bị từ
// chối, đếm vào 'dead'") = hành vi CŨ (bug BG-91 mà chính cổng này phát hiện).
// Khi BG-91 được vá, nó ĐỎ và trông giống một hồi quy do bản vá gây ra. Bài
// học: `kyVong` phải mã hoá hành vi ĐÚNG (khangDinh), không phải "hành vi hôm
// nay" — xem `KyVongOverallResult`.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ §D — BG-91 đã vá: DateTime.ToString() 50 ký tự Ở CỬA ZIP ĐƯỢC CHẤP NHẬN, KHÔNG chạm 'failed'/'dead'", () => {
  it("gói mang thời gian 50 ký tự ⇒ commit success:true, status='committed' NGAY lượt đầu", async () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "ngayGioDaiThatDuocNhanOMoiCap_BG91");
    expect(shape, "test dựng sai — thiếu hình dạng trong BANG_HINH_DANG").toBeTruthy();
    expect(shape!.kyVong.loai, "BG-91 đã vá ⇒ hình dạng này PHẢI ở nhóm chapNhan").toBe("chapNhan");
    // ⚠ Serial RIÊNG cho §D: §A ở trên đã commit CÙNG hình dạng này. Khoá tự
    // nhiên `(machineId, serialNumber, inspectionTime)` (mig 0272) sẽ coi lượt
    // thứ hai là DUPLICATE và trả về hàng của §A — cổng vẫn xanh nhưng nó sẽ
    // đang đo hàng của ca KHÁC. Một hậu tố serial là đủ để §D đứng một mình.
    const meta = { ...metaVoiSerialRieng(shape!), serialNumber: `HD-DT50-SN-${STAMP}-D` };
    const { packageId, pkgDbId } = await ghiZipHopLeVaTaoGoi("ngay-gio-dai-ok", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success, "commit phải THÀNH CÔNG ngay lượt đầu — chuỗi 50 ký tự không còn bị .max(40) chặn").toBe(true);

    const d = (await db.getDb())!;
    const inspRows = await d
      .select({ id: productInspections.id })
      .from(productInspections)
      .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
    expect(inspRows.length, "§D phải tạo hàng header RIÊNG của nó (serial riêng ⇒ không đụng khoá tự nhiên của §A)").toBe(1);
    for (const r of inspRows) inspectionIds.push(r.id);

    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.status, "gói phải 'committed' NGAY lượt đầu — KHÔNG hề chạm 'failed', nói gì tới 'dead'").toBe("committed");
    expect(pkgRow.errorMessage, "commit thành công ⇒ không có lỗi nào ghi lại").toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §E — MỆNH ĐỀ 3 (chống tự thoả): hình dạng của bảng KHÔNG sinh ra được từ dữ
// liệu DB test.
//
// ★★★ SỬA KHI KHÔI PHỤC (I-1) — bản bị xoá đo mệnh đề này bằng
// `SELECT count(*) FROM product_inspections WHERE serialNumber='SN123456' → 0`
// trên TOÀN DB. Phép đo đó KHÔNG khôi phục được, và lý do đáng ghi lại: DB test
// HÔM NAY có 2 hàng mang đúng serial ấy, để lại bởi một lượt chạy dưới mã CŨ
// (idempotencyKey `aoi-pkg:BG73-PKG-…` và `aoi-pkg:P1F-T4-PKG-…`), và
// `product_inspections` là WORM nên KHÔNG XOÁ ĐƯỢC. Một cổng đếm-toàn-DB vì thế
// đỏ VĨNH VIỄN vì lịch sử, không vì hành vi hôm nay — đúng lớp lỗi L-4 mà chính
// file này được dựng để chặn, chỉ ở chiều ngược lại.
// Phép đo thay thế nói ĐÚNG điều cần nói: hình dạng đó KHÔNG QUA NỔI hợp đồng,
// nên KHÔNG THỂ có hàng nào do nó sinh ra kể từ bây giờ (đo trên hợp đồng, một
// mệnh đề THUẦN, tất định) + gói của lượt chạy NÀY để lại 0 hàng (§C).
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ mệnh đề 3 — hình dạng của bảng KHÔNG sinh được từ dữ liệu DB test", () => {
  it("mẫu máy thật (BG-73) KHÔNG QUA metaJsonSchema ⇒ không đường ghi nào tạo được hàng từ nó", () => {
    const mmt = layHinhDangMauMayThat();
    const r = metaJsonSchema.safeParse(mmt.meta);
    expect(
      r.success,
      "mẫu máy THẬT phải bị hợp đồng CÂY từ chối — đây là điều làm nó thành hình dạng 'không có trong DB test'",
    ).toBe(false);
    if (!r.success) {
      expect(
        laLoiVinhVienDemVaoNguongDeadZip(r.error),
        "và lỗi đó KHÔNG được đếm vào ngưỡng 'dead' (Bước 6, đường di trú BG-73)",
      ).toBe(false);
    }
  });

  it("tổng số hình dạng cổng này CHẠY QUA đường verdict/phân loại THẬT (§A+§B+§C+§D) ≥11", () => {
    const soChapNhan = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "chapNhan").length;
    const soTuChoi = BANG_HINH_DANG.filter((h) => h.kyVong.loai === "tuChoi").length;
    const tong = soChapNhan + soTuChoi + 1; // +1 = mẫu máy thật (§C)
    expect(tong).toBeGreaterThanOrEqual(11);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §F — mệnh đề 2 đối chứng THUẦN, độc lập DB.
// ════════════════════════════════════════════════════════════════════════════
describe("§F — mệnh đề 2 đối chứng thuần: laLoiVinhVienDemVaoNguongDeadZip trên lỗi THẬT do commit ném ra", () => {
  it("gói varcharQuaCoChiMotLoiToCo khi commit ném lỗi thật ⇒ lỗi đó (bắt trực tiếp) được phân loại VĨNH VIỄN", async () => {
    const shape = BANG_HINH_DANG.find((h) => h.ten === "varcharQuaCoChiMotLoiToCo")!;
    const meta = metaVoiSerialRieng(shape);
    const { packageId } = await ghiZipHopLeVaTaoGoi("f-doi-chung-vinh-vien", meta);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    // `commit` bọc lỗi gốc trong TRPCError trước khi ném — nhưng bên trong,
    // `laLoiVinhVienDemVaoNguongDeadZip` được gọi trên ZodError GỐC. Đo lại
    // TRỰC TIẾP trên ZodError để không phụ thuộc chi tiết bọc lỗi của tRPC.
    const parseThat = metaJsonSchema.safeParse(meta);
    expect(parseThat.success).toBe(false);
    if (!parseThat.success) {
      expect(laLoiVinhVienDemVaoNguongDeadZip(parseThat.error)).toBe(true);
    }
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
  });
});
