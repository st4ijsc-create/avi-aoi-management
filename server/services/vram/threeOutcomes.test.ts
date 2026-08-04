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
  noteVramAllocationFailure,
  noteGpuLayersResolved,
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
  // ⚠ Lần THỨ HAI trong chính file này: ca N-1b thêm `doMock("fs")`, và nếu không gỡ thì ca
  // `warmModel generate-threw` (dựa vào việc file model KHÔNG tồn tại thật) đỏ vì lý do hoàn toàn
  // khác. Đo được: 1 ca đỏ khi chạy cả file, xanh khi chạy riêng.
  vi.doUnmock("fs");
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

  it("★★ 5b. N-3 — phán quyết phải nói HẾT CÁI GÌ, và `unknown` là câu TRUNG THỰC", () => {
    // Người trực đọc "OUT OF VRAM" rồi chạy nvidia-smi, thấy 30 GB trống, kết luận "sổ nói láo" —
    // trong khi thật ra máy hết RAM HỆ THỐNG. Cùng lớp "chỉ người trực đi sai hướng", khác trục.
    const scope = (m: string) => classifyLoadFailure(new Error(m)).scope;
    expect(scope("A context size of 32768 is too large for the available VRAM")).toBe("device-vram");
    expect(scope("Not enough VRAM to fit the model with the specified settings")).toBe("device-vram");
    expect(scope("A context size of 32768 is too large for the available RAM")).toBe("host-ram");
    // llama.cpp nuốt nguyên nhân ở hai câu này (init trả boolean) ⇒ đoán bừa là VRAM chính là lỗi.
    expect(scope("Failed to load model")).toBe("unknown");
    expect(scope("Failed to create context")).toBe("unknown");
    expect(scope("A context size of 32768 is too large for the available resources")).toBe("unknown");
    // Mọi dòng trong bảng phải khai scope — thiếu một dòng là một câu chữ đoán bừa đang chờ.
    for (const [pattern, , sc] of VRAM_EXHAUSTION_SIGNALS) {
      expect(["device-vram", "host-ram", "unknown"], pattern).toContain(sc);
    }
  });

  it("★★ 5c. N-4 — `\"auto\"` KHÔNG BAO GIỜ ném ⇒ 0 lớp phải bị ĐỌC LẠI mà bắt, ở điểm gọi NGOÀI §5.5", () => {
    const log = thuSuKien();
    // Thiết bị chật ⇒ resolveModelGpuLayersOption nhánh chuỗi kết bằng `?? 0` ⇒ "thành công" trên CPU.
    noteGpuLayersResolved({
      owner: "reranker:bge.gguf", kind: "gguf-model", priority: "background",
      site: "aiReranker.loadModel", requestedGpuLayers: "auto", resolvedGpuLayers: 0, emit: log.emit,
    });
    const d = log.ofType("degraded")[0].detail as Record<string, unknown>;
    expect(d.reason).toBe("zero-gpu-layers-on-success");
    expect(d.cpuOnly).toBe(true);
    expect(d.site).toBe("aiReranker.loadModel");

    // Không đọc được số lớp ⇒ vẫn phải kêu, nhưng KHÔNG được khai là 0 (hai thứ khác nhau).
    const log2 = thuSuKien();
    noteGpuLayersResolved({
      owner: "reranker:bge.gguf", kind: "gguf-model", priority: "background",
      site: "aiReranker.loadModel", requestedGpuLayers: "auto", resolvedGpuLayers: undefined, emit: log2.emit,
    });
    const d2 = log2.ofType("degraded")[0].detail as Record<string, unknown>;
    expect(d2.reason).toBe("gpu-layer-count-unreadable");
    expect(d2.cpuOnly).toBe(false);
    expect(d2.layerCountUnknown).toBe(true);

    // ĐỐI CHỨNG — đường ĐÚNG phải IM. Im lặng ở đường đúng là im lặng đúng.
    const log3 = thuSuKien();
    noteGpuLayersResolved({
      owner: "reranker:bge.gguf", kind: "gguf-model", priority: "background",
      site: "aiReranker.loadModel", requestedGpuLayers: "auto", resolvedGpuLayers: 25, emit: log3.emit,
    });
    expect(log3.events).toEqual([]);
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
    expect(chuanHoaSoLop(-1)).toEqual({ gpuLayers: "auto", normalizedFrom: -1, reason: "negative-gpu-layers" });
    expect(chuanHoaSoLop(0)).toEqual({ gpuLayers: 0, normalizedFrom: null, reason: null });
    expect(chuanHoaSoLop(undefined)).toEqual({ gpuLayers: "max", normalizedFrom: null, reason: null });
    // ★ M-3 (review vòng 1) — bản trước KHOÁ `reason: null` ở đây, tức viết một nhánh IM LẶNG vào
    // HỢP ĐỒNG, ngay trong task diệt im lặng. Nay `NaN`/`Infinity` cũng phải có lý do ⇒ có sự kiện.
    expect(chuanHoaSoLop(NaN)).toEqual({ gpuLayers: "auto", normalizedFrom: NaN, reason: "non-finite-gpu-layers" });
    expect(chuanHoaSoLop(Infinity).reason).toBe("non-finite-gpu-layers");
  });

  it("★★ 2b. M-3 — `NaN` KHÔNG được lọt vào jsonb dưới dạng `null` (sự kiện phải đọc được)", async () => {
    const log = thuSuKien();
    await loadWithVramOutcomes({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      fileBytes: FIXTURE_BYTES, requestedGpuLayers: NaN,
      load: async () => ({ gpuLayers: 12 }),
      resolvedGpuLayers: (m) => m.gpuLayers,
      begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
    });
    const d = log.ofType("degraded")[0].detail as Record<string, unknown>;
    expect(d.reason).toBe("non-finite-gpu-layers");
    // `JSON.stringify(NaN)` là `null` ⇒ số biến mất IM LẶNG trong cột jsonb. Điểm gọi tự hoá chuỗi.
    expect(d.requestedGpuLayers).toBe("NaN");
    expect(JSON.parse(JSON.stringify(d)).requestedGpuLayers).toBe("NaN");
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

  /**
   * ★★★ I-3 (review vòng 1) — CỬA THỨ HAI CỦA BẪY `-1`, TRONG MÃ SẢN XUẤT, KHÔNG LÁ CHẮN.
   *
   * `chuanHoaSoLop()` chỉ với tới những gì đi qua `loadWithVramOutcomes()`. `aiReranker.ts` gọi
   * `llama.loadModel()` THẲNG với một hằng số `-1` GHIM CỨNG. Reviewer đo trên phần cứng thật, đúng
   * file model đó (`bge-reranker-v2-m3-Q8_0.gguf`): `gpuLayers: -1` ⇒ `model.gpuLayers === 0` trong
   * khi `totalLayers === 25`. `.env` hôm nay có `RAG_RERANKER_GPU=false` nên vô hại — nhưng bật
   * đúng một cờ là có ngay một hộ tiêu thụ chạy CPU trong im lặng.
   *
   * ⚠ Ca này quét THEO LỚP, không theo một dòng: bất kỳ `gpuLayers` ÂM nào mới xuất hiện trong
   * `server/**` đều đỏ. Đó là khác biệt giữa "sửa một thể hiện" và "khoá một lớp".
   */
  it("★★★ 4b. I-3 — KHÔNG file nào trong server/ còn truyền `gpuLayers` ÂM cho node-llama-cpp", () => {
    const goc = path.join(process.cwd(), "server");
    const viPham: string[] = [];
    const duyet = (thuMuc: string) => {
      for (const e of fs.readdirSync(thuMuc, { withFileTypes: true })) {
        const p = path.join(thuMuc, e.name);
        if (e.isDirectory()) { duyet(p); continue; }
        if (!/\.ts$/.test(e.name) || /\.test\.ts$/.test(e.name)) continue;
        const src = fs.readFileSync(p, "utf8");
        /**
         * Bỏ chú thích VÀ chuỗi. Cả hai đều cần, và đã đo:
         *   • chú thích — `vramLoadOutcome.ts`/`aiReranker.ts` GIẢI THÍCH bẫy `-1` bằng chữ; máy
         *     quét bắt chính lời giải thích của mình là một lưới GIẢ;
         *   • chuỗi — một `note:` sản xuất chứa đúng chữ "gpuLayers:-1" cũng khớp.
         */
        const ma = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "")
          .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
        /**
         * ⚠ Chỉ khớp khi GIÁ TRỊ bắt đầu bằng dấu trừ + chữ số, tức một HẰNG SỐ ÂM truyền thẳng.
         * KHÔNG khớp `z.number().min(-1)` ở `aiGgufRouter.ts` — đó là lược đồ ĐẦU VÀO, và cửa đó
         * đã có `chuanHoaSoLop()` chặn KÈM SỰ KIỆN (cố ý giữ nguyên: từ chối thẳng ở API sẽ làm
         * hỏng một lời gọi hợp lệ theo quy ước llama.cpp CLI, còn chuẩn hoá-có-tiếng thì không).
         */
        for (const m of ma.matchAll(/gpuLayers\s*:\s*(-\s*\d+)/g)) {
          viPham.push(`${path.relative(process.cwd(), p)} → gpuLayers: ${m[1].trim()}`);
        }
      }
    };
    duyet(goc);
    expect(
      viPham,
      "node-llama-cpp 3.x tính Math.max(0, Math.min(totalLayers, n)) ⇒ MỌI số âm nghĩa là 0 LỚP " +
        "TRÊN GPU: suy luận chạy CPU, chậm gấp bội, KHÔNG một dòng cảnh báo. Dùng \"auto\" (nạp " +
        "nhiều lớp nhất còn vừa) hoặc \"max\" (tất cả, ném nếu không đủ).",
    ).toEqual([]);
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
      // ⚠ M-6 — trước bản vá, nhánh này KHÔNG sinh sự kiện nào: `resolved` thành `null`, `cpuOnly`
      // thành `false`, và lá chắn `zero-gpu-layers-on-success` MÙ đúng lúc nó cần thấy nhất.
      ten: "bộ đọc số lớp (resolvedGpuLayers) NÉM",
      reason: "resolve-gpu-layers-threw",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
          load: async () => ({ gpuLayers: 12 }),
          resolvedGpuLayers: () => { throw new Error("getter hỏng"); },
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      // ⚠ M-3 — `NaN` từng đổi ngầm sang "auto" KHÔNG sự kiện, và ca test còn KHOÁ hành vi đó.
      ten: "gpuLayers KHÔNG HỮU HẠN bị chuẩn hoá",
      reason: "non-finite-gpu-layers",
      chay: async () => {
        const log = thuSuKien();
        await loadWithVramOutcomes({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          fileBytes: FIXTURE_BYTES, requestedGpuLayers: NaN,
          load: async () => ({ gpuLayers: 12 }),
          resolvedGpuLayers: (m) => m.gpuLayers,
          begin: soGiaySo().begin, emit: log.emit, sleep: dongHoGia().sleep,
        });
        return log.events;
      },
    },
    {
      // ⚠ I-1 — bốn đường cấp phát NGOÀI §5.5 (ba createContext + đường dự phòng). Chúng KHÔNG đi
      // qua loadWithVramOutcomes nên bảng này canh chúng qua `noteVramAllocationFailure`.
      ten: "cấp phát hỏng NGOÀI §5.5 vì hết VRAM (createContext)",
      reason: "driver-refused-outside-load-outcomes",
      chay: async () => {
        const log = thuSuKien();
        noteVramAllocationFailure({
          owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
          site: "loadGgufModel.createContext",
          err: new Error("A context size of 32768 is too large for the available VRAM"),
          emit: log.emit,
        });
        return log.events;
      },
    },
    {
      ten: "cấp phát hỏng NGOÀI §5.5 vì lý do KHÁC",
      reason: "allocation-failed-not-vram",
      chay: async () => {
        const log = thuSuKien();
        noteVramAllocationFailure({
          owner: "gguf-embed-ctx:x", kind: "gguf-embed-context", priority: "background",
          site: "getEmbeddingContext.createEmbeddingContext",
          err: new Error("model has no embedding head"),
          emit: log.emit,
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

    /**
     * ★★★ C-1 (review vòng 1) — SỔ PHẢI TỰ KHAI PHẦN HỤT BẰNG **BYTE**, KHÔNG PHẢI BẰNG **LƯỢT**.
     * Vòng trước tôi từ chối cả (i) cưỡng chế lẫn (ii) kế toán, viện cùng một lý do. (i) đúng là
     * Task 5; (ii) **không cần từ chối ai cả**. Và một cái đếm KHÔNG đổi ngược thành byte được.
     */
    expect(vramBeginFailureState().unledgeredBytes).toBe(FIXTURE_BYTES);
    expect(vramBeginFailureState().unknownCount).toBe(0);
    expect((ev!.detail as Record<string, unknown>).unledgeredBytes).toBe(FIXTURE_BYTES);
    expect((ev!.detail as Record<string, unknown>).unledgeredBytesTotal).toBe(FIXTURE_BYTES);

    // Lượt thứ hai KHÔNG có căn cứ nào để ước byte ⇒ phải TÁCH, không cộng một số 0 giả vào tổng.
    const t2 = await beginVramAllocation({ owner: "gguf-ctx:x", kind: "gguf-context", priority: "interactive" });
    t2.release();
    expect(vramBeginFailureState().count).toBe(2);
    expect(vramBeginFailureState().unledgeredBytes, "0 giả sẽ làm cuốn sổ hụt tự khai là đủ").toBe(FIXTURE_BYTES);
    expect(vramBeginFailureState().unknownCount).toBe(1);
    const ev2 = events.filter((e) => (e.detail as Record<string, unknown>)?.reason === "begin-allocation-failed")[1];
    expect((ev2.detail as Record<string, unknown>).unledgeredBytesUnknown).toBe(true);
    expect((ev2.detail as Record<string, unknown>).unledgeredBytes).toBeNull();
  });

  /**
   * ★★★ I-2 (review vòng 1) — LỖ NẶNG NHẤT CỦA VÒNG TRƯỚC, VÀ NÓ TÁI TẠO ĐÚNG LỚP LỖI `0/24`
   * CAO HƠN MỘT TẦNG.
   *
   * Toàn bộ bảng ★★ ở trên tiêm `emit` vào, nên nó chứng minh **CHÍNH SÁCH gọi emit**, KHÔNG chứng
   * minh **emit nối được vào sổ**. Reviewer đột biến `const emit = spec.emit ?? logVramEvent` thành
   * một **hàm rỗng** ⇒ `server/services/vram/` **355/355 XANH** và `aiGgufEngine` **87/87 XANH**.
   * Tức: bốn bước §5.5 có thể trở lại VÔ HÌNH mà không một ca nào đỏ — đúng hình dạng "thứ con
   * người đọc được ≠ thứ hệ thống nhận được" mà cả task này sinh ra để diệt.
   *
   * Ca này chạy `loadWithVramOutcomes` **KHÔNG truyền `emit`**, rồi đòi thấy sự kiện ở **đầu kia
   * của ống dẫn** — trong lô mà `flushVramEvents()` đưa cho `db.insert()`.
   */
  it("★★★ I-2 — sự kiện của loadWithVramOutcomes TỚI ĐƯỢC ỐNG DẪN THẬT (không tiêm emit)", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    vi.doMock("./vramProcessProbe", () => ({
      readProcessVram: async () => ({
        totalBytes: 2048 * MiB, byPid: new Map([[process.pid, 2048 * MiB]]), byLuid: new Map(), sampledAtMs: Date.now(),
      }),
      awaitCounterSettle: async () => {},
    }));

    const eventLog = await import("./vramEventLog");
    eventLog.__setVramLogTimerEnabled(false);
    await eventLog.flushVramEvents(); // dọn hàng đợi của ca trước
    const { loadWithVramOutcomes: chay } = await import("./vramLoadOutcome");
    const { __resetBrokerForTests } = await import("./vramBroker");
    __resetBrokerForTests();

    await expect(
      chay({
        owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
        fileBytes: FIXTURE_BYTES, requestedGpuLayers: "max",
        load: async () => { throw LOI_THAT_CUA_LLAMA; },
        sleep: async () => {},
        // ⚠ KHÔNG truyền `emit` — ĐÓ LÀ TOÀN BỘ NỘI DUNG CỦA CA NÀY.
      }),
    ).rejects.toThrow();

    expect(await eventLog.flushVramEvents()).toBeGreaterThan(0);
    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const loai = new Set(rows.map((r) => String(r.event)));
    for (const mong of ["driver_refused", "retry", "refuse"]) {
      expect(loai, `"${mong}" KHÔNG tới được db.insert() — dây emit→logVramEvent đã đứt`).toContain(mong);
    }
    // Và chúng phải mang đúng chủ — không phải một dòng lạc của module khác.
    expect(rows.filter((r) => r.event === "driver_refused").every((r) => r.owner === "gguf:fixture-17000")).toBe(true);
  });

  /**
   * ★★★ N-1 (re-review) — DÂY THỨ HAI, DO CHÍNH VÒNG SỬA I-2 ĐẺ RA.
   *
   * Vòng trước tôi đóng dây của `loadWithVramOutcomes`, rồi **thêm `noteVramAllocationFailure` với
   * ĐÚNG cùng hình dạng `?? logVramEvent` mà không dựng lưới cho nó**. Reviewer đột biến `emit` mặc
   * định của nó thành hàm rỗng ⇒ **452/452 XANH, không ca nào bắt**. Lần thứ BA cùng một hình dạng
   * trong một task: chứng minh được thứ mình viết ra, không chứng minh được thứ hệ thống nhận được.
   */
  it("★★★ N-1a — sự kiện của noteVramAllocationFailure TỚI ĐƯỢC ỐNG DẪN THẬT (không tiêm emit)", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    const eventLog = await import("./vramEventLog");
    eventLog.__setVramLogTimerEnabled(false);
    await eventLog.flushVramEvents();
    const { noteVramAllocationFailure: ghi } = await import("./vramLoadOutcome");

    // ⚠ KHÔNG truyền `emit` — ĐÓ LÀ TOÀN BỘ NỘI DUNG CỦA CA NÀY.
    const v = ghi({
      owner: "gguf:fixture-17000", kind: "gguf-model", priority: "interactive",
      site: "loadGgufModel.createContext",
      err: new Error("A context size of 32768 is too large for the available VRAM"),
    });
    expect(v.exhausted).toBe(true);
    expect(v.scope).toBe("device-vram");

    expect(await eventLog.flushVramEvents()).toBeGreaterThan(0);
    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const ev = rows.find((r) => r.event === "driver_refused");
    expect(ev, "dây emit→logVramEvent của noteVramAllocationFailure đã đứt").toBeDefined();
    expect((ev!.detail as Record<string, unknown>).site).toBe("loadGgufModel.createContext");
    expect((ev!.detail as Record<string, unknown>).scope).toBe("device-vram");
  });

  /**
   * ★★★ N-1b — DÂY THỨ BA: `noteContextFailure` của `aiGgufEngine`, **cầu nối DUY NHẤT của cả bốn
   * đường I-1**, và vòng trước nó KHÔNG có một ca nào. Nó còn nuốt lỗi nhập động bằng `console.warn`
   * ⇒ nếu lượt `import("./vram/vramLoadOutcome")` hỏng, bốn đường quay lại IM LẶNG mà không ai biết.
   *
   * Ca này đi ĐƯỜNG THẬT: `loadGgufModel()` với `createContext` ném lỗi hết VRAM ⇒ đòi thấy sự kiện
   * ở ĐẦU KIA của ống dẫn (`db.insert`), không phải ở một `emit` tiêm vào.
   */
  it("★★★ N-1b — bốn đường I-1 để lại vết THẬT: loadGgufModel.createContext → db.insert()", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    vi.doMock("./vramProcessProbe", () => ({
      readProcessVram: async () => ({
        totalBytes: 2048 * MiB, byPid: new Map([[process.pid, 2048 * MiB]]), byLuid: new Map(), sampledAtMs: Date.now(),
      }),
      awaitCounterSettle: async () => {},
    }));
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({
        loadModel: async () => ({
          size: 1234, gpuLayers: 48,
          tokenize: (t: string) => t.split(" "),
          // ⚠ ĐỈNH áp lực VRAM: trọng số đã nạp XONG, giờ mới xin KV cache và hỏng.
          createContext: async () => { throw new Error("A context size of 32768 is too large for the available VRAM"); },
          createEmbeddingContext: async () => ({ getEmbeddingFor: async () => ({ vector: [] }), dispose: async () => {} }),
          dispose: async () => {},
        }),
        getVramState: async () => ({ total: 32 * 1024 * MiB, used: 2048 * MiB, free: 30 * 1024 * MiB, unifiedSize: 0 }),
      }),
      LlamaChatSession: class { async prompt() { return "ok"; } },
      LlamaJsonSchemaGrammar: class {},
      LlamaLogLevel: { fatal: "fatal", error: "error", warn: "warn", info: "info" },
    }));
    const fsApi = {
      existsSync: () => true, mkdirSync: () => {}, readdirSync: () => [] as string[],
      statSync: () => ({ size: FIXTURE_BYTES, mtime: new Date(), isFile: () => true }),
    };
    vi.doMock("fs", () => ({ default: fsApi, ...fsApi }));

    const eventLog = await import("./vramEventLog");
    eventLog.__setVramLogTimerEnabled(false);
    await eventLog.flushVramEvents();
    const eng = await import("../aiGgufEngine");

    await expect(eng.loadGgufModel({ modelPath: "big.gguf" })).rejects.toThrow(/too large for the available VRAM/);

    expect(await eventLog.flushVramEvents()).toBeGreaterThan(0);
    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const ev = rows.find((r) => (r.detail as Record<string, unknown>)?.site === "loadGgufModel.createContext");
    expect(
      ev,
      "bốn đường I-1 đi qua noteContextFailure — không ca nào chứng minh chúng để lại vết trong " +
        "vram_events thì bản vá I-1 chỉ là mã chưa ai chạy",
    ).toBeDefined();
    expect(ev!.event).toBe("driver_refused");
    expect(ev!.owner).toBe("gguf:big");
    expect((ev!.detail as Record<string, unknown>).scope).toBe("device-vram");
    // Và giấy phép của lượt nạp hỏng KHÔNG được treo lại trong sổ.
    const { snapshot } = await import("./vramBroker");
    expect(snapshot().leases.filter((l) => l.request.owner === "gguf:big")).toHaveLength(0);
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
    // ⚠ M-5 (review vòng 1) — `warm_skipped`, KHÔNG PHẢI `warm_failed`: "chưa cấu hình GGUF" không
    // phải một thất bại, và nó ghi MỘT DÒNG MỖI LẦN KHỞI ĐỘNG. Để nó mang tên "failed" là bắt
    // Task 7 lọc rác trong chính bảng nó dùng để đếm thất bại.
    const warm = rows.filter((r) => r.event === "warm_skipped");
    expect(warm.length, "0/24 lượt của Ư0 không có vết vì đúng nhánh này là một `catch {}`").toBeGreaterThan(0);
    expect(rows.some((r) => r.event === "warm_failed"), "không cấu hình GGUF KHÔNG phải thất bại").toBe(false);
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

  it("6. tham chiếu VÒNG không làm treo bộ làm sạch, và lượt cắt vòng ĐƯỢC GHI TÊN", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    const out = sanitizeVramEvent({
      event: "drift", owner: "a", leaseKind: "gguf-model", priority: "interactive", detail: a,
    });
    // ⚠ N-6 (re-review) — Ô RIÊNG `unscrubbedPaths`, KHÔNG đổ chung vào `nonFiniteFields`:
    // "chỗ chưa duyệt tới" KHÔNG PHẢI "số hỏng", và gộp lại là để Task 7 ĐẾM THỪA.
    expect(String((out.detail!.unscrubbedPaths as string[])?.join("|"))).toMatch(/vòng/);
    expect(out.detail!.nonFiniteFields, "không có số hỏng nào ở đây").toBeUndefined();
  });

  it("★★★ 6b. M-1 — tham chiếu DÙNG CHUNG (DAG, KHÔNG vòng) phải được làm sạch ĐỦ MỌI LẦN", () => {
    // Bản đầu dùng visited-set không bao giờ xoá ⇒ lần gặp THỨ HAI trả nguyên bản ⇒ `y` mất số
    // IM LẶNG và KHÔNG được ghi tên. Chính bộ làm sạch chống-im-lặng tự đẻ ra một đường im lặng.
    const shared = { headroomBytes: -Infinity };
    const out = sanitizeVramEvent({
      event: "drift", owner: "a", leaseKind: "gguf-model", priority: "interactive",
      detail: { x: shared, y: shared },
    });
    const json = JSON.parse(JSON.stringify(out.detail));
    expect(json.x.headroomBytes).toBe("-Infinity");
    expect(json.y.headroomBytes, "nhánh DÙNG CHUNG thứ hai KHÔNG được thành null").toBe("-Infinity");
    expect(out.detail!.nonFiniteFields).toEqual([
      "detail.x.headroomBytes=-Infinity",
      "detail.y.headroomBytes=-Infinity",
    ]);
  });

  it("★★ 6c. M-2 — sâu quá trần thì CẮT, nhưng phải KÊU (cắt im lặng vẫn là im lặng)", () => {
    let sau: Record<string, unknown> = { v: -Infinity };
    for (let i = 0; i < 11; i++) sau = { n: sau };
    const out = sanitizeVramEvent({
      event: "drift", owner: "a", leaseKind: "gguf-model", priority: "interactive", detail: sau,
    });
    // ⚠ N-6 — lượt CẮT đi vào `unscrubbedPaths`; `nonFiniteFields` chỉ dành cho SỐ hỏng thật.
    const ten = (out.detail!.unscrubbedPaths as string[]) ?? [];
    expect(ten.length, "trần độ sâu là đúng; cắt mà không ghi tên thì không").toBeGreaterThan(0);
    expect(ten.some((s) => /sâu quá 8 tầng/.test(s))).toBe(true);
    expect(out.detail!.nonFiniteFields, "số ở đáy KHÔNG được duyệt tới ⇒ không được khai là đã bắt").toBeUndefined();
  });

  it("★★ 6d. M-4 — hàng đợi ĐẦY thì có ĐẾM và có TIẾNG, không vứt im lặng", async () => {
    // ⚠ N-7 (re-review) — `try/finally`: nếu một assertion đỏ SỚM, biến môi trường rò sang mọi ca
    // sau (QUEUE_MAX=2 ⇒ chúng vứt sự kiện) và ta được một tràng đỏ chỉ vào SAI chỗ.
    try {
    process.env.VRAM_LOG_QUEUE_MAX = "2";
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({ getDb: async () => ({ insert: () => ({ values: insert }) }) }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled, __vramDroppedEventCount } =
      await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    const mot = (n: number) => ({
      event: "retry", owner: `gguf:${n}`, leaseKind: "gguf-model" as const, priority: "interactive" as const,
    });

    logVramEvent(mot(1));
    logVramEvent(mot(2));
    logVramEvent(mot(3)); // VỨT
    logVramEvent(mot(4)); // VỨT
    expect(__vramDroppedEventCount()).toBe(2);

    expect(await flushVramEvents()).toBe(2);
    // Sự kiện ĐẦU TIÊN ghi được sau quãng thủng phải mang theo con số đó — nếu không, số sự kiện
    // bị vứt là VÔ HÌNH với mọi truy vấn của Task 7.
    logVramEvent(mot(5));
    expect(__vramDroppedEventCount()).toBe(0);
    await flushVramEvents();
    const rows = insert.mock.calls.flatMap((c) => (c as unknown as [Array<Record<string, unknown>>])[0]);
    const cuoi = rows[rows.length - 1];
    expect((cuoi.detail as Record<string, unknown>).droppedBeforeThis).toBe(2);
    } finally {
      delete process.env.VRAM_LOG_QUEUE_MAX;
    }
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
