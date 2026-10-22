/**
 * ★★ Đợt 1 · T4 (2026-10-17) — `GoiModel` phía máy chủ cho `shared/agentCore` (spec Đợt 1 §4 "Mô hình").
 *
 * Một lượt model = `aiGgufEngine.chatCompletionStream` với tool-calling GỐC (`tools`, `toolChoice:"auto"`)
 * và `signal` của lượt chạy. Chạy trong cổng ưu tiên `chayVoiUuTien("tuong-tac")` (người đang ngồi xem
 * lượt chạy) + `chayVoiNgheCho` ⇒ khi phải xếp hàng, lõi nhận mảnh `{loai:"cho"}` và phát `dang-cho-model`.
 *
 * ⚠ VÌ SAO CÓ "MÁY BƠM": cổng ưu tiên dựa trên AsyncLocalStorage. Thân một async generator chạy trong ngữ
 *   cảnh của KẺ GỌI `next()` (ở đây là lõi agent — ngoài mọi `chayVoiUuTien`). Nên luồng engine được bơm
 *   trong MỘT hàm async chạy trọn bên trong `chayVoiUuTien(...)`, đẩy mảnh vào hàng đợi; generator ngoài
 *   chỉ rút hàng đợi. Nhờ vậy mọi lượt xin slot của engine nhìn thấy đúng mức ưu tiên.
 *
 * ⚠ Chữ ra người dùng đi qua `StreamingThinkingStripper` (cắt `<think>` lạc) rồi `StreamingSecretRedactor`;
 *   suy luận (`reasoning_content`) đi kênh RIÊNG `nghi` qua bộ che riêng — không bao giờ thành `chu`.
 *   Sổ khai `thinkingSurfaces.quantifier.test.ts` ghi bề mặt này `tai_cho`.
 *
 * Nghĩ: BẬT theo ngân sách của server (`--reasoning-budget`, không gửi `thinking_budget_tokens`); tắt bằng
 * `AI_AGENT_NGHI=0` cho phép đo ablation nghĩ bật/tắt của Đợt 1. Model: model thường trú (mặc định của
 * llama-server) — `AI_CODING_MODEL_TASK=code` ⇒ `GGUF_CODE_MODEL` (cùng công tắc với chế độ lập trình cũ;
 * xem khối VRAM ở `aiCodingAgent.ts`: model khác model server đang giữ thì đường tool-calling KHÔNG có).
 * Lỗi `LLAMA_SERVER_DOWN` / mảnh `error` giữa luồng ⇒ `LoiModel` TẠM THỜI (lõi thử lại 1 lần).
 */
import { laLoiToolCallTrongSuyLuan, laLoiTokenCanKietVaoSuyLuan } from "../../aiLlamaServerClient";
import { LoiModel, type GoiModel, type ManhModel, type TinNhan, type WireTool } from "@shared/agentCore";
import { StreamingThinkingStripper, thinkingStartsOpen } from "../../ai/thinkingStrip";
import { StreamingSecretRedactor } from "../aiSafety";
import { chayVoiNgheCho, chayVoiUuTien, type MucUuTien } from "../hangDoiUuTienLlm";
import type { GgufChatMessage, GgufChatOptions, GgufStreamChunk } from "../../aiGgufEngine";
import { ghiLuotNgoaiCong } from "../../aiGateway";

/** Trần token sinh MỘT lượt (gồm nghĩ). Cân bằng = 16.000 như chế độ lập trình cũ (`nghiSau.ts`). */
export const TRAN_TOKEN_MOT_LUOT_MAC_DINH = 16_000;

export type HamChatStream = (options: GgufChatOptions, modelId?: string, signal?: AbortSignal) => AsyncIterable<GgufStreamChunk>;

export interface CauHinhGoiModel {
  /** Thay engine trong lưới (mặc định `aiGgufEngine.chatCompletionStream`). */
  chatStream?: HamChatStream;
  modelId?: string;
  maxTokens?: number;
  /** `false` ⇒ tắt nghĩ (`disableThinking`). Mặc định đọc `AI_AGENT_NGHI` (vắng ⇒ bật). */
  nghi?: boolean;
  mucUuTien?: MucUuTien;
  temperature?: number;
  /** Người chạy lượt — chỉ để gắn vào dấu vết `ai_gateway_metrics` / `ai_llm_audit` (không ảnh hưởng gì khác). */
  userId?: number;
}

