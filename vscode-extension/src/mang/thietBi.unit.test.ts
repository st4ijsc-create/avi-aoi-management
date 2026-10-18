/**
 * ★★★ ĐỢT 4B — lưới DEVICE FLOW: mã hết hạn, bị từ chối, slow_down, lưu token CHỈ qua `luuToken` (SecretStorage),
 * đường xác nhận ghép vào ĐÚNG máy chủ đang gọi (không tin URL tuyệt đối từ đáp ứng).
 */
import { describe, it, expect } from "vitest";
import { dangNhapThietBi, thuHoiTokenCuaMinh } from "./thietBi";
import { docPhanHoiDoiMa, docPhanHoiTuThuHoi, docPhanHoiXinMa, thongDiepDangXuat } from "../loi/thietBi";

type DapGia = { status: number; than: unknown };

function fetchGia(xin: DapGia, doi: DapGia[]) {
  const goi: Array<{ url: string; than: unknown }> = [];
  const f = (async (url: string, init?: { body?: string }) => {
    goi.push({ url, than: init?.body ? JSON.parse(init.body) : undefined });
    const d = url.endsWith("/doi") ? (doi.shift() ?? { status: 400, than: { error: "authorization_pending" } }) : xin;
    return { status: d.status, json: async () => d.than } as Response;
  }) as unknown as typeof fetch;
  return { f, goi };
}

const XIN_OK: DapGia = {
  status: 200,
  than: {
    device_code: "d".repeat(43),
    user_code: "ABCD-EFGH",
    verification_path: "/ai-thiet-bi",
    // Máy chủ sau rà bảo mật de591c868 #3: đường hoàn chỉnh KHÔNG mang mã (người dùng tự gõ mã).
    verification_path_complete: "/ai-thiet-bi",
    expires_in: 600,
    interval: 5,
  },
};

function dongHoGia() {
  let t = 0;
  return {
    dongHo: () => t,
    ngu: async (ms: number) => {
      t += ms;
    },
    get t() {
      return t;
    },
  };
}

describe("device flow — dangNhapThietBi", () => {
  it("★★★ được duyệt ⇒ token CHỈ vào luuToken; mở đúng URL ghép từ máy chủ đang gọi", async () => {
    const { f, goi } = fetchGia(XIN_OK, [
      { status: 400, than: { error: "authorization_pending" } },
      { status: 200, than: { access_token: "avgw_bimat123", token_type: "Bearer", expires_at: "2027-01-01", token_prefix: "avgw_bim" } },
    ]);
    const daLuu: string[] = [];
    const daMo: string[] = [];
    const dh = dongHoGia();
    const kq = await dangNhapThietBi({
      serverUrl: "http://may-chu:3000/",
      tenThietBi: "VSCode",
      fetch: f,
      moTrinhDuyet: (u) => {
        daMo.push(u);
        return true;
      },
      luuToken: async (t) => {
        daLuu.push(t);
      },
      ngu: dh.ngu,
      dongHo: dh.dongHo,
    });
    expect(kq).toEqual({ ok: true, tienTo: "avgw_bim", hetHanLuc: "2027-01-01" });
    expect(daLuu).toEqual(["avgw_bimat123"]);
    expect(daMo).toEqual(["http://may-chu:3000/ai-thiet-bi"]);
    // kết quả KHÔNG mang token ra ngoài (UI không bao giờ thấy bản rõ)
    expect(JSON.stringify(kq)).not.toContain("bimat123");
    expect(goi[0].than).toMatchObject({ phamVi: ["chat", "fim", "apply"] });
    expect(goi.filter((g) => g.url.endsWith("/doi")).every((g) => (g.than as { device_code: string }).device_code.length === 43)).toBe(true);
  });

  it("★★★ bị TỪ CHỐI ⇒ ok:false ly:tu-choi, KHÔNG lưu gì", async () => {
    const { f } = fetchGia(XIN_OK, [{ status: 400, than: { error: "access_denied" } }]);
    const daLuu: string[] = [];
    const dh = dongHoGia();
    const kq = await dangNhapThietBi({
      serverUrl: "http://x:3000",
      tenThietBi: "t",
      fetch: f,
      moTrinhDuyet: () => true,
      luuToken: async (t) => void daLuu.push(t),
      ngu: dh.ngu,
      dongHo: dh.dongHo,
    });
    expect(kq.ok).toBe(false);
    expect(kq.ok === false && kq.ly).toBe("tu-choi");
    expect(daLuu).toEqual([]);
  });

  it("★★★ mã HẾT HẠN — máy chủ nói expired_token ⇒ dừng", async () => {
    const { f } = fetchGia(XIN_OK, [{ status: 400, than: { error: "expired_token" } }]);
    const dh = dongHoGia();
    const kq = await dangNhapThietBi({ serverUrl: "http://x", tenThietBi: "t", fetch: f, moTrinhDuyet: () => true, luuToken: async () => {}, ngu: dh.ngu, dongHo: dh.dongHo });
    expect(kq.ok === false && kq.ly).toBe("het-han");
  });

  it("★★★ mã HẾT HẠN theo đồng hồ CỤC BỘ dù máy chủ cứ 'pending' — không hỏi mãi", async () => {
    const { f, goi } = fetchGia({ ...XIN_OK, than: { ...(XIN_OK.than as object), expires_in: 20 } }, []);
    const dh = dongHoGia();
    const kq = await dangNhapThietBi({ serverUrl: "http://x", tenThietBi: "t", fetch: f, moTrinhDuyet: () => true, luuToken: async () => {}, ngu: dh.ngu, dongHo: dh.dongHo });
    expect(kq.ok === false && kq.ly).toBe("het-han");
    expect(goi.filter((g) => g.url.endsWith("/doi")).length).toBeLessThanOrEqual(4);
  });

  it("★★ slow_down ⇒ chu kỳ +5 s", async () => {
    const { f } = fetchGia(XIN_OK, [
      { status: 400, than: { error: "slow_down" } },
      { status: 200, than: { access_token: "avgw_x" } },
    ]);
    const cho: number[] = [];
    let t = 0;
    await dangNhapThietBi({
      serverUrl: "http://x",
      tenThietBi: "t",
      fetch: f,
      moTrinhDuyet: () => true,
      luuToken: async () => {},
      ngu: async (ms) => {
        cho.push(ms);
        t += ms;
      },
      dongHo: () => t,
    });
    expect(cho).toEqual([5000, 10000]);
  });

  it("★★ huỷ giữa chừng ⇒ ly:huy", async () => {
    const ac = new AbortController();
    const { f } = fetchGia(XIN_OK, []);
    const kq = await dangNhapThietBi({
      serverUrl: "http://x",
      tenThietBi: "t",
      fetch: f,
      moTrinhDuyet: () => {
        ac.abort();
        return true;
      },
      luuToken: async () => {},
      ngu: async () => {},
      signal: ac.signal,
    });
    expect(kq.ok === false && kq.ly).toBe("huy");
  });
});

