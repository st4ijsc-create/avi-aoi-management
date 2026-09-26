/**
 * Tiền tố cho CÂU HỎI trước khi nhúng — suy từ TÊN model nhúng (nguyên tắc "cơ chế thay cho cấu hình":
 * đổi `GGUF_EMBED_MODEL` thì tiền tố tự đổi theo, không có cờ `.env` nào để quên).
 *
 * Qwen3-Embedding là model nhúng BẤT ĐỐI XỨNG: tài liệu nhúng trơn, câu hỏi nhúng kèm
 * `Instruct: <nhiệm vụ>\nQuery:<câu hỏi>` (thẻ model của nhà phát hành). Repo này nhúng câu hỏi TRƠN.
 *
 * ĐO (2026-09-23, `tmp/audit-ai/r1c-instruct.mjs`, ngoại tuyến cùng model/ctx với server — biến "không
 * tiền tố" tái lập ĐÚNG số của server: 29/30 · MRR 0,772 · 15/30 qua 0,5):
 *
 * | Tiền tố | Studio trúng@5 | MRR | qua 0,5 | đoạn đúng min / trung vị | nhiễu ngoài max | hệ thống recall@5 (151) |
 * |---|---|---|---|---|---|---|
 * | không | 29/30 | 0,772 | 15/30 | 0,277 / 0,510 | 0,340 | 151 |
 * | **web chung (thẻ model)** | 29/30 | **0,804** | **20/30** | **0,340** / 0,557 | **0,308** | 151 |
 * | nhiệm vụ riêng miền AOI | 29/30 | 0,703 | 29/30 | 0,535 / 0,635 | 0,496 | **146** ✗ |
 *
 * ⇒ Chọn câu nhiệm vụ CHUNG của thẻ model: hai cụm điểm TÁCH được lần đầu (đoạn đúng thấp nhất 0,340 >
 * nhiễu cao nhất 0,308), không tụt phía hệ thống. Câu riêng miền bị bác: thổi phồng mọi điểm (nhiễu
 * 0,496 sát ngưỡng) và hạ kho hệ thống 151 → 146 — một kho chung không có "miền" để tả.
 *
 * Model khác (mxbai, …) ⇒ "" (hành vi cũ). mxbai cũng có tiền tố khuyến nghị nhưng CHƯA đo ở repo này —
 * không thêm thứ chưa đo.
 */
export const TIEN_TO_QWEN3_EMBEDDING =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:";

export function tienToNhungCauHoi(tenModelNhung: string | undefined | null): string {
  return /qwen3[-_]?embedding/i.test(String(tenModelNhung ?? "")) ? TIEN_TO_QWEN3_EMBEDDING : "";
}
