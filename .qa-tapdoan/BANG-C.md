# LÔ C — KẾT CỤC GỐC: "từ nhà máy chọn Line ⇒ Line 3D Twin · chọn máy (Cell) ⇒ Machine 3D Twin"

QA lần 11 (kịch bản tập đoàn) · HEAD `a147fc35` · bản dựng `.qa-tapdoan/dist-a147fc35` · server đo `http://localhost:3064` (PID 19136, KHÔNG bật/tắt) · viewport 1600×900 · vi.
Harness `.qa-tapdoan/do-C.mjs` (khuôn `.qa-dot52/k9-chon-line.mjs` + `.qa-dot52/k8.mjs` + động cơ fail-closed `.qa-dot59/do59.mjs`).
Kỳ vọng DB dựng RỜI bằng `.qa-tapdoan/db-C.mjs` (chỉ SELECT) → `.qa-tapdoan/tho/C/db-C.json`. Thô: `.qa-tapdoan/tho/C/*.json`. Ảnh: `.qa-tapdoan/anh/C-*.png`.

**Luật chấm.** L1 fail-closed: mỗi ca khai TÊN dữ kiện; thiếu ⇒ HỎNG kèm tên; tập rỗng ⇒ HỎNG không ĐẠT (G146). L2 đọc theo NGHĨA — mọi cột "dữ kiện" dưới đây là **chữ người dùng đọc được**, testid chỉ để tìm.

---

## 1. Bảng ca

