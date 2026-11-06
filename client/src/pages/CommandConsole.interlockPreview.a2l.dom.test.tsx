// @vitest-environment jsdom
//
// SCADA R1b-2b-2a A2(l) fix round 1 — the console's interlock preview in the robot command confirm:
//   m5 (L-7) — a STOP / abort NEVER shows the red "Interlock BLOCKED — the dispatcher will refuse a real run." (a STOP is never refused),
//              not even for an unplaced robot; no preview query is made for it; a neutral "motion only" note instead. A MOTION still shows it.
//   m3 — a placed robot whose machine set is EMPTY is shown as "No machines to check", never "Interlock clear"; a station with no machine
//        says that the rules of its line apply.
// Oracle: the hand-written preview answers + the captured query `enabled` flags + the rendered text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const CHUA_DINH_VI = { blocked: true, failClosed: false, maTuChoi: "ROBOT_CHUA_DINH_VI", viTri: "chua_dinh_vi", khongCoMay: false, tramKhongMay: false, lineId: null, violations: [] };
const H = vi.hoisted(() => ({
  preview: null as unknown,
  previewCalls: [] as Array<{ enabled: boolean }>,
  actuate: vi.fn(),
  consoleStop: vi.fn(),
}));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("wouter", () => ({ useSearch: () => "?robotId=5" }));
const q = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ robot: { jobs: { invalidate: vi.fn() } } }),
    robot: {
      list: { useQuery: () => q([{ id: 5, code: "R-05", name: "arm 5", vendor: "fanuc", kind: "arm", isEnabled: true, status: "online" }]) },
      interlockPreview: {
        useQuery: (_input: unknown, opts: { enabled?: boolean }) => {
          H.previewCalls.push({ enabled: opts?.enabled !== false });
          return q(opts?.enabled === false ? undefined : H.preview);
        },
      },
      jobs: { useQuery: () => q([]) },
      actuate: { useMutation: () => ({ mutate: H.actuate, isPending: false }) },
      consoleStop: { useMutation: () => ({ mutate: H.consoleStop, isPending: false }) },
    },
    assetCockpit: { robotDetail: { useQuery: () => q({ gatedActions: [] }) } },
    safety: { sourceHealth: { useQuery: () => q({ plcPoller: { latched: [] } }) } },
  },
}));

import CommandConsole from "./CommandConsole";

beforeEach(() => {
  H.preview = CHUA_DINH_VI;
  H.previewCalls.length = 0;
  H.actuate.mockReset();
  H.consoleStop.mockReset();
});
afterEach(() => cleanup());

async function openFor(label: RegExp) {
  render(<CommandConsole />);
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: label }));
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("A2(l) fix round 1 — interlock preview in the command confirm", () => {
  it("control: a MOTION (Home) to an unplaced robot shows the red BLOCKED banner and the localised unplaced refusal", async () => {
    const { dialog } = await openFor(/Home/);
    const banner = within(dialog).getByTestId("interlock-preview");
    expect(banner.textContent).toMatch(/Interlock BLOCKED — the dispatcher will refuse a real run\./);
    expect(banner.className).toMatch(/destructive/);
    expect(within(dialog).queryByTestId("interlock-preview-stop")).toBeNull();
    expect(H.previewCalls.some((c) => c.enabled)).toBe(true);
  });

  it.each([[/^\s*Stop/], [/Abort/]])("★ m5 (L-7): a STOP (%s) to the same unplaced robot never shows the red banner, makes no preview query, shows the neutral note; it still sends", async (label) => {
    const { user, dialog } = await openFor(label);
    expect(within(dialog).queryByTestId("interlock-preview")).toBeNull();
    expect(dialog.textContent).not.toMatch(/Interlock BLOCKED|will refuse/);
    expect(within(dialog).getByTestId("interlock-preview-stop").textContent).toMatch(/a STOP is never blocked/);
    expect(H.previewCalls.every((c) => !c.enabled)).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "R-05");
    await user.click(within(dialog).getByRole("button", { name: /Dispatch command/ }));
    expect(H.consoleStop).toHaveBeenCalledTimes(1);
  });

  it("★ m3: placed robot with an EMPTY machine set ⇒ 'No machines to check' (amber), never 'Interlock clear'", async () => {
    H.preview = { blocked: false, failClosed: false, maTuChoi: null, viTri: "tram", khongCoMay: true, tramKhongMay: true, lineId: 77, violations: [] };
    const { dialog } = await openFor(/Home/);
    const banner = within(dialog).getByTestId("interlock-preview");
    expect(banner.textContent).toMatch(/No machines to check/);
    expect(banner.textContent).not.toMatch(/Interlock clear/);
    expect(banner.className).toMatch(/amber/);
    expect(banner.textContent).toMatch(/This station has no machines — the rules on line #77 apply\./);
  });

  it("m3: a station with no machine but a line that has machines ⇒ clear + the 'rules on line X apply' note; a normal clear has no note", async () => {
    H.preview = { blocked: false, failClosed: false, maTuChoi: null, viTri: "tram", khongCoMay: false, tramKhongMay: true, lineId: 12, violations: [] };
    const { dialog } = await openFor(/Home/);
    const banner = within(dialog).getByTestId("interlock-preview");
    expect(banner.textContent).toMatch(/Interlock clear\./);
    expect(banner.textContent).toMatch(/the rules on line #12 apply/);
    cleanup();
    H.preview = { blocked: false, failClosed: false, maTuChoi: null, viTri: "tram", khongCoMay: false, tramKhongMay: false, lineId: 12, violations: [] };
    const again = await openFor(/Home/);
    const b2 = within(again.dialog).getByTestId("interlock-preview");
    expect(b2.textContent).toMatch(/Interlock clear\./);
    expect(b2.textContent).not.toMatch(/rules on line/);
  });
});
