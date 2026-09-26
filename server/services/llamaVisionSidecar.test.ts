/**
 * WS-G2 — Unit tests for the local llama.cpp mtmd vision sidecar (mocked).
 *
 * Everything external is mocked — NO real llama-server binary, NO real model file,
 * NO real network. We mock:
 *   - global.fetch          → fake /health + /v1/chat/completions
 *   - child_process.spawn   → fake process that "starts" and stays alive
 *   - fs                    → control file existence + GGUF magic header bytes
 *
 * Covers:
 *   - describeImageViaSidecar parses the OpenAI-compatible response → { text, modelId, ... }
 *   - isVisionSidecarAvailable() is false when env / files are missing
 *   - aiGgufEngine.describeImage throws VISION_NOT_AVAILABLE when sidecar unavailable
 *   - aiProviderRouter.describeImage returns fallbackUsed:true (no fabrication) when off
 *   - validateGgufFile: bad magic / too-small → error; real GGUF header → ok
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import path from "path";

// Resolve a "model dir" path the same way the production code does (path.resolve +
// path.join), so mocked-fs keys match exactly on both POSIX and Windows.
const MODELS_DIR = path.resolve("/models");
const inModels = (f: string) => path.join(MODELS_DIR, f);
const abs = (p: string) => path.resolve(p);

// ── fs mock: a virtual filesystem we control per-test ──────────────────────
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
    readSync: (_fd: number, buffer: Buffer, _off: number, _len: number, _pos: number) => {
      // The path isn't available here, so we stash "current" head via a module-level var.
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

// child_process mock
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
let fakeProc: FakeProc;
vi.mock("child_process", () => ({
  spawn: (...args: any[]) => {
    spawnCalls.push(args);
    fakeProc = new FakeProc();
    return fakeProc;
  },
}));

// ── helpers ────────────────────────────────────────────────────────────────
const GGUF_HEADER = Buffer.from([0x47, 0x47, 0x55, 0x46]); // "GGUF"
const BAD_HEADER = Buffer.from([0x00, 0x01, 0x02, 0x03]);

function setFile(path: string, opts: { size: number; head: Buffer }) {
  fsFiles.set(path, opts);
}

/** Point the fs.readSync mock at a specific file's head bytes for validateGgufFile. */
function selectHead(path: string) {
  const f = fsFiles.get(path);
  (globalThis as any).__currentHead = f?.head;
}

const BIG = 5 * 1024 * 1024;

