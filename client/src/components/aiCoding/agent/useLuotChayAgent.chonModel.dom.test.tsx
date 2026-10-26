// @vitest-environment jsdom
//
// Đợt 10.2 bước 4 — thân yêu cầu của lượt agent mang `chonModel` khi người dùng chọn; auto / vắng ⇒ KHÔNG có trường (thân giữ nguyên một byte).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ than: [] as Record<string, unknown>[] }));
vi.mock("@/lib/agentApi", () => ({
  agentTrpc: { danhSach: vi.fn(async () => []), cuaToi: vi.fn(async () => []) },
  huyLuotChay: vi.fn(),
  noiLaiLuotChay: vi.fn(),
  moLuotChay: vi.fn(async (than: Record<string, unknown>) => {
    h.than.push(than);
  }),
}));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "loi" }));

import { useLuotChayAgent } from "./useLuotChayAgent";

afterEach(() => {
  cleanup();
  h.than.length = 0;
});

async function guiVoi(chonModel?: string) {
  const { result } = renderHook(() => useLuotChayAgent({ projectId: "p1", chonModel }));
  await act(async () => {
    await result.current.gui("sửa lỗi", "sua");
  });
}

describe("useLuotChayAgent — chonModel", () => {
  it("chọn model ⇒ thân có chonModel nguyên văn", async () => {
    await guiVoi("ho-so:p27");
    expect(h.than[0]).toMatchObject({ cauHoi: "sửa lỗi", projectId: "p1", chonModel: "ho-so:p27" });
  });
  it("auto / vắng ⇒ KHÔNG có trường chonModel", async () => {
    await guiVoi("auto");
    await guiVoi(undefined);
    expect(h.than).toHaveLength(2);
    for (const t of h.than) expect("chonModel" in t).toBe(false);
  });
});