| ca | vai | đề bài | dữ kiện đọc được | kết cục | phán quyết | vì sao |
|---|---|---|---|---|---|---|
| **C1.1** | `qatd_kythuat` | Trên `/twin`: chọn **Nhà máy "Công ty B"** → **Toà 1** → **Tầng 1** → bật **Cây phân cấp** → bung mũi tên → **bấm node `QATD-B-T1-X1-L1 — Line 1`** ⇒ `/twin/line/249` | DB: line 249 = `Line 1`, 15 trạm, 15 máy. Thấy: breadcrumb `Nhà máy › **Chuyền 249**`, góc phải `Máy 0 · Trạm 0 · WIP 0`, thân màn: **"Chuyền này chưa có máy nào trên bố cục — Chuyền có thể chưa được xếp chỗ trong Twin Studio, hoặc thuộc một nhà máy khác."**; `canvas` 0, `__soCanvas` 0, 0 nhãn máy, 0 ô trạm | URL đúng nhưng **Line 3D Twin RỖNG** | **SAI** | line 249 thuộc **QATD-B = nhà máy THỨ HAI** trong danh sách của vai; `TwinLine.tsx:355` lấy cứng `factories[0]` = "Công ty A" ⇒ hỏi `canhThietKe` sai nhà máy ⇒ 0 máy. Ảnh `C-C1-qatd_kythuat-line249.png` |
| **C1.2** | `qatd_kythuat` | *(đối chứng DƯƠNG cùng vai, cùng đường bấm)* Công ty **A** → Toà 1 → Tầng 1 → node `QATD-A-T1-X1-L1 — Line 1` ⇒ `/twin/line/217` | DB: `Line 1`, 12 trạm, 12 máy. Thấy: `Line 1`, `Máy 12 · Trạm 12 · WIP 62`, canvas 1, `__soCanvas` 1, **12 nhãn máy**, 12 ô trạm, dải chuyền 1 | Line 3D Twin đầy đủ | **ĐẠT** | cùng vai, cùng build, cùng server — chỉ khác nhà máy là phần tử **[0]** |
| **C1.3** | `qatd_congnhan` | Công ty **C** → Toà 1 → Tầng 1 → node `QATD-C-T1-X1-L1 — Line 1` ⇒ `/twin/line/284` | DB: `Line 1`, 8 trạm, 8 máy. Thấy: `Line 1`, `Máy 8 · Trạm 8 · WIP 47`, canvas 1, `__soCanvas` 1, **8 nhãn máy** (M01…M08), 8 ô trạm | Line 3D Twin đầy đủ | **ĐẠT** | công nhân chỉ có QATD-C ⇒ `factories[0]` **tình cờ đúng**, và line nằm ở **toà đầu** |
| **C1.4** | `qatd_congnhan` | Công ty C → **Toà 3** → Tầng 1 → node `QATD-C-T3-X1-L1 — Line 1` ⇒ `/twin/line/299` | DB: `Line 1`, 10 trạm, 10 máy. Thấy: tên/`Máy 10 · Trạm 10 · WIP 56` ĐÚNG, dải chuyền S01…S10 "1 máy" ĐÚNG, canvas 1 — **nhưng 0 nhãn máy, cảnh 3D trống trơn** | tiêu đề nói 10 máy, **cảnh vẽ 0 máy** | **SAI** | `TwinLine.tsx:375` lấy cứng `toaNha[0]` rồi chỉ hỏi đặt chỗ của các tầng **toà đầu**; line ở toà 3 ⇒ `datCho` rỗng. Ảnh `C-C1-qatd_congnhan-line299.png` |
| **C2.1** | `qatd_kythuat` | Mở thẳng `/twin/may/4568` (QATD-B, WAVE_SOLDER, running) | DB: `WAVE_SOLDER-01`, QATD-B toà T1 tầng 1, có 1 hàng `twin_dat_cho`. Thấy: breadcrumb `Nhà máy › **Máy #4568**`, thân màn **"Không mở được máy #4568 — Đối tượng này không thuộc phạm vi đang xem (hoặc không còn tồn tại). Hãy đổi nhà máy/tầng rồi mở lại."** (`data-ly-do="ngoaiPhamVi"`); 0 canvas, không `loai-may`, không `suc-khoe-may` | **KHÔNG có Machine 3D Twin** | **SAI** | máy 4568 **THUỘC** phạm vi của kỹ thuật (QATD-A + QATD-B). `TwinMay.tsx:273→284` `factories[0]` = "Công ty A" ⇒ máy của nhà máy thứ hai không lọt vào `idTrongTam` ⇒ `lyDoMoManMay` trả `ngoaiPhamVi`. Ảnh `C-C2-qatd_kythuat-may4568.png` |
| **C2.2** | `qatd_congnhan` | `/twin/may/4977` (QATD-C, FEEDER, running) | DB: `FEEDER-01`, FEEDER. Thấy: `FEEDER-01`, loại `FEEDER`, `khoi-canh-may` 1 canvas, `__soCanvas` 1, không "chưa đặt chỗ", `suc-khoe-may` = **"Sức khoẻ 86 % · theo dõi"** (hạng `theo_doi`) | Machine 3D Twin đầy đủ | **ĐẠT** | `factories[0]` = "Công ty C" (vai chỉ có 1 nhà máy) và máy ở **toà đầu** |
| **C2.3** | `qatd_kythuat` | *(đối chứng DƯƠNG)* `/twin/may/4197` (QATD-A, ICT, stopped) | `ICT-01`, loại `ICT`, canvas 1, `__soCanvas` 1, có hạng sức khoẻ | Machine 3D Twin đầy đủ | **ĐẠT** | cùng vai với C2.1, chỉ khác máy nằm ở nhà máy **[0]** |
| **C2.4** | `qatd_congnhan` | `/twin/may/5139` (QATD-C **toà T3**, SPI, running) | DB: `SPI-01`, **có 1 hàng `twin_dat_cho`**. Thấy: tên `SPI-01` đúng, nhưng thân màn **"Máy này chưa có chỗ trên bố cục 3D — Xếp chỗ trong Twin Studio để thấy máy giữa hàng xóm của nó."**; 0 canvas, `__soCanvas` 0, **mất `loai-may` và `suc-khoe-may`** | màn nói SAI SỰ THẬT về dữ liệu | **SAI** | máy CÓ chỗ trong DB; trang chỉ hỏi đặt chỗ của **toà [0]** (`TwinMay.tsx:297`) ⇒ khai "chưa có chỗ". Ảnh `C-C2-qatd_congnhan-may5139.png` |
| **C3** | `qatd_congnhan` | Trên `/twin?nm=40&toa=61&tang=137`, **bấm `page.mouse.click` vào TÂM KHỐI 5 máy khác nhau** (tâm đo LẠI ngay trước mỗi cú bấm, đối chiếu raycast `hitTai` = `twin3d-lo-may`) | 39 máy trong khung, **39/39 bấm được**; 5 cú: 4977→4977 · 4985→4985 · 4994→4994 · 5002→5002 · 5010→5010 | 5/5 tới đúng `/twin/may/<id>` | **ĐẠT** | nửa "chọn máy (Cell)" trên **cảnh nhà máy** hoạt động đúng. Ảnh `C-C3-qatd_congnhan-sau-bam-khoi-may4977.png` |
| **C4a** | `qatd_congnhan` | Mở `/twin/line/249` (QATD-B — **ngoài** phạm vi) ⇒ kỳ vọng `line-khong-mo-duoc` | Thấy `line-rong`, chữ **"Chuyền này chưa có máy nào trên bố cục — … hoặc thuộc một nhà máy khác."**; `line-khong-mo-duoc` = 0, `data-ly-do` không tồn tại | chặn nhưng **nói sai lý do** | **SAI** | `LyDoManLine` chỉ có 3 giá trị `mo \| chuaGanNhaMay \| thieuQuyen` (`manLine.ts:412`) — **không có `ngoaiPhamVi`**, khác hẳn màn Máy. Hệ quả: câu cho "không phải của bạn" **trùng từng chữ** với câu của lỗi C1.1 ⇒ người dùng không phân biệt được. Ảnh `C-C4-qatd_congnhan-line249-chan.png` |
| **C4b** | `qatd_congnhan` | Mở `/twin/may/4568` (ngoài phạm vi) | `may-khong-mo-duoc`, `data-ly-do="ngoaiPhamVi"`, câu "Đối tượng này không thuộc phạm vi đang xem (hoặc không còn tồn tại)…" — không xác nhận máy có thật | chặn đúng | **CHẶN-ĐÚNG** | màn Máy có nhánh L-5 đủ, và câu **không rò** sự tồn tại |
| **C4c** | `qatd_congnhan` | Tầng API với cookie của chính vai: `factoryCommand.machineDetail(4568)`, `machine.getById(4568)`, `twinCanh.danhSachToaNha(39)`, `canhThietKe(39)`, `factoryCommand.overview(39)`, `factory.getById(39)`, `line.list` | `machineDetail` → **NOT_FOUND** (không FORBIDDEN) · `machine.getById` → `null` · `danhSachToaNha(39)` → `[]` · `overview(39)` → 0 máy · `factory.getById(39)` → `null` · `line.list` 31 hàng, **không** chứa 249. **Đối chứng DƯƠNG** `qatd_kythuat` cùng lời gọi: `machineDetail` có dữ liệu, `danhSachToaNha(39)` = 4 toà | 7/7 đúng | **CHẶN-ĐÚNG** | "ngoài phạm vi = như không tồn tại", có đối chứng dương cùng thiết bị (G139) |
| **C5.1** | `qatd_kythuat` | `/twin?nm=39&toa=57&tang=109` (Công ty B) → **bấm khối máy trên cảnh** → `/twin/may/:id` → `ve-man-line` → `ve-man-nha-may` | Ô chọn nhà máy = **"Công ty B"**, `dem-may` = **409**, **63/63 máy bấm được**; bấm máy 4568 ⇒ `/twin/may/4568` **TỪ CHỐI**: "Không mở được máy #4568 — Đối tượng này không thuộc phạm vi đang xem…"; tên rơi về `Máy #4568`; **không có `ve-man-line`** ⇒ breadcrumb đứt. `href` của `ve-man-nha-may` VẪN đúng: `/twin?nm=39&toa=57&tang=109&…` | thấy và bấm được, màn đích chối | **SAI** | lớp "một lối vào rồi TỪ CHỐI" (G149). Quan trọng: `duongVe` **đã mang đúng `nm=39`** trong chính trang đó ⇒ id nhà máy đúng CÓ SẴN, trang vẫn dùng `factories[0]`. Ảnh `C-C5-qatd_kythuat-nm39-toa57-may4568.png` |
| **C5.2** | `qatd_congnhan` | *(đối chứng DƯƠNG)* `/twin?nm=40&toa=61&tang=137` → bấm khối máy → `ve-man-line` → `ve-man-nha-may` | máy 4977 ⇒ `/twin/may/4977` ⇒ `ve-man-line` ("Line 1") ⇒ `/twin/line/284` ⇒ `ve-man-nha-may` ⇒ `/twin` với ô chọn **nhà máy 40 · toà 61 · tầng 137** giữ nguyên | về đúng line và đúng nhà máy | **ĐẠT** | breadcrumb + `duongVe` giữ đúng phạm vi đang xem |
| **C5.3** | `qatd_congnhan` | Như trên nhưng **toà 3** (`nm=40&toa=63&tang=151`) | máy 5139 ⇒ `ve-man-line` ⇒ `/twin/line/299` ⇒ `ve-man-nha-may` ⇒ `/twin` giữ **nhà máy 40 · toà 63 · tầng 151** | điều hướng đúng | **ĐẠT** | *(ĐƯỜNG ĐI đúng; nội dung hai màn đích vẫn hỏng — xem C1.4 và C2.4)* |
| **C6** | — | Tìm line 0 máy; có ⇒ mở, kiểm `line-rong` trung thực | `select count(*) … where l."isActive" and 0 = (số máy isActive qua station)` ⇒ **0/102 line**. Line ít máy nhất toàn hệ: line 11 (T12-SHOT) 1 trạm/1 máy; 98 line QATD đều ≥ 8 máy | không dựng được ca | **N/A** | không có line 0 máy; dựng một cái đòi GHI vào DB, ngoài giới hạn "chỉ SELECT" của lô này. Truy vấn nguyên văn ở `tho/C/C6-line-rong.json` |
| **C7** | `qatd_kythuat` | `/twin/line/abc` và `/twin/may/999999` | `/twin/line/abc` → `line-id-khong-hop-le`: **"Không đọc được chuyền từ đường dẫn — Đường dẫn phải có dạng /twin/line/&lt;số&gt;. Hãy chọn một chuyền từ màn nhà máy."** · `/twin/may/999999` → `may-khong-mo-duoc` `ngoaiPhamVi`: "Không mở được máy #999999 — Đối tượng này không thuộc phạm vi đang xem (hoặc không còn tồn tại)…" · **0 lỗi JS**, không màn trắng (343 / 390 ký tự đọc được) | chặn sạch | **CHẶN-ĐÚNG** | id xấu và id không tồn tại đều có câu riêng, không crash |

