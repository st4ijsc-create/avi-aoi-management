/**
 * llamaVisionSidecar — THAM SỐ SPAWN, canh trên ĐƯỜNG THOÁT THẬT.
 *
 * ★ G1-C (2026-08-16) — VIẾT LẠI. Bản cũ chỉ `readFileSync` chính file nguồn rồi
 * `expect(src).toContain('"-np"')`. Đó đúng là lớp *"lưới theo FILE, không theo ĐƯỜNG THOÁT"* đã
 * tái diễn nhiều lần ở repo này: nó xanh kể cả khi mảng args bị đổi tên biến, bị bọc trong nhánh
 * `if` không bao giờ chạy, hay khi cờ được nối SAI THỨ TỰ với giá trị của nó. Nó canh CHỮ trong
 * file, không canh thứ **thực sự được giao cho `spawn()`**.
 *
 * Bản này mock `child_process.spawn` và đọc ĐÚNG mảng mà đường sản xuất truyền đi — cùng khuôn
 * với `llamaVisionSidecar.test.ts`. Nhờ vậy nó canh được cả thứ mà bản cũ mù hoàn toàn:
 * **cặp cờ↔giá trị có liền nhau không** (`--flash-attn on`, chứ không phải `--flash-attn` rồi
 * một cờ khác chen vào giữa), và **có cờ nào KHÔNG được binary hỗ trợ bị lọt vào không**.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import path from "path";

const MODELS_DIR = path.resolve("/models");
const inModels = (f: string) => path.join(MODELS_DIR, f);
const abs = (p: string) => path.resolve(p);

const fsFiles = new Map<string, { size: number; head: Buffer }>();
vi.mock("fs", () => {
  const api = {
    existsSync: (p: string) => fsFiles.has(String(p)),
    statSync: (p: string) => {
      const f = fsFiles.get(String(p));
      if (!f) throw new Error("ENOENT");
      return { size: f.size, isFile: () => true };
    },
    openSync: (p: string) => {
      if (!fsFiles.has(String(p))) throw new Error("ENOENT");
      return 1;
    },
    readSync: (_fd: number, buffer: Buffer) => {
      const head = (globalThis as any).__currentHead as Buffer | undefined;
      if (!head) return 0;
      head.copy(buffer, 0, 0, Math.min(4, head.length));
      return Math.min(4, head.length);
    },
    closeSync: () => undefined,
    mkdirSync: () => undefined,
    readdirSync: () => [],
  };
  return { ...api, default: api };
});

const spawnCalls: any[] = [];
class FakeProc extends EventEmitter {
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() {
    this.killed = true;
    return true;
  }
}
vi.mock("child_process", () => ({
  spawn: (...args: any[]) => {
    spawnCalls.push(args);
    return new FakeProc();
  },
}));

const GGUF_HEADER = Buffer.from([0x47, 0x47, 0x55, 0x46]);
const BIG = 5 * 1024 * 1024;
const BIN_PATH = abs("/bin/llama-server");

beforeEach(() => {
  fsFiles.clear();
  spawnCalls.length = 0;
  vi.resetModules();
  process.env.LLAMA_VISION_HOST = "127.0.0.1";
  process.env.LLAMA_VISION_PORT = "8099";
  process.env.LLAMA_VISION_READY_TIMEOUT_MS = "5000";
  process.env.LLAMA_VISION_STOP_WAIT_MS = "10";
  process.env.GGUF_MODELS_DIR = "/models";
  process.env.LLAMA_SERVER_BIN = BIN_PATH;
  process.env.GGUF_VISION_MODEL = "qwen3-vl.gguf";
  process.env.GGUF_VISION_MMPROJ = "mmproj.gguf";
  // Mọi ca tự quyết kiểu KV-cache; xoá để .env thật (vitest.setup nạp .env) không rò vào ca.
  delete process.env.LLAMA_VISION_CACHE_TYPE_K;
  delete process.env.LLAMA_VISION_CACHE_TYPE_V;
  delete process.env.LLAMA_VISION_CTX;
  fsFiles.set(BIN_PATH, { size: BIG, head: GGUF_HEADER });
  fsFiles.set(inModels("qwen3-vl.gguf"), { size: BIG, head: GGUF_HEADER });
  fsFiles.set(inModels("mmproj.gguf"), { size: BIG, head: GGUF_HEADER });
  (globalThis as any).__currentHead = GGUF_HEADER;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/health")) return { ok: true, json: async () => ({ status: "ok" }) } as any;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }) } as any;
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Chạy đường sản xuất thật tới lúc spawn, trả về mảng args đã được giao cho spawn(). */
async function spawnArgs(): Promise<string[]> {
  const mod = await import("./llamaVisionSidecar");
  await mod.describeImageViaSidecar({
    image: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    prompt: "x",
  });
  await mod.stopSidecar();
  expect(spawnCalls.length).toBe(1);
  return spawnCalls[0][1] as string[];
}

