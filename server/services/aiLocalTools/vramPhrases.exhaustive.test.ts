/**
 * ★★★ Pha 5 Task 4 (N10) — **CỔNG VÉT CẠN CỦA BỀ MẶT AGENT VRAM.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG CÓ MỘT DÒNG `i18n.exists(…, { fallbackLng: false })` NÀO Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bất biến mà `fallbackLng: false` bảo vệ là **"`zh` KHÔNG được lặng lẽ mượn `vi` rồi khai là có"**.
 * Repo này **không có i18next ở máy chủ** (`git grep 'from "i18next"' -- server/ shared/` ⇒ rỗng;
 * `client/src/i18n/index.ts` là mã **trình duyệt**: `i18next-browser-languagedetector` +
 * `./locales/vi.json?url`), và `textSummary` của tool được **nhồi thẳng vào prompt LLM Ở MÁY CHỦ**.
 * ⇒ Không có khoá i18next nào để `exists()` hỏi. Bất biến ấy được cưỡng chế **trực tiếp** ở §A dưới
 * đây bằng ba luật **PHẢI-LÀ** trên chính chuỗi đã render — chặt hơn `exists()`, vì `exists()` chỉ
 * trả lời *"có khoá không"* chứ không trả lời *"khoá ấy có phải tiếng Trung không"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ "LƯỚI NÀY DẪN NGƯỜI TA TỚI ĐÂU?"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phản ứng tự nhiên với một cổng vét cạn ngây thơ là **khai một khoá RỖNG** cho ngôn ngữ còn thiếu:
 * đủ khoá, cổng xanh, người đọc nhận một dòng cụt. §A vì thế **không hỏi "khoá có tồn tại không"**,
 * nó hỏi ba câu **PHẢI-LÀ** về nội dung đã render:
 *   (1) cả ba bản đều **có chữ** (sau khi bỏ mọi ô tham số) ⇒ khoá rỗng ĐỎ;
 *   (2) `en` **không chứa một chữ cái phi-ASCII nào** ⇒ chép nguyên câu tiếng Việt sang `en` ĐỎ,
 *       và chép tiếng Trung sang `en` cũng ĐỎ;
 *   (3) `zh` **phải có ít nhất một Hán tự** và `vi` **phải có ít nhất một chữ Latin phi-ASCII**
 *       ⇒ `zh` mượn `vi`, hay `vi` mượn `en`, đều ĐỎ.
 * Ba câu ấy phát biểu **cái mỗi bản PHẢI LÀ**, không liệt kê cái nó không được chứa — đúng phép
 * "đảo lượng từ" đã phải trả giá **năm lần** trong Pha 5.
 *
 * ⚠ §A áp cho **TOÀN BẢNG, không một miễn trừ nào**. Miễn trừ là chỗ phần tử thứ N+1 chui vào. Nó
 * áp được là nhờ luật phân công ở `vramPhrases.ts`: **văn xuôi ⇒ khoá · định danh/dữ liệu ⇒ tham
 * số**. Một khoá thuần kỹ thuật (`leaseKey=`) không tồn tại, vì thứ đó là **tham số**.
 *
 * ⚠⚠ §B đối chiếu bảng khai với một **NGUỒN ĐỘC LẬP**: quét AST của `vramTools.ts` (mã sản xuất).
 * Đây là bài học N14 — hai vế suy ra từ **cùng một bảng** thì đột biến đổi/xoá một mục **không làm
 * đỏ được gì**.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./vramTools";
/**
 * ⚠ NHẬP TĨNH, KHÔNG `await import()` trong thân ca — đồ thị nhập của `./index` (toàn bộ họ tool)
 * tốn vài giây và sẽ ăn hết ngân sách 5.000 ms của một ca dưới tải song song (đúng lớp flake đã
 * ghi hồ sơ cho `wiring.inprocess`). Nhập tĩnh đẩy chi phí sang pha COLLECT.
 */
import { tryExecuteTool } from "./index";
import { argsWithAuthCtx, getTool, type ToolExecContext, type ToolLang } from "./toolRegistry";
import { CAU, VRAM_PHRASE_KEYS, type Cum, type Tham } from "./vramPhrases";
import * as broker from "../vram/vramBroker";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
  type SharedLeaseRow,
} from "../vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../vram/vramTickCell";
import { __resetVramDeferForTests } from "../vram/vramDefer";
import { __resetVramBeginFailureState } from "../vram/vramWiring";

