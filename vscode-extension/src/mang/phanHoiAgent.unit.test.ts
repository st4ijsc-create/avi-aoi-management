/**
 * ★★★ Đợt 5.1 (VSCode) — gửi phiếu 👍/👎 cho câu trả lời cuối của lượt agent CHẠY CỤC BỘ (`POST /api/ai/client-feedback`).
 *
 * Hợp đồng ĐO trên `server/routes/aiGatewayTokenBearerApi.ts` (không đoán):
 *   · thân JSON THẲNG {luotId, chiSoKhoi, danhGia, lyDo?, cauHoi, traLoi, duAn?}; header `Authorization: Bearer avgw_…`;
 *     KHÔNG mang id người (máy chủ lấy người từ token);
 *   · 200 ⇒ `{ok:true, phieu}`; mọi mã khác ⇒ khung `{error:{message,type,code}}`;
 *   · trần câu hỏi / câu trả lời / lý do = hằng số DÙNG CHUNG `shared/phanHoiAgent.ts` ⇒ extension cắt TRƯỚC khi gửi đúng
 *     bằng trần máy chủ kiểm (một câu trả lời dài không thành 400);
 *   · che bí mật ở client trước khi rời máy (lớp chiều sâu — máy chủ che lần nữa).
 * Phản hồi là PHỤ: hàm KHÔNG BAO GIỜ ném (lỗi mạng / 4xx / 5xx ⇒ `{ok:false, lyDo}` để ghi Output, không hộp thoại).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { dungThanPhanHoi, guiPhanHoiAgent } from "./phanHoiAgent";
import { TRAN_KY_TU_CAU_HOI_CLIENT, TRAN_KY_TU_TRA_LOI_CLIENT } from "../../../shared/phanHoiAgent";

type Goi = { url: string; method?: string; headers: Record<string, string>; than: unknown };

function datFetch(dap: { status: number; than: unknown } | "nem") {
  const goi: Goi[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      goi.push({ url, method: init?.method, headers: init?.headers ?? {}, than: init?.body ? JSON.parse(init.body) : undefined });
      if (dap === "nem") throw new TypeError("fetch failed: ECONNREFUSED");
      return { ok: dap.status >= 200 && dap.status < 300, status: dap.status, json: async () => dap.than } as Response;
    }),
  );
  return goi;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const LUOT = "0f0e0d0c-0b0a-4908-8706-050403020100";
const PHIEU = { luotId: LUOT, chiSoKhoi: 1, danhGia: -1 as const, lyDo: "  sai API  ", cauHoi: "Sửa hàm cộng", traLoi: "Đã sửa.", duAn: "repo" };

describe("dungThanPhanHoi — thân gửi đi (thuần)", () => {
  it("đúng khoá, không id người; lý do cắt khoảng trắng; dự án sai hình dạng ⇒ null", () => {
    expect(dungThanPhanHoi(PHIEU)).toEqual({ luotId: LUOT, chiSoKhoi: 1, danhGia: -1, lyDo: "sai API", cauHoi: "Sửa hàm cộng", traLoi: "Đã sửa.", duAn: "repo" });
    expect(dungThanPhanHoi({ ...PHIEU, lyDo: "   ", duAn: "D:\\ws\\repo" })).toMatchObject({ lyDo: null, duAn: null });
  });
  it("★ cắt về ĐÚNG trần máy chủ (hằng số dùng chung) + che bí mật trước khi rời máy", () => {
    const BI_MAT = "sk-abcdefghijklmnopqrstuvwxyz0123";
    const t = dungThanPhanHoi({ ...PHIEU, cauHoi: `k=${BI_MAT} ` + "q".repeat(TRAN_KY_TU_CAU_HOI_CLIENT), traLoi: "a".repeat(TRAN_KY_TU_TRA_LOI_CLIENT + 9) });
    expect(t.cauHoi.length).toBe(TRAN_KY_TU_CAU_HOI_CLIENT);
    expect(t.traLoi.length).toBe(TRAN_KY_TU_TRA_LOI_CLIENT);
    expect(JSON.stringify(t)).not.toContain(BI_MAT);
  });
});

describe("guiPhanHoiAgent — vận chuyển REST Bearer, không bao giờ ném", () => {
  it("★★★ POST đúng tuyến, Bearer token, thân JSON thẳng; 200 ⇒ ok", async () => {
    const goi = datFetch({ status: 200, than: { ok: true, phieu: null } });
    expect(await guiPhanHoiAgent("http://localhost:3000/", "avgw_x", PHIEU)).toEqual({ ok: true });
    expect(goi).toHaveLength(1);
    expect(goi[0]!.url).toBe("http://localhost:3000/api/ai/client-feedback");
    expect(goi[0]!.method).toBe("POST");
    expect(goi[0]!.headers.authorization).toBe("Bearer avgw_x");
    expect(goi[0]!.headers.cookie).toBeUndefined();
    expect(goi[0]!.than).toEqual(dungThanPhanHoi(PHIEU));
  });

  it("chưa có token ⇒ ok:false, KHÔNG chạm mạng", async () => {
    const goi = datFetch({ status: 200, than: {} });
    const kq = await guiPhanHoiAgent("http://localhost:3000", "", PHIEU);
    expect(kq.ok).toBe(false);
    expect(goi).toHaveLength(0);
  });

  it("403 insufficient_scope / 503 / lỗi mạng ⇒ ok:false kèm lý do đọc được — KHÔNG ném", async () => {
    datFetch({ status: 403, than: { error: { code: "insufficient_scope", message: "This token lacks the 'chat' scope." } } });
    const a = await guiPhanHoiAgent("http://localhost:3000", "avgw_x", PHIEU);
    expect(a).toMatchObject({ ok: false });
    expect(a.ok === false && a.lyDo).toContain("insufficient_scope");
    datFetch({ status: 503, than: { error: { code: "db_unavailable" } } });
    expect(await guiPhanHoiAgent("http://localhost:3000", "avgw_x", PHIEU)).toMatchObject({ ok: false });
    datFetch("nem");
    const c = await guiPhanHoiAgent("http://localhost:3000", "avgw_x", PHIEU);
    expect(c.ok === false && c.lyDo).toContain("ECONNREFUSED");
  });
});
