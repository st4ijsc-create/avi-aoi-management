// @vitest-environment jsdom
//
// R1b-2b-2 — bề mặt AIChatPage (thẻ ConfirmActionCard inline) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN lệnh AI mức ≥ 4
// bằng lỗi tRPC FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (data.appParams {ma, level:4}):
//   (1) thẻ chuyển `denied`, nút Xác nhận KHÔNG còn bấm được;
//   (2) câu errors.SCADA_AI_LEVEL_TOO_HIGH (vi THẬT, chứa "mức tác động 4") hiện ĐÚNG một lần trong DOM;
//   (3) không còn nút Xác nhận ⇒ không bấm lại được; confirmAction đã gọi đúng 1 lần.
// Đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ thẻ vẫn pending.
// i18n THẬT (vi.json); chỉ mock hạ tầng (trpc, auth, wouter, sonner, luồng SSE useKbChatStream, ngữ cảnh copilot, các component con nặng).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", name: "T" } }) }));
vi.mock("@/contexts/AiCopilotContext", () => ({ useAiCopilotContext: () => ({ selection: {}, publishPrefill: () => undefined }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/ai-chat", () => undefined], useSearch: () => "q=dat%20SP" }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: unknown }) => <main>{children as never}</main> }));
vi.mock("@/components/ai/ChonModel", () => ({ default: () => null }));
vi.mock("@/components/AIGuidedActionCards", () => ({ default: () => null }));
vi.mock("@/components/MachineQuickScan", () => ({ default: () => null }));
vi.mock("@/hooks/useKbChatStream", async (orig) => {
  const real = await orig<typeof import("@/hooks/useKbChatStream")>();
  const ketQua = {
    fullText: "Đề xuất đặt SP",
    confidence: 1,
    intent: "x",
    language: "vi",
    citations: [],
    toolResult: null,
    toolName: null,
    vision: null,
    clientAction: null,
    pendingAction: {
      actionId: "act-1",
      token: "act-1",
      tool: "set_machine_param",
      summary: "Đặt SP",
      preview: { entityType: "machine", changes: [], warnings: [], humanSummary: "Đặt SP = 5" },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
  };
  return {
    ...real,
    useKbChatStream: () => ({
      streamingText: "",
      isStreaming: false,
      error: null,
      abortedRef: { current: false },
      startKbStream: async () => ketQua,
      stopKbStream: () => undefined,
    }),
  };
});
vi.mock("@/lib/trpc", () => {
  const mut = () => ({ useMutation: () => ({ isPending: false, mutateAsync: async () => ({ id: 7 }), mutate: () => undefined }) });
  const q = (data?: unknown) => ({ useQuery: () => ({ data, isLoading: false, refetch: () => undefined }) });
  return {
    trpc: {
      useUtils: () => ({}),
      aiChat: {
        listConversations: q([]),
        getConversation: q({
          id: 7,
          messages: [
            { id: 1, role: "user", content: "đặt SP", createdAt: new Date().toISOString() },
            { id: 2, role: "assistant", content: "Đề xuất đặt SP", createdAt: new Date().toISOString() },
          ],
        }),
        tools: q({ tools: [] }),
        createConversation: { useMutation: (o?: { onSuccess?: (d: { id: number }) => void }) => ({ isPending: false, mutate: () => undefined, mutateAsync: async () => { o?.onSuccess?.({ id: 7 }); return { id: 7 }; } }) },
        deleteConversation: mut(),
        chat: mut(),
        saveStreamedMessage: mut(),
      },
      machine: { list: q([]) },
      aiCopilot: {
        confirmAction: { useMutation: () => ({ isPending: false, mutateAsync: H.confirm }) },
        cancelAction: mut(),
      },
    },
  };
});

import AIChatPage from "./AIChatPage";

const CAU = (vi_ as any).errors.SCADA_AI_LEVEL_TOO_HIGH.replace("{{level}}", "4") as string;
const loi = (appCode: string, appParams?: object) =>
  Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN", appCode, appParams } });

const nutXacNhan = () => screen.findByRole("button", { name: /^xác nhận$/i });

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.confirm.mockReset();
  H.toastError.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe("AIChatPage — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("câu vi thật chứa 'mức tác động 4' (hàng rào chống test rỗng)", () => {
    expect(CAU).toContain("mức tác động 4");
  });

  it("★ SCADA_AI_LEVEL_TOO_HIGH ⇒ thẻ denied: câu đã dịch đúng MỘT lần, hết nút Xác nhận, confirmAction gọi đúng 1 lần", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_AI_LEVEL_TOO_HIGH", { ma: "X", level: 4 }));
    render(<AIChatPage />);
    fireEvent.click(await nutXacNhan());
    await waitFor(() => expect(screen.getAllByText(CAU)).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /xác nhận/i })).not.toBeInTheDocument();
    expect(H.toastError).toHaveBeenCalledTimes(1);
    expect(H.toastError).toHaveBeenCalledWith(CAU);
    expect(document.body.textContent!.split(CAU).length - 1).toBe(1);
    // Không còn phần tử xác nhận ⇒ không thể bấm lại; chỉ khẳng định số lần gọi.
    expect(H.confirm).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ thẻ vẫn pending (nút Xác nhận còn), không có câu mức tác động", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_ROLE_FLOOR"));
    render(<AIChatPage />);
    fireEvent.click(await nutXacNhan());
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^xác nhận$/i })).toBeInTheDocument();
    expect(screen.queryByText(CAU)).not.toBeInTheDocument();
    expect(H.toastError).not.toHaveBeenCalledWith(CAU);
  });
});
