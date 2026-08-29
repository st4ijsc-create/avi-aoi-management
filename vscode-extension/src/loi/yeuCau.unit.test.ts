/**
 * LƯỚI thân yêu cầu SSE. Bất biến sống còn: chế độ LOCAL PHẢI gửi codingMode:false và KHÔNG gửi
 * projectId — vì mã nằm trên máy dev, bật tool server chỉ khiến model đọc nhầm repo của server
 * rồi trả lời tự tin mà sai. Ngược lại chế độ SERVER phải có đủ cặp (codingMode:true + projectId),
 * thiếu projectId thì server im lặng rơi về dự án mặc định — sai mà không báo.
 */
import { describe, it, expect } from "vitest";
import { dungYeuCauStream } from "./yeuCau";

const CHUNG = { cauHoi: "Hàm Divide sai chỗ nào?", nguCanh: "--- TỆP ---\nCODE\n", lichSu: [], ngonNgu: "vi", vaiTro: "engineer" };

describe("dungYeuCauStream", () => {
  it("★★★ LOCAL: codingMode=false và KHÔNG có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "d:/du-an" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(false);
    expect("projectId" in ctx).toBe(false);
  });

  it("★★★ SERVER: codingMode=true VÀ có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(true);
    expect(ctx.projectId).toBe("csharp");
  });

  it("★★★ ngữ cảnh đứng TRƯỚC câu hỏi trong `question`", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    expect(q.indexOf("--- TỆP ---")).toBeLessThan(q.indexOf("Hàm Divide sai chỗ nào?"));
  });

  it("★★ ngữ cảnh RỖNG ⇒ question chỉ là câu hỏi (không có khung trống)", () => {
    const t = dungYeuCauStream({ ...CHUNG, nguCanh: "", cheDo: { loai: "local", nhan: "x" } });
    expect(t.question).toBe("Hàm Divide sai chỗ nào?");
  });

  it("★★ route khai đúng nguồn gọi để server phân biệt với web", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    expect((t.context as Record<string, unknown>).route).toBe("vscode");
  });

  it("★★ lịch sử đi nguyên vẹn", () => {
    const ls = [{ role: "user" as const, content: "trước đó" }];
    const t = dungYeuCauStream({ ...CHUNG, lichSu: ls, cheDo: { loai: "local", nhan: "x" } });
    expect(t.history).toEqual(ls);
  });

  it("★★★ I5: chế độ LOCAL — question nêu rõ mã đính kèm đọc từ máy LOCAL", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "d:/du-an" } });
    const q = String(t.question);
    expect(q).toContain("LOCAL");
    expect(q).toContain("d:/du-an");
  });

  it("★★★ I5: chế độ SERVER — question phân biệt được nguồn mã dán (LOCAL) với dự án SERVER (cây khác)", () => {
    const t = dungYeuCauStream({
      ...CHUNG,
      cheDo: { loai: "server", projectId: "csharp", nhan: "Demo Csharp" },
    });
    const q = String(t.question);
    expect(q).toContain("LOCAL");
    expect(q).toContain("Demo Csharp");
    expect(q).toContain("KHÔNG PHẢI"); // hai nguồn phải được nói RÕ là khác nhau, không chỉ liệt kê tên
  });

  it("★★ I5: ngữ cảnh RỖNG ⇒ KHÔNG dán nhãn nguồn thừa (không đẻ khung trống)", () => {
    const t = dungYeuCauStream({ ...CHUNG, nguCanh: "", cheDo: { loai: "server", projectId: "c", nhan: "Demo" } });
    expect(t.question).toBe("Hàm Divide sai chỗ nào?");
  });
});
