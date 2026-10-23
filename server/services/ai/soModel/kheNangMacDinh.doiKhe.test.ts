/**
 * ★ Đợt 9 (2026-10-23, dieu-phoi) — mỗi lần ĐỔI KHE ghi một sự kiện `vram_events` `doi_khe` (có giờ) để đếm "số lần đổi khe/giờ" sau khi
 * bật trợ lý + tác nhân theo vai trò (`scripts/ai-eval/dem-doi-khe.mjs`, ngưỡng báo > 6/giờ).
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ suKien: [] as Array<Record<string, unknown>>, ketQua: "thanh-cong" as string, loi: null as string | null }));
vi.mock("../doiModelLlamaServer", () => ({
  LoiDoiModel: class extends Error { code = "X"; },
  layDieuPhoiDoiModel: () => ({ batDau: async () => ({ xong: Promise.resolve({ ketQua: h.ketQua, loi: h.loi }) }) }),
}));
vi.mock("../../vram/vramEventLog", () => ({ logVramEvent: (e: Record<string, unknown>) => void h.suKien.push(e) }));

import { __boPhucVuThatChoTest } from "./kheNangMacDinh";

describe("BoPhucVu thật — đổi khe ghi vram_events `doi_khe`", () => {
  it("★★★ đổi thành công ⇒ MỘT sự kiện doi_khe {den, ketQua, ms}", async () => {
    h.suKien = [];
    h.ketQua = "thanh-cong";
    await __boPhucVuThatChoTest.doiSang("Qwen3.6-27B-UD-Q4_K_XL");
    expect(h.suKien).toHaveLength(1);
    expect(h.suKien[0]).toMatchObject({ event: "doi_khe", owner: "khe-nang", leaseKind: "external-process", detail: { den: "Qwen3.6-27B-UD-Q4_K_XL", ketQua: "thanh-cong" } });
    expect(typeof (h.suKien[0]!.detail as { ms: unknown }).ms).toBe("number");
  });
  it("★★ đổi HỎNG ⇒ vẫn ghi (kèm loi) rồi mới ném — lần hỏng cũng là một lần chiếm khe", async () => {
    h.suKien = [];
    h.ketQua = "that-bai";
    h.loi = "nạp hỏng";
    await expect(__boPhucVuThatChoTest.doiSang("Qwen3.6-27B-UD-Q4_K_XL")).rejects.toThrow();
    expect(h.suKien).toHaveLength(1);
    expect(h.suKien[0]).toMatchObject({ event: "doi_khe", detail: { ketQua: "that-bai", loi: "nạp hỏng" } });
  });
});
