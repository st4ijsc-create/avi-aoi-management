// @vitest-environment jsdom
//
// doc 81 Đợt 9 task R3 — the API keys screen shows who each key is ISSUED TO, and only an ADMINISTRATOR can change it
// (apiKey.setHolder — the server enforces adminProcedure too). Real page; trpc / layout / user picker are test doubles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => null }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
// the user picker: a plain <select> over a fixed roster (the real one lists trpc.user.list)
vi.mock("@/components/patterns/EntityPicker", () => ({
  UserSelect: ({ value, onChange, "aria-label": label }: { value: number | null; onChange: (v: number | null) => void; "aria-label"?: string }) => (
    <select aria-label={label} data-testid="user-select" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">—</option>
      <option value="12">Holder Now</option>
      <option value="21">New Holder</option>
    </select>
  ),
}));

const h = vi.hoisted(() => ({ me: null as null | { id: number; role: string; name: string }, mutate: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: h.me }) }));
function q(data: unknown) {
  return { data, isLoading: false, isPending: false, isFetching: false, isError: false, error: null, refetch: vi.fn() };
}
const ROWS = [
  { id: 1, name: "line-integration", keyPrefix: "ak_1a2b3c", scopes: ["orchestration:write"], isActive: true, dataScopeMode: "global", holderUserId: 12, holderName: "Holder Now", holderRecorded: true },
  { id: 2, name: "orphan", keyPrefix: "ak_000000", scopes: ["bi:read"], isActive: true, dataScopeMode: null, holderUserId: null, holderName: null, holderRecorded: true },
  { id: 3, name: "pre-0369", keyPrefix: "ak_111111", scopes: ["bi:read"], isActive: true, dataScopeMode: null, holderUserId: null, holderName: null, holderRecorded: false },
];
vi.mock("@/lib/trpc", () => {
  const chain = (): unknown => new Proxy(() => undefined, { get: () => chain(), apply: () => undefined });
  return {
    trpc: {
      useUtils: () => chain(),
      apiKey: {
        list: { useQuery: () => q(ROWS) },
        scopes: { useQuery: () => q([]) },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setHolder: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
      },
      factory: { list: { useQuery: () => q([]) } },
    },
  };
});

import ApiKeysPage from "./ApiKeysPage";

beforeEach(() => {
  h.me = null;
  h.mutate.mockClear();
});
afterEach(() => cleanup());

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("ApiKeysPage — doc 81 Đợt 9 R3: 'Issued to'", () => {
  it("★ shows who each key is issued to; a key with no holder and one whose holder is not recorded say so", () => {
    h.me = { id: 5, role: "admin", name: "Admin" };
    render(<ApiKeysPage />);
    expect(within(rowOf("line-integration")).getByTestId("api-key-holder").textContent).toBe("Holder Now");
    expect(within(rowOf("orphan")).getByTestId("api-key-holder-none")).toBeInTheDocument();
    expect(within(rowOf("pre-0369")).getByTestId("api-key-holder-unrecorded")).toBeInTheDocument();
  });

  it("★ a non-admin cannot open 'change who it is issued to' (button disabled, says why)", () => {
    h.me = { id: 7, role: "engineer", name: "Eng" };
    render(<ApiKeysPage />);
    const btn = within(rowOf("line-integration")).getByTestId("api-key-change-holder");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/quản trị viên|administrator|changeHolderAdminOnly/i);
  });

  it("★ an admin changes it: picks the user, gives a reason ⇒ setHolder({ id, holderUserId, reason }); no reason ⇒ cannot save", async () => {
    h.me = { id: 5, role: "admin", name: "Admin" };
    render(<ApiKeysPage />);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(within(rowOf("line-integration")).getByTestId("api-key-change-holder"));
    await user.selectOptions(screen.getByTestId("user-select"), "21");
    const save = screen.getByTestId("api-key-holder-save");
    expect(save).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "handed to the line team");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(h.mutate).toHaveBeenCalledWith({ id: 1, holderUserId: 21, reason: "handed to the line team" });
  });
});
