/**
 * ★★★ Pha 4 Task 4 — **CÁI KIM CỦA MẶT ĐỌC VRAM.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI (đọc trước khi sửa bất cứ dòng nào)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1 dựng `buildVramAgentState()` và nối vào `vramRouter.state`. Chính báo cáo Task 1 tự khai:
 * *"nếu dừng ở đây thì chỉ là dời đồng hồ không kim ra sau một endpoint"* — và đúng thế: **AI Agent
 * của repo này KHÔNG đi qua tRPC**, nó đi qua `aiLocalTools/toolRegistry`. Không có file này thì
 * mọi ô độ-chắc-chắn mà bảy pha vừa dựng vẫn **không ai đọc**.
 *
 * ⇒ Đây là **người đọc thật NGOÀI `server/routers/**` và NGOÀI `server/services/vram/**`**, tức cổng
 * ra của Task 4. Có lưới canh: `vramTools.test.ts` (mỗi ô của bảng "đồng hồ không kim" phải xuất
 * hiện trong `textSummary`, kiểm bằng NỘI DUNG chứ không bằng "có nhập module không").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CHỈ ĐỌC — VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI MỘT THIẾU SÓT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba lệnh (`preempt`/`releaseStale`/`retryDeferred`) **KHÔNG** được đăng ký làm write-tool ở đây.
 * `preempt` **giết được tiến trình**; treo nó sau một bộ phân loại ý định (heuristic từ khoá +
 * LLM fallback) là mở một đường phá huỷ mà đầu vào là **một câu tiếng Việt mơ hồ**. Ba lệnh đó đã có
 * mặt tiếp xúc đúng mức — `deployProcedure` + `requirePermission("machine_control","canDelete")` +
 * step-up 2FA — và người đọc thật của chúng là panel VRAM ở `AIBrainDashboard`. Agent **đọc** ở đây
 * rồi **đề nghị người vận hành bấm**; nó không tự bắn.
 *
 * ⚠ `textSummary` là thứ được nhồi vào ngữ cảnh LLM ⇒ nó phải mang **CẢ CÁC Ô ĐỘ-CHẮC-CHẮN**, không
 * chỉ con số. Một bản tóm tắt in "còn 13.000 MiB" mà nuốt `basis: "ledger-only"` là đúng thứ
 * `vramReadModel.ts` tồn tại để chặn — Agent sẽ đọc một CHẶN TRÊN thành một trạng thái an toàn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 C-1 (review TOÀN NHÁNH Pha 4) — **MỘT CHUỖI, HAI BỀ MẶT, HAI LUẬT NGƯỢC NHAU.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước nội suy `h.owner` / `h.leaseKey` / `h.processKey` / `s.unledgered.lastReason` /
 * `degradedReasons` / `unverifiedReasons` / `nonFiniteFields[]` **thô** vào `textSummary`. Người
 * review nạp một `owner` độc hại qua `broker.reserve()` THẬT rồi chạy tool từ registry THẬT và đo
 * được: **3.869 ký tự NGUYÊN VĂN** vào ngữ cảnh LLM, chứa `<|im_start|>` · `{{}}` · `${}` · `$t()`.
 * Nguồn không hề giả định: `vram_leases.owner` do **TIẾN TRÌNH ANH EM** ghi (`vramBroker.ts:189`),
 * và `gguf:${modelId}` / `reranker:${modelPath}` ⇐ id model trong DB, `.env`, tên tệp `.gguf` —
 * **đúng ba nguồn Task 3 đã tự khai là bẩn**.
 *
 * ⚠⚠ VÌ SAO KHÔNG CẮT Ở NGUỒN, VÀ VÌ SAO KHÔNG NỚI CA ĐANG CANH CHIỀU NGƯỢC LẠI:
 * `vramTools.test.ts` có ca *"`owner` KHÔNG BỊ CẮT NGẮN"* và ca đó **ĐÚNG** — cho **mặt LỆNH**:
 * `owner` là **DANH TÍNH** mà Agent lấy từ mặt đọc rồi truyền **thẳng** vào `vram.preempt`; cắt nó
 * ở nguồn là phá đường nối hai mặt. Nhưng **cùng chuỗi đó** trên **bề mặt PROMPT** thì luật
 * **NGƯỢC LẠI**. ⇒ Tách **DANH TÍNH** khỏi **CÂU CHỮ**:
 *   • `data.state` — mọi ô **DANH TÍNH** (`owner`, `leaseKey`, `processKey`, `retryReach.owner`)
 *     **NGUYÊN VẸN**, không sạch, không cắt. Đây là thứ Agent đọc để lấy `owner` truyền vào lệnh.
 *     Ca "không bị cắt ngắn" nay khẳng định **ở đây**.
 *     ⚠ **ĐÍNH CHÍNH (Pha 5 Task 5, N11):** câu cũ viết *"ảnh chụp NGUYÊN VẸN"* cho **cả** ảnh
 *     chụp — nay **sai**. Các ô **CÂU CHỮ** (`unledgered.lastReason`,
 *     `defer.hosts[].status.lastRefusalMessage`) đã bị **cắt TẠI NGUỒN** ở `vramReadModel` (trần
 *     400) vì chúng là chuỗi lỗi **không trần** và có người đọc render thẳng vào DOM. Chúng mang
 *     kiểu `VramAgentDisplayText` (`{text, truncated, rawLength}`) ⇒ `tsc` bắt mọi người đọc thấy
 *     cờ, và `catSach(..., nguon)` khai bằng câu **`truncatedFieldAtSource`** — câu **không** hứa
 *     rằng `data.state` còn nguyên văn.
 *   • `textSummary` — **mọi** giá trị chuỗi đi qua `catSach()`: làm sạch bằng **ĐÚNG hai hàm đã có**
 *     ở `@shared/textSafety` (không hàm thứ ba), rồi cắt bằng **ĐÚNG phép cắt** mà
 *     `vramPreempt.catCau()` dùng, và **KHAI RA** là đã cắt (không cắt im lặng).
 * ⚠ Đây KHÔNG phải "hai bản sao vị từ": hai bề mặt có **hai bộ diễn giải khác nhau** đọc chuỗi, nên
 * chúng có hai bất biến khác nhau. Bản sao là khi một bất biến có hai người viết.
 */

