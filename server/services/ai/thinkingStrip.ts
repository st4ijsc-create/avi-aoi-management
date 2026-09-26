/**
 * ★★★ BỘ CẮT CHUỖI SUY LUẬN — module LÁ (không import gì, không I/O, không nạp model).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHỐI NÀY KHÔNG CÒN NẰM TRONG `aiGgufEngine.ts` (G5-C 2026-08-17)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * G5-B viết khối này bên trong `aiGgufEngine.ts`. Khi G5-C đi NỐI nó vào hai đường đang sống, chỗ
 * ở ấy hoá ra là một lỗ theo đúng nghĩa cơ chế, vì HAI lý do đo được:
 *
 *  1. **Mock có thể vô hiệu hoá hàng rào mà lưới vẫn xanh.** `aiLocalKnowledgeSafety.test.ts` và
 *     `aiLocalKnowledge.gguf.test.ts` đều `vi.mock("./aiGgufEngine", …)` bằng một factory liệt kê
 *     tay vài hàm. Nếu bộ cắt sống trong module ấy, mọi test kiểu đó sẽ chạy với bộ cắt =
 *     `undefined` ⇒ **đường đang đo là đường KHÔNG có hàng rào**, mà không ca nào đỏ. Đây đúng
 *     lớp lỗi "lưới xanh qua một cơ chế KHÁC với cơ chế nó tưởng đang canh".
 *
 *  2. **Import động trong `try/catch` = fail-open.** `aiLocalKnowledgeService` cố ý KHÔNG import
 *     tĩnh engine (nặng, kéo theo node-llama-cpp) — nó dùng `await import("./aiGgufEngine")` bên
 *     trong `try`. Lấy bộ cắt từ đó nghĩa là: import hỏng ⇒ nhánh `catch` chạy tiếp **không có bộ
 *     cắt** ⇒ rò. Module lá này import tĩnh được từ bất kỳ đâu với chi phí ~0, nên hàng rào là
 *     **vô điều kiện theo cấu tạo**, không phải theo may mắn.
 *
 * `aiGgufEngine.ts` RE-EXPORT nguyên vẹn mọi thứ ở đây, nên mọi bên gọi cũ không đổi một dòng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHỐI NÀY TỒN TẠI (giữ nguyên phần khai của G5-B, 2026-08-16 — doc 77 §5.7)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nhiệm vụ: **chuỗi suy luận của model không bao giờ được rò ra giao diện người vận hành.** Đây
 * là hỏng-trong-im-lặng thuần tuý — không crash, không log đỏ, chỉ là giữa câu trả lời có nội tâm
 * của model. Bản trước G5-B có BA đường rò, cả ba đã đo:
 *
 *  R1 — **THẺ GHIM CỨNG.** Bản cũ chỉ biết `<think>`. Roster mới (Qwen3.x-27B dense, hybrid
 *       thinking có `reasoning_effort`) có thể phát `<reasoning>`, `<thought>`, `<|think|>`…
 *       ⇒ không cắt gì, rò 100%. Nay: **tập thẻ khai báo được** (`AI_THINKING_TAGS` CỘNG thêm vào
 *       tập mặc định), phủ cả hai cú pháp `<name>` và `<|name|>`, chấp nhận thuộc tính.
 *
 *  R2 — **FAIL-OPEN mang tên fail-safe.** Bản cũ kết bằng:
 *           `if (!answer && text.trim()) return { answer: text.trim(), thinking };`
 *       tức là: *cắt xong không còn gì ⇒ trả lại NGUYÊN VĂN cả khối suy luận kèm thẻ.* Ca kích
 *       hoạt không hiếm: router cấp 4096 token cho `hard rca/report`, model reasoning tiêu hết
 *       token vào `<think>` trước khi kịp trả lời ⇒ đầu ra 100% là suy luận chưa đóng thẻ.
 *       Nay: cắt xong rỗng thì **trả rỗng** + `truncated=true`. ⚠ ĐỔI HÀNH VI CÓ CHỦ Ý.
 *
 *  R3 — **THẺ LỒNG NHAU.** `replace(/<think>([\s\S]*?)<\/think>/gi)` không tham lam nên với
 *       `<think>a<think>b</think>c</think>` nó cắt tới thẻ đóng ĐẦU TIÊN, để lọt `c` (nội dung
 *       suy luận) **và** một `</think>` lạc ra giao diện. Nay: quét MỘT LƯỢT có **đếm độ sâu**.
 *
 *  R4 — **STREAMING.** Token rời máy chủ từng mảnh; một thẻ bị chẻ đôi qua hai sự kiện SSE thì
 *       phép cắt một-lượt không nhìn thấy nó. Cùng lớp lỗi với bí mật rò xuyên chunk. Xem
 *       `StreamingThinkingStripper` bên dưới. **G5-C đã nối nó vào cả hai đường sống**:
 *       `server/routes/aiStreamingApi.ts` (ba tuyến SSE) và
 *       `server/services/aiLocalKnowledgeService.ts` (chat vận hành, cả stream lẫn không-stream).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THỨ TỰ VỚI BỘ CHE BÍ MẬT: **CẮT THẺ TRƯỚC — CHE BÍ MẬT SAU.** (quyết định của G5-C)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cắt thẻ là phép **XOÁ**, nên nó **nối liền** hai đoạn chữ vốn bị khối `<think>` tách rời. Một
 * khoá bị khối suy luận chẻ đôi — `sk-` + 8 ký tự · `<think>…</think>` · 16 ký tự nữa — thì:
 *   • che TRƯỚC: mỗi nửa đều DƯỚI ngưỡng `sk-[A-Za-z0-9]{16,}` ⇒ không khớp ⇒ nhả nguyên văn;
 *     bộ cắt chạy sau nối hai nửa lại ⇒ **khoá 24 ký tự ra tới trình duyệt.**
 *   • cắt TRƯỚC: hai nửa nối lại ngay, bộ che nhìn thấy khoá hoàn chỉnh ⇒ `[REDACTED_SECRET]`.
 * Nguyên tắc: **bộ lọc canh NỘI DUNG phải đứng CUỐI**, sau mọi phép biến đổi cấu trúc — nếu
 * không, nó canh một chuỗi KHÁC với chuỗi người dùng thật sự nhận. Ca này có lưới ở
 * `aiLocalKnowledge.thinkingLeak.test.ts` §5 và `aiStreamingApi.thinkingLeak.test.ts` §5; đảo thứ
 * tự ⇒ cả hai ĐỎ.
 */

