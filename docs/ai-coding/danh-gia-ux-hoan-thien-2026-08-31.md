# Đánh giá UX `/ai-coding-workspace` theo HÀNH TRÌNH NGƯỜI DÙNG — lộ trình hoàn thiện

*2026-08-31 · sau PDCA vòng 1 (commit `2408dc7b`). Góc nhìn: một kỹ sư dùng workspace làm việc THẬT
cả buổi — không phải danh sách tính năng đối chiếu máy móc. Chuẩn so: VSCode / Cursor / Claude Code.*

## Nguyên tắc bất di bất dịch khi bổ sung tính năng

1. **Mọi đường GHI mới đi qua `proposeAction → confirmAction`** (HITL). Không tính năng nào được
   mở đường ghi thứ hai — kể cả "sửa trực tiếp" (xem H2).
2. **Client chỉ gửi ID/số**, server phán quyết. Bản cắt/trần phải KHAI ra UI (bài T05).
3. Logic thuần tách lib + lưới; live-verify bằng Playwright trước khi khai xong.

---

## H1 · HIỂU MÃ (mở – đọc – điều hướng)

Trải nghiệm hiện tại: mở tệp nhanh (Ctrl+P đã phủ toàn cây sau vòng 1), tô cú pháp + số dòng tốt.
Điểm gãy khi ĐỌC LÂU:

| Thiếu | Đau thật khi nào | Cỡ |
|---|---|---|
| **Ctrl+G nhảy tới dòng** | stack trace nói "dòng 1042", phải cuộn tay | S |
| **Word-wrap toggle** | đọc markdown/chuỗi dài phải cuộn ngang từng dòng | S |
| **Breadcrumb đường tệp bấm được** | đang xem tệp sâu 5 cấp, muốn nhảy lên thư mục cha | S |
| Outline/symbol list · minimap · folding | file 2000+ dòng | M–L (đợt sau) |

## H2 · SỬA MÃ — khoảng cách LỚN NHẤT với Cursor

Hiện tại 100% chỉ-đọc: muốn đổi MỘT ký tự cũng phải mô tả cho model → chờ diff → duyệt. Đó là
điểm khác biệt trải-nghiệm lớn nhất so với Cursor (gõ thẳng, AI hỗ trợ khi cần).

