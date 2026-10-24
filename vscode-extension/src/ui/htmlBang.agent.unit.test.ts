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
    const bac2 = nutCua(the[1]).find((p) => p.textContent === "Bác")!;
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

/**
 * ★★★ 2026-10-24 — LỖI 1: markdown dựng TĂNG DẦN (không còn khối chữ đặc / ### ** ``` hiện nguyên), trên cả đường Agent lẫn đường Chat/SERVER; cuộn thông minh; thứ bậc tiêu đề.
 */
describe("webview — markdown tăng dần (ag_md_dang / md_dang) + cây cuối trong hoan_tat", () => {
  const cayA = [{ t: "h", cap: 2, con: [{ t: "text", chu: "Tiêu đề" }] }, { t: "p", con: [{ t: "strong", con: [{ t: "text", chu: "đậm" }] }] }, { t: "code", ngonNgu: "bash", ma: "npm i" }];
  const khungAi = (w: ReturnType<typeof chay>) => {
    const bb = w.nut("hoi-thoai").con;
    return bb[bb.length - 1]!.con[1]!; // [nhãn, nội dung] của bong bóng AI cuối
  };

  it("★★★ ĐƯỜNG AGENT: ag_md_dang thay nội dung bằng CÂY (thẻ h4/strong/pre) — KHÔNG còn chữ thô '###'/'**'; khối mã đang stream KHÔNG có nút hành động", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md_dang", cay: cayA });
    const cac = tatCa(w.nut("hoi-thoai"));
    const tag = cac.map((p) => p.tag);
    expect(tag).toContain("h4"); // cap 2 ⇒ h4
    expect(tag).toContain("strong");
    expect(tag).toContain("pre");
    expect(cac.map((p) => p.textContent).join("|")).not.toMatch(/[#*]{2}/);
    expect(cac.filter((p) => p.tag === "button")).toEqual([]); // dangStream ⇒ chưa có Chép/Chèn/Áp dụng
    // bản KẾ TIẾP thay THẾ (không cộng dồn): chỉ còn đúng một đoạn
    w.banTin({ loai: "ag_md_dang", cay: [{ t: "p", con: [{ t: "text", chu: "bản mới" }] }] });
    const doan = tatCa(w.nut("hoi-thoai")).filter((p) => p.className.includes("ag-doan"));
    expect(doan).toHaveLength(1);
    expect(tatCa(doan[0]!).map((p) => p.textContent).join("|")).toContain("bản mới");
    expect(tatCa(doan[0]!).map((p) => p.textContent).join("|")).not.toContain("Tiêu đề");
    // bản CUỐI (ag_md) có nút hành động
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: cayA });
    expect(tatCa(w.nut("hoi-thoai")).filter((p) => p.tag === "button" && p.className === "nut-khoi-ma").length).toBe(3);
  });

  it("★★★ ĐƯỜNG CHAT/SERVER: token thô CHỈ tới md_dang đầu; sau đó cây là nguồn duy nhất; hoan_tat mang cây CUỐI (có nút khối mã)", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "token", chu: "### Cách chạy" });
    expect(khungAi(w).textContent).toBe("### Cách chạy"); // trước md_dang: chữ thô (≤ một nhịp tiết lưu)
    w.banTin({ loai: "md_dang", cay: cayA });
    expect(khungAi(w).textContent).toBe(""); // thay bằng cây
    expect(tatCa(khungAi(w)).map((p) => p.tag)).toContain("h4");
    w.banTin({ loai: "token", chu: " thêm chữ thô" }); // sau md_dang: token KHÔNG cộng chữ thô vào khối
    expect(tatCa(khungAi(w)).map((p) => p.textContent).join("|")).not.toContain("thêm chữ thô");
    expect(khungAi(w).textContent).toBe(""); // khối KHÔNG nhận chữ thô nào sau md_dang
    expect(tatCa(khungAi(w)).filter((p) => p.tag === "button")).toEqual([]);
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null, cay: cayA, chiSoMaDau: 7 });
    const nut = tatCa(khungAi(w)).filter((p) => p.tag === "button" && p.className === "nut-khoi-ma");
    expect(nut).toHaveLength(3);
    nut[0]!.bam();
    expect(w.daGui.find((m) => m.loai === "ag_khoi_ma")).toEqual({ loai: "ag_khoi_ma", chiSo: 7, hanhDong: "chep" });
  });

  it("★ hoan_tat KHÔNG có cây (host cũ) ⇒ hành vi cũ: textContent = vanBanCuoi", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "token", chu: "thô" });
    w.banTin({ loai: "hoan_tat", vanBanCuoi: "bản đã lọc", canhBao: null });
    expect(khungAi(w).textContent).toBe("bản đã lọc");
  });

  it("★ lịch sử khôi phục: lượt AI có `cay` ⇒ dựng markdown; lượt người dùng giữ chữ", () => {
    const w = chay();
    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "câu hỏi" }, { vaiTro: "assistant", noiDung: "## T", cay: [{ t: "h", cap: 2, con: [{ t: "text", chu: "T" }] }] }], soLuot: 1, soKyTu: 5 });
    const bb = w.nut("hoi-thoai").con.filter((p) => p.className.includes("luot"));
    expect(bb[0]!.con[1]!.textContent).toBe("câu hỏi");
    expect(tatCa(bb[1]!).map((p) => p.tag)).toContain("h4");
  });

  it("★ bảng nằm trong khung cuộn riêng (.bang-cuon) — không đẩy rộng cả khung chat", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "table", dau: [[{ t: "text", chu: "A" }]], hang: [[[{ t: "text", chu: "1" }]]] }] });
    const cuon = tatCa(w.nut("hoi-thoai")).find((p) => p.className === "bang-cuon");
    expect(cuon).toBeTruthy();
    expect(cuon!.con[0]!.tag).toBe("table");
  });
});

