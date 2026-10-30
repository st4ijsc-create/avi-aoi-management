/**
 * ★ 10.4 (luong-ui báo) — lỗi RÀNG BUỘC CSDL trong giao dịch ghi của thủ tục AI ngoài ⇒ BAD_REQUEST sạch (không lộ "Failed query …").
 */
import { describe, expect, it } from "vitest";
import { giaoDichNgoai, maLoiPg } from "./_aiNgoaiPhamVi";
import { readAppErrorMeta } from "../_core/appError";

const dbNem = (e: unknown) => ({ transaction: async () => Promise.reject(e) }) as never;
const boc = (code: string) => Object.assign(new Error(`Failed query: insert into "ai_ngoai_model" ... params: sk-bi-mat`), { cause: Object.assign(new Error("check"), { code }) });

describe("giaoDichNgoai", () => {
  it.each(["23514", "23505", "23503", "23502", "22001", "22003"])("mã %s (drizzle bọc trong cause) ⇒ BAD_REQUEST du-lieu-vi-pham-rang-buoc, thông điệp KHÔNG chứa câu SQL / tham số", async (code) => {
    const e = await giaoDichNgoai(dbNem(boc(code)), async () => 1).catch((x: unknown) => x);
    expect((e as { code?: string }).code).toBe("BAD_REQUEST");
    expect((readAppErrorMeta(e) as { appParams?: { reason?: string } }).appParams?.reason).toBe("du-lieu-vi-pham-rang-buoc");
    expect(String((e as Error).message)).not.toMatch(/Failed query|insert into|sk-bi-mat/);
  });
  it("lỗi khác (mạng / không mã) ⇒ ném nguyên; thành công ⇒ trả giá trị", async () => {
    const goc = new Error("ECONNRESET");
    await expect(giaoDichNgoai(dbNem(goc), async () => 1)).rejects.toBe(goc);
    expect(await giaoDichNgoai({ transaction: async (f: (tx: unknown) => Promise<number>) => f({}) } as never, async () => 42)).toBe(42);
    expect(maLoiPg({ cause: { cause: { code: "23514" } } })).toBe("23514");
    expect(maLoiPg(new Error("x"))).toBeUndefined();
  });
});
