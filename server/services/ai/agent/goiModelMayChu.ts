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
import { laLoiToolCallTrongSuyLuan, laLoiTokenCanKietVaoSuyLuan, laLoiTranNguCanh } from "../../aiLlamaServerClient";
import { LoiModel, MA_LOI_TRAN_NGU_CANH, type GoiModel, type ManhModel, type TinNhan, type WireTool } from "@shared/agentCore";
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
  /** `true` ⇒ KHÔNG ghi dấu vết chỉ-ghi (lượt đã được đếm ở nơi khác, vd. qua cổng khi `AI_AGENT_THEO_VAI_TRO` bật). */
  khongGhiDauVet?: boolean;
  /**
   * (Đợt 12 H4.2) lượt chạy chủ của các lượt model này — CHỈ để bộ ghi (`AI_GHI_LUOT_DIR`, cửa sổ đo) đặt tên tệp `<runId>.jsonl`.
   * Vắng hoặc biến môi trường vắng ⇒ không ghi gì.
   */
  runId?: string;
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

/** Số tầng `cause` tối đa được đọc (engine bọc ⇒ LoiStreamServer ⇒ TypeError "fetch failed" ⇒ lỗi socket = 4; trần chống vòng lặp). */
const SAU_CHUOI_CAUSE = 6;

/** Lỗi và các `cause` của nó (ngoài cùng trước), tối đa `SAU_CHUOI_CAUSE` tầng, chỉ đối tượng. */
function chuoiCause(e: unknown): object[] {
  const ra: object[] = [];
  let x: unknown = e;
  for (let i = 0; i < SAU_CHUOI_CAUSE && x && typeof x === "object" && !ra.includes(x); i++) {
    ra.push(x);
    x = (x as { cause?: unknown }).cause;
  }
  return ra;
}

/** `httpStatus` của lỗi hoặc của một `cause` (tầng gần nhất thắng). */
function trangThaiHttp(chuoi: object[]): number | undefined {
  for (const x of chuoi) {
    const st = (x as { httpStatus?: unknown }).httpStatus;
    if (typeof st === "number") return st;
  }
  return undefined;
}

/** Mã lỗi socket/mạng ở BẤT KỲ tầng nào (lỗi mạng thật luôn nằm dưới đáy chuỗi: `fetch failed` ⇒ cause.code). */
const RE_MA_MANG = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_SOCKET)$/;
function maMangTrongChuoi(chuoi: object[]): string | undefined {
  for (const x of chuoi) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && RE_MA_MANG.test(c)) return c;
  }
  return undefined;
}

