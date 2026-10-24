# Đo ĐỌC ẢNH cho trợ lý lập trình (Đợt 9)

Spec, cổng và kết quả: `docs/superpowers/specs/2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md`.

| tệp | việc |
|---|---|
| `bo-anh.json` + `anh/` | 13 ảnh (11 UI thật, 1 lỗi tsc thật, 1 chèn lệnh), câu hỏi + nhóm từ khoá đáp án viết TRƯỚC khi chạy |
| `do-doc-anh.mjs` | chấm một cấu hình: `--che-do truc-tiep` (ảnh ⇒ model) hoặc `hai-buoc` (model thị giác mô tả ⇒ model chính) |
| `tai-chung-tien-to.mjs` | đối chứng CHỮ: 13 câu chung đúng câu hệ thống của `do-doc-anh.mjs` (đo checkpoint tích luỹ khi mmproj tắt) |
| `e2e-anh.mjs` | e2e qua máy chủ: `/v1` (token cá nhân) + KB stream (cookie), 3 ảnh, chấm NỘI DUNG (`done.answer`) |
| `do-thi-giac.sh` · `do-c5-ghep-cap.sh` | đợt so sánh phương án (a)/(b) và đo đường chữ ghép cặp |
| `do-cong-a.sh` · `do-e2e-lai.sh` · `do-bat-auto.sh` | cổng bật `LLAMA_SERVER_MMPROJ=auto` (đường sản phẩm, bản sao tạm `.env`) |
| `model-tham-chieu.ps1` | dựng/dừng Qwen3-VL-8B tham chiếu ở cổng 8095 (không đụng sidecar :8081) |

Mọi đợt giữ khoá khe (`lib/khoaKhe.mjs giu … --co-dung`), chạy kèm `lib/canh-bo-nho.sh`, cuối đợt đưa :8091 về 35B qua `doi-model.ps1`.

**e2e KB cần tệp tri thức SINH RA.** `knowledge/chunks.jsonl`, `embeddings.jsonl`, … nằm trong `.gitignore` nên worktree KHÔNG có ⇒ KB trên :3013
phát `error "Knowledge artifacts missing"` trước khi trả lời. Chép từ cây chính (chỉ tệp gitignored còn thiếu, không ghi đè), chạy từ gốc worktree:

```bash
for f in /d/SOURCES/avi-aoi-management/knowledge/*; do b=$(basename "$f"); [ -f "$f" ] && [ ! -e "knowledge/$b" ] && git check-ignore -q "knowledge/$b" && cp "$f" knowledge/; done
```

Bộ chấm có một âm tính giả đã biết: #12 khi câu trả lời viết "dòng:** 7" (regex `dong 7`) — giữ nguyên điểm máy, ghi chú trong spec.
