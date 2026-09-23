/**
 * ★ B6 — hợp đồng lớp phủ quyết (không cần engine: `hoi` tiêm được) + bộ dựng `tools` 5 tên.
 * Điều đắt nhất: tín hiệu MẠNH thì model KHÔNG được gọi (0 ms thêm, tất định); cờ tắt thì không gọi; lỗi thì giữ đường cũ.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import "../aiLocalTools/index"; // nạp registry thật
import { dungWireToolLapTrinh, phuQuyetToolLapTrinh } from "./phuQuyetToolNative";
import { CODING_TOOL_NAMES } from "../aiLocalTools/intentClassifier";

const RUN = { tool: "run_command", args: { command: "npm run check" }, reason: "CODING_RUN_SHORTCUT" };
const cu = process.env.AI_CODING_TOOL_VETO;
afterEach(() => {
  if (cu === undefined) delete process.env.AI_CODING_TOOL_VETO;
  else process.env.AI_CODING_TOOL_VETO = cu;
});

describe("phuQuyetToolLapTrinh", () => {
  it("★★★ tín hiệu MẠNH ⇒ KHÔNG hỏi model, trả nguyên quyết định", async () => {
    const hoi = vi.fn(async () => null);
    const kq = await phuQuyetToolLapTrinh("Chạy npm run check", RUN, hoi);
    expect(hoi).not.toHaveBeenCalled();
    expect(kq).toBe(RUN);
  });
  it("★★★ yếu + model nói KHÔNG ⇒ không gọi tool", async () => {
    const hoi = vi.fn(async () => null);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const kq = await phuQuyetToolLapTrinh("Giải thích npm run check làm gì", RUN, hoi);
    log.mockRestore();
    expect(hoi).toHaveBeenCalledTimes(1);
    expect(kq.tool).toBeNull();
    expect(kq.reason).toMatch(/^CODING_VETO_NATIVE:tu-hoi:run_command→none$/);
  });
  it("★★ yếu + model xác nhận ⇒ giữ nguyên (cả tham số)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const kq = await phuQuyetToolLapTrinh("npm run check chạy những gì?", RUN, async () => "run_command");
    log.mockRestore();
    expect(kq).toBe(RUN);
  });
  it("★★ yếu + model không hỏi được (undefined) ⇒ giữ đường cũ", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const kq = await phuQuyetToolLapTrinh("npm run check chạy những gì?", RUN, async () => undefined);
    log.mockRestore();
    expect(kq).toBe(RUN);
  });
  it("★★ AI_CODING_TOOL_VETO=0 ⇒ tắt hẳn, không hỏi model", async () => {
    process.env.AI_CODING_TOOL_VETO = "0";
    const hoi = vi.fn(async () => null);
    const kq = await phuQuyetToolLapTrinh("Giải thích npm run check làm gì", RUN, hoi);
    expect(hoi).not.toHaveBeenCalled();
    expect(kq).toBe(RUN);
  });
  it("heuristic không có tool ⇒ không hỏi model (model không thêm được tool)", async () => {
    const hoi = vi.fn(async () => "read_file");
    const k = { tool: null, args: {}, reason: "CODING_NO_MATCH" };
    expect(await phuQuyetToolLapTrinh("Tại sao nên dùng async?", k, hoi)).toBe(k);
    expect(hoi).not.toHaveBeenCalled();
  });
});

describe("dungWireToolLapTrinh", () => {
  it("★★ đúng các tool lập trình có trong registry, KHÔNG tên nào ngoài 5 tên, KHÔNG lộ ô __authCtx", () => {
    const w = dungWireToolLapTrinh();
    expect(w.length).toBeGreaterThanOrEqual(4);
    for (const t of w) {
      expect((CODING_TOOL_NAMES as readonly string[]).includes(t.function.name), t.function.name).toBe(true);
      expect(JSON.stringify(t.function.parameters)).not.toContain("__authCtx");
    }
  });
});
