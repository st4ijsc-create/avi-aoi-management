# BẢNG V3 — QA lần 11, VÒNG 3: đo SỐNG hai bản vá H1 + H5 trên bản dựng thật

**Ngày** 2026-09-15 · **Máy đo** Playwright chromium `--use-angle=default --enable-gpu --ignore-gpu-blocklist`,
**1 worker tuần tự**, viewport 1600×900, chờ cảnh bằng tín hiệu (`__thongKeVe.calls`, `__demTuongTac.dsMay()`,
khung nhìn đứng yên 3 nhịp) — **không một `waitForTimeout` cố định nào trong đường phán quyết**.

**Môi trường (không dựng lại, không bật/tắt gì)**
* server đo `http://localhost:3064` **PID 29128**, bundle **`assets/index-CF-6v5eP.js`**, cây `.qa-tapdoan/dist-sauva2`
  (`BUILD-INFO.txt`: `commit=f94c95ff+5va`, built 2026-09-15T16:16:41+07:00).
* nhịp heartbeat 45 s chạy nền suốt lượt đo — **KHÔNG tắt**. Không chạm 3000/8080. Không git. Không sửa `.env`.
  Không sửa mã sản phẩm. Không gọi `twinCanh.sinhTuDong`.
* ghi mới CHỈ trong `.qa-tapdoan/`: `do-vong3.mjs`, `db-V3.mjs`, `db-V3-don.mjs`, `tho/V3/*`, `anh/V3-*.png`,
  `BANG-V3.md`, `V3-XONG.txt`.

**Mốc dữ liệu (tự SELECT, `tho/V3/db-V3.json`)**
QATD-A **41** · QATD-B **42** · QATD-C **43**; toà A 65/66/67/68. Studio của `qatd_kythuat` mở mặc định ở
nhà máy **41 / toà 65 / tầng 165** (cấp 1, **45** máy đã xếp chỗ); tầng đối chiếu **166** (cấp 2, **40** máy).
`twin_dat_cho` lúc bắt đầu: **2.420 hàng toàn hệ · 2.338 hàng QATD · 0 hàng `daKhoa=true`**.

---

## Bảng 12 ô

