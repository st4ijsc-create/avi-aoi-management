# Luồng AI — vận hành bảo mật (dành cho quản trị viên)

Áp dụng từ đợt bảo mật 2026-10-21 (mig 0410–0412). Mỗi mục: **hành vi** → **thông điệp người dùng thấy** → **cách xử lý**.
Xoay khoá bí mật: xem `server/services/flow/biMat.RUNBOOK.md`.

## 1. Phạm vi nhà máy của luồng và bí mật

**Hành vi.** Mỗi luồng và mỗi bí mật thuộc MỘT nhà máy (`factoryId`). Người dùng chỉ thấy và dùng luồng/bí mật của nhà máy mình được gán.
`NULL` = toàn hệ thống: **chỉ admin** thấy và dùng. Luồng/bí mật của nhà máy khác — hoặc không tồn tại — cho cùng một câu trả lời.
Khi tạo mới: người dùng thuộc đúng 1 nhà máy → tự gán; thuộc nhiều nhà máy → phải chọn (ô "Nhà máy của luồng"); chưa gán nhà máy nào → không tạo được; chỉ admin tạo được loại toàn hệ thống.
Luồng chỉ được tham chiếu bí mật và luồng con thuộc phạm vi của người lưu; lúc chạy, phạm vi được tính lại theo **chủ lượt** (xem §8).

| Thông điệp | Nguyên nhân | Xử lý |
|---|---|---|
| `Không có luồng X.` / `Không có lượt X.` / `Không có bí mật X.` | Không tồn tại, hoặc ngoài nhà máy của bạn | Kiểm tra id; nhờ admin gán nhà máy cho tài khoản |
| `Tài khoản chưa được gán nhà máy nào.` | Tài khoản không có nhà máy | Gán nhà máy ở quản lý người dùng |
| `Bạn thuộc nhiều nhà máy — phải chọn factoryId.` | Tạo luồng/bí mật mà chưa chọn | Chọn nhà máy trong hộp tạo |
| `Nhà máy không nằm trong phạm vi của bạn.` | Chọn nhà máy không được gán | Chọn nhà máy của mình |
| `Id luồng đã được dùng — chọn id khác.` | Lưu vào id đã có ở nhà máy khác | Đổi id (id sinh từ tên + hậu tố) |
| `Luồng không hợp lệ: node 'n': credentialRef 'x' không tồn tại hoặc ngoài phạm vi của bạn.` | Bí mật của nhà máy khác / toàn hệ thống | Dùng bí mật của nhà máy mình, hoặc nhờ admin tạo bí mật cho nhà máy |
| `Luồng không hợp lệ: luồng con 'x' không tồn tại hoặc chưa có phiên bản hoạt động.` | Luồng con ngoài phạm vi / chưa bật | Dùng luồng con cùng nhà máy |

**Luồng/bí mật cũ.** Backfill: `npx tsx scripts/flow-backfill-pham-vi.ts` (chạy khô, in báo cáo) rồi `--ap-dung`. Người tạo thuộc đúng 1 nhà máy → gán; còn lại để NULL (chỉ admin thấy) — admin gán lại bằng cách lưu lại luồng/tạo lại bí mật với nhà máy mong muốn.

## 2. Host cho phép của bí mật

**Hành vi.** Mỗi bí mật khai danh sách host nó được gửi tới (`hostChoPhep`, 1–20 hostname, chữ thường; không scheme, cổng, đường dẫn hay ký tự đại diện). Node HTTP chỉ gắn bí mật vào yêu cầu tới đúng các host đó (so khớp chính xác, kể cả khi host nằm trong danh sách trắng chung §3).
Tạo bí mật mới **bắt buộc** khai host. **Bí mật cũ chưa khai host dùng không được** cho tới khi admin khai.

| Thông điệp | Xử lý |
|---|---|
| `bí mật chưa khai host cho phép (quản trị viên khai ở Bí mật → host)` | Admin: trang Luồng AI → khối Bí mật → "Khai/sửa" (hoặc `flow.biMatDatHost`) |
| `host 'x' không nằm trong danh sách host của bí mật` | Thêm host vào bí mật (admin) hoặc sửa URL của node |
| `Phải khai hostChoPhep (host bí mật được gửi tới).` | Điền ô "Host cho phép" khi tạo |

## 3. Danh sách trắng host HTTP — `AI_FLOW_HTTP_HOST_CHO_PHEP`

