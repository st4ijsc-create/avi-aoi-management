# Tìm kiếm ảnh AI (AI Image Search)

## 1. Mục đích
Tìm kiếm ảnh tương tự dựa trên vector embedding (similarity search), phân cụm lỗi tự động để phát hiện các nhóm defect mới.

## 2. Vị trí truy cập
- URL: `/ai-image-search`
- Menu: AI → Image Search

## 3. Quyền yêu cầu
- Tính năng AI

## 4. Tiền điều kiện
- Đã sinh `aiImageEmbeddings` cho ảnh inspection
- Model embedding đã active
- PostgreSQL phải có `vector` extension (pgvector) nếu dùng tìm kiếm similarity theo Embedding ID

## 5. Các bước thao tác
1. Mở `/ai-image-search`, xem stats: Total Images / Indexed / Defect Clusters
2. Tab `Search`: nhập Embedding ID (vd 2547), Top K (vd 5)
3. Click Search → hệ thống trả top K ảnh tương tự nhất với % similarity
4. Click ảnh để xem chi tiết inspection, ngày, kết quả
5. Tab `Embed`: upload ảnh PCB mới → sinh embedding
6. Click `Cluster` → chạy k-means/DBSCAN nhóm các defect tương tự
7. Xuất ZIP các ảnh tương tự nếu cần

## 6. Kết quả mong đợi
- Top K kết quả sắp xếp theo similarity desc
- Embedding mới lưu DB
- Cluster cập nhật số lượng và nhãn cluster

## 7. Lỗi thường gặp & cách xử lý
- Embedding ID rỗng → "Enter valid ID"
- Ít hơn K kết quả → hiển thị thực tế và note count
- Embed fail → kiểm tra format ảnh (jpg/png), kích thước
- Lỗi `CREATE EXTENSION IF NOT EXISTS vector` → DB chưa có pgvector; cài extension `vector` trên PostgreSQL rồi thử lại thao tác tìm similarity

## 8. API liên quan
- `trpc.aiImageSearch.stats()`
- `trpc.aiImageSearch.findSimilar({ embeddingId, limit })`
- `trpc.aiImageSearch.clusterDefects()`
- `trpc.aiImageSearch.embed({ imageBase64 })`

## 9. Tính năng liên quan
- [AI Quality Gate](ai/ai-quality-gate.md)
- [Defect Heatmap](analytics/defect-heatmap.md)
- [Advanced Vision Lab](ai/advanced-vision-lab.md)

## 10. Ví dụ thực tế
QA upload ảnh PCB nghi NG, sinh embedding → tìm Top 5 → ảnh giống nhất 98.2% là inspection cũ đã ghi nhận `Solder Bridge` tại vị trí góc trên trái. Dùng làm tham chiếu để xác nhận chẩn đoán nhanh chóng.
