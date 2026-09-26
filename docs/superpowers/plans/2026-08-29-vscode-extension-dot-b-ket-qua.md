# Đợt B — kết quả (chế độ SERVER: duyệt & ghi)

Kế hoạch: `2026-08-29-vscode-extension-dot-b.md` · Spec: `../specs/2026-08-28-vscode-extension-ai-local-design.md`
Sổ chi tiết (mọi phán quyết + số đo): `.superpowers/sdd/2026-08-29-vscode-extension-dot-b/progress.md`

## Đã giao

Trong VSCode, ở **chế độ SERVER**: nhận đề xuất ghi qua SSE → xem **diff native** (hai phía đều là
tài liệu ảo, không tệp tạm) → bấm **"Duyệt & ghi trên SERVER"** → **máy chủ** ghi byte.
**Extension không chạm đĩa** — census cưỡng chế 0 lần `fs.write*`/`applyEdit`/`WorkspaceEdit`.

| Task | Commit | Ghi chú |
|---|---|---|
| 1 Đọc `pending_action` | `78a753c8` | Hợp đồng khớp từng trường (reviewer đọc 6 nơi phát sự kiện thật) |
| 2 Tóm tắt diff | `43069b37` | Đột biến CRLF |
| 3 Diff native + nhãn nguồn | `f88e3537`→`a7be692c` | **1 vòng sửa**: URI ghép chuỗi ⇒ `Uri.from` theo thành phần |
| 4+5 Thẻ duyệt + census | `9368abab`→`3c4bf2e7` | **2 vòng sửa** (xem "Bốn lần" bên dưới) |
| 6 Vá lỗ `executed` | `07fe2f3d` | Migration `0341`, lưới đỏ-trước trên DB thật |
| 7 Nghiệm thu live | — | Đo cả hai chiều, xem dưới |
| Review toàn nhánh + vá | `1c58902e` | **Bắt lỗi thứ TƯ — trong bản vá của Task 6**; migration `0342` |

**Bất biến được cưỡng chế bằng máy:** đúng **MỘT** nơi gọi `confirmAction` (census đếm **số lần
gọi**, `toBe(1)` — không phải "≤1", vì 0 nghĩa là cửa duyệt đã bị gỡ); `selectedHunkIds` không
bao giờ mang nội dung; nhãn `SERVER ·` có trên cả tiêu đề diff lẫn thẻ duyệt.

## ★★★ Nghiệm thu LIVE — đo cả HAI chiều trên máy chủ thật

Chạy qua **chính mã của extension**, đích ghi là một dự án **tạm** trong scratchpad (đăng ký qua
đúng mutation `themDuAn` của app nên không phải khởi động lại máy chủ), **không đụng đề thi**.

| Kịch bản | Kết quả THẬT |
|---|---|
| **Huỷ** | Đề xuất thật (`Calculator.cs` +7/−1) → `cancelAction` → `{ok:true,"cancelled"}` → `git status sandbox-projects/` **rỗng** |
| **Duyệt — bị từ chối** | Máy chủ trả `ok:true, status:"executed"` **nhưng** `note=GIT_STATUS_FAILED`; đĩa **không đổi**; extension khai đúng **"CHƯA GHI"** |
| **Duyệt — thành công** | Đề xuất +3/−1 → duyệt → **đĩa đổi thật: 218 → 284 ký tự**, có `ArgumentException` |

**Lời khai của giao diện khớp hiện thực ở cả hai hướng.** Một chiều thì chưa chứng minh được gì.

Và lượt "bị từ chối" **bắt được đúng con bug đang vá, sống**: CSDL lưu `status='executed'` **cạnh**
`note='GIT_STATUS_FAILED'` — hai trường mâu thuẫn trong một hàng. Nếu chỉ có bản vá vòng 1 (đọc
`ok`), thẻ đã nói dối ngay lượt nghiệm thu **đầu tiên**.

## ★★★ Bài học: cùng một lớp lỗi, BỐN lần, ba tầng độc lập

