/**
 * ★★★ Pha 3 Task 5 (B) — **HOÃN, KHÔNG CHẶN — CHO MỌI HỘ `background`, KHÔNG CHỈ `kb:sync`.**
 * **Module LÁ**: chỉ `import type` + `vramRefusalSignal` (cũng là lá); mọi I/O đi qua
 * `await import()` bên trong thân hàm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MODULE NÀY TỒN TẠI — MỘT HỢP ĐỒNG ĐANG BỊ VỠ, ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 2B Task 6 dựng cơ chế hoãn **chỉ cho `cron:kb-sync`**. Năm hộ `background` còn lại rơi
 * thẳng qua `VramRefusedError`, và hai trong số đó **phá một hợp đồng ghi trong docstring**:
 *
 *   • `localSidecarTrainer.spawnAndPoll` — docstring nguyên văn *"Never rejects"*. Từ Pha 2B
 *     `beginTrainerVram()` **ném**, cú ném đi thẳng ra `runLocalTraining()` → `catch` → `fail()`
 *     ⇒ **job huấn luyện bị đánh THẤT BẠI** và phải chạy lại TAY.
 *   • `aiLlmFinetuneSidecar.spawnAndWait` — docstring nguyên văn *"Never rejects — mirrors
 *     localSidecarTrainer.spawnAndPoll"*. Cùng đường, cùng hậu quả.
 *
 * Một job nền bị đánh **thất bại** vì card đang bận **trong lúc này** là câu trả lời SAI: việc đó
 * không hỏng, nó chỉ **chưa tới lượt**. Quyết định của chủ dự án (2026-08-02, §5.4) nói đúng điều
 * đó cho `kb:sync`, và không có lý lẽ nào làm nó chỉ đúng cho `kb:sync`.
 *
 * ⚠⚠ **NHƯNG HOÃN MÃI CHÍNH LÀ BỎ QUA, MỘT CÁCH IM LẶNG.** Nên mọi thứ ở đây được dựng quanh đúng
 * bất biến của §5.4, chỉ mở rộng dân số:
 *
 *        KHÔNG ĐƯỜNG NÀO ĐỂ MỘT LƯỢT CẤP PHÁT `background` BIẾN MẤT MÀ KHÔNG ĐỂ LẠI VẾT.
 *
 * Ba vết, ba cơ chế độc lập (một cơ chế chết thì hai cơ chế kia còn):
 *   1. **`vram_events`** — sự kiện `defer` / `defer_exceeded`, BỀN, truy được bằng SQL;
 *   2. **`console.warn` / `console.error`** — người trực đọc ngay lúc chạy;
 *   3. **`docTrangThaiHoanVram()`** — máy đọc được, và nó ĐƯỢC NỐI vào mặt sức khoẻ KB
 *      (`aiLocalKnowledgeService.getKbHealth().vramDefer`). Không có (3) thì đây lại là một
 *      "đồng hồ không kim" — đúng nợ mà `getKbSyncSchedulerStatus().defer` để lại ở Pha 2B.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI KIỂU "HOÃN", VÀ CHÚNG KHÁC NHAU Ở **AI ĐANG ĐỢI** — ĐỌC TRƯỚC KHI ĐẶT NGÂN SÁCH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • **Đường JOB NỀN** (`sidecar:local-trainer` · `sidecar:llm-finetune`): không ai ngồi đợi.
 *     Chờ 15→60 phút rồi thử lại là **đúng nghĩa đen** của "hoãn": job không hỏng, nó chỉ chạy
 *     muộn. Ngân sách mặc định **6 giờ** (cùng con số §5.4).
 *   • **Đường PHỤC VỤ YÊU CẦU** (`cuda-backend:reranker` · `reranker:<path>` ·
 *     `gguf-embed-ctx:<id>` · **`cron:kb-eval-gate`**): có một request HTTP đang treo — hoặc, với
 *     cổng eval, **một chốt đơn-luồng đang bị giữ**. Ngủ 15 phút ở đó **là CHẶN**, đúng
 *     thứ tên module này cấm. Hai hộ ấy vốn đã **không chặn** theo cách khác — chúng **suy giảm
 *     tại chỗ** (`aiReranker.rerank()` trả về thứ tự cosine gốc; `getEmbeddingContext` ném một câu
 *     lỗi đã nói đúng nguyên nhân) — thứ chúng THIẾU là **VẾT**. ⇒ ngân sách mặc định **0**, nghĩa
 *     *"đừng đợi, kêu ngay"* (đúng ngữ nghĩa "0 tường minh" của §5.4): không một mili giây chờ
 *     nào, nhưng từ nay có `defer_exceeded` trong `vram_events` + một ô trạng thái đọc được.
 *     Người vận hành muốn chúng ĐỢI thì đặt `VRAM_DEFER_REQUEST_BUDGET_MS`.
 *
 * ⚠⚠ ĐÍNH CHÍNH (Pha 4 Task 1, review) — **`cron:kb-eval-gate` KHÔNG thuộc đường JOB NỀN**, dù cái
 * tên `cron:` gợi thế. Bản trước của chính khối này xếp nó vào đường JOB (6 giờ) trong khi
 * `kbSyncScheduler.beginEvalGateVram()` truyền `vramRequestDeferBudgetMs()` (mặc định **0**) — và
 * docstring TẠI ĐIỂM GỌI đã giải thích đúng lý do: cổng eval chạy **BÊN TRONG** `runKbSyncNow()`,
 * tức **đang giữ chốt đơn-luồng `running`**; ngủ 15-60 phút ở đó làm **mọi** lượt thử lại của
 * chuỗi hoãn `cron:kb-sync` rơi vào `already_running` — cơ chế hoãn mới vô hiệu hoá cơ chế hoãn cũ.
 * ⇒ Bảng này nay khai theo **MÃ ĐANG CHẠY**. Một tài liệu SAI về một cơ chế an toàn là chỗ người
 * sau dựng giả định lên.
 *
 * ⚠ Ba việc module này CỐ Ý KHÔNG làm (chép nguyên kỷ luật của `kbSyncScheduler`): không đo byte,
 * không cộng byte, không so hai thước (Đ4).
 */
