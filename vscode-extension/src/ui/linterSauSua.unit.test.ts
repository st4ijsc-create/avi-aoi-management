/** Đợt 11.4 / mục 7 — lớp vscode của linter: không bao giờ ném, đợi chẩn đoán yên lặng rồi đọc, hết hạn thì đọc số hiện có. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ ds: [] as unknown[], nghe: undefined as undefined | ((e: { uris: Array<{ toString(): string }> }) => void), nem: false, huy: vi.fn() }));
vi.mock("vscode", () => ({
  languages: {
    getDiagnostics: () => {
      if (st.nem) throw new Error("boom");
      return st.ds;
    },
    onDidChangeDiagnostics: (f: (e: { uris: Array<{ toString(): string }> }) => void) => {
      st.nghe = f;
      return { dispose: st.huy };
    },
  },
}));
import { docChanDoan, dopChanDoanSauSua } from "./linterSauSua";

const uri = { toString: () => "file:///a.ts" } as never;
const d = (message: string, severity = 0, line = 0, code?: unknown) => ({ message, severity, range: { start: { line } }, ...(code !== undefined ? { code } : {}) });
beforeEach(() => { vi.useFakeTimers(); st.ds = []; st.nem = false; st.nghe = undefined; st.huy.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("ui/linterSauSua", () => {
  it("docChanDoan: ánh xạ mức, dòng 1-based, mã (cả dạng {value}); ném ⇒ []", () => {
    st.ds = [d("x", 0, 4, 2304), d("y", 1, 0, { value: "E1", target: {} }), d("z", 3)];
    expect(docChanDoan(uri)).toEqual([
      { muc: "error", thongDiep: "x", dong: 5, ma: "2304" },
      { muc: "warning", thongDiep: "y", dong: 1, ma: "E1" },
      { muc: "hint", thongDiep: "z", dong: 1 },
    ]);
    st.nem = true;
    expect(docChanDoan(uri)).toEqual([]);
  });
  it("★ đợi: có thay đổi cho ĐÚNG tệp ⇒ yên lặng 400ms rồi đọc (đọc số SAU thay đổi); tệp khác bị bỏ qua", async () => {
    const p = dopChanDoanSauSua(uri);
    st.nghe!({ uris: [{ toString: () => "file:///khac.ts" }] });
    await vi.advanceTimersByTimeAsync(1000);
    st.ds = [d("moi", 0, 1)];
    st.nghe!({ uris: [uri] });
    await vi.advanceTimersByTimeAsync(399);
    let xong = false;
    void p.then(() => (xong = true));
    await Promise.resolve();
    expect(xong).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toEqual([{ muc: "error", thongDiep: "moi", dong: 2 }]);
    expect(st.huy).toHaveBeenCalled();
  });
  it("★ không có thay đổi nào ⇒ hết trần thì đọc số hiện có (không treo)", async () => {
    st.ds = [d("cu")];
    const p = dopChanDoanSauSua(uri, 2500);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toHaveLength(1);
  });
});
