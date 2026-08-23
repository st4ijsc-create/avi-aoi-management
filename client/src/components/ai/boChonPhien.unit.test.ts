/**
 * ★★★ 2026-08-23 — LƯỚI CHO **BỘ CHỌN PHIÊN** (nút đồng hồ + popover, mẫu Claude Code).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts`; đặt `.test.ts` là
 *   vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng" cũ).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO RENDER CÂY THẬT — VÀ VÌ SAO RUỘT POPOVER PHẢI ĐƯỢC RENDER **RIÊNG**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng khuôn `theDuyetDiff.unit.test.ts`: `renderToStaticMarkup` dựng cây thật để lưới hỏi được
 * "cái gì RA HTML", không phải "mã có chuỗi ấy không". Nhưng có một bẫy riêng của popover: Radix
 * `Portal` trả `null` khi SSR (không `document`), và Content chỉ render khi `open` — nghĩa là một
 * lưới render `BoChonPhien` (vỏ, popover đóng) sẽ KHÔNG BAO GIỜ nhìn thấy ô tìm hay danh sách, dù
 * chúng có hay không. Hỏi vỏ về ruột là hỏi câu không thể đỏ. Nên:
 *   • VỎ  (§1): render `BoChonPhien` → hai nút icon có thật trong HTML;
 *   • RUỘT (§2–§7): render THẲNG `NoiDungBoChonPhien` (xuất khẩu đúng cho mục đích này);
 *   • DÂY NỐI (§1): đọc mã nguồn xác nhận `PopoverContent` bọc đúng `NoiDungBoChonPhien` — mảnh
 *     duy nhất buộc phải quét văn bản, vì nó nằm sau cánh cửa Portal mà SSR không mở được.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (các ca (a)(b)(c) của brief):
 *   • bỏ nút đồng hồ (lịch sử)                       ⇒ §1 ĐỎ
 *   • popover không còn ô tìm kiếm                   ⇒ §2 ĐỎ
 *   • hàng phiên mất thời-gian-tương-đối             ⇒ §4 ĐỎ
 *   • phiên đang mở không còn được tô đậm            ⇒ §5 ĐỎ
 *   • hàng phiên mất nút xoá                         ⇒ §6 ĐỎ
 *   • mất trạng thái loading/denied/empty/scopeNote  ⇒ §7 ĐỎ
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/**
 * `t` giả TRA THẬT `vi.json` (khuôn `theDuyetDiff.unit.test.ts`): gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ.
 * Một `t` trả về chính khoá sẽ làm mọi khẳng định dưới đây xanh một cách tầm thường.
 */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

