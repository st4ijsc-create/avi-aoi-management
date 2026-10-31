/**
 * ★ Đợt 12 H0.1 (2026-10-31) — `goiModelMayChu` chép `cacheN` / `promptN` của chunk `done` vào `xong.usage` (lõi ⇒ sự kiện `usage`,
 * tho-ca-agent ⇒ `buoc-do`) và vào dấu vết chỉ-ghi `ghiLuotNgoaiCong` (⇒ `ai_gateway_metrics.cacheTokens/promptEvalTokens`, mig 0445).
 * ĐỘT BIẾN PHẢI BẮT: bỏ chép vào usage · đảo hai số · chép khi chỉ có một nửa · dấu vết ghi 0 thay vì null khi không đo được.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManhModel } from "@shared/agentCore";

const ghi = vi.fn();
vi.mock("../../aiGateway", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../aiGateway")>()), ghiLuotNgoaiCong: (o: unknown) => ghi(o) }));

const { taoGoiModelMayChu } = await import("./goiModelMayChu");

beforeEach(() => ghi.mockReset());

async function xongVoi(done: Record<string, unknown>, ghiDauVet = false) {
  const goi = taoGoiModelMayChu({
    khongGhiDauVet: !ghiDauVet,
    chatStream: async function* () {
      yield { type: "done", toolCalls: [], tokensPrompt: 14, tokensGenerated: 3, ...done } as never;
    },
  });
  let xong: Extract<ManhModel, { loai: "xong" }> | undefined;
  for await (const m of goi({ tinNhan: [{ role: "user", content: "hỏi" }], congCu: [], signal: new AbortController().signal })) {
    if (m.loai === "xong") xong = m;
  }
  return xong!;
}

describe("goiModelMayChu — cacheN / promptN", () => {
  it("★ chunk done có cặp ⇒ usage mang cacheN/promptN đúng chiều", async () => {
    const x = await xongVoi({ cacheN: 12, promptN: 2 });
    expect(x.usage).toEqual({ vao: 14, ra: 3, cacheN: 12, promptN: 2 });
  });
  it("thiếu một nửa / vắng ⇒ usage như cũ từng khoá", async () => {
    expect((await xongVoi({ cacheN: 12 })).usage).toEqual({ vao: 14, ra: 3 });
    expect((await xongVoi({})).usage).toEqual({ vao: 14, ra: 3 });
  });
  it("dấu vết chỉ-ghi: cacheTokens/promptEvalTokens = cặp đo được; không đo được ⇒ null (không phải 0)", async () => {
    await xongVoi({ cacheN: 12, promptN: 2 }, true);
    await xongVoi({}, true);
    expect(ghi.mock.calls.map((c) => [(c[0] as { cacheTokens: unknown }).cacheTokens, (c[0] as { promptEvalTokens: unknown }).promptEvalTokens])).toEqual([
      [12, 2],
      [null, null],
    ]);
  });
});
