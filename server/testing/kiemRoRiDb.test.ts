/**
 * `kiemRoRiDb.ts` — phần THUẦN: chỉ chạy trên CSDL `aoi_management_test` (chốt an toàn) và câu báo lỗi. KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: bỏ chốt tên CSDL (đếm trên CSDL khác) · câu báo lỗi không nêu số hàng / userId / nơi đi qua kênh.
 */
import { describe, expect, it } from "vitest";
import { cauBaoRoRi, demHangRoRi, ghiNhanRoRi, type HangRoRi } from "./kiemRoRiDb";
import type { KenhGiaoDich } from "./kenhGiaoDich";

describe("demHangRoRi — chốt CSDL", () => {
  it("★★★ từ chối mọi URL KHÔNG phải aoi_management_test (và URL vắng: null / rỗng — KHÔNG truyền undefined vì khi đó hàm đọc DATABASE_URL thật của môi trường cổng) TRƯỚC khi mở kết nối", async () => {
    for (const url of [null, "", "postgresql://u:p@127.0.0.1:5434/aoi_management", "postgresql://u:p@127.0.0.1:5434/aoi_dev", "postgresql://u:p@127.0.0.1:1/none"]) {
      await expect(demHangRoRi(1, url), String(url)).rejects.toThrow(/chỉ chạy trên CSDL aoi_management_test/);
    }
  });
});

describe("cauBaoRoRi", () => {
  it("★★★ nêu số hàng từng bảng, userId, và bản tóm tắt nơi đi qua kênh (hoặc nói không có lời gọi nào)", () => {
    const c = cauBaoRoRi({ audit_logs: 2, ai_pending_actions: 1, tong: 3 }, 235087, "server/services/x.ts:10:5 ×4");
    expect(c).toContain("2 hàng audit_logs");
    expect(c).toContain("1 hàng ai_pending_actions");
    expect(c).toContain("userId=235087");
    expect(c).toContain("server/services/x.ts:10:5 ×4");
    expect(cauBaoRoRi({ audit_logs: 1, ai_pending_actions: 0, tong: 1 }, 7, "")).toContain("(không lời gọi nào)");
  });
});

describe("ghiNhanRoRi — khối dùng chung ở finally (bộ đếm GIẢ)", () => {
  const kenhMoi = (): KenhGiaoDich => ({ db: null, lot: [], goi: { "server/x.ts:1:1": 2 } });
  it("★★★ bộ đếm trả 3 ⇒ `lot` có đúng MỘT câu RÒ RỈ nêu số hàng + userId + nơi đi qua kênh", async () => {
    const k = kenhMoi();
    const dem = async (id: number): Promise<HangRoRi> => ({ audit_logs: 2, ai_pending_actions: 1, tong: id === 77 ? 3 : 0 });
    await ghiNhanRoRi(k, 77, dem);
    expect(k.lot).toHaveLength(1);
    expect(k.lot[0]).toContain("RÒ RỈ");
    expect(k.lot[0]).toContain("2 hàng audit_logs");
    expect(k.lot[0]).toContain("1 hàng ai_pending_actions");
    expect(k.lot[0]).toContain("userId=77");
    expect(k.lot[0]).toContain("server/x.ts:1:1 ×2");
  });
  it("★★★ bộ đếm trả 0 ⇒ `lot` rỗng (không báo oan)", async () => {
    const k = kenhMoi();
    await ghiNhanRoRi(k, 5, async () => ({ audit_logs: 0, ai_pending_actions: 0, tong: 0 }));
    expect(k.lot).toEqual([]);
  });
  it("★★★ bộ đếm NÉM ⇒ `lot` có 'KHÔNG chạy được' kèm lý do, hàm KHÔNG ném và KHÔNG nuốt im lặng; ném giá trị không phải Error cũng được ghi", async () => {
    const k = kenhMoi();
    await expect(ghiNhanRoRi(k, 5, async () => { throw new Error("kết nối hỏng"); })).resolves.toBeUndefined();
    expect(k.lot).toHaveLength(1);
    expect(k.lot[0]).toContain("KHÔNG chạy được");
    expect(k.lot[0]).toContain("kết nối hỏng");
    const k2 = kenhMoi();
    await ghiNhanRoRi(k2, 5, async () => { throw "chuỗi trần"; });
    expect(k2.lot[0]).toContain("chuỗi trần");
  });
  it("★★★ chỉ tong > 0 mới là rò: audit_logs=0, ai_pending_actions=1 ⇒ vẫn báo", async () => {
    const k = kenhMoi();
    await ghiNhanRoRi(k, 9, async () => ({ audit_logs: 0, ai_pending_actions: 1, tong: 1 }));
    expect(k.lot).toHaveLength(1);
  });
});

describe("demHangRoRi — nhánh bộ thực thi (tx) với bộ thực thi GIẢ, không DB", () => {
  const URL_TEST = "postgresql://u:p@127.0.0.1:5434/aoi_management_test";
  it("★★★ hai truy vấn theo thứ tự audit_logs rồi ai_pending_actions; tong = tổng; chấp nhận cả dạng mảng lẫn `{ rows }`", async () => {
    const goi: string[] = [];
    const lay = (n: number, dang: "mang" | "rows") => async (q: { queryChunks: unknown[] }) => {
      goi.push(JSON.stringify(q.queryChunks).includes("ai_pending_actions") ? "ai_pending_actions" : "audit_logs");
      const h = [{ n }];
      return dang === "mang" ? h : { rows: h };
    };
    let k = 0;
    const thucThi = { execute: async (q: { queryChunks: unknown[] }) => (k++ === 0 ? lay(2, "mang")(q) : lay(5, "rows")(q)) };
    const r = await demHangRoRi(1, URL_TEST, thucThi as never);
    expect(r).toEqual({ audit_logs: 2, ai_pending_actions: 5, tong: 7 });
    expect(goi).toEqual(["audit_logs", "ai_pending_actions"]);
  });
  it("kết quả rỗng ⇒ 0 (không NaN); chốt tên CSDL vẫn áp cho nhánh này", async () => {
    const trong = { execute: async () => [] };
    expect(await demHangRoRi(1, URL_TEST, trong as never)).toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    await expect(demHangRoRi(1, "postgresql://u:p@127.0.0.1:5434/aoi_management", trong as never)).rejects.toThrow(/chỉ chạy trên CSDL aoi_management_test/);
  });
});
