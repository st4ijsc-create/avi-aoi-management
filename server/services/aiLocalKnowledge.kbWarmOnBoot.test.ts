/**
 * ★ Cờ `AI_KB_WARM_ON_BOOT` (2026-10-24): `warmUpOllamaModels()` — gọi lúc khởi động từ `registerAiLocalKnowledgeRoutes` — chỉ làm ấm model sâu/embedder/đường
 * truy hồi khi cờ KHÁC "false". Cờ false ⇒ KHÔNG chạm engine GGUF (không `warmModel`, không `generateEmbedding`) ⇒ không `getLlama()` ⇒ không nạp CUDA backend lên GPU lúc boot
 * (đo 2026-10-23: warmUp KB nạp CUDA backend + embedder 0.6B ~1,7 GB mỗi lần boot). Mặc định (vắng cờ) PHẢI giữ làm ấm như cũ (câu KB đầu không chậm).
 *
 * Ca khoá: (1) vị từ `kbWarmOnBoot`; (2) cờ false ⇒ sau cửa sổ chờ 2 s KHÔNG có lời gọi engine; (3) ĐỐI CHỨNG DƯƠNG cờ vắng ⇒ `warmModel` ĐƯỢC gọi (nếu không, (2) xanh vì
 * fixture hỏng); (4) cờ "FALSE"/" false " cũng tắt; "0"/"off" KHÔNG tắt (chỉ đúng chuỗi "false" — cùng khuôn các cờ kiểu `!== "false"` của repo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warmModel = vi.fn(async () => true);
const generateEmbedding = vi.fn(async () => new Array(1024).fill(0));

vi.mock("./aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("./aiGgufEngine")>();
  return { ...that, warmModel, generateEmbedding };
});

const GOC = process.env.AI_KB_WARM_ON_BOOT;

beforeEach(() => {
  vi.resetModules();
  warmModel.mockClear();
  generateEmbedding.mockClear();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.USE_LEGACY_OLLAMA;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (GOC === undefined) delete process.env.AI_KB_WARM_ON_BOOT;
  else process.env.AI_KB_WARM_ON_BOOT = GOC;
});

async function chayWarm(): Promise<void> {
  const svc = await import("./aiLocalKnowledgeService");
  svc.warmUpOllamaModels();
  await vi.advanceTimersByTimeAsync(6_000);
  await vi.runOnlyPendingTimersAsync();
}

describe("AI_KB_WARM_ON_BOOT", () => {
  it("vị từ: chỉ đúng chuỗi 'false' (không phân biệt hoa thường, bỏ khoảng trắng) mới tắt", async () => {
    const { kbWarmOnBoot } = await import("./aiLocalKnowledgeService");
    expect(kbWarmOnBoot({})).toBe(true);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "true" })).toBe(true);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "" })).toBe(true);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "0" })).toBe(true);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "off" })).toBe(true);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "false" })).toBe(false);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: "FALSE" })).toBe(false);
    expect(kbWarmOnBoot({ AI_KB_WARM_ON_BOOT: " False " })).toBe(false);
  });

  it("★★★ cờ false ⇒ KHÔNG gọi warmModel/generateEmbedding sau cửa sổ chờ (không getLlama lúc khởi động)", async () => {
    process.env.AI_KB_WARM_ON_BOOT = "false";
    await chayWarm();
    expect(warmModel).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("★★★ đối chứng dương: cờ vắng ⇒ warmModel ĐƯỢC gọi như cũ", async () => {
    delete process.env.AI_KB_WARM_ON_BOOT;
    process.env.GGUF_DEFAULT_MODEL = "model-thu.gguf";
    await chayWarm();
    expect(warmModel).toHaveBeenCalledTimes(1);
    expect(warmModel).toHaveBeenCalledWith("model-thu");
  });

  it("cờ true tường minh ⇒ cũng làm ấm", async () => {
    process.env.AI_KB_WARM_ON_BOOT = "true";
    process.env.GGUF_DEFAULT_MODEL = "model-thu.gguf";
    await chayWarm();
    expect(warmModel).toHaveBeenCalledTimes(1);
  });

  it("cờ false không đánh dấu 'đã khởi động': đổi cờ rồi gọi lại trong CÙNG tiến trình vẫn làm ấm được", async () => {
    process.env.AI_KB_WARM_ON_BOOT = "false";
    const svc = await import("./aiLocalKnowledgeService");
    svc.warmUpOllamaModels();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(warmModel).not.toHaveBeenCalled();
    delete process.env.AI_KB_WARM_ON_BOOT;
    process.env.GGUF_DEFAULT_MODEL = "model-thu.gguf";
    svc.warmUpOllamaModels();
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.runOnlyPendingTimersAsync();
    expect(warmModel).toHaveBeenCalledTimes(1);
  });
});