describe("webview — CSS thứ bậc tiêu đề + nhãn vai (2026-10-24)", () => {
  const html = dungHtmlBang({ nonce: "N" });
  const coChu = (nhan: string) => {
    const i = html.indexOf(nhan);
    expect(i, nhan).toBeGreaterThan(-1);
    return parseFloat(html.slice(i + nhan.length));
  };
  it("★★★ h3 > h4 > h5 > h6 ≥ chữ thường 13 px (trước đây ### = 10,8 px NHỎ HƠN chữ thường)", () => {
    const h3 = coChu(".ag-md h3 { font-size: ");
    const h4 = coChu(".ag-md h4 { font-size: ");
    const h5 = coChu(".ag-md h5 { font-size: ");
    const h6 = coChu(".ag-md h6 { font-size: ");
    expect(h3).toBeGreaterThan(h4);
    expect(h4).toBeGreaterThan(h5);
    expect(h5).toBeGreaterThan(h6);
    expect(h6).toBeGreaterThanOrEqual(13);
  });
  it("★ trích dẫn có viền trái + nền; nhãn vai trong lượt: ≥ 12 px, KHÔNG in hoa, KHÔNG mờ", () => {
    expect(html).toMatch(/\.ag-md blockquote \{[^}]*border-left: 3px solid[^}]*background:/);
    const i = html.indexOf(".luot > .nhan {");
    const khoi = html.slice(i, html.indexOf("}", i));
    expect(khoi).toContain("font-size: 12px");
    expect(khoi).toContain("text-transform: none");
    expect(khoi).toContain("opacity: 1");
  });
});

describe("webview — cuộn thông minh (chỉ tự cuộn khi đang ở đáy)", () => {
  type Co = { scrollTop: number; scrollHeight: number; clientHeight?: number };
  it("★★★ ĐANG Ở ĐÁY ⇒ tin ag_* mới kéo xuống đáy; ĐANG CUỘN LÊN ĐỌC ⇒ KHÔNG đổi scrollTop và hiện '↓ Tin mới'; bấm pill ⇒ xuống đáy và ẩn", () => {
    const w = chay();
    const ht = w.nut("hoi-thoai") as unknown as Co;
    ht.scrollHeight = 2000;
    ht.clientHeight = 500;
    ht.scrollTop = 1500; // đúng đáy
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "a" }] }] });
    expect(ht.scrollTop).toBe(2000);
    expect(w.nut("pill-moi").hidden).toBe(true);
    // người dùng cuộn lên đọc
    ht.scrollTop = 300;
    w.banTin({ loai: "ag_md", chiSoMaDau: 0, cay: [{ t: "p", con: [{ t: "text", chu: "b" }] }] });
    expect(ht.scrollTop).toBe(300); // KHÔNG giật về đáy
    expect(w.nut("pill-moi").hidden).toBe(false);
    w.nut("pill-moi").bam();
    expect(ht.scrollTop).toBe(ht.scrollHeight);
    expect(w.nut("pill-moi").hidden).toBe(true);
  });
});

