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
 */

import { z } from "zod";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolLang, type ToolResult } from "./toolRegistry";
import { buildVramAgentState, type VramAgentState } from "../vram/vramReadModel";

const MIB = 1024 * 1024;

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
    `basis=${s.headroom.basis}${s.headroom.blind ? " (MÙ ⇒ con số này là CHẶN TRÊN, không phải trạng thái an toàn)" : ""} · ` +
      `trusted=${s.headroom.trusted}` +
      (s.headroom.degradedReasons.length > 0
        ? ` · ĐANG SUY GIẢM vì: ${s.headroom.degradedReasons.join(", ")}.`
        : " · không lý do suy giảm nào."),
  );

  // ── `attributable` — CHẶN TRÊN có nhãn ──────────────────────────────────────────────────────
  d.push(
    s.attributable.known
      ? `Quy trách nhiệm được (attributable): ${mib(s.attributable.bytes)}.`
      : `attributable KHÔNG BIẾT (${s.attributable.reason}) ⇒ ${s.attributable.meaning}: dư địa đang là CHẶN TRÊN.`,
  );

  // ── `baselineUnverifiedReasons` (đồng hồ #3 của bảng) ────────────────────────────────────────
  d.push(
    `Nền (baseline): verified=${s.baseline.verified} · origin=${s.baseline.origin ?? "CHƯA CÓ NHỊP NÀO"} · ` +
      (s.baseline.unverifiedReasons === null
        ? "unverifiedReasons=null (CHƯA CÓ NHỊP NÀO — khác hẳn mảng rỗng)."
        : s.baseline.unverifiedReasons.length === 0
          ? "unverifiedReasons=[] (có nhịp, không lý do nào)."
          : `unverifiedReasons: ${s.baseline.unverifiedReasons.join(", ")}.`),
  );

  // ── SỔ: cục bộ + ANH EM (đồng hồ #5 — `foreignLedgerBytes`/`foreignLeases`) ──────────────────
  d.push(`Sổ cục bộ: ${mib(s.ledger.localBytes)} · tổng (cục bộ + anh em): ${mib(s.ledger.totalBytes)}.`);
  if (!s.ledger.foreign.known) {
    d.push(
      `Sổ chung: ${s.ledger.foreign.meaning} — ĐANG MÙ về tiến trình anh em. TUYỆT ĐỐI không đọc thành "không ai khác giữ gì".`,
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
    const noi = h.processKey === null ? "tiến trình NÀY" : `tiến trình ${h.processKey}`;
    const lenh =
      h.reclaim.kind === "reclaimable-here"
        ? `vram.preempt("${h.owner}") VỚI TỚI (người thi hành: ${h.reclaim.reclaimer})`
        : h.reclaim.kind === "declared-by-owner-process"
          ? `CHỈ tiến trình chủ thu hồi được (đã khai ${h.reclaim.reclaimer}); từ đây vram.preempt sẽ trả owner-not-in-local-ledger`
          : `KHÔNG lệnh nào với tới (${h.reclaim.why})`;
    const ttl =
      h.ttlExpired === null
        ? ""
        : ` · TTL ${h.ttlMs} ms, quá hạn=${h.ttlExpired}${h.ttlExpired ? " (KHÔNG có nhịp nào tự gặt theo TTL — phải ra lệnh thu hồi)" : ""}`;
    d.push(
      `Hộ "${h.owner}" (${h.kind}, ${h.priority}) ở ${noi}: ${mib(h.bytes)}` +
        ` · số đo=${h.measured}` +
        (h.leaseKey === null ? "" : ` · leaseKey=${h.leaseKey}`) +
        ttl +
        ` · ${lenh}.`,
    );
  }

  // ── PHẦN KHÔNG QUY TRÁCH NHIỆM ĐƯỢC — `holderListIsLowerBound` ───────────────────────────────
  d.push(
    `Ngoài sổ (không quy trách nhiệm được): ${mib(s.unattributed.bytes)} · caveat=${s.unattributed.caveat} · ` +
      `holderListIsLowerBound=${s.unattributed.holderListIsLowerBound} (danh sách hộ trên là CẬN DƯỚI: mới nối ` +
      `${s.unattributed.wiredSiteCount ?? "?"}/${s.unattributed.knownSiteRowCount ?? "?"} điểm cấp phát) · ` +
      `excludesBaselineBytes=${s.unattributed.excludesBaselineBytes} (mọi byte trong NỀN đã bị trừ ⇒ số 0 KHÔNG nghĩa là card đã giải thích hết).`,
  );

  // ── ƯỚC LƯỢNG NGOÀI SỔ + `vramBeginFailureState()` (đồng hồ #4) ──────────────────────────────
  d.push(
    `Ước lượng chạy ngoài sổ: ${mib(s.unledgered.estimateBytes)} (estimateKind=${s.unledgered.estimateKind}, ` +
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
      (s.unledgered.lastReason === null ? "." : ` · lý do gần nhất: ${s.unledgered.lastReason}`),
  );

  // ── NHỊP ─────────────────────────────────────────────────────────────────────────────────────
  d.push(
    s.tick.present
      ? `Nhịp quyết định: tuổi ${s.tick.ageMs ?? "?"} ms (ngưỡng ${s.tick.staleAfterMs} ms, stale=${s.tick.stale}) · hỏng liên tiếp=${s.tick.consecutiveFailures ?? "?"}.`
      : `Nhịp quyết định: ${s.tick.meaning} — CHƯA CÓ NHỊP NÀO (cấu trúc, không tự lành).`,
  );

  // ── HOÃN: CẢ 6 HỘ `background` (đồng hồ #1) + retryReach ((D)) ───────────────────────────────
  d.push(
    `Trạng thái hoãn — phạm vi ${s.defer.scope}, quan sát từ ${s.defer.observedFromProcessKey}; ` +
      `vết BỀN xuyên tiến trình: ${s.defer.durableTrace}.`,
  );
  for (const h of s.defer.hosts) {
    const coChe =
      h.mechanism === "no-wait-degrades-in-place"
        ? "KHÔNG CÓ CƠ CHẾ CHỜ (suy giảm tại chỗ, ngân sách 0)"
        : `có chờ + thử lại (đáy ${h.budgetMs} ms)`;
    const trangThai =
      h.status.kind === "deferring"
        ? `ĐANG HOÃN (${h.status.attempts ?? "?"} lượt, hạn kế ${h.status.nextRetryAt ?? "?"})`
        : h.status.kind === "exceeded"
          ? `ĐÃ QUÁ ĐÁY HOÃN (${h.status.attempts ?? "?"} lượt)`
          : h.status.kind === "no-chain-in-this-process"
            ? "không có chuỗi hoãn nào TRONG TIẾN TRÌNH NÀY"
            : `KHÔNG QUAN SÁT ĐƯỢC Ở ĐÂY (${h.status.meaning})`;
    const voiToi =
      h.retryReach.kind === "reachable-here"
        ? `vram.retryDeferred("${h.ownerPattern}") VỚI TỚI`
        : h.retryReach.kind === "unknown"
          ? `không rõ lệnh có với tới không (${h.retryReach.why})`
          : `vram.retryDeferred KHÔNG với tới (${h.retryReach.why}) — đừng tốn một lượt gọi`;
    d.push(
      `Hộ nền "${h.host}" (${h.ownerPattern}): ${coChe} · chủ trì ở đây=${h.hostedHere === null ? "KHÔNG XÁC ĐỊNH ĐƯỢC" : h.hostedHere} · ${trangThai} · ${voiToi}.`,
    );
  }

  // ── Ô BỊ CHẶN VÌ KHÔNG HỮU HẠN ──────────────────────────────────────────────────────────────
  d.push(
    s.nonFiniteFields.length === 0
      ? "nonFiniteFields: không ô số nào bị chặn."
      : `nonFiniteFields: ${s.nonFiniteFields.length} ô BỊ CHẶN (fail-closed HỢP LỆ, không phải dữ liệu thiếu): ` +
          s.nonFiniteFields.map((f) => `${f.path}=${f.was}`).join(", "),
  );

  return d;
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
        state,
        rows: dong.map((line, i) => ({ label: `#${i + 1}`, value: line })),
      },
      textSummary: dong.join("\n"),
    };
  },
};

registerTool(getVramState);
