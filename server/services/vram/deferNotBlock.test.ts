/**
 * ★★★ Pha 2B Task 6 — HOÃN, KHÔNG CHẶN (§5.4).
 *
 * Điều kiện ra số **6** của Pha 2B, viết nguyên văn:
 *
 *        KHÔNG ĐƯỜNG NÀO ĐỂ MỘT LƯỢT `kb:sync` BIẾN MẤT MÀ KHÔNG ĐỂ LẠI VẾT.
 *
 * ⚠⚠ BÀN GIAO CỨNG TỪ TASK 5 — nó quyết định bộ test này đọc tín hiệu ở ĐÂU. Một lượt `kb:sync` bị
 * cổng sổ từ chối **hiện đã**: trả `{skipped: true, reason: "vram_refused"}`, ghi
 * `lastRunStats.reason`, trả cờ `running` trong `finally`, **không ném**, và **không** lùi một lượt
 * sync đã thành công ở cổng eval. Đó là **vết THẬT**. (Báo cáo Task 5 từng khai "để lại vết" khi
 * vết đó mới chỉ là `console` — N-2 đã sửa. Đi tìm ở chỗ khác là xây cơ chế hoãn trên một tín hiệu
 * không tồn tại.)
 *
 * Task 5 KHÔNG có: lùi dần · đáy · tiếng kêu khi quá đáy. Đó là toàn bộ việc của Task 6, và bộ
 * test này chia làm bốn tầng, mỗi tầng trả lời một câu hỏi khác nhau:
 *
 *   §1 NGƯỜI QUYẾT ĐỊNH (`planKbSyncDefer`) — thuần, không đồng hồ, không hẹn giờ. Đây là chỗ
 *      DUY NHẤT quyết định "thử lại" hay "quá đáy", nên cũng là chỗ đột biến rẻ nhất và sắc nhất.
 *   §2 SỢI DÂY CẤU HÌNH (`kbSyncDeferBudgetMs`) — mỗi `?? <mặc_định>` cho một đường ra là một
 *      DÂY, và dây thì phải có LƯỚI (quy tắc Task 3, đã trả giá hai lần). Đáy là dây NGUY HIỂM
 *      NHẤT của task này: nó là thứ duy nhất biến "hoãn" thành "hoãn CÓ ĐÁY".
 *   §3 "AI ĐANG GIỮ CHỖ" (`readKbSyncRefusalNote`) — và đặc biệt: `[]` phải phân biệt được với
 *      "không đọc được". Một `?? []` ở đây biến câu *"tôi không biết"* thành *"tôi đã kiểm và
 *      không có ai"*, đúng lớp lỗi đắt nhất của cả chuỗi này.
 *   §4 VÒNG ĐỜI THẬT — `runKbSyncNow()` qua đúng đường sản xuất, với đồng hồ giả, chứng minh cả
 *      chuỗi 8 lượt từ 03:00 tới quá đáy, và chứng minh mọi lượt đều để lại vết.
 *
 * ⚠ Mọi thứ đều mock: `node:fs` (bộ nhớ), `node:child_process` (không tiến trình thật nào),
 * `./vramWiring` (cổng sổ có thể từ chối), `./vramEventLog` (bắt sự kiện). Không lượt `kb:sync`
 * thật, không file `knowledge/**` thật nào bị đụng, không DB.
 *
 * ⚠ `logVramEvent` được mock thành hàm CHÉP THẲNG, **cố ý không chạy `sanitizeVramEvent()`**: bộ
 * làm sạch ở cửa vào hàng đợi là lớp thứ hai; ca "không giá trị không hữu hạn nào" ở §4 phải
 * chứng minh **NGUỒN** sạch, chứ không phải bộ lọc sạch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";

vi.hoisted(() => {
  process.env.KB_AUTOSYNC_ENABLED = "true";
});

// ─── node:fs — kho trong bộ nhớ (tối thiểu: countChunks + ảnh chụp của cổng eval) ─────────────
const fsStore = new Map<string, string>();
const fsExist = new Set<string>();
let tmpDirCounter = 0;

vi.mock("node:fs", () => {
  const api = {
    existsSync: (p: string) => fsExist.has(p),
    readFileSync: (p: string) => {
      if (!fsStore.has(p)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file, open '${p}'`);
        err.code = "ENOENT";
        throw err;
      }
      return fsStore.get(p)!;
    },
    writeFileSync: (p: string, data: string) => {
      fsStore.set(p, String(data));
      fsExist.add(p);
    },
    copyFileSync: (src: string, dst: string) => {
      if (!fsStore.has(src)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file, copyfile '${src}'`);
        err.code = "ENOENT";
        throw err;
      }
      fsStore.set(dst, fsStore.get(src)!);
      fsExist.add(dst);
    },
    unlinkSync: (p: string) => {
      fsStore.delete(p);
      fsExist.delete(p);
    },
    mkdirSync: (p: string) => {
      fsExist.add(p);
    },
    mkdtempSync: (prefix: string) => {
      const dir = `${prefix}${tmpDirCounter++}`;
      fsExist.add(dir);
      return dir;
    },
    rmSync: (p: string) => {
      fsExist.delete(p);
      fsStore.delete(p);
      const pre1 = `${p}${path.sep}`;
      const pre2 = `${p}/`;
      for (const k of [...fsExist]) if (k.startsWith(pre1) || k.startsWith(pre2)) fsExist.delete(k);
      for (const k of [...fsStore.keys()]) if (k.startsWith(pre1) || k.startsWith(pre2)) fsStore.delete(k);
    },
  };
  return { default: api, ...api };
});

// ─── ./vramEventLog — BẮT sự kiện (`defer` / `defer_exceeded`) ────────────────────────────────
const suKien = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => {
    suKien.push(e);
  },
  sanitizeVramEvent: (e: unknown) => e,
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

// ─── ./vramWiring — cổng SỔ, ba hành vi ───────────────────────────────────────────────────────
/**
 * ⚠ Lỗi giả được nhận diện bằng `Error.name` — ĐÚNG cách `isVramRefusal()` nhận diện, nên bộ test
 * này cũng chứng minh vị từ đó đi qua được ranh giới `await import()` (thứ `instanceof` KHÔNG làm
 * được dưới `vi.mock`).
 *
 * `"treo"` = lời gọi `beginVramAllocation()` **chưa trả lời** — mô phỏng đúng cửa sổ mà `running`
 * đã là `true` nhưng giấy phép chưa có. Đó là ca duy nhất khiến một lượt thử lại rơi vào
 * `already_running`, và là lý do lưới `ensureDeferArmed()` tồn tại.
 */
type CongSo = "cap" | "tuChoi" | "treo";
const gate = vi.hoisted(() => ({
  che_do: "cap" as CongSo,
  soLuotXin: 0,
  moKhoaTreo: null as (() => void) | null,
  /** `facts` gắn vào lời từ chối — đổi được từng ca (kể cả BỎ HẲN, xem §3). */
  facts: undefined as unknown,
}));

vi.mock("./vramWiring", () => ({
  beginVramAllocation: async (opts: { owner: string }) => {
    if (opts.owner !== "cron:kb-sync") {
      return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
    }
    gate.soLuotXin++;
    if (gate.che_do === "treo") {
      await new Promise<void>((r) => {
        gate.moKhoaTreo = r;
      });
      return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
    }
    if (gate.che_do === "tuChoi") {
      const err = new Error(
        "Không đủ VRAM cho cron:kb-sync (mức background): xin 1251 MiB, còn 12 MiB.",
      );
      err.name = "VramRefusedError";
      if (gate.facts !== undefined) (err as unknown as { facts: unknown }).facts = gate.facts;
      throw err;
    }
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  },
  CUDA_BACKEND_FALLBACK_BYTES: 452_595_712,
}));

// ─── ../../db/connection — MỘT dòng `vram_events` cho đường khôi phục sau khởi động lại (I-1) ──
/**
 * ⚠ Mặc định `coDb = false` ⇒ `getDb()` trả `null` ⇒ **không** khôi phục gì — đúng hình dạng của
 * mọi ca khác trong file này, và đúng hình dạng của một cài đặt không DB (giới hạn đã khai).
 * Chuỗi builder của drizzle được giả bằng một object tự-trả-về, kết thúc ở `.limit()` (chỗ duy
 * nhất mã sản xuất `await`).
 */