| Ca | Kỳ vọng | Số đo | Phán quyết | Vì sao |
|---|---|---|---|---|
| **L1** đổi TẦNG khi còn thay đổi chưa lưu | hộp thoại hiện · đếm chưa về 0 · tầng chưa đổi | `hop-thoai-chua-luu` **co=1**, đủ 3 nút (`nut-luu-roi-doi`/`nut-bo-thay-doi`/`nut-huy-doi` = 1/1/1); `dem-chua-luu` = **1** ("1 unsaved changes"); `chon-tang` vẫn **165**; cảnh vẫn **45** khối | **ĐẠT** | Cách tạo thay đổi: **bấm TÂM khối máy 5333 trên cảnh rồi lật `cong-tac-khoa`** (đổi `daKhoa`, chưa ghi DB) — đúng cách vòng 2 dùng, vẫn còn dùng được. Vòng 2: đếm về **0**, **0 hộp thoại**, mất im lặng. |
| **L2** bấm `nut-huy-doi` | ở lại tầng cũ, thay đổi còn nguyên | hộp thoại **đóng** (co=0); `chon-tang` = **165**; `dem-chua-luu` = **1**; cảnh **45** khối | **ĐẠT** | Mặc định an toàn: Esc/bấm ra ngoài cũng về nhánh HUỶ (đọc từ mã; ở đây đo nhánh bấm nút). |
| **L3** bấm `nut-bo-thay-doi` | đổi tầng, thay đổi mất (người dùng đã chọn) | `chon-tang` = **166**; `dem-chua-luu` = **0**; cảnh **40** khối = số DB của tầng 166; **DB: máy 5333 `daKhoa` vẫn `false`, `updatedAt` vẫn `07:50:39` (giờ sinh dữ liệu)** | **ĐẠT** | Bỏ là bỏ THẬT — không có lượt ghi lén nào. Đây cũng là **đối chứng ÂM của phép đo DB**: cùng câu SELECT ấy ở L4 trả `true`. |
| **L4** bấm `nut-luu-roi-doi` ★ | **lưu vào ĐÚNG TẦNG CŨ** rồi mới đổi | sửa máy **5387** khi đang ở **tầng 166**, rồi xin đổi sang **165**. DB trước: `tangId=166, daKhoa=false, nguon=sinh`. DB sau: **`tangId=166`** (KHÔNG phải 165), `daKhoa=**true**`, `nguon=tay`, `viTri` 44570/34000/6000 **không đổi**. Một lượt `POST twinCanh.luuHangLoat` **200**. Rồi `chon-tang` → **165**, `dem-chua-luu` → **0**, hộp thoại đóng. Số hàng **2.420/2.338 không đổi** (cập nhật, không chèn); số hàng khoá 0 → **1** (đúng một hàng) | **ĐẠT** | **Ca quan trọng nhất và nó sạch**: lượt ghi mang `tangId` của tầng ĐANG SỬA, không phải tầng đích. Bản vá không nguy hiểm hơn lỗi nó vá. |
| **L5** đổi TOÀ và đổi NHÀ MÁY | cũng phải qua cổng | đổi **toà** 65→66: `hop-thoai` **1**, `chon-toa-nha` vẫn **65**. Đổi **nhà máy** 41→42: `hop-thoai` **1**, `chon-nha-may` vẫn **41**. Sau hai lượt huỷ: đứng nguyên 41/65/165, `dem-chua-luu` vẫn **1** | **ĐẠT** | Ô nhà máy có thật 2 mục (`41:Công ty A`, `42:Công ty B`) và ô toà 4 mục ⇒ tập **không rỗng**, phép đo có chỗ để sai. Cổng `xinDoiNap` gác cả **ba** lối, không chỉ ô tầng. |
| **L6** không có thay đổi nào | đổi tầng mượt, KHÔNG hỏi | `dem-chua-luu` = **0** lúc bắt đầu; đổi 165→166 ⇒ kết cục **`doi-that`**, hộp thoại **0**, cảnh **40** khối = số DB | **ĐẠT** | **Đối chứng ÂM của bộ dò hộp thoại**: cùng bộ dò ấy ở L1/L5 kêu, ở đây im ⇒ nó không phải cái chuông kêu-mãi. |
| **L7** auto-fit ở lượt mount đầu | gần bằng mức sau khi bấm Fit (19,72 %) | không chạm gì: bbox tâm khối **337×183** trên canvas **726×431** = **19,72 %**; 45/45 khối trong khung | **ĐẠT** | Vòng 2 cùng viewport, cùng canvas 726×431, cùng tầng 165, cùng 45 máy: **182×81 = 4,74 %**. Nay **19,72 %** — đúng bằng mức sau-Fit của vòng 2. |
| **L8** đối chứng bấm Fit | tỉ lệ **không** đổi đáng kể | sau khi bấm `nut-fit-tat-ca`: **337×183 = 19,72 %**; lệch **0 px / 0 px**, lệch tương đối **0,0000** | **ĐẠT** | Nút Fit là một **no-op** ⇒ auto-fit đã fit sẵn. Nếu nó nhảy vọt thì auto-fit chưa chạy (đúng thứ vòng 2 thấy). |
| **L9** người dùng xoay camera trước khi cảnh dựng xong | auto-fit **không cướp** camera | dựng bằng cách **làm chậm riêng truy vấn `canhThietKe` 3,5 s** (page.route, không sửa mã sản phẩm): lúc kéo chuột có **0 khối máy**; kéo 408×−168 px; dữ liệu về ⇒ khung **173×25 = 1,37 %** (KHÁC khung fit); bấm Fit sau đó ⇒ **337×183 = 19,71 %** ≈ L7 | **ĐẠT** | Auto-fit **nhường** camera, và nút Fit vẫn dùng được. Cũng là **đối chứng ÂM của thước bbox**: cùng công thức ấy trả 1,37 % khi không có fit. |
| **L10** hồi quy V-05 (`qatd_quanly`, 0 canCreate) | không thấy `nut-mo-sinh` và nút tạo toà nhà | `nut-mo-sinh` **0 phần tử DOM**, `tab-con-duong-b` **0 phần tử** (ẨN, không disable), 0 chữ "Generate" trên màn; **đối chứng DƯƠNG: `nut-luu` vẫn = 1** (canEdit) | **ĐẠT** | V-05 giữ; bản vá H1/H5 không nới hàng rào quyền, cũng không vá quá tay. |
| **L11** RB-4 | `__soCanvas` = 1 sau khi đổi tầng | `__soCanvas` = **1**; màn Studio có đúng **1** `<canvas>` trong DOM | **ĐẠT** | Cổng `xinDoiNap` chen vào giữa lượt đổi tầng nhưng không sinh Canvas thứ hai. |
| **L12** 5 khoá i18n mới | en đúng chữ · vi/zh không lộ khoá thô, en/zh không lộ dấu tiếng Việt | **en** (`html lang=en`): "Unsaved changes" · "1 change(s) on this floor will be LOST if you switch. Save them first?" · "Save and switch" / "Discard changes" / "Stay on this floor" — khoá thô **false**, dấu Việt **false**, `{{n}}` **đã thay bằng 1**. **vi**: "Còn thay đổi chưa lưu"… khoá thô **false**. **zh**: "有未保存的更改" · "保存并切换"/"放弃更改"/"留在本楼层" — khoá thô **false**, dấu Việt **false** | **ĐẠT** | `fallbackLng='vi'` ⇒ khoá thiếu sẽ lộ **tiếng Việt** chứ không lộ khoá thô; nên phép đo bắt CẢ HAI. Bộ dò dấu Việt kêu đúng ở **vi** (`coDauViet=true`) và im ở en/zh ⇒ nó biết kêu. |

