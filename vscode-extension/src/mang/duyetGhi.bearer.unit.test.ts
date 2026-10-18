/**
 * ★★★ ĐỢT 4B-client — SỔ KIỂM TOÁN QUA REST BEARER (`/api/ai/client-apply/*`, máy chủ 126de672b).
 *
 * Hợp đồng ĐO trên `server/routes/aiGatewayTokenBearerApi.ts` (không đoán):
 *   · thân yêu cầu là JSON THẲNG (không bọc `{json:…}` kiểu tRPC); header `Authorization: Bearer avgw_…`, KHÔNG cookie;
 *   · `bat-dau` 200 ⇒ `{actionId, token}`; mọi mã khác ⇒ khung `{error:{message,type,code}}` ⇒ NÉM (phía gọi KHÔNG ghi);
 *   · `chot` 200/409 ⇒ thân dịch vụ `{ok,status,message}` (409 = ok:false, KHÔNG ném — cùng ngữ nghĩa tRPC cũ);
 *     503 `{ok:false, message:"DB_UNAVAILABLE"}` cũng là thân dịch vụ ⇒ đọc như ok:false;
 *     khung `{error}` (401/403/429/503 auth_backend_unavailable) ⇒ NÉM.
 *   · 403 `insufficient_scope` (token cũ chỉ có chat/fim) ⇒ thông điệp nói ĐÚNG việc phải làm: đăng nhập lại để cấp
 *     quyền ghi sổ; mã máy đọc `THIEU_PHAM_VI_APPLY`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { goiBatDauApClient, goiChotApClient, LoiSoKiemToan } from "./duyetGhi";

type Goi = { url: string; method?: string; headers: Record<string, string>; than: unknown };

function datFetch(dap: { status: number; than: unknown } | (() => never)) {
  const goi: Goi[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      goi.push({ url, method: init?.method, headers: init?.headers ?? {}, than: init?.body ? JSON.parse(init.body) : undefined });
      if (typeof dap === "function") dap();
      const d = dap as { status: number; than: unknown };
      return { ok: d.status >= 200 && d.status < 300, status: d.status, json: async () => d.than } as Response;
    }),
  );
  return goi;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const DV_BAT_DAU = {
  path: "src/a.ts",
  nhanWorkspace: "/ws",
  sha256Truoc: "a".repeat(64),
  sha256Sau: "b".repeat(64),
  tomTat: "+1 / −1",
  soDongThem: 1,
  soDongBot: 1,
};

const loiKhung = (code: string, message = "x") => ({ error: { message, type: "permission_error", code } });

describe("goiBatDauApClient — Bearer", () => {
  it("★★★ POST /api/ai/client-apply/bat-dau, Bearer avgw_, thân JSON THẲNG, KHÔNG cookie ⇒ {actionId, token}", async () => {
    const goi = datFetch({ status: 200, than: { actionId: "A1", token: "T1" } });
    const kq = await goiBatDauApClient("http://may:3000/", { bearer: "avgw_abc" }, DV_BAT_DAU);
    expect(kq).toEqual({ actionId: "A1", token: "T1" });
    expect(goi).toHaveLength(1);
    expect(goi[0].url).toBe("http://may:3000/api/ai/client-apply/bat-dau");
    expect(goi[0].method).toBe("POST");
    expect(goi[0].headers.authorization).toBe("Bearer avgw_abc");
    expect(Object.keys(goi[0].headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(goi[0].than).toEqual(DV_BAT_DAU);
  });

  it("★★★ 403 insufficient_scope (token cũ thiếu 'apply') ⇒ NÉM, mã THIEU_PHAM_VI_APPLY, chỉ đường đăng nhập lại để cấp quyền ghi sổ", async () => {
    datFetch({ status: 403, than: loiKhung("insufficient_scope", "This token lacks the 'apply' scope.") });
    const e = await goiBatDauApClient("http://may", { bearer: "avgw_cu" }, DV_BAT_DAU).catch((x) => x);
    expect(e).toBeInstanceOf(LoiSoKiemToan);
    expect((e as LoiSoKiemToan).ma).toBe("THIEU_PHAM_VI_APPLY");
    expect((e as Error).message).toMatch(/đăng nhập lại/i);
    expect((e as Error).message).toMatch(/ghi sổ/i);
    expect((e as Error).message).toMatch(/device flow/);
  });

  it("★★★ 503 db_unavailable / auth_backend_unavailable ⇒ NÉM (fail-closed: không ghi được sổ ⇒ không áp)", async () => {
    for (const code of ["db_unavailable", "auth_backend_unavailable"]) {
      datFetch({ status: 503, than: { error: { message: "down", type: "server_error", code } } });
      const e = await goiBatDauApClient("http://may", { bearer: "avgw_x" }, DV_BAT_DAU).catch((x) => x);
      expect(e, code).toBeInstanceOf(LoiSoKiemToan);
      expect((e as LoiSoKiemToan).ma, code).toBe("SO_KIEM_TOAN_TAM_LOI");
      expect((e as Error).message, code).toContain(code);
    }
  });

  it("★★ 401 (token hết hạn/thu hồi) ⇒ NÉM mã TOKEN_401 kèm lời mời đăng nhập lại", async () => {
    datFetch({ status: 401, than: loiKhung("token_revoked", "API token has been revoked.") });
    const e = await goiBatDauApClient("http://may", { bearer: "avgw_x" }, DV_BAT_DAU).catch((x) => x);
    expect((e as LoiSoKiemToan).ma).toBe("TOKEN_401");
    expect((e as Error).message).toMatch(/đăng nhập/i);
  });

  it("★★ 200 nhưng thân lạ ⇒ hai chuỗi rỗng (phía gọi KHÔNG ghi), không đoán", async () => {
    datFetch({ status: 200, than: { ok: true } });
    expect(await goiBatDauApClient("http://may", { bearer: "avgw_x" }, DV_BAT_DAU)).toEqual({ actionId: "", token: "" });
  });

  it("★★★ token RỖNG ⇒ NÉM trước khi chạm mạng (không một lượt fetch nào)", async () => {
    const goi = datFetch({ status: 200, than: { actionId: "A", token: "T" } });
    const e = await goiBatDauApClient("http://may", { bearer: "" }, DV_BAT_DAU).catch((x) => x);
    expect((e as LoiSoKiemToan).ma).toBe("CHUA_CO_TOKEN");
    expect(goi).toHaveLength(0);
  });

  it("★★ lỗi mạng ⇒ NÉM (không nuốt)", async () => {
    datFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(goiBatDauApClient("http://may", { bearer: "avgw_x" }, DV_BAT_DAU)).rejects.toThrow();
  });

  it("★ đường COOKIE cũ (chuỗi) vẫn đi tRPC — khung chat cũ không đổi hành vi", async () => {
    const goi = datFetch({ status: 200, than: { result: { data: { json: { actionId: "A", token: "T" } } } } });
    await goiBatDauApClient("http://may", "cookie-x", DV_BAT_DAU);
    expect(goi[0].url).toBe("http://may/api/trpc/aiCopilot.batDauApDungOClient");
    expect(goi[0].headers.cookie).toBe("app_session_id=cookie-x");
    expect(goi[0].headers.authorization).toBeUndefined();
  });
});

describe("goiChotApClient — Bearer", () => {
  const DV_CHOT = { actionId: "A1", token: "T1", thanhCong: true, sha256SauThat: "c".repeat(64) };

  it("★★★ POST /api/ai/client-apply/chot, thân JSON thẳng (kèm sha256SauThat thật) ⇒ ok:true", async () => {
    const goi = datFetch({ status: 200, than: { ok: true, status: "da_ap_client" } });
    const kq = await goiChotApClient("http://may", { bearer: "avgw_x" }, DV_CHOT);
    expect(kq).toMatchObject({ ok: true, status: "da_ap_client" });
    expect(goi[0].url).toBe("http://may/api/ai/client-apply/chot");
    expect(goi[0].headers.authorization).toBe("Bearer avgw_x");
    expect(goi[0].than).toEqual(DV_CHOT);
  });

  it("★★★ 409 {ok:false,…} ⇒ TRẢ ok:false giữ nguyên message (không ném — cùng ngữ nghĩa tRPC cũ)", async () => {
    datFetch({ status: 409, than: { ok: false, status: "invalid", message: "Token hoặc người dùng không khớp." } });
    const kq = await goiChotApClient("http://may", { bearer: "avgw_x" }, DV_CHOT);
    expect(kq).toMatchObject({ ok: false, status: "invalid", message: "Token hoặc người dùng không khớp." });
  });

  it("★★ 503 {ok:false, message:DB_UNAVAILABLE} (thân dịch vụ) ⇒ ok:false, không ném", async () => {
    datFetch({ status: 503, than: { ok: false, message: "DB_UNAVAILABLE" } });
    const kq = await goiChotApClient("http://may", { bearer: "avgw_x" }, DV_CHOT);
    expect(kq.ok).toBe(false);
    expect(kq.message).toBe("DB_UNAVAILABLE");
  });

  it("★★ khung lỗi {error} (403 insufficient_scope) ⇒ NÉM", async () => {
    datFetch({ status: 403, than: loiKhung("insufficient_scope") });
    const e = await goiChotApClient("http://may", { bearer: "avgw_x" }, DV_CHOT).catch((x) => x);
    expect((e as LoiSoKiemToan).ma).toBe("THIEU_PHAM_VI_APPLY");
  });
});