/**
 * Tập thẻ suy luận mặc định. Cố ý KHÔNG gồm những tên quá phổ thông có thể là thẻ nội dung THẬT
 * trong câu trả lời (`<reason>`, `<analysis>`) — copilot lập trình cũng đi qua hàm này và một câu
 * trả lời sinh XML/HTML không được bị cắt oan. Cần thêm ⇒ `AI_THINKING_TAGS`.
 */
const DEFAULT_THINKING_TAG_NAMES = [
  "think",
  "thinking",
  "thought",
  "thoughts",
  "reasoning",
  "reflection",
  "scratchpad",
  "inner_monologue",
] as const;

/** Chỉ nhận tên thẻ hợp lệ; mọi thứ khác trong env bị bỏ qua thay vì làm hỏng regex. */
const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function parseThinkingTagNames(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^[<|/]+/, "").replace(/[>|/]+$/, ""))
    .filter((s) => TAG_NAME_RE.test(s))
    .map((s) => s.toLowerCase());
}

/**
 * Tập tên thẻ suy luận đang hiệu lực = mặc định **∪** `AI_THINKING_TAGS`.
 *
 * CỘNG chứ không THAY THẾ, có chủ ý: cấu hình sai (gõ thiếu `think`) chỉ làm cắt THỪA, không bao
 * giờ làm rò. Muốn bớt thẻ mặc định thì phải sửa mã — đó là rào cản đúng cho một thay đổi mà hậu
 * quả là rò nội tâm model ra giao diện.
 */
