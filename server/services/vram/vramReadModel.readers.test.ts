/**
 * ★★★ Pha 7 Task 2 — **CHẶNG CUỐI: MỌI Ô TRÊN MẶT ĐỌC VRAM PHẢI CÓ NGƯỜI ĐỌC THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ KHUÔN CHUNG mà review TOÀN NHÁNH Pha 6 gọi tên (chỉ ghép cả nhánh mới thấy)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Task 1, 2 và 5 ĐỀU dừng lời khai ở **BIÊN PAYLOAD** và đều gọi đó là 'tới được người đọc'.
 * Chặng cuối — payload **RA MÀN HÌNH** — không task nào nhận."*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ I-1 (review Task 2) — **BẢN ĐẦU CỦA CHÍNH LƯỚI NÀY CANH MỘT PHÉP TRUY CẬP AST, KHÔNG CANH
 * GIÁ TRỊ RA TỚI CHUỖI.** Và đó là **cùng một lớp lỗi, dịch lên MỘT TẦNG.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đột biến của người review, **một dòng, biên dịch sạch**, hình dạng của một lỗi gõ nhầm rất thật:
 *
 * ```ts
 * -   owner: C(h.status.owner),
 * +   owner: h.status.owner === "" ? "" : "(khong ro)",
 * ```
 *
 * Phép **truy cập** `h.status.owner` vẫn còn ⇒ bộ quét AST vẫn ghi ô ấy là *"đã có người đọc"*.
 * **Giá trị thì không tới đâu cả.** Đo được: **113 file / 1941 ca XANH**, `tsc` sạch — trong khi
 * `defer.hosts[].status.owner`, ô mà chính báo cáo gọi là **nặng nhất**, **rơi khỏi mặt Agent ở cả
 * ba ngôn ngữ**. Luật cũ của Task 2 là *"CÓ MẶT TRONG PAYLOAD không tính"*; luật đúng phải nói thêm
 * ***"CÓ MẶT TRONG AST cũng không tính"***.
 *
 * ⇒ **§1 (luật chính) nay là một PHÉP ĐO VI PHÂN LÚC CHẠY**, đi **đúng đường thoát của Agent**:
 * `registry THẬT → handler THẬT → tomTat() → ghepCoTran() → textSummary`. Với **mỗi** ô lá: đổi
 * **đúng một ô**, chạy lại, đòi chuỗi **ĐỔI THEO**. Một phép chạm không in ra gì thì **không đổi
 * chuỗi**, nên nó **không thể** lừa được phép đo này. AST **không còn** là nguồn của luật chính.
 *
 * ⚠ **AST vẫn còn MỘT việc, và chỉ một:** mặt **NGƯỜI** không có harness render (repo có **0** file
 * `*.test.tsx`), nên *"màn hình đọc ô nào"* chỉ đọc được bằng AST. §2 dùng nó cho **đúng** câu hỏi
 * ấy và **không** dùng nó để phát biểu luật chính.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐỊNH NGHĨA CHẶT CỦA "NGƯỜI ĐỌC THẬT" (chính định nghĩa lỏng là cái đẻ ra khuôn trên)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • **AGENT** — ô ấy **ĐIỀU KHIỂN NỘI DUNG `textSummary`** (đo vi phân, §1); **hoặc**
 *   • **NGƯỜI** — ô ấy bị đọc trong mã render của một màn thật, kể cả qua `translateVram*` (§2).
 * ⚠⚠ Agent **chỉ nhận `textSummary`** — đo hai lần độc lập: `aiLocalKnowledgeService.ts:2070` /
 *   `:2351` (đường stream) / `:2396`. Một ô chỉ nằm ở `data.state` thì Agent **KHÔNG BAO GIỜ** thấy.
 *
 * ⚠ **PHẠM VI, KHÔNG HỨA QUÁ:** §1 chứng minh *"giá trị của ô ĐI VÀO chuỗi được nhồi vào ngữ cảnh
 * LLM"*. Chặng **LLM đọc** chuỗi ấy, và chặng **pixel lên màn** của mặt NGƯỜI, nằm ngoài tầm mọi
 * lưới hôm nay — ô **còn mở**, không phải ô được coi là đã đóng.
 */
import { describe, it, expect, vi } from "vitest";
import ts from "typescript";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { vramStateLeafInfo } from "./vramStateFieldPaths";
import type { VramAgentState } from "./vramReadModel";
import { VRAM_BEFORE_AFTER_EVIDENCE, VRAM_EFFECTIVE_VARIES_WITH } from "./vramReadModel";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/services/vram
const GOC = join(TEST_DIR, "..", "..", ".."); // gốc repo

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HARNESS ĐƯỜNG THOÁT THẬT — tiêm ẢNH CHỤP, giữ nguyên MỌI chặng còn lại
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Mock **CHỈ** `buildVramAgentState` (giữ phần còn lại của module bằng `importOriginal`) — đây là
 * điểm tiêm **duy nhất**. `tomTat()`/`ghepCoTran()`/bảng câu/registry đều là **BẢN THẬT**; nếu mock
 * sâu hơn thì lưới lại đo chính nó, đúng lỗi mà cả file này tồn tại để diệt.
 */
const HOI = vi.hoisted(() => ({ anhChup: null as unknown }));
vi.mock("./vramReadModel", async (importOriginal) => {
  const goc = await importOriginal<typeof import("./vramReadModel")>();
  return { ...goc, buildVramAgentState: async () => HOI.anhChup };
});
vi.mock("../../_core/accessControl", () => ({ checkPermission: async () => true }));

import { getVramState } from "../aiLocalTools/vramTools";

type Lang = "vi" | "en" | "zh";

