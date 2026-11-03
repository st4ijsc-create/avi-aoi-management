/** Cổng vào phòng `ai:agents`: admin|engineer + MOD_AI, fail-closed. Lỗi gốc: phòng này không có cổng (ai đăng nhập cũng vào). */
import { describe, it, expect, vi, beforeEach } from "vitest";

const isModuleLicensed = vi.fn(async (_m: string): Promise<boolean> => true);
vi.mock("./moduleGate", () => ({ isModuleLicensed: (m: string) => isModuleLicensed(m) }));

import { duocVaoPhongAiAgents } from "./socketPhongQuyen";

const nguoi = (role: string, over: Record<string, unknown> = {}) => ({ clientType: "browser", user: { id: 5, role }, ...over });

describe("duocVaoPhongAiAgents", () => {
  beforeEach(() => {
    isModuleLicensed.mockReset();
    isModuleLicensed.mockResolvedValue(true);
  });
  it("admin / engineer có MOD_AI ⇒ vào; hỏi đúng module MOD_AI", async () => {
    expect(await duocVaoPhongAiAgents(nguoi("admin"))).toBe(true);
    expect(await duocVaoPhongAiAgents(nguoi("engineer"))).toBe(true);
    expect(isModuleLicensed).toHaveBeenCalledWith("MOD_AI");
  });
  it("★ vai khác (operator/viewer/…) ⇒ KHÔNG vào, kể cả có giấy phép", async () => {
    for (const r of ["operator", "user", "viewer", ""]) expect(await duocVaoPhongAiAgents(nguoi(r)), r).toBe(false);
  });
  it("★ không có giấy phép MOD_AI ⇒ không vào", async () => {
    isModuleLicensed.mockResolvedValue(false);
    expect(await duocVaoPhongAiAgents(nguoi("engineer"))).toBe(false);
  });
  it("★ kiểm giấy phép ném lỗi ⇒ không vào (fail-closed)", async () => {
    isModuleLicensed.mockRejectedValue(new Error("db"));
    expect(await duocVaoPhongAiAgents(nguoi("admin"))).toBe(false);
  });
  it("socket không phải trình duyệt đã xác thực (machine / vô danh) ⇒ không vào", async () => {
    expect(await duocVaoPhongAiAgents({ clientType: "machine", user: { id: 5, role: "admin" } })).toBe(false);
    expect(await duocVaoPhongAiAgents({ clientType: "browser", user: null })).toBe(false);
    expect(await duocVaoPhongAiAgents(undefined)).toBe(false);
  });
});
