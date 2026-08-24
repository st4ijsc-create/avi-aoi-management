/**
 * ★★★ 2026-08-24 — LƯỚI CHO **BẢNG TERMINAL (chỉ-đọc) + Ô CHẠY-NHANH** của `/ai-coding-workspace`.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts`; đặt `.test.ts` là
 *   vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng" cũ).
 *
 * Cùng khuôn `boChonPhien.unit.test.ts`: `renderToStaticMarkup` dựng CÂY THẬT để lưới hỏi được
 * "cái gì RA HTML", không phải "mã có chuỗi ấy không"; `t` giả TRA THẬT `vi.json` nên gõ sai khoá
 * ⇒ `‹THIẾU:…›` ⇒ đỏ (một `t` trả về chính khoá làm mọi khẳng định xanh tầm thường).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ điều kiện lọc `canChayLenh === true` (render MỌI mục gợi ý)  ⇒ §5 ĐỎ
 *     (ca §5 truyền một mục `canChayLenh:false`, đòi nút của nó KHÔNG ra HTML);
 *   • đảo/không-đảo thứ tự (mất "mới-nhất-trước")                    ⇒ §2 ĐỎ;
 *   • huy hiệu không đổi theo `ketQua.xanh`                          ⇒ §3 ĐỎ;
 *   • mất nhãn "từ vòng tự động" khi `nguon==="vong_tu_dong"`        ⇒ §4 ĐỎ.
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

/** `t` giả TRA THẬT `vi.json` (khuôn `boChonPhien.unit.test.ts`): gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ. */
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

const { BangTerminal } = await import("./BangTerminal");
type LuotLenh = import("./BangTerminal").LuotLenh;
type GoiYDuAn = import("@/lib/goiYDuAn").GoiYDuAn;
type Props = Parameters<typeof BangTerminal>[0];

// ── Dữ liệu mẫu ──────────────────────────────────────────────────────────────────────────────
/** Lượt XANH, do người bấm Duyệt khởi phát. */
const LUOT_XANH: LuotLenh = {
  lenh: "npm run check",
  dauRa: "Không lỗi tsc.\n",
  exitCode: 0,
  timedOut: false,
  durationMs: 4200,
  ketQua: { xanh: true, soDo: 0, soXanh: 12 },
  luc: "07:05:09",
  nguon: "duyet",
  diaDiemLoi: [],
};
/** Lượt ĐỎ, do VÒNG TỰ ĐỘNG khởi phát — lệnh KHÁC (không phải chuỗi con của lượt xanh). */
const LUOT_DO: LuotLenh = {
  lenh: "dotnet test CalculatorDemo.sln",
  dauRa: "FAIL Divide_ByZero\n2 failed, 10 passed\n",
  exitCode: 1,
  timedOut: false,
  durationMs: 8100,
  ketQua: { xanh: false, soDo: 2, soXanh: 10 },
  luc: "07:06:00",
  nguon: "vong_tu_dong",
  diaDiemLoi: [{ tep: null, dong: null, cot: null, thongDiep: "FAIL Divide_ByZero" }],
};
// Thứ tự LƯU (cũ→mới): xanh trước, đỏ sau ⇒ bảng phải hiện ĐỎ (mới) TRƯỚC XANH (cũ).
const LUOT_MAU: LuotLenh[] = [LUOT_XANH, LUOT_DO];

// Hai mục CHẠY-ĐƯỢC (dùng khoá THẬT sẵn có trong `goiYDuAn`/`vi.json`) + một mục KHÔNG chạy được.
const GOIY_MAU: GoiYDuAn[] = [
  { khoa: "repoWs.suggest.check", macDinh: "Chạy npm run check rồi đọc lỗi", canChayLenh: true },
  { khoa: "repoWs.suggest.reactTest", macDinh: "Chạy node --test test/validate.test.mjs", canChayLenh: true },
  // ⚠ MỤC BẪY ĐỘT BIẾN: KHÔNG chạy được ⇒ nút của nó KHÔNG được ra HTML (xem §5).
  { khoa: "repoWs.suggest.read", macDinh: "Đọc file server/routers.ts và tóm tắt", canChayLenh: false },
];

