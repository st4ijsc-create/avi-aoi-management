/**
 * Pha 1F Task 2 (BG-73 ⛔) — gói `meta.json` THẬT của máy chết `'dead'`,
 * KHÔNG LỐI VỀ.
 *
 * `metaJsonSchema` bắt buộc `measurements[]`; mẫu tham chiếu THẬT của máy
 * (`D:\SOURCES\AOIData\aoipackage-meta-sample.json`) mang `images[]` — KHÔNG
 * có `measurements[]`/`points[]`. `metaJsonSchema.parse()` ném `ZodError`
 * MỘT issue duy nhất (`code:"invalid_type"`, thiếu `measurements`, đã đo LIVE
 * bằng `safeParse` — xem task-2-report.md). TRƯỚC bản vá này (Pha 1E T1,
 * BG-64), `isPermanentSubmitError` coi MỌI `ZodError` là VĨNH VIỄN như nhau
 * ⇒ đếm vào `nguongLoiVinhVienZip()` ⇒ sau N lượt, gói chuyển `'dead'`
 * (trạng thái CUỐI, BG-65) ⇒ `presign`/`commit`/`upload` đều khoá VĨNH VIỄN —
 * KHÔNG có đường về nào từ phía máy chủ, DÙ server sau đó sửa
 * `metaJsonSchema` cho đúng hình dạng máy thật.
 *
 * SAU bản vá: `laLoiVinhVienDemVaoNguongDeadZip` (aoiPackageRouter.ts) chỉ đếm
 * `ZodError` khi MỌI issue là `"too_big"` (payload QUÁ CỠ — Postgres cũng sẽ
 * `22001`). `ZodError` do LỆCH HÌNH DẠNG (issue khác, ví dụ `"invalid_type"`
 * vì thiếu `measurements`) KHÔNG đếm — gói ở lại `'failed'` VÔ THỜI HẠN,
 * `presign`/`commit` vẫn nhận retry vô hạn — đúng hành vi TRƯỚC Pha 1E cho
 * lớp lỗi này.
 *
 * Kịch bản THẬT trên DB thật (avi_app), KHÔNG suy đoán từ đọc mã: ZIP chứa
 * ĐÚNG NGUYÊN VĂN nội dung `aoipackage-meta-sample.json` làm `meta.json`,
 * `commit` gọi (ngưỡng+2) lần liên tiếp (nhiều HƠN `AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS`)
 * — mệnh đề: status KHÔNG BAO GIỜ chuyển `'dead'`, mỗi lượt đều được xử lý
 * ĐẦY ĐỦ (không short-circuit sớm), và KHÔNG có hàng `product_inspections`
 * nào được tạo (ZodError xảy ra TRƯỚC bất kỳ ghi DB nghiệp vụ nào — 0 hàng
 * WORM mới sinh ra từ file test này).
 *
 * Đột biến bắt buộc (xem report): hoàn nguyên `laLoiVinhVienDemVaoNguongDeadZip`
 * về `isPermanentSubmitError` nguyên văn ⇒ mệnh đề "không bao giờ dead" ĐỎ
 * (status chuyển 'dead' đúng ở lượt ngưỡng).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp, readFileSync } from "node:fs";
import { ZodError, z } from "zod";
import JSZip from "jszip";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  aoiPackageRouter,
  laLoiVinhVienDemVaoNguongDeadZip,
} from "./aoiPackageRouter";
import * as db from "../db";
import { inspectionPackages, packageActivityLogs, packageImages, productInspections } from "../../drizzle/schema";

const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\aoipackage-meta-sample.json";

// ════════════════════════════════════════════════════════════════════════════
// §1 — laLoiVinhVienDemVaoNguongDeadZip: hàm THUẦN, không DB (đơn vị).
// ════════════════════════════════════════════════════════════════════════════
function taoZodErrorTuSchema(schema: z.ZodTypeAny, data: unknown): ZodError {
  const r = schema.safeParse(data);
  if (r.success) throw new Error("test dựng sai — schema PHẢI từ chối data này");
  return r.error;
}

describe("laLoiVinhVienDemVaoNguongDeadZip — hàm THUẦN (đơn vị)", () => {
  it("★★★ ZodError CHỈ issue invalid_type (thiếu trường bắt buộc, đúng hình dạng BG-73) ⇒ false — KHÔNG đếm", () => {
    const schema = z.object({ measurements: z.array(z.object({})) });
    const err = taoZodErrorTuSchema(schema, {});
    expect(err.issues.map((i) => i.code)).toEqual(["invalid_type"]);
    expect(laLoiVinhVienDemVaoNguongDeadZip(err)).toBe(false);
  });

  it("ZodError CHỈ issue too_big (payload quá cỡ, đúng lý do BG-64) ⇒ true — VẪN đếm", () => {
    const schema = z.object({ serialNumber: z.string().max(3) });
    const err = taoZodErrorTuSchema(schema, { serialNumber: "toolong" });
    expect(err.issues.map((i) => i.code)).toEqual(["too_big"]);
    expect(laLoiVinhVienDemVaoNguongDeadZip(err)).toBe(true);
  });

  it("ZodError TRỘN too_big + invalid_type (không phải toàn bộ too_big) ⇒ false — KHÔNG đếm", () => {
    const schema = z.object({ serialNumber: z.string().max(3), measurements: z.array(z.object({})) });
    const err = taoZodErrorTuSchema(schema, { serialNumber: "toolong" });
    const codes = err.issues.map((i) => i.code).sort();
    expect(codes).toEqual(["invalid_type", "too_big"]);
    expect(laLoiVinhVienDemVaoNguongDeadZip(err)).toBe(false);
  });

  it("TRPCError NOT_FOUND (không phải ZodError) ⇒ true — vẫn đi qua isPermanentSubmitError như trước", () => {
    expect(
      laLoiVinhVienDemVaoNguongDeadZip(new TRPCError({ code: "NOT_FOUND", message: "x" })),
    ).toBe(true);
  });

  it("lỗi kết nối tạm thời (ECONNREFUSED) ⇒ false — không đổi hành vi TẠM THỜI cũ", () => {
    expect(laLoiVinhVienDemVaoNguongDeadZip(new Error("connect ECONNREFUSED 127.0.0.1:5434"))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — Kịch bản THẬT trên DB thật: mẫu máy THẬT KHÔNG BAO GIỜ chạm 'dead'.
// ════════════════════════════════════════════════════════════════════════════
const STAMP = Date.now();
const API_KEY = `BG73-PKG-${STAMP}`;
const NGUONG = 3;

let machineId: number;
const packageDbIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG73-PKG-${STAMP}`,
    name: "Pha 1F Task 2 (BG-73) — gói mẫu máy thật",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && packageDbIds.length > 0) {
    // I-6 (review lượt 8) — `commit` GHI LẠI `package_images` cho gói hình dạng cây.
    // Dọn TRƯỚC `inspection_packages` (khoá ngoại mềm `packageId` → `inspection_packages.id`):
    // xoá gói trước sẽ để lại hàng ảnh MỒ CÔI — bảng đó đã có 774 hàng như thế.
    await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
    await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
    await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg73-pkg-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = String(NGUONG);
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

async function taoGoiVoiZipMayThat(suffix: string): Promise<{ pkgDbId: number; packageId: string }> {
  const packageId = `BG73-PKG-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);

  // ZIP THẬT hợp lệ (mở được, meta.json ĐÚNG NGUYÊN VĂN mẫu máy thật) — chỉ
  // meta.json SAI HÌNH DẠNG (images[] thay vì measurements[]/points[]).
  const metaThat = readFileSync(MAU_MAY_THAT, "utf8");
  const zip = new JSZip();
  zip.file("meta.json", metaThat);
  zip.file("images/TOP_P01_Default.jpg", Buffer.from("bg73-fake-image"));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({ machineId, packageId, storageKey, status: "uploaded" })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return { pkgDbId: pkg.id, packageId };
}

async function demSoCommitFail(pkgDbId: number): Promise<number> {
  const d = await db.getDb();
  const rows = await d!
    .select()
    .from(packageActivityLogs)
    .where(and(eq(packageActivityLogs.packageDbId, pkgDbId), eq(packageActivityLogs.event, "commit_fail")));
  return rows.length;
}

describe("★★★ mẫu meta.json THẬT của máy (images[]) — commit lặp lại VƯỢT ngưỡng KHÔNG BAO GIỜ chạm 'dead'", () => {
  it(`(ngưỡng+2)=${NGUONG + 2} lượt commit liên tiếp trên CÙNG packageId ⇒ status LUÔN 'failed', KHÔNG BAO GIỜ 'dead'; presign/commit vẫn còn mở`, async () => {
    const { pkgDbId, packageId } = await taoGoiVoiZipMayThat("shape");
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    for (let lan = 1; lan <= NGUONG + 2; lan++) {
      let loi: any;
      try {
        await caller.commit({ apiKey: API_KEY, packageId });
      } catch (e) {
        loi = e;
      }
      expect(loi, `lượt ${lan} phải ném lỗi (meta.json sai hình dạng)`).toBeTruthy();
      // TRƯỚC bản vá BG-73: thông điệp sẽ chứa "HỎNG VĨNH VIỄN" sau lượt thứ NGUONG.
      expect(
        String(loi.message),
        `lượt ${lan}: KHÔNG được ném thông điệp 'HỎNG VĨNH VIỄN' — gói không được phép chết vì lệch hình dạng`,
      ).not.toContain("HỎNG VĨNH VIỄN");

      const [row] = await (await db.getDb())!
        .select()
        .from(inspectionPackages)
        .where(eq(inspectionPackages.id, pkgDbId));
      expect(row.status, `sau lượt ${lan}: status phải LUÔN 'failed'`).toBe("failed");
    }

    // MỌI lượt đều được xử lý ĐẦY ĐỦ (không short-circuit sớm như 'dead' làm) —
    // đúng NGUONG+2 entry commit_fail, không phải dừng lại ở NGUONG.
    expect(await demSoCommitFail(pkgDbId)).toBe(NGUONG + 2);

    // presign gọi lại CÙNG inspectionId vẫn phải trả về info retry (KHÔNG bị
    // khoá 'dead') — đúng câu trả lời "vận hành lấy gói này về bằng cách nào":
    // gói không hề bị khoá, Agent/vận hành gọi lại được ngay.
    const resPresign = await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: 1024 });
    expect(resPresign.success).toBe(true);
    expect((resPresign as { alreadyCommitted: boolean }).alreadyCommitted).toBe(false);
  });

  it("KHÔNG hàng product_inspections nào được tạo — ZodError xảy ra TRƯỚC mọi ghi DB nghiệp vụ (0 rác WORM)", async () => {
    const { packageId } = await taoGoiVoiZipMayThat("worm-check");
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();

    const d = await db.getDb();
    // ★★★ SỬA 2026-08-31 (lô vá review lượt 8) — TRƯỚC bản sửa này, ca đo bằng
    //     SELECT … WHERE "serialNumber" = 'SN123456'   → kỳ vọng 0
    // trên TOÀN DB. Phép đo đó ĐỎ VĨNH VIỄN kể từ khi DB test có 2 hàng mang
    // đúng serial ấy — đo được: id 110092 (`aoi-pkg:BG73-PKG-1788158795363-shape`)
    // và id 110126 (`aoi-pkg:P1F-T4-PKG-1788158795457-mau-may-that`), để lại bởi
    // một lượt chạy dưới mã CŨ (thời hợp đồng PHẲNG, khi mẫu máy thật CÒN parse
    // được). `product_inspections` là WORM — avi_app KHÔNG có DELETE (mig 0279)
    // ⇒ hai hàng đó KHÔNG BAO GIỜ biến mất.
    // Đã kiểm chứng đây KHÔNG phải hồi quy của lô vá: chạy ca này trên
    // `git show HEAD:server/routers/aoiPackageRouter.ts` (mã chưa vá) cũng ĐỎ
    // với đúng "expected 2 to be +0".
    // Cái ca này MUỐN nói là "lượt commit VỪA RỒI không tạo hàng nào" — nên nó
    // phải hỏi theo GÓI NÀY, không theo một serial mà cả DB dùng chung. Sổ
    // idempotency `aoi-pkg:<packageId>` là khoá của chính gói vừa commit (đã
    // mang STAMP), nên phép đo mới nói ĐÚNG điều nó định nói và không thể bị
    // lịch sử WORM làm cho vô nghĩa. Cùng lớp lỗi L-4 ("đo trên hình dạng CÓ
    // trong DB test thay vì hành vi đang xét"), chỉ ở chiều ngược lại.
    const rows = await d!
      .select()
      .from(productInspections)
      .where(eq(productInspections.idempotencyKey, `aoi-pkg:${packageId}`));
    expect(rows.length, "meta.json sai hình dạng ⇒ 0 hàng product_inspections được tạo CHO GÓI NÀY").toBe(0);
  });
});
