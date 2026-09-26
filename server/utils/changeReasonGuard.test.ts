/**
 * server/utils/changeReasonGuard.test.ts
 *
 * ★★★ BG-126 (Khối C, "nợ còn mở", 2026-09-05) — lưới THUẦN cho
 * `assertChangeReasonKhongGiaTienToBienThe` (không DB — hàm chỉ đọc/ném, xem
 * `changeReasonGuard.ts`). Ca tích hợp qua tRPC caller thật (mock db) nằm ở
 * `server/routers/changeReasonGiaTienToBienThe.test.ts` +
 * `server/routers/thresholdApprovalRouter.test.ts` (mở rộng).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertChangeReasonKhongGiaTienToBienThe } from "./changeReasonGuard";
import { readAppErrorMeta } from "../_core/appError";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("assertChangeReasonKhongGiaTienToBienThe", () => {
  it("★★★ '[VARIANT:12] abc' ⇒ ném BAD_REQUEST/CHANGE_REASON_RESERVED_PREFIX", () => {
    let err: unknown;
    try {
      assertChangeReasonKhongGiaTienToBienThe("[VARIANT:12] abc", "changeReason");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(readAppErrorMeta(err)).toMatchObject({
      appCode: "CHANGE_REASON_RESERVED_PREFIX",
      appParams: { field: "changeReason" },
    });
  });

  it("'đổi giới hạn theo đo đạc' ⇒ KHÔNG ném", () => {
    expect(() => assertChangeReasonKhongGiaTienToBienThe("đổi giới hạn theo đo đạc", "changeReason")).not.toThrow();
  });

  it("undefined/null/rỗng ⇒ KHÔNG ném (không có gì để chặn)", () => {
    expect(() => assertChangeReasonKhongGiaTienToBienThe(undefined, "changeReason")).not.toThrow();
    expect(() => assertChangeReasonKhongGiaTienToBienThe(null, "changeReason")).not.toThrow();
    expect(() => assertChangeReasonKhongGiaTienToBienThe("", "changeReason")).not.toThrow();
  });

  it("field khác 'changeReason' (reason/comment) vẫn ném đúng appParams.field", () => {
    let err: unknown;
    try {
      assertChangeReasonKhongGiaTienToBienThe("[VARIANT:3] x", "reason");
    } catch (e) {
      err = e;
    }
    expect(readAppErrorMeta(err)).toMatchObject({ appParams: { field: "reason" } });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ BG-126 mục 3 — đường NỘI BỘ `recordVariantOverrideVersion` TỰ GHI
  // tiền tố `[VARIANT:<id>]` (đó CHÍNH LÀ cơ chế NEW-3 bảo vệ) và KHÔNG được đi
  // qua guard này (guard chỉ áp Ở INPUT của người dùng). Census TĨNH: thân hàm
  // `recordVariantOverrideVersion` trong `server/db/product.ts` không tham
  // chiếu `assertChangeReasonKhongGiaTienToBienThe`/`changeReasonGuard` —
  // chứng minh cấu trúc rằng guard không (và không thể lỡ) bọc quanh đường ghi
  // nội bộ đó. Hành vi CHỨC NĂNG (hàm vẫn ghi thành công, tiền tố vẫn đúng) đã
  // đo bằng DB thật ở `server/db/versionBienTheTachChuoi.db.test.ts` (NEW-3) và
  // `server/db/lienKetBoTrongBienThe.db.test.ts` (BG-128) — không lặp lại DB
  // fixture ở đây.
  // ══════════════════════════════════════════════════════════════════════════
  it("★★★ recordVariantOverrideVersion KHÔNG import/gọi changeReasonGuard (đường nội bộ không bị chặn)", () => {
    const src = readFileSync(join(HERE, "..", "db", "product.ts"), "utf8");
    expect(src, "product.ts không được import changeReasonGuard").not.toMatch(/changeReasonGuard/);

    const start = src.indexOf("export async function recordVariantOverrideVersion");
    expect(start, "phải tìm thấy hàm recordVariantOverrideVersion").toBeGreaterThan(-1);
    // Cắt tới hàm KẾ TIẾP (mergeEffectivePoints, xem product.ts) để chỉ soi
    // đúng THÂN hàm này, không lẫn phần còn lại của file.
    const nextFnMarker = "export function mergeEffectivePoints";
    const end = src.indexOf(nextFnMarker, start);
    expect(end, "phải tìm thấy điểm kết thúc hàm (mergeEffectivePoints ngay sau)").toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/assertChangeReasonKhongGiaTienToBienThe/);
  });
});