describe("device flow — diễn dịch đáp ứng (thuần)", () => {
  it("★★★ đường xác nhận TUYỆT ĐỐI / '//' từ máy chủ bị bác (chống chèn Host)", () => {
    for (const xau of ["http://ke-gian/ai-thiet-bi", "//ke-gian/x", "javascript:alert(1)"]) {
      const kq = docPhanHoiXinMa(200, { device_code: "d".repeat(43), user_code: "A-B", verification_path: xau, verification_path_complete: xau });
      expect(kq.ok).toBe(false);
    }
  });
  it("★★★ (chống lừa đảo mã) extension KHÔNG tự gắn mã vào URL xác nhận khi máy chủ chỉ trả verification_path", () => {
    const kq = docPhanHoiXinMa(200, { device_code: "d".repeat(43), user_code: "ABCD-EFGH", verification_path: "/ai-thiet-bi" });
    expect(kq.ok && kq.ma.duongXacNhan).toBe("/ai-thiet-bi");
  });
  it("★★ token sai khuôn (không avgw_) ⇒ lỗi, không coi là xong", () => {
    expect(docPhanHoiDoiMa(200, { access_token: "sk-abc" }).loai).toBe("loi");
  });
  it("★★ 409 token_limit_reached ⇒ lỗi rõ", () => {
    const kq = docPhanHoiDoiMa(409, { error: "token_limit_reached" });
    expect(kq.loai === "loi" && kq.lyDo).toMatch(/quá nhiều token/);
  });
});

/**
 * ★★★ 4B-client — ĐĂNG XUẤT THU HỒI THẬT (`POST /api/ai/gateway-token/tu-thu-hoi`, Bearer). Máy chủ:
 * 200 `{revoked, already_revoked, token_prefix}` · 401 `invalid_api_key` (máy chủ không biết băm này) · 429 · 503.
 * Chỉ 200 (hoặc 401 "không nhận ra" — token này không mở được cửa nào) mới được khai "token đã chết trên máy chủ".
 */