**Dòng tổng (17 ca chính): ĐẠT 7 · SAI 6 · CHẶN-ĐÚNG 3 · HỎNG 0 · N/A 1.**
**Ô không có phán quyết: 0.**

---

## 2. Ablation — chứng minh nguyên nhân là `factories[0]`, không phải quyền/phạm vi

Biến độc lập: **phần tử [0] của `factory.list`** (server sắp theo `factories.name`, `server/db/hierarchy.ts:340`). Không ghi một hàng DB nào — chỉ đổi VAI đăng nhập.

`factory.list[0]` đo được qua API (`tho/C/AB-factory-list.json`):

| vai | phạm vi | `factory.list[0]` |
|---|---|---|
| `qatd_congnhan` | QATD-C | **40 QATD-C "Công ty C"** |
| `qatd_giamdoc` | A+B+C (gán tập đoàn) | 38 QATD-A "Công ty A" |
| `qatd_admin` | tất cả (bypass) | 38 QATD-A "Công ty A" |
| `qatd_kythuat` | A+B | 38 QATD-A "Công ty A" |

| ca ablation | kết cục | phán quyết |
|---|---|---|
| **CÙNG máy 4977** (QATD-C) · `qatd_giamdoc` | `may-khong-mo-duoc` `ngoaiPhamVi` — "Không mở được máy #4977…" | **SAI** |
| **CÙNG máy 4977** · `qatd_admin` (toàn quyền) | `may-khong-mo-duoc` `ngoaiPhamVi` | **SAI** |
| **CÙNG line 284** (QATD-C) · `qatd_giamdoc` | `line-rong`, `Máy 0 · Trạm 0`, tên rơi về "Chuyền 284", canvas 0 | **SAI** |
| *(mốc so)* máy 4977 · `qatd_congnhan` | mở đầy đủ, 1 canvas, hạng sức khoẻ | **ĐẠT** (C2.2) |
| *(mốc so)* line 284 · `qatd_congnhan` | 8 nhãn máy, 8 ô trạm | **ĐẠT** (C1.3) |