import { isVramRefusal } from "./vramRefusalSignal";
import type { VramLeaseKind, VramPriority } from "./types";

/** §5.4 — thử lại sau **15 phút**, nhân đôi, trần **60 phút**. Cùng con số với `kbSyncScheduler`. */
export const VRAM_DEFER_FIRST_DELAY_MS = 15 * 60 * 1000;
export const VRAM_DEFER_MAX_DELAY_MS = 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type VramDeferPlan =
  | {
      readonly kind: "retry";
      readonly delayMs: number;
      readonly retryAt: number;
      readonly elapsedMs: number;
      readonly budgetMs: number;
    }
  | {
      readonly kind: "exceeded";
      readonly elapsedMs: number;
      /** Lượt thử lại LẼ RA sẽ cách bao lâu — `null` ⇔ chính con số đó không hữu hạn. */
      readonly wouldRetryInMs: number | null;
      readonly budgetMs: number;
    };

/**
 * ★★★ NGƯỜI QUYẾT ĐỊNH DUY NHẤT của §5.4. **Thuần, đồng bộ, không đọc đồng hồ, KHÔNG BAO GIỜ NÉM.**
 *
 * ⚠⚠ ĐÂY LÀ **BẢN CÀI ĐẶT DUY NHẤT** TRONG REPO. `kbSyncScheduler.planKbSyncDefer` nay là một
 * lời gọi thẳng xuống đây (ràng buộc 12: hai bản sao của một vị từ dưới một bất biến thì phải
 * làm cho bản sao sai **không viết ra được** — ở đây là bằng cách xoá hẳn bản thứ hai).
 *
 * `elapsed + delay > budget` chứ không phải `elapsed > budget`: đáy là **ngân sách hoãn**, nên
 * lượt thử lại nào **rơi ra ngoài** ngân sách thì lượt đó không được lên lịch. Với 15→30→60→60…
 * và đáy 6 giờ, cộng dồn là 15·45·105·165·225·285·345 phút ⇒ lượt thứ **8** vượt đáy.
 *
 * ⚠⚠ NHÁNH KHÔNG-HỮU-HẠN LÀ **NHÁNH ĐẦU TIÊN**, CÓ CHỦ Ý. Để phép so sánh tự xử `NaN` là chọn
 * `false` ⇒ "thử lại" ⇒ hoãn vô hạn không tiếng. Ở đây `NaN` đi thẳng vào `exceeded`: **kêu**,
 * chứ không **im**. Cùng chiều fail-closed với `NaN ≤ x === false` ở `vramEnforcement`.
 */
