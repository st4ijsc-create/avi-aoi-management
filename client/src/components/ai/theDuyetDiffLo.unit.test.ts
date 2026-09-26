/**
 * ★★★ 2026-08-24 — LƯỚI CHO **THẺ DUYỆT LÔ** (`apply_diff_batch`): N tệp = N tab, mỗi tab một diff
 * THẬT chỉ-đọc; cảnh báo theo-tệp gắn đúng tab; hàng nút đối xứng; **KHÔNG** UI chọn-khối.
 *
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` khác đi ⇒ vitest **lặng lẽ bỏ qua** mà cổng vẫn
 *   XANH (lớp "glob rỗng" đã che ca đỏ nhiều lần trong dự án này).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO DỰNG CÂY THẬT (`renderToStaticMarkup`), KHÔNG QUÉT VĂN BẢN MÃ NGUỒN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng bài học F1/F14 và của `theDuyetDiff.unit.test.ts`: một lưới quét VĂN BẢN trả lời "mã có hình
 * dạng ấy không", KHÔNG trả lời "mã LÀM việc ấy không". Ví dụ một chú thích nhắc `grid-cols-2` làm
 * lưới-văn-bản xanh trong khi nút thật đã đổi sang `flex`. Nên ta dựng CÂY THẬT và hỏi những câu chỉ
 * cây thật trả lời được: *có đúng N nút tab không*, *cảnh báo `#2` gắn TAB tệp thứ hai hay lẫn vào
 * khối ghim chung*, *hàng nút có đối xứng không*, *cây có rò UI chọn-khối không*.
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
 * `t` giả TRA THẬT `vi.json` (gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ ô ĐỎ), có nội suy `{{n}}` — không có bước
 * nội suy thì nhãn ra HTML là chuỗi "{{n}} tệp" và các ô hỏi sai câu.
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

/** React SSR thoát `&`,`<`,`>`,`"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { TheDuyetDiffLo, phanLoaiCanhBaoLo } = await import("./TheDuyetDiffLo");
const { tachCanhBaoKyThuat } = await import("./TheDuyetDiff");

/**
 * ★ FIXTURE HARDCODE. Hai tệp, mỗi tệp một khối:
 *   • #1 `foo.ts`  — đổi MỘT dòng            ⇒ badge +1 / −1.
 *   • #2 `bar.tsx` — thêm MỘT dòng ở cuối    ⇒ badge +1 / −0.
 * ⚠ `CANH_BAO` mô phỏng ĐÚNG khuôn chuỗi `applyDiffBatch.ts · xemTruoc` sinh (2026-08-24):
 *   [0] cảnh báo CHUNG cả-lô (KHÔNG tiền tố `#`),
 *   [1] `#1 {relPath} — GHI ĐÈ (tệp sạch); băm …… → …….`,
 *   [2] `#2 {relPath} — GHI ĐÈ (tệp sạch); băm …… → …….`.
 *   Nếu server đổi khuôn (tiền tố `#{stt} `) thì đồng bộ TAY ở đây — giống `theDuyetDiff` hardcode `BA_CAU`.
 */
const FILES = [
  { path: "server/services/foo.ts", original: "export const a = 1;\n", modified: "export const a = 2;\n" },
  { path: "client/src/bar.tsx", original: "const x = 1;\n", modified: "const x = 1;\nconst y = 2;\n" },
];
const CANH_BAO_CHUNG =
  "2 tệp, MỖI TỆP MỘT BĂM NEO RIÊNG — cả 2 băm được so LẠI lúc bạn bấm duyệt. Nếu bất kỳ tệp nào đổi dưới chân trong lúc bạn cân nhắc, CẢ LÔ bị từ chối và đĩa không đổi một byte.";
const CANH_BAO = [
  CANH_BAO_CHUNG,
  `#1 ${FILES[0].path} — GHI ĐÈ (tệp sạch); băm 725ee0d8aaaa… → 14f5438dbbbb….`,
  `#2 ${FILES[1].path} — GHI ĐÈ (tệp sạch); băm 99887766ccccc… → 55443322dddd….`,
];