describe("thẻ duyệt Agent — thiết kế lại (2026-10-24)", () => {
  const nut = (t: PT, chu: string) => tatCa(t).find((p) => p.tag === "button" && p.textContent === chu);
  function mo() {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    return w;
  }
  const theCuoi = (w: ReturnType<typeof chay>) => tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "ag-the").at(-1)!;
  const HET = "Duyệt, tự duyệt các lần sửa tiếp trong lượt này";

  it("★★★ XOÁ: nút riêng 'Xác nhận xoá…' + cảnh báo; lần bấm đầu KHÔNG gửi gì, lần hai mới gửi ag_duyet; không có nút duyệt-hết-lượt", () => {
    const w = mo();
    w.banTin({ loai: "ag_the_duyet", id: "x1", loaiDuyet: "ghi", thaoTac: "xoa", tomTat: "Xoá src/cu.ts", duong: "src/cu.ts", coDiff: true, coTheDuyetHet: false });
    const the = theCuoi(w);
    expect(tatCa(the).some((p) => String(p.textContent).includes("sẽ bị xoá khỏi workspace"))).toBe(true);
    expect(nut(the, "Duyệt")).toBeUndefined();
    const nutXoa = nut(the, "Xác nhận xoá…")!;
    expect(nutXoa.className).toBe("nut-nguy");
    nutXoa.bam();
    expect(w.daGui.filter((m) => m.loai === "ag_duyet")).toHaveLength(0);
    expect(nutXoa.textContent).toBe("Xoá tệp này");
    nutXoa.bam();
    nutXoa.bam();
    expect(w.daGui.filter((m) => m.loai === "ag_duyet")).toEqual([{ loai: "ag_duyet", id: "x1" }]);
    expect(nut(the, HET)!.hidden).toBe(true);
  });

  it("★★★ ghi thường: nút duyệt-hết-lượt CHỈ hiện khi host cho phép; bấm ⇒ ag_duyet_het (một lần) và khoá cả thẻ", () => {
    const w = mo();
    w.banTin({ loai: "ag_the_duyet", id: "g1", loaiDuyet: "ghi", thaoTac: "thay", tomTat: "Sửa a.ts", duong: "a.ts", coDiff: true, coTheDuyetHet: true });
    w.banTin({ loai: "ag_the_duyet", id: "g2", loaiDuyet: "ghi", thaoTac: "thay", tomTat: "Sửa b.ts", duong: "b.ts", coDiff: true, coTheDuyetHet: false });
    const [t1, t2] = tatCa(w.nut("hoi-thoai")).filter((p) => p.className === "ag-the");
    expect(nut(t1, HET)!.hidden).toBe(false);
    expect(nut(t2, HET)!.hidden).toBe(true);
    nut(t1, HET)!.bam();
    nut(t1, HET)!.bam();
    nut(t1, "Duyệt")!.bam();
    expect(w.daGui.filter((m) => String(m.loai).startsWith("ag_duyet"))).toEqual([{ loai: "ag_duyet_het", id: "g1" }]);
  });

  it("★★ Bác nhẹ hơn Duyệt (lớp nut-nhe vs nut-chinh); ô lý do ẨN tới khi bấm 'Thêm lý do'", () => {
    const w = mo();
    w.banTin({ loai: "ag_the_duyet", id: "b1", loaiDuyet: "ghi", thaoTac: "tao", tomTat: "Tạo c.ts", duong: "c.ts", coDiff: true });
    const the = theCuoi(w);
    expect(nut(the, "Duyệt")!.className).toBe("nut-chinh");
    expect(nut(the, "Bác")!.className).toBe("nut-nhe");
    const o = tatCa(the).find((p) => p.tag === "input")!;
    expect(o.hidden).toBe(true);
    nut(the, "Thêm lý do")!.bam();
    expect(o.hidden).toBe(false);
  });

  it("★★ thẻ CHẠY LỆNH giữ nghĩa cũ: 'Chạy' + 'Bác', không có nút duyệt-hết-lượt", () => {
    const w = mo();
    w.banTin({ loai: "ag_the_duyet", id: "l1", loaiDuyet: "lenh", tomTat: "npm test", lenh: "npm test", coDiff: false, coTheDuyetHet: false });
    const the = theCuoi(w);
    expect(nut(the, "Chạy")).toBeDefined();
    expect(nut(the, HET)!.hidden).toBe(true);
    nut(the, "Chạy")!.bam();
    expect(w.daGui.filter((m) => m.loai === "ag_duyet")).toEqual([{ loai: "ag_duyet", id: "l1" }]);
  });

  it("★★ ag_tu_duyet ⇒ một dòng 'Đã tự duyệt' nêu tệp (người dùng thấy cái gì đã đi qua)", () => {
    const w = mo();
    w.banTin({ loai: "ag_tu_duyet", id: "q", tomTat: "Sửa src/z.ts", duong: "src/z.ts" });
    expect(tatCa(w.nut("hoi-thoai")).some((p) => String(p.textContent).includes("Đã tự duyệt") && String(p.textContent).includes("src/z.ts"))).toBe(true);
  });
});

