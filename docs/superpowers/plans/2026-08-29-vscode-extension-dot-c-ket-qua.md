# Đợt C — kết quả (chế độ LOCAL: extension tự ghi vào đĩa máy lập trình viên)

Kế hoạch: `2026-08-29-vscode-extension-dot-c.md` · Spec: `../specs/2026-08-28-vscode-extension-ai-local-design.md` (§4.1, §5.3, §6, §10)
Sổ chi tiết (mọi phán quyết + số đo): `.superpowers/sdd/2026-08-29-vscode-extension-dot-c/progress.md`
Nền: Đợt B `0cbd1dd5` (128 lưới, census quét TẬP VÀO BUNDLE, migration tới 0342).

★★★ ĐÂY LÀ ĐỢT ĐẦU TIÊN EXTENSION TỰ GHI VÀO ĐĨA MÁY LẬP TRÌNH VIÊN. Máy chủ không với tới tệp ⇒
không cưỡng chế được; ba hàng rào thay thế: **đúng MỘT điểm ghi** (census canh, `toBe(1)`) ·
**vị từ chặn cục bộ** (`chanGhi.ts` + `duongThat.ts`, R-C5 symlink) · **kiểm toán ghi-trước-chốt-sau**
(hai thủ tục tRPC, migration `0343`).

## Đã giao

| Task | Commit | Ghi chú |
|---|---|---|
| 1 Đọc đề xuất cục bộ (`docDeXuatCucBo`) | `56e8ddbe` → fix `5639eb62` | Controller tự tái hiện 2 lỗi: khối `null` ném TypeError vứt cả lô · CRLF trả `[]` toàn lượt |
| 2 Ghép bản vá (`ghepBanVa`) | `b4a8f863` | Giữ nguyên EOL của GỐC, không tự cắt khi `dongCuoi` vượt số dòng |
| 3 Vị từ chặn cục bộ (`chanGhi.ts`) | `0c11bb11` | Dùng lại `duocPhepGuiNoiDung` (R-C1: hai câu hỏi khác nhau, một danh sách) |
| 4 Băm chống xung đột (`bamTep.ts`) | `1a122473` | Cùng vị từ `BASE_MISMATCH` của máy chủ; không chuẩn hoá EOL khi băm |
| 5 Kiểm toán server (migration `0343` + 2 thủ tục tRPC) | `50f4c148` | `dang_ap_client`/`da_ap_client`/`ap_client_that_bai`; CAS chống chốt-hai-lần |
| 6 Điểm ghi đĩa duy nhất (`apBanVa.ts`) + R-C5 (symlink) | `6d21431a` → fix review `91f1af7e` | **C-1 CRITICAL**: `applyEdit` xong mà `save()` hỏng ⇒ sổ khai "thất bại" trong khi byte có thể đang ở bộ đệm — vá bằng đọc-kết-cục-rồi-mới-khai |
| 7 Cmd+K sửa đoạn đang chọn | `646e0f61` | CHỈ dựng câu hỏi, không mở đường ghi mới; census xác nhận 0 lời gọi API áp-chỉnh-sửa |
| 8 Nghiệm thu live | — | Đo cả năm kịch bản trên MẠNG THẬT + CSDL THẬT + ĐĨA THẬT, xem dưới |

**Bất biến được cưỡng chế bằng máy:** đúng **MỘT** lời gọi `applyEdit`/`WorkspaceEdit` tại
`ui/apBanVa.ts` (census `toBe(1)`, đột biến HAI CHIỀU: thừa ⇒ đỏ nêu đúng tệp thừa, thiếu ⇒ đỏ vì
số tụt); `fs.writeFile`/`writeFileSync`/`appendFile`/6 từ khác **vẫn = 0 VĨNH VIỄN**; census quét
TẬP VÀO BUNDLE (không chỉ `src/`), có ca canh chính danh sách tệp-ngoài-cây; nhãn `LOCAL · <ws>` /
`SERVER · <tên>` — thiếu nhãn ⇒ thẻ KHÔNG hiện (fail-closed).

## ★★★ Nghiệm thu LIVE — đo trên MẠNG THẬT + CSDL THẬT + ĐĨA THẬT

