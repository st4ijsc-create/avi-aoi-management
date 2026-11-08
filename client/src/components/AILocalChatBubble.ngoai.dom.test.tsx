// @vitest-environment jsdom
//
// Đợt 10.4b L4 — bong bóng trợ lý với model NGOÀI (hợp đồng docs/HOP_DONG_10_4B_L4_BONG_BONG.md). Nhà cung cấp/máy chủ GIẢ (fetch stub); i18n THẬT.
//   T3  chọn ngoài ⇒ tạo hội thoại THẬT ở tin ngoài đầu tiên (không tạo khi mở bong bóng) + gửi conversationId số; `conversationId` KHÔNG vào local/sessionStorage.
//   T3b body `/local-kb/stream` nhánh ngoài chỉ gồm tập khoá L1 (không máy/trang/đính kèm), lịch sử chỉ của hội thoại ngoài này.
//   T4  lượt ngoài render qua bộ an toàn duy nhất (không <a>/<img> sống) + huy hiệu vết.
//   T5  chưa đồng ý ⇒ KHÔNG gọi mạng; 428 ⇒ hỏi vận hành một lần rồi gửi lại với cờ.
//   T6  nút kiểm định: chỉ nhánh `chat` khi lượt đã lưu (daLuu); lượt chưa lưu ⇒ KHÔNG nút (van-ban ẩn).
//   T10 nhánh cục bộ/auto: body GIỮ NGUYÊN (khoá + không conversationId) và KHÔNG tạo hội thoại.
//   T13 đang stream ⇒ không nút kiểm định.
//   T9/T13 van-ban: cờ TẮT mặc định ⇒ lượt chưa lưu không nút; cờ BẬT ⇒ nút nhánh van-ban, đang stream ⇒ không.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({
  createConv: vi.fn(),
  saveStreamed: vi.fn(),
  toastError: vi.fn(),
  layThongTin: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", name: "T" } }) }));