describe("webview — lỗi có Thử lại · Esc = Dừng · Chép/Tạo lại câu trả lời (2026-10-24)", () => {
  const nutTheoChu = (p: PT, chu: string) => tatCa(p).filter((x) => x.tag === "button" && x.textContent === chu);
  const soHoi = (w: ReturnType<typeof chay>) => w.daGui.filter((m) => m.loai === "hoi");
  function hoi(w: ReturnType<typeof chay>, cau = "câu hỏi") {
    w.nut("o-nhap").value = cau;
    w.nut("nut-gui").bam();
  }

  it("★★★ thẻ lỗi có 'Thử lại': gửi LẠI đúng câu hỏi; mỗi thẻ chỉ một lần; khi đang chạy lượt khác thì KHÔNG gửi chồng", () => {
    const w = chay();
    hoi(w, "đọc giúp log");
    w.banTin({ loai: "loi", thongDiep: "Mất kết nối", moSettings: true });
    w.banTin({ loai: "loi", thongDiep: "Lỗi nữa", moSettings: false });
    const [a] = nutTheoChu(w.nut("hoi-thoai") as PT, "Thử lại");
    const nutThuLai = nutTheoChu(w.nut("hoi-thoai") as PT, "Thử lại");
    expect(nutThuLai).toHaveLength(2);
    expect(soHoi(w)).toHaveLength(1);
    a!.bam();
    expect(soHoi(w)).toHaveLength(2);
    expect(soHoi(w)[1]).toMatchObject({ cauHoi: "đọc giúp log" });
    a!.bam(); // cùng thẻ: đã khoá
    nutThuLai[1]!.bam(); // thẻ khác nhưng lượt đang chạy ⇒ không gửi chồng
    expect(soHoi(w)).toHaveLength(2);
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false }); // lượt thử lại XONG, nút Dừng ẩn
    a!.bam(); // bấm lại ĐÚNG thẻ đã dùng ⇒ vẫn khoá (mỗi thẻ một lần)
    expect(soHoi(w)).toHaveLength(2);
  });

  it("★★ lỗi mất kết nối có gợi ý + nút Mở Settings; ag_loi DANG_CHAY/KHONG_WORKSPACE KHÔNG có Thử lại, lỗi khác thì có", () => {
    const w = chay();
    hoi(w);
    w.banTin({ loai: "loi", thongDiep: "Mất kết nối", moSettings: true });
    const hoiThoai = w.nut("hoi-thoai") as PT;
    expect(tatCa(hoiThoai).some((x) => x.className === "loi-goi-y")).toBe(true);
    expect(tatCa(hoiThoai).some((x) => x.className === "nut-mo-settings" && String(x.textContent).startsWith("Mở Settings"))).toBe(true);
    const truoc = nutTheoChu(hoiThoai, "Thử lại").length;
    w.banTin({ loai: "ag_loi", thongDiep: "Một lượt đang chạy", ma: "DANG_CHAY" });
    w.banTin({ loai: "ag_loi", thongDiep: "Chưa mở thư mục", ma: "KHONG_WORKSPACE" });
    expect(nutTheoChu(hoiThoai, "Thử lại")).toHaveLength(truoc);
    w.banTin({ loai: "ag_loi", thongDiep: "Lượt hỏng", ma: "LOI" });
    expect(nutTheoChu(hoiThoai, "Thử lại")).toHaveLength(truoc + 1);
  });

  it("★★ thẻ lỗi nổi bật bằng thuộc tính data-loi (giữ nguyên lớp luot-he-thong); thông báo thường thì không", () => {
    const w = chay();
    hoi(w);
    w.banTin({ loai: "loi", thongDiep: "x" });
    const luot = (w.nut("hoi-thoai") as PT).con.filter((c) => c.className.includes("luot-he-thong"));
    expect(luot.some((c) => c.getAttribute("data-loi") === "1")).toBe(true);
    w.banTin({ loai: "thong_bao", thongDiep: "y" });
    expect((w.nut("hoi-thoai") as PT).con.filter((c) => c.getAttribute("data-loi") === "1")).toHaveLength(1);
  });

  it("★★★ ba chấm chờ AI được gỡ bằng removeChild (DOM thật không có trường con — bản cũ chỉ splice trường của DOM giả nên ba chấm kẹt vĩnh viễn ở trình duyệt thật)", () => {
    const w = chay();
    PT.daGo.length = 0;
    hoi(w);
    w.banTin({ loai: "ag_md", cay: [{ t: "p", c: [{ t: "text", v: "Xong." }] }], chiSoMaDau: 0 });
    expect(PT.daGo.some((x) => x.className === "cho-ai")).toBe(true);
    expect(tatCa(w.nut("hoi-thoai") as PT).some((x) => x.className === "cho-ai")).toBe(false);
  });

  it("★★★ xong thành công ⇒ hàng 'Chép câu trả lời · Tạo lại' (một hàng duy nhất); Chép ⇒ chep_tra_loi; Tạo lại ⇒ hỏi lại đúng câu; bị dừng ⇒ KHÔNG có hàng", () => {
    const w = chay();
    hoi(w, "tóm tắt");
    w.banTin({ loai: "ag_md", cay: [{ t: "p", c: [{ t: "text", v: "Xong." }] }], chiSoMaDau: 0 });
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false });
    const hoiThoai = w.nut("hoi-thoai") as PT;
    expect(nutTheoChu(hoiThoai, "Chép câu trả lời")).toHaveLength(1);
    nutTheoChu(hoiThoai, "Chép câu trả lời")[0]!.bam();
    expect(w.daGui.filter((m) => m.loai === "chep_tra_loi")).toHaveLength(1);
    nutTheoChu(hoiThoai, "Tạo lại")[0]!.bam();
    expect(soHoi(w)).toHaveLength(2);
    expect(soHoi(w)[1]).toMatchObject({ cauHoi: "tóm tắt" });
    // lượt mới đang chạy ⇒ hàng cũ đã gỡ
    expect(nutTheoChu(hoiThoai, "Chép câu trả lời")).toHaveLength(0);
    w.banTin({ loai: "ag_xong", lyDo: "huy", coHoanTac: false });
    expect(nutTheoChu(hoiThoai, "Chép câu trả lời")).toHaveLength(0);
  });

  it("★★ 'Tạo lại' không gửi khi một lượt đang chạy", () => {
    const w = chay();
    hoi(w, "a");
    w.banTin({ loai: "ag_xong", lyDo: "hoan-thanh", coHoanTac: false });
    const nutLai = nutTheoChu(w.nut("hoi-thoai") as PT, "Tạo lại")[0]!;
    w.nut("nut-dung").hidden = false; // giả lập lượt khác đang chạy
    nutLai.bam();
    expect(soHoi(w)).toHaveLength(1);
  });

  it("★★★ Esc = DỪNG lượt đang chạy; rảnh thì không gửi gì", () => {
    const w = chay();
    // DOM giả mặc định hidden=false; markup thật: menu/gợi ý/nút Dừng đều mang hidden lúc rảnh
    w.nut("menu-dinh-kem").hidden = true;
    w.nut("mention-ds").hidden = true;
    w.nut("nut-dung").hidden = true;
    w.banDoc("keydown", { key: "Escape" });
    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(0);
    hoi(w);
    w.banDoc("keydown", { key: "Escape" });
    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(1);
  });

  it("★★★ Esc KHÔNG dừng khi: đang soạn IME (isComposing/229), menu Đính kèm đang mở (chỉ đóng menu), gợi ý @ đang mở", () => {
    const w = chay();
    hoi(w);
    w.banDoc("keydown", { key: "Escape", isComposing: true });
    w.banDoc("keydown", { key: "Escape", keyCode: 229 });
    w.nut("menu-dinh-kem").hidden = false;
    w.banDoc("keydown", { key: "Escape" });
    expect(w.nut("menu-dinh-kem").hidden).toBe(true);
    w.nut("mention-ds").hidden = false;
    w.banDoc("keydown", { key: "Escape" });
    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(0);
    w.nut("mention-ds").hidden = true;
    w.banDoc("keydown", { key: "Escape" });
    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(1);
  });
});

