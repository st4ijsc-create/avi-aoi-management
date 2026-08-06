/**
 * ★★★ Pha 4 — vá review TOÀN NHÁNH, **F1/I-1: HAI NÚT PHÁ HUỶ KHÔNG BẤM ĐƯỢC VỚI BẤT KỲ VAI NÀO.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — VÀ VÌ SAO NÓ KHÔNG PHẢI "CANH VIỆC CHƯA XẢY RA"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu sống đo được trên **cấu hình đang chạy** (`.env:568` `ACTUATION_STEPUP_2FA=true`):
 * `vramRouter.preempt` / `releaseStale` đứng trên `deployProcedure = actuationProcedure.use(
 * requireFreshTotp)`, và `requireFreshTotp` đọc `totpCode` **từ raw input** ⇒ thiếu nó thì lượt
 * bấm ĐẦU TIÊN của mọi phiên **luôn 403**. `VramBrokerPanel` không gửi `totpCode` và không dùng
 * `useStepUpOtp` — trong khi hook ĐÃ CÓ và **3 màn khác** đang dùng đúng khuôn đó.
 *
 * Hậu quả không dừng ở một nút hỏng: `onSuccess` là chỗ **DUY NHẤT** gọi
 * `translateVramPreemptCommand`/`translateVramReleaseStaleCommand`, nên nó là **nhánh không tới
 * được từ UI** ⇒ điều kiện ra #3 của Pha 4 (*"mọi ô có người đọc thật"*) thực ra là **5/8 câu**.
 * Cổng AST (ii) của Task 3 **thấy lời gọi** nhưng không người nào chạy được nó — đúng lớp "nhánh
 * chết" mà T5-B được dựng ra để đóng, tái xuất hiện một nấc sâu hơn.
 *
 * ⚠⚠ LƯỚI HỎI VỀ **CÁI NÓ PHẢI LÀ**, KHÔNG PHẢI "CÓ CHỨA CHỮ": mỗi lời gọi `.mutate(` của HAI
 * mutation phá huỷ **phải nằm trong** một callback của `stepUp.guard(...)` **và** túi tham số
 * **phải có** ô `totpCode`. Thêm một biến trung gian, một `?:`, hay gửi `totpCode` mà không mở
 * dialog đều làm nó **thôi LÀ** hình dạng ấy ⇒ ĐỎ. (Cùng kỷ luật N-2/N-5 của Task 4.)
 *
 * ⚠ VÌ SAO KHÔNG RENDER THẬT: bộ test `*.unit.test.ts` chạy ở môi trường **node** (xem
 * `vitest.config.ts` — jsdom chỉ dành cho `*.test.ts` phía client). Lưới AST là công cụ mà chính
 * Task 3/Task 4 đã dùng cho cổng (i)/(ii)/N-2/N-6 ở đúng file này — không cơ chế mới.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
const PANEL = join(TEST_DIR, "..", "components", "ai", "VramBrokerPanel.tsx");
const VRAM_ROUTER = join(TEST_DIR, "..", "..", "..", "server", "routers", "vramRouter.ts");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-3 (review TOÀN NHÁNH 2026-08-06) — **HAI NỬA CỦA BẤT BIẾN NAY ĐƯỢC GHÉP, LẦN ĐẦU.**
//
// ⚠⚠⚠ "AN TOÀN LÀ HỆ QUẢ CỦA MỘT THỨ KHÁC", LẦN THỨ TƯ.
// Bản trước của file này **chép tay** hai danh sách: `PHA_HUY = ["preempt","releaseStale"]` và
// `KHONG_STEP_UP = "retryDeferred"`, kèm một chú thích trỏ tới số dòng của `vramRouter.ts`. Tức
// nửa MÁY CHỦ của bất biến (*"thủ tục nào đứng sau `requireFreshTotp`"*) **chưa từng được ai đọc
// bằng máy** — nó là một câu văn xuôi.
// Đo được (đột biến **W3** của reviewer): nâng `retryDeferred` lên `deployProcedure` — một thay
// đổi trông giống *"siết cho chặt hơn"*, đúng chiều cả Pha 5 đang đi — làm nút *Thử lại ngay*
// **hiện và bấm được**, lượt bấm đầu tiên của mọi phiên trả **403**, và **không hộp thoại OTP nào
// bật lên** (panel cố ý không bọc step-up cho nút này vì `input` của nó không khai `totpCode`).
// Cổng của kế hoạch: **XANH**. Cổng đầy đủ: đúng **một** ca đỏ, và nó đỏ **như một tác dụng phụ**
// — câu lỗi của nó chỉ đường tới `preempt`, không tới `retryDeferred`.
//
// ⇒ Hai danh sách nay **SUY RA TỪ MÁY CHỦ**, và bất biến được phát biểu đủ **hai vế**:
//   ***∀ thủ tục p đứng sau `requireFreshTotp`: `input` của p PHẢI khai `totpCode`, VÀ mọi điểm gọi
//   `p.mutate(` ở panel PHẢI nằm trong `stepUp.guard(...)` và gửi `totpCode`. ∀ p KHÔNG đứng sau
//   nó: cả hai điều trên PHẢI SAI.***
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Sàn danh tính chain `requireFreshTotp` (`server/_core/trpc.ts`) — tên thủ tục dựng sẵn của hệ. */
const SAN_CO_STEP_UP = "deployProcedure";

