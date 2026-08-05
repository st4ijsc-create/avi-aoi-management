/**
 * ★★★ Pha 4 Task 3 — CÂU CHỮ CHO 23 MÃ KẾT CỤC CỦA `vramCommands.ts` + phần "cần câu chữ giải
 * thích" của `vramReadModel.ts` (Pha 4 Task 1/Task 2, đã có ở `HEAD=84cabe67`, KHÔNG sửa ở đây).
 *
 * Hai hạng người đọc CÙNG một câu: người vận hành ("chuyện gì xảy ra, tôi làm gì tiếp") và AI Agent
 * ("lệnh này thi hành được không, và VÌ SAO không"). Một câu chỉ lặp lại mã bằng tiếng Việt
 * (`owner-not-in-local-ledger` → "chủ sở hữu không có trong sổ cục bộ") là THẤT BẠI — file này khoá
 * cả hai: (a) mọi literal của 3 union `Vram*CommandReason` + `rowKind`/`durability`/`scope`/outcome
 * có bản dịch THẬT (không phải fallback, không phải tiếng vọng của chính mã) — VÉT CẠN theo KIỂU
 * thật, không phải một danh sách chép tay (xem §C-2), (b) mỗi bản dịch mang đúng NỘI DUNG chỉ dẫn
 * hành động mà brief đòi.
 *
 * ⚠⚠⚠ ĐÍNH CHÍNH (review vòng 1, C-2) — bản đầu của file này canh "23/23" bằng một mảng
 * `REQUIRED_OUTCOME_CODES` CHÉP TAY từ brief, không có quan hệ KIỂU nào với `vramCommands.ts`.
 * Reviewer thêm `| "reclaimer-timed-out"` vào `VramPreemptCommandReason` mà KHÔNG dịch ⇒ MỌI CỔNG
 * XANH (93/93, key-parity 4/4, i18n:check 0, tsc 0), câu ra `"…THẤT BẠI: reclaimer-timed-out"`.
 * Nay: `import type` 3 union + kiểu `rowKind`/`durability`/`scope`/outcome trực tiếp từ
 * `vramCommands.ts` (test-only), dựng `Record<Union, …>` VÉT CẠN — union mọc thêm literal mà bảng
 * chưa khai ⇒ `tsc`/`npm run check:tests` ĐỎ TRƯỚC KHI CHẠY TEST NÀO. Đây là NGUỒN THẬT của "23 mã",
 * không phải một mảng song song.
 *
 * Cùng cách nạp i18n THẬT như `errorCodes.vram.unit.test.ts` (KHÔNG stub i18n.t) — stub là cách
 * nhanh nhất để xanh giả trong khi người dùng thấy khoá trần.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

// Test-only: KHÔNG import vào production `errorCodes.ts` (giữ đúng ranh giới mà chính file đó tự
// đặt: "KHÔNG import kiểu từ server/** — file này bundle vào client"). `import type` bị xoá hoàn
// toàn khỏi JS phát ra, nên không có coupling runtime nào — chỉ dùng để ép `tsc` vét cạn union.
import type {
  VramPreemptCommandReason,
  VramPreemptCommandOutcome,
  VramReleaseStaleCommandReason,
  VramReleaseStaleCommandResult,
  VramRetryDeferredCommandReason,
  VramRetryDeferredCommandResult,
  VramCommandScope,
} from "../../../server/services/vram/vramCommands";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});

// ★ I-2 — nhiều ca đổi ngôn ngữ sang một locale KHÔNG có bundle (để ép nấc fallback). Luôn trả về
// "vi" sau MỖI ca để không rò trạng thái ngôn ngữ sang ca sau.
afterEach(async () => {
  await i18n.changeLanguage("vi");
});

const LOCALES = ["vi", "en", "zh"] as const;

function hasUnresolvedPlaceholder(s: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(s);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ C-2 — CỔNG VÉT CẠN THEO KIỂU THẬT (không phải danh sách chép tay)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
type VramRowKind = NonNullable<VramReleaseStaleCommandResult["rowKind"]>;
type VramDurability = NonNullable<VramReleaseStaleCommandResult["durability"]>;
type VramScope = VramCommandScope["scope"];
type VramReleaseOutcome = VramReleaseStaleCommandResult["outcome"];
type VramRetryOutcome = VramRetryDeferredCommandResult["outcome"];

/** Bảy lý do `preempt` VÉT CẠN, ánh xạ luôn tới outcome THẬT mà mỗi lý do đó xảy ra (khớp
 *  `vramPreempt.ts`/`vramCommands.ts`: `no-bytes-freed`/`reclaimer-returned-false`/`reclaimer-threw`
 *  chỉ xảy ra ở `failed`; bốn lý do còn lại chỉ xảy ra ở `refused`). Một Record trên UNION THẬT là
 *  chính cổng vét cạn — thêm literal mới vào `VramPreemptCommandReason` mà quên khai ở đây ⇒ `tsc` đỏ. */