describe("khớp mockup 0.3.1: trạng thái rỗng · hộp soạn · đồng hồ ngữ cảnh (2026-10-24)", () => {
  const nutRong = (w: ReturnType<typeof chay>) => tatCa(w.nut("rong-lan-dau") as PT).filter((x) => x.tag === "button");

  it("★★★ trạng thái rỗng = thẻ gợi ý theo nghề PLC/AOI bấm được (không phải ba dòng chữ rời); ảnh TẮT ⇒ 3 thẻ, không có thẻ đọc ảnh", () => {
    const w = chay();
    const nut = nutRong(w);
    expect(nut).toHaveLength(3);
    const chu = nut.map((b) => tatCa(b).map((x) => x.textContent).join("|"));
    expect(chu.some((c) => c.includes("Viết FB điều khiển van 2 vị trí"))).toBe(true);
    expect(chu.some((c) => c.includes("HMI"))).toBe(false);
  });

  it("★★ cau_hinh_anh bat:true ⇒ thêm thẻ 'Đọc ảnh màn hình HMI'; bat:false ⇒ bỏ lại", () => {
    const w = chay();
    w.banTin({ loai: "cau_hinh_anh", bat: true });
    expect(nutRong(w)).toHaveLength(4);
    expect(tatCa(w.nut("rong-lan-dau") as PT).some((x) => x.textContent === "Đọc ảnh màn hình HMI báo lỗi")).toBe(true);
    w.banTin({ loai: "cau_hinh_anh", bat: false });
    expect(nutRong(w)).toHaveLength(3);
  });

  it("★★★ bấm thẻ gợi ý ⇒ ĐIỀN câu hỏi vào ô nhập, KHÔNG tự gửi", () => {
    const w = chay();
    nutRong(w)[1]!.bam();
    expect(String(w.nut("o-nhap").value)).toContain("function block IEC 61131-3");
    expect(w.daGui.filter((m) => m.loai === "hoi")).toHaveLength(0);
  });

  it("★★ dòng 'Đang làm việc trên' theo dự án đang chọn; chưa có dự án ⇒ ẩn", () => {
    const w = chay();
    const dong = () => tatCa(w.nut("rong-lan-dau") as PT).find((x) => x.id === "rong-du-an")!;
    expect(dong().hidden).toBe(true);
    const o = w.nut("o-du-an") as unknown as { options: unknown[]; selectedIndex: number };
    o.options = [{ textContent: "aoi-management" }];
    o.selectedIndex = 0;
    (w.nut("o-du-an") as PT).bam();
    (w.nut("o-du-an") as unknown as { kichHoat?: unknown });
    // sự kiện change
    for (const h of ((w.nut("o-du-an") as unknown as { nghe: Record<string, Array<(e: unknown) => void>> }).nghe.change ?? [])) h({ target: { value: "x" } });
    expect(dong().textContent).toBe("Đang làm việc trên: aoi-management");
    expect(dong().hidden).toBe(false);
  });

  it("★★ nút Đính kèm hiện SỐ tệp: 'Đính kèm' → 'Đính kèm (2)'", () => {
    const w = chay();
    expect(w.nut("dinh-kem-chu").textContent).toBe("");
    w.banTin({ loai: "them_dinh_kem_ngoai", muc: { loai: "tep", ten: "a.log", kieu: "text/plain", kichThuoc: 5, noiDung: "x" } });
    expect(w.nut("dinh-kem-chu").textContent).toBe("Đính kèm (1)");
    w.banTin({ loai: "them_dinh_kem_ngoai", muc: { loai: "tep", ten: "b.log", kieu: "text/plain", kichThuoc: 5, noiDung: "y" } });
    expect(w.nut("dinh-kem-chu").textContent).toBe("Đính kèm (2)");
  });

  it("★★ thanh ngữ cảnh: độ rộng theo % ngữ cảnh, chuyển cảnh báo (lớp cao) từ 75%", () => {
    const w = chay();
    const i = { style: { width: "" } };
    (w.nut("dong-ho-thanh") as unknown as { con: unknown[] }).con = [i];
    w.banTin({ loai: "ag_usage", vao: 8400, ra: 0, ctxPhanTram: 13, uocLuong: false });
    expect(i.style.width).toBe("13%");
    expect(w.nut("dong-ho-thanh").className).toBe("");
    w.banTin({ loai: "ag_usage", vao: 52000, ra: 0, ctxPhanTram: 80, uocLuong: false });
    expect(i.style.width).toBe("80%");
    expect(w.nut("dong-ho-thanh").className).toBe("cao");
  });

  it("★★ tooltip đồng hồ ngữ cảnh mang thống kê (lượt · ký tự · tệp) thay cho thanh thống kê dev đã bỏ", () => {
    const w = chay();
    w.banTin({ loai: "ag_thong_ke", soLuot: 3, soKyTu: 4213 });
    expect(w.nut("dong-ho-token").title).toContain("3 lượt");
    expect(w.nut("dong-ho-token").title).toContain("4213 ký tự");
  });
});