const MIB = 1024 * 1024;
const AUTH = { userId: 7, role: "admin" } as const;
const NGON_NGU: ToolLang[] = ["vi", "en", "zh"];

const HERE = dirname(fileURLToPath(import.meta.url));
const NGUON_TOOLS = join(HERE, "vramTools.ts");

// ── Ba vị từ PHẢI-LÀ, phát biểu trên LỚP KÝ TỰ (không trên mẫu, không trên danh sách cấm) ───────
/** Một chữ cái Latin **không** thuộc ASCII ⇒ dấu tiếng Việt (`ế`, `Ô`, `đ`, …). */
const coLatinPhiAscii = (s: string): boolean =>
  [...s].some((c) => /\p{Script=Latin}/u.test(c) && !/[A-Za-z]/.test(c));
/** Không một chữ cái phi-ASCII nào — kể cả Hán tự, kể cả dấu tiếng Việt. */
const chiChuCaiAscii = (s: string): boolean => [...s].every((c) => !/\p{L}/u.test(c) || /[A-Za-z]/.test(c));
const coHanTu = (s: string): boolean => /\p{Script=Han}/u.test(s);
/** Chữ cái hợp lệ cho bản `zh`: ASCII (tên trường máy đọc) hoặc Hán tự. Không có gì khác. */
const chuCaiHopLeChoZh = (s: string): boolean =>
  [...s].every((c) => !/\p{L}/u.test(c) || /[A-Za-z]/.test(c) || /\p{Script=Han}/u.test(c));

/**
 * Ô tham số được thay bằng một **nhãn nhìn thấy được** để (1) mọi khuôn render được mà không cần
 * bịa dữ liệu cho từng khoá, và (2) §A bóc nhãn ra rồi hỏi *"còn chữ nào không"* — đó là câu hỏi
 * giết được khoá rỗng.
 */
const NHAN = (k: string) => `«p:${k}»`;
const thamGia = new Proxy({} as Tham, { get: (_t, k) => NHAN(String(k)) }) as Tham;
const boNhan = (s: string): string => s.replace(/«p:[^»]*»/g, "");

