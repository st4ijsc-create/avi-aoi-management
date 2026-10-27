// @vitest-environment jsdom
//
// R1b-2b-2b B-T2 (mục 30, I-2) — hộp thư hành động AI (AIActionInbox) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN lệnh
// mức >= 4 của AI bằng lỗi FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (máy chủ GIỮ NGUYÊN hàng đề xuất):
//   · đúng MỘT toast lỗi mang câu vi THẬT (có "mức tác động 4"); không toast thứ hai (lưới cuối main.tsx bị tắt bằng onError rỗng);
//   · hàng ấy chuyển "đã bị từ chối": nút Duyệt biến mất ⇒ bấm lại không gọi confirmAction lần hai;
//   · đối chứng: lỗi khác ⇒ nút Duyệt còn.
// Dựng component THẬT + bundle i18n THẬT; chỉ mock hạ tầng (trpc, socket, sonner, wouter).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  invalidate: vi.fn(),
  confirmOptions: null as null | { onError?: unknown },
}));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: H.toastSuccess, warning: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@/lib/socketManager", () => ({ getSharedSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock("@/components/RealtimeBadge", () => ({ RealtimeBadge: () => null, useSocketConnected: () => true }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ aiInbox: { list: { invalidate: H.invalidate }, count: { invalidate: H.invalidate } } }),
    aiInbox: {
      list: {
        useQuery: () => ({
          isLoading: false,
          data: {
            items: [
              {
                id: "act-1",
                type: "proposal",
                severity: "warning",
                title: "Đề xuất đặt tốc độ",
                body: "Đặt SP = 5",
                actions: ["approve", "dismiss"],
                createdAt: new Date().toISOString(),
                actionId: "act-1",
                token: "act-1",
              },
            ],
          },
        }),
      },
      dismiss: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
    aiCopilot: {
      confirmAction: {
        useMutation: (opts?: { onError?: unknown }) => {
          H.confirmOptions = opts ?? null;
          return { isPending: false, mutateAsync: H.confirm };
        },
      },
    },
  },
}));

import { AIActionInbox } from "./AIActionInbox";

const loiAppCode = (appCode: string, appParams?: Record<string, unknown>) =>
  Object.assign(new Error("FORBIDDEN"), { data: { appCode, appParams, code: "FORBIDDEN" } });

const CAU_MUC_QUA_CAO = (vi_ as unknown as { errors: Record<string, string> }).errors.SCADA_AI_LEVEL_TOO_HIGH.replace(
  "{{level}}",
  "4",
);

beforeEach(() => {
  initLayoutKitTestI18n();
  H.confirm.mockReset();
  H.toastError.mockReset();
  H.toastSuccess.mockReset();
  H.invalidate.mockReset();
});
afterEach(() => cleanup());

const nutDuyet = () => screen.queryByRole("button", { name: vi_.aiInbox.actions.approve });

describe("AIActionInbox — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("cầu chì: câu vi thật có 'mức tác động 4' (nếu khoá mất, các ca dưới xanh vô nghĩa)", () => {
    expect(CAU_MUC_QUA_CAO).toContain("mức tác động 4");
  });

  it("★ bị từ chối vĩnh viễn ⇒ một toast câu vi thật, không toast thứ hai, nút Duyệt biến mất, bấm lại không gọi lần hai", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_AI_LEVEL_TOO_HIGH", { ma: "MUC_QUA_CAO", level: 4 }));
    render(<AIActionInbox open onOpenChange={() => undefined} />);
    fireEvent.click(nutDuyet()!);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).toHaveBeenCalledWith(CAU_MUC_QUA_CAO);
    expect(H.toastSuccess).not.toHaveBeenCalled();
    // lưới cuối của main.tsx bị tắt cho mutation này ⇒ đúng một chỗ hiện lỗi
    expect(typeof H.confirmOptions?.onError).toBe("function");
    await waitFor(() => expect(nutDuyet()).not.toBeInTheDocument());
    expect(H.confirm).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: lỗi KHÁC ⇒ nút Duyệt còn (có thể thử lại)", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_ROLE_FLOOR"));
    render(<AIActionInbox open onOpenChange={() => undefined} />);
    fireEvent.click(nutDuyet()!);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).not.toHaveBeenCalledWith(CAU_MUC_QUA_CAO);
    expect(nutDuyet()).toBeInTheDocument();
  });
});