vi.mock("@/hooks/useLicenseModules", () => ({ useLicenseModules: () => ({ isModuleBlocked: () => false }) }));
vi.mock("@/contexts/AiCopilotContext", () => ({
  useAiCopilotContext: () => ({ selection: { selectedMachineCode: "M-77", selectedLot: "LOT-9" }, publishPrefill: () => undefined }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/trang-dang-dung", () => undefined] }));
vi.mock("@/components/ai/ChonModel", () => ({ default: () => null }));
vi.mock("@/lib/thongTinNgoaiClient", () => ({ layThongTinNgoai: () => H.layThongTin }));
vi.mock("@/hooks/useDanhMucModel", () => ({
  useDanhMucModel: () => ({
    daTai: true,
    danhMuc: [{ ma: "ngoai:fake:m1", loai: "ngoai", nhan: "Fake", moTa: "", trangThai: "san-sang", nhaCungCap: "fake", duocDungO: ["chat", "kiem-dinh"] }],
  }),
}));
vi.mock("@/lib/trpc", () => {
  const mut = (extra?: object) => ({ useMutation: () => ({ isPending: false, mutateAsync: async () => ({}), mutate: () => undefined, ...extra }) });
  const query = { useQuery: () => ({ data: undefined, isLoading: false }) };
  return {
    trpc: {
      useUtils: () => ({}),
      aiLocalKb: { health: { useQuery: () => ({ data: { ready: true, staleDays: 0 }, isLoading: false }) }, reload: mut(), feedback: mut() },
      aiCopilot: { confirmAction: mut(), cancelAction: mut() },
      aiAgent: { startSession: mut(), approvePlan: mut(), confirmStep: mut(), cancelSession: mut(), startPlaybook: mut(), listPlaybooks: query },
      aiChat: {
        createConversation: { useMutation: () => ({ isPending: false, mutateAsync: H.createConv }) },
        saveStreamedMessage: { useMutation: () => ({ isPending: false, mutate: H.saveStreamed }) },
      },
    },
  };
});

import { AILocalChatBubble } from "./AILocalChatBubble";
import { setAiChatOpen, resetAiEntryForTest } from "@/lib/aiEntryStore";
import { luuChon } from "@/lib/chonModel";
import { datDongYNgoai, datXacNhanVanHanh } from "@/lib/dongYNgoai";
import { KHOA_NGU_CANH_NGOAI } from "@/components/ai/bongBongNgoai";

const MA = "ngoai:fake:m1";
const VET = { nhaCungCap: "fake", model: "m1", tokenVao: 10, tokenRa: 5, chiPhiUocUsd: 0.001, callId: 3 };
const data = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const sse = (...khung: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const e = new TextEncoder();
        for (const k of khung) c.enqueue(e.encode(k));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
const khungNgoai = (traLoi: string, daLuu: boolean) => [
  data({ type: "meta", ngoai: { nhaCungCap: "fake", model: "m1" }, confidence: 1, intent: "general", language: "vi", citations: [] }),
  data({ type: "token", token: traLoi }),
  data({ type: "done", vet: VET, ...(daLuu ? { daLuu: { tinNguoiDungId: 100, tinTraLoiId: 101 } } : {}) }),
];

const THONG_TIN = {
  nhaCungCap: "fake", model: "m1", duocPhep: true, mucDuLieu: "van-hanh", choDuLieuVanHanh: true,
  conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: true } }, dinhKemBiCam: true,
};

let fetchSpy: ReturnType<typeof vi.fn>;
const gui = async (cau: string) => {
  const o = await screen.findByPlaceholderText(/Nhập câu hỏi/i);
  fireEvent.change(o, { target: { value: cau } });
  fireEvent.keyDown(o, { key: "Enter", shiftKey: false });
};
const bodyCuaGoi = (i: number): Record<string, any> => JSON.parse(String((fetchSpy.mock.calls[i]![1] as RequestInit).body));
const goiStream = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/ai/local-kb/stream"));

async function moVaGui(cau: string) {
  render(<AILocalChatBubble />);
  act(() => setAiChatOpen(true));
  const o = await screen.findByPlaceholderText(/Nhập câu hỏi/i);
  fireEvent.change(o, { target: { value: cau } });
  fireEvent.keyDown(o, { key: "Enter", shiftKey: false });
}

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.createConv.mockReset().mockResolvedValue({ id: 42 });
  H.saveStreamed.mockReset();
  H.toastError.mockReset();
  H.layThongTin.mockReset().mockImplementation(() => new Promise(() => undefined));
  localStorage.clear();
  sessionStorage.clear();
  resetAiEntryForTest();
  Element.prototype.scrollIntoView = vi.fn();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AILocalChatBubble — model ngoài (L4)", () => {
  it("T3/T3b — mở bong bóng KHÔNG tạo hội thoại; gửi tin ngoài đầu tiên ⇒ tạo MỘT hội thoại, body chỉ có khoá L1, lịch sử trống (bắt đầu SẠCH)", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    // lịch sử CỤC BỘ có sẵn trong bong bóng: KHÔNG được sang nhà cung cấp ngoài
    localStorage.setItem("ai_chat_messages_v2", JSON.stringify([{ id: "c1", type: "user", content: "câu cục bộ cũ", timestamp: new Date().toISOString() }]));
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("Xin chào", true)));
    render(<AILocalChatBubble />);
    act(() => setAiChatOpen(true));
    const o = await screen.findByPlaceholderText(/Nhập câu hỏi/i);
    expect(H.createConv).not.toHaveBeenCalled();
    fireEvent.change(o, { target: { value: "hỏi ngoài" } });
    fireEvent.keyDown(o, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(goiStream()).toHaveLength(1));
    expect(H.createConv).toHaveBeenCalledTimes(1);
    const b = bodyCuaGoi(0);
    expect(Object.keys(b.context).sort()).toEqual([...KHOA_NGU_CANH_NGOAI].filter((k) => k !== "xacNhanVanHanh").sort());
    expect(b.context).toMatchObject({ chonModel: MA, conversationId: 42, route: "/ai-chat" });
    expect(JSON.stringify(b)).not.toContain("M-77"); // máy đang chọn
    expect(JSON.stringify(b)).not.toContain("LOT-9");
    expect(JSON.stringify(b)).not.toContain("trang-dang-dung"); // trang đang đứng
    expect(JSON.stringify(b)).not.toContain("câu cục bộ cũ");
    expect(b.history).toEqual([]);
    expect(b).not.toHaveProperty("image");
    // conversationId KHÔNG nằm trong storage riêng nào
    for (const st of [localStorage, sessionStorage]) {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i)!;
        if (k === "ai_chat_messages_v2") continue; // tin nhắn bong bóng (đã có từ trước) mang cặp id do MÁY CHỦ trả
        expect(st.getItem(k)).not.toMatch(/"?conversationId"?\s*[:=]\s*42|^42$/);
      }
    }
  });

  it("T4 — lượt ngoài render bằng bộ an toàn: không <a>/<img> sống, có huy hiệu vết; Markdown thường không dùng", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("Xin chào [bấm](javascript:alert(1)) ![x](http://127.0.0.1:1/leak) <img src=x onerror=alert(1)>", true)));
    await moVaGui("độc");
    const kh = await screen.findByTestId("noi-dung-tra-loi-ngoai");
    await waitFor(() => expect(kh).toHaveTextContent("Xin chào"));
    expect(kh.querySelectorAll("a, img, script, iframe")).toHaveLength(0);
    expect(await screen.findByTestId("huy-hieu-ngoai")).toHaveTextContent("fake");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // không yêu cầu mạng nào khác (ảnh/liên kết)
  });

  it("T5 — chưa đồng ý ⇒ hộp đồng ý mở, KHÔNG gọi /stream, KHÔNG tạo hội thoại", async () => {
    luuChon("chat", MA); // model lưu từ phiên trước, phiên này CHƯA đồng ý
    await moVaGui("chưa đồng ý");
    expect(await screen.findByTestId("hop-dong-y-ngoai")).toBeInTheDocument();
    expect(goiStream()).toHaveLength(0);
    expect(H.createConv).not.toHaveBeenCalled();
  });

  it("T5b — 428 ⇒ hỏi vận hành; từ chối ⇒ bỏ cả hai tin, câu trả về ô nhập, không gửi lần hai", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" }), { status: 428, headers: { "Content-Type": "application/json" } }));
    await moVaGui("cần xác nhận");
    fireEvent.click(await screen.findByTestId("xnvh-tu-choi"));
    await waitFor(() => expect(screen.queryByTestId("hop-xac-nhan-van-hanh")).not.toBeInTheDocument());
    expect(goiStream()).toHaveLength(1);
    expect(screen.getByPlaceholderText(/Nhập câu hỏi/i)).toHaveValue("cần xác nhận");
    expect(screen.queryByText("cần xác nhận", { selector: "p" })).not.toBeInTheDocument();
  });

  it("T5c — 428 ⇒ đồng ý ⇒ gửi lại với xacNhanVanHanh:true", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" }), { status: 428, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(sse(...khungNgoai("ok", true)));
    await moVaGui("cần xác nhận");
    fireEvent.click(await screen.findByTestId("xnvh-dong-y"));
    await waitFor(() => expect(goiStream()).toHaveLength(2));
    expect(bodyCuaGoi(0).context).not.toHaveProperty("xacNhanVanHanh");
    expect(bodyCuaGoi(1).context.xacNhanVanHanh).toBe(true);
    expect(H.createConv).toHaveBeenCalledTimes(1); // gửi lại KHÔNG tạo hội thoại thứ hai
  });

  it("T6/T13 — lượt đã lưu ⇒ có nút kiểm định (nhánh chat); lượt chưa lưu (daLuu vắng) ⇒ KHÔNG nút; saveStreamedMessage chạy với callId", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    datXacNhanVanHanh("42", MA);
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("đã lưu", false)));
    await moVaGui("không lưu được");
    await screen.findByTestId("noi-dung-tra-loi-ngoai");
    await waitFor(() => expect(H.saveStreamed).toHaveBeenCalledTimes(1));
    expect(H.saveStreamed.mock.calls[0]![0]).toMatchObject({ conversationId: 42, assistantMessage: "đã lưu", ngoaiCallId: 3 });
    expect(screen.queryByTestId("nut-kiem-dinh-ngoai")).not.toBeInTheDocument();
  });

  it("T6 — daLuu có ⇒ nút kiểm định hiện, KHÔNG gọi saveStreamedMessage", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("đã lưu", true)));
    await moVaGui("lưu được");
    expect(await screen.findByTestId("nut-kiem-dinh-ngoai")).toBeInTheDocument();
    expect(H.saveStreamed).not.toHaveBeenCalled();
  });

  it("T9 — cờ van-ban TẮT (mặc định) ⇒ lượt chưa lưu KHÔNG nút; BẬT ⇒ nút hiện (nhánh van-ban), lượt đang stream vẫn KHÔNG nút", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    datXacNhanVanHanh("42", MA);
    fetchSpy.mockResolvedValue(sse(...khungNgoai("chưa lưu", false)));
    await moVaGui("hỏi chưa lưu");
    await screen.findByTestId("noi-dung-tra-loi-ngoai");
    expect(screen.queryByTestId("nut-kiem-dinh-ngoai")).not.toBeInTheDocument();
    cleanup();
    resetAiEntryForTest();
    vi.stubEnv("VITE_AI_BONG_BONG_VAN_BAN", "true");
    try {
      localStorage.setItem(
        "ai_chat_messages_v2",
        JSON.stringify([
          { id: "u1", type: "user", content: "hỏi", timestamp: new Date().toISOString(), ngoaiConvId: 7 },
          { id: "a1", type: "assistant", content: "đáp xong", timestamp: new Date().toISOString(), ngoaiConvId: 7 },
          { id: "u2", type: "user", content: "hỏi tiếp", timestamp: new Date().toISOString(), ngoaiConvId: 7 },
          { id: "a2", type: "assistant", content: "đang gõ", timestamp: new Date().toISOString(), ngoaiConvId: 7, streaming: true },
        ]),
      );
      render(<AILocalChatBubble />);
      act(() => setAiChatOpen(true));
      expect(await screen.findByText("đang gõ")).toBeInTheDocument();
      expect(screen.getAllByTestId("nut-kiem-dinh-ngoai")).toHaveLength(1); // chỉ lượt đã xong; lượt đang stream không có
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T10 — model cục bộ/auto: KHÔNG tạo hội thoại, body giữ khoá cũ (route trang, máy, KHÔNG conversationId), nhánh ngoài không chạy", async () => {
    fetchSpy.mockResolvedValueOnce(sse(data({ type: "token", token: "cục bộ" }), data({ type: "done" })));
    await moVaGui("hỏi cục bộ");
    await waitFor(() => expect(goiStream()).toHaveLength(1));
    expect(H.createConv).not.toHaveBeenCalled();
    const b = bodyCuaGoi(0);
    expect(Object.keys(b.context).sort()).toEqual(["route", "selectedLot", "selectedMachineCode", "uiLanguage"].sort());
    expect(b.context.route).toBe("/trang-dang-dung");
    expect(b.context.selectedMachineCode).toBe("M-77");
    expect(b).toHaveProperty("history");
    expect(await screen.findByText("cục bộ")).toBeInTheDocument();
    expect(screen.queryByTestId("noi-dung-tra-loi-ngoai")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nut-kiem-dinh-ngoai")).not.toBeInTheDocument();
  });

  it("lỗi 400 từ máy chủ ⇒ KHÔNG lặng lẽ chuyển sang /ask cục bộ; câu trả về ô nhập", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: "NGOAI_VUOT_TRAN", error: "NGOAI_VUOT_TRAN" }), { status: 429, headers: { "Content-Type": "application/json" } }));
    await moVaGui("vượt trần");
    await waitFor(() => expect(H.toastError).toHaveBeenCalled());
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/ask"))).toHaveLength(0);
    expect(screen.getByPlaceholderText(/Nhập câu hỏi/i)).toHaveValue("vượt trần");
  });

  // ── bổ sung theo rà kiem-dinh (b5, m5, b9/b21, b16, b12, b3, b11) ────────────────────────────────────────
  it("b5 — tin ngoài thứ HAI dùng lại conversationId: createConversation gọi ĐÚNG 1 lần; lịch sử lần hai chỉ có lượt của hội thoại này", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    datXacNhanVanHanh("42", MA);
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("trả lời 1", true))).mockResolvedValueOnce(sse(...khungNgoai("trả lời 2", true)));
    await moVaGui("câu một");
    await waitFor(() => expect(screen.getByText("trả lời 1")).toBeInTheDocument());
    await gui("câu hai");
    await waitFor(() => expect(goiStream()).toHaveLength(2));
    expect(H.createConv).toHaveBeenCalledTimes(1);
    expect(bodyCuaGoi(0).context.conversationId).toBe(42);
    expect(bodyCuaGoi(1).context.conversationId).toBe(42);
    expect(bodyCuaGoi(1).history).toEqual([
      { role: "user", content: "câu một" },
      { role: "assistant", content: "trả lời 1" },
    ]);
  });

  it("m5 — lịch sử gửi kèm tối đa 10 lượt gần nhất của hội thoại ngoài", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    datXacNhanVanHanh("42", MA);
    localStorage.setItem(
      "ai_chat_messages_v2",
      JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, type: i % 2 ? "assistant" : "user", content: `m${i}`, timestamp: new Date().toISOString(), ngoaiConvId: 42 }))),
    );
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("ok", true)));
    render(<AILocalChatBubble />);
    act(() => setAiChatOpen(true));
    await gui("hỏi tiếp");
    await waitFor(() => expect(goiStream()).toHaveLength(1));
    expect(bodyCuaGoi(0).history).toHaveLength(10);
    expect(bodyCuaGoi(0).history.at(-1)).toEqual({ role: "assistant", content: "m29" });
  });

  it("b9/b21 — lỗi có vết: gỡ HAI tin tạm, huy hiệu ĐỎ hiện, câu về ô nhập, không còn bong bóng trống", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    // lỗi SAU khi mở SSE mới mang `vet` (khung `error`)
    fetchSpy.mockResolvedValueOnce(
      sse(data({ type: "meta", ngoai: { nhaCungCap: "fake", model: "m1" }, confidence: 1, intent: "general", language: "vi", citations: [] }), data({ type: "error", code: "NGOAI_NHA_CUNG_CAP_LOI", error: "NGOAI_NHA_CUNG_CAP_LOI", vet: VET })),
    );
    await moVaGui("sẽ lỗi");
    const hh = await screen.findByTestId("huy-hieu-ngoai");
    expect(hh.className).toContain("text-red-700");
    expect(screen.getByPlaceholderText(/Nhập câu hỏi/i)).toHaveValue("sẽ lỗi");
    expect(screen.queryByTestId("noi-dung-tra-loi-ngoai")).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("ai_chat_messages_v2") ?? "[]")).toEqual([]));
  });

  it("b16 — đang stream ⇒ KHÔNG nút kiểm định, kể cả khi tin đã có cặp id", async () => {
    luuChon("chat", MA);
    localStorage.setItem(
      "ai_chat_messages_v2",
      JSON.stringify([{ id: "a1", type: "assistant", content: "đang gõ", timestamp: new Date().toISOString(), streaming: true, ngoaiConvId: 5, tinTraLoiId: 6 }]),
    );
    render(<AILocalChatBubble />);
    act(() => setAiChatOpen(true));
    expect(await screen.findByText("đang gõ")).toBeInTheDocument();
    expect(screen.queryByTestId("nut-kiem-dinh-ngoai")).not.toBeInTheDocument();
  });

  it("b12 — xoá lịch sử ⇒ tin ngoài kế tiếp tạo hội thoại MỚI (không ghi vào hội thoại cũ)", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    datXacNhanVanHanh("42", MA);
    datXacNhanVanHanh("43", MA);
    H.createConv.mockReset().mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 43 });
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("một", true))).mockResolvedValueOnce(sse(...khungNgoai("hai", true)));
    await moVaGui("đầu");
    await waitFor(() => expect(screen.getByText("một")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle(/Xóa lịch sử/i));
    await gui("sau khi xoá");
    await waitFor(() => expect(goiStream()).toHaveLength(2));
    expect(H.createConv).toHaveBeenCalledTimes(2);
    expect(bodyCuaGoi(1).context.conversationId).toBe(43);
    expect(bodyCuaGoi(1).history).toEqual([]);
  });

  it("b3 — đồng ý ở tin 1 ⇒ tin 2 KHÔNG hỏi lại", async () => {
    luuChon("chat", MA); // chưa đồng ý trong phiên
    datXacNhanVanHanh("42", MA);
    H.layThongTin.mockReset().mockResolvedValue(THONG_TIN);
    fetchSpy.mockResolvedValueOnce(sse(...khungNgoai("một", true))).mockResolvedValueOnce(sse(...khungNgoai("hai", true)));
    await moVaGui("tin một");
    fireEvent.click(await screen.findByTestId("hdy-dong-y"));
    await waitFor(() => expect(screen.getByText("một")).toBeInTheDocument());
    await gui("tin hai");
    await waitFor(() => expect(goiStream()).toHaveLength(2));
    expect(screen.queryByTestId("hop-dong-y-ngoai")).not.toBeInTheDocument();
    expect(H.layThongTin).toHaveBeenCalledTimes(1);
  });

  it("b11 — kèm ảnh khi chọn model ngoài ⇒ từ chối bằng thông báo, KHÔNG gọi mạng, KHÔNG tạo hội thoại, ô nhập giữ nguyên", async () => {
    luuChon("chat", MA);
    datDongYNgoai(MA);
    render(<AILocalChatBubble />);
    act(() => setAiChatOpen(true));
    const o = await screen.findByPlaceholderText(/Nhập câu hỏi/i);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(document.querySelector("img[src^='data:image']")).not.toBeNull());
    fireEvent.change(o, { target: { value: "có ảnh" } });
    fireEvent.keyDown(o, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith(expect.stringContaining("tệp đính kèm")));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(H.createConv).not.toHaveBeenCalled();
    expect(o).toHaveValue("có ảnh");
  });
});