Nạp bundle đã build với `vscode` GIẢ (không lái được cửa sổ VSCode thật), nhưng nâng cấp so với
Task 6/7: **KHÔNG còn `fetch` giả cho tRPC** — đăng nhập THẬT (`engineer1`/`User@123`), mọi lời gọi
`repoWorkspace.listProjects`/`aiCopilot.batDauApDungOClient`/`aiCopilot.chotApDungOClient` đi qua
`fetch` THẬT tới máy chủ đang chạy cổng 3000; CHỈ khung SSE mô phỏng câu trả lời của model là giả
(mô hình AI thật không thuộc phạm vi đợt này — đợt này đo đường GHI). Sau mỗi lời gọi kiểm toán
THẬT, script tự truy vấn lại CSDL bằng driver `postgres` **độc lập với API máy chủ** (bài học Đợt
B: hai vế đo bởi cùng một API chỉ chứng minh API tự nhất quán).

| Kịch bản | Kết quả THẬT |
|---|---|
| **KB1 — THÀNH CÔNG** | Mạng: `batDauApDungOClient` → `chotApDungOClient` (đúng thứ tự, cả hai THẬT) · Đĩa: `node:fs` đọc lại độc lập cho 21→42 ký tự, băm khớp `sha256SauThat` server trả · **CSDL (2 lát cắt trực tiếp)**: `dang_ap_client` (ngay sau `batDau`, `resultJson=null`) → `da_ap_client` (ngay sau `chot`, `resultJson` mang băm thật) |
| **KB2 — XUNG ĐỘT (TOCTOU)** | Người dùng tự sửa đĩa (ngoài extension) SAU khi thẻ hiện, TRƯỚC khi bấm duyệt ⇒ mạng SAU khi bấm = `[]` (KHÔNG có `batDauApDungOClient`) · `applyEdit=0` · tệp GIỮ ĐÚNG bản người dùng · đếm CSDL `tool='ap_o_client'` KHÔNG tăng qua kịch bản (không hàng kiểm toán nào bị bỏ lửng) |
| **KB3 — CHẶN ĐƯỜNG DẪN** (`.env` · ra ngoài ws bằng `..` · `.git/hooks/pre-commit`) | Cả ba: thẻ duyệt KHÔNG hiện · KHÔNG lời gọi mạng nào (ngoài `listProjects` xảy ra trước khi có đề xuất) · tệp KHÔNG đổi byte nào (đọc lại `node:fs` xác nhận) |
| **KB4 — TÊN TỆP TIẾNG VIỆT** (`src/Báo cáo #1.cs`) | Byte ĐÚNG tệp có dấu/khoảng trắng/`#` đổi thật (`node:fs` + `readdirSync` liệt kê nguyên văn tên) · `Uri.from` dựng THEO THÀNH PHẦN với `path` mang nguyên văn tên tệp · `Uri.parse` gọi **0 lần** trên đường diff LOCAL — cơ chế gây lỗ ở Đợt B (ghép chuỗi rồi parse) KHÔNG được dùng lại. **GIỚI HẠN nói thẳng: vẫn là `Uri` GIẢ, không mô phỏng mã hoá `%XX` nội bộ của VSCode thật — lỗ bằng-chứng URI của Đợt B đóng MỘT PHẦN, chưa đóng hoàn toàn.** |
| **KB5 — HOÀN NGUYÊN + SẠCH** | Xoá workspace thử; `git status --short sandbox-projects/` **rỗng**; `git status --short` không có dòng nào liên quan tới workspace/script scratchpad của task này |

Chi tiết đầy đủ (số đo THẬT từng dòng lệnh, hai lần chạy — lần 1 bắt một lỗi TRONG CHÍNH SCRIPT
nghiệm thu ở KB3b, đã sửa và chạy lại): `.superpowers/sdd/2026-08-29-vscode-extension-dot-c/task-8-report.md`.

## ★★★ Bài học: cùng một lớp lỗi, LẦN THỨ TƯ liên tiếp, giờ là INSTANCE THỨ NĂM

