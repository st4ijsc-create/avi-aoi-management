/**
 * ★★★ ĐỢT 3 (2026-08-23) — LƯỚI cho **DUYỆT THEO KHỐI THẬT** ở thẻ duyệt + hợp đồng dây của trang.
 *
 * ⚠ Đuôi `.unit.test.ts` là bắt buộc (glob của vitest.config gom client bằng đuôi này; đặt
 *   `.test.ts` thì vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI NỬA, HAI CÁCH ĐO — và vì sao mỗi nửa cần đúng cách của nó
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §1–§2 đo CÂY THẬT (`renderToStaticMarkup`, khuôn `theDuyetDiff.unit.test.ts`): mặc định TẤT CẢ
 * khối được chọn, con số {{chon}}/{{tong}} đứng NGAY TRÊN NÚT — câu người bấm đọc được trước khi
 * ngón tay hạ xuống.
 * §3–§4 là CENSUS trên mã nguồn — vì thứ chúng canh là **hình dạng của đường đi trên dây**: trang
 * chỉ được gửi SỐ THỨ TỰ khối, không bao giờ gửi byte nội dung (đột biến (d) của brief: *"client
 * gửi byte thay vì id ⇒ ĐỎ"*). Một lưới render không đo được cái GỬI đi; census đọc đúng lời gọi
 * mutation thì đo được, và không xanh nổi nhờ một mock.
 * ⚠ Cái giá của census (quét văn bản ⇒ mù đường thoát) đã trả bằng lưới server
 *   `aiCopilotActions.chonKhoi.test.ts` — nơi byte trên đĩa được đọc lại thật; hai lưới bọc nhau.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/** `t` giả TRA THẬT `vi.json` — gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ ca ĐỎ (không phải lưới giả). */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { TheDuyetDiff } = await import("./TheDuyetDiff");

/** Ba khối thay đổi tách rời ⇒ kế hoạch chuẩn cho đúng 3 khối. */
const GOC = "a1\ngiu\nb1\ngiu\nc1\n";
const SUA = "a2\ngiu\nb2\ngiu\nc2\n";

