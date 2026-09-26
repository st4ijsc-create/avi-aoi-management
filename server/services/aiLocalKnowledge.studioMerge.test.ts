/**
 * Wave 2 đường B (Task 4) — kiểm `gatherStudioHits`, cầu nối kho Training Studio
 * (`kb_studio_chunks` qua server/services/kbVectorStore.ts's searchCorpus) vào
 * retrieveKnowledge. searchCorpus đã tồn tại từ trước nhưng chưa từng có caller
 * sản xuất nào — bài test này khoá hành vi của cầu nối đó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const searchCorpusMock = vi.fn();
const listCorporaMock = vi.fn();
vi.mock("./kbVectorStore", () => ({ searchCorpus: (...a: any[]) => searchCorpusMock(...a) }));
vi.mock("./kbStudioService", () => ({ listCorpora: (...a: any[]) => listCorporaMock(...a) }));

import { gatherStudioHits } from "./aiLocalKnowledgeStudio";

beforeEach(() => { vi.clearAllMocks(); });

describe("gatherStudioHits", () => {
  it("duyệt mọi corpus và gộp kết quả, cắt theo topK", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }, { name: "b" }] });
    searchCorpusMock
      .mockResolvedValueOnce([{ id: 1, text: "A1", sourceRef: "a.pdf", score: 0.9 }])
      .mockResolvedValueOnce([{ id: 2, text: "B1", sourceRef: "b.pdf", score: 0.95 }]);
    const hits = await gatherStudioHits([0.1, 0.2], 1);
    expect(searchCorpusMock).toHaveBeenCalledTimes(2);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("B1"); // điểm cao hơn thắng
  });

  it("KHÔNG có corpus nào ⇒ rỗng, không gọi searchCorpus", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [] });
    expect(await gatherStudioHits([0.1], 5)).toEqual([]);
    expect(searchCorpusMock).not.toHaveBeenCalled();
  });

  it("listCorpora ném ⇒ rỗng, KHÔNG ném ra ngoài (trợ lý phải vẫn trả lời)", async () => {
    listCorporaMock.mockRejectedValue(new Error("db down"));
    await expect(gatherStudioHits([0.1], 5)).resolves.toEqual([]);
  });

  it("một corpus ném ⇒ vẫn lấy được kết quả của corpus còn lại", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }, { name: "b" }] });
    searchCorpusMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ id: 2, text: "B1", sourceRef: "b.pdf", score: 0.5 }]);
    const hits = await gatherStudioHits([0.1], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("B1");
  });

  it("embedding rỗng ⇒ rỗng, không gọi searchCorpus (tránh nhúng lần hai)", async () => {
    listCorporaMock.mockResolvedValue({ corpora: [{ name: "a" }] });
    expect(await gatherStudioHits([], 5)).toEqual([]);
    expect(searchCorpusMock).not.toHaveBeenCalled();
  });
});
