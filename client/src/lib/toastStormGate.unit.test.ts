import { describe, it, expect } from "vitest";
import { createToastStormGate } from "./toastStormGate";

describe("createToastStormGate", () => {
  it("lets the first `max` toasts of a window through", () => {
    const g = createToastStormGate({ max: 3, windowMs: 10_000 });
    expect([g.admit(0), g.admit(10), g.admit(20)].map((d) => d.show)).toEqual([true, true, true]);
  });

  it("holds back the rest of the window and counts them", () => {
    const g = createToastStormGate({ max: 3, windowMs: 10_000 });
    for (let i = 0; i < 3; i++) g.admit(i);
    expect(g.admit(5)).toEqual({ show: false, heldBack: 1 });
    expect(g.admit(6)).toEqual({ show: false, heldBack: 2 });
  });

  it("300 alerts in one second ⇒ 3 shown, 297 held back", () => {
    const g = createToastStormGate({ max: 3, windowMs: 10_000 });
    let shown = 0;
    let last = 0;
    for (let i = 0; i < 300; i++) {
      const d = g.admit(i * 3);
      if (d.show) shown++;
      else last = d.heldBack;
    }
    expect(shown).toBe(3);
    expect(last).toBe(297);
  });

  it("opens again once the window has passed, and the held-back count restarts", () => {
    const g = createToastStormGate({ max: 2, windowMs: 1_000 });
    g.admit(0);
    g.admit(1);
    expect(g.admit(2).show).toBe(false);
    expect(g.admit(1_500)).toEqual({ show: true });
    g.admit(1_600);
    expect(g.admit(1_700)).toEqual({ show: false, heldBack: 1 });
  });
});
