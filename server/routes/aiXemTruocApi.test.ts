/**
 * ★★★ Đợt 3c (2026-10-17) — `GET /api/ai/preview/:projectId[/*]` trên ỨNG DỤNG CHÍNH: kiểm PHIÊN + CHỦ, cấp VÉ MỘT
 * LẦN rồi chuyển hướng sang ORIGIN RIÊNG của proxy. Tuyến này KHÔNG proxy một byte nào trên origin ứng dụng.
 *
 * (Lượng từ "không cookie ⇒ 401/403" trên handler THẬT do `xacThucBeMatRest.test.ts` §2 canh — registrar này nằm
 *  trong DA_GOI của lưới ấy.)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerAiXemTruocRoutes, type PhuThuocTuyenXemTruoc } from "./aiXemTruocApi";
import { DUONG_VAO, KhoVeXemTruoc } from "../services/ai/chayUngDung/proxyXemTruoc";

type XuLy = (req: any, res: any) => Promise<void> | void;

function ghiTuyen(deps: PhuThuocTuyenXemTruoc): Map<string, XuLy> {
  const t = new Map<string, XuLy>();
  const app: any = { get: (d: string, h: XuLy) => t.set(d, h) };
  registerAiXemTruocRoutes(app, deps);
  return t;
}

function goi(h: XuLy, params: Record<string, string>, query: Record<string, string> = {}, hostnameHoacNull: string | null = "may-chu.local") {
  const hostname = hostnameHoacNull ?? undefined; // null ⇒ `req.hostname` VẮNG thật (undefined kích hoạt giá trị mặc định)
  const ra = { ma: 0, than: null as unknown, chuyen: null as string | null };
  const res: any = {
    status(m: number) {
      ra.ma = m;
      return res;
    },
    json(b: unknown) {
      ra.than = b;
      return res;
    },
    setHeader() {},
    redirect(m: number, u: string) {
      ra.ma = m;
      ra.chuyen = u;
    },
  };
  const req: any = { params, query, protocol: "http", hostname, headers: {}, originalUrl: "" };
  return Promise.resolve(h(req, res)).then(() => ra);
}

let kho: KhoVeXemTruoc;
let chay: Map<string, { chuSoHuu: number; cong: number }>;
let coQuyen = true;
let nguoiDung: { ok: true; user: any } | { ok: false; ma: 401 | 403 | 500; lyDo: any } = { ok: true, user: { id: 7, role: "engineer" } };
let bat = true;
let originCongKhai: string | null = "http://10.0.0.9:5099";

function deps(): PhuThuocTuyenXemTruoc {
  return {
    xacThuc: async () => nguoiDung as any,
    coQuyenXem: async () => coQuyen,
    // Mô phỏng repoProjects: "rieng-8" là dự án CÁ NHÂN của người 8 — người khác (không admin) ⇒ không phân giải được.
    phanGiaiGoc: (id, ng) => ({ ok: id !== "rieng-8" || ng?.id === 8 || ng?.role === "admin" }),
    kho,
    ungDung: {
      trangThai: (id) => (chay.has(id) ? { chuSoHuu: chay.get(id)!.chuSoHuu } : null),
      congCuaDuAn: (id) => chay.get(id)?.cong ?? null,
    },
    cauHinh: () => ({ bat, cong: 5099, originCongKhai }) as any,
  };
}

beforeEach(() => {
  kho = new KhoVeXemTruoc();
  chay = new Map([["du-an-a", { chuSoHuu: 7, cong: 5100 }]]);
  coQuyen = true;
  nguoiDung = { ok: true, user: { id: 7, role: "engineer" } };
  bat = true;
  originCongKhai = "http://10.0.0.9:5099";
});

describe("§1 — đăng ký đúng hai tuyến GET", () => {
  it("★★ `/api/ai/preview/:projectId` và `/api/ai/preview/:projectId/*`", () => {
    expect([...ghiTuyen(deps()).keys()].sort()).toEqual(["/api/ai/preview/:projectId", "/api/ai/preview/:projectId/*"]);
  });
});

describe("§2 — xác thực + chủ sở hữu", () => {
  it("★★★ không phiên ⇒ 401 (mã của tầng xác thực), KHÔNG cấp vé", async () => {
    nguoiDung = { ok: false, ma: 401, lyDo: "AUTH_REQUIRED" };
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(r.ma).toBe(401);
    expect(r.chuyen).toBeNull();
  });

  it("★★★ NGƯỜI KHÁC (không phải người chạy ứng dụng) ⇒ 404 — không tiết lộ dự án đang chạy", async () => {
    nguoiDung = { ok: true, user: { id: 8, role: "engineer" } };
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(r.ma).toBe(404);
    expect(r.chuyen).toBeNull();
  });

  it("★★★ dự án CÁ NHÂN của người khác ⇒ 404 KỂ CẢ khi sổ tiến trình (giả định hỏng) ghi người hỏi là chủ", async () => {
    chay.set("rieng-8", { chuSoHuu: 7, cong: 5101 });
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "rieng-8" });
    expect(r.ma).toBe(404);
    expect(r.chuyen).toBeNull();
    nguoiDung = { ok: true, user: { id: 8, role: "engineer" } };
    chay.set("rieng-8", { chuSoHuu: 8, cong: 5101 });
    expect((await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "rieng-8" })).ma).toBe(302);
  });

  it("★★ mất quyền ai_repo_read/canView ⇒ 403", async () => {
    coQuyen = false;
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(r.ma).toBe(403);
  });

  it("★★ dự án không chạy / id méo ⇒ 404", async () => {
    const h = ghiTuyen(deps()).get("/api/ai/preview/:projectId")!;
    expect((await goi(h, { projectId: "khong-co" })).ma).toBe(404);
    expect((await goi(h, { projectId: "../etc" })).ma).toBe(404);
  });

  it("★★ proxy TẮT ⇒ 503 PREVIEW_DISABLED (nói rõ, không chuyển hướng tới cổng chết)", async () => {
    bat = false;
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(r.ma).toBe(503);
    expect((r.than as any).code).toBe("PREVIEW_DISABLED");
  });
});

describe("§3 — chủ ⇒ 302 sang ORIGIN RIÊNG với vé MỘT LẦN", () => {
  it("★★★ chuyển tới <AI_PREVIEW_PUBLIC_ORIGIN>/__ai_xem_truoc/vao?t=<vé>&p=<đường con> — vé đổi được ĐÚNG một lần", async () => {
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId/*")!, { projectId: "du-an-a", 0: "src/trang" }, { a: "1" });
    expect(r.ma).toBe(302);
    const u = new URL(r.chuyen!);
    expect(u.origin).toBe("http://10.0.0.9:5099");
    expect(u.pathname).toBe(DUONG_VAO);
    expect(u.searchParams.get("p")).toBe("/src/trang?a=1");
    const ve = u.searchParams.get("t")!;
    expect(kho.doiVe(ve)).toEqual({ userId: 7, projectId: "du-an-a" });
    expect(kho.doiVe(ve)).toBeNull();
  });

  it("★★ AI_PREVIEW_PUBLIC_ORIGIN (host khác ⇒ khác SITE) được dùng nguyên văn", async () => {
    const d = deps();
    d.cauHinh = () => ({ bat: true, cong: 5099, originCongKhai: "http://10.0.0.9:5099" }) as any;
    const r = await goi(ghiTuyen(d).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(new URL(r.chuyen!).origin).toBe("http://10.0.0.9:5099");
  });
});

describe("§4 — ★★★ vá cookie-tossing: CÙNG SITE ⇒ KHÔNG cấp vé (fail-closed)", () => {
  function demVe(d: PhuThuocTuyenXemTruoc): { n: number } {
    const dem = { n: 0 };
    const goc = d.kho.capVe.bind(d.kho);
    d.kho = Object.assign(Object.create(Object.getPrototypeOf(d.kho)), d.kho, {
      capVe: (u: number, p: string) => {
        dem.n++;
        return goc(u, p);
      },
    });
    return dem;
  }

  it("★★★ không có origin RIÊNG (originCongKhai null) ⇒ 503, KHÔNG suy origin từ host của yêu cầu, KHÔNG cấp vé", async () => {
    originCongKhai = null;
    const d = deps();
    const dem = demVe(d);
    const r = await goi(ghiTuyen(d).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" });
    expect(r.ma).toBe(503);
    expect(r.chuyen).toBeNull();
    expect(dem.n).toBe(0);
  });

  for (const [hostApp, origin] of [
    ["may-chu.local", "http://may-chu.local:5099"],
    ["127.0.0.2", "http://127.0.0.2:5099"],
    ["localhost", "http://127.0.0.1:5099"],
    ["[::1]", "http://localhost:5099"],
    ["mes.factory.vn", "http://preview.factory.vn:5099"],
  ] as const) {
    it(`★★★ ứng dụng ở ${hostApp} + xem trước ở ${origin} ⇒ 409 PREVIEW_SAME_SITE, không vé, có gợi ý cấu hình`, async () => {
      originCongKhai = origin;
      const d = deps();
      const dem = demVe(d);
      const r = await goi(ghiTuyen(d).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" }, {}, hostApp);
      expect(r.ma).toBe(409);
      expect(r.chuyen).toBeNull();
      expect((r.than as any).code).toBe("PREVIEW_SAME_SITE");
      expect(String((r.than as any).goiY)).toContain("AI_PREVIEW_PUBLIC_ORIGIN");
      expect(dem.n).toBe(0);
    });
  }

  it("★★★ host yêu cầu vắng ⇒ fail-closed 409", async () => {
    const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" }, {}, null);
    expect(r.ma).toBe(409);
  });

  it("★★ KHÁC site ⇒ cấp: ứng dụng ở 127.0.0.1 / localhost, xem trước ở 127.0.0.2", async () => {
    originCongKhai = "http://127.0.0.2:5099";
    for (const hostApp of ["127.0.0.1", "localhost"]) {
      const r = await goi(ghiTuyen(deps()).get("/api/ai/preview/:projectId")!, { projectId: "du-an-a" }, {}, hostApp);
      expect(r.ma, hostApp).toBe(302);
      expect(new URL(r.chuyen!).origin).toBe("http://127.0.0.2:5099");
    }
  });
});
