/**
 * Sprint 5 §4.2 — lỗi máy chủ phải mang một MÃ ổn định để client dịch được.
 * Trước đây message là chuỗi tiếng Anh viết tay (81% số chỗ), dùng chung nhiều
 * caller nên không dịch nổi ở máy chủ.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { appError, readAppErrorMeta } from "./appError";

describe("appError", () => {
  it("trả về TRPCError thật, giữ nguyên mã tRPC đã truyền", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found");
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("message = fallback truyền vào (log và API ngoài vẫn đọc được)", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found");
    expect(err.message).toBe("Product not found");
  });

  it("thiếu fallback ⇒ message là chính mã, KHÔNG rỗng", () => {
    const err = appError("BAD_REQUEST", "DB_UNAVAILABLE");
    expect(err.message).toBe("DB_UNAVAILABLE");
  });

  it("mang appCode + params đọc lại được", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" });
    expect(readAppErrorMeta(err)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "machine" } });
  });

  it("không params ⇒ appParams undefined, không phải {} rỗng", () => {
    const err = appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE");
    expect(readAppErrorMeta(err)).toEqual({ appCode: "DB_UNAVAILABLE", appParams: undefined });
  });

  it("TRPCError thường (chưa di trú) ⇒ readAppErrorMeta trả null, không ném", () => {
    expect(readAppErrorMeta(new TRPCError({ code: "NOT_FOUND", message: "x" }))).toBeNull();
    expect(readAppErrorMeta(new Error("x"))).toBeNull();
    expect(readAppErrorMeta(undefined)).toBeNull();
  });

  // Review round 1 — Finding I-1: `??` chỉ bắt null/undefined, không bắt chuỗi
  // rỗng/toàn-khoảng-trắng. Một fallbackMessage hỏng (biến undefined nội suy ra
  // "" hoặc chỉ có khoảng trắng) trước đây lọt qua, cho ra message rỗng — cả
  // log máy chủ lẫn câu hiện cho người dùng (khi client rơi về fallback) đều
  // rỗng, một lỗi im lặng sẽ nhân lên ở toàn bộ ~1056 chỗ gọi appError() sau này.
  it("fallbackMessage rỗng (\"\") ⇒ message là mã, KHÔNG phải chuỗi rỗng", () => {
    const err = appError("BAD_REQUEST", "DB_UNAVAILABLE", undefined, "");
    expect(err.message).toBe("DB_UNAVAILABLE");
  });

  it("fallbackMessage toàn khoảng trắng (\"   \") ⇒ message là mã, KHÔNG phải khoảng trắng", () => {
    const err = appError("BAD_REQUEST", "DB_UNAVAILABLE", undefined, "   ");
    expect(err.message).toBe("DB_UNAVAILABLE");
  });

  it("fallbackMessage có nội dung kèm khoảng trắng bao quanh ⇒ giữ NGUYÊN VĂN, không tự ý trim message thật", () => {
    const err = appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, " Product not found ");
    expect(err.message).toBe(" Product not found ");
  });
});

// Bài học §6(2): trường mới chết im lặng vì chặng nối tay bỏ sót. Phải khẳng
// định appCode/appParams **qua được** errorFormatter, không chỉ tồn tại trên
// `cause`.
import { initTRPC } from "@trpc/server";

describe("errorFormatter — hợp đồng tới client", () => {
  // Dựng lại ĐÚNG errorFormatter đang dùng ở trpc.ts để test không phụ thuộc
  // vào việc khởi tạo cả context thật.
  const t = initTRPC.create({
    errorFormatter({ shape, error }) {
      const appMeta = readAppErrorMeta(error);
      return {
        ...shape,
        data: {
          ...shape.data,
          ...(appMeta ? { appCode: appMeta.appCode, ...(appMeta.appParams ? { appParams: appMeta.appParams } : {}) } : {}),
        },
      };
    },
  });

  const router = t.router({
    boom: t.procedure.query(() => {
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Machine not found");
    }),
    plain: t.procedure.query(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    }),
  });

  it("appCode + appParams tới được shape.data", async () => {
    const caller = t.createCallerFactory(router)({});
    await expect(caller.boom()).rejects.toMatchObject({ code: "NOT_FOUND" });
    try {
      await caller.boom();
    } catch (e: any) {
      const shape = t._config.errorFormatter({ shape: { data: {} }, error: e } as any);
      expect(shape.data.appCode).toBe("ENTITY_NOT_FOUND");
      expect(shape.data.appParams).toEqual({ entity: "machine" });
    }
  });

  it("lỗi CHƯA di trú ⇒ không có appCode, hình dạng phản hồi không đổi", () => {
    const err = new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    const shape = t._config.errorFormatter({ shape: { data: {} }, error: err } as any);
    expect(shape.data.appCode).toBeUndefined();
  });
});
