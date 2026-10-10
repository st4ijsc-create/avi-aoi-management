// @vitest-environment jsdom
//
// doc 81 Đợt 4 final wave G7 (group C review M1) — the C1 WIRING on the real page: after `deviceAdapter.update`
// answers `stopPinsCleared > 0`, DeviceAdapterManagement must (1) warn the operator (notifyAdapterStopPinsCleared ⇒
// toast.warning with the count) and (2) refresh the open tag list (invalidateTags ⇒ tags.listByAdapter.invalidate for
// the open adapter), so the cleared pins disappear from the tag drawer. The helper and the server count were tested;
// deleting either call from updateAdapter.onSuccess survived every test. This renders the PAGE; only the network
// contract (`@/lib/trpc`), `sonner`, permissions and the dashboard chrome are mocked. Real vi bundle.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

const H = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  /** what deviceAdapter.update answers (onSuccess) */
  updateResult: null as unknown,
  updateCalls: [] as unknown[],
  invalidated: [] as Array<{ path: string; input?: unknown }>,
  adapters: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: H.toast }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true, isAdmin: true }) }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/ManualHelp", () => ({ default: () => null }));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => null }));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => ({
    useQuery: () => {
      if (path === "deviceAdapter.list") return { data: H.adapters, isLoading: false };
      return { data: [], isLoading: false };
    },
  });
  const mutation = (path: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void } = {}) => ({
      isPending: false,
      mutate: (input: unknown) => {
        if (path === "deviceAdapter.update") {
          H.updateCalls.push(input);
          queueMicrotask(() => opts.onSuccess?.(H.updateResult));
        }
      },
    }),
  });
  const node = (path: string): any =>
    new Proxy(
      {},
      {
        get: (_t, k: string) => {
          if (k === "useQuery") return query(path).useQuery;
          if (k === "useMutation") return mutation(path).useMutation;
          if (k === "invalidate") return (input?: unknown) => void H.invalidated.push({ path, input });
          return node(path ? `${path}.${k}` : k);
        },
      },
    );
  const root = node("");
  return { trpc: new Proxy({}, { get: (_t, k: string) => (k === "useUtils" ? () => root : root[k]) }) };
});

import "../i18n";
import i18n from "i18next";
import DeviceAdapterManagement from "./DeviceAdapterManagement";

beforeAll(async () => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  await i18n.changeLanguage("vi");
});
beforeEach(async () => {
  for (const f of Object.values(H.toast)) f.mockReset();
  H.updateCalls.length = 0;
  H.invalidated.length = 0;
  H.adapters = [{ id: 7, code: "PLC-7", name: "PLC 7", protocol: "modbus", endpoint: "tcp://10.0.0.7:502", status: "connected", isEnabled: false, machineId: 3, pollIntervalMs: 5000 }];
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

/** Open PLC-7's tag drawer (so the page has an open tag list to refresh), then toggle its "enabled" switch (adapter.update). */
async function toggleWithTagDrawerOpen() {
  render(<DeviceAdapterManagement />);
  const row = screen.getByText("PLC-7").closest("tr")!;
  const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
  // [test, tags, edit, delete] — the tags button is the 2nd (the "enabled" Switch is excluded)
  fireEvent.click(buttons[1]);
  const sw = screen.getAllByRole("switch", { hidden: true }).find((el) => row.contains(el))!;
  fireEvent.click(sw);
  await waitFor(() => expect(H.updateCalls).toHaveLength(1));
  await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
}

describe("final wave G7 — DeviceAdapterManagement wires the C1 stop-pin-cleared answer of adapter.update", () => {
  it("★ stopPinsCleared = 2 ⇒ warning toast with the count AND the open tag list is invalidated", async () => {
    H.updateResult = { success: true, stopPinsCleared: 2 };
    await toggleWithTagDrawerOpen();
    const expected = i18n.t("deviceAdapter.stopPin.toast.adapterPinsCleared", { count: 2 });
    expect(expected).not.toBe("deviceAdapter.stopPin.toast.adapterPinsCleared"); // the real sentence, not a bare key
    expect(H.toast.warning).toHaveBeenCalledWith(expected);
    expect(H.invalidated).toContainEqual({ path: "deviceAdapter.tags.listByAdapter", input: { adapterId: 7 } });
  });

  it("control: stopPinsCleared = 0 ⇒ no warning (the tag list is still refreshed)", async () => {
    H.updateResult = { success: true, stopPinsCleared: 0 };
    await toggleWithTagDrawerOpen();
    expect(H.toast.warning).not.toHaveBeenCalled();
    expect(H.invalidated).toContainEqual({ path: "deviceAdapter.tags.listByAdapter", input: { adapterId: 7 } });
  });
});
