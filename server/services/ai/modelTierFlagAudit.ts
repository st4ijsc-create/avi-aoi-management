/**
 * modelTierFlagAudit.ts — G1-C (2026-08-16): **CỜ KHAI BẬT MÀ TẦNG CHẾT KHÔNG ĐƯỢC PHÉP IM LẶNG.**
 *
 * ─── VÌ SAO MODULE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Lớp lỗi *"cờ `*_ENABLED=true` nhưng model tương ứng rỗng/không có trên đĩa ⇒ tầng âm thầm rơi
 * về model khác, KHÔNG có gì đỏ"* đã tái diễn NHIỀU LẦN ở repo này. Nó được vá đúng MỘT lần, cho
 * đúng MỘT cờ: `AI_THINKING_TIER_ENABLED` (doc69 G2-6 → `aiModelRouter.getThinkingTierStatus()` +
 * `reportThinkingTierStatus()`, đã gắn ở `_core/index.ts`). Bản vá đó ĐÚNG và VẪN CHẠY — nhưng nó
 * là một bản vá **RIÊNG LẺ, viết tay cho một cờ**. Mọi cặp cờ↔model khác (code router, reranker
 * gguf, embed, sidecar thị giác) KHÔNG có gì tương đương ⇒ vẫn hỏng-trong-im-lặng y hệt.
 *
 * ⇒ Module này biến bản vá một-lần ấy thành **MỘT BẢNG KHAI BÁO**. Thêm một cặp cờ↔model mới chỉ
 * là thêm MỘT dòng vào `TIER_FLAG_SPECS`; không ai phải nhớ viết lại logic cảnh báo. Đó là điều
 * làm cho lớp lỗi này **không thể im lặng lần nữa** — thay vì trông chờ người sau tự nhớ.
 *
 * ─── PHẠM VI (khai thẳng, để không ai tưởng nó bảo vệ nhiều hơn thực tế) ──────────────────────
 * Module này CHỈ trả lời: *"cờ đang BẬT — thứ nó cần có thật trên đĩa không?"*. Nó KHÔNG:
 *   • nạp model, KHÔNG chạm GPU, KHÔNG gọi mạng, KHÔNG ghi DB (chỉ `fs.existsSync` gián tiếp);
 *   • KHÔNG chặn boot — cảnh báo, không ném (mọi tầng ở đây đều đã có đường degrade an toàn).
 * ⚠ Khoảng hở còn lại: một cặp cờ↔model KHÔNG được khai vào bảng thì vẫn mù. Bảng là bề mặt phải
 * giữ đúng — nhưng nó nhỏ hơn hẳn "nhớ viết tay một cơ chế cảnh báo cho mỗi cờ".
 */
import { toBasename } from "./modelResolver";

/** Một model mà một cờ tầng PHỤ THUỘC vào. */
export interface TierModelRequirement {
  /** Tên biến env chứa model (vd "GGUF_THINKING_MODEL"). */
  env: string;
  /**
   * "basename" — giá trị là basename GGUF, tra qua `ggufModelFileExists` (GGUF_MODELS_DIR/uploads).
   * "path"     — giá trị là đường dẫn tuyệt đối/tương đối tới một file, tra bằng fs.existsSync.
   */
  kind: "basename" | "path";
  /**
   * true  → env RỖNG là LỖI (tầng không có gì để chạy).
   * false → env rỗng là chấp nhận được vì có fallback; chỉ kiểm tra khi có giá trị.
   */
  requiredWhenOn: boolean;
  /**
   * G5-B (2026-08-16) — tên các env mà giá trị này KHÔNG ĐƯỢC TRÙNG (so theo basename).
   *
   * Vì sao cần: `requiredWhenOn` chỉ bắt được ca *"bỏ trống"*. Nó MÙ với ca **gộp roster** — ai đó
   * trỏ một model chuyên dụng vào chính model chat vạn năng. Khi đó env ĐÃ gán, file CÓ THẬT ⇒
   * cả "unset" lẫn "missing" đều im, mà tầng vẫn chết đúng kiểu nó chết khi bỏ trống. Hình dạng
   * hỏng giống hệt, nên nó phải kêu bằng cùng một cơ chế — không phải cơ chế cảnh báo thứ hai.
   */
  mustDifferFrom?: string[];
  /** Điều gì THỰC SỰ xảy ra khi thiếu — câu này đi thẳng vào log, nên phải cụ thể. */
  impact: string;
}

