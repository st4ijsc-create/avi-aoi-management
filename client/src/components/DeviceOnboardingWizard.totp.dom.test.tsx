// @vitest-environment jsdom
//
// SCADA R1b-2a Task 11 (R1b-1 backlog mục 12) — wizard onboarding: `deviceAdapter.tags.create` lên khoá orphan được bảo vệ trả
// `SCADA_CONFIG_TOTP_REQUIRED` ⇒ hộp mã 6 số mở, người dùng nhập mã và CHÍNH lượt tạo tag được gửi lại kèm `totpCode`; thành công ⇒
// sang bước 4 (test). Mã sai ⇒ hộp còn mở, ô mã xoá. Lỗi khác ⇒ toast như cũ, không hộp mã. Chỉ mock hợp đồng mạng, `sonner`, socket.
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
  toastTrpcError: vi.fn(),
  /** câu trả lời lần lượt của tags.create: "ok" | appCode của lỗi */
  traLoi: [] as string[],
  calls: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: H.toast }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: H.toastTrpcError, mapTrpcError: (e: unknown) => String((e as { message?: string })?.message ?? e) }));
vi.mock("@/lib/socketManager", () => ({ getSharedSocket: () => ({ on: () => undefined, off: () => undefined, emit: () => undefined }) }));
vi.mock("@/lib/trpc", () => {
  const mutation = (path: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown, v: unknown) => void } = {}) => ({
      isPending: false,
      mutate: (input: unknown) => {
        let kq = "ok";
        if (path === "deviceAdapter.tags.create") {
          H.calls.push(input);
          kq = H.traLoi.shift() ?? "ok";
        }
        queueMicrotask(() => {
          if (kq === "ok") opts.onSuccess?.(path === "deviceAdapter.create" ? { id: 5 } : {});
          else opts.onError?.({ message: kq, data: { appCode: kq } }, input);
        });
      },
    }),
  });
  const node = (path: string): any =>
    new Proxy(
      {},
      {
        get: (_t, k: string) => {
          if (k === "useQuery") return () => ({ data: [], isLoading: false });
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
import DeviceOnboardingWizard from "./DeviceOnboardingWizard";

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
beforeEach(() => {
  for (const f of Object.values(H.toast)) f.mockReset();
  H.toastTrpcError.mockReset();
  H.calls.length = 0;
  H.traLoi = [];
});
afterEach(() => cleanup());

const oMa = () => screen.queryByLabelText(i18n.t("scada.kenh.dialog.totp")) as HTMLInputElement | null;

/** Đi tới bước 3 (tag) rồi bấm "Tạo tag" — một lượt tags.create. */
async function taoTag() {
  render(<DeviceOnboardingWizard open onOpenChange={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("common.next") }));
  fireEvent.change(screen.getByPlaceholderText("line-a-plc1"), { target: { value: "plc1" } });
  fireEvent.change(screen.getByPlaceholderText(/opc\.tcp/), { target: { value: "stub://x" } });
  const ten = screen.getAllByRole("textbox")[1];
  fireEvent.change(ten, { target: { value: "PLC 1" } });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("wizard.createAdapter") }));
  await screen.findByPlaceholderText("temperature");
  fireEvent.change(screen.getByPlaceholderText("temperature"), { target: { value: "sp" } });
  fireEvent.change(screen.getByPlaceholderText(/DB1\.DBD0/), { target: { value: "40001" } });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("wizard.createTag") }));
  await waitFor(() => expect(H.calls).toHaveLength(1));
}

describe("R1b-2a T11 — wizard onboarding nhập được TOTP khi tạo tag lên khoá bảo vệ", () => {
  it("★ TOTP_CAN ⇒ hộp mã (không toast lỗi); nhập 6 số ⇒ lượt 2 gửi {…cùng biến, totpCode}; thành công ⇒ bước 4 (test), hộp đóng", async () => {
    H.traLoi = ["SCADA_CONFIG_TOTP_REQUIRED", "ok"];
    await taoTag();
    const lan1 = H.calls[0] as Record<string, unknown>;
    expect(lan1).not.toHaveProperty("totpCode");
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    expect(H.toastTrpcError).not.toHaveBeenCalled();
    const nut = screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") });
    expect(nut).toBeDisabled();
    fireEvent.change(oMa()!, { target: { value: "123456" } });
    fireEvent.click(nut);
    await waitFor(() => expect(H.calls).toHaveLength(2));
    expect(H.calls[1]).toEqual({ ...lan1, totpCode: "123456" });
    await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("wizard.runTest") })).toBeInTheDocument());
    expect(oMa()).toBeNull();
  });

  it("mã sai ⇒ hộp còn mở, ô mã xoá, báo lỗi; lỗi khác (NOT_ENROLLED) ⇒ toast như cũ, KHÔNG hộp mã", async () => {
    H.traLoi = ["SCADA_CONFIG_TOTP_REQUIRED", "SCADA_CONFIG_TOTP_INVALID"];
    await taoTag();
    await waitFor(() => expect(oMa()).toBeInTheDocument());
    fireEvent.change(oMa()!, { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("deviceAdapter.troLai.submit") }));
    await waitFor(() => expect(H.calls).toHaveLength(2));
    await waitFor(() => expect(H.toastTrpcError).toHaveBeenCalledTimes(1));
    expect(oMa()).toBeInTheDocument();
    expect(oMa()!.value).toBe("");
    cleanup();

    H.calls.length = 0;
    H.toastTrpcError.mockReset();
    H.traLoi = ["SCADA_CONFIG_TOTP_NOT_ENROLLED"];
    await taoTag();
    await waitFor(() => expect(H.toastTrpcError).toHaveBeenCalledTimes(1));
    expect(oMa()).toBeNull();
  });
});
