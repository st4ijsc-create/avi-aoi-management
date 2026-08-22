/**
 * ★★★ G2-C — VÒNG LẶP TOOL **TỰ DO CÓ CHẶN** cho đường chat.
 *
 * ─── VẤN ĐỀ ĐO ĐƯỢC ────────────────────────────────────────────────────────────────────────────
 * `aiLocalKnowledgeService.answerQuestion` gọi `tryExecuteTool` **ĐÚNG MỘT LẦN**, nhét
 * `result.textSummary` vào prompt rồi sinh câu trả lời. Model **không bao giờ** nhìn kết quả tool
 * rồi quyết định gọi tool tiếp. Hệ quả: câu *"tuần này line 3 defect gì tăng, VÌ SAO?"* chết ở vế
 * "vì sao" — nó cần HAI bước (lấy Pareto → chạy phân tích nguyên nhân TRÊN kết quả đó).
 * Đường Agent (`aiAgentOrchestrator`) có đa bước nhưng là **plan-then-execute**: lập trọn kế hoạch
 * TRƯỚC khi thấy dữ liệu, nên nó không giải được lớp câu hỏi mà bước sau phụ thuộc bước trước.
 *
 * ─── VÌ SAO FILE NÀY THUẦN (không import registry, không gọi LLM, không đọc DB) ─────────────────
 * Mọi tác dụng phụ đều được TIÊM: chọn tool (`deciders`), chạy tool (`execute`), kill-switch, và
 * cả ĐỒNG HỒ (`now`). Lý do không phải là thẩm mỹ mà là **đo được**: trần thời gian và trần token
 * chỉ chứng minh được bằng số vòng THẬT dưới một đồng hồ điều khiển được — một lưới đi qua mock
 * cấp cao sẽ xanh vì lý do khác (repo này đã trả giá 10 lần cho thiết bị đo hỏng trong hai ngày).
 * Phần WIRING thật (registry + LLM + kill-switch DB) nằm ở `index.ts::tryExecuteToolLoop`.
 *
 * ─── BỐN TRẦN, VÀ VÌ SAO CHỌN SỐ ĐÓ ────────────────────────────────────────────────────────────
 *  1. `maxRounds` = 3. Ca thúc đẩy cần ĐÚNG 2 vòng; 3 cho đúng một bước hụt được phép xảy ra mà
 *     không mở ngân sách vô hạn. (Đường Agent dùng 6 — nhưng nó lập kế hoạch trước, mỗi bước đã
 *     được duyệt hình dạng; một vòng lặp tự do rủi ro hơn mỗi vòng nên được ít vòng hơn.)
 *  2. `maxMs` = 20 000. Đường trả lời LLM hiện đã tốn 10–15 s (chú thích :2154 của service). Một
 *     lượt chat vượt ~30 s là không dùng được; 20 s cho pha tool còn chỗ cho pha sinh câu trả lời.
 *  3. `maxToolTokens` = **suy ra từ `serverSlotContextTokens()`**, KHÔNG phải một hằng 32768 thứ
 *     hai (`repo này đã dính "N+1 bản sao một hằng số" 17 lần`). Lấy 25% ngân sách slot: prompt
 *     còn phải chở system prompt + tối đa `topK`×`KB_QA_CTX_CAP` (5×1200 ký tự ≈ 2 143 token) +
 *     hints + lịch sử + chỗ dành cho câu trả lời. 25% của 32 768 = 8 192 token ≈ 22 900 ký tự.
 *  4. `lap_lai` — cùng tool + cùng args ⇒ dừng. Không phải "tối ưu": một vòng lặp gọi lại y hệt
 *     là một vòng lặp KHÔNG học được gì từ quan sát, và nó sẽ đốt hết ba trần kia mới chịu dừng.
 *
 * ★ BẤT BIẾN NGÂN SÁCH (có ca canh): tổng token quan sát **KHÔNG BAO GIỜ** vượt `maxToolTokens`,
 *   kể cả khi mỗi tool trả 1 MB — trần MỖI KHỐI được chia từ trần TỔNG (`tranMoiKhoiKyTu`), nên
 *   bất biến đúng theo CẤU TẠO chứ không nhờ "may là kết quả ngắn".
 *
 * ⚠⚠ AN TOÀN — VÒNG LẶP KHUẾCH ĐẠI MỘT LỖ ĐÃ CÓ. `scanForInjection` chỉ quét câu hỏi của người
 * dùng; kết quả tool thì KHÔNG. Với một vòng gọi, rủi ro còn hạn chế. Với vòng lặp tự do, nội dung
 * do kẻ khác kiểm soát quay lại prompt NHIỀU LẦN và có thể lái các lượt gọi tool tiếp theo. Ở đây
 * quy tắc là CỨNG và không có cờ tắt: một kết quả tool bị `scanUntrustedContent` chấm `high` thì
 * **KHÔNG có vòng sau** (`menh_lenh_trong_du_lieu`). Dữ liệu vẫn được dùng để TRẢ LỜI (số liệu
 * thật vẫn thật) nhưng nó đã hết khả năng chọn hành động — xem `docs` của `stop` bên dưới.
 */
