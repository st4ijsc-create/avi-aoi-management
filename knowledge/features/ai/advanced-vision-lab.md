# Advanced Vision Lab

## 1. Mục đích
Phòng lab tích hợp các kỹ thuật vision nâng cao: so sánh OK/NG, kiểm tra chất lượng ảnh, sinh defect heatmap, OCR đa ngôn ngữ, auto detect ROI, augmentation, Visual QA, Batch Triage.

## 2. Vị trí truy cập
- URL: `/ai-advanced-vision-lab`
- Menu: AI → Advanced Vision Lab

## 3. Quyền yêu cầu
- Tính năng AI

## 4. Tiền điều kiện
- Vision provider hoạt động (OpenAI Vision / GGUF Vision)
- Ảnh upload ≤ 10MB

## 5. Các bước thao tác
1. Tab `Compare`: upload 2 ảnh OK + NG → AI so sánh khác biệt, mark vùng nghi ngờ
2. Tab `Quality`: upload ảnh → đánh giá blur/exposure/noise
3. Tab `Heatmap`: upload OK reference + candidate → sinh diff heatmap
4. Tab `OCR`: upload ảnh, chọn language → trả text + confidence
5. Tab `ROI`: auto detect ROI bounding boxes
6. Tab `Augmentation`: chọn transforms (rotate/flip/blur) → preview
7. Tab `Visual QA`: upload ảnh + nhập câu hỏi → AI trả lời tự nhiên
8. Tab `Batch Triage`: upload nhiều ảnh + config → batch classify

## 6. Kết quả mong đợi
- Mỗi tab trả output cụ thể (text/image/JSON)
- Latency < 5s/ảnh single, batch theo số lượng
- Lưu kết quả vào `aiAdvancedVisionResults`

## 7. Lỗi thường gặp & cách xử lý
- File > 10MB → reject + toast
- Format lạ → fallback PNG conversion
- Vision provider down → fallback message
- OCR language mismatch → đổi language code (vi/en/zh)

## 8. API liên quan
- `trpc.aiAdvancedVision.compareOkVsNg({ okImage, ngImage, language })`
- `trpc.aiAdvancedVision.imageQualityCheck({ image })`
- `trpc.aiAdvancedVision.generateDefectHeatmap({ okReference, candidate })`
- `trpc.aiAdvancedVision.extractText({ image, language })`
- `trpc.aiAdvancedVision.autoDetectRoi({ image })`
- `trpc.aiAdvancedVision.augmentImage({ image, transforms[] })`
- `trpc.aiAdvancedVision.visualQA({ image, question, language })`
- `trpc.aiAdvancedVision.batchTriage({ images[], config })`

## 9. Tính năng liên quan
- [AI Image Search](ai/ai-image-search.md)
- [Defect Heatmap](analytics/defect-heatmap.md)
- [AI Quality Gate](ai/ai-quality-gate.md)

## 10. Ví dụ thực tế
QA upload ảnh OK + NG cùng PCB → tab Compare cho thấy thiếu component ở vị trí U7. Tab Visual QA hỏi "Linh kiện nào thiếu?" → AI trả "Tụ điện C12 ở góc trên trái". Đối chiếu BOM xác nhận chính xác.