function render(key: string, lang: ToolLang): string {
  const cum = (CAU as unknown as Record<string, Cum<Tham>>)[key];
  expect(typeof cum, `khoá "${key}" không có mục nào trong bảng CAU`).toBe("object");
  const khuon = cum[lang];
  expect(
    typeof khuon,
    `khoá "${key}" THIẾU bản "${lang}" — thêm nó vào \`ba(vi, en, zh)\` ở vramPhrases.ts`,
  ).toBe("function");
  return khuon(thamGia);
}

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §A — BẢNG CÂU: ba luật PHẢI-LÀ, áp cho TOÀN BẢNG, không miễn trừ
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §A bảng câu — mỗi khoá PHẢI có ba bản THẬT (không rỗng, không mượn nhau)", () => {
  it("bảng không rỗng và mọi khoá đều render được ở cả ba ngôn ngữ", () => {
    expect(VRAM_PHRASE_KEYS.length).toBeGreaterThan(30);
    for (const k of VRAM_PHRASE_KEYS) for (const l of NGON_NGU) expect(typeof render(k, l)).toBe("string");
  });

  for (const key of VRAM_PHRASE_KEYS) {
    it(`khoá "${key}" — (1) ba bản CÓ CHỮ · (2) en chỉ chữ ASCII · (3) zh có Hán tự, vi có dấu`, () => {
      const vi = render(key, "vi");
      const en = render(key, "en");
      const zh = render(key, "zh");

      // (1) KHÔNG RỖNG — đây là câu chặn phản ứng "khai một khoá rỗng cho xong".
      for (const [l, s] of [
        ["vi", vi],
        ["en", en],
        ["zh", zh],
      ] as const) {
        expect(
          boNhan(s).trim().length,
          `"${key}".${l} rỗng (hoặc chỉ có ô tham số) — một khoá rỗng là một dòng cụt cho Agent`,
        ).toBeGreaterThan(0);
        expect(boNhan(s), `"${key}".${l} không có một chữ cái nào`).toMatch(/\p{L}/u);
      }

      // (2) BA BẢN KHÁC NHAU — chép nguyên văn từ ngôn ngữ khác là "tồn tại" mà không "được dịch".
      expect(en, `"${key}".en TRÙNG NGUYÊN VĂN với .vi ⇒ chưa dịch`).not.toBe(vi);
      expect(zh, `"${key}".zh TRÙNG NGUYÊN VĂN với .vi ⇒ zh đang mượn vi`).not.toBe(vi);
      expect(zh, `"${key}".zh TRÙNG NGUYÊN VĂN với .en`).not.toBe(en);

      // (3) MỖI BẢN PHẢI LÀ CHÍNH NÓ.
      expect(chiChuCaiAscii(en), `"${key}".en còn chữ cái phi-ASCII (dấu tiếng Việt / Hán tự)`).toBe(true);
      expect(coHanTu(zh), `"${key}".zh không có một Hán tự nào ⇒ không phải bản tiếng Trung`).toBe(true);
      expect(chuCaiHopLeChoZh(zh), `"${key}".zh còn chữ cái Latin phi-ASCII (dấu tiếng Việt)`).toBe(true);
      expect(coLatinPhiAscii(vi), `"${key}".vi không có một dấu tiếng Việt nào ⇒ không phải bản tiếng Việt`).toBe(
        true,
      );
      expect(coHanTu(vi), `"${key}".vi lẫn Hán tự`).toBe(false);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §B — VÉT CẠN THEO NGUỒN ĐỘC LẬP: AST của `vramTools.ts` (mã sản xuất), không phải bảng khai
// ════════════════════════════════════════════════════════════════════════════════════════════════
const nguon = readFileSync(NGUON_TOOLS, "utf8");
const cay = ts.createSourceFile(NGUON_TOOLS, nguon, ts.ScriptTarget.Latest, true);

interface LoiGoiCau {
  ten: "noi" | "cum";
  key: string | null;
  dong: number;
}

function quetLoiGoi(): { goi: LoiGoiCau[]; push: ts.CallExpression[]; ep: ts.Node[] } {
  const goi: LoiGoiCau[] = [];
  const push: ts.CallExpression[] = [];
  const ep: ts.Node[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const ten = n.expression.text;
      if (ten === "noi" || ten === "cum") {
        const a = n.arguments[1];
        goi.push({
          ten,
          key: a !== undefined && ts.isStringLiteralLike(a) ? a.text : null,
          dong: cay.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        });
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "push"
    ) {
      push.push(n);
    }
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && /\bDong\b/.test(n.type.getText())) {
      ep.push(n);
    }
    ts.forEachChild(n, di);
  };
  di(cay);
  return { goi, push, ep };
}

/** Mọi LÁ của biểu thức đẩy vào mảng dòng PHẢI là một lời gọi `noi(`. Chỉ `? :` được nằm giữa. */
function laMotDongDich(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return laMotDongDich(e.expression);
  if (ts.isConditionalExpression(e)) return laMotDongDich(e.whenTrue) && laMotDongDich(e.whenFalse);
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "noi";
}

describe("★★★ §B vét cạn — bảng khai đối chiếu với NGUỒN ĐỘC LẬP (AST mã sản xuất)", () => {
  const { goi, push, ep } = quetLoiGoi();

  it("★ mọi lời gọi `noi(`/`cum(` phải nêu khoá bằng CHUỖI NGUYÊN VĂN (nếu không, cổng dưới mù)", () => {
    /**
     * ⚠ Đây là mắt canh cho **chính cổng vét cạn**: nêu khoá bằng một BIẾN là đường lách hiển
     * nhiên — bảng khai và mã sản xuất vẫn "khớp" vì cổng không đọc được vế nào cả.
     */
    expect(goi.length, "không tìm thấy lời gọi `noi(`/`cum(` nào — cổng đang quét nhầm file").toBeGreaterThan(20);
    const bien = goi.filter((g) => g.key === null);
    expect(bien.map((g) => `${g.ten}@L${g.dong}`), "khoá phải là chuỗi nguyên văn").toEqual([]);
  });

  it("★★★ TẬP KHOÁ DÙNG === TẬP KHOÁ KHAI (hai chiều: thiếu ⇒ đỏ, thừa ⇒ đỏ)", () => {
    const dung = new Set(goi.map((g) => g.key).filter((k): k is string => k !== null));
    const khai = new Set<string>(VRAM_PHRASE_KEYS);
    const thieu = [...dung].filter((k) => !khai.has(k)).sort();
    const thua = [...khai].filter((k) => !dung.has(k)).sort();
    expect(thieu, "khoá được DÙNG ở vramTools.ts nhưng KHÔNG KHAI ở vramPhrases.ts").toEqual([]);
    expect(thua, "khoá KHAI ở vramPhrases.ts nhưng KHÔNG AI DÙNG — bảng đang nói dối").toEqual([]);
  });

  it("★★★ MỌI dòng đẩy vào bản tóm tắt PHẢI LÀ một lời gọi `noi(` (không chuỗi trần, không nối chuỗi)", () => {
    expect(push.length, "không thấy `.push(` nào — cổng đang quét nhầm file").toBeGreaterThan(10);
    const hong: string[] = [];
    for (const p of push) {
      for (const a of p.arguments) {
        if (!laMotDongDich(a)) {
          hong.push(`L${cay.getLineAndCharacterOfPosition(a.getStart()).line + 1}: ${a.getText().slice(0, 70)}`);
        }
      }
    }
    expect(hong, "một dòng của bề mặt Agent không đi qua bảng câu ⇒ nó chỉ có MỘT ngôn ngữ").toEqual([]);
  });

  it("★★ `vramTools.ts` KHÔNG được ép kiểu sang `Dong` — đó là đường lách nhãn kiểu", () => {
    expect(ep.map((n) => n.getText().slice(0, 80))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §C — ĐƯỜNG THOÁT THẬT: registry → handler → `textSummary` (thứ được nhồi vào ngữ cảnh LLM)
// ════════════════════════════════════════════════════════════════════════════════════════════════
function tool() {
  const t = getTool("get_vram_state");
  if (!t || typeof t.handler !== "function") throw new Error("get_vram_state CHƯA đăng ký trong toolRegistry");
  return t;
}
const chay = async (lang?: ToolLang) => await tool().handler!({ __authCtx: AUTH, ...(lang ? { lang } : {}) });

function hangAnhEm(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "worker:999:1#lease-7",
    processKey: "worker:999:1",
    pid: 999,
    role: "worker",
    leaseId: "lease-7",
    owner: "gguf:qwen30b",
    leaseKind: "gguf-model",
    priority: "background",
    bytes: 17_000 * MIB,
    measured: true,
    refCount: 0,
    reclaimer: "gguf-idle-model",
    acquiredAtMs: 1,
    updatedAtMs: 1,
    ...over,
  };
}

/**
 * Dựng một trạng thái **chạm nhiều nhánh cùng lúc**: hộ cục bộ thu-hồi-được · hộ ANH EM (nhánh
 * `declared-by-owner-process`) · hộ nhận nuôi TTL quá hạn · sổ chung ĐÃ công bố · cả 6 hộ nền.
 * ⚠ Mọi dữ liệu đều ASCII **có chủ ý**: nếu ca dưới đỏ vì một dấu tiếng Việt thì đó là **khuôn
 * câu** chưa dịch, không phải dữ liệu — nếu không, ca này xanh/đỏ vì lý do sai.
 */
function dungCanh(): void {
  broker.reserve(
    { owner: "gguf:idle-30b", kind: "gguf-model", estimatedBytes: 900 * MIB, priority: "background", reclaimer: "gguf-idle-model" },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
  const lease = broker.adoptLease(
    { owner: "sidecar:orphan-pid-4242", kind: "external-process", estimatedBytes: 800 * MIB, priority: "interactive", ttlMs: 1_000, reclaimer: "orphan-pid" },
    800 * MIB,
    "adopt (test)",
  );
  (lease as { acquiredAt: Date }).acquiredAt = new Date(Date.now() - 60_000);
  __setSharedLedgerSelfKeyForTests("api:100:1");
  publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");
}

describe("★★★ §C đường thoát thật — cùng MỘT trạng thái, ba `lang` ⇒ ba bản tóm tắt KHÁC NHAU", () => {
  it("★★★ ba ngôn ngữ ⇒ ba chuỗi khác nhau, CÙNG số dòng (không nuốt, không bịa dòng)", async () => {
    dungCanh();
    const [vi, en, zh] = await Promise.all([chay("vi"), chay("en"), chay("zh")]);
    expect(en.textSummary).not.toBe(vi.textSummary);
    expect(zh.textSummary).not.toBe(vi.textSummary);
    expect(zh.textSummary).not.toBe(en.textSummary);
    const dong = (s: string) => s.split("\n").length;
    expect(dong(en.textSummary), "en lệch số dòng ⇒ có nhánh chỉ chạy ở một ngôn ngữ").toBe(dong(vi.textSummary));
    expect(dong(zh.textSummary)).toBe(dong(vi.textSummary));
    expect(dong(vi.textSummary)).toBeGreaterThan(12);
  });

  it("★★★ `lang=en` ⇒ KHÔNG một chữ cái phi-ASCII nào trong toàn bản tóm tắt (không rớt về vi)", async () => {
    dungCanh();
    const r = await chay("en");
    const la = [...r.textSummary].filter((c) => /\p{L}/u.test(c) && !/[A-Za-z]/.test(c));
    expect([...new Set(la)].join(""), "ký tự tiếng Việt/Hán còn sót ⇒ một khuôn câu chưa dịch").toBe("");
  });

  it("★★★ `lang=zh` ⇒ có Hán tự và KHÔNG một dấu tiếng Việt nào", async () => {
    dungCanh();
    const r = await chay("zh");
    expect(coHanTu(r.textSummary)).toBe(true);
    const viet = [...r.textSummary].filter((c) => /\p{Script=Latin}/u.test(c) && !/[A-Za-z]/.test(c));
    expect([...new Set(viet)].join(""), "zh đang mượn vi ở ít nhất một dòng").toBe("");
  });

  it("★★★ TỪNG DÒNG một: dòng thứ i của en/zh phải KHÁC dòng thứ i của vi", async () => {
    /**
     * ⚠ Đây là mắt bắt *"thêm một câu mới không dịch"* **ở nhánh đang chạy**: một dòng chưa qua
     * bảng câu sẽ giống hệt nhau ở cả ba ngôn ngữ, và ca so-cả-chuỗi ở trên vẫn xanh vì các dòng
     * khác đã khác. Nhánh KHÔNG chạy trong ca này do §B canh (mọi `.push` phải là `noi(`).
     */
    dungCanh();
    const [vi, en, zh] = await Promise.all([chay("vi"), chay("en"), chay("zh")]);
    const V = vi.textSummary.split("\n");
    const E = en.textSummary.split("\n");
    const Z = zh.textSummary.split("\n");
    const trung: string[] = [];
    for (let i = 0; i < V.length; i++) {
      if (E[i] === V[i]) trung.push(`en#${i + 1}: ${V[i].slice(0, 60)}`);
      if (Z[i] === V[i]) trung.push(`zh#${i + 1}: ${V[i].slice(0, 60)}`);
    }
    expect(trung, "dòng giống hệt vi ⇒ dòng đó chưa có bản dịch").toEqual([]);
  });

  it("★★ `title` và câu TỪ CHỐI cũng đủ ba ngôn ngữ (bề mặt từ chối là bề mặt Agent đọc nhiều nhất)", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const [vi, en, zh] = await Promise.all([chay("vi"), chay("en"), chay("zh")]);
    for (const r of [vi, en, zh]) expect(r.note).toBe("PERMISSION_DENIED");
    expect(new Set([vi.title, en.title, zh.title]).size, "title chỉ có một bản").toBe(3);
    expect(new Set([vi.textSummary, en.textSummary, zh.textSummary]).size).toBe(3);
    expect(chiChuCaiAscii(en.textSummary)).toBe(true);
    expect(coHanTu(zh.textSummary)).toBe(true);
  });

  it("★★ số MiB theo ĐÚNG dấu nhóm của ngôn ngữ (13.000 ≠ 13,000 — một con số đọc sai là một câu sai)", async () => {
    dungCanh();
    const [vi, en] = await Promise.all([chay("vi"), chay("en")]);
    expect(vi.textSummary).toMatch(/\d\.\d{3} MiB/);
    expect(en.textSummary).toMatch(/\d,\d{3} MiB/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §D — NGÔN NGỮ PHIÊN CÓ TỚI ĐƯỢC TOOL KHÔNG? (đi từ CÂU HỎI, không tự tiêm `lang`)
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ VÌ SAO §D TỒN TẠI, VÀ VÌ SAO §C KHÔNG THAY ĐƯỢC NÓ.
 * Mọi ca §A/§B/§C **tự đặt `lang`** vào tham số — tức tự tiêm đúng thứ mà **mã sản xuất có thể
 * không bao giờ đặt**. Đó chính xác là lớp lỗi đã để `buildVramAgentState()` thành **mã chết** trên
 * đường Agent ở Pha 4 (`vramTools.test.ts` ghi hồ sơ: mọi ca vòng 1 tự tiêm `__authCtx`).
 * ⇒ Ca dưới đi **từ câu hỏi**, qua `tryExecuteTool()` THẬT, và chỉ đưa `lang` qua **`execCtx`** —
 * đúng chỗ `aiChatRouter` đặt nó. Gỡ phép chuyển tiếp `lang` ở `argsWithAuthCtx` ⇒ ĐỎ.
 */
describe("★★★ §D `execCtx.lang` PHẢI tới được read tool — nếu không, 51 khoá × 3 bản là MÃ CHẾT", () => {
  const phien = (lang: ToolLang): ToolExecContext => ({
    user: { id: 7, role: "admin", name: "Tester" },
    lang,
  });

  it("★★★ hỏi với phiên `zh` ⇒ bản tóm tắt là TIẾNG TRUNG (không rớt về vi)", async () => {
    dungCanh();
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, phien("zh"));
    expect(r.result, "bộ phân loại ý định phải chọn get_vram_state cho câu này").not.toBeNull();
    expect(coHanTu(r.result!.textSummary), "phiên zh nhưng tool trả về không một Hán tự nào").toBe(true);
    const viet = [...r.result!.textSummary].filter((c) => /\p{Script=Latin}/u.test(c) && !/[A-Za-z]/.test(c));
    expect([...new Set(viet)].join(""), "phiên zh vẫn nhận dấu tiếng Việt ⇒ lang không tới được tool").toBe("");
  });

  it("★★★ hỏi với phiên `en` ⇒ KHÔNG một chữ cái phi-ASCII nào", async () => {
    dungCanh();
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, phien("en"));
    expect(r.result).not.toBeNull();
    expect(chiChuCaiAscii(r.result!.textSummary)).toBe(true);
  });

  it("★★ phiên `vi` vẫn ra tiếng Việt — đối chứng DƯƠNG (không phải một phép 'đổi hết sang en')", async () => {
    dungCanh();
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, phien("vi"));
    expect(r.result).not.toBeNull();
    expect(coLatinPhiAscii(r.result!.textSummary)).toBe(true);
    expect(coHanTu(r.result!.textSummary)).toBe(false);
  });

  it("★★ `lang` HỢP LỆ do người sản xuất args nêu được GIỮ; `lang` rác bị phiên ghi đè", () => {
    /**
     * ⚠ Khác `__authCtx` một cách CÓ CHỦ ĐÍCH — ngôn ngữ không phải một biên an ninh. Ca này khoá
     * đúng sự khác biệt ấy để không ai "đồng bộ hoá" hai luật rồi làm mất một trong hai.
     */
    const t = getTool("get_vram_state")!;
    expect((argsWithAuthCtx(t, { lang: "en" }, phien("zh")) as { lang?: string }).lang).toBe("en");
    expect((argsWithAuthCtx(t, { lang: "klingon" }, phien("zh")) as { lang?: string }).lang).toBe("zh");
    expect((argsWithAuthCtx(t, {}, phien("zh")) as { lang?: string }).lang).toBe("zh");
    // Chiều NGƯỢC LẠI của `__authCtx`: đầu vào KHÔNG BAO GIỜ là nguồn danh tính.
    const bia = argsWithAuthCtx(t, { __authCtx: { userId: 999, role: "superadmin" } }, phien("vi"));
    expect((bia as { __authCtx: { userId: number } }).__authCtx.userId).toBe(7);
  });

  it("★★ tool KHÔNG khai `lang` trong schema thì KHÔNG bị nhét thêm khoá lạ (mọi schema đều `.strict()`)", () => {
    const gia = { name: "x", parameters: { shape: { foo: {} } } } as unknown as Parameters<typeof argsWithAuthCtx>[0];
    expect(argsWithAuthCtx(gia, { foo: 1 }, phien("zh"))).toEqual({ foo: 1 });
  });
});