const PREEMPT_REASON_OUTCOME: Record<VramPreemptCommandReason, "failed" | "refused"> = {
  "owner-not-in-local-ledger": "refused",
  "production-never-preempted": "refused",
  "busy-in-use": "refused",
  "no-reclaimer-declared": "refused",
  "reclaimer-returned-false": "failed",
  "reclaimer-threw": "failed",
  "no-bytes-freed": "failed",
};
const RELEASE_STALE_REASONS_TRANSLATED: Record<VramReleaseStaleCommandReason, true> = {
  "shared-ledger-never-refreshed": true,
  "row-not-in-shared-ledger-replica": true,
  "own-row-local-ledger-is-authority": true,
  "process-not-proven-dead": true,
};
const RETRY_DEFERRED_REASONS_TRANSLATED: Record<VramRetryDeferredCommandReason, true> = {
  "unknown-background-host": true,
  "no-retry-mechanism-for-this-host": true,
  "host-not-running-in-this-process": true,
  "no-defer-chain-in-this-process": true,
  "defer-budget-exceeded": true,
};
const ROW_KIND_TRANSLATED: Record<VramRowKind, true> = {
  "sibling-lease": true,
  "shared-baseline": true,
};
const DURABILITY_TRANSLATED: Record<VramDurability, true> = {
  "queued-for-shared-ledger": true,
};
const SCOPE_TRANSLATED: Record<VramScope, true> = {
  "this-process-only": true,
};
// Ba outcome union — VÉT CẠN cả "refused"/"released" (KHÔNG có khoá riêng, xem docstring
// `errorCodes.ts`: câu thật nằm ở `reason`/`rowKind`+`durability`) để một outcome MỚI (vd
// "partially-reclaimed") cũng làm `tsc` đỏ, không lọt qua trong im lặng.
const PREEMPT_OUTCOMES_CONSIDERED: Record<VramPreemptCommandOutcome, true> = {
  reclaimed: true,
  failed: true,
  refused: true,
};
const RELEASE_OUTCOMES_CONSIDERED: Record<VramReleaseOutcome, true> = {
  released: true,
  refused: true,
};
const RETRY_OUTCOMES_CONSIDERED: Record<VramRetryOutcome, true> = {
  "retry-armed": true,
  refused: true,
};

describe("C-2 — cổng VÉT CẠN theo union thật: mọi literal của vramCommands.ts có bản dịch THẬT", () => {
  const cases: Array<[string, () => string]> = [
    ...Object.entries(PREEMPT_REASON_OUTCOME).map(([reason, outcome]): [string, () => string] => [
      `preempt reason=${reason}`,
      () =>
        translateVramPreemptCommand({
          outcome,
          reason,
          owner: "gguf-model:x",
          detail: null,
          detailTruncated: false,
          freedBytes: 0,
        }),
    ]),
    ...Object.keys(RELEASE_STALE_REASONS_TRANSLATED).map((reason): [string, () => string] => [
      `releaseStale reason=${reason}`,
      () =>
        translateVramReleaseStaleCommand({
          outcome: "refused",
          reason,
          leaseKey: "worker:1:1#2",
          processKey: "worker:1:1",
          rowKind: null,
          durability: null,
        }),
    ]),
    ...Object.keys(RETRY_DEFERRED_REASONS_TRANSLATED).map((reason): [string, () => string] => [
      `retryDeferred reason=${reason}`,
      () => translateVramRetryDeferredCommand({ outcome: "refused", reason, owner: "cron:kb-sync", host: "cron:kb-sync" }),
    ]),
    ...Object.keys(ROW_KIND_TRANSLATED).map((rowKind): [string, () => string] => [
      `rowKind=${rowKind}`,
      () =>
        translateVramReleaseStaleCommand({
          outcome: "released",
          reason: null,
          leaseKey: "worker:1:1#2",
          processKey: "worker:1:1",
          rowKind: rowKind as VramRowKind,
          durability: "queued-for-shared-ledger",
        }),
    ]),
    ...Object.keys(DURABILITY_TRANSLATED).map((durability): [string, () => string] => [
      `durability=${durability}`,
      () =>
        translateVramReleaseStaleCommand({
          outcome: "released",
          reason: null,
          leaseKey: "worker:1:1#2",
          processKey: "worker:1:1",
          rowKind: "sibling-lease",
          durability,
        }),
    ]),
    ...Object.keys(SCOPE_TRANSLATED).map((scope): [string, () => string] => [
      `scope=${scope}`,
      () => translateVramScope(scope as VramScope),
    ]),
  ];

  for (const locale of LOCALES) {
    for (const [name, render] of cases) {
      it(`${locale}: ${name} — dịch được, không placeholder thô, không tiếng vọng của chính mã`, async () => {
        await i18n.changeLanguage(locale);
        const out = render();
        expect(hasUnresolvedPlaceholder(out), out).toBe(false);
        expect(out).not.toMatch(/Infinity|NaN/);
        const code = name.split("=")[1] ?? name;
        expect(out.toLowerCase()).not.toBe(code.toLowerCase());
        expect(out.length).toBeGreaterThan(code.length);
      });
    }
  }

  it("outcome-level: reclaimed/failed(base)/retry-armed có bản dịch riêng, không tiếng vọng", async () => {
    await i18n.changeLanguage("vi");
    expect(
      translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: "x", detail: null, detailTruncated: false, freedBytes: 100 }),
    ).not.toBe("reclaimed");
    expect(
      translateVramPreemptCommand({ outcome: "failed", reason: null, owner: "x", detail: null, detailTruncated: false, freedBytes: 0 }),
    ).not.toBe("failed");
    expect(
      translateVramRetryDeferredCommand({ outcome: "retry-armed", reason: null, owner: "x", host: "cron:kb-sync" }),
    ).not.toBe("retry-armed");
  });

  // Bằng chứng BIÊN DỊCH: sự tồn tại của 3 bảng dưới đây (khai đủ MỌI literal của outcome union thật)
  // chính là cổng — nếu ai thêm một outcome mới vào `vramCommands.ts` mà quên khai, `tsc` đỏ trước
  // khi runner tới được dòng `expect` này.
  it("(bằng chứng biên dịch) 3 bảng *_OUTCOMES_CONSIDERED đã vét cạn theo kiểu thật", () => {
    expect(Object.keys(PREEMPT_OUTCOMES_CONSIDERED)).toHaveLength(3);
    expect(Object.keys(RELEASE_OUTCOMES_CONSIDERED)).toHaveLength(2);
    expect(Object.keys(RETRY_OUTCOMES_CONSIDERED)).toHaveLength(2);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ N-1 (review vòng 2, CHẶN) — ĐÍNH CHÍNH BẮT BUỘC: `Record<Union, …>` ở trên chứng minh một
  // literal CÓ TÊN TRONG MỘT BẢNG TEST, KHÔNG chứng minh nó CÓ BẢN DỊCH THẬT. Đo được: thêm
  // `"reclaimer-timed-out"` vào `VramPreemptCommandReason` làm `tsc` đỏ (đúng), nhưng PHẢN ỨNG TỰ
  // NHIÊN với lỗi đó — khai `"reclaimer-timed-out": "failed"` VÀO BẢNG mà KHÔNG dịch — làm MỌI CỔNG
  // XANH LẠI (115/115 · tsc 0 · i18n:check 0 · key-parity 4/4), ra câu `"…: reclaimer-timed-out"` —
  // ĐÚNG C-2 gốc, chỉ dịch đi một bước. Đối chứng nặng hơn: xoá `errors.reason.busy-in-use` (mã
  // ĐANG SỐNG) khỏi cả ba locale ⇒ không cổng nào biết.
  //
  // Vì sao ca kiểm runtime ở trên không bắt: thất bại thật là *mã NẰM TRONG khung câu*
  // (`"...bị TỪ CHỐI: <mã>"`), không phải *câu BẰNG mã* — luôn dài hơn, luôn khác `code.toLowerCase()`.
  //
  // ⇒ Cổng THẬT: hỏi "có bản dịch THẬT ở cả ba ngôn ngữ không" bằng `i18n.exists()` — KHÔNG suy luận
  // qua nội dung câu render. `fallbackLng: false` là CỐT LÕI: thiếu nó thì zh/en mượn vi rồi khai
  // "tồn tại" dù bundle của chính ngôn ngữ đó KHÔNG có khoá — cùng cơ chế F8 mà `translateAppError`
  // đã phải chặn (xem lịch sử đầu file `errorCodes.ts`).
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  it("N-1 — mọi literal reason/rowKind/durability PHẢI có bản dịch THẬT ở cả ba locale (i18n.exists, không suy qua nội dung câu)", () => {
    const reasonCodes = [
      ...Object.keys(PREEMPT_REASON_OUTCOME),
      ...Object.keys(RELEASE_STALE_REASONS_TRANSLATED),
      ...Object.keys(RETRY_DEFERRED_REASONS_TRANSLATED),
    ];
    for (const code of reasonCodes) {
      for (const locale of LOCALES) {
        expect(
          i18n.exists(`errors.reason.${code}`, { lng: locale, fallbackLng: false }),
          `errors.reason.${code} @${locale}`,
        ).toBe(true);
      }
    }
    for (const code of Object.keys(ROW_KIND_TRANSLATED)) {
      for (const locale of LOCALES) {
        expect(
          i18n.exists(`errors.vramRowKind.${code}`, { lng: locale, fallbackLng: false }),
          `errors.vramRowKind.${code} @${locale}`,
        ).toBe(true);
      }
    }
    for (const code of Object.keys(DURABILITY_TRANSLATED)) {
      for (const locale of LOCALES) {
        expect(
          i18n.exists(`errors.vramDurability.${code}`, { lng: locale, fallbackLng: false }),
          `errors.vramDurability.${code} @${locale}`,
        ).toBe(true);
      }
    }
  });
});

