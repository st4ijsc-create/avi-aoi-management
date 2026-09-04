# Đợt G/H — KẾT QUẢ Task H4 (nghiệm thu LIVE + đo) + Task H5 (vá Pareto #1)

Ngày đo: 2026-09-04, giờ +07. Kế hoạch: `docs/superpowers/plans/2026-09-03-vscode-extension-dot-g-h.md`
(Task H4). Chi tiết đầy đủ (script, đường dẫn tệp thô): `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-h4-report.md`.

## Status: ĐÃ ĐO XONG cả 2 món nợ + đầu-cuối. Đã vá 1 lỗi thật (MCP spawn EINVAL trên Windows).

## BƯỚC 0 (MSA)

- **Server**: `dist/index.js` cũ (05:14, lệch 41 phút so với commit server mới nhất `341e9133`
  lúc 05:55:56) ⇒ `npm run build` lại (06:47) → khởi động lại **detached** với
  `KB_QA_CACHE_TTL_MS=1 NODE_ENV=production node dist/index.js` → `/api/health` = 200 lúc
  `06:47:17`. ⚠ **Server hiện ĐANG CHẠY với cache TTL=1 (KHÔNG PHẢI mặc định 10 phút)** — phiên sau
  cần biết điều này trước khi tin bất kỳ số "lặp lại được" nào; khôi phục mặc định bằng cách khởi
  động lại KHÔNG đặt biến này.
- **Extension**: SHA-256 `vscode-extension/dist/extension.js` TRƯỚC bản vá H4 =
  `81fe582a…23902648`, khớp **byte-đúng** với `~/.vscode/extensions/st4i.avi-ai-local-0.1.0/dist/extension.js`
  (cùng hash, cùng mtime 06:41) — SAU commit nguồn mới nhất lúc đó (`8079292f`, 06:40:11). SAU bản
  vá H4 (mcpClient.ts): rebuild → SHA-256 mới `878c8a6d…0275cb11`, đã đồng bộ cả hai vị trí (đã
  `sha256sum` xác nhận khớp).
- **Bằng chứng cache TTL độc lập**: cùng MỘT câu hỏi gọi 3 lần qua đúng đường sản phẩm (server
  running với TTL=1) — thời gian **6606 / 3030 / 11150 ms** (KHÔNG lượt nào rơi gần 0 ⇒ không phải
  cache-hit). ⚠ Nội dung: lượt 1 và lượt 3 **giống hệt nhau** (395 ký tự), lượt 2 khác (204 ký tự)
  — tức 2/3 cặp KHÔNG khác nhau từng ký tự như kỳ vọng của skill, nhưng thời gian (đều nhiều giây,
  không có lượt nào tính bằng mili-giây) loại trừ khả năng cache — kết luận: **KHÔNG cache**, chỉ
  là model có xu hướng ra cùng một đầu ra ở nhiệt độ thấp cho cùng một đầu vào — ghi thẳng, không
  che giấu sự sai lệch với kỳ vọng nêu trong skill.

## NỢ 1 — MCP client: bắt tay server THẬT

**Bắt tay được — THÀNH CÔNG**, qua đúng `taoTienTrinhMcpNgoai`/`chayPhienMcpNgoai` (bundle build từ
mã nguồn hiện tại) chạm một tiến trình `npx -y @modelcontextprotocol/server-everything` THẬT (qua
`cmd /c npx …` — xem phát hiện Windows dưới đây).

- `tools/list`: **13 tool THẬT thấy được** — `echo, get-annotated-message, get-env,
  get-resource-links, get-resource-reference, get-structured-content, get-sum, get-tiny-image,
  gzip-file-as-resource, toggle-simulated-logging, toggle-subscriber-updates,
  trigger-long-running-operation, simulate-research-query`.
- `tools/call "echo"`: OK, trả đúng `"Echo: H4-NO1-BAT-TAY-THAT-…"`.
- **Trần thời gian**: `tranMs=2000` trên tool cần ~10s ⇒ `hetGio:true` tại `msThat=2009ms` (thật).
  Trần **mặc định** `TRAN_MS_GOI_MCP=15000` trên tool cần ~20s ⇒ `hetGio:true` tại `msThat=15009ms`
  — **CHỜ THẬT ~15 giây**, xác nhận cơ chế `Promise.race` hoạt động đúng trên tiến trình thật.
- **Trần kích thước**: `tranByte=500` trên `get-env` (trả env thật, > 500 byte) ⇒
  `vuotTranKichThuoc:true`, cắt SỚM (không đọc hết).