**TỔNG: ĐẠT 12 · SAI 0 · HỎNG 0 · CHẶN-ĐÚNG 0 · N/A 0 — ô không có phán quyết: 0**

---

## H1 và H5 có đóng thật trên màn sống không

* **H1 — ĐÓNG.** Sáu ca L1–L6 đo trên bản dựng thật: cổng hiện ra đúng lúc (L1), giữ nguyên việc khi huỷ (L2),
  bỏ thật khi người dùng chọn bỏ (L3, có DB xác nhận không ghi lén), **ghi vào đúng tầng cũ khi chọn "Lưu rồi
  chuyển" (L4, có DB xác nhận `tangId=166` chứ không phải 165)**, gác cả ba ô chứ không riêng ô tầng (L5), và
  **không làm phiền khi không có gì để mất** (L6). Lớp lỗi "mất im lặng" của V-08 không tái hiện được nữa.
* **H5 — ĐÓNG.** Auto-fit chạy ngay ở lượt mount đầu: **4,74 % → 19,72 %** (cùng viewport, cùng canvas
  726×431, cùng tầng, cùng 45 máy), và bấm Fit sau đó **không đổi một pixel nào** (L8). Điều kiện "không cướp
  camera" mà docblock hứa cũng đúng trên màn sống (L9).

## Bằng chứng DB của L4 (ca quan trọng nhất)

```
máy 5387 · đang sửa ở TẦNG 166 · xin đổi sang TẦNG 165
trước:  tangId=166  daKhoa=false  nguon=sinh  updatedAt=2026-09-15T07:50:39.046Z
sau:    tangId=166  daKhoa=true   nguon=tay   updatedAt=2026-09-15T09:36:50.573Z
        viTriXMm=44570.000  viTriYMm=34000.000  viTriZMm=6000.000  (không đổi)
mạng:   POST /api/trpc/twinCanh.luuHangLoat?batch=1 → 200 {daGhi:1, daTao:0, daCapNhat:1}
đếm:    2420/2338 hàng KHÔNG đổi · hàng daKhoa 0 → 1 (đúng một hàng, đúng hàng vừa sửa)
```

`tangId` **ở nguyên 166** — tầng ĐANG SỬA — trong khi giao diện đã sang 165. Đây là điều phải đúng, và nó đúng.

## Dọn hàng tạm

| Mốc | `twin_dat_cho` toàn hệ | hàng QATD | hàng QATD `daKhoa=true` |
|---|---|---|---|
| trước lượt đo | 2.420 | 2.338 | **0** |
| sau L4 (đã ghi) | 2.420 | 2.338 | **1** |
| sau khi dọn | **2.420** | **2.338** | **0** |