async function tomTatCua(anhChup: unknown, lang: Lang): Promise<string> {
  HOI.anhChup = anhChup;
  // ⚠ `Tool.handler` là ô TUỲ CHỌN trong kiểu registry ⇒ khai thẳng thay vì `!`: một tool mất
  //   handler là một lưới **im lặng không đo gì**, không phải một lượt ép kiểu cho qua.
  const chay = getVramState.handler;
  if (chay === undefined) throw new Error("harness hỏng: `get_vram_state` KHÔNG có handler");
  const r = await chay({ lang, __authCtx: { userId: 7, role: "admin" } });
  if (r.note === "PERMISSION_DENIED") throw new Error("harness hỏng: bị từ chối quyền");
  return r.textSummary;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CẢNH DỰNG — hai cảnh, vét cạn MỌI nhánh hợp kiểu của `VramAgentState`
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Cảnh không phải nguồn của **lượng từ** (lượng từ suy từ KIỂU — `vramStateLeafPaths()`); nó chỉ
 * là chỗ **hiện thực hoá** ô để đo được. Ô nào kiểu có mà **không cảnh nào dựng nổi** ⇒ ca §1 ĐỎ,
 * đúng như một ô không người đọc — vì một ô không dựng nổi thì cũng **không chứng minh được** nó
 * tới người đọc.
 */
function canhDay(soHoAnhEm = 2): VramAgentState {
  const hoAnhEm = Array.from({ length: soHoAnhEm }, (_, i) => ({
    owner: `gguf:sibling-${i}`,
    kind: "gguf-model",
    bytes: 17_000 * 1024 * 1024,
    priority: "background" as const,
    measured: true,
    reclaim:
      i === 0
        ? ({ kind: "no-reclaimer", why: "owner-not-in-local-ledger" } as const)
        : ({ kind: "declared-by-owner-process", reclaimer: "gguf-idle-model" } as const),
    processKey: `worker:${900 + i}:1`,
    /**
     * ⚠⚠ **HAI Ô NÀY KHÔNG PHẢI MỘT LƯỢT "DỰNG CHO XANH".** Sổ chung hôm nay **không mang TTL**
     * (`vramReadModel` gán `null` cứng cho hàng anh em), nhưng `VramAgentHolderView` là **MỘT**
     * kiểu dùng chung cho hộ cục bộ **và** hộ anh em, và bộ liệt kê tách chúng thành hai đường.
     * Luật ở đây nói về **NGƯỜI ĐỌC**, không về **người GHI** ⇒ cảnh phải dựng được **hình dạng**
     * mà kiểu cho phép, nếu không ta đang đo *"producer hôm nay ghi gì"* thay vì *"reader có đọc
     * không"*. Một hàng anh em có TTL ⇒ `vramTools` in `ttlMs` + `ttlExpired` qua khoá `ttl`.
     * ⚠ Ô `ttlMs` **chỉ** được in khi `ttlExpired !== null` — nên để `null` cả hai là đo hụt.
     */
    ttlMs: i === 1 ? 45_000 : null,
    ttlExpired: i === 1 ? true : null,
    leaseKey: `worker:${900 + i}:1#lease-${i}`,
  }));
  return {
    atMs: 1_700_000_000_123,
    processKey: "api:111:9",
    nonFiniteFields: [{ path: "headroom.rawBytes", was: "-Infinity" }],
    ledger: {
      localBytes: 7_471_882_240,
      localHolders: [
        {
          owner: "gguf:local-idle",
          kind: "gguf-model",
          bytes: 1_048_576,
          priority: "background",
          measured: true,
          reclaim: { kind: "reclaimable-here", reclaimer: "gguf-idle-model" },
          processKey: null,
          ttlMs: 60_000,
          ttlExpired: false,
          leaseKey: null,
        },
        {
          owner: "onnx:aoi-seg",
          kind: "onnx-session",
          bytes: 2_097_152,
          priority: "production",
          measured: false,
          reclaim: { kind: "no-reclaimer", why: "production-never-preempted" },
          processKey: null,
          ttlMs: null,
          ttlExpired: null,
          leaseKey: null,
        },
      ],
      foreign: {
        known: true,
        bytes: 1_572_864_000,
        holders: hoAnhEm,
        ageMs: 59,
        stale: false,
        unsyncedWrites: 0,
        consecutiveFailures: 0,
        truncatedIdentityWrites: 3,
      },
      totalBytes: 9_044_746_240,
      sharedRefreshIntervalMs: 60_123,
      sharedStaleAfterMs: 90_456,
    },
    headroom: {
      rawBytes: 23_679_991_808,
      effective: {
        bytesAtReadMs: 22_000_000_000,
        readMark: "api:111:9#7",
        readAtMs: 1_700_000_000_123,
        notAnInvariant: true,
        variesWith: VRAM_EFFECTIVE_VARIES_WITH,
        beforeAfterEvidence: VRAM_BEFORE_AFTER_EVIDENCE,
      },
      basis: "attributable",
      blind: false,
      trusted: true,
      degradedReasons: ["stale-tick"],
      usedBytes: 8_000_000_000,
      ceilingBytes: 34_182_889_472,
      safetyReserveBytes: 13_631_488,
      charges: {
        staleMarginBytes: 3_145_728,
        sharedLedgerMarginBytes: 5_242_880,
        unledgeredChargeBytes: 7_340_032,
        distrustChargeBytes: 11_534_336,
      },
    },
    attributable: { known: true, bytes: 8_205_107_200 },
    tick: { present: true, ageMs: 12, staleAfterMs: 120_000, stale: false, consecutiveFailures: 0 },
    baseline: { verified: true, unverifiedReasons: ["chua-chup-nen"], origin: "captured" },
    unattributed: {
      bytes: 1_048_576,
      excludesBaselineBytes: true,
      caveat: "vramUnattributedUnreliable",
      holderListIsLowerBound: true,
      wiredSiteCount: 15,
      knownSiteRowCount: 159,
    },
    unledgered: {
      estimateBytes: 8_388_608,
      estimateKind: "estimate",
      unknownCount: 0,
      estimateUsable: true,
      beginFailureCount: 2,
      lastReason: { text: "khong cap phat duoc", truncated: true, rawLength: 4242 },
    },
    defer: {
      scope: "this-process-only",
      observedFromProcessKey: "api:111:9",
      durableTrace: "vram_events(defer|defer_exceeded)",
      hosts: [
        {
          host: "cron:kb-sync",
          ownerPattern: { patternText: "cron:kb-sync" },
          budgetMs: 900_000,
          mechanism: "waits-and-retries",
          hostedHere: true,
          status: {
            kind: "deferring",
            owner: "cron:kb-sync",
            attempts: 3,
            firstRefusedAt: "2026-03-03T03:03:03.003Z",
            nextRetryAt: "2026-03-03T04:00:00.000Z",
            lastRefusalMessage: { text: "khong du vram", truncated: true, rawLength: 4242 },
            chainBudgetMs: 777_123,
          },
          retryReach: { kind: "reachable-here", owner: "cron:kb-sync" },
        },
        {
          host: "cron:kb-eval-gate",
          ownerPattern: { patternText: "cron:kb-eval-gate" },
          budgetMs: 0,
          mechanism: "no-wait-degrades-in-place",
          hostedHere: false,
          status: {
            kind: "exceeded",
            owner: "cron:kb-eval-gate",
            attempts: 9,
            firstRefusedAt: "2026-03-03T01:01:01.001Z",
            lastRefusalMessage: null,
            chainBudgetMs: 0,
          },
          retryReach: { kind: "unreachable", why: "no-retry-mechanism-for-this-host" },
        },
        {
          host: "sidecar:local-trainer",
          ownerPattern: { patternText: "sidecar:local-trainer" },
          budgetMs: 21_600_000,
          mechanism: "waits-and-retries",
          hostedHere: null,
          status: { kind: "not-observable-here", meaning: "host-not-running-in-this-process" },
          retryReach: { kind: "unknown", why: "defer-state-unreadable" },
        },
        {
          host: "reranker",
          ownerPattern: { patternText: "cuda-backend:reranker | reranker:<modelPath>" },
          budgetMs: 0,
          mechanism: "no-wait-degrades-in-place",
          hostedHere: true,
          status: { kind: "no-chain-in-this-process" },
          retryReach: { kind: "unreachable", why: "host-not-running-in-this-process" },
        },
      ],
    },
  };
}

/** Cảnh **MÙ** — mọi nhánh `known:false` / `present:false` / `lastReason:null` mà cảnh đầy không dựng. */
function canhMu(): VramAgentState {
  const s = canhDay(0) as unknown as Record<string, unknown>;
  const ledger = { ...(s.ledger as Record<string, unknown>) };
  ledger.foreign = { known: false, meaning: "never-refreshed-blind-to-siblings" };
  s.ledger = ledger;
  s.attributable = { known: false, meaning: "headroom-upper-bound", reason: "no-tick" };
  s.tick = { present: false, meaning: "no-tick-blind" };
  s.baseline = { verified: false, unverifiedReasons: null, origin: null };
  s.nonFiniteFields = [];
  const un = { ...(s.unledgered as Record<string, unknown>) };
  un.lastReason = null;
  un.estimateUsable = false;
  s.unledgered = un;
  return s as unknown as VramAgentState;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LIỆT KÊ LÁ LÚC CHẠY — **CÙNG QUY ƯỚC** với `vramStateFieldPaths` (mảng nguyên thuỷ = MỘT lá)
// ══════════════════════════════════════════════════════════════════════════════════════════════
function laCu(v: unknown, duong: string, ra: string[]): void {
  if (Array.isArray(v)) {
    if (v.length === 0 || v.some((x) => x === null || typeof x !== "object")) {
      ra.push(duong);
      return;
    }
    v.forEach((x, i) => laCu(x, `${duong}[${i}]`, ra));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) laCu(x, duong === "" ? k : `${duong}.${k}`, ra);
    return;
  }
  ra.push(duong);
}
function laCua(s: unknown): string[] {
  const ra: string[] = [];
  laCu(s, "", ra);
  return ra;
}
const gopChiSo = (d: string): string => d.replace(/\[\d+\]/g, "[]");

function docTai(goc: unknown, duong: string): unknown {
  let cur: unknown = goc;
  for (const doan of duong.split(".")) {
    const m = /^(.*?)((\[\d+\])*)$/.exec(doan)!;
    if (m[1] !== "") cur = (cur as Record<string, unknown>)[m[1]];
    for (const idx of m[2].match(/\d+/g) ?? []) cur = (cur as unknown[])[Number(idx)];
  }
  return cur;
}
function ghiTai(goc: unknown, duong: string, gt: unknown): void {
  const doan = duong.split(".");
  let cur: unknown = goc;
  for (let i = 0; i < doan.length; i++) {
    const m = /^(.*?)((\[\d+\])*)$/.exec(doan[i]!)!;
    const chiSo = (m[2].match(/\d+/g) ?? []).map(Number);
    const cuoi = i === doan.length - 1;
    if (cuoi && chiSo.length === 0) {
      (cur as Record<string, unknown>)[m[1]!] = gt;
      return;
    }
    if (m[1] !== "") cur = (cur as Record<string, unknown>)[m[1]!];
    for (let j = 0; j < chiSo.length; j++) {
      if (cuoi && j === chiSo.length - 1) {
        (cur as unknown[])[chiSo[j]!] = gt;
        return;
      }
      cur = (cur as unknown[])[chiSo[j]!];
    }
  }
}

/**
 * ★★★ **PROBE — nhiều hình dạng, và đó là chủ ý.** Một ô `null` chỉ làm chuỗi đổi khi ta đặt vào
 * **đúng hình dạng người đọc mong đợi** (số cho một ô byte · đối tượng `{text,truncated,rawLength}`
 * cho một ô HIỂN THỊ). Đòi *một* probe cố định là đòi lưới đoán trước kiểu của mọi ô — đúng lối
 * "liệt kê" mà cả nhánh này đang gỡ. ⇒ **∃ probe làm chuỗi đổi** là đủ, và là điều kiện đúng.
 */
function probes(goc: unknown, hang: ReadonlySet<string> | undefined): unknown[] {
  const ra: unknown[] = [];
  // ★ HẰNG CỦA CHÍNH KIỂU trước tiên — thứ duy nhất lật được một ô dùng làm VỊ TỪ.
  for (const h of hang ?? []) if (h !== goc) ra.push(h);
  if (typeof goc === "string") ra.push(`${goc}~M~`);
  else if (typeof goc === "number") ra.push(goc + 98_765);
  else if (typeof goc === "boolean") ra.push(!goc);
  else if (Array.isArray(goc)) ra.push([...goc, "~M~"]);
  ra.push(1_234_567, "~M~", { text: "~M~", truncated: true, rawLength: 4242 });
  return ra;
}

interface KetQuaDo {
  /** Đường (đã gộp chỉ số) mà một probe làm `textSummary` ĐỔI. */
  readonly anhHuong: Set<string>;
  /** Đường có mặt trong cảnh nhưng **không probe nào** làm chuỗi đổi. */
  readonly khongDoi: string[];
  /** Đường mà bằng chứng DUY NHẤT là một lượt NÉM (đổi luồng mạnh tới mức hỏng). */
  readonly chiNem: string[];
}

/** Đo VI PHÂN trên toàn bộ lá của MỘT cảnh, ở MỘT ngôn ngữ. */
async function doViPhan(canh: VramAgentState, lang: Lang, chiCacDuong?: ReadonlySet<string>): Promise<KetQuaDo> {
  const nen = await tomTatCua(canh, lang);
  const anhHuong = new Set<string>();
  const khongDoi: string[] = [];
  const chiNem: string[] = [];
  /**
   * ⚠⚠ **NHÓM THEO ĐƯỜNG ĐÃ GỘP, RỒI THỬ MỌI PHẦN TỬ.** Bản đầu chỉ thử phần tử **ĐẦU TIÊN** và
   * khai oan `ledger.foreign.holders[].ttlMs` là *"không ai đọc"* — trong khi hộ thứ hai của cảnh
   * có TTL và **được in**. Một ô chỉ cần **MỘT** chỗ ngồi chứng minh được là nó tới người đọc.
   */
  const nhom = new Map<string, string[]>();
  for (const la of laCua(canh)) {
    const g = gopChiSo(la);
    if (chiCacDuong !== undefined && !chiCacDuong.has(g)) continue;
    nhom.set(g, [...(nhom.get(g) ?? []), la]);
  }
  for (const [gop, cacLa] of nhom) {
    let doi = false;
    let doiKhongNem = false;
    for (const la of cacLa) {
      const cu = docTai(canh, la);
      for (const p of probes(cu, HANG.get(gop))) {
        const ban = structuredClone(canh) as VramAgentState;
        ghiTai(ban, la, p);
        let ra: string;
        try {
          ra = await tomTatCua(ban, lang);
        } catch {
          doi = true; // đổi luồng tới mức hỏng ⇒ chắc chắn ô ấy ĐƯỢC TIÊU THỤ
          continue;
        }
        if (ra !== nen) {
          doi = true;
          doiKhongNem = true;
          break;
        }
      }
      if (doiKhongNem) break;
    }
    if (!doi) khongDoi.push(gop);
    else {
      anhHuong.add(gop);
      if (!doiKhongNem) chiNem.push(gop);
    }
  }
  return { anhHuong, khongDoi, chiNem };
}

const HANG = vramStateLeafInfo();
const O = [...HANG.keys()].sort();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — LUẬT CHÍNH: ∀ ô ⇒ ô ấy ĐIỀU KHIỂN NỘI DUNG `textSummary` (đo VI PHÂN, không phải AST)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §1 — MỌI ô của mặt đọc VRAM phải ĐIỀU KHIỂN `textSummary` (hoặc bị XOÁ)", () => {
  it("★★★ 0 ô có-người-ghi-mà-không-ai-đọc — đo VI PHÂN trên đường thoát THẬT", async () => {
    const a = await doViPhan(canhDay(), "vi");
    const b = await doViPhan(canhMu(), "vi");
    const phu = new Set([...a.anhHuong, ...b.anhHuong]);

    // ⚠ CẦU CHÌ: phép đo phải thật sự chạy — 0 đường ảnh hưởng nghĩa là harness hỏng, KHÔNG phải "đạt".
    expect(phu.size, "0 đường ảnh hưởng ⇒ harness hỏng, mọi khẳng định dưới là chân lý rỗng").toBeGreaterThanOrEqual(90);
    expect(O.length, "bộ liệt kê ô TỪ KIỂU không rút được gì").toBeGreaterThanOrEqual(90);

    const khong = O.filter((o) => !phu.has(o));
    expect(
      khong.map((o) => `  ✗ ${o}`).join("\n"),
      "Những ô này đi trên dây MỖI LƯỢT `vram.state` mà GIÁ TRỊ của chúng KHÔNG tới `textSummary`.\n" +
        "⚠ Một phép TRUY CẬP không phải một người đọc: `owner: h.status.owner === \"\" ? \"\" : \"(khong ro)\"`\n" +
        "  giữ nguyên phép truy cập AST và vẫn làm ô ấy rơi khỏi mặt Agent (I-1 của review).\n" +
        "Luật (Task 4 Pha 4): **NGƯỜI ĐỌC THẬT hoặc BỊ XOÁ** — không có lựa chọn thứ ba.\n" +
        "⇒ Cho ô một điểm in THẬT ở `vramTools.tomTat()`, hoặc XOÁ ô khỏi `VramAgentState`.\n" +
        "⚠ Ô nào KHÔNG cảnh nào dựng nổi cũng đứng ở đây — một ô không dựng nổi thì cũng không\n" +
        "  chứng minh được là nó tới người đọc; hãy mở rộng `canhDay()`/`canhMu()`.",
    ).toBe("");
  });

  it("★★★ ĐỐI CHỨNG NGƯỢC — có ô mà phép đo nói KHÔNG (nếu mọi probe đều 'đổi' thì phép đo vô nghĩa)", async () => {
    /**
     * ⚠⚠ Không có ca này thì một phép đo **luôn trả true** (vd `textSummary` chứa một mốc thời gian
     * đổi mỗi lượt) sẽ khai 108/108 mà **không đo gì cả**. Ta thêm một ô **KHÔNG THUỘC** mặt đọc
     * vào ảnh chụp: nó phải **KHÔNG** làm chuỗi đổi.
     */
    const canh = canhDay() as unknown as Record<string, unknown>;
    canh.oKhongThuocMatDoc = "ban dau";
    const nen = await tomTatCua(canh, "vi");
    const khac = structuredClone(canh);
    khac.oKhongThuocMatDoc = "da doi";
    expect(await tomTatCua(khac, "vi"), "một ô KHÔNG được đọc mà làm chuỗi đổi ⇒ phép đo đang nhiễu").toBe(nen);
  });

  it("★★ bằng chứng KHÔNG được dựa vào một lượt NÉM (đổi luồng tới mức hỏng)", async () => {
    const a = await doViPhan(canhDay(), "vi");
    const b = await doViPhan(canhMu(), "vi");
    const nem = [...new Set([...a.chiNem, ...b.chiNem])].filter((d) => !a.anhHuong.has(d) || !b.anhHuong.has(d));
    // Ghi nhận, không cấm: một ô chỉ chứng minh được bằng lượt ném vẫn là ô ĐƯỢC TIÊU THỤ, nhưng
    // bằng chứng ấy yếu hơn ⇒ phải nhìn thấy được, không được im lặng.
    expect(nem.length, `ô chỉ chứng minh được bằng NÉM:\n${nem.join("\n")}`).toBeLessThanOrEqual(4);
  });

  it("★★★ luật đúng ở CẢ BA ngôn ngữ — không phải một sự thật của riêng `vi`", async () => {
    for (const lang of ["en", "zh"] as const) {
      const a = await doViPhan(canhDay(), lang);
      const b = await doViPhan(canhMu(), lang);
      const phu = new Set([...a.anhHuong, ...b.anhHuong]);
      const khong = O.filter((o) => !phu.has(o));
      expect(khong.join("\n"), `lang=${lang}: ô không tới được bản tóm tắt`).toBe("");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — MẶT NGƯỜI (AST): repo có **0** file `*.test.tsx` ⇒ đây là nguồn DUY NHẤT đọc được
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Đoạn cuối là **TÊN PHƯƠNG THỨC**, không phải một nút dữ liệu (`x.map` ⇒ nút là `x`). */
const PHUONG_THUC =
  /^(map|filter|join|length|some|every|slice|includes|find|sort|flatMap|toFixed|toLocaleString|forEach|at|reduce|concat|indexOf|entries|keys|values)$/;

const CACHE = new Map<string, ts.SourceFile>();
function ast(rel: string): ts.SourceFile {
  const co = CACHE.get(rel);
  if (co !== undefined) return co;
  const f = join(GOC, rel);
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  CACHE.set(rel, sf);
  return sf;
}
function moiNut(sf: ts.SourceFile): ts.Node[] {
  const ra: ts.Node[] = [];
  const di = (n: ts.Node): void => {
    ra.push(n);
    n.forEachChild(di);
  };
  sf.forEachChild(di);
  return ra;
}
function chuoi(n: ts.Node): { goc: ts.Node; doan: string[] } {
  const doan: string[] = [];
  let cur: ts.Node = n;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      doan.unshift(cur.name.text);
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression;
    } else break;
  }
  return { goc: cur, doan };
}
function giaiModule(tuFile: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith("@/")) p = join("client", "src", spec.slice(2));
  else if (spec.startsWith("@shared/")) p = join("shared", spec.slice(8));
  else if (spec.startsWith(".")) p = resolve(dirname(join(GOC, tuFile)), spec).slice(GOC.length + 1);
  else return null;
  const chuanHoa = p.split(sep).join("/");
  for (const duoi of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(join(GOC, chuanHoa + duoi))) return chuanHoa + duoi;
  }
  return null;
}

