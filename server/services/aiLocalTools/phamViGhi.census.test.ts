/**
 * ★★★ W11c — CENSUS cổng phạm vi tool GHI: MỌI tool ghi đã đăng ký phải có dòng trong `KHOA_PHAM_VI_TOOL` (hoặc miễn trừ CÓ LÝ DO); dòng thừa (tool không còn) ⇒ đỏ.
 * Thêm tool GHI mới mà quên bảng ⇒ đỏ ở đây (và cổng từ chối fail-closed lúc chạy).
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { listTools, isWriteTool } from "./toolRegistry";
import { KHOA_PHAM_VI_TOOL, kiemPhamViGhiTool } from "./phamViGhi";

const REPO = ["apply_diff", "apply_diff_batch", "delete_file", "rename_file", "run_command", "write_project_file"];

describe("phamViGhi tool census", () => {
  it("mọi tệp ngoài aiLocalTools gọi registerTool( phải nằm trong danh sách đã nạp ở census này (tool ghi đăng ký lẻ không được lọt)", () => {
    const ra = execSync('git grep -l "registerTool(" -- "server/**/*.ts"', { encoding: "utf8" }).split("\n").filter(Boolean)
      .filter((p) => !/\.test\.ts$/.test(p) && !p.startsWith("server/services/aiLocalTools/"));
    expect(ra.sort()).toEqual(["server/services/visionDefectProposal.ts"]);
  });
  it("32/32 tool ghi có dòng; không dòng thừa", async () => {
    await import("./index");
    await import("../visionDefectProposal"); // tool ghi đăng ký lẻ (aiVisionRouter nạp nó lúc chạy)
    const ghi = listTools().filter(isWriteTool).map((t) => t.name).sort();
    expect(ghi.length).toBe(32);
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
