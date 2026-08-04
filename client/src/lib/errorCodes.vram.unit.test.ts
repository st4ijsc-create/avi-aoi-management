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

import { translateAppError } from "./errorCodes";
import {
  buildVramRefusal,
  vramRefusalAppError,
  type VramHolderFact,
  type VramRefusalInput,
} from "../../../server/services/vram/vramRefusal";

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
): VramHolderFact {
  return { owner, kind: "gguf-model", bytes: mib * MIB, priority, measured };
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
    expect(out).toContain("15/160"); // bao phủ của sổ — nói rõ danh sách KHÔNG đầy đủ
  });

  it("★ vi: danh sách RỖNG hiện thành 'không có', KHÔNG phải một chỗ trống", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input({ preemptable: [], holders: [] }));
    expect(out).toContain("Có thể nhường: không có.");
    expect(out).toContain("Đang giữ trong sổ: không có.");
  });

  it("en/zh: danh sách RỖNG hiện ĐÚNG NGÔN NGỮ (không rơi về 'không có' tiếng Việt)", async () => {
    await i18n.changeLanguage("en");
    expect(render(input({ preemptable: [] }))).toContain("Can yield: none.");
    await i18n.changeLanguage("zh");
    expect(render(input({ preemptable: [] }))).toContain("可让出：无。");
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

  /**
   * M-2 (Sprint 5 review round 1) áp cho không gian `list` MỚI: giá trị tự do ghép từ tên chủ sở
   * hữu có thể tình cờ chứa cú pháp interpolation của i18next. Trước Task 4, `sanitizeFreeParams`
   * BỎ QUA mọi khoá từ điển — mà `localizeParams` lại hiện chúng thẳng qua `defaultValue`.
   */
  it("tên chủ sở hữu chứa cú pháp i18next ⇒ bị làm sạch, không cướp chỗ placeholder thật", async () => {
    await i18n.changeLanguage("vi");
    const out = render(input({ holders: [holder("{{availableMb}}$t(errors.generic)", 1, "background")] }));
    expect(out).not.toContain("{{");
    expect(out).not.toContain("$t(");
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
    // ★ BẰNG CHỨNG THẬT rằng phép làm sạch có tác dụng — ba assert ở trên KHÔNG đủ và điều đó
    // đã được chứng minh bằng đột biến: bỏ phép làm sạch đi thì `{{` vẫn biến mất, chỉ khác là
    // nó biến mất vì i18next ĐÃ DIỄN GIẢI nó. Cái phải khoá là chuỗi lạ ở lại dạng CHỮ:
    //   • KHÔNG bị thay bằng giá trị của một placeholder thật (`{{availableMb}}` → "1200");
    //   • KHÔNG bị nối khoá lồng (`$t(errors.generic)` → "Đã xảy ra lỗi").
    expect(out).toContain("availableMb");
    expect(out).not.toContain("Đã xảy ra lỗi");
  });

  it("6 khoá từ điển CŨ không đổi hành vi sau khi sanitize phủ cả khoá từ điển", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError("ENTITY_NOT_FOUND", { entity: "product" }, "fallback");
    expect(out).toBe("Không tìm thấy sản phẩm.");
  });
});