describe("nội dung PHẢI mang chỉ dẫn hành động, không chỉ dịch định danh (ví dụ đích danh của brief)", () => {
  it("vi: owner-not-in-local-ledger PHẢI nói tới TIẾN TRÌNH KHÁC + lệnh vram.preempt, không chỉ lặp lại tên mã", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({
      outcome: "refused",
      reason: "owner-not-in-local-ledger",
      owner: "gguf-model:qwen3-30b",
      detail: null,
      detailTruncated: false,
      freedBytes: 0,
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
      detailTruncated: false,
      freedBytes: 0,
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
      detailTruncated: false,
      freedBytes: 0,
    });
    expect(out).toContain("§5.2");
    expect(out).toContain("KHÔNG BAO GIỜ");
  });

  it("vi: host-not-running-in-this-process nói ĐÚNG hai tiến trình, VÀ (M-2) nói KHÔNG có đường ra lệnh qua API", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramRetryDeferredCommand({
      outcome: "refused",
      reason: "host-not-running-in-this-process",
      owner: "cron:kb-sync",
      host: "cron:kb-sync",
    });
    expect(out).toContain("worker");
    expect(out).toContain("KHÔNG NHÌN THẤY");
    // ★ M-2 (review vòng 1) — trước đây câu "Ra lệnh này ở đúng tiến trình worker" gợi ý một hành
    // động Agent KHÔNG thi hành được qua tRPC (không có cơ chế chọn tiến trình đích). Nay câu phải
    // NÓI THẲNG giới hạn đó và trỏ đúng chỗ (mặt đọc `reclaimable`).
    expect(out).toContain("KHÔNG có đường ra lệnh");
    expect(out).toContain("reclaimable");
  });

  it("vi: own-row-local-ledger-is-authority (M-2) nói KHÔNG có lệnh nào phơi ra cho việc đó qua API", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramReleaseStaleCommand({
      outcome: "refused",
      reason: "own-row-local-ledger-is-authority",
      leaseKey: "api:1:1#2",
      processKey: "api:1:1",
      rowKind: null,
      durability: null,
    });
    expect(out).toContain("KHÔNG có lệnh nào");
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

  it("★ M-3 (review vòng 1) — reclaimed: freedBytes=0 chọn khoá RIÊNG (đua cấp phát); freedBytes>0 KHÔNG dán lời cảnh báo đó", async () => {
    await i18n.changeLanguage("vi");
    const zero = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: "gguf-model:x", detail: null, detailTruncated: false, freedBytes: 0 });
    const nonzero = translateVramPreemptCommand({
      outcome: "reclaimed",
      reason: null,
      owner: "gguf-model:x",
      detail: null,
      detailTruncated: false,
      freedBytes: 17_000,
    });
    // Cả hai PHẢI nêu bằng chứng thật (leaseLeftLedger), không phải freedBytes — đúng bàn giao C-1
    // của Task 2 (Agent kiểm được lời khai bằng ô nào).
    expect(zero).toContain("leaseLeftLedger: true");
    expect(nonzero).toContain("leaseLeftLedger: true");
    // Chỉ nhánh freedBytes=0 mới nói về cơ chế đua — KHÔNG dán vào lượt bình thường.
    expect(zero).toContain("chen vào đúng lúc");
    expect(nonzero).not.toContain("chen vào đúng lúc");
    expect(zero).not.toBe(nonzero);
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
// ★★★ C-1 + I-1 (review vòng 1) — MỘT LỚP: tham số đặt CÓ ĐIỀU KIỆN, khuôn câu dùng VÔ ĐIỀU KIỆN.
// PROBE C của reviewer (`estimateUsable(false, null)`) + PROBE D (`releaseStale` released + 3 ô
// null) đo được `{{unknownCount}}`/`{{processKey}}`/`{{rowKind}}`/`{{durability}}`/`{{host}}` THÔ.
// Tích Descartes dưới đây — mọi trường nullable × mọi outcome hợp lệ của 3 hàm lệnh — là lưới THEO
// HÌNH DẠNG ĐẦU VÀO, không theo payload (bài học "lưới theo ĐƯỜNG THOÁT, không theo FILE").
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("C-1 + I-1 — tích Descartes: mọi trường nullable × outcome không để lọt placeholder thô", () => {
  it("C-1 — estimateUsable(false, null): unknownCount CHƯA HỎI (kịch bản hỏng thật của vramReadModel.ts)", async () => {
    for (const locale of LOCALES) {
      await i18n.changeLanguage(locale);
      const out = translateVramEstimateUsable(false, null);
      expect(hasUnresolvedPlaceholder(out), out).toBe(false);
      expect(out).toContain("?");
    }
  });

  const releaseStaleFieldCombos: Array<{
    processKey: string | null;
    rowKind: "sibling-lease" | "shared-baseline" | null;
    durability: string | null;
  }> = [
    { processKey: null, rowKind: null, durability: null },
    { processKey: "worker:1:1", rowKind: null, durability: null },
    { processKey: null, rowKind: "sibling-lease", durability: null },
    { processKey: null, rowKind: null, durability: "queued-for-shared-ledger" },
    { processKey: "worker:1:1", rowKind: "sibling-lease", durability: "queued-for-shared-ledger" },
  ];
  for (const outcome of ["released", "refused"] as const) {
    for (const combo of releaseStaleFieldCombos) {
      it(`I-1 — releaseStale outcome=${outcome} × processKey=${combo.processKey} rowKind=${combo.rowKind} durability=${combo.durability}`, async () => {
        const out = translateVramReleaseStaleCommand({
          outcome,
          reason: outcome === "refused" ? "process-not-proven-dead" : null,
          leaseKey: "worker:1:1#2",
          ...combo,
        });
        expect(hasUnresolvedPlaceholder(out), out).toBe(false);
        // ★ Đo được từ ĐỘT BIẾN của chính người thi hành (round 2): kiểm "không {{}} thô" KHÔNG đủ
        // — khi `paramOrUnknown()` trả `null` thay vì `"?"`, i18next hạ `{{x}}` thành RỖNG (không
        // phải placeholder thô), qua được `hasUnresolvedPlaceholder` mà vẫn SAI quy ước. Ở khuôn
        // `…_RELEASED` (nơi cả ba ô này thật sự được nội suy), một ô `null` PHẢI để lại "?" — nội
        // dung, không chỉ hình dạng.
        if (outcome === "released") {
          const expectedQuestionMarks =
            (combo.processKey === null ? 1 : 0) + (combo.rowKind === null ? 1 : 0) + (combo.durability === null ? 1 : 0);
          const questionMarksFound = (out.match(/\?/g) ?? []).length;
          expect(questionMarksFound, out).toBe(expectedQuestionMarks);
        }
      });
    }
  }

  for (const outcome of ["retry-armed", "refused"] as const) {
    for (const host of [null, "cron:kb-sync"] as const) {
      it(`I-1 — retryDeferred outcome=${outcome} × host=${host}`, async () => {
        const out = translateVramRetryDeferredCommand({
          outcome,
          reason: outcome === "refused" ? "unknown-background-host" : null,
          owner: "cron:kb-sync",
          host,
        });
        expect(hasUnresolvedPlaceholder(out), out).toBe(false);
        // Cùng lý do trên: `{{host}}` chỉ thật sự được nội suy ở khuôn `…_ARMED`.
        if (outcome === "retry-armed" && host === null) {
          expect(out, out).toContain("?");
        }
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ N-2 (review vòng 2, Minor) — 4 khoá "gốc" (không `_WITH_REASON`, `reason: null`) tồn tại
// theo M-4 để LÀM LƯỚI khi bất biến "reason luôn non-null khi thất bại/từ chối" vỡ trong tương lai
// — nhưng MỘT LƯỚI KHÔNG ĐƯỢC KIỂM là lưới sẽ hỏng đúng ngày nó được cần. Đột biến của reviewer
// (N5b: thêm `{{refusalCode}}` vào `VRAM_CMD_PREEMPT_REFUSED`) đo được **112/112 vẫn xanh** vì
// KHÔNG ca nào trước đây gọi 3 lệnh với `outcome: "refused"/"failed", reason: null` cho CẢ 4 khoá
// (`VRAM_CMD_PREEMPT_REFUSED`/`VRAM_CMD_RELEASE_STALE_REFUSED`/`VRAM_CMD_RETRY_DEFERRED_REFUSED`
// không render bao giờ; `VRAM_CMD_PREEMPT_FAILED` có render nhưng chỉ `.not.toBe("failed")`, không
// kiểm placeholder). Thêm 3 tổ hợp còn thiếu + xiết ca đã có.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("N-2 — 4 khoá phòng thủ (M-4) PHẢI được kiểm placeholder, không chỉ khai 'tồn tại để làm lưới'", () => {
  it("preempt outcome=refused, reason=null ⇒ không placeholder thô (khoá VRAM_CMD_PREEMPT_REFUSED, chưa từng render)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({ outcome: "refused", reason: null, owner: "x", detail: null, detailTruncated: false, freedBytes: 0 });
    expect(hasUnresolvedPlaceholder(out), out).toBe(false);
  });

  it("preempt outcome=failed, reason=null ⇒ không placeholder thô (khoá VRAM_CMD_PREEMPT_FAILED, trước chỉ kiểm .not.toBe)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({ outcome: "failed", reason: null, owner: "x", detail: null, detailTruncated: false, freedBytes: 0 });
    expect(hasUnresolvedPlaceholder(out), out).toBe(false);
  });

  it("releaseStale outcome=refused, reason=null ⇒ không placeholder thô (khoá VRAM_CMD_RELEASE_STALE_REFUSED, chưa từng render)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramReleaseStaleCommand({
      outcome: "refused",
      reason: null,
      leaseKey: "worker:1:1#2",
      processKey: null,
      rowKind: null,
      durability: null,
    });
    expect(hasUnresolvedPlaceholder(out), out).toBe(false);
  });

  it("retryDeferred outcome=refused, reason=null ⇒ không placeholder thô (khoá VRAM_CMD_RETRY_DEFERRED_REFUSED, chưa từng render)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramRetryDeferredCommand({ outcome: "refused", reason: null, owner: "x", host: null });
    expect(hasUnresolvedPlaceholder(out), out).toBe(false);
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
      const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: raw, detail: null, detailTruncated: false, freedBytes: 1 });
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
        detailTruncated: false,
        freedBytes: 0,
      });
      expect(out).not.toMatch(/[{}$]/);
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).toContain(residue);
    });
  }

  it("★ ràng buộc 3 — owner KHÔNG bị cắt ngắn (chỉ làm sạch {}$, không đụng độ dài)", async () => {
    await i18n.changeLanguage("vi");
    const longOwner = `gguf-model:${"x".repeat(500)}`;
    const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: longOwner, detail: null, detailTruncated: false, freedBytes: 1 });
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
      detailTruncated: false,
      freedBytes: 0,
    });
    expect(out).not.toMatch(/[{}$]/);
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-2 (review vòng 1) — NẤC FALLBACK là ĐƯỜNG THỨ HAI cho cùng giá trị (`translateAppError`
// trả `fallback` NGUYÊN VĂN khi khoá thiếu ở `activeLng` — kịch bản THẬT: bundle en/zh nạp `import()`
// ĐỘNG và hỏng vĩnh viễn khi offline, xem lịch sử dòng đầu `errorCodes.ts`). PROBE E của reviewer đo
// được `owner` THÔ nguyên cú pháp ở nấc này.
//
// ⚠⚠ ĐÍNH CHÍNH TỰ ĐO (khác bản đầu của khối này) — đổi `i18n.language` sang một MÃ NGÔN NGỮ không
// nằm trong `supportedLngs` (`['vi','en','zh']`, `client/src/i18n/index.ts`) KHÔNG ép được nấc
// fallback: cấu hình `nonExplicitSupportedLngs`/`fallbackLng: 'vi'` khiến i18next ÂM THẦM giải về
// một ngôn ngữ khác, nên `translateAppError` vẫn tìm THẤY khoá — ca kiểm "xanh" mà KHÔNG kiểm được
// gì (đo bằng chính đột biến của reviewer round 2: mutation bỏ `stripInterpolationSyntax` ở fallback
// vẫn 107/107 XANH với cách dựng cũ). Cách ép ĐÚNG: gỡ TOÀN BỘ bundle của một ngôn ngữ ĐANG được hỗ
// trợ (`i18n.removeResourceBundle`) — mọi khoá (kể cả các khoá `VRAM_CMD_*` vừa thêm) biến mất khỏi
// ĐÚNG `activeLng` đang tra ⇒ SENTINEL ⇒ `translateAppError` LUÔN rơi về `fallback`. Khôi phục ngay
// trong `finally` để không rò trạng thái sang ca sau (dùng lại đúng payload đã nạp ở `beforeAll`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("I-2 — nấc fallback của translateAppError không phát tán cú pháp i18next chưa sạch", () => {
  const viBundle = localeJson("../i18n/locales/vi.json");

  /** Chạy `fn` trong khi bundle "vi" KHÔNG tồn tại — buộc MỌI khoá về SENTINEL/fallback. Khôi phục
   *  bundle ngay cả khi `fn` ném, để không rò trạng thái sang ca test kế tiếp. */
  async function withMissingViBundle<T>(fn: () => T | Promise<T>): Promise<T> {
    await i18n.changeLanguage("vi");
    i18n.removeResourceBundle("vi", "translation");
    try {
      return await fn();
    } finally {
      i18n.addResourceBundle("vi", "translation", viBundle, true, true);
    }
  }

  it("(tiền đề) gỡ bundle THẬT SỰ ép translateAppError rơi về fallback — kiểm bằng một khoá KHÔNG bẩn trước", async () => {
    await withMissingViBundle(() => {
      const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: "clean-owner", detail: null, detailTruncated: false, freedBytes: 1 });
      // Không còn bundle ⇒ câu KHÔNG THỂ là bản dịch thật (thiếu "leaseLeftLedger: true" — cụm chỉ
      // xuất hiện trong khuôn i18n đã dịch, không xuất hiện trong fallback `${outcome}: ${owner}`).
      expect(out).not.toContain("leaseLeftLedger");
      expect(out).toBe("reclaimed: clean-owner");
    });
  });

  it("owner bẩn ở nấc fallback (preempt) ⇒ vẫn ở lại dạng CHỮ, không còn [{}$]", async () => {
    await withMissingViBundle(() => {
      const dirty = "$$t(t(errors.VRAM_CMD_PREEMPT_RECLAIMED)";
      const out = translateVramPreemptCommand({ outcome: "reclaimed", reason: null, owner: dirty, detail: null, detailTruncated: false, freedBytes: 1 });
      expect(out).not.toMatch(/[{}$]/);
      expect(out).toContain("errors.VRAM_CMD_PREEMPT_RECLAIMED");
    });
  });

  it("leaseKey bẩn ở nấc fallback (releaseStale) ⇒ vẫn sạch", async () => {
    await withMissingViBundle(() => {
      const dirty = "{$t({leaseKey}}";
      const out = translateVramReleaseStaleCommand({
        outcome: "refused",
        reason: "process-not-proven-dead",
        leaseKey: dirty,
        processKey: null,
        rowKind: null,
        durability: null,
      });
      expect(out).not.toMatch(/[{}$]/);
      expect(out).toContain("leaseKey");
    });
  });

  it("owner bẩn ở nấc fallback (retryDeferred) ⇒ vẫn sạch", async () => {
    await withMissingViBundle(() => {
      const dirty = "$$t(t(errors.generic)";
      const out = translateVramRetryDeferredCommand({ outcome: "retry-armed", reason: null, owner: dirty, host: "cron:kb-sync" });
      expect(out).not.toMatch(/[{}$]/);
      expect(out).toContain("errors.generic");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ (D) — skipOnVariables LÀ MỘT BẤT BIẾN CỦA REPO, KHÔNG PHẢI MẶC ĐỊNH MAY MẮN CỦA THƯ VIỆN
// (review vòng 1, §6). Mối lo #1 của bản đầu ("ghép sau khi dịch nên không thể treo") ĐÚNG KẾT LUẬN
// nhưng chỉ là MỘT NỬA lý do — nửa còn lại (thứ thật sự giữ cửa) là SENTINEL ở `defaultValue`
// (đã có ca kiểm) + `skipOnVariables: true` của i18next (TRƯỚC review vòng này: mặc định thư viện,
// KHÔNG ca nào của repo giữ). `client/src/i18n/index.ts` nay đặt `skipOnVariables: true` TƯỜNG
// MINH — ca dưới đây khoá cấu hình đó VÀ khoá hành vi THẬT của thư viện (gọi `i18n.t()` trực tiếp,
// KHÔNG qua `stripInterpolationSyntax`, để kiểm ĐÚNG lớp thư viện độc lập với lớp làm sạch của repo).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("(D) skipOnVariables — CHỐT bằng ca kiểm, không dựa vào mặc định của thư viện", () => {
  it("i18n.options.interpolation.skipOnVariables === true (client/src/i18n/index.ts)", () => {
    expect(i18n.options.interpolation?.skipOnVariables).toBe(true);
  });

  it("skipOnVariables chặn nesting từ một giá trị RAW (bỏ qua lớp làm sạch của repo, kiểm ĐÚNG lớp thư viện)", async () => {
    await i18n.changeLanguage("vi");
    // Gọi i18n.t() TRỰC TIẾP — KHÔNG qua stripInterpolationSyntax/translateAppError — để chứng minh
    // thư viện TỰ nó đã chặn, độc lập với mọi lớp làm sạch repo tự viết.
    const raw = i18n.t("errors.VRAM_CMD_PREEMPT_RECLAIMED", {
      owner: "$t(errors.VRAM_FIELD_HOLDER_LIST_LOWER_BOUND)",
      lng: "vi",
      fallbackLng: false,
    });
    expect(typeof raw).toBe("string");
    // Nội dung của khoá kia (chứa "CẬN DƯỚI") KHÔNG được nối vào câu — nếu skipOnVariables tắt,
    // i18next sẽ diễn giải $t(...) trong giá trị và nối nội dung khoá đó vào.
    expect(raw as string).not.toContain("CẬN DƯỚI");
    expect(raw as string).toContain("$t(errors.VRAM_FIELD_HOLDER_LIST_LOWER_BOUND)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Cổng (i) (review vòng 2, §5 mục 2) — "KHÔNG CÂU CHỮ VIẾT TAY" cho kết quả lệnh VRAM.
//
// Reviewer BÁC lời hoãn ban đầu ("canh việc chưa xảy ra") — hình dạng cổng này ĐÚNG dù XANH hôm nay
// (chưa consumer nào gọi `translateVram*Command`): nó không canh một sự kiện QUÁ KHỨ, nó canh một
// sự kiện SẼ XẢY RA — người sẽ vi phạm nó (Task 4/5 tự ghép `${outcome}: ${reason}` bằng tay thay vì
// gọi lớp dịch) chính là người lẽ ra phải cài nó, nên KHÔNG dừng lại tự hỏi có nên cài không. Cùng
// kỹ thuật quét tĩnh (`walkTsFiles`-style) mà `appErrorParamsCoverage.test.ts` đã dùng cho
// `server/routers/**`, áp cho `client/src/**` + `server/routers/vramRouter*` — không cơ chế mới.
//
// Phạm vi: template literal (backtick) chứa CẢ `outcome` LẪN một trong ba trường mô tả
// (`reason`/`rowKind`/`durability`) — chữ ký của "tự ghép một câu tóm tắt kết cục" thay vì gọi
// `translateVram*Command()`. `client/src/lib/errorCodes.ts` là lớp dịch CHÍNH THỨC nên được LOẠI TRỪ
// khỏi quét (đó chính là nơi phép ghép này HỢP LỆ — `${r.outcome}: ${stripInterpolationSyntax(r.owner)}`
// ở nấc fallback, không chạm `reason`/`rowKind`/`durability`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("cổng (i) — không câu chữ viết tay ghép outcome + reason/rowKind/durability ngoài errorCodes.ts", () => {
  const TEST_FILE_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
  const REPO_ROOT = join(TEST_FILE_DIR, "..", "..", "..");
  const ALLOWED_FILES = new Set([join(TEST_FILE_DIR, "errorCodes.ts")]);

  function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        out.push(...walkTsFiles(full));
        continue;
      }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  /** Chỉ `vramRouter*.ts` (không phải toàn bộ `server/routers/**`) — đúng phạm vi review nêu. */
  function vramRouterFiles(dir: string): string[] {
    return readdirSync(dir)
      .filter((n) => n.startsWith("vramRouter") && /\.ts$/.test(n) && !/\.test\.ts$/.test(n))
      .map((n) => join(dir, n));
  }

  it("không template literal nào ghép outcome + (reason|rowKind|durability) thành câu ngoài errorCodes.ts", () => {
    const candidateFiles = [
      ...walkTsFiles(join(REPO_ROOT, "client", "src")).filter((f) => !ALLOWED_FILES.has(f)),
      ...vramRouterFiles(join(REPO_ROOT, "server", "routers")),
    ];
    const violations: string[] = [];
    for (const file of candidateFiles) {
      const src = readFileSync(file, "utf8");
      if (!/\boutcome\b/.test(src)) continue; // lọc nhanh trước khi tách template literal (rẻ)
      // Tách template literal (backtick string) — đủ dùng cho mã hiện có (không có backtick lồng
      // trong biểu thức của các file này). `(?:[^`\\]|\\.)*` bắt cả ký tự escape.
      const templateLiteralRe = /`(?:[^`\\]|\\.)*`/g;
      let m: RegExpExecArray | null;
      while ((m = templateLiteralRe.exec(src))) {
        const literal = m[0];
        const hasOutcome = /\boutcome\b/.test(literal);
        const hasDescriptiveField = /\b(reason|rowKind|durability)\b/.test(literal);
        if (hasOutcome && hasDescriptiveField) {
          violations.push(`${file.replace(REPO_ROOT, "")}: ${literal.slice(0, 160)}`);
        }
      }
    }
    if (violations.length > 0) {
      console.error(`[cổng (i) — không câu chữ viết tay] ${violations.length} chỗ:\n` + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CỔNG (ii) (bàn giao Task 3 review vòng 2, §5 mục 2 — CÀI Ở TASK 4)
//
// *"Mỗi 1 trong 8 tên hàm `translateVram*` phải xuất hiện ≥ 1 lần trong kết quả (call-site THẬT,
// không phải định nghĩa)."* — Task 3 hoãn CÓ CHỦ ĐÍCH vì nó đỏ NGAY hôm đó theo cấu trúc (chưa có
// consumer nào); Task 4 nối `VramBrokerPanel` (⇐ `AIBrainDashboard`) và cài cổng.
//
// ⚠ NGUYÊN VĂN lệnh của brief (dịch sang quét tĩnh, cùng phạm vi/loại trừ, không nới một chữ nào):
//   grep -E "translateVram(Preempt|ReleaseStale|RetryDeferred)Command|translateVram(Scope|HostedHere|HolderListIsLowerBound|EstimateUsable|NonFiniteFields)" \
//     -r client/src --include="*.ts" --include="*.tsx" | grep -v "\.test\.ts" | grep -v "client/src/lib/errorCodes.ts"
//
// ⚠⚠ VÌ SAO LOẠI `errorCodes.ts`: đó là nơi ĐỊNH NGHĨA. Đếm nó là đếm chính cái đồng hồ rồi tuyên bố
// nó có kim — đúng thứ cả Task 4 tồn tại để chặn.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("cổng (ii) — mỗi hàm `translateVram*` có ≥1 CALL-SITE SẢN PHẨM trong client/src", () => {
  const TEST_FILE_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
  const CLIENT_SRC = join(TEST_FILE_DIR, "..");
  /** `grep -v "client/src/lib/errorCodes.ts"` — nơi ĐỊNH NGHĨA, không phải người tiêu thụ. */
  const EXCLUDED = new Set([join(TEST_FILE_DIR, "errorCodes.ts")]);

  const TAM_HAM = [
    "translateVramPreemptCommand",
    "translateVramReleaseStaleCommand",
    "translateVramRetryDeferredCommand",
    "translateVramScope",
    "translateVramHostedHere",
    "translateVramHolderListIsLowerBound",
    "translateVramEstimateUsable",
    "translateVramNonFiniteFields",
  ] as const;

  function walkClientFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walkClientFiles(full, out);
        continue;
      }
      // `--include="*.ts" --include="*.tsx"` + `grep -v "\.test\.ts"` (kể cả `.test.tsx`).
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !EXCLUDED.has(full)) out.push(full);
    }
    return out;
  }

  /**
   * ★★★ C-2 (review vòng 1) — **ĐẾM LỜI GỌI TRÊN CÂY CÚ PHÁP, KHÔNG ĐẾM CHUỖI.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠ Bản đầu của cổng này quét `readFileSync` + regex `translateVramX\s*\(`. Người review
   * **biến một lời gọi thành CHÚ THÍCH** ⇒ chuỗi vẫn còn nguyên trong văn bản ⇒ **119/119 XANH**
   * trong khi hàm ấy đã trở lại làm đồng hồ không kim. `tsc` không cứu vì `noUnusedLocals` TẮT.
   *
   * ⇒ Đổi **BẢN CHẤT** của phép hỏi, không vá regex: `ts.createSourceFile()` dựng AST, và **chú
   * thích KHÔNG PHẢI node của AST** — một lời gọi bị comment ra thì **biến mất khỏi cây**, không
   * cách nào lách. Ta đếm `CallExpression` mà `expression` là đúng định danh ấy (kể cả dạng
   * `ns.translateVramX(...)` qua `PropertyAccessExpression`).
   *
   * ⚠ Cổng này trả lời *"chương trình CÓ một lời gọi"*, vẫn **chưa** trả lời *"lời gọi ấy CHẠY"*
   * — repo có **0 file `*.test.tsx`** nên không có harness render nào. Khai thẳng giới hạn: ca
   * chứng minh nó chạy thật là nghiệm thu SỐNG (Task 5).
   */
  function demLoiGoiTrongAst(file: string, ten: string): number {
    const src = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /* .tsx */ ts.ScriptKind.TSX);
    let n = 0;
    const di = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const e = node.expression;
        if ((ts.isIdentifier(e) && e.text === ten) || (ts.isPropertyAccessExpression(e) && e.name.text === ten)) n++;
      }
      ts.forEachChild(node, di);
    };
    di(sf);
    return n;
  }

  it("★★★ cả 8/8 hàm có LỜI GỌI THẬT trên AST (chú thích không phải node ⇒ không lách được)", () => {
    const files = walkClientFiles(CLIENT_SRC);
    const thieu: string[] = [];
    const thay: Record<string, string[]> = {};
    for (const ten of TAM_HAM) {
      const hits = files.filter((f) => demLoiGoiTrongAst(f, ten) > 0).map((f) => f.replace(CLIENT_SRC, ""));
      thay[ten] = hits;
      if (hits.length === 0) thieu.push(ten);
    }
    if (thieu.length > 0) {
      console.error(
        `[cổng (ii)] ${thieu.length}/8 hàm dịch KHÔNG có LỜI GỌI sản phẩm — chúng là đồng hồ không kim: ` +
          thieu.join(", ") +
          ` (đã tìm thấy: ${JSON.stringify(thay)})`,
      );
    }
    expect(thieu).toEqual([]);
  });

  it("★★ (lưới cho chính lưới) một lời gọi BỊ COMMENT KHÔNG được tính — chứng minh cổng đọc AST, không đọc văn bản", () => {
    // Nguồn giả lập ĐÚNG cách người review đã lách: chuỗi còn nguyên trong văn bản, lời gọi thì không.
    const nguon = `
      import { translateVramScope } from "@/lib/errorCodes";
      export function X() {
        // return translateVramScope("this-process-only");
        /* translateVramScope("this-process-only"); */
        return "translateVramScope(\"this-process-only\")";
      }
    `;
    const sf = ts.createSourceFile("giả.tsx", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let n = 0;
    const di = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "translateVramScope") n++;
      ts.forEachChild(node, di);
    };
    di(sf);
    expect(nguon).toContain("translateVramScope("); // văn bản CÓ — regex cũ sẽ XANH GIẢ
    expect(n, "AST phải thấy 0 lời gọi: comment + chuỗi đều không phải CallExpression").toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ M-5 NỬA SAU — câu ghép PHẢI nói ra rằng `detail` đã bị cắt, và nó ĐỌC cờ chứ không ĐO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("M-5 nửa sau — `detailTruncated` là ô ĐỌC, không phải một phép đo thứ hai", () => {
  it("★★★ `detailTruncated: true` ⇒ câu NÓI RA rằng phần còn lại đã mất", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({
      outcome: "failed",
      reason: "reclaimer-threw",
      owner: "sidecar:vision",
      detail: "Z".repeat(400),
      detailTruncated: true,
      freedBytes: 0,
    });
    expect(out).toContain("CẮT");
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
  });

  it("★★★ CÙNG `detail` dài 400 nhưng cờ `false` ⇒ KHÔNG dán mẩu chữ đó — chứng minh câu ĐỌC cờ, không đo độ dài", async () => {
    await i18n.changeLanguage("vi");
    const chung = {
      outcome: "failed",
      reason: "reclaimer-threw",
      owner: "sidecar:vision",
      detail: "Z".repeat(400),
      freedBytes: 0,
    } as const;
    const catRoi = translateVramPreemptCommand({ ...chung, detailTruncated: true });
    const chuaCat = translateVramPreemptCommand({ ...chung, detailTruncated: false });
    // Nếu ai thay ô này bằng `r.detail.length === 400` thì HAI câu này bằng nhau ⇒ ca ĐỎ.
    expect(catRoi).not.toBe(chuaCat);
    expect(chuaCat).not.toContain("CẮT");
  });

  it("mẩu chữ đó có bản dịch THẬT ở cả ba locale (không rơi về fallback tiếng Anh)", () => {
    for (const locale of LOCALES) {
      expect(
        i18n.exists("errors.VRAM_CMD_PREEMPT_DETAIL_TRUNCATED", { lng: locale }),
        `${locale} thiếu khoá cắt-câu`,
      ).toBe(true);
    }
  });

  it("★ `detail: null` ⇒ không mẩu chữ nào, kể cả khi cờ bật (không có câu thì không có gì bị cắt)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateVramPreemptCommand({
      outcome: "reclaimed",
      reason: null,
      owner: "x",
      detail: null,
      detailTruncated: true,
      freedBytes: 1,
    });
    expect(out).not.toContain("CẮT");
  });
});
