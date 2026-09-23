/**
 * phuQuyetToolNative.ts — ★ B6 (2026-09-23): phần I/O của hybrid "phủ quyết" (vị từ thuần ở `phuQuyetTool.ts`).
 *
 * Hỏi model (tool-calling GỐC của chat template, 5 tool lập trình, NGHĨ TẮT) một ý kiến thứ hai CHỈ khi heuristic đã chọn tool
 * VÀ câu mang tín hiệu yếu. Model chỉ được XÁC NHẬN hoặc nói KHÔNG — xem `ketHopPhuQuyet`.
 *
 * Số đo làm căn cứ (thước `eval-toolcall.mjs --coding --native --hybrid`, 2026-09-23, Qwen3.6-35B-A3B):
 *   bộ chính 38 ca · held-out 18 · held-out-2 16 (viết SAU khi chốt vị từ, TRƯỚC khi đo) — hybrid ≥ heuristic ở MỌI số trên
 *   cả ba bộ; từ chối đúng 0,5 → 1,0 ở hai held-out; cặp đối kháng 1/4 → 4/4 · 0/2 → 2/2 · 0/2 → 1/2; model được hỏi ở
 *   7/38 · 7/18 · 4/16 ca; ~0,7 s mỗi lần hỏi.
 * ⚠ Lượt đo native ĐẦU TIÊN để template tự bật nghĩ với trần 320 token ⇒ 9/12 "không gọi tool" là content RỖNG bị cắt, không
 *   phải từ chối. Lượt chọn tool là lớp PHỤ (`loaiLuot` "phan-loai") ⇒ `disableThinking: true` ở đây là BẮT BUỘC.
 *
 * Fail-open có chủ ý: model vắng / lỗi / quá hạn / bị cắt ⇒ `undefined` ⇒ giữ heuristic (hành vi trước B6). Công tắc
 * `AI_CODING_TOOL_VETO=0` tắt hẳn lớp này (không gọi model).
 */
import { z } from "zod";
import { stripThinking } from "../ai/thinkingStrip"; // đường "ai/thinkingStrip" để census AST nhận bộ cắt
import { CODING_TOOL_NAMES } from "../aiLocalTools/intentClassifier";
import type { ToolDecision } from "../aiLocalTools/intentClassifier";
import { getTool } from "../aiLocalTools/toolRegistry";
import { veSchemaAnToanChoGrammar, type WireTool } from "./nativeToolCalls";
import { ketHopPhuQuyet, tinHieuYeu } from "./phuQuyetTool";

/** Persona cho lượt hỏi ý kiến thứ hai — CÙNG chuỗi thước đo dùng (`eval-toolcall.mjs --coding` import từ đây). */
export const PERSONA_CHON_TOOL_LAP_TRINH =
  "Bạn là tác nhân lập trình làm việc trong một repo mã nguồn. Bạn có công cụ để ĐỌC tệp, LIỆT KÊ thư mục, TÌM chuỗi trong repo, " +
  "CHẠY lệnh kiểm chứng trong danh sách trắng, và ĐỀ XUẤT sửa tệp. Chỉ gọi đúng MỘT công cụ khi người dùng thật sự yêu cầu làm việc " +
  "với repo (đọc/xem/tìm/liệt kê/chạy/sửa một tệp, thư mục hay lệnh cụ thể). Nếu người dùng yêu cầu VIẾT MÃ MỚI độc lập, giải thích " +
  "khái niệm, hay chỉ NHẮC tên một lệnh/tệp trong câu hỏi mà không yêu cầu chạy/đọc nó, KHÔNG gọi công cụ — trả lời ngắn bằng lời.";

export const HAN_GIO_PHU_QUYET_MS = 15_000;

let wireCache: WireTool[] | null = null;

