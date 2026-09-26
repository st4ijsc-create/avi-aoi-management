/**
 * ★★★ 2026-08-23 — LƯỚI CHO **CỬA DUYỆT**: nút ghi và đường thoát phải cùng thấy, hoặc cùng không.
 *
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng
 *   vẫn khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH — và vì sao lưới QUÉT VĂN BẢN không bắt được nó
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu live 2026-08-23 (Playwright, `/ai-coding-workspace`, 1600×1000) đo tại đúng thẻ duyệt
 * `apply_diff`:
 *     "Duyệt & ghi"  hiện 336,8/336,8 px = **100%**
 *     "Hủy"          hiện  41,2/338,8 px = **12,2%**
 *     đồng hồ hết hạn hiện 0/64,8 px    = **0%**
 *     `preview.warnings` (3 câu server đã dựng): **không render dòng nào**
 * Mọi cổng tĩnh của repo khi ấy XANH. Một lưới hỏi *"mã có chuỗi `warnings` không"* cũng XANH — vì
 * chuỗi ấy CÓ trong `ConfirmActionCard`, chỉ là **thẻ diff không dùng**. Nên lưới này dựng CÂY THẬT
 * bằng `renderToStaticMarkup` và hỏi những câu chỉ cây thật trả lời được:
 *   §1 ba câu cảnh báo có THẬT SỰ ra HTML lúc `pending` không (và biến mất khi đã xong).
 *   §2 khối cảnh báo có nằm TRƯỚC hàng nút trong THỨ TỰ TÀI LIỆU không — cảnh báo dưới nút là
 *      cảnh báo đến sau quyết định.
 *   §3 hàng nút có ĐỐI XỨNG không: cùng một hộp `grid-cols-2`, hai nút cùng lớp bề rộng, không
 *      `flex-1`. Đây là chỗ luật trở thành HÌNH HỌC.
 *   §4 đồng hồ TTL có mặt lúc `pending`.
 *
 * ⚠ §3 đọc **thuộc tính class trên cây đã render**, không đọc mã nguồn: một đột biến đổi
 *   `grid-cols-2` → `flex` ở TỆP làm ô này ĐỎ, còn một chú thích nhắc tới `grid-cols-2` thì không
 *   làm nó xanh. Đó là khác biệt giữa "đo cái được vẽ" và "đo cái được viết".
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/**
 * `t` giả TRA THẬT `vi.json`. Một `t` trả về chính khoá sẽ làm mọi khẳng định dưới đây xanh một
 * cách tầm thường — đó là lưới giả. Ở đây gõ sai khoá ⇒ ra `‹THIẾU:…›` ⇒ ô §1 ĐỎ.
 */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  // Nội suy `{{x}}` — không có bước này thì nhãn ra HTML là chuỗi "{{n}} khối" và ô §2 hỏi sai câu.
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