const kho = vi.hoisted(() => ({ coDb: false, rows: [] as Record<string, unknown>[] }));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    if (!kho.coDb) return null;
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "orderBy"]) chain[k] = () => chain;
    chain.limit = async () => kho.rows;
    return chain;
  },
}));

// ─── node:child_process ───────────────────────────────────────────────────────────────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
  }
}
const spawnCalls: string[][] = [];
const spawnMock = vi.fn((cmd: string, args: string[]) => {
  spawnCalls.push([cmd, ...args]);
  const child = new FakeChild();
  queueMicrotask(() => child.emit("close", 0));
  return child;
});
vi.mock("node:child_process", () => ({
  spawn: (...a: [string, string[], Record<string, unknown>?]) =>
    (spawnMock as unknown as (...a: unknown[]) => FakeChild)(...a),
}));

import {
  runKbSyncNow,
  startKbSyncScheduler,
  stopKbSyncScheduler,
  getKbSyncSchedulerStatus,
  planKbSyncDefer,
  planKbSyncDeferResume,
  resumeKbSyncDeferFromLog,
  kbSyncDeferBudgetMs,
  kbSyncDeferStreakIsAlive,
  readKbSyncRefusalNote,
  __resetKbSyncDeferForTests,
  __hasKbSyncDeferTimer,
} from "../kbSyncScheduler";

const PHUT = 60 * 1000;
const GIO = 60 * PHUT;
const MIB = 1024 * 1024;

/**
 * Hai hộ đang giữ chỗ — đúng hình dạng `VramRefusalFacts` mà Task 4/5 dựng, và dùng lại **fixture
 * chuẩn của Pha 2B** (`gguf:fixture-17000`, 17.000 MiB — cùng khối byte mà Ư0 đo được 3 OK/9 hỏng
 * ở `threeOutcomes.test.ts`). Hai hộ CỐ Ý khác nhau ở CẢ BA trục mà cảnh báo phải giữ nguyên:
 * mức ưu tiên · thước đo (`measured`) · có cơ chế thu hồi hay không.
 */
function factsMau() {
  return {
    requestedBytes: 1251 * MIB,
    holders: [
      { owner: "cuda-backend", kind: "gguf-backend", bytes: 432 * MIB, priority: "production", measured: true, reclaimable: false },
      { owner: "gguf:fixture-17000", kind: "gguf-model", bytes: 17_000 * MIB, priority: "interactive", measured: false, reclaimable: true },
    ],
    preemptable: [],
  };
}

beforeEach(() => {
  fsStore.clear();
  fsExist.clear();
  tmpDirCounter = 0;
  suKien.length = 0;
  spawnCalls.length = 0;
  spawnMock.mockClear();
  gate.che_do = "cap";
  gate.soLuotXin = 0;
  gate.moKhoaTreo = null;
  gate.facts = factsMau();
  kho.coDb = false;
  kho.rows = [];
  __resetKbSyncDeferForTests();
  delete process.env.KB_SYNC_MAX_DEFER_HOURS;
  // Cổng eval TẮT mặc định: cơ chế hoãn trực giao với nó. Đúng một ca bật lại (§4).
  process.env.KB_AUTOSYNC_EVAL_GATE = "false";
  const chunks = path.join(process.cwd(), "knowledge", "chunks.jsonl");
  fsStore.set(chunks, "a\nb\nc\n");
  fsExist.add(chunks);
});