**"Khai kết quả mà không đọc kết quả."**

Đợt B đã ghi bốn instance của lớp lỗi này (server `status='executed'` dù ghi bị từ chối; thẻ duyệt
khai "đã ghi" khi `confirmAction` trả `{ok:false}` qua HTTP 200; thẻ vẫn khai "đã ghi" khi `ok:true`
kèm `note` từ chối; bản vá cho ca đầu tự đẻ lời khai sai vì coi MỌI `note` là "0 byte"). Ở Đợt C,
**C-1** (review Task 6, vá `91f1af7e`) là **instance thứ NĂM**, và lần này nó đổi HƯỚNG: không còn
là "khai đã ghi khi chưa ghi" (nói dối LẠC QUAN) mà là **`applyEdit` THÀNH CÔNG + `save()` HỎNG ⇒
sổ khai `ap_client_that_bai` (thất bại) trong khi nội dung của AI đang nằm trong BỘ ĐỆM người dùng
ở dạng CHƯA LƯU** — với `files.autoSave` bật hoặc một cú Ctrl+S sau đó, byte VẪN rơi xuống đĩa
trong khi sổ đã đóng thành "không có gì xảy ra". Đây là lời nói dối theo hướng **CHE GIẤU** một
lượt ghi, ngược hướng với bốn instance trước.

Vá: `apBanVa.ts` bước 9 nay ĐỌC ĐĨA trước (không suy từ giá trị trả về của lời gọi hỏng), rồi HOÀN
NGUYÊN qua ĐÚNG điểm ghi duy nhất (không mở lối thứ hai) nếu cần, rồi ĐO LẠI để xác nhận trước khi
khai bất cứ điều gì. Nếu cả ghi lẫn hoàn nguyên đều hỏng, **KHÔNG chốt sổ** — để hàng đứng ở
`dang_ap_client`, câu TRUNG THỰC duy nhất còn lại ("một lượt ghi đã bắt đầu, kết cục CHƯA RÕ").

Docblock đầu `apBanVa.ts` nay có mục "BA LỜI KHAI HỢP LỆ + MỘT CÂU KHÔNG BAO GIỜ ĐƯỢC NÓI NẾU CHƯA
ĐO" — cố định nguyên tắc này thành văn bản để không lặp lại lần thứ sáu.

## Bài học phụ (Task 8, nghiệm thu)