**"Khai kết quả mà không đọc kết quả."**

1. **Máy chủ** lưu `status='executed'` kể cả khi `apply_diff` **từ chối ghi**. *(tôi tìm ra khi đọc spec)*
2. **Thẻ duyệt** khai "đã ghi" khi `confirmAction` trả `{ok:false}` qua **HTTP 200** (hết hạn TTL 5
   phút, token lệch, trạng thái sai). *(reviewer)*
3. **Thẻ duyệt** vẫn khai "đã ghi" khi `{ok:true, status:"executed"}` **kèm `note`** từ chối —
   `ok` chỉ nói *vòng đời HITL đã xong*, không nói *byte đã ghi*. *(tôi tìm ra khi đọc mã xung quanh)*
4. **Bản vá cho (1) tự đẻ ra lời khai sai**: nó coi **mọi** `note` là "0 byte", nhưng
   `BATCH_PARTIAL` nghĩa là **một phần ĐÃ trên đĩa**. Lô áp nửa chừng bị đóng dấu `bi_tu_choi_ghi`
   (hợp đồng ghi "0 byte") và `writeRejected:true` — **sai vĩnh viễn trong sổ kiểm toán**.
   Repo đã cấm đúng điều này một tầng trên (`AICodingWorkspace.tsx:1537`). *(review toàn nhánh)*

**Vá (4):** thêm `ap_mot_phan` + migration `0342` — cột phải nói được **ba** sự thật (ghi / không
ghi / **ghi một phần**), hai giá trị không diễn tả nổi ba trạng thái. **Một vị từ trả lời một câu
hỏi**: `daBiTuChoiGhi` giữ nguyên bản duy nhất; `laMaGhiMotPhan` lấy danh sách mã **export từ
chính `applyDiffBatch.ts`** — nơi mã được sinh ra, không bịa bảng thứ hai.

**Hệ quả (1) mà tôi đã khai quá trong sổ:** tôi ghi *"rà 22 nơi, 0 nơi bị phá"* — **sai**. Ba giao
diện client rơi vào nhánh `pending` (thẻ không bao giờ kết thúc, nút Duyệt vẫn bật) và
`if (res.ok) toast.success(...)` hiện **toast xanh cho một lượt bị từ chối**. Đã vá: gộp ba bản đồ
trạng thái chép tay thành một.

## Cổng đo được

`ext:check` 0 lỗi · `ext:build` OK · **127 lưới extension** · lưới máy chủ liên quan xanh ·
census: 0 lần ghi đĩa, **đúng 1** lời gọi `confirmAction` (đột biến: lời gọi thứ hai **trong cùng
tệp** nay bị bắt — trước đây lọt).

## CHƯA xác minh / còn mở — nói thẳng

- **Bản vá Task 6 + lượt vá cuối CHƯA chạy trên máy chủ đang chạy** (vẫn là `dist` cũ). Có hiệu
  lực ở lần build+restart kế tiếp. Migration `0341`+`0342` **đã áp** lên DB dev nên không gây lỗi.
- **`ap_mot_phan` chưa có lưới vòng-thật**: `BATCH_PARTIAL` cần một lỗi hệ tệp giữa lô, muốn dựng
  phải mở một mối tiêm vào `ghiTheoPhanQuyet`.
- **Chưa mở bảng chat trong cửa sổ VSCode thật** với phiên đăng nhập (đã đo qua bundle đã build
  với `vscode` giả, nhưng đó không phải cùng một thứ).
- **Lỗ bằng-chứng URI của Task 3 vẫn mở**: không stub nào chứng minh được hành vi mã hoá URI thật
  của VSCode. Phải là một phép kiểm live tường minh ở Đợt C, không được mang đi im lặng.
- Nợ mang sang: `AICodingWorkspace.tsx:1519` còn bản đồ trạng thái chép tay (vô hại hôm nay) ·
  `ChatMessage.actionState` chưa khai hai giá trị mới · census quét `src/` trong khi bundle còn gộp
  `shared/aiCodingLoop.ts` (tập quét ≠ tập gộp — **Đợt C phải siết trước khi thêm đường ghi đĩa**).