export interface TierFlagSpec {
  /** Nhãn ngắn cho log. */
  label: string;
  /** Vị từ quyết định "cờ này có đang BẬT không" (đọc env, thuần). */
  isOn: () => boolean;
  /** Mô tả điều kiện bật, để log tự giải thích. */
  onCondition: string;
  requires: TierModelRequirement[];
}

/** Vị từ bật/tắt dùng chung — GIỐNG HỆT `aiModelRouter.thinkingTierEnabled/codeRouterEnabled`. */
function flagOn(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * BẢNG KHAI BÁO — thêm cặp cờ↔model mới ở ĐÂY, không viết cơ chế cảnh báo mới ở nơi khác.
 *
 * Ghi chú về `requiredWhenOn`: phân biệt "tầng CHẾT HẲN" với "tầng ĐỔI MODEL trong im lặng".
 * Cả hai đều đáng báo, nhưng chỉ cái đầu mới là *cờ khai bật mà vô hiệu*.
 */
export const TIER_FLAG_SPECS: readonly TierFlagSpec[] = [
  {
    label: "thinking-tier",
    isOn: () => flagOn("AI_THINKING_TIER_ENABLED"),
    onCondition: "AI_THINKING_TIER_ENABLED",
    requires: [
      {
        env: "GGUF_THINKING_MODEL",
        kind: "basename",
        requiredWhenOn: true,
        impact:
          "rca/report độ khó 'hard' âm thầm rơi về deep model thường (aiModelRouter.deepModelFor) — " +
          "tầng thinking coi như KHÔNG tồn tại dù cờ khai BẬT",
      },
    ],
  },
  {
    label: "code-router",
    isOn: () => flagOn("AI_CODE_ROUTER_ENABLED"),
    onCondition: "AI_CODE_ROUTER_ENABLED",
    requires: [
      // Hai env này CÓ fallback (code→GGUF_DEFAULT_MODEL, fim→GGUF_FAST_MODEL→GGUF_DEFAULT_MODEL),
      // nên rỗng KHÔNG phải lỗi. Nhưng nếu đã GÁN mà file không có trên đĩa thì engine sẽ ném lúc
      // nạp — đó mới là thứ phải bắt ở boot thay vì ở request đầu tiên của kỹ sư.
      {
        env: "GGUF_CODE_MODEL",
        kind: "basename",
        requiredWhenOn: false,
        impact: "tầng 'code' sẽ ném khi nạp; Copilot lập trình hỏng ở request đầu",
      },
      {
        env: "GGUF_FIM_MODEL",
        kind: "basename",
        // ★ G5-B (2026-08-16) — ĐỔI TỪ `false` SANG `true`, cùng lập luận đã ghi cho
        // `copilot-repo-index` bên dưới: *có fallback KHÔNG có nghĩa là fallback dùng được*.
        // Đường lùi (`→ GGUF_FAST_MODEL → GGUF_DEFAULT_MODEL`) trỏ tới một model CHAT không được
        // huấn luyện fill-in-middle. Bỏ trống biến này khi gộp roster ⇒ ghost-text vẫn "chạy",
        // chỉ là chậm hơn nhiều và chất lượng khác hẳn — đúng lớp hỏng-trong-im-lặng mà bảng này
        // tồn tại để chặn. Roster mới gộp chat+code+fast vào MỘT model dense 27B nên đây không
        // còn là rủi ro lý thuyết: thiếu dòng này thì `.env` mất một biến là đủ để hỏng.
        requiredWhenOn: true,
        mustDifferFrom: ["GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL"],
        impact:
          "ghost-text/inline completion rơi về model chat vạn năng (fill-in-middle → completion " +
          "thường): chậm hơn nhiều, chất lượng khác hẳn, KHÔNG có gì đỏ. Giữ GGUF_FIM_MODEL trỏ " +
          "một model FIM riêng (vd Qwen2.5-Coder-1.5B) kể cả khi gộp roster chat/code",
      },
    ],
  },
  {
    // G2-A — chỉ mục repo nối vào copilot lập trình. Cặp cờ↔model ở đây là THẬT: khối ngữ cảnh
    // chỉ có nghĩa khi câu hỏi được nhúng CÙNG KHÔNG GIAN với `knowledge/embeddings.jsonl`
    // (Qwen3-Embedding-0.6B, 1024 chiều). `aiLocalKnowledgeService` phát hiện lệch model thì
    // ÂM THẦM rơi về keyword-only — vẫn trả kết quả, chỉ là thứ hạng gần như vô nghĩa cho một
    // truy vấn mã nguồn ⇒ đúng lớp "cờ khai BẬT mà tầng chết trong im lặng" mà bảng này tồn tại
    // để chặn. `requiredWhenOn: true` vì fallback (`mxbai-embed-large-v1-f16`) là một model
    // KHÁC hẳn không gian vector của corpus — có fallback không có nghĩa là fallback dùng được.
    label: "copilot-repo-index",
    // Mặc định TẮT (khớp `repoContextService.REPO_INDEX_DEFAULT_ON`) ⇒ dùng thẳng `flagOn`.
    isOn: () => flagOn("AI_COPILOT_REPO_INDEX_ENABLED"),
    onCondition: "AI_COPILOT_REPO_INDEX_ENABLED",
    requires: [
      {
        env: "GGUF_EMBED_MODEL",
        // `requiredWhenOn: false` là quyết định CÓ CHỦ ĐÍCH, không phải cho dễ:
        //   • ca "env RỖNG" ĐÃ có tiếng kêu riêng và to hơn — `aiLocalKnowledgeService` in
        //     "⚠️ EMBED-MODEL MISMATCH … falling back to keyword-only" khi model truy vấn lệch
        //     model corpus. Báo lại ở đây chỉ tạo tiếng ồn trùng cho mọi cài đặt chạy mặc định.
        //   • ca THỰC SỰ câm là "env ĐÃ GÁN nhưng file KHÔNG có trên đĩa": khi đó engine ném lúc
        //     nạp, ở REQUEST ĐẦU TIÊN của kỹ sư, chứ không phải lúc boot. Đó đúng là thứ bảng
        //     này sinh ra để kéo về boot.
        kind: "basename",
        requiredWhenOn: false,
        impact:
          "lượt nhúng câu hỏi của copilot sẽ NÉM khi nạp ⇒ retrieveKnowledge rơi về keyword-only " +
          "trong im lặng; khối 'NGỮ CẢNH TỪ CHỈ MỤC REPO' vẫn hiện ra nhưng thứ hạng gần như " +
          "ngẫu nhiên (mã nguồn không tra được bằng từ khoá tiếng Việt)",
      },
    ],
  },
  {
    label: "rag-reranker(gguf)",
    // Cross-encoder GGUF chỉ được dùng khi BẬT *và* mode=gguf (aiReranker.ts:67,72).
    isOn: () =>
      (process.env.RAG_RERANKER_ENABLED ?? "false").toLowerCase() === "true" &&
      (process.env.RAG_RERANKER_MODE ?? "llm").toLowerCase() === "gguf",
    onCondition: "RAG_RERANKER_ENABLED=true + RAG_RERANKER_MODE=gguf",
    requires: [
      {
        env: "GGUF_RERANKER_MODEL",
        kind: "basename",
        requiredWhenOn: true,
        impact:
          "rerank rơi về đường LLM/không rerank — thứ hạng trích dẫn RAG đổi trong im lặng " +
          "(aiReranker.ts:485 chỉ log ở lần dùng đầu)",
      },
    ],
  },
  {
    label: "vision-sidecar",
    // Sidecar thị giác không có cờ *_ENABLED riêng: nó "bật" khi cả ba env được gán
    // (llamaVisionSidecar.getVisionSidecarConfig trả null nếu thiếu bất kỳ cái nào).
    isOn: () =>
      !!(process.env.LLAMA_SERVER_BIN || process.env.GGUF_VISION_MODEL || process.env.GGUF_VISION_MMPROJ),
    onCondition: "một trong LLAMA_SERVER_BIN / GGUF_VISION_MODEL / GGUF_VISION_MMPROJ đã được gán",
    requires: [
      {
        env: "LLAMA_SERVER_BIN",
        kind: "path",
        requiredWhenOn: true,
        impact: "mọi yêu cầu thị giác ném VISION_NOT_AVAILABLE",
      },
      {
        env: "GGUF_VISION_MODEL",
        kind: "path",
        requiredWhenOn: true,
        impact: "mọi yêu cầu thị giác ném VISION_NOT_AVAILABLE",
      },
      {
        env: "GGUF_VISION_MMPROJ",
        kind: "path",
        requiredWhenOn: true,
        impact: "sidecar khởi động nhưng KHÔNG nhìn được ảnh (thiếu projector)",
      },
    ],
  },
  {
    /**
     * ★★★ G2-B — TOOL-CALLING GỐC. Đây LÀ một cặp cờ↔model thật, không phải một cờ hạ tầng:
     * khả năng "gọi tool" **nằm trong CHAT TEMPLATE của chính file GGUF**, không nằm ở llama.cpp.
     * Đo sống trên `Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL` (`/props`): template có nhánh
     * `{%- if tools %}` … `{%- for tool in tools %}` — và phép ĐẦU ĐỘC (`chat_template_kwargs:
     * {"tools":12345}`) làm server ném đúng *"line 7, column 9 … Expected iterable … got Integer"*,
     * tức chính nhánh ấy đang chạy. Trỏ `LLAMA_SERVER_MODEL` sang một GGUF **không có** nhánh đó
     * thì cờ vẫn khai BẬT, server vẫn 200, mà `tool_calls` **không bao giờ xuất hiện** — đúng hình
     * dạng "tầng chết trong im lặng" mà bảng này tồn tại để chặn.
     *
     * `requiredWhenOn: true` — KHÔNG có đường lùi nào phục vụ được: đường in-process
     * (`node-llama-cpp`) không dựng được khối `<tools>`, và `aiGgufEngine.chatCompletion()` nay NÉM
     * `LoiToolCallKhongHoTro` thay vì lặng lẽ trả một câu chữ thường. Cờ bật + biến rỗng = mọi lượt
     * có `tools` đều hỏng ở request đầu tiên.
     */
    label: "native-toolcalls",
    isOn: () => flagOn("AI_NATIVE_TOOLCALLS_ENABLED"),
    onCondition: "AI_NATIVE_TOOLCALLS_ENABLED",
    requires: [
      {
        env: "LLAMA_SERVER_MODEL",
        kind: "basename",
        requiredWhenOn: true,
        impact:
          "tool-calling GỐC (/v1 `tools` → `message.tool_calls`) không có đường nào phục vụ: khối " +
          "<tools> chỉ dựng được bởi chat template của model mà llama-server đang giữ. Thiếu biến " +
          "này ⇒ mọi yêu cầu có `tools` ném LoiToolCallKhongHoTro ở request đầu tiên (đường " +
          "in-process không thay thế được). Kiểm chat template có nhánh `{%- if tools %}` qua GET /props",
      },
    ],
  },
];

export interface TierFlagFinding {
  label: string;
  env: string;
  /**
   * "unset"     — cờ bật mà env rỗng;
   * "missing"   — env có giá trị nhưng file không có trên đĩa;
   * "collapsed" — env ĐÃ gán, file CÓ THẬT, nhưng trỏ trùng một model khác mà nó phải khác
   *               (gộp roster ⇒ tầng chuyên dụng biến mất mà không có gì đỏ).
   */
  problem: "unset" | "missing" | "collapsed";
  /** Giá trị env (khi problem="missing"), để người đọc log biết phải sửa cái gì. */
  value?: string;
  impact: string;
  reason: string;
}

/** Bộ kiểm tra sự tồn tại — tách ra để test tiêm được, KHÔNG cần đĩa thật. */
export interface TierFlagProbes {
  ggufExists: (basename: string) => boolean;
  pathExists: (p: string) => boolean;
}

async function defaultProbes(): Promise<TierFlagProbes> {
  // Dynamic import: giữ module này nhẹ (aiGgufEngine kéo theo cả stack inference).
  const { ggufModelFileExists } = await import("../aiGgufEngine");
  const fs = await import("fs");
  return {
    ggufExists: (b) => ggufModelFileExists(b),
    pathExists: (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
  };
}

/**
 * Kiểm tra THUẦN (không log, không ném): với mỗi cờ đang BẬT, mọi model nó cần có thật không?
 * Trả về danh sách phát hiện — RỖNG nghĩa là mọi cờ đang bật đều có đủ đồ.
 */
export async function auditModelTierFlags(
  probes?: TierFlagProbes,
  specs: readonly TierFlagSpec[] = TIER_FLAG_SPECS,
): Promise<TierFlagFinding[]> {
  const p = probes ?? (await defaultProbes());
  const findings: TierFlagFinding[] = [];

  for (const spec of specs) {
    let on = false;
    try {
      on = spec.isOn();
    } catch {
      on = false; // vị từ hỏng KHÔNG được làm hỏng boot
    }
    if (!on) continue;

    for (const req of spec.requires) {
      const raw = (process.env[req.env] || "").trim();
      if (!raw) {
        if (req.requiredWhenOn) {
          findings.push({
            label: spec.label,
            env: req.env,
            problem: "unset",
            impact: req.impact,
            reason: `${spec.onCondition} đang BẬT nhưng ${req.env} chưa được gán ⇒ ${req.impact}`,
          });
        }
        continue;
      }
      let exists = false;
      try {
        exists = req.kind === "basename" ? p.ggufExists(toBasename(raw)) : p.pathExists(raw);
      } catch {
        exists = false;
      }
      if (!exists) {
        findings.push({
          label: spec.label,
          env: req.env,
          problem: "missing",
          value: raw,
          impact: req.impact,
          reason: `${spec.onCondition} đang BẬT và ${req.env}="${raw}" nhưng file KHÔNG có trên đĩa ⇒ ${req.impact}`,
        });
        continue;
      }

      // Gán đúng, file có thật — nhưng có trỏ TRÙNG một model mà nó phải khác không?
      const mine = toBasename(raw).toLowerCase();
      for (const other of req.mustDifferFrom ?? []) {
        const otherRaw = (process.env[other] || "").trim();
        if (!otherRaw) continue;
        if (toBasename(otherRaw).toLowerCase() !== mine) continue;
        findings.push({
          label: spec.label,
          env: req.env,
          problem: "collapsed",
          value: raw,
          impact: req.impact,
          reason:
            `${spec.onCondition} đang BẬT và ${req.env}="${raw}" TRỎ TRÙNG ${other} ` +
            `⇒ tầng chuyên dụng biến mất trong im lặng: ${req.impact}`,
        });
        break; // một lần kêu là đủ; trùng với nhiều env cũng cùng một lỗi
      }
    }
  }

  return findings;
}

// Chỉ cảnh báo MỘT lần cho mỗi lý do trong đời tiến trình (boot có thể gọi lại khi hot-reload).
const warned = new Set<string>();

/**
 * Gọi MỘT lần lúc khởi động (`_core/index.ts`, cạnh `reportAiModelAvailability` /
 * `reportThinkingTierStatus`). Log MỘT khối cảnh báo rõ ràng cho mọi cờ khai BẬT mà model tương
 * ứng rỗng/không có trên đĩa. Im lặng khi mọi thứ khớp. KHÔNG BAO GIỜ ném.
 */
export async function reportModelTierFlags(probes?: TierFlagProbes): Promise<TierFlagFinding[]> {
  try {
    const findings = await auditModelTierFlags(probes);
    if (findings.length === 0) return findings;

    console.warn(
      `[AITierFlags] ${findings.length} cờ tầng model khai BẬT nhưng VÔ HIỆU — cấu hình đang NÓI SAI sự thật:`,
    );
    for (const f of findings) {
      const key = `${f.label}:${f.env}:${f.problem}:${f.value ?? ""}`;
      if (warned.has(key)) continue;
      warned.add(key);
      console.warn(`[AITierFlags]   • ${f.label} — ${f.reason}`);
    }
    console.warn(
      "[AITierFlags] Sửa: gán/ tải model còn thiếu, HOẶC tắt cờ tương ứng để cấu hình khai đúng thực tế.",
    );
    return findings;
  } catch (err) {
    console.warn("[AITierFlags] audit failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
