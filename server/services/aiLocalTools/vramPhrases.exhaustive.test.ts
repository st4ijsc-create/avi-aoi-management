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
import { z } from "zod";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
import {
  argsWithAuthCtx,
  getTool,
  laOEnumNgonNguHienThi,
  listTools,
  type ToolExecContext,
  type ToolLang,
} from "./toolRegistry";
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
const NGUON_PHRASES = join(HERE, "vramPhrases.ts");
/** Gốc `server/` — §B đi tìm **người dùng bảng câu**, không tìm một file đã biết tên. */
const GOC_SERVER = join(HERE, "..", "..");

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
/**
 * ★ M-4 (review) — điểm render THỨ HAI: **mọi tham số RỖNG**. Nhiều ô thật sự là `""` khi chạy
 * (`blind`, `degraded`, `note`, `leaseKeyPart`, `ttlPart`), nên một khuôn mà **toàn bộ văn xuôi
 * nằm trong một mảnh tuỳ chọn** sẽ rỗng THẬT lúc chạy trong khi lượt render bằng nhãn vẫn xanh.
 * ⚠ Đây là phòng ngừa, không phải vá một lỗi đang có: người review đã đo toàn bảng ở hình dạng
 * này ⇒ 0/51 hỏng. Giữ nó để cửa ấy **đóng vĩnh viễn**, không chỉ tình cờ đóng.
 */
const thamRong = new Proxy({} as Tham, { get: () => "" }) as Tham;
const boNhan = (s: string): string => s.replace(/«p:[^»]*»/g, "");