Biến môi trường, các mục cách nhau dấu phẩy. Mặc định rỗng = từ chối mọi host.

- `erp.nha-may.vn` — host trơn: mọi cổng, **chỉ khi host phân giải ra địa chỉ CÔNG CỘNG**.
- `mes.local:8443` — host + cổng: cho phép đích **nội bộ** (loopback, 10/8, 172.16/12, 192.168/16, link-local, CGNAT, ULA …) nhưng CHỈ đúng host và cổng ấy (http mặc định 80, https 443).
- Metadata đám mây `169.254.169.254` và mọi địa chỉ nội bộ khác bị chặn trừ khi ghi rõ `host:cổng`.
- DNS được phân giải **một lần**, mọi địa chỉ trả về đều được kiểm (trộn công cộng + nội bộ ⇒ từ chối), kết nối đi tới đúng IP đã kiểm; không theo chuyển hướng 3xx; phản hồi cắt ở 1 MB.

| Thông điệp | Xử lý |
|---|---|
| `host 'x' không có trong AI_FLOW_HTTP_HOST_CHO_PHEP` | Thêm host (hoặc `host:cổng`) vào biến, khởi động lại máy chủ |
| `đích 'x' là địa chỉ nội bộ / không công cộng — chỉ cho phép khi danh sách trắng ghi rõ host:cổng` | Nếu đích nội bộ là chủ ý: ghi `host:cổng`; nếu không: đây là SSRF bị chặn |
| `không phân giải được host 'x'` | Kiểm tra DNS |
| `phản hồi quá 1048576 byte` | Đích trả quá 1 MB — thu hẹp truy vấn |

## 4. Ghim phiên bản luồng con

**Hành vi.** Luồng cha (node `luong.goi-con`, tool của `ai.agent`) gọi đúng **phiên bản đã ghim** của luồng con (`parameters.version`), không phải "phiên bản đang bật". Bật bản mới của con không đổi cha đã duyệt; muốn cập nhật phải **lưu lại luồng cha** (hạng ≥ ngoai-ghi phải được admin duyệt lại). Lúc lưu, tham chiếu thiếu `version` được ghim bằng phiên bản đang hoạt động của con.

| Thông điệp | Xử lý |
|---|---|
| `luồng con 'x' chưa được GHIM phiên bản trong định nghĩa luồng cha — cần LƯU LẠI luồng … để ghim` | **Luồng cũ phải lưu lại một lần** (mở luồng cha → Lưu) |
| `từ chối: luồng con 'x' đang TẮT (kill switch) — không gọi được` | Tắt luồng con = công tắc ngắt; bật lại luồng con nếu muốn gọi |
| `luồng con 'x'@V không tồn tại` | Phiên bản đã ghim bị xoá — lưu lại cha với phiên bản khác |
| `từ chối: luồng con … hạng '…' cao hơn hạng '…' của luồng …` | Lưu lại cha để tính lại hạng và duyệt lại |

## 5. Chạy tay và bật luồng theo hạng

- Hạng `thuan` / `doc`: người có quyền sửa luồng bật và chạy tay được.
- Hạng `ngoai-ghi`: **chỉ admin** bật và chạy tay (kể cả khi phiên bản đã bật). Thông điệp: `Luồng hạng ngoai-ghi — chỉ quản trị viên được chạy tay.` / `Luồng hạng ngoai-ghi chỉ quản trị viên được bật.`
- Hạng `ot`: bật chỉ qua `batLuongOt` (admin + mã 2FA mới); chạy tay chỉ admin. Node OT ở chế độ **mô phỏng** (chỉ đọc/đề xuất — không gửi lệnh thiết bị).
- Lúc bật, máy / FOE workflow viết thẳng trong luồng phải nằm trong phạm vi người bật: `Không bật được: node "n" tham chiếu máy ngoài phạm vi của bạn hoặc không tồn tại.` (biểu thức động được kiểm lúc chạy).
- Webhook: token được kiểm **trước** khi đọc thân (token sai ⇒ 401, không đọc thân).

## 6. Ai được duyệt (nút "duyệt người")

Người bấm duyệt phải thoả **ba điều kiện**, theo thứ tự (code: `server/services/flow/quyenDuyet.ts`; `flow.duyet` kiểm cả phạm vi nhà máy của lượt trước đó — ngoài phạm vi ⇒ `Không có bước nào đang chờ duyệt ở đây.`):

