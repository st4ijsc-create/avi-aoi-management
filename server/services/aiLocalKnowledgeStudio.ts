/**
 * Wave 2 đường B — cầu nối kho Training Studio vào truy hồi của trợ lý.
 *
 * BỐI CẢNH: `searchCorpus()` (server/services/kbVectorStore.ts:180) ĐÃ TỒN TẠI, đã có
 * 2 tầng (pgvector HNSW + brute-force) và đã fail-safe — nhưng KHÔNG CÓ CALLER SẢN XUẤT
 * NÀO. Tài liệu người dùng nạp vào Studio vì thế không bao giờ tới được trợ lý, trong khi
 * UI lại nói ngược lại. Hàm này là chỗ nối duy nhất.
 *
 * ⚠ Có HAI file tên `kbVectorStore.ts` trong repo. File này import
 * `server/services/kbVectorStore.ts` (đọc/ghi bảng `kb_studio_chunks`) — KHÔNG phải
 * `server/services/kb/kbVectorStore.ts` (bảng `kb_chunks` riêng, không liên quan).
 *
 * HAI CHI TIẾT QUAN TRỌNG:
 *  1. searchCorpus nhận EMBEDDING ĐÃ TÍNH SẴN — dùng lại qVec mà retrieveKnowledge đã
 *     tính, KHÔNG nhúng lần hai (tốn thời gian + có thể lệch không gian vector).
 *  2. searchCorpus lọc theo MỘT corpus — duyệt listCorpora() rồi gộp.
 *
 * FAIL-SAFE TUYỆT ĐỐI: mọi lỗi ⇒ [] . Trợ lý phải trả lời được bằng corpus file ngay cả
 * khi toàn bộ nhánh Studio hỏng.
 */
export interface StudioHit {
  id: number;
  text: string;
  sourceRef: string;
  score: number;
  corpus: string;
}

export async function gatherStudioHits(queryEmbedding: number[], topK: number): Promise<StudioHit[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];
  try {
    const { listCorpora } = await import("./kbStudioService");
    const { searchCorpus } = await import("./kbVectorStore");
    const listed = await listCorpora();
    const names = (listed?.corpora ?? []).map((c: any) => c?.name).filter((n: any): n is string => typeof n === "string" && n.length > 0);
    if (names.length === 0) return [];

    const all: StudioHit[] = [];
    for (const name of names) {
      try {
        const hits = await searchCorpus(name, queryEmbedding, topK);
        for (const h of hits ?? []) {
          all.push({
            id: Number((h as any).id),
            text: String((h as any).text ?? ""),
            sourceRef: String((h as any).sourceRef ?? ""),
            score: Number((h as any).score ?? 0),
            corpus: name,
          });
        }
      } catch {
        // Một corpus hỏng không được làm mất kết quả của corpus khác.
      }
    }
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, Math.max(1, topK));
  } catch {
    return [];
  }
}