describe("khớp mockup 0.3.1: bố cục tĩnh", () => {
  const html = dungHtmlBang({ nonce: "N" });
  it("★★★ chế độ nằm TRONG hàng dưới ô nhập (Đính kèm · chế độ · Gửi), không còn select riêng phía trên; mặc định tĩnh = Agent · duyệt", () => {
    const hang = html.match(/<div class="soan-thanh">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="mo-ta-nho">/)![1]!;
    expect(hang.indexOf('id="nut-dinh-kem"')).toBeGreaterThan(-1);
    expect(hang.indexOf('id="o-che-do"')).toBeGreaterThan(hang.indexOf('id="nut-dinh-kem"'));
    expect(hang.indexOf('id="nut-gui"')).toBeGreaterThan(hang.indexOf('id="o-che-do"'));
    expect(html.match(/<select id="o-che-do"[\s\S]*?<option value="(\w+)"/)![1]).toBe("sua");
    expect(html).toMatch(/<option value="sua">Agent · duyệt<\/option>/);
  });
  it("★★ nút Đính kèm CÓ CHỮ (không chỉ biểu tượng kẹp giấy)", () => {
    expect(html).toMatch(/<span id="dinh-kem-chu">Đính kèm<\/span>/);
  });
  it("★★ thanh thống kê dev bị ẩn khỏi giao diện (còn trong DOM cho tooltip)", () => {
    expect(html).toMatch(/<div id="thanh-ngu-canh"[^>]*\bhidden>/);
  });
  it("★★ thanh trên: tên + mã build + tài khoản; đăng nhập token / hoàn tác nằm hàng riêng, không chung với chế độ", () => {
    expect(html).toMatch(/<div id="vung-tai-khoan">\s*<span class="ten">AI LOCAL<\/span>/);
    const vungAgent = html.match(/<div id="vung-agent">([\s\S]*?)<\/div>/)![1]!;
    expect(vungAgent).toContain('id="nut-token"');
    expect(vungAgent).not.toContain('id="o-che-do"');
    expect(vungAgent).not.toContain('id="dong-ho-token"');
  });
  it("★★ chip đính kèm nằm TRONG hộp soạn, phía trên ô nhập", () => {
    const hop = html.match(/<div id="hang-nhap">([\s\S]*?)<div class="soan-thanh">/)![1]!;
    expect(hop.indexOf('id="ds-dinh-kem"')).toBeGreaterThan(-1);
    expect(hop.indexOf('id="ds-dinh-kem"')).toBeLessThan(hop.indexOf('id="o-nhap"'));
  });
});