function ve(over: Partial<Parameters<typeof TheDuyetDiff>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TheDuyetDiff, {
      action: { expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(), preview: { warnings: ["Tệp SẠCH — sẽ GHI ĐÈ."] } },
      args: { path: "src/ba_khoi.ts", original: GOC, modified: SUA },
      state: "pending",
      busy: false,
      preview: GOC,
      onPreview: () => {},
      onConfirm: () => {},
      onCancel: () => {},
      ...over,
    } as Parameters<typeof TheDuyetDiff>[0]),
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — MẶC ĐỊNH: mọi khối được chọn, con số đứng NGAY TRÊN NÚT", () => {
  it("★★★ nút Duyệt mang nhãn '(3/3 khối)' và KHÔNG bị khoá — ca thường gặp vẫn MỘT cú bấm", () => {
    const html = ve();
    const nhan = tThat("repoWs.diff.confirmChon", { chon: 3, tong: 3 });
    expect(nhan).not.toContain("‹THIẾU:");
    expect(html).toContain(esc(nhan));
    // Nút Duyệt (nút đầu trong hàng nút) không disabled khi đủ khối + không busy.
    // ⚠ So THUỘC TÍNH `disabled=""` (dạng SSR của React), không so chuỗi trần "disabled" —
    //   class Tailwind của nút chứa `disabled:opacity-50` và đã làm lượt đầu của ca này đỏ SAI.
    const nutDau = (iHtml: string) => /<button[^>]*>/.exec(iHtml.slice(iHtml.indexOf("data-hang-nut")))?.[0] ?? "";
    expect(nutDau(html)).not.toContain('disabled=""');
    // Đối chứng chống tự thoả: busy ⇒ đúng thuộc tính ấy XUẤT HIỆN — thước đo đọc được cả hai chiều.
    expect(nutDau(ve({ busy: true } as never))).toContain('disabled=""');
    // Và không có băng "chưa chọn khối nào".
    expect(html).not.toContain("data-khong-chon-khoi");
  });

  it("★★★ câu dưới thẻ nói đúng nghĩa MỚI: ghi {{chon}}/{{tong}} khối ĐANG CHỌN — không còn 'ghi TOÀN BỘ, chọn chỉ để xem trước'", () => {
    const html = ve();
    expect(html).toContain(esc(tThat("repoWs.diff.writesSelected", { chon: 3, tong: 3 })));
    // Câu cũ ("không đổi thứ được ghi") là lời khai của kiến trúc cũ — còn nó là còn nói dối.
    expect(html).not.toContain(esc("không đổi thứ được ghi"));
  });

  it("★ khối HunkDiffView mặc định ở trạng thái ĐÃ NHẬN cả 3 (nhãn 'Đã nhận 3' có thật trong cây)", () => {
    const html = ve();
    expect(html).toContain(esc(tThat("diff.hunk.appliedN", { n: 3 })));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — khuôn ĐỢT 1 không bị phá: cảnh báo trước nút, hàng nút vẫn lưới hai cột", () => {
  it("★★ `data-canh-bao` < `data-hang-nut`, và hàng nút vẫn grid-cols-2 (không flex-1)", () => {
    const html = ve();
    expect(html.indexOf("data-canh-bao")).toBeGreaterThan(-1);
    expect(html.indexOf("data-canh-bao")).toBeLessThan(html.indexOf("data-hang-nut"));
    const i = html.indexOf("data-hang-nut");
    const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
    expect(the).toContain("grid-cols-2");
    expect(the).not.toContain("flex-1");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
const NGUON_TRANG = readFileSync(join(CLIENT_SRC, "pages", "AICodingWorkspace.tsx"), "utf8").replace(/\r\n/g, "\n");
const NGUON_THE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TheDuyetDiff.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("§3 — CENSUS DÂY: trang gửi CHỈ SỐ khối, không bao giờ gửi byte nội dung", () => {
  /**
   * Bóc đúng đối tượng tham số của LỜI GỌI THẬT (neo `await …` — chuỗi trần `confirmM.mutateAsync(`
   * còn xuất hiện trong docblock của trang, và lượt đầu của chính census này đã bóc nhầm docblock).
   */
  function doiSoMutation(): string {
    const i = NGUON_TRANG.indexOf("await confirmM.mutateAsync(");
    expect(i, "phải tìm thấy lời gọi mutation thật").toBeGreaterThan(-1);
    const cuoi = NGUON_TRANG.indexOf(");", i);
    expect(cuoi).toBeGreaterThan(i);
    return NGUON_TRANG.slice(i, cuoi);
  }

  it("★★★ lời gọi mutation mang `selectedHunkIds`, và KHÔNG mang `modified`/`original`/`content`", () => {
    const goi = doiSoMutation();
    expect(goi).toContain("selectedHunkIds");
    for (const cam of ["modified", "original", "content"]) {
      expect(goi, `lời gọi confirm không được chở byte nội dung (\`${cam}\`)`).not.toContain(cam);
    }
  });

  it("★★★ `handleConfirm` chỉ nhận MẢNG (Array.isArray) — một MouseEvent lọt vào không thành lựa chọn", () => {
    const i = NGUON_TRANG.indexOf("const handleConfirm");
    const j = NGUON_TRANG.indexOf("const handleCancel");
    const than = NGUON_TRANG.slice(i, j);
    expect(than).toContain("Array.isArray(chonKhoi)");
  });

  it("★★ thẻ duyệt gửi lên trang qua `chiSoGuiLenServer` (null = đủ khối ⇒ không gửi trường nào)", () => {
    expect(NGUON_THE).toContain("chiSoGuiLenServer(keHoach, chon)");
    expect(NGUON_THE).toContain("onConfirm(chiSoGui ?? undefined)");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — 0 khối: nút tự khoá + câu nói thẳng (phép LỊCH SỰ client; hàng rào thật ở server)", () => {
  /**
   * ⚠ Vì sao đo bằng census chứ không render: trạng thái 0-khối chỉ tới được qua tương tác (bấm
   * "Hoàn tác hết"), mà repo này không có jsdom (0 gói mới — doc 83) và `renderToStaticMarkup`
   * không bấm được nút. Hàng rào THẬT của 0-khối (`NO_HUNKS_SELECTED`, đĩa không đổi) đã có ca
   * live server §4 của `aiCopilotActions.chonKhoi.test.ts`; ở đây chỉ canh phép lịch sự không bị
   * ai dọn mất.
   */
  it("★★ nút Duyệt khoá theo `khongChonKhoi`, và băng `data-khong-chon-khoi` có trong mã", () => {
    expect(NGUON_THE).toContain("disabled={busy || ttl.expired || khongChonKhoi}");
    expect(NGUON_THE).toContain("data-khong-chon-khoi");
    expect(NGUON_THE).toContain('t("repoWs.diff.zeroChon"');
  });
});
