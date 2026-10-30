/**
 * Đợt 11.4 / mục 3 — Workspace Trust: vị từ thuần, nguồn trạng thái fail-closed, cổng chạy lệnh thật (không spawn), manifest.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MA_KHONG_TIN_CAY, TOOL_CAN_TIN_CAY, chanKhiKhongTinCay, datNguonTinCay, laTinCay, workspaceTinCay } from "./tinCayWorkspace";
import { chayLenhCucBo } from "../mang/chayLenhCucBo";

afterEach(() => datNguonTinCay(() => true));

describe("tinCayWorkspace", () => {
  it("laTinCay: chỉ boolean false là không tin cậy (API thiếu ⇒ tin cậy)", () => {
    expect(laTinCay(false)).toBe(false);
    expect(laTinCay(true)).toBe(true);
    expect(laTinCay(undefined)).toBe(true);
  });
  it("tập tool đóng đúng 5 tool ghi/lệnh, không có tool đọc", () => {
    expect([...TOOL_CAN_TIN_CAY].sort()).toEqual(["delete_file", "edit_file", "rename_file", "run_command", "write_file"]);
    for (const doc of ["read_file", "list_dir", "find_files", "grep", "find_symbol", "get_diagnostics", "remember"]) expect(TOOL_CAN_TIN_CAY.has(doc)).toBe(false);
  });
  it("chanKhiKhongTinCay: chặn tool ghi khi chưa tin cậy, cho đọc, cho tất cả khi đã tin cậy", () => {
    expect(chanKhiKhongTinCay("write_file", false)).toMatchObject({ ma: MA_KHONG_TIN_CAY });
    expect(chanKhiKhongTinCay("write_file", false)!.choModel).toContain("not trusted");
    expect(chanKhiKhongTinCay("read_file", false)).toBeNull();
    expect(chanKhiKhongTinCay("write_file", true)).toBeNull();
  });
  it("★ nguồn ném lỗi ⇒ coi là KHÔNG tin cậy (fail-closed)", () => {
    datNguonTinCay(() => {
      throw new Error("x");
    });
    expect(workspaceTinCay()).toBe(false);
  });
  it("★★★ chayLenhCucBo khi chưa tin cậy ⇒ KHÔNG spawn: trả ok:false ngay với lời giải thích", async () => {
    datNguonTinCay(() => false);
    const kq = await chayLenhCucBo({ lenh: { argv: ["definitely-not-a-real-program-xyz"], ten: "x", hienThi: "x" } as never, cwd: process.cwd(), tranMs: 1000 });
    expect(kq.ok).toBe(false);
    expect(kq.output).toContain("chưa được tin cậy");
    expect(kq.durationMs).toBe(0); // 0 = không đi tới nhánh spawn (nhánh spawn lỗi luôn có thời gian > 0 hoặc thông điệp khác)
    expect(kq.output).not.toContain("không khởi động được");
  });
  it("manifest khai capabilities.untrustedWorkspaces = limited + mô tả", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(m.capabilities.untrustedWorkspaces.supported).toBe("limited");
    expect(String(m.capabilities.untrustedWorkspaces.description).length).toBeGreaterThan(10);
  });
});
