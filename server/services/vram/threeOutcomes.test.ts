/**
 * ★★★ Pha 2B Task 3 — BA KẾT CỤC (§5.5): DIỆT SUY BIẾN IM LẶNG.
 *
 * Bối cảnh đo được (Ư0, 24 lượt): **`0/24` log chứa dòng lùi `gpuLayers:"auto"`** ⇒ lớp phòng thủ
 * cuối của `loadGgufModel()` KHÔNG BAO GIỜ chạy. Hai nguyên nhân ĐỘC LẬP, và bộ ca này canh CẢ HAI:
 *   1. `isOom` không khớp chuỗi llama.cpp THẬT SỰ ném (§1 — chứng minh bằng cách ĐỌC
 *      `node_modules/node-llama-cpp/dist/**` bằng máy, không hardcode);
 *   2. `warmModel()` có `catch` nuốt trọn (§5, hai dòng cuối bảng).
 *
 * ⚠ Ca ★★ của task này là §5: **không nhánh thất bại nào được im lặng**. Nó table-driven trên MỌI
 * nhánh — thêm nhánh mới mà quên sự kiện thì phải thêm dòng vào bảng, và dòng đó sẽ đỏ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  classifyLoadFailure,
  chuanHoaSoLop,
  loadWithVramOutcomes,
  vramLoadRetries,
  vramLoadRetryDelayMs,
  VRAM_LOAD_RETRIES_DEFAULT,
  VRAM_LOAD_RETRY_DELAY_MS_DEFAULT,
  VRAM_EXHAUSTION_SIGNALS,
} from "./vramLoadOutcome";
import { sanitizeVramEvent } from "./vramEventLog";

const MiB = 1024 * 1024;
/** Ràng buộc của task: fixture cỡ 17.000 MiB (khối 30B thật mà Ư0/Ư7 đo). */
const FIXTURE_BYTES = 17_000 * MiB;

/** Bộ thu sự kiện — tiêm qua `spec.emit`, không cần mock module. */
function thuSuKien() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    emit: (e: unknown) => { events.push(e as Record<string, unknown>); },
    ofType: (t: string) => events.filter((e) => e.event === t),
    reasons: () => events.map((e) => String((e.detail as Record<string, unknown>)?.reason ?? "")),
  };
}

/** Giấy phép giả có ghi lại thứ tự — §2 cần biết `release()` xảy ra TRƯỚC lượt xin kế tiếp. */
function soGiaySo() {
  const nhatKy: string[] = [];
  let n = 0;
  return {
    nhatKy,
    begin: (async (opts: { owner: string }) => {
      const id = ++n;
      nhatKy.push(`begin#${id}:${opts.owner}`);
      return {
        async commitMeasured() { nhatKy.push(`commit#${id}`); },
        release() { nhatKy.push(`release#${id}`); },
      };
    }) as never,
  };
}

/** `sleep` giả: ghi lại từng lượt gọi, không chờ thật. */
function dongHoGia() {
  const calls: number[] = [];
  return { calls, sleep: async (ms: number) => { calls.push(ms); } };
}

const LOI_THAT_CUA_LLAMA = new Error("Failed to load model");