afterEach(() => {
  vi.useRealTimers();
  __resetKbSyncDeferForTests();
  delete process.env.KB_SYNC_MAX_DEFER_HOURS;
  delete process.env.KB_AUTOSYNC_EVAL_GATE;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — người quyết định của §5.4 (planKbSyncDefer): thuần, không đồng hồ", () => {
  const DAY_6H = 6 * GIO;

  it("lượt ĐẦU lùi 15 phút (§5.4)", () => {
    const p = planKbSyncDefer({ now: 1_000, firstRefusedAt: 1_000, previousDelayMs: null, budgetMs: DAY_6H });
    expect(p.kind).toBe("retry");
    if (p.kind !== "retry") return;
    expect(p.delayMs).toBe(15 * PHUT);
    expect(p.retryAt).toBe(1_000 + 15 * PHUT);
  });

  it("NHÂN ĐÔI rồi CHẠM TRẦN 60 phút — không bao giờ 120", () => {
    const b = (prev: number) =>
      planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: prev, budgetMs: Number.MAX_SAFE_INTEGER });
    const d = (prev: number) => {
      const p = b(prev);
      return p.kind === "retry" ? p.delayMs : -1;
    };
    expect(d(15 * PHUT)).toBe(30 * PHUT);
    expect(d(30 * PHUT)).toBe(60 * PHUT);
    expect(d(60 * PHUT)).toBe(60 * PHUT); // TRẦN — không lên 120
    expect(d(45 * PHUT)).toBe(60 * PHUT); // min(90, 60)
  });

  /**
   * ★★★ ĐÁY. Đây là ca mà đột biến "bỏ đáy 6 giờ" phải làm ĐỎ.
   *
   * Cộng dồn của 15·30·60·60… là 15·45·105·165·225·285·345 phút. Lượt thứ **8** lẽ ra rơi vào
   * phút 405 — NGOÀI ngân sách 360 phút ⇒ không được lên lịch. Mốc dưới đây là **TUYỆT ĐỐI**
   * (phút thật), KHÔNG phải bội số của chính hằng số đang kiểm — bài học (B) của Task 5: một ca
   * tự tham chiếu sống sót được cả đột biến `MAX_SAFE_INTEGER`.
   */
  it("★★★ ĐÁY 6 GIỜ: lượt thứ 8 KHÔNG được lên lịch — nó rơi ra ngoài ngân sách", () => {
    const moc = [0, 15, 45, 105, 165, 225, 285].map((m) => m * PHUT);
    const delay = [null, 15, 30, 60, 60, 60, 60].map((d) => (d === null ? null : d * PHUT));
    for (let i = 0; i < moc.length; i++) {
      const p = planKbSyncDefer({ now: moc[i], firstRefusedAt: 0, previousDelayMs: delay[i], budgetMs: DAY_6H });
      expect(`lượt ${i + 1}: ${p.kind}`).toBe(`lượt ${i + 1}: retry`);
    }
    // lượt 8: đã hoãn 345 phút, lùi tiếp 60 ⇒ 405 > 360
    const cuoi = planKbSyncDefer({ now: 345 * PHUT, firstRefusedAt: 0, previousDelayMs: 60 * PHUT, budgetMs: DAY_6H });
    expect(cuoi.kind).toBe("exceeded");
    if (cuoi.kind !== "exceeded") return;
    expect(cuoi.elapsedMs).toBe(345 * PHUT);
    expect(cuoi.wouldRetryInMs).toBe(60 * PHUT);
  });

  it("đáy vừa ĐỦ cho lượt kế thì vẫn lên lịch — ranh giới `elapsed + delay === budget`", () => {
    const p = planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: 15 * PHUT });
    expect(p.kind).toBe("retry");
    const q = planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: 15 * PHUT - 1 });
    expect(q.kind).toBe("exceeded");
  });

  /**
   * ★★★ `NaN` PHẢI ĐI VÀO "QUÁ ĐÁY", KHÔNG PHẢI "THỬ LẠI".
   *
   * `elapsed + delay > NaN` là `false` ⇒ để phép so sánh tự xử thì mọi đáy hỏng đều thành **hoãn
   * VÔ HẠN, IM LẶNG** — đúng một đường mà §5.4 tồn tại để chặn, và nó sẽ không có ca nào đỏ vì
   * "hoãn thành công" trông y hệt "hoãn đúng".
   */
  it("★★★ đáy/đồng hồ KHÔNG HỮU HẠN ⇒ QUÁ ĐÁY (kêu), KHÔNG phải hoãn vô hạn (im)", () => {
    for (const budgetMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const p = planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs });
      expect(`budget=${budgetMs}: ${p.kind}`).toBe(`budget=${budgetMs}: exceeded`);
    }
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = planKbSyncDefer({ now, firstRefusedAt: 0, previousDelayMs: null, budgetMs: DAY_6H });
      expect(`now=${now}: ${p.kind}`).toBe(`now=${now}: exceeded`);
    }
    const q = planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: Number.NaN, budgetMs: DAY_6H });
    expect(q.kind).toBe("exceeded");
  });

  it("KHÔNG con số nào rời khỏi người quyết định mà không hữu hạn", () => {
    const p = planKbSyncDefer({ now: Number.NaN, firstRefusedAt: 0, previousDelayMs: Number.NaN, budgetMs: Number.NaN });
    expect(p.kind).toBe("exceeded");
    if (p.kind !== "exceeded") return;
    expect(Number.isFinite(p.elapsedMs)).toBe(true);
    expect(Number.isFinite(p.budgetMs)).toBe(true);
    expect(p.wouldRetryInMs === null || Number.isFinite(p.wouldRetryInMs)).toBe(true);
  });

  it("đáy 0 TƯỜNG MINH ⇒ quá đáy ngay lượt đầu (chiều AN TOÀN: ồn hơn, không im hơn)", () => {
    const p = planKbSyncDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: 0 });
    expect(p.kind).toBe("exceeded");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — SỢI DÂY `KB_SYNC_MAX_DEFER_HOURS` (mỗi `?? mặc_định` là một dây ⇒ phải có lưới)", () => {
  it("chưa đặt ⇒ 6 giờ (mặc định của spec §5.4)", () => {
    delete process.env.KB_SYNC_MAX_DEFER_HOURS;
    expect(kbSyncDeferBudgetMs()).toBe(6 * GIO);
  });

  it("đặt một số hợp lệ ⇒ đúng số đó", () => {
    process.env.KB_SYNC_MAX_DEFER_HOURS = "2";
    expect(kbSyncDeferBudgetMs()).toBe(2 * GIO);
    process.env.KB_SYNC_MAX_DEFER_HOURS = "0.5";
    expect(kbSyncDeferBudgetMs()).toBe(30 * PHUT);
  });

  /**
   * ★★ Bẫy (F) của Task 5, tái hiện đúng hình dạng: *"đặt rồi để TRỐNG"*. `Number("")` là **0**,
   * tức "đừng hoãn giây nào" — một lượt đổi chính sách **âm thầm** do một dòng `.env` cụt.
   */
  it('★★ "đặt rồi để trống" ⇒ LỖI CẤU HÌNH: về mặc định 6 giờ và KÊU, KHÔNG âm thầm về 0', () => {
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.KB_SYNC_MAX_DEFER_HOURS = "   ";
    expect(kbSyncDeferBudgetMs()).toBe(6 * GIO);
    expect(kbSyncDeferBudgetMs()).not.toBe(0);
    expect(keu).toHaveBeenCalled();
    keu.mockRestore();
  });

  it("★★★ giá trị vô nghĩa (chữ · âm · Infinity) ⇒ mặc định 6 giờ, KHÔNG để NaN/∞ thành đáy", () => {
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const v of ["abc", "-1", "Infinity", "NaN"]) {
      __resetKbSyncDeferForTests(); // đặt lại chốt "đã kêu"
      process.env.KB_SYNC_MAX_DEFER_HOURS = v;
      const ms = kbSyncDeferBudgetMs();
      expect(`${v} ⇒ ${ms}`).toBe(`${v} ⇒ ${6 * GIO}`);
      expect(Number.isFinite(ms)).toBe(true);
    }
    expect(keu).toHaveBeenCalled();
    keu.mockRestore();
  });

  it('"0" TƯỜNG MINH vẫn hợp lệ — nghĩa "đừng hoãn, kêu ngay"', () => {
    process.env.KB_SYNC_MAX_DEFER_HOURS = "0";
    expect(kbSyncDeferBudgetMs()).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — AI ĐANG GIỮ CHỖ (readKbSyncRefusalNote)", () => {
  function loiTuChoi(facts?: unknown): Error {
    const err = new Error("Không đủ VRAM cho cron:kb-sync (mức background): xin 1251 MiB, còn 12 MiB.");
    err.name = "VramRefusedError";
    if (facts !== undefined) (err as unknown as { facts: unknown }).facts = facts;
    return err;
  }

  it("chép NGUYÊN hộ đang giữ, giữ cả hai thước (`measured`) — Đ4: không trộn, không cộng", () => {
    const note = readKbSyncRefusalNote(loiTuChoi(factsMau()));
    expect(note.holdersKnown).toBe(true);
    expect(note.holders).toHaveLength(2);
    expect(note.holders[0]).toMatchObject({ owner: "cuda-backend", mib: 432, measured: true, reclaimable: false });
    expect(note.holders[1]).toMatchObject({ owner: "gguf:fixture-17000", mib: 17_000, measured: false, reclaimable: true });
    expect(note.requestedBytes).toBe(1251 * MIB);
    // KHÔNG có ô "tổng" nào: cộng một số ĐO với một số ƯỚC LƯỢNG là trộn hai thước (Đ4).
    expect(Object.keys(note)).not.toContain("totalBytes");
  });

  /**
   * ★★★ ĐÂY LÀ CA CHỐNG "DÂY". `isVramRefusal()` nhận diện bằng `Error.name` (cố ý — nó phải đi
   * qua ranh giới `await import()`), nên một lỗi mang đúng tên mà **không** mang `facts` vẫn tới
   * được đây. Nếu `holders: []` là câu trả lời duy nhất thì cảnh báo sẽ nói *"không có ai giữ"* —
   * biến một câu "tôi không biết" thành "tôi đã kiểm và không có gì".
   */
  it("★★★ lời từ chối KHÔNG mang `facts` ⇒ holdersKnown=false — PHÂN BIỆT ĐƯỢC với sổ rỗng", () => {
    const khongCo = readKbSyncRefusalNote(loiTuChoi(undefined));
    expect(khongCo.holdersKnown).toBe(false);
    expect(khongCo.holders).toHaveLength(0);

    const soRong = readKbSyncRefusalNote(loiTuChoi({ holders: [], preemptable: [] }));
    expect(soRong.holdersKnown).toBe(true);
    expect(soRong.holders).toHaveLength(0);

    // hai tình huống KHÁC NHAU ⇒ hai câu trả lời KHÁC NHAU. Đây là toàn bộ điểm của ca này.
    expect(khongCo.holdersKnown).not.toBe(soRong.holdersKnown);
  });

  it("byte không hữu hạn của một hộ ⇒ `\"?\"`, KHÔNG bịa `0` và KHÔNG để NaN đi tiếp", () => {
    const note = readKbSyncRefusalNote(
      loiTuChoi({ holders: [{ owner: "x", kind: "k", bytes: Number.NaN, priority: "background" }] }),
    );
    expect(note.holders[0].mib).toBe("?");
    const note2 = readKbSyncRefusalNote(
      loiTuChoi({ holders: [{ owner: "y", kind: "k", bytes: Number.POSITIVE_INFINITY, priority: "background" }] }),
    );
    expect(note2.holders[0].mib).toBe("?");
  });

  it("`requestedBytes` không hữu hạn ⇒ `null` (cột byte là bigint: một NaN mất CẢ LÔ)", () => {
    const note = readKbSyncRefusalNote(loiTuChoi({ holders: [], requestedBytes: Number.NaN }));
    expect(note.requestedBytes).toBeNull();
  });

  it("KHÔNG BAO GIỜ NÉM — kể cả với `facts` méo mó hoàn toàn", () => {
    for (const f of [null, 42, "chuỗi", { holders: "không phải mảng" }, { holders: [null, undefined] }]) {
      expect(() => readKbSyncRefusalNote(loiTuChoi(f))).not.toThrow();
    }
    expect(() => readKbSyncRefusalNote(undefined)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — VÒNG ĐỜI THẬT qua runKbSyncNow()", () => {
  /** Mọi số trong một object, đệ quy — dùng để chứng minh NGUỒN sạch (không nhờ bộ lọc). */
  function moiSo(v: unknown, duong = "", ra: string[] = []): string[] {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) ra.push(`${duong}=${String(v)}`);
      return ra;
    }
    if (v === null || typeof v !== "object") return ra;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) moiSo(x, duong ? `${duong}.${k}` : k, ra);
    return ra;
  }
  const suKienTen = () => suKien.map((e) => String(e.event));

  it("★★★ BỊ TỪ CHỐI ⇒ HOÃN (không hỏng, không bỏ qua): 15 phút, hẹn giờ SỐNG, vết đủ 3 đường", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T03:00:00.000Z"));
    gate.che_do = "tuChoi";

    const stats = await runKbSyncNow();

    // (a) hợp đồng "never throws" + cờ được trả (bàn giao C-1 của Task 5, không được vỡ)
    expect(stats.skipped).toBe(true);
    expect(stats.reason).toBe("vram_refused");
    expect(getKbSyncSchedulerStatus().running).toBe(false);
    expect(spawnCalls).toHaveLength(0); // từ chối xảy ra TRƯỚC spawn

    // (b) VẾT 1 — máy đọc được qua lastRunStats
    expect(stats.defer).toBeDefined();
    expect(stats.defer?.exceeded).toBe(false);
    expect(stats.defer?.attempts).toBe(1);
    expect(stats.defer?.nextDelayMs).toBe(15 * PHUT);
    expect(stats.defer?.nextRetryAt).toBe("2026-08-05T03:15:00.000Z");
    expect(stats.defer?.deadlineAt).toBe("2026-08-05T09:00:00.000Z"); // 03:00 + 6 giờ

    // (c) VẾT 2 — sự kiện BỀN, truy được bằng SQL
    expect(suKienTen()).toEqual(["defer"]);
    expect(suKien[0]).toMatchObject({ event: "defer", owner: "cron:kb-sync", priority: "background", leaseKind: "external-process" });

    // (d) VẾT 3 — trạng thái sống + hẹn giờ THẬT SỰ được vũ trang
    expect(__hasKbSyncDeferTimer()).toBe(true);
    expect(getKbSyncSchedulerStatus().defer?.attempts).toBe(1);
  });

  it("★★★ hẹn giờ NỔ ⇒ chạy lại THẬT, và lượt từ chối kế lùi GẤP ĐÔI (15 → 30)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T03:00:00.000Z"));
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    expect(gate.soLuotXin).toBe(1);

    await vi.advanceTimersByTimeAsync(15 * PHUT);

    expect(gate.soLuotXin).toBe(2); // ĐÃ THỬ LẠI THẬT — không phải chỉ đặt cờ
    const d = getKbSyncSchedulerStatus().defer;
    expect(d?.attempts).toBe(2);
    expect(d?.nextDelayMs).toBe(30 * PHUT);
    expect(d?.nextRetryAt).toBe("2026-08-05T03:45:00.000Z");
    expect(suKienTen()).toEqual(["defer", "defer"]);
  });

  it("★★★ ĐƯỢC CẤP ⇒ chuỗi hoãn KẾT THÚC: trạng thái xoá, hẹn giờ gỡ, sync chạy thật", async () => {
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    expect(__hasKbSyncDeferTimer()).toBe(true);

    gate.che_do = "cap";
    await vi.advanceTimersByTimeAsync(15 * PHUT);

    expect(getKbSyncSchedulerStatus().defer).toBeNull();
    expect(__hasKbSyncDeferTimer()).toBe(false);
    expect(spawnCalls.some((c) => c[0] === "npm")).toBe(true);
  });

  /**
   * ★★★ CA TRUNG TÂM CỦA TASK. Đột biến "bỏ `defer_exceeded`" và "bỏ đáy 6 giờ" đều phải làm ĐỎ ca
   * này. Đồng hồ chạy nguyên một đêm 03:00 → 09:00+ với cổng sổ từ chối LIÊN TỤC.
   */
  it("★★★ QUÁ ĐÁY (6 giờ) ⇒ `defer_exceeded` + CẢNH BÁO NÊU AI ĐANG GIỮ CHỖ, và NGỪNG thử lại", async () => {
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T03:00:00.000Z"));
    gate.che_do = "tuChoi";

    await runKbSyncNow(); // 03:00 — lượt 1
    await vi.advanceTimersByTimeAsync(7 * GIO); // cả đêm

    // đúng 8 lượt xin (15·45·105·165·225·285·345 phút + lượt đầu), lượt 8 rơi ra ngoài đáy
    expect(gate.soLuotXin).toBe(8);

    const d = getKbSyncSchedulerStatus().defer;
    expect(d?.exceeded).toBe(true);
    expect(d?.attempts).toBe(8);
    expect(d?.nextRetryAt).toBeNull();
    expect(d?.nextDelayMs).toBeNull();
    // NGỪNG thử lại — nhưng KHÔNG âm thầm.
    expect(__hasKbSyncDeferTimer()).toBe(false);

    // ① SỰ KIỆN `defer_exceeded` — đúng MỘT cái, ở CUỐI
    expect(suKienTen()).toEqual(["defer", "defer", "defer", "defer", "defer", "defer", "defer", "defer_exceeded"]);
    const cuoi = suKien[suKien.length - 1];
    expect(cuoi.event).toBe("defer_exceeded");
    const chiTiet = cuoi.detail as Record<string, unknown>;
    expect(chiTiet.attempt).toBe(8);
    expect(chiTiet.budgetMs).toBe(6 * GIO);
    expect(chiTiet.holdersKnown).toBe(true);
    // ② AI ĐANG GIỮ CHỖ — trong sự kiện
    expect(JSON.stringify(chiTiet.holders)).toContain("gguf:fixture-17000");
    expect(JSON.stringify(chiTiet.holders)).toContain("cuda-backend");

    // ③ AI ĐANG GIỮ CHỖ — trong CẢNH BÁO cho người trực
    const canhBao = keu.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(canhBao).toContain("defer_exceeded");
    expect(canhBao).toContain("gguf:fixture-17000");
    expect(canhBao).toContain("cuda-backend");
    // ④ trỏ về TÍN HIỆU SẴN CÓ, không phát minh biển báo mới
    expect(canhBao).toContain("staleDays");
    keu.mockRestore();
  });

  /**
   * ★★★ ĐIỀU KIỆN RA SỐ 6, phát biểu trực tiếp: quét CẢ CHUỖI và khẳng định **mỗi** lượt xin bị
   * từ chối đều có một sự kiện tương ứng. Đột biến "cho một lượt biến mất không vết" (bỏ lời gọi
   * ghi sự kiện, hoặc bỏ `lastRunStats`) phải làm ca này ĐỎ.
   */
  it("★★★ KHÔNG lượt nào biến mất không vết: #lượt xin === #sự kiện, và lượt cuối vào lastRunStats", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";

    await runKbSyncNow();
    await vi.advanceTimersByTimeAsync(7 * GIO);

    expect(suKien).toHaveLength(gate.soLuotXin);
    expect(suKien.every((e) => e.event === "defer" || e.event === "defer_exceeded")).toBe(true);

    const tt = getKbSyncSchedulerStatus();
    expect(tt.lastRunStats?.reason).toBe("vram_refused");
    expect(tt.lastRunStats?.skipped).toBe(true);
    expect(tt.lastRunStats?.defer?.exceeded).toBe(true);
    expect(tt.lastRunAt).toBeInstanceOf(Date);
    expect(tt.running).toBe(false);
  });

  /**
   * ★★★ (B) của review — LƯỚI CỦA CHÍNH TASK 6, KHÔNG PHẢI LƯỚI THỪA KẾ.
   *
   * Đột biến của reviewer (*"chỉ ghi `lastRunStats` khi `defer === null || defer.exceeded`"*) cho
   * **1 đỏ / 500** — nhưng ca đỏ đó nằm ở **FILE KỀ BÊN** (ca `C-1` của Task 5). Cả 28 ca của Task
   * 6 XANH, vì ca `KHÔNG lượt nào biến mất không vết` đếm **sự kiện** (vết #2) rồi đọc
   * `lastRunStats` **đúng một lần, sau khi đã quá đáy** — tức chỉ khoá lượt CUỐI. Vết #1 của **7
   * lượt giữa** là vết THỪA KẾ: ngày nào ai sửa ca C-1 của Task 5, lớp bảo vệ ấy rơi mà không ai đỏ.
   *
   * Ca này khoá **TỪNG LƯỢT**: sau mỗi nhịp hẹn giờ, `lastRunStats` phải là của **lượt vừa rồi**.
   */
  it("★★★ (B) MỌI lượt trong chuỗi để lại vết #1 — không chỉ lượt CUỐI", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    const vet = () => {
      const st = getKbSyncSchedulerStatus().lastRunStats;
      return `${st?.reason}/${st?.defer?.attempts}/${st?.defer?.exceeded}`;
    };

    await runKbSyncNow();
    expect(`lượt 1: ${vet()}`).toBe("lượt 1: vram_refused/1/false");

    // các nhịp đưa chuỗi tới lượt 2…7 (15 → 30 → 60 → 60 → 60 → 60), tất cả CÒN TRONG đáy
    const buoc = [15, 30, 60, 60, 60, 60].map((m) => m * PHUT);
    let n = 1;
    for (const d of buoc) {
      await vi.advanceTimersByTimeAsync(d);
      n++;
      expect(`lượt ${n}: ${vet()}`).toBe(`lượt ${n}: vram_refused/${n}/false`);
    }
    expect(gate.soLuotXin).toBe(7);
  });

  it("★★ KHÔNG một giá trị KHÔNG HỮU HẠN nào rời khỏi NGUỒN vào ống dẫn sự kiện", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    // đầu vào BẨN ở mọi ô có thể: byte hộ, byte đang xin, và một đáy vô nghĩa
    process.env.KB_SYNC_MAX_DEFER_HOURS = "không-phải-số";
    gate.facts = {
      requestedBytes: Number.POSITIVE_INFINITY,
      holders: [{ owner: "x", kind: "k", bytes: Number.NaN, priority: "background", measured: true, reclaimable: false }],
      preemptable: [],
    };
    gate.che_do = "tuChoi";

    await runKbSyncNow();
    await vi.advanceTimersByTimeAsync(7 * GIO);

    expect(suKien.length).toBeGreaterThan(0);
    for (const e of suKien) {
      expect(moiSo(e)).toEqual([]); // KHÔNG NaN/±Infinity ở bất kỳ độ sâu nào
      // cột byte `bigint`: hoặc VẮNG hẳn, hoặc là một số hữu hạn — không bao giờ NaN/∞
      if (e.estimatedBytes !== undefined) expect(Number.isFinite(e.estimatedBytes as number)).toBe(true);
    }
    // …và một đáy vô nghĩa KHÔNG biến thành hoãn vô hạn: chuỗi vẫn kết thúc bằng tiếng kêu
    expect(suKienTen()).toContain("defer_exceeded");
  });

  it("★★ chuỗi MỚI sau khi quá đáy (cron đêm sau) mở lại ngân sách — không kêu MỘT lần rồi câm", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    await vi.advanceTimersByTimeAsync(7 * GIO);
    expect(getKbSyncSchedulerStatus().defer?.exceeded).toBe(true);

    suKien.length = 0;
    await runKbSyncNow(); // "cron 03:00 đêm sau"

    const d = getKbSyncSchedulerStatus().defer;
    expect(d?.exceeded).toBe(false);
    expect(d?.attempts).toBe(1);
    expect(d?.nextDelayMs).toBe(15 * PHUT);
    expect(suKienTen()).toEqual(["defer"]);
    expect(__hasKbSyncDeferTimer()).toBe(true);
  });

  /**
   * ★★★ LƯỚI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE (bài học Task 5). Lượt thử lại rơi vào
   * `already_running` — nhánh đó KHÔNG vũ trang gì cả. Thiếu `ensureDeferArmed()`, chuỗi hoãn
   * đứng im vĩnh viễn với `nextRetryAt` đã qua: một lượt `kb:sync` biến mất, im lặng.
   */
  it("★★★ lượt thử lại rơi vào `already_running` ⇒ chuỗi VẪN được vũ trang lại (không đứng im)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    expect(__hasKbSyncDeferTimer()).toBe(true);

    // một lượt khác đang giữ cờ `running` NHƯNG chưa có giấy phép (cửa sổ thật, hẹp)
    gate.che_do = "treo";
    const dangChay = runKbSyncNow();
    await Promise.resolve();
    expect(getKbSyncSchedulerStatus().running).toBe(true);

    await vi.advanceTimersByTimeAsync(15 * PHUT);

    // lượt thử lại đã trả `already_running` — và chuỗi KHÔNG bị bỏ rơi
    expect(getKbSyncSchedulerStatus().defer).not.toBeNull();
    expect(__hasKbSyncDeferTimer()).toBe(true);

    // dọn: mở khoá cho lượt đang treo chạy nốt
    gate.moKhoaTreo?.();
    await vi.advanceTimersByTimeAsync(1);
    await dangChay;
  });

  it("cổng eval BẬT: lượt bị từ chối vẫn dọn ảnh chụp KB và vẫn hoãn (hai việc không cản nhau)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    process.env.KB_AUTOSYNC_EVAL_GATE = "true";
    gate.che_do = "tuChoi";

    const stats = await runKbSyncNow();

    expect(stats.reason).toBe("vram_refused");
    expect(stats.defer?.exceeded).toBe(false);
    // không thư mục tạm nào còn lại trên "đĩa"
    expect([...fsExist].filter((p) => p.includes("kb-eval-gate-backup"))).toEqual([]);
  });

  it("`stopKbSyncScheduler()` gỡ luôn hẹn giờ HOÃN — không để nó nổ ở tiến trình đang tắt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    expect(__hasKbSyncDeferTimer()).toBe(true);

    stopKbSyncScheduler();

    expect(__hasKbSyncDeferTimer()).toBe(false);
    const truoc = gate.soLuotXin;
    await vi.advanceTimersByTimeAsync(2 * GIO);
    expect(gate.soLuotXin).toBe(truoc); // không lượt thử lại nào nổ sau khi đã tắt
  });

  it("cơ chế hoãn KHÔNG được là chốt thứ hai: sau chuỗi hoãn, một lượt gọi tay vẫn chạy được", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    await vi.advanceTimersByTimeAsync(7 * GIO);
    expect(getKbSyncSchedulerStatus().defer?.exceeded).toBe(true);

    gate.che_do = "cap";
    const lai = await runKbSyncNow();

    expect(lai.reason).not.toBe("already_running");
    expect(lai.ok).toBe(true);
    expect(getKbSyncSchedulerStatus().defer).toBeNull();
    expect(getKbSyncSchedulerStatus().running).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §5 — VÒNG SỬA 1 (review): I-1 khôi phục qua khởi động lại · I-2 vị từ dùng chung · M-1·M-2·M-4·M-6
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — I-2: VỊ TỪ DÙNG CHUNG *chuỗi hoãn còn sống không*", () => {
  /**
   * ★★★ Đột biến (D) của review — bỏ `s.exceeded ||` khỏi bản sao THỨ HAI — cho **0 đỏ / 500**:
   * bản sao ấy không được ghim bởi bất kỳ ca nào. Nay chỉ còn MỘT bản cài đặt, và ca này ghim
   * **từng mệnh đề RIÊNG**.
   *
   * ⚠⚠ VÒNG SỬA 2 — LƯỚI THẬT KHÔNG PHẢI CA NÀY, MÀ LÀ **KIỂU**. Bản đầu của tôi giữ
   * `{ exceeded, nextRetryAt }` và ghim bốn tổ hợp; nhưng đột biến nguy hiểm nhất của reviewer
   * (*người TIÊU THỤ tự viết lại vị từ, quên `exceeded`*) vẫn **0 đỏ** — vì dưới bất biến của
   * người sản xuất, hai cách viết trùng nhau và **không ca hành vi nào phân biệt nổi**.
   * ⇒ `DeferStreak` nay là **hai BIẾN THỂ**, và biến thể `"exceeded"` **không có trường
   * `nextRetryAt`** ⇒ bản sao thứ hai **không viết ra được** (`tsc` chặn), và nếu lách qua `tsc`
   * thì ca `already-exceeded` bên dưới ĐỎ. Ca này chỉ còn là lưới cho chính vị từ.
   */
  it("★★★ (I-2) ba đầu vào, ghim TRỰC TIẾP — đảo vị từ là ĐỎ", () => {
    expect(kbSyncDeferStreakIsAlive(null)).toBe(false);
    expect(kbSyncDeferStreakIsAlive({ kind: "alive" })).toBe(true);
    // ↓ hướng hỏng NGUY HIỂM NHẤT: vũ trang lại một chuỗi đã tuyên bố quá đáy ⇒ cơ chế
    //   chống-hoãn-mãi tự phá chính nó, sau khi đã kêu "NGỪNG thử lại".
    expect(kbSyncDeferStreakIsAlive({ kind: "exceeded" })).toBe(false);
  });
});