const moTaLoi = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Số ký tự tối đa của chữ dùng để BĂM ở dấu vết (đuôi prompt / đầu câu trả lời) — chặn chi phí quét an toàn trên hội thoại dài. */
const TRAN_CHU_DAU_VET = 32_768;

/** Đuôi hội thoại gửi đi, chỉ để BĂM. */
function duoiHoiThoai(tinNhan: readonly { content?: unknown }[]): string {
  const gop = tinNhan.map((t) => (typeof t.content === "string" ? t.content : "")).join("\n");
  return gop.length > TRAN_CHU_DAU_VET ? gop.slice(gop.length - TRAN_CHU_DAU_VET) : gop;
}

/** Mẩu audit: CHỈ tên công cụ model gọi (không đối số, không mã). `undefined` khi không có. */
function tenCongCuGoi(c: GgufStreamChunk | null): string | undefined {
  const ds = Array.isArray(c?.toolCalls) ? (c!.toolCalls as Array<{ function?: { name?: unknown } }>) : [];
  const ten = [...new Set(ds.map((t) => (typeof t.function?.name === "string" ? t.function.name : "")).filter((x) => /^[a-z_][a-z0-9_]{0,40}$/i.test(x)))].slice(0, 10);
  return ten.length ? "kb-agent-luot cong-cu=" + ten.join(",") : undefined;
}

/** Lỗi engine ⇒ `LoiModel` có cờ tạm thời đúng nghĩa. */
export function chuyenLoiModel(e: unknown): LoiModel {
  if (e instanceof LoiModel) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "LLAMA_SERVER_DOWN") return new LoiModel(moTaLoi(e), { tamThoi: true, ma: "LLAMA_SERVER_DOWN" });
  if (typeof code === "string" && code.startsWith("LLM_QUEUE_")) return new LoiModel(moTaLoi(e), { tamThoi: false, ma: code });
  if (code === "tool_calls_unsupported_path") return new LoiModel(moTaLoi(e), { tamThoi: false, ma: "TOOL_CALL_KHONG_HO_TRO" });
  if (typeof code === "string" && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_SOCKET)$/.test(code)) {
    return new LoiModel(moTaLoi(e), { tamThoi: true, ma: code });
  }
  return new LoiModel(moTaLoi(e), { tamThoi: false, ma: "MODEL_LOI" });
}

function sangTinNhanGguf(ds: TinNhan[]): GgufChatMessage[] {
  return ds.map((m) => {
    const ra: GgufChatMessage = { role: m.role, content: m.content ?? "" };
    if (m.role === "assistant" && m.tool_calls?.length) ra.tool_calls = m.tool_calls;
    if (m.role === "tool" && m.tool_call_id) ra.tool_call_id = m.tool_call_id;
    return ra;
  });
}

function docCoNghi(): boolean {
  return (process.env.AI_AGENT_NGHI ?? "1").trim() !== "0";
}

function docMaxTokens(): number {
  const n = Number(process.env.AI_AGENT_MAX_TOKENS_MOT_LUOT);
  return Number.isFinite(n) && n >= 256 ? Math.floor(n) : TRAN_TOKEN_MOT_LUOT_MAC_DINH;
}

/**
 * MỘT lượt model của vòng agent. Điểm gọi engine nằm trong hàm CÓ TÊN `bomLuongModelMayChu` (sổ khai bề mặt
 * sinh chữ neo theo hàm bao gần nhất có tên); bộ cắt suy luận nằm cách nó đúng một bước (biến cùng tệp).
 */