export function planVramDefer(input: {
  readonly now: number;
  readonly firstRefusedAt: number;
  readonly previousDelayMs: number | null;
  readonly budgetMs: number;
}): VramDeferPlan {
  const elapsedMs = input.now - input.firstRefusedAt;
  const delayMs =
    input.previousDelayMs === null
      ? VRAM_DEFER_FIRST_DELAY_MS
      : Math.min(input.previousDelayMs * 2, VRAM_DEFER_MAX_DELAY_MS);

  if (!Number.isFinite(elapsedMs) || !Number.isFinite(delayMs) || !Number.isFinite(input.budgetMs)) {
    return {
      kind: "exceeded",
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
      wouldRetryInMs: Number.isFinite(delayMs) ? delayMs : null,
      budgetMs: Number.isFinite(input.budgetMs) ? input.budgetMs : 0,
    };
  }
  if (elapsedMs + delayMs > input.budgetMs) {
    return { kind: "exceeded", elapsedMs, wouldRetryInMs: delayMs, budgetMs: input.budgetMs };
  }
  return { kind: "retry", delayMs, retryAt: input.now + delayMs, elapsedMs, budgetMs: input.budgetMs };
}

/** Đã kêu về biến cấu hình nào rồi — kêu MỘT lần cho MỖI biến, không mỗi lượt. */
const daKeuVeCauHinh = new Set<string>();

/**
 * ★★★ ĐỌC NGÂN SÁCH HOÃN TỪ `.env`. **MỘT bản cài đặt cho MỌI hộ.**
 *
 * ⚠⚠ MỖI `?? <mặc_định>` CHO MỘT ĐƯỜNG RA LÀ MỘT **DÂY**, VÀ DÂY THÌ PHẢI CÓ **LƯỚI** (ràng buộc
 * 11). Đây là sợi dây nguy hiểm nhất của cả cơ chế: ngân sách là thứ DUY NHẤT biến "hoãn" thành
 * "hoãn CÓ ĐÁY". Bốn hình dạng đầu vào phải được KỂ TÊN, không được để `Number()` tự quyết:
 *   • **chưa đặt** ⇒ mặc định của người gọi;
 *   • **đặt rồi để TRỐNG** (`X=`) ⇒ `Number("")` là **0** — tức "không hoãn một giây nào"; đây là
 *     bẫy "đặt rồi để trống ⇒ âm thầm về một giá trị khác" ⇒ coi là **LỖI CẤU HÌNH**: về mặc định
 *     và KÊU;
 *   • **`NaN` / `Infinity` / âm** ⇒ về mặc định và KÊU. `NaN` là hình dạng CHẾT NGƯỜI: phép so
 *     `elapsed + delay > NaN` cho `false` ⇒ nhánh "thử lại" ⇒ **hoãn VÔ HẠN, IM LẶNG**;
 *   • **`0` TƯỜNG MINH** vẫn hợp lệ: *"đừng hoãn, kêu ngay"* — chiều AN TOÀN (ồn hơn, không im hơn).
 *
 * ⚠⚠ THAM SỐ `keu` KHÔNG PHẢI KHẨU VỊ (M-6 của Task 6, giữ nguyên lý lẽ): chốt một-lần là một
 * **tài nguyên tiêu thụ được** — một mặt sức khoẻ bị poll định kỳ sẽ **ăn mất** tiếng kêu trước
 * khi người vận hành kịp thấy. ⇒ chỉ **đường QUYẾT ĐỊNH** được kêu; mọi đường CHỈ-ĐỌC dùng `false`.
 *
 * @param bien tên biến `.env`.
 * @param macDinh giá trị dùng khi biến **chưa đặt** hoặc **không dùng được** (ms).
 * @param donVi `"gio"` ⇒ giá trị trong `.env` tính bằng GIỜ; `"ms"` ⇒ tính bằng mili giây.
 */
