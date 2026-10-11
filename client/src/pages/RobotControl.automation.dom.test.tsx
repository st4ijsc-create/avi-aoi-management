// @vitest-environment jsdom
/**
 * doc 81 Đợt 7 task I5 — the per-robot "automation off" switch on the Robot Control registry.
 *   • a robot whose automation is OFF (or unreadable) shows the badge and offers "Turn automation on";
 *   • "Turn automation off" needs only machine_control/canEdit; it opens a dialog, a reason (≥ 3 chars) is required, and it
 *     calls robot.disableAutomation({ robotId, reason }) — never without a reason;
 *   • "Turn automation on" needs the actuation role floor too (disabled otherwise) and calls robot.enableAutomation.
 * The server is the wall (robotRouter); this measures the screen's contract with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import React from "react";

const srv = vi.hoisted(() => ({
  robots: [] as Array<Record<string, unknown>>,
  calls: {} as Record<string, unknown[]>,
  role: "engineer" as string | null,
  canEdit: true,
  isAdmin: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: string | Record<string, unknown>) => {
      if (typeof d === "string") return d;
      if (d && typeof d === "object" && typeof d.defaultValue === "string") {
        return (d.defaultValue as string).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(d[n] ?? ""));
      }
      return k;
    },
    i18n: { language: "vi", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: (_m: string, a: string) => (a === "canEdit" ? srv.canEdit : true), isAdmin: srv.isAdmin }),
}));
vi.mock("@/hooks/useActuationReadiness", () => ({ useActuationReadiness: () => ({ role: srv.role }) }));
vi.mock("@/lib/trpc", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: () => Promise.resolve() });
  const proc = (router: string, name: string) => {
    const key = `${router}.${name}`;
    return {
      useQuery: () => (key === "robot.list" ? q(srv.robots) : q([])),
      useMutation: () => ({
        isPending: false,
        mutate: (input: unknown) => {
          (srv.calls[key] ??= []).push(input);
        },
      }),
    };
  };
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: () => Promise.resolve() }) }) });
  return {
    trpc: new Proxy(
      {},
      { get: (_t, r: string) => (r === "useUtils" ? () => utils : new Proxy({}, { get: (_t2, p: string) => proc(r, p) })) },
    ),
  };
});

import RobotControl from "./RobotControl";

const robot = (id: number, automation: string) => ({
  id, code: `R${id}`, name: `Robot ${id}`, vendor: "vda5050", kind: "agv", endpoint: "mqtt://x", isEnabled: true,
  status: "online", lastSeenAt: null, live: { active: false, connected: false, motionLock: null }, automation,
});
const rowOf = (code: string) => screen.getAllByText(code).map((e) => e.closest("tr")).find(Boolean) as HTMLElement;

beforeEach(() => {
  srv.robots = [robot(1, "on"), robot(2, "off"), robot(3, "unknown")];
  srv.calls = {};
  srv.role = "engineer";
  srv.canEdit = true;
  srv.isAdmin = false;
});
afterEach(() => cleanup());

describe("doc 81 Đợt 7 I5 — Robot Control: per-robot automation switch", () => {
  it("★ OFF / unreadable robots show the badge; ON shows none", () => {
    render(<RobotControl />);
    expect(within(rowOf("R1")).queryByTestId("robot-automation-off")).toBeNull();
    expect(within(rowOf("R2")).getByTestId("robot-automation-off")).toHaveTextContent("Tự động hoá: TẮT");
    expect(within(rowOf("R3")).getByTestId("robot-automation-off")).toHaveTextContent("không đọc được");
  });

  it("★ turn OFF: dialog, a reason is required, then robot.disableAutomation({ robotId, reason })", async () => {
    const user = userEvent.setup();
    render(<RobotControl />);
    await user.click(within(rowOf("R1")).getByRole("button", { name: /Tắt tự động hoá/ }));
    const dlg = await screen.findByRole("alertdialog");
    const confirm = within(dlg).getByRole("button", { name: /Tắt tự động hoá/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "lane blocked" } });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(srv.calls["robot.disableAutomation"]).toEqual([{ robotId: 1, reason: "lane blocked" }]);
    expect(srv.calls["robot.enableAutomation"]).toBeUndefined();
  });

  it("★ turn OFF needs only canEdit (not the actuation role); without canEdit it is disabled", () => {
    srv.role = null; // not in the actuation floor
    const view = render(<RobotControl />);
    expect(within(rowOf("R1")).getByRole("button", { name: /Tắt tự động hoá/ })).toBeEnabled();
    view.unmount();
    srv.canEdit = false;
    render(<RobotControl />);
    expect(within(rowOf("R1")).getByRole("button", { name: /Tắt tự động hoá/ })).toBeDisabled();
  });

  it("★ turn ON needs the actuation role floor too; with it, the dialog calls robot.enableAutomation", async () => {
    srv.role = null;
    const view = render(<RobotControl />);
    expect(within(rowOf("R2")).getByRole("button", { name: /Bật tự động hoá/ })).toBeDisabled();
    view.unmount();
    srv.role = "engineer";
    const user = userEvent.setup();
    render(<RobotControl />);
    await user.click(within(rowOf("R2")).getByRole("button", { name: /Bật tự động hoá/ }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "lane clear again" } });
    await user.click(within(dlg).getByRole("button", { name: /Bật tự động hoá/ }));
    expect(srv.calls["robot.enableAutomation"]).toEqual([{ robotId: 2, reason: "lane clear again" }]);
  });
});
