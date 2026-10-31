// @vitest-environment jsdom
//
// SCADA R1b-2b-2b A — C2 fix 1 (dieu-phoi 2026-10-31): hàng adapter máy chủ đã CHE chi tiết kỹ thuật (`endpoint: null`, `connectionOptions: null` —
// người xem không phải admin/engineer có machine_control.canEdit). Bảng hiện "—"; hộp sửa ẩn endpoint / cấu hình kết nối / nút kiểm tra kết nối,
// không bao giờ gọi `.trim()` trên null, và lượt lưu KHÔNG mang `endpoint` / `connectionOptions` (máy chủ cũng từ chối — chốt mất dữ liệu).
// Đối chứng: hàng không che giữ nguyên hành vi cũ. Khuôn mock của DeviceAdapterManagement.troLaiTotp.dom.test.tsx (chỉ mock hợp đồng mạng).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

const H = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  calls: {} as Record<string, unknown[]>,
  adapters: [] as unknown[],
  /** C2 fix 2 — câu trả lời của deviceAdapter.testConnection (null ⇒ ok) */
  traLoiDo: null as Record<string, unknown> | null,
}));

vi.mock("sonner", () => ({ toast: H.toast }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true, isAdmin: false }) }));
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
        (H.calls[path] ??= []).push(input);
        const kq = path === "deviceAdapter.testConnection" && H.traLoiDo ? H.traLoiDo : { ...(input as object), ok: true, latencyMs: 1 };
        queueMicrotask(() => opts.onSuccess?.(kq));
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
const hangGoc = { id: 7, code: "PLC-7", name: "PLC 7", protocol: "modbus", status: "connected", isEnabled: false, machineId: 3, pollIntervalMs: 5000 };
beforeEach(async () => {
  for (const f of Object.values(H.toast)) f.mockReset();
  H.calls = {};
  H.traLoiDo = null;
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

/** Mở hộp sửa của PLC-7 — nút tìm theo vai + tên truy cập (C2 fix 2, review m7), không theo vị trí. */
function moSua() {
  render(<DeviceAdapterManagement />);
  const row = screen.getByText("PLC-7").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: i18n.t("deviceAdapter.editAdapter") }));
  return row;
}
const oEndpoint = () => screen.queryByPlaceholderText("opc.tcp://… / tcp://host:port / stub://x");
const nutKiemKetNoi = () => screen.queryByRole("button", { name: i18n.t("deviceAdapter.testConn") });

describe("C2 fix 1 — Device Adapter: hàng bị che (endpoint / connectionOptions null)", () => {
  it("★ bảng hiện '—'; hộp sửa ẩn endpoint + nút kiểm tra kết nối, có ghi chú; Lưu gửi tên mới, KHÔNG có endpoint / connectionOptions", async () => {
    H.adapters = [{ ...hangGoc, endpoint: null, connectionOptions: null, lastError: "ADAPTER_OFFLINE", maLoi: "ADAPTER_OFFLINE", tamKhoa: null }];
    const row = moSua();
    const o = [...row.querySelectorAll("td")][3];
    expect(o).toHaveTextContent("—");
    expect(o).not.toHaveAttribute("title");
    expect(await screen.findByTestId("adapter-bi-che")).toHaveTextContent(i18n.t("deviceAdapter.chiTietBiChe"));
    expect(oEndpoint()).not.toBeInTheDocument();
    expect(nutKiemKetNoi()).not.toBeInTheDocument();
    const oTen = screen.getByDisplayValue("PLC 7");
    fireEvent.change(oTen, { target: { value: "PLC 7 mới" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(H.calls["deviceAdapter.update"]).toHaveLength(1));
    const gui = H.calls["deviceAdapter.update"][0] as Record<string, unknown>;
    expect(gui).toMatchObject({ id: 7, name: "PLC 7 mới", isEnabled: false, pollIntervalMs: 5000, machineId: 3 });
    expect("endpoint" in gui).toBe(false);
    expect("connectionOptions" in gui).toBe(false);
    expect("protocol" in gui).toBe(false); // C2 fix 2 — máy chủ từ chối protocol từ người bị che
    expect(H.calls["deviceAdapter.testConnection"]).toBeUndefined();
  });

  it("đối chứng: hàng KHÔNG che ⇒ ô endpoint + nút kiểm tra kết nối hiện, Lưu gửi endpoint như cũ", async () => {
    H.adapters = [{ ...hangGoc, endpoint: "tcp://10.0.0.7:502", connectionOptions: null, lastError: null, maLoi: null, tamKhoa: null }];
    const row = moSua();
    expect([...row.querySelectorAll("td")][3]).toHaveAttribute("title", "tcp://10.0.0.7:502");
    expect(screen.queryByTestId("adapter-bi-che")).not.toBeInTheDocument();
    expect(oEndpoint()).toHaveValue("tcp://10.0.0.7:502");
    expect(nutKiemKetNoi()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(H.calls["deviceAdapter.update"]).toHaveLength(1));
    expect(H.calls["deviceAdapter.update"][0]).toMatchObject({ id: 7, endpoint: "tcp://10.0.0.7:502" });
  });
});

describe("C2 fix 2 — nút 'Kiểm tra' của hàng: máy chủ bỏ văn bản driver (không có error) ⇒ toast hiện câu DỊCH của errorCode", () => {
  it("không có error + errorCode DEVICE_UNREACHABLE ⇒ toast lỗi mang câu đã dịch (không 'unknown'); có văn bản ⇒ hiện văn bản (kỹ sư)", async () => {
    H.adapters = [{ ...hangGoc, endpoint: null, connectionOptions: null, lastError: null, maLoi: null, tamKhoa: null }];
    H.traLoiDo = { ok: false, latencyMs: 3, errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "modbus" } }; // không có khoá error (bị che)
    render(<DeviceAdapterManagement />);
    const row = screen.getByText("PLC-7").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: i18n.t("deviceAdapter.test") }));
    await waitFor(() => expect(H.toast.error).toHaveBeenCalledTimes(1));
    expect(H.calls["deviceAdapter.testConnection"]).toEqual([{ id: 7 }]);
    const dich = i18n.t("errors.DEVICE_UNREACHABLE", { entity: "modbus" });
    expect(dich).not.toBe("errors.DEVICE_UNREACHABLE");
    const cau = String(H.toast.error.mock.calls[0][0]);
    expect(cau).not.toContain("unknown");
    expect(cau).toContain(dich.slice(0, 12));
    cleanup();
    H.toast.error.mockReset();
    H.traLoiDo = { ok: false, latencyMs: 3, errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "modbus" }, error: "connect ECONNREFUSED 10.0.0.5:502" };
    render(<DeviceAdapterManagement />);
    fireEvent.click(within(screen.getByText("PLC-7").closest("tr")!).getByRole("button", { name: i18n.t("deviceAdapter.test") }));
    await waitFor(() => expect(H.toast.error).toHaveBeenCalledTimes(1));
    expect(String(H.toast.error.mock.calls[0][0])).toContain("ECONNREFUSED 10.0.0.5:502");
  });
});