function ve(over: Partial<Parameters<typeof TheDuyetDiffLo>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TheDuyetDiffLo, {
      action: { expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(), preview: { warnings: CANH_BAO } },
      files: FILES,
      state: "pending",
      busy: false,
      onConfirm: () => {},
      onCancel: () => {},
      ...over,
    } as Parameters<typeof TheDuyetDiffLo>[0]),
  );
}

const NHAN_HUY = VI.repoWs.diff.cancel as string;

describe("phanLoaiCanhBaoLo — bóc CHUNG khỏi THEO-TỆP theo tiền tố `#{stt} `", () => {
  it("cảnh báo không `#` ⇒ chung; cảnh báo `#{stt} ` ⇒ theoTep[stt]", () => {
    const { chung, theoTep } = phanLoaiCanhBaoLo(CANH_BAO);
    expect(chung).toEqual([CANH_BAO_CHUNG]);
    expect(theoTep.get(1)).toEqual([CANH_BAO[1]]);
    expect(theoTep.get(2)).toEqual([CANH_BAO[2]]);
    expect(theoTep.has(3)).toBe(false);
  });

  it("★ chống tự thoả: một chuỗi bắt đầu bằng SỐ nhưng KHÔNG `#` vẫn là CHUNG", () => {
    // "2 tệp…" mở đầu bằng chữ số — nếu khớp nhầm `/^\d/` thì nó rơi sai vào theoTep. Phải là chung.
    const { chung, theoTep } = phanLoaiCanhBaoLo(["2 tệp — cả lô…"]);
    expect(chung.length).toBe(1);
    expect(theoTep.size).toBe(0);
  });
});

describe("§1 TAB STRIP — đúng N nút = số tệp, mỗi nút một baseName + badge", () => {
  it("tab strip có ĐÚNG N nút", () => {
    const html = ve();
    const iStrip = html.indexOf("data-tab-strip");
    const iPanel = html.indexOf("data-tab-panel");
    expect(iStrip).toBeGreaterThan(-1);
    expect(iPanel).toBeGreaterThan(iStrip);
    const doan = html.slice(iStrip, iPanel); // vùng strip kết thúc trước panel đầu tiên
    const nut = [...doan.matchAll(/data-tab-nut="\d+"/g)];
    expect(nut.length).toBe(FILES.length);
  });

  it("★ mỗi nút tab mang baseName của tệp + badge cộng-trừ", () => {
    const html = ve();
    const iStrip = html.indexOf("data-tab-strip");
    const doan = html.slice(iStrip, html.indexOf("data-tab-panel"));
    expect(doan).toContain("foo.ts"); // baseName("server/services/foo.ts")
    expect(doan).toContain("bar.tsx"); // baseName("client/src/bar.tsx")
    // badge từ `planStats(keHoachKhoiDuyet(...))`: cả hai tệp thêm 1 dòng ⇒ "+1" xuất hiện.
    expect(doan).toContain("+1");
  });

  it("★ số nút tab đổi THEO số tệp (một fixture 3 tệp ⇒ 3 nút) — ô này phải ĐỎ ĐƯỢC", () => {
    const ba = [...FILES, { path: "shared/baz.ts", original: "", modified: "export const z = 3;\n" }];
    const html = ve({ files: ba } as any);
    const doan = html.slice(html.indexOf("data-tab-strip"), html.indexOf("data-tab-panel"));
    expect([...doan.matchAll(/data-tab-nut="\d+"/g)].length).toBe(3);
  });
});

