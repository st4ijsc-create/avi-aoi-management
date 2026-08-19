/**
 * ★★★ doc 79 · TRỤC 1 (C) — **TÁC NHÂN LẬP TRÌNH GỌI MODEL**: sinh mã đa mục đích + dựng đề xuất
 * sửa tệp cho `apply_diff`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI — MỘT NGÕ CỤT ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trục 1 làm cho chế độ lập trình TẤT ĐỊNH: câu có đường dẫn/lệnh/mẫu ⇒ gọi thẳng 1 trong 5 tool.
 * Nhưng `streamCodingAnswer` khi ấy chỉ có 5 đường ra, và đường thứ năm — *"không tool nào khớp"* —
 * **KHÔNG BAO GIỜ gọi model**. Hệ quả đo được (chủ dự án báo 2026-08-19): hỏi
 * *"viết code C# cho chương trình chat LAN sử dụng socket"* ⇒ nhận *"Chưa rõ yêu cầu lập trình…"*.
 * Mọi câu **SINH MÃ MỚI** (không đường dẫn, không lệnh) đều bị từ chối. File này là phần CÒN LẠI.
 *
 * Hai việc, cùng một cửa gọi model:
 *   • **SINH MÃ** — persona kỹ sư lập trình, KHÔNG RAG vận hành, có ngữ cảnh dự án đang chọn.
 *   • **SỬA TỆP** — model đọc nội dung THẬT (từ `read_file`) rồi sinh TOÀN BỘ tệp mới; kết quả đi
 *     qua HITL `proposeAction`/`confirmAction` của `apply_diff` (băm TOCTOU + tệp bẩn + hộp cát).
 *     Heuristic KHÔNG dựng được `{path, original, modified}` từ một câu trần — chỗ này cần LLM.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO CHỖ Ở LÀ `server/services/` CHỨ KHÔNG PHẢI `server/services/ai/`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `thinkingSurfaces.quantifier.test.ts` §2 chỉ công nhận bộ cắt khi ký hiệu ấy đến từ **module lá**
 * qua một chuỗi module khớp `/(^|\/)ai\/thinkingStrip$|(^|\/)aiGgufEngine$/`. Đặt file trong
 * `server/services/ai/` thì chuỗi nhập là `"./thinkingStrip"` — **KHÔNG khớp** ⇒ lưới coi lời khai
 * `tai_cho` là nói dối và ĐỎ. Ở đây chuỗi nhập là `"./ai/thinkingStrip"` ⇒ khớp. Đây không phải sở
 * thích sắp xếp thư mục: nó là điều kiện để hàng rào **được cưỡng chế**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VRAM — VÌ SAO MẶC ĐỊNH LÀ `task:"chat"`, KHÔNG PHẢI `task:"code"`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cấu hình đang chạy: `LLAMA_SERVER_MODEL=Qwen3-30B-A3B-Instruct` (llama-server GIỮ ~19 GB) và
 * `GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct` (**model KHÁC**). `generateTextStream` chỉ đi qua
 * llama-server khi `modelId` TRÙNG model server đang giữ; một `modelId` khác **rơi xuống đường
 * in-process** ⇒ nạp BẢN THỨ HAI ~19 GB trong khi card chỉ còn ~5,6 GB trống ⇒ OOM.
 * ⇒ Mặc định `AI_CODING_MODEL_TASK=chat`: dùng ĐÚNG model đang thường trú (còn được prefix-cache).
 *   Đặt `AI_CODING_MODEL_TASK=code` để dùng model Coder — **chỉ khi** `GGUF_CODE_MODEL` bằng
 *   `LLAMA_SERVER_MODEL`, hoặc card đủ chỗ cho bản thứ hai. Đây là quyết định vận hành, không phải
 *   mặc định trôi vào.
 */
import { StreamingSecretRedactor } from "./ai/aiSafety";
/**
 * ★ Bộ cắt chuỗi suy luận — import TĨNH từ module LÁ, đúng lý do đã ghi ở
 * `aiLocalKnowledgeService.ts`: engine chỉ được nhập ĐỘNG trong `try`, nên lấy bộ cắt từ engine là
 * fail-open (import hỏng ⇒ chạy tiếp không hàng rào); và mọi test `vi.mock("./aiGgufEngine")` sẽ
 * làm bộ cắt thành `undefined` mà không ca nào đỏ.
 */