export function docNganSachHoanMs(
  bien: string,
  macDinh: number,
  donVi: "gio" | "ms",
  keu: boolean,
): number {
  const raw = process.env[bien];
  if (raw === undefined) return macDinh;
  const trimmed = String(raw).trim();
  const so = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(so) || so < 0) {
    if (keu && !daKeuVeCauHinh.has(bien)) {
      daKeuVeCauHinh.add(bien);
      console.error(
        `[vramDefer] ${bien}=${JSON.stringify(raw)} KHÔNG dùng được (rỗng/không phải số/âm) ⇒ dùng ` +
          `ngân sách mặc định ${Math.round(macDinh / 1000)} s. Một đáy không hữu hạn sẽ biến ` +
          `"hoãn có đáy" thành "hoãn vô hạn, im lặng".`,
      );
    }
    return macDinh;
  }
  return donVi === "gio" ? so * MS_PER_HOUR : so;
}

/** Ngân sách cho **đường JOB NỀN** — không ai ngồi đợi ⇒ chờ là đúng. Mặc định 6 giờ (§5.4). */
export function vramJobDeferBudgetMs(keu = true): number {
  return docNganSachHoanMs("VRAM_DEFER_BUDGET_HOURS", 6 * MS_PER_HOUR, "gio", keu);
}

/**
 * Ngân sách cho **đường PHỤC VỤ YÊU CẦU** — có request đang treo ⇒ **0 = đừng đợi, kêu ngay**.
 * ⚠ `0` ở đây KHÔNG phải "cơ chế tắt": lượt xin vẫn đi qua `xinVramCoHoan()`, vẫn ghi
 * `defer_exceeded` + trạng thái đọc được, chỉ là **không ngủ**. Đó là toàn bộ khác biệt so với
 * trước Task 5, nơi lời từ chối chỉ để lại một `console.warn` ở `aiReranker`.
 */
export function vramRequestDeferBudgetMs(keu = true): number {
  return docNganSachHoanMs("VRAM_DEFER_REQUEST_BUDGET_MS", 0, "ms", keu);
}

/**
 * Trạng thái hoãn của MỘT hộ — máy đọc được (`docTrangThaiHoanVram()`), và **được nối vào mặt
 * sức khoẻ**. `exceeded === true` ⇒ ngân sách đã hết: lượt xin đã bị NÉM lại cho người gọi.
 */
export interface VramDeferState {
  readonly owner: string;
  readonly attempts: number;
  readonly firstRefusedAt: string;
  /** `null` ⇔ đã quá đáy (không còn lượt thử lại nào được hẹn). */
  readonly nextRetryAt: string | null;
  readonly exceeded: boolean;
  readonly budgetMs: number;
  /** Câu từ chối gần nhất — CẮT còn 400 ký tự (cột chuỗi + `jsonb`, ràng buộc 9/M-1). */
  readonly lastRefusalMessage: string;
}

/**
 * ⚠ MỘT ô cho MỖI `owner`, và `owner` là chuỗi ĐỘNG ở hai hộ (`reranker:<path>`,
 * `gguf-embed-ctx:<id>`). Trần để một cấu hình sinh nhiều model không làm map phình vô hạn:
 * quá trần thì ô CŨ NHẤT bị vứt (và việc đó chỉ mất một dòng TRẠNG THÁI — hai vết kia còn nguyên).
 */
const TRAN_O_TRANG_THAI = 64;
const oTrangThai = new Map<string, VramDeferState>();

/** Ảnh chụp trạng thái hoãn ĐANG SỐNG. Thuần, đồng bộ, KHÔNG BAO GIỜ NÉM. */
export function docTrangThaiHoanVram(): VramDeferState[] {
  return [...oTrangThai.values()];
}

