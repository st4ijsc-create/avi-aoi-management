/**
 * W4-19 — test round-trip cho history undo/redo (THUẦN, không React).
 */
import { describe, it, expect } from "vitest";
import {
  initHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndoHistory,
  canRedoHistory,
  HISTORY_LIMIT,
} from "./flowHistory";

describe("flowHistory (undo/redo core)", () => {
  it("khởi tạo: present đúng, không undo/redo được", () => {
    const h = initHistory({ n: 0 });
    expect(h.present).toEqual({ n: 0 });
    expect(canUndoHistory(h)).toBe(false);
    expect(canRedoHistory(h)).toBe(false);
  });

  it("push rồi undo trả về đúng present trước đó, redo khôi phục", () => {
    let h = initHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    expect(canUndoHistory(h)).toBe(true);

    h = undoHistory(h);
    expect(h.present).toBe(1);
    h = undoHistory(h);
    expect(h.present).toBe(0);
    expect(canUndoHistory(h)).toBe(false);

    // redo đi ngược lại
    h = redoHistory(h);
    expect(h.present).toBe(1);
    h = redoHistory(h);
    expect(h.present).toBe(2);
    expect(canRedoHistory(h)).toBe(false);
  });

  it("ROUND-TRIP: chuỗi push → undo hết → redo hết cho cùng dãy giá trị", () => {
    const values = [10, 20, 30, 40];
    let h = initHistory(0);
    for (const v of values) h = pushHistory(h, v);

    // undo về tận đầu, thu lại các present
    const undone: number[] = [];
    while (canUndoHistory(h)) {
      h = undoHistory(h);
      undone.push(h.present);
    }
    expect(undone).toEqual([30, 20, 10, 0]);

    // redo về tận cuối
    const redone: number[] = [];
    while (canRedoHistory(h)) {
      h = redoHistory(h);
      redone.push(h.present);
    }
    expect(redone).toEqual([10, 20, 30, 40]);
    expect(h.present).toBe(40);
  });

  it("push mới sau khi undo sẽ XOÁ nhánh redo (future)", () => {
    let h = initHistory("a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    h = undoHistory(h); // present = b, future = [c]
    expect(canRedoHistory(h)).toBe(true);
    h = pushHistory(h, "d"); // rẽ nhánh mới
    expect(h.present).toBe("d");
    expect(canRedoHistory(h)).toBe(false);
    // undo bây giờ về b, không phải c
    h = undoHistory(h);
    expect(h.present).toBe("b");
  });

  it("push cùng tham chiếu present là no-op (không tạo entry rác)", () => {
    const obj = { k: 1 };
    let h = initHistory(obj);
    h = pushHistory(h, obj);
    expect(canUndoHistory(h)).toBe(false);
  });

  it("undo/redo trên history rỗng là no-op", () => {
    let h = initHistory(1);
    h = undoHistory(h);
    expect(h.present).toBe(1);
    h = redoHistory(h);
    expect(h.present).toBe(1);
  });

  it("cắt past theo HISTORY_LIMIT nhưng vẫn giữ present mới nhất", () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) h = pushHistory(h, i);
    expect(h.present).toBe(HISTORY_LIMIT + 20);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
