// @vitest-environment jsdom
//
// SCADA R1b-2b-1 Task 12 (muc 49) — lưới hồi quy cho việc gỡ nhánh chết `tagForm.id` của `submitTag`: form "Thêm tag" của ngăn tag
// CHỈ tạo. Điền tagKey/address, bấm lưu ⇒ đúng MỘT `tags.create` {adapterId:7, tagKey, address, …}, 0 lượt `tags.update`.
// Ca "sửa qua form" KHÔNG dựng được CHỦ Ý: không còn lối vào nào đặt `tagForm.id` (form sửa tag thật, có cột nhịp + TOTP, sang R1b-2b-2).
// Chỉ mock hợp đồng mạng (`@/lib/trpc`), `sonner`, quyền, khung trang (khuôn DeviceAdapterManagement.troLaiTotp.dom.test.tsx).
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
  /** mọi lượt mutate theo path: { proc, vars } */
  goi: [] as { proc: string; vars: unknown }[],
  adapters: [] as unknown[],
  tags: [] as unknown[],
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
      if (path === "deviceAdapter.tags.listByAdapter") return { data: H.tags, isLoading: false };
      return { data: [], isLoading: false };
    },
  });
  const mutation = (path: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void } = {}) => ({
      isPending: false,
      mutate: (input: unknown) => {
        H.goi.push({ proc: path.replace(/^deviceAdapter\./, ""), vars: input });
        queueMicrotask(() => opts.onSuccess?.({ ...(input as object) }));
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
          if (k === "invalidate") return () => undefined;
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
  H.goi.length = 0;
  H.adapters = [{ id: 7, code: "PLC-7", name: "PLC 7", protocol: "modbus", endpoint: "tcp://10.0.0.7:502", status: "connected", isEnabled: false, machineId: 3, pollIntervalMs: 5000 }];
  H.tags = [{ id: 41, adapterId: 7, tagKey: "sp", address: "40001", dataType: "int", writable: false, isEnabled: true, stopValue: null, scale: "1", offset: "0" }];
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

/** Ô nhập nằm cạnh nhãn `text` trong form "Thêm tag". */
const oCanh = (text: string) => screen.getAllByText(text).map((e) => e.parentElement!.querySelector("input")).filter(Boolean).pop() as HTMLInputElement;

describe("R1b-2b-1 T12 — form Thêm tag chỉ tạo (nhánh sửa qua tagForm.id đã gỡ)", () => {
  it("★ điền tagKey + address, bấm Thêm tag ⇒ đúng một tags.create {adapterId:7,…}, 0 lượt tags.update", async () => {
    render(<DeviceAdapterManagement />);
    const row = screen.getByText("PLC-7").closest("tr")!;
    const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
    fireEvent.click(buttons[1]); // [kiểm tra, tag, sửa, xoá]
    await screen.findByRole("switch", { name: /Ghi được: sp/ });
    fireEvent.change(oCanh(i18n.t("deviceAdapter.tag.key")), { target: { value: "  mới  " } });
    fireEvent.change(oCanh(i18n.t("deviceAdapter.tag.address")), { target: { value: " 40010 " } });
    const nut = screen.getByRole("button", { name: i18n.t("deviceAdapter.addTag") });
    expect(nut).toBeEnabled();
    fireEvent.click(nut);
    await waitFor(() => expect(H.goi.filter((c) => c.proc === "tags.create")).toHaveLength(1));
    const tao = H.goi.find((c) => c.proc === "tags.create")!;
    expect(tao.vars).toMatchObject({ adapterId: 7, tagKey: "mới", address: "40010", dataType: "float", writable: false, isEnabled: true });
    expect(H.goi.filter((c) => c.proc === "tags.update")).toHaveLength(0);
  });
});