Dọn bằng **đường sản phẩm** (`POST twinCanh.luuHangLoat` với đúng giá trị gốc đã chụp trước khi ghi), không bằng
SQL tay; mọi truy vấn DB của lượt đo là **CHỈ SELECT**. Kiểm lại (`tho/V3/don-cuoi.json`): máy 5387 về
`tangId=166, daKhoa=false, nguon=sinh`, toạ độ **khớp từng chữ số**; toàn hệ **0 hàng `daKhoa=true`**.
Vết duy nhất còn lại: cột `updatedAt` của đúng một hàng (12386) mang giờ lượt đo thay vì giờ sinh dữ liệu —
`luuHangLoat` luôn đặt `updatedAt`, không có đường ghi nào giữ lại giá trị cũ.
Máy 5333 (dùng ở L1/L2/L3/L5) **chưa bao giờ bị ghi**: `updatedAt` vẫn là 07:50:39 của lượt sinh dữ liệu.

## Nhận xét thị giác (tự chụp, tự đọc)

* `V3-L7-mount-dau-khong-cham-gi.png` — mở màn, chưa chạm gì: 45 khối máy xếp thành các hàng trên sàn lưới,
  nhìn rõ từng khối, cụm máy nằm gọn giữa khung 3D và chiếm khoảng **46 % chiều ngang / 42 % chiều dọc** khung
  nhìn. Không còn cảnh "sàn ở rất xa, máy co thành vệt mờ" của vòng 1/2. Mini-map có chấm khớp với cảnh.
* `V3-L8-sau-bam-fit.png` — **không phân biệt được với ảnh L7 bằng mắt**, khớp với số đo lệch 0 px.
* `V3-L1-hop-thoai-hien.png` — hộp thoại nổi giữa khung 3D: biểu tượng cảnh báo hổ phách, tiêu đề
  "Unsaved changes", câu "1 change(s) on this floor will be LOST if you switch. Save them first?", ba nút
  xếp trái→phải **Stay on this floor · Discard changes · Save and switch** (nút xanh "Save and switch" là nút
  mặc định, tức mặc định trực quan là **không mất gì**). Huy hiệu "1 unsaved changes" hiện cạnh nút Save ở
  header; ô Tầng vẫn đọc "Tầng 1"; công tắc **Lock** bên phải đang bật; máy vừa chọn được tô sáng trong cây.
* `V3-L9-nguoi-dung-xoay-truoc.png` — sau khi người dùng tự kéo: camera ở góc **rất tà**, sàn gần như nhìn
  nghiêng thành một dải, 45 khối máy chỉ còn một vệt mảnh gần đường chân trời. Đúng khung của **người dùng**,
  không phải khung fit ⇒ auto-fit đã nhường.
* `V3-L12-hop-thoai-zh.png` — giao diện Trung hoàn chỉnh (生产 / 3D 工厂 — 设计 / 数据健康度…), hộp thoại hiện
  "有未保存的更改" với ba nút 留在本楼层 · 放弃更改 · 保存并切换; chữ CJK dựng đủ nét, không ô vuông tofu.
  (Ảnh bắt đúng lúc hộp thoại đang mờ dần vào — nội dung đọc từ DOM, không từ pixel.)
* ⚠ **Không phải khuyết tật**: trong giao diện en/zh, ba ô chọn vẫn đọc "Công ty A / Toà 1 / Tầng 1" — đó là
  **tên trong DB** (`twin_toa_nha.ten`, `twin_tang.ten` do bộ sinh QATD đặt), không phải nhãn i18n.

## Phép đo của tôi có biết KÊU không (đối chứng âm trong CHÍNH lượt này)

| Bộ dò | Ca nó KÊU | Ca nó IM | ⇒ |
|---|---|---|---|
| hộp thoại `hop-thoai-chua-luu` | L1, L5 (toà), L5 (nhà máy), L3, L4, L12×3 | **L6** (`co=0`, kết cục `doi-that`) | không phải chuông kêu mãi |
| hàng DB bị ghi (`daKhoa`) | L4 (`false→true`) | **L3** (máy 5333 vẫn `false`) | biết phân biệt ghi/không ghi |
| tỉ lệ bbox khung nhìn | L7/L8 = 19,72 % | **L9** = 1,37 % | không bị ghim vào một con số |
| đếm phần tử DOM theo quyền | L10 `nut-mo-sinh`=0 | L10 `nut-luu`=1 | không phải "mọi thứ đều 0" |
| dò dấu tiếng Việt | **L12 vi** (`true`) | L12 en/zh (`false`) | biết kêu trên ca dương đã biết |