## Điều kiện trước khi bắt đầu Đợt C

1. Chạy `0341` và `0342` **trước** khi triển khai mã máy chủ (cả hai migration đã ghi cảnh báo ở
   đầu tệp, nêu đích danh kiểu hỏng ghi-hai-lần).
2. Siết census: quét cả tập được **gộp vào bundle**, không chỉ `src/`.
3. Khi thêm điểm ghi đĩa **đầu tiên**, **SỬA** census thành "đúng MỘT lần tại đường dẫn X" —
   **không được xoá**.

---

## Cập nhật 2026-08-29 (chiều) — ba điều kiện trước Đợt C đã ĐÓNG

**1. Migration đã chạy qua đúng runner.** Cổng 3000 dừng, `0341` + `0342` chạy bằng vai owner
`aoi` (runner mặc định dùng `avi_app`, không có quyền DDL ⇒ `42501`; đặt biến cho riêng lệnh đó,
**không sửa `.env`**). Cả hai vào sổ `__applied_migrations` với `success=true`; enum có đủ
`bi_tu_choi_ghi | ap_mot_phan`.
⚠ Lượt chạy báo **9 thành công / 4 thất bại** — bốn cái là `0057`, `0066`, `0125`, `0234`, tức
~300 migration TRƯỚC Đợt B, thuộc đúng lớp runner tự khai là bình thường ("may be normal if
tables/columns already exist"). Không liên quan việc này; ghi ra chứ không giấu.

**2. ★★★ Bản vá T6 nay CHẠY THẬT, và được chứng minh bằng hậu quả.** Build lại + khởi động server
(`dist` có `ap_mot_phan`), rồi dựng LẠI đúng kịch bản đã bắt được lời nói dối:

| | Trước vá (đo sáng) | Sau vá (đo chiều) |
|---|---|---|
| `status` trả về | **`executed`** ← nói dối | **`bi_tu_choi_ghi`** ✓ |
| `note` | `GIT_STATUS_FAILED` | `GIT_STATUS_FAILED` |
| Cột `status` trong CSDL | **`executed`** cạnh note từ chối | **`bi_tu_choi_ghi`** cạnh note từ chối |
| Đĩa | không đổi | không đổi |

Hai trường trong cùng một hàng **hết mâu thuẫn**. Đây là lần đầu bản vá được chứng minh bằng
hậu quả trên máy chủ thật, chứ không bằng lưới.

**3. Census đã siết: TẬP QUÉT = TẬP VÀO BUNDLE.** Trước đó census quét `src/`, trong khi esbuild
còn gộp `shared/aiCodingLoop.ts` (nhập cố ý để không nhân bản vị từ) ⇒ một đường ghi đĩa nấp
trong tệp `shared/` sẽ **lọt qua toàn bộ hàng rào**. Nay khai `TEP_NGOAI_CAY_VAO_BUNDLE` và quét
cả tập đó, **kèm một ca canh chính danh sách ấy** (đọc `src/` tìm mọi import vượt `../..`, đỏ nếu
có tệp chưa khai — vì quên khai là tự chọc mù mình một cách im lặng).
Đột biến chứng minh: giấu `fs.writeFileSync` vào `shared/aiCodingLoop.ts` ⇒ census **ĐỎ và nêu
đúng tên tệp**; census cũ sẽ xanh. Lưới extension **128**, `ext:check` 0 lỗi.

**Còn mở sang Đợt C:** lỗ bằng-chứng URI của Task 3 (không stub nào chứng minh được hành vi mã
hoá URI thật của VSCode — phải là phép kiểm live tường minh) · `ap_mot_phan` chưa có lưới
vòng-thật (cần mối tiêm lỗi hệ tệp giữa lô) · chưa mở bảng chat trong cửa sổ VSCode thật với
phiên đăng nhập.