import { StreamingThinkingStripper, thinkingStartsOpen } from "./ai/thinkingStrip";
import { guardGeneratedText, isDegenerateStream } from "./ai/generationGuard";
import { planInference } from "./aiGateway";

export type NgonNguMa = "vi" | "en" | "zh";

function w(lang: NgonNguMa, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỜ — mỗi việc một công tắc, mặc định BẬT (không có nó thì chủ dự án vẫn thấy hỏng)
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ `AI_CODING_GEN` — nhánh SINH MÃ ở chế độ lập trình. Mặc định **BẬT**; `"0"` ⇒ nhánh
 * "không tool nào khớp" quay lại `codingNoToolMessage()` (đường nói thật khi offline).
 *
 * ⚠ KHÔNG dùng chung cờ với `AI_TOOL_LLM_FALLBACK`: cờ ấy tắt bộ chọn tool VẬN HÀNH vì
 * false-positive 92,3% — một lớp lỗi HOÀN TOÀN KHÁC (chọn nhầm tool trên đường vận hành), không
 * liên quan tới việc sinh văn bản mã trong một phiên đã tự khai là phiên lập trình.
 */
export function codingGenEnabled(): boolean {
  return (process.env.AI_CODING_GEN ?? "1") !== "0";
}

/** ★ `AI_CODING_EDIT` — nhánh SỬA TỆP (model dựng `original`/`modified` cho `apply_diff`). BẬT sẵn. */
export function codingEditEnabled(): boolean {
  return (process.env.AI_CODING_EDIT ?? "1") !== "0";
}

/** Xem khối ⚠⚠ VRAM ở đầu file. `"code"` là opt-in có ý thức. */
function tacVuModel(): "chat" | "code" {
  return process.env.AI_CODING_MODEL_TASK === "code" ? "code" : "chat";
}

/**
 * Model có sẵn để sinh chữ không. **Fail-safe**: mọi lỗi ⇒ `false` ⇒ người gọi nói thẳng
 * "model chưa sẵn sàng", KHÔNG im lặng và KHÔNG giả vờ "chưa rõ yêu cầu".
 */
export async function codingModelSanSang(): Promise<boolean> {
  try {
    const { isGgufAvailable } = await import("./aiGgufEngine");
    return await isGgufAvailable();
  } catch (e) {
    console.warn("[aiCodingAgent] không hỏi được engine GGUF:", (e as Error)?.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỬA GỌI MODEL — **MỘT** điểm gọi `generateTextStream` cho cả sinh mã lẫn sửa tệp
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface YeuCauSinhChu {
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  /** Mặc định 1.05. Đường SỬA TỆP truyền 1.0: phạt lặp làm hỏng việc chép lại nguyên văn một tệp. */
  repeatPenalty?: number;
  userId?: number;
  /**
   * ★★★ Đường SỬA TỆP đặt `true`. Chữ model sinh ra ở đường ấy **sẽ được ghi ra đĩa**, nên prompt
   * phải tới model NGUYÊN VĂN: nếu `AI_SAFETY_ENABLED` bật và bộ che đầu vào thay một chuỗi trong
   * nội dung tệp, model sẽ chép lại chỗ CHE ĐÓ vào tệp mới — một lượt **hỏng câm** đúng nghĩa.
   * Lệch ⇒ NÉM `CODING_PROMPT_REDACTED`, người gọi nói thẳng thay vì đề xuất một diff bẩn.
   */
  nguyenVanPrompt?: boolean;
}

/**
 * ★★★ ĐIỂM GỌI `generateTextStream` DUY NHẤT của tác nhân lập trình (sổ khai lượng từ:
 * `server/services/aiCodingAgent.ts::streamCodingModel::generateTextStream`, `noi:"tai_cho"`).
 *
 * ⚠ Bộ cắt suy luận và bộ che bí mật dựng **NGOÀI mọi nhánh**, ngay dòng đầu. Bài học lặp lại của
 * repo này là *"lưới theo FILE, không theo ĐƯỜNG THOÁT"*: hàm này có nhiều đường thoát (ném ở
 * `planInference`, ném ở import engine, ném giữa luồng), và một bộ cắt dựng bên trong `try` là một
 * hàng rào chỉ tồn tại ở đúng một đường.
 *
 * ⚠ Trạng thái của CẢ HAI bộ lọc là của RIÊNG một lượt gọi (thẻ đang mở, mảnh bí mật ở đuôi) —
 * không bao giờ được nâng lên phạm vi module.
 */
export async function* streamCodingModel(y: YeuCauSinhChu): AsyncGenerator<string> {
  const catSuyLuan = new StreamingThinkingStripper({ startInsideThinking: thinkingStartsOpen() });
  const cheBiMat = new StreamingSecretRedactor();

  const plan = await planInference({ task: tacVuModel(), text: y.prompt, userId: y.userId });
  if (y.nguyenVanPrompt === true && plan.safeText !== y.prompt) {
    plan.record({ latencyMs: 0, outcome: "error" });
    throw new Error("CODING_PROMPT_REDACTED");
  }

  const batDau = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const { generateTextStream: ggufStream } = await import("./aiGgufEngine");
    for await (const chunk of ggufStream(
      {
        systemPrompt: y.systemPrompt,
        prompt: plan.safeText,
        maxTokens: y.maxTokens,
        temperature: y.temperature ?? 0.2,
        topP: 0.9,
        repeatPenalty: y.repeatPenalty ?? 1.05,
        contextSize: plan.decision.contextSize,
      },
      plan.decision.modelId,
    )) {
      if (chunk.type === "token" && typeof chunk.token === "string" && chunk.token.length > 0) {
        // CẮT thẻ suy luận TRƯỚC, CHE bí mật SAU — cả hai giữ trạng thái xuyên chunk (xem
        // `ai/thinkingStrip.ts`: cắt thẻ là phép XOÁ nên nó NỐI hai nửa một bí mật bị `<think>`
        // tách rời; bộ canh nội dung phải đứng CUỐI).
        const an = cheBiMat.push(catSuyLuan.push(chunk.token));
        if (an) yield an;
      } else if (chunk.type === "done") {
        tokensIn = chunk.tokensPrompt ?? 0;
        tokensOut = chunk.tokensGenerated ?? 0;
      } else if (chunk.type === "error") {
        throw new Error(chunk.error || "GGUF stream error");
      }
    }
    // Xả ĐÚNG THỨ TỰ: bộ cắt trước, phần ấy đi QUA bộ che, rồi mới xả bộ che — ngược lại thì đuôi
    // câu ra SAU phần đã che, đảo thứ tự chữ người đọc nhận được.
    const con = catSuyLuan.flush();
    const duoi = (con ? cheBiMat.push(con) : "") + cheBiMat.flush();
    if (duoi) yield duoi;
    plan.record({ tokensIn, tokensOut, latencyMs: Date.now() - batDau, outcome: "ok" });
  } catch (e) {
    plan.record({ latencyMs: Date.now() - batDau, outcome: "error" });
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CANH VÒNG LẶP THOÁI HOÁ — cùng vị từ với đường ops-chat, không viết bản sao thứ hai
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Kiểm đầu tiên sau bấy nhiêu ký tự (dưới ngưỡng này một đoạn mã bình thường dễ bị kêu oan). */
const CANH_TU_KY_TU = 600;
/** Nhịp kiểm lại. */
const CANH_MOI_KY_TU = 400;

export interface KetQuaChu {
  /** Chữ dùng được. **RỖNG khi `degraded`** — xem lý do ngay dưới. */
  text: string;
  degraded: boolean;
  reason: string;
}

/**
 * Rút một luồng chữ, canh vòng lặp thoái hoá SỚM (cắt ngang) rồi guard cuối.
 *
 * ⚠ KHÁC đường ops-chat ở đúng một điểm, có chủ ý: **KHÔNG dùng "phần đầu cứu được"**. Với văn xuôi
 * thì một nửa câu trả lời còn hơn không; với MÃ NGUỒN thì một tệp bị cắt cụt là một tệp HỎNG, và
 * nếu nó đi tiếp vào `apply_diff` thì ta vừa ghi mã hỏng ra đĩa. Đây đúng lập luận `runCodeModel`
 * đã dùng ở `aiProgrammingCopilot.ts`.
 *
 * Generator yield từng mảnh (để người dùng thấy tác nhân đang chạy) và TRẢ VỀ phán quyết cuối.
 */
export async function* rutChuCoCanh(nguon: AsyncGenerator<string>): AsyncGenerator<string, KetQuaChu> {
  let gom = "";
  let mocSau = CANH_TU_KY_TU;
  for await (const manh of nguon) {
    if (!manh) continue;
    gom += manh;
    yield manh;
    if (gom.length >= mocSau) {
      mocSau = gom.length + CANH_MOI_KY_TU;
      if (isDegenerateStream(gom)) {
        return { text: "", degraded: true, reason: "stream_loop" };
      }
    }
  }
  const g = guardGeneratedText(gom);
  if (g.degraded) return { text: "", degraded: true, reason: g.reason };
  return { text: g.text, degraded: false, reason: "" };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PERSONA — KỸ SƯ LẬP TRÌNH. **KHÔNG** trợ lý vận hành, **KHÔNG** RAG, **KHÔNG** [1][2].
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Ba câu cấm ở cuối persona không phải trang trí: đúng ba hình dạng câu trả lời mà chủ dự án gặp
 * hôm 2026-08-19 khi phiên lập trình rơi vào đường RAG vận hành (*"liên hệ kỹ sư kỹ thuật"*,
 * trích dẫn `[1][2]`, và câu vận hành nhà máy). Chúng được nêu ĐÍCH DANH để model không tái tạo lại
 * giọng ấy khi ngữ cảnh dự án mỏng.
 */
export function personaSinhMa(lang: NgonNguMa, nguCanhDuAn: string): string {
  const than = w(
    lang,
    [
      "Bạn là KỸ SƯ LẬP TRÌNH đang làm việc trong một không gian mã nguồn.",
      "",
      "NGUYÊN TẮC:",
      "1. Trả lời bằng TIẾNG VIỆT.",
      "2. Đưa MÃ HOÀN CHỈNH, biên dịch/chạy được, trong khối ```<ngôn ngữ> (```csharp, ```ts, ```sql…).",
      "3. Giải thích NGẮN: tối đa 5 gạch đầu dòng, đặt SAU khối mã.",
      "4. Thiếu thông tin thì NÊU GIẢ ĐỊNH rồi vẫn đưa mã — đừng hỏi lại rồi không làm gì.",
      "5. Không bịa thư viện/API không tồn tại.",
      "",
      "TUYỆT ĐỐI KHÔNG:",
      "• KHÔNG trích dẫn kiểu [1], [2] — bạn không đọc tài liệu vận hành nào.",
      "• KHÔNG nói \"liên hệ kỹ sư kỹ thuật\" hay \"tôi không có thông tin trong tài liệu hiện tại\".",
      "• KHÔNG trả lời như trợ lý vận hành nhà máy (OEE, lô, máy AOI) — đây là phiên LẬP TRÌNH.",
    ].join("\n"),
    [
      "You are a SOFTWARE ENGINEER working inside a source-code workspace.",
      "",
      "RULES:",
      "1. Answer in ENGLISH.",
      "2. Give COMPLETE, compilable/runnable code inside a ```<language> block (```csharp, ```ts, ```sql…).",
      "3. Keep prose SHORT: at most 5 bullets, placed AFTER the code block.",
      "4. If information is missing, STATE AN ASSUMPTION and still deliver code.",
      "5. Never invent libraries or APIs that do not exist.",
      "",
      "NEVER:",
      "• No [1], [2] style citations — you are not reading any operations document.",
      "• Never say \"contact a technical engineer\" or \"I have no information in the current documents\".",
      "• Never answer as a factory-operations assistant (OEE, lots, AOI machines) — this is a CODING session.",
    ].join("\n"),
    [
      "你是在源代码工作区中工作的软件工程师。",
      "",
      "规则：",
      "1. 用中文回答。",
      "2. 在 ```<语言> 代码块中给出完整、可编译/可运行的代码。",
      "3. 说明要短：最多 5 条要点，放在代码块之后。",
      "4. 信息不足时先说明假设，仍然给出代码。",
      "5. 不要臆造不存在的库或 API。",
      "",
      "绝对不要：",
      "• 不要使用 [1]、[2] 式引用——你并未阅读任何运维文档。",
      "• 不要说“请联系技术工程师”或“当前文档中没有相关信息”。",
      "• 不要以工厂运维助手的口吻回答（OEE、批次、AOI 设备）——这是编程会话。",
    ].join("\n"),
  );
  return nguCanhDuAn ? `${than}\n\n${nguCanhDuAn}` : than;
}

/**
 * Persona SỬA TỆP. Khác persona sinh mã ở một ràng buộc cứng: đầu ra phải là **TOÀN BỘ tệp mới**,
 * không phải một đoạn và cũng không phải một patch — vì `apply_diff` nhận `{original, modified}`
 * (hai chuỗi ĐẦY ĐỦ) chứ không nhận chuỗi diff, và server băm `original` để chứng minh tác nhân
 * đang nhìn đúng phiên bản (xem `writeHandlers/applyDiff.ts`).
 */
export function personaSuaTep(lang: NgonNguMa, nguCanhDuAn: string): string {
  const than = w(
    lang,
    [
      "Bạn là KỸ SƯ LẬP TRÌNH đang SỬA một tệp trong repo thật.",
      "",
      "ĐẦU RA BẮT BUỘC:",
      "1. ĐÚNG MỘT khối ```<ngôn ngữ> chứa TOÀN BỘ nội dung tệp SAU KHI SỬA.",
      "   KHÔNG phải một đoạn trích, KHÔNG phải patch/diff, KHÔNG phải chỉ hàm vừa đổi.",
      "2. GIỮ NGUYÊN từng ký tự mọi phần không liên quan tới yêu cầu: namespace/import, chú thích,",
      "   thứ tự thành viên, thụt đầu dòng, dòng trống.",
      "3. Trong khối mã chỉ có mã + chú thích hợp lệ của ngôn ngữ đó.",
      "4. SAU khối mã, viết tối đa 3 gạch đầu dòng nói bạn đã đổi GÌ và VÌ SAO.",
      "",
      "Không đạt được yêu cầu thì nói thẳng, ĐỪNG trả về một tệp cắt cụt.",
    ].join("\n"),
    [
      "You are a SOFTWARE ENGINEER EDITING one file in a real repository.",
      "",
      "REQUIRED OUTPUT:",
      "1. EXACTLY ONE ```<language> block containing the ENTIRE file AFTER the edit.",
      "   Not an excerpt, not a patch/diff, not just the changed function.",
      "2. Preserve character-for-character everything unrelated to the request: namespace/imports,",
      "   comments, member order, indentation, blank lines.",
      "3. Inside the block: code plus valid comments of that language only.",
      "4. AFTER the block, at most 3 bullets on WHAT changed and WHY.",
      "",
      "If you cannot satisfy the request, say so — never return a truncated file.",
    ].join("\n"),
    [
      "你是正在修改真实仓库中某个文件的软件工程师。",
      "",
      "输出要求：",
      "1. 恰好一个 ```<语言> 代码块，包含修改后的**整个文件**。",
      "   不是片段、不是补丁/diff、不是只有改动的函数。",
      "2. 与需求无关的部分逐字符保留：命名空间/导入、注释、成员顺序、缩进、空行。",
      "3. 代码块内只放代码与该语言的合法注释。",
      "4. 代码块之后，最多 3 条要点说明改了什么、为什么。",
      "",
      "如果无法满足需求就直说，绝不要返回被截断的文件。",
    ].join("\n"),
  );
  return nguCanhDuAn ? `${than}\n\n${nguCanhDuAn}` : than;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BÓC KHỐI MÃ + ĐỒNG BỘ KẾT THÚC DÒNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Bóc nội dung khối ``` … ``` **DÀI NHẤT** trong câu trả lời.
 *
 * ⚠ Chọn khối DÀI NHẤT chứ không phải khối đầu tiên: model hay mở đầu bằng một khối nhỏ minh hoạ
 * (`dotnet test …`) rồi mới tới tệp thật. Với đường SỬA TỆP, chọn nhầm khối nhỏ nghĩa là đề xuất
 * ghi đè cả tệp bằng ba dòng — hỏng CÂM và không có hàng rào nào bên dưới bắt được (băm khớp,
 * tệp sạch, hộp cát đều xanh vì lượt ghi ấy "hợp lệ").
 *
 * Trả `null` khi không có khối nào ⇒ người gọi TỪ CHỐI, không đoán bừa.
 */
export function bocKhoiMa(text: string): string | null {
  const re = /```[A-Za-z0-9+#._-]*[ \t]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let daiNhat: string | null = null;
  while ((m = re.exec(text)) !== null) {
    const than = m[1] ?? "";
    if (daiNhat === null || than.length > daiNhat.length) daiNhat = than;
  }
  return daiNhat;
}

/**
 * Đưa kết thúc dòng của `moi` về ĐÚNG kiểu của `goc`, và giữ nguyên việc có/không có dòng trống
 * cuối tệp.
 *
 * ⚠ VÌ SAO CẦN: model gần như luôn phát `\n`. Nếu tệp trên đĩa dùng CRLF thì một lượt sửa một dòng
 * sẽ hiện thành **diff toàn tệp** — người duyệt không còn nhìn thấy thay đổi THẬT giữa một biển
 * dòng đổi, tức hàng rào "người duyệt" bị vô hiệu hoá bằng nhiễu.
 */
export function dongBoXuongDong(goc: string, moi: string): string {
  const gocCrlf = goc.includes("\r\n");
  const chuan = moi.replace(/\r\n/g, "\n");
  let ra = gocCrlf ? chuan.replace(/\n/g, "\r\n") : chuan;
  const gocKetBangDong = /\r?\n$/.test(goc);
  const moiKetBangDong = /\r?\n$/.test(ra);
  if (gocKetBangDong && !moiKetBangDong) ra += gocCrlf ? "\r\n" : "\n";
  else if (!gocKetBangDong && moiKetBangDong) ra = ra.replace(/\r?\n$/, "");
  return ra;
}

/** Nhãn ngôn ngữ cho khối ``` theo đuôi tệp — chỉ để prompt đọc tự nhiên, không phải cổng an toàn. */
export function nhanNgonNgu(duong: string): string {
  const duoi = (duong.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();
  switch (duoi) {
    case ".cs": return "csharp";
    case ".csproj":
    case ".sln":
    case ".html":
    case ".xml": return "xml";
    case ".ts": return "typescript";
    case ".tsx": return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs": return "javascript";
    case ".jsx": return "jsx";
    case ".json": return "json";
    case ".sql": return "sql";
    case ".md": return "markdown";
    case ".css":
    case ".scss": return "css";
    case ".yml":
    case ".yaml": return "yaml";
    case ".sh": return "bash";
    default: return "";
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DỰNG PROMPT
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Trần ký tự nội dung tệp đưa vào prompt sửa. Lớn hơn ⇒ từ chối (xem `LY_DO_TU_CHOI_SUA`). */
export const TRAN_KY_TU_TEP_SUA = 60_000;

export function promptSuaTep(duong: string, noiDung: string, yeuCau: string, lang: NgonNguMa): string {
  const nhan = nhanNgonNgu(duong);
  return [
    w(lang, `Tệp: ${duong}`, `File: ${duong}`, `文件：${duong}`),
    "",
    w(lang, "=== NỘI DUNG HIỆN TẠI (nguyên văn) ===", "=== CURRENT CONTENT (verbatim) ===", "=== 当前内容（原样）==="),
    "```" + nhan,
    noiDung,
    "```",
    "",
    w(lang, "=== YÊU CẦU ===", "=== REQUEST ===", "=== 需求 ==="),
    yeuCau,
    "",
    w(
      lang,
      "Trả về TOÀN BỘ tệp sau khi sửa trong một khối mã duy nhất.",
      "Return the ENTIRE file after the edit in a single code block.",
      "在唯一一个代码块中返回修改后的整个文件。",
    ),
  ].join("\n");
}

export function promptSinhMa(cauHoi: string, lang: NgonNguMa): string {
  return [
    w(lang, "=== YÊU CẦU LẬP TRÌNH ===", "=== CODING REQUEST ===", "=== 编程需求 ==="),
    cauHoi,
  ].join("\n");
}

/**
 * Trần token cho một lượt sinh. Đường SỬA phải đủ chỗ chép lại CẢ tệp cộng phần giải thích, nếu
 * không model bị cắt giữa chừng và ta nhận về một tệp cụt (đã chặn ở `rutChuCoCanh`, nhưng chặn
 * xong thì người dùng không có gì — thà cấp đủ token ngay từ đầu).
 */
export function tranTokenChoTep(soKyTu: number): number {
  // ~2,6 ký tự/token cho mã nguồn là ước tính thận trọng; cộng 700 cho phần giải thích + lề.
  return Math.min(12_000, Math.max(1_400, Math.ceil(soKyTu / 2.6) + 700));
}
