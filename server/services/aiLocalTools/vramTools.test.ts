/**
 * ★★★ Pha 4 Task 4 — **CỔNG RA CỦA TASK: MỖI Ô "ĐỒNG HỒ KHÔNG KIM" CÓ NGƯỜI ĐỌC THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI LOẠI CA Ở ĐÂY, VÀ CHÚNG KHÔNG THAY ĐƯỢC NHAU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **CA THEO ĐƯỜNG THOÁT** (phần lớn file): lấy tool ra khỏi **registry THẬT**, chạy `handler()`
 *    THẬT trên trạng thái dựng bằng `vramBroker.reserve()` THẬT, rồi khẳng định `textSummary` (thứ
 *    được nhồi vào ngữ cảnh LLM) **THẬT SỰ CHỨA** từng ô. Gỡ một lượt đọc ở điểm sản xuất ⇒ ĐỎ.
 *    ⚠ Đây là câu trả lời cho lớp lỗi *"lưới theo FILE, không theo ĐƯỜNG THOÁT"* (đã tái diễn MƯỜI
 *    lần): một ca hỏi *"file có nhập `buildVramAgentState` không"* trả lời về **sự hiện diện**, và
 *    **không nói gì** về việc con số ấy có tới được người đọc hay không.
 * 2. **CỔNG TĨNH** (cuối file): *"có ≥1 điểm gọi NGOÀI `server/routers/**` và NGOÀI
 *    `server/services/vram/**`"* — cổng ra do người điều phối đặt lại cho Task 4 (bản đầu của kế
 *    hoạch nói *"nối vào router"*, thứ Task 1 đã làm, nên nó **không đóng được gì**). Cổng này
 *    kiểm **CẤU TRÚC** (ai được phép là người đọc), thứ một ca hành vi không diễn đạt được.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./vramTools";
import { getTool } from "./toolRegistry";
import * as broker from "../vram/vramBroker";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
  type SharedLeaseRow,
} from "../vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../vram/vramTickCell";
import { __resetVramDeferForTests } from "../vram/vramDefer";
import { __resetVramBeginFailureState } from "../vram/vramWiring";

const MIB = 1024 * 1024;
const AUTH = { userId: 7, role: "admin" } as const;

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
});

/** Lấy tool ra khỏi **registry THẬT** — nếu ai gỡ `registerTool()`, mọi ca dưới đây ngã. */
function tool() {
  const t = getTool("get_vram_state");
  if (!t || typeof t.handler !== "function") throw new Error("get_vram_state CHƯA đăng ký trong toolRegistry");
  return t;
}