describe("lỗi máy chủ chưa đọc ảnh ⇒ 'Gửi lại không kèm ảnh' (0.3.2)", () => {
  const nutTheoChu = (p: PT, chu: string) => tatCa(p).filter((x) => x.tag === "button" && x.textContent === chu);
  it("★★★ IMAGE_KHONG_HO_TRO: nút gửi lại bỏ ẢNH nhưng GIỮ tệp văn bản; mỗi thẻ một lần; lỗi khác không có nút này", () => {
    const w = chay();
    w.banTin({ loai: "them_dinh_kem_ngoai", muc: { loai: "anh", ten: "a.png", kieu: "image/png", kichThuoc: 4, noiDung: "AAAA" } });
    w.banTin({ loai: "them_dinh_kem_ngoai", muc: { loai: "tep", ten: "l.log", kieu: "text/plain", kichThuoc: 3, noiDung: "ERR" } });
    w.nut("o-nhap").value = "đọc giúp";
    w.nut("nut-gui").bam();
    const hoi = () => w.daGui.filter((m) => m.loai === "hoi");
    expect((hoi()[0] as { dinhKemNgoai: unknown[] }).dinhKemNgoai).toHaveLength(2);
    w.banTin({ loai: "ag_loi", thongDiep: "Máy chủ AI chưa bật đọc ảnh", ma: "IMAGE_KHONG_HO_TRO" });
    w.banTin({ loai: "ag_xong", lyDo: "loi-model", coHoanTac: false });
    const [nut] = nutTheoChu(w.nut("hoi-thoai") as PT, "Gửi lại không kèm ảnh");
    expect(nut).toBeDefined();
    nut!.bam();
    nut!.bam();
    expect(hoi()).toHaveLength(2);
    expect((hoi()[1] as { dinhKemNgoai: Array<{ loai: string }> }).dinhKemNgoai.map((d) => d.loai)).toEqual(["tep"]);
    w.banTin({ loai: "ag_loi", thongDiep: "Lỗi khác", ma: "LOI" });
    expect(nutTheoChu(w.nut("hoi-thoai") as PT, "Gửi lại không kèm ảnh")).toHaveLength(1);
  });

  it("★★ chỉ có ảnh ⇒ gửi lại KHÔNG còn trường dinhKemNgoai", () => {
    const w = chay();
    w.banTin({ loai: "them_dinh_kem_ngoai", muc: { loai: "anh", ten: "a.png", kieu: "image/png", kichThuoc: 4, noiDung: "AAAA" } });
    w.nut("o-nhap").value = "đọc giúp";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "ag_loi", thongDiep: "chưa bật đọc ảnh", ma: "IMAGE_KHONG_HO_TRO" });
    w.banTin({ loai: "ag_xong", lyDo: "loi-model", coHoanTac: false });
    nutTheoChu(w.nut("hoi-thoai") as PT, "Gửi lại không kèm ảnh")[0]!.bam();
    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(2);
    expect("dinhKemNgoai" in (hoi[1] as object)).toBe(false);
  });
});