/**
 * ★★★ **M-6 của review — `MAT_NGUOI` THÔI LÀ MỘT DANH SÁCH.**
 * Bản trước ghi tay hai đường; cầu chì chỉ canh chiều **MẤT**, không canh chiều **THÊM** ⇒ một màn
 * thứ ba đọc `vram.state` sẽ **im lặng** rơi khỏi luật — *"cái gì LIỆT KÊ thì luôn có phần tử thứ
 * N+1"*, ngay trong lưới dựng ra để chống nó. Nay tập được **QUÉT** ra khỏi `client/src/**`.
 */
function moiFileClient(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const item of readdirSync(goc)) {
    const p = join(goc, item);
    if (statSync(p).isDirectory()) {
      if (item === "node_modules" || item === "dist") continue;
      moiFileClient(p, ra);
    } else if (/\.tsx?$/.test(item) && !/\.test\.tsx?$/.test(item)) {
      ra.push(p.slice(GOC.length + 1).split(sep).join("/"));
    }
  }
  return ra;
}
function matNguoiSuyRa(): string[] {
  return moiFileClient(join(GOC, "client", "src"))
    .filter((f) => /trpc\.vram\.state\.useQuery/.test(readFileSync(join(GOC, f), "utf8")))
    .sort();
}
const MAT_NGUOI = matNguoiSuyRa();

