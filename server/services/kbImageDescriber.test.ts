/**
 * Wave 2 đường B, Task 6 — kbImageDescriber.ts unit tests.
 *
 * `./aiProviderRouter` and `./llamaVisionSidecar` are BOTH mocked — no live vision model is
 * ever exercised here. The mocked `describeImage` return shape below mirrors the REAL
 * `DescribeImageResult` shape (`{ text, provider, model, totalTimeMs, fallbackUsed }`,
 * aiProviderRouter.ts:115-121) — review round 1 fixed an earlier version of this file that
 * mocked a made-up `{ description }` shape, which let the implementation's field-name bug
 * (reading `.description` instead of the real `.text`) hide behind `as any` and pass anyway.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const describeImageMock = vi.fn();
const availableMock = vi.fn();
vi.mock("./aiProviderRouter", () => ({ describeImage: (...a: any[]) => describeImageMock(...a) }));
vi.mock("./llamaVisionSidecar", () => ({ isVisionSidecarAvailable: () => availableMock() }));

import { describeImageForKnowledge } from "./kbImageDescriber";

/** Real DescribeImageResult shape (aiProviderRouter.ts:115-121) — used by every mock below so
 * the mocked module actually models what the real function returns. */
function fakeDescribeImageResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text: "ok",
    provider: "gguf",
    model: "Qwen3-VL-8B-Instruct-UD-Q4_K_XL",
    totalTimeMs: 1200,
    fallbackUsed: false,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); availableMock.mockReturnValue(true); });

describe("describeImageForKnowledge", () => {
  it("VLM trả mô tả ⇒ ok + văn bản", async () => {
    describeImageMock.mockResolvedValue(fakeDescribeImageResult({ text: "Sơ đồ đấu dây PLC gồm 3 khối" }));
    const r = await describeImageForKnowledge(Buffer.from("x"), "so-do.png");
    expect(r).toEqual({ ok: true, text: "Sơ đồ đấu dây PLC gồm 3 khối" });
  });

  it("VLM CHƯA sẵn sàng ⇒ từ chối TRUNG THỰC, KHÔNG gọi model", async () => {
    availableMock.mockReturnValue(false);
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/thị giác|vision/i);
    expect(describeImageMock).not.toHaveBeenCalled();
  });

  it("VLM ném ⇒ ok:false kèm lý do, KHÔNG ném ra ngoài", async () => {
    describeImageMock.mockRejectedValue(new Error("model busy"));
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain("model busy");
  });

  it("VLM trả mô tả RỖNG ⇒ ok:false (không lưu chunk rỗng giả vờ thành công)", async () => {
    describeImageMock.mockResolvedValue(fakeDescribeImageResult({ text: "   " }));
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
  });

  it("router tự suy giảm trung thực (fallbackUsed:true, aiProviderRouter.ts:396-419) ⇒ ok:false, KHÔNG lưu câu giải thích lỗi làm mô tả thật", async () => {
    describeImageMock.mockResolvedValue(
      fakeDescribeImageResult({
        text: "Vision unavailable: local llama-server mtmd sidecar is not configured (set LLAMA_SERVER_BIN, GGUF_VISION_MODEL, GGUF_VISION_MMPROJ).",
        fallbackUsed: true,
      }),
    );
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toContain("Vision unavailable");
  });

  // Review round 1 — replaces the old "ghim model tường minh" test, which asserted a field
  // (`modelId`/`model` on the REQUEST) that does not exist on the real `DescribeImageRequest`
  // (aiProviderRouter.ts:100-113). Assert what is actually true instead.
  it("gửi đúng buffer ảnh + prompt cho describeImage() — request KHÔNG có field 'modelId' bịa", async () => {
    describeImageMock.mockResolvedValue(fakeDescribeImageResult());
    const buf = Buffer.from("fake-image-bytes");
    await describeImageForKnowledge(buf, "so-do.png");
    expect(describeImageMock).toHaveBeenCalledTimes(1);
    const arg = describeImageMock.mock.calls[0][0];
    expect(arg.image).toBe(buf);
    expect(arg.prompt).toContain("Tên tệp: so-do.png");
    expect(arg.prompt).toMatch(/mô tả/i);
    expect(arg).not.toHaveProperty("modelId");
    expect(arg).not.toHaveProperty("model");
  });

  it("kiểm isVisionSidecarAvailable() TRƯỚC khi gọi describeImage() (không gọi model khi chưa xác nhận sẵn sàng)", async () => {
    describeImageMock.mockResolvedValue(fakeDescribeImageResult());
    await describeImageForKnowledge(Buffer.from("x"));
    expect(availableMock).toHaveBeenCalledTimes(1);
    expect(describeImageMock).toHaveBeenCalledTimes(1);
    expect(availableMock.mock.invocationCallOrder[0]).toBeLessThan(describeImageMock.mock.invocationCallOrder[0]);
  });
});