/** Chỉ dùng trong test — xoá ô trạng thái + chốt "đã kêu về cấu hình". */
export function __resetVramDeferForTests(): void {
  oTrangThai.clear();
  daKeuVeCauHinh.clear();
  nguCuaTest = null;
}

/**
 * ★★★ SEAM CHO NGHIỆM THU THEO **ĐƯỜNG THOÁT** (ràng buộc 10). Không có nó thì lượt hoãn của
 * `localSidecarTrainer` / `aiLlmFinetuneSidecar` chỉ kiểm được bằng cách gọi thẳng
 * `xinVramCoHoan()` và tự truyền `ngu` — tức một lưới đi theo FILE, **không** chứng minh rằng
 * hai điểm gọi sản xuất ĐÃ ĐI QUA cơ chế hoãn. Với seam này, ca test gọi `runSidecarTraining()`
 * THẬT và quan sát đúng chuỗi hoãn mà sản xuất sẽ chạy.
 *
 * ⚠ CHỈ thay **giấc ngủ**. Người quyết định, ngân sách, sự kiện, ô trạng thái đều là mã sản xuất.
 */
let nguCuaTest: ((ms: number) => Promise<void>) | null = null;
export function __setVramDeferSleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  nguCuaTest = fn;
}

function isoOrNull(ms: number): string | null {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** ⚠ Cột chuỗi + `detail` `jsonb`: một câu dài vô hạn là một lô sự kiện mất. Cắt tại nguồn. */
function catCau(v: unknown): string {
  return String((v as { message?: unknown } | null)?.message ?? v ?? "").slice(0, 400);
}

/** ⚠ Ràng buộc 9 — không giá trị không hữu hạn nào vào ống dẫn sự kiện. */
function soHuuHan(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

async function ghiSuKienHoan(
  event: "defer" | "defer_exceeded",
  owner: string,
  leaseKind: VramLeaseKind,
  priority: VramPriority,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const { logVramEvent } = await import("./vramEventLog");
    logVramEvent({ event, owner, leaseKind, priority, detail });
  } catch {
    /* telemetry KHÔNG được làm hỏng chính đường hoãn mà nó đang ghi */
  }
}

function nguMacDinh(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    // Một lượt hoãn KHÔNG được giữ tiến trình sống qua lúc đóng máy.
    t.unref?.();
  });
}

export interface XinVramCoHoanTuyChon<T> {
  readonly owner: string;
  readonly leaseKind: VramLeaseKind;
  readonly priority: VramPriority;
  /** Ngân sách hoãn (ms). `0` ⇒ không đợi một mili giây nào, nhưng VẪN để lại vết. */
  readonly budgetMs: number;
  /** Lượt xin THẬT. Được gọi lại nguyên vẹn ở mỗi lượt thử. */
  readonly xin: () => Promise<T>;
  /** Seam test — mặc định `Date.now`. */
  readonly now?: () => number;
  /** Seam test — mặc định `setTimeout`. */
  readonly ngu?: (ms: number) => Promise<void>;
}

/**
 * ★★★ HOÃN-KHÔNG-CHẶN, DÙNG CHUNG. Trả về kết quả của `xin()` khi cổng sổ cấp; **NÉM LẠI ĐÚNG
 * `VramRefusedError` GỐC** khi ngân sách đã hết.
 *
 * ⚠⚠ **KHÔNG NUỐT LỜI TỪ CHỐI.** Quá đáy thì lỗi đi tiếp lên người gọi — nếu không thì đây lại
 * đúng là *"tắt cưỡng chế tại điểm gọi"* mà Pha 2B Task 5 tốn một vòng sửa để bịt. Cái hàm này
 * đổi là **THỜI ĐIỂM** lời từ chối tới nơi, không phải **việc nó có tới nơi hay không**.
 *
 * ⚠ Lỗi KHÔNG PHẢI từ chối (telemetry hỏng, `await import()` ngã…) đi thẳng ra ngoài **không
 * hoãn**: hoãn một lỗi hạ tầng là đợi một thứ sẽ không tự lành.
 *
 * ⚠ RÀNG BUỘC 13 (*"đặt cờ trước lời gọi có thể ném, gỡ ngoài `finally`"* ⇒ chốt kẹt): ô trạng
 * thái ở đây **chỉ được ghi SAU** một lời từ chối và **luôn được xoá** ở mọi đường ra — thành
 * công, quá đáy, và cả lỗi lạ. Không có cờ nào bật trước một lời gọi có thể ném.
 */
