MÃ: TC-05
MỤC TIÊU: Viết unit test vitest cho server/utils/msaReport.ts, hàm renderMsaReportMarkdown(input). Hàm dựng báo cáo MSA dạng Markdown từ một thiết bị đo và một bản ghi MSA. Test phải khẳng định đúng các hành vi sau trên chuỗi trả về:
  (1) Dòng đầu là "# MSA Report — <code> (<name>)".
  (2) Verdict in HOA ("good" thành "GOOD").
  (3) Ngày (performedAt, validUntil, approvedAt) in dạng YYYY-MM-DD theo UTC. Có ít nhất một ca với giờ gần nửa đêm UTC, ví dụ new Date("2026-03-31T23:30:00Z") phải ra "2026-03-31". Ngày null ra "—".
  (4) Số: evPct, avPct, grrPct có 2 chữ số thập phân; ptRatio, biasValue, linearityScore, stabilityScore có 4 chữ số. Nhận cả chuỗi số ("12.3456") lẫn number. null, undefined, chuỗi rỗng "" và chuỗi không phải số ("abc") đều ra "—".
  (5) ndc in nguyên giá trị. ndc = 0 phải ra "0", không ra "—". ndc null ra "—".
  (6) manufacturer, model, serialNumber, defaultUnit null thì ra "—".
  (7) Khối "**Approved:**" chỉ xuất hiện khi approvedAt có giá trị. Khi approvedBy null, dòng đó ghi "user #—".
  (8) Mục "## Notes" chỉ xuất hiện khi notes khác rỗng, và chứa đúng nội dung notes.
  (9) Dòng cuối là "_Generated <ISO> — record #<id>_". Dùng vi.useFakeTimers() + vi.setSystemTime(...) để khẳng định đúng chuỗi ISO, và trả lại đồng hồ thật sau test.
  Khẳng định trên dòng hoặc chuỗi con cụ thể, ví dụ "| GR&R% | 12.35 |". Không dùng snapshot.
TỆP ĐƯỢC PHÉP SỬA/TẠO: server/utils/msaReport.unit.test.ts
NGỮ CẢNH ĐỌC: server/utils/msaReport.ts (chỉ đọc, KHÔNG sửa). Kiểu InstrumentMsaRecord và MeasurementInstrument ở drizzle/schema/product.ts, chỉ cần các trường trong Pick. Dựng đối tượng đầu vào bằng ép kiểu `as MsaReportInput["msa"]` nếu cần.
LỆNH KIỂM: npx vitest run server/utils/msaReport.unit.test.ts. Ngoài ra dieu-phoi đặt các đột biến vào msaReport.ts, và test phải ĐỎ với mỗi đột biến.
QUY TRÌNH: Trước khi viết test, in danh sách hành vi sẽ kiểm (≤ 12 dòng) và chờ duyệt.
GIỚI HẠN: 15 phút, 8 vòng. Không chạm DB, mạng, tệp khác. Không viết chữ "Pha" kèm số trong tệp test.
