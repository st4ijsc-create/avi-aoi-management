// @vitest-environment jsdom
//
// Đợt 10.4b (L1) — /ai-chat với model NGOÀI: id hội thoại + cờ xác nhận vận hành đi kèm; 428 ⇒ hỏi MỘT lần rồi gửi lại; từ chối ⇒ dừng và trả câu về ô nhập;
// lỗi ngoài KHÔNG lặng lẽ rơi sang trả lời cục bộ; lưu tin kèm ngoaiCallId; tin lịch sử có nguonModel render bằng bộ an toàn + huy hiệu.
// i18n THẬT (vi.json); chỉ mock hạ tầng (trpc, auth, wouter, sonner, luồng SSE, ngữ cảnh copilot, các component con nặng).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { LoiSinhChuNgoai } from "@/lib/loiNgoai";

const MA = "ngoai:anthropic:claude-x";
const VET = { nhaCungCap: "anthropic", model: "claude-x", tokenVao: 100, tokenRa: 20, chiPhiUocUsd: 0.002, callId: 5 };
const H = vi.hoisted(() => ({
  start: vi.fn(),
  save: vi.fn(),
  chat: vi.fn(),
  loi: { current: null as unknown },
  tinNhan: [] as unknown[],
  refetch: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", name: "T" } }) }));
vi.mock("@/contexts/AiCopilotContext", () => ({ useAiCopilotContext: () => ({ selection: {}, publishPrefill: () => undefined }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/ai-chat", () => undefined], useSearch: () => "q=hoi%20gi%20do" }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: unknown }) => <main>{children as never}</main> }));
vi.mock("@/components/ai/ChonModel", () => ({ default: () => null }));
vi.mock("@/components/AIGuidedActionCards", () => ({ default: () => null }));
vi.mock("@/components/MachineQuickScan", () => ({ default: () => null }));
vi.mock("@/components/ai/NutKiemDinhNgoai", () => ({ NutKiemDinhNgoai: () => null }));
vi.mock("@/hooks/useKbChatStream", async (orig) => {
  const real = await orig<typeof import("@/hooks/useKbChatStream")>();
  return {
    ...real,
    useKbChatStream: () => ({
      streamingText: "",
      isStreaming: false,
      error: null,
      loiNgoai: null,
      loiNgoaiRef: H.loi,
      abortedRef: { current: false },
      startKbStream: H.start,
      stopKbStream: () => undefined,
    }),
  };
});
vi.mock("@/lib/trpc", () => {
  const mut = (mutate?: unknown) => ({ useMutation: () => ({ isPending: false, mutateAsync: async () => ({ id: 7 }), mutate: mutate ?? (() => undefined) }) });
  const q = (data?: unknown) => ({ useQuery: () => ({ data, isLoading: false, refetch: () => undefined }) });
  return {
    trpc: {
      useUtils: () => ({}),
      aiChat: {
        listConversations: q([]),
        getConversation: { useQuery: () => ({ data: { id: 7, messages: H.tinNhan }, isLoading: false, refetch: () => H.refetch() }) },
        tools: q({ tools: [] }),
        createConversation: { useMutation: (o?: { onSuccess?: (d: { id: number }) => void }) => ({ isPending: false, mutate: () => undefined, mutateAsync: async () => { o?.onSuccess?.({ id: 7 }); return { id: 7 }; } }) },
        deleteConversation: mut(),
        chat: { useMutation: () => ({ isPending: false, mutate: (...a: unknown[]) => H.chat(...a) }) },
        saveStreamedMessage: { useMutation: () => ({ isPending: false, mutate: (...a: unknown[]) => H.save(...a) }) },
      },
      machine: { list: q([]) },
      aiChonModel: { danhMuc: q([]) },
      aiKiemDinh: { xemTruoc: q(undefined), chay: mut() },
      aiCopilot: { confirmAction: mut(), cancelAction: mut() },
    },
  };
});

import AIChatPage from "./AIChatPage";

const KET_QUA = (o: Record<string, unknown> = {}) => ({
  fullText: "Trả lời",
  confidence: 1,
  intent: "x",
  language: "vi",
  citations: [],
  toolResult: null,
  toolName: null,
  vision: null,
  clientAction: null,
  pendingAction: null,
  ...o,
});
const loi428 = () => new LoiSinhChuNgoai({ status: 428, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" });

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.start.mockReset();
  H.save.mockReset();
  H.chat.mockReset();
  H.refetch.mockReset();
  H.loi.current = null;
  H.tinNhan = [];
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

const ngu = (i: number) => (H.start.mock.calls[i]![0] as { context: Record<string, unknown> }).context;

describe("AIChatPage — model ngoài", () => {
  it("428 ⇒ hộp xác nhận vận hành; Đồng ý ⇒ gửi lại với xacNhanVanHanh + conversationId; lưu tin kèm ngoaiCallId; KHÔNG rơi sang chat cục bộ", async () => {
    localStorage.setItem("aiChon.chat", MA);
    H.start.mockImplementationOnce(async () => {
      H.loi.current = loi428();
      return null;
    });
    H.start.mockImplementationOnce(async () => KET_QUA({ ngoai: { nhaCungCap: "anthropic", model: "claude-x" }, vet: VET }));
    render(<AIChatPage />);
    expect(await screen.findByTestId("hop-xac-nhan-van-hanh")).toBeInTheDocument();
    expect(H.start).toHaveBeenCalledTimes(1);
    expect(ngu(0)).toMatchObject({ chonModel: MA, conversationId: 7 });
    expect(ngu(0)).not.toHaveProperty("xacNhanVanHanh");
    fireEvent.click(screen.getByTestId("xnvh-dong-y"));
    await waitFor(() => expect(H.save).toHaveBeenCalledTimes(1));
    expect(H.start).toHaveBeenCalledTimes(2);
    expect(ngu(1)).toMatchObject({ chonModel: MA, conversationId: 7, xacNhanVanHanh: true });
    expect(H.save.mock.calls[0]![0]).toMatchObject({ conversationId: 7, ngoaiCallId: 5 });
    expect(H.chat).not.toHaveBeenCalled();
  });

  it("done.daLuu ⇒ máy chủ đã lưu: client KHÔNG gọi saveStreamedMessage (tránh trùng tin) mà nạp lại hội thoại; không có daLuu ⇒ đường cũ kèm ngoaiCallId", async () => {
    localStorage.setItem("aiChon.chat", MA);
    sessionStorage.setItem("aiNgoai.xacNhanVanHanh", JSON.stringify(["7|anthropic:claude-x"]));
    H.start.mockImplementationOnce(async () => KET_QUA({ vet: VET, daLuu: { tinNguoiDungId: 11, tinTraLoiId: 12 } }));
    render(<AIChatPage />);
    await waitFor(() => expect(H.start).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(H.save).not.toHaveBeenCalled();
    expect(H.refetch).toHaveBeenCalled();
    expect(H.chat).not.toHaveBeenCalled();
  });

  it("428 ⇒ Từ chối ⇒ KHÔNG gửi lại, KHÔNG lưu, KHÔNG chat cục bộ; câu hỏi trả về ô nhập", async () => {
    localStorage.setItem("aiChon.chat", MA);
    H.start.mockImplementation(async () => {
      H.loi.current = loi428();
      return null;
    });
    render(<AIChatPage />);
    fireEvent.click(await screen.findByTestId("xnvh-tu-choi"));
    await waitFor(() => expect(screen.queryByTestId("hop-xac-nhan-van-hanh")).toBeNull());
    expect(H.start).toHaveBeenCalledTimes(1);
    expect(H.save).not.toHaveBeenCalled();
    expect(H.chat).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/Hỏi bất cứ điều gì/i) as HTMLInputElement).value).toBe("hoi gi do");
  });

  it("đã xác nhận trong hội thoại ⇒ lượt đầu mang xacNhanVanHanh luôn (không hỏi lại)", async () => {
    localStorage.setItem("aiChon.chat", MA);
    sessionStorage.setItem("aiNgoai.xacNhanVanHanh", JSON.stringify(["7|anthropic:claude-x"]));
    H.start.mockImplementation(async () => KET_QUA({ vet: VET }));
    render(<AIChatPage />);
    await waitFor(() => expect(H.save).toHaveBeenCalledTimes(1));
    expect(ngu(0)).toMatchObject({ xacNhanVanHanh: true, conversationId: 7 });
    expect(screen.queryByTestId("hop-xac-nhan-van-hanh")).toBeNull();
  });

  it("lỗi ngoài khác (vượt trần) ⇒ KHÔNG chat cục bộ, KHÔNG lưu; huy hiệu lượt lỗi hiện nếu có vết", async () => {
    localStorage.setItem("aiChon.chat", MA);
    H.start.mockImplementation(async () => {
      H.loi.current = new LoiSinhChuNgoai({ status: 0, code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi", vet: VET });
      return null;
    });
    render(<AIChatPage />);
    expect(await screen.findByTestId("huy-hieu-ngoai")).toBeInTheDocument();
    expect(screen.getByTestId("huy-hieu-ngoai").className).toContain("text-red-700");
    expect(H.chat).not.toHaveBeenCalled();
    expect(H.save).not.toHaveBeenCalled();
  });

  it("model cục bộ: KHÔNG conversationId/xacNhanVanHanh, KHÔNG ngoaiCallId; lỗi stream vẫn rơi sang chat như cũ", async () => {
    H.start.mockImplementationOnce(async () => KET_QUA());
    render(<AIChatPage />);
    await waitFor(() => expect(H.save).toHaveBeenCalledTimes(1));
    expect(ngu(0)).not.toHaveProperty("conversationId");
    expect(ngu(0)).not.toHaveProperty("xacNhanVanHanh");
    expect(H.save.mock.calls[0]![0]).not.toHaveProperty("ngoaiCallId");
    cleanup();
    H.save.mockReset();
    H.start.mockReset();
    H.start.mockImplementation(async () => null);
    render(<AIChatPage />);
    await waitFor(() => expect(H.chat).toHaveBeenCalledTimes(1));
  });

  it("tin lịch sử có nguonModel ⇒ bộ render an toàn (link/ảnh bị chặn) + huy hiệu; tin cục bộ ⇒ markdown thường", async () => {
    H.tinNhan = [
      { id: 1, role: "user", content: "hỏi", createdAt: new Date().toISOString() },
      { id: 2, role: "assistant", content: "[bấm](javascript:alert(1)) ![i](http://evil.example/p.png)", nguonModel: MA, vetNgoai: { nhaCungCap: "anthropic", model: "claude-x", tokenVao: 1, tokenRa: 2, chiPhiUocUsd: 0.001 }, createdAt: new Date().toISOString() },
    ];
    H.start.mockImplementation(async () => KET_QUA());
    const { container } = render(<AIChatPage />);
    expect(await screen.findByTestId("noi-dung-tra-loi-ngoai")).toBeInTheDocument();
    expect(screen.getByTestId("nhan-ngoai").textContent).toContain("anthropic");
    expect(container.querySelector("main a[href], main img")).toBeNull();
  });
});