import { z } from "zod";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolLang, type ToolResult } from "./toolRegistry";
import { buildVramAgentState, type VramAgentState, type VramAgentDisplayText } from "../vram/vramReadModel";
import { catChuoi, stripChatControlTokens, stripInterpolationSyntax } from "@shared/textSafety";
import { cum, noi, type Dong } from "./vramPhrases";

const MIB = 1024 * 1024;

/**
 * Trần MỘT TRƯỜNG trong câu chữ. **160 không phải một con số đẹp** — nó là trần `owner` của chính
 * `vramRouter.preempt.input` (`z.string().trim().min(1).max(160)`); `leaseKey` là 200
 * (`releaseStale.input`). ⇒ Lấy **200** = trần lớn hơn trong hai lệnh: một danh tính dài hơn thế
 * thì **lệnh cũng không nhận**, nên câu chữ không mất một byte nào *hành động được*. Và
 * `data.state` vẫn giữ nguyên văn cho mọi mục đích khác.
 */
const O_TOI_DA = 200;

/**
 * Trần CẢ BẢN TÓM TẮT. Bản sống đo được ~8.700 ký tự với 6 hộ nền + vài hộ giữ; `foreign.holders`
 * **không có trần dân số**, nên một tiến trình anh em ghi 500 hàng là một đường **bơm phồng ngữ
 * cảnh** (đẩy phần KB thật ra khỏi cửa sổ) — hậu quả thứ ba mà C-1 gọi tên. Cắt theo **DÒNG**
 * (không cắt giữa câu) và **khai ra đã bỏ bao nhiêu dòng**.
 */
const TOM_TAT_TOI_DA = 16_000;

/**
 * ★★★ MỘT CỬA DUY NHẤT cho mọi chuỗi đi vào câu chữ. Ghép **hai** bộ lọc (i18next + chat template)
 * rồi **một** phép cắt — tất cả đều là hàm ĐÃ CÓ ở `@shared/textSafety`.
 *
 * ⚠ Thứ tự làm-sạch-trước-cắt-sau là **bắt buộc**: cắt trước thì một chuỗi bị cắt giữa `<|im_` vẫn
 * trơ, nhưng cắt sau khi làm sạch cho ta biết độ dài THẬT của phần người đọc nhận được.
 * ⚠ Nhãn cắt viết bằng ký tự **không nằm trong hai lớp bị xoá** (`…[đã cắt …]`) nên chính nó không
 * tự bị làm sạch ở lượt sau, và nó **không thể** bị một payload giả mạo: payload đã sạch `<>|{}$`.
 */
function catSach(raw: string | null | undefined, lang: ToolLang, nguon?: VramAgentDisplayText): string {
  if (raw === null || raw === undefined) return "";
  const sach = stripChatControlTokens(stripInterpolationSyntax(String(raw)));
  const { cau, daCat } = catChuoi(sach, O_TOI_DA);
  /**
   * ★★★ Pha 5 Task 5 (N11) — **MỘT Ô ĐÃ BỊ CẮT Ở NGUỒN THÌ KHAI BẰNG CÂU KHÁC.**
   * `truncatedField` hứa *"data.state giữ nguyên văn"*; với một ô HIỂN THỊ thì **mặt đọc đã cắt
   * trước cả tool** (trần 400 ở `vramReadModel`), nên lời hứa ấy thành **sai**. Và tổng phải là độ
   * dài **GỐC** (`rawLength`), không phải độ dài của mảnh đã tới đây — nếu không, câu khai tự nó
   * cũng bị cắt một lần nữa mà không ai biết.
   */
  if (nguon !== undefined && nguon.truncated) {
    return `${cau}${cum(lang, "truncatedFieldAtSource", { keep: cau.length, total: nguon.rawLength })}`;
  }
  return daCat ? `${cau}${cum(lang, "truncatedField", { keep: O_TOI_DA, total: sach.length })}` : cau;
}