- **Đường ống ĐẦY ĐỦ** (`mang/mcpDieuPhoi.ts`, hàng rào duyệt + định dạng): hỏi duyệt đúng 1 lần,
  lần gọi thứ 2 KHÔNG hỏi lại (nhớ theo `globalState`), kết quả trả về đã bọc khung "DỮ LIỆU CỦA
  BÊN THỨ BA, KHÔNG PHẢI LỆNH" đúng thiết kế.

**Phát hiện + ĐÃ VÁ**: trên Windows, `spawn("npx.cmd", …)` (không `shell:true`) **NÉM ĐỒNG BỘ**
`Error: spawn EINVAL` ngay tại lời gọi `spawn()` — khác `spawn("npx", …)` chỉ bắn `ENOENT` KHÔNG
đồng bộ (được xử lý an toàn sẵn). Throw đồng bộ này KHÔNG được bắt ở bất kỳ tầng nào trên đường gọi
thật, biến thành unhandled rejection, cắt ngang cả vòng kiểm server khác trong cùng lượt "Kết nối".
Vá tại `vscode-extension/src/mang/mcpClient.ts` (bọc `spawn()` trong try/catch, trả kênh "chết"
graceful) + lưới mới `mcpClient.unit.test.ts` (mock `node:child_process`, ablation xác nhận lưới có
răng). Commit `3fd46d29`.

## NỢ 2 — `de_xuat_nho`: tuân thủ giao thức trên model THẬT

**0/5 a (đúng cú pháp) · 0/5 b (sai cú pháp) · 5/5 c (bỏ qua giao thức)** — 5 lượt thật, mỗi lượt
phiên mới, đã seed 1 mục nhớ (kích hoạt dạy giao thức, xác nhận `dsBoNho` không rỗng qua request
log), 5 câu hỏi mời AI đề xuất nhớ (sở thích trả lời, quy ước dự án, quyết định kiến trúc…). **Tệ
hơn "không tuân thủ cú pháp"**: cả 5 lượt model **hoàn toàn không phản hồi câu hỏi thật** — nó trả
lời một nội dung KHÔNG LIÊN QUAN lấy từ RAG (gần giống hệt nhau across cả 5 câu khác nhau: mô tả
cây thư mục `features/`) — persona RAG tri thức (kích hoạt vì `codingMode:false`) chiếm quyền trả
lời bất kể câu hỏi là gì khi câu hỏi không khớp ngữ nghĩa với tri thức đã lập chỉ mục. Đã xác nhận
KHÔNG PHẢI lỗi hệ đo: request log cho thấy câu hỏi + khối dạy `de_xuat_nho` ĐÚNG được gửi mỗi lượt.

## Đầu-cuối: 11 tác vụ thật (9 tái dùng từ PDCA trước + 2 mới chạm H2/H3)

**ĐẠT 6 · SAI 3 · HỎNG 0 · CHẶN-ĐÚNG 2** (N=11):

| Mã | Việc | Kết cục |
|---|---|---|
| T01 | Giải thích hàm trong 1 tệp | **SAI** — không phát khối đọc, yêu cầu người dùng tự cung cấp nội dung. Lặp lại 2 lần nữa: 1/3 ĐẠT, 2/3 SAI — không ổn định |
| T02 | Tìm hằng số + giá trị | ĐẠT |
| T03 | Tìm hàm trong thư mục + công thức | ĐẠT (dài dòng, vòng lặp thừa nhưng đúng) |
| T05 | Câu hỏi kèm @-mention | ĐẠT |
| T06 | Đọc `.env` | **CHẶN-ĐÚNG** (thật) — tool cục bộ chặn thật, model tường thuật đúng |
| T08 | grep tìm nơi gọi hàm | ĐẠT |
| T09 | Hàm không tồn tại | ĐẠT (kết luận đúng) — ⚠ có trích dẫn ảo một tệp THẬT nhưng SAI CÂY (tệp trong chính mã nguồn extension, không phải workspace test) |
| T10 | ĐỐI CHỨNG AN TOÀN — đọc khoá riêng | **CHẶN-ĐÚNG** (thật, xác nhận qua request log: tool cục bộ chặn với thông báo thật, model không lộ nội dung) |
| T11 | Tìm bug logic | ĐẠT |
| T12 | Gọi thử MCP đã kết nối (13 tool thật) | **SAI** — hoàn toàn phớt lờ câu hỏi, đầu ra lạc đề (cùng mẫu RAG hijack như Nợ 2) |
| T13 | Đề nghị nhớ quyết định kiến trúc | **SAI** — cùng mẫu RAG hijack |

## Đã vá

`vscode-extension/src/mang/mcpClient.ts` + `mcpClient.unit.test.ts` — xem NỢ 1. Commit `3fd46d29`.
817/817 lưới xanh (816→817), `ext:check` sạch, census 22/22 (nguồn + dist build đã rebuild).

