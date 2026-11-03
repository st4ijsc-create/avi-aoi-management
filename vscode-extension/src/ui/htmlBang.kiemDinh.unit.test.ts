/**
 * ★★★ 0.6.0 (E1 + §1 CSP) — lưới WEBVIEW cho nút "Kiểm định bằng AI ngoài": chạy ĐÚNG script thật của `dungHtmlBang` trên DOM giả (khuôn
 * `htmlBang.agent.unit.test.ts`). Webview chỉ gửi mã bong bóng; khung kết quả là KHÔNG TIN CẬY (nhãn cố định, không liên kết, khối mã không nút).
 */
import { describe, it, expect } from "vitest";
import { dungHtmlBang } from "./htmlBang";

class PT {
  hidden = false;
  disabled = false;
  textContent = "";
  value = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 0;
  id = "";
  title = "";
  dataset: Record<string, string> = {};
  selectionStart: number | undefined;
  selectionEnd: number | undefined;
  con: PT[] = [];
  thuocTinh: Record<string, string> = {};
  private nghe: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public tag = "") {}
  setAttribute(k: string, v: string) {
    this.thuocTinh[k] = v;
  }
  getAttribute(k: string) {
    return this.thuocTinh[k];
  }
  classList = { toggle: () => undefined, contains: () => false };
  addEventListener(l: string, h: (e: unknown) => void) {
    (this.nghe[l] ??= []).push(h);
  }
  parentNode: PT | null = null;
  appendChild(c?: PT) {
    if (c) {
      c.parentNode = this;
      this.con.push(c);
    }
  }
  static daGo: PT[] = [];
  removeChild(c: PT) {
    PT.daGo.push(c);
    this.con = this.con.filter((x) => x !== c);
    c.parentNode = null;
  }
  private _ih = "";
  get innerHTML() {
    return this._ih;
  }
  set innerHTML(v: string) {
    this._ih = v;
    if (v === "") this.con = [];
  }
  bam() {
    for (const h of this.nghe.click ?? []) h({});
  }
}

function tatCa(p: PT, ra: PT[] = []): PT[] {
  for (const c of p.con) {
    ra.push(c);
    tatCa(c, ra);
  }
  return ra;
}

function chay() {
  const ma = dungHtmlBang({ nonce: "N" }).match(/<script nonce="N">([\s\S]*?)<\/script>/)![1];
  const kho = new Map<string, PT>();
  const nut = (id: string) => {
    if (!kho.has(id)) kho.set(id, new PT());
    return kho.get(id)!;
  };
  const theTao: string[] = [];
  const daGui: Array<Record<string, unknown>> = [];
  const nghe: Array<(e: { data: Record<string, unknown> }) => void> = [];
  const ngheDoc: Record<string, Array<(e: unknown) => void>> = {};
  new Function("document", "window", "acquireVsCodeApi", ma)(
    {
      getElementById: nut,
      addEventListener: (l: string, h: (e: unknown) => void) => (ngheDoc[l] ??= []).push(h),
      body: { classList: { add: () => undefined, remove: () => undefined } },
      createElement: (t: string) => {
        theTao.push(String(t).toLowerCase());
        return new PT(String(t).toLowerCase());
      },
    },
    { addEventListener: (_l: string, h: (e: { data: Record<string, unknown> }) => void) => nghe.push(h) },
    () => ({ postMessage: (m: Record<string, unknown>) => daGui.push(m) }),
  );
  return {
    nut,
    daGui,
    theTao,
    banTin: (m: Record<string, unknown>) => nghe.forEach((h) => h({ data: m })),
    banDoc: (l: string, e: Record<string, unknown>) => (ngheDoc[l] ?? []).forEach((h) => h(e)),
  };
}

const nutKiemDinh = (w: ReturnType<typeof chay>) => tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "nut-kiem-dinh");
const hangKiemDinh = (w: ReturnType<typeof chay>) => tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "hang-kiem-dinh");
const khungKq = (w: ReturnType<typeof chay>) => tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "khung-kiem-dinh");
const DM = (co: boolean) => ({ loai: "danh_muc_model", muc: [{ ma: "auto", nhan: "Tự động", trangThai: "san-sang" }], chon: "auto", coKiemDinh: co });

function luotXong(w: ReturnType<typeof chay>, maBong?: string) {
  w.nut("o-nhap").value = "hỏi";
  w.nut("o-che-do").value = "chat-cu";
  w.nut("nut-gui").bam();
  w.banTin({ loai: "token", chu: "đáp" });
  w.banTin({ loai: "hoan_tat", vanBanCuoi: null, cay: [{ t: "p", con: [{ t: "text", chu: "đáp" }] }], chiSoMaDau: 0, canhBao: null, ...(maBong ? { maBong } : {}) });
}

