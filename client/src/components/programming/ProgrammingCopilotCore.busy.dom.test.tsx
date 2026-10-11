// @vitest-environment jsdom
//
// doc 81 Đợt 7 task L fix 1 (b) — lõi Copilot nối trạng thái bận của engine (ProgrammingCopilotPanel.onBusyChange) lên
// context ⇒ CopilotStatusItem của thanh trạng thái biết một lượt đang chạy khuất. Ngoài Provider lõi vẫn chạy (không ném).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }) }));
const h = vi.hoisted(() => ({ onBusy: null as ((b: boolean) => void) | null | undefined }));
vi.mock("@/components/programming/ProgrammingCopilotPanel", () => ({
  ProgrammingCopilotPanel: (p: { onBusyChange?: (b: boolean) => void }) => {
    h.onBusy = p.onBusyChange;
    return <p>engine</p>;
  },
}));

import { ProgrammingCopilotCore } from "./ProgrammingCopilotCore";
import { ProgrammingCopilotProvider, useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";

afterEach(() => {
  cleanup();
  h.onBusy = null;
  localStorage.clear();
});

describe("L fix 1 (b) — ProgrammingCopilotCore nối onBusyChange lên context", () => {
  it("engine báo bận ⇒ context.busy true; hết ⇒ false", async () => {
    let busy: boolean | null = null;
    function Probe() { busy = useProgrammingCopilot().busy; return null; }
    render(<ProgrammingCopilotProvider><Probe /><ProgrammingCopilotCore binding={{}} /></ProgrammingCopilotProvider>);
    await screen.findByText("engine");
    expect(typeof h.onBusy).toBe("function");
    act(() => h.onBusy!(true));
    expect(busy).toBe(true);
    act(() => h.onBusy!(false));
    expect(busy).toBe(false);
  });
  it("ngoài Provider ⇒ không ném, engine vẫn vẽ (onBusyChange vắng)", async () => {
    render(<ProgrammingCopilotCore binding={{}} />);
    await screen.findByText("engine");
    expect(h.onBusy).toBeUndefined();
  });
});