beforeEach(() => {
  /**
   * ⚠⚠ CÁCH LY `doMock` — GOTCHA ĐÃ TRẢ GIÁ Ở FILE KHÁC (`wiring.inprocess.test.ts`, khối cùng tên).
   * `vi.resetModules()` KHÔNG gỡ đăng ký `doMock`: một bản giả `./vramEventLog` của ca §5 sẽ theo
   * sang §6 và làm ca "logVramEvent THẬT SỰ áp bộ làm sạch" xanh/đỏ vì lý do hoàn toàn khác
   * (đo được: cả §6.7 lẫn hai ca `warmModel` đỏ khi chạy CẢ FILE, xanh khi chạy RIÊNG).
   */
  vi.doUnmock("./vramEventLog");
  vi.doUnmock("./vramEstimator");
  vi.doUnmock("./vramProcessProbe");
  vi.doUnmock("node-llama-cpp");
  vi.doUnmock("../aiLlamaServerClient");
  vi.doUnmock("../../db/connection");
  vi.resetModules();
  delete process.env.VRAM_LOAD_RETRIES;
  delete process.env.VRAM_LOAD_RETRY_DELAY_MS;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — NGUYÊN NHÂN 1: `isOom` cũ trượt chuỗi lỗi THẬT của llama.cpp", () => {
  const NLC = path.join(process.cwd(), "node_modules", "node-llama-cpp", "dist");

  /** Bản `isOom` NGUYÊN VĂN trước Pha 2B Task 3 (aiGgufEngine.ts:874-879). */
  function isOomCu(err: unknown): boolean {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    return (
      msg.includes("out of memory") ||
      msg.includes("cudamalloc") ||
      msg.includes("failed to allocate") ||
      msg.includes("unable to allocate")
    );
  }

  /**
   * ĐỌC BẰNG MÁY, KHÔNG CHÉP TAY. Nếu một lượt nâng cấp node-llama-cpp đổi câu lỗi, ca này đỏ —
   * đó chính là điều ta muốn, vì `isOom` sẽ lại trượt trong im lặng đúng như 24 lượt của Ư0.
   */
  function chuoiLoiThat(): string[] {
    const files = [
      "evaluator/LlamaModel/LlamaModel.js",
      "evaluator/LlamaContext/LlamaContext.js",
      "gguf/insights/utils/resolveModelGpuLayersOption.js",
      "gguf/insights/utils/resolveContextContextSizeOption.js",
    ];
    const out: string[] = [];
    for (const f of files) {
      const p = path.join(NLC, f);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/throw new (?:Error|InsufficientMemoryError)\((["'`])((?:\\.|(?!\1).)*)\1/g)) {
        out.push(m[2]);
      }
    }
    return out;
  }

  it("★★★ 1. mọi chuỗi 'không đủ bộ nhớ' mà node-llama-cpp THẬT SỰ ném đều được phân loại là cạn VRAM", () => {
    const thuc = chuoiLoiThat();
    expect(thuc.length, "không đọc được node_modules/node-llama-cpp/dist — ca này thành lưới GIẢ").toBeGreaterThan(0);

    // Bốn câu mà `resolveContextContextSizeOption` dựng bằng template — lấy nguyên phần tĩnh.
    const bat = thuc.filter((s) =>
      /failed to load model|failed to create context|not enough vram|too large for the available/i.test(s),
    );
    expect(bat, "dist không còn câu lỗi nào khớp mẫu — đọc lại mã thật trước khi sửa ca này").not.toHaveLength(0);

    for (const s of bat) {
      expect(classifyLoadFailure(new Error(s)).exhausted, `KHÔNG phân loại được: "${s}"`).toBe(true);
    }
  });

  it("★★★ 2. bản `isOom` CŨ trượt ĐÚNG câu mà LlamaModel.js ném khi cudaMalloc hỏng", () => {
    // `ggml_backend_cuda_buffer_type_alloc_buffer: … cudaMalloc failed: out of memory` là dòng
    // llama.cpp in ra STDERR. Thứ JS NHẬN ĐƯỢC là ba chữ dưới đây — và đó là toàn bộ lý do 0/24.
    expect(isOomCu(LOI_THAT_CUA_LLAMA)).toBe(false);
    expect(classifyLoadFailure(LOI_THAT_CUA_LLAMA).exhausted).toBe(true);
    expect(classifyLoadFailure(LOI_THAT_CUA_LLAMA).signal).toBe("llama-model-init-false");
  });

  it("3. `InsufficientMemoryError` nhận diện được cả khi câu chữ đổi (lá chắn PHỤ theo lớp)", () => {
    class InsufficientMemoryError extends Error {}
    const err = new InsufficientMemoryError("một câu hoàn toàn khác");
    expect(err.name, "lớp này KHÔNG đặt this.name — đừng nhận diện bằng err.name").toBe("Error");
    expect(classifyLoadFailure(err).exhausted).toBe(true);
    expect(classifyLoadFailure(err).signal).toBe("insufficient-memory-error-class");
  });

  it("4. ĐỐI CHỨNG — lỗi KHÔNG phải cạn VRAM vẫn là KHÔNG (không nới bừa cho 'chắc ăn')", () => {
    for (const msg of ["corrupt gguf header", "ENOENT: no such file", "invalid magic", "aborted"]) {
      expect(classifyLoadFailure(new Error(msg)).exhausted, msg).toBe(false);
    }
    expect(classifyLoadFailure(null).exhausted).toBe(false);
    expect(classifyLoadFailure(undefined).exhausted).toBe(false);
  });

  it("5. bốn chuỗi CŨ vẫn được giữ (bản vá NỚI, không THAY)", () => {
    for (const s of ["out of memory", "cudaMalloc", "failed to allocate", "unable to allocate"]) {
      expect(classifyLoadFailure(new Error(`x ${s} y`)).exhausted, s).toBe(true);
    }
    // Thứ tự bảng có nghĩa: câu CỤ THỂ phải thắng câu CHUNG.
    const chung = VRAM_EXHAUSTION_SIGNALS.findIndex(([p]) => p === "insufficient memory");
    const cuThe = VRAM_EXHAUSTION_SIGNALS.findIndex(([p]) => p === "not enough vram");
    expect(cuThe).toBeLessThan(chung);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — BỐN BƯỚC của §5.5, mỗi bước MỘT sự kiện", () => {
  it("★★★ BƯỚC 1 — driver từ chối ⇒ TRẢ GIẤY PHÉP NGAY, trước cả lượt chờ và lượt xin kế tiếp", async () => {
    const log = thuSuKien();
    const so = soGiaySo();
    const clock = dongHoGia();

    await expect(
      loadWithVramOutcomes({
        owner: "gguf:fixture-17000",
        kind: "gguf-model",
        priority: "interactive",
        fileBytes: FIXTURE_BYTES,
        requestedGpuLayers: "max",
        load: async () => { throw LOI_THAT_CUA_LLAMA; },
        begin: so.begin,
        emit: log.emit,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow(/Failed to load model/);

    // ★ TRỌNG TÂM: giấy phép #1 được trả TRƯỚC khi giấy phép #2 được xin. Lease còn treo thì sổ
    // cộng dư VĨNH VIỄN và lượt xin kế tiếp bị từ chối trên BYTE MA.
    expect(so.nhatKy.slice(0, 4)).toEqual(["begin#1:gguf:fixture-17000", "release#1", "begin#2:gguf:fixture-17000", "release#2"]);
    // Không giấy phép nào được commit — không lượt nạp nào thành công.
    expect(so.nhatKy.filter((x) => x.startsWith("commit"))).toEqual([]);
    // Mỗi lượt hỏng đúng MỘT sự kiện `driver_refused`, và nó khai rõ đã trả chỗ.
    const refused = log.ofType("driver_refused");
    expect(refused.length).toBe(4); // lượt đầu + 2 thử lại + lượt hạ số lớp
    for (const e of refused) {
      expect((e.detail as Record<string, unknown>).leaseReleased).toBe(true);
      expect((e.detail as Record<string, unknown>).signal).toBe("llama-model-init-false");
    }
  });

  it("★★★ BƯỚC 2 — thử lại ĐÚNG 2 lần, cách nhau ĐÚNG 5.000 ms (mặc định, không ai khai)", async () => {
    const log = thuSuKien();
    const so = soGiaySo();
    const clock = dongHoGia();

    // Mặc định phải đọc được từ chính module, không phải từ ca test.
    expect(VRAM_LOAD_RETRIES_DEFAULT).toBe(2);
    expect(VRAM_LOAD_RETRY_DELAY_MS_DEFAULT).toBe(5000);
    expect(vramLoadRetries()).toBe(2);
    expect(vramLoadRetryDelayMs()).toBe(5000);

    let luot = 0;
    await loadWithVramOutcomes({
      owner: "gguf:fixture-17000",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: FIXTURE_BYTES,
      requestedGpuLayers: "max",
      // Trần KHÔNG tất định: hỏng 2 lượt rồi ĐƯỢC ở lượt 3 — đúng hình dạng 3 OK / 9 hỏng của Ư7.
      load: async () => { if (++luot < 3) throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 48 }; },
      resolvedGpuLayers: (m) => m.gpuLayers,
      begin: so.begin,
      emit: log.emit,
      sleep: clock.sleep,
    });

    expect(clock.calls, "hai lượt chờ, mỗi lượt 5.000 ms").toEqual([5000, 5000]);
    const retries = log.ofType("retry");
    expect(retries.length).toBe(2);
    expect(retries.map((e) => (e.detail as Record<string, unknown>).retryIndex)).toEqual([1, 2]);
    expect((retries[0].detail as Record<string, unknown>).delayMs).toBe(5000);
    // Thắng ở lượt 3 ⇒ KHÔNG hạ số lớp, KHÔNG từ chối.
    expect(log.ofType("degraded")).toHaveLength(0);
    expect(log.ofType("refuse")).toHaveLength(0);
    expect(luot).toBe(3);
  });

  it("★★★ BƯỚC 3 — hạ số lớp ⇒ sự kiện `degraded` mang SỐ LỚP THẬT ĐÃ NẠP (không phải số đã xin)", async () => {
    const log = thuSuKien();
    const so = soGiaySo();
    const clock = dongHoGia();

    const ket = await loadWithVramOutcomes({
      owner: "gguf:fixture-17000",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: FIXTURE_BYTES,
      requestedGpuLayers: "max",
      load: async (plan) => {
        if (plan.step !== "degrade") throw LOI_THAT_CUA_LLAMA;
        // node-llama-cpp giải "auto" thành một SỐ thật; ta đọc lại số đó.
        return { gpuLayers: 31 };
      },
      resolvedGpuLayers: (m) => m.gpuLayers,
      begin: so.begin,
      emit: log.emit,
      sleep: clock.sleep,
    });

    expect(ket.outcome).toBe("degraded");
    expect(ket.plan.gpuLayers, "nấc lùi KHÔNG BAO GIỜ là -1").toBe("auto");
    expect(ket.resolvedGpuLayers).toBe(31);

    const deg = log.ofType("degraded");
    expect(deg).toHaveLength(1);
    const d = deg[0].detail as Record<string, unknown>;
    expect(d.reason).toBe("gpu-layers-lowered");
    expect(d.requestedGpuLayers).toBe("max");
    expect(d.appliedGpuLayers).toBe("auto");
    expect(d.gpuLayers, "SỐ LỚP THẬT đọc lại từ model").toBe(31);
    expect(d.cpuOnly).toBe(false);
    // Giấy phép của lượt THẮNG còn mở và được giao cho người gọi; ba lượt trước đã trả chỗ.
    expect(so.nhatKy.filter((x) => x.startsWith("release"))).toEqual(["release#1", "release#2", "release#3"]);
  });

  it("★★★ BƯỚC 4 — hết nấc ⇒ `refuse` rồi NÉM LẠI NGUYÊN lỗi cuối của driver", async () => {
    const log = thuSuKien();
    const so = soGiaySo();
    const clock = dongHoGia();
    const loiCuoi = new Error("Not enough VRAM to fit the model with the specified settings");

    await expect(
      loadWithVramOutcomes({
        owner: "gguf:fixture-17000",
        kind: "gguf-model",
        priority: "interactive",
        fileBytes: FIXTURE_BYTES,
        requestedGpuLayers: "max",
        load: async () => { throw loiCuoi; },
        begin: so.begin, emit: log.emit, sleep: clock.sleep,
      }),
    ).rejects.toBe(loiCuoi); // NGUYÊN đối tượng lỗi, không bọc lại

    const ref = log.ofType("refuse");
    expect(ref).toHaveLength(1);
    const d = ref[0].detail as Record<string, unknown>;
    expect(d.reason).toBe("all-outcomes-exhausted");
    expect(d.attempts).toBe(4);
    expect(d.signal).toBe("insufficient-vram-preflight");
    // Thứ tự kể chuyện: mọi `driver_refused`/`retry` đứng TRƯỚC lượt từ chối cuối.
    expect(log.events[log.events.length - 1].event).toBe("refuse");
  });

  it("5. đã ở nấc ĐÁY (`auto`) ⇒ KHÔNG hạ nữa, nhưng vẫn để lại vết `no-degrade-available`", async () => {
    const log = thuSuKien();
    const clock = dongHoGia();
    const plans: string[] = [];

    await expect(
      loadWithVramOutcomes({
        owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
        fileBytes: FIXTURE_BYTES, requestedGpuLayers: "auto",
        load: async (p) => { plans.push(String(p.gpuLayers)); throw LOI_THAT_CUA_LLAMA; },
        begin: soGiaySo().begin, emit: log.emit, sleep: clock.sleep,
      }),
    ).rejects.toThrow();

    expect(plans).toEqual(["auto", "auto", "auto"]); // 3 lượt, KHÔNG có lượt hạ cấp thứ 4
    expect(log.reasons()).toContain("no-degrade-available");
    expect(log.ofType("refuse")).toHaveLength(2); // no-degrade-available + all-outcomes-exhausted
  });

  it("6. lỗi KHÔNG phải cạn VRAM ⇒ KHÔNG thử lại, KHÔNG hạ cấp, ném NGAY — nhưng vẫn có sự kiện", async () => {
    const log = thuSuKien();
    const clock = dongHoGia();
    let luot = 0;

    await expect(
      loadWithVramOutcomes({
        owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
        fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
        load: async () => { luot++; throw new Error("corrupt gguf header"); },
        begin: soGiaySo().begin, emit: log.emit, sleep: clock.sleep,
      }),
    ).rejects.toThrow(/corrupt gguf header/);

    expect(luot, "một lượt duy nhất — thử lại một file hỏng chỉ tốn thời gian").toBe(1);
    expect(clock.calls).toEqual([]);
    expect(log.ofType("driver_refused")).toHaveLength(0);
    expect(log.reasons()).toContain("load-failed-not-vram");
  });

  it("7. `VRAM_LOAD_RETRIES` / `VRAM_LOAD_RETRY_DELAY_MS` ép được từ .env, số vô lý về mặc định", async () => {
    process.env.VRAM_LOAD_RETRIES = "0";
    process.env.VRAM_LOAD_RETRY_DELAY_MS = "250";
    expect(vramLoadRetries()).toBe(0);
    expect(vramLoadRetryDelayMs()).toBe(250);
    process.env.VRAM_LOAD_RETRIES = "khong-phai-so";
    process.env.VRAM_LOAD_RETRY_DELAY_MS = "-5";
    expect(vramLoadRetries()).toBe(VRAM_LOAD_RETRIES_DEFAULT);
    expect(vramLoadRetryDelayMs()).toBe(VRAM_LOAD_RETRY_DELAY_MS_DEFAULT);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — CẠM BẪY `gpuLayers: -1` (Math.max(0, Math.min(totalLayers, -1)) === 0)", () => {
  it("★★ 1. mã THẬT của node-llama-cpp vẫn chứa đúng phép tính biến -1 thành 0", () => {
    const p = path.join(process.cwd(), "node_modules", "node-llama-cpp", "dist", "gguf", "insights", "utils", "resolveModelGpuLayersOption.js");
    if (!fs.existsSync(p)) return; // môi trường không có node_modules — ba ca dưới vẫn canh hành vi
    const src = fs.readFileSync(p, "utf8").replace(/\s+/g, " ");
    expect(
      src,
      "Phép kẹp này là toàn bộ lý do 'đường lùi phải đặt số lớp tường minh'. Nếu nó biến mất, " +
        "đọc lại mã thật rồi mới sửa lá chắn — đừng gỡ lá chắn theo trí nhớ.",
    ).toMatch(/Math\.max\(0, Math\.min\(ggufInsights\.totalLayers, gpuLayers\)\)/);
    expect(Math.max(0, Math.min(48, -1))).toBe(0);
  });

  it("★★ 2. số ÂM KHÔNG BAO GIỜ tới node-llama-cpp, và lượt chuẩn hoá để lại sự kiện", async () => {
    for (const xin of [-1, -999]) {
      const log = thuSuKien();
      const thay: unknown[] = [];
      await loadWithVramOutcomes({
        owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
        fileBytes: FIXTURE_BYTES, requestedGpuLayers: xin,
        load: async (p) => { thay.push(p.gpuLayers); return { gpuLayers: 40 }; },
        resolvedGpuLayers: (m) => m.gpuLayers,
        begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
      });
      expect(thay, `gpuLayers ${xin} phải bị chặn ở cửa`).toEqual(["auto"]);
      const d = log.ofType("degraded")[0].detail as Record<string, unknown>;
      expect(d.reason).toBe("negative-gpu-layers");
      expect(d.requestedGpuLayers).toBe(xin);
    }
    // Hàm chuẩn hoá thuần — canh trực tiếp để lá chắn không phụ thuộc đường dài.
    expect(chuanHoaSoLop(-1)).toEqual({ gpuLayers: "auto", normalizedFrom: -1 });
    expect(chuanHoaSoLop(0)).toEqual({ gpuLayers: 0, normalizedFrom: null });
    expect(chuanHoaSoLop(undefined)).toEqual({ gpuLayers: "max", normalizedFrom: null });
    expect(chuanHoaSoLop(NaN)).toEqual({ gpuLayers: "auto", normalizedFrom: null });
  });

  it("★★★ 3. nạp THÀNH CÔNG ngay lượt đầu nhưng số lớp THẬT = 0 ⇒ VẪN kêu (`cpuOnly`)", async () => {
    const log = thuSuKien();
    const ket = await loadWithVramOutcomes({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
      load: async () => ({ gpuLayers: 0 }),          // llama.cpp "thành công" — trên CPU
      resolvedGpuLayers: (m) => m.gpuLayers,
      begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
    });
    expect(ket.outcome).toBe("loaded");              // lượt nạp KHÔNG hỏng…
    const d = log.ofType("degraded")[0].detail as Record<string, unknown>;
    expect(d.reason).toBe("zero-gpu-layers-on-success"); // …nhưng suy biến vẫn phải có tiếng
    expect(d.cpuOnly).toBe(true);
    expect(d.gpuLayers).toBe(0);
  });

  it("4. ĐỐI CHỨNG — nạp thành công với số lớp > 0 KHÔNG đẻ sự kiện nào (chống lưới GIẢ)", async () => {
    const log = thuSuKien();
    const ket = await loadWithVramOutcomes({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
      load: async () => ({ gpuLayers: 48 }),
      resolvedGpuLayers: (m) => m.gpuLayers,
      begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
    });
    expect(ket.outcome).toBe("loaded");
    expect(ket.resolvedGpuLayers).toBe(48);
    expect(log.events).toEqual([]);
  });

  it("5. không khai được cách đọc số lớp ⇒ `layerCountUnknown`, KHÔNG bịa ra 0", async () => {
    const log = thuSuKien();
    await loadWithVramOutcomes({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
      load: async (p) => { if (p.step !== "degrade") throw LOI_THAT_CUA_LLAMA; return {}; },
      begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
    });
    const d = log.ofType("degraded")[0].detail as Record<string, unknown>;
    expect(d.layerCountUnknown).toBe(true);
    expect(d.gpuLayers).toBeNull();
    expect(d.cpuOnly, "không đọc được ≠ 0 lớp — đừng gộp hai thứ").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — SỔ THẬT: driver từ chối KHÔNG để lại byte ma", () => {
  /** Đầu dò theo tiến trình giả — không mock thì `vramWiring` gọi powershell.exe THẬT. */
  function mockProbe(used: number) {
    vi.doMock("./vramProcessProbe", () => ({
      readProcessVram: async () => ({
        totalBytes: used, byPid: new Map([[process.pid, used]]), byLuid: new Map(), sampledAtMs: Date.now(),
      }),
      awaitCounterSettle: async () => {},
    }));
  }

  it("★★★ 1. bốn lượt hỏng ⇒ sổ RỖNG (không một giấy phép treo nào)", async () => {
    mockProbe(2048 * MiB);
    const { loadWithVramOutcomes: chay } = await import("./vramLoadOutcome");
    const { snapshot, __resetBrokerForTests } = await import("./vramBroker");
    __resetBrokerForTests();

    await expect(
      chay({
        owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
        fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
        load: async () => { throw LOI_THAT_CUA_LLAMA; },
        sleep: async () => {},
      }),
    ).rejects.toThrow();

    expect(
      snapshot().leases.filter((l) => l.request.owner === "gguf:fixture-17000"),
      "một giấy phép còn treo ở đây = sổ cộng dư VĨNH VIỄN 17.000 MiB ⇒ mọi lượt xin sau bị " +
        "từ chối trên BYTE MA",
    ).toHaveLength(0);
    expect(snapshot().totalReservedBytes).toBe(0);
  });

  it("★★★ 2. hạ cấp thành công ⇒ ĐÚNG MỘT giấy phép sống, và nó commit được số THẬT", async () => {
    mockProbe(2048 * MiB);
    const { loadWithVramOutcomes: chay } = await import("./vramLoadOutcome");
    const { snapshot, __resetBrokerForTests } = await import("./vramBroker");
    __resetBrokerForTests();

    const ket = await chay({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
      load: async (p) => { if (p.step !== "degrade") throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 20 }; },
      resolvedGpuLayers: (m) => m.gpuLayers,
      sleep: async () => {},
    });

    const song = snapshot().leases.filter((l) => l.request.owner === "gguf:fixture-17000");
    expect(song).toHaveLength(1);
    expect(song[0].request.estimatedBytes).toBe(FIXTURE_BYTES);
    expect(ket.outcome).toBe("degraded");

    await ket.ticket.commitMeasured();
    expect(snapshot().leases.find((l) => l.request.owner === "gguf:fixture-17000")!.actualBytes).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 ★★ CA BẮT BUỘC — KHÔNG CÓ ĐƯỜNG NÀO IM LẶNG", () => {
  /**
   * ⚠ BẢNG NÀY LÀ HỢP ĐỒNG. Mỗi dòng = MỘT nhánh thất bại có thật trong Task 3. Thêm nhánh mới mà
   * quên sự kiện ⇒ thêm dòng ⇒ dòng đó đỏ. Đây là lý do ca này table-driven chứ không phải 11 ca rời.
   */
  const NHANH: ReadonlyArray<{
    ten: string;
    /** Chạy nhánh, trả về danh sách sự kiện quan sát được. */
    chay: () => Promise<Array<Record<string, unknown>>>;
    reason: string;
  }> = [
    {
      ten: "lượt đầu hỏng vì cạn VRAM (bước 1)",
      reason: "driver-refused-after-ledger-gate",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async (p) => { if (p.step === "initial") throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 12 }; },
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "sắp thử lại (bước 2)",
      reason: "non-deterministic-ceiling",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async (p) => { if (p.step === "initial") throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 12 }; },
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "hạ số lớp (bước 3)",
      reason: "gpu-layers-lowered",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async (p) => { if (p.step !== "degrade") throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 12 }; },
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "từ chối trung thực (bước 4)",
      reason: "all-outcomes-exhausted",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async () => { throw LOI_THAT_CUA_LLAMA; },
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        }).catch(() => {});
        return log.events;
      },
    },
    {
      ten: "không còn nấc nào để hạ",
      reason: "no-degrade-available",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: 0,
          load: async () => { throw LOI_THAT_CUA_LLAMA; },
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        }).catch(() => {});
        return log.events;
      },
    },
    {
      ten: "lỗi KHÔNG phải cạn VRAM",
      reason: "load-failed-not-vram",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async () => { throw new Error("corrupt gguf header"); },
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        }).catch(() => {});
        return log.events;
      },
    },
    {
      ten: "gpuLayers ÂM bị chuẩn hoá",
      reason: "negative-gpu-layers",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: -1,
          load: async () => ({ gpuLayers: 12 }),
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "nạp thành công nhưng 0 lớp trên GPU",
      reason: "zero-gpu-layers-on-success",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async () => ({ gpuLayers: 0 }),
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "lượt giành lại chỗ (evictLRU) NÉM",
      reason: "reclaim-failed",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async (p) => { if (p.step === "initial") throw LOI_THAT_CUA_LLAMA; return { gpuLayers: 12 }; },
          resolvedGpuLayers: (m) => m.gpuLayers,
          reclaim: async () => { throw new Error("evictLRU hỏng"); },
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      ten: "beginVramAllocation NÉM (lời hứa 'không bao giờ ném' bị vỡ)",
      reason: "begin-allocation-threw",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async () => ({ gpuLayers: 12 }),
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: (async () => { throw new Error("sổ cái không nạp được"); }) as never,
          emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
  ];

  for (const nhanh of NHANH) {
    it(`★★ nhánh "${nhanh.ten}" để lại ÍT NHẤT một sự kiện (reason="${nhanh.reason}")`, async () => {
      const events = await nhanh.chay();
      expect(events.length, "nhánh thất bại KHÔNG có sự kiện nào = đúng lớp lỗi Task 3 đang diệt").toBeGreaterThan(0);
      const reasons = events.map((e) => String((e.detail as Record<string, unknown>)?.reason ?? ""));
      expect(reasons).toContain(nhanh.reason);
    });
  }

  it("★★★ `beginVramAllocation()` rơi vào catch cuối hàm ⇒ SỰ KIỆN + trạng thái đọc được (không chỉ console)", async () => {
    // Ép `estimateBytesFor()` ném ⇒ toàn thân `beginVramAllocation()` rơi vào catch ngoài cùng.
    vi.doMock("./vramEstimator", () => ({
      estimateBytesFor: async () => { throw new Error("ước lượng hỏng (ca thử nghiệm)"); },
      recordActual: () => {},
    }));
    const events: Array<Record<string, unknown>> = [];
    vi.doMock("./vramEventLog", () => ({
      logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
      flushVramEvents: async () => 0,
      sanitizeVramEvent: (e: unknown) => e,
      __setVramLogTimerEnabled: () => {},
      __hasVramLogTimer: () => false,
    }));

    const { beginVramAllocation, vramBeginFailureState, __resetVramBeginFailureState } = await import("./vramWiring");
    __resetVramBeginFailureState();
    const ticket = await beginVramAllocation({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive", fileBytes: FIXTURE_BYTES,
    });
    // Vẫn trả một giấy phép NOOP — chính sách "telemetry không làm hỏng lượt nạp" KHÔNG đổi.
    await ticket.commitMeasured();
    ticket.release();

    expect(vramBeginFailureState().count).toBe(1);
    expect(vramBeginFailureState().lastReason).toMatch(/ước lượng hỏng/);
    const ev = events.find((e) => (e.detail as Record<string, unknown>)?.reason === "begin-allocation-failed");
    expect(ev, "Task 2 chỉ để lại console.warn; một dòng console KHÔNG PHẢI một cơ chế").toBeDefined();
  });

  it("★★★ `warmModel()` KHÔNG còn nuốt — cả hai nhánh trả false đều để lại `warm_failed`", async () => {
    // node-llama-cpp KHÔNG nạp được ⇒ isGgufAvailable() false ⇒ nhánh "gguf-unavailable".
    vi.doMock("node-llama-cpp", () => { throw new Error("không có binding native (ca thử nghiệm)"); });
    const eventLog = await import("./vramEventLog");
    eventLog.__setVramLogTimerEnabled(false);
    const eng = await import("../aiGgufEngine");

    expect(await eng.warmModel("Qwen3-30B-khong-ton-tai")).toBe(false);

    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));

    // `noteWarmFailure()` ghi sự kiện trong một microtask nổi (nó KHÔNG được chặn đường warm).
    await vi.waitFor(async () => {
      expect(await eventLog.flushVramEvents()).toBeGreaterThan(0);
    }, { timeout: 2000 });

    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const warm = rows.filter((r) => r.event === "warm_failed");
    expect(warm.length, "0/24 lượt của Ư0 không có vết vì đúng nhánh này là một `catch {}`").toBeGreaterThan(0);
    expect(String((warm[0].detail as Record<string, unknown>).reason)).toBe("gguf-unavailable");
    expect(warm[0].owner).toBe("gguf:Qwen3-30B-khong-ton-tai");
  });

  it("★★★ `warmModel()` — nhánh lượt nạp/suy luận THẬT hỏng (`generate-threw`), nhánh mà Ư0 cần", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => { throw new Error("Failed to load model"); },
      LlamaChatSession: class { async prompt() { return "ok"; } },
      LlamaJsonSchemaGrammar: class {},
      LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
    }));
    vi.doMock("../aiLlamaServerClient", () => ({
      shouldUseServerForText: () => false, shouldUseServerForFim: () => false,
      preflightHealthy: async () => false, preflightHealthyForFim: async () => false,
      llamaServerStrict: () => false, llamaServerEnabled: () => false, llamaServerHealthy: async () => false,
    }));
    const eventLog = await import("./vramEventLog");
    eventLog.__setVramLogTimerEnabled(false);
    await eventLog.flushVramEvents();
    const eng = await import("../aiGgufEngine");

    expect(await eng.warmModel("Qwen3-30B-khong-ton-tai")).toBe(false);

    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    await vi.waitFor(async () => {
      expect(await eventLog.flushVramEvents()).toBeGreaterThan(0);
    }, { timeout: 2000 });

    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const warm = rows.filter((r) => r.event === "warm_failed");
    expect(warm.length).toBeGreaterThan(0);
    expect(String((warm[0].detail as Record<string, unknown>).reason)).toBe("generate-threw");
    expect(String((warm[0].detail as Record<string, unknown>).error), "lỗi THẬT phải đi kèm").not.toBe("null");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — ỐNG DẪN SỰ KIỆN: giá trị không hữu hạn KHÔNG được nuốt (bàn giao N-2 của Task 2)", () => {
  it("★★★ 1. `-Infinity` ở cột byte ⇒ ô TRỐNG + tên cột ghi lại, KHÔNG mất cả lô", () => {
    const out = sanitizeVramEvent({
      event: "refuse", owner: "gguf:fixture-17000", leaseKind: "gguf-model", priority: "interactive",
      estimatedBytes: FIXTURE_BYTES,
      actualBytes: -Infinity,           // fail-closed của Task 2 (computeHeadroom)
      driftBytes: NaN,
      detail: { reason: "test" },
    });
    // Cột `bigint(mode:"number")` — Postgres từ chối "-Infinity"/"NaN" ⇒ MẤT CẢ LÔ (5.000 dòng).
    expect(out.actualBytes).toBeUndefined();
    expect(out.driftBytes).toBeUndefined();
    expect(out.estimatedBytes, "số HỢP LỆ không được đụng tới").toBe(FIXTURE_BYTES);
    expect(out.detail!.nonFiniteFields).toEqual(["actualBytes=-Infinity", "driftBytes=NaN"]);
    expect(out.detail!.reason, "sự kiện KHÔNG bị vứt, chỉ bị làm sạch").toBe("test");
  });

  it("★★★ 2. `-Infinity` trong `detail` ⇒ CHUỖI, sống sót JSON.stringify (jsonb → `null` là bẫy thứ hai)", () => {
    // Chứng minh cái bẫy trước, rồi chứng minh bản vá — cùng một phép đo.
    expect(JSON.stringify({ headroomBytes: -Infinity })).toBe('{"headroomBytes":null}');

    const out = sanitizeVramEvent({
      event: "drift", owner: "gguf:fixture-17000", leaseKind: "gguf-model", priority: "interactive",
      detail: { headroomBytes: -Infinity, sau: { sau_nua: [1, Infinity, 3] }, ok: 5 },
    });
    expect(JSON.parse(JSON.stringify(out.detail))).toMatchObject({
      headroomBytes: "-Infinity",
      sau: { sau_nua: [1, "Infinity", 3] },
      ok: 5,
    });
    expect(out.detail!.nonFiniteFields).toEqual([
      "detail.headroomBytes=-Infinity",
      "detail.sau.sau_nua[1]=Infinity",
    ]);
  });

  it("★★ 3. chuỗi vượt độ rộng varchar bị CẮT + ghi tên (bẫy 22001 đã mất cả lô một lần rồi)", () => {
    const out = sanitizeVramEvent({
      event: "mot_ten_su_kien_dai_hon_hai_muoi_bon_ky_tu",
      owner: "x".repeat(200), leaseKind: "gguf-model", priority: "interactive",
    });
    expect(out.event.length).toBe(24);
    expect(out.owner.length).toBe(160);
    expect(out.detail!.truncatedFields).toEqual(["event: 42>24", "owner: 200>160"]);
  });

  it("4. ĐỐI CHỨNG — sự kiện bình thường đi qua KHÔNG bị thêm/bớt trường nào", () => {
    const vao = {
      event: "commit", owner: "gguf:fixture-17000", leaseKind: "gguf-model" as const,
      priority: "interactive" as const, estimatedBytes: FIXTURE_BYTES, actualBytes: 16_698 * MiB,
      detail: { measureSource: "process-delta", beforeUsedBytes: 0, afterUsedBytes: 16_698 * MiB },
    };
    expect(sanitizeVramEvent(vao)).toEqual(vao);
  });

  it("5. `Date` trong detail KHÔNG bị bóc thành `{}` (Object.entries(new Date()) === [])", () => {
    const d = new Date("2026-08-04T00:00:00.000Z");
    const out = sanitizeVramEvent({
      event: "drift", owner: "a", leaseKind: "gguf-model", priority: "interactive",
      detail: { luc: d, xau: -Infinity },
    });
    expect(out.detail!.luc).toBe(d);
    expect(JSON.parse(JSON.stringify(out.detail)).luc).toBe("2026-08-04T00:00:00.000Z");
  });

  it("6. tham chiếu VÒNG không làm treo bộ làm sạch", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() =>
      sanitizeVramEvent({ event: "drift", owner: "a", leaseKind: "gguf-model", priority: "interactive", detail: a }),
    ).not.toThrow();
  });

  it("★★ 7. `logVramEvent()` THẬT SỰ áp bộ làm sạch — lô vẫn ghi được với `-Infinity` đi vào", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    await flushVramEvents();

    logVramEvent({ event: "refuse", owner: "gguf:fixture-17000", leaseKind: "gguf-model", priority: "interactive", actualBytes: -Infinity });
    logVramEvent({ event: "commit", owner: "gguf:fixture-17000", leaseKind: "gguf-model", priority: "interactive", actualBytes: FIXTURE_BYTES });

    expect(await flushVramEvents(), "MẤT CẢ LÔ là hậu quả thật của một ô bigint không hữu hạn").toBe(2);
    const rows = insert.mock.calls[0][0] as unknown as Array<Record<string, unknown>>;
    expect(rows[0].actualBytes).toBeNull();
    expect(rows[1].actualBytes).toBe(FIXTURE_BYTES);
  });

  it("★★ 8. bảng độ rộng varchar KHỚP schema thật (đổi schema mà quên bảng = mất lô, im lặng)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "drizzle", "schema", "vram.ts"), "utf8");
    const thuc = new Map<string, number>();
    for (const m of src.matchAll(/(\w+):\s*varchar\("(\w+)",\s*\{\s*length:\s*(\d+)/g)) thuc.set(m[2], Number(m[3]));
    for (const [ten, rong] of [["event", 24], ["owner", 160], ["leaseKind", 32], ["priority", 16], ["estimateSource", 48]] as const) {
      expect(thuc.get(ten), `cột ${ten}`).toBe(rong);
    }
    // Và bộ làm sạch phải cắt đúng ngần ấy — canh bằng hành vi, không bằng đọc hằng số.
    for (const [ten, rong] of thuc) {
      if (ten === "wouldRefuse" || ten === "resourceKind") continue;
      const e: Record<string, unknown> = {
        event: "commit", owner: "a", leaseKind: "gguf-model", priority: "interactive",
      };
      e[ten] = "y".repeat(rong + 5);
      expect((sanitizeVramEvent(e as never) as unknown as Record<string, string>)[ten].length, ten).toBe(rong);
    }
  });
});
