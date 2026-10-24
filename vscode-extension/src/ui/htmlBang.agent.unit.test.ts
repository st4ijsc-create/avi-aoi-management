/**
 * ★★★ ĐỢT 4B — lưới WEBVIEW phần agent: chạy ĐÚNG script thật của `dungHtmlBang` trên DOM giả (khuôn
 * `htmlBang.unit.test.ts`), ghi lại MỌI thẻ được tạo để chứng minh markdown chỉ dựng thẻ trong danh sách trắng, không
 * `innerHTML` với nội dung, CSP giữ nguyên; chế độ mặc định = Agent duyệt từng bước; thẻ duyệt từng tệp; khối mã.
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
  appendChild(c?: PT) {
    if (c) this.con.push(c);
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
  new Function("document", "window", "acquireVsCodeApi", ma)(
    {
      getElementById: nut,
      addEventListener: () => undefined,
      body: { classList: { add: () => undefined, remove: () => undefined } },
      createElement: (t: string) => {
        theTao.push(String(t).toLowerCase());
        return new PT(String(t).toLowerCase());
      },
    },
    { addEventListener: (_l: string, h: (e: { data: Record<string, unknown> }) => void) => nghe.push(h) },
    () => ({ postMessage: (m: Record<string, unknown>) => daGui.push(m) }),
  );
  return { nut, daGui, theTao, banTin: (m: Record<string, unknown>) => nghe.forEach((h) => h({ data: m })) };
}

describe("webview agent — tĩnh", () => {
  const html = dungHtmlBang({ nonce: "N" });
  it("★★★ CSP KHOÁ giữ nguyên: default-src 'none', script chỉ bằng nonce, không unsafe-inline/eval", () => {
    // 2026-10-24: chỉ MỞ THÊM `img-src data:` (ảnh thu nhỏ của chip đính kèm do CHÍNH webview tạo bằng FileReader) — không nguồn ngoài nào khác.
    expect(html).toContain(`default-src 'none'; img-src data:; style-src 'nonce-N'; script-src 'nonce-N';`);
    expect(html).not.toMatch(/img-src[^;]*(https?:|\*)/);
    expect(html).not.toMatch(/unsafe-(inline|eval)/);
  });
  it("★★★ script KHÔNG gán innerHTML với nội dung (chỉ được dọn bằng chuỗi rỗng)", () => {
    // Bỏ chú thích trước khi soi (chú thích có nhắc `innerHTML = ""` bằng chữ).
    const ma = html
      .match(/<script nonce="N">([\s\S]*?)<\/script>/)![1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const gan = [...ma.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(gan.length).toBeGreaterThan(0);
    expect(gan.every((v) => v === '""')).toBe(true);
    expect(ma).not.toMatch(/insertAdjacentHTML|outerHTML\s*=|document\.write|DOMParser|eval\(/);
  });
  it("★★★ chế độ mặc định = Agent duyệt từng bước (option ĐẦU của #o-che-do), có 'Chat cũ'", () => {
    const o = html.match(/<select id="o-che-do"[\s\S]*?<\/select>/)![0];
    expect(o.match(/<option value="([^"]+)"/)![1]).toBe("sua");
    expect(o).toContain('value="chat-cu"');
    expect(o).toContain('value="tu-dong"');
  });
});

describe("webview agent — hành vi", () => {
  it("★★★ gửi câu hỏi: ô chế độ rỗng ⇒ cheDoAgent 'sua'; 'chat-cu' ⇒ đường cũ; Cmd+K ⇒ đường cũ", () => {
    const w = chay();
    w.nut("o-nhap").value = "sửa lỗi";
    w.nut("nut-gui").bam();
    w.nut("o-che-do").value = "chat-cu";
    w.nut("o-nhap").value = "hỏi kiểu cũ";
    w.nut("nut-gui").bam();
    w.nut("o-che-do").value = "tu-dong";
    w.banTin({ loai: "dat_cau_hoi_tu_lenh", cauHoi: "CmdK" });
    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi.map((m) => m.cheDoAgent)).toEqual(["sua", undefined, undefined]);
  });

  it("★★★ markdown: chỉ thẻ danh sách trắng được tạo; <script>/<img> là CHỮ; nút lạ bị bỏ; href javascript: không gắn", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    const truoc = w.theTao.length;
    w.banTin({
      loai: "ag_md",
      chiSoMaDau: 0,
      cay: [
        { t: "p", con: [{ t: "text", chu: "<script>alert(1)</script>" }, { t: "strong", con: [{ t: "text", chu: "<img src=x onerror=alert(1)>" }] }] },
        { t: "script", con: [{ t: "text", chu: "bị bỏ" }] },
        { t: "iframe" },
        { t: "a", href: "javascript:alert(1)", con: [{ t: "text", chu: "bấm" }] },
        { t: "a", href: "https://vi.wikipedia.org", con: [{ t: "text", chu: "wiki" }] },
      ],
    });
    const moi = w.theTao.slice(truoc);
    const DUOC = new Set(["p", "span", "strong", "a", "div", "code", "pre", "button", "em", "del", "ul", "ol", "li", "blockquote", "br", "hr", "table", "tr", "th", "td", "h3", "h4", "h5", "h6"]);
    expect(moi.filter((t) => !DUOC.has(t))).toEqual([]);
    const cac = tatCa(w.nut("hoi-thoai"));
    const chu = cac.map((p) => p.textContent).join("|");
    expect(chu).toContain("<script>alert(1)</script>");
    expect(chu).not.toContain("bị bỏ");
    const a = cac.filter((p) => p.tag === "a");
    expect(a.map((x) => x.thuocTinh.href)).toEqual([undefined, "https://vi.wikipedia.org"]);
  });

  it("★★★ khối mã có Chép/Chèn/Áp dụng; chỉ số TOÀN CỤC = chiSoMaDau + thứ tự", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 3, cay: [{ t: "code", ngonNgu: "ts", ma: "const a = 1;" }, { t: "code", ngonNgu: "", ma: "b" }] });
    const nutMa = tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "nut-khoi-ma");
    expect(nutMa.map((n) => n.textContent)).toEqual(["Chép", "Chèn", "Áp dụng", "Chép", "Chèn", "Áp dụng"]);
    nutMa[2].bam();
    nutMa[3].bam();
    expect(w.daGui.filter((m) => m.loai === "ag_khoi_ma")).toEqual([
      { loai: "ag_khoi_ma", chiSo: 3, hanhDong: "ap-dung" },
      { loai: "ag_khoi_ma", chiSo: 4, hanhDong: "chep" },
    ]);
    expect(tatCa(w.nut("hoi-thoai")).some((p) => p.tag === "code" && p.textContent === "const a = 1;")).toBe(true);
  });

  it("★★★ thẻ duyệt TỪNG TỆP: Xem diff · Duyệt (một lần) · Bác kèm lý do", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_the_duyet", id: "c1", loaiDuyet: "ghi", tomTat: "Sửa src/a.ts", duong: "src/a.ts", coDiff: true });
    w.banTin({ loai: "ag_the_duyet", id: "c2", loaiDuyet: "ghi", tomTat: "Tạo src/b.ts", duong: "src/b.ts", coDiff: true });
    const the = tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "ag-the");
    expect(the).toHaveLength(2);
    const nutCua = (t: PT) => tatCa(t).filter((p) => p.tag === "button");
    const [diff1, ok1] = nutCua(the[0]);
    diff1.bam();
    ok1.bam();
    ok1.bam();
    const [, , bac2] = nutCua(the[1]);
    tatCa(the[1]).find((p) => p.tag === "input")!.value = "giữ API cũ";
    bac2.bam();
    expect(w.daGui.filter((m) => String(m.loai).startsWith("ag_"))).toEqual([
      { loai: "ag_xem_diff", id: "c1" },
      { loai: "ag_duyet", id: "c1" },
      { loai: "ag_bac", id: "c2", lyDo: "giữ API cũ" },
    ]);
  });

  it("★★ dòng thời gian tool + kế hoạch + kết thúc có Hoàn tác", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_goi_tool", id: "t1", ten: "read_file", moTa: "đọc src/a.ts" });
    w.banTin({ loai: "ag_ket_qua_tool", id: "t1", ok: true, tomTat: "File: src/a.ts" });
    w.banTin({ loai: "ag_ke_hoach", viec: [{ noiDung: "Đọc mã", trangThai: "xong" }, { noiDung: "Sửa", trangThai: "dang-lam" }] });
    const cac = tatCa(w.nut("hoi-thoai"));
    expect(cac.some((p) => p.className === "ag-tool" && p.textContent === "✓ đọc src/a.ts")).toBe(true);
    expect(cac.filter((p) => p.textContent === "☑ Đọc mã" || p.textContent === "◐ Sửa")).toHaveLength(2);
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: true });
    expect(w.nut("nut-hoan-tac").hidden).toBe(false);
    expect(w.nut("nut-dung").hidden).toBe(true);
    w.nut("nut-hoan-tac").bam();
    expect(w.daGui.at(-1)).toEqual({ loai: "ag_hoan_tac" });
  });

  it("★★ lỗi thiếu token ⇒ nút 'Đăng nhập AI Local (device flow)' gửi ag_dang_nhap_thiet_bi", () => {
    const w = chay();
    w.banTin({ loai: "ag_loi", thongDiep: "Chưa có token", ma: "CHUA_CO_TOKEN" });
    const nutDn = tatCa(w.nut("hoi-thoai")).find((p) => p.textContent === "Đăng nhập AI Local (device flow)")!;
    nutDn.bam();
    expect(w.daGui.at(-1)).toEqual({ loai: "ag_dang_nhap_thiet_bi" });
    expect(w.nut("nut-token").hidden).toBe(false);
  });

  it("★★ đồng hồ ngữ cảnh: ước lượng có dấu ~", () => {
    const w = chay();
    w.banTin({ loai: "ag_usage", vao: 12345, ctxPhanTram: 19, uocLuong: true });
    expect(w.nut("dong-ho-token").textContent).toBe("Ngữ cảnh: ~12.3k token (19%)");
  });

  it("★★ đề xuất nhớ: Nhớ ⇒ ag_nho (một lần)", () => {
    const w = chay();
    w.banTin({ loai: "ag_de_xuat_nho", id: "n1", note: "Dùng pnpm", scope: "project" });
    const nutNho = tatCa(w.nut("hoi-thoai")).find((p) => p.tag === "button" && p.textContent === "Nhớ")!;
    nutNho.bam();
    expect(w.daGui.filter((m) => m.loai === "ag_nho")).toEqual([{ loai: "ag_nho", id: "n1" }]);
  });
});

describe("webview agent — cảnh báo nội dung đáng ngờ (2026-10-17)", () => {
  it("★★ ag_canh_bao ⇒ dòng hệ thống 'Cảnh báo' / 'Đã hạ tự trị' (chữ trơn), lượt không bị kết thúc", () => {
    const w = chay();
    w.banTin({ loai: "ag_canh_bao", haTuTri: false, thongDiep: "Nội dung đọc từ <b>x</b> chứa câu dạng mệnh lệnh" });
    w.banTin({ loai: "ag_canh_bao", haTuTri: true, thongDiep: "Đã hạ tự trị: …" });
    const cac = tatCa(w.nut("hoi-thoai"));
    expect(cac.some((p) => p.textContent === "Nội dung đọc từ <b>x</b> chứa câu dạng mệnh lệnh")).toBe(true);
    expect(cac.some((p) => p.textContent === "Cảnh báo")).toBe(true);
    expect(cac.some((p) => p.textContent === "Đã hạ tự trị")).toBe(true);
    expect(cac.some((p) => p.tag === "b")).toBe(false);
  });
});

describe("webview agent — 👍/👎 câu trả lời cuối (Đợt 5.1 VSCode)", () => {
  const LUOT = "0f0e0d0c-0b0a-4908-8706-050403020100";
  const nutPh = (w: ReturnType<typeof chay>) =>
    tatCa(w.nut("hoi-thoai")).filter((p) => p.tag === "button" && (p.textContent === "👍" || p.textContent === "👎"));

  it("★★★ nút CHỈ hiện khi lượt xong VÀ host báo có câu trả lời để chấm; xong không kèm phanHoi ⇒ không nút", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "Đã sửa." }] }] });
    expect(nutPh(w)).toHaveLength(0);
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false });
    expect(nutPh(w)).toHaveLength(0);
    w.nut("o-nhap").value = "y";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "Xong." }] }] });
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false, phanHoi: { luotId: LUOT, chiSoKhoi: 1 } });
    expect(nutPh(w).map((n) => n.textContent)).toEqual(["👍", "👎"]);
  });

  it("★★★ 👍 ⇒ ag_phan_hoi {luotId, chiSoKhoi, danhGia:1}; 👎 ⇒ danhGia −1 rồi lý do tuỳ chọn gửi lại CÙNG khoá", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "Đã sửa." }] }] });
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false, phanHoi: { luotId: LUOT, chiSoKhoi: 0 } });
    const [len, xuong] = nutPh(w);
    const vung = tatCa(w.nut("hoi-thoai")).find((p) => p.className === "ag-phan-hoi")!;
    const oLyDo = tatCa(vung).find((p) => p.tag === "input")!;
    const nutLyDo = tatCa(vung).find((p) => p.tag === "button" && p.textContent === "Gửi lý do")!;
    expect(oLyDo.hidden).toBe(true);
    len!.bam();
    xuong!.bam();
    expect(oLyDo.hidden).toBe(false);
    oLyDo.value = "sai API";
    nutLyDo.bam();
    expect(w.daGui.filter((m) => m.loai === "ag_phan_hoi")).toEqual([
      { loai: "ag_phan_hoi", luotId: LUOT, chiSoKhoi: 0, danhGia: 1 },
      { loai: "ag_phan_hoi", luotId: LUOT, chiSoKhoi: 0, danhGia: -1 },
      { loai: "ag_phan_hoi", luotId: LUOT, chiSoKhoi: 0, danhGia: -1, lyDo: "sai API" },
    ]);
  });

  it("★★ kết quả từ host: ok ⇒ 'Đã ghi phản hồi'; hỏng ⇒ dòng trạng thái nhỏ (KHÔNG thêm lượt Lỗi/hộp thoại)", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "Đã sửa." }] }] });
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false, phanHoi: { luotId: LUOT, chiSoKhoi: 0 } });
    const vung = tatCa(w.nut("hoi-thoai")).find((p) => p.className === "ag-phan-hoi")!;
    const soLuotTruoc = tatCa(w.nut("hoi-thoai")).length;
    w.banTin({ loai: "ag_phan_hoi_kq", luotId: LUOT, ok: false });
    expect(tatCa(vung).some((p) => String(p.textContent).includes("Output"))).toBe(true);
    expect(tatCa(w.nut("hoi-thoai")).length).toBe(soLuotTruoc);
    w.banTin({ loai: "ag_phan_hoi_kq", luotId: LUOT, ok: true });
    expect(tatCa(vung).some((p) => p.textContent === "Đã ghi phản hồi.")).toBe(true);
  });
});