const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();

const vramStateParams = z
  .object({
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

interface RenderRow {
  label: string;
  value: string;
}

interface VramStateData {
  /** Ảnh chụp NGUYÊN VẸN — Agent đọc được mọi ô độ-chắc-chắn, không chỉ bản tóm tắt. */
  state: VramAgentState | null;
  rows: RenderRow[];
}

/**
 * MiB chỉ ở CÂU CHỮ (Đ4 — đơn vị nội bộ luôn là byte). `null` giữ nguyên là `null`.
 * ⚠ Dấu nhóm chữ số cũng theo ngôn ngữ: `13.000` (vi) ≠ `13,000` (en/zh). Một Agent trả lời tiếng
 * Anh mà in `13.000 MiB` là nói **mười ba** MiB với người đọc `en-US`.
 */
function mib(bytes: number | null | undefined, lang: ToolLang): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return cum(lang, "unknownNumber", {});
  const locale = lang === "vi" ? "vi-VN" : lang === "zh" ? "zh-CN" : "en-US";
  return `${Math.round(bytes / MIB).toLocaleString(locale)} MiB`;
}

function empty(): VramStateData {
  return { state: null, rows: [] };
}

/**
 * ★★★ BẢN TÓM TẮT — **MỖI DÒNG LÀ MỘT CÁI KIM.** Bảng "đồng hồ không kim" của kế hoạch Pha 4 nằm
 * trọn ở đây; xoá một dòng là trả một ô về trạng thái không ai đọc (và `vramTools.test.ts` đỏ).
 */
function tomTat(s: VramAgentState, lang: ToolLang): Dong[] {
  const d: Dong[] = [];
  /** Rút gọn cục bộ — **không** phải một cửa thứ hai: cả hai chỉ chuyển tiếp `lang` xuống. */
  const M = (b: number | null | undefined): string => mib(b, lang);
  const C = (x: string | null | undefined): string => catSach(x, lang);
  /**
   * ★ N11 — ô **HIỂN THỊ** (đã cắt ở nguồn, có cờ đi kèm). Không phải cửa thứ hai: nó gọi **đúng**
   * `catSach()`, chỉ chuyển tiếp thêm cờ + độ dài GỐC để câu khai nói đúng sự thật.
   */
  const H = (x: VramAgentDisplayText | null | undefined): string =>
    x === null || x === undefined ? "" : catSach(x.text, lang, x);

  /**
   * ★★★ Pha 7 Task 2 — **DÒNG ĐẦU: DANH TÍNH CỦA ẢNH CHỤP.**
   * `atMs` · `processKey` · `effective.readMark` · `effective.readAtMs` có **0 người đọc** trước
   * bản này. Agent **chỉ nhận `textSummary`**, nên không có bốn ô này thì hai bản tóm tắt của hai
   * lượt hỏi **không phân biệt được** — và cả cơ chế `readMark` (dựng ra đúng để phân biệt) là mã
   * chết đối với người nó phục vụ.
   */
  d.push(
    noi(lang, "snapshotMark", {
      processKey: C(s.processKey),
      atMs: String(s.atMs),
      readMark: C(s.headroom.effective.readMark),
      /**
       * ★ M-3 (review) — `readAtMs` được đọc bằng một **PHÉP SO**, không in lại thành một con
       * số thứ hai: nó **bằng `atMs` theo cấu tạo**, nên in cả hai là nói một điều hai lần.
       * Rẽ nhánh nằm **ở đây** và chọn giữa **HAI KHOÁ** (§A-AST: thân khuôn không được rẽ nhánh).
       */
      mocDau:
        s.headroom.effective.readAtMs === s.atMs
          ? cum(lang, "markSameAsSnapshot", {})
          : cum(lang, "markDiffersFromSnapshot", { readAtMs: String(s.headroom.effective.readAtMs) }),
    }),
  );

  // ── DƯ ĐỊA + `trusted`/`degradedReasons` (đồng hồ #2 của bảng) ───────────────────────────────
  d.push(
    noi(lang, "headroom", {
      /**
       * ★ Pha 6 Task 2 — con số ĐANG CHẢY, lấy **tại mốc đọc của chính ảnh chụp**. Lượt ấy chỉ
       * đổi **đường lấy số**, không đổi lời nói.
       *
       * ⚠⚠ **NỢ CÒN MỞ, VÀ ĐÂY LÀ LÝ DO ĐÚNG** (đính chính RR-D — lý do khai lần đầu **SAI**):
       * dòng này in một con số **KHÔNG kèm câu "nó đang chảy"**, trong khi mặt đọc đã mang sẵn
       * `effective.notAnInvariant` + `beforeAfterEvidence`. Và Agent **chỉ nhận `textSummary`**
       * (`aiLocalKnowledgeService.ts:2351` đường stream · `:2070`/`:2396` đường không stream —
       * `data.state` **không bao giờ** tới LLM) ⇒ với Agent, lượt đổi kiểu của Task 2 là **vô
       * hình**.
       * ⚠ Lý do hoãn **KHÔNG PHẢI** *"câu `vi` bị ghim từng byte"*: `git grep "Dư địa hiệu lực"`
       * ngoài `vramPhrases.ts` = **0**, và `vramPhrases.exhaustive.test.ts` cưỡng chế **luật hình
       * dạng** (ba bản thật · `en` chỉ ASCII · `zh` có Hán tự · khuôn không rẽ nhánh · tập khoá
       * dùng ≡ tập khoá khai), **không ghim nội dung**. Chi phí thật để trả nợ này là **3 chuỗi
       * khuôn (vi/en/zh) trong `CAU.headroom`, 0 khoá i18n mới**.
       */
      eff: M(s.headroom.effective.bytesAtReadMs),
      raw: M(s.headroom.rawBytes),
      ceiling: M(s.headroom.ceilingBytes),
      used: M(s.headroom.usedBytes),
    }),
  );
  /**
   * ★★★ Pha 7 Task 2 — **NỢ CỦA KHỐI NGAY TRÊN, NAY TRẢ.** Khối chú thích ở `noi(lang,"headroom")`
   * tự khai: dòng ấy in một con số **KHÔNG kèm** lời khai của chính payload, và với Agent thì lượt
   * đổi KIỂU của Pha 6 Task 2 là **vô hình**. Nay ba ô ấy đi trong chữ, **nguyên văn giá trị của
   * chúng** — không phải một bản sao viết tay của cùng ý.
   * ⚠ `beforeAfterEvidence` là **ASCII** (Pha 7 Task 2 đổi) — điều kiện để nó qua được cổng
   *   *"`lang=en` không một chữ phi-ASCII"* / *"`lang=zh` không một dấu tiếng Việt"*.
   */
  d.push(
    noi(lang, "effectiveFlowing", {
      notAnInvariant: String(s.headroom.effective.notAnInvariant),
      varies: s.headroom.effective.variesWith.map((x) => C(x)).join(", "),
      evidence: C(s.headroom.effective.beforeAfterEvidence),
    }),
  );
  /** ★★★ Pha 7 Task 2 — năm khoản TRỪ; ba trong số đó chính là thứ làm con số trên nhúc nhích. */
  d.push(
    noi(lang, "charges", {
      stale: M(s.headroom.charges.staleMarginBytes),
      sharedLedger: M(s.headroom.charges.sharedLedgerMarginBytes),
      unledgered: M(s.headroom.charges.unledgeredChargeBytes),
      distrust: M(s.headroom.charges.distrustChargeBytes),
      reserve: M(s.headroom.safetyReserveBytes),
    }),
  );
  d.push(
    noi(lang, "basis", {
      basis: C(s.headroom.basis),
      blind: s.headroom.blind ? cum(lang, "basisBlind", {}) : "",
      trusted: String(s.headroom.trusted),
      degraded:
        s.headroom.degradedReasons.length > 0
          ? cum(lang, "degradedYes", { reasons: s.headroom.degradedReasons.map((r) => C(r)).join(", ") })
          : cum(lang, "degradedNo", {}),
    }),
  );

  // ── `attributable` — CHẶN TRÊN có nhãn ──────────────────────────────────────────────────────
  d.push(
    s.attributable.known
      ? noi(lang, "attributableKnown", { bytes: M(s.attributable.bytes) })
      : noi(lang, "attributableUnknown", {
          reason: C(s.attributable.reason),
          meaning: C(s.attributable.meaning),
        }),
  );

  // ── `baselineUnverifiedReasons` (đồng hồ #3 của bảng) ────────────────────────────────────────
  d.push(
    noi(lang, "baseline", {
      verified: String(s.baseline.verified),
      origin: s.baseline.origin === null ? cum(lang, "baselineOriginNone", {}) : C(s.baseline.origin),
      unverified:
        s.baseline.unverifiedReasons === null
          ? cum(lang, "baselineUnverifiedNull", {})
          : s.baseline.unverifiedReasons.length === 0
            ? cum(lang, "baselineUnverifiedEmpty", {})
            : cum(lang, "baselineUnverifiedList", {
                reasons: s.baseline.unverifiedReasons.map((r) => C(r)).join(", "),
              }),
    }),
  );

  // ── SỔ: cục bộ + ANH EM (đồng hồ #5 — `foreignLedgerBytes`/`foreignLeases`) ──────────────────
  d.push(noi(lang, "ledgerLocal", { local: M(s.ledger.localBytes), total: M(s.ledger.totalBytes) }));
  /**
   * ★★★ Pha 7 Task 2 — **CỬA SỔ MÙ XUYÊN TIẾN TRÌNH.** Hai ô này có **0 người đọc** trước bản này
   * dù chúng đo đúng khoảng thời gian mà **hai tiến trình cùng tưởng card còn trống**. Dòng nằm
   * NGOÀI nhánh `foreign.known` cố ý: lúc đang MÙ mới là lúc con số ấy cần được nói ra nhất.
   */
  d.push(
    noi(lang, "sharedWindow", {
      refreshMs: String(s.ledger.sharedRefreshIntervalMs ?? "?"),
      staleAfterMs: String(s.ledger.sharedStaleAfterMs ?? "?"),
    }),
  );
  if (!s.ledger.foreign.known) {
    d.push(noi(lang, "foreignBlind", { meaning: C(s.ledger.foreign.meaning) }));
  } else {
    d.push(
      noi(lang, "foreignKnown", {
        bytes: M(s.ledger.foreign.bytes),
        count: s.ledger.foreign.holders.length,
        ageMs: String(s.ledger.foreign.ageMs ?? "?"),
        stale: String(s.ledger.foreign.stale),
        unsynced: String(s.ledger.foreign.unsyncedWrites ?? "?"),
        fails: String(s.ledger.foreign.consecutiveFailures ?? "?"),
        // ★★★ I-2 — lời khai của Task 5 nay đi trong CHỮ, chỗ Agent thật sự đọc.
        truncated: String(s.ledger.foreign.truncatedIdentityWrites ?? "?"),
      }),
    );
    /**
     * ★★★ I-2 — dòng HÀNH ĐỘNG, chỉ khi con số khác 0. Rẽ nhánh nằm **ở đây**, không trong khuôn
     * câu (§A-AST: thân khuôn phải là một biểu thức chuỗi THUẦN, không rẽ nhánh).
     */
    if ((s.ledger.foreign.truncatedIdentityWrites ?? 0) > 0) {
      d.push(noi(lang, "foreignTruncatedIdentity", { count: String(s.ledger.foreign.truncatedIdentityWrites) }));
    }
  }

  // ── PHẦN KHÔNG QUY TRÁCH NHIỆM ĐƯỢC — `holderListIsLowerBound` ───────────────────────────────
  d.push(
    noi(lang, "unattributed", {
      bytes: M(s.unattributed.bytes),
      caveat: C(s.unattributed.caveat),
      lowerBound: String(s.unattributed.holderListIsLowerBound),
      wired: String(s.unattributed.wiredSiteCount ?? "?"),
      known: String(s.unattributed.knownSiteRowCount ?? "?"),
      excludes: String(s.unattributed.excludesBaselineBytes),
    }),
  );

  // ── ƯỚC LƯỢNG NGOÀI SỔ + `vramBeginFailureState()` (đồng hồ #4) ──────────────────────────────
  const thamUocLuong = {
    bytes: M(s.unledgered.estimateBytes),
    kind: C(s.unledgered.estimateKind),
    usable: String(s.unledgered.estimateUsable),
    unknownCount: String(s.unledgered.unknownCount ?? "?"),
  };
  d.push(
    s.unledgered.estimateUsable
      ? noi(lang, "unledgeredEstimateUsable", thamUocLuong)
      : noi(lang, "unledgeredEstimateUnusable", thamUocLuong),
  );
  /**
   * ⚠ NHÃN CỐ Ý KHÔNG VIẾT `beginVramAllocation` KÈM DẤU `(` — và đây là một bài học, không phải
   * một sở thích: lưới *"MỌI file sản xuất gọi `beginVramAllocation` đều nhập vị từ `isVramRefusal`"*
   * (`enforcement.test.ts`) quét bằng `git grep` + regex `\bbeginVramAllocation\s*[({]`, và nó bỏ
   * **chú thích** chứ không bỏ **chuỗi**. Một nhãn người-đọc trông như một LỜI GỌI đã làm lưới ấy
   * kêu oan ở đúng file này. Lưới đó tự ghi *"một lưới kêu oan bảy lần sẽ bị người sau tắt đi, lúc
   * đó ca THẬT chết theo"* ⇒ sửa NHÃN, tuyệt đối không thêm một dòng miễn trừ.
   */
  d.push(
    s.unledgered.lastReason === null
      ? noi(lang, "beginFailuresNoReason", { count: String(s.unledgered.beginFailureCount ?? "?") })
      : noi(lang, "beginFailuresWithReason", {
          count: String(s.unledgered.beginFailureCount ?? "?"),
          reason: H(s.unledgered.lastReason),
        }),
  );

  // ── NHỊP ─────────────────────────────────────────────────────────────────────────────────────
  d.push(
    s.tick.present
      ? noi(lang, "tickPresent", {
          ageMs: String(s.tick.ageMs ?? "?"),
          staleAfterMs: String(s.tick.staleAfterMs),
          stale: String(s.tick.stale),
          fails: String(s.tick.consecutiveFailures ?? "?"),
        })
      : noi(lang, "tickAbsent", { meaning: C(s.tick.meaning) }),
  );

  // ── HOÃN: CẢ 6 HỘ `background` (đồng hồ #1) + retryReach ((D)) ───────────────────────────────
  d.push(
    noi(lang, "deferScope", {
      scope: C(s.defer.scope),
      observedFrom: C(s.defer.observedFromProcessKey),
      durableTrace: C(s.defer.durableTrace),
    }),
  );
  for (const h of s.defer.hosts) {
    const coChe =
      h.mechanism === "no-wait-degrades-in-place"
        ? cum(lang, "mechNoWait", {})
        : cum(lang, "mechWaitRetry", { budgetMs: String(h.budgetMs) });
    /**
     * ★★★ Pha 7 Task 2 — bốn ô của một chuỗi hoãn ĐANG SỐNG (`owner` · `firstRefusedAt` ·
     * `chainBudgetMs` · `lastRefusalMessage`) trước bản này có **0 người đọc**. `owner` nặng nhất:
     * `retryReach.owner` **chỉ tồn tại** ở nhánh `reachable-here` (1/6 hộ), nên với 5 hộ còn lại
     * đây là **chuỗi duy nhất** nói được chuỗi hoãn ấy là của ai.
     * ⚠ `H()` — không phải một cửa cắt thứ hai: `lastRefusalMessage` là ô **HIỂN THỊ đã cắt TẠI
     *   NGUỒN**, và `H` chuyển tiếp cờ + độ dài GỐC để câu khai nói đúng sự thật.
     */
    const trangThai =
      h.status.kind === "deferring"
        ? cum(lang, "statusDeferring", {
            attempts: String(h.status.attempts ?? "?"),
            nextRetryAt: h.status.nextRetryAt === null ? "?" : C(h.status.nextRetryAt),
            owner: C(h.status.owner),
            firstRefusedAt: h.status.firstRefusedAt === null ? "?" : C(h.status.firstRefusedAt),
            chainBudgetMs: String(h.status.chainBudgetMs ?? "?"),
            lastRefusal: h.status.lastRefusalMessage === null ? "?" : H(h.status.lastRefusalMessage),
          })
        : h.status.kind === "exceeded"
          ? cum(lang, "statusExceeded", {
              attempts: String(h.status.attempts ?? "?"),
              owner: C(h.status.owner),
              firstRefusedAt: h.status.firstRefusedAt === null ? "?" : C(h.status.firstRefusedAt),
              chainBudgetMs: String(h.status.chainBudgetMs ?? "?"),
              lastRefusal: h.status.lastRefusalMessage === null ? "?" : H(h.status.lastRefusalMessage),
            })
          : h.status.kind === "no-chain-in-this-process"
            ? cum(lang, "statusNoChain", {})
            : cum(lang, "statusUnobservable", { meaning: C(h.status.meaning) });
    const voiToi =
      h.retryReach.kind === "reachable-here"
        ? /**
           * ⚠⚠ **M-4 (review Task 5) — ĐÂY LÀ MỘT MỆNH LỆNH, DỰNG TỪ MỘT BẢN SAO ĐÃ LÀM SẠCH + CẮT.**
           * Câu `retryReachable` nay bảo Agent *"gọi với owner=…"*, còn `C()` là
           * `stripChatControlTokens ∘ stripInterpolationSyntax` + cắt ở `O_TOI_DA = 200`. Vô hại
           * **hôm nay** chỉ vì một bất biến ở nơi khác: `reachable-here ⇒ owner ≡ host` (ngắn,
           * sạch — xem `vramReadModel.HoTuHenGio`). Nếu một hộ hẹn-giờ-riêng tương lai có `owner`
           * dài/bẩn thì phép cắt **tự khai** (`truncatedField` nói rõ `data.state` giữ nguyên văn),
           * nên Agent không nhận một danh tính hỏng **mà không biết** — nhưng nó vẫn phải đọc
           * `data.state` để lấy bản đúng. Đừng bỏ lời khai ấy đi.
           */
          cum(lang, "retryReachable", { owner: C(h.retryReach.owner) })
        : h.retryReach.kind === "unknown"
          ? cum(lang, "retryUnknown", { why: C(h.retryReach.why) })
          : cum(lang, "retryUnreachable", { why: C(h.retryReach.why) });
    d.push(
      noi(lang, "deferHostLine", {
        host: C(h.host),
        ownerPattern: C(h.ownerPattern.patternText),
        mechanism: coChe,
        hostedHere: h.hostedHere === null ? cum(lang, "hostedHereUnknown", {}) : String(h.hostedHere),
        status: trangThai,
        reach: voiToi,
      }),
    );
  }

  // ── Ô BỊ CHẶN VÌ KHÔNG HỮU HẠN ──────────────────────────────────────────────────────────────
  d.push(
    s.nonFiniteFields.length === 0
      ? noi(lang, "nonFiniteNone", {})
      : noi(lang, "nonFiniteSome", {
          count: s.nonFiniteFields.length,
          fields: s.nonFiniteFields.map((f) => `${C(f.path)}=${C(f.was)}`).join(", "),
        }),
  );

  /**
   * ★ M-6 (review TOÀN NHÁNH) — **AGENT KHÔNG THI HÀNH ĐƯỢC BA LỆNH NÀY, VÀ PHẢI NÓI RA.**
   * Khối đầu file lập luận vì sao `preempt`/`releaseStale`/`retryDeferred` **cố ý** không được đăng
   * ký làm write-tool. Nhưng bản tóm tắt lại gọi tên chúng như thể gọi được ⇒ Agent sẽ "gọi" một
   * tool không tồn tại rồi im lặng. Cùng hạng với M-2 của review Task 3 (*"hai câu chỉ dẫn một hành
   * động Agent KHÔNG THI HÀNH ĐƯỢC"*) — đã đóng ở `client/src`, mở lại ở bề mặt Agent.
   */
  d.push(noi(lang, "commandsNotTools", {}));

  /**
   * ★★★ Pha 7 Task 2 · **I-2 của review — DANH SÁCH KHÔNG CÓ TRẦN DÂN SỐ PHẢI ĐỨNG CUỐI.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO KHỐI NÀY BỊ DỜI XUỐNG CUỐI (đo được, không phải khẩu vị)
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * `ghepCoTran()` **`break` ở dòng đầu tiên vượt trần** ⇒ **mọi dòng SAU nó bị BỎ**. Khối này là
   * chỗ **DUY NHẤT** không có trần dân số (`foreign.holders` do TIẾN TRÌNH ANH EM ghi — nợ C-1
   * vẫn treo), nên khi nó đứng GIỮA thì nó **đẩy mọi dòng sau nó ra khỏi ngữ cảnh LLM**.
   * Đo được ở `lang=en` TRƯỚC lượt dời: **31 hộ anh em** là đủ để **cả khối HOÃN biến mất** —
   * gồm `defer.hosts[].status.owner`, ô mà chính báo cáo Task này gọi là *nặng nhất*.
   * ⇒ Thứ tự nay là một **luật**: *cái gì KHÔNG có trần thì đứng SAU cái gì có trần.* Lượt cắt
   *   khi ấy chỉ ăn vào một danh sách **tự khai là CẬN DƯỚI** (`holderListIsLowerBound`, dòng
   *   `unattributed` ở TRÊN), và người đọc vẫn nhận đủ mọi dòng CÓ trần + câu khai đã cắt.
   * ⚠ Có lưới canh **CHÍNH PHÉP CẮT** (`vramReadModel.readers.test.ts` §5), không chỉ canh
   *   `tomTat()` — một lưới AST thuần trên `tomTat()` **mù hoàn toàn** với `ghepCoTran()`.
   */
  // ── HỘ + `reclaim` (bàn giao I-3: lệnh nào VỚI TỚI hộ này) + TTL (đồng hồ #6) ────────────────
  const hoTatCa = [...s.ledger.localHolders, ...(s.ledger.foreign.known ? s.ledger.foreign.holders : [])];
  if (hoTatCa.length === 0) {
    d.push(noi(lang, "noHolders", {}));
  }
  for (const h of hoTatCa) {
    const oDau =
      h.processKey === null
        ? cum(lang, "atThisProcess", {})
        : cum(lang, "atProcess", { processKey: C(h.processKey) });
    const lenh =
      h.reclaim.kind === "reclaimable-here"
        ? cum(lang, "reclaimHere", { owner: C(h.owner), reclaimer: C(h.reclaim.reclaimer) })
        : h.reclaim.kind === "declared-by-owner-process"
          ? cum(lang, "reclaimOwnerProcess", { reclaimer: C(h.reclaim.reclaimer) })
          : cum(lang, "reclaimNone", { why: C(h.reclaim.why) });
    const ttl =
      h.ttlExpired === null
        ? ""
        : cum(lang, "ttl", {
            ttlMs: String(h.ttlMs),
            expired: String(h.ttlExpired),
            note: h.ttlExpired ? cum(lang, "ttlExpiredNote", {}) : "",
          });
    d.push(
      noi(lang, "holderLine", {
        owner: C(h.owner),
        kind: C(h.kind),
        priority: C(h.priority),
        where: oDau,
        bytes: M(h.bytes),
        measured: String(h.measured),
        // ⚠ `leaseKey=` là TÊN TRƯỜNG máy đọc — dữ liệu, không phải văn xuôi ⇒ ghép ở đây, không
        // vào bảng câu (xem luật "văn xuôi ⇒ khoá · định danh ⇒ tham số" ở `vramPhrases.ts`).
        leaseKeyPart: h.leaseKey === null ? "" : ` · leaseKey=${C(h.leaseKey)}`,
        ttlPart: ttl,
        command: lenh,
      }),
    );
  }

  return d;
}

/**
 * ★ C-1, hậu quả thứ ba — **TRẦN NGỮ CẢNH.** Cắt theo DÒNG (không cắt giữa câu) và **khai ra** đã
 * bỏ bao nhiêu dòng: một bản tóm tắt cụt lủn mà im lặng thì Agent đọc phần còn lại thành TOÀN BỘ.
 */
function ghepCoTran(dong: Dong[], lang: ToolLang): string {
  let do_ = 0;
  let giuBaoNhieu = 0;
  for (const line of dong) {
    if (do_ + line.length + 1 > TOM_TAT_TOI_DA) break;
    giuBaoNhieu += 1;
    do_ += line.length + 1;
  }
  if (giuBaoNhieu === dong.length) return dong.join("\n");
  /**
   * ⚠ `slice` chứ **không** `push(line)` trong vòng lặp — và đó là một quyết định của lưới, không
   * phải khẩu vị: cổng §B của `vramPhrases.exhaustive.test.ts` đòi **mọi** đối số `.push(` trong
   * file này là một lời gọi `noi(`. Một lượt `push` **chuyển tiếp** (đẩy lại một dòng đã dịch) làm
   * cổng ấy phải nới thành *"hoặc là một định danh"* — và cái nới ấy là đúng cửa cho một chuỗi trần
   * đi vào qua một biến trung gian.
   */
  const giu: Dong[] = dong.slice(0, giuBaoNhieu);
  giu.push(
    noi(lang, "summaryTruncated", {
      dropped: dong.length - giu.length,
      total: dong.length,
      cap: TOM_TAT_TOI_DA,
    }),
  );
  return giu.join("\n");
}

export const getVramState: Tool<z.infer<typeof vramStateParams>, VramStateData> = {
  name: "get_vram_state",
  description:
    "Ảnh chụp trạng thái bộ điều phối VRAM: dư địa hiệu lực + cơ sở tính (basis/blind/trusted/degradedReasons), " +
    "sổ cục bộ và sổ chung (hộ của tiến trình anh em), lệnh nào với tới từng hộ, phần KHÔNG quy trách nhiệm " +
    "được, ước lượng chạy ngoài sổ, nền (baseline), nhịp quyết định và trạng thái hoãn của cả 6 hộ nền. " +
    "READ-ONLY, không cấp/thu hồi gì. RBAC machine_control.",
  parameters: vramStateParams,
  triggers: [
    "vram",
    "còn bao nhiêu vram",
    "dư địa vram",
    "ai đang giữ vram",
    "gpu còn trống",
    "vram broker",
    "trạng thái vram",
    "hết vram",
    "显存",
    "vram state",
  ],
  kind: "read",
  requiredPermission: { module: "machine_control", action: "canView" },
  handler: async (params): Promise<ToolResult<VramStateData>> => {
    const lang: ToolLang = params.lang === "en" || params.lang === "zh" ? params.lang : "vi";
    const title = cum(lang, "title", {});

    // ⚠ FAIL-SAFE giống mọi read tool P2: `__authCtx` thiếu/hỏng ⇒ TỪ CHỐI, không rò dữ liệu.
    const parsed = authCtxSchema.safeParse((params as { __authCtx?: unknown }).__authCtx);
    let allowed = false;
    if (parsed.success) {
      try {
        allowed = await checkPermission(parsed.data.userId, parsed.data.role, "machine_control", "canView");
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      return {
        type: "vram_state",
        title,
        data: empty(),
        textSummary: cum(lang, "deny", {}),
        note: "PERMISSION_DENIED",
      };
    }

    /**
     * ⚠ **KHÔNG dựng đường thứ hai** (ràng buộc 2): đọc **đúng** `buildVramAgentState()` mà
     * `vramRouter.state` đọc — cùng phép ghép mà `reserve()` chạy. Một bản tính riêng ở đây sẽ là
     * đồng hồ THỨ HAI nói số khác, đúng lỗi mà `AIBrainDashboard` vừa được gỡ.
     */
    const state = await buildVramAgentState();
    const dong = tomTat(state, lang);

    return {
      type: "vram_state",
      title,
      data: {
        /**
         * ⚠⚠ Mọi ô **DANH TÍNH** ở đây là NGUYÊN VĂN, KHÔNG LÀM SẠCH, KHÔNG CẮT — và đó là **CHỦ Ý**
         * (C-1): `owner`/`leaseKey`/`processKey`/`retryReach.owner` là thứ Agent lấy ra rồi truyền
         * THẲNG vào `vram.preempt` / `vram.releaseStale` / `vram.retryDeferred`; cắt hay làm sạch ở
         * đây là phá đường nối mặt đọc ↔ mặt lệnh (ràng buộc 3). Bề mặt **CÂU CHỮ** (`textSummary`,
         * `rows`) mới là nơi luật ngược lại.
         *
         * ⚠⚠ **M-3 (review Task 5) — CÂU TRÊN KHÔNG CÒN ĐÚNG CHO CẢ ẢNH CHỤP.** Hai ô **CÂU CHỮ**
         * (`unledgered.lastReason`, `defer.hosts[].status.lastRefusalMessage`) đã bị **cắt TẠI
         * NGUỒN** ở `vramReadModel` (trần 400) vì chúng là chuỗi lỗi **không trần** và có người đọc
         * render thẳng. Chúng mang kiểu `VramAgentDisplayText` (`{text, truncated, rawLength}`) —
         * `truncated: true` nghĩa **bản đầy đủ KHÔNG có ở đây**, đừng hứa với Agent là có.
         */
        state,
        rows: dong.map((line, i) => ({ label: `#${i + 1}`, value: line })),
      },
      textSummary: ghepCoTran(dong, lang),
    };
  },
};

registerTool(getVramState);