/** Dựng `tools` (khuôn OpenAI) cho ĐÚNG 5 tool lập trình từ registry thật; bỏ ô nội bộ `__authCtx`. */
export function dungWireToolLapTrinh(): WireTool[] {
  if (wireCache) return wireCache;
  const ra: WireTool[] = [];
  for (const ten of CODING_TOOL_NAMES) {
    const t = getTool(ten);
    if (!t) continue;
    const js = z.toJSONSchema(t.parameters, { io: "input", unrepresentable: "any" }) as Record<string, any>;
    if (js?.properties?.__authCtx) {
      const { __authCtx: _bo, ...rest } = js.properties;
      js.properties = rest;
      if (Array.isArray(js.required)) js.required = js.required.filter((r: string) => r !== "__authCtx");
    }
    ra.push({
      type: "function",
      function: { name: t.name, description: String(t.description ?? "").slice(0, 300), parameters: veSchemaAnToanChoGrammar(js) },
    } as WireTool);
  }
  wireCache = ra;
  return ra;
}

/**
 * Hỏi model: câu này cần tool nào (hoặc không tool nào)? Trả tên tool, `null` (model nói không), hoặc `undefined` (không
 * hỏi được: lỗi, quá hạn, bị cắt, tool ngoài 5 tên).
 */
export async function hoiModelChonTool(question: string, hanGioMs = HAN_GIO_PHU_QUYET_MS): Promise<string | null | undefined> {
  const { chatCompletion } = await import("../aiGgufEngine");
  let henGio: ReturnType<typeof setTimeout> | undefined;
  try {
    const kq = await Promise.race([
      chatCompletion({
        messages: [
          { role: "system", content: PERSONA_CHON_TOOL_LAP_TRINH },
          { role: "user", content: question },
        ],
        tools: dungWireToolLapTrinh(),
        toolChoice: "auto",
        maxTokens: 320,
        temperature: 0.1,
        disableThinking: true,
      } as never),
      new Promise<null>((resolve) => {
        henGio = setTimeout(() => resolve(null), hanGioMs);
      }),
    ]);
    if (kq === null) return undefined; // quá hạn
    const ten = (kq as { toolCalls?: Array<{ function?: { name?: string } }> }).toolCalls?.[0]?.function?.name;
    if (ten) return (CODING_TOOL_NAMES as readonly string[]).includes(ten) ? ten : undefined;
    // Cắt khối nghĩ TRƯỚC khi hỏi "rỗng?": một chuỗi chỉ gồm `<think>…` bị cắt vì length là LƯỢT CỤT, không
    // phải lời "không dùng tool" (đúng lớp lỗi 8.4k: 9/12 "không tool" từng là rỗng bị cắt). Chữ này không
    // bao giờ tới người dùng — chỉ dùng để phân loại.
    const text = stripThinking(String((kq as { text?: string }).text ?? "")).answer.trim();
    const finish = (kq as { finishReason?: string }).finishReason;
    if (text === "" && finish === "length") return undefined; // bị cắt ⇒ không phải một lời từ chối
    return null;
  } catch {
    return undefined;
  } finally {
    if (henGio) clearTimeout(henGio);
  }
}

/**
 * Áp lớp phủ quyết lên quyết định của heuristic. Không hỏi model khi: tắt bằng cờ, heuristic không chọn tool, hoặc tín hiệu MẠNH.
 * `hoi` tiêm được để lưới đo hợp đồng mà không cần engine.
 */
export async function phuQuyetToolLapTrinh(
  question: string,
  heuristic: ToolDecision,
  hoi: (q: string) => Promise<string | null | undefined> = hoiModelChonTool,
): Promise<ToolDecision> {
  if ((process.env.AI_CODING_TOOL_VETO ?? "").trim() === "0") return heuristic;
  const lyDo = tinHieuYeu(question);
  if (heuristic.tool === null || lyDo === null) return heuristic;
  const t0 = Date.now();
  const ykien = await hoi(question);
  const kq = ketHopPhuQuyet(heuristic, ykien, lyDo);
  console.log(
    `[codingTool] PHỦ QUYẾT (${lyDo}): heuristic=${heuristic.tool} · model=${ykien === undefined ? "(không hỏi được)" : ykien ?? "không tool"} ` +
      `⇒ ${kq.tool ?? "KHÔNG gọi tool"} · ${Date.now() - t0} ms`,
  );
  if (kq.tool === heuristic.tool) return heuristic;
  return { tool: null, args: {}, reason: kq.reason };
}
