/**
 * ★★★ Pha 2B Task 7 (§8) — **VỀ MỘT MỐI.**
 *
 * Bộ ca này canh đúng một câu: *"hệ chỉ còn MỘT người quản lý VRAM"* — yêu cầu gốc của chủ dự án.
 * Bốn nhóm, mỗi nhóm một dòng của bảng §8:
 *
 *   A. `enforceVramGuard()` **XOÁ** — trần nay là của broker, và `reserve()` biết kích thước TRƯỚC.
 *   B. `ensureCapacity()` **HẤP THỤ** thành chính sách ĐẾM của broker (Đ4: thước RIÊNG).
 *   C. `evictLRU()` **HẤP THỤ** thành `preempt()` — mở rộng cho sidecar, và **chỉ** cho hộ thi hành được.
 *   D. **vị từ dùng chung** `coThiHanhThuHoi()` — MỌI nơi tiêu thụ đọc CÙNG một câu trả lời.
 *
 * ⚠ Ràng buộc 7 — fixture **17.000 MiB** (khối 30B đo được 17.511.354.368 B ≈ 16.700 MiB): mọi con
 * số dưới đây đủ lớn để một lỗi làm tròn/đơn vị không trốn được.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const suKien = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { suKien.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

/** Người thi hành GIẢ — ta canh AI bị gọi và THEO THỨ TỰ NÀO, không canh llama.cpp. */
const daDonModel = vi.hoisted(() => [] as string[]);
const donModelKetQua = vi.hoisted(() => ({ value: true as boolean | "THROW" }));
vi.mock("../aiGgufEngine", () => ({
  unloadGgufModel: async (modelId: string) => {
    daDonModel.push(modelId);
    if (donModelKetQua.value === "THROW") throw new Error("unloadGgufModel hỏng (ca thử nghiệm)");
    return donModelKetQua.value;
  },
}));
const daTatSidecar = vi.hoisted(() => ({ n: 0 }));
vi.mock("../llamaVisionSidecar", () => ({
  stopSidecar: async () => { daTatSidecar.n += 1; },
}));

import {
  reserve, release, snapshot, noteDeviceTotalBytes, setLeaseRefCount, deviceTotalBytes,
  deviceUsableBytes, ledgerHolders, preemptCandidates, preemptPlan, nguoiThiHanhThuHoi,
  __resetBrokerForTests, type VramDecisionContext,
} from "./vramBroker";
import { preempt } from "./vramPreempt";
import {
  ggufMaxLoadedModels, ggufMaxVramBytes, ggufVramGuardPct, sessionCacheMax, usableCeilingBytes,
  __resetVramCapsForTests,
} from "./vramCaps";
import type { VramLeaseKind, VramPriority, VramReclaimerId, VramReserveRequest } from "./types";

const MIB = 1024 * 1024;
const NOW = 1_800_000_000_000;
/** Ràng buộc 7 — khối 30B, con số của thiết bị thật. */
const KHOI_30B = 17_000 * MIB;
const TRAN_THIET_BI = 32_607 * MIB;

const BIEN_CAP = [
  "GGUF_VRAM_GUARD_PCT", "GGUF_MAX_VRAM_MB", "GGUF_MAX_LOADED_MODELS", "AI_SESSION_CACHE_MAX",
] as const;

function xin(
  owner: string,
  bytes: number,
  over: Partial<VramReserveRequest> = {},
): VramReserveRequest {
  return {
    owner,
    kind: "gguf-model" as VramLeaseKind,
    estimatedBytes: bytes,
    priority: "interactive" as VramPriority,
    ...over,
  };
}

/** Ô tick SẠCH — bộ ca này canh §8, không canh chính sách suy giảm. */
function ctx(over: Partial<VramDecisionContext> = {}): VramDecisionContext {
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: NOW, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    nowMs: NOW,
    ...over,
  };
}

