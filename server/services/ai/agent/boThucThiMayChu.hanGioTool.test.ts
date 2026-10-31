/**
 * Đợt 12 · H1.5 — HẠN GIỜ THEO CÔNG CỤ ĐỌC/TÌM (`hanGioTool`, mặc định TẮT): một lời gọi treo ⇒ `TOOL_TIMEOUT` có cấu trúc, các lời gọi khác
 * không bị ảnh hưởng. Tool giả qua chỗ tiêm `phuThuoc.timTaiLieu` (không CSDL).
 */
import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import { kiemThamSo, type SuKienAgent } from "@shared/agentCore";
import { HAN_GIO_TOOL_MAC_DINH_MS, hanGioToolBat, taoBoThucThiMayChu, type PhuThuocBoThucThi } from "./boThucThiMayChu";
import type { TimTaiLieu } from "./timTaiLieuAgent";

const NGUOI = { id: 1, role: "admin", name: "Ky su h15" };

function taoBo(o: { hanGioTool?: Record<string, number>; timTaiLieu: TimTaiLieu }) {
  const phuThuoc: PhuThuocBoThucThi = { timTaiLieu: o.timTaiLieu, nhipKiemMs: 50 };
  return taoBoThucThiMayChu({
    execCtx: { user: NGUOI, lang: "vi", projectRoot: os.tmpdir() },
    gocDuAn: os.tmpdir(),
    user: NGUOI,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc,
    ...(o.hanGioTool ? { hanGioTool: o.hanGioTool } : {}),
  });
}
const goi = (query = "q") => {
  const kt = kiemThamSo("search_docs", { query });
  if (!kt.ok) throw new Error(kt.loiChoModel);
  return { id: "c1", ten: "search_docs", thamSo: kt.thamSo };
};
const ctx = (signal = new AbortController().signal) => ({ cheDo: "hoi" as const, runId: "r", luot: 1, signal, phat: (_e: SuKienAgent) => undefined });
const treo: TimTaiLieu = () => new Promise(() => undefined);
const nhanh: TimTaiLieu = async () => ({ doan: [], daTim: ["all"] }) as never;

describe("hanGioTool", () => {
  it("công tắc: chỉ '1' bật", () => {
    expect(hanGioToolBat("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "on"]) expect(hanGioToolBat(v)).toBe(false);
  });

  it("★ mặc định cho mọi tool đọc/tìm; tool ghi/lệnh/compile_st KHÔNG có", () => {
    for (const t of ["read_file", "list_dir", "find_files", "grep", "find_symbol", "search_code", "search_docs", "lookup_api"]) {
      expect(HAN_GIO_TOOL_MAC_DINH_MS[t], t).toBeGreaterThan(0);
    }
    for (const t of ["write_file", "edit_file", "delete_file", "rename_file", "run_command", "compile_st", "remember", "delegate"]) {
      expect(HAN_GIO_TOOL_MAC_DINH_MS[t], t).toBeUndefined();
    }
  });

  it("★★★ tool treo + có hạn ⇒ TOOL_TIMEOUT sau ~hạn, ok:false, lời cho model nêu tên tool", async () => {
    const bo = taoBo({ hanGioTool: { search_docs: 60 }, timTaiLieu: treo });
    const t0 = Date.now();
    const r = await bo.chay(goi(), ctx());
    const dt = Date.now() - t0;
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("TOOL_TIMEOUT");
    expect(r.choModel).toContain("search_docs");
    expect(r.choModel).toMatch(/timed out/);
    expect(dt).toBeGreaterThanOrEqual(50);
    expect(dt).toBeLessThan(2000);
  });

  it("tool nhanh trong hạn ⇒ kết quả bình thường (không TOOL_TIMEOUT)", async () => {
    const bo = taoBo({ hanGioTool: { search_docs: 5000 }, timTaiLieu: nhanh });
    const r = await bo.chay(goi(), ctx());
    expect(r.ma).not.toBe("TOOL_TIMEOUT");
    expect(r.ok).toBe(true);
  });

  it("★★★ KHÔNG khai hanGioTool (mặc định) ⇒ không hạn: tool chậm 200 ms vẫn trả kết quả thật", async () => {
    const cham: TimTaiLieu = () => new Promise((ok) => setTimeout(() => ok({ doan: [], daTim: ["all"] } as never), 200));
    const bo = taoBo({ timTaiLieu: cham });
    const r = await bo.chay(goi(), ctx());
    expect(r.ma).not.toBe("TOOL_TIMEOUT");
    expect(r.ok).toBe(true);
  });

  it("hạn của tool khác không áp lên tool này; bảng rỗng ⇒ dùng mặc định (rộng) ⇒ tool 100 ms không bị cắt", async () => {
    const cham: TimTaiLieu = () => new Promise((ok) => setTimeout(() => ok({ doan: [], daTim: ["all"] } as never), 100));
    const a = await taoBo({ hanGioTool: { grep: 10 }, timTaiLieu: cham }).chay(goi(), ctx());
    expect(a.ma).not.toBe("TOOL_TIMEOUT");
    const b = await taoBo({ hanGioTool: {}, timTaiLieu: cham }).chay(goi(), ctx());
    expect(b.ma).not.toBe("TOOL_TIMEOUT");
  });

  it("hạn 0 / âm ⇒ coi như không hạn", async () => {
    const cham: TimTaiLieu = () => new Promise((ok) => setTimeout(() => ok({ doan: [], daTim: ["all"] } as never), 80));
    for (const han of [0, -5]) {
      const r = await taoBo({ hanGioTool: { search_docs: han }, timTaiLieu: cham }).chay(goi(), ctx());
      expect(r.ma, String(han)).not.toBe("TOOL_TIMEOUT");
    }
  });

  it("★ không rò bộ hẹn giờ: tool xong trong hạn ⇒ không còn timer nào treo", async () => {
    vi.useFakeTimers();
    try {
      const bo = taoBo({ hanGioTool: { search_docs: 60_000 }, timTaiLieu: nhanh });
      const r = await bo.chay(goi(), ctx());
      expect(r.ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lỗi muộn của tool bị bỏ rơi KHÔNG làm rò unhandled rejection", async () => {
    let tuChoi: (e: Error) => void = () => undefined;
    const bo = taoBo({ hanGioTool: { search_docs: 30 }, timTaiLieu: () => new Promise((_ok, no) => (tuChoi = no)) });
    const loiChuaXuLy: unknown[] = [];
    const on = (e: unknown) => loiChuaXuLy.push(e);
    process.on("unhandledRejection", on);
    try {
      const r = await bo.chay(goi(), ctx());
      expect(r.ma).toBe("TOOL_TIMEOUT");
      tuChoi(new Error("muộn"));
      await new Promise((ok) => setTimeout(ok, 50));
      expect(loiChuaXuLy).toEqual([]);
    } finally {
      process.off("unhandledRejection", on);
    }
  });
});
