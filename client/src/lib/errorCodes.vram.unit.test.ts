/**
 * ★ Pha 2B Task 4 (§5.3) — LỜI TỪ CHỐI VRAM hiện ra thành CÂU NGƯỜI ĐỌC ĐƯỢC.
 *
 * `server/services/vram/refusal.test.ts` khoá phần CẤU TRÚC (bốn thành phần, phần KHÔNG quy trách
 * nhiệm được, không giá trị vô hạn nào lọt ra). File này khoá **nấc cuối cùng**: `params` do
 * `vramRefusalAppError()` sinh ra, đi qua ĐÚNG đường `translateAppError()` + bản dịch THẬT, ra
 * một câu **không còn placeholder thô** ở **cả ba** ngôn ngữ.
 *
 * Vì sao phải có nấc này: hai cổng phía máy chủ chỉ chứng minh khoá TỒN TẠI và tham số ĐƯỢC
 * TRUYỀN. Chúng KHÔNG chạy i18next thật, nên không thấy được các ca như *"khoá `_WITH_REASON` chỉ
 * có ở vi"* (F8) hay *"nội suy LỒNG cho `errors.reason.*` không nhận placeholder con"* — hai bug
 * đã xảy ra thật trong Sprint 5. Cùng cách nạp i18n THẬT như `errorCodes.unit.test.ts` (KHÔNG stub
 * `i18n.t`): stub là cách nhanh nhất để xanh giả trong khi người dùng thấy khoá trần.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

import { translateAppError, stripInterpolationSyntax } from "./errorCodes";
import {
  buildVramRefusal,
  vramRefusalAppError,
  type VramHolderFact,
  type VramRefusalInput,
} from "../../../server/services/vram/vramRefusal";
// ★ Lượt vá sau review TOÀN NHÁNH — ĐỌC HAI HẰNG SỐ, KHÔNG chép "15/160" vào ca test: bản liệt kê
// đường cấp phát đổi theo từng task (nay 15/159), và một con số chép tay ở đây đã đỏ IM LẶNG suốt
// hai task vì file này không nằm trong `npx vitest run server/services/vram/`.
import {
  KNOWN_ALLOCATION_SITE_ROW_COUNT,
  WIRED_ALLOCATION_SITE_COUNT,
} from "../../../server/services/vram/vramAllocationSites";

import "../i18n";
import i18n from "i18next";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});

const LOCALES = ["vi", "en", "zh"] as const;
const MIB = 1024 * 1024;

function hasUnresolvedPlaceholder(s: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(s);
}

function holder(
  owner: string,
  mib: number,
  priority: "production" | "interactive" | "background",
  measured = true,
  /**
   * ★★★ LƯỢT VÁ SAU REVIEW TOÀN NHÁNH — **FILE NÀY ĐÃ ĐỎ TỪ Task 4 mà không ai thấy.**
   *
   * `VramHolderFact.reclaimable` (Task 4 vòng sửa 1) là trường BẮT BUỘC, nhưng fixture ở đây không
   * khai nó ⇒ `undefined` ⇒ `preemptableBytes` cộng ra **0** ⇒ hai ca đỏ (*"câu mang ĐỦ BỐN thứ"* và
   * *"I-3b … nêu TỔNG byte nhường được"*). `tsc` KHÔNG bắt vì `tsconfig.json` loại mọi tệp `.test.ts`,
   * và `npx vitest run server/services/vram/` KHÔNG chạy file này (nó ở `client/`).
   * ⇒ Nấc i18n — nấc DUY NHẤT chạy i18next thật với bản dịch thật — đã tối suốt hai task.
   */
  reclaimable = true,
): VramHolderFact {
  return { owner, kind: "gguf-model", bytes: mib * MIB, priority, measured, reclaimable };
}

