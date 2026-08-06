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

/** HAI lệnh đứng trên `deployProcedure` (⇒ `requireFreshTotp`). Đọc từ `vramRouter.ts:92,102`. */
const PHA_HUY = ["preempt", "releaseStale"] as const;
/**
 * `retryDeferred` đứng trên `actuationProcedure` — **KHÔNG** `requireFreshTotp` — và `input` của nó
 * KHÔNG khai `totpCode` (`z.object().strict()`). Bọc nó vào step-up là gửi một khoá bị từ chối.
 */
const KHONG_STEP_UP = "retryDeferred";

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

  it("★★ chiều NGƯỢC — `retryDeferred` KHÔNG được bọc step-up (sàn khác, `input` KHÔNG khai `totpCode`)", () => {
    /**
     * ⚠ Không có ca này thì bản vá dễ trượt sang "bọc hết cho chắc", và `z.object().strict()` của
     * `retryDeferred` sẽ **từ chối** khoá lạ ⇒ đổi một nút hỏng lấy một nút hỏng khác.
     */
    const cua = quetMutate(ast()).filter((g) => g.ten === KHONG_STEP_UP);
    expect(cua.length, "phải có lời gọi `retryDeferred.mutate(`").toBeGreaterThan(0);
    for (const g of cua) {
      expect(g.coTotpCode, "`retryDeferred.input` KHÔNG khai `totpCode` — gửi nó là vỡ `.strict()`").toBe(false);
      expect(g.trongStepUpGuard, "`actuationProcedure` KHÔNG chain `requireFreshTotp`").toBe(false);
    }
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