async function* luongModelMayChu(
  vao: { tinNhan: TinNhan[]; congCu: WireTool[]; signal: AbortSignal },
  cauHinh: CauHinhGoiModel,
): AsyncGenerator<ManhModel> {
  const catSuyLuan = new StreamingThinkingStripper({ startInsideThinking: thinkingStartsOpen() });
  const cheChu = new StreamingSecretRedactor();
  const cheNghi = new StreamingSecretRedactor();

  const hang: ManhModel[] = [];
  let xong = false;
  let loi: unknown = null;
  let danhThuc: (() => void) | null = null;
  const day = (m: ManhModel) => {
    hang.push(m);
    const f = danhThuc;
    danhThuc = null;
    f?.();
  };

  /** Máy bơm: chạy TRỌN trong `chayVoiUuTien` (xem đầu tệp). Bộ cắt suy luận + bộ che ở ngay trên. */
  async function bomLuongModelMayChu(epTatNghi = false): Promise<void> {
    const chatCompletionStream: HamChatStream =
      cauHinh.chatStream ?? (await import("../../aiGgufEngine")).chatCompletionStream;
    let modelId = cauHinh.modelId;
    if (modelId === undefined && process.env.AI_CODING_MODEL_TASK === "code") {
      modelId = (await import("../../aiGgufEngine")).codeModelBasename();
    }
    const nghi = epTatNghi ? false : (cauHinh.nghi ?? docCoNghi());
    const options: GgufChatOptions = {
      messages: sangTinNhanGguf(vao.tinNhan),
      maxTokens: cauHinh.maxTokens ?? docMaxTokens(),
      temperature: cauHinh.temperature ?? 0.2,
      topP: 0.9,
      repeatPenalty: 1.05,
      ...(vao.congCu.length ? { tools: vao.congCu, toolChoice: "auto" as const } : {}),
      ...(nghi ? {} : { disableThinking: true }),
    };
    // ★ Đợt 9 — DẤU VẾT: đường agent đi NGOÀI cổng (gọi thẳng engine, không `planInference`) ⇒ không quota / safety / license và KHÔNG
    //   định tuyến theo vai trò (gốc của lỗ "tác nhân luôn dùng model mặc định"). Chưa đưa qua cổng thật (việc riêng); trong lúc đó mỗi lượt
    //   model để lại MỘT hàng bằng helper CHỈ-GHI `ghiLuotNgoaiCong` — dễ thay bằng `planInference().record()` khi agent qua cổng.
    //   Chỉ BĂM: prompt = đuôi TRAN_CHU_DAU_VET ký tự của hội thoại gửi đi; câu trả lời = chữ đã che; mã nguồn không được lưu.
    const t0 = Date.now();
    let chuDaPhat = "";
    let ketThuc: GgufStreamChunk | null = null;
    let hoanTat = false;
    try {
    for await (const c of chatCompletionStream(options, modelId, vao.signal)) {
      if (c.type === "token" && typeof c.token === "string" && c.token) {
        const an = cheChu.push(catSuyLuan.push(c.token));
        if (an) {
          if (chuDaPhat.length < TRAN_CHU_DAU_VET) chuDaPhat += an;
          day({ loai: "chu", noiDung: an });
        }
      } else if (c.type === "reasoning" && typeof c.token === "string" && c.token) {
        const an = cheNghi.push(c.token);
        if (an) day({ loai: "nghi", noiDung: an });
      } else if (c.type === "error") {
        throw new LoiModel(`model stream error: ${c.error ?? "unknown"}`, { tamThoi: true, ma: "MODEL_LOI_LUONG" });
      } else if (c.type === "done") {
        const conChu = cheChu.push(catSuyLuan.flush()) + cheChu.flush();
        if (conChu) {
          if (chuDaPhat.length < TRAN_CHU_DAU_VET) chuDaPhat += conChu;
          day({ loai: "chu", noiDung: conChu });
        }
        ketThuc = c;
        hoanTat = true;
        const conNghi = cheNghi.flush();
        if (conNghi) day({ loai: "nghi", noiDung: conNghi });
        const coUsage = typeof c.tokensPrompt === "number" || typeof c.tokensGenerated === "number";
        day({
          loai: "xong",
          toolCalls: Array.isArray(c.toolCalls) ? c.toolCalls : [],
          // ★★★ Lượt bị cắt ở trần token (engine giữ "length" kể cả khi có tool call dở) ⇒ lõi không thực thi lượt đó.
          ...(c.finishReason === "length" ? { biCat: true } : {}),
          ...(coUsage
            ? {
                usage: {
                  vao: Number(c.tokensPrompt ?? 0),
                  // `ra` = MỌI token sinh (gồm nghĩ) — trần `tokenRaToiDa` của lõi phải đo chi phí THẬT.
                  ra: Number(c.tokensGenerated ?? 0),
                  ...(typeof c.tokensReasoning === "number" ? { nghi: c.tokensReasoning } : {}),
                },
              }
            : {}),
        });
        return;
      }
    }
    } finally {
      ghiLuotNgoaiCong({
        task: "chat",
        auditTask: "kb_agent_luot",
        userId: cauHinh.userId ?? null,
        model: (typeof ketThuc?.modelId === "string" && ketThuc.modelId ? ketThuc.modelId : modelId ?? null) || null,
        tokensIn: ketThuc?.tokensPrompt,
        tokensOut: ketThuc?.tokensGenerated,
        reasoningTokens: typeof ketThuc?.tokensReasoning === "number" ? ketThuc.tokensReasoning : null,
        thinking: nghi ? null : false,
        latencyMs: Date.now() - t0,
        outcome: hoanTat ? "ok" : "error",
        promptText: duoiHoiThoai(options.messages),
        responseText: chuDaPhat || undefined,
        auditSnippet: tenCongCuGoi(ketThuc),
      });
    }
  }

  const mucUuTien = cauHinh.mucUuTien ?? "tuong-tac";
  const chay = chayVoiUuTien(mucUuTien, () =>
    chayVoiNgheCho((tb) => day({ loai: "cho", phiaTruoc: tb.phiaTruoc }), async () => {
      try {
        await bomLuongModelMayChu();
      } catch (e) {
        // ★★★ Model phát tool call TRONG suy luận (xem `LoiToolCallTrongSuyLuan`, aiLlamaServerClient): chữ suy luận
        //   KHÔNG được thành hành động (rà bảo mật ×2) ⇒ hỏi lại ĐÚNG lượt này MỘT lần với nghĩ TẮT — model khi ấy phát
        //   tool call qua đường thật (b9814 tách được). Lần hai vẫn hỏng ⇒ ném tiếp (lõi coi là lỗi model).
        //   ★★★ Đợt 4 (V-dot4-1/2) — cùng cách chữa cho G5-D ca (B) khi lượt có tool: model viết NGUYÊN câu trả lời cuối
        //   vào suy luận chưa đóng, content rỗng. Chữ suy luận đó KHÔNG thành câu trả lời — chỉ hỏi lại.
        const g5d = vao.congCu.length > 0 && laLoiTokenCanKietVaoSuyLuan(e);
        if ((!laLoiToolCallTrongSuyLuan(e) && !g5d) || vao.signal.aborted) throw e;
        console.warn(
          g5d
            ? "[agent] câu trả lời nằm trong suy luận, content rỗng (G5-D) ⇒ hỏi lại lượt này với nghĩ TẮT."
            : "[agent] tool call nằm trong suy luận ⇒ hỏi lại lượt này với nghĩ TẮT.",
        );
        await bomLuongModelMayChu(true);
      }
    }),
  );
  chay.then(
    () => {
      xong = true;
      const f = danhThuc;
      danhThuc = null;
      f?.();
    },
    (e: unknown) => {
      loi = e;
      xong = true;
      const f = danhThuc;
      danhThuc = null;
      f?.();
    },
  );

  for (;;) {
    if (hang.length > 0) {
      yield hang.shift()!;
      continue;
    }
    if (xong) break;
    await new Promise<void>((r) => {
      danhThuc = r;
    });
  }
  if (loi !== null) throw chuyenLoiModel(loi);
}

/** `GoiModel` cho `chayVongAgent`. */
export function taoGoiModelMayChu(cauHinh: CauHinhGoiModel = {}): GoiModel {
  return (vao) => luongModelMayChu(vao, cauHinh);
}