/** Giá trị đi ngay SAU một cờ — undefined nếu cờ vắng mặt. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe("llamaVisionSidecar — tham số spawn (quan sát spawn thật)", () => {
  it("giữ nguyên các tham số bắt buộc cũ", async () => {
    const args = await spawnArgs();
    for (const flag of ["-m", "--mmproj", "--host", "--port", "-ngl", "-c", "-np", "--jinja"]) {
      expect(args).toContain(flag);
    }
  });

  it("BẬT flash-attention TƯỜNG MINH bằng giá trị (build này nhận [on|off|auto], mặc định auto)", async () => {
    const args = await spawnArgs();
    expect(args).toContain("--flash-attn");
    // Cặp cờ↔giá trị PHẢI liền nhau: `--flash-attn on`. Bản test cũ (grep nguồn) mù chỗ này.
    expect(valueAfter(args, "--flash-attn")).toBe("on");
  });

  // ★★★ ĐO 2026-08-16 (G1-A) — mặc định ĐỔI q8_0/q4_0 → f16/f16. Lượng hoá KV trên build 9814 /
  // RTX 5090 sm_120 làm prefill chậm 62–85× (6.485 → ~100 tok/s) và decode chậm 8–15×. Con số
  // "perplexity ratio 1,006" từng dùng để biện minh q8_0/q4_0 nói về CHẤT LƯỢNG, không phải TỐC ĐỘ.
  it("KV-cache f16 cho CẢ K và V — lượng hoá KV rơi khỏi kernel nhanh trên sm_120", async () => {
    const args = await spawnArgs();
    expect(valueAfter(args, "--cache-type-k")).toBe("f16");
    expect(valueAfter(args, "--cache-type-v")).toBe("f16");
  });

  it("KHÔNG hạ -c: vẫn 8192, vì generateQAReport gửi tới 10 ảnh + 2048 token sinh", async () => {
    const args = await spawnArgs();
    expect(valueAfter(args, "-c")).toBe("8192");
  });

  // Cổng cấm-4-bit-cho-K GIỮ NGUYÊN dù mặc định nay là f16: nó canh trường hợp ai đó CỐ Ý đặt
  // env (vd để lấy lại VRAM), và lý do cấm — perplexity ratio 199,7, model nói nhảm mà KHÔNG
  // crash — vẫn đúng nguyên vẹn. Nay ép về f16 thay vì q8_0.
  it("⚠⚠ TỪ CHỐI q4_0 cho K (perplexity ratio 199,7) và ép về mặc định f16", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.LLAMA_VISION_CACHE_TYPE_K = "q4_0";
    const args = await spawnArgs();
    expect(valueAfter(args, "--cache-type-k")).toBe("f16");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/BỊ TỪ CHỐI|199,7/));
  });

  it("từ chối MỌI kiểu 4-bit cho K, không riêng q4_0", async () => {
    for (const bad of ["q4_1", "iq4_nl"]) {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      spawnCalls.length = 0;
      vi.resetModules();
      process.env.LLAMA_VISION_CACHE_TYPE_K = bad;
      const args = await spawnArgs();
      expect(valueAfter(args, "--cache-type-k")).toBe("f16");
    }
  });

  it("vẫn cho phép ĐẶT TAY q8_0 cho K (hợp lệ, chỉ chậm — không phải sai)", async () => {
    process.env.LLAMA_VISION_CACHE_TYPE_K = "q8_0";
    const args = await spawnArgs();
    expect(valueAfter(args, "--cache-type-k")).toBe("q8_0");
  });

  it("một kiểu cache LẠ không được truyền xuống binary (sidecar sẽ không khởi động nổi)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.LLAMA_VISION_CACHE_TYPE_V = "q3_k_m"; // không nằm trong tập llama-server chấp nhận
    const args = await spawnArgs();
    expect(valueAfter(args, "--cache-type-v")).toBe("f16");
    expect(args).not.toContain("q3_k_m");
  });

  /**
   * ★ Lưới quan trọng nhất của file này. Brief cảnh báo đúng: *"thêm một cờ không tồn tại sẽ khiến
   * sidecar không khởi động được — và nó sẽ hỏng đúng lúc ai đó cần phân tích ảnh."* Danh sách dưới
   * đây lấy TỪ `llama-server.exe --help` của chính binary đang cấu hình (build 9814 / 487a6cc16).
   * Ca này biến "nhớ kiểm tra --help" thành một điều kiện MÁY canh được.
   */
  it("chỉ truyền những cờ mà binary llama-server thật sự hỗ trợ", async () => {
    const SUPPORTED = new Set([
      "-m", "--mmproj", "--host", "--port", "-ngl", "-c", "-np", "--jinja",
      "--flash-attn", "--cache-type-k", "--cache-type-v",
    ]);
    const args = await spawnArgs();
    const flags = args.filter((a) => typeof a === "string" && a.startsWith("-") && !/^-?\d+$/.test(a));
    for (const f of flags) {
      expect(SUPPORTED, `cờ "${f}" chưa được đối chiếu với llama-server --help`).toContain(f);
    }
  });
});
