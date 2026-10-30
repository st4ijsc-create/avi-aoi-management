// @vitest-environment jsdom
//
// R1b-2b-2b B-T10 (mục 38) — màn admin mở khoá TOTP của người dùng KHÁC (`twoFactor.moKhoaTotp`, adminProcedure).
// Hợp đồng máy chủ (C6): vào `{ userId, lyDo 5..300 }`, ra `{ success, daMoKhoa }`; lỗi: tự mở khoá (FORBIDDEN totpSelfUnlock),
// NOT_FOUND user (một câu chung cho mọi nguyên nhân), RATE_LIMITED (3 lần/giờ/người bị mở — KHÔNG thử lại tự động).
// Component THẬT (trang Users) + bundle vi.json THẬT + `mapTrpcError` THẬT; chỉ mock hợp đồng mạng, quyền, khung trang, sonner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

const H = vi.hoisted(() => ({
  role: "admin",
  moKhoa: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: H.toastSuccess, info: H.toastInfo, error: H.toastError, warning: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: H.role, name: "Tôi" }, loading: false, isAuthenticated: true }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: H.role === "admin", loading: false, hasPermission: () => true }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ViewOnlyBadge: () => null,
}));

const USERS = [
  { id: 1, name: "Tôi Admin", username: "toi", email: "t@x", role: "admin", isActive: true, loginMethod: "local", lastSignedIn: new Date(), createdAt: new Date(), updatedAt: new Date() },
  { id: 2, name: "Người Khác", username: "khac", email: "k@x", role: "user", isActive: true, loginMethod: "local", lastSignedIn: new Date(), createdAt: new Date(), updatedAt: new Date() },
];

vi.mock("@/lib/trpc", () => {
  const mut = { useMutation: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }) };
  return {
    trpc: {
      useUtils: () => ({}),
      user: {
        list: { useQuery: () => ({ data: USERS, isLoading: false, refetch: vi.fn() }) },
        create: mut,
        update: mut,
        updatePassword: mut,
        delete: mut,
        updateRole: mut,
      },
      twoFactor: {
        moKhoaTotp: {
          useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
            isPending: false,
            mutate: (vars: unknown) => {
              Promise.resolve(H.moKhoa(vars)).then(
                (r) => opts?.onSuccess?.(r),
                (e) => opts?.onError?.(e),
              );
            },
          }),
        },
      },
    },
  };
});

import Users from "./Users";

const loiApp = (code: string, appCode: string, appParams?: Record<string, unknown>) =>
  Object.assign(new Error(code), { data: { code, appCode, appParams } });

const hangCua = (ten: string) => screen.getByText(ten).closest("tr") as HTMLElement;
const nutMoKhoa = (ten: string) => within(hangCua(ten)).queryByRole("button", { name: S("users.totp.moKhoa.nut") });

async function moHopVaGui(ten: string, lyDo = "Người dùng mất điện thoại") {
  fireEvent.click(nutMoKhoa(ten)!);
  const dlg = await screen.findByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText(S("users.totp.moKhoa.lyDo")), { target: { value: lyDo } });
  fireEvent.click(within(dlg).getByRole("button", { name: S("users.totp.moKhoa.gui") }));
  return dlg;
}

beforeEach(() => {
  initLayoutKitTestI18n();
  H.role = "admin";
  H.moKhoa.mockReset();
  H.toastSuccess.mockReset();
  H.toastInfo.mockReset();
  H.toastError.mockReset();
});
afterEach(() => cleanup());

describe("Users — mở khoá TOTP (mục 38)", () => {
  it("admin: hàng người KHÁC có hành động, hàng CỦA CHÍNH MÌNH thì không", () => {
    render(<Users />);
    expect(nutMoKhoa("Người Khác")).toBeTruthy();
    expect(nutMoKhoa("Tôi Admin")).toBeNull();
  });

  it("vai không phải admin ⇒ không có hành động ở hàng nào", () => {
    H.role = "user";
    render(<Users />);
    expect(nutMoKhoa("Người Khác")).toBeNull();
  });

  it("lý do < 5 ký tự ⇒ nút gửi khoá; đủ ⇒ gửi đúng { userId, lyDo } (đã trim)", async () => {
    H.moKhoa.mockResolvedValue({ success: true, daMoKhoa: true });
    render(<Users />);
    fireEvent.click(nutMoKhoa("Người Khác")!);
    const dlg = await screen.findByRole("dialog");
    const gui = within(dlg).getByRole("button", { name: S("users.totp.moKhoa.gui") });
    const o = within(dlg).getByLabelText(S("users.totp.moKhoa.lyDo"));
    fireEvent.change(o, { target: { value: "abcd" } });
    expect(gui).toBeDisabled();
    fireEvent.change(o, { target: { value: "  mất điện thoại  " } });
    expect(gui).toBeEnabled();
    fireEvent.click(gui);
    await waitFor(() => expect(H.moKhoa).toHaveBeenCalledTimes(1));
    expect(H.moKhoa).toHaveBeenCalledWith({ userId: 2, lyDo: "mất điện thoại" });
  });

  it("daMoKhoa:true ⇒ 'Đã mở khoá…'; daMoKhoa:false ⇒ 'không bị khoá (đã ghi nhật ký)' — hai câu khác nhau", async () => {
    H.moKhoa.mockResolvedValueOnce({ success: true, daMoKhoa: true });
    const { unmount } = render(<Users />);
    await moHopVaGui("Người Khác");
    await waitFor(() => expect(H.toastSuccess).toHaveBeenCalledWith(S("users.totp.moKhoa.daMoKhoa")));
    unmount();
    cleanup();
    H.moKhoa.mockResolvedValueOnce({ success: true, daMoKhoa: false });
    render(<Users />);
    await moHopVaGui("Người Khác");
    await waitFor(() => expect(H.toastInfo).toHaveBeenCalledWith(S("users.totp.moKhoa.khongBiKhoa")));
    expect(S("users.totp.moKhoa.daMoKhoa")).not.toBe(S("users.totp.moKhoa.khongBiKhoa"));
  });

  it("★ ba lỗi của máy chủ ⇒ ba câu đã dịch; RATE_LIMITED KHÔNG tự thử lại; không bao giờ hiện số lần sai", async () => {
    const ca: Array<[Error, string]> = [
      [loiApp("FORBIDDEN", "PERMISSION_DENIED", { action: "adminAccess", reason: "totpSelfUnlock" }), "Không tự mở khoá xác thực hai lớp"],
      [loiApp("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }), "Không tìm thấy"],
      [loiApp("TOO_MANY_REQUESTS", "RATE_LIMITED"), S("errors.RATE_LIMITED")],
    ];
    for (const [loi, cauMongDoi] of ca) {
      H.moKhoa.mockReset();
      H.toastError.mockReset();
      H.moKhoa.mockRejectedValue(loi);
      const { unmount } = render(<Users />);
      await moHopVaGui("Người Khác");
      await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
      const cau = H.toastError.mock.calls[0][0] as string;
      expect(cau).not.toMatch(/undefined|null|\{\{/);
      expect(cau).toContain(cauMongDoi);
      expect(H.moKhoa).toHaveBeenCalledTimes(1); // không thử lại tự động
      expect(H.toastSuccess).not.toHaveBeenCalled();
      unmount();
      cleanup();
    }
  });
});