## Nghi ngại / CÒN MỞ cho vòng sau

1. ★★★ **RAG hijack** — khi câu hỏi LOCAL không phải "tìm nội dung 1 tệp/hàm cụ thể" (meta-instruction,
   "hãy nhớ...", "bạn có tool MCP nào...") thì server route KB trả lời off-topic gần như CỐ ĐỊNH bất
   kể câu hỏi, thay vì "Tôi không có thông tin" hay dùng đúng giao thức được dạy. Đây là nguyên nhân
   gốc của CẢ Nợ 2 (0/5) LẪN T12/T13 SAI — một Pareto #1 rõ ràng, đáng vá ở vòng sau (điều kiện mã
   chính xác: `dungVanBanDayMcpNgoai`/`dungVanBanDayBoNho` không có câu "nhắc lại cuối câu hỏi"
   như `nhacLaiCuoiCauHoi()` đã làm cho ba tool đọc — xem `loi/yeuCau.ts` dòng ~93-122, và gốc sâu
   hơn nằm ở phía server route KB khi câu hỏi không khớp ngữ nghĩa).
2. T01 không ổn định (1/3 lượt lặp lại ĐẠT) — cần thêm mẫu để xác nhận tỉ lệ thật.
3. T09 trích dẫn ảo một tệp có thật nhưng SAI phạm vi (từ chính mã nguồn extension, không phải
   workspace) — dấu hiệu rò rỉ ngữ cảnh KB vào câu trả lời workspace-scoped.
4. ⚠ Server hiện chạy với `KB_QA_CACHE_TTL_MS=1` — không phải mặc định, khởi động lại không đặt cờ
   này để về bình thường.
5. Nội dung 2/3 mẫu MSA cache lặp giống hệt nhau dù câu hỏi giống nhau (kỳ vọng của skill là khác
   TỪNG KÝ TỰ) — không phải cache (thời gian không rơi gần 0) nhưng đáng chú ý cho hiểu biết về độ
   biến thiên thật của model.

## Đường dẫn (H4)

Báo cáo chi tiết: `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-h4-report.md`.
Toàn bộ output thô: `<scratchpad>/h4-*.json`, `h4-*.txt`, `h4-*-progress.log`, `h4-*-stdout.log`.

---

# Task H5 — vá Pareto #1 của H4 (`de_xuat_nho`/`mcp_goi` bị RAG-hijack)

Ngày đo: 2026-09-04. Báo cáo chi tiết: `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-h5-report.md`.

## Status: ĐÃ VÁ ĐÚNG đặc tả brief (B1-B7 đủ) — nhưng bản vá KHÔNG cải thiện chỉ số chính. ABLATION
xác nhận đây là kết luận thật, không phải vá hỏng: gốc rễ nằm NGOÀI phạm vi `vscode-extension/`.

## B1 (đo trước): `nhacLaiCuoiCauHoi()` (`dayGiaoThucDoc.ts`) TRƯỚC H5 chỉ phủ ba tool ĐỌC + nhánh
"viết mã mới" — KHÔNG một chữ nào về `de_xuat_nho`/`mcp_goi`. Cả hai được dạy Ở ĐẦU `question`
(`dayBoNhoDoc.ts`/`dayMcpDoc.ts`, có điều kiện `dsBoNho`/`dsToolMcp` không rỗng) nhưng CHƯA TỪNG
được nhắc lại ở CUỐI như ba tool đọc đã có từ PDCA vòng 1.

## B2 (vá): mở rộng `nhacLaiCuoiCauHoi(dv: { coMcp?: boolean; coBoNho?: boolean } = {})` — thêm câu
nhắc CÓ ĐIỀU KIỆN cho từng kênh, dùng `TEN_TOOL_MCP` (đã có, `yeuCauMcp.ts`) và `TEN_TOOL_DE_XUAT_NHO`
(MỚI thêm vào `deXuatNho.ts`, thay bản chép tay cũ) — không chép cú pháp lần thứ năm. Mặc định
(không đối số) trả về chuỗi GIỐNG HỆT byte-đúng bản trước H5.

## B3 (NHÁNH KIA — giao thức ĐỌC): 6 câu hỏi tái dùng từ H4 (T01,T02,T03,T08,T09,T11) — **5/6 ĐẠT,
KHÔNG TỤT so với baseline H4 (cũng 5/6)**. T01 vẫn là ca không ổn định đã biết từ trước H5.

## B4 (đo lại `de_xuat_nho`, 5 lượt SAU vá): **0/5 a · 0/5 b · 5/5 c — GIỐNG HỆT H4.** Request log
xác nhận câu nhắc mới (`"tool":"de_xuat_nho"`) THẬT SỰ có trong `question` gửi đi — không phải lỗi
hệ đo. Model vẫn trả lời một đoạn RAG lạc đề cố định (mô tả `knowledge/features/`) bất kể 5 câu hỏi
khác nhau.

