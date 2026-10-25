// @vitest-environment jsdom
//
// R1b-1 T10 fix round 1 (I-2) — thẻ xác nhận 1-chạm (SuggestedActionDialog) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN lệnh mức ≥ 4 của AI
// bằng lỗi tRPC FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (trước đó là một kết quả `{status:"denied"}` đóng thẻ):
//   · thẻ ĐÓNG ở `denied` — nút Xác nhận biến mất (không bấm lại được), hiện câu đã dịch MỘT lần, có nút Đóng;
//   · lỗi KHÁC ⇒ thẻ vẫn `pending` (nút Xác nhận còn) và có đúng một toast lỗi.
// Dựng component THẬT; chỉ mock hạ tầng (trpc, quyền, i18n, sonner).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const H = vi.hoisted(() => ({
  confirm: vi.fn(),
  toastError: vi.fn(),
  confirmOptions: null as null | { onError?: unknown },
}));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true, isAdmin: true }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      const f = typeof fallback === "string" ? fallback : _k;
      return f.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ""));
    },
    i18n: { language: "vi" },
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiCopilot: {
      proposeSuggestedAction: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async () => ({
            ok: true,
            pendingAction: {
              actionId: "act-1",
              token: "act-1",
              tool: "set_machine_param",
              summary: "Đặt SP",
              preview: { entityType: "machine", changes: [], warnings: [], humanSummary: "Đặt SP = 5" },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        }),
      },
      confirmAction: {
        useMutation: (opts?: { onError?: unknown }) => {
          H.confirmOptions = opts ?? null;
          return { isPending: false, mutateAsync: H.confirm };
        },
      },
      cancelAction: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({ ok: true }) }) },
    },
  },
}));
// mapTrpcError THẬT cần i18n khởi tạo; ở đây chỉ kiểm LUỒNG thẻ — bản dịch thật của khoá được khoá bằng test của lib + i18n:check.
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: (e: { data?: { appCode?: string }; message?: string }) => `DICH(${e.data?.appCode ?? e.message})` }));

import AIGuidedActionCards from "./AIGuidedActionCards";

const loiAppCode = (appCode: string) => Object.assign(new Error("FORBIDDEN"), { data: { appCode, code: "FORBIDDEN" } });

function moTheDeXuat() {
  render(
    <AIGuidedActionCards
      onSend={() => undefined}
      hideStaticActions
      suggestedActions={[{ tool: "set_machine_param", args: {}, summary: "Đề xuất đặt SP", requiredPermission: { module: "machine_control", action: "canEdit" } }]}
    />,
  );
  fireEvent.click(screen.getByText("Đề xuất đặt SP"));
}

beforeEach(() => {
  H.confirm.mockReset();
  H.toastError.mockReset();
});
afterEach(() => cleanup());

describe("SuggestedActionDialog — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("★ lỗi SCADA_AI_LEVEL_TOO_HIGH ⇒ thẻ đóng ở denied: hiện câu đã dịch, KHÔNG còn nút Xác nhận, có nút Đóng, KHÔNG toast thứ hai", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_AI_LEVEL_TOO_HIGH"));
    moTheDeXuat();
    const xacNhan = await screen.findByRole("button", { name: /xác nhận/i });
    fireEvent.click(xacNhan);
    await waitFor(() => expect(screen.getByText("DICH(SCADA_AI_LEVEL_TOO_HIGH)")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^xác nhận$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^đóng$/i })).toBeInTheDocument();
    expect(H.toastError).not.toHaveBeenCalled();
    expect(H.confirm).toHaveBeenCalledTimes(1);
  });

  it("lưới cuối của main.tsx bị tắt cho mutation này (onError khai) — đúng MỘT chỗ hiện lỗi", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_AI_LEVEL_TOO_HIGH"));
    moTheDeXuat();
    await screen.findByRole("button", { name: /xác nhận/i });
    expect(typeof H.confirmOptions?.onError).toBe("function");
  });

  it("đối chứng: lỗi KHÁC (vd. mạng) ⇒ thẻ vẫn pending (nút Xác nhận còn) và đúng một toast lỗi", async () => {
    H.confirm.mockRejectedValue(loiAppCode("SCADA_ROLE_FLOOR"));
    moTheDeXuat();
    fireEvent.click(await screen.findByRole("button", { name: /xác nhận/i }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).toHaveBeenCalledWith("DICH(SCADA_ROLE_FLOOR)");
    expect(screen.getByRole("button", { name: /xác nhận/i })).toBeInTheDocument();
  });
});