/** Fixture cỡ **17.000 MiB** (ràng buộc toàn cục 7). */
function input(over: Partial<VramRefusalInput> = {}): VramRefusalInput {
  return {
    requestedBytes: 17_000 * MIB,
    owner: "aiGgufEngine:qwen3-30b",
    priority: "interactive",
    headroomBytes: 1_200 * MIB,
    degradedReasons: [],
    blind: false,
    ledgerTotalBytes: 18_000 * MIB,
    usedBytes: 18_000 * MIB,
    holders: [holder("gguf-model:qwen3-30b", 17_000, "production")],
    preemptable: [holder("kb-sync:embed", 1_000, "background", false)],
    unledgered: { bytes: 0, unknownCount: 0 },
    // ★ I-3 — trần ĐẾM là trường BẮT BUỘC của sự thật từ chối (xem vramRefusal.ts).
    slotsNeeded: 0,
    ...over,
  };
}

function render(inp: VramRefusalInput): string {
  const { appCode, params, fallbackMessage } = vramRefusalAppError(buildVramRefusal(inp));
  return translateAppError(appCode, params, fallbackMessage);
}

/** BỐN hình dạng của lời từ chối — mỗi hình dạng chọn một khoá `errors.reason.*` khác nhau. */
const SHAPES: Array<[string, VramRefusalInput]> = [
  ["unknownCount>0", input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } })],
  ["mù / chưa hỏi", input({ unledgered: null })],
  ["đo được phần ngoài sổ", input({ usedBytes: 21_000 * MIB })],
  ["sổ giải thích hết", input()],
  [
    "dư địa KHÔNG tính được",
    input({ headroomBytes: Number.NEGATIVE_INFINITY, degradedReasons: ["invalid-input"] }),
  ],
  ["không ai nhường được", input({ preemptable: [], holders: [] })],
  // ★ I-3 (review TOÀN NHÁNH) — hình dạng THỨ BẢY: byte VỪA, hết KHE ⇒ khoá `VRAM_SLOT_CAP`.
  ["hết KHE model GGUF", input({ requestedBytes: 600 * MIB, slotsNeeded: 2 })],
];

