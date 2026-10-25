// @vitest-environment jsdom
//
// SCADA R1b-1 Task 9 — trỏ lại tag ĐÃ KHAI cần mã TOTP: trang Device Adapter KHÔNG hiện ô mã sẵn; khi `deviceAdapter.tags.update` trả
// `SCADA_CONFIG_TOTP_REQUIRED` (ma TOTP_CAN) thì hộp mã 6 số mở, người dùng nhập mã và lượt CŨ được gửi lại kèm `totpCode`. Mã sai ⇒ hộp
// giữ nguyên, ô mã bị xoá. Lỗi khác ⇒ không có hộp mã, chỉ báo lỗi như cũ. Chỉ mock hợp đồng mạng (`@/lib/trpc`), `sonner`, quyền, khung
// trang (khuôn DeviceAdapterManagement.updateWiring.dom.test.tsx). Gói vi thật.
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
  /** lần lượt các câu trả lời của tags.update: "ok" | appCode của lỗi */
  traLoi: [] as string[],
  calls: [] as unknown[],
  /** fix round 1 — câu trả lời / lượt gọi của các mutation khác (deviceAdapter.update, tags.delete) theo path */
  traLoiKhac: {} as Record<string, string[]>,
  callsKhac: {} as Record<string, unknown[]>,
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
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown, v: unknown) => void } = {}) => ({
      isPending: false,
      mutate: (input: unknown) => {
        let kq: string;
        if (path === "deviceAdapter.tags.update") {
          H.calls.push(input);
          kq = H.traLoi.shift() ?? "ok";
        } else if (path === "deviceAdapter.update" || path === "deviceAdapter.tags.delete" || path === "deviceAdapter.delete") {
          (H.callsKhac[path] ??= []).push(input);
          kq = H.traLoiKhac[path]?.shift() ?? "ok";
        } else return;
        queueMicrotask(() => {
          if (kq === "ok") opts.onSuccess?.({ ...(input as object) });
          else opts.onError?.({ message: kq, data: { appCode: kq, appParams: { ma: kq } } }, input);
        });
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
  H.calls.length = 0;
  H.traLoi = [];
  H.traLoiKhac = {};
  H.callsKhac = {};
  H.adapters = [{ id: 7, code: "PLC-7", name: "PLC 7", protocol: "modbus", endpoint: "tcp://10.0.0.7:502", status: "connected", isEnabled: false, machineId: 3, pollIntervalMs: 5000 }];
  // tag KHÔNG ghim DỪNG ⇒ công tắc "Ghi được" gửi ngay (không hộp xác nhận gỡ ghim)
  H.tags = [{ id: 41, adapterId: 7, tagKey: "sp", address: "40001", dataType: "int", writable: false, isEnabled: true, stopValue: null, scale: "1", offset: "0" }];
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

/** Mở ngăn tag của PLC-7 rồi bật công tắc "Ghi được" của tag `sp` (một lượt tags.update). */
async function batGhiDuoc() {
  render(<DeviceAdapterManagement />);
  const row = screen.getByText("PLC-7").closest("tr")!;
  const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
  fireEvent.click(buttons[1]); // [kiểm tra, tag, sửa, xoá]
  const sw = await screen.findByRole("switch", { name: /Ghi được: sp/ });
  fireEvent.click(sw);
  await waitFor(() => expect(H.calls).toHaveLength(1));
}

const oMa = () => screen.queryByLabelText(i18n.t("scada.kenh.dialog.totp"));

describe("R1b-1 T9 — Device Adapter: trỏ lại tag đã khai hỏi mã TOTP khi máy chủ đòi", () => {
  it("★ TOTP_CAN ⇒ hộp mã mở (không toast lỗi); nhập 6 số + xác nhận ⇒ CHÍNH lượt đó gửi lại kèm totpCode; thành công ⇒ hộp đóng", async () => {
    H.traLoi = ["SCADA_CONFIG_TOTP_REQUIRED", "ok"];
    await batGhiDuoc();
    expect(H.calls[0]).toEqual({ id: 41, writable: true });
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    expect(screen.getByText(i18n.t("deviceAdapter.troLai.body"))).toBeInTheDocument();
    expect(H.toast.error).not.toHaveBeenCalled();
    const nut = screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") });
    expect(nut).toBeDisabled(); // chưa đủ 6 số
    fireEvent.change(oMa()!, { target: { value: "12a3456" } }); // chỉ nhận chữ số
    expect(nut).toBeEnabled();
    fireEvent.click(nut);
    await waitFor(() => expect(H.calls).toHaveLength(2));
    expect(H.calls[1]).toEqual({ id: 41, writable: true, totpCode: "123456" });
    await waitFor(() => expect(oMa()).not.toBeInTheDocument());
    expect(H.toast.success).toHaveBeenCalled();
  });

  it("mã SAI khi gửi lại ⇒ hộp vẫn mở, ô mã bị xoá, có báo lỗi", async () => {
    H.traLoi = ["SCADA_CONFIG_TOTP_REQUIRED", "SCADA_CONFIG_TOTP_INVALID"];
    await batGhiDuoc();
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    fireEvent.change(oMa()!, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.calls).toHaveLength(2));
    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    expect(oMa()).toBeInTheDocument();
    expect((oMa() as HTMLInputElement).value).toBe("");
  });

  it("control: lỗi KHÁC (INTERLOCK_NGOAI_DAI) ⇒ không có hộp mã, báo lỗi như cũ", async () => {
    H.traLoi = ["INTERLOCK_NGOAI_DAI"];
    await batGhiDuoc();
    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    expect(oMa()).not.toBeInTheDocument();
  });

  it("fix round 1 (I5): đổi endpoint adapter ⇒ máy chủ đòi mã ⇒ hộp mã mở; xác nhận ⇒ gửi lại CHÍNH biến cũ kèm totpCode", async () => {
    H.traLoiKhac["deviceAdapter.update"] = ["SCADA_CONFIG_TOTP_REQUIRED", "ok"];
    render(<DeviceAdapterManagement />);
    const row = screen.getByText("PLC-7").closest("tr")!;
    const sw = [...row.querySelectorAll("[role=switch]")][0] as HTMLElement; // công tắc "Bật" của adapter ⇒ deviceAdapter.update
    fireEvent.click(sw);
    await waitFor(() => expect(H.callsKhac["deviceAdapter.update"]).toHaveLength(1));
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    fireEvent.change(oMa()!, { target: { value: "111222" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.callsKhac["deviceAdapter.update"]).toHaveLength(2));
    expect(H.callsKhac["deviceAdapter.update"][1]).toEqual({ ...(H.callsKhac["deviceAdapter.update"][0] as object), totpCode: "111222" });
    await waitFor(() => expect(oMa()).not.toBeInTheDocument());
  });

  it("fix round 1 (C1): xoá tag đã khai ⇒ hộp mã gửi lại {id, totpCode}; lỗi KHÁC khi gửi lại ⇒ hộp đóng + báo lỗi; lượt sau hỏi lại với ô trống", async () => {
    H.traLoiKhac["deviceAdapter.tags.delete"] = ["SCADA_CONFIG_TOTP_REQUIRED", "INTERLOCK_MAT_DICH", "SCADA_CONFIG_TOTP_REQUIRED"];
    render(<DeviceAdapterManagement />);
    const row = screen.getByText("PLC-7").closest("tr")!;
    const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
    fireEvent.click(buttons[1]);
    const tagRow = (await screen.findByRole("switch", { name: /Ghi được: sp/ })).closest("tr")!;
    const nutXoa = [...tagRow.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch").pop()!;
    const xoa = async () => {
      fireEvent.click(nutXoa);
      const dlg = await screen.findByRole("alertdialog");
      fireEvent.click([...dlg.querySelectorAll("button")].pop()!); // nút xác nhận xoá
    };
    await xoa();
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    fireEvent.change(oMa()!, { target: { value: "333444" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.callsKhac["deviceAdapter.tags.delete"]).toHaveLength(2));
    expect(H.callsKhac["deviceAdapter.tags.delete"][1]).toEqual({ id: 41, totpCode: "333444" });
    await waitFor(() => expect(oMa()).not.toBeInTheDocument());
    expect(H.toast.error).toHaveBeenCalled();
    await xoa(); // lượt mới — hộp mở lại với ô TRỐNG
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    expect((oMa() as HTMLInputElement).value).toBe("");
  });

  it("★ R1b-1 T10b (m2e): XOÁ ADAPTER còn tag được bảo vệ ⇒ máy chủ đòi mã ⇒ hộp mã (không toast lỗi); xác nhận ⇒ gửi lại {id, totpCode}; thành công ⇒ hộp đóng + báo đã xoá", async () => {
    H.traLoiKhac["deviceAdapter.delete"] = ["SCADA_CONFIG_TOTP_REQUIRED", "ok"];
    render(<DeviceAdapterManagement />);
    const row = screen.getByText("PLC-7").closest("tr")!;
    const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
    fireEvent.click(buttons[buttons.length - 1]); // [kiểm tra, tag, sửa, xoá] — nút xoá adapter
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click([...dlg.querySelectorAll("button")].pop()!); // nút xác nhận xoá
    await waitFor(() => expect(H.callsKhac["deviceAdapter.delete"]).toHaveLength(1));
    expect(H.callsKhac["deviceAdapter.delete"][0]).toEqual({ id: 7 });
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    expect(screen.getByText(i18n.t("deviceAdapter.troLai.body"))).toBeInTheDocument();
    expect(H.toast.error).not.toHaveBeenCalled();
    fireEvent.change(oMa()!, { target: { value: "777888" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.callsKhac["deviceAdapter.delete"]).toHaveLength(2));
    expect(H.callsKhac["deviceAdapter.delete"][1]).toEqual({ id: 7, totpCode: "777888" });
    await waitFor(() => expect(oMa()).not.toBeInTheDocument());
    expect(H.toast.success).toHaveBeenCalled();
  });

  it("R1b-1 T10b (m2e): xoá adapter — lỗi KHÁC (INTERLOCK_MAT_DICH) ⇒ không có hộp mã, báo lỗi; mã SAI khi gửi lại ⇒ hộp giữ, ô mã xoá", async () => {
    H.traLoiKhac["deviceAdapter.delete"] = ["INTERLOCK_MAT_DICH", "SCADA_CONFIG_TOTP_REQUIRED", "SCADA_CONFIG_TOTP_INVALID"];
    render(<DeviceAdapterManagement />);
    const xoa = async () => {
      const row = screen.getByText("PLC-7").closest("tr")!;
      const buttons = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "switch");
      fireEvent.click(buttons[buttons.length - 1]);
      const dlg = await screen.findByRole("alertdialog");
      fireEvent.click([...dlg.querySelectorAll("button")].pop()!);
    };
    await xoa();
    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    expect(oMa()).not.toBeInTheDocument();
    H.toast.error.mockReset();
    await xoa();
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    fireEvent.change(oMa()!, { target: { value: "999000" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.callsKhac["deviceAdapter.delete"]).toHaveLength(3));
    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    expect(oMa()).toBeInTheDocument();
    expect((oMa() as HTMLInputElement).value).toBe("");
  });
});