/** Lỗi engine ⇒ `LoiModel` có cờ tạm thời đúng nghĩa. */
export function chuyenLoiModel(e: unknown): LoiModel {
  if (e instanceof LoiModel) return e;
  const chuoi = chuoiCause(e);
  // Đã có chữ / mảnh tool rời máy chủ tới người dùng (bit do client hoặc engine gắn ở BẤT KỲ tầng nào) ⇒ chạy lại = câu trả lời chắp vá.
  const daPhat = chuoi.some((x) => (x as { daPhatChu?: unknown }).daPhatChu === true);
  // ★ Đợt 12 H3.1 — mã ổn định theo HTTP của llama-server (tìm cả trong chuỗi `cause` — engine có thể bọc lại lỗi; H3.1b: cấu hình
  //   sản xuất STRICT tắt bọc qua G1-D, nay giữ `cause`).
  const st = trangThaiHttp(chuoi);
  if (st === 503) return new LoiModel(moTaLoi(e), { tamThoi: true, ma: "MODEL_DANG_NAP" });
  if (st === 429) {
    // ★ H3.1b (C-P1) — 429 `insufficient_quota` = HẾT HẠN MỨC, không phải dồn dập: thử lại chỉ giữ chỗ ngân sách lần nữa ⇒ không tạm thời.
    const hetHanMuc = chuoi.some((x) => (x as { maNhaCungCap?: unknown }).maNhaCungCap === "insufficient_quota");
    return hetHanMuc
      ? new LoiModel(moTaLoi(e), { tamThoi: false, ma: "QUOTA" })
      : new LoiModel(moTaLoi(e), { tamThoi: true, ma: "RATE_LIMIT" });
  }
  const code = (e as { code?: unknown } | null)?.code;
  // mã LLAMA_SERVER_DOWN xét TRƯỚC chữ tràn: lỗi nạp model có thể chứa "n_ctx" mà vẫn là lỗi TẠM THỜI (được thử lại)
  if (code === "LLAMA_SERVER_DOWN") return new LoiModel(moTaLoi(e), { tamThoi: true, ma: "LLAMA_SERVER_DOWN" });
  // (Đợt 12 · H1.3) tràn cửa sổ ngữ cảnh: mã riêng, KHÔNG tạm thời (gọi lại y nguyên vẫn tràn) — lõi nén mạnh rồi thử một lần
  if (laLoiTranNguCanh(e)) return new LoiModel(moTaLoi(e), { tamThoi: false, ma: MA_LOI_TRAN_NGU_CANH });
  if (typeof code === "string" && code.startsWith("LLM_QUEUE_")) return new LoiModel(moTaLoi(e), { tamThoi: false, ma: code });
  if (code === "tool_calls_unsupported_path") return new LoiModel(moTaLoi(e), { tamThoi: false, ma: "TOOL_CALL_KHONG_HO_TRO" });
  // ★ H3.1b (lỗ L3) — RST / từ chối kết nối nằm trong `cause` (LoiStreamServer ⇒ fetch failed ⇒ ECONNRESET): tìm cả chuỗi. Thử lại CHỈ
  //   khi chưa phát gì ra người dùng; đứt SAU khi đã phát ⇒ giữ mã mạng nhưng không tạm thời.
  const maMang = maMangTrongChuoi(chuoi);
  if (maMang) return new LoiModel(moTaLoi(e), { tamThoi: !daPhat, ma: maMang });
  return new LoiModel(moTaLoi(e), { tamThoi: false, ma: "MODEL_LOI" });
}

