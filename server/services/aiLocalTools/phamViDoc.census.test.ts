/**
 * ★★★ L8 — CENSUS phạm vi tool ĐỌC: MỌI tool ĐỌC đăng ký phải có dòng trong `KHOA_PHAM_VI_DOC_TOOL` (lọc / chỉ-toàn-quyền / đã-có / miễn trừ CÓ LÝ DO); dòng thừa ⇒ đỏ.
 * Thêm tool đọc mới mà quên bảng ⇒ đỏ ở đây. Lọc THẬT được đo trên CSDL ở `phamViDoc.db.test.ts` (đối chứng A→A, B→A rỗng, người không gán nhà máy).
 */
import { describe, expect, it } from "vitest";
import { listTools, isWriteTool } from "./toolRegistry";
import { KHOA_PHAM_VI_DOC_TOOL } from "./phamViDoc";

describe("phamViDoc tool census", () => {
  it("mọi tool đọc có dòng; không dòng thừa", async () => {
    await import("./index");
    await import("../visionDefectProposal");
    const doc = listTools().filter((t) => !isWriteTool(t)).map((t) => t.name).sort();
    expect(Object.keys(KHOA_PHAM_VI_DOC_TOOL).sort()).toEqual(doc);
    expect(doc.length).toBe(56);
  });
  it("miễn trừ có lý do ≥ 20 ký tự; mọi dòng còn lại nêu trục", () => {
    for (const [ten, v] of Object.entries(KHOA_PHAM_VI_DOC_TOOL)) {
      if (v.kieu === "mien") expect(v.lyDo.length, ten).toBeGreaterThanOrEqual(20);
      else expect(v.truc.length, ten).toBeGreaterThan(5);
    }
  });
});
