/**
 * ★ Đợt 2 — `timTaiLieuMacDinh` (search_docs) gọi ĐÚNG nhánh truy hồi LẬP TRÌNH (`route:"vscode"`, vai trò THẬT từ phiên
 * cho cổng Studio), phân loại nguồn hãng/Studio, lọc theo `corpus`, kèm api-ref; truy hồi hỏng ⇒ phần đã có, không ném.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieveKnowledge = vi.fn();
vi.mock("../../aiLocalKnowledgeService", () => ({ retrieveKnowledge: (...a: unknown[]) => retrieveKnowledge(...a) }));

import { timTaiLieuMacDinh, _datLaiApiRef } from "./timTaiLieuAgent";

const KQ = {
  citations: [
    { id: "v1", sourcePath: "programming/mitsubishi/mc.pdf", title: "MC Protocol (mitsubishi, p.42)", sourceType: "vendor_manual", score: 0.77 },
    { id: "studio:c:1", sourcePath: "so-tay.md", title: "so-tay.md", sourceType: "studio", score: 0.5, origin: "studio" },
  ],
  contexts: ["Batch read: command 0401.", "Sổ tay nội bộ: dùng D100."],
};

beforeEach(() => {
  retrieveKnowledge.mockReset();
  _datLaiApiRef();
});

describe("timTaiLieuMacDinh", () => {
  it("★ route vscode + callerRole từ phiên; hãng/Studio tách loại; api-ref khớp tên kiểu .NET", async () => {
    retrieveKnowledge.mockResolvedValue(KQ);
    const r = await timTaiLieuMacDinh({ query: "SqlDataReader MC protocol", corpus: "all", vaiTro: "engineer" });
    expect(retrieveKnowledge).toHaveBeenCalledWith("SqlDataReader MC protocol", 5, { route: "vscode", callerRole: "engineer" });
    expect(r.daTim).toEqual(["api", "vendor", "studio"]);
    expect(r.doan.filter((d) => d.loai === "vendor").map((d) => d.nguon)).toEqual(["MC Protocol (mitsubishi, p.42)"]);
    expect(r.doan.filter((d) => d.loai === "studio").map((d) => d.noiDung)).toEqual(["Sổ tay nội bộ: dùng D100."]);
    expect(r.doan.some((d) => d.loai === "api" && d.noiDung.includes("SqlDataReader") && d.noiDung.includes("using"))).toBe(true);
  });

  it("corpus=studio ⇒ chỉ đoạn Studio; corpus=api ⇒ không gọi truy hồi", async () => {
    retrieveKnowledge.mockResolvedValue(KQ);
    const s = await timTaiLieuMacDinh({ query: "q", corpus: "studio", vaiTro: "admin" });
    expect(s.doan.map((d) => d.loai)).toEqual(["studio"]);
    retrieveKnowledge.mockClear();
    const a = await timTaiLieuMacDinh({ query: "DataTable", corpus: "api", vaiTro: "admin" });
    expect(retrieveKnowledge).not.toHaveBeenCalled();
    expect(a.daTim).toEqual(["api"]);
  });

  it("truy hồi ném ⇒ không ném, trả phần đã có", async () => {
    retrieveKnowledge.mockRejectedValue(new Error("hỏng"));
    const r = await timTaiLieuMacDinh({ query: "xyz", corpus: "vendor", vaiTro: "admin" });
    expect(r).toEqual({ doan: [], daTim: ["vendor"] });
  });
});
