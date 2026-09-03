# Khối C — bàn giao và đối chiếu (tiếp quản từ phiên song song)

**2026-09-03.** Chủ dự án quyết định **dừng phiên song song** và để phiên này tiếp quản Khối C theo **ba quyết định đã chốt**.

---

## 1. Vì sao bàn giao — chi phí đã hiện ra bằng số

Hai phiên ghi cùng nhánh `feat/hmi-dep` đã tạo ra **hai thiệt hại đo được**:

1. **Suýt mất công việc.** Người làm BG-97 phải dựng bản chỉ-của-mình rồi nạp **thẳng vào index** để không commit byte của phiên kia; trong hai lượt đột biến họ `cp` đè hai tệp router — **nếu phiên kia ghi vào cửa sổ vài giây đó thì đã mất**. (Tôi đã kiểm: **không mất gì** — `getTimezoneOffset` = 0 ở HEAD, `mocDoTuChuoi` còn ở 3 tệp.)
2. **Trùng lặp công việc.** `c98781db` (BG-97, **18:58**) và **Task 4 + Task 5** của kế hoạch phiên kia giải **cùng một bài**: giải giới hạn tại neo cho v2 + nối ba đường ghi. Task 1 của họ commit lúc **19:02** — sau đó 4 phút.

---

## 2. Trạng thái thật — cái gì đã xong

| Việc | Commit | Ai làm |
|---|---|---|
| BG-97 — v2 chấm theo giới hạn **lúc bo được đo**, cả 3 đường | `c98781db` | phiên này |
| Khối C Task 1 — bỏ dịch fake-UTC ở mọi đường ghi + dedup | `aedd3096` | phiên song song |
| Task 2 (+2 lượt vá) — ba ổ đọc → giờ-tường-nhà-máy | `86b0e889` `118d5322` `db10d08f` | phiên song song |
| Task 3 (+vá review) — census cấm fake-UTC tái sinh, dọn dữ liệu lệch TZ | `2f37e9d2` `dce8e97d` | phiên song song |

⚠ **BG-96 chưa đóng theo bất biến** — xem **BG-99** (`02c6cfec`): census của họ chặn khuôn `/getTimezoneOffset\(\)\s*\*\s*60000/`, nhưng `new Date(chuỗi trần)` tái tạo **đúng 7 giờ** sai số bằng đường ngầm. Đo trên máy này (`Asia/Bangkok`, −420): **lệch 420 phút**, cùng một chuỗi, hai luật đọc, **trong cùng một request** (`aoiPackageRouter.ts` dòng 1282 vs 1344).

---

## 3. Ba quyết định của chủ dự án, đối chiếu với thiết kế phiên kia

| Quyết định | Thiết kế phiên kia | Kết luận |
|---|---|---|
| **Kỹ sư dạy giới hạn trên hệ** | QĐ-3/5 — `pointLimitSpec.ts` một nguồn 18 cột · `measurementPoint.update` + `setLimitsBatch` | **KHỚP** — giữ nguyên |
| **Dialog chỉ trường đang dùng** | QĐ-3 mở `touchesLimits` đủ **18 cột** | **KHÔNG XUNG ĐỘT** — hai tầng khác nhau: `touchesLimits` (máy chủ: sửa cột nào thì phải qua hàng đợi duyệt) **phải** đủ 18; **dialog** (kỹ sư nhìn) chỉ phơi trường đang dùng. Đo trên 3.252 điểm: **14 cột chưa bao giờ dùng** (`tolPlus`/`tolMinus`, `area*`, `volume*`, `coplanarity`, `warpage`, `voidPct`, `offsetX/Y`, `tilt`, `thickness*`) |
| **Bảng chính, canvas trong dialog** | QĐ-4 — tab thứ 6 "Cây dạy" + bảng component + dialog; **không** nối `MeasurementPointCanvas` vào dialog | **LỆCH MỘT PHẦN** — xem §4 |

---

## 4. Chỗ lệch duy nhất, và phán quyết

