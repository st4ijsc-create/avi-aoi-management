// @vitest-environment jsdom
//
// Đợt 10.4b (L1) — đường stream KB với model NGOÀI: ngữ cảnh gửi đi (xacNhanVanHanh / conversationId chỉ khi hợp lệ), lỗi TRƯỚC SSE có kiểu (428 …),
// khung `: ping` (comment SSE) không làm hỏng luồng, `meta.ngoai` + `done.vet` vào kết quả, khung `error` mang code/tranVuot/vet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("i18next", () => ({ default: { t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k } }));

import { dungNguCanhKb, useKbChatStream, type KbStreamRequest } from "./useKbChatStream";
import { bocVetNgoai, docLoiTruocSse, LoiSinhChuNgoai } from "@/lib/loiNgoai";

const NGU_CANH = { route: "/ai-chat", uiLanguage: "vi" };
const REQ = (c: Record<string, unknown> = {}): KbStreamRequest => ({ question: "q", history: [], userRole: "engineer", context: { ...NGU_CANH, ...c } as KbStreamRequest["context"] });

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
const data = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const VET = { nhaCungCap: "anthropic", model: "claude-x", tokenVao: 100, tokenRa: 20, chiPhiUocUsd: 0.002, callId: 7 };

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("dungNguCanhKb — trường mới của 10.4b", () => {
  it("xacNhanVanHanh CHỈ đi khi đúng true; conversationId CHỈ khi số nguyên dương", () => {
    expect(dungNguCanhKb({ ...NGU_CANH })).toEqual({ route: "/ai-chat", uiLanguage: "vi" });
    expect(dungNguCanhKb({ ...NGU_CANH, xacNhanVanHanh: false, conversationId: 0 })).toEqual({ route: "/ai-chat", uiLanguage: "vi" });
    expect(dungNguCanhKb({ ...NGU_CANH, conversationId: 1.5 })).not.toHaveProperty("conversationId");
    expect(dungNguCanhKb({ ...NGU_CANH, conversationId: "5" as never })).not.toHaveProperty("conversationId");
    expect(dungNguCanhKb({ ...NGU_CANH, xacNhanVanHanh: true, conversationId: 42 })).toMatchObject({ xacNhanVanHanh: true, conversationId: 42 });
  });
});

