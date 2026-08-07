/**
 * ★★★ Pha 6 Task 2 — **`headroom.effective` LÀ MỘT BẪY ĐO LƯỜNG, VÀ LƯỚI NÀY LÀ THỨ LÀM NÓ KHÔNG
 * DÙNG ĐƯỢC LÀM BẰNG CHỨNG TRƯỚC/SAU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NỢ: MỘT Ô HỎNG Ở **CẢ HAI CHIỀU**, VÀ PHA 4 ĐÃ DÙNG NÓ LÀM BẰNG CHỨNG — TRÚNG NHỜ MAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • **DƯƠNG TÍNH GIẢ** (nghiệm thu sống Pha 5 §5): `−426.640.456 B` giữa hai lượt đọc cách nhau
 *     vài giây **trong khi không một byte nào đổi**. Chứng cứ đối chứng: 9 lượt đọc/40 s, **không
 *     một lệnh nào**, `effectiveBytes` `30.725.037.092 → 28.771.770.368` thuần theo `foreign.ageMs`
 *     leo `59 → 5.088 ms`.
 *   • **ÂM TÍNH GIẢ** (nghiệm thu sống Pha 4, F4): **đứng yên tuyệt đối** (`23.470.170.112` ở cả
 *     hai đầu) sau một lượt thu hồi **THÀNH CÔNG 5.030 MiB**, vì `used = max(sổ, attributable)` bị
 *     GHIM bởi phép đo thiết bị của nhịp CŨ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LUẬT CỦA FILE NÀY — **ĐẢO LƯỢNG TỪ**, KHÔNG LIỆT KÊ Ô XẤU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một danh sách *"những ô không được dùng làm bằng chứng"* luôn có **phần tử thứ N+1** (chuỗi pha
 * này đếm được **chín** lần). Nên luật ở đây phát biểu **cái mọi ô PHẢI LÀ**:
 *
 *   ***MỌI ô của ảnh chụp PHẢI tự khai nó là ĐỔI-THEO-ĐỒNG-HỒ hay KHÔNG-ĐỔI-THEO-ĐỒNG-HỒ, và bản
 *   khai ấy bị PHÉP ĐO chấm — không phải bị một docstring.***
 *
 * Một ô MỚI (dù ở nhánh nào của payload) **không có** trong bản khai ⇒ ca **ĐỎ**. Một ô khai sai
 * chiều ⇒ ca **ĐỎ**. Hoán vị hai đường giữa hai danh sách ⇒ **ĐỎ** (bản khai bị chấm theo **ÁNH
 * XẠ từng đường**, không theo **TẬP** — bài học "hai cổng độc lập cùng canh TẬP" của Pha 5).
 *
 * ⚠ **LƯỢNG TỪ, NÓI RÕ VÌ HAI VẾ KHÔNG ĐỐI XỨNG:**
 *   • **KHÔNG-ĐỔI** là lời khẳng định MẠNH ⇒ phải đúng với **MỌI** bước nhích đồng hồ được thử
 *     (`BUOC_NHICH`, ba mốc: trong chu kỳ · qua ngưỡng cũ 120 s · một giờ).
 *   • **ĐỔI** là lời **loại tư cách** ⇒ **MỘT** bước nhích làm nó đổi là đủ; đòi "mọi bước" ở đây
 *     sẽ loại oan những ô chỉ nhảy khi vượt ngưỡng (`trusted`, `tick.stale`, …).
 *   ⇒ Để làm bằng chứng trước/sau, một ô phải bất biến với **MỌI** bước; để bị loại, **MỘT** bước
 *     là đủ. Đúng chiều an toàn.
 *
 * ⚠ **KHÔNG BẮT NHẦM** (chiều bị bỏ qua thường xuyên hơn): §6 khẳng định những ô **được phép** so
 * trước/sau thì **vẫn so được**, và `vramRouter.test.ts` giữ phép so **CÙNG MỐC** giữa mặt đọc và
 * `reserve().decision` — thứ vẫn phải viết ra được sau lượt đổi kiểu.
 *
 * ⚠ Giả **hai** module, và chỉ hai: `./vramEventLog` (chặn một lượt ghi DB trong ca thuần logic) và
 * `../kbSyncScheduler` (cron không chủ trì ở tiến trình test ⇒ ô trạng thái phải tất định). Mọi thứ
 * còn lại là mã sản xuất: `broker.reserve()`, `applyEnforcement()`, `buildVramAgentState()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * ★★★ Pha 7 Task 2 — bộ suy "ô TỪ KIỂU" đã **RỜI KHỎI FILE NÀY** và có **MỘT** chỗ ở.
 * Lý do đầy đủ ở `vramStateFieldPaths.ts`; tóm tắt: Pha 7 cần **đúng lượng từ này** cho luật
 * *"mọi ô phải có NGƯỜI ĐỌC"*, và Global Constraints cấm dựng **bộ suy thứ N+1** cho cùng một tập.
 */
import { vramStateLeafPaths } from "./vramStateFieldPaths";

/** `server/services/vram` — neo theo vị trí file test, không theo `process.cwd()`. */
const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
/** Gốc repo — để kiểm một con trỏ trong payload có **SỐNG** không. */
const GOC_REPO = join(TEST_DIR, "..", "..", "..");

vi.mock("./vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));
vi.mock("../kbSyncScheduler", () => ({
  getKbSyncSchedulerStatus: () => ({ hostedHere: false, deferBudgetMs: 21_600_000, defer: null }),
}));

import { buildVramAgentState, type VramAgentState } from "./vramReadModel";
import * as broker from "./vramBroker";
import { publishDecisionTick, __tickFieldsForTests, __resetDecisionTickForTests } from "./vramTickCell";
import {
  __resetSharedLedgerForTests,
  drainSharedLedgerWrites,
  publishSharedLedgerReplica,
  sharedLedgerSelfKey,
  type SharedLeaseRow,
} from "./vramSharedLedger";
import { __resetVramDeferForTests } from "./vramDefer";
import { __resetVramBeginFailureState } from "./vramWiring";
import { distrustUnitBytes } from "./vramEnforcement";

const MIB = 1024 * 1024;
/** Mốc của lượt đọc `vram.state` THẬT trong nghiệm thu sống Pha 4 — không phải một số bịa. */
const T0 = 1_785_945_331_310;

/**
 * ★ Bốn hộ **THẬT** đọc từ nghiệm thu sống Pha 4 (§1) — tổng đúng **7.471.882.240 B** (`localBytes`
 * đo được hôm đó). Dùng số thật để phép trôi tái lập ở đây so được với phép trôi đo ngoài đời.
 * ⚠ Hộ thứ tư mang **TTL** — cố ý: `ttlExpired` là một ô **ĐỔI THEO ĐỒNG HỒ** nằm ngay trong
 * `localHolders`, tức ngay trong ô mà kế hoạch gọi là "bất biến đúng". Xem §5.
 */
const HO_THAT = [
  { owner: "cuda-backend", kind: "gguf-backend", bytes: 452_595_712, priority: "production", ttlMs: undefined },
  {
    owner: "gguf-embed-ctx:Qwen3-Embedding-0.6B-f16",
    kind: "gguf-embed-context",
    bytes: 551_575_552,
    priority: "background",
    ttlMs: undefined,
  },
  { owner: "gguf:Qwen3-Embedding-0.6B-f16", kind: "gguf-model", bytes: 1_193_291_776, priority: "background", ttlMs: undefined },
  {
    owner: "gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL",
    kind: "gguf-model",
    bytes: 5_274_419_200,
    priority: "background",
    ttlMs: 60_000,
  },
] as const;

/** `attributable` ĐÈ được sổ (`max(L,A) = A`) — đúng hình dạng đã sinh ra F4 ở nghiệm thu Pha 4. */
const ATTRIBUTABLE = 9_000 * MIB;
/**
 * ★ Byte của **một hộ ANH EM**. Con số lấy đúng của review (#2): **1.572.864.000 B** rời sổ chung
 * ⇒ **cả bốn** vế bằng chứng của bản đầu đứng yên tuyệt đối. Xem §7.
 * ⚠ Vẫn phải giữ `localBytes + foreign < ATTRIBUTABLE` để `used` bị `attributable` GHIM — đó là
 * điều kiện của **cả** F4 (§5) **lẫn** phép đo mù sổ chung (§7).
 */
const HO_ANH_EM_BYTES = 1_572_864_000;

/** Hộ CỤC BỘ mang TTL — hộ mà §5/§7 thao tác. MỘT tên, không phải một chuỗi chép ở bốn chỗ. */
const HO_TTL = "gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL";

/**
 * ★ **(B) của review** — một `attributable` **DƯỚI SỔ**: `ledgerTotal` = 7.471.882.240 +
 * 1.572.864.000 = **9.044.746.240**. Ở mức này `max(L, A) = L`, nên hạ `attributable` thêm 1 GiB
 * **không** làm `usedBytes`/`rawBytes`/`effective` nhúc nhích — đúng cảnh mà (B) đòi.
 */
const ATTRIBUTABLE_DUOI_SO = 8_000 * MIB;

/** Ba bước nhích — trong chu kỳ · vượt `*_STALE_AFTER_MS` (120 s) · một giờ. */
const BUOC_NHICH = [5_000, 121_000, 3_600_000] as const;

function hangAnhEm(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "worker:999:1#lease-7",
    processKey: "worker:999:1",
    pid: 999,
    role: "worker",
    leaseId: "lease-7",
    owner: "gguf:qwen30b",
    leaseKind: "gguf-model",
    priority: "background",
    bytes: HO_ANH_EM_BYTES,
    measured: true,
    refCount: 0,
    reclaimer: "gguf-idle-model",
    acquiredAtMs: 1,
    updatedAtMs: 1,
    ...over,
  };
}

