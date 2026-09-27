// @vitest-environment jsdom
//
// doc 80 Đợt 1 Task 4 (X-01 · ORC-13) — component dùng chung ProvenanceBadge /
// ProvenanceSummary / DispatchModeBadge. Bảng tín hiệu → nhãn đã được khoá ở
// shared/provenance.test.ts; ở đây khoá phần HIỂN THỊ: badge mang đúng nhãn, hàng thật không
// có badge, dải tóm tắt đếm đúng N/M và ẨN khi N = 0.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProvenanceBadge, ProvenanceSummary, DispatchModeBadge } from "./ProvenanceBadge";

afterEach(() => cleanup());

describe("ProvenanceBadge", () => {
  it("hàng seed ⇒ badge SEED, tooltip nêu tín hiệu", () => {
    render(<ProvenanceBadge row={{ id: 7, contextJson: { seed: true } }} />);
    const b = screen.getByTestId("provenance-badge");
    expect(b).toHaveAttribute("data-provenance", "SEED");
    expect(b).toHaveTextContent("SEED");
    expect(b.getAttribute("title") ?? "").toContain("contextJson.seed=true");
  });
  it("hàng demo / sim ⇒ DEMO / SIM", () => {
    render(
      <>
        <ProvenanceBadge row={{ taskKey: "DEMO-TASK-PICK-1" }} />
        <ProvenanceBadge row={{ code: "SIM-SAFETY-PLC-1" }} />
      </>,
    );
    expect(screen.getAllByTestId("provenance-badge").map((b) => b.getAttribute("data-provenance"))).toEqual(["DEMO", "SIM"]);
  });
  it("hàng thật ⇒ KHÔNG render gì", () => {
    const { container } = render(<ProvenanceBadge row={{ id: 1, taskKey: "WO-1", scope: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProvenanceSummary — dải 'N/M hàng là dữ liệu demo'", () => {
  it("đếm đúng N/M", () => {
    render(<ProvenanceSummary rows={[{ scope: "demo" }, { id: 2 }, { origin: "seed" }]} />);
    const s = screen.getByTestId("provenance-summary");
    expect(s).toHaveAttribute("data-count", "2");
    expect(s).toHaveAttribute("data-total", "3");
  });
  it("N = 0 ⇒ ẩn", () => {
    render(<ProvenanceSummary rows={[{ id: 1 }, { id: 2 }]} />);
    expect(screen.queryByTestId("provenance-summary")).not.toBeInTheDocument();
  });
});

describe("DispatchModeBadge — ORC-13", () => {
  it("simulated ⇒ DRY-RUN; mixed ⇒ badge riêng; live ⇒ LIVE; none ⇒ không gì", () => {
    const { rerender, container } = render(<DispatchModeBadge dispatch={{ mode: "simulated", simulated: 2, live: 0 }} />);
    expect(screen.getByTestId("dispatch-mode")).toHaveAttribute("data-mode", "simulated");
    expect(screen.getByTestId("dispatch-mode")).toHaveTextContent(/DRY-RUN/);
    rerender(<DispatchModeBadge dispatch={{ mode: "mixed", simulated: 1, live: 1 }} />);
    expect(screen.getByTestId("dispatch-mode")).toHaveAttribute("data-mode", "mixed");
    rerender(<DispatchModeBadge dispatch={{ mode: "live", simulated: 0, live: 1 }} />);
    expect(screen.getByTestId("dispatch-mode")).toHaveTextContent(/LIVE/);
    rerender(<DispatchModeBadge dispatch={{ mode: "none", simulated: 0, live: 0 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DispatchModeBadge dispatch={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
