/**
 * ★★★ ĐỢT 4B — lưới DEVICE FLOW: mã hết hạn, bị từ chối, slow_down, lưu token CHỈ qua `luuToken` (SecretStorage),
 * đường xác nhận ghép vào ĐÚNG máy chủ đang gọi (không tin URL tuyệt đối từ đáp ứng).
 */
import { describe, it, expect } from "vitest";
import { dangNhapThietBi } from "./thietBi";
import { docPhanHoiDoiMa, docPhanHoiXinMa } from "../loi/thietBi";

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
    expect(goi[0].than).toMatchObject({ phamVi: ["chat", "fim"] });
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
