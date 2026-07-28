/**
 * Wave 2 đường B, Task 6 — kbImageDescriber.ts unit tests.
 *
 * `./aiProviderRouter` and `./llamaVisionSidecar` are BOTH mocked — no live vision model is
 * ever exercised here. See kbImageDescriber.ts's module doc comment for why the mocked
 * `describeImage` return shape (`{ description }`) differs from the REAL `DescribeImageResult`
 * shape (`{ text, provider, model, totalTimeMs, fallbackUsed }`) — the implementation reads
 * `res.text ?? res.description` to stay correct against both.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const describeImageMock = vi.fn();
const availableMock = vi.fn();
vi.mock("./aiProviderRouter", () => ({ describeImage: (...a: any[]) => describeImageMock(...a) }));
vi.mock("./llamaVisionSidecar", () => ({ isVisionSidecarAvailable: () => availableMock() }));

import { describeImageForKnowledge } from "./kbImageDescriber";

beforeEach(() => { vi.clearAllMocks(); availableMock.mockReturnValue(true); });

describe("describeImageForKnowledge", () => {
  it("VLM trả mô tả ⇒ ok + văn bản", async () => {
    describeImageMock.mockResolvedValue({ description: "Sơ đồ đấu dây PLC gồm 3 khối" });
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
    describeImageMock.mockResolvedValue({ description: "   " });
    const r = await describeImageForKnowledge(Buffer.from("x"));
    expect(r.ok).toBe(false);
  });

  it("ghim model tường minh khi gọi VLM", async () => {
    describeImageMock.mockResolvedValue({ description: "ok" });
    await describeImageForKnowledge(Buffer.from("x"));
    const arg = describeImageMock.mock.calls[0][0];
    expect(arg.modelId ?? arg.model).toBeTruthy();
  });
});
