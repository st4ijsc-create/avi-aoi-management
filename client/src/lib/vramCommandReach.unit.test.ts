/**
 * ★★★ Pha 4 Task 4 (review vòng 1, I-1) — **NÚT LỆNH KHÔNG ĐƯỢC HỨA NHIỀU HƠN LỆNH.**
 *
 * Bản đầu của `VramBrokerPanel` viết `retryReach === "reachable-here" || status === "deferring" || …`
 * ⇒ nút *"Thử lại ngay"* hiện cho **5/6 hộ** mà `vram.retryDeferred` **LUÔN** từ chối. Đó đúng lỗi
 * mà bàn giao (D) được dựng ra để đóng, chỉ khác là nó bò lên tầng UI và ghi đè đúng cái tín hiệu
 * (`retryReach`) vừa được dựng để trả lời câu ấy.
 *
 * ⚠ Vị từ nằm ở module THUẦN (`vramCommandReach.ts`) chứ không nằm trong `.tsx`: repo có **0 file
 * `*.test.tsx`** và không có harness render nào — một vị từ trong `.tsx` là vị từ **không ai kiểm
 * được**. Lưới canh việc panel THẬT SỰ gọi hàm này là cổng AST ở `errorCodes.vramCommands.unit.test.ts`
 * (cổng (ii) đã đổi sang AST sau khi bản regex bị lách bằng một dòng chú thích).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { vramRetryButtonEnabled, type VramDeferRetryReachKind } from "./vramCommandReach";

/** ⚠ VÉT CẠN theo KIỂU: thêm một phạm trù `retryReach` mà quên khai ⇒ `tsc` ĐỎ, không phải lọt. */
const MONG_DOI: Record<VramDeferRetryReachKind, boolean> = {
  "reachable-here": true,
  unreachable: false,
  unknown: false,
};