**Đề xuất kiến trúc — "SỬA TAY = MỘT ĐỀ XUẤT DIFF"** (giữ nguyên bất biến HITL):
CodeMirror (đã có sẵn ở `engineering/CodeEditor.tsx`) mở ở chế độ sửa → người dùng gõ → bấm
**"Tạo đề xuất"** → client dựng `apply_diff` (original = bản server, modified = buffer) → đi ĐÚNG
cửa `proposeAction → thẻ duyệt → confirmAction` như diff của model. Không một byte nào rời trình
duyệt ngoài đường đã kiểm toán; TOCTOU đã có băm chống sẵn. Người dùng được trải nghiệm "gõ trực
tiếp", hệ thống giữ được sổ kiểm toán + RBAC (`ai_repo_read/canEdit` đã đặt trước từ mig 0330).
→ **Đây là quyết định kiến trúc, cần chủ dự án gật trước khi làm** (nó đổi cảm giác "AI đề xuất,
người duyệt" thành "người đề xuất, người duyệt"). Cỡ L, giá trị cao nhất bảng này.

Kèm theo: **Hoàn tác sau áp** (revert = một đề xuất diff ngược, cũng qua cửa duyệt) — hiện áp sai
là phải nhờ git tay. Cỡ M.

## H3 · CHẠY & KIỂM — nền tốt (đuôi sống vòng trước), còn thiếu vòng lặp tay

| Thiếu | Đau thật | Cỡ |
|---|---|---|
| **Chạy lại lệnh cũ 1 phím** (nút ↻ trên từng lượt) | sửa xong muốn chạy đúng lệnh vừa fail, phải gõ lại qua chat | S |
| **Copy đầu ra / Clear terminal** | muốn dán lỗi vào chỗ khác; lịch sử dài che lượt mới | S |
| **Problems TÍCH LUỸ + phân mức** | hiện chỉ đọc lượt lệnh MỚI NHẤT, warning bị vứt | M |
| Nhảy tệp:dòng từ lỗi trong CHAT (không chỉ panel) | stack trace nằm trong hội thoại | M |

## H4 · TÌM KIẾM

Vòng 1 đã sửa độ phủ + cờ bản cắt. Còn lại về TRẢI NGHIỆM:

| Thiếu | Đau thật | Cỡ |
|---|---|---|
| **Toggle Aa (hoa/thường) + .* (regex)** cho tìm-repo | server ĐÃ nhận `ignoreCase`, client không gửi; regex đang chạy NGẦM — gõ `a+b` ra kết quả khó hiểu mà không ai nói | S |
| Include/exclude glob (`server/**`) | tìm trong 1 vùng | M |
| Thay thế hàng loạt (qua thẻ duyệt LÔ có sẵn!) | đổi tên rải rác | L (đợt sau, HITL batch đã có nền) |

## H5 · PHIÊN & TRẠNG THÁI LÀM VIỆC

| Thiếu | Đau thật | Cỡ |
|---|---|---|
| **Tab/tệp/panel SỐNG QUA reload** (localStorage theo user+dự án) | F5 là mất sạch bàn làm việc — transcript thì lưu DB mà tab thì không | S |
| Chọn model trong trang (`ModelSelect.tsx` có sẵn chưa nối) | biết mình đang nói với model nào | M |
| Đồng hồ token/chi phí lượt | model local chậm — biết đắt rẻ | M |

## H6 · BỐ CỤC

| Thiếu | Đau thật | Cỡ |
|---|---|---|
| **Kéo-resize 3 cột + panel dưới** (`ui/resizable.tsx` có sẵn chưa dùng) | màn 1080p: cột chat 440px cố định quá hẹp khi đọc diff dài | M |
| Maximize tạm một khung (như VSCode double-click tab) | so sánh 2 vùng mã | M |
| Ctrl+W đóng tab · Ctrl+Tab chuyển tab | thao tác không rời bàn phím | S |

---

## LỘ TRÌNH ĐỀ XUẤT

- **Đợt A (nhỏ-chắc, làm ngay):** toggle Aa/.* tìm-repo · copy/clear + chạy-lại terminal ·
  tab/panel sống qua reload · Ctrl+G. → nâng "cảm giác công cụ thật" với rủi ro ~0.
- **Đợt B:** resize khung · Problems tích luỹ + warning · Ctrl+W/Ctrl+Tab · word-wrap ·
  breadcrumb · include/exclude glob.
- **Đợt C (cần chủ dự án duyệt kiến trúc):** SỬA TAY = ĐỀ XUẤT DIFF (CodeMirror → HITL) ·
  hoàn tác sau áp · thay thế hàng loạt qua thẻ duyệt lô · model selector + cost.

*Trạng thái thực thi (cập nhật 2026-09-03) — **Đợt A, B, C đã chạy hết các mục đã lên lịch**:*

- *Đợt A (`14c0a4a5`): toggle Aa/`.*` · bàn làm việc sống qua reload · terminal copy/chạy-lại/xoá.*
- *Đợt C lõi (`2dd31a9a`): SỬA TAY = ĐỀ XUẤT DIFF (`deXuatSuaTay` chỉ-propose → thẻ duyệt cũ).*
- *Đợt C tiếp (`ee539e0f`): Ctrl+G · Hoàn tác sau áp (đề xuất NGƯỢC qua HITL).*
- *Gỡ nghẽn (`cfdac724`): miễn-trừ-hẹp theo băm cho hàng rào tệp-bẩn — chuỗi HITL liên tiếp
  (undo, vòng ghi→test→sửa-tiếp) hết bị `FILE_DIRTY` chặn; người chen một byte ⇒ hàng rào đóng lại.*
- *Đợt kế 1-4 (`531ec71b`, `1cf52c26`): batch vào cùng sổ băm (cửa ghi chung) · CodeMirror thay
  textarea (legacy-modes có sẵn, 0 gói mới) · ba cột kéo-resize tự lưu · Problems tích luỹ per-lệnh.*
- *Mục 5 (`5c7303d7`): THAY THẾ HÀNG LOẠT = một đề xuất lô (`deXuatThayTheLo`) — nghiệm thu HTTP
  trọn vòng: propose → confirm → đĩa đổi thật.*
- *Mục 6 (`8472bf42`): **model HIỂN THỊ, không phải CHỌN** — `RouteInput` không có trường ép model
  và đó là thiết kế (VRAM broker); huy hiệu `model: T<tier>` + tooltip nói đúng mức chắc chắn.*

*CÒN LẠI trong lộ trình (chưa lên lịch): phân-mức warning cho Problems (đổi hợp đồng parser
`aiCodingLoiViTri` — có lưới ghim, phải là một đợt riêng) · include/exclude glob cho tìm kiếm ·
outline/minimap/folding · maximize khung · word-wrap (gutter căn theo dòng-logic; bật wrap là lệch
số dòng — cần render từng-dòng trước).*