import {
  sanitizeUntrustedBlock,
  wrapUntrustedBlock,
  UNTRUSTED_DEFAULT_MAX_CHARS,
  UNTRUSTED_TRUNCATE_SUFFIX,
  type InjectionRisk,
} from "../ai/aiSafety";
// ⚠ Ước lượng token dùng CHUNG với cổng ngân sách ngữ cảnh (`kiemNganSachNguCanh`): cùng hằng
// 2,8 ký tự/token đã ĐO bằng chính tokenizer của model đang phục vụ. KHÔNG viết lại phép ước
// lượng ở đây — hai bản sao sẽ trôi khỏi nhau và cái yếu hơn sẽ là cái đang canh.
import { uocLuongSoToken, serverSlotContextTokens } from "../aiLlamaServerClient";
import type { ToolDecision } from "./intentClassifier";
import type { ClientActionDirective, ToolResult } from "./toolRegistry";
import type { PendingActionDTO } from "../aiCopilotActions";

// ─── Kiểu ──────────────────────────────────────────────────────────────────────────────────────

/** Kết quả MỘT lượt chạy tool, đúng hình dạng `tryExecuteTool` đã trả về từ trước. */
export interface ToolLoopExecOutcome {
  result: ToolResult | null;
  pendingAction?: PendingActionDTO | null;
  clientAction?: ClientActionDirective | null;
  denied?: { message: string; reason?: string } | null;
  error?: string | null;
}

/** Quan sát rút gọn của một vòng, ĐÃ LÀM SẠCH — đây là thứ duy nhất bộ chọn vòng sau được thấy. */
export interface ToolLoopQuanSat {
  tool: string;
  args: Record<string, unknown>;
  /** `textSummary` đã trung hoà hàng rào + che bí mật + cắt theo trần. */
  summary: string;
}

export interface ToolLoopRound {
  round: number;
  tool: string | null;
  args: Record<string, unknown>;
  /** null khi vòng này không sinh dữ liệu (write/client/denied/lỗi). */
  summary: string | null;
  tokens: number;
  ms: number;
  injectionRisk: InjectionRisk;
  injectionMatched: string[];
  error: string | null;
}

/**
 * Vì sao vòng lặp dừng. Mọi giá trị đều là một mệnh đề KIỂM CHỨNG ĐƯỢC, không có "unknown".
 *  - `ket_luan`                : bộ chọn nói "đủ rồi" (`tool: null`) — đường kết thúc mong muốn.
 *  - `khong_co_tool`           : ngay vòng 1 không tool nào khớp ⇒ y hệt hành vi trước G2-C.
 *  - `het_vong` / `het_gio` / `het_ngan_sach` / `lap_lai` : bốn trần.
 *  - `cho_phe_duyet`           : gặp write tool ⇒ HITL. Vòng lặp KHÔNG được là đường vòng qua cổng.
 *  - `hanh_dong_client` / `tu_choi` : hai đường thoát sẵn có của `tryExecuteTool`.
 *  - `menh_lenh_trong_du_lieu` : kết quả tool chứa chỉ thị ⇒ cắt khả năng lái vòng sau.
 *  - `kill_switch`             : cầu chì tự trị đang bật.
 *  - `loi`                     : bộ chọn/executor hỏng — nói thẳng, không nuốt.
 */