function veBang(over: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(BangTerminal, {
      luotLenh: LUOT_MAU,
      goiYNhanh: GOIY_MAU,
      dangGui: false,
      onChayNhanh: () => {},
      ...over,
    } as Props),
  );
}

describe("§1 RỖNG — câu `empty`, không danh sách lượt", () => {
  it("★★★ luotLenh=[] ⇒ câu `empty` từ vi.json, KHÔNG có `data-luot` nào", () => {
    const html = veBang({ luotLenh: [] });
    expect(html).toContain("data-terminal-rong");
    expect(html).toContain(esc(VI.repoWs.terminal.empty));
    expect(html).not.toContain("data-luot");
    // …và không có huy hiệu đếm lượt khi chưa có lượt nào.
    expect(html).not.toContain("data-dem-lenh");
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§2 N LƯỢT — N khối, MỚI-NHẤT-TRƯỚC, kèm đếm lượt", () => {
  it("★★★ hai lượt ⇒ hai khối `data-luot`, lượt LƯU-SAU đứng TRƯỚC trong HTML", () => {
    // goiYNhanh:[] để nhãn nút chạy-nhanh không chứa chuỗi "npm run check" gây nhiễu indexOf.
    const html = veBang({ goiYNhanh: [] });
    expect((html.match(/data-luot/g) ?? []).length).toBe(2);
    const iMoi = html.indexOf("dotnet test CalculatorDemo.sln"); // lưu SAU ⇒ mới
    const iCu = html.indexOf("npm run check"); // lưu TRƯỚC ⇒ cũ
    expect(iMoi).toBeGreaterThan(-1);
    expect(iCu).toBeGreaterThan(-1);
    expect(iMoi, "mất 'mới-nhất-trước' — lượt mới phải đứng trên lượt cũ").toBeLessThan(iCu);
  });

  it("★ đếm lượt `count` hiện đúng số (khoá có {{n}})", () => {
    expect(veBang()).toContain("2 lệnh");
  });

  it("★ hiển thị lệnh với tiền tố `$ ` và mốc `luc` trang truyền", () => {
    const html = veBang({ goiYNhanh: [] });
    expect(html).toContain("$ ");
    expect(html).toContain("07:06:00");
    expect(html).toContain("07:05:09");
  });
});

describe("§3 HUY HIỆU xanh/đỏ THEO `ketQua.xanh`", () => {
  it("★★★ mỗi kết cục một huy hiệu: đúng một `xanh`, đúng một `do`", () => {
    const html = veBang({ goiYNhanh: [] });
    expect((html.match(/data-huy-hieu="xanh"/g) ?? []).length).toBe(1);
    expect((html.match(/data-huy-hieu="do"/g) ?? []).length).toBe(1);
    // Số ca (đậu/tổng) hiện khi đủ căn cứ: 12/12 (xanh) và 10/12 (đỏ).
    expect(html).toContain("12/12");
    expect(html).toContain("10/12");
  });

  it("★ `ketQua=null` ⇒ KHÔNG huy hiệu nào (lệnh không đếm được ca — vd grep)", () => {
    const html = veBang({ luotLenh: [{ ...LUOT_XANH, ketQua: null }], goiYNhanh: [] });
    expect(html).not.toContain("data-huy-hieu");
  });
});

describe("§4 NHÃN 'từ vòng tự động' CHỈ khi `nguon==='vong_tu_dong'`", () => {
  it("★★★ đúng MỘT nhãn `fromLoop` (lượt vòng), lượt `duyet` KHÔNG có", () => {
    const html = veBang({ goiYNhanh: [] });
    expect((html.match(/data-tu-vong/g) ?? []).length).toBe(1);
    expect(html).toContain(esc(VI.repoWs.terminal.fromLoop));
  });

  it("★ mọi lượt `duyet` ⇒ KHÔNG nhãn nào", () => {
    const html = veBang({ luotLenh: [LUOT_XANH], goiYNhanh: [] });
    expect(html).not.toContain("data-tu-vong");
  });
});

describe("§5 Ô CHẠY-NHANH — CHỈ mục `canChayLenh` (đột biến bắt buộc)", () => {
  it("★★★ render nút cho mục canChayLenh:true; mục canChayLenh:false KHÔNG ra nút", () => {
    const html = veBang();
    // Hai nút của hai mục chạy-được:
    expect((html.match(/data-nut-chay-nhanh/g) ?? []).length).toBe(2);
    expect(html).toContain('data-khoa="repoWs.suggest.check"');
    expect(html).toContain('data-khoa="repoWs.suggest.reactTest"');
    // ⚠ ĐỘT BIẾN: gỡ lọc `canChayLenh === true` ⇒ mục `read` (canChayLenh:false) mọc nút ⇒ dòng
    //   này ĐỎ. Đây là phép canh danh-sách-trắng sống, không phải quét văn bản.
    expect(html, "mục canChayLenh:false KHÔNG được thành nút chạy-nhanh").not.toContain(
      'data-khoa="repoWs.suggest.read"',
    );
    // Nhãn nút = câu i18n (t(khoa, macDinh)) tra thẳng vi.json.
    expect(html).toContain(esc(VI.repoWs.suggest.reactTest));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★ nhãn + gợi ý luôn hiện (quickRunLabel · quickRunHint)", () => {
    const html = veBang();
    expect(html).toContain(esc(VI.repoWs.terminal.quickRunLabel));
    expect(html).toContain(esc(VI.repoWs.terminal.quickRunHint));
  });
});

describe("§6 KHÔNG mục chạy-được ⇒ câu `quickRunNone`", () => {
  it("★★★ mọi mục canChayLenh:false ⇒ câu 'chưa có lệnh gợi ý', KHÔNG nút nào", () => {
    const html = veBang({
      goiYNhanh: [{ khoa: "repoWs.suggest.read", macDinh: "Đọc file server/routers.ts và tóm tắt", canChayLenh: false }],
    });
    expect(html).toContain("data-chay-nhanh-rong");
    expect(html).toContain(esc(VI.repoWs.terminal.quickRunNone));
    expect(html).not.toContain("data-nut-chay-nhanh");
  });

  it("★ goiYNhanh rỗng ⇒ cũng câu `quickRunNone`", () => {
    expect(veBang({ goiYNhanh: [] })).toContain(esc(VI.repoWs.terminal.quickRunNone));
  });
});

describe("§7 `dangGui` KHOÁ nút chạy-nhanh", () => {
  it("★★★ dangGui:true ⇒ nút mang thuộc tính `disabled`; dangGui:false ⇒ không", () => {
    // ⚠ Button luôn có lớp `disabled:pointer-events-none` — nên canh THUỘC TÍNH `disabled=\"\"`,
    //   không canh chuỗi "disabled" trần (sẽ dính vào tên lớp).
    expect(veBang({ dangGui: true })).toContain('disabled=""');
    expect(veBang({ dangGui: false })).not.toContain('disabled=""');
  });
});

describe("§8 MÃ THOÁT · QUÁ HẠN · THỜI LƯỢNG", () => {
  it("★★★ hiện mã thoát và thời lượng của từng lượt", () => {
    const html = veBang({ goiYNhanh: [] });
    expect(html).toContain("Mã thoát: 0");
    expect(html).toContain("Mã thoát: 1");
    expect(html).toContain("4200 ms");
    expect(html).toContain("8100 ms");
    // Không lượt nào quá hạn ⇒ không nhãn quá hạn.
    expect(html).not.toContain("data-qua-han");
  });

  it("★ lượt QUÁ HẠN (exitCode=null) ⇒ nhãn `timedOut`, KHÔNG dòng mã thoát", () => {
    const html = veBang({
      luotLenh: [{ ...LUOT_XANH, exitCode: null, timedOut: true, durationMs: null, ketQua: null }],
      goiYNhanh: [],
    });
    expect(html).toContain("data-qua-han");
    expect(html).toContain(esc(VI.repoWs.terminal.timedOut));
    expect(html).not.toContain("data-ma-thoat");
    expect(html).not.toContain("data-thoi-luong");
  });
});