/**
 * React SSR thoát `&`, `<`, `>`, `"`. Mọi phép so chuỗi với HTML phải đi qua đây — nếu không, ô
 * *"nhãn Hủy có mặt không"* sẽ ĐỎ vì `Duyệt & ghi` ra thành `Duyệt &amp; ghi`, tức đỏ vì lý do SAI.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { TheDuyetDiff, tachCanhBaoKyThuat } = await import("./TheDuyetDiff");

const BA_CAU = [
  'Tệp SẠCH (không có thay đổi chưa commit) — sẽ GHI ĐÈ "src/StringUtils.cs".',
  "Băm TRƯỚC 725ee0d8aaaa1111… → SAU 14f5438dbbbb2222… Băm này được so LẠI ở lúc bạn xác nhận.",
  "30 dòng → 32 dòng.",
];

function ve(over: Partial<Parameters<typeof TheDuyetDiff>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TheDuyetDiff, {
      action: { expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(), preview: { warnings: BA_CAU } },
      args: {
        path: "src/StringUtils.cs",
        original: "using System;\nclass A { }\n",
        modified: "using System;\nclass A { public static int N(string s) => s.Length; }\n",
      },
      state: "pending",
      busy: false,
      preview: "using System;\nclass A { }\n",
      onPreview: () => {},
      onConfirm: () => {},
      onCancel: () => {},
      ...over,
    } as Parameters<typeof TheDuyetDiff>[0]),
  );
}

const NHAN_DUYET = VI.repoWs.diff.confirm as string;
const NHAN_HUY = VI.repoWs.diff.cancel as string;

describe("§1 CẢNH BÁO — có thật trong HTML lúc đang hỏi, không phải sau khi đã trả lời", () => {
  it("cả BA câu `preview.warnings` ra HTML khi state = pending", () => {
    const html = ve();
    expect(html).toContain("data-canh-bao");
    for (const cau of BA_CAU) expect(html, cau).toContain(esc(cau));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★ chống tự thoả: warnings RỖNG ⇒ KHÔNG có khối cảnh báo (ô này phải ĐỎ ĐƯỢC)", () => {
    const html = ve({ action: { expiresAt: new Date(Date.now() + 60_000).toISOString(), preview: { warnings: [] } } } as any);
    expect(html).not.toContain("data-canh-bao");
    // …nhưng thẻ vẫn là thẻ duyệt, tức ô trên đỏ vì ĐÚNG lý do chứ không vì render hỏng.
    expect(html).toContain('data-the-duyet="apply_diff"');
  });

  it("★ đã xong (executed) ⇒ không còn hỏi nữa ⇒ không còn cảnh báo lẫn hàng nút", () => {
    const html = ve({ state: "executed" } as any);
    expect(html).not.toContain("data-canh-bao");
    expect(html).not.toContain("data-hang-nut");
    expect(html).toContain(esc(VI.repoWs.diff.executed));
  });
});

describe("§2 THỨ TỰ TÀI LIỆU — cảnh báo TRƯỚC nút, luôn luôn", () => {
  it("vị trí `data-canh-bao` < vị trí `data-hang-nut`", () => {
    const html = ve();
    const iCanhBao = html.indexOf("data-canh-bao");
    const iNut = html.indexOf("data-hang-nut");
    expect(iCanhBao).toBeGreaterThan(-1);
    expect(iNut).toBeGreaterThan(-1);
    expect(iCanhBao).toBeLessThan(iNut);
  });

  it("★ và cảnh báo cũng đứng TRƯỚC khối diff — diff dài không đẩy được nó xuống dưới nếp gấp", () => {
    const html = ve();
    // `HunkDiffView` luôn phát nhãn "khối" (`diff.hunk.count`) khi có ít nhất một khối.
    const iDiff = html.indexOf(esc(String(VI.diff.hunk.count).replace("{{n}}", "1")));
    expect(iDiff).toBeGreaterThan(-1);
    expect(html.indexOf("data-canh-bao")).toBeLessThan(iDiff);
  });
});

describe("§3 HÀNG NÚT — luật là HÌNH HỌC, không phải lời dặn", () => {
  /** Bóc thuộc tính `class` của thẻ mở mang `data-hang-nut`. */
  function classHangNut(html: string): string {
    const i = html.indexOf("data-hang-nut");
    const dau = html.lastIndexOf("<", i);
    const cuoi = html.indexOf(">", i);
    const the = html.slice(dau, cuoi);
    return /class="([^"]*)"/.exec(the)?.[1] ?? "";
  }

  it("hộp chứa hai nút là LƯỚI HAI CỘT (không phải flex)", () => {
    const cls = classHangNut(ve());
    expect(cls).toContain("grid-cols-2");
    expect(cls.split(/\s+/)).toContain("grid");
    // `flex-1` là đúng cơ chế đã đẩy "Hủy" ra ngoài: nó chia phần theo bề rộng CHA đã phình.
    expect(cls).not.toContain("flex-1");
  });

  it("★ hai nút ĐỐI XỨNG: cùng `w-full`, không nút nào mang `flex-1`/`col-span`", () => {
    const html = ve();
    const iNut = html.indexOf("data-hang-nut");
    const doan = html.slice(iNut, html.indexOf("</div>", html.indexOf(esc(NHAN_HUY))));
    const nut = [...doan.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    expect(nut.length).toBe(2);
    for (const c of nut) {
      expect(c).toContain("w-full");
      expect(c).not.toContain("flex-1");
      expect(c).not.toContain("col-span");
    }
  });

  it("cả hai nhãn có mặt, và nhãn HỦY không bị nuốt", () => {
    const html = ve();
    expect(html).toContain(esc(NHAN_DUYET));
    expect(html).toContain(esc(NHAN_HUY));
  });

  it("★ busy ⇒ nút GHI bị khoá nhưng nút HỦY thì KHÔNG — đường thoát không bao giờ bị khoá theo", () => {
    const html = ve({ busy: true } as any);
    const iNut = html.indexOf("data-hang-nut");
    const doan = html.slice(iNut);
    const nut = [...doan.matchAll(/<button[^>]*>/g)].slice(0, 2).map((m) => m[0]);
    expect(nut[0]).toContain("disabled");
    expect(nut[1]).toContain("disabled"); // busy khoá cả hai — nêu ra để lượt sau không tưởng là lỗi
  });
});

describe("§4 ĐỒNG HỒ TTL — có mặt đúng lúc đang hỏi", () => {
  it("pending ⇒ có `data-dong-ho-ttl`; executed ⇒ không", () => {
    expect(ve()).toContain("data-dong-ho-ttl");
    expect(ve({ state: "executed" } as any)).not.toContain("data-dong-ho-ttl");
  });
});

