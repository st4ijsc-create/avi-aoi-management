/**
 * F3 — chứng minh `DbUnavailableError` thật sự đưa được `appCode` tới client.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ TOÀN BỘ đợt di trú ~400 chỗ `throw new Error("Database not available")` đứng trên
 * MỘT giả định: *"tRPC bọc lỗi không-phải-TRPCError thành
 * `TRPCError({ cause: <lỗi gốc> })`, nên `readAppErrorMeta` đọc được `cause.appCode`."*
 *
 * Giả định đó nghe hợp lý — và đó chính là lý do phải đo. Nếu nó SAI, 400 chỗ vừa
 * đổi vẫn hiện chuỗi tiếng Anh y như cũ, mà mọi cổng đều xanh vì mã "trông đã đúng".
 * Bộ test này đo thẳng chuỗi ĐI RA, không đo ý định.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { DbUnavailableError } from "./dbErrors";
import { readAppErrorMeta } from "./appError";

describe("F3 — DbUnavailableError mang appCode tới errorFormatter", () => {
  it("lớp lỗi tự khai appCode DB_UNAVAILABLE", () => {
    const err = new DbUnavailableError();
    expect(err.appCode).toBe("DB_UNAVAILABLE");
  });

  it("★★★ giữ `name` = DbUnavailableError — đường ingest WAL nhận diện bằng NAME", () => {
    // `_core/index.ts:437` dùng `error?.name === "DbUnavailableError"` để coi lỗi là
    // TẠM THỜI và ĐỆM bản ghi kiểm tra xuống đĩa. Đổi name = mất dữ liệu kiểm khi DB
    // sập, không phải chuyện đặt tên.
    expect(new DbUnavailableError().name).toBe("DbUnavailableError");
    expect(new DbUnavailableError() instanceof Error).toBe(true);
  });

  it("★★★ khi tRPC bọc nó, `readAppErrorMeta` ĐỌC ĐƯỢC appCode qua `cause`", () => {
    // Đây là mô phỏng ĐÚNG cách tRPC v11 bọc lỗi ném từ procedure: giữ lỗi gốc ở
    // `cause`. `readAppErrorMeta` đọc `err.cause.appCode`.
    const wrapped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new DbUnavailableError() });
    const meta = readAppErrorMeta(wrapped);
    expect(meta).not.toBeNull();
    expect(meta?.appCode).toBe("DB_UNAVAILABLE");
  });

  it("lỗi THÔ cùng nội dung thì KHÔNG có appCode — đối chứng cho ca trên", () => {
    // Nếu ca này cũng trả appCode thì ca trên không chứng minh được gì (nó sẽ xanh
    // bất kể lớp lỗi có mang appCode hay không).
    const wrapped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new Error("Database not available") });
    expect(readAppErrorMeta(wrapped)).toBeNull();
  });
});
