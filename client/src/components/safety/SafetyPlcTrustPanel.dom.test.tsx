// @vitest-environment jsdom
//
// doc 81 Đợt 8 task N fix 1 (I1 item 5) — the maker-checker approval panel: shows the SERVER's state, digest and
// separation-of-duties verdict; approve / reject send the digest that was SHOWN; reject needs a reason; nothing to decide
// for a viewer who may not (no buttons). Oracle: the mocked trpc mutations' captured arguments.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const M = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: false,
  approve: vi.fn(),
  reject: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ safety: { plcTrustList: { invalidate: vi.fn() } } }),
    safety: {
      plcTrustList: { useQuery: () => ({ data: M.error ? undefined : M.rows, isError: M.error, isLoading: false }) },
      approveSafetyPlcConfig: { useMutation: () => ({ mutate: M.approve, isPending: false }) },
      rejectSafetyPlcConfig: { useMutation: () => ({ mutate: M.reject, isPending: false }) },
    },
  },
}));

import { SafetyPlcTrustPanel } from "./SafetyPlcTrustPanel";

const D = "ab".repeat(32);
const row = (over: Record<string, unknown> = {}) => ({
  id: 7, code: "PNOZ-1", name: "p", backend: "modbus", enabled: true, robotId: 3, stationId: null, lineId: null, factoryId: 1,
  state: "pending", digest: D, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectReason: null,
  lastEditedBy: 2, lastEditedAt: null, mayDecide: true, mayReject: true, blockedBy: null, needsTwoApprovals: false, firstApprovedBy: null,
  scope: null, corporateCode: null, trustUnavailable: null, // final wave F2 / F3 / N-R7 fields
  endpoint: "tcp://10.1.2.3:502", tags: [{ flag: "estop", address: "coil:1", dataType: "bool", activeWhen: "truthy" }],
  ...over,
});

beforeEach(() => {
  M.rows = [];
  M.error = false;
  M.approve.mockReset();
  M.reject.mockReset();
});
afterEach(() => cleanup());

describe("SafetyPlcTrustPanel (doc 81 Đợt 8 N fix 1)", () => {
  it("★ approve shows the FULL digest + what is approved, and sends exactly that digest", () => {
    M.rows = [row()];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.getByTestId("safety-plc-trust-row-7")).toHaveAttribute("data-state", "pending");
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(screen.getByTestId("safety-plc-trust-full-digest")).toHaveTextContent(D);
    expect(screen.getByText("tcp://10.1.2.3:502")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
    expect(M.approve).toHaveBeenCalledWith({ id: 7, expectedDigest: D });
  });

  it("★ reject is disabled until a reason (≥ 3 chars) is given, then sends digest + reason", () => {
    M.rows = [row()];
    render(<SafetyPlcTrustPanel enabled />);
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    const confirm = screen.getByRole("button", { name: /Confirm rejection/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Rejection reason/ }), { target: { value: "wrong PLC" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(M.reject).toHaveBeenCalledWith({ id: 7, expectedDigest: D, reason: "wrong PLC" });
  });

  // re-pinned 2026-10-11 (doc 81 Đợt 8 final wave N-R7): the FIRST approver is now offered Reject (server mayReject), never Approve.
  it("★ a viewer who may not decide gets NO approve button, and the reason (separation of duties) is shown; the first approver may only reject", () => {
    M.rows = [row({ mayDecide: false, mayReject: false, blockedBy: "self" }), row({ id: 8, code: "PNOZ-2", mayDecide: false, mayReject: true, blockedBy: "first_approver", state: "awaiting_second", needsTwoApprovals: true })];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Reject/ })).toHaveLength(1);
    expect(screen.getByTestId("safety-plc-trust-row-8")).toContainElement(screen.getByRole("button", { name: /Reject/ }));
    expect(screen.getAllByTestId("safety-plc-trust-blocked").map((e) => e.textContent)).toEqual([
      expect.stringMatching(/changed this config/),
      expect.stringMatching(/first approval/),
    ]);
    expect(screen.getByTestId("safety-plc-trust-row-8")).toHaveTextContent(/Unknown provenance — needs approvals from two different admins/);
  });

  it("sim rows are shown as never trusted and offer no decision; a read error says 'treat as NOT trusted'", () => {
    M.rows = [row({ backend: "sim", state: "sim", mayDecide: false, blockedBy: "sim", endpoint: null, tags: null })];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.getByTestId("safety-plc-trust-state")).toHaveTextContent(/never trusted/);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    cleanup();
    M.error = true;
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.getByTestId("safety-plc-trust")).toHaveTextContent(/NOT trusted/);
  });

  it("★ final wave F2: the review shows the TARGET the digest covers (robot / station / line / factory / scope / corporate / enabled)", () => {
    M.rows = [row({ robotId: 3, stationId: 11, lineId: null, factoryId: 4, scope: "factory", corporateCode: "C1", enabled: false })];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.queryByTestId("safety-plc-trust-target")).toBeNull(); // only inside the review
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    const target = screen.getByTestId("safety-plc-trust-target");
    expect(target).toHaveTextContent(/robot 3 · station 11 · line — · factory 4 · scope factory · corporate C1 · disabled/);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    expect(screen.getByTestId("safety-plc-trust-target")).toHaveTextContent(/robot 3/);
  });

  it("★ final wave F3: migration 0368 missing ⇒ an alert says so and NO decision is offered", () => {
    M.rows = [row({ mayDecide: false, mayReject: false, blockedBy: "migration_missing", trustUnavailable: "migration_missing" })];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.getByTestId("safety-plc-trust-unavailable")).toHaveTextContent(/migration 0368 is not applied/);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Reject/ })).toBeNull();
    cleanup();
    M.rows = [row({ mayDecide: false, mayReject: false, blockedBy: "trust_unreadable", trustUnavailable: "trust_unreadable" })];
    render(<SafetyPlcTrustPanel enabled />);
    expect(screen.getByTestId("safety-plc-trust-unavailable")).toHaveTextContent(/cannot be read/);
  });
});