describe("VRAM_REFUSED — câu người vận hành đọc, cả ba ngôn ngữ", () => {
  for (const locale of LOCALES) {
    for (const [name, inp] of SHAPES) {
      it(`${locale}: ${name} ⇒ dịch được, không còn placeholder thô, không rơi về fallback`, async () => {
        await i18n.changeLanguage(locale);
        const out = render(inp);
        expect(hasUnresolvedPlaceholder(out), out).toBe(false);
        // Rơi về `fallbackMessage` = mất bản dịch ⇒ người dùng en/zh đọc câu tiếng Việt máy chủ.
        expect(out).not.toBe(vramRefusalAppError(buildVramRefusal(inp)).fallbackMessage);
        // Không lọt giá trị vô hạn (bàn giao 1 của Task 2).
        expect(out).not.toMatch(/Infinity|NaN/);
      });
    }
  }

  it("vi: câu mang ĐỦ BỐN thứ + phần KHÔNG quy trách nhiệm được", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input());
    expect(out).toContain("17000"); // xin bao nhiêu
    expect(out).toContain("1200"); // còn bao nhiêu
    expect(out).toContain("gguf-model:qwen3-30b"); // ai đang giữ
    expect(out).toContain("kb-sync:embed"); // ai có thể nhường
    expect(out).toContain("không quy trách nhiệm được");
    // bao phủ của sổ — nói rõ danh sách KHÔNG đầy đủ
    expect(out).toContain(`${WIRED_ALLOCATION_SITE_COUNT}/${KNOWN_ALLOCATION_SITE_ROW_COUNT}`);
  });

  it("★ vi: danh sách RỖNG hiện thành 'không có', KHÔNG phải một chỗ trống", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input({ preemptable: [], holders: [] }));
    expect(out).toContain("Có thể nhường (0 MiB): không có.");
    expect(out).toContain("không có"); // vế "đang giữ" cũng vậy
  });

  it("en/zh: danh sách RỖNG hiện ĐÚNG NGÔN NGỮ (không rơi về 'không có' tiếng Việt)", async () => {
    await i18n.changeLanguage("en");
    expect(render(input({ preemptable: [] }))).toContain("Can yield (0 MiB): none.");
    await i18n.changeLanguage("zh");
    expect(render(input({ preemptable: [] }))).toContain("可让出（0 MiB）：无。");
  });

  it("★★ vi: unknownCount > 0 ⇒ câu NÓI RA rằng ước lượng KHÔNG đáng tin", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } }));
    expect(out).toContain("không quy trách nhiệm được");
    expect(out).toContain("2 lượt");
    expect(out).toContain("452 MiB");
    expect(out).toContain("không đáng tin");
  });

  it("dư địa KHÔNG tính được ⇒ câu KHÔNG chứa vế 'còn bao nhiêu' (vi)", async () => {
    await i18n.changeLanguage("vi");
    const out = render(
      input({ headroomBytes: Number.NEGATIVE_INFINITY, degradedReasons: ["invalid-input"] }),
    );
    expect(out).toContain("không tính được dư địa còn lại");
    expect(out).toContain("invalid-input");
    expect(out).not.toMatch(/còn \S+ MiB/);
  });

  it("★ I-3: dư địa KÉM TIN ⇒ câu i18n cũng HẠ GIỌNG (không chỉ câu máy chủ)", async () => {
    await i18n.changeLanguage("vi");
    const degraded = render(input({ degradedReasons: ["no-tick", "unverified-baseline"] }));
    expect(degraded).toContain("kém tin hơn bình thường");
    expect(degraded).toContain("no-tick");
    // Và KHÔNG hạ giọng khi số đáng tin — `errors.trust.trusted` là chuỗi RỖNG.
    const trusted = render(input());
    expect(trusted).not.toContain("kém tin");
    expect(trusted).toContain("còn 1200 MiB.");
  });

  it("★ I-3b: câu i18n GIẢI THÍCH ký hiệu '≈' và nêu TỔNG byte nhường được", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input());
    expect(out).toContain('"≈" = ước lượng chưa đo');
    expect(out).toContain("Có thể nhường (1000 MiB)");
  });

  /**
   * ★★★ I-3 (review TOÀN NHÁNH) — NẤC CUỐI: người vận hành đọc ĐÚNG cửa đã chặn.
   *
   * Trước bản vá, ca này in ra *"Không đủ VRAM … xin 600 MiB, còn 1200 MiB (con số này kém tin hơn
   * bình thường: gguf-slot-cap)"* — một câu vừa khai còn thừa vừa nói không đủ, rồi đổ cho độ tin
   * cậy của một con số hoàn toàn đúng.
   */
  it("★★★ I-3: hết KHE ⇒ câu nói về KHE, không nói về byte thiếu (vi/en/zh)", async () => {
    const inp = input({ requestedBytes: 600 * MIB, slotsNeeded: 2 });
    await i18n.changeLanguage("vi");
    const vi = render(inp);
    expect(vi).toContain("Hết KHE model GGUF");
    expect(vi).toContain("nhả thêm 2 model");
    expect(vi).toContain("1200 MiB");            // dư địa byte vẫn được in — không giấu số
    expect(vi).not.toContain("Không đủ VRAM");
    expect(vi).not.toContain("kém tin hơn bình thường");
    await i18n.changeLanguage("en");
    expect(render(inp)).toContain("No free GGUF model slot");
    await i18n.changeLanguage("zh");
    expect(render(inp)).toContain("GGUF 模型槽位");
  });

  it("6 khoá từ điển CŨ không đổi hành vi sau khi sanitize phủ cả khoá từ điển", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError("ENTITY_NOT_FOUND", { entity: "product" }, "fallback");
    expect(out).toBe("Không tìm thấy sản phẩm.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ C-1 (review vòng 1) — ĐÓNG **LỚP**, không đóng THỂ HIỆN.
//
// Bản vá đầu làm sạch bằng THAY THẾ MẪU và reviewer chạy **3/3 biến thể tự huỷ đều SỐNG** — một
// lượt quét không quét lại, nên payload tái tạo cú pháp SAU khi đã quét. Biến thể thứ ba là một
// đường **TREO TIẾN TRÌNH** (`i18n.t()` không trả về, đo được > 8 phút), không chỉ hiển thị sai.
//
// ⚠ VÌ SAO MỖI CA KIỂM TIỀN ĐIỀU KIỆN TRƯỚC KHI RENDER: một vòng lặp/đệ quy ĐỒNG BỘ trong
// `i18n.t()` thì `timeout` của vitest KHÔNG cắt được (một luồng, không điểm nhả) — nó chỉ treo
// runner. Chứng minh trên hàm THUẦN trước: nếu chuỗi đã sạch `{`/`}`/`$` thì i18next không còn gì
// để diễn giải, nên lượt render sau đó KHÔNG THỂ treo. Thứ tự này là BẮT BUỘC, không phải khẩu vị.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("C-1 — payload TỰ HUỶ: đóng lớp, không vá mẫu", () => {
  /** Tính chất PHẢI đạt: làm sạch là BẤT ĐỘNG, và kết quả không dựng nổi cú pháp nào. */
  function assertInert(raw: string): string {
    const once = stripInterpolationSyntax(raw);
    expect(once, `còn ký tự dựng cú pháp: ${JSON.stringify(once)}`).not.toMatch(/[{}$]/);
    // Lặp lại KHÔNG sinh cú pháp mới — đúng tính chất mà một lượt thay-thế-MẪU không có.
    expect(stripInterpolationSyntax(once)).toBe(once);
    return once;
  }

  /** `[tên, payload, mẩu chữ PHẢI còn nguyên trong câu ra]` — mẩu chữ là bằng chứng "ở lại dạng
   *  CHỮ": nếu i18next diễn giải được payload thì đúng mẩu đó biến mất (thành `1200`, thành câu
   *  của khoá `errors.generic`, hoặc thành một lượt đệ quy không trả về). */
  const VARIANTS: Array<[string, string, string]> = [
    ["1. cướp placeholder thật", "{$t({availableMb}}", "availableMb"],
    ["2. nối khoá i18n bất kỳ", "$$t(t(errors.generic)", "errors.generic"],
    [
      "3. TỰ THAM CHIẾU (treo tiến trình)",
      "$$t(t(errors.VRAM_REFUSED_WITH_REASON)",
      "errors.VRAM_REFUSED_WITH_REASON",
    ],
  ];

  it("làm sạch BẤT ĐỘNG với cả ba biến thể tự huỷ (hàm THUẦN, không render)", () => {
    for (const [name, raw] of VARIANTS) {
      const cleaned = assertInert(raw);
      expect(cleaned, name).not.toContain("{{");
      expect(cleaned, name).not.toContain("$t(");
    }
  });

  for (const [name, raw, residue] of VARIANTS) {
    it(`${name} — ở tham số TỪ ĐIỂN (holders) ⇒ ở lại dạng CHỮ`, async () => {
      assertInert(raw); // TIỀN ĐIỀU KIỆN: sau bước này render không thể treo.
      await i18n.changeLanguage("vi");
      const out = render(input({ holders: [holder(raw, 1, "background")] }));
      expect(out).not.toMatch(/[{}$]/);
      expect(out).not.toContain("Đã xảy ra lỗi"); // không nối được khoá i18n nào
      expect(out).toContain("1200 MiB"); // placeholder THẬT vẫn thay đúng, không bị cướp
      expect(out).toContain(residue); // chuỗi lạ ở lại dạng chữ
    });
  }

  /**
   * ⚠⚠ LỚP NÀY CÒN NGUYÊN Ở THAM SỐ **TỰ DO** mà bản vá đầu không đụng tới — reviewer đo:
   * `owner = "{$t({availableMb}}"` ⇒ `Không đủ VRAM cho 1200 … còn {{availableMb}} MiB`, vừa cướp
   * giá trị vừa đẩy `{{}}` THÔ ra màn hình. Bề mặt là THẬT, không lý thuyết: `gguf:${modelId}` /
   * `reranker:${modelPath}` (`aiGgufEngine.ts:950,986,1168,1680,3035`; `aiReranker.ts:472,523`)
   * ⇐ id model trong DB, `.env`, tên tệp `.gguf`.
   */
  it("★ biến thể ở tham số TỰ DO (owner) — cùng lớp, cũng phải câm", async () => {
    const raw = "{$t({availableMb}}";
    assertInert(raw);
    await i18n.changeLanguage("vi");
    const out = render(input({ owner: raw }));
    expect(out).not.toMatch(/[{}$]/);
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
    expect(out).toContain("availableMb");
    expect(out).toContain("1200");
  });
});