export type ToolLoopStop =
  | "ket_luan"
  | "khong_co_tool"
  | "het_vong"
  | "het_gio"
  | "het_ngan_sach"
  | "lap_lai"
  | "cho_phe_duyet"
  | "hanh_dong_client"
  | "tu_choi"
  | "menh_lenh_trong_du_lieu"
  | "kill_switch"
  | "loi";

export interface ToolLoopProgress {
  round: number;
  phase: "dang_goi" | "xong" | "dung";
  tool: string | null;
  elapsedMs: number;
  stop?: ToolLoopStop;
}

export interface ToolLoopLimits {
  maxRounds: number;
  maxMs: number;
  maxToolTokens: number;
}

export interface ToolLoopResult {
  rounds: ToolLoopRound[];
  stop: ToolLoopStop;
  /** Khối đã BỌC hàng rào "dữ liệu không tin cậy", sẵn sàng nhét vào prompt. null = không có dữ liệu. */
  promptBlock: string | null;
  /** `ToolResult` của vòng CUỐI có dữ liệu — giữ nguyên hình dạng cho mọi consumer cũ. */
  lastResult: ToolResult | null;
  /** Quyết định của VÒNG 1 — `toolName` hiển thị/ghi log vẫn là cái người dùng hỏi trực tiếp. */
  firstDecision: ToolDecision;
  pendingAction: PendingActionDTO | null;
  clientAction: ClientActionDirective | null;
  denied: { message: string; reason?: string } | null;
  errors: Array<{ round: number; tool: string | null; code: string }>;
  tokensUsed: number;
  elapsedMs: number;
  /** null khi không vòng nào bị chấm `high`. */
  injection: { risk: InjectionRisk; matched: string[]; rounds: number[] } | null;
}

export interface ToolLoopDeciders {
  /** Vòng 1 — CHỈ nhìn câu hỏi (đúng hành vi `tryExecuteTool` hiện tại). */
  first: () => Promise<ToolDecision>;
  /** Vòng ≥2 — nhìn câu hỏi + các quan sát ĐÃ LÀM SẠCH. */
  next: (quanSat: ToolLoopQuanSat[]) => Promise<ToolDecision>;
}

// ─── Trần ──────────────────────────────────────────────────────────────────────────────────────

/** Phần ngân sách ngữ cảnh MỘT SLOT dành cho kết quả tool tích luỹ. Xem lập luận đầu file. */
export const TOOL_LOOP_CTX_FRACTION = 0.25;

export const TOOL_LOOP_DEFAULTS = {
  maxRounds: 3,
  maxMs: 20_000,
} as const;