describe("§5 — I-1: chuỗi hoãn SỐNG QUA một lần khởi động lại (đọc ngược vram_events, KHÔNG DDL)", () => {
  const T0 = Date.parse("2026-08-05T03:00:00.000Z");
  function detailDefer(over: Record<string, unknown> = {}) {
    return {
      attempt: 3,
      firstRefusedAt: "2026-08-05T03:00:00.000Z",
      deadlineAt: "2026-08-05T09:00:00.000Z",
      budgetMs: 6 * GIO,
      delayMs: 60 * PHUT,
      nextRetryAt: "2026-08-05T04:45:00.000Z",
      holdersKnown: true,
      holders: [
        { owner: "gguf:fixture-17000", kind: "gguf-model", mib: 17_000, priority: "interactive", measured: false, reclaimable: true },
      ],
      refusalMessage: "Không đủ VRAM cho cron:kb-sync (mức background): xin 1251 MiB, còn 12 MiB.",
      ...over,
    };
  }
  function dongLog(event: string, detail: unknown) {
    kho.coDb = true;
    kho.rows = [{ event, detail }];
  }

  // ── người quyết định thuần ──────────────────────────────────────────────────────────────────
  it("thuần: dòng `defer` còn trong ngân sách ⇒ `resume` + đúng mốc", () => {
    const p = planKbSyncDeferResume({ now: T0 + 90 * PHUT, event: "defer", detail: detailDefer() });
    expect(p.kind).toBe("resume");
    if (p.kind === "none") return;
    expect(p.attempts).toBe(3);
    expect(p.firstRefusedAt).toBe(T0);
    expect(p.lastDelayMs).toBe(60 * PHUT);
    expect(p.nextRetryAt).toBe(Date.parse("2026-08-05T04:45:00.000Z"));
  });

  it("★★ thuần: dòng `defer` mà ĐÁY ĐÃ QUA lúc tiến trình chết ⇒ `overdue` (nợ một tiếng kêu)", () => {
    const p = planKbSyncDeferResume({ now: T0 + 7 * GIO, event: "defer", detail: detailDefer() });
    expect(p.kind).toBe("overdue");
    if (p.kind === "none") return;
    expect(p.nextRetryAt).toBeNull();
  });

  it("thuần: dòng `defer_exceeded` ⇒ `already-exceeded` (đêm trước đã kêu, KHÔNG kêu lại)", () => {
    const p = planKbSyncDeferResume({ now: T0 + 30 * PHUT, event: "defer_exceeded", detail: detailDefer({ attempt: 8 }) });
    expect(p.kind).toBe("already-exceeded");
  });

  /**
   * ★★★ FAIL-CLOSED. Mỗi ô hỏng ở đây, nếu được "khôi phục" thay vì bị từ chối, sẽ dựng lại một
   * chuỗi có đáy `NaN`/thiếu mốc ⇒ **hoãn vô hạn, im lặng** — đúng đường §5.4 tồn tại để chặn.
   * ⚠ Ô `budgetMs: "NaN"` là **mìn M-3 có thật**: `soHuuHan()` ghi NHÃN CHUỖI vào `detail`.
   */
  it("★★★ thuần: MỌI dòng méo mó ⇒ `none` (mở chuỗi mới, đáy đầy đủ) — KHÔNG khôi phục rác", () => {
    const xau: Array<[string, unknown, unknown]> = [
      ["không phải sự kiện hoãn", "reserve", detailDefer()],
      ["không có detail", "defer", null],
      ["detail không phải object", "defer", 42],
      ["thiếu firstRefusedAt", "defer", detailDefer({ firstRefusedAt: undefined })],
      ["firstRefusedAt không phải ngày", "defer", detailDefer({ firstRefusedAt: "hôm-qua" })],
      ["budgetMs là NHÃN CHUỖI (mìn M-3)", "defer", detailDefer({ budgetMs: "NaN" })],
      ["budgetMs là chuỗi số", "defer", detailDefer({ budgetMs: "21600000" })],
      ["attempt = 0", "defer", detailDefer({ attempt: 0 })],
      ["thiếu nextRetryAt", "defer", detailDefer({ nextRetryAt: undefined })],
      ["không có dòng nào", null, null],
    ];
    for (const [ten, event, detail] of xau) {
      const p = planKbSyncDeferResume({
        now: T0 + 30 * PHUT,
        event: event as string | null,
        detail: detail as Record<string, unknown> | null,
      });
      expect(`${ten}: ${p.kind}`).toBe(`${ten}: none`);
    }
  });

  it("thuần: `now` không hữu hạn ⇒ `overdue` (KÊU), không phải `resume` (IM)", () => {
    const p = planKbSyncDeferResume({ now: Number.NaN, event: "defer", detail: detailDefer() });
    expect(p.kind).toBe("overdue");
  });

  /**
   * ★★★ Pha 3 Task 5 (D) — **"KHÔNG ĐỌC ĐƯỢC" ≠ "KHÔNG CÓ DÒNG NÀO".**
   *
   * Bản Task 6 ép cả hai về `event: null` ⇒ cùng lý do `"khong-co-dong-hoan-nao"`. Hậu quả ở cài
   * đặt **không DB**: mỗi lượt khởi động lại kết luận *"đêm qua không có lượt hoãn nào"* — một câu
   * KHẲNG ĐỊNH dựng trên chỗ không có dữ liệu — nên đáy 6 giờ không bao giờ chạm tới và
   * `defer_exceeded` **không bao giờ kêu**. Task 5 không vá được cái mù (không kho bền thì không
   * có gì để đọc lại), nhưng bắt nó phải **CÓ TÊN**.
   *
   * ⚠ Cả hai vẫn cho `kind: "none"` — hành vi ĐÚNG, và đó là lý do một ca chỉ nhìn `kind` sẽ
   * **KHÔNG BAO GIỜ ĐỎ** dưới đột biến "bỏ vế `docDuoc`". Ca này nhìn `reason`.
   */
  it("★★★ (Task 5 D) KHÔNG ĐỌC ĐƯỢC nhật ký ⇒ lý do RIÊNG, không đội lốt 'không có dòng nào'", () => {
    const mu = planKbSyncDeferResume({ now: T0, event: null, detail: null, docDuoc: false });
    const rong = planKbSyncDeferResume({ now: T0, event: null, detail: null, docDuoc: true });
    expect(mu.kind).toBe("none");
    expect(rong.kind).toBe("none");
    expect(mu.reason, "phải nói ra là MẤT KHẢ NĂNG ĐỌC").toBe("khong-doc-duoc-nhat-ky-hoan");
    expect(rong.reason).toBe("khong-co-dong-hoan-nao");
    expect(mu.reason).not.toBe(rong.reason);
  });

  it("★★ (Task 5 D) `docDuoc: false` THẮNG cả một dòng đọc được — không khôi phục theo dữ liệu mình không đọc nổi", () => {
    const p = planKbSyncDeferResume({
      now: T0 + 30 * PHUT,
      event: "defer",
      detail: detailDefer(),
      docDuoc: false,
    });
    expect(p.kind).toBe("none");
    expect(p.reason).toBe("khong-doc-duoc-nhat-ky-hoan");
  });

  it("★★★ (Task 5 D) KHÔNG CÓ DB ⇒ `resumeKbSyncDeferFromLog()` KÊU MỘT LẦN, không im lặng", async () => {
    const keu = vi.spyOn(console, "warn").mockImplementation(() => {});
    kho.coDb = false;
    kho.rows = [];
    const p = await resumeKbSyncDeferFromLog();
    expect(p.kind).toBe("none");
    expect(p.reason).toBe("khong-doc-duoc-nhat-ky-hoan");
    const dong = keu.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("MẤT KHẢ NĂNG ĐỌC"));
    expect(dong.length, "phải có ĐÚNG một tiếng kêu").toBe(1);
    // Lượt thứ hai KHÔNG được kêu lại (chốt một-lần — cùng kỷ luật `deferBudgetWarned`).
    await resumeKbSyncDeferFromLog();
    expect(keu.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("MẤT KHẢ NĂNG ĐỌC")).length).toBe(1);
    keu.mockRestore();
  });

  // ── vòng đời thật ───────────────────────────────────────────────────────────────────────────
  it("★★★ (I-1) khởi động lại giữa chuỗi ⇒ VŨ TRANG LẠI, và lượt thử lại NỔ THẬT", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T04:00:00.000Z")); // 60' sau khi chuỗi bắt đầu
    dongLog("defer", detailDefer());
    gate.che_do = "tuChoi";

    const plan = await resumeKbSyncDeferFromLog();

    expect(plan.kind).toBe("resume");
    expect(__hasKbSyncDeferTimer()).toBe(true);
    const d = getKbSyncSchedulerStatus().defer;
    expect(d?.attempts).toBe(3);
    expect(d?.exceeded).toBe(false);
    expect(d?.deadlineAt).toBe("2026-08-05T09:00:00.000Z"); // đáy của chuỗi CŨ, không mở lại
    // hộ đang giữ chỗ đọc lại được từ dòng log
    expect(d?.holdersKnown).toBe(true);
    expect(d?.holders[0]?.owner).toBe("gguf:fixture-17000");

    // …và nó NỔ THẬT: 45 phút nữa là 04:45
    await vi.advanceTimersByTimeAsync(45 * PHUT);
    expect(gate.soLuotXin).toBe(1);
    expect(getKbSyncSchedulerStatus().defer?.attempts).toBe(4); // nối tiếp chuỗi CŨ, không về 1
  });

  /**
   * ★★★ CA NÀY LÀ NGƯỜI TIÊU THỤ của vị từ dùng chung (I-2) trên một ĐƯỜNG SẢN XUẤT THẬT.
   * `ensureDeferArmed()` được gọi vô điều kiện ở cuối `resumeKbSyncDeferFromLog()` — chính vị từ
   * phải TỰ từ chối, chứ không phải một `if` rải rác ở ba nhánh.
   */
  it("★★★ (I-2 tiêu thụ) khôi phục dòng `defer_exceeded` ⇒ TUYỆT ĐỐI KHÔNG vũ trang lại", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T04:00:00.000Z"));
    dongLog("defer_exceeded", detailDefer({ attempt: 8 }));
    gate.che_do = "tuChoi";

    const plan = await resumeKbSyncDeferFromLog();

    expect(plan.kind).toBe("already-exceeded");
    expect(__hasKbSyncDeferTimer()).toBe(false);
    const d = getKbSyncSchedulerStatus().defer;
    expect(d?.exceeded).toBe(true);
    expect(d?.nextRetryAt).toBeNull();
    expect(d?.nextDelayMs).toBeNull();
    // KHÔNG kêu lại — đêm trước đã kêu rồi
    expect(suKien).toHaveLength(0);
    // …và 2 giờ sau vẫn không có lượt thử lại nào
    await vi.advanceTimersByTimeAsync(2 * GIO);
    expect(gate.soLuotXin).toBe(0);
  });

  /**
   * ★★★ MÓN NỢ TIẾNG KÊU. Đây là lỗ mà review (I-1) gọi tên: trong một vòng khởi-động-lại lặp,
   * `defer_exceeded` **không bao giờ kêu**. Nay nó kêu — MUỘN, và **tự khai là muộn**.
   */
  it("★★★ (I-1) đáy đã qua lúc tiến trình chết ⇒ PHÁT `defer_exceeded` NGAY, có nhãn phát-muộn", async () => {
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T11:00:00.000Z")); // 8 giờ sau, đáy 6 giờ đã qua
    dongLog("defer", detailDefer());
    gate.che_do = "tuChoi";

    const plan = await resumeKbSyncDeferFromLog();

    expect(plan.kind).toBe("overdue");
    expect(suKien.map((e) => e.event)).toEqual(["defer_exceeded"]);
    const ct = suKien[0].detail as Record<string, unknown>;
    // ⚠ nhãn phát-muộn: thiếu nó, Task 7 đọc dòng này thành "đêm NAY vừa quá đáy"
    expect(ct.recoveredAfterRestart).toBe(true);
    expect(ct.attempt).toBe(3);
    expect(JSON.stringify(ct.holders)).toContain("gguf:fixture-17000");
    // KHÔNG vũ trang lại — đã quá đáy
    expect(__hasKbSyncDeferTimer()).toBe(false);
    const canhBao = keu.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(canhBao).toContain("PHÁT MUỘN");
    expect(canhBao).toContain("gguf:fixture-17000");
    keu.mockRestore();
  });

  it("không có DB (getDb → null) ⇒ `none`, không ném, không vũ trang — giới hạn ĐÃ KHAI", async () => {
    kho.coDb = false;
    const plan = await resumeKbSyncDeferFromLog();
    expect(plan.kind).toBe("none");
    expect(__hasKbSyncDeferTimer()).toBe(false);
  });

  it("chuỗi ĐANG SỐNG trong bộ nhớ THẮNG một dòng lịch sử — không đè lên nhau", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow(); // chuỗi sống, lượt 1
    dongLog("defer", detailDefer({ attempt: 99 }));

    const plan = await resumeKbSyncDeferFromLog();

    expect(plan.kind).toBe("none");
    expect(getKbSyncSchedulerStatus().defer?.attempts).toBe(1); // KHÔNG bị dòng log ghi đè
  });

  /**
   * ★★★ ĐƯỜNG BOOT THẬT — và ca này là bản THAY THẾ cho một ca quét-văn-bản đã **NÓI DỐI**.
   *
   * Bản đầu của tôi kiểm *"thân `startKbSyncScheduler` có chứa chuỗi tên hàm khôi phục không"*.
   * Đột biến xoá đúng LỜI GỌI cho **0 đỏ**: chuỗi ấy vẫn còn — trong **docstring** ngay phía trên.
   * Đúng bài học đã trả giá hai lần ở pha này (*"lưới đi theo ĐƯỜNG THOÁT, không theo FILE"* và
   * *"ca quét không đóng lớp alias"*), lần này tôi tự dẫm vào. ⇒ Gọi THẬT `start…()` và đo TÁC DỤNG.
   *
   * ⚠ Đồng hồ THẬT ở ca này (không `useFakeTimers`): đường khôi phục là `void`-fire-and-forget và
   * đi qua ba lượt `await import()`; ép nó vào đồng hồ giả là canh một thứ khác.
   */
  it("★★★ (I-1) `startKbSyncScheduler()` CHẠY đường khôi phục — bằng chứng HÀNH VI, không phải quét chữ", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const bayGio = Date.now();
    kho.coDb = true;
    kho.rows = [{
      event: "defer",
      detail: {
        attempt: 3,
        firstRefusedAt: new Date(bayGio - 60 * PHUT).toISOString(),
        budgetMs: 6 * GIO,
        delayMs: 60 * PHUT,
        nextRetryAt: new Date(bayGio + 45 * PHUT).toISOString(),
        holdersKnown: true,
        holders: [{ owner: "gguf:fixture-17000", kind: "gguf-model", mib: 17_000, priority: "interactive", measured: false, reclaimable: true }],
        refusalMessage: "Không đủ VRAM cho cron:kb-sync (mức background).",
      },
    }];
    gate.che_do = "tuChoi";

    try {
      startKbSyncScheduler();
      for (let i = 0; i < 200 && getKbSyncSchedulerStatus().defer === null; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      // chuỗi CŨ được nhặt lên VÀ hẹn giờ được vũ trang — chỉ đăng ký cron thôi thì cả hai đều rỗng
      expect(getKbSyncSchedulerStatus().defer?.attempts).toBe(3);
      expect(getKbSyncSchedulerStatus().defer?.exceeded).toBe(false);
      expect(__hasKbSyncDeferTimer()).toBe(true);
    } finally {
      stopKbSyncScheduler();
    }
  });
});