/** React SSR thoát `&<>"` — mọi phép so chuỗi với HTML phải đi qua đây (đỏ vì lý do sai là đỏ bỏ đi). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { BoChonPhien, NoiDungBoChonPhien, locPhienTheoTen, thoiGianTuongDoi } = await import("./BoChonPhien");
const NGUON = readFileSync(join(HERE, "BoChonPhien.tsx"), "utf8").replace(/\r\n/g, "\n");

// ── Dữ liệu mẫu: mốc thời gian tính LÙI từ lúc chạy để thang tương đối cho chữ tất định ──
const GIO = 3_600_000;
const PHIEN_MAU = [
  { id: "p1", title: "Sửa StringUtils", turnCount: 4, updatedAt: new Date(Date.now() - 90_000).toISOString() },        // 1 phút
  { id: "p2", title: "Thêm lưới EOL", turnCount: 12, updatedAt: new Date(Date.now() - 13 * GIO).toISOString() },       // 13 giờ
  { id: "p3", title: "", turnCount: 1, updatedAt: new Date(Date.now() - 49 * GIO).toISOString() },                     // 2 ngày
];

type NoiDungProps = Parameters<typeof NoiDungBoChonPhien>[0];
function veRuot(over: Partial<NoiDungProps> = {}): string {
  return renderToStaticMarkup(
    createElement(NoiDungBoChonPhien, {
      phien: PHIEN_MAU,
      dangChon: "p2",
      dangTai: false,
      biTuChoi: false,
      tuKhoa: "",
      onDoiTuKhoa: () => {},
      onChon: () => {},
      onXoa: () => {},
      ...over,
    } as NoiDungProps),
  );
}

function veVo(): string {
  return renderToStaticMarkup(
    createElement(BoChonPhien, {
      phien: PHIEN_MAU, dangChon: null, dangTai: false, biTuChoi: false,
      onChon: () => {}, onMoi: () => {}, onXoa: () => {},
    }),
  );
}

describe("§1 VỎ — hai nút icon có THẬT, và popover nối đúng ruột", () => {
  it("★★★ nút ĐỒNG HỒ (lịch sử phiên) ra HTML, kèm nhãn truy cập", () => {
    const html = veVo();
    expect(html).toContain("data-nut-lich-su");
    expect(html).toContain(esc(VI.repoWs.sessions.history));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★★★ nút ＋ (phiên mới) ra HTML, kèm nhãn truy cập", () => {
    const html = veVo();
    expect(html).toContain("data-nut-phien-moi");
    expect(html).toContain(esc(VI.repoWs.sessions.new));
  });

  it("★ DÂY NỐI (quét mã — Portal không SSR được): `PopoverContent` bọc đúng `NoiDungBoChonPhien`", () => {
    const moContent = NGUON.indexOf("<PopoverContent");
    const ruot = NGUON.indexOf("<NoiDungBoChonPhien");
    const dongContent = NGUON.indexOf("</PopoverContent>");
    expect(moContent).toBeGreaterThan(-1);
    expect(ruot, "popover không còn chứa ruột — nút đồng hồ mở ra một hộp rỗng").toBeGreaterThan(moContent);
    expect(dongContent).toBeGreaterThan(ruot);
    // …và nút đồng hồ là TRIGGER của chính popover ấy (không phải một nút trơ cạnh popover).
    const trigger = NGUON.indexOf("<PopoverTrigger");
    expect(trigger).toBeGreaterThan(-1);
    expect(NGUON.indexOf("data-nut-lich-su")).toBeGreaterThan(trigger);
    expect(NGUON.indexOf("data-nut-lich-su")).toBeLessThan(moContent);
  });
});

describe("§2 Ô TÌM KIẾM — có thật trong ruột popover", () => {
  it("★★★ input `data-o-tim` với placeholder từ vi.json", () => {
    const html = veRuot();
    expect(html).toContain("data-o-tim");
    expect(html).toContain(esc(VI.repoWs.sessions.search));
  });

  it("★ ô tìm là CONTROLLED — chữ đã gõ hiện lại trong value", () => {
    expect(veRuot({ tuKhoa: "EOL" })).toContain('value="EOL"');
  });
});

describe("§3 LỌC CLIENT-SIDE theo tên", () => {
  it("hàm thuần: rỗng ⇒ nguyên danh sách · khớp chứa, không phân biệt hoa thường", () => {
    expect(locPhienTheoTen(PHIEN_MAU, "")).toHaveLength(3);
    expect(locPhienTheoTen(PHIEN_MAU, "  ")).toHaveLength(3);
    expect(locPhienTheoTen(PHIEN_MAU, "lưới eol").map((p) => p.id)).toEqual(["p2"]);
    expect(locPhienTheoTen(PHIEN_MAU, "không-có-ai")).toHaveLength(0);
  });

  it("★ render với từ khoá: hàng khớp CÒN, hàng không khớp MẤT", () => {
    const html = veRuot({ tuKhoa: "EOL" });
    expect(html).toContain(esc("Thêm lưới EOL"));
    expect(html).not.toContain(esc("Sửa StringUtils"));
  });

  it("★ không hàng nào khớp ⇒ câu `noMatch` (không phải màn trắng câm)", () => {
    const html = veRuot({ tuKhoa: "zzz-không-khớp" });
    expect(html).toContain(esc(VI.repoWs.sessions.noMatch));
    expect(html).not.toContain("data-hang-phien");
  });
});

describe("§4 THỜI GIAN TƯƠNG ĐỐI — thang bốn bậc, chữ qua i18n, căn PHẢI", () => {
  const MOC = new Date("2026-08-23T12:00:00Z");
  const truoc = (ms: number) => new Date(MOC.getTime() - ms).toISOString();

  it("hàm thuần với mốc CỐ ĐỊNH: vừa xong · {{n}} phút · {{n}} giờ · {{n}} ngày", () => {
    expect(thoiGianTuongDoi(truoc(5_000), MOC, tThat)).toBe("vừa xong");
    expect(thoiGianTuongDoi(truoc(90_000), MOC, tThat)).toBe("1 phút");
    expect(thoiGianTuongDoi(truoc(13 * GIO), MOC, tThat)).toBe("13 giờ");
    expect(thoiGianTuongDoi(truoc(49 * GIO), MOC, tThat)).toBe("2 ngày");
  });

  it("★ biên: ISO hỏng ⇒ '—' (không 'Invalid Date') · mốc TƯƠNG LAI ⇒ 'vừa xong' (không số âm)", () => {
    expect(thoiGianTuongDoi("không-phải-ngày", MOC, tThat)).toBe("—");
    expect(thoiGianTuongDoi(new Date(MOC.getTime() + 3 * GIO).toISOString(), MOC, tThat)).toBe("vừa xong");
  });

  it("★★★ mỗi hàng phiên RA HTML với `data-thoi-gian` mang đúng chữ", () => {
    const html = veRuot();
    expect((html.match(/data-thoi-gian/g) ?? []).length).toBe(3);
    expect(html).toContain("1 phút");
    expect(html).toContain("13 giờ");
    expect(html).toContain("2 ngày");
  });

  it("★ căn PHẢI như mẫu: ô thời gian mang `ml-auto` + `shrink-0` (tên dài không nuốt giờ)", () => {
    const html = veRuot();
    const i = html.indexOf("data-thoi-gian");
    const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
    expect(the).toContain("ml-auto");
    expect(the).toContain("shrink-0");
  });
});

describe("§5 PHIÊN ĐANG MỞ được tô đậm — và CHỈ nó", () => {
  it("★★★ đúng MỘT hàng mang `aria-current` + `font-semibold`", () => {
    const html = veRuot({ dangChon: "p2" });
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    // Nhãn của hàng đang chọn nằm trong một span `font-semibold`; hai hàng kia thì không.
    const iDangChon = html.indexOf('aria-current="true"');
    const doan = html.slice(iDangChon, html.indexOf("data-thoi-gian", iDangChon));
    expect(doan).toContain("font-semibold");
  });

  it("★ không chọn gì ⇒ không hàng nào tự nhận là đang mở", () => {
    expect(veRuot({ dangChon: null })).not.toContain('aria-current="true"');
  });
});

describe("§6 NÚT XOÁ trên từng hàng", () => {
  it("★★★ mỗi hàng một `data-nut-xoa`, kèm nhãn truy cập `delete`", () => {
    const html = veRuot();
    expect((html.match(/data-nut-xoa/g) ?? []).length).toBe(3);
    expect(html).toContain(esc(VI.repoWs.sessions.delete));
  });
  // ⚠ HỎI-XÁC-NHẬN không nằm ở đây mà ở `xoaPhienNay` của trang — MỘT đường xoá, một chỗ hỏi.
  //   `aiCodingWorkspacePhien.unit.test.ts` §6 canh cả sự có mặt lẫn thứ tự hỏi-trước-xoá.
});

describe("§7 TRẠNG THÁI + CÂU QUYỀN RIÊNG TƯ — chuyển vào popover, không rơi mất", () => {
  it("đang tải ⇒ câu `loading`", () => {
    expect(veRuot({ dangTai: true, phien: [] })).toContain(esc(VI.repoWs.sessions.loading));
  });

  it("server từ chối ⇒ câu `denied` (hàng rào THẬT, không phải danh sách rỗng)", () => {
    const html = veRuot({ biTuChoi: true });
    expect(html).toContain(esc(VI.repoWs.sessions.denied));
    expect(html).not.toContain("data-hang-phien");
  });

  it("chưa có phiên ⇒ câu `empty` (đúng mẫu 'Sessions you start will show up here')", () => {
    expect(veRuot({ phien: [] })).toContain(esc(VI.repoWs.sessions.empty));
  });

  it("★ câu quyền riêng tư (`scopeNote`) LUÔN ở đáy popover — kể cả khi danh sách rỗng", () => {
    for (const html of [veRuot(), veRuot({ phien: [] }), veRuot({ biTuChoi: true })]) {
      expect(html).toContain(esc(VI.repoWs.sessions.scopeNote));
    }
  });

  it("★ phiên không tên ⇒ nhãn `untitled`, không phải một hàng trắng", () => {
    expect(veRuot()).toContain(esc(VI.repoWs.sessions.untitled));
  });
});
