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
const HO_ANH_EM_BYTES = 100 * MIB;

/** Ba bước nhích — trong chu kỳ · vượt `*_STALE_AFTER_MS` (120 s) · một giờ. */
const BUOC_NHICH = [5_000, 121_000, 3_600_000] as const;

function hangAnhEm(): SharedLeaseRow {
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
  // ★★★ Ô của Task 2 — và mốc đọc đi kèm nó.
  "headroom.effective.bytesAtReadMs",
  "headroom.effective.readAtMs",
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
describe("★★★ §2 — `effective` mang MỐC ĐỌC ⇒ hai lượt đọc KHÔNG BAO GIỜ bằng nhau", () => {
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
    /** Mọi vi phạm của lời khẳng định MẠNH (mọi phần tử × mọi bước nhích). */
    const viPham = (g: string): string[] =>
      (nhom.get(g) ?? []).flatMap((k) =>
        BUOC_NHICH.filter((b) => sau.get(b)!.get(k) !== goc.get(k)).map(
          (b) => `${k} @+${b}ms: ${goc.get(k)} → ${sau.get(b)!.get(k)}`,
        ),
      );
    return { goc, sau, nhom, doiThat, viPham };
  }

  it("★★★ cầu chì — ảnh chụp có đủ nhiều ô (0 ô ⇒ mọi khẳng định dưới là chân lý rỗng)", async () => {
    const { goc, nhom } = await doBonAnh();
    expect(goc.size, "lá thô").toBeGreaterThanOrEqual(120);
    expect(nhom.size, "đường đã gộp chỉ số").toBeGreaterThanOrEqual(80);
  });

  it("★★★ VÉT CẠN — mọi đường của ảnh chụp nằm ở ĐÚNG MỘT vế, và không vế nào có đường đã chết", async () => {
    const { nhom, doiThat } = await doBonAnh();
    const khai = new Set([...KHONG_DOI_THEO_DONG_HO, ...DOI_THEO_DONG_HO]);

    const chuaKhai = [...nhom.keys()].filter((d) => !khai.has(d));
    expect(
      chuaKhai.map((d) => `${doiThat(d) ? "DOI" : "KHONG_DOI"}  ${d}`).join("\n"),
      "ô của ảnh chụp CHƯA được phân loại ⇒ một đại lượng đang chảy có thể lọt vào một phép so trước/sau mà không ai thấy",
    ).toBe("");

    const daChet = [...khai].filter((d) => !nhom.has(d));
    expect(daChet.join("\n"), "bản khai giữ một đường KHÔNG CÒN trong payload ⇒ nó đang canh một thứ không tồn tại").toBe("");

    // ⚠ Hai vế phải RỜI NHAU: một đường ở cả hai bên là một bản khai tự mâu thuẫn.
    const caHai = KHONG_DOI_THEO_DONG_HO.filter((d) => DOI_THEO_DONG_HO.includes(d));
    expect(caHai.join(" · ")).toBe("");
  });

  it("★★★ KHÔNG-ĐỔI là lời khẳng định MẠNH — phải đúng với **MỌI** bước nhích và **MỌI** phần tử", async () => {
    const { viPham } = await doBonAnh();
    const pham = KHONG_DOI_THEO_DONG_HO.flatMap((d) => viPham(d));
    expect(pham.join("\n"), "ô khai KHÔNG-ĐỔI mà đổi khi CHỈ đồng hồ nhích ⇒ nó là một bẫy đo lường chưa bị gọi tên").toBe("");
  });

  it("★★★ ĐỔI là lời LOẠI TƯ CÁCH — MỘT bước nhích ở MỘT phần tử là đủ (và phải có ít nhất một)", async () => {
    const { doiThat } = await doBonAnh();
    const khongDoiNoi = DOI_THEO_DONG_HO.filter((d) => !doiThat(d));
    expect(
      khongDoiNoi.join("\n"),
      "ô khai ĐỔI-THEO-ĐỒNG-HỒ mà KHÔNG bước nhích nào làm nó đổi ⇒ bản khai đang loại oan một ô so được (BẮT NHẦM)",
    ).toBe("");
  });

  it("★★★ HOÁN VỊ — đổi chỗ hai đường giữa hai vế phải bị bắt (canh ÁNH XẠ, không canh TẬP)", async () => {
    const { doiThat } = await doBonAnh();
    /**
     * ⚠⚠ Bài học Pha 5: hai cổng "độc lập" cùng canh **TẬP** ⇒ hoán vị hai giá trị giữ nguyên tập
     * và cả hai đều xanh. Ca này chứng minh phép chấm ở trên là một **ÁNH XẠ**: lấy một đường của
     * mỗi vế, tráo chỗ, và khẳng định **cả hai** phép chấm đều nói sai.
     */
    const motKhongDoi = KHONG_DOI_THEO_DONG_HO.find((d) => !doiThat(d))!;
    const motDoi = DOI_THEO_DONG_HO.find((d) => doiThat(d))!;
    expect(motKhongDoi, "cần ít nhất một đường KHÔNG-ĐỔI có thật để ca này đo được gì").toBeDefined();
    expect(motDoi, "cần ít nhất một đường ĐỔI có thật để ca này đo được gì").toBeDefined();
    // Sau khi tráo: đường "KHÔNG-ĐỔI" (nay là `motDoi`) đổi thật ⇒ phép chấm MẠNH bắt được.
    expect(doiThat(motDoi)).toBe(true);
    // …và đường "ĐỔI" (nay là `motKhongDoi`) không đổi nổi ⇒ phép chấm LOẠI-TƯ-CÁCH bắt được.
    expect(doiThat(motKhongDoi)).toBe(false);
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

  it("★★★ MỌI đường payload trong `beforeAfterEvidence` phải TỒN TẠI và phải KHÔNG đổi với MỌI bước nhích", async () => {
    const { goc, sau, s } = await doBonAnh();

    /**
     * Rút những đường **payload** ra khỏi câu khai (phần `nvidia-smi` là bằng chứng NGOÀI payload).
     * ⚠ `[]` nghĩa **MỌI phần tử** — `ledger.localHolders[].owner` chấm `…[0].owner`, `…[1].owner`, …
     */
    const duong = s.headroom.effective.beforeAfterEvidence
      .split("+")
      .map((x) => x.trim())
      .filter((x) => /^[a-zA-Z]+(\[\])?(\.[a-zA-Z]+)+/.test(x))
      .map((x) => x.split(" ")[0]!);
    expect(duong.length, "câu khai không rút ra được đường payload nào ⇒ nó đang không chỉ tới đâu cả").toBeGreaterThanOrEqual(4);

    const sai: string[] = [];
    for (const d of duong) {
      // Đường có thể mang `[]` (mọi phần tử) hoặc là một NHÁNH ⇒ chấm mọi lá khớp.
      const khop = d.includes("[]")
        ? new RegExp(`^${d.replace(/\[\]/g, "\\[\\d+\\]").replace(/\./g, "\\.")}$`)
        : null;
      const laCon = [...goc.keys()].filter((k) =>
        khop !== null ? khop.test(k) : k === d || k.startsWith(`${d}[`) || k.startsWith(`${d}.`),
      );
      if (laCon.length === 0) {
        sai.push(`${d}: KHÔNG TỒN TẠI trong payload (con trỏ chết)`);
        continue;
      }
      for (const k of laCon) {
        for (const b of BUOC_NHICH) {
          if (sau.get(b)!.get(k) !== goc.get(k)) sai.push(`${k} @+${b}ms: ${goc.get(k)} → ${sau.get(b)!.get(k)}`);
        }
      }
    }
    expect(
      sai.join("\n"),
      "câu khai `beforeAfterEvidence` chỉ tới một ô ĐANG CHẢY ⇒ chính bản vá này lại dựng một cái bẫy mới",
    ).toBe("");
  });

  it("★★ câu khai phải nói rõ là một PHÉP HỘI, không phải một danh sách để chọn một món", async () => {
    dungCanh();
    const s = await chupTai(0);
    expect(s.headroom.effective.beforeAfterEvidence).toContain("CẢ BỐN NGUỒN CÙNG LÚC");
    // ⚠ Và nó phải nêu bằng chứng NGOÀI payload — sổ không nhìn thấy byte ngoài sổ (§5 của
    //   `vramReadModel`: `unattributed` LOẠI TRỪ toàn bộ nền thiết bị).
    expect(s.headroom.effective.beforeAfterEvidence).toContain("nvidia-smi");
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