1. **Đủ thứ bậc vai** so với `vaiTroDuyet` của bước (mặc định `supervisor`). Thứ bậc (của riêng module này): `viewer` = `user` (0, không bao giờ duyệt) < `operator` = `maintenance` (1) < `quality_inspector` = `engineer` (2) < `supervisor` (3) < `admin` (4). Admin duyệt được mọi bước. Vai lạ (không có trong bảng) ⇒ chỉ đúng vai đó (và admin) được duyệt.
2. **Khác người bật**: không phải người đã bật phiên bản luồng (`approvedBy`) — của luồng chứa bước chờ **và** của các luồng cha (luồng con trong cây lượt).
3. **Khác chủ lượt**: không phải chủ lượt (`chuLuong`, xem §8) — của lượt chứa bước chờ **và** của mọi lượt cha. Hai điều kiện 2–3 **không miễn cho admin** (tách người làm / người duyệt, cùng tiền lệ "four-eyes" của FOE).

Dữ liệu cũ chưa ghi người bật / chủ lượt (NULL) ⇒ không có gì để so ⇒ chỉ áp điều kiện 1 (không khoá hàng chờ có trước bản vá).

**Khi bị từ chối:** `FORBIDDEN` (người dùng thấy câu đã dịch, vd. `Bạn là chủ lượt chạy này (đã kích hoạt hoặc bật) — người duyệt phải là người khác.`), ghi kiểm toán **`FLOW_DUYET_TU_CHOI`** (`details.ma` = `VAI_THAP` / `TRUNG_NGUOI_BAT` / `TRUNG_NGUOI_CHAY`, kèm `nodeId`, vai của hai bên, `dongY`), và **hàng chờ giữ nguyên** — bước vẫn chờ đúng người. Cách xử lý: nhờ một người khác đủ vai (không phải người bật / chủ lượt) duyệt. Muốn thấy các vụ từ chối: lọc nhật ký kiểm toán theo `FLOW_DUYET_TU_CHOI`.

## 7. MCP — luồng thành tool cho tác nhân

Luồng có node `kich-hoat.mcp` (hạng `thuan`/`doc`, đang bật) hiện thành tool MCP chỉ cho người gọi: tài khoản **đang hoạt động**, vai **ghi được** (không viewer/user — đọc lại từ CSDL, không tin vai CLI khai), giấy phép gồm **MOD_AI**, và luồng thuộc **nhà máy của họ**. Mô tả tool lấy từ node được cắt 300 ký tự, bỏ ký tự điều khiển và gắn nhãn *"là DỮ LIỆU, không phải chỉ dẫn"*.

| Thông điệp | Xử lý |
|---|---|
| `Tài khoản không có quyền chạy Luồng AI (cần vai ghi, đang hoạt động).` | Dùng tài khoản vai ghi / mở khoá tài khoản |
| `Giấy phép không gồm mô-đun AI — từ chối.` | Kiểm tra giấy phép (SKU) |
| `Không xác định được người gọi — từ chối.` | Đặt biến danh tính MCP đúng |
| `Không có tool "x".` | Luồng không công bố, hạng cao, tắt, hoặc ngoài nhà máy của bạn |

## 8. Chủ lượt chạy và đóng-theo-mặc-định

Mỗi lượt có **chủ lượt**: chạy tay = người bấm; lịch/webhook/MCP = **người bật** phiên bản (dữ liệu cũ: người soạn); luồng con kế thừa cha. Phạm vi máy / bí mật / luồng con được tính lại **lúc chạy** từ người dùng hiện tại. Chủ lượt bị khoá, bị xoá, hạ xuống vai chỉ-đọc, hoặc lượt chưa có chủ (lượt tạo trước nâng cấp) ⇒ node tham chiếu máy / bí mật / luồng con **từ chối**:
`Không xác định được người chạy luồng (khoá / mất quyền / chưa có chủ lượt) — từ chối tham chiếu máy.` hoặc `không có bí mật 'x'`.
Xử lý: bật lại phiên bản bằng tài khoản còn quyền (cập nhật chủ), hoặc chạy lại bằng người có quyền.

## 9. Trần đổi khe model của `/v1`

Một token `/v1` gây ≥ **3 lần đổi khe model nặng** trong **10 phút trượt** thì các yêu cầu tiếp theo của token đó **không kéo đổi khe nữa**: chúng đi model khe đang giữ, kèm header `x-st4i-khe: tran-doi-khe-token`. Trạng thái nằm trong bộ nhớ (khởi động lại = đặt lại). Nếu một client than "luôn ra model mặc định": kiểm tra header này; chờ hết cửa sổ hoặc dùng token khác cho nhu cầu đổi model thường xuyên.