- **Một sai lệch của chính phép đo, không phải của sản phẩm.** Kịch bản KB3b lần chạy đầu dùng
  đường dẫn thiếu một cấp `..` (workspace thử nằm ở `…/ws-dot-c/ws`, cần HAI cấp để chạm thư mục
  anh em). Kết quả AN TOÀN không đổi (vẫn bị chặn), nhưng chặn SAI NHÁNH ("không giải được thư mục
  cha" thay vì "nằm ngoài mọi thư mục workspace"). Sửa NGAY TRONG SCRIPT (không đụng mã sản phẩm),
  chạy lại toàn bộ, ghi cả hai lần chạy — đúng nguyên tắc "một kịch bản ra khác kỳ vọng thì báo
  trung thực, không sửa mã cho khớp".
- **Truy vấn CSDL phải đi ĐỘC LẬP với API của hệ đang được đo.** Việc chèn một truy vấn `postgres`
  trực tiếp NGAY SAU khi `fetch` thật nhận đáp ứng của `batDauApDungOClient`/`chotApDungOClient`
  (nhưng TRƯỚC khi trả đáp ứng đó lại cho bundle) cho phép quan sát ĐÚNG HAI LÁT CẮT thời gian thực
  của một chuỗi ghi-trước-chốt-sau chạy tuần tự trong MỘT lời gọi hàm — không cần tách luồng hay
  chèn breakpoint.

## Cổng đo được

`ext:check` 0 lỗi · `ext:build` OK (`dist/extension.js` 82.1kb) · **233 lưới extension, 26 tệp,
tất cả xanh** · census: đúng 1 lần `applyEdit`/`WorkspaceEdit` tại `ui/apBanVa.ts`, 0 lần `fs.write*`
· Live: byte đổi thật sau duyệt (KB1) · bị chặn khi xung đột (KB2) · bị chặn khi ra ngoài
workspace/`.env`/`.git/hooks` (KB3) · hàng kiểm toán đi đúng `dang_ap_client → da_ap_client` đo
bằng truy vấn CSDL trực tiếp (KB1) · workspace thử dọn sạch, `git status` rỗng ở mọi nơi ngoài
scratchpad (KB5).

## CHƯA xác minh / còn mở — nói thẳng, không tô hồng

1. **Chưa chạy trong cửa sổ VSCode THẬT.** Toàn bộ nghiệm thu Đợt C (Task 6/7/8) đều qua bundle đã
   build + `vscode` GIẢ. Task 8 nâng MẠNG và CSDL lên THẬT, nhưng API của chính VSCode (`Uri`,
   `WorkspaceEdit`, `TextDocument`) vẫn là bản mô phỏng.
2. **Chuẩn hoá EOL/BOM của VSCode thật chưa đo được.** `ghepBanVa` giữ EOL gốc, nhưng VSCode thật
   chuẩn hoá text chèn về `doc.eol` lúc `applyEdit`/`save()` — với tệp EOL hỗn hợp hoặc có BOM,
   `sha256SauThat` đo được trên VSCode thật có thể khác băm dự kiến. `apBanVa.ts` đã xử lý TRUNG
   THỰC hướng này (khai băm ĐO ĐƯỢC + cảnh báo lệch cho người dùng), nhưng hành vi lệch cụ thể chưa
   quan sát được ngoài đời.
3. **Chưa hỗ trợ TẠO TỆP MỚI.** `de_xuat_sua`/`de_xuat_sua_doan` trỏ vào tệp chưa tồn tại bị từ
   chối RÀNH MẠCH ở bước đọc đĩa của `apBanVa`/`xuLyDeXuatCucBo` — không im lặng, nhưng cũng không
   làm được. Cần một task riêng (đường ghi THỨ HAI qua `.createFile()`, xem phán quyết trong
   `progress.md`).
4. **Symlink TỆP (khác thư mục/junction) chưa đo được trên Windows** — máy dev không tạo nổi
   symlink tệp khi không có quyền elevation (`EPERM`); junction/thư mục ĐÃ đo (R-C5).
5. **Lỗ bằng-chứng URI của Đợt B đóng MỘT PHẦN, không hoàn toàn** (xem KB4 ở trên) — `Uri` GIẢ
   không mô phỏng mã hoá `%XX` nội bộ của VSCode thật.
6. **Nhiều đề xuất trong một lượt trả lời:** chỉ hiện đề xuất ĐẦU TIÊN, nói rõ đã bỏ qua bao nhiêu
   cái còn lại — chưa đổi ở Đợt C, chưa có kịch bản live riêng cho ca này.
7. **Vòng tác nhân cục bộ đa bước, @-mention, nút Dừng ở LOCAL** — ngoài phạm vi Đợt C (dành cho
   Đợt D theo đúng brief).

## Điều kiện trước Đợt D

1. Nếu Đợt D mở đường "tạo tệp mới", phải thiết kế lại nhánh băm-gốc-rỗng cho `apBanVa` — KHÔNG vá
   chồng lên luồng hiện tại (luồng hiện tại giả định tệp ĐÃ TỒN TẠI ở mọi bước: realpath, đọc đĩa,
   so băm).
2. Nếu Đợt D thêm bất kỳ điểm chạm đĩa THỨ HAI nào (kể cả cho một tính năng tưởng như vô hại), phải
   SỬA census (`toBe(1)` → điều kiện mới nói rõ CẢ HAI điểm hợp lệ) — KHÔNG xoá bất biến "đúng MỘT
   lần", đúng nguyên tắc đã áp dụng xuyên suốt Đợt C.
3. Muốn đóng NỐT lỗ bằng-chứng URI (KB4 §2), cần một phép kiểm live tường minh TRONG cửa sổ VSCode
   thật (không phải bundle + `vscode` giả) — ghi lại thành một dòng riêng trong backlog Đợt D, đừng
   mang đi im lặng lần thứ ba.