describe("tin tien_do (0.3.3)", () => {
  it("★★★ tien_do đổi CHỮ chỉ báo chờ của khung AI (không tạo bong bóng mới); token/kết thúc vẫn xoá chỉ báo", () => {
    const w = chay();
    w.nut("o-nhap").value = "x";
    w.nut("nut-gui").bam();
    const hoiThoai = w.nut("hoi-thoai") as PT;
    const soBong = hoiThoai.con.length;
    w.banTin({ loai: "tien_do", chu: "Đang đọc ảnh…" });
    const cho = tatCa(hoiThoai).find((x) => x.className === "cho-ai-chu")!;
    expect(cho.textContent).toBe("Đang đọc ảnh…");
    w.banTin({ loai: "tien_do", chu: "Đang trả lời…" });
    expect(cho.textContent).toBe("Đang trả lời…");
    expect(hoiThoai.con.length).toBe(soBong);
    w.banTin({ loai: "ag_md", cay: [{ t: "p", c: [{ t: "text", v: "Xong." }] }], chiSoMaDau: 0 });
    expect(tatCa(hoiThoai).some((x) => x.className === "cho-ai-chu")).toBe(false);
  });

  it("★ tien_do khi KHÔNG có lượt chờ ⇒ bỏ qua êm (không ném lỗi, không vẽ gì)", () => {
    const w = chay();
    expect(() => w.banTin({ loai: "tien_do", chu: "Đang trả lời…" })).not.toThrow();
    expect((w.nut("hoi-thoai") as PT).con).toHaveLength(0);
  });
});