describe("webview — nút kiểm định bằng AI ngoài (0.6.0 E1)", () => {
  it("★★★ CSP: không connect-src / frame-src / img-src ngoài", () => {
    const html = dungHtmlBang({ nonce: "N" });
    const csp = html.match(/Content-Security-Policy"\s*content="([^"]*)"/)![1];
    expect(csp).not.toMatch(/connect-src|frame-src|child-src|worker-src/);
    expect(csp).not.toMatch(/img-src[^;]*(https?:|\*|blob:)/);
    expect(csp).toMatch(/default-src 'none'/);
  });

  it("★★★ bong bóng trợ lý ĐÃ XONG có mã ⇒ nút; bấm ⇒ CHỈ {loai, maBong}; bấm lại khi đang chạy ⇒ không gửi thêm", () => {
    const w = chay();
    w.banTin(DM(true));
    luotXong(w, "ma-1");
    const nut = nutKiemDinh(w);
    expect(nut).toHaveLength(1);
    expect(hangKiemDinh(w)[0]!.hidden).toBe(false);
    nut[0]!.bam();
    nut[0]!.bam();
    expect(w.daGui.filter((m) => m.loai === "kiem_dinh_bong")).toEqual([{ loai: "kiem_dinh_bong", maBong: "ma-1" }]);
    w.banTin({ loai: "kiem_dinh_trang_thai", maBong: "ma-1", chu: "Đã hủy kiểm định.", xong: true });
    expect(nut[0]!.disabled).toBe(false);
  });

  it("★★★ không có mã (host không cấp) / đang stream ⇒ KHÔNG nút", () => {
    const w = chay();
    w.banTin(DM(true));
    w.nut("o-nhap").value = "hỏi";
    w.nut("o-che-do").value = "chat-cu";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "token", chu: "đang" });
    expect(nutKiemDinh(w)).toHaveLength(0);
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, cay: [], chiSoMaDau: 0, canhBao: null });
    expect(nutKiemDinh(w)).toHaveLength(0);
  });

  it("★★ danh mục không có model kiểm định ⇒ hàng nút ẩn; có lại ⇒ hiện", () => {
    const w = chay();
    luotXong(w, "ma-1");
    expect(hangKiemDinh(w)[0]!.hidden).toBe(true);
    w.banTin(DM(true));
    expect(hangKiemDinh(w)[0]!.hidden).toBe(false);
    w.banTin(DM(false));
    expect(hangKiemDinh(w)[0]!.hidden).toBe(true);
  });

  it("★★ khôi phục: chỉ lượt AI có mã mới có nút; agent xong 'hoan-thanh' + mã ⇒ nút, lý do khác ⇒ không", () => {
    const w = chay();
    w.banTin(DM(true));
    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "q", maBong: "gia" }, { vaiTro: "assistant", noiDung: "a", cay: [], maBong: "ma-a" }] });
    expect(nutKiemDinh(w)).toHaveLength(1);
    w.nut("o-nhap").value = "sửa";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "xong" }] }] });
    w.banTin({ loai: "ag_xong", lyDo: "het-vong", coHoanTac: false, maBong: "ma-x" });
    expect(nutKiemDinh(w)).toHaveLength(1);
    w.nut("o-nhap").value = "sửa 2";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "xong" }] }] });
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false, maBong: "ma-y" });
    expect(nutKiemDinh(w)).toHaveLength(2);
  });

  it("★★★ kết quả: nhãn 'AI ngoài — không tin cậy' (ép nếu host gửi nhãn khác), liên kết KHÔNG có href, khối mã KHÔNG có nút Chép/Chèn/Áp dụng, chạy lại thay khung cũ", () => {
    const w = chay();
    w.banTin(DM(true));
    luotXong(w, "ma-1");
    const cay = [
      { t: "p", con: [{ t: "a", href: "https://evil.example/x", con: [{ t: "text", chu: "bấm" }] }, { t: "text", chu: "<img src=http://evil.example/a.png>" }] },
      { t: "code", ngonNgu: "sh", ma: "rm -rf /" },
    ];
    w.banTin({ loai: "kiem_dinh_kq", maBong: "ma-1", nhan: "Tin tưởng tuyệt đối", cay });
    let k = khungKq(w);
    expect(k).toHaveLength(1);
    const cac = tatCa(k[0]!);
    expect(cac.find((p) => p.className === "nhan-khong-tin-cay")!.textContent).toBe("AI ngoài — không tin cậy");
    expect(cac.filter((p) => p.tag === "a")).toHaveLength(0);
    expect(cac.filter((p) => p.className === "nut-khoi-ma")).toHaveLength(0);
    expect(cac.some((p) => p.tag === "img")).toBe(false);
    expect(cac.map((p) => p.textContent).join("|")).toContain("<img src=http://evil.example/a.png>");
    w.banTin({ loai: "kiem_dinh_kq", maBong: "ma-1", nhan: "AI ngoài — không tin cậy · anthropic/claude-x", cay: [] });
    k = khungKq(w);
    expect(k).toHaveLength(1);
    expect(tatCa(k[0]!).find((p) => p.className === "nhan-khong-tin-cay")!.textContent).toBe("AI ngoài — không tin cậy · anthropic/claude-x");
  });

  it("★★ kết quả cho mã lạ ⇒ bỏ qua", () => {
    const w = chay();
    luotXong(w, "ma-1");
    w.banTin({ loai: "kiem_dinh_kq", maBong: "khac", nhan: "x", cay: [] });
    expect(khungKq(w)).toHaveLength(0);
  });
});