describe("§2 CẢNH BÁO THEO TỆP gắn TAB, cảnh báo CHUNG ở khối ghim — không lẫn nhau", () => {
  it("cảnh báo `#2` nằm ở panel tệp thứ hai, KHÔNG ở khối cảnh báo chung", () => {
    const html = ve();
    const iChung = html.indexOf("data-canh-bao-chung");
    const iStrip = html.indexOf("data-tab-strip");
    const iTep2 = html.indexOf('data-canh-bao-tep="2"');
    const i2 = html.indexOf(esc(`#2 ${FILES[1].path}`));

    expect(iChung).toBeGreaterThan(-1);
    expect(iTep2).toBeGreaterThan(-1);
    // khối cảnh báo CHUNG (giữa marker chung và tab strip) KHÔNG chứa cảnh báo theo-tệp.
    expect(iChung).toBeLessThan(iStrip);
    expect(html.slice(iChung, iStrip)).not.toContain("#1");
    expect(html.slice(iChung, iStrip)).not.toContain("#2");
    // cảnh báo `#2` đứng SAU tab strip (tức trong panel, ngoài khối ghim) và gắn marker panel-2.
    expect(iTep2).toBeGreaterThan(iStrip);
    expect(i2).toBeGreaterThan(iTep2);
  });

  it("★ cảnh báo CHUNG có mặt trong khối ghim (câu cả-lô, không tiền tố `#`)", () => {
    const html = ve();
    expect(html).toContain(esc(CANH_BAO_CHUNG));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★ diff THẬT hiện trong panel (HunkDiffView chỉ-đọc phát nhãn `{{n}} khối`)", () => {
    const html = ve();
    // mỗi tệp fixture một khối ⇒ nhãn "1 khối" của HunkDiffView phải ra HTML.
    expect(html).toContain(esc(String(VI.diff.hunk.count).replace("{{n}}", "1")));
  });
});

describe("§3 HÀNG NÚT — luật là HÌNH HỌC (grid-cols-2 đối xứng), như TheDuyetDiff §3", () => {
  /** Bóc `class` của thẻ mở mang `data-hang-nut`. */
  function classHangNut(html: string): string {
    const i = html.indexOf("data-hang-nut");
    const dau = html.lastIndexOf("<", i);
    const cuoi = html.indexOf(">", i);
    return /class="([^"]*)"/.exec(html.slice(dau, cuoi))?.[1] ?? "";
  }

  it("hộp chứa hai nút là LƯỚI HAI CỘT (không phải flex)", () => {
    const cls = classHangNut(ve());
    expect(cls).toContain("grid-cols-2");
    expect(cls.split(/\s+/)).toContain("grid");
    expect(cls).not.toContain("flex-1");
  });

  it("★ hai nút ĐỐI XỨNG: cùng `w-full`, không nút nào `flex-1`/`col-span`", () => {
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

  it("★ busy ⇒ nút GHI khoá, nút HỦY thì KHÔNG khoá theo (đường thoát luôn mở)", () => {
    const html = ve({ busy: true } as any);
    const doan = html.slice(html.indexOf("data-hang-nut"));
    const nut = [...doan.matchAll(/<button[^>]*>/g)].slice(0, 2).map((m) => m[0]);
    expect(nut[0]).toContain("disabled"); // busy khoá nút GHI
    expect(nut[1]).toContain("disabled"); // …và cả HỦY (busy khoá cả hai — nêu ra để lượt sau không tưởng là lỗi)
  });
});

describe("§4 ĐỒNG HỒ TTL + trạng thái ĐÃ XONG", () => {
  it("pending ⇒ có `data-dong-ho-ttl` và hàng nút; executed ⇒ không còn cả hai lẫn cảnh báo", () => {
    expect(ve()).toContain("data-dong-ho-ttl");
    const done = ve({ state: "executed" } as any);
    expect(done).not.toContain("data-dong-ho-ttl");
    expect(done).not.toContain("data-hang-nut");
    expect(done).not.toContain("data-canh-bao-chung");
    expect(done).toContain(esc(VI.repoWs.diff.executed));
  });
});