describe("tự thu hồi token — docPhanHoiTuThuHoi (thuần)", () => {
  it("★★★ 200 revoked ⇒ vừa thu hồi, kèm tiền tố", () => {
    expect(docPhanHoiTuThuHoi(200, { revoked: true, already_revoked: false, token_prefix: "avgw_ab" })).toEqual({
      ok: true,
      ketCuc: "vua-thu-hoi",
      tienTo: "avgw_ab",
    });
  });
  it("★★ 200 already_revoked ⇒ đã thu hồi từ trước", () => {
    expect(docPhanHoiTuThuHoi(200, { revoked: true, already_revoked: true, token_prefix: "avgw_ab" })).toMatchObject({ ok: true, ketCuc: "da-thu-hoi-truoc" });
  });
  it("★★ 401 invalid_api_key ⇒ máy chủ không nhận ra token (không còn mở cửa nào)", () => {
    expect(docPhanHoiTuThuHoi(401, { error: { code: "invalid_api_key", message: "Invalid API token." } })).toMatchObject({ ok: true, ketCuc: "khong-nhan-ra" });
  });
  it("★★★ 503 / 429 / 200 thân lạ ⇒ ok:false (KHÔNG khai đã thu hồi)", () => {
    expect(docPhanHoiTuThuHoi(503, { error: { code: "auth_backend_unavailable" } }).ok).toBe(false);
    expect(docPhanHoiTuThuHoi(429, { error: { code: "rate_limit_exceeded" } }).ok).toBe(false);
    expect(docPhanHoiTuThuHoi(200, { ok: true }).ok).toBe(false);
    expect(docPhanHoiTuThuHoi(403, { error: { code: "license_required" } }).ok).toBe(false);
  });
});

describe("tự thu hồi token — thuHoiTokenCuaMinh (I/O)", () => {
  it("★★★ POST Bearer tới /api/ai/gateway-token/tu-thu-hoi của ĐÚNG máy chủ, không thân bí mật nào khác", async () => {
    const goi: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    const f = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      goi.push({ url, init });
      return { status: 200, json: async () => ({ revoked: true, already_revoked: false, token_prefix: "avgw_x" }) } as Response;
    }) as unknown as typeof fetch;
    const kq = await thuHoiTokenCuaMinh({ serverUrl: "http://may:3000/", token: "avgw_bimat", fetch: f });
    expect(kq).toMatchObject({ ok: true, ketCuc: "vua-thu-hoi" });
    expect(goi).toHaveLength(1);
    expect(goi[0].url).toBe("http://may:3000/api/ai/gateway-token/tu-thu-hoi");
    expect(goi[0].init?.method).toBe("POST");
    expect(goi[0].init?.headers?.authorization).toBe("Bearer avgw_bimat");
    expect(goi[0].init?.body).toBeUndefined();
  });

  it("★★★ lỗi mạng ⇒ ok:false (KHÔNG ném) — phía gọi vẫn xoá cục bộ và cảnh báo", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const kq = await thuHoiTokenCuaMinh({ serverUrl: "http://may", token: "avgw_x", fetch: f });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.lyDo).toMatch(/fetch failed|không nối/i);
  });

  it("★★ serverUrl hỏng ⇒ ok:false, không gọi mạng", async () => {
    let dem = 0;
    const f = (async () => {
      dem++;
      return { status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const kq = await thuHoiTokenCuaMinh({ serverUrl: "file:///x", token: "avgw_x", fetch: f });
    expect(kq.ok).toBe(false);
    expect(dem).toBe(0);
  });
});

describe("tự thu hồi token — thongDiepDangXuat (thuần)", () => {
  it("★★★ thu hồi được ⇒ nói đã thu hồi trên máy chủ", () => {
    expect(thongDiepDangXuat(true, { ok: true, ketCuc: "vua-thu-hoi", tienTo: "avgw_ab" })).toMatch(/đã thu hồi.*máy chủ/i);
  });
  it("★★★ thu hồi HỎNG ⇒ vẫn đăng xuất cục bộ + CẢNH BÁO token còn sống tới khi thu hồi trên web", () => {
    const tb = thongDiepDangXuat(true, { ok: false, lyDo: "Không nối được máy chủ" });
    expect(tb).toMatch(/xoá.*máy này/i);
    expect(tb).toMatch(/còn (sống|hiệu lực)/i);
    expect(tb).toMatch(/\/ai-thiet-bi/);
    expect(tb).toContain("Không nối được máy chủ");
  });
  it("★★ không có token ⇒ chỉ 'đã đăng xuất'", () => {
    expect(thongDiepDangXuat(false, undefined)).toBe("AI Local: đã đăng xuất.");
  });
});