/** Số nguyên dương từ env, hoặc `undefined` khi vắng/vô lý (0, âm, không phải số). */
function soDuongTuEnv(ten: string): number | undefined {
  const v = Number(process.env[ten]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

/**
 * Trần đang có hiệu lực. Đọc TẠI THỜI ĐIỂM GỌI (không cache) để một lượt đổi env/cấu hình có tác
 * dụng ngay — cùng lối với `aiAgentOrchestrator`'s tunables.
 */
export function docTranVongLap(): ToolLoopLimits {
  return {
    maxRounds: soDuongTuEnv("AI_TOOL_LOOP_MAX_ROUNDS") ?? TOOL_LOOP_DEFAULTS.maxRounds,
    maxMs: soDuongTuEnv("AI_TOOL_LOOP_MAX_MS") ?? TOOL_LOOP_DEFAULTS.maxMs,
    maxToolTokens:
      soDuongTuEnv("AI_TOOL_LOOP_MAX_TOOL_TOKENS") ??
      Math.max(256, Math.floor(serverSlotContextTokens() * TOOL_LOOP_CTX_FRACTION)),
  };
}

/**
 * Trần ký tự MỘT khối (một lượt kết quả tool). Mặc định dùng lại `UNTRUSTED_DEFAULT_MAX_CHARS`.
 *
 * ⚠ BẢN NHÁP ĐẦU CHIA TRẦN TỔNG CHO `maxRounds` — VÀ LƯỚI BẮT ĐƯỢC RẰNG NÓ SAI. Khi trần mỗi khối
 * đúng bằng `maxToolTokens / maxRounds`, một khối "đầy" làm ngân sách chạm đáy ĐÚNG ở vòng
 * `maxRounds`, còn khối nhỏ hơn thì KHÔNG BAO GIỜ chạm ⇒ nhánh `het_ngan_sach` **không thể tự
 * kích hoạt**: nó chỉ trùng với `het_vong`. Một cái trần không bao giờ tự cắt được là một cái
 * trần TRANG TRÍ. Bây giờ trần tổng được cưỡng chế bằng cách CẮT KHỐI CUỐI vừa đúng phần ngân
 * sách còn lại (`capChoVongNay`), nên vừa có bất biến CỨNG vừa có một nhánh dừng thật.
 */
function tranMoiKhoiKyTu(): number {
  return soDuongTuEnv("AI_TOOL_LOOP_MAX_BLOCK_CHARS") ?? UNTRUSTED_DEFAULT_MAX_CHARS;
}

/**
 * Trần ký tự cho khối của VÒNG NÀY = min(trần mỗi khối, phần ngân sách token còn lại quy ra ký
 * tự). Trừ đúng độ dài hậu tố "đã cắt" vì `sanitizeUntrustedBlock` NỐI hậu tố SAU khi cắt —
 * không trừ thì khối cuối vượt trần tổng đúng 9 ký tự, và một bất biến "cứng" hụt 9 ký tự vẫn là
 * một bất biến SAI.
 */
function capChoVongNay(capKhoi: number, tokenConLai: number): number {
  const theoNganSach = Math.floor(tokenConLai * 2.8) - UNTRUSTED_TRUNCATE_SUFFIX.length;
  return Math.max(1, Math.min(capKhoi, theoNganSach));
}

/**
 * ★ "KHÔNG CHỌN ĐƯỢC TOOL" có HAI nghĩa hoàn toàn khác nhau, và trước G2-C cả hai đều im lặng:
 *   (a) bộ chọn **bỏ phiếu trắng** — không tool nào hợp (`LLM_NONE`) hoặc người vận hành đã TẮT
 *       fallback (`LLM_FALLBACK_DISABLED`, chính là cấu hình đang chạy `AI_TOOL_LLM_FALLBACK=0`).
 *       Đây là hành vi ĐÚNG, không được kêu — kêu ở đây là cảnh báo trên MỌI câu hỏi RAG.
 *   (b) bộ chọn **KHÔNG CHẠY ĐƯỢC** — engine chết, HTTP lỗi. Câu trả lời sau đó dựa trên tài liệu
 *       mà người dùng KHÔNG biết rằng đường số-liệu-sống vừa hỏng. Đây là ca brief mô tả.
 * Chỉ (b) mới là lỗi. Một vị từ, dùng chung cho cả vòng lặp lẫn `tryExecuteTool` — hai bản sao sẽ
 * trôi, và bản lỏng hơn sẽ là bản đang chạy.
 */
export function laLoiBoChonTool(reason: string | undefined | null): boolean {
  return /^(LLM_FETCH_ERROR|LLM_HTTP_)/.test(String(reason ?? ""));
}

// ─── Guard lặp ─────────────────────────────────────────────────────────────────────────────────

/**
 * Khoá nhận dạng MỘT lượt gọi. Khoá phải ỔN ĐỊNH theo THỨ TỰ KHOÁ: `JSON.stringify` trần cho
 * `{a:1,b:2}` và `{b:2,a:1}` hai chuỗi khác nhau ⇒ guard sẽ mù với đúng ca mà một model hay tạo
 * ra (cùng args, thứ tự khoá khác). Đệ quy để `{f:{x:1,y:2}}` cũng ổn định.
 */
function khoaOnDinh(tool: string, args: unknown): string {
  const chuanHoa = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(chuanHoa);
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = chuanHoa(o[k]);
        return acc;
      }, {});
  };
  try {
    return `${tool}|${JSON.stringify(chuanHoa(args))}`;
  } catch {
    // Args có vòng tham chiếu — không đáng tin để so trùng; trả khoá duy nhất để KHÔNG chặn oan.
    return `${tool}|${Math.random()}`;
  }
}

// ─── Vòng lặp ──────────────────────────────────────────────────────────────────────────────────

