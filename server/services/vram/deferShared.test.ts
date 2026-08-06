/**
 * ★★★ Pha 3 Task 5 (B) — **HOÃN, KHÔNG CHẶN — CHO CẢ SÁU HỘ `background`.**
 *
 * Điều kiện ra số **5** của Pha 3, nguyên văn: *"Cả 6 hộ `background` đều hoãn-không-chặn;
 * trainer **không còn** bị đánh thất bại"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỚI ĐI THEO **ĐƯỜNG THOÁT**, KHÔNG THEO FILE (ràng buộc 10 — đã tái diễn MƯỜI MỘT lần)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một ca gọi thẳng `xinVramCoHoan()` rồi tự truyền `ngu` chứng minh **cơ chế** đúng, và **không
 * nói một chữ nào** về việc hai điểm gọi sản xuất có đi qua cơ chế đó hay không. Nên bộ này chia
 * làm hai tầng, và tầng thứ hai mới là tầng trả nợ:
 *
 *   §1-§3 — **CƠ CHẾ**: người quyết định, sợi dây ngân sách, vòng đời một lượt hoãn.
 *   §4    — **ĐƯỜNG SẢN XUẤT THẬT**: `runSidecarTraining()` (localSidecarTrainer) chạy nguyên
 *           vẹn, `beginVramAllocation` giả **TỪ CHỐI**, và ca quan sát: có ngủ đúng 15 phút không,
 *           tiến trình con có được sinh ra sau lượt thử lại không, và **job có bị đánh THẤT BẠI
 *           không**. Seam duy nhất được thay là **giấc ngủ** (`__setVramDeferSleepForTests`) —
 *           người quyết định, ngân sách, sự kiện, ô trạng thái đều là mã sản xuất.
 *
 * ⚠ Vì sao §4 nằm trong file này chứ không ở `localSidecarTrainer.test.ts`: `vi.mock` là
 * theo-FILE, và bộ ca cũ ở đó **không** giả `./vram/vramWiring` (nó cố ý để đường VRAM chạy thật
 * và rơi vào nhánh nuốt-lỗi telemetry). Thêm một `vi.mock` vào đó là đổi thế giới của 12 ca không
 * liên quan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── ./vramEventLog — BẮT sự kiện `defer` / `defer_exceeded` ──────────────────────────────────
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

// ─── ./vramWiring — cổng SỔ: từ chối N lượt đầu rồi cấp ───────────────────────────────────────
const NOOP_TICKET = { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
let soLuotTuChoiConLai = 0;
const luotXin = vi.hoisted(() => [] as string[]);
function loiTuChoi(owner: string): Error {
  const e = new Error(`Không đủ VRAM cho ${owner} (mức background): xin 6144 MiB, còn 12 MiB.`);
  e.name = "VramRefusedError";
  return e;
}
vi.mock("./vramWiring", () => ({
  beginVramAllocation: async (opts: { owner: string }) => {
    luotXin.push(opts.owner);
    if (soLuotTuChoiConLai > 0) {
      soLuotTuChoiConLai -= 1;
      throw loiTuChoi(opts.owner);
    }
    return NOOP_TICKET;
  },
}));

// ─── fs / child_process / dataset / DB — đúng khuôn `localSidecarTrainer.test.ts` ─────────────
const fsStore = new Map<string, string>();
const fsExist = new Set<string>();
vi.mock("fs", () => {
  const api = {
    mkdirSync: (p: string) => {
      fsExist.add(p);
    },
    writeFileSync: (p: string, data: string) => {
      fsStore.set(p, String(data));
      fsExist.add(p);
    },
    readFileSync: (p: string) => {
      if (!fsStore.has(p)) throw new Error(`ENOENT ${p}`);
      return fsStore.get(p)!;
    },
    existsSync: (p: string) => fsExist.has(p),
    copyFileSync: (s: string, d: string) => {
      fsExist.add(d);
      fsStore.set(d, fsStore.get(s) ?? "<onnx>");
    },
  };
  return { default: api, ...api };
});

class FakeChild extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
  }
}
let lastChild: FakeChild | null = null;
const spawnSpy = vi.fn(() => {
  lastChild = new FakeChild();
  return lastChild;
});
vi.mock("child_process", () => ({ spawn: () => spawnSpy() }));

vi.mock("../aiDatasetBuilder", () => ({
  buildDataset: async () => ({
    datasetId: 12,
    totalSamples: 40,
    labelDistribution: { OK: 20, NG: 20 },
    split: { train: 30, val: 6, test: 4 },
    storageKey: "datasets/12",
    manifestPaths: { train: "/a/train.jsonl", val: "/a/val.jsonl", test: "/a/test.jsonl" },
    labels: ["NG", "OK"],
  }),
}));
vi.mock("../../db/aiAdvanced", () => ({ updateTrainingJob: async () => ({}) }));
vi.mock("../../db/ai", () => ({
  getAiModelById: async () => ({ id: 7, code: "M7", filePath: "/uploads/models/base.onnx" }),
}));

import {
  planVramDefer,
  xinVramCoHoan,
  vramJobDeferBudgetMs,
  vramRequestDeferBudgetMs,
  docTrangThaiHoanVram,
  __resetVramDeferForTests,
  __setVramDeferSleepForTests,
  VRAM_DEFER_FIRST_DELAY_MS,
  VRAM_DEFER_MAX_DELAY_MS,
} from "./vramDefer";
import { planKbSyncDefer } from "../kbSyncScheduler";
import { runSidecarTraining } from "../localSidecarTrainer";
import { getKbHealth } from "../aiLocalKnowledgeService";

const PHUT = 60_000;
const GIO = 60 * PHUT;

beforeEach(() => {
  suKien.length = 0;
  luotXin.length = 0;
  soLuotTuChoiConLai = 0;
  lastChild = null;
  spawnSpy.mockClear();
  fsStore.clear();
  fsExist.clear();
  __resetVramDeferForTests();
  delete process.env.VRAM_DEFER_BUDGET_HOURS;
  delete process.env.VRAM_DEFER_REQUEST_BUDGET_MS;
  delete process.env.LOCAL_TRAINER_CMD;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  __resetVramDeferForTests();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — NGƯỜI QUYẾT ĐỊNH DÙNG CHUNG (`planVramDefer`)", () => {
  /**
   * ★★★ Ràng buộc 12 — hai bản sao của một vị từ dưới một bất biến thì lời giải KHÔNG phải "thêm
   * một ca canh chúng khớp nhau", mà là **xoá bản thứ hai**. Ca này khoá đúng điều đã làm:
   * `kbSyncScheduler.planKbSyncDefer` nay là một lời gọi thẳng xuống `planVramDefer`.
   */
  it("★★★ `planKbSyncDefer` KHÔNG còn là bản cài đặt thứ hai — nó trả ĐÚNG kết quả của bản chung", () => {
    const hinhDang = [
      { now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: 6 * GIO },
      { now: 45 * PHUT, firstRefusedAt: 0, previousDelayMs: 30 * PHUT, budgetMs: 6 * GIO },
      { now: 345 * PHUT, firstRefusedAt: 0, previousDelayMs: 60 * PHUT, budgetMs: 6 * GIO },
      { now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: Number.NaN },
    ];
    for (const h of hinhDang) {
      expect(planKbSyncDefer(h), JSON.stringify(h)).toEqual(planVramDefer(h));
    }
  });

  it("bậc thang 15 → 30 → 60 → 60 (trần), và trần là hằng số CÔNG BỐ", () => {
    expect(planVramDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs: 6 * GIO }))
      .toMatchObject({ kind: "retry", delayMs: VRAM_DEFER_FIRST_DELAY_MS });
    expect(
      planVramDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: 60 * PHUT, budgetMs: 99 * GIO }),
    ).toMatchObject({ kind: "retry", delayMs: VRAM_DEFER_MAX_DELAY_MS });
  });

  it("★★★ đáy/đồng hồ KHÔNG HỮU HẠN ⇒ QUÁ ĐÁY (kêu), KHÔNG phải hoãn vô hạn (im)", () => {
    for (const budgetMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const p = planVramDefer({ now: 0, firstRefusedAt: 0, previousDelayMs: null, budgetMs });
      expect(`budget=${budgetMs}: ${p.kind}`).toBe(`budget=${budgetMs}: exceeded`);
      expect(Number.isFinite(p.elapsedMs) && Number.isFinite(p.budgetMs)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — SỢI DÂY NGÂN SÁCH (mỗi `?? mặc_định` là một dây ⇒ phải có lưới)", () => {
  it("JOB NỀN: chưa đặt ⇒ 6 giờ; số hợp lệ ⇒ đúng số đó (đơn vị GIỜ)", () => {
    expect(vramJobDeferBudgetMs()).toBe(6 * GIO);
    process.env.VRAM_DEFER_BUDGET_HOURS = "2";
    expect(vramJobDeferBudgetMs()).toBe(2 * GIO);
    process.env.VRAM_DEFER_BUDGET_HOURS = "0.5";
    expect(vramJobDeferBudgetMs()).toBe(30 * PHUT);
  });

  it("★★ ĐƯỜNG PHỤC VỤ YÊU CẦU: chưa đặt ⇒ **0** (đừng đợi, kêu ngay) và đơn vị là **ms**", () => {
    expect(vramRequestDeferBudgetMs()).toBe(0);
    process.env.VRAM_DEFER_REQUEST_BUDGET_MS = "2500";
    expect(vramRequestDeferBudgetMs()).toBe(2500);
  });

  it('★★★ "đặt rồi để trống" / rác / âm ⇒ về MẶC ĐỊNH và KÊU, KHÔNG âm thầm về 0 hay NaN', () => {
    for (const v of ["   ", "abc", "-1", "Infinity", "NaN"]) {
      __resetVramDeferForTests(); // đặt lại chốt "đã kêu"
      const keu = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.VRAM_DEFER_BUDGET_HOURS = v;
      const ms = vramJobDeferBudgetMs();
      expect(`${v} ⇒ ${ms}`).toBe(`${v} ⇒ ${6 * GIO}`);
      expect(keu, `${v} phải KÊU`).toHaveBeenCalled();
      keu.mockRestore();
    }
  });

  it('"0" TƯỜNG MINH vẫn hợp lệ — nghĩa "đừng hoãn, kêu ngay" (chiều AN TOÀN)', () => {
    process.env.VRAM_DEFER_BUDGET_HOURS = "0";
    expect(vramJobDeferBudgetMs()).toBe(0);
  });

  it("★★ đường CHỈ-ĐỌC (`keu = false`) KHÔNG được ăn mất chốt một-lần của đường QUYẾT ĐỊNH", () => {
    process.env.VRAM_DEFER_BUDGET_HOURS = "abc";
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    vramJobDeferBudgetMs(false);
    expect(keu, "đường chỉ-đọc phải IM").not.toHaveBeenCalled();
    vramJobDeferBudgetMs(true);
    expect(keu, "đường quyết định mới được kêu").toHaveBeenCalledTimes(1);
    vramJobDeferBudgetMs(true);
    expect(keu, "và chỉ MỘT lần trong cả đời tiến trình").toHaveBeenCalledTimes(1);
    keu.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — VÒNG ĐỜI MỘT LƯỢT HOÃN (`xinVramCoHoan`)", () => {
  const chung = { owner: "test:ho", leaseKind: "external-process" as const, priority: "background" as const };

  it("cấp được ngay ⇒ KHÔNG sự kiện, KHÔNG ô trạng thái, KHÔNG ngủ", async () => {
    const ngu = vi.fn(async (_ms: number) => {});
    const r = await xinVramCoHoan({ ...chung, budgetMs: 6 * GIO, ngu, xin: async () => "ve" });
    expect(r).toBe("ve");
    expect(ngu).not.toHaveBeenCalled();
    expect(suKien).toHaveLength(0);
    expect(docTrangThaiHoanVram()).toHaveLength(0);
  });

  it("★★★ TỪ CHỐI rồi CẤP ⇒ HOÃN 15 phút, thử lại, và KHÔNG ném gì lên người gọi", async () => {
    const ngu = vi.fn(async (_ms: number) => {});
    let lan = 0;
    const now = () => lan * 1000; // đồng hồ giả: mỗi lượt cách nhau 1 s ⇒ luôn còn trong đáy
    const r = await xinVramCoHoan({
      ...chung,
      budgetMs: 6 * GIO,
      now,
      ngu,
      xin: async () => {
        lan += 1;
        if (lan === 1) throw loiTuChoi("test:ho");
        return "ve";
      },
    });
    expect(r, "lượt thứ hai phải được cấp và trả về nguyên vẹn").toBe("ve");
    expect(ngu).toHaveBeenCalledTimes(1);
    expect(ngu.mock.calls[0]![0], "đúng bậc thang §5.4").toBe(VRAM_DEFER_FIRST_DELAY_MS);
    expect(suKien.map((e) => e.event)).toEqual(["defer"]);
    expect(suKien[0]).toMatchObject({ owner: "test:ho", priority: "background", leaseKind: "external-process" });
    expect(docTrangThaiHoanVram(), "cấp được rồi ⇒ ô trạng thái phải SẠCH").toHaveLength(0);
  });

  it("★★★ QUÁ ĐÁY ⇒ `defer_exceeded` + NÉM LẠI ĐÚNG lỗi gốc (cưỡng chế KHÔNG bị tắt ở đây)", async () => {
    const ngu = vi.fn(async (_ms: number) => {});
    const goc = loiTuChoi("test:ho");
    await expect(
      xinVramCoHoan({ ...chung, budgetMs: 0, ngu, xin: async () => Promise.reject(goc) }),
    ).rejects.toBe(goc);
    expect(ngu, "đáy 0 ⇒ KHÔNG được ngủ một mili giây nào").not.toHaveBeenCalled();
    expect(suKien.map((e) => e.event)).toEqual(["defer_exceeded"]);
    const tt = docTrangThaiHoanVram();
    expect(tt).toHaveLength(1);
    expect(tt[0]).toMatchObject({ owner: "test:ho", exceeded: true, nextRetryAt: null, attempts: 1 });
  });

  it("★★ lỗi KHÔNG PHẢI từ chối ⇒ đi thẳng ra ngoài, KHÔNG hoãn, KHÔNG để lại ô trạng thái", async () => {
    const ngu = vi.fn(async (_ms: number) => {});
    const la = new Error("DB sập");
    await expect(
      xinVramCoHoan({ ...chung, budgetMs: 6 * GIO, ngu, xin: async () => Promise.reject(la) }),
    ).rejects.toBe(la);
    expect(ngu).not.toHaveBeenCalled();
    expect(suKien).toHaveLength(0);
    expect(docTrangThaiHoanVram()).toHaveLength(0);
  });

  it("★★ KHÔNG con số nào không hữu hạn rời khỏi ống dẫn sự kiện (ràng buộc 9)", async () => {
    await expect(
      xinVramCoHoan({
        ...chung,
        budgetMs: Number.NaN,
        ngu: async () => {},
        xin: async () => Promise.reject(loiTuChoi("test:ho")),
      }),
    ).rejects.toBeInstanceOf(Error);
    const d = suKien[0]!.detail as Record<string, unknown>;
    for (const k of ["attempt", "elapsedMs", "budgetMs"]) {
      expect(`${k}=${d[k]}`).toBe(`${k}=${Number(d[k])}`);
      expect(Number.isFinite(d[k] as number), k).toBe(true);
    }
  });

  it("★ câu từ chối đi vào `detail` bị CẮT (cột chuỗi + jsonb — không để một câu vô hạn mất cả lô)", async () => {
    const dai = loiTuChoi("x");
    dai.message = "z".repeat(5_000);
    await expect(
      xinVramCoHoan({ ...chung, budgetMs: 0, ngu: async () => {}, xin: async () => Promise.reject(dai) }),
    ).rejects.toBe(dai);
    const d = suKien[0]!.detail as Record<string, unknown>;
    expect(String(d.refusalMessage).length).toBe(400);
    // I-3 (review Task 5): cau da cat nay MANG CO cua chinh no ⇒ khong ai phai do lai bang `length`.
    expect(docTrangThaiHoanVram()[0]!.lastRefusal.cau.length).toBe(400);
    expect(docTrangThaiHoanVram()[0]!.lastRefusal.daCat).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — ĐƯỜNG SẢN XUẤT THẬT: trainer KHÔNG còn bị đánh THẤT BẠI vì một lượt từ chối", () => {
  const yeuCau = {
    jobId: 42,
    modelId: 7,
    targetVersion: "1.3.0",
    datasetId: 12,
    classLabels: ["NG", "OK"],
  };

  /**
   * ★★★ ĐÂY LÀ CA TRẢ NỢ. Trước Task 5: `beginTrainerVram()` ném ⇒ `runSidecarTraining()` bắt ở
   * `catch` ngoài cùng ⇒ `fail()` ⇒ **job huấn luyện THẤT BẠI**, phải chạy lại tay — trong khi lý
   * do duy nhất là *"card đang bận NGAY BÂY GIỜ"*.
   *
   * ⚠ Ca đi qua **ĐÚNG hàm sản xuất** `runSidecarTraining()`; seam duy nhất là **giấc ngủ**.
   * ⇒ Đột biến *"bỏ `xinVramCoHoan` khỏi `beginTrainerVram`"* làm ca này ĐỎ ở ba chỗ cùng lúc:
   * không có lượt ngủ nào, tiến trình con KHÔNG được sinh, và job bị đánh thất bại.
   */
  it("★★★ TỪ CHỐI một lượt ⇒ HOÃN 15 phút rồi thử lại ⇒ tiến trình con VẪN được sinh, job KHÔNG hỏng", async () => {
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    soLuotTuChoiConLai = 1;
    const ngu = vi.fn(async (_ms: number) => {});
    __setVramDeferSleepForTests(ngu);

    const p = runSidecarTraining(yeuCau);
    // Đợi tới khi lượt xin thứ HAI đi qua và tiến trình con được sinh.
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    fsExist.add([...fsExist].find((k) => k.endsWith("output")) ?? "");
    // Sidecar "chạy xong": ghi model + result rồi thoát 0.
    const jobJson = [...fsStore.keys()].find((k) => k.endsWith("job.json"))!;
    const contract = JSON.parse(fsStore.get(jobJson)!) as {
      output: { modelPath: string; resultPath: string };
    };
    fsStore.set(contract.output.modelPath, "<onnx>");
    fsExist.add(contract.output.modelPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ metrics: { accuracy: 0.9 } }));
    fsExist.add(contract.output.resultPath);
    lastChild!.emit("exit", 0);

    const res = await p;
    expect(ngu, "phải có ĐÚNG một lượt hoãn").toHaveBeenCalledTimes(1);
    expect(ngu.mock.calls[0]![0]).toBe(VRAM_DEFER_FIRST_DELAY_MS);
    expect(luotXin, "hai lượt xin cho CÙNG một hộ").toEqual([
      "sidecar:local-trainer",
      "sidecar:local-trainer",
    ]);
    expect(spawnSpy, "tiến trình con PHẢI được sinh sau lượt thử lại").toHaveBeenCalledTimes(1);
    expect(res.success, "job KHÔNG được đánh thất bại vì một lượt từ chối tạm thời").toBe(true);
    expect(suKien.map((e) => e.event)).toEqual(["defer"]);
  });

  /**
   * ★★ NỬA CÒN LẠI CỦA HỢP ĐỒNG: quá đáy thì lời từ chối **vẫn tới nơi** — cưỡng chế KHÔNG bị
   * tắt. Nhưng nó tới nơi bằng một **mã thoát có tên** (`"Never rejects"` được trả lại), và câu
   * lỗi phải nói ĐÚNG nguyên nhân: người trực đọc "exited with code -3" sẽ đi tìm lỗi trong một
   * `train.py` **chưa bao giờ chạy**.
   */
  it("★★★ QUÁ ĐÁY ⇒ KHÔNG spawn, job hỏng với câu nói ĐÚNG nguyên nhân, và KHÔNG ai ném ra ngoài", async () => {
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    process.env.VRAM_DEFER_BUDGET_HOURS = "0"; // "đừng hoãn, kêu ngay"
    soLuotTuChoiConLai = 99;
    const ngu = vi.fn(async (_ms: number) => {});
    __setVramDeferSleepForTests(ngu);

    const res = await runSidecarTraining(yeuCau);
    expect(ngu).not.toHaveBeenCalled();
    expect(spawnSpy, "cưỡng chế còn nguyên: tiến trình con KHÔNG được sinh").not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.error, "câu lỗi phải nói VRAM + ngân sách hoãn, không phải 'exited with code -3'").toMatch(
      /VRAM refused/i,
    );
    expect(res.error).toMatch(/VRAM_DEFER_BUDGET_HOURS/);
    expect(res.error, "và phải nói rõ tiến trình con CHƯA TỪNG chạy").toMatch(/NEVER spawned/i);
    expect(suKien.map((e) => e.event)).toEqual(["defer_exceeded"]);
    expect(docTrangThaiHoanVram()[0]).toMatchObject({
      owner: "sidecar:local-trainer",
      exceeded: true,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — MẶT SỨC KHOẺ: `getKbSyncSchedulerStatus().defer` thôi là 'đồng hồ không kim'", () => {
  /**
   * ★★★ Pha 3 Task 5 (D). Pha 2B Task 6 dựng `getKbSyncSchedulerStatus().defer` để *"máy đọc
   * được"* rồi **không nối vào đâu cả**. Task 5 mở dân số ra sáu hộ, nên không nối thì nay là
   * **sáu** đồng hồ không kim. Ca này đi qua **ĐÚNG hàm sản xuất** `getKbHealth()`.
   *
   * ⚠ Ở bộ test này `fs` là bản giả rỗng ⇒ `ensureDataLoaded()` ném ⇒ `getKbHealth()` rơi vào
   * **nhánh SUY GIẢM**. Đó là chủ ý: nhánh ấy là nhánh dễ quên nhất khi thêm một ô mới, và một mặt
   * sức khoẻ mất ô đúng lúc hệ đang hỏng là lúc nó vô dụng nhất.
   */
  it("★★★ ô `vramDefer` có mặt ở mặt sức khoẻ và MANG ĐÚNG trạng thái vừa xảy ra", async () => {
    await expect(
      xinVramCoHoan({
        owner: "sidecar:llm-finetune",
        leaseKind: "external-process",
        priority: "background",
        budgetMs: 0,
        ngu: async () => {},
        xin: async () => Promise.reject(loiTuChoi("sidecar:llm-finetune")),
      }),
    ).rejects.toBeInstanceOf(Error);

    const h = await getKbHealth();
    expect(h.vramDefer, "ô phải TỒN TẠI kể cả ở nhánh suy giảm").toBeDefined();
    expect(h.vramDefer.kbSync.chain, "chưa có chuỗi hoãn kb:sync nào ⇒ null").toBeNull();
    /**
     * ★★★ I-5 (review TOÀN NHÁNH) — **`chain === null` MỘT MÌNH KHÔNG PHẢI MỘT CÂU TRẢ LỜI.**
     * Cron `kb:sync` sống ở `worker`, mặt sức khoẻ KB được phục vụ ở `api` ⇒ ở `api` ô ấy **LUÔN**
     * `null`, và đọc nó thành *"không có chuỗi hoãn nào"* là một lời khẳng định SAI. Caveat phải
     * đi CÙNG ô, không phải nằm trong đầu người đọc.
     */
    expect(
      Object.hasOwn(h.vramDefer.kbSync, "hostedHere"),
      "ô `kbSync` phải chở caveat 'tiến trình này có chủ trì cron không'",
    ).toBe(true);
    expect([true, false, null], "hostedHere: 'không đọc được' ≠ 'không chủ trì'").toContain(
      h.vramDefer.kbSync.hostedHere,
    );
    expect(h.vramDefer.holders.map((s) => s.owner)).toEqual(["sidecar:llm-finetune"]);
    expect(h.vramDefer.holders[0]!.exceeded).toBe(true);
  });

  it("không hộ nào bị hoãn ⇒ danh sách RỖNG (không phải thiếu ô, không phải null)", async () => {
    const h = await getKbHealth();
    expect(h.vramDefer.holders).toEqual([]);
  });
});
