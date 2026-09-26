# Doc 68 — Tái thiết kế THỊ GIÁC module "Tổng quan" + Navbar (CHỜ DUYỆT)

> **Ngày**: 2026-07-20 · **Bối cảnh**: sau khi thực thi doc 67 (8 wave chức năng/freshness/a11y/perf), user phản hồi cần **(1) đánh giá & cải tiến thiết kế thị giác từng màn** (bố cục · cân xứng · gọn gàng · mảng chính-phụ · card thuộc-tính → **fly-out panel phải** · typography) và **(2) navbar gọn gàng NHƯNG không giấu các dashboard tổng hợp** (đảo hướng W5).
> **Phương pháp**: 10 AI agent design-critique song song trên **screenshot LIVE mới** (capture sau doc 67, 3 viewport) + đọc JSX từng trang, dùng lăng kính frontend-design (ISA-101 HMI, persona operator panel-PC 10.1"/găng).
> **Trạng thái**: CHỜ USER DUYỆT phương án trước khi thực thi (đây là thay đổi BỐ CỤC, không chỉ token).

---

## §1. NĂM CHỦ ĐỀ THIẾT KẾ XUYÊN SUỐT (lặp trên gần như mọi màn)

1. **Thiếu vùng HERO / mảng chính** → mắt không neo được trong 5-10s. Mọi card/panel/KPI đồng-trọng-số; nội dung quan trọng nhất (cảnh báo đang mở, máy lỗi, rủi ro) bị xếp ngang hàng số đếm tầm thường hoặc bị chôn dưới widget nhiễu. **Giải:** thêm 1 dải/khối hero mỗi màn cho đúng "câu hỏi số 1" của persona.

2. **Card thuộc-tính/chi-tiết nên là ContextDrawer trượt PHẢI** (đúng ý user) — hiện đang là: modal che toàn màn (dashboard), Collapsible bung in-place đẩy layout (ops-console), hoặc **điều hướng rời trang** (command-center/drill-down/corporate). Primitive `client/src/components/workspace/ContextDrawer.tsx` (Sheet phải ~420px) đã có sẵn, gần như **0 màn nào dùng**. **Giải:** click node/máy/cảnh báo/dòng → drawer preview, giữ danh sách nền phía sau để so sánh liên tiếp; nút "mở đầy đủ" thành CTA bước-2 trong drawer.

3. **Ô/panel RỖNG-TRÙNG chiếm chỗ đắc địa**: KPI "OEE —"/"Năng lượng —" đứng đầu strip; panel "Insight AI rỗng" chiếm khối cao; donut/bar chart 1-2 điểm dữ liệu phình nửa card; số đếm trùng (Cao 77 = Đang mở 87 gần nhau; OK/NG/NTF hiện 2 lần). **Giải:** ô rỗng co lại/gộp/hạ muted; chart co theo mật độ dữ liệu; khử biểu diễn trùng.

4. **Chrome lặp làm loãng**: nhiều "Cập nhật 0s trước" (5 cái/màn ở control-tower & command-center), 2 nút "Làm mới", 2 chỉ báo live/poll mâu thuẫn thị giác, RelatedViews + persona-tab + freshness xếp chồng ở vùng đắt giá đầu trang. **Giải:** freshness per-panel chỉ hiện khi STALE (ẩn khi tươi); 1 nút refresh/trang; đẩy RelatedViews xuống chân trang hoặc thu gọn.

5. **Breakpoint 1280 (panel-PC = persona chính) bị bỏ rơi so với 1920**: lưới `xl:grid-cols-3/7` kích hoạt đúng tại 1280 → **vỡ chữ, cắt nhãn** ("OEE TRUN…", tiêu đề nhóm cụt "MA…/Throug…"). Layout đang được tinh cho 1920. **Giải:** hạ số cột ở 1280 (`xl:cols-4 2xl:cols-7`, war-room `lg:cols-2 2xl:cols-3`).

---

## §2. NAVBAR — sửa hướng W5 (trả lời điểm 2 của user)

**Vấn đề W5** (`256bda97`): gộp menu 9→4 bằng cách đưa `/dashboard`, `/command-center`, `/corporate-dashboard`, `/executive` vào `COLLAPSED_INTO_HUB` → **ẩn hẳn 4 dashboard tổng hợp khỏi sidebar**. Sai vì: (a) vi phạm recognition-over-recall — dashboard là đích quét-mắt-tìm; (b) 4 màn này là 4 đích ĐỘC LẬP, không có hub gộp thật (khác `/report-builder`→`/reporting-studio`); (c) bất đối xứng khó hiểu (giữ control-tower/drill-down nhưng giấu dashboard/corporate). Gốc: W5 nhầm "menu dài" thành "quá nhiều màn" → cắt màn thay vì tổ chức lại.

**Phát hiện then chốt**: `NavGroup` **đã có sẵn field `sections`** (`navigation.tsx:147`) + toàn bộ render đã hỗ trợ sub-header cấp-2 (nhóm "Sản xuất" đang dùng 4 section). Thêm sub-nhóm = **0 plumbing mới**, chỉ sửa data + i18n.

**✅ KHUYẾN NGHỊ — Phương án B**: giữ đủ 8 màn, gọn bằng grouping ngữ nghĩa:

```
⌂ Tổng quan
   ▸ Tổng quan nhà máy   ★     (control-tower — landing, leading-bucket, không header)
   BẢNG TỔNG HỢP               (section header tĩnh 11px)
   ▸ Chất lượng sản xuất        (/dashboard)          ← BỎ ẨN
   ▸ Phân tích tập đoàn         (/drill-down)
   ▸ Tổng quan tập đoàn         (/corporate-dashboard) ← BỎ ẨN
   ▸ Bản tin điều hành          (/executive)          ← BỎ ẨN
   VẬN HÀNH
   ▸ Xử lý cảnh báo             (/ops-console)
   ▸ Bảng Andon (TV)            (/andon)
   ▸ Sơ đồ & bản sao số         (/command-center)     ← BỎ ẨN
⚙ Quản trị
```

So 3 phương án: A (phẳng, un-hide) = giữ đủ nhưng 8 row không phân cấp, quét mệt; **B (landing + 2 sub-group)** = giữ đủ + gọn + tái dùng cơ chế Production, 0 code render mới; C (collapsible) = tái phạm ẩn-màn + cần plumbing mới. → **Chọn B.**

**Kỹ thuật B** (data-only, rủi ro thấp): (a) xoá 4 dòng khỏi `COLLAPSED_INTO_HUB` (giữ `/oee-dashboard` redirect); (b) thêm `sections: [{key:"dashboards",...},{key:"ops",...}]` vào group overview + gắn `section` cho item (control-tower để đầu, không section = leading landing); (c) 2 key i18n `nav.section.overviewDashboards`/`overviewOps` × 3 locale. **Giữ tài sản tốt của W5**: tên nhất quán, redirect theo role, RelatedViews (giờ là lối tắt phụ, không phải đường duy nhất), ⌘K index đủ.

---

## §3. ĐÁNH GIÁ & ĐỀ XUẤT TỪNG MÀN

Ký hiệu: **P1** = tác động lớn, làm trước · **P2** = cân xứng/gọn · **P3** = đánh bóng. Mọi đề xuất tái dùng primitive sẵn có (ContextDrawer, MetricCard size compact/hero, EmptyState, SectionCard, StatusBadge) — không cần component mới.

### 3.1 /command-center (Sơ đồ & bản sao số) — ⭐ QUYẾT ĐỊNH CUỐI CỦA USER
**User chốt (2026-07-20, sau khi xem live)**: **GIỮ 3 CỘT như cũ** (cây | twin | dải cảnh báo), NHƯNG **thu gọn + cân xứng 2 cột bên** để twin nổi hơn và tổng thể cân đối. Nguyên nhân "mất cân đối" chính KHÔNG phải tỷ lệ pane mà là **twin canvas rỗng** (44 máy dồn cụm giữa, lề đen trống trên/dưới).

- **3 cột**: tree TRÁI (thu gọn) | **twin GIỮA (rộng hơn)** | dải cảnh báo PHẢI (thu gọn). Tỷ lệ đề xuất ~2.5/7/2.5 (thay 3/6/3) — cả 2 cột bên hẹp lại, twin nới ra.
- **P1 — AUTO-FIT CAMERA**: khung camera/zoom lấp đầy 44 thiết bị ra toàn canvas, diệt lề đen trống (đây là fix "mất cân đối" quan trọng nhất — không chỉ đổi tỷ lệ pane).
- **P1 — Thu gọn 2 cột bên**: tree header "Cây phân cấp hệ sinh thái" 3 dòng → 1 dòng + mô tả vào tooltip; rail cảnh báo thẻ compact 2 dòng, chip lọc gọn. Cả 2 cột giảm bề ngang, nhịp chặt hơn.
- **P1 — Canh đáy 3 pane**: bỏ height cố định lệch (520/420/532), 3 cột cùng chiều cao. `CommandCenter.tsx:727,:1207,:1298`
- **P1 — Click khối twin/chip 2D/lá cây → ContextDrawer phải** (overlay, chi tiết thiết bị: KPI máy + cảnh báo của máy + lịch sử; "Mở cockpit" = CTA bước-2). Đây là bổ sung fly-out, KHÔNG thay dải cảnh báo (dải giữ nguyên là cột 3). `:468,:562,:952`
- **P2** KPI ribbon mỏng compact: sửa cắt nhãn `xl:cols-7`→`xl:cols-4 2xl:cols-7` (`:1088`), MetricCard `size="compact"`, gộp 2 ô rỗng (OEE/Năng lượng) muted.
- **P2** Bỏ nút "Làm mới" trùng trong twin (`:686`); gộp các "Cập nhật 0s trước" → 1 chấm dot/pane.
- Giữ máy-không-ok hiện nhãn thường trực (W6), toggle 2D/3D, pulse máy-cảnh-báo trên twin.

### 3.2 /control-tower (Tổng quan nhà máy)
**Nửa trên màn = chrome nav** (persona-tab + RelatedViews 2 hàng + freshness + KPI strip 2 hàng đẩy panel chạm mép fold ở 800px).
- **P1** Thêm **HERO status band** dưới h1: đèn tổng (Khỏe/Cảnh báo/Sự cố) + đếm cảnh báo mở + 1 dòng bất thường #1 (SIM-L2-ASSY 94%). `ControlTower.tsx:223`
- **P1** Panel rỗng **co lại 1 dòng** thay vì khối py-8 cao (cứu "Insight AI rỗng" + "Cảnh báo 24h toàn 0"). `PanelShell.tsx:183` · Panel hero span 2 cột khi nghiêm trọng. `:294`
- **P1** Click dòng cảnh báo/line → **ContextDrawer** + Ack tại chỗ (thay vì nhảy /ops-console từng dòng). `panels.tsx:694,742`
- **P2** Ẩn 5 pill freshness khi tươi (chỉ hiện khi stale); bỏ dòng "Tuổi dữ liệu KPI" trùng. · Đẩy RelatedViews xuống chân trang. `:263`
- **P2** KPI strip ≤5 chip cốt lõi/persona + nhãn 12px (hết truncate "OEE TRUN…").

### 3.3 /dashboard (Chất lượng sản xuất)
**Operator KHÔNG trả lời được "máy nào lỗi" trong 5s** — thông tin ở tab "Bố cục" khác + bị chôn dưới widget MQTT (5 dòng lặp phình gần 1 màn). Trang cao ~3,9 màn cuộn ở 1280.
- **P1** Thêm khối **"Máy/Trạm cần chú ý"** lên đầu tab Tổng quan (gộp bottom-machines + top trạm lỗi). `~1822`
- **P1** Chi tiết máy: **Dialog modal 4xl → ContextDrawer phải** (so sánh máy liên tiếp không mất lưới). `Dashboard.tsx:2800`
- **P1** Rút MQTT widget: gộp alert trùng "×N" + giới hạn 2-3 dòng. `~1824` · Tab bar lên ngay dưới KPI + sticky. `:1804`
- **P2** Gộp 2 hệ cảnh báo (tỷ lệ đạt + MQTT) · chuẩn hoá `glass-card`→`cardStyleProps` (`:1691,:1753`) · gộp Pie 1-datum + Bar.
- **P3** Nhãn `text-[10px]`→`text-xs` (persona 50cm/găng) · mobile 390 header MQTT flex-wrap (hết đè nút).

### 3.4 /ops-console (Xử lý cảnh báo)
Lưới 3 cột @1280 **vỡ chữ** (tiêu đề cụt "MA…/Throug…", thân vỡ 8 dòng 1 từ); 1 Andon đỏ **thua salience** badge "×53" vàng.
- **P1** Breakpoint war-room `md:cols-2 xl:cols-3`→`cols-1 lg:cols-2 2xl:cols-3` (1280 = 2 cột). `OpsConsole.tsx:867`
- **P1** Dải **"CẦN XỬ LÝ TRƯỚC" full-width** nhấc critical/quá-hạn khỏi cột lên trên (salience đúng, không dựa may rủi vị trí ô). `:853`
- **P1** "Xem N bản ghi" Collapsible in-place → **ContextDrawer**. `AlertGroupCard.tsx:143` · Bỏ truncate tiêu đề → line-clamp-2. `:108`
- **P2** KPI: ô "Nghiêm trọng" chiếm 2 cột/text-4xl khi >0; gộp 3 ô trùng (87=87) thành dải phụ. · Nút hành động ngang thay dọc. `:58` · Hạ tông badge "×N".

### 3.5 /andon (Bảng Andon TV — persona nhìn 5-10m)
**Tile đỏ cho thấy "ở ĐÂU đỏ" nhưng KHÔNG cho biết TẠI SAO** (lý do chỉ ở ticker chữ nhỏ); **line 3 bị cắt khuất** (overflow-y-auto trên TV không ai cuộn + auto-cycle mặc định tắt).
- **P1** Tile andon/crit: thay số yield "—" bằng **chữ trạng thái/lý do khổ lớn** ("DỪNG"/"KẸT"/tên andon) + tuổi sự cố. `AndonBoard.tsx:631`
- **P1** Đảm bảo mọi line luôn thấy: bật auto-cycle mặc định cho TV HOẶC scale-co-vừa (không cuộn-khuất). `:544,:356`
- **P1** Bỏ "(TV)" khỏi h1 board + bỏ subtitle (hết cắt "BẢNG ANDON (T…"). `:451,:455`
- **P2** Phóng to dấu hiệu trạng thái line/tile (0.9vw→≥1.6vw, hiện vô hình từ xa). · Ẩn chrome tương tác (Tra mã/Ack/gear/freshness) ở kiosk. · KPI "Andon đang mở" thành hero, đồng hồ hạ cấp (đang là mảng sáng-to thứ 2 vô lý).

### 3.6 /drill-down (Phân tích tập đoàn)
Danh sách node **không xếp hạng theo mức xấu** (chỉ sort total) → job "yield tụt ở ĐÂU" phải quét từng dòng; bar chart đáy **trùng** progress bar trong node.
- **P1** Rank danh sách yield-thấp/NG-cao lên đầu (sort thứ cấp). `DrillDownDashboard.tsx:501`
- **P1** Tầng máy click = **ContextDrawer preview** (KPI + sparkline NG + điểm-đo) thay hard-navigate; "Mở buồng lái" trong drawer. `:673,DrillNode.tsx:87`
- **P1** Bỏ/đổi bar chart đáy trùng → Pareto NG rank (hoặc bỏ hẳn). `:919` · "Đi tới điểm xấu nhất" lên cạnh tiêu đề list. `:903`
- **P2** RelatedViews xuống dưới · bỏ nhãn "Kỳ: Hôm nay" trùng select · thu nhỏ donut khi thưa · khử trùng liveness (FreshnessStrip vs top-bar).

### 3.7 /corporate-dashboard (Tổng quan tập đoàn)
Chưa đọc như "báo cáo điều hành": 7 MetricCard đồng cỡ (số điều hành ngang số đếm), ô OEE-rỗng mồ côi + card tự chế lệch chuẩn, chart phình cho 2 điểm dữ liệu.
- **P1** Tách **hero band 3 số** (Tỷ lệ đạt/OEE/Sản lượng, to gấp đôi) khỏi 5 số đếm (→ strip nhỏ muted). `CorporateDashboard.tsx:391`
- **P1** Ô no-OEE dùng `MetricCard value="—"` (khử ô mồ côi + đồng nhất). `:433`
- **P1** Dòng tập đoàn tĩnh → **ContextDrawer** (KPI + so kỳ + link drill) thay bắt đổi tab "Chi tiết" (vốn có filter kỳ riêng gây đứt mạch). `:483`
- **P2** Chart co khi `monthlyTrend<3` (`:532,:573`) · cân card danh sách vs chart · MetricCard `size="hero"` cho hero.

### 3.8 /dashboard-center (Trung tâm dashboard)
"Vùng chết" dọc (tab-strip → trống → CTA lẻ → search → sub-tab → grid); footer card **5 nút icon** sát nhau (chạm nhầm với găng).
- **P1** Gộp CTA "Tạo mới ▾" (split: Từ mẫu/Trống) + search lên **cùng hàng tab-strip** (xóa vùng chết + loại "Tạo trống" trùng). `CustomDashboardContent.tsx:270,324,484`
- **P1** Footer card: 5 icon → **"Mở" (primary) + "⋯"** mở **ContextDrawer** thuộc tính (đổi tên/mô tả/công khai/nhân bản/xóa). Giữ editor kéo-thả ở fullscreen (đúng cho canvas). `:586`
- **P2** Grid thêm `xl:cols-4` (fhd hết loãng) · bỏ H3 empty-state trùng H1 · mini-preview thêm nhãn loại widget.

### 3.9 /executive (Bản tin điều hành — PWA)
2 cột desktop **so le** (dải trống ~200px do `items-start`); headline AI "câu điều hành số 1" bị **chôn giữa card AI**; nhãn KPI cắt trên mobile ("TỶ LỆ ĐẠT (HÔ…").
- **P1** **Nâng headline AI 1-dòng lên làm LEAD** full-width trên cùng. `ExecutiveMobile.tsx:895`
- **P1** Cân 2 cột: đưa "Chờ phê duyệt" lên ngang tầm KPI (col2/row1), AI đầy đủ xuống row2 (xóa dải trống so le). `:830,:933`
- **P1** Rút nhãn KPI ("(hôm nay)" xuống dòng sub) hết cắt. `:693,:702,:711`
- **P2** Risk/threshold row → **ContextDrawer** (đọc+ack tại chỗ); GIỮ proposal Duyệt/Bỏ-qua 1-chạm inline (điểm sáng) + deploy deep-link SoD/2FA. `:800,:964`
- **P3** Mobile: "Chờ phê duyệt" lên trên "Tóm tắt AI" (quyết định trước, tường thuật sau).

---

## §4. KẾ HOẠCH THỰC THI ĐỀ XUẤT (chờ duyệt)

Nguyên tắc: **navbar trước (rẻ, đúng khiếu nại) → chuẩn hóa ContextDrawer (đòn bẩy lớn nhất, xuyên màn) → hero/mảng-chính từng màn → cân xứng/gọn → đánh bóng**. Mỗi wave gate tsc + build + re-capture live đối chứng, 1 commit trên `feat/hmi-dep`.

| Wave | Nội dung | Quy mô |
|---|---|---|
| **V1 — Navbar B** | Bỏ ẩn 4 dashboard + 2 sub-nhóm "Bảng tổng hợp"/"Vận hành" + i18n (data-only) | S |
| **V2 — ContextDrawer chuẩn** | Chuẩn hóa pattern chi tiết→drawer phải cho: command-center (thiết bị), dashboard (máy), drill-down (máy), ops-console (nhóm/alert), corporate (tập đoàn), executive (risk/threshold), dashboard-center (thuộc tính). 1 mẫu dùng lại 7 màn | L |
| **V3 — Hero / mảng chính** | control-tower status band · dashboard "Máy cần chú ý" · ops-console "Cần xử lý trước" · corporate hero-3-số · executive LEAD headline · command-center rail-làm-chính · andon tile-lý-do · drill-down rank-list | L |
| **V4 — Cân xứng & breakpoint 1280** | tỷ lệ pane (command-center 3/5/4, ops-console 2-cột) · ô rỗng co/gộp · chart co theo mật độ · sửa cắt nhãn KPI · MetricCard size compact/hero | M |
| **V5 — Gọn chrome & đánh bóng** | ẩn freshness khi tươi · 1 refresh/trang · RelatedViews xuống chân · andon ẩn chrome kiosk + đọc-xa · typography 12px · mobile fixes | M |

**Ước tính**: tương tự doc 67 (mỗi wave vài agent song song trên cụm file không giao). V1 nhỏ có thể làm ngay để anh thấy navbar đúng ý trước.

## §5. Trạng thái duyệt (2026-07-20)
✅ **USER ĐÃ DUYỆT** — Navbar Phương án B · pattern ContextDrawer xuyên module · V1→V5 cả 9 màn · **/command-center: GIỮ 3 CỘT, thu gọn 2 bên + twin rộng (§3.1 quyết định cuối)**.

## §6. KẾT QUẢ THỰC THI REDESIGN (2026-07-20)
**2 commit trên `feat/hmi-dep`**: V1 navbar `2a92f398` · redesign 9 màn `252d0e7a`. Mỗi commit gate tsc(heap8GB)+i18n+build (+vitest andon 21/21). Đối chứng live (re-capture 9 màn): hScroll@1280 = false toàn bộ, 1 landmark main, 0 lỗi console.

Đạt (xác nhận trên ảnh live):
- ✅ Navbar: 8 màn hiển thị lại, landing "Tổng quan nhà máy" + nhóm "Bảng tổng hợp" + "Vận hành".
- ✅ control-tower: HeroStatusBand đỏ "Sự cố · 3 nặng · 3 cao · 6 đang mở · Bất thường #1" neo mắt; toolbar gộp; KPI 5 chip; panel rỗng → "Tất cả ổn".
- ✅ command-center: 3 cột 2.5/7/2.5 (2 bên gọn, twin rộng); KPI ribbon gộp ô rỗng muted; ContextDrawer chi tiết thiết bị khi click.
- ✅ 7 màn còn lại: Hero + ContextDrawer + cân xứng theo §3 (corporate hero-3-số, dashboard Máy-cần-chú-ý, ops-console 2-cột+dải-ưu-tiên, andon tile-lý-do, drill-down rank, executive LEAD, dashboard-center card+drawer).

**Twin 3D "mất cân đối" — ĐÃ GIẢI QUYẾT (3 bước, user chốt hướng)**:
1. `1c9ea716` camera pitch 45°→52° + zoom 1.08× + ground plane bó theo cụm → cải thiện nhưng chưa trọn.
2. Nguyên nhân gốc: thiết bị dùng TỌA ĐỘ KHÔNG GIAN thật (line-3 + máy lẻ nằm xa) → bounding box giãn → khoảng đen. Không phải camera.
3. `89cf2c8c` **user chốt XẾP LƯỚI GỌN**: `gridPositions` lưới đều 8×6 (cols=ceil(√(n*1.4)), spacing 2.2u, sort ổn định stationId→code→id) thay tọa độ rải rác → auto-fit tự lấp đầy. **Live: twin lấp đầy ~75% canvas, cân đối.** Đánh đổi: không còn phản ánh vị trí vật lý thật (thành lưới thiết bị trực quan) — user chấp nhận.

Mục nhỏ còn lại: đánh bóng typography sâu; row cuối lưới (44=8×5+4) hơi lệch trái (chấp nhận được).

> Nguồn đầy đủ (wireframe ASCII + file:line từng màn): 10 báo cáo agent design-critique + 9 báo cáo agent thực thi trong session.
