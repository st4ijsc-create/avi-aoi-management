/**
 * ★★★ Pha 4 Task 3 — CÂU CHỮ CHO 23 MÃ KẾT CỤC CỦA `vramCommands.ts` + phần "cần câu chữ giải
 * thích" của `vramReadModel.ts` (Pha 4 Task 1/Task 2, đã có ở `HEAD=84cabe67`, KHÔNG sửa ở đây).
 *
 * Hai hạng người đọc CÙNG một câu: người vận hành ("chuyện gì xảy ra, tôi làm gì tiếp") và AI Agent
 * ("lệnh này thi hành được không, và VÌ SAO không"). Một câu chỉ lặp lại mã bằng tiếng Việt
 * (`owner-not-in-local-ledger` → "chủ sở hữu không có trong sổ cục bộ") là THẤT BẠI — file này khoá
 * cả hai: (a) 23/23 mã có bản dịch THẬT (không phải fallback, không phải tiếng vọng của chính mã),
 * (b) mỗi bản dịch mang đúng NỘI DUNG chỉ dẫn hành động mà brief đòi (ca "vi: owner-not-in-local-
 * ledger PHẢI nói tới tiến trình khác + vram.preempt", không chỉ "không rỗng").
 *
 * Cùng cách nạp i18n THẬT như `errorCodes.vram.unit.test.ts` (KHÔNG stub i18n.t) — stub là cách
 * nhanh nhất để xanh giả trong khi người dùng thấy khoá trần.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "i18next";
import "../i18n";

import {
  translateVramPreemptCommand,
  translateVramReleaseStaleCommand,
  translateVramRetryDeferredCommand,
  translateVramScope,
  translateVramHostedHere,
  translateVramHolderListIsLowerBound,
  translateVramEstimateUsable,
  translateVramNonFiniteFields,
  stripInterpolationSyntax,
} from "./errorCodes";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});

const LOCALES = ["vi", "en", "zh"] as const;

function hasUnresolvedPlaceholder(s: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(s);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 23 MÃ KẾT CỤC — bản khai VERBATIM từ brief Task 3, dùng làm SỔ ĐỐI CHIẾU (không được rút gọn).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const REQUIRED_OUTCOME_CODES = [
  "reclaimed",
  "failed",
  "no-bytes-freed",
  "busy-in-use",
  "production-never-preempted",
  "no-reclaimer-declared",
  "reclaimer-returned-false",
  "reclaimer-threw",
  "process-not-proven-dead",
  "owner-not-in-local-ledger",
  "own-row-local-ledger-is-authority",
  "row-not-in-shared-ledger-replica",
  "sibling-lease",
  "shared-baseline",
  "shared-ledger-never-refreshed",
  "queued-for-shared-ledger",
  "host-not-running-in-this-process",
  "no-defer-chain-in-this-process",
  "no-retry-mechanism-for-this-host",
  "unknown-background-host",
  "defer-budget-exceeded",
  "retry-armed",
  "this-process-only",
] as const;

/** Mỗi mã → CÁCH DỰNG câu bằng đúng hàm/đường mà `vramCommands.ts` sẽ dùng khi mã đó phát ra. */
function renderCode(code: (typeof REQUIRED_OUTCOME_CODES)[number]): string {
  switch (code) {
    case "reclaimed":
      return translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: "gguf-model:x", detail: null });
    case "failed":
      // outcome=failed với reason=null: KHÔNG xảy ra ở mã thật hôm nay (kq.failure luôn non-null khi
      // outcome=failed), nhưng kiểu `reason: X | null` không ép được điều đó ở tầng biên dịch — khoá
      // GỐC (không _WITH_REASON) phải tồn tại cho trường hợp phòng thủ này.
      return translateVramPreemptCommand({ outcome: "failed", reason: null, owner: "gguf-model:x", detail: null });
    case "no-bytes-freed":
    case "reclaimer-returned-false":
    case "reclaimer-threw":
      return translateVramPreemptCommand({ outcome: "failed", reason: code, owner: "gguf-model:x", detail: null });
    case "busy-in-use":
    case "production-never-preempted":
    case "no-reclaimer-declared":
    case "owner-not-in-local-ledger":
      return translateVramPreemptCommand({ outcome: "refused", reason: code, owner: "gguf-model:x", detail: null });
    case "process-not-proven-dead":
    case "own-row-local-ledger-is-authority":
    case "row-not-in-shared-ledger-replica":
    case "shared-ledger-never-refreshed":
      return translateVramReleaseStaleCommand({
        outcome: "refused",
        reason: code,
        leaseKey: "worker:123:456#7",
        processKey: "worker:123:456",
        rowKind: null,
        durability: null,
      });
    case "sibling-lease":
    case "shared-baseline":
      return translateVramReleaseStaleCommand({
        outcome: "released",
        reason: null,
        leaseKey: "worker:123:456#7",
        processKey: "worker:123:456",
        rowKind: code,
        durability: "queued-for-shared-ledger",
      });
    case "queued-for-shared-ledger":
      return translateVramReleaseStaleCommand({
        outcome: "released",
        reason: null,
        leaseKey: "worker:123:456#7",
        processKey: "worker:123:456",
        rowKind: "sibling-lease",
        durability: code,
      });
    case "host-not-running-in-this-process":
    case "no-defer-chain-in-this-process":
    case "no-retry-mechanism-for-this-host":
    case "unknown-background-host":
    case "defer-budget-exceeded":
      return translateVramRetryDeferredCommand({ outcome: "refused", reason: code, owner: "cron:kb-sync", host: "cron:kb-sync" });
    case "retry-armed":
      return translateVramRetryDeferredCommand({ outcome: "retry-armed", reason: null, owner: "cron:kb-sync", host: "cron:kb-sync" });
    case "this-process-only":
      return translateVramScope("this-process-only");
  }
}