describe("I-1 — nút `vram.retryDeferred` CHỈ hiện khi lệnh thật sự với tới", () => {
  for (const [kind, mong] of Object.entries(MONG_DOI) as [VramDeferRetryReachKind, boolean][]) {
    it(`${kind} ⇒ ${mong ? "CHO" : "KHÔNG cho"} bấm`, () => {
      expect(vramRetryButtonEnabled(kind)).toBe(mong);
    });
  }

  it("★★★ ĐÚNG MỘT phạm trù cho phép bấm — `||` thêm bất kỳ điều kiện nào là quay lại lỗi (D)", () => {
    const choPhep = (Object.keys(MONG_DOI) as VramDeferRetryReachKind[]).filter((k) => vramRetryButtonEnabled(k));
    expect(choPhep).toEqual(["reachable-here"]);
  });

  it('★★ "đang hoãn" KHÔNG phải một lý do cho bấm: hộ `unreachable` vẫn KHÔNG bấm được dù đang hoãn thật', () => {
    // Hai câu hỏi khác nhau: `status` = "nó có CHỜ không"; `retryReach` = "ta có GỌI DẬY được không".
    // Hộ đi qua `vramDefer` chờ TRONG ngăn xếp của chính job đó ⇒ không cơ chế nào đánh thức từ ngoài.
    expect(vramRetryButtonEnabled("unreachable")).toBe(false);
  });

  it('★★ `unknown` (ô trạng thái cron đọc không được) ⇒ KHÔNG bấm — chiều CHẶT, không đọc thành "được"', () => {
    expect(vramRetryButtonEnabled("unknown")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ LƯỚI CẤU TRÚC — PHÁT BIỂU VỀ **CÁI NÓ PHẢI LÀ**, KHÔNG PHẢI DANH SÁCH CÁI NÓ KHÔNG ĐƯỢC CHỨA
//
// ⚠⚠⚠ N-2 (re-review) — BẢN TRƯỚC CỦA LƯỚI NÀY **LÁCH ĐƯỢC**, và cách lách rất rẻ:
//     const rk = h.retryReach.kind;
//     const canRetry = rk === "reachable-here" || h.status.kind === "deferring";
// ⇒ lỗi I-1 **khôi phục NGUYÊN VẸN**, lưới **XANH 153/153** — vì lưới cũ cấm *"một `||` chạm
// `retryReach`"*, tức nó chép **CHỮ KÝ của lỗi vừa rồi** thay vì phát biểu **BẤT BIẾN**. Một biến
// trung gian đổi chữ ký; `?:`, `&&`, `??` cũng vậy. Đây là **lần thứ BA** trong chuỗi pha một lưới
// được nặn theo hình dạng của lỗi cũ.
//
// ⇒ BẤT BIẾN, phát biểu MỘT LẦN: **khởi tạo của `canRetry` PHẢI LÀ một lời gọi
// `vramRetryButtonEnabled(...)`** — không phải "không được chứa X". Mọi biểu thức khác (biến trung
// gian, `?:`, `&&`, hằng `true`, một hàm khác) đều **không phải** lời gọi ấy ⇒ ĐỎ, bất kể hình dạng.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("N-2 — khởi tạo của `canRetry` PHẢI LÀ lời gọi `vramRetryButtonEnabled` (bất biến, không phải chữ ký)", () => {
  const HERE = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
  const PANEL = join(HERE, "..", "components", "ai", "VramBrokerPanel.tsx");

  function ast(): ts.SourceFile {
    return ts.createSourceFile(PANEL, readFileSync(PANEL, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  /** MỌI khai báo biến mang tên `ten` trong file (kể cả trong hàm/JSX callback). */
  function khaiBao(sf: ts.SourceFile, ten: string): ts.VariableDeclaration[] {
    const ra: ts.VariableDeclaration[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten) ra.push(n);
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  /** `true` ⇔ node LÀ một lời gọi đúng hàm ấy (không phải "có chứa" nó ở đâu đó bên trong). */
  function laLoiGoi(n: ts.Node | undefined, ten: string): boolean {
    return n !== undefined && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ten;
  }

  it("★★★ có ĐÚNG ≥1 `canRetry`, và MỌI khởi tạo của nó LÀ `vramRetryButtonEnabled(...)`", () => {
    const sf = ast();
    const kb = khaiBao(sf, "canRetry");
    expect(kb.length, "panel phải có biến quyết định nút thử lại").toBeGreaterThanOrEqual(1);
    const sai = kb
      .filter((d) => !laLoiGoi(d.initializer, "vramRetryButtonEnabled"))
      .map((d) => d.getText(sf).slice(0, 160));
    // ⚠ Thông điệp nói BẤT BIẾN, không nói "đừng dùng ||" — người sau đọc là hiểu phải làm gì.
    expect(sai, "khởi tạo của `canRetry` phải LÀ lời gọi `vramRetryButtonEnabled(...)`, không phải một biểu thức tự chế").toEqual([]);
  });

  it("★★ (lưới cho chính lưới) BỐN hình dạng lách khác nhau đều bị bắt bởi CÙNG một phát biểu", () => {
    /**
     * Bốn biến thể: biến trung gian · `?:` · `&&` · `??`. Lưới cũ (cấm `||`) **để lọt cả bốn**.
     * Ca này chạy phép hỏi mới trên nguồn giả lập — chứng minh nó bắt theo BẤT BIẾN, không theo
     * chữ ký của lỗi đã gặp.
     */
    const bienThe: Record<string, string> = {
      "biến trung gian": 'const rk = x.retryReach.kind; const canRetry = rk === "reachable-here" || x.status.kind === "deferring";',
      "toán tử ?:": 'const canRetry = x.retryReach.kind === "unknown" ? true : x.status.kind === "deferring";',
      "toán tử &&": 'const canRetry = x.status.kind === "deferring" && x.retryReach.kind !== "unreachable";',
      "toán tử ??": "const canRetry = x.coBam ?? true;",
      "hằng số": "const canRetry = true;",
      "hàm KHÁC": "const canRetry = motHamKhac(x.retryReach.kind);",
    };
    for (const [ten, nguon] of Object.entries(bienThe)) {
      const sf = ts.createSourceFile("giả.tsx", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const kb = khaiBao(sf, "canRetry");
      expect(kb.length, ten).toBeGreaterThanOrEqual(1);
      expect(kb.every((d) => laLoiGoi(d.initializer, "vramRetryButtonEnabled")), `${ten} PHẢI bị bắt`).toBe(false);
    }
    // Và hình dạng ĐÚNG thì lọt qua — lưới không phải một cái cấm-tất-cả.
    const dung = ts.createSourceFile(
      "giả.tsx",
      "const canRetry = vramRetryButtonEnabled(x.retryReach.kind);",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(khaiBao(dung, "canRetry").every((d) => laLoiGoi(d.initializer, "vramRetryButtonEnabled"))).toBe(true);
  });
});
