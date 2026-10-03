// @vitest-environment jsdom
//
// doc 81 Đợt 2 final wave (T11b minor 5) — sơ đồ là MAIN của WorkbenchShell; nội dung có thể mount vào host DOM
// đang TÁCH (slot portal) hoặc tab ẩn (< 1024 px) ⇒ lúc `onInit` khung là 0×0 và fitView không có gì để vừa.
// Hợp đồng: khung chuyển từ 0×0 sang có kích thước ⇒ fitView MỘT lần (mỗi lần lại hiện ra); đổi cỡ thường không fit lại.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

const fitView = vi.fn();
vi.mock("@xyflow/react", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ReactFlow: Pass,
    ReactFlowProvider: Pass,
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useReactFlow: () => ({ fitView, screenToFlowPosition: (p: unknown) => p }),
    useNodesState: (init: unknown[]) => [init, () => undefined, () => undefined],
  };
});
vi.mock("@xyflow/react/dist/style.css", () => ({}));

type RoCb = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
let roCb: RoCb | null = null;
class FakeRO {
  constructor(cb: RoCb) { roCb = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
}

import { WorkflowGraphCanvas } from "./WorkflowGraphCanvas";

const t = ((k: string, d?: string) => d ?? k) as never;
const size = (width: number, height: number) => React.act(() => roCb?.([{ contentRect: { width, height } }]));

beforeEach(() => {
  fitView.mockClear();
  roCb = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeRO;
});
afterEach(() => cleanup());

describe("WorkflowGraphCanvas — fitView khi khung có kích thước thật", () => {
  it("0×0 lúc mount ⇒ chưa fit; có kích thước ⇒ fit đúng một lần; đổi cỡ ⇒ không fit lại; ẩn rồi hiện ⇒ fit lại", () => {
    render(
      <WorkflowGraphCanvas
        def={{ ref: "w", name: "w", version: 1, steps: [] } as never}
        selectedId={null} onSelect={() => undefined} onDelete={() => undefined} onAddTopLevel={() => undefined}
        onAddChild={() => undefined} onReorderToSibling={() => undefined} onMoveNode={() => undefined} t={t} fill
      />,
    );
    expect(roCb).not.toBeNull();
    const base = fitView.mock.calls.length; // onInit (nếu thư viện gọi) không tính
    size(0, 0);
    expect(fitView.mock.calls.length - base).toBe(0);
    size(900, 600);
    expect(fitView.mock.calls.length - base).toBe(1);
    size(1000, 640);
    expect(fitView.mock.calls.length - base).toBe(1);
    size(0, 0);
    size(900, 600);
    expect(fitView.mock.calls.length - base).toBe(2);
  });
});