beforeEach(() => {
  for (const b of BIEN_CAP) delete process.env[b];
  suKien.length = 0;
  daDonModel.length = 0;
  daTatSidecar.n = 0;
  donModelKetQua.value = true;
  __resetBrokerForTests();
  __resetVramCapsForTests();
  noteDeviceTotalBytes(TRAN_THIET_BI);
});
afterEach(() => {
  for (const b of BIEN_CAP) delete process.env[b];
  __resetVramCapsForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("A. `enforceVramGuard()` XOÁ — trần nay là của BROKER, và nó biết kích thước TRƯỚC", () => {
  it("★★★ MẶC ĐỊNH: GGUF_VRAM_GUARD_PCT KHÔNG cắt gì (100) — sai lệch có chủ đích, được KHOÁ", () => {
    // Nếu ai đổi mặc định về 90, ca này ĐỎ và buộc họ đọc lý do ở `vramCaps.ts`:
    // `90` nghĩa CŨ (ngưỡng phản ứng, hậu quả = một lượt đuổi) ≠ `90` nghĩa MỚI (trần cứng, hậu
    // quả = TỪ CHỐI). Giữ 90 làm mặc định là lặng lẽ cắt 3.261 MiB khỏi MỌI máy.
    expect(ggufVramGuardPct()).toBe(100);
    expect(deviceUsableBytes()).toBe(deviceTotalBytes());
  });

  it("★★★ đặt GGUF_VRAM_GUARD_PCT=90 ⇒ trần HIỆU LỰC = 90% — và lượt xin bị cân TRƯỚC khi nạp", () => {
    process.env.GGUF_VRAM_GUARD_PCT = "90";
    __resetVramCapsForTests();
    expect(deviceUsableBytes()).toBe(Math.floor((TRAN_THIET_BI * 90) / 100));

    // Đây là toàn bộ khác biệt với guard cũ: guard cũ đọc mức dùng HIỆN TẠI (0) ⇒ CHO QUA, rồi
    // khối 29.000 MiB mới lên card. Broker so CHÍNH kích thước đang xin với trần 90%.
    const r = reserve(xin("gguf:30B", 29_000 * MIB), ctx());
    expect(r.lease).toBeNull();
    expect(r.wouldRefuse).toBe(true);
    // và cùng lượt xin đó VỪA khi trần không bị cắt ⇒ ca này nói về TRẦN, không nói về "luôn từ chối".
    delete process.env.GGUF_VRAM_GUARD_PCT;
    __resetBrokerForTests();
    noteDeviceTotalBytes(TRAN_THIET_BI);
    expect(reserve(xin("gguf:30B", 29_000 * MIB), ctx()).lease).not.toBeNull();
  });

  it("GGUF_MAX_VRAM_MB là trần BYTE; `0` = tắt (ngữ nghĩa cũ giữ nguyên)", () => {
    expect(ggufMaxVramBytes()).toBe(0);
    expect(usableCeilingBytes(TRAN_THIET_BI)).toBe(TRAN_THIET_BI);
    process.env.GGUF_MAX_VRAM_MB = "20000";
    __resetVramCapsForTests();
    expect(usableCeilingBytes(TRAN_THIET_BI)).toBe(20_000 * MIB);
  });

  it("★★ hai trần cùng đặt ⇒ CHẶT HƠN thắng (mọi trần chỉ làm con số NHỎ ĐI, không bao giờ nới)", () => {
    process.env.GGUF_VRAM_GUARD_PCT = "90";     // 29.346 MiB
    process.env.GGUF_MAX_VRAM_MB = "20000";     // 20.000 MiB
    __resetVramCapsForTests();
    expect(usableCeilingBytes(TRAN_THIET_BI)).toBe(20_000 * MIB);
    process.env.GGUF_MAX_VRAM_MB = "31000";     // 31.000 MiB > 90%
    __resetVramCapsForTests();
    expect(usableCeilingBytes(TRAN_THIET_BI)).toBe(Math.floor((TRAN_THIET_BI * 90) / 100));
  });

  it("trần KHÔNG hữu hạn ⇒ trả NGUYÊN (không nhân, không `min`) — fail-closed nằm ở computeHeadroom", () => {
    for (const xau of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(usableCeilingBytes(xau)).toBe(xau);
    }
  });

  /**
   * ★★★ ĐIỀU KIỆN RA #7 — cụm chữ của lượt tràn im lặng phải BIẾN MẤT khỏi mã sản xuất.
   *
   * ⚠ Cụm đó **không được viết nguyên văn ở bất kỳ đâu trong file này**, kể cả trong một chú thích:
   * `git grep` không phân biệt mã với chú thích, nên một lần nhắc tên là ca này tự làm mình đỏ —
   * đúng cái bẫy "tên hàm còn trong docstring" mà Task 6 đã dẫm phải. Vì vậy cụm được GHÉP từ hai
   * mảnh lúc chạy.
   */
  it("★★★ cụm chữ của lượt tràn im lặng KHÔNG CÒN Ở MÃ SẢN XUẤT (điều kiện ra #7, kiểm bằng MÁY)", async () => {
    const CUM = ["temporary", "overflow"].join(" ");
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const goc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const thuMuc = ["server", "client", "shared", "drizzle", "scripts", "tools"];
    const dinh: string[] = [];
    const duyet = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) { duyet(p); continue; }
        if (!/\.(ts|tsx|js|mjs|cjs|cs)$/.test(e.name)) continue;
        if (statSync(p).size > 4_000_000) continue;
        if (readFileSync(p, "utf8").includes(CUM)) dinh.push(p);
      }
    };
    for (const t of thuMuc) {
      try { duyet(join(goc, t)); } catch { /* thư mục không có ở cấu hình này */ }
    }
    expect(dinh, `Còn cụm "${CUM}" ở:\n  ${dinh.join("\n  ")}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("B. `ensureCapacity()` HẤP THỤ — chính sách ĐẾM của broker (Đ4: thước RIÊNG)", () => {
  it("mặc định 2, đọc từ MỘT chỗ (`vramCaps`)", () => {
    expect(ggufMaxLoadedModels()).toBe(2);
    process.env.GGUF_MAX_LOADED_MODELS = "4";
    __resetVramCapsForTests();
    expect(ggufMaxLoadedModels()).toBe(4);
  });

  it("★★★ Đ4 — hết KHE ⇒ TỪ CHỐI **kể cả khi byte thừa thãi**, và dư địa BYTE KHÔNG bị bóp méo", () => {
    process.env.GGUF_MAX_LOADED_MODELS = "2";
    __resetVramCapsForTests();
    // hai model tí hon: byte gần như không tốn gì
    reserve(xin("gguf:a", 1 * MIB), ctx());
    reserve(xin("gguf:b", 1 * MIB), ctx());
    const r = reserve(xin("gguf:c", 1 * MIB), ctx());
    expect(r.lease).toBeNull();
    expect(r.decision.slotsNeeded).toBe(1);
    expect(r.decision.reasons).toContain("gguf-slot-cap");
    // ⚠ Đ4: lý do ĐẾM KHÔNG được biến thành một khoản phụ phí BYTE.
    expect(r.decision.effectiveHeadroomBytes).toBe(r.decision.headroomBytes);
    expect(r.decision.effectiveHeadroomBytes).toBeGreaterThan(KHOI_30B);
  });

  it("★★ trần KHE chỉ áp cho `gguf-model` — hộ khác KHÔNG dính", () => {
    process.env.GGUF_MAX_LOADED_MODELS = "1";
    __resetVramCapsForTests();
    reserve(xin("gguf:a", 1 * MIB), ctx());
    expect(reserve(xin("gguf:b", 1 * MIB), ctx()).lease).toBeNull();
    for (const kind of ["gguf-context", "gguf-embed-context", "onnx-session", "external-process", "gguf-backend"] as const) {
      const r = reserve(xin(`x:${kind}`, 1 * MIB, { kind }), ctx());
      expect(r.lease, `kind ${kind} KHÔNG được dính trần ĐẾM của gguf-model`).not.toBeNull();
      expect(r.decision.slotsNeeded).toBe(0);
    }
  });

  it("★★ dân số RỘNG HƠN `loadedModels` cũ: model của aiReranker CŨNG chiếm khe (bản cũ đếm thiếu)", () => {
    process.env.GGUF_MAX_LOADED_MODELS = "2";
    __resetVramCapsForTests();
    reserve(xin("gguf:qwen30b", KHOI_30B), ctx());
    reserve(xin("gguf-reranker:bge", 600 * MIB), ctx());   // aiReranker — NGOÀI `loadedModels`
    expect(reserve(xin("gguf:coder", 1 * MIB), ctx()).decision.slotsNeeded).toBe(1);
  });

  it("nhả một khe ⇒ lượt xin kế tiếp ĐI TIẾP (trần là trần, không phải một cánh cửa một chiều)", () => {
    process.env.GGUF_MAX_LOADED_MODELS = "1";
    __resetVramCapsForTests();
    const a = reserve(xin("gguf:a", 1 * MIB), ctx());
    expect(reserve(xin("gguf:b", 1 * MIB), ctx()).lease).toBeNull();
    release(a.lease!);
    expect(reserve(xin("gguf:b", 1 * MIB), ctx()).lease).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("C. `evictLRU()` HẤP THỤ thành `preempt()`", () => {
  /** Mở một giấy phép rồi khai NHÀN RỖI. */
  function moNhanRoi(owner: string, bytes: number, over: Partial<VramReserveRequest> = {}) {
    process.env.GGUF_MAX_LOADED_MODELS = "64";
    __resetVramCapsForTests();
    const r = reserve(xin(owner, bytes, over), ctx());
    expect(r.lease, `không mở được giấy phép cho ${owner}`).not.toBeNull();
    setLeaseRefCount(r.lease!.id, 0);
    return r.lease!;
  }

  it("★★★ CHỈ chạm hộ CÓ NGƯỜI THI HÀNH — hộ chỉ có QUYỀN nhường thì KHÔNG bị đụng tới", async () => {
    moNhanRoi("gguf:idle", KHOI_30B, { reclaimer: "gguf-idle-model" });
    // mức THẤP HƠN ⇒ CÓ QUYỀN nhường; nhưng KHÔNG khai người thi hành ⇒ không ai dọn được
    moNhanRoi("sidecar:local-trainer", 4_000 * MIB, { kind: "external-process", priority: "background" });
    moNhanRoi("onnx-ocr:rec", 700 * MIB, { kind: "onnx-session", priority: "background" });

    const kh = preemptPlan("interactive", Number.POSITIVE_INFINITY);
    expect(kh.map((s) => s.owner)).toEqual(["gguf:idle"]);

    const kq = await preempt("interactive", Number.POSITIVE_INFINITY);
    expect(kq.reclaimed).toEqual(["gguf:idle"]);
    expect(daDonModel).toEqual(["idle"]);   // `gguf:` bị cắt ⇒ modelId
    expect(daTatSidecar.n).toBe(0);
  });

  it("★★★ `production` KHÔNG BAO GIỜ bị thu hồi, kể cả khi nhàn rỗi VÀ có người thi hành", async () => {
    moNhanRoi("gguf:prod", KHOI_30B, { priority: "production", reclaimer: "gguf-idle-model" });
    expect(preemptPlan("production", Number.POSITIVE_INFINITY)).toEqual([]);
    const kq = await preempt("production", Number.POSITIVE_INFINITY);
    expect(kq.planned).toBe(0);
    expect(daDonModel).toEqual([]);
  });

  /**
   * ★★★ ĐÍNH CHÍNH MỘT MỆNH ĐỀ CỦA BÀN GIAO TASK 6 (§7.3) — đo bằng máy, ở cả hai chiều.
   *
   * Task 6 viết: *"`background` là mức THẤP NHẤT và `preemptable` = 'mức thấp hơn mức đang xin'
   * ⇒ RỖNG THEO ĐỊNH NGHĨA, VĨNH VIỄN với `kb:sync`"*. Vế ĐẦU đúng và ca 1 dưới đây khoá nó.
   * Vế SAU nói QUÁ, vì `coTheNhuong()` có **HAI** đường chứ không một:
   *
   *     production ⇒ KHÔNG BAO GIỜ  ·  còn lại: `refCount === 0` **HOẶC** rank thấp hơn
   *
   * ⇒ Câu đúng: `preempt()` **KHÔNG** giành được chỗ cho `kb:sync` từ một hộ **ĐANG BẬN**; nó CHỈ
   * giành được từ hộ **NHÀN RỖI**. Và hộ nhàn rỗi chính là ca *"một hộ khác TỰ NHẢ"* mà Task 6 gọi
   * là đường DUY NHẤT — khác biệt là hệ nay **chủ động dọn** thay vì ngồi đợi hết 8 lượt hoãn.
   * ⚠ KHÔNG đảo ngược bàn giao: cơ chế hoãn của Task 6 **vẫn cần**, vì ca 1 (mọi hộ đang bận) là
   * ca thường gặp lúc 03:00 nếu dây chuyền còn chạy.
   */
  it("★★★ (Task 6 §7.3) `kb:sync` KHÔNG lấy được chỗ của hộ ĐANG BẬN — rỗng theo RANK là vĩnh viễn", async () => {
    const a = moNhanRoi("gguf:busy", KHOI_30B, { reclaimer: "gguf-idle-model" });
    const b = moNhanRoi("sidecar:vision", 7_825 * MIB, {
      kind: "external-process", priority: "interactive", reclaimer: "vision-sidecar",
    });
    setLeaseRefCount(a.id, 1);
    setLeaseRefCount(b.id, 1);
    expect(preemptPlan("background", Number.POSITIVE_INFINITY)).toEqual([]);
    const kq = await preempt("background", Number.POSITIVE_INFINITY);
    expect(kq).toMatchObject({ planned: 0, freedBytes: 0, reclaimed: [], failed: [] });
    expect(daDonModel).toEqual([]);
    expect(daTatSidecar.n).toBe(0);
  });

  it("★★ (đính chính) `kb:sync` LẤY ĐƯỢC chỗ của hộ NHÀN RỖI — §5.2 quy tắc 2, không phải rank", async () => {
    moNhanRoi("gguf:idle", KHOI_30B, { reclaimer: "gguf-idle-model" });
    expect(preemptPlan("background", Number.POSITIVE_INFINITY).map((s) => s.owner)).toEqual(["gguf:idle"]);
    expect((await preempt("background", Number.POSITIVE_INFINITY)).reclaimed).toEqual(["gguf:idle"]);
  });

  it("★★★ `production` vẫn KHÔNG BAO GIỜ nhường, kể cả cho một lượt `production` khác", () => {
    moNhanRoi("prod:aoi", KHOI_30B, { priority: "production", reclaimer: "gguf-idle-model" });
    expect(preemptPlan("background", Number.POSITIVE_INFINITY)).toEqual([]);
    expect(preemptPlan("production", Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("★★★ MỞ RỘNG: sidecar thị giác NHÀN RỖI thu hồi được — nhưng ĐANG BAY thì KHÔNG", async () => {
    const l = moNhanRoi("sidecar:vision", 7_825 * MIB, {
      kind: "external-process", priority: "interactive", reclaimer: "vision-sidecar",
    });
    expect(nguoiThiHanhThuHoi({ ...l, refCount: 0 } as never)).toBe<VramReclaimerId>("vision-sidecar");

    // ĐANG BAY (một request thị giác) ⇒ KHÔNG ai được giết nó
    setLeaseRefCount(l.id, 1);
    expect(preemptPlan("production", Number.POSITIVE_INFINITY)).toEqual([]);
    expect((await preempt("production", Number.POSITIVE_INFINITY)).planned).toBe(0);
    expect(daTatSidecar.n).toBe(0);

    // NHÀN RỖI ⇒ thu hồi được (chính là việc hẹn giờ nhàn rỗi của module đó vẫn làm)
    setLeaseRefCount(l.id, 0);
    const kq = await preempt("production", Number.POSITIVE_INFINITY);
    expect(kq.reclaimed).toEqual(["sidecar:vision"]);
    expect(daTatSidecar.n).toBe(1);
  });

  it("★★ THỨ TỰ §5.2: mức THẤP trước, rồi NHÀN RỖI, rồi CŨ — y như `preemptCandidates()`", () => {
    moNhanRoi("bg:cu", 1_000 * MIB, { priority: "background", reclaimer: "gguf-idle-model" });
    moNhanRoi("it:idle", 2_000 * MIB, { reclaimer: "gguf-idle-model" });
    const kh = preemptPlan("production", Number.POSITIVE_INFINITY);
    expect(kh.map((s) => s.owner)).toEqual(["bg:cu", "it:idle"]);
  });

  it("★★ DỪNG KHI ĐỦ (không dọn sạch cả hệ) — theo BYTE và theo KHE, hai điều kiện RIÊNG", () => {
    moNhanRoi("bg:a", 5_000 * MIB, { priority: "background", reclaimer: "gguf-idle-model" });
    moNhanRoi("bg:b", 5_000 * MIB, { priority: "background", reclaimer: "gguf-idle-model" });
    moNhanRoi("bg:c", 5_000 * MIB, { priority: "background", reclaimer: "gguf-idle-model" });
    // cần 6.000 MiB ⇒ đúng HAI hộ, không phải ba
    expect(preemptPlan("interactive", 6_000 * MIB).map((s) => s.owner)).toEqual(["bg:a", "bg:b"]);
    // cần 0 byte nhưng THIẾU 1 KHE ⇒ vẫn phải nêu MỘT hộ (Đ4: hai thước, hai điều kiện dừng)
    expect(preemptPlan("interactive", 0, 1).map((s) => s.owner)).toEqual(["bg:a"]);
    expect(preemptPlan("interactive", 0, 0)).toEqual([]);
  });

  it("★★★ `freedBytes` đo bằng SỔ, KHÔNG cộng theo lời khai của kế hoạch", async () => {
    const l = moNhanRoi("gguf:idle", KHOI_30B, { reclaimer: "gguf-idle-model" });
    // Người thi hành GIẢ trả `true` nhưng KHÔNG nhả sổ (đúng ca "sổ khai trống, card vẫn giữ").
    donModelKetQua.value = true;
    const kq = await preempt("interactive", Number.POSITIVE_INFINITY);
    expect(kq.reclaimed).toEqual(["gguf:idle"]);
    expect(kq.freedBytes).toBe(0);          // ← sổ chưa nhả ⇒ KHÔNG được khai đã giành lại 17.000 MiB
    // và khi sổ THẬT SỰ nhả thì con số mới hiện ra
    release(l);
    expect(snapshot().totalReservedBytes).toBe(0);
  });

  it("★★★ người thi hành NÉM ⇒ KHÔNG ném ra ngoài, vào `failed`, và ĐỂ LẠI SỰ KIỆN", async () => {
    moNhanRoi("gguf:idle", KHOI_30B, { reclaimer: "gguf-idle-model" });
    donModelKetQua.value = "THROW";
    const kq = await preempt("interactive", Number.POSITIVE_INFINITY);
    expect(kq.failed).toEqual(["gguf:idle"]);
    expect(kq.reclaimed).toEqual([]);
    const loi = suKien.filter((e) => e.event === "preempt" && (e.detail as never as Record<string, unknown>)?.reason === "reclaimer-threw");
    expect(loi.length).toBe(1);
  });

  it("★★ KHÔNG một giá trị KHÔNG HỮU HẠN nào rời khỏi `preempt()` vào ống dẫn sự kiện", async () => {
    moNhanRoi("gguf:idle", KHOI_30B, { reclaimer: "gguf-idle-model" });
    await preempt("interactive", Number.POSITIVE_INFINITY, 0);
    expect(suKien.length).toBeGreaterThan(0);
    const quet = (v: unknown, duong: string): string[] => {
      if (typeof v === "number") return Number.isFinite(v) ? [] : [duong];
      if (Array.isArray(v)) return v.flatMap((x, i) => quet(x, `${duong}[${i}]`));
      if (v && typeof v === "object") {
        return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => quet(x, `${duong}.${k}`));
      }
      return [];
    };
    expect(suKien.flatMap((e, i) => quet(e, `sk[${i}]`))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D. VỊ TỪ DÙNG CHUNG `coThiHanhThuHoi()` — mọi nơi tiêu thụ đọc CÙNG một câu trả lời", () => {
  function dungSo() {
    process.env.GGUF_MAX_LOADED_MODELS = "64";
    __resetVramCapsForTests();
    const ho: Array<[string, VramReserveRequest]> = [
      ["gguf:idle", xin("gguf:idle", 6_000 * MIB, { reclaimer: "gguf-idle-model" })],
      ["gguf:busy", xin("gguf:busy", 6_000 * MIB, { reclaimer: "gguf-idle-model" })],
      ["gguf-reranker:bge", xin("gguf-reranker:bge", 600 * MIB)],
      ["sidecar:vision", xin("sidecar:vision", 7_825 * MIB, {
        kind: "external-process", priority: "background", reclaimer: "vision-sidecar",
      })],
      ["sidecar:local-trainer", xin("sidecar:local-trainer", 2_000 * MIB, {
        kind: "external-process", priority: "background",
      })],
    ];
    const ids: Record<string, string> = {};
    for (const [ten, req] of ho) {
      const r = reserve(req, ctx());
      ids[ten] = r.lease!.id;
      if (ten !== "gguf:busy") setLeaseRefCount(r.lease!.id, 0);
    }
    return ids;
  }

  it("★★★ nơi tiêu thụ 1 (`ledgerHolders`) và nơi tiêu thụ 2 (`preemptPlan`) KHỚP NHAU tuyệt đối", () => {
    dungSo();
    const soNoiRong = new Set(
      ledgerHolders().filter((h) => h.reclaimable).map((h) => h.owner),
    );
    const keHoach = new Set(preemptPlan("production", Number.POSITIVE_INFINITY).map((s) => s.owner));
    // Mọi hộ trong kế hoạch PHẢI được sổ khai là thu hồi được …
    for (const o of keHoach) expect(soNoiRong.has(o), `${o} nằm trong kế hoạch mà sổ khai KHÔNG thu hồi được`).toBe(true);
    // … và ngược lại, mọi hộ sổ khai thu hồi được mà `production` có quyền lấy PHẢI vào kế hoạch.
    const coQuyen = new Set(preemptCandidates("production", Number.POSITIVE_INFINITY).map((h) => h.owner));
    for (const o of soNoiRong) {
      if (coQuyen.has(o)) expect(keHoach.has(o), `${o} sổ khai thu hồi được mà KHÔNG vào kế hoạch`).toBe(true);
    }
    expect([...keHoach].sort()).toEqual(["gguf:idle", "sidecar:vision"]);
  });

  it("★★★ nơi tiêu thụ 3 (câu từ chối) — `preemptableBytes` cộng ĐÚNG tập hộ thu hồi được", () => {
    dungSo();
    const r = reserve(xin("gguf:new", 30_000 * MIB, { priority: "production" }), ctx());
    expect(r.lease).toBeNull();
    const f = r.refusal!;
    const thuHoiDuoc = f.preemptable.filter((h) => h.reclaimable);
    expect(thuHoiDuoc.map((h) => h.owner).sort()).toEqual(["gguf:idle", "sidecar:vision"]);
    expect(f.preemptableBytes).toBe(thuHoiDuoc.reduce((s, h) => s + h.bytes, 0));
    // và hộ CÓ QUYỀN nhưng KHÔNG ai dọn được vẫn được GỌI TÊN, chỉ là không vào tổng
    expect(f.preemptable.map((h) => h.owner)).toContain("sidecar:local-trainer");
  });

  it("★★★ HAI ĐIỀU KIỆN, cả hai đều CẦN: khai người thi hành **và** NHÀN RỖI", () => {
    const ids = dungSo();
    const tim = (o: string) => ledgerHolders().find((h) => h.owner === o)!;
    expect(tim("gguf:idle").reclaimable).toBe(true);
    expect(tim("gguf:busy").reclaimable).toBe(false);          // có người dọn nhưng ĐANG DÙNG
    expect(tim("gguf-reranker:bge").reclaimable).toBe(false);  // nhàn rỗi nhưng KHÔNG ai dọn
    // đảo trạng thái ⇒ câu trả lời đảo theo, ở CẢ hai nơi tiêu thụ
    setLeaseRefCount(ids["gguf:busy"]!, 0);
    expect(tim("gguf:busy").reclaimable).toBe(true);
    expect(preemptPlan("production", Number.POSITIVE_INFINITY).map((s) => s.owner)).toContain("gguf:busy");
  });

  it("★★ vị từ trả TÊN NGƯỜI THI HÀNH (không phải boolean) ⇒ bản sao viết tay không lái được lượt thi hành", () => {
    dungSo();
    for (const s of preemptPlan("production", Number.POSITIVE_INFINITY)) {
      // `reclaimer` là `VramReclaimerId` — chỉ `nguoiThiHanhThuHoi()` đẻ ra được giá trị này.
      expect(["gguf-idle-model", "vision-sidecar"]).toContain(s.reclaimer);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("E. `AI_SESSION_CACHE_MAX` — MỘT người đọc cho CẢ HAI kho phiên ONNX", () => {
  it("mặc định 5, và `ai/ocrService` + `aiInferenceEngine` đọc CÙNG một hàm", async () => {
    expect(sessionCacheMax()).toBe(5);
    process.env.AI_SESSION_CACHE_MAX = "3";
    __resetVramCapsForTests();
    expect(sessionCacheMax()).toBe(3);

    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const goc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    for (const f of ["server/services/aiInferenceEngine.ts", "server/services/ai/ocrService.ts"]) {
      const src = readFileSync(join(goc, f), "utf8");
      expect(src, `${f} phải NHẬP trần từ vramCaps`).toMatch(/from "\.\.?\/(\.\.\/)?vram\/vramCaps"/);
      // ⚠ Ca này canh SỰ HIỆN DIỆN của một người đọc duy nhất; hành vi "kho có trần" được canh
      // bằng ca hành vi ở `ai/ocrService` (xem `donKhoPhienOcr`) và `aiInferenceEngine`.
      expect(src).not.toMatch(/process\.env\.AI_SESSION_CACHE_MAX/);
    }
  });

  it("★★ `recSessionCache` của ocrService KHÔNG còn là `Map` không giới hạn", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const goc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const src = readFileSync(join(goc, "server/services/ai/ocrService.ts"), "utf8");
    // có một lượt dọn, và nó chạy trên đường ghi cache
    expect(src).toMatch(/function donKhoPhienOcr\(\)/);
    expect(src).toMatch(/recSessionCache\.set\(modelPath, session\);\s*\n[\s\S]{0,200}?donKhoPhienOcr\(\);/);
  });
});