export function thinkingTagNames(): string[] {
  const merged = new Set<string>([...DEFAULT_THINKING_TAG_NAMES, ...parseThinkingTagNames(process.env.AI_THINKING_TAGS)]);
  // Dài trước ngắn: `thinking` phải được thử trước `think` để `\b` không chặn nhầm nhánh.
  return [...merged].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * ★ G5-C — MỘT SỐ CHAT TEMPLATE **MỞ SẴN** KHỐI SUY LUẬN.
 *
 * Template của vài model reasoning kết thúc bằng chính chuỗi `<think>` (hoặc bằng một token đặc
 * biệt tương đương) trước khi model sinh chữ. Đầu ra vì thế bắt đầu **NGAY TRONG** khối, và thẻ
 * đầu tiên máy chủ nhìn thấy là thẻ **ĐÓNG**. Bản một-lượt (`stripThinking`) tự xử lý được ca này
 * (thẻ đóng ở độ sâu 0 ⇒ mọi thứ trước nó là suy luận), nhưng bản STREAMING thì **không thể**:
 * chữ đã phát ra thì không rút lại được. Vì vậy trạng thái ban đầu phải được **KHAI**.
 *
 * Đọc từ env `AI_THINKING_STARTS_OPEN` (mặc định TẮT). Mặc định TẮT là bắt buộc: bật nhầm cho một
 * model KHÔNG mở sẵn khối sẽ nuốt trọn câu trả lời đầu tiên. Đây là **cấu hình theo roster** —
 * đổi roster sang model mở sẵn khối thì phải bật cờ này, và `suspectedStartInsideThinking` bên
 * dưới là cái chuông báo nếu ai đó quên.
 */
export function thinkingStartsOpen(): boolean {
  const v = (process.env.AI_THINKING_STARTS_OPEN || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Nguồn regex nhận MỌI thẻ mở/đóng của MỌI tên đang hiệu lực, cả `<n>` lẫn `<|n|>`. */
function thinkingTagPattern(): string {
  const names = thinkingTagNames()
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  //  <  sp |?  sp (/)?  sp  NAME \b  [^>]*?  |?  sp  >
  return `<\\s*\\|?\\s*(\\/)?\\s*(?:${names})\\b[^>]*?\\|?\\s*>`;
}

interface ThinkingScan {
  answer: string;
  thinking: string;
  /** true khi có thẻ mở KHÔNG BAO GIỜ được đóng (đầu ra bị cắt giữa chừng). */
  truncated: boolean;
}

/**
 * Quét MỘT LƯỢT, **đếm độ sâu** — thay cho ba phép `replace`/`search` chồng lên nhau của bản cũ.
 * Đây là thứ làm cho thẻ lồng nhau (R3) và thẻ chéo tên trở nên đúng theo cấu tạo chứ không phải
 * theo từng ca được nhớ tới.
 */
function scanThinking(text: string, batDauTrongKhoi: boolean): ThinkingScan {
  const re = new RegExp(thinkingTagPattern(), "gi");
  const thoughts: string[] = [];
  let visible = "";
  let depth = batDauTrongKhoi ? 1 : 0;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const seg = text.slice(last, m.index);
    if (depth === 0) visible += seg;
    else thoughts.push(seg);

    if (m[1]) {
      // thẻ ĐÓNG
      if (depth > 0) depth--;
      else {
        // Đóng mà chưa từng mở (chat template mở sẵn khối) ⇒ mọi thứ nhìn thấy trước đó là suy luận.
        thoughts.push(visible);
        visible = "";
      }
    } else {
      depth++;
    }
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++; // chống vòng lặp vô hạn nếu khớp rỗng
  }

  const tail = text.slice(last);
  let truncated = false;
  if (depth === 0) {
    visible += tail;
  } else {
    thoughts.push(tail);
    truncated = true;
  }
  return { answer: visible, thinking: thoughts.join("\n"), truncated };
}

let stripThinkingFailureWarned = false;

/**
 * B6.2 — Tách chuỗi suy luận khỏi câu trả lời cuối của model.
 *
 * Trả về `answer` (an toàn để hiển thị) và `thinking` (để log/kiểm toán riêng, KHÔNG hiển thị),
 * cộng `truncated` = có thẻ mở không bao giờ đóng.
 *
 * FAIL-SAFE theo đúng nghĩa: **thà cắt thừa còn hơn rò**. Cắt xong rỗng ⇒ trả rỗng (bản cũ trả
 * nguyên văn — xem R2 ở đầu khối). Có lỗi nội bộ ⇒ cũng trả rỗng + `truncated`, không bao giờ ném
 * và không bao giờ trả lại chữ chưa được quét.
 */
export function stripThinking(text: string): { answer: string; thinking: string; truncated: boolean } {
  if (typeof text !== "string" || text.length === 0) {
    return { answer: typeof text === "string" ? text : "", thinking: "", truncated: false };
  }
  try {
    // ⚠ `thinkingStartsOpen()` cũng áp cho bản MỘT LƯỢT: nếu template mở sẵn khối thì một đầu ra
    // KHÔNG có thẻ nào cả vẫn là suy luận từ đầu tới cuối. Không đọc cờ ở đây thì đường
    // không-streaming rò trọn vẹn đúng ca mà đường streaming đã được canh.
    const s = scanThinking(text, thinkingStartsOpen());
    return { answer: s.answer.trim(), thinking: s.thinking.trim(), truncated: s.truncated };
  } catch (err) {
    if (!stripThinkingFailureWarned) {
      stripThinkingFailureWarned = true;
      console.warn(
        "[thinkingStrip] stripThinking failed — trả câu trả lời RỖNG (fail-safe: thà mất chữ còn hơn " +
          `rò chuỗi suy luận): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { answer: "", thinking: "", truncated: true };
  }
}

/**
 * Vị trí bắt đầu của một MẢNH thẻ đang dở ở đuôi bộ đệm, hoặc -1 nếu đuôi chắc chắn không phải
 * thẻ. Đây là mấu chốt của đường streaming: `<thi` ở cuối chunk 1 phải được GIỮ LẠI, còn `a < b`
 * thì phải nhả ngay (nếu giữ mọi dấu `<` thì luồng chữ tới trình duyệt sẽ khựng vô cớ).
 */
function partialThinkingTagStart(buf: string): number {
  const i = buf.lastIndexOf("<");
  if (i < 0) return -1;
  const rest = buf.slice(i);
  if (rest.includes(">")) return -1; // đã là thẻ hoàn chỉnh — bộ quét ở trên đã xử lý
  const m = /^<\s*\|?\s*\/?\s*([A-Za-z][A-Za-z0-9_-]*)?([^>]*)$/.exec(rest);
  if (!m) return -1;
  const partial = (m[1] || "").toLowerCase();
  const after = m[2] || "";
  if (!partial) return rest.length <= 4 ? i : -1; // mới có "<", "</", "<|", "<|/"
  const names = thinkingTagNames();
  // Có phần đuôi (khoảng trắng/thuộc tính) ⇒ tên PHẢI đã trọn vẹn; chưa có đuôi ⇒ chỉ cần là tiền tố.
  return after ? (names.includes(partial) ? i : -1) : names.some((n) => n.startsWith(partial)) ? i : -1;
}

/**
 * ★ Bộ cắt suy luận cho ĐƯỜNG STREAMING — một thực thể cho MỘT luồng (trạng thái là của riêng
 * từng cuộc, KHÔNG dùng chung ở phạm vi module).
 *
 * Song sinh có chủ ý với `StreamingSecretRedactor` (`server/services/ai/aiSafety.ts`): cùng lớp
 * lỗi (mẫu cần nhận diện bị chẻ đôi qua hai chunk), nên cùng hình dạng `push()`/`flush()` để người
 * đọc sau không phải học hai mô hình.
 *
 * KHÁC một điểm QUAN TRỌNG: khi có lỗi nội bộ, `StreamingSecretRedactor` nhả chữ thô (che bí mật
 * là best-effort), còn bộ này **nuốt chữ** — vì ở đây "để lọt" nghĩa là đẩy nguyên văn nội tâm
 * model ra trình duyệt.
 *
 * ⚠ `startInsideThinking`: khi chat template MỞ SẴN khối suy luận, đầu ra bắt đầu NGAY TRONG khối
 * và thẻ đầu tiên nhìn thấy là thẻ ĐÓNG. Một lượt phát đã rời máy chủ thì không rút lại được, nên
 * bên gọi PHẢI khai cờ này (mặc định lấy từ `thinkingStartsOpen()`); bản một-lượt tự xử lý được
 * ca đó, bản streaming thì KHÔNG.
 */
export class StreamingThinkingStripper {
  private buf = "";
  private depth: number;
  private readonly thoughts: string[] = [];
  private truncatedFlag = false;
  /** Đã phát ra ngoài ít nhất một ký tự — dùng để phát hiện cờ `startInsideThinking` bị QUÊN. */
  private daPhat = false;
  private nghiMoSan = false;

  constructor(opts?: { startInsideThinking?: boolean }) {
    this.depth = (opts?.startInsideThinking ?? thinkingStartsOpen()) ? 1 : 0;
  }

  /** Nạp một chunk; trả về phần chữ ĐÃ AN TOÀN để phát ra ngoài ("" = còn đang giữ). */
  push(chunk: string): string {
    try {
      this.buf += typeof chunk === "string" ? chunk : "";
      const re = new RegExp(thinkingTagPattern(), "gi");
      let out = "";
      let last = 0;
      let m: RegExpExecArray | null;

      while ((m = re.exec(this.buf)) !== null) {
        const seg = this.buf.slice(last, m.index);
        if (this.depth === 0) out += seg;
        else this.thoughts.push(seg);

        if (m[1]) {
          if (this.depth > 0) this.depth--;
          else {
            // Thẻ đóng lạc: phần đang giữ trong lượt này là suy luận. Phần đã PHÁT ở lượt trước
            // thì không rút lại được — đó là lý do `startInsideThinking` tồn tại.
            this.thoughts.push(out);
            out = "";
            // ★ G5-C — chuông báo: một thẻ đóng ở độ sâu 0 SAU KHI đã phát chữ ra ngoài chỉ có
            // một nghĩa hợp lý — template mở sẵn khối mà cờ không được bật. Chữ đã rò rồi; điều
            // duy nhất còn làm được là biến hỏng-trong-im-lặng thành hỏng-CÓ-TIẾNG.
            if (this.daPhat) {
              this.nghiMoSan = true;
              this.truncatedFlag = true;
            }
          }
        } else {
          this.depth++;
        }
        last = m.index + m[0].length;
        if (re.lastIndex === m.index) re.lastIndex++;
      }

      const rest = this.buf.slice(last);
      const hold = partialThinkingTagStart(rest);
      const settled = hold >= 0 ? rest.slice(0, hold) : rest;
      this.buf = hold >= 0 ? rest.slice(hold) : "";
      if (this.depth === 0) out += settled;
      else if (settled) this.thoughts.push(settled);
      if (out) this.daPhat = true;
      return out;
    } catch {
      this.buf = "";
      this.truncatedFlag = true;
      return ""; // FAIL-SAFE: thà mất chữ còn hơn rò
    }
  }

  /** Xả phần còn giữ khi luồng kết thúc. Đang ở trong khối suy luận ⇒ KHÔNG nhả gì. */
  flush(): string {
    try {
      const rest = this.buf;
      this.buf = "";
      if (this.depth > 0) {
        if (rest) this.thoughts.push(rest);
        this.truncatedFlag = true;
        return "";
      }
      const hold = partialThinkingTagStart(rest);
      if (hold >= 0) {
        // Luồng đứt giữa một thẻ — mảnh thẻ dở không phải câu trả lời, không phun ra giao diện.
        this.truncatedFlag = true;
        const con = rest.slice(0, hold);
        if (con) this.daPhat = true;
        return con;
      }
      if (rest) this.daPhat = true;
      return rest;
    } catch {
      this.buf = "";
      this.truncatedFlag = true;
      return "";
    }
  }

  /** Chuỗi suy luận đã gom (để log/kiểm toán — KHÔNG hiển thị). */
  get thinking(): string {
    return this.thoughts.join("\n").trim();
  }

  /** true khi luồng kết thúc trong lúc còn đang ở trong khối suy luận / giữa một thẻ. */
  get truncated(): boolean {
    return this.truncatedFlag;
  }

  /**
   * ★ true khi bộ cắt thấy một thẻ ĐÓNG ở độ sâu 0 **sau khi** đã phát chữ ra ngoài — dấu hiệu
   * gần như chắc chắn rằng template mở sẵn khối suy luận mà `AI_THINKING_STARTS_OPEN` chưa bật.
   * Chữ đã rò (không rút lại được), nhưng đây là tín hiệu để vận hành BẬT cờ thay vì mãi mãi
   * không biết. Bên gọi nên log một lần.
   */
  get suspectedStartInsideThinking(): boolean {
    return this.nghiMoSan;
  }
}
