// @vitest-environment jsdom
//
// R1b-2b-2 — bề mặt AILocalChatBubble (thẻ ConfirmActionCard) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN lệnh AI mức ≥ 4
// bằng lỗi tRPC FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (data.appParams {ma, level:4}):
//   (1) thẻ chuyển `denied`, nút Xác nhận KHÔNG còn bấm được;
//   (2) câu errors.SCADA_AI_LEVEL_TOO_HIGH (vi THẬT, chứa "mức tác động 4") hiện ĐÚNG một lần trong DOM;
//   (3) không còn nút Xác nhận ⇒ không bấm lại được; confirmAction đã gọi đúng 1 lần.
// Đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ thẻ vẫn pending.
// i18n THẬT (vi.json); chỉ mock hạ tầng (trpc, auth, license, wouter, sonner, ngữ cảnh copilot, ChonModel).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", name: "T" } }) }));
vi.mock("@/hooks/useLicenseModules", () => ({ useLicenseModules: () => ({ isModuleBlocked: () => false }) }));
vi.mock("@/contexts/AiCopilotContext", () => ({ useAiCopilotContext: () => ({ selection: {}, publishPrefill: () => undefined }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", () => undefined] }));
vi.mock("@/components/ai/ChonModel", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => {
  const mut = (extra?: object) => ({ useMutation: () => ({ isPending: false, mutateAsync: async () => ({}), mutate: () => undefined, ...extra }) });
  const query = { useQuery: () => ({ data: undefined, isLoading: false }) };
  return {
    trpc: {
      useUtils: () => ({}),
      aiLocalKb: { health: query, reload: mut(), feedback: mut() },
      aiCopilot: {
        confirmAction: { useMutation: () => ({ isPending: false, mutateAsync: H.confirm }) },
        cancelAction: mut(),
      },
      aiAgent: { startSession: mut(), approvePlan: mut(), confirmStep: mut(), cancelSession: mut(), startPlaybook: mut(), listPlaybooks: query },
    },
  };
});

import { AILocalChatBubble } from "./AILocalChatBubble";
import { setAiChatOpen, resetAiEntryForTest } from "@/lib/aiEntryStore";

const CAU = (vi_ as any).errors.SCADA_AI_LEVEL_TOO_HIGH.replace("{{level}}", "4") as string;
const loi = (appCode: string, appParams?: object) =>
  Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN", appCode, appParams } });

function gieoTheCho() {
  localStorage.setItem(
    "ai_chat_messages_v2",
    JSON.stringify([
      {
        id: "m1",
        type: "assistant",
        content: "Đề xuất đặt SP",
        timestamp: Date.now(),
        actionState: "pending",
        pendingAction: {
          actionId: "act-1",
          token: "act-1",
          tool: "set_machine_param",
          summary: "Đặt SP",
          preview: { entityType: "machine", changes: [], warnings: [], humanSummary: "Đặt SP = 5" },
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      },
    ]),
  );
}

async function moBong() {
  render(<AILocalChatBubble />);
  act(() => setAiChatOpen(true));
  return screen.findByRole("button", { name: /^xác nhận$/i });
}

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.confirm.mockReset();
  H.toastError.mockReset();
  localStorage.clear();
  resetAiEntryForTest();
  Element.prototype.scrollIntoView = vi.fn();
  gieoTheCho();
});
afterEach(() => cleanup());

describe("AILocalChatBubble — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("câu vi thật chứa 'mức tác động 4' (hàng rào chống test rỗng)", () => {
    expect(CAU).toContain("mức tác động 4");
  });

  it("★ SCADA_AI_LEVEL_TOO_HIGH ⇒ thẻ denied: câu đã dịch đúng MỘT lần, hết nút Xác nhận, confirmAction gọi đúng 1 lần", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_AI_LEVEL_TOO_HIGH", { ma: "X", level: 4 }));
    fireEvent.click(await moBong());
    await waitFor(() => expect(screen.getAllByText(CAU)).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /xác nhận/i })).not.toBeInTheDocument();
    // Không còn phần tử xác nhận ⇒ không thể bấm lại; chỉ khẳng định số lần gọi.
    expect(H.confirm).toHaveBeenCalledTimes(1);
    expect(H.toastError).toHaveBeenCalledTimes(1);
    expect(H.toastError).toHaveBeenCalledWith(CAU);
    expect(document.body.textContent!.split(CAU).length - 1).toBe(1);
  });

  it("đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ thẻ vẫn pending (nút Xác nhận còn), không có câu mức tác động", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_ROLE_FLOOR"));
    fireEvent.click(await moBong());
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^xác nhận$/i })).toBeInTheDocument();
    expect(screen.queryByText(CAU)).not.toBeInTheDocument();
    expect(H.toastError).not.toHaveBeenCalledWith(CAU);
  });
});
