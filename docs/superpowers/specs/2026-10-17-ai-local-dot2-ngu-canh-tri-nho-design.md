# Đợt 2 — Ngữ cảnh và trí nhớ cho vòng agent — thiết kế

Kế hoạch mẹ: `docs/superpowers/plans/2026-10-14-ai-local-hoan-thien-7-tang.md` §Đợt 2. Nền: lõi agent Đợt 1
(`shared/agentCore`, `server/services/ai/agent/*`). Khảo sát tầng 5: dự án ngoài repo chính nhận 0 ngữ cảnh mã; không
symbol/LSP; bài học 0 hàng; không đọc tệp quy ước; corpus Studio không tới đường sinh mã.

## 1. Cổng ra (viết trước)

| Cổng | Ngưỡng |
|---|---|
| Bộ "tìm mã" (mới, ≥ 12 câu "X được định nghĩa/dùng ở đâu, sửa chỗ nào" trên repo chính + dự án agent-f) | trả đúng tệp:dòng ≥ 80 %; số lượt tool trung vị giảm so với khi tắt tool mới (ablation) |
| Bộ F ×3 khi bật tool mới | không tụt quá nhiễu so với cổng Đợt 1 |
| Trí nhớ | đề xuất nhớ được người duyệt mới ghi; 0 lượt ghi nhớ không qua duyệt; nhớ đã duyệt xuất hiện trong ngữ cảnh lượt sau (đo bằng lưới + 1 lượt sống) |
| Tệp quy ước | AGENTS.md / CLAUDE.md / .github/copilot-instructions.md của dự án có trong system prompt (lưới + 1 lượt sống) |
| An toàn | nội dung nhớ/tệp quy ước/kết quả tìm là DỮ LIỆU (không quét tìm lệnh); đề xuất nhớ từ dữ liệu bị tiêm vẫn phải qua người |

## 2. Tool mới của agentCore

| Tool | Loại | Tham số | Ghi chú |
|---|---|---|---|
| `find_symbol` | đọc | `name`, `kind?` (function/class/…) | định nghĩa (tệp:dòng, chữ ký) + tối đa N tham chiếu (grep ranh giới từ) |
| `search_code` | đọc | `query`, `k?` | tìm ngữ nghĩa trên chỉ mục mã của DỰ ÁN ĐANG CHỌN (đoạn mã thật kèm tệp:dòng) |
| `search_docs` | đọc | `query`, `corpus?` | corpus Studio + tài liệu lập trình hãng + api-ref; trả đoạn kèm nguồn; dưới ngưỡng ⇒ "không thấy" |
| `remember` | đề xuất | `note` (≤ 400 ký tự), `scope?` (`project`/`user`) | KHÔNG ghi ngay: phát `de-xuat-nho`; chỉ người bấm "Nhớ" mới ghi (cả chế độ tu-dong) |

Chế độ `hoi` có `find_symbol`, `search_code`, `search_docs` (đọc); `remember` có ở mọi chế độ (chỉ là đề xuất).

## 3. Chỉ mục mã theo dự án (`server/services/ai/chiMucMa/`)

Hợp đồng (phía agent gọi qua giao diện tiêm được):
```ts
export async function timKyHieu(y: { gocDuAn: string; ten: string; kind?: string; tran?: number }):
  Promise<{ dinhNghia: Array<{ duong: string; dong: number; kind: string; chuKy: string }>; thamChieu: Array<{ duong: string; dong: number; dongMa: string }>; catBot: boolean }>;
export async function timMaNgu(y: { gocDuAn: string; cauHoi: string; k?: number; signal?: AbortSignal }):
  Promise<{ ketQua: Array<{ duong: string; dongDau: number; dongCuoi: number; doan: string; diem: number }>; trangThai: "san-sang" | "dang-dung" | "chua-co" }>;
export async function lamTuoiTep(y: { gocDuAn: string; duongs: string[] }): Promise<void>; // gọi sau mỗi lượt ghi
export async function dungChiMuc(y: { gocDuAn: string; projectId: string; signal?: AbortSignal }): Promise<{ soTep: number; soDoan: number; ms: number }>;
```
- Ký hiệu: trích định nghĩa bằng mẫu theo ngôn ngữ (ts/js/mjs, py, cs, java, go, rs, cpp/h) — không phụ thuộc gói mới; bộ nhớ đệm theo (tệp, mtime, kích thước); chỉ đọc qua hộp cát giam giữ (đuôi được phép, bỏ thư mục cấm, trần tệp/byte).
- Ngữ nghĩa: cắt đoạn theo ranh giới hàm/lớp (rơi về cửa sổ dòng), nhúng bằng embedder sẵn có (Qwen3-Embedding, in-process), lưu bảng pgvector mới (mig 0391 `ai_code_chunks`: projectId, duong, bam, dongDau, dongCuoi, noiDung, embedding vector, capNhat) khoá theo projectId; dựng khi dự án được chọn lần đầu (nền, mức ưu tiên `nen`, có huỷ) và làm tươi theo băm sau mỗi lượt ghi của agent; dự án lớn: trần số tệp + báo `catBot`.
- Không gỡ cổng `khac-goc` của đường "Hỏi" cũ trong đợt này (đo trước).

## 4. Trí nhớ và tệp quy ước

- Tệp quy ước: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules` ở gốc dự án (đọc qua hộp cát, trần 8 KB tổng, che bí mật) ⇒ khối "Project conventions" trong `dungKhoiNguCanhDuAn`.
- Nhớ: bảng có sẵn `ai_coding_lessons` (người dùng × dự án). Đề xuất (`de-xuat-nho`) giữ trong lượt chạy; tRPC `aiAgent.nhoDeXuat(runId, id)` / `boDeXuat` ghi bằng `luuBaiHoc` (giới hạn có sẵn 400 ký tự, 200 bài). Bài học đã có đi vào ngữ cảnh (đã nối ở T4) — kiểm và giữ.
- UI: thẻ "Đề xuất nhớ" trong dòng thời gian (Nhớ / Bỏ), i18n.

## 5. `search_docs`

Dùng lại truy hồi sẵn có (Studio corpora + `aiProgrammingKnowledgeService` + `knowledge/api-ref`), ngưỡng hiện hành (0,44 Studio); kết quả là dữ liệu, cắt trần, kèm nguồn; câu ngoài corpus ⇒ trả "không thấy tài liệu liên quan" (không bịa).