describe("23/23 mã kết cục — dịch được, không placeholder thô, không tiếng vọng của chính mã", () => {
  for (const locale of LOCALES) {
    for (const code of REQUIRED_OUTCOME_CODES) {
      it(`${locale}: "${code}"`, async () => {
        await i18n.changeLanguage(locale);
        const out = renderCode(code);
        expect(hasUnresolvedPlaceholder(out), out).toBe(false);
        expect(out).not.toMatch(/Infinity|NaN/);
        // KHÔNG được là tiếng vọng của chính mã (câu phải THẬT SỰ được viết, không phải "code" trần).
        expect(out.toLowerCase()).not.toBe(code.toLowerCase());
        expect(out.length).toBeGreaterThan(code.length);
      });
    }
  }
});

describe("nội dung PHẢI mang chỉ dẫn hành động, không chỉ dịch định danh (ví dụ đích danh của brief)", () => {
  it("vi: owner-not-in-local-ledger PHẢI nói tới TIẾN TRÌNH KHÁC + lệnh vram.preempt, không chỉ lặp lại tên mã", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({
      outcome: "refused",
      reason: "owner-not-in-local-ledger",
      owner: "gguf-model:qwen3-30b",
      detail: null,
    });
    expect(out).not.toBe("chủ sở hữu không có trong sổ cục bộ");
    expect(out).toContain("tiến trình khác");
    expect(out).toContain("vram.preempt");
    expect(out).toContain("gguf-model:qwen3-30b");
  });

  it("en: owner-not-in-local-ledger names the OTHER process + the vram.preempt command", async () => {
    await i18n.changeLanguage("en");
    const out = translateVramPreemptCommand({
      outcome: "refused",
      reason: "owner-not-in-local-ledger",
      owner: "gguf-model:qwen3-30b",
      detail: null,
    });
    expect(out).toContain("another process");
    expect(out).toContain("vram.preempt");
  });

  it("vi: production-never-preempted PHẢI dẫn §5.2 (quy tắc), không chỉ nói 'là production'", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({
      outcome: "refused",
      reason: "production-never-preempted",
      owner: "aoi:line1",
      detail: null,
    });
    expect(out).toContain("§5.2");
    expect(out).toContain("KHÔNG BAO GIỜ");
  });

  it("vi: host-not-running-in-this-process PHẢI nói ĐÚNG hai tiến trình (worker chủ trì / nơi lệnh đang chạy)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramRetryDeferredCommand({
      outcome: "refused",
      reason: "host-not-running-in-this-process",
      owner: "cron:kb-sync",
      host: "cron:kb-sync",
    });
    expect(out).toContain("worker");
    expect(out).toContain("KHÔNG NHÌN THẤY");
  });

  it("vi: shared-baseline PHẢI giải thích freedBytes=0 là 'thước chưa từng đo', KHÔNG phải 'không có gì xảy ra'", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramReleaseStaleCommand({
      outcome: "released",
      reason: null,
      leaseKey: "shared-baseline#0",
      processKey: "worker:1:1",
      rowKind: "shared-baseline",
      durability: "queued-for-shared-ledger",
    });
    expect(out).toContain("chưa từng đo");
    // Câu PHẢI phủ định rõ ràng — "KHÔNG phải vì không có gì xảy ra" — chứ không được nói TRƠN
    // "không có gì xảy ra" (khẳng định, không phủ định) như một lời giải thích riêng.
    expect(out).toContain("KHÔNG phải vì không có gì xảy ra");
  });

  it("vi: reclaimed với freedBytes=0 (không truyền ở đây, câu tĩnh) vẫn phải nói đó là THÀNH CÔNG THẬT", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: "gguf-model:x", detail: null });
    expect(out).toContain("thành công thật");
  });
});