async function chay(params: Record<string, unknown> = {}) {
  return await tool().handler!({ __authCtx: AUTH, ...params });
}

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
    bytes: 17_000 * MIB,
    measured: true,
    refCount: 0,
    reclaimer: "gguf-idle-model",
    acquiredAtMs: 1,
    updatedAtMs: 1,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐĂNG KÝ + PHÂN QUYỀN
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("get_vram_state — đăng ký, chỉ-đọc, phân quyền", () => {
  it("★★★ CÓ MẶT trong `toolRegistry` ⇒ AI Agent gọi được (Agent repo này KHÔNG đi qua tRPC)", () => {
    const t = tool();
    expect(t.kind ?? "read").toBe("read");
    expect(t.requiredPermission).toEqual({ module: "machine_control", action: "canView" });
  });

  it("★★ CHỈ ĐỌC: không phơi `preview`/`execute`/`buildClientAction` — lệnh phá huỷ KHÔNG treo sau bộ phân loại ý định", () => {
    const t = tool();
    expect(t.preview).toBeUndefined();
    expect(t.execute).toBeUndefined();
    expect(t.buildClientAction).toBeUndefined();
  });

  it("thiếu `__authCtx` ⇒ TỪ CHỐI (fail-safe), không rò một con số nào", async () => {
    const r = await tool().handler!({});
    expect(r.note).toBe("PERMISSION_DENIED");
    expect((r.data as { state: unknown }).state).toBeNull();
    expect(checkPermissionMock).not.toHaveBeenCalled();
  });

  it("RBAC từ chối ⇒ TỪ CHỐI; RBAC NÉM ⇒ cũng TỪ CHỐI (fail-safe)", async () => {
    checkPermissionMock.mockResolvedValue(false);
    expect((await chay()).note).toBe("PERMISSION_DENIED");

    checkPermissionMock.mockRejectedValue(new Error("DB down"));
    const r = await chay();
    expect(r.note).toBe("PERMISSION_DENIED");
    expect((r.data as { state: unknown }).state).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ BẢNG "ĐỒNG HỒ KHÔNG KIM" — TỪNG Ô, THEO ĐƯỜNG THOÁT
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ mỗi ô của bảng Pha 4 CÓ MẶT trong `textSummary` (thứ được nhồi vào ngữ cảnh LLM)", () => {
  it("#2 `trusted` + `degradedReasons` — và `basis`/`blind` đi kèm, không để Agent đọc CHẶN TRÊN thành an toàn", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("trusted=");
    // Bộ test chưa công bố sổ chung ⇒ `shared-ledger-unasked` là một lý do suy giảm THẬT.
    expect(r.textSummary).toContain("shared-ledger-unasked");
    expect(r.textSummary).toContain("basis=");
    expect(r.textSummary).toContain("CHẶN TRÊN");
  });

  it("#3 `baselineUnverifiedReasons` — và `null` (CHƯA CÓ NHỊP) phân biệt được với mảng rỗng", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("unverifiedReasons");
    expect(r.textSummary).toContain("CHƯA CÓ NHỊP NÀO");
  });

  it("#4 `vramBeginFailureState()` — số lượt hỏng + lý do gần nhất", async () => {
    const r = await chay();
    // ⚠ Nhãn CỐ Ý không có dấu `(` ngay sau tên hàm — xem khối chú thích ở `vramTools.ts` (lưới
    // `enforcement.test.ts` quét chuỗi, không chỉ chú thích, và đã kêu oan ở đúng file này).
    expect(r.textSummary).toContain("hàm beginVramAllocation) đã hỏng");
  });

  it("#5 `foreignLedgerBytes`/`foreignLeases` — hộ ANH EM + `leaseKey` (đầu vào của `vram.releaseStale`)", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");

    const r = await chay();
    expect(r.textSummary).toContain("Sổ chung (anh em)");
    expect(r.textSummary).toContain("gguf:qwen30b");
    expect(r.textSummary).toContain("worker:999:1#lease-7");
    // ⚠ KHÔNG được hứa thu hồi được từ đây (bàn giao I-3).
    expect(r.textSummary).toContain("CHỈ tiến trình chủ thu hồi được");
  });

  it("★ sổ chung CHƯA làm mới ⇒ nói rõ ĐANG MÙ, tuyệt đối không im lặng", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("ĐANG MÙ về tiến trình anh em");
  });

  it("#6 `VRAM_SIDECAR_TTL_MS` → `ttlMs`: hộ nhận nuôi quá hạn hiện ra, KÈM câu 'không có nhịp nào tự gặt'", async () => {
    const lease = broker.adoptLease(
      {
        owner: "sidecar:orphan-pid-4242",
        kind: "external-process",
        estimatedBytes: 7_825 * MIB,
        priority: "interactive",
        ttlMs: 1_000,
        reclaimer: "orphan-pid",
      },
      7_825 * MIB,
      "nhận nuôi (test)",
    );
    (lease as { acquiredAt: Date }).acquiredAt = new Date(Date.now() - 60_000);

    const r = await chay();
    expect(r.textSummary).toContain("TTL 1000 ms");
    expect(r.textSummary).toContain("quá hạn=true");
    expect(r.textSummary).toContain("KHÔNG có nhịp nào tự gặt theo TTL");
  });

  it("#1 trạng thái hoãn của CẢ 6 hộ nền — và `retryReach` nói trước lệnh có với tới không ((D))", async () => {
    const r = await chay();
    for (const host of [
      "cron:kb-sync",
      "cron:kb-eval-gate",
      "sidecar:local-trainer",
      "sidecar:llm-finetune",
      "reranker",
      "gguf-embed-ctx",
    ]) {
      expect(r.textSummary, `hộ nền ${host} phải có mặt`).toContain(host);
    }
    // 3/6 hộ ngân sách 0 ⇒ "KHÔNG CÓ CƠ CHẾ CHỜ" phải PHÂN BIỆT được với "đang hoãn".
    expect(r.textSummary).toContain("KHÔNG CÓ CƠ CHẾ CHỜ");
    expect(r.textSummary).toContain("KHÔNG với tới");
    expect(r.textSummary).toContain("host-not-running-in-this-process");
  });

  it("★★ `holderListIsLowerBound` + `excludesBaselineBytes` — chặn đúng câu 'card trống'", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("holderListIsLowerBound=true");
    expect(r.textSummary).toContain("CẬN DƯỚI");
    expect(r.textSummary).toContain("excludesBaselineBytes=true");
  });

  it("★★ `estimateKind`/`estimateUsable`/`unknownCount` đi CÙNG NHAU — không có đường gửi số mà bỏ cảnh báo", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("estimateKind=estimate");
    expect(r.textSummary).toContain("estimateUsable=");
    expect(r.textSummary).toContain("unknownCount=");
  });

  it("`nonFiniteFields` rỗng LÀ một câu trả lời, không phải im lặng", async () => {
    const r = await chay();
    expect(r.textSummary).toContain("nonFiniteFields");
  });

  it("★ ảnh chụp NGUYÊN VẸN đi kèm ⇒ Agent đọc được mọi ô, không chỉ bản tóm tắt", async () => {
    const r = await chay();
    const data = r.data as { state: { headroom: unknown; defer: { hosts: unknown[] } } | null };
    expect(data.state).not.toBeNull();
    expect(data.state!.defer.hosts.length).toBe(6);
  });

  it("★★ hộ CỤC BỘ thu hồi được ⇒ tóm tắt gọi ĐÍCH DANH lệnh + người thi hành (Agent hành động được)", async () => {
    const r0 = broker.reserve(
      {
        owner: "gguf:idle-30b",
        kind: "gguf-model",
        estimatedBytes: 1_000 * MIB,
        priority: "background",
        reclaimer: "gguf-idle-model",
      },
      { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
    );
    if (r0.lease === null) throw new Error("phải cấp được");
    broker.setLeaseRefCount(r0.lease.id, 0);

    const r = await chay();
    expect(r.textSummary).toContain('vram.preempt("gguf:idle-30b") VỚI TỚI');
    expect(r.textSummary).toContain("gguf-idle-model");
  });

  it("★ `owner` KHÔNG BỊ CẮT NGẮN — nó là DANH TÍNH Agent truyền thẳng vào lệnh (ràng buộc 3)", async () => {
    const dai = `gguf:${"D:/models/rat-dai/".repeat(12)}model.gguf`;
    const r0 = broker.reserve(
      { owner: dai, kind: "gguf-model", estimatedBytes: 10 * MIB, priority: "background", reclaimer: "gguf-idle-model" },
      { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
    );
    if (r0.lease === null) throw new Error("phải cấp được");

    const r = await chay();
    expect(r.textSummary).toContain(dai);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CỔNG RA CỦA TASK 4 (người điều phối đặt lại): NGƯỜI ĐỌC THẬT PHẢI Ở NGOÀI HAI THƯ MỤC
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("cổng ra — `buildVramAgentState` có điểm gọi NGOÀI `server/routers/**` và `server/services/vram/**`", () => {
  const HERE = fileURLToPath(new URL(".", import.meta.url)); // .../server/services/aiLocalTools
  const REPO_ROOT = join(HERE, "..", "..", "..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, out);
        continue;
      }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  /** Cả hai thư mục bị LOẠI — "nối vào router" là việc Task 1 đã làm, nó không đóng được gì. */
  function laNoiLoaiTru(file: string): boolean {
    const rel = file.replace(REPO_ROOT, "").replace(/\\/g, "/");
    return rel.startsWith("/server/routers/") || rel.startsWith("/server/services/vram/");
  }

  it("★★★ ≥1 điểm gọi `buildVramAgentState(` ngoài hai thư mục đó (nếu không: đồng hồ vẫn không có kim)", () => {
    const hits = walk(join(REPO_ROOT, "server"))
      .filter((f) => !laNoiLoaiTru(f))
      .filter((f) => /\bbuildVramAgentState\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(REPO_ROOT, ""));
    expect(hits.length, `điểm gọi tìm được: ${JSON.stringify(hits)}`).toBeGreaterThanOrEqual(1);
  });

  it("★★★ mặt ĐỌC được tiêu thụ ở CLIENT qua `trpc.vram.state` — và `AIBrainDashboard` KHÔNG còn đọc VRAM thô", () => {
    const dashboard = readFileSync(join(REPO_ROOT, "client", "src", "pages", "AIBrainDashboard.tsx"), "utf8");
    expect(dashboard).toMatch(/trpc\.vram\.state\.useQuery/);
    /**
     * ⚠ Đồng hồ CŨ: `const vram = h?.vram ?? null` ⇐ `aiGguf.health` ⇐ `llamaInstance.getVramState()`.
     * Hai nguồn số cho cùng một câu hỏi là lớp lỗi "hai bản sao vị từ" (review Task 1 gọi tên đích
     * danh dòng đó). Nó phải KHÔNG còn lái thẻ VRAM.
     */
    expect(dashboard).not.toMatch(/h\?\.vram/);
  });
});
