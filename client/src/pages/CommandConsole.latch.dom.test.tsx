// @vitest-environment jsdom
//
// doc 81 Đợt 9 final wave (ruling R-9-e, U re-review #3) — the robot command confirm dialog warns of a set e-stop LATCH on a PLC
// guarding THAT robot ("first seen set at T, not reset"): non-blocking (Dispatch still sends), and NEVER for a STOP (no warning,
// not even a query). Oracle: the hand-written sourceHealth answer + the captured query inputs / mutate arguments.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const H = vi.hoisted(() => ({
  latched: [] as Array<{ code: string; since: string }>,
  healthCalls: [] as Array<{ input: unknown; enabled: boolean }>,
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
      interlockPreview: { useQuery: () => q({ blocked: false, violations: [] }) },
      jobs: { useQuery: () => q([]) },
      actuate: { useMutation: () => ({ mutate: H.actuate, isPending: false }) },
      // robot.consoleStop (doc 81 Đợt 10 D R-10-bb): STOP/abort route in CommandConsole.tsx — the mock must offer it or the page throws on render.
      consoleStop: { useMutation: () => ({ mutate: H.consoleStop, isPending: false }) },
    },
    assetCockpit: { robotDetail: { useQuery: () => q({ gatedActions: [] }) } },
    safety: {
      sourceHealth: {
        useQuery: (input: unknown, opts: { enabled?: boolean }) => {
          H.healthCalls.push({ input, enabled: opts?.enabled !== false });
          return q(opts?.enabled === false ? undefined : { plcPoller: { latched: H.latched } });
        },
      },
    },
  },
}));

import CommandConsole from "./CommandConsole";

const SINCE = "2026-10-12T03:04:05.000Z";
beforeEach(() => {
  H.latched = [{ code: "MB-7", since: SINCE }];
  H.healthCalls.length = 0;
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

describe("CommandConsole — final wave R-9-e: latch warning in the robot command confirm", () => {
  it("★ a MOTION command: the warning names the latched PLC guarding THIS robot (target sent), and Dispatch still sends (non-blocking)", async () => {
    const { user, dialog } = await openFor(/Home/);
    const warn = within(dialog).getByTestId("safety-latch-confirm-warning");
    expect(warn.textContent).toMatch(/MB-7: e-stop latch first seen set at .*not reset.*Warning only: this command is not blocked/);
    expect(H.healthCalls.some((c) => c.enabled && JSON.stringify(c.input) === JSON.stringify({ target: { robotId: 5 } }))).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "R-05");
    await user.click(within(dialog).getByRole("button", { name: /Dispatch command/ }));
    expect(H.actuate).toHaveBeenCalledWith({ robotId: 5, command: "home" });
  });

  it.each([[/^\s*Stop/], [/Abort/]])("★ L-7: a STOP (%s) never shows the warning and never queries it", async (label) => {
    const { dialog } = await openFor(label);
    expect(within(dialog).queryByTestId("safety-latch-confirm-warning")).toBeNull();
    expect(H.healthCalls.every((c) => !c.enabled)).toBe(true);
  });

  it("no latch set ⇒ no warning", async () => {
    H.latched = [];
    const { dialog } = await openFor(/Home/);
    expect(within(dialog).queryByTestId("safety-latch-confirm-warning")).toBeNull();
  });
});
