// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 13 — thanh trạng thái IDE hiện "Ln/Col" ⇒ CodeEditor báo vị trí con trỏ qua `onCursorChange`
// (tuỳ chọn; không truyền ⇒ editor y như trước). Đo trên CodeMirror THẬT (EditorView của chính editor).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

vi.mock("@/lib/trpc", () => ({
  trpc: { programming: { copilotComplete: { useMutation: () => ({ mutateAsync: () => Promise.resolve({ completion: "" }) }) } } },
}));

import { CodeEditor } from "./CodeEditor";

afterEach(() => cleanup());

function viewOf(): EditorView {
  const el = document.querySelector(".cm-editor") as HTMLElement;
  const v = EditorView.findFromDOM(el);
  if (!v) throw new Error("no EditorView");
  return v;
}

describe("CodeEditor — onCursorChange (Ln/Col)", () => {
  it("di chuyển con trỏ ⇒ báo dòng/cột 1-based của vị trí con trỏ", () => {
    const seen: Array<{ line: number; col: number }> = [];
    render(<CodeEditor value={"AB\nCDEF\nG"} onChange={() => {}} onCursorChange={(p) => seen.push(p)} />);
    act(() => viewOf().dispatch({ selection: { anchor: 6 } })); // "AB\nCDE|F" ⇒ dòng 2, cột 4
    expect(seen[seen.length - 1]).toEqual({ line: 2, col: 4 });
    act(() => viewOf().dispatch({ selection: { anchor: 0 } }));
    expect(seen[seen.length - 1]).toEqual({ line: 1, col: 1 });
  });

  it("không truyền onCursorChange ⇒ không lỗi, editor vẫn chạy", () => {
    render(<CodeEditor value={"X"} onChange={() => {}} />);
    act(() => viewOf().dispatch({ selection: { anchor: 1 } }));
    expect(document.querySelector(".cm-editor")).not.toBeNull();
  });
});
