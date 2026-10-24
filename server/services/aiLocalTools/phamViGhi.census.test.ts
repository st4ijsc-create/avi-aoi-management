/**
 * ★★★ W11c — CENSUS cổng phạm vi tool GHI: MỌI tool ghi đã đăng ký phải có dòng trong `KHOA_PHAM_VI_TOOL` (hoặc miễn trừ CÓ LÝ DO); dòng thừa (tool không còn) ⇒ đỏ.
 * Thêm tool GHI mới mà quên bảng ⇒ đỏ ở đây (và cổng từ chối fail-closed lúc chạy).
 */
import { describe, expect, it } from "vitest";
import { listTools, isWriteTool } from "./toolRegistry";
import { KHOA_PHAM_VI_TOOL, kiemPhamViGhiTool } from "./phamViGhi";

const REPO = ["apply_diff", "apply_diff_batch", "delete_file", "rename_file", "run_command", "write_project_file"];

describe("phamViGhi tool census", () => {
  it("31/31 tool ghi có dòng; không dòng thừa", async () => {
    await import("./index");
    const ghi = listTools().filter(isWriteTool).map((t) => t.name).sort();
    expect(ghi.length).toBe(31);
    expect(Object.keys(KHOA_PHAM_VI_TOOL).sort()).toEqual(ghi);
  });
  it("miễn trừ chỉ gồm 6 tool repo + set_yield_threshold, mỗi cái có lý do ≥ 20 ký tự", () => {
    const mien = Object.entries(KHOA_PHAM_VI_TOOL).filter(([, v]) => v.kieu === "mien");
    expect(mien.map(([k]) => k).sort()).toEqual([...REPO, "set_yield_threshold"].sort());
    for (const [, v] of mien) expect(v.kieu === "mien" && v.lyDo.length >= 20).toBe(true);
  });
  it("tool vắng bảng ⇒ OUT_OF_SCOPE (fail-closed)", async () => {
    expect(await kiemPhamViGhiTool("tool_ghi_moi_chua_khai_bao", {}, { id: 1, role: "engineer" })).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
  });
});