describe("loiNgoai — đọc hợp đồng", () => {
  it("428 ⇒ lỗi có kiểu, canXacNhanVanHanh; mã không thuộc đường ngoài ⇒ null", () => {
    const e = docLoiTruocSse(428, { success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" });
    expect(e).toBeInstanceOf(LoiSinhChuNgoai);
    expect(e!.canXacNhanVanHanh).toBe(true);
    expect(e!.status).toBe(428);
    expect(e!.muc).toBe("van-hanh");
    expect(docLoiTruocSse(401, { code: "AUTH_REQUIRED" })).toBeNull();
    expect(docLoiTruocSse(500, null)).toBeNull();
    expect(docLoiTruocSse(404, { code: "modelNgoaiChuaCaiDat" })!.status).toBe(404);
    expect(docLoiTruocSse(400, { code: "NGOAI_THIEU_HOI_THOAI" })!.canXacNhanVanHanh).toBe(false);
    // mã NGOAI_* ngoài bảng HTTP trước-SSE (lỗi nhà cung cấp…) vẫn là lỗi ngoài
    expect(docLoiTruocSse(502, { code: "NGOAI_NHA_CUNG_CAP_LOI" })!.code).toBe("NGOAI_NHA_CUNG_CAP_LOI");
    expect(docLoiTruocSse(500, { code: "constructor" })).toBeNull();
  });
  it("tranVuot lạ / muc lạ bị bỏ (không tin chuỗi từ máy chủ); câu hiển thị lấy theo mã, kèm trần nếu hợp lệ", () => {
    const e = docLoiTruocSse(429, { code: "NGOAI_VUOT_TRAN", tranVuot: "<img>", muc: "x" })!;
    expect(e.tranVuot).toBeUndefined();
    expect(e.muc).toBeUndefined();
    const g = docLoiTruocSse(429, { code: "NGOAI_VUOT_TRAN", tranVuot: "lan-phut" })!;
    expect(g.tranVuot).toBe("lan-phut");
    expect(g.message).toContain("lan-phut");
  });
  it("bocVetNgoai: thiếu callId nguyên dương / số âm / chuỗi rỗng ⇒ null hoặc null từng ô", () => {
    expect(bocVetNgoai(VET)).toEqual(VET);
    expect(bocVetNgoai({ ...VET, callId: 0 })).toBeNull();
    expect(bocVetNgoai({ ...VET, callId: 1.5 })).toBeNull();
    expect(bocVetNgoai({ ...VET, model: "" })).toBeNull();
    expect(bocVetNgoai("x")).toBeNull();
    expect(bocVetNgoai({ ...VET, tokenVao: -1, tokenRa: "5", chiPhiUocUsd: Number.NaN })).toMatchObject({ tokenVao: null, tokenRa: null, chiPhiUocUsd: null });
  });
});

describe("useKbChatStream — model ngoài", () => {
  const chay = async (req: KbStreamRequest) => {
    const h = renderHook(() => useKbChatStream());
    let kq: Awaited<ReturnType<typeof h.result.current.startKbStream>> = null;
    await act(async () => {
      kq = await h.result.current.startKbStream(req);
    });
    return { h, kq: kq as Awaited<ReturnType<typeof h.result.current.startKbStream>> };
  };

  it("429 JSON trước SSE ⇒ loiNgoai có kiểu + error là câu theo mã; kết quả null", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: false, code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" }), { status: 429, headers: { "Content-Type": "application/json" } }));
    const { h, kq } = await chay(REQ());
    expect(kq).toBeNull();
    expect(h.result.current.loiNgoai).toBeInstanceOf(LoiSinhChuNgoai);
    expect(h.result.current.loiNgoai!.tranVuot).toBe("nguoi");
    expect(h.result.current.error).toContain("NGOAI_VUOT_TRAN");
  });

  it("428 ⇒ canXacNhanVanHanh; gửi lại với xacNhanVanHanh:true ⇒ thân yêu cầu mang cờ + conversationId, và loiNgoai được xoá", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" }), { status: 428 }));
    const { h } = await chay(REQ({ chonModel: "ngoai:anthropic:claude-x", conversationId: 9 }));
    expect(h.result.current.loiNgoai!.canXacNhanVanHanh).toBe(true);
    fetchSpy.mockResolvedValueOnce(sse(data({ type: "done" })));
    await act(async () => {
      await h.result.current.startKbStream(REQ({ chonModel: "ngoai:anthropic:claude-x", conversationId: 9, xacNhanVanHanh: true }));
    });
    const thanGui = JSON.parse(fetchSpy.mock.calls[1]![1].body as string);
    expect(thanGui.context).toMatchObject({ chonModel: "ngoai:anthropic:claude-x", conversationId: 9, xacNhanVanHanh: true });
    expect(h.result.current.loiNgoai).toBeNull();
  });

  it("khung `: ping` giữa luồng bị bỏ qua; meta.ngoai + done.vet vào kết quả (vet đã kiểm kiểu)", async () => {
    fetchSpy.mockResolvedValue(
      sse(
        ": ping\n\n",
        data({ type: "meta", confidence: 0.5, intent: "x", language: "vi", citations: [], ngoai: { nhaCungCap: "anthropic", model: "claude-x" } }),
        ": ping\n\n",
        ": ping\n\n",
        data({ type: "token", token: "Xin " }),
        data({ type: "token", token: "chào" }),
        data({ type: "done", vet: VET }),
      ),
    );
    const { kq } = await chay(REQ({ chonModel: "ngoai:anthropic:claude-x", conversationId: 9, xacNhanVanHanh: true }));
    expect(kq!.fullText).toBe("Xin chào");
    expect(kq!.ngoai).toEqual({ nhaCungCap: "anthropic", model: "claude-x" });
    expect(kq!.vet).toEqual(VET);
  });

  it("done.daLuu hợp lệ (hai id nguyên dương) ⇒ vào kết quả; thiếu/không hợp lệ ⇒ vắng (đường lưu cũ)", async () => {
    fetchSpy.mockResolvedValueOnce(sse(data({ type: "token", token: "a" }), data({ type: "done", vet: VET, daLuu: { tinNguoiDungId: 11, tinTraLoiId: 12 } })));
    const a = await chay(REQ());
    expect(a.kq!.daLuu).toEqual({ tinNguoiDungId: 11, tinTraLoiId: 12 });
    for (const dl of [{ tinNguoiDungId: 0, tinTraLoiId: 12 }, { tinNguoiDungId: 1.5, tinTraLoiId: 2 }, { tinNguoiDungId: "1", tinTraLoiId: 2 }, { tinNguoiDungId: 1 }, null]) {
      fetchSpy.mockResolvedValueOnce(sse(data({ type: "token", token: "a" }), data({ type: "done", vet: VET, daLuu: dl })));
      const b = await chay(REQ());
      expect(b.kq).not.toHaveProperty("daLuu");
    }
  });

  it("lượt cục bộ: KHÔNG có ngoai/vet trong kết quả; vet hỏng ⇒ không dựng huy hiệu", async () => {
    fetchSpy.mockResolvedValue(sse(data({ type: "token", token: "a" }), data({ type: "done", vet: { nhaCungCap: "x" } })));
    const { kq } = await chay(REQ());
    expect(kq).not.toHaveProperty("ngoai");
    expect(kq).not.toHaveProperty("vet");
  });

  it("khung error sau SSE mang code/tranVuot/vet ⇒ lỗi có kiểu giữ vet (huy hiệu lượt lỗi); error không code ⇒ lỗi thường", async () => {
    fetchSpy.mockResolvedValueOnce(sse(data({ type: "token", token: "a" }), data({ type: "error", error: "x", code: "NGOAI_VUOT_TRAN", tranVuot: "luot", vet: VET })));
    const a = await chay(REQ());
    expect(a.kq).toBeNull();
    expect(a.h.result.current.loiNgoai!.code).toBe("NGOAI_VUOT_TRAN");
    expect(a.h.result.current.loiNgoai!.tranVuot).toBe("luot");
    expect(a.h.result.current.loiNgoai!.vet).toEqual(VET);
    fetchSpy.mockResolvedValueOnce(sse(data({ type: "error", error: "hỏng" })));
    const b = await chay(REQ());
    expect(b.h.result.current.loiNgoai).toBeNull();
    expect(b.h.result.current.error).toBe("hỏng");
  });
});