beforeEach(() => {
  fsFiles.clear();
  spawnCalls.length = 0;
  vi.resetModules();
  delete (globalThis as any).__currentHead;
  process.env.LLAMA_VISION_HOST = "127.0.0.1";
  process.env.LLAMA_VISION_PORT = "8099";
  process.env.LLAMA_VISION_READY_TIMEOUT_MS = "5000";
  // ★ C-2 (review TOÀN NHÁNH) — `stopSidecar()` nay CHỜ tiến trình chết thật (mặc định 8.000 ms).
  // Tiến trình con giả ở file này không bao giờ phát `"exit"`, nên lượt dọn cuối mỗi ca sẽ chờ
  // hết hạn; rút hạn xuống để ca không đụng trần thời gian của vitest. Ngữ nghĩa "chờ thật" được
  // canh ở `vram/wiring.outofprocess.test.ts` (C-2a/C-2b), không phải ở đây.
  process.env.LLAMA_VISION_STOP_WAIT_MS = "10";
  process.env.GGUF_MODELS_DIR = "/models";
  delete process.env.LLAMA_SERVER_BIN;
  delete process.env.GGUF_VISION_MODEL;
  delete process.env.GGUF_VISION_MMPROJ;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const BIN_PATH = abs("/bin/llama-server");

function configureValidVision() {
  process.env.LLAMA_SERVER_BIN = BIN_PATH;
  process.env.GGUF_VISION_MODEL = "qwen2-vl.gguf";
  process.env.GGUF_VISION_MMPROJ = "mmproj.gguf";
  setFile(BIN_PATH, { size: BIG, head: GGUF_HEADER });
  setFile(inModels("qwen2-vl.gguf"), { size: BIG, head: GGUF_HEADER });
  setFile(inModels("mmproj.gguf"), { size: BIG, head: GGUF_HEADER });
  // ensureSidecar validates both GGUF files; all configured files share the GGUF header.
  (globalThis as any).__currentHead = GGUF_HEADER;
}

describe("validateGgufFile", () => {
  it("accepts a file with a valid GGUF magic header", async () => {
    const { validateGgufFile } = await import("./aiGgufEngine");
    const p = abs("/models/good.gguf");
    setFile(p, { size: BIG, head: GGUF_HEADER });
    selectHead(p);
    expect(() => validateGgufFile(p)).not.toThrow();
    expect(validateGgufFile(p).sizeBytes).toBe(BIG);
  });

  it("rejects a file with a bad magic header (corrupt placeholder)", async () => {
    const { validateGgufFile } = await import("./aiGgufEngine");
    const p = abs("/models/fake70mb.gguf");
    setFile(p, { size: 70 * 1024 * 1024, head: BAD_HEADER });
    selectHead(p);
    expect(() => validateGgufFile(p)).toThrow(/magic header/i);
  });

  it("rejects a file that is too small", async () => {
    const { validateGgufFile } = await import("./aiGgufEngine");
    const p = abs("/models/tiny.gguf");
    setFile(p, { size: 100, head: GGUF_HEADER });
    selectHead(p);
    expect(() => validateGgufFile(p)).toThrow(/too small/i);
  });

  it("rejects a missing file", async () => {
    const { validateGgufFile } = await import("./aiGgufEngine");
    expect(() => validateGgufFile(abs("/models/missing.gguf"))).toThrow(/not found/i);
  });
});

describe("isVisionSidecarAvailable", () => {
  it("is false when env vars are unset", async () => {
    const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
    expect(isVisionSidecarAvailable()).toBe(false);
  });

  it("is false when files do not exist on disk", async () => {
    process.env.LLAMA_SERVER_BIN = "/bin/llama-server";
    process.env.GGUF_VISION_MODEL = "qwen2-vl.gguf";
    process.env.GGUF_VISION_MMPROJ = "mmproj.gguf";
    const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
    expect(isVisionSidecarAvailable()).toBe(false);
  });

  it("is true when binary + model + mmproj all exist", async () => {
    configureValidVision();
    const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
    expect(isVisionSidecarAvailable()).toBe(true);
  });
});

describe("describeImageViaSidecar", () => {
  it("spawns llama-server, healthchecks, and parses the chat completion", async () => {
    configureValidVision();

    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) } as any;
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        // Verify the request carries an image_url data URI.
        const body = JSON.parse(init.body);
        const userMsg = body.messages.find((m: any) => m.role === "user");
        const imgPart = userMsg.content.find((c: any) => c.type === "image_url");
        expect(imgPart.image_url.url).toMatch(/^data:image\/(png|jpeg|webp|gif);base64,/);
        return {
          ok: true,
          json: async () => ({
            model: "qwen2-vl",
            choices: [{ message: { content: "A solder bridge defect on pin 3." } }],
            usage: { prompt_tokens: 120, completion_tokens: 11 },
          }),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "nf" } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { describeImageViaSidecar } = await import("./llamaVisionSidecar");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const result = await describeImageViaSidecar({ image: png, prompt: "Describe defects." });

    expect(result.text).toBe("A solder bridge defect on pin 3.");
    expect(result.modelId).toBe("qwen2-vl");
    expect(result.tokensGenerated).toBe(11);
    expect(result.tokensPrompt).toBe(120);
    expect(spawnCalls.length).toBe(1);
    // spawn args include -m / --mmproj / --host / --port
    const args: string[] = spawnCalls[0][1];
    expect(args).toContain("--mmproj");
    expect(args).toContain("--host");
    expect(args).toContain("127.0.0.1");

    const { stopSidecar } = await import("./llamaVisionSidecar");
    await stopSidecar();
  });

  it("sends multiple image_url parts when given images[]", async () => {
    configureValidVision();
    let sentParts = 0;
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith("/health")) return { ok: true, json: async () => ({ status: "ok" }) } as any;
      const body = JSON.parse(init.body);
      const userMsg = body.messages.find((m: any) => m.role === "user");
      sentParts = userMsg.content.filter((c: any) => c.type === "image_url").length;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }], usage: {} }) } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { describeImageViaSidecar, stopSidecar } = await import("./llamaVisionSidecar");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await describeImageViaSidecar({ images: [png, png], prompt: "compare" });
    expect(sentParts).toBe(2);
    await stopSidecar();
  });
});

describe("aiGgufEngine.describeImage (vision gating)", () => {
  it("throws VISION_NOT_AVAILABLE when sidecar is not configured", async () => {
    const { describeImage } = await import("./aiGgufEngine");
    await expect(
      describeImage({ image: Buffer.from([1, 2, 3, 4]), prompt: "x" }),
    ).rejects.toThrow(/VISION_NOT_AVAILABLE/);
  });
});

describe("aiProviderRouter.describeImage (honest fallback)", () => {
  it("returns fallbackUsed:true with a clear reason when vision is off", async () => {
    const { describeImage } = await import("./aiProviderRouter");
    const res = await describeImage({ image: Buffer.from([1, 2, 3, 4]), prompt: "x" });
    expect(res.fallbackUsed).toBe(true);
    expect(res.model).toBe("none");
    expect(res.text).toMatch(/Vision unavailable/i);
  });
});
