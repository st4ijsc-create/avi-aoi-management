// @vitest-environment jsdom
//
// R1b-2b-2b B-T2 (mục 30, I-2) — hộp duyệt (ApprovalsInbox, nguồn 2: đề xuất AI) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN
// lệnh mức >= 4 của AI bằng FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (máy chủ GIỮ NGUYÊN hàng đề xuất):
//   · đúng MỘT toast lỗi mang câu vi THẬT (có "mức tác động 4"); không toast thứ hai;
//   · nút Duyệt của hàng ấy biến mất ⇒ bấm lại không gọi confirmAction lần hai; đối chứng: lỗi khác ⇒ nút còn.
// Component THẬT + bundle i18n THẬT; chỉ mock hạ tầng (trpc, quyền, khung trang, sonner, wouter).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  confirmOptions: null as null | { onError?: unknown },
}));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: H.toastSuccess, warning: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()], useSearch: () => "" }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => false, isAdmin: false }) }));
vi.mock("@/hooks/useActuationReadiness", () => ({ useActuationReadiness: () => ({ ready: true, blockers: [] }) }));
vi.mock("@/components/security/StepUpOtpDialog", () => ({ useStepUpOtp: () => ({ guard: vi.fn(), dialog: null }) }));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const ITEMS = vi.hoisted(() => [
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
]);

vi.mock("@/lib/trpc", () => {
  const query = (data?: unknown) => ({ useQuery: () => ({ data, isLoading: false, isError: false, refetch: vi.fn() }) });
  const mutation = { useMutation: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }) };
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({
        aiInbox: { list: inv, count: inv },
        thresholdApproval: { list: inv },
        programming: { listDeployApprovals: inv, listDeployments: inv },
      }),
      auth: { me: query({ id: 1 }) },
      thresholdApproval: { list: query([]), approve: mutation, reject: mutation },
      aiInbox: { list: query({ items: ITEMS }), dismiss: mutation },
      programming: { listDeployApprovals: query([]), approveDeployment: mutation, rejectDeployment: mutation },
      aiCopilot: {
        confirmAction: {
          useMutation: (opts?: { onError?: unknown }) => {
            H.confirmOptions = opts ?? null;
            return { isPending: false, mutateAsync: H.confirm };
          },
        },
      },
    },
  };
});

import ApprovalsInbox from "./ApprovalsInbox";

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
});
afterEach(() => cleanup());

/** Nút Duyệt của hàng đề xuất (aria-label chứa tiêu đề; loại nút Bỏ qua). */
const nutDuyet = () =>
  screen
    .queryAllByRole("button", { name: /Đề xuất đặt tốc độ/ })
    .find((b) => /duy[eệ]t|approve/i.test(b.getAttribute("aria-label") ?? "") && !/b[oỏ] qua|dismiss/i.test(b.getAttribute("aria-label") ?? ""));

describe("ApprovalsInbox — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("cầu chì: câu vi thật có 'mức tác động 4' và dựng được nút Duyệt", () => {
    expect(CAU_MUC_QUA_CAO).toContain("mức tác động 4");
    render(<ApprovalsInbox />);
    expect(nutDuyet()).toBeTruthy();
  });

  it("★ bị từ chối vĩnh viễn ⇒ một toast câu vi thật, nút Duyệt biến mất, không gọi confirmAction lần hai", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_AI_LEVEL_TOO_HIGH", { ma: "MUC_QUA_CAO", level: 4 }));
    render(<ApprovalsInbox />);
    fireEvent.click(nutDuyet()!);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).toHaveBeenCalledWith(CAU_MUC_QUA_CAO);
    expect(H.toastSuccess).not.toHaveBeenCalled();
    expect(typeof H.confirmOptions?.onError).toBe("function");
    await waitFor(() => expect(nutDuyet()).toBeUndefined());
    expect(H.confirm).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: lỗi KHÁC ⇒ nút Duyệt còn (có thể thử lại)", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_ROLE_FLOOR"));
    render(<ApprovalsInbox />);
    fireEvent.click(nutDuyet()!);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).not.toHaveBeenCalledWith(CAU_MUC_QUA_CAO);
    expect(nutDuyet()).toBeTruthy();
  });
});
