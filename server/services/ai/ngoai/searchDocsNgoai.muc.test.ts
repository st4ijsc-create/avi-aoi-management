/**
 * ★ Đợt 10.4b L3c (rà kiem-dinh v9) — MỨC / LOẠI PHẦN của kết quả `search_docs` khi bộ chuyển agent ngoài dựng yêu cầu: tin tool `search_docs` vào
 * `ghepPhan` là `truy-hoi-kb` kho `api` (tài liệu sản phẩm), KHÔNG phải `ma-repo`; tool đọc mã vẫn `ma-repo`. Quan sát ĐẦU VÀO thật của
 * `ghepPhan` (vi.mock bọc bản thật).
 */
import { describe, expect, it, vi } from "vitest";
import type { TinGhep } from "./ghepPhan";

const daGhep: TinGhep[][] = [];
vi.mock("./ghepPhan", async (goc) => {
  const that = (await goc()) as typeof import("./ghepPhan");
  return { ...that, ghepPhan: (ds: readonly TinGhep[]) => (daGhep.push(structuredClone([...ds])), that.ghepPhan(ds)) };
});

const { taoCapAgentNgoai } = await import("./vongAgentNgoai");

describe("L3c — loại phần của kết quả search_docs", () => {
  it("tool search_docs ⇒ truy-hoi-kb / loaiKho api; read_file ⇒ ma-repo", async () => {
    const cap = taoCapAgentNgoai({
      dich: { nhaCungCap: "anthropic", model: "m" },
      runId: "11111111-2222-3333-4444-555555555555",
      user: { id: 7, role: "user" },
      nhaMay: 1,
      cauHoi: "q",
      lichSu: [],
      ngonNgu: "vi",
      goc: "D:/du-an",
      doc: { byte: 0, tep: 0, tranByte: 1, tranTep: 1 },
      goi: async () => ({ noiDung: "", toolCalls: [{ ten: "search_docs", thamSo: { query: "x" } }, { ten: "read_file", thamSo: { path: "a.ts" } }], khongTinCay: true, tokenVao: 1, tokenRa: 1, chiPhiUocUsd: null, callId: 1 }) as never,
      chayTool: async () => ({ ok: true, noiDung: "kq" }),
      searchDocs: true,
    });
    const congCu = cap.boThucThi.congCu("hoi");
    // vòng 1: model đòi 2 tool ⇒ lấy id do bộ chuyển phát
    let toolCalls: Array<{ id: string; function: { name: string } }> = [];
    for await (const m of cap.goiModel({ tinNhan: [{ role: "user", content: "q" }], congCu, signal: new AbortController().signal } as never))
      if ((m as { loai: string }).loai === "xong") toolCalls = (m as unknown as { toolCalls: typeof toolCalls }).toolCalls;
    expect(toolCalls.map((t) => t.function.name)).toEqual(["search_docs", "read_file"]);
    // vòng 2: lịch sử có hai kết quả tool
    const tinNhan = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", tool_calls: toolCalls },
      { role: "tool", tool_call_id: toolCalls[0]!.id, name: "search_docs", content: "<<<TAI_LIEU …>>>" },
      { role: "tool", tool_call_id: toolCalls[1]!.id, name: "read_file", content: "<<<TEP a.ts>>>" },
    ];
    for await (const _ of cap.goiModel({ tinNhan, congCu, signal: new AbortController().signal } as never)) void _;
    const v2 = daGhep.at(-1)!;
    const tool = v2.filter((t) => t.vaiTro === "tool");
    expect(tool.map((t) => [t.tenTool, t.phan[0]])).toEqual([
      ["search_docs", { loai: "truy-hoi-kb", loaiKho: "api", noiDung: "<<<TAI_LIEU …>>>" }],
      ["read_file", { loai: "ma-repo", noiDung: "<<<TEP a.ts>>>" }],
    ]);
  });
});