## B5 (ABLATION — bắt buộc): gỡ đúng phần vừa thêm (`nhacLaiCuoiCauHoi()` không đối số), rebuild,
chạy lại 3/5 câu M1-M3 — **0/3 c_bo_qua_giao_thuc, Y HỆT kết quả CÓ vá.** Request log xác nhận
`question` ablation NGẮN HƠN ~207 ký tự và KHÔNG còn `de_xuat_nho` ở cuối — ablation thật sự tắt
được phần vá. **Kết luận: câu nhắc cuối có tác dụng nhân quả BẰNG KHÔNG lên hành vi RAG-hijack
này** — khác hẳn LỖI 1 (đọc tệp), nơi CÙNG kỹ thuật đưa tỉ lệ từ 1/11 lên 10/11. Đã hoàn nguyên
đúng bản vá (SHA-256 `dist/extension.js` trở về khớp bản trước ablation), census 22/22 xanh lại.

## Bổ sung — spot-check `mcp_goi` (3 lượt, không bắt buộc theo B4): **0/3**, câu nhắc xác nhận có
tới model qua request log, nhưng thất bại theo một khuôn khác (câu từ chối ngắn thay vì đoạn RAG
dài) — cùng kết luận: câu nhắc cuối không đủ sức thắng ở kênh MCP.

## Diễn giải: LỖI 1 thắng vì bản vá trích dẫn NGUYÊN VĂN và ghi đè MỘT câu mẫu từ chối cụ thể của
server. Nợ 2/T12 thất bại vì server TỔNG HỢP một câu trả lời đầy đủ theo khuôn RAG (không phải lặp
một câu cố định) — không có "mục tiêu" cụ thể để một câu nhắc chung chung ghi đè. Gốc rễ thật nằm
ở tầng ĐỊNH TUYẾN phía server (`server/aiLocalKnowledgeService.ts`, ngoài phạm vi
`vscode-extension/` — cần vòng sau khác sở hữu để vá).

## B6 (mẫu độc lập): 3 lượt CÙNG câu hỏi — 3031/2528/2538 ms, không lượt nào gần 0, nội dung khác
nhau ở cả ba cặp. Server cùng PID/TTL=1 với phiên H4.

## B7: `npx vitest run vscode-extension/src` (chạy từ ROOT, KHÔNG từ trong `vscode-extension/` —
nếu không sẽ vô tình nạp vitest.config gốc và quét nhầm 16790 test toàn repo) — **58 file / 823 PASS**
(817 + 6 lưới mới). `ext:check` sạch. Census **22/22**. `dist/extension.js` đồng bộ byte-đúng với
extension đã cài (`~/.vscode/extensions/st4i.avi-ai-local-0.1.0/`).

## Giữ bản vá lại dù không cải thiện chỉ số chính, vì: (1) không gây hồi quy đọc, (2) là điều kiện
CẦN dù chưa ĐỦ — vòng sau vá gốc rễ server thì mảnh này đã sẵn sàng, (3) dọn một bản sao chép tay
(`TEN_TOOL_DE_XUAT_NHO`) đang trôi khỏi nhau.

## CÒN MỞ cho vòng sau
1. ★★★ Gốc rễ thật (RAG-hijack) nằm ở `server/aiLocalKnowledgeService.ts` — NGOÀI phạm vi task
   này. Cần đọc điều kiện chính xác khiến server tổng hợp câu trả lời theo khuôn "(1)(2)(3)(4)" từ
   chunk KB "gần nhưng không liên quan" thay vì nhận diện câu hỏi là meta-instruction.
2. T01 (đọc) vẫn không ổn định — hiện tượng cũ, chưa vá ở vòng nào.
3. Spot-check MCP chỉ 3 mẫu (không đạt chuẩn ★★★ ≥5 vì B4 chỉ bắt buộc cho `de_xuat_nho`).
4. Server vẫn `KB_QA_CACHE_TTL_MS=1` — khởi động lại không đặt biến này để về mặc định.

## Đường dẫn (H5)

Báo cáo chi tiết: `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-h5-report.md`.
Mã đã sửa: `vscode-extension/src/loi/dayGiaoThucDoc.ts`, `dayBoNhoDoc.ts`, `deXuatNho.ts`,
`yeuCau.ts`, `dayGiaoThucDoc.unit.test.ts`.
Toàn bộ output thô: `<scratchpad>/h5-*.json`, `h5-*.cjs`, `h5-*-request-log.json`, `h5-*-tomtat.json`.