describe("§5 — M-1 · M-2 · M-4 · M-6 (Minor của review)", () => {
  it("★ (M-1) vũ trang LẠI có SÀN — `nextRetryAt` đã qua KHÔNG cho quay vòng 0 ms", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T04:00:00.000Z"));
    // dòng log có `nextRetryAt` ĐÃ QUA (03:30) nhưng đáy thì chưa
    kho.coDb = true;
    kho.rows = [{
      event: "defer",
      detail: {
        attempt: 2, firstRefusedAt: "2026-08-05T03:00:00.000Z", budgetMs: 6 * GIO,
        delayMs: 30 * PHUT, nextRetryAt: "2026-08-05T03:30:00.000Z",
        holdersKnown: true, holders: [], refusalMessage: "x",
      },
    }];
    gate.che_do = "tuChoi";

    await resumeKbSyncDeferFromLog();
    expect(__hasKbSyncDeferTimer()).toBe(true);

    // 59 giây: CHƯA nổ (không có sàn thì nó đã nổ ở 0 ms)
    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(gate.soLuotXin).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * 1000);
    expect(gate.soLuotXin).toBe(1);
  });

  it("★ (M-2) `stopKbSyncScheduler()` KHÔNG để lại chuỗi mồ côi ⇒ mặt trạng thái không NÓI DỐI", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi";
    await runKbSyncNow();
    expect(getKbSyncSchedulerStatus().defer?.nextRetryAt).toBeTruthy();

    stopKbSyncScheduler();

    // trước bản vá: `defer` vẫn khai exceeded:false + nextRetryAt TƯƠNG LAI cho một lượt
    // thử lại KHÔNG BAO GIỜ nổ.
    expect(getKbSyncSchedulerStatus().defer).toBeNull();
    expect(__hasKbSyncDeferTimer()).toBe(false);
  });

  /**
   * ★ (M-4 / review C) `background` là mức THẤP NHẤT ⇒ `preemptable` RỖNG VĨNH VIỄN với `kb:sync`
   * ⇒ ngay cả `preempt()` mở rộng của Task 7 cũng không giành được byte nào. Khi KHÔNG hộ nào
   * thu hồi được, câu "thử lại sau N phút" phải NÓI RA điều đó thay vì để người trực tự suy.
   */
  it("★ (M-4) mọi hộ KHÔNG thu hồi được ⇒ câu hoãn NÓI THẲNG là thử lại nhiều khả năng vẫn trượt", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.facts = {
      requestedBytes: 1251 * MIB,
      holders: [
        { owner: "sidecar:vision", kind: "external-process", bytes: 7825 * MIB, priority: "interactive", measured: true, reclaimable: false },
        { owner: "onnx-aoi:seg", kind: "onnx-session", bytes: 339 * MIB, priority: "production", measured: true, reclaimable: false },
      ],
      preemptable: [],
    };
    gate.che_do = "tuChoi";

    await runKbSyncNow();

    const noi = canh.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(noi).toContain("KHÔNG hộ nào thu hồi được");
    expect(noi).toContain("TỰ NHẢ");
    expect(noi).toContain("sidecar:vision");
    canh.mockRestore();
  });

  it("★ (M-4) CÓ hộ thu hồi được ⇒ KHÔNG thêm câu đó (không kêu oan)", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.che_do = "tuChoi"; // fixture mặc định: `gguf:fixture-17000` reclaimable

    await runKbSyncNow();

    const noi = canh.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(noi).not.toContain("KHÔNG hộ nào thu hồi được");
    canh.mockRestore();
  });

  /**
   * ★★★ I-1 (review TOÀN NHÁNH) — **CƠ CHẾ MỚI VÔ HIỆU HOÁ CƠ CHẾ CŨ QUA VỊ TỪ DÙNG CHUNG, LẦN
   * THỨ NĂM.**
   *
   * Task 5 (C) đưa hộ của **anh em** vào `VramRefusalFacts.holders` với `reclaimable` tính bằng
   * CHÍNH vị từ dùng chung (`nguoiThiHanhThuHoiTu`). Nhưng một model GGUF nhàn rỗi **của tiến
   * trình anh em** thu hồi được **BỞI ANH EM**, không phải bởi ta — chính câu từ chối nói thế
   * (`vramRefusal.ts:558-560`: *"`preempt()` KHÔNG nhường được chỗ của một tiến trình anh em còn
   * sống"*).
   *
   * ⚠⚠ VÀ HẬU QUẢ RƠI ĐÚNG VÀO HỘ NHẠY NHẤT: `cron:kb-sync` chạy mức `background` = THẤP NHẤT ⇒
   * `preemptable` **RỖNG THEO ĐỊNH NGHĨA, VĨNH VIỄN** ⇒ câu M-4 là **TÍN HIỆU DUY NHẤT** nói với
   * người trực rằng chờ thêm 6 giờ nữa cũng vô ích. Trước bản vá, một sự thật về **tiến trình
   * khác** nuốt mất nó.
   *
   * ⚠ Hai ca M-4 cũ (`:1109`, `:1131`) đều dùng hộ **CỤC BỘ** (không `processKey`) nên không ca
   * nào canh chiều này.
   */
  it("★★★ (I-1) hộ THU HỒI ĐƯỢC của ANH EM KHÔNG được nuốt câu 'cần người can thiệp'", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.facts = {
      requestedBytes: 1251 * MIB,
      holders: [
        // Hộ CỤC BỘ: không thu hồi được ⇒ một mình nó thì câu M-4 phải nổ.
        { owner: "sidecar:vision", kind: "external-process", bytes: 7825 * MIB, priority: "interactive", measured: true, reclaimable: false },
        // Hộ của ANH EM: `reclaimable: true` — nhưng thu hồi được BỞI ANH EM, không phải bởi ta.
        { owner: "gguf:30B", kind: "gguf-model", bytes: 17_000 * MIB, priority: "interactive", measured: true, reclaimable: true, processKey: "api:900:1000" },
      ],
      preemptable: [],
    };
    gate.che_do = "tuChoi";

    await runKbSyncNow();

    const noi = canh.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(noi, "một sự thật về TIẾN TRÌNH KHÁC không được tắt tín hiệu DUY NHẤT của hộ này").toContain(
      "KHÔNG hộ nào thu hồi được",
    );
    // Và người trực phải ĐỌC ĐƯỢC hộ đó là của ai — mất dấu `@role:pid:boot` là bắt họ đi tìm
    // nhầm tiến trình (đúng thứ `vramRefusal.holderText()` vừa được thêm để chặn).
    expect(noi, "hộ của anh em phải mang dấu tiến trình").toContain("gguf:30B@api:900:1000");
    canh.mockRestore();
  });

  it("★★ (I-1) hộ CỤC BỘ thu hồi được thì vẫn KHÔNG nổ câu đó — bản vá không đảo chiều ca cũ", async () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    gate.facts = {
      requestedBytes: 1251 * MIB,
      holders: [
        { owner: "sidecar:vision", kind: "external-process", bytes: 7825 * MIB, priority: "interactive", measured: true, reclaimable: false, processKey: null },
        { owner: "gguf:fixture-17000", kind: "gguf-model", bytes: 17_000 * MIB, priority: "interactive", measured: false, reclaimable: true, processKey: null },
      ],
      preemptable: [],
    };
    gate.che_do = "tuChoi";

    await runKbSyncNow();

    const noi = canh.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(noi).not.toContain("KHÔNG hộ nào thu hồi được");
    // `processKey: null` ⇒ hộ CỦA TA ⇒ KHÔNG được in một dấu `@` rỗng.
    expect(noi).not.toContain("@null");
    expect(noi).not.toContain("@undefined");
    canh.mockRestore();
  });

  it("★★ (I-1) `readKbSyncRefusalNote()` mang `processKey` qua — chuỗi rỗng/rác ⇒ `null` (CỦA TA)", () => {
    const err = new Error("x");
    err.name = "VramRefusedError";
    (err as unknown as { facts: unknown }).facts = {
      holders: [
        { owner: "a", kind: "k", bytes: MIB, priority: "background", processKey: "api:900:1000" },
        { owner: "b", kind: "k", bytes: MIB, priority: "background", processKey: "   " },
        { owner: "c", kind: "k", bytes: MIB, priority: "background", processKey: 42 },
        { owner: "d", kind: "k", bytes: MIB, priority: "background" },
      ],
    };
    const note = readKbSyncRefusalNote(err);
    expect(note.holders.map((h) => h.processKey)).toEqual(["api:900:1000", null, null, null]);
  });

  /**
   * ★★ (M-6) Chốt một-lần `deferBudgetWarned` là một TÀI NGUYÊN TIÊU THỤ ĐƯỢC. Nếu một mặt sức
   * khoẻ bị poll định kỳ gọi vào đường có kêu, lượt poll đó ĂN MẤT tiếng kêu cấu hình trước khi
   * người vận hành kịp thấy.
   */
  it("★★ (M-6) `getKbSyncSchedulerStatus()` KHÔNG tiêu thụ chốt cảnh báo cấu hình", () => {
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.KB_SYNC_MAX_DEFER_HOURS = "sáu";

    // "poll" mặt trạng thái nhiều lần — KHÔNG được kêu, và KHÔNG được ăn mất lượt kêu
    for (let i = 0; i < 5; i++) expect(getKbSyncSchedulerStatus().deferBudgetMs).toBe(6 * GIO);
    expect(keu).not.toHaveBeenCalled();

    // đường QUYẾT ĐỊNH vẫn kêu được
    expect(kbSyncDeferBudgetMs()).toBe(6 * GIO);
    expect(keu).toHaveBeenCalledTimes(1);
    keu.mockRestore();
  });
});
