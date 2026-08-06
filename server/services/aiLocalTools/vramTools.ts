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
 *   • `data.state` — ảnh chụp **NGUYÊN VẸN**, không sạch, không cắt. Đây là thứ Agent đọc để lấy
 *     `owner` truyền vào lệnh. Ca "không bị cắt ngắn" nay khẳng định **ở đây**.
 *   • `textSummary` — **mọi** giá trị chuỗi đi qua `catSach()`: làm sạch bằng **ĐÚNG hai hàm đã có**
 *     ở `@shared/textSafety` (không hàm thứ ba), rồi cắt bằng **ĐÚNG phép cắt** mà
 *     `vramPreempt.catCau()` dùng, và **KHAI RA** là đã cắt (không cắt im lặng).
 * ⚠ Đây KHÔNG phải "hai bản sao vị từ": hai bề mặt có **hai bộ diễn giải khác nhau** đọc chuỗi, nên
 * chúng có hai bất biến khác nhau. Bản sao là khi một bất biến có hai người viết.
 */

import { z } from "zod";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolLang, type ToolResult } from "./toolRegistry";
import { buildVramAgentState, type VramAgentState } from "../vram/vramReadModel";
import { catChuoi, stripChatControlTokens, stripInterpolationSyntax } from "@shared/textSafety";

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
function catSach(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const sach = stripChatControlTokens(stripInterpolationSyntax(String(raw)));
  const { cau, daCat } = catChuoi(sach, O_TOI_DA);
  return daCat ? `${cau}…[đã cắt, còn ${O_TOI_DA}/${sach.length} ký tự — ảnh chụp data.state giữ nguyên văn]` : cau;
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

/** MiB chỉ ở CÂU CHỮ (Đ4 — đơn vị nội bộ luôn là byte). `null` giữ nguyên là `null`. */
function mib(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "KHÔNG BIẾT";
  return `${Math.round(bytes / MIB).toLocaleString("vi-VN")} MiB`;
}

const DENY: Record<ToolLang, string> = {
  vi: 'Bạn không có quyền xem trạng thái bộ điều phối VRAM ("machine_control"). Liên hệ quản trị viên.',
  en: 'You do not have permission to view VRAM broker state ("machine_control"). Contact an administrator.',
  zh: "您无权查看 VRAM 调度器状态（machine_control）。请联系管理员。",
};

function empty(): VramStateData {
  return { state: null, rows: [] };
}

/**
 * ★★★ BẢN TÓM TẮT — **MỖI DÒNG LÀ MỘT CÁI KIM.** Bảng "đồng hồ không kim" của kế hoạch Pha 4 nằm
 * trọn ở đây; xoá một dòng là trả một ô về trạng thái không ai đọc (và `vramTools.test.ts` đỏ).
 */
function tomTat(s: VramAgentState): string[] {
  const d: string[] = [];

  // ── DƯ ĐỊA + `trusted`/`degradedReasons` (đồng hồ #2 của bảng) ───────────────────────────────
  d.push(
    `Dư địa hiệu lực: ${mib(s.headroom.effectiveBytes)} (thô ${mib(s.headroom.rawBytes)}) · ` +
      `trần ${mib(s.headroom.ceilingBytes)} · đang dùng ${mib(s.headroom.usedBytes)}.`,
  );
  d.push(
    `basis=${catSach(s.headroom.basis)}${s.headroom.blind ? " (MÙ ⇒ con số này là CHẶN TRÊN, không phải trạng thái an toàn)" : ""} · ` +
      `trusted=${s.headroom.trusted}` +
      (s.headroom.degradedReasons.length > 0
        ? ` · ĐANG SUY GIẢM vì: ${s.headroom.degradedReasons.map(catSach).join(", ")}.`
        : " · không lý do suy giảm nào."),
  );

  // ── `attributable` — CHẶN TRÊN có nhãn ──────────────────────────────────────────────────────
  d.push(
    s.attributable.known
      ? `Quy trách nhiệm được (attributable): ${mib(s.attributable.bytes)}.`
      : `attributable KHÔNG BIẾT (${catSach(s.attributable.reason)}) ⇒ ${catSach(s.attributable.meaning)}: dư địa đang là CHẶN TRÊN.`,
  );

  // ── `baselineUnverifiedReasons` (đồng hồ #3 của bảng) ────────────────────────────────────────
  d.push(
    `Nền (baseline): verified=${s.baseline.verified} · origin=${s.baseline.origin === null ? "CHƯA CÓ NHỊP NÀO" : catSach(s.baseline.origin)} · ` +
      (s.baseline.unverifiedReasons === null
        ? "unverifiedReasons=null (CHƯA CÓ NHỊP NÀO — khác hẳn mảng rỗng)."
        : s.baseline.unverifiedReasons.length === 0
          ? "unverifiedReasons=[] (có nhịp, không lý do nào)."
          : `unverifiedReasons: ${s.baseline.unverifiedReasons.map(catSach).join(", ")}.`),
  );

  // ── SỔ: cục bộ + ANH EM (đồng hồ #5 — `foreignLedgerBytes`/`foreignLeases`) ──────────────────
  d.push(`Sổ cục bộ: ${mib(s.ledger.localBytes)} · tổng (cục bộ + anh em): ${mib(s.ledger.totalBytes)}.`);
  if (!s.ledger.foreign.known) {
    d.push(
      `Sổ chung: ${catSach(s.ledger.foreign.meaning)} — ĐANG MÙ về tiến trình anh em. TUYỆT ĐỐI không đọc thành "không ai khác giữ gì".`,
    );
  } else {
    d.push(
      `Sổ chung (anh em): ${mib(s.ledger.foreign.bytes)} · ${s.ledger.foreign.holders.length} hộ · ` +
        `tuổi bản sao ${s.ledger.foreign.ageMs ?? "?"} ms (stale=${s.ledger.foreign.stale}) · ` +
        `ghi chưa đồng bộ=${s.ledger.foreign.unsyncedWrites ?? "?"} · hỏng liên tiếp=${s.ledger.foreign.consecutiveFailures ?? "?"}.`,
    );
  }

  // ── HỘ + `reclaim` (bàn giao I-3: lệnh nào VỚI TỚI hộ này) + TTL (đồng hồ #6) ────────────────
  const hoTatCa = [...s.ledger.localHolders, ...(s.ledger.foreign.known ? s.ledger.foreign.holders : [])];
  if (hoTatCa.length === 0) {
    d.push('Đang giữ (theo sổ): KHÔNG hộ nào — nhưng xem "CẬN DƯỚI" ngay dưới trước khi kết luận card trống.');
  }
  for (const h of hoTatCa) {
    const noi = h.processKey === null ? "tiến trình NÀY" : `tiến trình ${catSach(h.processKey)}`;
    const lenh =
      h.reclaim.kind === "reclaimable-here"
        ? `vram.preempt("${catSach(h.owner)}") VỚI TỚI (người thi hành: ${catSach(h.reclaim.reclaimer)})`
        : h.reclaim.kind === "declared-by-owner-process"
          ? `CHỈ tiến trình chủ thu hồi được (đã khai ${catSach(h.reclaim.reclaimer)}); từ đây vram.preempt sẽ trả owner-not-in-local-ledger`
          : `KHÔNG lệnh nào với tới (${catSach(h.reclaim.why)})`;
    const ttl =
      h.ttlExpired === null
        ? ""
        : ` · TTL ${h.ttlMs} ms, quá hạn=${h.ttlExpired}${h.ttlExpired ? " (KHÔNG có nhịp nào tự gặt theo TTL — phải ra lệnh thu hồi)" : ""}`;
    d.push(
      `Hộ "${catSach(h.owner)}" (${catSach(h.kind)}, ${catSach(h.priority)}) ở ${noi}: ${mib(h.bytes)}` +
        ` · số đo=${h.measured}` +
        (h.leaseKey === null ? "" : ` · leaseKey=${catSach(h.leaseKey)}`) +
        ttl +
        ` · ${lenh}.`,
    );
  }

  // ── PHẦN KHÔNG QUY TRÁCH NHIỆM ĐƯỢC — `holderListIsLowerBound` ───────────────────────────────
  d.push(
    `Ngoài sổ (không quy trách nhiệm được): ${mib(s.unattributed.bytes)} · caveat=${catSach(s.unattributed.caveat)} · ` +
      `holderListIsLowerBound=${s.unattributed.holderListIsLowerBound} (danh sách hộ trên là CẬN DƯỚI: mới nối ` +
      `${s.unattributed.wiredSiteCount ?? "?"}/${s.unattributed.knownSiteRowCount ?? "?"} điểm cấp phát) · ` +
      `excludesBaselineBytes=${s.unattributed.excludesBaselineBytes} (mọi byte trong NỀN đã bị trừ ⇒ số 0 KHÔNG nghĩa là card đã giải thích hết).`,
  );

  // ── ƯỚC LƯỢNG NGOÀI SỔ + `vramBeginFailureState()` (đồng hồ #4) ──────────────────────────────
  d.push(
    `Ước lượng chạy ngoài sổ: ${mib(s.unledgered.estimateBytes)} (estimateKind=${catSach(s.unledgered.estimateKind)}, ` +
      `estimateUsable=${s.unledgered.estimateUsable}, unknownCount=${s.unledgered.unknownCount ?? "?"})` +
      (s.unledgered.estimateUsable ? "." : " ⇒ KHÔNG ĐÁNG TIN, đừng dùng để tính."),
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
    `Lượt cấp phát ngoài sổ (hàm beginVramAllocation) đã hỏng ${s.unledgered.beginFailureCount ?? "?"} lượt` +
      (s.unledgered.lastReason === null ? "." : ` · lý do gần nhất: ${catSach(s.unledgered.lastReason)}`),
  );

  // ── NHỊP ─────────────────────────────────────────────────────────────────────────────────────
  d.push(
    s.tick.present
      ? `Nhịp quyết định: tuổi ${s.tick.ageMs ?? "?"} ms (ngưỡng ${s.tick.staleAfterMs} ms, stale=${s.tick.stale}) · hỏng liên tiếp=${s.tick.consecutiveFailures ?? "?"}.`
      : `Nhịp quyết định: ${catSach(s.tick.meaning)} — CHƯA CÓ NHỊP NÀO (cấu trúc, không tự lành).`,
  );

  // ── HOÃN: CẢ 6 HỘ `background` (đồng hồ #1) + retryReach ((D)) ───────────────────────────────
  d.push(
    `Trạng thái hoãn — phạm vi ${catSach(s.defer.scope)}, quan sát từ ${catSach(s.defer.observedFromProcessKey)}; ` +
      `vết BỀN xuyên tiến trình: ${catSach(s.defer.durableTrace)}.`,
  );
  for (const h of s.defer.hosts) {
    const coChe =
      h.mechanism === "no-wait-degrades-in-place"
        ? "KHÔNG CÓ CƠ CHẾ CHỜ (suy giảm tại chỗ, ngân sách 0)"
        : `có chờ + thử lại (đáy ${h.budgetMs} ms)`;
    const trangThai =
      h.status.kind === "deferring"
        ? `ĐANG HOÃN (${h.status.attempts ?? "?"} lượt, hạn kế ${h.status.nextRetryAt === null ? "?" : catSach(h.status.nextRetryAt)})`
        : h.status.kind === "exceeded"
          ? `ĐÃ QUÁ ĐÁY HOÃN (${h.status.attempts ?? "?"} lượt)`
          : h.status.kind === "no-chain-in-this-process"
            ? "không có chuỗi hoãn nào TRONG TIẾN TRÌNH NÀY"
            : `KHÔNG QUAN SÁT ĐƯỢC Ở ĐÂY (${catSach(h.status.meaning)})`;
    const voiToi =
      h.retryReach.kind === "reachable-here"
        ? `vram.retryDeferred VỚI TỚI (mẫu owner: ${catSach(h.ownerPattern)})`
        : h.retryReach.kind === "unknown"
          ? `không rõ lệnh có với tới không (${catSach(h.retryReach.why)})`
          : `vram.retryDeferred KHÔNG với tới (${catSach(h.retryReach.why)}) — đừng tốn một lượt gọi`;
    d.push(
      `Hộ nền "${catSach(h.host)}" (${catSach(h.ownerPattern)}): ${coChe} · chủ trì ở đây=${h.hostedHere === null ? "KHÔNG XÁC ĐỊNH ĐƯỢC" : h.hostedHere} · ${trangThai} · ${voiToi}.`,
    );
  }

  // ── Ô BỊ CHẶN VÌ KHÔNG HỮU HẠN ──────────────────────────────────────────────────────────────
  d.push(
    s.nonFiniteFields.length === 0
      ? "nonFiniteFields: không ô số nào bị chặn."
      : `nonFiniteFields: ${s.nonFiniteFields.length} ô BỊ CHẶN (fail-closed HỢP LỆ, không phải dữ liệu thiếu): ` +
          s.nonFiniteFields.map((f) => `${catSach(f.path)}=${catSach(f.was)}`).join(", "),
  );

  /**
   * ★ M-6 (review TOÀN NHÁNH) — **AGENT KHÔNG THI HÀNH ĐƯỢC BA LỆNH NÀY, VÀ PHẢI NÓI RA.**
   * Khối đầu file lập luận vì sao `preempt`/`releaseStale`/`retryDeferred` **cố ý** không được đăng
   * ký làm write-tool. Nhưng bản tóm tắt lại gọi tên chúng như thể gọi được ⇒ Agent sẽ "gọi" một
   * tool không tồn tại rồi im lặng. Cùng hạng với M-2 của review Task 3 (*"hai câu chỉ dẫn một hành
   * động Agent KHÔNG THI HÀNH ĐƯỢC"*) — đã đóng ở `client/src`, mở lại ở bề mặt Agent.
   */
  d.push(
    "⚠ Ba lệnh vram.preempt / vram.releaseStale / vram.retryDeferred KHÔNG được đăng ký làm tool " +
      "(chúng phá huỷ được, nên không treo sau một bộ phân loại ý định). Agent ĐỌC ở đây rồi ĐỀ NGHỊ " +
      "người vận hành bấm nút tương ứng trong panel VRAM của màn AI Brain; tuyệt đối không khai là đã tự chạy.",
  );

  return d;
}

/**
 * ★ C-1, hậu quả thứ ba — **TRẦN NGỮ CẢNH.** Cắt theo DÒNG (không cắt giữa câu) và **khai ra** đã
 * bỏ bao nhiêu dòng: một bản tóm tắt cụt lủn mà im lặng thì Agent đọc phần còn lại thành TOÀN BỘ.
 */
function ghepCoTran(dong: string[]): string {
  const giu: string[] = [];
  let do_ = 0;
  for (const line of dong) {
    if (do_ + line.length + 1 > TOM_TAT_TOI_DA) break;
    giu.push(line);
    do_ += line.length + 1;
  }
  if (giu.length === dong.length) return giu.join("\n");
  giu.push(
    `⚠ BẢN TÓM TẮT ĐÃ BỊ CẮT: bỏ ${dong.length - giu.length}/${dong.length} dòng vì vượt trần ` +
      `${TOM_TAT_TOI_DA} ký tự ngữ cảnh. Ảnh chụp ĐẦY ĐỦ nằm ở data.state — đọc nó trước khi kết luận.`,
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
    const title = "Trạng thái bộ điều phối VRAM";

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
      return { type: "vram_state", title, data: empty(), textSummary: DENY[lang], note: "PERMISSION_DENIED" };
    }

    /**
     * ⚠ **KHÔNG dựng đường thứ hai** (ràng buộc 2): đọc **đúng** `buildVramAgentState()` mà
     * `vramRouter.state` đọc — cùng phép ghép mà `reserve()` chạy. Một bản tính riêng ở đây sẽ là
     * đồng hồ THỨ HAI nói số khác, đúng lỗi mà `AIBrainDashboard` vừa được gỡ.
     */
    const state = await buildVramAgentState();
    const dong = tomTat(state);

    return {
      type: "vram_state",
      title,
      data: {
        /**
         * ⚠⚠ NGUYÊN VĂN, KHÔNG LÀM SẠCH, KHÔNG CẮT — và đó là **CHỦ Ý** (C-1): đây là mặt **DANH
         * TÍNH**. `owner`/`leaseKey` ở đây là thứ Agent lấy ra rồi truyền THẲNG vào `vram.preempt` /
         * `vram.releaseStale`; cắt hay làm sạch ở đây là phá đường nối mặt đọc ↔ mặt lệnh (ràng
         * buộc 3). Bề mặt **CÂU CHỮ** (`textSummary`, `rows`) mới là nơi luật ngược lại.
         */
        state,
        rows: dong.map((line, i) => ({ label: `#${i + 1}`, value: line })),
      },
      textSummary: ghepCoTran(dong),
    };
  },
};

registerTool(getVramState);
