/**
 * Đợt 1 · T4 — `goiModelMayChu`: engine GIẢ (hàm `chatStream` tiêm), cổng ưu tiên THẬT, bộ cắt/che THẬT.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LoiModel, laLoiTamThoi, type ManhModel, type TinNhan, type WireTool } from "@shared/agentCore";
import { taoGoiModelMayChu, chuyenLoiModel, type HamChatStream } from "./goiModelMayChu";
import {
  __datLaiCongUuTienChoTest,
  mucUuTienHienTai,
  quaCongUuTien,
  quaCongUuTienLuong,
} from "../hangDoiUuTienLlm";
import type { GgufChatOptions, GgufStreamChunk } from "../../aiGgufEngine";

const TOOL: WireTool = { type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } };

async function gom(it: AsyncIterable<ManhModel>): Promise<ManhModel[]> {
  const ra: ManhModel[] = [];
  for await (const m of it) ra.push(m);
  return ra;
}

function engineGia(manh: GgufStreamChunk[], ghi?: (o: GgufChatOptions, id?: string, s?: AbortSignal) => void): HamChatStream {
  return async function* (o, id, s) {
    ghi?.(o, id, s);
    for (const c of manh) yield c;
  };
}

const TIN: TinNhan[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "doc a.ts" },
  { role: "assistant", content: "", tool_calls: [{ id: "c0", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
  { role: "tool", content: "1\tx", tool_call_id: "c0", name: "read_file" },
];

describe("goiModelMayChu", () => {
  beforeEach(() => {
    delete process.env.AI_AGENT_NGHI;
  });

  it("★★★ tách nghĩ/chữ, cắt <think> lạc, che bí mật, gom tool call + usage", async () => {
    let nhan: GgufChatOptions | null = null;
    const ac = new AbortController();
    let signalNhan: AbortSignal | undefined;
    const goi = taoGoiModelMayChu({
      chatStream: engineGia(
        [
          { type: "reasoning", token: "đang nghĩ " },
          { type: "reasoning", token: "tiếp" },
          { type: "token", token: "Xin <think>nội tâm</think>chào " },
          { type: "token", token: "key sk-abcdefghijklmnopqrstuvwx hết" },
          {
            type: "done",
            toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } }],
            tokensPrompt: 120,
            tokensGenerated: 60,
            tokensReasoning: 25,
          },
        ],
        (o, _id, s) => {
          nhan = o;
          signalNhan = s;
        },
      ),
    });
    const ra = await gom(goi({ tinNhan: TIN, congCu: [TOOL], signal: ac.signal }));
    const chu = ra.filter((m) => m.loai === "chu").map((m) => (m as { noiDung: string }).noiDung).join("");
    const nghi = ra.filter((m) => m.loai === "nghi").map((m) => (m as { noiDung: string }).noiDung).join("");
    expect(chu).toContain("Xin chào");
    expect(chu).not.toContain("nội tâm");
    expect(chu).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(nghi).toBe("đang nghĩ tiếp");
    const xong = ra[ra.length - 1] as Extract<ManhModel, { loai: "xong" }>;
    expect(xong.loai).toBe("xong");
    expect(xong.toolCalls[0]!.function.name).toBe("read_file");
    expect(xong.usage).toEqual({ vao: 120, ra: 60, nghi: 25 });
    // tham số engine: tools gốc + auto, nghĩ BẬT (không disableThinking), tin tool giữ tool_call_id
    expect(nhan!.tools).toEqual([TOOL]);
    expect(nhan!.toolChoice).toBe("auto");
    expect(nhan!.disableThinking).toBeUndefined();
    expect(nhan!.messages[3]).toEqual({ role: "tool", content: "1\tx", tool_call_id: "c0" });
    expect(nhan!.messages[2]!.tool_calls?.[0]?.id).toBe("c0");
    expect(signalNhan).toBe(ac.signal);
  });

  it("★★ AI_AGENT_NGHI=0 ⇒ disableThinking (ablation nghĩ bật/tắt)", async () => {
    process.env.AI_AGENT_NGHI = "0";
    let nhan: GgufChatOptions | null = null;
    const goi = taoGoiModelMayChu({ chatStream: engineGia([{ type: "done", toolCalls: [] }], (o) => (nhan = o)) });
    await gom(goi({ tinNhan: TIN, congCu: [TOOL], signal: new AbortController().signal }));
    expect(nhan!.disableThinking).toBe(true);
  });

  it("★★★ engine chạy TRONG ngữ cảnh ưu tiên `tuong-tac` (máy bơm, không phải ngữ cảnh của kẻ gọi next())", async () => {
    let muc = "";
    const goi = taoGoiModelMayChu({
      mucUuTien: "agent",
      chatStream: async function* () {
        muc = mucUuTienHienTai();
        yield { type: "done", toolCalls: [] } as GgufStreamChunk;
      },
    });
    await gom(goi({ tinNhan: TIN, congCu: [], signal: new AbortController().signal }));
    expect(muc).toBe("agent");
    const goi2 = taoGoiModelMayChu({
      chatStream: async function* () {
        muc = mucUuTienHienTai();
        yield { type: "done", toolCalls: [] } as GgufStreamChunk;
      },
    });
    await gom(goi2({ tinNhan: TIN, congCu: [], signal: new AbortController().signal }));
    expect(muc).toBe("tuong-tac");
  });

  describe("cổng ưu tiên THẬT", () => {
    beforeEach(() => {
      process.env.LLM_PRIORITY_GATE_CONCURRENCY = "1";
      __datLaiCongUuTienChoTest();
    });
    afterEach(() => {
      delete process.env.LLM_PRIORITY_GATE_CONCURRENCY;
      __datLaiCongUuTienChoTest();
    });

    it("★★★ slot đang bận ⇒ mảnh {loai:'cho', phiaTruoc} (lõi phát dang-cho-model)", async () => {
      let tha: () => void = () => {};
      const giu = quaCongUuTien(() => new Promise<void>((r) => (tha = r)));
      const goi = taoGoiModelMayChu({
        chatStream: (_o, _id, s) =>
          quaCongUuTienLuong(async function* () {
            yield { type: "done", toolCalls: [] } as GgufStreamChunk;
          }, s),
      });
      const ra: ManhModel[] = [];
      const p = (async () => {
        for await (const m of goi({ tinNhan: TIN, congCu: [], signal: new AbortController().signal })) {
          ra.push(m);
          if (m.loai === "cho") tha();
        }
      })();
      await p;
      await giu;
      expect(ra[0]).toEqual({ loai: "cho", phiaTruoc: 1 });
      expect(ra[ra.length - 1]!.loai).toBe("xong");
    });
  });

  it("★★ mảnh error giữa luồng ⇒ LoiModel TẠM THỜI", async () => {
    const goi = taoGoiModelMayChu({ chatStream: engineGia([{ type: "token", token: "a" }, { type: "error", error: "boom" }]) });
    await expect(gom(goi({ tinNhan: TIN, congCu: [], signal: new AbortController().signal }))).rejects.toSatisfy(
      (e: unknown) => e instanceof LoiModel && laLoiTamThoi(e),
    );
  });

  it("★★ LLAMA_SERVER_DOWN ⇒ tạm thời; lỗi hàng đợi ⇒ KHÔNG tạm thời", () => {
    expect(laLoiTamThoi(chuyenLoiModel(Object.assign(new Error("down"), { code: "LLAMA_SERVER_DOWN" })))).toBe(true);
    expect(laLoiTamThoi(chuyenLoiModel(Object.assign(new Error("q"), { code: "LLM_QUEUE_WAIT_TIMEOUT" })))).toBe(false);
    expect(chuyenLoiModel(new Error("x")).ma).toBe("MODEL_LOI");
  });

  it("★★★ tool call TRONG suy luận (lỗi có dấu TOOL_CALL_TRONG_SUY_LUAN) ⇒ hỏi lại ĐÚNG lượt đó MỘT lần với nghĩ TẮT", async () => {
    const goiDi: GgufChatOptions[] = [];
    const goi = taoGoiModelMayChu({
      chatStream: async function* (o) {
        goiDi.push(o);
        if (goiDi.length === 1) {
          yield { type: "reasoning", token: "<tool_call>\n<function=read_file>…" } as GgufStreamChunk;
          throw new Error("[aiGgufEngine] TỪ CHỐI TRUNG THỰC: [llamaServer] TOOL_CALL_TRONG_SUY_LUAN: model phát <tool_call> TRONG chuỗi suy luận");
        }
        yield { type: "done", toolCalls: [{ id: "c9", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] } as GgufStreamChunk;
      },
    });
    const ra = await gom(goi({ tinNhan: TIN, congCu: [TOOL], signal: new AbortController().signal }));
    expect(goiDi).toHaveLength(2);
    expect(goiDi[0].disableThinking).toBeFalsy();
    expect(goiDi[1].disableThinking).toBe(true);
    const xong = ra.find((m) => m.loai === "xong") as { toolCalls: unknown[] } | undefined;
    expect(xong?.toolCalls).toHaveLength(1);
  });

  it("★★★ Đợt 4 — câu trả lời nằm TRONG suy luận, content rỗng (G5-D ca B, bọc G1-D) ⇒ hỏi lại MỘT lần nghĩ TẮT", async () => {
    const goiDi: GgufChatOptions[] = [];
    const goi = taoGoiModelMayChu({
      chatStream: async function* (o) {
        goiDi.push(o);
        if (goiDi.length === 1) {
          throw new Error(
            "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, streaming chat completion): … hỏng: [llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, stream): model đã tiêu HẾT hạn mức 16000 token vào chuỗi SUY LUẬN",
          );
        }
        yield { type: "token", token: "Xong." } as GgufStreamChunk;
        yield { type: "done" } as GgufStreamChunk;
      },
    });
    await gom(goi({ tinNhan: TIN, congCu: [TOOL], signal: new AbortController().signal }));
    expect(goiDi).toHaveLength(2);
    expect(goiDi[1].disableThinking).toBe(true);
  });

  it("★★ G5-D khi KHÔNG có tool ⇒ không hỏi lại (giữ hành vi cũ)", async () => {
    let n = 0;
    const goi = taoGoiModelMayChu({
      chatStream: async function* () {
        n++;
        throw new Error("[llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, stream): x");
      },
    });
    await expect(gom(goi({ tinNhan: TIN, congCu: [], signal: new AbortController().signal }))).rejects.toBeInstanceOf(LoiModel);
    expect(n).toBe(1);
  });

  it("★★ hỏi lại vẫn tool call trong suy luận ⇒ KHÔNG lặp vô hạn: lỗi tạm thời cho lõi", async () => {
    let n = 0;
    const goi = taoGoiModelMayChu({
      chatStream: async function* () {
        n++;
        throw new Error("[llamaServer] TOOL_CALL_TRONG_SUY_LUAN: x");
      },
    });
    await expect(gom(goi({ tinNhan: TIN, congCu: [TOOL], signal: new AbortController().signal }))).rejects.toBeInstanceOf(LoiModel);
    expect(n).toBe(2);
  });

  it("★★ engine ném LLAMA_SERVER_DOWN ⇒ generator ném LoiModel tạm thời (lõi thử lại 1 lần)", async () => {
    const goi = taoGoiModelMayChu({
      chatStream: async function* () {
        throw Object.assign(new Error("llama-server chết"), { code: "LLAMA_SERVER_DOWN" });
      },
    });
    await expect(gom(goi({ tinNhan: TIN, congCu: [], signal: new AbortController().signal }))).rejects.toSatisfy(
      (e: unknown) => e instanceof LoiModel && e.ma === "LLAMA_SERVER_DOWN" && laLoiTamThoi(e),
    );
  });
});