function render(key: string, lang: ToolLang, tham: Tham = thamGia): string {
  const cum = (CAU as unknown as Record<string, Cum<Tham>>)[key];
  expect(typeof cum, `khoá "${key}" không có mục nào trong bảng CAU`).toBe("object");
  const khuon = cum[lang];
  expect(
    typeof khuon,
    `khoá "${key}" THIẾU bản "${lang}" — thêm nó vào \`ba(vi, en, zh)\` ở vramPhrases.ts`,
  ).toBe("function");
  return khuon(tham);
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

    it(`khoá "${key}" — M-4: cùng ba luật ấy khi MỌI THAM SỐ RỖNG (ô tuỳ chọn thật sự hay rỗng)`, () => {
      const vi = render(key, "vi", thamRong);
      const en = render(key, "en", thamRong);
      const zh = render(key, "zh", thamRong);
      for (const [l, s] of [
        ["vi", vi],
        ["en", en],
        ["zh", zh],
      ] as const) {
        expect(s.trim().length, `"${key}".${l} RỖNG khi tham số rỗng — văn xuôi đang nằm trong ô tuỳ chọn`).toBeGreaterThan(
          0,
        );
        expect(s, `"${key}".${l} không còn chữ cái nào khi tham số rỗng`).toMatch(/\p{L}/u);
      }
      expect(chiChuCaiAscii(en), `"${key}".en còn chữ cái phi-ASCII khi tham số rỗng`).toBe(true);
      expect(coHanTu(zh), `"${key}".zh mất hết Hán tự khi tham số rỗng`).toBe(true);
      expect(coLatinPhiAscii(vi), `"${key}".vi mất hết dấu khi tham số rỗng`).toBe(true);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §B — VÉT CẠN THEO NGUỒN ĐỘC LẬP: AST của `vramTools.ts` (mã sản xuất), không phải bảng khai
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ I-2 (review) — **§B TỪNG NEO VÀO MỘT FILE (`join(HERE,"vramTools.ts")`), VÀ ĐÓ LÀ LỚP LỖI
 * "LƯỚI THEO FILE, KHÔNG THEO ĐƯỜNG THOÁT" (đã tái diễn 12 lần trong chuỗi pha).**
 * Tách một phần `tomTat()` sang `vramTomTatPhu.ts` là làm cả bốn ca §B **mù**.
 * ⇒ Tập file được quét nay **SUY RA từ chính đồ thị nhập**: mọi file `.ts` không-test dưới
 * `server/` **nhập `vramPhrases`** đều là người dùng bảng câu, và đều bị soi. Không glob, không
 * danh sách tên — thêm một người dùng mới là **tự động** bị canh.
 */
function moiFileTs(goc: string, ra: string[] = []): string[] {
  for (const m of readdirSync(goc)) {
    if (m === "node_modules" || m === "dist" || m === "build" || m.startsWith(".")) continue;
    const p = join(goc, m);
    if (statSync(p).isDirectory()) moiFileTs(p, ra);
    // N-4: `.js`/`.mjs`/`.cjs`/`.tsx` cũng nhập được — bỏ chúng là để hở đúng một cửa.
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(m) && !m.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

/**
 * ★ N-4 (re-review) — nhận diện **mọi hình thức nhập** bảng câu, không chỉ `from "…"`:
 * `import … from`, `export … from` (**tái xuất**), `import("…")` động, `require("…")`.
 * ⚠ **Giới hạn CÒN LẠI, khai ra chứ không giấu:** một **chuỗi tái xuất gián tiếp** (file A tái xuất
 * `noi`/`cum` dưới tên khác, file B nhập từ A) vẫn vô hình — muốn đóng thì phải dựng đồ thị module
 * thật (`ts.Program`), đắt hơn nhiều lần giá trị nó mua ở phạm vi hôm nay. Ca *"tập file được soi
 * SUY RA từ đồ thị nhập"* ngay dưới là **cầu chì**: nó nổ nếu phép nhận diện này hỏng.
 */
const NHAP_BANG_CAU = /(?:from|import|require)\s*\(?\s*["'][^"']*\/vramPhrases(?:\.[a-z]+)?["']/;
/** N-4: người dùng có thể nằm ngoài `server/` — quét cả `shared/` và `scripts/`. */
const GOC_QUET = [GOC_SERVER, join(GOC_SERVER, "..", "shared"), join(GOC_SERVER, "..", "scripts")];
const NGUOI_DUNG_BANG_CAU: string[] = GOC_QUET.flatMap((g) => moiFileTs(g)).filter(
  (p) => !/\.(test|spec)\.[tj]sx?$/.test(p) && NHAP_BANG_CAU.test(readFileSync(p, "utf8")),
);

function cayCua(p: string): ts.SourceFile {
  return ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);
}

interface LoiGoiCau {
  ten: "noi" | "cum";
  key: string | null;
  /**
   * ★★★ N-1 (re-review) — **ĐỐI SỐ THỨ NHẤT: NGÔN NGỮ.** Bản trước §B **không bao giờ đọc
   * `arguments[0]`** — nó canh **KHOÁ**, không canh **NGÔN NGỮ** — nên `cum("en", "atProcess", …)`
   * đi lọt **3 file / 165 ca xanh, `tsc` 0 lỗi**, và sinh ra một mảnh tiếng Anh **nằm trong bản
   * `vi` và bản `zh`**.
   * ⚠ §C cũng mù, vì ba luật của nó là **TỒN TẠI trên toàn bản tóm tắt** (`zh` chỉ cần **một** Hán
   * tự, `vi` chỉ cần **một** dấu) ⇒ một mảnh **ASCII tiếng Anh** không vi phạm luật nào.
   * ⚠⚠ **Bất đối xứng đáng nhớ:** ghim `"vi"` thì `chiChuCaiAscii(en)` bắt được; ghim `"en"` thì
   * **mù** — lưới chặt một chiều, hở **đúng chiều dễ xảy ra hơn**. Ca dưới đóng **cả hai chiều**
   * bằng một luật PHẢI-LÀ, **không** dựa vào phép may ấy.
   */
  lang: string | null;
  o: string;
}

function quetLoiGoi(): { goi: LoiGoiCau[]; push: { n: ts.CallExpression; cay: ts.SourceFile; o: string }[]; ep: string[] } {
  const goi: LoiGoiCau[] = [];
  const push: { n: ts.CallExpression; cay: ts.SourceFile; o: string }[] = [];
  const ep: string[] = [];
  for (const p of NGUOI_DUNG_BANG_CAU) {
    const cay = cayCua(p);
    const nhan = (n: ts.Node) => `${relative(GOC_SERVER, p)}:L${cay.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ten = n.expression.text;
        if (ten === "noi" || ten === "cum") {
          const l = n.arguments[0];
          const a = n.arguments[1];
          goi.push({
            ten,
            // `null` = **KHÔNG PHẢI** một định danh trần ⇒ ca §B "đối số ngôn ngữ" đỏ.
            lang: l !== undefined && ts.isIdentifier(l) ? l.text : null,
            key: a !== undefined && ts.isStringLiteralLike(a) ? a.text : null,
            o: nhan(n),
          });
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push") {
        push.push({ n, cay, o: nhan(n) });
      }
      if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && /\bDong\b/.test(n.type.getText())) {
        ep.push(`${nhan(n)}: ${n.getText().slice(0, 60)}`);
      }
      ts.forEachChild(n, di);
    };
    di(cay);
  }
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

  it("★★★ I-2: tập file được soi SUY RA từ đồ thị nhập, không từ một tên file đã biết", () => {
    /**
     * ⚠ Ca này canh **chính cổng**: nếu phép tìm người-dùng-bảng-câu hỏng (đổi đường nhập, đổi tên
     * module) thì bốn ca dưới **im lặng xanh trên tập rỗng** — đúng lớp "glob rỗng ⇒ vitest im
     * lặng ⇒ cổng khai XANH" đã che 18 ca đỏ trong chuỗi pha này.
     */
    const ten = NGUOI_DUNG_BANG_CAU.map((p) => relative(GOC_SERVER, p));
    expect(ten.length, "không tìm thấy người dùng `vramPhrases` nào — cổng đang quét trên tập RỖNG").toBeGreaterThan(
      0,
    );
    expect(ten, "`vramTools.ts` phải nằm trong tập được soi").toContain(
      relative(GOC_SERVER, join(HERE, "vramTools.ts")),
    );
  });

  it("★★★ N-1: ĐỐI SỐ NGÔN NGỮ của mọi `noi(`/`cum(` PHẢI LÀ định danh `lang` — không ghim hằng", () => {
    /**
     * ⚠ Luật phát biểu **cái nó PHẢI LÀ** (`lang`), **không** liệt kê cái bị cấm (`"en"`, `"vi"`,
     * `"zh"`, một hằng, một hàm trả ngôn ngữ…). Nhờ thế nó đóng **cả hai chiều** ghim và mọi hình
     * dạng chưa ai nghĩ ra — đúng phép đảo lượng từ đã phải trả giá **sáu lần** trong Pha 5.
     * ⚠ "Lưới DẪN người ta tới đâu?" — đỏ ở đây chỉ có **một** bản vá đúng: chuyền `lang` xuống.
     * Không có cách "khai cho qua".
     */
    const ghim = goi.filter((g) => g.lang !== "lang");
    expect(
      ghim.map((g) => `${g.ten}(${g.lang ?? "<không phải định danh>"}, "${g.key}") @${g.o}`),
      "một mảnh câu bị ghim cứng ngôn ngữ ⇒ nó xuất hiện NGUYÊN VĂN trong cả ba bản dịch",
    ).toEqual([]);
  });

  it("★ mọi lời gọi `noi(`/`cum(` phải nêu khoá bằng CHUỖI NGUYÊN VĂN (nếu không, cổng dưới mù)", () => {
    /**
     * ⚠ Đây là mắt canh cho **chính cổng vét cạn**: nêu khoá bằng một BIẾN là đường lách hiển
     * nhiên — bảng khai và mã sản xuất vẫn "khớp" vì cổng không đọc được vế nào cả.
     */
    expect(goi.length, "không tìm thấy lời gọi `noi(`/`cum(` nào — cổng đang quét nhầm file").toBeGreaterThan(20);
    const bien = goi.filter((g) => g.key === null);
    expect(bien.map((g) => `${g.ten}@${g.o}`), "khoá phải là chuỗi nguyên văn").toEqual([]);
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
      for (const a of p.n.arguments) {
        if (!laMotDongDich(a)) hong.push(`${p.o}: ${a.getText().slice(0, 70)}`);
      }
    }
    expect(hong, "một dòng của bề mặt Agent không đi qua bảng câu ⇒ nó chỉ có MỘT ngôn ngữ").toEqual([]);
  });

  it("★★ người dùng bảng câu KHÔNG được ép kiểu sang `Dong` — đó là đường lách nhãn kiểu", () => {
    expect(ep).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §A-AST — I-3: THÂN MỖI HÀM KHUÔN **PHẢI LÀ** MỘT BIỂU THỨC CHUỖI. KHÔNG RẼ NHÁNH.
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Vá cho **RV-2** — đột biến của người review: rẽ nhánh **theo GIÁ TRỊ THAM SỐ** ngay trong ô
 * `en` (`p.stale === "true" ? <tiếng Việt> : <tiếng Anh>`) ⇒ **106/106 xanh, `tsc` sạch**, và
 * nhánh ấy **tới được thật** trên trạng thái thường gặp (bản sao sổ chung cũ).
 *
 * ⚠⚠ Vì sao §A **không thể** đóng nó bằng cách thêm ca: §A render mỗi khuôn tại **một điểm dữ
 * liệu**; tập giá trị tham số là **VÔ HẠN**. Thêm điểm render là **liệt kê**, và *"cái gì liệt kê
 * thì luôn có phần tử thứ N+1"* — bài học đã trả giá năm lần ở Pha 5, lần này ở nấc **điểm dữ
 * liệu**, không phải nấc khoá.
 * ⇒ Đảo lượng từ: phát biểu **cái thân hàm PHẢI LÀ** — một biểu thức chuỗi thuần (chuỗi · template
 * · nối `+` · đọc thuộc tính tham số). Mọi rẽ nhánh **phải** leo lên `vramTools.ts` và chọn giữa
 * **hai KHOÁ**, nơi §A soi được từng khoá một.
 * ⚠ "Lưới DẪN người ta tới đâu?" — đỏ ở đây dẫn thẳng tới khuôn `degradedYes`/`degradedNo`,
 * `unledgeredEstimateUsable`/`Unusable`, `beginFailures*`: tách thành hai khoá. Đó là bản vá ĐÚNG.
 */
const KIND_CHO_PHEP = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.ParenthesizedExpression,
]);

describe("★★★ §A-AST (I-3) — thân hàm khuôn PHẢI LÀ một biểu thức chuỗi thuần, KHÔNG rẽ nhánh", () => {
  const cayCau = cayCua(NGUON_PHRASES);

  /** Mọi lời gọi `ba(...)` — nguồn duy nhất sinh ra một cụm ba ngôn ngữ. */
  function moiKhuon(): { arrow: ts.ArrowFunction; o: string }[] {
    const ra: { arrow: ts.ArrowFunction; o: string }[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "ba") {
        for (const a of n.arguments) {
          if (ts.isArrowFunction(a)) {
            ra.push({ arrow: a, o: `L${cayCau.getLineAndCharacterOfPosition(a.getStart()).line + 1}` });
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(cayCau);
    return ra;
  }

  const khuon = moiKhuon();

  it("★ tìm được đủ khuôn để soi (nếu 0 thì mọi ca dưới xanh vì lý do sai)", () => {
    expect(khuon.length, "không thấy lời gọi `ba(` nào — cổng đang quét nhầm file").toBe(VRAM_PHRASE_KEYS.length * 3);
  });

  it("★★★ KHÔNG một khuôn nào rẽ nhánh (`? :` · `if` · `&&` · `||` · `??` · lời gọi hàm)", () => {
    const hong: string[] = [];
    for (const { arrow, o } of khuon) {
      if (ts.isBlock(arrow.body)) {
        hong.push(`${o}: thân là một KHỐI lệnh — phải là một biểu thức chuỗi`);
        continue;
      }
      const di = (n: ts.Node): void => {
        if (ts.isBinaryExpression(n)) {
          // ⚠ Chỉ đi vào HAI VẾ — `operatorToken` là một node con, và duyệt nó sẽ tự báo "PlusToken
          // không nằm trong tập cho phép", tức lưới kêu oan trên chính hình dạng nó cho phép.
          if (n.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
            hong.push(`${o}: toán tử ${ts.tokenToString(n.operatorToken.kind)} — chỉ được nối chuỗi bằng '+'`);
          }
          di(n.left);
          di(n.right);
          return;
        }
        if (!KIND_CHO_PHEP.has(n.kind)) {
          hong.push(`${o}: ${ts.SyntaxKind[n.kind]} — ${n.getText().slice(0, 50)}`);
          return;
        }
        ts.forEachChild(n, di);
      };
      di(arrow.body);
    }
    expect(
      hong,
      "một khuôn rẽ nhánh theo GIÁ TRỊ THAM SỐ ⇒ §A chỉ thấy MỘT nhánh; tách thành HAI KHOÁ ở vramTools.ts",
    ).toEqual([]);
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

  it("★★★ M-5: ĐƯỜNG CẮT phải KHAI ở CẢ BA ngôn ngữ (en/zh dài hơn vi ⇒ điểm cắt KHÁC NHAU)", async () => {
    /**
     * ⚠ Vì `en`/`zh` mang thêm mệnh đề hành động nên chúng **dài hơn `vi`** ⇒ với cùng một trạng
     * thái, người đọc `en` bị cắt **sớm hơn**. Trước ca này chỉ `vi` được nghiệm thu đường cắt
     * (`promptSafety.test.ts`) — tức một **lệch NỘI DUNG theo ngôn ngữ** không ai canh: người đọc
     * `en` nhận ít dòng hơn cho **cùng một sự thật**. Bất biến bắt buộc: cắt thì **phải KHAI**, ở
     * mọi ngôn ngữ — im lặng là thứ biến "phần còn lại" thành "toàn bộ".
     */
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica(
      Array.from({ length: 400 }, (_, i) =>
        hangAnhEm({ leaseKey: `worker:999:1#lease-${i}`, leaseId: `lease-${i}`, owner: `gguf:model-${i}` }),
      ),
      Date.now(),
      "api:100:1",
    );
    /** Lời khai đã cắt = mở bằng ⚠ **và** chỉ đường tới ảnh chụp đầy đủ. Ở cả ba ngôn ngữ. */
    const laLoiKhaiCat = (dong: string): boolean => dong.startsWith("⚠") && dong.includes("data.state");
    const soDong: Record<string, number> = {};
    for (const l of NGON_NGU) {
      const r = await chay(l);
      const dong = r.textSummary.split("\n");
      soDong[l] = dong.length;
      expect(r.textSummary.length, `${l}: vượt trần ngữ cảnh`).toBeLessThanOrEqual(16_400);
      expect(laLoiKhaiCat(dong[dong.length - 1]), `${l}: bị cắt mà KHÔNG khai — Agent đọc phần còn lại thành TOÀN BỘ`).toBe(
        true,
      );
    }
    // Đối chứng ÂM: trạng thái nhỏ ⇒ KHÔNG được khai là đã cắt (nếu không, "khai luôn" cũng xanh).
    __resetSharedLedgerForTests();
    for (const l of NGON_NGU) {
      const dong = (await chay(l)).textSummary.split("\n");
      expect(laLoiKhaiCat(dong[dong.length - 1]), `${l}: khai đã cắt trong khi KHÔNG cắt gì`).toBe(false);
    }
    expect(Object.keys(soDong).length).toBe(3);
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §E — 🔴 C-1: BÁN KÍNH CỦA PHÉP TIÊM `lang`, ĐO TRÊN **REGISTRY LÚC CHẠY**
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ VÌ SAO §E TỒN TẠI — **MỘT HỒI QUY ĐÃ XẢY RA, KHÔNG PHẢI MỘT RỦI RO LÝ THUYẾT.**
 * Vòng trước, vị từ tiêm là `Object.hasOwn(shape, "lang")` — **neo theo TÊN**. Hai tool
 * (`retrieve_programming_kb`, `lookup_error_code`, `readToolsProgramming.ts:455/:504`) có một ô
 * **trùng tên** nhưng khai `z.string().min(1).max(16)`, và nó là **BỘ LỌC KHO TÀI LIỆU**. Người
 * review đo trên kho thật: một câu hỏi tiếng Việt về mã lỗi servo ⇒ RAG tụt **91.678 → 237 chunk
 * (0,26%)** và trả **sai tài liệu**, trong khi `programmingTools.test.ts` **28/28 vẫn xanh**.
 *
 * ⚠⚠ Ca chính dưới đây là một **TƯƠNG ĐƯƠNG (⟺)** trên **toàn bộ registry lúc chạy** — không đếm
 * bằng `grep` (chính `grep z.enum` đã **bỏ sót đúng hai tool gây hại**), không liệt kê tên tool.
 * Hai ca sau nêu **đích danh** hai tool ấy: một lưới không gọi tên nạn nhân thì lần sau người đọc
 * log không biết mình vừa làm hỏng cái gì.
 */
describe("★★★ §E (C-1) — `lang` chỉ được tiêm vào ô **LÀ ENUM BA NGÔN NGỮ HIỂN THỊ**", () => {
  const phien = (lang: ToolLang): ToolExecContext => ({ user: { id: 7, role: "admin", name: "T" }, lang });
  const shapeCua = (t: { parameters?: unknown }): Record<string, unknown> =>
    ((t.parameters as { shape?: Record<string, unknown> })?.shape ?? {}) as Record<string, unknown>;

  /**
   * ⚠ N-3 (re-review) — **TÊN CA NÀY TỪNG NÓI QUÁ.** Nó gọi `laOEnumNgonNguHienThi` ở **cả hai
   * vế** (vế "phải tiêm" và vế mã sản xuất dùng), nên nó **KHÔNG kiểm được ĐỊNH NGHĨA** của vị từ:
   * một định nghĩa sai vẫn cho hai vế khớp nhau. Thứ nó **thật sự** khoá — và khoá đúng — là
   * **PHÉP NỐI**: `argsWithAuthCtx` phải quyết định bằng **chính vị từ ấy**, không bằng tên ô.
   * Nó **vẫn bắt đúng hồi quy C-1** (đột biến N1 nới về `hasOwn` ⇒ ca này đỏ).
   * ⇒ Thứ canh **định nghĩa** là ba ca dưới: hai ca ĐÍCH DANH/KHÔNG-BẮT-NHẦM (đối chứng ngoài) và
   * ca *"vị từ nói cái ô ấy PHẢI LÀ"* (17 hình dạng, hằng số viết tay).
   */
  it("★★★ PHÉP NỐI: `argsWithAuthCtx` quyết định bằng chính vị từ, không bằng TÊN ô (mọi tool đã đăng ký)", () => {
    const tools = listTools();
    expect(tools.length, "registry rỗng — cổng đang chạy trước khi tool kịp đăng ký").toBeGreaterThan(20);
    const lech: string[] = [];
    let soDuocTiem = 0;
    let soCoOLang = 0;
    for (const t of tools) {
      const shape = shapeCua(t);
      if (!Object.hasOwn(shape, "lang")) continue;
      soCoOLang += 1;
      const phaiTiem = laOEnumNgonNguHienThi(shape.lang);
      const ra = argsWithAuthCtx(t, {}, phien("zh")) as { lang?: unknown };
      const daTiem = Object.hasOwn(ra, "lang");
      if (daTiem !== phaiTiem) lech.push(`${t.name}: phảiTiêm=${phaiTiem} nhưng đãTiêm=${daTiem}`);
      if (daTiem) soDuocTiem += 1;
    }
    expect(lech, "một ô `lang` bị đối xử theo TÊN thay vì theo NGHĨA").toEqual([]);
    // Đối chứng DƯƠNG hai chiều: cổng không được xanh vì "không tiêm gì cả", cũng không vì "tiêm hết".
    expect(soCoOLang, "không tool nào có ô `lang` — cổng xanh vì lý do sai").toBeGreaterThan(20);
    expect(soDuocTiem, "không tool nào được tiêm ⇒ bản dịch lại thành mã chết").toBeGreaterThan(20);
    expect(soDuocTiem, "MỌI ô `lang` đều bị tiêm ⇒ vị từ vẫn đang neo theo TÊN").toBeLessThan(soCoOLang);
  });

  it("★★★ ĐÍCH DANH `readToolsProgramming` — hai tool KB KHÔNG được nhận `lang` (ô ấy LỌC KHO, không phải ngôn ngữ)", () => {
    for (const ten of ["retrieve_programming_kb", "lookup_error_code"]) {
      const t = getTool(ten);
      expect(t, `${ten} chưa đăng ký`).toBeTruthy();
      expect(
        laOEnumNgonNguHienThi(shapeCua(t!).lang),
        `${ten}.lang là z.string() (bộ lọc kho), KHÔNG phải enum ngôn ngữ hiển thị`,
      ).toBe(false);
      for (const l of NGON_NGU) {
        const ra = argsWithAuthCtx(t!, { query: "servo alarm", code: "AL.32" }, phien(l)) as { lang?: unknown };
        expect(
          Object.hasOwn(ra, "lang"),
          `${ten} bị tiêm lang="${l}" ⇒ RAG tụt từ 91.678 xuống ${l === "vi" ? "237" : "49"} chunk và trả SAI tài liệu`,
        ).toBe(false);
      }
    }
  });

  it("★★★ KHÔNG BẮT NHẦM — `get_vram_state` VẪN nhận `zh`/`en` (lợi ích của Task 4 còn nguyên)", () => {
    const t = getTool("get_vram_state")!;
    for (const l of NGON_NGU) {
      expect((argsWithAuthCtx(t, {}, phien(l)) as { lang?: string }).lang).toBe(l);
    }
  });

  it("★★★ N-2: KHÔNG có ÂM TÍNH GIẢ trong registry — ô nào XỬ SỰ như enum ba ngôn ngữ thì vị từ phải nói `true`", () => {
    /**
     * ⚠ Vị từ nhận diện theo **CẤU TRÚC** (`z.enum`/`z.nativeEnum`), nên `z.union([literal×3])` và
     * `z.preprocess(…, enum3)` là **âm tính giả** — cùng khái niệm, khác cách viết. Nới vị từ để
     * đuổi theo mọi cách viết là **liệt kê**, và luôn có cách viết thứ N+1.
     * ⇒ Ca này canh **HÀNH VI** thay vì cấu trúc: một ô nhận đúng `vi`/`en`/`zh` và từ chối mọi
     * thứ khác **PHẢI** được vị từ công nhận. Hôm nay 0 tool lệch; ngày ai đó viết `z.union`, ca
     * này đỏ và chỉ thẳng tới quy ước có tên ở `toolRegistry.ts`.
     * ⚠ Chiều hỏng là chiều **AN TOÀN** (không tiêm ⇒ rơi về `vi`), nên đây là **Minor được cưỡng
     * chế**, không phải một lỗ đang chảy.
     */
    const nhanBa = (o: unknown): boolean => {
      const s = o as { safeParse?: (v: unknown) => { success: boolean } };
      if (typeof s?.safeParse !== "function") return false;
      const nhan = ["vi", "en", "zh"].every((v) => s.safeParse!(v).success);
      const tuChoi = ["ja", "VI", "vi-VN", "x", "", "en_US"].every((v) => !s.safeParse!(v).success);
      return nhan && tuChoi;
    };
    const amTinhGia: string[] = [];
    for (const t of listTools()) {
      const shape = shapeCua(t);
      if (!Object.hasOwn(shape, "lang")) continue;
      if (nhanBa(shape.lang) && !laOEnumNgonNguHienThi(shape.lang)) amTinhGia.push(t.name);
    }
    expect(
      amTinhGia,
      'ô này XỬ SỰ như enum ba ngôn ngữ nhưng không được nhận ⇒ tool âm thầm rơi về "vi". ' +
        "Viết ô ngôn ngữ hiển thị bằng `z.enum`/`z.nativeEnum` (quy ước có tên ở toolRegistry.ts)",
    ).toEqual([]);
  });

  it("★★ vị từ nói cái ô ấy PHẢI LÀ — không phải 'ô nào từ chối một giá trị lạ'", () => {
    /**
     * ⚠ Một vị từ kiểu *"ô này có từ chối `ja` không"* cũng loại được hai tool KB hôm nay, nhưng
     * `z.string().length(2)` **chấp nhận** `ja` mà vẫn không phải ngôn ngữ hiển thị, và
     * `z.enum(["vi","en"])` **từ chối** `ja` mà cũng không phải. Ca này khoá đúng chỗ ấy.
     */
    expect(laOEnumNgonNguHienThi(z.enum(["vi", "en", "zh"]))).toBe(true);
    expect(laOEnumNgonNguHienThi(z.enum(["vi", "en", "zh"]).optional())).toBe(true);
    expect(laOEnumNgonNguHienThi(z.enum(["zh", "en", "vi"]).optional().default("vi"))).toBe(true);
    expect(laOEnumNgonNguHienThi(z.enum(["vi", "en"]).optional())).toBe(false);
    expect(laOEnumNgonNguHienThi(z.enum(["vi", "en", "zh", "ja"]).optional())).toBe(false);
    expect(laOEnumNgonNguHienThi(z.string().min(1).max(16).optional())).toBe(false);
    expect(laOEnumNgonNguHienThi(z.string().length(2).optional())).toBe(false);
    expect(laOEnumNgonNguHienThi(undefined)).toBe(false);
    // `z.nativeEnum` = CÙNG KHÁI NIỆM, khác cách viết ⇒ phải được nhận.
    expect(laOEnumNgonNguHienThi(z.nativeEnum({ vi: "vi", en: "en", zh: "zh" } as const))).toBe(true);
    /**
     * ⚠ N-2 — **HAI ÂM TÍNH GIẢ ĐƯỢC GHIM CÓ CHỦ Ý**, không phải bị bỏ quên. Chiều hỏng là chiều
     * AN TOÀN (không tiêm ⇒ rơi về `vi`). Ca *"KHÔNG có ÂM TÍNH GIẢ trong registry"* ở trên là thứ
     * cưỡng chế quy ước; hai dòng này chỉ **ghi lại sự thật** để lần sau ai đổi vị từ thì thấy ngay
     * mình đang đổi cái gì.
     */
    expect(laOEnumNgonNguHienThi(z.union([z.literal("vi"), z.literal("en"), z.literal("zh")]))).toBe(false);
  });
});