## Ghi lại cho lượt sau

* `<select>` của `BoChonNapUI` là **controlled** (`giaTri={props.tangId}`). Cổng chặn ⇒ React trả DOM value về
  giá trị cũ. Đọc ô ngay sau `selectOption` sẽ thấy **giá trị mới** trong một khoảnh khắc rồi mất — phải chờ
  phân định bằng `waitForFunction("hộp thoại hiện" || "ô đã đổi thật")`, đừng đọc thẳng.
* Chờ auto-fit bằng **"khung nhìn đứng yên 3 nhịp"** chứ không bằng đồng hồ: auto-fit là một lượt đổi camera
  CHẬM HƠN lượt dựng khối, đọc bbox ngay sau khi có khối sẽ bắt được khung TRƯỚC khi fit.
* `postgres.js`: `= any(${sql.array(ids)})` ném `op ANY/ALL (array) requires array on right side`; dạng chạy
  được là `in ${sql(ids)}`. Và **luôn `sql.end()` trong `finally`** — một lượt reject không đóng kết nối làm
  tiến trình treo tới hết hạn.

## ĐIỀU TÔI KHÔNG CHẮC

1. **Ablation của H5 là CHÉO BẢN DỰNG, không phải trong cùng phiên.** Con số đối chứng 4,74 % lấy từ sổ vòng 2
   (`tho/V2/H5.json`, cây `dist-sauva`), không phải từ một lượt chạy bản-chưa-vá trong chính phiên này — tôi
   không được bật server thứ hai để đo. Điều kiện so sánh trùng khít (viewport 1600×900, canvas 726×431, tầng
   165, 45 máy, cùng công thức bbox, cùng tài khoản), nên tôi tin, nhưng nó **không** mạnh bằng một ablation
   bật/tắt ngay trong phiên.
2. **L9 là một thứ tự do tôi ÉP RA.** Tôi làm chậm riêng truy vấn `canhThietKe` 3,5 s bằng `page.route` để dựng
   đúng cảnh "Canvas xong trước, dữ liệu về sau" mà docblock mô tả. Tôi **không** quan sát được thứ tự ấy xảy
   ra tự nhiên trên máy này (mạng nội bộ quá nhanh). Kết luận "không cướp camera" đúng cho thứ tự ấy; tôi
   không đo được xác suất nó xảy ra thật với người dùng.
3. **Thay đổi chưa lưu luôn là ĐÚNG MỘT và luôn cùng một loại** (lật `cong-tac-khoa` ⇒ `daKhoa`). Chưa đo:
   buffer **nhiều** hàng, thay đổi kiểu **kéo-dời** (đổi toạ độ — cùng đường ghi `luuHangLoat`, nhưng tôi không
   đo), và **nhánh ghi HỎNG** (`TwinStudio.tsx` `luuRoiDoi`: `if (!daGhiXong) return` — giữ hộp thoại, giữ tầng).
   Nhánh ấy là thứ giữ cho "Lưu rồi chuyển" không mất dữ liệu khi server từ chối, và nó **chưa có phép đo sống**.
4. **Chỉ đo một cặp tầng của một toà** (165 ↔ 166 của toà 65, nhà máy 41). L5 bấm huỷ ngay khi hộp thoại hiện,
   nên đường "bỏ thay đổi rồi đổi **nhà máy**" đi tới cùng (nạp lại toàn bộ cây toà/tầng của nhà máy khác)
   **chưa được đo**.
5. **Tôi không đo `updatedAt` như một bất biến.** Lượt ghi + lượt dọn để lại giờ mới trên đúng một hàng. Nếu có
   phép đo nào ở lượt sau dựa vào `updatedAt` của `twin_dat_cho` để suy "hàng này do người sinh dữ liệu đặt",
   hàng 12386 (máy 5387) sẽ nói dối với nó.
6. **Mọi ô đều ĐẠT** — điều này tự nó đáng nghi. Chỗ dựa của tôi là bảng đối chứng âm ở trên: mỗi bộ dò đều có
   ít nhất một ca KÊU và một ca IM **trong chính lượt này**. Nếu ai muốn bác bỏ, chỗ yếu nhất là mục 1 và 3.