Yêu cầu gốc của chủ dự án là *"làm lại UI quản lý sản phẩm dạng bảng + dialog"*. QĐ-4 của phiên kia **cố ý loại** hướng đó:

> *Bị loại: (a) viết lại cả trang thành bảng+dialog một lượt — 3.546 dòng, ~30 mutation, đứt gãy lớn người dùng nhìn thấy, không phục vụ mục tiêu giới hạn.*

**Lập luận đó đúng về kỹ thuật.** `ProductModels.tsx` đã có toolbar gom 10→3 (doc 43), 14 dialog, `productColumnSpec`, 0 chuỗi Việt trần, và một MSA wizard ~500 dòng đang chạy. Viết lại một lượt là rủi ro cao cho giá trị thấp.

**Ruling R-KC-1:** giữ hướng **theo giai đoạn** của phiên kia (tab "Cây dạy" + tách shell mức vừa), **và bổ sung** đúng phần còn thiếu so với quyết định của chủ dự án: **nối `MeasurementPointCanvas` vào dialog linh kiện** để xem vị trí ROI khi dạy giới hạn.

⇒ Bảng là màn chính để lọc/sắp/dạy hàng loạt; dialog chứa canvas để thấy **điểm này nằm đâu trên ảnh**. Thoả cả ba quyết định, **không** phải viết lại 3.546 dòng.
*Giá nếu sai:* trang `/products` vẫn giữ hình dạng cũ ở 5 tab kia — đổi sau được, không đứt gãy. *Giá của hướng big-bang:* ~30 mutation và một đợt hồi quy người dùng nhìn thấy, **không** phục vụ mục tiêu giới hạn.

---

## 5. Việc còn lại — đã đối chiếu để không làm trùng

| Task (kế hoạch phiên kia) | Trạng thái sau đối chiếu |
|---|---|
| Task 4 — batch loader lịch sử giới hạn | ⚠ **ĐO LẠI** — `c98781db` đã nạp snapshot cả bo trong **một** `SELECT`. Còn giá trị nếu tách hàm dùng chung; **đừng làm lại từ đầu**. |
| Task 5 — giải giới-hạn-tại-neo v2 + 3 đường | ⚠ **PHẦN LỚN ĐÃ XONG** ở `c98781db`. Còn lại: **bộ đếm basis**. |
| Task 6 — hợp nhất merge variant-patch (v1) + khai rõ v2-BASE | **CÒN** — và `c98781db` đã đo: variant override **không khoá được** ở v2 (`machineDataContractV2` **0 trường** `variantCode`; `variant_point_overrides` **0 hàng** cả hai DB) ⇒ chỉ khai rõ + cầu chì, **đừng viết mã chết**. |
| Task 7 — `shared/pointLimitSpec.ts` một nguồn 18 cột + census | **CÒN** — giữ nguyên, đây là món chống lỗ "một chiều giới hạn không bao giờ được chấm". |
| Task 8 — `touchesLimits` suy từ spec + `setLimitsBatch` | **CÒN** |
| Task 9 — `cayDayRouter` 4 procedure đọc | **CÒN** |
| Task 10 — tab "Cây dạy" (đọc) | **CÒN** |
| Task 11 — dialog dạy giới hạn (đơn + hàng loạt) | **CÒN** + **bổ sung canvas** theo R-KC-1 |
| Task 12 — readiness đếm hàng cây + nghiệm thu ảnh | **CÒN** |
| Task 13 — BG-98 "máy tự mâu thuẫn" | **CÒN** — độc lập, làm được ngay, không cần bản dạy |
| Task 14 — tách shell `ProductListPanel` + `ProductDialogsHost` | **CÒN** |
| **BG-99** (mới) — bất biến "chuỗi trần đọc bằng đúng MỘT luật" | **CÒN** — chèn **trước** Task 9, vì nó đụng cùng tệp router |

⚠ **Cổng snapshot v2 mặc định TẮT.** Ngày dialog dạy giới hạn lên, **phải bật cờ**, không thì v2 vẫn hạ oan — mệnh đề 7B của `c98781db` đo đúng điều đó.