const giayPhep = new Map<string, ReturnType<typeof broker.reserve>["lease"]>();

/**
 * Cảnh chuẩn: 4 hộ cục bộ · 1 hộ anh em · tick TƯƠI · sổ chung TƯƠI · **hàng đợi ghi ĐÃ RÚT**.
 *
 * ⚠ Vì sao rút hàng đợi: mỗi lượt `reserve()` xếp một ý định ghi ⇒ `unsyncedWrites > 0` ⇒ lý do
 * `"shared-ledger-unsynced"` thường trực ⇒ `trusted` **kẹt ở `false` ngay từ mốc 0** và phép đo
 * không còn phân biệt được "đổi vì đồng hồ" với "đổi vì hàng đợi". Rút hàng đợi **cô lập đúng một
 * biến số đang đo: THỜI GIAN**. (Không nới gì: đây là cảnh của một tiến trình vừa đồng bộ xong.)
 */
function dungCanh(): void {
  giayPhep.clear();
  for (const h of HO_THAT) {
    const out = broker.reserve(
      {
        owner: h.owner,
        kind: h.kind,
        estimatedBytes: h.bytes,
        priority: h.priority,
        ttlMs: h.ttlMs,
        reclaimer: h.priority === "production" ? undefined : "gguf-idle-model",
      },
      { tick: null, unledgered: null, sharedLedger: null, nowMs: T0 },
    );
    giayPhep.set(h.owner, out.lease);
  }
  drainSharedLedgerWrites();
  publishDecisionTick(__tickFieldsForTests(ATTRIBUTABLE, true), T0);
  publishSharedLedgerReplica([hangAnhEm()], T0, sharedLedgerSelfKey());
}

/** Ảnh chụp tại `T0 + delta` — **chỉ đồng hồ nhích**, không một lượt cấp phát/nhả nào. */
async function chupTai(delta: number): Promise<VramAgentState> {
  vi.setSystemTime(T0 + delta);
  return buildVramAgentState();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LIỆT KÊ LÁ — mảng OBJECT thì đi vào từng phần tử; mảng nguyên thuỷ (và mảng RỖNG) là MỘT lá.
// ══════════════════════════════════════════════════════════════════════════════════════════════
function la(v: unknown, duong: string, ra: Map<string, string>): void {
  if (Array.isArray(v)) {
    // Mảng rỗng vẫn phải để lại MỘT đường — nếu không, một nhánh biến mất khỏi lượng từ mà không
    // ai thấy (đúng lớp "glob rỗng ⇒ cổng khai XANH").
    if (v.length === 0 || v.some((x) => x === null || typeof x !== "object")) {
      ra.set(duong, JSON.stringify(v));
      return;
    }
    v.forEach((x, i) => la(x, `${duong}[${i}]`, ra));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      la(x, duong === "" ? k : `${duong}.${k}`, ra);
    }
    return;
  }
  ra.set(duong, JSON.stringify(v) ?? "undefined");
}

function laCua(s: VramAgentState): Map<string, string> {
  const ra = new Map<string, string>();
  la(s, "", ra);
  return ra;
}

/**
 * ★★★ **GỘP CHỈ SỐ MẢNG: `[3]` → `[]`.** Bản khai phải nói về **một Ô**, không về **một chỗ ngồi
 * trong cảnh dựng của lưới**.
 *
 * ⚠⚠ Đây không phải một lượt dọn cho gọn — nó là điều kiện để bản khai **không nói dối**: trong
 * cảnh này chỉ hộ thứ tư có `ttlMs`, nên nếu khai theo chỉ số thì `localHolders[0..2].ttlExpired`
 * nằm ở vế **KHÔNG-ĐỔI** và người sau đọc thành *"`ttlExpired` so trước/sau được"* — trong khi ô
 * ấy lật thuần vì đồng hồ ở **bất kỳ** hộ nào có TTL. Gộp chỉ số ⇒ một ô chỉ có **một** lời khai,
 * và lời khai ấy đúng cho **mọi** phần tử.
 */
function gopChiSo(duong: string): string {
  return duong.replace(/\[\d+\]/g, "[]");
}

/**
 * ★★★ **MỘT BẢN CÀI ĐẶT DUY NHẤT của phép khớp "đường khai → lá thật"** — `[]` nghĩa **MỌI phần tử**.
 *
 * ⚠⚠ VÌ SAO PHẢI LÀ MỘT BẢN: bản đầu có **HAI** bản (một ở §4, một ở §7) và bản thứ hai **mất một
 * lớp dấu `\`** khi được ghi vào file ⇒ mẫu thành `^ledger.localHolders[d+].owner$` (lớp ký tự
 * `[d+]`, không phải chỉ số) ⇒ nó khớp **KHÔNG lá nào**. Và lỗi ấy **BỊ CHE**: ca *"một hàng sổ
 * chung biến mất"* vẫn xanh nhờ một vế **KHÁC** (`ledger.foreign.bytes`) đổi, nên chỉ ca *"đổi
 * DANH TÍNH, giữ nguyên byte"* mới lòi ra. Đúng lớp *"xanh vì lý do sai"*.
 * ⇒ Một bản cài đặt + **cầu chì "đường khai nào cũng phải khớp ≥ 1 lá"** (dưới) đóng cả hai.
 */
function laKhop(khai: string, cacLa: Iterable<string>): string[] {
  const la = [...cacLa];
  if (!khai.includes("[]")) {
    return la.filter((k) => k === khai || k.startsWith(`${khai}.`) || k.startsWith(`${khai}[`));
  }
  // Thoát TOÀN BỘ trước, rồi mới mở lại đúng `[]` thành "một chỉ số bất kỳ" — không tự tay đếm `\`.
  const mau = khai.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\[\\\]/g, "\\[\\d+\\]");
  const re = new RegExp(`^${mau}$`);
  const khop = la.filter((k) => re.test(k));
  if (khop.length > 0) return khop;
  /**
   * ⚠⚠ **MẢNG RỖNG KHÔNG PHẢI PHÉP KHỚP HỎNG** — và phân biệt được hai thứ đó là điều kiện để cầu
   * chì ở §7 giữ được răng. Khi danh sách hộ **rỗng**, người liệt kê lá phát ra **chính đường mảng**
   * (`ledger.foreign.holders = "[]"`), nên `…[].owner` khớp 0 phần tử một cách **hợp lệ**. Trả về
   * đường mảng ấy ⇒ *"hộ cuối cùng biến mất"* hiện ra như **một lượt đổi giá trị**, đúng như nó là.
   * ⇒ Cầu chì chỉ còn kêu khi **cả hai** đều vắng, tức phép khớp thật sự hỏng.
   */
  const duongMang = khai.slice(0, khai.indexOf("[]"));
  return la.filter((k) => k === duongMang);
}

/**
 * Rút những đường **payload** ra khỏi một câu khai (phần `nvidia-smi` là bằng chứng **NGOÀI**
 * payload — sổ không nhìn thấy byte ngoài sổ, xem `unattributed.excludesBaselineBytes`).
 * ⚠ MỘT bản cài đặt, dùng chung §4 và §7 — cùng lý do với `laKhop`.
 */