describe("§5 ĐỘT BIẾN — lô KHÔNG có UI chọn-khối-lẻ (server tự chặn HUNK_IDS_INVALID)", () => {
  /**
   * Nếu ai đó mở chọn-khối cho lô, cách duy nhất để nó có tác dụng là **bỏ `readOnly`** của
   * `HunkDiffView` (khi ấy nút "Nhận khối"/"Áp tất cả"/checkbox EOL hiện ra) HOẶC dựng checkbox
   * riêng. Cả hai đều rơi vào cây render ⇒ ô này ĐỎ. (Nhánh "`onConfirm` nhận tham số" được chốt ở
   * KIỂU trong `TheDuyetDiffLo.tsx` — tệp component ĐƯỢC `npm run check` soi; tệp test thì tsconfig
   * loại trừ mọi tệp đuôi `.test.ts` nên không type-check ở đây, vì vậy ta canh nhánh này bằng cây render.)
   */
  it("cây render KHÔNG chứa nhãn 'Nhận khối'/'Áp tất cả' và KHÔNG có input chọn khối", () => {
    const html = ve();
    expect(html).not.toContain(esc(VI.diff.hunk.accept)); // "Nhận khối"
    expect(html).not.toContain(esc(VI.diff.hunk.applyAll)); // "Áp tất cả"
    expect(html).not.toContain(esc(VI.diff.hunk.undo)); // "Hoàn tác" (nút từng-khối)
    expect(html).not.toContain('type="checkbox"');
  });

  it("★ chống tự thoả: chính các nhãn ấy PHẢI xuất hiện khi `HunkDiffView` KHÔNG readOnly", async () => {
    // Dựng trực tiếp một HunkDiffView tương-tác để chứng minh ô trên đỏ ĐƯỢC (nhãn thật, tra thật).
    const { HunkDiffView } = await import("@/components/diff/HunkDiffView");
    const tuongTac = renderToStaticMarkup(
      createElement(HunkDiffView, { base: FILES[0].original, suggested: FILES[0].modified }),
    );
    expect(tuongTac).toContain(esc(VI.diff.hunk.applyAll)); // có readOnly=false ⇒ "Áp tất cả" hiện
  });
});

/**
 * ★★★ §7 (2026-08-25) — GIẤU BĂM HEX THEO TỆP. Cảnh báo `#N … băm …hex…` trong panel mỗi tệp phải
 * GẬP trong `<details>` (điều tra mở xem được), KHÔNG phơi thẳng. Cảnh báo CHUNG (câu "N tệp… BĂM
 * NEO RIÊNG", KHÔNG hex) vẫn HIỆN ở khối ghim — nó là lời trấn an bằng ngôn ngữ thường, không dọa.
 */
describe("§7 GIẤU BĂM HEX THEO TỆP — dòng '#N … băm …' GẬP trong <details>, chung thì không đổi", () => {
  it("hàm THUẦN: '#1 … băm hex' (theoTep) ⇒ kyThuat; câu CHUNG (không hex) ⇒ thuong", () => {
    const { chung, theoTep } = phanLoaiCanhBaoLo(CANH_BAO);
    expect(tachCanhBaoKyThuat(theoTep.get(1) ?? []).kyThuat).toEqual([CANH_BAO[1]]);
    // câu chung nhắc chữ "băm" nhưng KHÔNG có hex ⇒ vẫn là cảnh báo thường (hiện như cũ).
    expect(tachCanhBaoKyThuat(chung).thuong).toEqual([CANH_BAO_CHUNG]);
    expect(tachCanhBaoKyThuat(chung).kyThuat.length).toBe(0);
  });

  it("★ '#1 … băm hex' nằm TRONG <details data-chi-tiet-ky-thuat> ở panel, không phơi thẳng", () => {
    const html = ve();
    const iDetails = html.indexOf("data-chi-tiet-ky-thuat");
    expect(iDetails).toBeGreaterThan(-1); // ĐỘT BIẾN: bỏ tachCanhBaoKyThuat (hiện thẳng) ⇒ mất details ⇒ ĐỎ
    const iBam1 = html.indexOf(esc(CANH_BAO[1])); // "#1 … băm 725ee0d8aaaa… → …"
    expect(iBam1).toBeGreaterThan(iDetails); // dòng băm đứng SAU marker ⇒ trong khối gập
  });

  it("★ câu CHUNG (không hex) VẪN HIỆN ở khối ghim, KHÔNG bị gập nhầm", () => {
    const html = ve();
    const iChung = html.indexOf("data-canh-bao-chung");
    const iStrip = html.indexOf("data-tab-strip");
    // câu chung nằm trong khối cảnh báo chung (giữa marker chung và tab strip), hiện nguyên văn.
    expect(html.slice(iChung, iStrip)).toContain(esc(CANH_BAO_CHUNG));
    expect(html).toContain(esc(VI.repoWs.diff.techDetails)); // summary tra thật
    expect(html).not.toContain("‹THIẾU:");
  });
});