describe("mặt ĐỌC — trường CẦN câu chữ giải thích, không chỉ nhãn", () => {
  it("vi/en/zh: hostedHere true/false/null ba câu KHÁC NHAU, null KHÔNG đọc thành false", async () => {
    for (const locale of LOCALES) {
      await i18n.changeLanguage(locale);
      const t = translateVramHostedHere(true);
      const f = translateVramHostedHere(false);
      const u = translateVramHostedHere(null);
      expect(new Set([t, f, u]).size).toBe(3);
      expect(hasUnresolvedPlaceholder(t)).toBe(false);
      expect(hasUnresolvedPlaceholder(f)).toBe(false);
      expect(hasUnresolvedPlaceholder(u)).toBe(false);
    }
    await i18n.changeLanguage("vi");
    expect(translateVramHostedHere(null)).toContain("KHÔNG XÁC ĐỊNH ĐƯỢC");
  });

  it("vi: holderListIsLowerBound nói RÕ danh sách rỗng KHÔNG nghĩa là không ai giữ gì", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramHolderListIsLowerBound();
    expect(out).toContain("CẬN DƯỚI");
    expect(out).toContain("SAI");
  });

  it("vi: estimateUsable=false (unknownCount>0) PHẢI nói KHÔNG ĐÁNG TIN; true PHẢI khác hẳn", async () => {
    await i18n.changeLanguage("vi");
    const unusable = translateVramEstimateUsable(false, 3);
    const usable = translateVramEstimateUsable(true, 0);
    expect(unusable).toContain("KHÔNG ĐÁNG TIN");
    expect(unusable).toContain("3");
    expect(usable).not.toContain("KHÔNG ĐÁNG TIN");
    expect(usable).not.toBe(unusable);
  });

  it("vi: nonFiniteFields rỗng LÀ một câu trả lời (khác câu khi có ô bị chặn)", async () => {
    await i18n.changeLanguage("vi");
    const none = translateVramNonFiniteFields([]);
    const present = translateVramNonFiniteFields([{ path: "headroom.rawBytes", was: "-Infinity" }]);
    expect(none).not.toBe(present);
    expect(present).toContain("headroom.rawBytes");
    expect(present).toContain("-Infinity");
    expect(present).toContain("1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ RÀNG BUỘC 1/2/3/6 — BỀ MẶT BẨN THẬT: `owner`/`leaseKey`/`host` (tên hộ đến từ TIẾN TRÌNH
// KHÁC — Pha 3 sổ chung) VÀ `detail` (M-5, bàn giao CỨNG từ Task 2: "CHƯA LÀM SẠCH cho i18n").
// KHÔNG hàm làm sạch thứ hai: mọi giá trị đi qua ĐÚNG `stripInterpolationSyntax` (params bag qua
// `translateAppError`→`localizeParams`→`sanitizeAllParams`; `detail` nối SAU câu chính qua ĐÚNG cùng
// hàm export sẵn, xem `translateVramPreemptCommand`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("bề mặt bẩn thật — owner/leaseKey/host/detail không được vỡ i18n, không được cắt ngắn", () => {
  /** Tiền điều kiện THUẦN — không render — mirror hệt cách `errorCodes.vram.unit.test.ts` đã làm
   *  cho `stripInterpolationSyntax`: một vòng lặp/đệ quy ĐỒNG BỘ trong `i18n.t()` thì `timeout` của
   *  vitest KHÔNG cắt được (một luồng, không điểm nhả) — chứng minh BẤT ĐỘNG trước, render sau, là
   *  cách duy nhất chạy được biến thể tự huỷ mà không treo runner. */
  function assertInert(raw: string): void {
    const once = stripInterpolationSyntax(raw);
    expect(once).not.toMatch(/[{}$]/);
    expect(stripInterpolationSyntax(once)).toBe(once); // S(S(x)) === S(x)
  }

  /** [tên, payload, mẩu chữ PHẢI còn nguyên trong câu ra dạng CHỮ]. Biến thể 3 CHỈ trở thành cú
   *  pháp HỢP LỆ SAU một lượt quét thay-thế-mẫu (Pha 2B: `$$t(t(...)` → `$t(t(...)` → tự tham
   *  chiếu) — đúng lớp lỗi brief đòi, không chỉ biến thể ngây thơ (biến thể 1). */
  const VARIANTS: Array<[string, string, string]> = [
    ["1. cướp placeholder thật", "{$t({owner}}", "owner"],
    ["2. nối khoá i18n bất kỳ", "$$t(t(errors.generic)", "errors.generic"],
    [
      "3. TỰ THAM CHIẾU (chỉ hợp lệ SAU một lượt quét thay-thế-mẫu, treo tiến trình nếu quét kiểu đó)",
      "$$t(t(errors.VRAM_CMD_PREEMPT_RECLAIMED)",
      "errors.VRAM_CMD_PREEMPT_RECLAIMED",
    ],
  ];

  for (const [name, raw, residue] of VARIANTS) {
    it(`${name} — ở owner (preempt) ⇒ ở lại dạng CHỮ, câu vẫn dịch được`, { timeout: 5000 }, async () => {
      assertInert(raw);
      await i18n.changeLanguage("vi");
      const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: raw, detail: null });
      expect(out).not.toMatch(/[{}$]/);
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).toContain(residue);
    });

    it(`${name} — ở leaseKey (releaseStale) ⇒ ở lại dạng CHỮ`, { timeout: 5000 }, async () => {
      assertInert(raw);
      await i18n.changeLanguage("vi");
      const out = translateVramReleaseStaleCommand({
        outcome: "refused",
        reason: "process-not-proven-dead",
        leaseKey: raw,
        processKey: null,
        rowKind: null,
        durability: null,
      });
      expect(out).not.toMatch(/[{}$]/);
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).toContain(residue);
    });

    it(`${name} — ở host (retryDeferred) ⇒ ở lại dạng CHỮ`, { timeout: 5000 }, async () => {
      assertInert(raw);
      await i18n.changeLanguage("vi");
      const out = translateVramRetryDeferredCommand({
        outcome: "retry-armed",
        reason: null,
        owner: "cron:kb-sync",
        host: raw,
      });
      expect(out).not.toMatch(/[{}$]/);
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).toContain(residue);
    });

    it(`${name} — ★★ M-5 ở detail (bàn giao Task 2: "CHƯA LÀM SẠCH cho i18n") ⇒ ở lại dạng CHỮ`, { timeout: 5000 }, async () => {
      assertInert(raw);
      await i18n.changeLanguage("vi");
      const out = translateVramPreemptCommand({
        outcome: "failed",
        reason: "reclaimer-threw",
        owner: "gguf-model:x",
        detail: raw,
      });
      expect(out).not.toMatch(/[{}$]/);
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).toContain(residue);
    });
  }

  it("★ ràng buộc 3 — owner KHÔNG bị cắt ngắn (chỉ làm sạch {}$, không đụng độ dài)", async () => {
    await i18n.changeLanguage("vi");
    const longOwner = `gguf-model:${"x".repeat(500)}`;
    const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: longOwner, detail: null });
    expect(out).toContain(longOwner);
  });

  it("★ ràng buộc 2 — dữ liệu KHÔNG BAO GIỜ nằm trong defaultValue: reason KHÔNG có bản dịch vẫn KHÔNG được render như một TEMPLATE", async () => {
    await i18n.changeLanguage("vi");
    // reason chứa cú pháp i18next NHƯNG không khớp khoá dịch nào ⇒ phải rơi về RAW literal (qua
    // SENTINEL), không phải bị coi là defaultValue rồi diễn giải lại.
    const out = translateVramPreemptCommand({
      outcome: "refused",
      reason: "$t(errors.generic)",
      owner: "gguf-model:x",
      detail: null,
    });
    expect(out).not.toMatch(/[{}$]/);
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
  });
});