function sangTinNhanGguf(ds: TinNhan[]): GgufChatMessage[] {
  return ds.map((m) => {
    const ra: GgufChatMessage = { role: m.role, content: m.content ?? "" };
    if (m.role === "assistant" && m.tool_calls?.length) ra.tool_calls = m.tool_calls;
    if (m.role === "tool" && m.tool_call_id) ra.tool_call_id = m.tool_call_id;
    if (m.role === "assistant" && m.reasoning_content?.trim()) ra.nghiTruoc = m.reasoning_content; // ★ 11.0 — chỉ có khi host bật giữ nghĩ
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
    const streamGoc: HamChatStream = cauHinh.chatStream ?? (await import("../../aiGgufEngine")).chatCompletionStream;
    // ★ Đợt 12 H4.2 — bộ GHI lượt (phát lại không GPU): CHỈ tiến trình đo đặt AI_GHI_LUOT_DIR (thư mục tuyệt đối, ngoài repo); điểm đọc
    //   biến DUY NHẤT (census). Vắng ⇒ engine y nguyên. Bộ ghi chuyển nguyên từng mảnh, ghi hỏng không làm hỏng lượt.
    const thuMucGhi = (process.env.AI_GHI_LUOT_DIR ?? "").trim();
    const chatCompletionStream: HamChatStream =
      thuMucGhi && cauHinh.runId ? (await import("./ghiLuotModel")).bocGhiLuot(streamGoc, { thuMuc: thuMucGhi, runId: cauHinh.runId }) : streamGoc;
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
      // ★ Đợt 11.0 (preserve_thinking — agent server mặc định BẬT) — lịch sử mang suy luận ⇒ bảo template GIỮ nó (`preserve_thinking`); vắng ⇒ thân yêu cầu như cũ.
      ...(nghi && vao.tinNhan.some((m) => m.role === "assistant" && m.reasoning_content?.trim()) ? { preserveThinking: true } : {}),
    };
    // ★ Đợt 9 — DẤU VẾT: đường agent đi NGOÀI cổng (gọi thẳng engine, không `planInference`) ⇒ không quota / safety / license và KHÔNG
    //   định tuyến theo vai trò (gốc của lỗ "tác nhân luôn dùng model mặc định"). Chưa đưa qua cổng thật (việc riêng); trong lúc đó mỗi lượt
    //   model để lại MỘT hàng bằng helper CHỈ-GHI `ghiLuotNgoaiCong` — dễ thay bằng `planInference().record()` khi agent qua cổng.
    //   Chỉ BĂM: prompt = đuôi TRAN_CHU_DAU_VET ký tự của hội thoại gửi đi; câu trả lời = chữ đã che; mã nguồn không được lưu.
    const t0 = Date.now();
    let chuDaPhat = "";
    // ★ H3.1b (lỗ L5) — lượt này đã phát chữ / suy luận nào ra người dùng chưa (chuDaPhat bị cắt ở trần băm nên không dùng được).
    let coChu = false;
    let coNghi = false;
    let ketThuc: GgufStreamChunk | null = null;
    let hoanTat = false;
    try {
    for await (const c of chatCompletionStream(options, modelId, vao.signal)) {
      if (c.type === "token" && typeof c.token === "string" && c.token) {
        const an = cheChu.push(catSuyLuan.push(c.token));
        if (an) {
          if (chuDaPhat.length < TRAN_CHU_DAU_VET) chuDaPhat += an;
          coChu = true;
          day({ loai: "chu", noiDung: an });
        }
      } else if (c.type === "reasoning" && typeof c.token === "string" && c.token) {
        const an = cheNghi.push(c.token);
        if (an) {
          coNghi = true;
          day({ loai: "nghi", noiDung: an });
        }
      } else if (c.type === "error") {
        if (laLoiTranNguCanh(c.error)) throw new LoiModel(`model stream error: ${c.error}`, { tamThoi: false, ma: MA_LOI_TRAN_NGU_CANH });
        throw new LoiModel(`model stream error: ${c.error ?? "unknown"}`, { tamThoi: true, ma: "MODEL_LOI_LUONG" });
      } else if (c.type === "done") {
        const conChu = cheChu.push(catSuyLuan.flush()) + cheChu.flush();
        if (conChu) {
          if (chuDaPhat.length < TRAN_CHU_DAU_VET) chuDaPhat += conChu;
          coChu = true;
          day({ loai: "chu", noiDung: conChu });
        }
        ketThuc = c;
        const conNghi = cheNghi.flush();
        if (conNghi) {
          coNghi = true;
          day({ loai: "nghi", noiDung: conNghi });
        }
        // ★ H3.1b (lỗ L5, C-P1 EMPTY_RESPONSE) — 200 mà không một chữ / tool (hoặc chỉ `<think>` không đóng — bộ cắt nuốt hết) ⇒ KHÔNG báo
        //   hoàn thành im lặng. Thử lại (tạm thời) CHỈ khi chưa phát gì ra người dùng — kể cả suy luận; đã hiện suy luận ⇒ dừng có lỗi.
        //   Lượt bị cắt ở trần (`length`) để lõi xử lý như cũ (biCat / G5-D).
        if (!coChu && !(Array.isArray(c.toolCalls) && c.toolCalls.length > 0) && c.finishReason !== "length") {
          throw new LoiModel(
            coNghi
              ? "model kết thúc lượt mà không có câu trả lời (chỉ có suy luận) — EMPTY_RESPONSE"
              : "model trả lời RỖNG (200 không chữ, không tool call) — EMPTY_RESPONSE",
            { tamThoi: !coNghi, ma: "EMPTY_RESPONSE" },
          );
        }
        hoanTat = true;
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
                  // ★ Đợt 12 H0.1 — tái dùng prefix-cache / xử lý lại (chỉ đường llama-server, luôn đi cặp).
                  ...(typeof c.cacheN === "number" && typeof c.promptN === "number" ? { cacheN: c.cacheN, promptN: c.promptN } : {}),
                },
              }
            : {}),
        });
        return;
      }
    }
    } finally {
      if (!cauHinh.khongGhiDauVet) ghiLuotNgoaiCong({
        task: "chat",
        auditTask: "kb_agent_luot",
        userId: cauHinh.userId ?? null,
        model: (typeof ketThuc?.modelId === "string" && ketThuc.modelId ? ketThuc.modelId : modelId ?? null) || null,
        tokensIn: ketThuc?.tokensPrompt,
        tokensOut: ketThuc?.tokensGenerated,
        reasoningTokens: typeof ketThuc?.tokensReasoning === "number" ? ketThuc.tokensReasoning : null,
        cacheTokens: typeof ketThuc?.cacheN === "number" ? ketThuc.cacheN : null,
        promptEvalTokens: typeof ketThuc?.promptN === "number" ? ketThuc.promptN : null,
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