interface Rang {
  readonly file: string;
  readonly ten: string;
  readonly duong: string;
  readonly tu: number;
  readonly den: number;
}
interface HatGiong {
  readonly file: string;
  readonly ten: string;
  readonly nut: ts.Node;
  readonly sf: ts.SourceFile;
}

/**
 * Bộ quét **CÓ PHẠM VI** (`tu`/`den`): cùng chữ `h` là hộ giữ chỗ ở vòng này và hộ nền ở vòng kia;
 * một bảng alias không phạm vi trộn chúng lại và **khai khống ~20 ô**. Đo được lúc dựng lưới.
 */
function quetNguoiDoc(hatGiong: readonly HatGiong[]): Set<string> {
  const rang: Rang[] = [];
  const daCo = new Set<string>();
  const themRang = (file: string, ten: string, duong: string, pv: ts.Node, sf: ts.SourceFile): boolean => {
    const tu = pv.getStart(sf);
    const den = pv.getEnd();
    const k = `${file}#${ten}#${duong}#${tu}`;
    if (daCo.has(k)) return false;
    daCo.add(k);
    rang.push({ file, ten, duong, tu, den });
    return true;
  };
  for (const h of hatGiong) themRang(h.file, h.ten, "", h.nut, h.sf);

  const co = (file: string, ten: string, viTri: number): Set<string> => {
    const ung = rang.filter((b) => b.file === file && b.ten === ten && viTri >= b.tu && viTri <= b.den);
    if (ung.length === 0) return new Set();
    const trong = Math.max(...ung.map((b) => b.tu));
    return new Set(ung.filter((b) => b.tu === trong).map((b) => b.duong));
  };

  interface Mod {
    readonly sf: ts.SourceFile;
    readonly nut: ts.Node[];
    readonly ham: Map<string, { params: ts.NodeArray<ts.ParameterDeclaration>; than: ts.Node; sf: ts.SourceFile }>;
    readonly nhap: Map<string, { file: string; ten: string }>;
  }
  const MOD = new Map<string, Mod>();
  function nap(file: string): Mod {
    const co2 = MOD.get(file);
    if (co2 !== undefined) return co2;
    const sf = ast(file);
    const nut = moiNut(sf);
    const ham = new Map<string, { params: ts.NodeArray<ts.ParameterDeclaration>; than: ts.Node; sf: ts.SourceFile }>();
    const nhap = new Map<string, { file: string; ten: string }>();
    for (const n of nut) {
      if (ts.isFunctionDeclaration(n) && n.name !== undefined) ham.set(n.name.text, { params: n.parameters, than: n, sf });
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer !== undefined &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) {
        ham.set(n.name.text, { params: n.initializer.parameters, than: n.initializer, sf });
      }
      if (
        ts.isImportDeclaration(n) &&
        n.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(n.importClause.namedBindings) &&
        ts.isStringLiteral(n.moduleSpecifier)
      ) {
        const dich = giaiModule(file, n.moduleSpecifier.text);
        if (dich !== null) {
          for (const el of n.importClause.namedBindings.elements) {
            nhap.set(el.name.text, { file: dich, ten: (el.propertyName ?? el.name).text });
          }
        }
      }
    }
    const m: Mod = { sf, nut, ham, nhap };
    MOD.set(file, m);
    return m;
  }

  function giai(file: string, sf: ts.SourceFile, e: ts.Node | undefined, viTri: number): Set<string> {
    const ra = new Set<string>();
    if (e === undefined) return ra;
    if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) {
      return giai(file, sf, e.expression, viTri);
    }
    if (ts.isConditionalExpression(e)) {
      for (const x of giai(file, sf, e.whenTrue, viTri)) ra.add(x);
      for (const x of giai(file, sf, e.whenFalse, viTri)) ra.add(x);
      return ra;
    }
    if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      for (const x of giai(file, sf, e.left, viTri)) ra.add(x);
      for (const x of giai(file, sf, e.right, viTri)) ra.add(x);
      return ra;
    }
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) if (ts.isSpreadElement(el)) for (const x of giai(file, sf, el.expression, viTri)) ra.add(x);
      return ra;
    }
    if (ts.isIdentifier(e)) return co(file, e.text, viTri);
    if (ts.isPropertyAccessExpression(e)) {
      const { goc, doan } = chuoi(e);
      const nen = ts.isIdentifier(goc) ? co(file, goc.text, viTri) : giai(file, sf, goc, viTri);
      for (const b of nen) ra.add([b, ...doan].filter((x) => x !== "").join("."));
      return ra;
    }
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      /^(map|filter|slice|concat|sort)$/.test(e.expression.name.text)
    ) {
      return giai(file, sf, e.expression.expression, viTri);
    }
    return ra;
  }

  for (const h of hatGiong) nap(h.file);

  for (let vong = 0; vong < 8; vong++) {
    let doi = false;
    for (const file of [...MOD.keys()]) {
      const m = MOD.get(file)!;
      for (const n of m.nut) {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
          let pv: ts.Node | undefined = n.parent;
          while (pv !== undefined && !ts.isBlock(pv) && !ts.isSourceFile(pv)) pv = pv.parent;
          for (const d of giai(file, m.sf, n.initializer, n.getStart(m.sf))) {
            if (themRang(file, n.name.text, d, pv ?? m.sf, m.sf)) doi = true;
          }
        }
        if (ts.isForOfStatement(n)) {
          const decl = n.initializer;
          if (
            ts.isVariableDeclarationList(decl) &&
            decl.declarations[0] !== undefined &&
            ts.isIdentifier(decl.declarations[0].name)
          ) {
            const ten = decl.declarations[0].name.text;
            for (const d of giai(file, m.sf, n.expression, n.getStart(m.sf))) {
              if (themRang(file, ten, `${d}[]`, n, m.sf)) doi = true;
            }
          }
        }
        if (!ts.isCallExpression(n)) continue;
        if (
          ts.isPropertyAccessExpression(n.expression) &&
          /^(map|forEach|filter|find|some|every|flatMap)$/.test(n.expression.name.text)
        ) {
          const nguon = giai(file, m.sf, n.expression.expression, n.getStart(m.sf));
          const cb = n.arguments[0];
          if (
            cb !== undefined &&
            (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
            cb.parameters[0] !== undefined &&
            ts.isIdentifier(cb.parameters[0].name)
          ) {
            const ten = cb.parameters[0].name.text;
            for (const d of nguon) if (themRang(file, ten, `${d}[]`, cb, m.sf)) doi = true;
          }
        }
        if (ts.isIdentifier(n.expression)) {
          const ten = n.expression.text;
          let dich = m.ham.get(ten);
          let fileDich = file;
          const nh = m.nhap.get(ten);
          if (dich === undefined && nh !== undefined) {
            dich = nap(nh.file).ham.get(nh.ten);
            fileDich = nh.file;
          }
          if (dich === undefined) continue;
          n.arguments.forEach((arg, i) => {
            const p = dich!.params[i];
            if (p === undefined || !ts.isIdentifier(p.name)) return;
            for (const d of giai(file, m.sf, arg, n.getStart(m.sf))) {
              if (themRang(fileDich, p.name.text, d, dich!.than, dich!.sf)) doi = true;
            }
          });
        }
      }
    }
    if (!doi) break;
  }

  const doc = new Set<string>();
  for (const file of MOD.keys()) {
    const m = MOD.get(file)!;
    for (const n of m.nut) {
      if (!ts.isPropertyAccessExpression(n)) continue;
      if (ts.isPropertyAccessExpression(n.parent)) continue;
      const { goc, doan } = chuoi(n);
      if (!ts.isIdentifier(goc)) continue;
      for (const b of co(file, goc.text, n.getStart(m.sf))) {
        const cuoi = doan[doan.length - 1];
        const dd = cuoi !== undefined && PHUONG_THUC.test(cuoi) ? doan.slice(0, -1) : doan;
        for (let i = 1; i <= dd.length; i++) {
          const d = [b, ...dd.slice(0, i)].filter((x) => x !== "").join(".");
          if (d !== "") doc.add(d);
        }
      }
    }
  }
  return doc;
}