**Kết luận ablation:** giám đốc và admin có quyền **rộng hơn hẳn** công nhân, vẫn bị từ chối **đúng cái máy và đúng cái chuyền** mà công nhân mở được. Nguyên nhân không thể là quyền, không thể là phạm vi tenant, không thể là dữ liệu — chỉ còn **vị trí phần tử [0] trong `factory.list`**.

---

## 3. Mô hình dự đoán và bán kính ảnh hưởng

Mô hình rút từ mã: một line/máy hiển thị **đủ** chỉ khi `factory == factory.list[0]` **và** tầng của nó thuộc `danhSachToaNha(factory)[0]` (toà có `ma` nhỏ nhất). Ba mức:

* **VẼ ĐỦ** — đúng nhà máy [0] và đúng toà [0].
* **ĐẦU ĐÚNG · CẢNH RỖNG** — đúng nhà máy [0], sai toà ⇒ header đúng số, cảnh 0 khối máy (màn Máy: "chưa có chỗ trên bố cục").
* **TỪ CHỐI HẲN** — sai nhà máy ⇒ `line-rong` / `ngoaiPhamVi`.

Mô hình dự đoán **đúng 10/10** điểm đã đo (C1.1–C1.4, C2.1–C2.4, 3 ca ablation). Đếm rời từ DB (`.qa-tapdoan/pham-vi-hong.mjs`, chỉ SELECT):

