// @vitest-environment jsdom
//
// kiem-dinh mục 5 (2026-10-24) — màn 2FA của Login: LỐI THOÁT khi TOTP bị tạm khoá.
//   - nhận MÃ DỰ PHÒNG 8 ký tự hex (backupCodeSecret.sinhMaDuPhong: hex HOA) bên cạnh mã TOTP 6 số; REST /api/auth/verify-2fa (oauth.ts)
//     tự phân luồng: đúng 6 số ⇒ TOTP, còn lại ⇒ mã dự phòng;
//   - đang khoá (429 TWOFA_TOTP_LOCKED / TWOFA_BACKUP_LOCKED + remainingMinutes) ⇒ nút gửi KHOÁ cho loại mã bị khoá + đếm ngược phút;
//     khoá TOTP KHÔNG chặn mã dự phòng (đó là lối thoát) và ngược lại;
//   - không bao giờ hiện số lần thử.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

const toastFn = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      login: { useMutation: () => ({ mutateAsync: async () => ({ requires2FA: true, userId: 7 }) }) },
      checkSetupRequired: { useQuery: () => ({ data: { required: false } }) },
      oauthProviders: { useQuery: () => ({ data: [] }) },
    },
  },
}));

import Login from "./Login";

type Tra = { status: number; body: Record<string, unknown> };
let traLoi: Tra[] = [];
const goiFetch: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  traLoi = [];
  goiFetch.length = 0;
  for (const f of Object.values(toastFn)) f.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      goiFetch.push({ url, body: JSON.parse(init?.body ?? "{}") });
      const r = traLoi.shift() ?? { status: 401, body: { code: "TWOFA_INVALID_TOKEN" } };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function denManHinh2FA() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText(S("common.username")), { target: { value: "eng1" } });
  fireEvent.change(screen.getByLabelText(S("common.password")), { target: { value: "pw" } });
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(S("common.password")).closest("form")!);
  });
  await screen.findByLabelText(S("auth.verificationCode"));
}
const oMa = () => screen.getByLabelText(S("auth.verificationCode")) as HTMLInputElement;
const nutXacNhan = () => screen.getByRole("button", { name: S("common.confirm") });
const nhap = (v: string) => fireEvent.change(oMa(), { target: { value: v } });
const gui = async () => {
  await act(async () => {
    fireEvent.submit(oMa().closest("form")!);
  });
};

describe("Login 2FA — mã dự phòng 8 ký tự là lối thoát khi TOTP bị khoá", () => {
  it("mã dự phòng 8 ký tự hex (gõ thường) ⇒ chuẩn hoá HOA, nút bật, gửi đúng token tới /api/auth/verify-2fa", async () => {
    await denManHinh2FA();
    nhap("a1b2-c3d4");
    expect(oMa().value).toBe("A1B2C3D4");
    expect(nutXacNhan()).toBeEnabled();
    await gui();
    expect(goiFetch).toEqual([{ url: "/api/auth/verify-2fa", body: { userId: 7, token: "A1B2C3D4" } }]);
  });

  it("mã TOTP 6 số vẫn chạy như cũ", async () => {
    await denManHinh2FA();
    nhap("123456");
    expect(nutXacNhan()).toBeEnabled();
    await gui();
    expect(goiFetch[0]?.body).toEqual({ userId: 7, token: "123456" });
  });

  it("độ dài / ký tự không phải TOTP 6 số cũng không phải mã dự phòng 8 hex ⇒ nút khoá, không gửi", async () => {
    await denManHinh2FA();
    for (const v of ["12345", "1234567", "ABC123", "A1B2C3"]) {
      nhap(v);
      expect(nutXacNhan(), v).toBeDisabled();
    }
    nhap("A1B2C3D4E5");
    expect(oMa().value).toBe("A1B2C3D4"); // tối đa 8 ký tự
    nhap("ZZZZ1234");
    expect(oMa().value).toBe("1234"); // chỉ hex
    await gui();
    expect(goiFetch).toHaveLength(0);
  });

  it("★ 429 TWOFA_TOTP_LOCKED {remainingMinutes:4} ⇒ mã 6 số: nút KHOÁ + đếm ngược '4 phút'; mã dự phòng VẪN gửi được; hết giờ ⇒ mở lại; không có số lần", async () => {
    await denManHinh2FA();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    traLoi.push({ status: 429, body: { code: "TWOFA_TOTP_LOCKED", remainingMinutes: 4, error: "x" } });
    nhap("123456");
    await gui();
    expect(toastFn.error).toHaveBeenCalledWith(S("auth.twoFactor.totpLocked", { minutes: 4 }));
    expect(nutXacNhan()).toBeDisabled();
    const dem = screen.getByTestId("dem-nguoc-khoa-2fa");
    expect(dem).toHaveTextContent(S("auth.twoFactor.demNguocTotp", { minutes: 4 }));
    expect(document.body.textContent ?? "").not.toMatch(/\d+\s*(lần|attempt)/i);
    await gui(); // Enter trong lúc khoá ⇒ không gửi
    expect(goiFetch).toHaveLength(1);

    nhap("A1B2C3D4"); // lối thoát
    expect(nutXacNhan()).toBeEnabled();
    nhap("123456");
    expect(nutXacNhan()).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(3 * 60_000 + 1_000);
    });
    expect(screen.getByTestId("dem-nguoc-khoa-2fa")).toHaveTextContent(S("auth.twoFactor.demNguocTotp", { minutes: 1 }));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId("dem-nguoc-khoa-2fa")).toBeNull();
    expect(nutXacNhan()).toBeEnabled();
  });

  it("429 TWOFA_BACKUP_LOCKED {remainingMinutes:30} ⇒ mã dự phòng KHOÁ + đếm ngược; mã TOTP 6 số vẫn gửi được", async () => {
    await denManHinh2FA();
    traLoi.push({ status: 429, body: { code: "TWOFA_BACKUP_LOCKED", remainingMinutes: 30 } });
    nhap("A1B2C3D4");
    await gui();
    expect(nutXacNhan()).toBeDisabled();
    expect(screen.getByTestId("dem-nguoc-khoa-2fa")).toHaveTextContent(S("auth.twoFactor.demNguocBackup", { minutes: 30 }));
    nhap("654321");
    expect(nutXacNhan()).toBeEnabled();
    await gui();
    await waitFor(() => expect(goiFetch).toHaveLength(2));
    expect(goiFetch[1]?.body.token).toBe("654321");
  });
});