function hatNguoi(): HatGiong[] {
  const ra: HatGiong[] = [];
  for (const file of MAT_NGUOI) {
    const sf = ast(file);
    const nut = moiNut(sf);
    const bienQuery = new Set<string>();
    for (const n of nut) {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer !== undefined &&
        ts.isCallExpression(n.initializer) &&
        /trpc\.vram\.state\.useQuery/.test(n.initializer.expression.getText(sf))
      ) {
        bienQuery.add(n.name.text);
      }
    }
    for (const n of nut) {
      if (!ts.isVariableDeclaration(n) || n.initializer === undefined || !ts.isIdentifier(n.name)) continue;
      const kt = n.initializer;
      if (!ts.isPropertyAccessExpression(kt) || kt.name.text !== "data") continue;
      if (!ts.isIdentifier(kt.expression) || !bienQuery.has(kt.expression.text)) continue;
      let pv: ts.Node | undefined = n.parent;
      while (pv !== undefined && !ts.isBlock(pv) && !ts.isSourceFile(pv)) pv = pv.parent;
      ra.push({ file, ten: n.name.text, nut: pv ?? sf, sf });
    }
  }
  return ra;
}

describe("★★ §2 — mặt NGƯỜI (AST là nguồn DUY NHẤT: repo có 0 file `*.test.tsx`)", () => {
  it("★★★ tập màn NGƯỜI được SUY RA khỏi `client/src/**`, không viết tay (M-6)", () => {
    expect(MAT_NGUOI.length, "0 màn nào gọi `trpc.vram.state.useQuery` ⇒ bộ quét hỏng").toBeGreaterThanOrEqual(2);
    for (const f of MAT_NGUOI) expect(existsSync(join(GOC, f)), `KHÔNG có trên đĩa: ${f}`).toBe(true);
    // Một màn THỨ BA đọc `vram.state` tự vào lượng từ — không ai phải nhớ cập nhật một danh sách.
    expect(hatNguoi().length, "quét ra màn nhưng KHÔNG thấy biến payload nào ⇒ mặt NGƯỜI đang không được đo").toBe(
      MAT_NGUOI.length,
    );
  });

  it("★★★ MỌI ô mà MÀN HÌNH đọc cũng phải ĐIỀU KHIỂN `textSummary` (Agent là mặt KHÔNG AI NHÌN)", async () => {
    /**
     * ⚠ Vì sao là một luật: mặt NGƯỜI có người **ngồi trước màn** và sẽ kêu khi thiếu; mặt AGENT
     * thì **không ai kêu** — một ô rơi khỏi `textSummary` hỏng theo chiều **IM LẶNG**.
     */
    const nguoi = quetNguoiDoc(hatNguoi());
    const laO = new Set(O);
    const oNguoi = [...nguoi].filter((d) => laO.has(d));
    expect(oNguoi.length, "0 ô nào của mặt NGƯỜI khớp một lá ⇒ bộ quét AST đang mù").toBeGreaterThanOrEqual(20);

    const a = await doViPhan(canhDay(), "vi");
    const b = await doViPhan(canhMu(), "vi");
    const agent = new Set([...a.anhHuong, ...b.anhHuong]);
    const thieu = oNguoi.filter((d) => !agent.has(d)).sort();
    expect(
      thieu.join("\n"),
      "ô hiện trên màn NGƯỜI mà KHÔNG điều khiển `textSummary` ⇒ Agent quyết định mà thiếu đúng ô người đang nhìn",
    ).toBe("");
  });

  it("★★ MỌI đường bộ quét AST phát ra phải khớp một ô CÓ THẬT (bộ quét lệch tên 'phủ' 0 ô mà vẫn xanh)", () => {
    const nut = new Set<string>();
    for (const o of O) {
      const doan = o.split(".");
      for (let i = 1; i <= doan.length; i++) {
        const d = doan.slice(0, i).join(".");
        nut.add(d);
        nut.add(d.replace(/\[\]$/, ""));
      }
    }
    const lac = [...quetNguoiDoc(hatNguoi())].filter((d) => !nut.has(d)).sort();
    expect(lac.join("\n"), "bộ quét phát ra một đường KHÔNG có trong kiểu `VramAgentState`").toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — BỐN Ô mà review TOÀN NHÁNH đã ĐO là "0 lượt đọc": neo ĐÍCH DANH, có LỊCH SỬ
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §3 — bốn ô '0 lượt đọc' của Pha 6 phải ở lại có người đọc", () => {
  const NEO: readonly { readonly o: string; readonly viSao: string }[] = [
    { o: "headroom.effective.notAnInvariant", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "headroom.effective.variesWith", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "headroom.effective.beforeAfterEvidence", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "ledger.foreign.truncatedIdentityWrites", viSao: "Pha 6 Task 5 — 0 điểm đọc ở client/** và vramTools.ts" },
  ];
  for (const { o, viSao } of NEO) {
    it(`★★★ ${o} — GIÁ TRỊ tới textSummary (${viSao})`, async () => {
      expect(O, `${o} không còn trong kiểu — nếu XOÁ cố ý thì gỡ luôn mục này khỏi NEO`).toContain(o);
      const kq = await doViPhan(canhDay(), "vi", new Set([o]));
      expect(kq.khongDoi.join(" · "), `${o}: quay lại 0 người đọc (giá trị KHÔNG tới bản tóm tắt)`).toBe("");
    });
  }

  it("★★★ `beforeAfterEvidence` phải ASCII — điều kiện TỒN TẠI của người đọc ấy", () => {
    /**
     * ⚠⚠ `vramPhrases.exhaustive.test.ts` §C/§D cấm chữ phi-ASCII ở `lang=en` và dấu tiếng Việt ở
     * `lang=zh`. Một câu tiếng Việt ở ô này **không có cách nào** vào `textSummary` của 2/3 phiên.
     */
    expect(
      /^[\x20-\x7E]+$/.test(VRAM_BEFORE_AFTER_EVIDENCE),
      `hằng chứa ký tự phi-ASCII ⇒ rơi khỏi textSummary en/zh:\n${VRAM_BEFORE_AFTER_EVIDENCE}`,
    ).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §4 — I-2: **PHÉP CẮT** `ghepCoTran()` là một người đọc có thể GIẾT mọi người đọc sau nó
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §4 (I-2) — bản tóm tắt CHẠM TRẦN: 21 ô mới vẫn phải tới Agent", () => {
  /**
   * ⚠⚠⚠ **VÌ SAO §1 MỘT MÌNH KHÔNG ĐỦ, VÀ ĐÂY LÀ MỘT PHÉP ĐO CHỨ KHÔNG PHẢI MỘT LO XA.**
   * `ghepCoTran()` **`break` ở dòng đầu vượt trần** ⇒ **mọi dòng SAU nó bị BỎ**. Trước lượt dời của
   * Task này, khối HOÃN (chứa **7/21** ô mới) nằm **SAU** danh sách hộ — và `foreign.holders`
   * **KHÔNG có trần dân số** (nợ C-1). Người review đo được: ở `lang=en`, **31 hộ anh em** là đủ để
   * **cả khối hoãn biến mất**, gồm `defer.hosts[].status.owner` — ô báo cáo gọi là *nặng nhất*.
   * ⇒ Cổng ra *"0 ô không ai đọc"* khi ấy là một khẳng định **CÓ ĐIỀU KIỆN**. Ca này biến điều kiện
   * ấy thành một **phép đo**: chạy lại đúng §1 **TRONG chế độ đã cắt**.
   */
  const SO_HO_QUA_TRAN = 120;
  const O_MOI: readonly string[] = [
    "atMs",
    "processKey",
    "headroom.effective.readMark",
    "headroom.effective.readAtMs",
    "headroom.effective.notAnInvariant",
    "headroom.effective.variesWith",
    "headroom.effective.beforeAfterEvidence",
    "headroom.charges.staleMarginBytes",
    "headroom.charges.sharedLedgerMarginBytes",
    "headroom.charges.unledgeredChargeBytes",
    "headroom.charges.distrustChargeBytes",
    "headroom.safetyReserveBytes",
    "ledger.sharedRefreshIntervalMs",
    "ledger.sharedStaleAfterMs",
    "defer.hosts[].status.owner",
    "defer.hosts[].status.firstRefusedAt",
    "defer.hosts[].status.chainBudgetMs",
    "defer.hosts[].status.lastRefusalMessage",
    "defer.hosts[].status.lastRefusalMessage.text",
    "defer.hosts[].status.lastRefusalMessage.truncated",
    "defer.hosts[].status.lastRefusalMessage.rawLength",
  ];

  it("★★★ CẦU CHÌ — cảnh này THẬT SỰ chạm trần (nếu không, mọi khẳng định dưới là chân lý rỗng)", async () => {
    for (const lang of ["vi", "en", "zh"] as const) {
      const t = await tomTatCua(canhDay(SO_HO_QUA_TRAN), lang);
      /**
       * ⚠ **NỢ ĐO ĐƯỢC, KHAI THẲNG:** `ghepCoTran()` kiểm ngân sách **TRƯỚC** rồi mới `push` câu
       * khai *"đã cắt"* ⇒ đầu ra **vượt trần của chính nó** đúng bằng độ dài câu ấy (đo được:
       * `vi` = 16.002 với trần 16.000). Nhỏ, nhưng nó là một trần **tự khai mà không tự giữ**;
       * ca này ghim biên độ thay vì làm ngơ.
       */
      expect(t.length, `lang=${lang}: vượt trần quá xa (câu khai "đã cắt" là phần dôi HỢP LỆ)`).toBeLessThanOrEqual(
        16_000 + 400,
      );
      // Câu khai "đã cắt" do `ghepCoTran()` phát ra — có nó nghĩa là phép cắt ĐANG chạy.
      const daCat = /BẢN TÓM TẮT ĐÃ BỊ CẮT|SUMMARY TRUNCATED|摘要已被截断/.test(t);
      expect(daCat, `lang=${lang}: cảnh ${SO_HO_QUA_TRAN} hộ KHÔNG chạm trần ⇒ ca dưới không đo gì`).toBe(true);
    }
  });

  it("★★★ 21 ô MỚI vẫn ĐIỀU KHIỂN `textSummary` khi phép cắt ĐANG chạy, ở CẢ BA ngôn ngữ", async () => {
    const can = new Set(O_MOI);
    for (const lang of ["vi", "en", "zh"] as const) {
      const kq = await doViPhan(canhDay(SO_HO_QUA_TRAN), lang, can);
      expect(
        kq.khongDoi.join("\n"),
        `lang=${lang}: những ô này BỊ PHÉP CẮT ăn mất. ` +
          "⇒ Dời chúng lên TRƯỚC mọi khối KHÔNG có trần dân số (`ledger.foreign.holders`), " +
          "hoặc đặt trần dân số cho khối ấy (nợ C-1).",
      ).toBe("");
      expect(kq.anhHuong.size, `lang=${lang}: 0 ô đo được ⇒ harness hỏng`).toBe(O_MOI.length);
    }
  });

  it("★★ 21 ô ấy phải là ô CÓ THẬT trong kiểu (danh sách trên không được mục ruỗng)", () => {
    const laO = new Set(O);
    expect(O_MOI.filter((o) => !laO.has(o)).join(" · "), "một ô của danh sách §4 không còn trong kiểu").toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §5 — CÔNG CỤ CỦA LƯỚI KHÔNG ĐƯỢC RÒ VÀO ĐỒ THỊ NHẬP SẢN XUẤT
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ §5 — `vramStateFieldPaths.ts` là công cụ của LƯỚI, không phải mã sản xuất", () => {
  it("★★ KHÔNG một file sản xuất nào nhập nó (nó kéo theo `typescript` + `node:fs`)", () => {
    const nhap = quetNhap("vramStateFieldPaths");
    const sanXuat = nhap.filter((f) => !/\.test\.tsx?$/.test(f));
    expect(sanXuat.join("\n"), "một file SẢN XUẤT đang nhập công cụ của lưới").toBe("");
    expect(nhap.length, "không file test nào nhập nó ⇒ nó là mã chết").toBeGreaterThanOrEqual(2);
  });
});

function quetNhap(ten: string): string[] {
  const ra: string[] = [];
  const re = new RegExp(`from\\s+["'][^"']*${ten}["']`);
  const di = (thuMuc: string): void => {
    if (!existsSync(thuMuc)) return;
    for (const item of readdirSync(thuMuc)) {
      const p = join(thuMuc, item);
      if (statSync(p).isDirectory()) {
        if (item === "node_modules" || item === "dist" || item === ".git") continue;
        di(p);
      } else if (/\.tsx?$/.test(item) && re.test(readFileSync(p, "utf8"))) {
        ra.push(p.slice(GOC.length + 1).split(sep).join("/"));
      }
    }
  };
  for (const nhanh of ["server", join("client", "src"), "shared"]) di(join(GOC, nhanh));
  return ra;
}