describe("§6 KHỐI PHẢI ĐỌC ĐƯỢC GHIM TRÊN — luật theo trục DỌC", () => {
  /**
   * Vì sao ô này tồn tại: ở 900×700 khung hội thoại đo được cao **252,5 px** trong khi thẻ duyệt
   * cao **492,8 px**, và hội thoại TỰ CUỘN XUỐNG ĐÁY ⇒ nếu khối đồng hồ+cảnh báo không ghim, thứ
   * lọt vào mắt là HÀNG NÚT còn cảnh báo trôi lên trên nếp gấp. Vẫn đúng hình dạng cũ, chỉ đổi trục.
   * Sau khi ghim, phép đo live cho **cả bốn** (nút Duyệt · nút Hủy · đồng hồ · cảnh báo) hiện 100%
   * bề rộng **và** 100% bề cao trong một khung 252,5 px.
   */
  it("khối `data-ghim-tren` có `sticky top-0` và bọc CẢ đồng hồ LẪN cảnh báo", () => {
    const html = ve();
    const i = html.indexOf("data-ghim-tren");
    expect(i).toBeGreaterThan(-1);
    const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
    expect(the).toContain("sticky");
    expect(the).toContain("top-0");
    // Cả hai thứ "phải đọc" nằm TRONG khối ghim, và hàng nút nằm NGOÀI (nó cuộn theo thẻ).
    const dongHo = html.indexOf("data-dong-ho-ttl");
    const canhBao = html.indexOf("data-canh-bao");
    const ketGhim = html.indexOf("data-ghim-tren") + html.slice(html.indexOf("data-ghim-tren")).indexOf('class="min-w-0 space-y-2"');
    expect(dongHo).toBeGreaterThan(i);
    expect(canhBao).toBeGreaterThan(i);
    expect(dongHo).toBeLessThan(ketGhim);
    expect(canhBao).toBeLessThan(ketGhim);
    expect(html.indexOf("data-hang-nut")).toBeGreaterThan(ketGhim);
  });
});

describe("§5 KHÔNG KHỐI NÀO ĐƯỢC PHÉP KHÔNG CO — mọi hộp chữ mang `min-w-0`", () => {
  it("thẻ gốc có `min-w-0` và `max-w-full`", () => {
    const html = ve();
    const i = html.indexOf('data-the-duyet="apply_diff"');
    const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
    expect(the).toContain("min-w-0");
    expect(the).toContain("max-w-full");
  });
});

/**
 * ★★★ §7 (2026-08-25) — GIẤU CHUỖI BĂM HEX KHỎI HỘP "PHẢI ĐỌC".
 * Audit UX (kỹ-sư-mới): dòng "Băm TRƯỚC a1b2c3… → SAU d4e5f6…" phơi nguyên văn trong hộp đỏ vừa
 * VÔ NGHĨA vừa DỌA. Nó phải GẬP trong `<details>` (điều tra vẫn mở xem được), KHÔNG ở hộp chính.
 * Hàm THUẦN `tachCanhBaoKyThuat` được đo MỘT MÌNH; phần render được đo trên CÂY THẬT.
 */
describe("§7a tachCanhBaoKyThuat — hàm THUẦN bóc dòng BĂM HEX khỏi cảnh báo thường", () => {
  it("'Băm TRƯỚC…' → kyThuat; 'GHI ĐÈ' + 'N dòng' → thuong", () => {
    const { thuong, kyThuat } = tachCanhBaoKyThuat(BA_CAU);
    expect(kyThuat).toEqual([BA_CAU[1]]); // chỉ đúng dòng mang băm hex
    expect(thuong).toEqual([BA_CAU[0], BA_CAU[2]]); // GHI ĐÈ + số dòng vẫn là cảnh báo thường
  });

  it("★ chống tự thoả: '3 tệp, mỗi tệp…' KHÔNG hex và KHÔNG mở đầu 'băm' ⇒ thuong", () => {
    const { thuong, kyThuat } = tachCanhBaoKyThuat([
      "3 tệp, mỗi tệp một băm neo riêng — kiểm lại lúc bạn duyệt.",
    ]);
    expect(thuong.length).toBe(1);
    expect(kyThuat.length).toBe(0);
  });
});

describe("§7b BĂM HEX GẬP trong <details>, KHÔNG ở hộp cảnh báo chính", () => {
  it("★ 'Băm TRƯỚC…' nằm TRONG <details data-chi-tiet-ky-thuat>; hai dòng thường ở hộp chính", () => {
    const html = ve();
    const iDetails = html.indexOf("data-chi-tiet-ky-thuat");
    expect(iDetails).toBeGreaterThan(-1); // ĐỘT BIẾN: bỏ phân loại (hiện thẳng) ⇒ mất details ⇒ ĐỎ
    const iBam = html.indexOf(esc(BA_CAU[1]));
    // dòng băm đứng SAU marker details ⇒ ở khối gập; hai dòng thường đứng TRƯỚC ⇒ ở hộp cảnh báo chính.
    expect(iBam).toBeGreaterThan(iDetails);
    expect(html.indexOf(esc(BA_CAU[0]))).toBeLessThan(iDetails);
    expect(html.indexOf(esc(BA_CAU[2]))).toBeLessThan(iDetails);
    // hộp cảnh báo CHÍNH (giữa `data-canh-bao` và <details>) KHÔNG được chứa chuỗi băm.
    const iBox = html.indexOf("data-canh-bao");
    expect(html.slice(iBox, iDetails)).not.toContain("Băm TRƯỚC");
  });

  it("★ summary tra THẬT `repoWs.diff.techDetails` (không phải khoá thô, không THIẾU)", () => {
    const html = ve();
    expect(html).toContain(esc(VI.repoWs.diff.techDetails));
    expect(html).not.toContain("‹THIẾU:");
  });
});