| vai | trong phạm vi | VẼ ĐỦ | ĐẦU ĐÚNG · CẢNH RỖNG | TỪ CHỐI HẲN | % line hỏng |
|---|---|---|---|---|---|
| `qatd_kythuat` | 67 line / 780 máy | 7 line / 85 máy | 25 line / 286 máy | 35 line / 409 máy | **89,6 %** |
| `qatd_giamdoc` | 98 line / 1.108 máy | 7 / 85 | 25 / 286 | 66 / 737 | **92,9 %** |
| `qatd_admin` | 102 line / 1.150 máy | 7 / 85 | 25 / 286 | 70 / 779 | **93,1 %** |
| `qatd_congnhan` | 31 line / 328 máy | 7 / 71 | 24 / 257 | 0 / 0 | **77,4 %** |
| `qatd_quanly` | 32 line / 371 máy | 7 / 85 | 25 / 286 | 0 / 0 | **78,1 %** |

---

## 4. Mã nguồn — nguyên văn (đọc bằng `docMaNguon()`, CRLF đã chuẩn hoá — G150)

```
client/src/pages/TwinLine.tsx:355   const factoryId = factories[0]?.id ?? null;
client/src/pages/TwinMay.tsx:284    const factoryId = factories[0]?.id ?? null;
client/src/pages/TwinLine.tsx:375   ((toaNhaQ.data ?? []) as Array<…>)[0] ?? null      ← toà ĐẦU
client/src/pages/TwinMay.tsx:299    ((toaNhaQ.data ?? []) as Array<…>)[0] ?? null      ← toà ĐẦU
server/db/hierarchy.ts:340          …where(and(...dieuKien)).orderBy(factories.name);  ← thứ tự quyết định "[0]"
server/db/twinCanh.ts:260           …orderBy(asc(twinToaNha.ma));                      ← thứ tự quyết định "toà [0]"
client/…/van-hanh/manLine.ts:412    export type LyDoManLine = "mo" | "chuaGanNhaMay" | "thieuQuyen";  ← THIẾU "ngoaiPhamVi"
```

Cả hai chỗ `factories[0]` đều có **docblock tự khai giới hạn** ngay phía trên (`TwinLine.tsx:344-354`), viện lý do *"đo 2026-09-09: 2 nhà máy, toàn bộ 82 hàng `twin_dat_cho` nằm ở MỘT tầng — mọi chuyền đều thuộc nhà máy đầu"*. Dữ liệu tập đoàn của đợt này (3 công ty · 12 toà · 84 tầng · 1.150 hàng `twin_dat_cho` trải trên 24 tầng) làm **hết hạn** tiền đề ấy (lớp G148 "lý do hoãn có HẠN SỬ DỤNG").

---

## 5. Ảnh (≥6, tự chụp trong đợt)

| ảnh | nội dung |
|---|---|
| `anh/C-C1-qatd_kythuat-line249.png` | C1 line QATD-B — Line 3D Twin rỗng |
| `anh/C-C1-qatd_congnhan-line284.png` | C1 line QATD-C — Line 3D Twin đúng (8 khối máy M01…M08) |
| `anh/C-C1-qatd_congnhan-line299.png` | C1 line QATD-C toà 3 — "Máy 10" mà cảnh 0 khối |
| `anh/C-C1-qatd_kythuat-line217.png` | C1 đối chứng dương (12 khối máy) |
| `anh/C-C2-qatd_kythuat-may4568.png` | C2 máy 4568 — "Không mở được máy #4568" |
| `anh/C-C2-qatd_congnhan-may4977.png` | C2 máy 4977 — Machine 3D Twin đúng |
| `anh/C-C2-qatd_congnhan-may5139.png` | C2 máy 5139 — "chưa có chỗ trên bố cục" (DB có chỗ) |
| `anh/C-C3-qatd_congnhan-sau-bam-khoi-may4977.png` | C3 sau khi bấm tâm khối máy trên canvas |
| `anh/C-C4-qatd_congnhan-line249-chan.png` · `C-C4-qatd_congnhan-may4568-chan.png` | C4 chặn ngoài phạm vi |
| `anh/C-C5-qatd_congnhan-nm40-toa61-ve-man-nha-may.png` | C5 sau khi về màn nhà máy (giữ đúng nhà máy/toà/tầng) |
| `anh/C-C2-qatd_giamdoc-may4977.png` · `C-C2-qatd_admin-may4977.png` · `C-C1-qatd_giamdoc-line284.png` | ablation |