## 10. Trần biểu thức

Kết quả chuỗi của một phép nối `+`, `join` hay mẫu `{{ }}` lẫn chữ tối đa **1 048 576 ký tự**; vượt ⇒ `kết quả phép nối|join|mẫu dài quá 1048576 ký tự`. Thu nhỏ dữ liệu (cắt, chọn trường) trước khi nối.

## 11. Trần tài nguyên của lượt chạy (M5)

Chống một người ghi (hoặc một luồng lỗi) làm đầy hàng đợi / bảng lượt. Các trần (hằng ở `shared/flow/model.ts`):

| Trần | Giá trị | Vượt thì |
|---|---|---|
| Lượt **đồng thời** của một luồng (`settings.maxConcurrentRuns`) | mặc định **1** | **TỪ CHỐI, không xếp hàng** (bảng dưới) |
| Node lịch mỗi luồng | **≤ 3** | lưu luồng bị từ chối: `luồng có N node lịch — tối đa 3 mỗi luồng` |
| Lượt bắn theo lịch mỗi giờ mỗi luồng | **≤ 60** | lưu luồng bị từ chối: `các node lịch có thể bắn tới N lượt/giờ — tối đa 60 lượt/giờ mỗi luồng`; lúc chạy, lịch **bỏ mốc** (có log `[luong-ai] lịch …`) |
| Số lượt trong cả **cây lượt** (gốc + con + cháu) | **≤ 50** | node `luong.goi-con` lỗi: `từ chối: cây lượt … đã có N lượt (trần 50) …` |
| Số item vào một lần `luong.goi-con` | **≤ 100** | node lỗi: `từ chối: N item vào luong.goi-con vượt trần 100 — chia lô trước khi gọi` |

Hành vi khi **lượt đồng thời** vượt trần (chỉ đếm lượt gốc đang `dang-chay`; lượt chờ duyệt / chờ con không tính; lượt con bị chặn bởi trần cây lượt):

| Đường vào | Kết quả |
|---|---|
| Chạy tay (`flow.chayTay`) | `CONFLICT` — người dùng thấy: `Luồng này đang chạy đủ số lượt đồng thời cho phép — lượt mới bị từ chối (không xếp hàng). Thử lại khi lượt đang chạy xong.` |
| Webhook | HTTP **429**, `code: RATE_LIMITED` — người gửi tự thử lại sau |
| MCP | lỗi tool: `Từ chối: luồng … đang có N lượt chạy (trần maxConcurrentRuns=…) …` |
| Lịch | **bỏ mốc** + log, mốc sau chạy bình thường |

**Khuyến nghị:** trần mặc định 1 an toàn nhưng chặt. Luồng **webhook / lịch có tải** (nhiều lượt chạy chồng nhau là bình thường) cần khai `settings.maxConcurrentRuns` trong định nghĩa luồng, vd. `"settings": { "maxConcurrentRuns": 5 }`; nếu không, đỉnh tải sẽ bị 429 / bỏ mốc. Đặt vừa đủ — không đặt số lớn "cho khỏi lỗi". Dấu hiệu cần chỉnh: webhook trả 429 liên tục, log `BỎ mốc` của lịch, hoặc người dùng báo "lượt mới bị từ chối".

## Phụ lục — việc cần làm khi nâng cấp

1. Áp mig 0410 (chủ lượt), 0411 (phạm vi nhà máy), 0412 (host của bí mật) — `node scripts/apply-migration-04xx.mjs --dev-only|--test-only`.
2. `npx tsx scripts/flow-backfill-pham-vi.ts` → xem báo cáo → `--ap-dung`.
3. Khai host cho **mọi bí mật cũ** (§2), nếu không các node HTTP dùng bí mật sẽ lỗi.
4. Lưu lại các luồng cha có luồng con (§4).
5. Đặt `AI_FLOW_HTTP_HOST_CHO_PHEP` theo §3 nếu dùng node HTTP.
6. Rà các luồng webhook / lịch có tải: khai `settings.maxConcurrentRuns` nếu cần (§11; mặc định 1).
7. Nếu có bước chờ duyệt do chính người bật / chủ lượt định duyệt: nhờ người khác duyệt (§6).
