/**
 * W17a (kiểm định phamViGhi) — `cancelJob(id, userId)`: người dùng chỉ huỷ được job CỦA MÌNH. Job không chủ (hệ thống / cron: `userId` vắng) KHÔNG phải
 * của ai ⇒ người dùng nêu danh tính không huỷ được (trước: điều kiện `job.userId !== undefined` cho lọt ⇒ huỷ được job hệ thống đang xếp hàng).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./aiProviderRouter", () => ({
  generateNarrative: () => new Promise(() => undefined), // không bao giờ xong ⇒ giữ khe chạy
  generateInsightJson: () => new Promise(() => undefined),
}));

describe("aiJobQueue.cancelJob — sở hữu", () => {
  it("job của A: B không huỷ được, A huỷ được; job hệ thống (không chủ): người dùng không huỷ được, gọi nội bộ (không userId) huỷ được", async () => {
    const { enqueueNarrative, cancelJob, getJob } = await import("./aiJobQueue");
    const conc = Number(process.env.AI_JOB_CONCURRENCY || "1");
    for (let i = 0; i < conc; i++) enqueueNarrative({ prompt: `giữ khe ${i}`, systemPrompt: "s" } as never, 9_000_000 + i); // chiếm hết khe chạy
    const cuaA = enqueueNarrative({ prompt: "a", systemPrompt: "s" } as never, 101);
    const heThong = enqueueNarrative({ prompt: "sys", systemPrompt: "s" } as never);
    const heThong2 = enqueueNarrative({ prompt: "sys2", systemPrompt: "s" } as never);
    expect(cuaA.status).toBe("queued");
    expect(heThong.status).toBe("queued");

    expect(cancelJob(cuaA.id, 202)).toBe(false); // B
    expect(getJob(cuaA.id)?.status).toBe("queued");
    expect(cancelJob(heThong.id, 202)).toBe(false); // người dùng huỷ job hệ thống
    expect(getJob(heThong.id)?.status).toBe("queued");

    expect(cancelJob(cuaA.id, 101)).toBe(true); // chủ
    expect(cancelJob(heThong2.id)).toBe(true); // nội bộ (không nêu người dùng)
  });
});