export async function xinVramCoHoan<T>(opts: XinVramCoHoanTuyChon<T>): Promise<T> {
  const now = opts.now ?? Date.now;
  const ngu = opts.ngu ?? nguCuaTest ?? nguMacDinh;
  const { owner, leaseKind, priority, budgetMs } = opts;
  const batDau = now();
  let lanTruoc: number | null = null;
  let luot = 0;

  for (;;) {
    try {
      const ket = await opts.xin();
      oTrangThai.delete(owner);
      return ket;
    } catch (err) {
      if (!isVramRefusal(err)) {
        oTrangThai.delete(owner);
        throw err;
      }
      luot += 1;
      const ke = planVramDefer({
        now: now(),
        firstRefusedAt: batDau,
        previousDelayMs: lanTruoc,
        budgetMs,
      });
      const chung = {
        attempt: luot,
        elapsedMs: soHuuHan(ke.elapsedMs),
        budgetMs: soHuuHan(ke.budgetMs),
        firstRefusedAt: isoOrNull(batDau),
        deadlineAt: isoOrNull(batDau + budgetMs),
        refusalMessage: catCau(err),
      };

      if (ke.kind === "exceeded") {
        oTrangThai.set(owner, {
          owner,
          attempts: luot,
          firstRefusedAt: new Date(batDau).toISOString(),
          nextRetryAt: null,
          exceeded: true,
          budgetMs: soHuuHan(budgetMs),
          lastRefusalMessage: catCau(err),
        });
        catBotOTrangThai();
        await ghiSuKienHoan("defer_exceeded", owner, leaseKind, priority, {
          ...chung,
          wouldRetryInMs: ke.wouldRetryInMs === null ? null : soHuuHan(ke.wouldRetryInMs),
        });
        console.error(
          `[vramDefer] ★ QUÁ ĐÁY HOÃN cho "${owner}" (mức ${priority}) — đã hoãn ${luot} lượt trong ` +
            `${Math.round(soHuuHan(ke.elapsedMs) / 1000)} s, ngân sách ${Math.round(soHuuHan(budgetMs) / 1000)} s. ` +
            `Lời từ chối được NÉM LẠI cho người gọi (cưỡng chế KHÔNG bị tắt ở đây). ` +
            `Câu từ chối gần nhất: ${catCau(err)}`,
        );
        throw err;
      }

      lanTruoc = ke.delayMs;
      oTrangThai.set(owner, {
        owner,
        attempts: luot,
        firstRefusedAt: new Date(batDau).toISOString(),
        nextRetryAt: isoOrNull(ke.retryAt),
        exceeded: false,
        budgetMs: soHuuHan(budgetMs),
        lastRefusalMessage: catCau(err),
      });
      catBotOTrangThai();
      await ghiSuKienHoan("defer", owner, leaseKind, priority, {
        ...chung,
        delayMs: soHuuHan(ke.delayMs),
        nextRetryAt: isoOrNull(ke.retryAt),
      });
      console.warn(
        `[vramDefer] HOÃN "${owner}" (mức ${priority}) lượt ${luot}: cổng sổ từ chối, thử lại sau ` +
          `${Math.round(ke.delayMs / 1000)} s (đáy ${Math.round(soHuuHan(budgetMs) / 1000)} s). ` +
          `Việc này KHÔNG hỏng — nó chỉ chưa tới lượt. ${catCau(err)}`,
      );
      await ngu(ke.delayMs);
    }
  }
}

function catBotOTrangThai(): void {
  while (oTrangThai.size > TRAN_O_TRANG_THAI) {
    const cuNhat = oTrangThai.keys().next();
    if (cuNhat.done === true) return;
    oTrangThai.delete(cuNhat.value);
  }
}
