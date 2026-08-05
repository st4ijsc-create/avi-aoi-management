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
import ts from "typescript";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./vramTools";
/**
 * ⚠ NHẬP TĨNH, KHÔNG `await import()` TRONG THÂN CA: đồ thị nhập của `./index` (toàn bộ họ tool)
 * tốn vài giây; nạp nó BÊN TRONG một ca làm ca đó ăn hết ngân sách 5.000 ms mặc định của vitest
 * dưới tải song song (đo được 5.018 ms — đúng lớp flake đã ghi cho `wiring.inprocess`). Nhập tĩnh
 * đẩy chi phí sang pha COLLECT, nơi không có trần 5 s.
 */
import { classifyToolIntent, tryExecuteTool } from "./index";
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
// ★★★ C-1 (review vòng 1) — **ĐI TỪ ĐẦU ĐƯỜNG CỦA AGENT, KHÔNG TIÊM `__authCtx` BẰNG TAY**
//
// ⚠⚠⚠ ĐÂY LÀ CA MÀ BỘ CA VÒNG 1 KHÔNG CÓ, VÀ NÓ LÀ CA QUAN TRỌNG NHẤT CỦA FILE.
// Mọi ca vòng 1 gọi thẳng `tool.handler({ __authCtx: AUTH, … })` — tức **tự tiêm** đúng thứ mà mã
// sản xuất **không bao giờ tiêm**. `tryExecuteTool()` gọi `tool.handler(decision.args)` và `execCtx`
// **không vào `args`** ⇒ tool LUÔN trả `PERMISSION_DENIED`, `buildVramAgentState()` là **MÃ CHẾT**
// trên đường Agent. Cả họ `readToolsP2*`/`analyticsTools` chết y hệt (nợ có sẵn của repo).
// ⇒ Ca dưới đây đi **từ câu hỏi**, qua bộ phân loại ý định THẬT, qua `tryExecuteTool()` THẬT.
// ⚠ Lưới theo ĐƯỜNG THOÁT, không theo FILE: một ca hỏi *"file có nhập `buildVramAgentState` không"*
// đã XANH suốt vòng 1 trong khi con số **không tới được người đọc**.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ C-1 — đường AGENT ĐẦY ĐỦ: câu hỏi → classifier → tryExecuteTool → state THẬT", () => {
  const EXEC = { user: { id: 7, role: "admin" as const, name: "Tester" }, lang: "vi" as const };

  it("bộ phân loại ý định định tuyến câu hỏi VRAM về `get_vram_state`", () => {
    expect(classifyToolIntent("còn bao nhiêu vram").tool).toBe("get_vram_state");
  });

  it("★★★ gọi TỪ ĐẦU ĐƯỜNG (KHÔNG tiêm `__authCtx` bằng tay) ⇒ state THẬT, TUYỆT ĐỐI không PERMISSION_DENIED", async () => {
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, EXEC);

    expect(r.decision.tool).toBe("get_vram_state");
    expect(r.result, "tool phải chạy được, không nuốt lỗi").not.toBeNull();
    // ⇐ ĐÂY là ca đỏ khi ai gỡ phép tiêm `__authCtx` ở `tryExecuteTool` (C-1).
    expect(r.result!.note, "danh tính phiên THẬT phải tới được RBAC gate").not.toBe("PERMISSION_DENIED");
    const data = r.result!.data as { state: { headroom: unknown } | null };
    expect(data.state, "ảnh chụp VRAM phải THẬT SỰ tới được Agent").not.toBeNull();
    expect(r.result!.textSummary).toContain("trusted=");
  });

  it("★★ RBAC vẫn CƯỠNG CHẾ trên đường đầy đủ: `checkPermission` từ chối ⇒ vẫn TỪ CHỐI", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, EXEC);
    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).toBeNull();
  });

  it("★★ KHÔNG có `execCtx` (lời gọi cũ, không danh tính) ⇒ TỪ CHỐI — phép tiêm KHÔNG nới quyền cho ai", async () => {
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, undefined);
    expect(r.result!.note).toBe("PERMISSION_DENIED");
  });

  it("★★★ `__authCtx` do NGƯỜI GỌI bịa trong args KHÔNG thắng danh tính phiên THẬT", async () => {
    /**
     * Ranh giới an toàn của phép tiêm: `__authCtx` được gán SAU phép trải. Ca này chứng minh bằng
     * ĐỐI SỐ THẬT đi tới `checkPermission`, không bằng đọc mã.
     */
    await tryExecuteTool("còn bao nhiêu vram", undefined, EXEC);
    const goi = checkPermissionMock.mock.calls.at(-1)!;
    expect(goi[0], "userId phải là của PHIÊN, không phải của args").toBe(7);
    expect(goi[1]).toBe("admin");
    expect(goi[2]).toBe("machine_control");
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

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ N-2 (re-review) — PHÁT BIỂU VỀ **CÁI NÓ PHẢI LÀ**, KHÔNG PHẢI CÁI NÓ KHÔNG ĐƯỢC CHỨA
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Bản trước của ca này là `expect(dashboard).not.toMatch(/h\?\.vram/)` — **chép CHỮ KÝ** của
   * đúng dòng cũ (`const vram = h?.vram ?? null`). Người sau viết `h?.vram?.used`, hay đọc qua một
   * biến trung gian, hay `const v = h; v.vram` là **đi lọt**, y hệt cách người review vừa lách lưới
   * `||` bằng một biến trung gian. Người review gọi tên nguyên tắc, và đây là lần thứ BA nó xuất
   * hiện: **một lưới nặn theo chữ ký của lỗi vừa rồi không canh được bất biến.**
   *
   * ⇒ BẤT BIẾN, phát biểu DƯƠNG: **chuỗi nguồn của con số VRAM PHẢI LÀ**
   *   `vramState` ← lời gọi `trpc.vram.state.useQuery(...)` → `vb` ← `vramState.data`
   *   → `vramUsed`/`vramCeiling` ← đọc từ `vb`.
   * Bất kỳ nguồn nào khác (kể cả `aiGguf.health`) **không phải** chuỗi này ⇒ ĐỎ, bất kể cú pháp.
   */
  function astCua(rel: string[]): ts.SourceFile {
    const f = join(REPO_ROOT, ...rel);
    return ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  function khoiTao(sf: ts.SourceFile, ten: string): ts.Expression | undefined {
    let ra: ts.Expression | undefined;
    const di = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten && n.initializer) {
        ra ??= n.initializer;
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  it("★★★ con số VRAM của `AIBrainDashboard` PHẢI đến từ chuỗi `trpc.vram.state` → `vb` → used/ceiling", () => {
    const sf = astCua(["client", "src", "pages", "AIBrainDashboard.tsx"]);

    // (1) `vramState` PHẢI LÀ một lời gọi `trpc.vram.state.useQuery(...)`.
    const kState = khoiTao(sf, "vramState");
    expect(kState, "phải có biến `vramState`").toBeDefined();
    expect(ts.isCallExpression(kState!), "`vramState` phải LÀ một lời gọi query").toBe(true);
    expect((kState! as ts.CallExpression).expression.getText(sf)).toBe("trpc.vram.state.useQuery");

    // (2) `vb` PHẢI đọc từ `vramState`.
    const kVb = khoiTao(sf, "vb");
    expect(kVb, "phải có biến ảnh chụp broker").toBeDefined();
    expect(kVb!.getText(sf)).toContain("vramState");

    // (3) Hai con số hiển thị PHẢI đọc từ `vb` — tức từ broker, không từ một nguồn thứ hai.
    for (const ten of ["vramUsed", "vramCeiling"]) {
      const k = khoiTao(sf, ten);
      expect(k, `phải có biến ${ten}`).toBeDefined();
      expect(k!.getText(sf), `${ten} phải đọc từ ảnh chụp broker`).toContain("vb");
    }
  });

  it("★★ (lưới cho chính lưới) BA hình dạng nguồn-thô khác nhau đều bị bắt bởi CÙNG phát biểu", () => {
    /** Lưới cũ (`not.toMatch(/h\?\.vram/)`) để lọt biến thể 2 và 3. */
    const bienThe: Record<string, string> = {
      "nguyên văn lỗi cũ": "const vramUsed = h?.vram ?? null;",
      "thêm một nấc": "const vramUsed = h?.vram?.used ?? null;",
      "qua biến trung gian": "const hh = h; const vramUsed = hh.vram.used;",
    };
    for (const [ten, nguon] of Object.entries(bienThe)) {
      const sf = ts.createSourceFile("giả.tsx", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const k = khoiTao(sf, "vramUsed");
      expect(k, ten).toBeDefined();
      expect(k!.getText(sf).includes("vb"), `${ten} PHẢI bị bắt`).toBe(false);
    }
  });

  /**
   * ★★★ C-3 (review vòng 1) — **PANEL PHẢI ĐƯỢC MOUNT, KHÔNG CHỈ TỒN TẠI.**
   *
   * Người review gỡ thẻ `<VramBrokerPanel …/>` khỏi `AIBrainDashboard` ⇒ **283/283 XANH**: người đọc
   * phía client **không có lưới nào canh**. Một thành phần không được mount là một file đẹp mà không
   * ai render — đúng "đồng hồ không kim" ở tầng UI.
   *
   * ⚠ Hỏi trên **AST** (`ts.createSourceFile`), không hỏi trên văn bản: comment KHÔNG phải node ⇒
   * bình luận thẻ ra là nó **biến mất khỏi cây**, không lách được (cùng kỹ thuật cổng (ii) vừa đổi
   * sang sau khi bản regex bị lách).
   */
  it("★★★ `<VramBrokerPanel/>` THẬT SỰ được mount trong `AIBrainDashboard` (hỏi trên AST, không hỏi văn bản)", () => {
    const file = join(REPO_ROOT, "client", "src", "pages", "AIBrainDashboard.tsx");
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let mounted = 0;
    const tenThe = (n: ts.JsxSelfClosingElement | ts.JsxOpeningElement): string =>
      ts.isIdentifier(n.tagName) ? n.tagName.text : n.tagName.getText(sf);
    const di = (node: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && tenThe(node) === "VramBrokerPanel") {
        mounted++;
      }
      ts.forEachChild(node, di);
    };
    di(sf);
    expect(mounted, "AIBrainDashboard phải render <VramBrokerPanel/>").toBeGreaterThanOrEqual(1);
  });
});