/** Hình dạng máy chủ của MỘT mutation: sàn danh tính + `input` có khai `totpCode` không. */
interface HinhDangMayChu {
  readonly san: string;
  readonly khaiTotp: boolean;
}

/**
 * Đọc `vramRouter.ts`: khoá-router ⇒ (sàn, `input` khai `totpCode`?). **Chỉ mutation** — `query`
 * không có `.mutate(` nào ở panel nên nó nằm ngoài bất biến này.
 *
 * ⚠ Ô nào không leo được tới một sàn ⇒ vào `mu` (**ĐỎ**), không bỏ qua im lặng.
 */
function mutationCuaMayChu(nguon?: string): { anhXa: Record<string, HinhDangMayChu>; mu: string[] } {
  const ma = nguon ?? readFileSync(VRAM_ROUTER, "utf8");
  const sf = ts.createSourceFile(VRAM_ROUTER, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const objectCuaBien = new Map<string, ts.ObjectLiteralExpression>();
  const bien = new Map<string, string | null>(); // biến ⇒ gốc chuỗi của nó

  /** Tên các ô của một object literal, **mở** cả `...spread` trỏ tới một object khai ở tầng module. */
  const oCuaObject = (n: ts.Node, sau = 0): string[] => {
    if (sau > 4 || !ts.isObjectLiteralExpression(n)) return [];
    const ra: string[] = [];
    for (const p of n.properties) {
      if (ts.isSpreadAssignment(p)) {
        const g = ts.isIdentifier(p.expression) ? objectCuaBien.get(p.expression.text) : undefined;
        if (g !== undefined) ra.push(...oCuaObject(g, sau + 1));
        continue;
      }
      if (p.name !== undefined) ra.push(p.name.getText(sf).replace(/["']/g, ""));
    }
    return ra;
  };

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      if (ts.isObjectLiteralExpression(d.initializer)) objectCuaBien.set(d.name.text, d.initializer);
      bien.set(d.name.text, gocCuaChuoi(d.initializer));
    }
  }
  /** Leo ngược chuỗi biến tới định danh KHÔNG phải khai báo của file ⇒ đó là SÀN. */
  const san = (bd: string | null): string | null => {
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      if (!bien.has(cur)) return cur;
      cur = bien.get(cur) ?? null;
    }
    return null;
  };

  const anhXa: Record<string, HinhDangMayChu> = {};
  const mu: string[] = [];
  const di = (n: ts.Node): void => {
    const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "router" &&
      arg0 !== undefined &&
      ts.isObjectLiteralExpression(arg0)
    ) {
      for (const p of arg0.properties) {
        const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
          mu.push(`vramRouter.ts:${dong} — ô của router KHÔNG phải \`tên: <chuỗi thủ tục>\``);
          continue;
        }
        // Đi dọc chuỗi `X.input(...).mutation(...)`: tìm `.mutation(` và túi `input`.
        let laMutation = false;
        let khaiTotp = false;
        const doc = (x: ts.Node): void => {
          if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
            const ten = x.expression.name.text;
            if (ten === "mutation") laMutation = true;
            const a0 = x.arguments[0];
            // `.input(z.object({ … }))` — mở một nấc lời gọi để tới object literal.
            if (ten === "input" && a0 !== undefined) {
              const di2 = (y: ts.Node): void => {
                if (oCuaObject(y).includes("totpCode")) khaiTotp = true;
                ts.forEachChild(y, di2);
              };
              di2(a0);
            }
          }
          ts.forEachChild(x, doc);
        };
        doc(p.initializer);
        if (!laMutation) continue; // `query` — ngoài phạm vi step-up
        const s = san(gocCuaChuoi(p.initializer));
        if (s === null) {
          mu.push(`vramRouter.ts:${dong} \`${p.name.text}\` — KHÔNG leo được tới một sàn thủ tục`);
          continue;
        }
        anhXa[p.name.text] = { san: s, khaiTotp };
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { anhXa, mu };
}

const MAY_CHU = mutationCuaMayChu();
/** Mọi mutation đứng sau `requireFreshTotp` — **suy ra từ máy chủ**, không chép tay. */
const PHA_HUY: readonly string[] = Object.keys(MAY_CHU.anhXa).filter((k) => MAY_CHU.anhXa[k]?.san === SAN_CO_STEP_UP);
/** Mọi mutation **không** đứng sau nó: bọc step-up ở đây là gửi một khoá `.strict()` từ chối. */
const KHONG_STEP_UP: readonly string[] = Object.keys(MAY_CHU.anhXa).filter(
  (k) => MAY_CHU.anhXa[k]?.san !== SAN_CO_STEP_UP,
);

function ast(): ts.SourceFile {
  return ts.createSourceFile(PANEL, readFileSync(PANEL, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

interface LoiGoiMutate {
  readonly ten: string;
  readonly coTotpCode: boolean;
  readonly trongStepUpGuard: boolean;
}

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`preempt.mutate` → `preempt`). */
function gocCuaChuoi(n: ts.Node | undefined): string | null {
  let cur: ts.Node | undefined = n;
  for (;;) {
    if (cur === undefined) return null;
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return null;
  }
}

/** Có tổ tiên nào là lời gọi `stepUp.guard(...)` không — hỏi trên CÂY, không hỏi trên văn bản. */
function namTrongStepUpGuard(n: ts.Node, sf: ts.SourceFile): boolean {
  let cur: ts.Node | undefined = n.parent;
  while (cur !== undefined) {
    if (ts.isCallExpression(cur) && cur.expression.getText(sf) === "stepUp.guard") return true;
    cur = cur.parent;
  }
  return false;
}

function quetMutate(sf: ts.SourceFile): LoiGoiMutate[] {
  const ra: LoiGoiMutate[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "mutate") {
      const ten = gocCuaChuoi(n.expression.expression);
      if (ten !== null) {
        const a0 = n.arguments[0];
        const coTotpCode =
          !!a0 &&
          ts.isObjectLiteralExpression(a0) &&
          a0.properties.some((p) => p.name !== undefined && p.name.getText(sf).replace(/["']/g, "") === "totpCode");
        ra.push({ ten, coTotpCode, trongStepUpGuard: namTrongStepUpGuard(n, sf) });
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

describe("★★★ I-3 — NỬA MÁY CHỦ của bất biến step-up (suy ra từ `vramRouter.ts`, không chép tay)", () => {
  it("★★★ cầu chì — đọc được cả ba mutation và 0 ô mù (một danh sách rỗng làm mọi ca dưới thành chân lý rỗng)", () => {
    expect(MAY_CHU.mu.join("\n"), "một ô không leo được tới sàn là một ô KHÔNG AI CANH").toBe("");
    expect(Object.keys(MAY_CHU.anhXa).sort()).toEqual(["preempt", "releaseStale", "retryDeferred"]);
    expect(PHA_HUY.length, "phải có ít nhất hai lệnh đứng sau `requireFreshTotp`").toBeGreaterThanOrEqual(2);
    expect(KHONG_STEP_UP.length, "phải có ít nhất một lệnh KHÔNG đứng sau nó — nếu không, ca chiều-ngược là rỗng").toBeGreaterThanOrEqual(1);
  });

  it("★★★ ∀ thủ tục đứng sau `requireFreshTotp`: `input` của nó PHẢI khai `totpCode`", () => {
    /**
     * ⚠ Đây là **nửa bị bỏ quên** của I-3. Nâng sàn của một thủ tục lên `deployProcedure` mà không
     * thêm `totpCode` vào `input` ⇒ `requireFreshTotp` đọc raw input, không thấy mã, trả 403 —
     * **mãi mãi**, cho mọi vai, và panel không có đường nào gửi mã ấy lên.
     */
    const thieu = PHA_HUY.filter((k) => MAY_CHU.anhXa[k]?.khaiTotp !== true);
    expect(
      thieu.join(" · "),
      `thủ tục đứng trên \`${SAN_CO_STEP_UP}\` mà \`input\` KHÔNG khai \`totpCode\` ⇒ mọi lượt bấm 403 và KHÔNG hộp thoại OTP nào bật lên`,
    ).toBe("");
  });

  it("★★★ chiều NGƯỢC — ∀ thủ tục KHÔNG đứng sau `requireFreshTotp`: `input` KHÔNG được khai `totpCode`", () => {
    // ⚠ `z.object()` mặc định **strip**, nhưng một `input` khai `totpCode` ở sàn không đòi OTP là
    //   một lời hứa sai với người viết client: nó nói *"chỗ này có step-up"* trong khi không có.
    const thua = KHONG_STEP_UP.filter((k) => MAY_CHU.anhXa[k]?.khaiTotp === true);
    expect(thua.join(" · "), "`input` khai `totpCode` ở một sàn KHÔNG chain `requireFreshTotp`").toBe("");
  });
});

describe("★★★ F1 — hai nút PHÁ HUỶ của VramBrokerPanel phải đi qua step-up 2FA", () => {
  it("★★★ panel dùng ĐÚNG hook đã có (`useStepUpOtp`), không dựng dialog thứ hai", () => {
    const src = readFileSync(PANEL, "utf8");
    const sf = ast();
    // Hỏi trên AST: một `import` bị comment ra là biến mất khỏi cây, không lách được.
    let nhap = false;
    let goi = false;
    const di = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        if (n.moduleSpecifier.text.includes("StepUpOtpDialog")) nhap = true;
      }
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "useStepUpOtp") goi = true;
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(nhap, "phải nhập `useStepUpOtp` từ `@/components/security/StepUpOtpDialog`").toBe(true);
    expect(goi, "phải GỌI hook, không chỉ nhập nó").toBe(true);
    expect(src, "không được viết một dialog OTP thứ hai trong panel").not.toMatch(/InputOTP\b/);
  });

  it("★★★ CẢ HAI lệnh phá huỷ: `.mutate(` nằm TRONG `stepUp.guard(...)` VÀ gửi `totpCode`", () => {
    const goi = quetMutate(ast());
    for (const ten of PHA_HUY) {
      const cua = goi.filter((g) => g.ten === ten);
      expect(cua.length, `không tìm thấy lời gọi \`${ten}.mutate(\` nào — panel đã đổi hình dạng?`).toBeGreaterThan(0);
      for (const g of cua) {
        expect(
          g.trongStepUpGuard,
          `\`${ten}.mutate(\` KHÔNG nằm trong \`stepUp.guard\` ⇒ lượt bấm đầu tiên của mọi phiên = 403`,
        ).toBe(true);
        expect(
          g.coTotpCode,
          `\`${ten}.mutate(\` không gửi \`totpCode\` ⇒ \`requireFreshTotp\` trả FORBIDDEN INVALID_VALUE`,
        ).toBe(true);
      }
    }
  });

  it("★★ dialog OTP được RENDER (một lần) — guard mà không có dialog thì nút chỉ im lặng không làm gì", () => {
    const sf = ast();
    let render = 0;
    const di = (n: ts.Node): void => {
      if (ts.isJsxExpression(n) && n.expression !== undefined && n.expression.getText(sf) === "stepUp.dialog") render++;
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(render, "render `{stepUp.dialog}` đúng MỘT lần (khuôn của 3 màn đang chạy)").toBe(1);
  });

  it("★★ chiều NGƯỢC — thủ tục KHÔNG đứng sau `requireFreshTotp` KHÔNG được bọc step-up", () => {
    /**
     * ⚠ Không có ca này thì bản vá dễ trượt sang "bọc hết cho chắc", và một `input` không khai
     * `totpCode` sẽ nhận một khoá lạ ⇒ đổi một nút hỏng lấy một nút hỏng khác.
     */
    for (const ten of KHONG_STEP_UP) {
      const cua = quetMutate(ast()).filter((g) => g.ten === ten);
      expect(cua.length, `phải có lời gọi \`${ten}.mutate(\``).toBeGreaterThan(0);
      for (const g of cua) {
        expect(g.coTotpCode, `\`${ten}.input\` KHÔNG khai \`totpCode\` — gửi nó là gửi một khoá thừa`).toBe(false);
        expect(g.trongStepUpGuard, `sàn của \`${ten}\` KHÔNG chain \`requireFreshTotp\``).toBe(false);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ LƯỚI-CHO-LƯỚI CỦA NỬA MÁY CHỦ — I-3 phải ĐỎ dưới chính đột biến W3 của reviewer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ I-3 lưới-cho-lưới — đột biến W3 và họ hàng của nó", () => {
  const GOC = readFileSync(VRAM_ROUTER, "utf8");

  /**
   * ⚠⚠ Mẫu đột biến neo vào **TÊN SÀN** (`actuationProcedure`/`deployProcedure` — do `_core/trpc.ts`
   * sở hữu), **KHÔNG** vào tên biến thủ tục của `vramRouter`. Phép thử đã bắt được lỗi ngược lại:
   * neo vào tên biến thì một lượt **đổi tên hợp lệ** biến phép thay thành no-op ⇒ mutant **bằng**
   * bản gốc ⇒ ca *"phải ĐỎ"* đỏ **vì lý do sai**, và câu lỗi không nói *"bạn vừa đổi tên biến"*.
   */
  const doiSan = (tu: string, sang: string): string => {
    expect(GOC.split(`= ${tu}.use(`).length - 1, `\`= ${tu}.use(\` phải xuất hiện ĐÚNG một lần`).toBe(1);
    return GOC.replace(`= ${tu}.use(`, `= ${sang}.use(`);
  };

  it("★★★ W3 — nâng `retryDeferred` lên `deployProcedure` ⇒ nó vào PHA_HUY và THIẾU `totpCode` ⇒ ĐỎ", () => {
    const ma = doiSan("actuationProcedure", "deployProcedure");
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(GOC);
    const { anhXa, mu } = mutationCuaMayChu(ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa.retryDeferred).toEqual({ san: SAN_CO_STEP_UP, khaiTotp: false });

    const phaHuy = Object.keys(anhXa).filter((k) => anhXa[k]?.san === SAN_CO_STEP_UP);
    expect(phaHuy, "W3 kéo `retryDeferred` vào tập đòi OTP").toContain("retryDeferred");
    // ⚠ Câu lỗi phải chỉ ĐÍCH DANH `retryDeferred` — bản trước đỏ ở một ca chỉ đường tới `preempt`.
    expect(phaHuy.filter((k) => anhXa[k]?.khaiTotp !== true)).toEqual(["retryDeferred"]);
  });

  it("★★★ chiều còn lại — HẠ `preempt` xuống `actuationProcedure` (bỏ step-up) ⇒ ĐỎ ở chiều ngược", () => {
    const ma = doiSan("deployProcedure", "actuationProcedure");
    expect(ma).not.toBe(GOC);
    const { anhXa } = mutationCuaMayChu(ma);
    expect(anhXa.preempt?.san).toBe("actuationProcedure");
    const khongStepUp = Object.keys(anhXa).filter((k) => anhXa[k]?.san !== SAN_CO_STEP_UP);
    // `preempt` rơi khỏi tập step-up, nhưng `input` vẫn khai `totpCode` ⇒ chiều ngược ĐỎ.
    expect(khongStepUp.filter((k) => anhXa[k]?.khaiTotp === true)).toContain("preempt");
  });

  it("★★ bị BẮT: gỡ `totpCode` khỏi `input` của một lệnh phá huỷ (giữ nguyên sàn) ⇒ ĐỎ", () => {
    const ma = GOC.replace("const totp = { totpCode: z.string().max(16).optional() };", "const totp = {};");
    expect(ma).not.toBe(GOC);
    const { anhXa } = mutationCuaMayChu(ma);
    expect(anhXa.preempt).toEqual({ san: SAN_CO_STEP_UP, khaiTotp: false });
    expect(anhXa.releaseStale?.khaiTotp).toBe(false);
  });

  it("★★ KHÔNG BẮT NHẦM — `query` (mặt đọc) nằm NGOÀI bất biến step-up", () => {
    expect(Object.keys(MAY_CHU.anhXa), "`state` là `query` ⇒ không có `.mutate(` nào ở panel").not.toContain("state");
  });

  it("★★ KHÔNG BẮT NHẦM — ĐỔI TÊN BIẾN thủ tục ở máy chủ (dọn dẹp hợp lệ) ⇒ VẪN XANH", () => {
    /**
     * ⚠ Ca này được thêm vì một lượt đo **bắt được chính lưới này bắt nhầm**: khi mẫu đột biến neo
     * vào tên biến, một lượt đổi tên hợp lệ làm ba ca meta đỏ **vì lý do sai**. Bất biến thật chỉ
     * nói về **sàn** và **`input`**, nên đổi tên phải hoàn toàn vô hình.
     */
    const ten = /const\s+(\w+)\s*=\s*deployProcedure\.use\(/.exec(GOC)?.[1];
    expect(ten, "không đọc được tên biến thủ tục phá huỷ — vramRouter đổi hình dạng?").toBeDefined();
    // ⚠ Tên mới DẪN XUẤT từ tên cũ ⇒ phép đổi LUÔN là một thay đổi thật (xem ghi chú ở ca sinh đôi
    //   bên `vramCommandReach.role.unit.test.ts`).
    const ma = GOC.split(ten as string).join(`${ten as string}Doi`);
    expect(ma, "phép đổi tên phải là một thay đổi THẬT").not.toBe(GOC);
    const { anhXa, mu } = mutationCuaMayChu(ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa.preempt).toEqual({ san: SAN_CO_STEP_UP, khaiTotp: true });
    expect(anhXa.retryDeferred).toEqual({ san: "actuationProcedure", khaiTotp: false });
  });

  it("★★ KHÔNG BẮT NHẦM — mã sản xuất ở HEAD cho đúng hai tập, không giao nhau", () => {
    expect([...PHA_HUY].sort()).toEqual(["preempt", "releaseStale"]);
    expect([...KHONG_STEP_UP].sort()).toEqual(["retryDeferred"]);
    expect(PHA_HUY.filter((k) => KHONG_STEP_UP.includes(k))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ LƯỚI-CHO-LƯỚI — bốn hình dạng lách đều bị bắt bởi CHÍNH hai vị từ ở trên.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ lưới-cho-lưới — các hình dạng 'gần đúng' không được cho qua", () => {
  function chamTren(nguon: string): LoiGoiMutate[] {
    return quetMutate(ts.createSourceFile("t.tsx", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  }

  const LACH: Record<string, string> = {
    "nguyên văn lỗi F1 (không step-up, không totpCode)": "preempt.mutate({ owner: h.owner });",
    "gửi totpCode nhưng KHÔNG mở dialog": "preempt.mutate({ owner: h.owner, totpCode });",
    "mở dialog nhưng QUÊN gửi totpCode": "stepUp.guard(() => preempt.mutate({ owner: h.owner }));",
    "guard của một hook KHÁC": "otherStepUp.guard((totpCode) => preempt.mutate({ owner: h.owner, totpCode }));",
  };

  for (const [ten, nguon] of Object.entries(LACH)) {
    it(`bị BẮT: ${ten}`, () => {
      const g = chamTren(nguon).find((x) => x.ten === "preempt");
      expect(g, "lưới phải THẤY lời gọi").toBeDefined();
      expect(g!.trongStepUpGuard && g!.coTotpCode, `hình dạng lách phải bị bắt: ${nguon}`).toBe(false);
    });
  }

  it("chiều DƯƠNG — hình dạng ĐÚNG lọt qua (lưới không phải một cái cấm-tất-cả)", () => {
    const g = chamTren("stepUp.guard((totpCode) => preempt.mutate({ owner: h.owner, totpCode }));").find(
      (x) => x.ten === "preempt",
    );
    expect(g).toBeDefined();
    expect(g!.trongStepUpGuard && g!.coTotpCode).toBe(true);
  });
});