export interface RunToolLoopDeps {
  deciders: ToolLoopDeciders;
  execute: (decision: ToolDecision, round: number) => Promise<ToolLoopExecOutcome>;
  /**
   * Cầu chì tự trị. **Ném hoặc trả `true` ⇒ dừng** (fail-closed, cùng posture với
   * `isKillSwitchTripped`, vốn tự nó đã fail-closed khi DB hỏng).
   * ⚠ CỐ Ý KHÔNG hỏi trước vòng 1: vòng 1 CHÍNH LÀ hành vi chat một-lượt đã có từ trước G2-C.
   * Nếu cầu chì chặn cả vòng 1 thì bật cầu chì = tắt luôn trợ lý chat, một hệ quả không ai
   * khai báo và không ai muốn. Cầu chì cắt cái MỚI: khả năng tự đi tiếp.
   */
  killSwitch?: () => Promise<boolean>;
  limits?: Partial<ToolLoopLimits>;
  onProgress?: (p: ToolLoopProgress) => void;
  /** Đồng hồ tiêm được — để trần thời gian đo được mà không phải ngủ thật trong test. */
  now?: () => number;
}

export async function runToolLoop(deps: RunToolLoopDeps): Promise<ToolLoopResult> {
  const now = deps.now ?? Date.now;
  const limits: ToolLoopLimits = { ...docTranVongLap(), ...deps.limits };
  const capKhoi = tranMoiKhoiKyTu();
  const batDau = now();

  const rounds: ToolLoopRound[] = [];
  const quanSat: ToolLoopQuanSat[] = [];
  const khoiBoc: string[] = [];
  const errors: ToolLoopResult["errors"] = [];
  const daGoi = new Set<string>();
  const nhanTiem = new Set<string>();
  const vongTiem: number[] = [];

  let firstDecision: ToolDecision = { tool: null, args: {}, reason: "CHUA_CHAY" };
  let lastResult: ToolResult | null = null;
  let pendingAction: PendingActionDTO | null = null;
  let clientAction: ClientActionDirective | null = null;
  let denied: ToolLoopResult["denied"] = null;
  let tokensUsed = 0;
  let stop: ToolLoopStop = "het_vong";

  const bao = (p: ToolLoopProgress): void => {
    // Một FE/consumer hỏng KHÔNG được làm hỏng vòng lặp đang chạy.
    try {
      deps.onProgress?.(p);
    } catch {
      /* nuốt CÓ CHỦ Ý — đây là kênh hiển thị, không phải kênh quyết định */
    }
  };

  for (let round = 1; round <= limits.maxRounds; round++) {
    // ── Cầu chì (từ vòng 2 trở đi — xem doc của `killSwitch`) ──
    if (round > 1 && deps.killSwitch) {
      let tripped = true;
      try {
        tripped = await deps.killSwitch();
      } catch {
        tripped = true; // fail-CLOSED
      }
      if (tripped) {
        stop = "kill_switch";
        break;
      }
    }

    // ── Chọn tool ──
    let decision: ToolDecision;
    try {
      // ⚠ BẢN SAO PHÒNG VỆ, không phải mảng sống. Bộ chọn vòng sau là nơi nội dung KHÔNG TIN CẬY
      // đi qua; đưa cho nó mảng trạng thái THẬT nghĩa là nó (hoặc một lớp bọc sau này) sửa được
      // sổ quan sát của vòng lặp. Lưới bắt được đúng chỗ này: một khẳng định về `mock.calls[0]`
      // đọc ra trạng thái của LƯỢT SAU vì cả hai lượt trỏ chung một mảng.
      decision = round === 1 ? await deps.deciders.first() : await deps.deciders.next([...quanSat]);
    } catch (err) {
      errors.push({ round, tool: null, code: err instanceof Error ? err.message : String(err) });
      stop = "loi";
      break;
    }
    if (round === 1) firstDecision = decision;

    if (!decision.tool) {
      if (laLoiBoChonTool(decision.reason)) {
        // KHÔNG được khai là "ket_luan": bộ chọn không kết luận gì cả, nó chết.
        errors.push({ round, tool: null, code: decision.reason });
        stop = "loi";
      } else {
        stop = round === 1 ? "khong_co_tool" : "ket_luan";
      }
      break;
    }

    // ── Guard lặp vô ích ──
    const khoa = khoaOnDinh(decision.tool, decision.args);
    if (daGoi.has(khoa)) {
      stop = "lap_lai";
      break;
    }
    daGoi.add(khoa);

    // ── Chạy ──
    bao({ round, phase: "dang_goi", tool: decision.tool, elapsedMs: now() - batDau });
    const t0 = now();
    let outcome: ToolLoopExecOutcome;
    try {
      outcome = await deps.execute(decision, round);
    } catch (err) {
      // data-raw-ok: ⚠ NGƯỜI TIÊU THỤ Ở ĐÂY LÀ CHÍNH MÔ HÌNH LLM — outcome này được đưa
      // ngược vào prompt vòng sau để mô hình tự sửa lời gọi công cụ. Dịch sang tiếng Việt là
      // làm mô hình khó hiểu hơn, không phải làm người dùng dễ hiểu hơn.
      outcome = { result: null, error: err instanceof Error ? err.message : String(err) };
    }
    const ms = now() - t0;

    const ghi: ToolLoopRound = {
      round,
      tool: decision.tool,
      args: (decision.args ?? {}) as Record<string, unknown>,
      summary: null,
      tokens: 0,
      ms,
      injectionRisk: "none",
      injectionMatched: [],
      error: outcome.error ?? null,
    };

    // ── Ba đường thoát ĐÃ CÓ TỪ TRƯỚC, giữ nguyên ngữ nghĩa ──
    if (outcome.pendingAction) {
      pendingAction = outcome.pendingAction;
      rounds.push(ghi);
      bao({ round, phase: "xong", tool: decision.tool, elapsedMs: now() - batDau });
      stop = "cho_phe_duyet";
      break;
    }
    if (outcome.clientAction) {
      clientAction = outcome.clientAction;
      rounds.push(ghi);
      stop = "hanh_dong_client";
      break;
    }
    if (outcome.denied) {
      denied = outcome.denied;
      rounds.push(ghi);
      stop = "tu_choi";
      break;
    }
    if (outcome.error || !outcome.result) {
      if (outcome.error) errors.push({ round, tool: decision.tool, code: outcome.error });
      rounds.push(ghi);
      bao({ round, phase: "xong", tool: decision.tool, elapsedMs: now() - batDau });
      stop = outcome.error ? "loi" : "ket_luan";
      break;
    }

    // ── Làm sạch + bọc hàng rào TRƯỚC KHI bất kỳ ai (kể cả bộ chọn vòng sau) nhìn thấy ──
    const sach = sanitizeUntrustedBlock(outcome.result.textSummary ?? "", {
      maxChars: capChoVongNay(capKhoi, limits.maxToolTokens - tokensUsed),
    });
    ghi.summary = sach.text;
    ghi.tokens = uocLuongSoToken(sach.text);
    ghi.injectionRisk = sach.risk;
    ghi.injectionMatched = sach.matched;
    lastResult = outcome.result;
    tokensUsed += ghi.tokens;
    quanSat.push({ tool: decision.tool, args: ghi.args, summary: sach.text });
    khoiBoc.push(wrapUntrustedBlock(`tool:${decision.tool} (vòng ${round})`, sach.text));
    rounds.push(ghi);
    bao({ round, phase: "xong", tool: decision.tool, elapsedMs: now() - batDau });

    // ── ★★★ CẮT KHẢ NĂNG LÁI: dữ liệu mang chỉ thị thì KHÔNG có vòng sau ──
    if (sach.risk === "high") {
      for (const n of sach.matched) nhanTiem.add(n);
      vongTiem.push(round);
      stop = "menh_lenh_trong_du_lieu";
      break;
    }

    // ── Trần token / trần thời gian ──
    if (tokensUsed >= limits.maxToolTokens) {
      stop = "het_ngan_sach";
      break;
    }
    if (now() - batDau >= limits.maxMs) {
      stop = "het_gio";
      break;
    }
    if (round === limits.maxRounds) stop = "het_vong";
  }

  const elapsedMs = now() - batDau;
  bao({ round: rounds.length, phase: "dung", tool: rounds.at(-1)?.tool ?? null, elapsedMs, stop });

  return {
    rounds,
    stop,
    promptBlock: khoiBoc.length > 0 ? khoiBoc.join("\n") : null,
    lastResult,
    firstDecision,
    pendingAction,
    clientAction,
    denied,
    errors,
    tokensUsed,
    elapsedMs,
    injection:
      vongTiem.length > 0 ? { risk: "high", matched: [...nhanTiem], rounds: vongTiem } : null,
  };
}