function duongCuaCauKhai(cau: string): string[] {
  return cau
    .split("+")
    .map((x) => x.trim())
    .filter((x) => /^[a-zA-Z]+(\[\])?(\.[a-zA-Z]+)+/.test(x))
    .map((x) => x.split(" ")[0]!);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LIỆT KÊ Ô **TỪ KIỂU** (AST) — vì "MỌI ô" suy từ MỘT CẢNH thì chỉ là "mọi ô của cảnh ấy"
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ #4 (review) — **LƯỢNG TỪ KHÔNG ĐƯỢC NEO VÀO MỘT CẢNH DỰNG.**
 *
 * ⚠⚠ Đột biến **R1** đo được: thêm một ô **ĐANG CHẢY** vào một **nhánh hợp kiểu mà cảnh này không
 * hiện thực hoá** (vd nhánh `known: false` của `VramAgentForeignLedger`) ⇒ **45 file / 790 ca
 * XANH**. Tức câu *"MỌI ô của ảnh chụp"* thật ra là *"mọi ô của MỘT cảnh"* — một lượng từ **hẹp
 * hơn nó tự khai**, đúng lớp lỗi mà cả file này tồn tại để diệt.
 *
 * ⇒ Tập ô được suy từ **KIỂU `VramAgentState`**, đọc bằng **AST** (không so chuỗi), **vét cạn MỌI
 * nhánh của MỌI hợp kiểu**. Cảnh dựng chỉ còn một vai: **CHẤM** những ô nó hiện thực hoá được.
 * Ô nào kiểu có mà cảnh không dựng nổi thì phải nằm ở danh sách **thứ ba**, có **lý do** —
 * và nếu một ngày cảnh dựng được nó, ca sẽ ĐỎ cho tới khi nó được **chấm** thật.
 *
 * ⚠ Quy ước khớp với người liệt kê lá lúc CHẠY: mảng của **giá trị nguyên thuỷ** là **một lá**
 * (không `[]`); mảng của **đối tượng** đi vào từng phần tử (`[]`).
 */
/**
 * ⚠ Bộ suy **KHÔNG** nằm ở đây nữa (Pha 7 Task 2) — xem `vramStateFieldPaths.ts`. Lượng từ giữ
 * nguyên từng chữ; thứ đổi là **số bản cài đặt**: 1, không phải 2.
 */
const DUONG_KIEU = vramStateLeafPaths();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BẢN KHAI — mỗi đường của ảnh chụp đứng ở ĐÚNG MỘT vế. Phép đo chấm bản khai này.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Bất biến với **MỌI** bước nhích, ở **MỌI** phần tử mảng ⇒ **dùng được** làm bằng chứng trước/sau.
 * ⚠ Vẫn phải đọc `beforeAfterEvidence`: "so được" **không** đồng nghĩa "một mình nó đủ" (xem §5).
 */
const KHONG_DOI_THEO_DONG_HO: readonly string[] = [
  "processKey",
  "nonFiniteFields",
  // ── SỔ ────────────────────────────────────────────────────────────────────────────────────
  "ledger.localBytes",
  "ledger.totalBytes",
  "ledger.sharedRefreshIntervalMs",
  "ledger.sharedStaleAfterMs",
  "ledger.localHolders[].owner",
  "ledger.localHolders[].kind",
  "ledger.localHolders[].bytes",
  "ledger.localHolders[].priority",
  "ledger.localHolders[].measured",
  "ledger.localHolders[].reclaim.kind",
  "ledger.localHolders[].reclaim.why",
  "ledger.localHolders[].processKey",
  "ledger.localHolders[].leaseKey",
  "ledger.localHolders[].ttlMs",
  "ledger.foreign.known",
  "ledger.foreign.bytes",
  "ledger.foreign.unsyncedWrites",
  "ledger.foreign.consecutiveFailures",
  // ★ Pha 6 Task 5 — số HÀNG mang danh tính cụt. Đứng yên theo đồng hồ: nó đếm **trạng thái đang
  //   công bố**, không đếm **lượt**, đúng để tránh lớp nhiễu I-3 ("một cờ luôn bật là cờ vô nghĩa").
  "ledger.foreign.truncatedIdentityWrites",
  "ledger.foreign.holders[].owner",
  "ledger.foreign.holders[].kind",
  "ledger.foreign.holders[].bytes",
  "ledger.foreign.holders[].priority",
  "ledger.foreign.holders[].measured",
  "ledger.foreign.holders[].reclaim.kind",
  "ledger.foreign.holders[].reclaim.reclaimer",
  "ledger.foreign.holders[].processKey",
  "ledger.foreign.holders[].leaseKey",
  // ⚠ Sổ chung KHÔNG mang TTL ⇒ hai ô này là hằng `null` (`hoAnhEm`), **khác hẳn** hộ CỤC BỘ.
  "ledger.foreign.holders[].ttlMs",
  "ledger.foreign.holders[].ttlExpired",
  // ── DƯ ĐỊA ────────────────────────────────────────────────────────────────────────────────
  "headroom.rawBytes",
  "headroom.basis",
  "headroom.blind",
  "headroom.usedBytes",
  "headroom.ceilingBytes",
  "headroom.safetyReserveBytes",
  "headroom.charges.unledgeredChargeBytes",
  "headroom.effective.notAnInvariant",
  "headroom.effective.variesWith",
  "headroom.effective.beforeAfterEvidence",
  // ── CÒN LẠI ───────────────────────────────────────────────────────────────────────────────
  "attributable.known",
  "attributable.bytes",
  "tick.present",
  "tick.staleAfterMs",
  "tick.consecutiveFailures",
  "baseline.verified",
  "baseline.unverifiedReasons",
  "baseline.origin",
  "unattributed.bytes",
  "unattributed.excludesBaselineBytes",
  "unattributed.caveat",
  "unattributed.holderListIsLowerBound",
  "unattributed.wiredSiteCount",
  "unattributed.knownSiteRowCount",
  "unledgered.estimateBytes",
  "unledgered.estimateKind",
  "unledgered.unknownCount",
  "unledgered.estimateUsable",
  "unledgered.beginFailureCount",
  "unledgered.lastReason",
  "defer.scope",
  "defer.observedFromProcessKey",
  "defer.durableTrace",
  "defer.hosts[].host",
  "defer.hosts[].ownerPattern.patternText",
  "defer.hosts[].budgetMs",
  "defer.hosts[].mechanism",
  "defer.hosts[].hostedHere",
  "defer.hosts[].status.kind",
  "defer.hosts[].status.meaning",
  "defer.hosts[].retryReach.kind",
  "defer.hosts[].retryReach.why",
];

/**
 * **MỘT** bước nhích (ở **MỘT** phần tử là đủ) làm nó đổi ⇒ **KHÔNG dùng được** làm bằng chứng
 * trước/sau. Mười ba ô, và **không ô nào** trong số này từng tự khai điều đó trước Pha 6.
 */
const DOI_THEO_DONG_HO: readonly string[] = [
  "atMs",
  // ★★★ Ô của Task 2 — và hai dấu đi kèm nó.
  "headroom.effective.bytesAtReadMs",
  "headroom.effective.readAtMs",
  /**
   * ⚠ #1 — **DẤU ĐỌC**: đổi ở **MỌI** lượt đọc, kể cả hai lượt **cùng một mili giây**. Nó là một
   * ô "đổi mạnh hơn theo-đồng-hồ", nên đương nhiên thuộc vế bị **LOẠI TƯ CÁCH** làm bằng chứng.
   */
  "headroom.effective.readMark",
  // Hai biên theo tuổi + phụ phí mất-tin-cậy: ba khoản TRỪ đang chảy.
  "headroom.charges.staleMarginBytes",
  "headroom.charges.sharedLedgerMarginBytes",
  "headroom.charges.distrustChargeBytes",
  // Cờ và lý do lật khi vượt ngưỡng — **chỉ** bước nhích 121 s bắt được (lượng từ ∃, xem đầu file).
  "headroom.trusted",
  "headroom.degradedReasons",
  "tick.ageMs",
  "tick.stale",
  "ledger.foreign.ageMs",
  "ledger.foreign.stale",
  /**
   * ⚠⚠⚠ **PHẦN TỬ THỨ N+1 CỦA CHÍNH BẢN KHAI "BẤT BIẾN ĐÚNG".** Kế hoạch nêu bằng chứng đúng là
   * *"`rawBytes` + `localBytes` + **danh sách hộ** + `nvidia-smi`"*. Nhưng "danh sách hộ" đọc
   * nguyên khối **KHÔNG** bất biến: ô này lật `false → true` thuần vì đồng hồ (§5). ⇒ vế thứ ba
   * của bằng chứng phải là **`owner` + `bytes`**, không phải cả đối tượng hộ.
   */
  "ledger.localHolders[].ttlExpired",
];

/**
 * ★★★ #4 — **DANH SÁCH THỨ BA: ô KIỂU CÓ mà CẢNH NÀY KHÔNG DỰNG NỔI.**
 *
 * ⚠⚠ Đây **không** phải một sọt rác miễn trừ, và có hai hàng rào giữ nó khỏi thành sọt rác:
 *   1. một đường ở đây mà **cảnh dựng hiện thực hoá được** ⇒ ca **ĐỎ** (nó phải được **CHẤM**,
 *      không được đứng đây);
 *   2. mỗi đường phải có **LÝ DO** — và lý do là *"nhánh nào của hợp kiểu"*, thứ đọc lại được.
 * Một ô MỚI ở một nhánh chưa dựng vẫn **buộc người thêm nó phải khai** — đó là toàn bộ mục đích.
 */
const CANH_NAY_KHONG_DUNG_NOI: readonly { readonly duong: string; readonly viSao: string }[] = [
  { duong: "nonFiniteFields[].path", viSao: "cảnh này KHÔNG có số không hữu hạn ⇒ mảng RỖNG (một lá `nonFiniteFields`)" },
  { duong: "nonFiniteFields[].was", viSao: "cảnh này KHÔNG có số không hữu hạn ⇒ mảng RỖNG (một lá `nonFiniteFields`)" },
  { duong: "ledger.foreign.meaning", viSao: "nhánh `known:false` — cảnh này ĐÃ làm mới sổ chung" },
  { duong: "attributable.meaning", viSao: "nhánh `known:false` — cảnh này có `attributable` hữu hạn" },
  { duong: "attributable.reason", viSao: "nhánh `known:false` — cảnh này có `attributable` hữu hạn" },
  { duong: "tick.meaning", viSao: "nhánh `present:false` — cảnh này ĐÃ xuất bản một nhịp" },
  { duong: "ledger.localHolders[].reclaim.reclaimer", viSao: "nhánh `reclaimable-here`/`declared-by-owner-process` — 4 hộ cục bộ của cảnh đều `no-reclaimer`" },
  { duong: "ledger.foreign.holders[].reclaim.why", viSao: "nhánh `no-reclaimer` — hộ anh em của cảnh CÓ người thi hành đã khai" },
  { duong: "defer.hosts[].status.owner", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.attempts", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.firstRefusedAt", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.nextRetryAt", viSao: "nhánh `deferring` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.chainBudgetMs", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.lastRefusalMessage", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.lastRefusalMessage.text", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.lastRefusalMessage.truncated", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].status.lastRefusalMessage.rawLength", viSao: "nhánh `deferring`/`exceeded` — cảnh này KHÔNG có chuỗi hoãn nào" },
  { duong: "defer.hosts[].retryReach.owner", viSao: "nhánh `reachable-here` — cron KHÔNG chủ trì ở tiến trình test" },
  { duong: "unledgered.lastReason.text", viSao: "cảnh này KHÔNG có lượt `beginVramAllocation()` hỏng ⇒ `null`" },
  { duong: "unledgered.lastReason.truncated", viSao: "cảnh này KHÔNG có lượt `beginVramAllocation()` hỏng ⇒ `null`" },
  { duong: "unledgered.lastReason.rawLength", viSao: "cảnh này KHÔNG có lượt `beginVramAllocation()` hỏng ⇒ `null`" },
];

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — TÁI LẬP PHÉP TRÔI, CÓ SỐ (Bước 1 của brief)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §1 — TÁI LẬP: chỉ ĐỒNG HỒ nhích, `effective` trôi, phần còn lại đứng yên", () => {
  it("★★★ 5 giây, KHÔNG một byte nào đổi ⇒ `effective` trôi ĐÚNG hai trần biên", async () => {
    dungCanh();
    const a = await chupTai(0);
    const b = await chupTai(5_000);

    const don = distrustUnitBytes();
    // Mốc 0: hai bản sao TƯƠI TINH ⇒ hai biên bằng 0, không một lý do suy giảm nào.
    expect(a.headroom.charges.staleMarginBytes).toBe(0);
    expect(a.headroom.charges.sharedLedgerMarginBytes).toBe(0);
    expect(a.headroom.degradedReasons).toEqual([]);
    expect(a.headroom.trusted).toBe(true);
    // Mốc +5 s: **cả hai** biên đã CHẠM TRẦN (bão hoà sau ~675 ms — xem `vramEnforcement`).
    expect(b.headroom.charges.staleMarginBytes).toBe(don);
    expect(b.headroom.charges.sharedLedgerMarginBytes).toBe(don);

    const troi = a.headroom.effective.bytesAtReadMs! - b.headroom.effective.bytesAtReadMs!;
    expect(troi).toBe(2 * don);
    // ⚠ SỐ ĐO: 2.147.483.648 B = 2.048 MiB **thuần vì đồng hồ**.
    expect(troi).toBe(2_147_483_648);

    // ── VÀ KHÔNG MỘT BYTE NÀO ĐỔI: đúng bốn vế của `beforeAfterEvidence` ────────────────────
    expect(b.headroom.rawBytes).toBe(a.headroom.rawBytes);
    expect(b.ledger.localBytes).toBe(a.ledger.localBytes);
    expect(b.ledger.localBytes).toBe(7_471_882_240);
    expect(b.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`)).toEqual(
      a.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`),
    );
    expect(b.headroom.usedBytes).toBe(a.headroom.usedBytes);
  });

  it("★★★ 121 giây ⇒ trôi GẤP ĐÔI (hai biên + hai đơn vị mất-tin-cậy), `rawBytes` vẫn y nguyên", async () => {
    dungCanh();
    const a = await chupTai(0);
    const c = await chupTai(121_000);

    const don = distrustUnitBytes();
    expect(c.headroom.degradedReasons).toEqual(["stale-tick", "shared-ledger-stale"]);
    expect(c.headroom.trusted).toBe(false);
    expect(c.headroom.charges.distrustChargeBytes).toBe(2 * don);

    const troi = a.headroom.effective.bytesAtReadMs! - c.headroom.effective.bytesAtReadMs!;
    expect(troi).toBe(4 * don);
    // ⚠ SỐ ĐO: 4.294.967.296 B = 4.096 MiB **thuần vì đồng hồ**.
    expect(troi).toBe(4_294_967_296);
    expect(c.headroom.rawBytes).toBe(a.headroom.rawBytes);
    expect(c.ledger.localBytes).toBe(a.ledger.localBytes);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — ĐỔI KIỂU: CÂU "NÓ KHÔNG ĐỔI" KHÔNG PHÁT BIỂU ĐƯỢC NỮA — **KỂ CẢ KHI MAY**
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §2 — `effective` mang DẤU ĐỌC ⇒ hai lượt đọc KHÔNG BAO GIỜ bằng nhau", () => {
  /**
   * ★★★ **#1 — CA CỦA CỔNG RA, DẠNG MẠNH.** Đây là ca mà bản đầu **KHÔNG ĐẠT**: mốc là
   * `Date.now()` nên hai lượt đọc **cùng một mili giây** cho hai giá trị `effective` **BẰNG NHAU
   * TUYỆT ĐỐI**, và câu *"sổ không đổi"* xanh **dù 5,27 GB vừa rời sổ**. Đo được trên đồng hồ
   * THẬT: **18/20** cặp lượt đọc liên tiếp trùng mili giây.
   */
  it("★★★ #1 — CÙNG MỘT MILI GIÂY, và 5,27 GB VỪA RỜI SỔ ⇒ hai giá trị `effective` vẫn PHẢI khác", async () => {
    dungCanh();
    // ⚠ Đồng hồ ĐỨNG YÊN tuyệt đối giữa hai lượt đọc — không nhích một mili giây nào.
    const truoc = await chupTai(0);
    broker.release(giayPhep.get("gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL")!);
    drainSharedLedgerWrites();
    const sau = await chupTai(0);

    // Tiền đề của ca: mốc TƯỜNG thật sự TRÙNG (nếu không, ca này không đo cái nó nói).
    expect(sau.headroom.effective.readAtMs).toBe(truoc.headroom.effective.readAtMs);
    expect(sau.atMs).toBe(truoc.atMs);
    // …và 5,27 GB thật sự đã rời sổ.
    expect(truoc.ledger.localBytes! - sau.ledger.localBytes!).toBe(5_274_419_200);
    /**
     * ⇒ **KHẲNG ĐỊNH LOAD-BEARING ĐỨNG TRƯỚC** (bài học của chính đột biến Đ6): nếu để dòng
     * `readMark` lên trên, một bản vá gỡ dấu đọc sẽ làm ca đỏ với câu *"expected undefined not to
     * be undefined"* — người sửa đi tìm một ô `undefined`, chứ không thấy điều thật sự hỏng là
     * **hai ảnh chụp BẰNG NHAU trong khi 5,27 GB đã rời sổ**.
     */
    expect(
      sau.headroom.effective,
      "hai lượt đọc ở hai trạng thái SỔ khác hẳn nhau mà cho cùng một giá trị ⇒ cổng ra KHÔNG đạt",
    ).not.toEqual(truoc.headroom.effective);
    // …và đây là ô DUY NHẤT phân biệt được chúng (bằng chứng cho câu trên, không thay nó).
    expect(sau.headroom.effective.readMark).not.toBe(truoc.headroom.effective.readMark);
  });

  it("★★★ #1 — DẤU ĐỌC KHÔNG TRÙNG ĐƯỢC: 50 lượt đọc trong CÙNG một mili giây ⇒ 50 dấu KHÁC NHAU", async () => {
    dungCanh();
    const dau = new Set<string>();
    for (let i = 0; i < 50; i += 1) dau.add((await chupTai(0)).headroom.effective.readMark);
    expect(dau.size, "hai lượt đọc trùng dấu ⇒ `toEqual` xanh cho hai trạng thái khác nhau").toBe(50);
    // ⚠ Và dấu phải mang DANH TÍNH TIẾN TRÌNH — nếu không, hai tiến trình sinh ra dấu trùng.
    const s = await chupTai(0);
    expect(s.headroom.effective.readMark.startsWith(`${s.processKey}#`)).toBe(true);
  });

  it("★★ đối chứng NGƯỢC — mốc TƯỜNG thì TRÙNG ĐƯỢC (vì sao `readAtMs` một mình không đủ)", async () => {
    dungCanh();
    const a = await chupTai(0);
    const b = await chupTai(0);
    expect(b.headroom.effective.readAtMs).toBe(a.headroom.effective.readAtMs);
  });

  it("★★★ hai lượt đọc cách 35 GIÂY — số byte TRÙNG KHÍT — mà giá trị vẫn KHÁC (đây là ca của cái MAY)", async () => {
    dungCanh();
    /**
     * ⚠ Mốc +5 s và +40 s: **cả hai biên đã bão hoà ở trần** (~675 ms) ⇒ con số byte **giống hệt
     * nhau**, đúng như 8 lượt đọc liên tiếp của chứng cứ đối chứng Pha 5 (`28.771.770.368` ở
     * `t+5s … t+40s`). Đây là **CÁI MAY của Pha 4**, tái lập bằng số.
     */
    const a = await chupTai(5_000);
    const b = await chupTai(40_000);

    // Cái MAY, tái lập: con số byte **giống hệt** ở hai lượt đọc cách nhau 35 giây.
    expect(b.headroom.effective.bytesAtReadMs).toBe(a.headroom.effective.bytesAtReadMs);
    // …nhưng GIÁ TRỊ thì không, vì nó đi cùng mốc của nó ⇒ "nó không đổi" là một câu SAI, và nay
    // một phép so nguyên giá trị **nói ra điều đó**.
    expect(b.headroom.effective).not.toEqual(a.headroom.effective);
    expect(a.headroom.effective.readAtMs).toBe(a.atMs);
    expect(b.headroom.effective.readAtMs).toBe(b.atMs);
    expect(b.headroom.effective.readAtMs).not.toBe(a.headroom.effective.readAtMs);
  });

  it("★★ ô tự khai đúng vai của nó, và bản khai KHÔNG rỗng", async () => {
    dungCanh();
    const s = await chupTai(0);
    expect(s.headroom.effective.notAnInvariant).toBe(true);
    expect(s.headroom.effective.variesWith.length).toBeGreaterThanOrEqual(5);
    expect(s.headroom.effective.beforeAfterEvidence).toContain("nvidia-smi");
  });

  it("★★★ ô `effectiveBytes` CŨ đã BIẾN MẤT khỏi payload (không còn đường trần để so trước/sau)", async () => {
    dungCanh();
    const s = await chupTai(0);
    const duong = [...laCua(s).keys()];
    expect(duong).not.toContain("headroom.effectiveBytes");
    expect(duong).toContain("headroom.effective.bytesAtReadMs");
    expect(duong).toContain("headroom.effective.readAtMs");
    expect(duong).toContain("headroom.effective.readMark");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — PHÂN LOẠI VÉT CẠN, CÓ ĐO (đảo lượng từ)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §3 — MỌI ô của ảnh chụp phải tự khai, và phép ĐO chấm bản khai", () => {
  /** Ảnh chụp mốc 0 + ba ảnh chụp sau mỗi bước nhích. Dựng MỘT lần cho cả nhóm ca. */
  async function doBonAnh() {
    dungCanh();
    const goc = laCua(await chupTai(0));
    const sau = new Map<number, Map<string, string>>();
    for (const d of BUOC_NHICH) sau.set(d, laCua(await chupTai(d)));
    /** Đường ĐÃ GỘP CHỈ SỐ → những lá cụ thể của nó. */
    const nhom = new Map<string, string[]>();
    for (const k of goc.keys()) {
      const g = gopChiSo(k);
      nhom.set(g, [...(nhom.get(g) ?? []), k]);
    }
    /** ĐO: đường (đã gộp) có đổi ở **một** phần tử nào, dưới **một** bước nhích nào không. */
    const doiThat = (g: string): boolean =>
      (nhom.get(g) ?? []).some((k) => BUOC_NHICH.some((b) => sau.get(b)!.get(k) !== goc.get(k)));
    /**
     * ★★★ **HAI PHÉP CHẤM, TÁCH RA THÀNH HÀM THUẦN** — để ca "HOÁN VỊ" chấm được một bản khai
     * **KHÁC** bản khai thật, thay vì lặp lại chính phép đo (#6 của review: ca cũ là một
     * **TAUTOLOGY** — `find(d => !doiThat(d))` rồi `expect(doiThat(d)).toBe(false)` — nên nó XANH
     * dưới **cả** Đ3 lẫn R2, tức cái tên "HOÁN VỊ" hứa nhiều hơn ca làm được).
     */
    const chamMANH = (ds: readonly string[]): string[] =>
      ds.flatMap((g) =>
        (nhom.get(g) ?? []).flatMap((k) =>
          BUOC_NHICH.filter((b) => sau.get(b)!.get(k) !== goc.get(k)).map(
            (b) => `${k} @+${b}ms: ${goc.get(k)} → ${sau.get(b)!.get(k)}`,
          ),
        ),
      );
    const chamLOAI = (ds: readonly string[]): string[] => ds.filter((g) => !doiThat(g));
    return { goc, sau, nhom, doiThat, chamMANH, chamLOAI };
  }

  it("★★★ cầu chì — cả hai nguồn ô đều KHÔNG rỗng (0 ô ⇒ mọi khẳng định dưới là chân lý rỗng)", async () => {
    const { goc, nhom } = await doBonAnh();
    expect(goc.size, "lá thô của CẢNH").toBeGreaterThanOrEqual(120);
    expect(nhom.size, "đường đã gộp chỉ số của CẢNH").toBeGreaterThanOrEqual(80);
    // ⚠ #4 — nguồn thứ hai, và là nguồn ĐỊNH NGHĨA lượng từ: KIỂU.
    expect(DUONG_KIEU.size, "bộ đọc AST không rút được ô nào từ `VramAgentState` — nó đã hỏng?").toBeGreaterThanOrEqual(90);
    // ⚠ Kiểu phải RỘNG HƠN cảnh — nếu không, danh sách thứ ba là thừa và #4 chưa đóng.
    expect([...DUONG_KIEU].filter((d) => !nhom.has(d)).length).toBeGreaterThanOrEqual(10);
  });

  it("★★★ #4 VÉT CẠN THEO **KIỂU** — mọi ô của `VramAgentState` nằm ở ĐÚNG MỘT trong BA vế", async () => {
    const { nhom, doiThat } = await doBonAnh();
    const chamDuoc = new Set([...KHONG_DOI_THEO_DONG_HO, ...DOI_THEO_DONG_HO]);
    const khongDungNoi = new Set(CANH_NAY_KHONG_DUNG_NOI.map((x) => x.duong));
    const khai = new Set([...chamDuoc, ...khongDungNoi]);

    /** ⚠ HỢP của hai nguồn: KIỂU (lượng từ) và CẢNH (phép chấm). Thiếu vế nào cũng lọt. */
    const moiO = new Set([...DUONG_KIEU, ...nhom.keys()]);

    const chuaKhai = [...moiO].filter((d) => !khai.has(d));
    expect(
      chuaKhai.map((d) => `${nhom.has(d) ? (doiThat(d) ? "DOI" : "KHONG_DOI") : "CANH_KHONG_DUNG_NOI"}  ${d}`).join("\n"),
      "ô của `VramAgentState` CHƯA được phân loại ⇒ một đại lượng đang chảy có thể lọt vào một phép so trước/sau mà không ai thấy",
    ).toBe("");

    const daChet = [...khai].filter((d) => !moiO.has(d));
    expect(daChet.join("\n"), "bản khai giữ một đường KHÔNG CÒN trong kiểu lẫn cảnh ⇒ nó đang canh một thứ không tồn tại").toBe("");

    // ⚠ BA vế phải RỜI NHAU ĐÔI MỘT — một đường ở hai vế là một bản khai tự mâu thuẫn.
    const caHai = KHONG_DOI_THEO_DONG_HO.filter((d) => DOI_THEO_DONG_HO.includes(d));
    expect(caHai.join(" · "), "một đường vừa KHÔNG-ĐỔI vừa ĐỔI").toBe("");
    const chongLan = [...chamDuoc].filter((d) => khongDungNoi.has(d));
    expect(chongLan.join(" · "), "một đường vừa được CHẤM vừa khai là cảnh không dựng nổi").toBe("");
  });

  it("★★★ #4 — danh sách THỨ BA không được thành SỌT RÁC: đường nào cảnh DỰNG NỔI thì phải bị CHẤM", async () => {
    const { nhom } = await doBonAnh();
    const parked = CANH_NAY_KHONG_DUNG_NOI.filter((x) => nhom.has(x.duong));
    expect(
      parked.map((x) => `${x.duong} — cảnh DỰNG ĐƯỢC ô này, nó phải nằm ở vế được CHẤM`).join("\n"),
    ).toBe("");
    // ⚠ Và mỗi đường phải có LÝ DO đọc được — một danh sách không lý do là một danh sách miễn trừ.
    const khongLyDo = CANH_NAY_KHONG_DUNG_NOI.filter((x) => x.viSao.trim().length < 10);
    expect(khongLyDo.map((x) => x.duong).join("\n")).toBe("");
  });

  it("★★★ KHÔNG-ĐỔI là lời khẳng định MẠNH — phải đúng với **MỌI** bước nhích và **MỌI** phần tử", async () => {
    const { chamMANH } = await doBonAnh();
    expect(
      chamMANH(KHONG_DOI_THEO_DONG_HO).join("\n"),
      "ô khai KHÔNG-ĐỔI mà đổi khi CHỈ đồng hồ nhích ⇒ nó là một bẫy đo lường chưa bị gọi tên",
    ).toBe("");
  });

  it("★★★ ĐỔI là lời LOẠI TƯ CÁCH — MỘT bước nhích ở MỘT phần tử là đủ (và phải có ít nhất một)", async () => {
    const { chamLOAI } = await doBonAnh();
    expect(
      chamLOAI(DOI_THEO_DONG_HO).join("\n"),
      "ô khai ĐỔI-THEO-ĐỒNG-HỒ mà KHÔNG bước nhích nào làm nó đổi ⇒ bản khai đang loại oan một ô so được (BẮT NHẦM)",
    ).toBe("");
  });

  /**
   * ★★★ **#6 — CA NÀY NAY CHẤM MỘT BẢN KHAI KHÁC, KHÔNG LẶP LẠI PHÉP ĐO.**
   *
   * ⚠⚠ Bài học Pha 5: hai cổng "độc lập" cùng canh **TẬP** ⇒ hoán vị hai giá trị giữ nguyên tập và
   * cả hai đều xanh. Ca này **dựng ra bản khai đã hoán vị** rồi chạy **đúng hai phép chấm** mà §3
   * dùng, và đòi **cả hai** phải kêu. Bản cũ chỉ hỏi lại `doiThat()` về hai đường có sẵn — một
   * **tautology** xanh dưới mọi đột biến.
   */
  it("★★★ #6 HOÁN VỊ — bản khai TRÁO CHỖ phải làm **CẢ HAI** phép chấm kêu (ÁNH XẠ, không phải TẬP)", async () => {
    const { chamMANH, chamLOAI } = await doBonAnh();

    const A = "headroom.rawBytes"; // khai KHÔNG-ĐỔI, và đo được là KHÔNG đổi
    const B = "ledger.localHolders[].ttlExpired"; // khai ĐỔI, và đo được là CÓ đổi
    expect(KHONG_DOI_THEO_DONG_HO).toContain(A);
    expect(DOI_THEO_DONG_HO).toContain(B);

    // Bản khai HOÁN VỊ — **TẬP HỢP hai vế không đổi một phần tử nào**.
    const khongDoiTrao = KHONG_DOI_THEO_DONG_HO.map((d) => (d === A ? B : d));
    const doiTrao = DOI_THEO_DONG_HO.map((d) => (d === B ? A : d));
    expect(new Set([...khongDoiTrao, ...doiTrao]).size).toBe(
      new Set([...KHONG_DOI_THEO_DONG_HO, ...DOI_THEO_DONG_HO]).size,
    );

    // ⇒ Một cổng canh TẬP sẽ XANH ở đây. Hai phép chấm theo ÁNH XẠ thì KHÔNG.
    expect(chamMANH(khongDoiTrao).join("\n"), "phép chấm MẠNH phải kêu khi một ô ĐANG CHẢY bị khai là KHÔNG-ĐỔI").not.toBe("");
    expect(chamLOAI(doiTrao).join("\n"), "phép chấm LOẠI-TƯ-CÁCH phải kêu khi một ô so-được bị khai là ĐỔI").not.toBe("");
    // …và phải kêu ĐÚNG TÊN, không phải kêu bừa.
    expect(chamMANH(khongDoiTrao).join("\n")).toContain(B.replace("[]", "[3]"));
    expect(chamLOAI(doiTrao)).toContain(A);

    // ⚠ ĐỐI CHỨNG DƯƠNG: bản khai THẬT thì **cả hai** phép chấm im lặng.
    expect(chamMANH(KHONG_DOI_THEO_DONG_HO)).toEqual([]);
    expect(chamLOAI(DOI_THEO_DONG_HO)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §4 — BẢN KHAI TRONG PAYLOAD PHẢI KHỚP PHÉP ĐO (docstring ↔ mã, chấm bằng máy)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §4 — `variesWith` / `beforeAfterEvidence` bị PHÉP ĐO chấm, không phải bị một docstring", () => {
  /** Cùng bộ ảnh chụp với §3 — dựng lại ở đây để mỗi nhóm ca đứng độc lập. */
  async function doBonAnh() {
    dungCanh();
    const goc = laCua(await chupTai(0));
    const sau = new Map<number, Map<string, string>>();
    for (const d of BUOC_NHICH) sau.set(d, laCua(await chupTai(d)));
    const s = await chupTai(0);
    return { goc, sau, s };
  }

  it("★★★ MỌI đường trong `effective.variesWith` phải TỒN TẠI và phải thật sự ĐỔI theo đồng hồ", async () => {
    const { goc, sau, s } = await doBonAnh();

    const sai: string[] = [];
    for (const duong of s.headroom.effective.variesWith) {
      if (!goc.has(duong)) {
        sai.push(`${duong}: KHÔNG TỒN TẠI trong payload (con trỏ chết)`);
        continue;
      }
      if (!BUOC_NHICH.some((b) => sau.get(b)!.get(duong) !== goc.get(duong))) {
        sai.push(`${duong}: khai là ĐANG CHẢY nhưng KHÔNG đổi khi đồng hồ nhích`);
      }
    }
    expect(sai.join("\n")).toBe("");
    // ⚠ Và bản khai ấy phải TRÙNG KHỚP với phép phân loại của §3 — không phải một danh sách thứ hai.
    for (const duong of s.headroom.effective.variesWith) {
      expect(DOI_THEO_DONG_HO, `${duong} khai trong \`variesWith\` thì phải nằm ở vế ĐỔI của §3`).toContain(duong);
    }
  });

  /**
   * ★★★ **RR-A — CÂU KHAI NAY LÀ MỘT LUẬT, NÊN NÓ ĐƯỢC CHẤM NHƯ MỘT LUẬT.**
   *
   * ⚠⚠ Bản trước nêu **9 đường** và ca này chấm từng đường. Nhưng **đo được**: bản 9 đường vẫn mù
   * trước **BA** lượt đổi thật (xem §7 — (B)(C)(D) của review). Ba lượt liệt kê liên tiếp, ba lần
   * thiếu một vế **khác**. ⇒ Câu khai **thôi liệt kê**; ba điều phải đúng thay vào đó:
   *   1. nó **trỏ tới bản phân loại**, và con trỏ ấy phải **TỒN TẠI trên đĩa** (một đường gõ sai là
   *      một con trỏ chết — bài học của `vramPha5Gate`);
   *   2. nó nêu bằng chứng **NGOÀI payload** (`nvidia-smi`) — sổ không thấy byte ngoài sổ;
   *   3. tập ô nó chỉ tới **KHÔNG chứa một ô ĐANG CHẢY nào** (giao với vế ĐỔI = ∅).
   *
   * ⚠⚠ **VÀ VÌ THẾ KHÔNG CÒN CON SỐ "BAO NHIÊU VẾ" Ở ĐÂU CẢ.** Cổng `toBe(8)` cũ chỉ là một cổng
   * **KHAI BÁO**: bỏ một vế **và** sửa một chữ số ⇒ **26/26 XANH**. Thứ thay nó là **CẤU TRÚC**: tập
   * bằng chứng **suy ra** từ `KHONG_DOI_THEO_DONG_HO`, mà tập ấy **không co lại im lặng được** —
   * bỏ một đường khỏi nó thì hoặc ô ấy **chưa phân loại** (§3 VÉT CẠN ĐỎ), hoặc bị đẩy sang vế ĐỔI
   * (§3 LOẠI-TƯ-CÁCH ĐỎ vì nó không nhúc nhích theo đồng hồ).
   */
  it("★★★ RR-A — câu khai là một LUẬT: con trỏ SỐNG · bằng chứng NGOÀI payload · tập ô KHÔNG chứa ô đang chảy", async () => {
    dungCanh();
    const s = await chupTai(0);
    const cau = s.headroom.effective.beforeAfterEvidence;

    // (1) con trỏ tới bản phân loại phải TỒN TẠI trên đĩa.
    const conTro = cau.match(/[\w./-]+\.test\.ts/)?.[0];
    expect(conTro, "câu khai KHÔNG trỏ tới bản phân loại nào ⇒ nó không cưỡng chế được gì").toBeDefined();
    expect(existsSync(join(GOC_REPO, conTro!)), `con trỏ CHẾT: ${conTro}`).toBe(true);

    // (2) bằng chứng NGOÀI payload — `unattributed` LOẠI TRỪ toàn bộ nền thiết bị.
    expect(cau).toContain("nvidia-smi");
    // (3) một LUẬT, không phải một danh sách để chọn một món.
    //     ⚠ Pha 7 Task 2 — nhãn nay là **ASCII** (xem `VRAM_BEFORE_AFTER_EVIDENCE`): chỉ khi ASCII
    //     thì ô này mới **tới được** `textSummary` của `lang=en`/`lang=zh`, tức mới có NGƯỜI ĐỌC.
    expect(cau).toContain("CLOCK-INVARIANT");
    expect(cau, "nhãn phải nói CẢ TẬP, không phải vài ô được chọn").toContain("(ALL)");
    // ⚠ Và chính tính ASCII ấy là một bất biến: một chữ có dấu quay lại ⇒ ô này rơi khỏi mặt Agent.
    expect(/^[\x20-\x7E]+$/.test(cau), "câu khai phải ASCII — nếu không nó KHÔNG vào được textSummary en/zh").toBe(true);

    // (4) SOUNDNESS: tập bằng chứng không được mời một ô ĐANG CHẢY vào.
    const giao = KHONG_DOI_THEO_DONG_HO.filter((d) => DOI_THEO_DONG_HO.includes(d));
    expect(giao.join(" · "), "bằng chứng đang mời một ô ĐANG CHẢY vào làm bất biến").toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §5 — F4: `rawBytes` MỘT MÌNH KHÔNG ĐỦ — vì sao bằng chứng phải là PHÉP HỘI
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §5 — chiều ÂM TÍNH GIẢ (F4): sổ đổi THẬT mà `effective` VÀ `rawBytes` đều đứng yên", () => {
  it("★★★ nhả 5.274.419.200 B, KHÔNG nhịp đo mới ⇒ `used` bị `attributable` GHIM ⇒ hai ô mù, sổ thì không", async () => {
    dungCanh();
    const truoc = await chupTai(0);

    // Nhả một hộ THẬT. ⚠ Rút hàng đợi ghi để lượt so **chỉ** khác nhau ở đúng biến số đang đo
    // (byte rời sổ) — không phải ở một lý do suy giảm mới.
    broker.release(giayPhep.get("gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL")!);
    drainSharedLedgerWrites();
    const sau = await chupTai(0);

    // ── HAI Ô MÙ ────────────────────────────────────────────────────────────────────────────
    expect(sau.headroom.effective.bytesAtReadMs).toBe(truoc.headroom.effective.bytesAtReadMs);
    expect(sau.headroom.rawBytes).toBe(truoc.headroom.rawBytes);
    expect(sau.headroom.usedBytes).toBe(ATTRIBUTABLE); // `max(sổ, attributable)` = attributable

    // ── SỔ THÌ KHÔNG MÙ: đây là vế mang bằng chứng ─────────────────────────────────────────
    expect(truoc.ledger.localBytes! - sau.ledger.localBytes!).toBe(5_274_419_200);
    expect(sau.ledger.localHolders.length).toBe(truoc.ledger.localHolders.length - 1);

    // ⇒ Ai dùng **một mình** `rawBytes` làm bằng chứng "không có gì đổi" sẽ kết luận SAI ở đây.
    //   Đó là lý do `beforeAfterEvidence` là một PHÉP HỘI bốn vế (§4).
  });

  it("★★★ và `ledger.localHolders` cũng KHÔNG sạch: `ttlExpired` bên trong nó lật thuần vì đồng hồ", async () => {
    /**
     * ⚠⚠ **PHẦN TỬ THỨ N+1 CỦA CHÍNH BẢN KHAI "BẤT BIẾN ĐÚNG".** Kế hoạch nêu bằng chứng đúng là
     * `rawBytes + localBytes + danh sách hộ + nvidia-smi`. Nhưng *"danh sách hộ"* đọc nguyên khối
     * thì **không** bất biến theo đồng hồ: `ttlExpired` (`vramReadModel`, hộ có `ttlMs`) lật
     * `false → true` mà **không một byte nào đổi**. ⇒ Vế "danh sách hộ" của bằng chứng phải là
     * **DANH TÍNH + BYTE** của hộ, không phải cả đối tượng.
     */
    dungCanh();
    const a = await chupTai(0);
    const b = await chupTai(121_000);

    const ttl = (s: VramAgentState) =>
      s.ledger.localHolders.find((h) => h.owner === "gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL")!.ttlExpired;
    expect(ttl(a)).toBe(false);
    expect(ttl(b)).toBe(true);
    // …trong khi DANH TÍNH + BYTE của đúng hộ ấy không nhúc nhích.
    expect(b.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`)).toEqual(
      a.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §6 — KHÔNG BẮT NHẦM: ô ĐƯỢC PHÉP so trước/sau thì PHẢI VẪN SO ĐƯỢC
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ §6 — chiều KHÔNG BẮT NHẦM", () => {
  it("★★ `rawBytes` + `localBytes` + danh tính/byte của hộ: so trước/sau **viết ra được và XANH**", async () => {
    dungCanh();
    const a = await chupTai(0);
    const b = await chupTai(3_600_000);
    expect(b.headroom.rawBytes).toBe(a.headroom.rawBytes);
    expect(b.ledger.localBytes).toBe(a.ledger.localBytes);
    expect(b.ledger.totalBytes).toBe(a.ledger.totalBytes);
    expect(b.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`)).toEqual(
      a.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`),
    );
    expect(b.ledger.foreign.known && b.ledger.foreign.bytes).toBe(a.ledger.foreign.known && a.ledger.foreign.bytes);
  });

  it("★★ phép so CÙNG MỐC vẫn viết được: `effective.bytesAtReadMs` là một `number | null` trần", async () => {
    dungCanh();
    const s = await chupTai(0);
    // ⚠ Đây là chiều mà một "brand" sẽ bắt nhầm — xem `VramAgentEffectiveHeadroom` (đường không chọn).
    const x: number | null = s.headroom.effective.bytesAtReadMs;
    expect(typeof x).toBe("number");
    expect(x! + 0).toBe(x);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §7 — RR-A: LƯỢNG TỪ TRÊN **LƯỢT ĐỔI**, VÀ TẬP BẰNG CHỨNG THÌ **SUY RA**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ **BA LƯỢT LIỆT KÊ, BA LẦN THIẾU MỘT VẾ KHÁC — NÊN THÔI LIỆT KÊ.**
 *
 * | bản khai | vế | lượt đổi THẬT nó KHÔNG thấy |
 * |---|---|---|
 * | kế hoạch | 4 (chỉ sổ CỤC BỘ) | 1.572.864.000 B rời **SỔ CHUNG** |
 * | lượt vá trước | 9 (+ sổ chung) | (B) `attributable` −1 GiB khi **sổ đè** · (C) hộ cục bộ đổi `priority`+`ttlMs` giữ `owner`+`bytes` · (D) hộ anh em **sang tiến trình khác** |
 * | **nay** | **SUY RA** = cả tập KHÔNG-ĐỔI-THEO-ĐỒNG-HỒ | *(lượng từ không còn chỗ cho phần tử N+1 nào ở trục Ô)* |
 *
 * ⚠⚠⚠ Và **mỗi lần**, ô nói ra sự thật **ĐÃ NẰM SẴN** ở vế KHÔNG-ĐỔI của §3 — bản khai chỉ là
 * không mời nó. ⇒ Bằng chứng nay **KHÔNG được viết tay**: nó **là** tập ô mà **PHÉP ĐO** của §3 đã
 * chứng minh là bất biến theo đồng hồ. Cùng lời giải đã dùng cho #4 (vét cạn theo **KIỂU**).
 *
 * ⚠ Tập ấy **không thể co lại im lặng**: bỏ một đường khỏi `KHONG_DOI_THEO_DONG_HO` thì hoặc nó
 * thành **chưa phân loại** (§3 VÉT CẠN ĐỎ), hoặc bị đẩy sang vế ĐỔI (§3 LOẠI-TƯ-CÁCH ĐỎ vì nó
 * không nhúc nhích theo đồng hồ). Đó là thứ thay cho con số `toBe(8)` cũ — **cấu trúc, không phải
 * một cái ghim**.
 *
 * ⚠ **GIỚI HẠN, KHAI THẲNG:** một lượt đổi chỉ chạm những ô **ĐỔI-THEO-ĐỒNG-HỒ** thì payload
 * **không chứng minh được** — phải đo bằng `nvidia-smi` hoặc bảng `vram_events`. Đó là lý do vế
 * ngoài-payload nằm trong chính câu khai.
 */
describe("★★★ §7 — MỌI lượt đổi THẬT phải làm ít nhất MỘT ô của tập bằng chứng nhúc nhích", () => {
  /**
   * Tập bằng chứng — **SUY RA** từ bản phân loại có đo, không phải một danh sách viết tay.
   * (Đường đã gộp chỉ số ∈ `KHONG_DOI_THEO_DONG_HO` ⇒ mọi lá cụ thể của nó đều là bằng chứng.)
   */
  function veBangChung(s: VramAgentState): Map<string, string> {
    const la = laCua(s);
    const ra = new Map<string, string>();
    for (const [k, v] of la) if (KHONG_DOI_THEO_DONG_HO.includes(gopChiSo(k))) ra.set(k, v);
    return ra;
  }

  /** Có ô nào khác nhau giữa hai ảnh chụp không (KHUYẾT một khoá cũng là một lượt đổi). */
  function daDoi(a: Map<string, string>, b: Map<string, string>): string[] {
    const moi = new Set([...a.keys(), ...b.keys()]);
    return [...moi].filter((k) => a.get(k) !== b.get(k));
  }

  /** Rút đúng những lá khớp một BẢN KHAI LIỆT KÊ (dùng cho hai ca "hằng số lịch sử" ở cuối). */
  function rutTheoDanhSach(s: VramAgentState, ds: readonly string[]): Map<string, string> {
    const la = laCua(s);
    const ra = new Map<string, string>();
    for (const d of ds) for (const k of laKhop(d, la.keys())) ra.set(k, la.get(k)!);
    return ra;
  }

  /**
   * Danh mục **LƯỢT ĐỔI THẬT**, mỗi mục **thi hành bằng mã sản xuất**, **đồng hồ ĐỨNG YÊN** (thứ
   * đang đo là *"bằng chứng có THẤY không"*, không phải thời gian).
   * ⚠ Danh mục này vẫn là một danh sách — **nói thẳng ra**. Nhưng nó lượng từ trên **TRỤC KHÁC**
   * (lượt đổi), nên một phần tử N+1 ở đây là *"thêm một phép thử"*, không phải *"một lỗ trong bằng
   * chứng"*. Ba mục (B)(C)(D) đến từ review — **đo được**, không phải nghĩ ra.
   */
  const LUOT_DOI: readonly {
    readonly ten: string;
    readonly dungThem?: () => void;
    readonly lam: () => void;
  }[] = [
    {
      ten: "nhả một hộ CỤC BỘ (5.274.419.200 B)",
      lam: () => {
        broker.release(giayPhep.get(HO_TTL)!);
        drainSharedLedgerWrites();
      },
    },
    {
      ten: "hộ CỤC BỘ đổi DANH TÍNH, giữ nguyên byte (RR-B)",
      lam: () => {
        broker.release(giayPhep.get(HO_TTL)!);
        broker.reserve(
          { owner: "gguf:mot-model-cuc-bo-khac", kind: "gguf-model", estimatedBytes: 5_274_419_200, priority: "background", ttlMs: 60_000, reclaimer: "gguf-idle-model" },
          { tick: null, unledgered: null, sharedLedger: null, nowMs: T0 },
        );
        drainSharedLedgerWrites();
      },
    },
    {
      /**
       * ★★★ **(C) của review — LƯỢT ĐỔI MÀ CẢ CHÍN VẾ CŨ ĐỀU MÙ, KỂ CẢ `nvidia-smi`.**
       * Hộ vừa chuyển từ **thu hồi được** sang **KHÔNG** (`background` → `production`) và mất TTL,
       * mà `owner`+`bytes` **không đổi một ký tự nào** và **0 byte rời card**.
       */
      ten: "(C) hộ CỤC BỘ đổi `priority` background→production + `ttlMs` 60.000→null, GIỮ owner+bytes",
      lam: () => {
        broker.release(giayPhep.get(HO_TTL)!);
        broker.reserve(
          { owner: HO_TTL, kind: "gguf-model", estimatedBytes: 5_274_419_200, priority: "production" },
          { tick: null, unledgered: null, sharedLedger: null, nowMs: T0 },
        );
        drainSharedLedgerWrites();
      },
    },
    {
      /** ★★★ **(D) của review** — hộ anh em **sang tiến trình khác**, giữ `owner`+`bytes`. */
      ten: "(D) hộ ANH EM sang TIẾN TRÌNH KHÁC (worker:999:1 → worker:1234:9), giữ owner+bytes",
      lam: () =>
        publishSharedLedgerReplica(
          [hangAnhEm({ processKey: "worker:1234:9", pid: 1234, leaseKey: "worker:1234:9#lease-7" })],
          T0,
          sharedLedgerSelfKey(),
        ),
    },
    {
      /**
       * ★★★ **(B) của review** — nhịp đo mới hạ `attributable` **1 GiB THẬT**, nhưng **SỔ ĐÈ**
       * (`max(L,A) = L` ở **cả hai** đầu) nên `usedBytes`/`rawBytes`/`effective` **không nhúc
       * nhích**. Ô duy nhất nói ra sự thật là `attributable.bytes` — và nó **đã ở vế KHÔNG-ĐỔI**.
       */
      ten: "(B) nhịp đo mới hạ `attributable` 1 GiB trong khi SỔ ĐÈ (`used` không đổi)",
      dungThem: () => publishDecisionTick(__tickFieldsForTests(ATTRIBUTABLE_DUOI_SO, true), T0),
      lam: () => publishDecisionTick(__tickFieldsForTests(ATTRIBUTABLE_DUOI_SO - 1024 * MIB, true), T0),
    },
  ];

  for (const lo of LUOT_DOI) {
    it(`★★★ ${lo.ten} ⇒ ÍT NHẤT MỘT ô bằng chứng phải đổi`, async () => {
      dungCanh();
      lo.dungThem?.();
      const truoc = veBangChung(await chupTai(0));
      lo.lam();
      const sau = veBangChung(await chupTai(0));
      const doi = daDoi(truoc, sau);
      expect(
        doi.join(" · ") || "(KHÔNG Ô NÀO ĐỔI)",
        `lượt đổi "${lo.ten}" VÔ HÌNH với TOÀN BỘ tập bằng chứng ⇒ payload không chứng minh được nó`,
      ).not.toBe("(KHÔNG Ô NÀO ĐỔI)");
    });
  }

  it("★★ cầu chì — tập bằng chứng SUY RA phải KHÔNG rỗng và KHÔNG chứa một ô ĐANG CHẢY nào", async () => {
    dungCanh();
    const ve = veBangChung(await chupTai(0));
    expect(ve.size, "tập bằng chứng rỗng ⇒ mọi ca §7 là chân lý rỗng").toBeGreaterThanOrEqual(60);
    const bay = [...ve.keys()].filter((k) => DOI_THEO_DONG_HO.includes(gopChiSo(k)));
    expect(bay.join(" · "), "một ô ĐANG CHẢY lọt vào tập bằng chứng").toBe("");
  });

  /**
   * ★★★ **HAI HẰNG SỐ LỊCH SỬ** — giữ nguyên hai bản khai LIỆT KÊ đã bị bác bỏ, và chứng minh lại
   * **bằng số** rằng chúng mù. Không có hai ca này thì các con số 1.572.864.000 / (C) chỉ là một
   * câu trong báo cáo, và người sau sẽ bị cám dỗ *"quay lại liệt kê cho gọn"*.
   */
  const BAN_KE_HOACH_4_VE = [
    "headroom.rawBytes",
    "ledger.localBytes",
    "ledger.localHolders[].owner",
    "ledger.localHolders[].bytes",
  ];
  const BAN_9_VE = [
    ...BAN_KE_HOACH_4_VE,
    "ledger.totalBytes",
    "ledger.foreign.bytes",
    "ledger.foreign.holders[].owner",
    "ledger.foreign.holders[].bytes",
  ];

  it("★★★ HẰNG SỐ LỊCH SỬ 1 — bản KẾ HOẠCH (4 vế) mù trước 1.572.864.000 B rời SỔ CHUNG", async () => {
    dungCanh();
    const truoc = await chupTai(0);
    const truocRut = rutTheoDanhSach(truoc, BAN_KE_HOACH_4_VE);
    publishSharedLedgerReplica([], T0, sharedLedgerSelfKey());
    const sau = await chupTai(0);

    expect(truoc.ledger.foreign.known && truoc.ledger.foreign.bytes).toBe(1_572_864_000);
    expect(truoc.ledger.totalBytes! - sau.ledger.totalBytes!).toBe(1_572_864_000);
    expect(
      daDoi(truocRut, rutTheoDanhSach(sau, BAN_KE_HOACH_4_VE)),
      "nếu ca này đỏ thì tiền đề đã đổi — ĐIỀU TRA, đừng sửa số",
    ).toEqual([]);
    // …và tập SUY RA thì THẤY.
    expect(daDoi(veBangChung(truoc), veBangChung(sau)).length).toBeGreaterThan(0);
  });

  it("★★★ HẰNG SỐ LỊCH SỬ 2 — bản 9 VẾ mù trước (C), kể cả `nvidia-smi` (0 byte rời card)", async () => {
    dungCanh();
    const truoc = await chupTai(0);
    const truocRut = rutTheoDanhSach(truoc, BAN_9_VE);
    // (C) nguyên văn: đổi priority + bỏ TTL, GIỮ owner + bytes.
    broker.release(giayPhep.get(HO_TTL)!);
    broker.reserve(
      { owner: HO_TTL, kind: "gguf-model", estimatedBytes: 5_274_419_200, priority: "production" },
      { tick: null, unledgered: null, sharedLedger: null, nowMs: T0 },
    );
    drainSharedLedgerWrites();
    const sau = await chupTai(0);

    // Tiền đề: `owner`+`bytes` THẬT SỰ không đổi, và hộ THẬT SỰ đổi tư cách thu hồi.
    expect(sau.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`)).toEqual(
      truoc.ledger.localHolders.map((h) => `${h.owner}=${h.bytes}`),
    );
    expect(sau.ledger.localBytes).toBe(truoc.ledger.localBytes);
    const ho = (x: VramAgentState) => x.ledger.localHolders.find((h) => h.owner === HO_TTL)!;
    expect(ho(truoc).priority).toBe("background");
    expect(ho(sau).priority).toBe("production");
    expect(ho(truoc).ttlMs).toBe(60_000);
    expect(ho(sau).ttlMs).toBeNull();

    // ⇒ CHÍN vế mù hoàn toàn…
    expect(
      daDoi(truocRut, rutTheoDanhSach(sau, BAN_9_VE)),
      "nếu ca này đỏ thì tiền đề của RR-A đã đổi — ĐIỀU TRA, đừng sửa số",
    ).toEqual([]);
    // …và tập SUY RA thì THẤY, đích danh những ô nào.
    const thay = daDoi(veBangChung(truoc), veBangChung(sau));
    expect(thay.length).toBeGreaterThan(0);
    expect(thay.some((k) => k.endsWith(".priority") || k.endsWith(".ttlMs"))).toBe(true);
  });
});
