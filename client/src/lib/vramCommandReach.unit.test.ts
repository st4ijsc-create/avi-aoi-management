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
// ★★★ LƯỚI CẤU TRÚC — panel KHÔNG được tự dựng lại phép so, và KHÔNG được `||` thêm điều kiện
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("I-1 — `VramBrokerPanel` phải ĐI QUA vị từ này, không viết lại một phép so nào", () => {
  const HERE = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
  const PANEL = join(HERE, "..", "components", "ai", "VramBrokerPanel.tsx");

  function ast() {
    return ts.createSourceFile(PANEL, readFileSync(PANEL, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  it("★★★ panel GỌI `vramRetryButtonEnabled(` (hỏi trên AST — chú thích không phải node)", () => {
    let n = 0;
    const di = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "vramRetryButtonEnabled"
      ) {
        n++;
      }
      ts.forEachChild(node, di);
    };
    di(ast());
    expect(n, "panel phải đi qua vị từ dùng chung, không tự so").toBeGreaterThanOrEqual(1);
  });

  it('★★★ panel KHÔNG so `status.kind === "deferring"/"exceeded"` để quyết định NÚT THỬ LẠI', () => {
    /**
     * ⚠ Phép so ấy vẫn HỢP LỆ ở chỗ khác của panel (badge "đang hoãn", và `owner` truyền vào lệnh).
     * Thứ bị cấm là dùng nó **trong một biểu thức `||`** — chữ ký chính xác của lỗi I-1. Hỏi trên
     * AST: có `BinaryExpression` `||` nào mà một vế chạm `retryReach` không.
     */
    const sf = ast();
    const viPham: string[] = [];
    const di = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        const text = node.getText(sf);
        if (/\bretryReach\b/.test(text)) viPham.push(text.slice(0, 160));
      }
      ts.forEachChild(node, di);
    };
    di(sf);
    expect(viPham, "một `||` quanh `retryReach` là đúng chữ ký của lỗi I-1").toEqual([]);
  });
});
