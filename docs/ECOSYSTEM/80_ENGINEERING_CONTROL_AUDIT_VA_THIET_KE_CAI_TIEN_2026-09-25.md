# Doc 80 — Audit toàn diện module "Kỹ thuật & Điều khiển" + Thiết kế cải tiến

> **Ngày:** 2026-09-25 · **Nhánh:** `feat/ai-local-L7-hang-rao` @ `84f12c7d5` · **Pha:** PLAN (đánh giá + thiết kế). **Chưa sửa một dòng mã nào.**
> **Người đọc:** chủ dự án — review từng hạng mục và ra quyết định (§9) trước khi thực thi.
> **Phụ lục chi tiết** (thư mục [80_ENGINEERING_CONTROL_AUDIT/](80_ENGINEERING_CONTROL_AUDIT/)):
> [A — AI hỗ trợ lập trình](80_ENGINEERING_CONTROL_AUDIT/A_AI_HO_TRO_LAP_TRINH.md) ·
> [B — IDE lập trình thiết bị](80_ENGINEERING_CONTROL_AUDIT/B_IDE_LAP_TRINH_THIET_BI.md) ·
> [C — IR Editor + POU Studio](80_ENGINEERING_CONTROL_AUDIT/C_IR_EDITOR_POU_STUDIO.md) ·
> [D — Hub · ECN · Recipe · Interlock](80_ENGINEERING_CONTROL_AUDIT/D_HUB_ECN_RECIPE_INTERLOCK.md) ·
> [E — Điều phối · An toàn · Chuẩn hoá](80_ENGINEERING_CONTROL_AUDIT/E_DIEU_PHOI_AN_TOAN_CHUAN_HOA.md) ·
> [F — Nền tảng · DB · Hiệu năng](80_ENGINEERING_CONTROL_AUDIT/F_NEN_TANG_DB_HIEU_NANG.md) ·
> [ảnh chụp màn hình thật](80_ENGINEERING_CONTROL_AUDIT/anh/)

---

## 0. Cách đọc tài liệu này

- §1 là bản tóm tắt một trang. §3 chấm điểm 14 màn. §4 là những gì **nhìn thấy trên màn hình thật**. §5 là danh sách P0/P1. §6 gom thành 7 nguyên nhân gốc. §7 là thiết kế mục tiêu. §8 lộ trình. **§9 là các quyết định cần anh/chị chốt.**
- Mỗi phát hiện có mã (`AI-01`, `WS-02`, `ILK-04`…) trỏ về phụ lục, nơi có `file:dòng` và cách đo.
- Quy ước mức: **P0** = sai an toàn/bảo mật hoặc tính năng cốt lõi không chạy · **P1** = sai nghiệp vụ/đường vòng cổng/khoảng cách lớn · **P2** = chất lượng/khả dụng · **P3** = vặt.
- Báo cáo tách ba lớp theo nguyên tắc chủ dự án: **LOGIC** (mã) · **DỮ LIỆU** (seed/demo) · **VẬN HÀNH** (cờ, cấu hình `.env`).

## 1. Tóm tắt điều hành

**Module có 14 màn** (menu "Kỹ thuật & Điều khiển (Nâng cao)"): Trung tâm Kỹ thuật (Hub) · Xưởng kỹ thuật (Studio) · Lập trình thiết bị (IDE) · Thay đổi kỹ thuật (ECN) · Recipe máy · Trình soạn IR · Studio POU · Trợ lý Lập trình (Copilot) · Studio Quy trình (Orchestration) · Điều phối robot (Fleet) · Quy tắc Interlock · An toàn & Nhân lực · Tiêu chuẩn thiết bị · Tích hợp thiết bị.

**Điểm tổng module: ~4,8 / 10** (trung bình 14 màn + lớp nền, §3). Doc 54 (07/2026) từng chấm Kỹ thuật ~81/100 và doc 26 chấm UX ~6,5/10; lần này thấp hơn vì **đo kết cục người dùng nhận được** (gọi thật, dữ liệu thật, màn hình thật) thay vì đếm cơ chế đã có.

**Ba sự thật lớn nhất:**

1. **AI hỗ trợ lập trình hiện không sinh được mã nào.** 14 tác vụ lập trình thật qua đúng đường sản phẩm ⇒ **0 ĐẠT · 1 SAI · 13 HỎNG** (mỗi lượt 11–25 s, trên UI thật 60–80 s không stream, không nút huỷ, rồi đổ một đoạn chẩn đoán kỹ thuật cho kỹ sư). Nguyên nhân số 1 đã chứng minh bằng ablation: model đang "suy nghĩ" mà trần token chỉ 1 536 ⇒ nghĩ hết ngân sách trước khi viết (`aiModelRouter.ts:610`). **Nhưng** tắt nghĩ thì hết HỎNG mà vẫn chỉ 2/14 ĐẠT, và khi cho nghĩ đủ thì model **sinh ra mã bypass E-STOP** qua một yêu cầu tiếng Việt/qua `contextCode` mà cổng an toàn (regex tiếng Anh/Trung) không bắt. Validator ST chỉ đếm từ khoá: chương trình rác được gắn "Validated", FB hợp lệ bị báo lỗi. ⇒ Phụ lục A.
2. **Các cổng an toàn đúng đều đã có, nhưng mỗi cổng có một đường vòng.** Ví dụ đã kiểm trong mã: Abort một quy trình không dừng quy trình (DB ghi `aborted`, driver chạy tiếp rồi ghi đè `completed` — ORC-01); sửa một rule interlock **đã duyệt, đang bật** không mất trạng thái duyệt (ILK-01); cổng interlock so với mẫu telemetry **cũ nhất** trong cửa sổ (đo được trễ 35 phút — ILK-04); release recipe qua trang Tích hợp bỏ qua duyệt + 2FA mà trang Recipe bắt (FLOW-01/INT-02); rollback chương trình ghi sổ WORM "đã khôi phục" khi máy vẫn chạy bản lỗi (WS-03); socket tự khai `clientType:"machine"` vào được phòng `engineering:*` không cần xác thực (PLT-01). **Trong khi `.env` đang bật `OT_CONTROL`/`ROBOT_CONTROL` (ghi lệnh thật) và engine interlock TẮT** — interlock hiện không chặn lệnh nào, và không màn nào nói điều này (ILK-06).
3. **Giao diện "pro ở từng mảnh" nhưng không phải phần mềm kỹ thuật.** IDE là 7 card xếp dọc cao ~2 800 px quanh một ô soạn 360 px; IR/POU là trang cuộn dài với canvas nhỏ; ba công cụ soạn (IDE, IR, POU) không mở được bản của nhau ("Mở project này trong IR/POU" mở canvas trống); ba lối vào trùng nhau (sidebar, Hub, Studio); 13/14 màn không có bảng dữ liệu chuẩn (tìm/lọc/sort/phân trang), nhiều ô nhập **ID số trần** thay cho bộ chọn; 5 màn chồng 3–4 banner thông báo trước nội dung. So với TIA Portal / CODESYS / Copilot–Cursor / Teamcenter / MiR Fleet / PlantState, khoảng cách lớn nhất nằm ở **mô hình project nhiều POU, panel Problems, online monitor, vòng đời thay đổi có liên kết**. Điểm **vượt trội thật**: 4 mắt/SoD/audit WORM/canary fleet/mô phỏng thuần/diff-merge 3 chiều theo AST — những thứ đối thủ không có hoặc bán riêng.

**Số P0:** 13 (§5.1). **Hướng khuyến nghị:** *vá an toàn & trung thực trước (Đợt 0–1, ~2–3 tuần), rồi mới xây IDE hợp nhất + AI copilot v2 (Đợt 2), rồi quy trình ECN/Recipe/Interlock-MOC (Đợt 3), Orchestration/Alarm (Đợt 4)*; Fleet chuyển Labs, Tích hợp thiết bị giải thể về chỗ đúng.

## 2. Hệ đo (MSA) và phương pháp

| Kiểm | Kết quả |
|---|---|
| Thứ đang chạy có khớp mã? | Server :3000 = `dist/index.js` build 17:14:28, tiến trình khởi 17:14:38. Client `dist/public` build 15:29 — **không có commit nào vào `client/src` sau 15:29** ⇒ UI đo khớp mã. Commit server sau 17:14 (`e85093400`, 17:15) chỉ chạm ai-coding, ngoài phạm vi. |
| Có phiên khác sửa vùng này? | Có một phiên Claude khác đang commit mảng ai-coding trên cùng nhánh ⇒ audit này **chỉ đọc**: không sửa mã, không restart, không sửa `.env`, không ghi DB (trừ tác dụng phụ đo AI bên dưới). |
| Cache giữa các mẫu? | Copilot không có cache ứng dụng (T01 lặp lại vẫn 15,7 s) ⇒ mẫu độc lập. |
| Phép đo tự thoả? | DB đọc bằng phiên `READ ONLY` độc lập với API; kết quả AI chấm bằng adapter thật + đọc tay, không bằng chính cờ "Validated" của hệ thống. |
| Tác dụng phụ | Đo AI đúng đường sản phẩm ghi ~26 hàng `audit_logs` + ~24 hàng `ai_gateway_metrics`. Không ghi gì khác. |

**Phương pháp:** 6 tác tử audit song song theo cụm (A AI · B IDE · C IR/POU · D Hub/ECN/Recipe/Interlock · E Điều phối/An toàn/Chuẩn hoá · F Nền tảng/DB/Hiệu năng) — đọc mã có `file:dòng`, gọi tRPC thật (engineer1), `SELECT`/`EXPLAIN ANALYZE` chỉ đọc, đo bundle. Phiên chính **tự đi qua 14 màn trên trình duyệt thật** (1600×950, engineer1) chụp 19 ảnh, đo mạng, chạy một yêu cầu Copilot thật, và **tự kiểm lại trong mã** các P0 chỉ dựa trên đọc mã (ORC-01, ILK-01, WS-03, AI-01, PLT-01, PLT-06).

**Bối cảnh vận hành đo được:** engineer1 **không bật 2FA** (`AUTH_2FA_BAT_BUOC=0`) ⇒ không deploy được (UI báo đúng lý do). Dữ liệu module gần như toàn **seed/demo**: 4 project lập trình, 7 phiên bản (dài nhất 336 ký tự), 3 deployment (cả 3 `simulated`), 3 ECN, 5 recipe, 1 rule interlock, 6 run orchestration (6/6 seed), 2 task fleet demo, 0 robot AMR, **1 700 máy** (mã QATD-*, dữ liệu thử tải). ⇒ Số hiệu năng DB **không đại diện** quy mô nhà máy.

## 3. Bảng điểm 14 màn + lớp nền

Thang 0–10. "Pro" = độ chuyên nghiệp so với phần mềm tương đương.

| # | Màn | Chức năng | UX/Bố cục | Pro | Backend | DB | Hiệu năng | **TB** | Đối thủ tham chiếu |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Hub `/engineering-home` | 6 | 7 | 6 | 6 | 7 | 8 | **6,7** | — |
| 2 | Studio `/engineering-studio` | 4 | 5 | 4 | – | – | 9 | **5,5** | (trùng Hub) |
| 3 | IDE `/engineering` | 4 | 4 | 2,5 | 5,5 | 4,5 | 6,5 | **4,5** | TIA · CODESYS · TwinCAT · GX Works3 · ZDevelop |
| 4 | ECN `/engineering-changes` | 4 | 5,5 | 3 | 4,5 | 5 | 6 | **4,7** | Teamcenter · Windchill · Arena |
| 5 | Recipes `/recipes` | 5,5 | 5,5 | 4 | 6 | 5,5 | 6 | **5,4** | FactoryTalk Batch · SIMATIC Batch (ISA-88) |
| 6 | IR Editor `/ir-editor` | 5,5 | 5 | 3,5 | 4 | 5 | 4 | **4,5** | CODESYS CFC · Node-RED · Blockly |
| 7 | POU Studio `/pou-studio` | 4 | 4 | 2,5 | 4 | 3 | 3,5 | **3,5** | CODESYS LD/FBD/SFC · TIA LAD/GRAPH |
| 8 | Copilot `/programming-copilot` + dock | 2 | 4 | 2 | 3 | – | 3 | **2,8** | GitHub Copilot · Cursor · Siemens Industrial Copilot |
| 9 | Orchestration `/orchestration-studio` | 6,5 | 5,5 | 4,5 | 5 | 4,5 | 6 | **5,3** | Camunda · Ignition SFC · Tulip |
| 10 | Fleet `/fleet-orchestration` | 4,5 | 5 | 2,5 | 5,5 | 4 | 6 | **4,6** | MiR Fleet · OTTO · VDA 5050 |
| 11 | Interlock `/interlock-rules` | 4,5 | 5 | 3 | 5 | 5 | 7 | **4,9** | Siemens Safety Matrix · Rockwell C&E |
| 12 | Safety & Workforce `/safety-workforce` | 3,5 | 5 | 2,5 | 5 | 4 | 7 | **4,5** | Intelex · Cority (EHS) |
| 13 | Equipment Standards `/equipment-standards` | 5,5 | 5,5 | 4 | 6,5 | 5 | 7 | **5,6** | PAS PlantState · DynAMo |
| 14 | Equipment Integration `/equipment-integration` | 3,5 | 4,5 | 2,5 | 5 | 5 | 7 | **4,6** | Kepware · HighByte |
| — | **Lớp nền** (kiến trúc 5,5 · RBAC 4,5 · DB 6 · flow 4,5 · perf 6 · obs 6 · test 3) | | | | | | | **5,1** | |

## 4. Đánh giá trên màn hình thật (phiên chính đi qua 14 màn)

Ảnh: [anh/](80_ENGINEERING_CONTROL_AUDIT/anh/). Những điểm dưới đây **quan sát trực tiếp**, không suy từ mã.

**Chung cho cả module**
- **G-01 · Hai breadcrumb chồng nhau** trên mọi trang (thanh trên + trong trang) — chiếm ~120 px dọc vô ích (ảnh 01, 03).
- **G-02 · Ba lối vào cho cùng 12 công cụ:** sidebar, Hub (17 ô), Studio (15 ô, trùng 12). Studio trộn nhãn tiếng Anh ("Programming Copilot", "Engineering change notice", "POU Studio") (ảnh 02).
- **G-03 · Chồng banner:** IR/POU/Orchestration/Fleet/Safety/Standards/Integration xếp 3–4 banner (Beta · "Khi nào dùng" · khoá · advisory) trước nội dung; nội dung thật bắt đầu dưới ~400 px (ảnh 10–14).
- **G-04 · Font chính không tải được (PLT-06):** URL `/assets/@fontsource-variable/geist/...woff2` trả **HTML 369 KB** (SPA fallback, đã `curl` xác nhận `200 text/html`). Toàn app — kể cả editor mã (Geist Mono) — chạy font dự phòng, và mỗi lượt tải lạnh tải ~1,5 MB HTML vô ích.
- **G-05 · Khởi động chặn:** mỗi lượt tải lạnh, sidebar + trang **trống** tới khi batch `permissions.getMyPermissions,commandCenter.hierarchy,aiInbox.count,andon.active,license.*` xong (~1–1,4 s).
- **G-06 · `data-loc="client\src\...:351"`** gắn trong DOM production — lộ đường dẫn mã nguồn.

**IDE `/engineering`** (ảnh 03, 03b, 03c)
- **G-07 · Trạng thái mặc định lúc tải hiện như sự thật:** vài giây đầu màn hình nói "Chưa có dự án", badge "Triển khai: OFF" và banner vàng "DPC_DEPLOY_ENABLED đang TẮT — mọi deploy được ghi nhận là SIMULATED"; sau đó thành 4 dự án + "Triển khai: ON". Người dùng không phân biệt được "đang tải" với "tắt". Banner lộ tên biến môi trường.
- **G-08 · Không phải bố cục IDE:** 7 card xếp dọc, trang cao ~2 800 px; editor 360 px; khối Deploy/Fleet/Tag nằm dưới cùng phải cuộn.
- **G-09 · Stepper luồng vàng báo sai:** chọn phiên bản v2 (nháp, **0 dòng mã**, "Chưa có build") nhưng stepper vẫn tick ✓ Soạn và ✓ Deploy (lấy từ deployment seed của v1).
- **G-10 · Canary fleet liệt kê phẳng 40 máy**, gồm cảm biến nhiệt-ẩm ESP32, máy AOI/AVI/SPI — cho một chương trình Zmotion. Không lọc theo loại chương trình.
- **G-11 · Chuỗi i18n hỏng:** "Chọn một build ở khối \\" (`vi.json:15551` bị cắt).
- **G-12 · Ba lối vào AI trên một trang:** nút nổi "Trợ lý AI" chung + tab "Copilot" cạnh phải + card "Trợ lý Lập trình AI" chỉ chứa một nút "Mở Trợ lý".

**Copilot (dock trên IDE)** (ảnh 03d, 03e, 03f)
- **G-13 · Một yêu cầu thật thất bại:** "Zmotion BASIC: trục 0 và 1 về gốc, di chuyển tương đối 50/30 mm tốc độ 100 mm/s, chờ dừng rồi bật OUT 3" ⇒ "Đang sinh…" ~60–80 s (không stream, không huỷ, không tiến độ) ⇒ hộp xám dài: *"HỆ THỐNG HỎNG — … [llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, chat): model đã tiêu HẾT hạn mức 1536 token vào chuỗi SUY LUẬN… CÁCH SỬA… đặt `disableThinking: true`… TRÍCH SUY LUẬN: Here's a thinking process…"* + 5 nguồn sổ tay. Thông điệp viết cho lập trình viên nền tảng, không cho kỹ sư tự động hoá.
- Dock dạng form một lượt (loại/chế độ/hãng/yêu cầu), không hội thoại; mở lại ở mọi trang (IR, POU) vì trạng thái được nhớ.

**IR Editor** (ảnh 05) — **G-14** canvas chỉ ~200×390 px trong cột giữa của trang cao ~2 870 px; hai "luồng đã lưu" đều hiện **"không phân tích được"**; panel So sánh còn tiếng Anh ("Base version", "Pick a saved version…", "Current editor draft").
**POU Studio** (ảnh 06) — **G-15** ladder vẽ bằng node graph (tiếp điểm là các khối nhỏ nối dây), không phải lưới rung với hai thanh nguồn như LD chuẩn; khu vẽ ~350×550 px.
**ECN** (ảnh 07) — **G-16** bảng trần 6 cột, không tìm kiếm, không cột người yêu cầu/ưu tiên/đối tượng; nút **Phê duyệt / Từ chối** ngay trên hàng (một click).
**Recipes** (ảnh 08) — **G-17** banner "Để ĐẨY recipe xuống máy thật, dùng luồng HITL trong **AI Copilot**" (quy trình vận hành đi qua AI); cột "Người triển khai" hiện số `1`; tiêu đề cột bị cắt "Đang dùn".
**Interlock** (ảnh 09) — **G-18** engineer "Chỉ xem" vẫn thấy nút Tắt/Sửa/Xoá (mờ); ngưỡng hiển thị `gt 20.000000`; không có gì cho biết engine interlock đang TẮT.
**Orchestration** (ảnh 10) — **G-19** mỗi nút có **hai icon chồng** (icon + emoji: "🧪 Mô phỏng", "💾 Lưu (deploy)", "▶ Chạy", "AI gợi ý"); "Lưu (deploy)" gộp lưu với triển khai; `listRuns` gọi lại mỗi ~2,5 s không dừng.
**Fleet** (ảnh 11) — **G-20** 9 thẻ KPI một hàng, nhãn bị cắt ("Đang …", "Đặt tr…", "Tài ng…"); dữ liệu 2 task `DEMO-TASK-*` không có nhãn demo.
**Standards** (ảnh 13) — **G-21** "100 % Máy đã ánh xạ 1700/1700" — con số của 1 700 máy thử tải, tính trên hằng số seed (STD-01).
**Integration** (ảnh 14) — **G-22** "13 Adapter đã kết nối" cạnh "0 Thiết bị đã kết nối" (đăng ký ≠ kết nối).

## 5. Phát hiện trọng yếu

### 5.1 P0 (13)

| ID | Lớp | Phát hiện | Kiểm bằng | Phụ lục |
|---|---|---|---|---|
| AI-01 | Logic | Copilot suy luận không quản lý, trần 1 536 token ⇒ 13/14 HỎNG | gọi thật + ablation + UI thật | A |
| AI-02 | Logic | Validator ST đếm từ khoá: rác "Validated", mã đúng bị báo lỗi | adapter thật | A |
| AI-03 | Logic | Cổng an toàn copilot chỉ regex EN/ZH, không soi `contextCode` ⇒ đã sinh mã bypass E-STOP | gọi thật (cánh C) | A |
| WS-01 | Logic+Vận hành | `DPC_VERSION_REVIEW` BẬT nhưng không UI duyệt phiên bản ⇒ phiên bản mới nào cũng không build được (4/7 đang `pending_review`) | mã + DB | B |
| WS-02 | Logic | Deploy thật gãy về cấu trúc: adapter nhận BuildResult mất `meta` ⇒ Zmotion/Mitsubishi/IEC luôn failed, robot mất bước | mã + `programming.status` | B |
| WS-03 | Logic | Rollback chương trình ghi `rolled_back` vô điều kiện khi thực tế chỉ simulated | mã (tự kiểm) | B |
| IR-01 | Logic | Chèn mã qua trường chuỗi IR ⇒ lint OK mà URScript chứa `v=3` (12× trần), ROS2 chứa `os.system(...)` | gọi thật | C |
| POU-01 | Logic | Nhập PLCopen gom rung theo băng y ⇒ mất tiếp điểm NC `Stop`, vẫn `ok:true` | gọi thật | C |
| XC-01 | Logic | Preview/lint/import dùng GET ⇒ HTTP 431 từ 30 block / 20 rung / XML 12 KB | gọi thật | C |
| ILK-01 | Logic | Sửa rule interlock đã duyệt & đang bật không mất trạng thái duyệt | mã (tự kiểm) | D |
| ORC-01 | Logic | Abort không dừng run; driver ghi đè `completed` | mã (tự kiểm) | E |
| PLT-01 | Logic (nền tảng) | Socket `clientType:"machine"` bỏ qua xác thực, join phòng `engineering:*` không kiểm quyền | thử kết nối thật | F |
| FLOW-01 | Logic | Release/rollback recipe qua `/equipment-integration` bỏ qua duyệt + 2FA (cùng bảng mà `/recipes` bảo vệ) | mã | E/F |

*(INT-02 ở phụ lục E là cùng lỗ FLOW-01 nhìn từ phía trang Tích hợp — không đếm hai lần.)*

### 5.2 P1 tiêu biểu (chọn lọc — đầy đủ ở phụ lục)

- **An toàn/điều khiển:** ILK-04 cổng interlock so mẫu **cũ nhất** (trễ 35 phút đo được) · ILK-05 rule `stop_line` không đích "đang bật" mà không bao giờ chặn · **ILK-06 `OT_CONTROL` BẬT + engine interlock TẮT + rule duy nhất không có dữ liệu ⇒ interlock không chặn gì, không màn nào nói** · ORC-02/03 resume không CAS (2 driver), `approverRoles` không được kiểm, người chạy tự duyệt · ORC-04 run "held" do restart nằm trong "chờ duyệt" kèm nút Approve (bấm ⇒ chạy lại thật) · ORC-06 duplicate workflow ra `active` bỏ qua deploy gate · FLOW-02/03 `confirmedBy` do client gửi; Zmotion ghi FFI thẳng, không qua dispatcher/interlock (P0 khi đặt `ZMC_ENDPOINT`) · WS-04/05/06 idempotency cố định, `buildId` không reset (deploy nhầm build), race trên đường actuation · SAF-01 nút thử proximity bật **Andon thật** · STD-02 Shelve báo động không có hiệu lực ở đâu · INT-01 **SSRF** qua `euromapOpcuaSnapshot`.
- **Trung thực trạng thái:** IR-02 lint "OK" khi query lỗi · HUB-01 dải chờ duyệt xanh khi nguồn lỗi · STD-01 KPI tuân thủ luôn 100 % · X-01 không trang nào gắn nhãn DEMO/SEED · G-07 trạng thái mặc định lúc tải hiện như sự thật.
- **Nghiệp vụ:** ECN-01 ECN không liên kết recipe/program/BOM, deploy không cần ECN · ECN-02/03/04 ai đăng nhập cũng tạo/đọc ECN qua API, race duyệt, dấu người duyệt bị ghi đè · RCP-01 kiểm kiểu/giới hạn tham số recipe không bao giờ chạy · RCP-02 một phiên bản active cho cả nhà máy · RCP-03 rollback sai hàng · RCP-04 recipe deploy chưa lên `deployProcedure`.
- **Khả dụng:** XC-02/RBAC-01 menu hiện nhưng route chặn (IR, POU, Fleet — 4–5 user thật) · XC-03 "Mở trong IR/POU" không mở gì · POU-04 POU Studio không có chức năng "Mở" · WS-09/10 không panel Problems, không lỗi inline, bố cục không phải IDE · AI-07/09/10 không stream/huỷ, lỗi kỹ thuật đổ cho người dùng, "Apply" **nối cả chương trình vào cuối buffer**.
- **Nền:** PERF-01 three.js + React chung chunk 420 KB gz preload mọi trang · PLT-06 font · TST-01 7/12 router 0 test, 0 test client/E2E/tích hợp DB thật.

## 6. Pareto nguyên nhân gốc (7 chủ đề)

| # | Nguyên nhân gốc | Phát hiện gom về | Vì sao xảy ra |
|---|---|---|---|
| **T1** | **Trạng thái không trung thực** — hệ thống hiển thị/ghi điều khác với sự thật | IR-02, HUB-01, STD-01, WS-03, ORC-01, AI-02, AI-27, G-07, G-09, X-01, SAF-02, ILK-06, `?? true` ×4 | Mặc định lạc quan khi thiếu dữ liệu; không có khái niệm "không đọc được" tách khỏi "0"/"OK" |
| **T2** | **Cổng an toàn có đường vòng** — cổng đúng nhưng không phải đường duy nhất | ILK-01/04/05, ORC-03/05/06, FLOW-01/02/03, INT-02, AI-03, PLT-01, RCP-04 | Mỗi tính năng tự cài cổng riêng; không có một "điểm ghi thiết bị" và một registry quyền duy nhất |
| **T3** | **Không phải phần mềm kỹ thuật** — trang web xếp card thay vì công cụ | WS-10, IR-10, POU-07, G-08, G-14, G-15, ECN-06, X-04 | Mỗi đợt thêm một card; chưa có vỏ IDE, `DataTable`, `EntityPicker` dùng chung |
| **T4** | **Quyền nhiều nguồn sự thật** — nav, RouteGuard, Hub, server mỗi nơi một kiểu | RBAC-01..04, XC-02, X-02, ECN-02, canEdit vô nghĩa, không ai có canDelete | Quyền khai tay ở 4 nơi |
| **T5** | **Vòng đời đứt gãy** — các đối tượng không nối với nhau | ECN-01, XC-03/05, POU-04, WS-01, RCP-02, HUB-02 | Mỗi công cụ là một đảo: ECN không chạm recipe/program; IR/POU không mở lại được; review không có UI |
| **T6** | **AI lập trình hỏng ở mọi tầng sau model** | AI-01..27 | Cấu hình token sai + validator giả + prompt tự phá + cổng regex; không có đo chấp nhận nên không ai thấy (19 lượt dùng trong 2 tháng) |
| **T7** | **Nền mỏng** — FK/TX/test/observability | DB-01, FLOW-04/05, TST-01/02, OBS-01..04, PERF-01..05 | Test mock chính cơ chế đang kiểm; không test tích hợp DB/E2E; dữ liệu đồ chơi che rủi ro tăng trưởng |

## 7. Thiết kế mục tiêu

### 7.1 Kiến trúc thông tin mới (menu)

```
Kỹ thuật & Điều khiển
├ Trung tâm Kỹ thuật (Hub hợp nhất: Hộp việc · Tư thế an toàn · Luồng vàng số sống · Danh mục công cụ)
├ Soạn thảo
│   ├ IDE Kỹ thuật  (một project, nhiều Program Unit: ST · LD · FBD · SFC · Motion-IR · ZBasic · Robot · GVL · IO map)
│   │                ⟵ hợp nhất /engineering + /ir-editor + /pou-studio; Copilot là view cột phải
│   ├ Recipes (ISA-88: phiên bản · tham số có kiểu · máy đang chạy · drift · genealogy)
│   └ Thay đổi kỹ thuật (ECN v2)
├ Điều phối: Orchestration (Library · Designer · Runs · Approvals)
├ An toàn: Interlock & ma trận Cause–Effect · Safety Monitor (advisory)
├ Chuẩn hoá: Alarm Management & Standards
└ Labs (ẩn mặc định): Fleet · Collaboration
Chuyển ra: /engineering-studio → Hub?view=catalog · /programming-copilot → IDE (scratch) ·
           Workforce → Sản xuất›Ca · FOCAS/Euromap → Connectivity › Connector catalog ·
           Acquisition → AOI/Vision · /equipment-integration → redirect theo tab
```

Nguyên tắc: **một lối vào cho mỗi việc**; route cũ luôn redirect (không gãy link); không xoá màn nào khi chưa có chỗ mới nhận chức năng.

### 7.2 Hub hợp nhất (chi tiết: D §7.1)

```
┌ Trung tâm Kỹ thuật ──────────────────────── [⌘K Tìm công cụ / ECN / recipe] ┐
│ Tư thế: OT ghi ●BẬT · Gate ●BẬT · Engine interlock ○TẮT ⚠ · Config-sync ○TẮT │
├ Hộp việc [Của tôi|Toàn module] ─────────────────────── cập nhật 12 s ───────┤
│ [ECN chờ duyệt 1 ⏱3d] [Recipe chạy CHƯA duyệt 1 ⛔] [Run chờ 1] [Rule chờ 0]  │
│ ⚠ Không đọc được: safety_events — số liệu có thể thiếu                        │
├ Luồng vàng (số sống): ECN 3 ▶ Recipe/Program 4 ▶ Chờ duyệt 0 ▶ Triển khai 3 ▶ Lệch 0 ┤
├ Công cụ [Theo tác vụ | A–Z] ☆ ghim · gần đây · trạng thái "Sẵn sàng / Labs"   ┤
└─────────────────────────────────────────────────────────────────────────────┘
```
Thẻ ba trạng thái `ok | degraded | error` — **không bao giờ xanh khi một nguồn lỗi**. "Tư thế" hiển thị sự thật vận hành (ILK-06) ngay trang đầu.

### 7.3 IDE Kỹ thuật hợp nhất (chi tiết: B §5, C §7)

```
┌ ◧CELL-L1▾ ⎇main▾ v7● │ ✓Kiểm ⚒Build ⏵Mô phỏng ⇪Deploy… │ 🎯PLC-06 · "chưa tải được: thiếu endpoint" │ Review ⏳ ┐
├──┬ EXPLORER ─────┬ [MotorCtl.ld●][PickPlace.ir][Main.st][Tags][Δ v6↔v7] ─┬ INSPECTOR / COPILOT ┤
│📁│ ▾Chương trình │                                                     │ v7 · Minh · 10:42    │
│🔍│ ▾Biến & IO    │   editor/canvas toàn chiều cao (≥60 % màn hình)     │ "Sửa interlock"      │
│⎇ │ ▾Tasks        │   ~~ gạch lỗi inline                                │ Build#12✓ Sim⚠       │
│⏵ │ ▾Phiên bản    │                                                     │ Trên máy: v5 a3f9    │
│📡│ ▾Deploy       │                                                     │ ─ Copilot (hội thoại)│
├──┴───────────────┴─────────────────────────────────────────────────────┴──────────────────────┤
│ [Vấn đề 2✖1⚠][Output][Build][Mô phỏng][Watch][Cross-ref][Lịch sử deploy]  ✕ Main.st:3:5 …   │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Ln3 Col5 · ST · Online ○ · Build 12s trước · Copilot ● hàng đợi 0 · Deploy thật: ON             │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Mô hình dữ liệu:** `program_units` (một project nhiều unit) + artifact có `baseArtifactId` (khoá lạc quan, 409 ⇒ mở Merge) + `layoutJson` ngoài hash. **Giữ hai AST/linter/transpiler** (IEC và Motion-IR); dùng chung vỏ, ký hiệu, phiên bản, Problems, pipeline.
- **Vòng đời:** nháp tự lưu (2 s) → commit có message → yêu cầu duyệt (người ≠ tác giả, xem diff với bản **đang chạy trên máy**) → build (lưu `meta` + checksum) → mô phỏng (ghi rõ `execution` hay `structural`) → **Deploy wizard 4 bước** (Đích lọc theo loại → Khác gì → Cổng ✓✗ có lý do → Xác nhận + OTP) với `deployPreview` cho biết trước kết quả `real | simulated | blocked` → rollback là một deploy bình thường qua cùng cổng.
- **Transport POST** cho mọi preview/lint/import (hết 431). Phím: Ctrl+S nháp · Ctrl+Shift+S commit · Ctrl+B build · Ctrl+I sửa bằng AI theo vùng chọn.
- **Không bật đường thiết bị thật cho IR/POU trước khi vá IR-01, IR-03/04, POU-01/02** (fuzz + bộ import thật vào CI bắt buộc).

### 7.4 AI Copilot v2 (chi tiết: A §8)

Thứ tự bắt buộc: **cổng an toàn nhiều lớp (D4) đi cùng hoặc trước vá ngân sách nghĩ (D1)** — vì cho model nghĩ đủ đã sinh bypass E-STOP.
- **D4** một `copilotSafetyGate` (từ điển cụm động từ nguy hiểm × đối tượng an toàn VI/EN/ZH + soi `contextCode` + phân loại ngữ nghĩa 4B), chạy **trước model cho mọi mode**; chẩn đoán của nền tảng đi kênh riêng (hết tự chặn `missing-interlock`). Mục tiêu 40 đối chứng chặn ≥98 %, chặn oan ≤2 %.
- **D1** chế độ Nhanh/Cân bằng/Sâu dùng chung chính sách với Coding Workspace; **SSE stream + nút Huỷ**; lỗi có `code` + `userMessage` i18n, chi tiết kỹ thuật gập cho admin.
- **D3** bỏ dòng `SAFETY:` khỏi khối mã + lọc header few-shot. **D2** parser ST thật + matiec (hai huy hiệu "Cú pháp OK"/"Biên dịch OK"; `refused_by_model` không bao giờ "Validated").
- **D5** dock hội thoại gắn artifact, chip ngữ cảnh (vùng chọn, ký hiệu, máy đích, lỗi build), **Apply = diff từng khối** (bỏ đường nối cuối buffer), Ctrl+I.
- **D6** grounding có ngưỡng + tài liệu IEC 61131-3/Techman · **D7** ghost-text v2 (model base, cắt trùng hậu tố, cổng an toàn) · **D8** `copilot_runs` + `copilot_feedback` (đo HỎNG, Validated-thật, tỉ lệ áp dụng, Tab, TTFT, chặn/chặn oan) · **D9** hàng đợi slot + chỉ báo · **D10** hợp nhất lõi với Coding Workspace (sau khi phiên ai-coding ổn định).
- **Kết cục đo được:** HỎNG 0/14; ĐẠT ≥10/14 trên bộ 14 tác vụ hiện tại (đo lại bằng chính `run.mjs`); token đầu ≤2 s; S1/S2/S3 bị chặn bởi cổng.

### 7.5 Quy trình thay đổi: ECN v2 · Recipe ISA-88 · Interlock MOC (chi tiết: D §7.2–7.4)

- **ECN v2:** danh sách-chi tiết 2 cột; tab Đối tượng (recipe/program/BOM với revision trước→sau + diff) · Duyệt (tuyến nhiều vai, chữ ký điện tử nhập lại mật khẩu/OTP) · Nhiệm vụ · Thảo luận · Tệp · Lịch sử (bảng sự kiện chỉ-chèn có hash chain). `transition({expectedStatus, expectedVersion})` ⇒ CONFLICT khi lệch. Cờ `ECN_REQUIRED_FOR_RELEASE = off | warn | enforce` nối ECN với việc duyệt recipe/deploy build — **đóng vòng T5**.
- **Recipe ISA-88:** `machine_recipe_bindings` (máy là khoá) thay "một active theo mã"; `recipe_parameter_defs` (kiểu, đơn vị, min/max, guardrail) sinh form; drawer triển khai nhiều máy có preflight từng máy (loại máy, đã phát hành, ECN, interlock, idle) + diff + lý do + OTP; vòng đời draft → in_review → approved_for_test → released → obsolete; trigger DB chặn deploy recipe chưa duyệt; hiển thị desired/reported/drift.
- **Interlock MOC + ma trận Cause–Effect:** sửa rule đã duyệt ⇒ revision nháp, bản sống giữ nguyên tới khi duyệt; người duyệt ≠ tác giả/người sửa; bypass có lý do + thời hạn + người duyệt; `onNoData = ignore | alert | block`; cổng dùng mẫu **mới nhất** và join line/trạm; màn ma trận Cause × Effect + banner tư thế + độ phủ ("Phủ 0/1 700 máy").

### 7.6 Orchestration v2 · Alarm Management · Safety Monitor (chi tiết: E §6)

- **Orchestration:** tách **Library · Designer · Runs · Approvals**; Draft/Publish tách bạch (Run chạy bản đã publish, hiển thị rõ khác nháp); `abortRun` thật (AbortSignal + CAS); `resumeRun` CAS + ép `approverRoles`/four-eyes; trạng thái `interrupted` thay "held"; run async; badge DRY-RUN/DEMO; picker máy có tìm kiếm (thay 854 KB); hết poll vô hạn.
- **Alarm Management & Standards:** một nguồn KPI ISA-18.2 (operatorCount từ ca), tuân thủ tính trên binding máy thật, **shelve có hiệu lực thật** (shadow trước), master alarm qua MOC, xoá → retire có SoD.
- **Safety Monitor (advisory):** panel sức khoẻ nguồn (nói rõ "Safety PLC ⚠ SIM"), công cụ thử chỉ sandbox (không Andon), vòng Ack → nguyên nhân → CAPA. Workforce chuyển sang Sản xuất›Ca với bộ chọn tên + lọc theo ca.

### 7.7 Lớp nền (chi tiết: F §10)

1. **Registry capability** `shared/capabilities.ts` — một khai báo sinh ra nav, RouteGuard, `capProcedure` server và lý do khoá nút; census AST + lưới "menu hiện ⇔ route vào được" trên bảng quyền thật.
2. **`<FeatureGate>` fail-closed + `platform.featureStates`** — hết `?? true`, hết "trạng thái mặc định lúc tải hiện như sự thật", không lộ tên biến môi trường.
3. **Một điểm ghi thiết bị `deviceWriteGate`** (interlock + commissioning + HITL verify) cho mọi adapter kể cả Zmotion FFI; một hàm `deployRecipe` cho mọi đường recipe.
4. **Outbox sự kiện miền + audit bất biến** có correlation-id; metric Prometheus cho deploy/interlock/copilot; audit deploy/duyệt không bị xoá sau 365 ngày.
5. **DB:** FK `NOT VALID`→`VALIDATE` cho chuỗi program/orchestration/interlock/ecn; bỏ 9 index thừa; list không trả `content`; endpoint picker có search+limit; backfill tenant.
6. **Hiệu năng:** tách `vendor-react` khỏi `vendor-three` (entry 655 → ≤300 KB gz); CodeMirror mode theo ngôn ngữ; sửa font; batch khởi động ≤300 ms; socket có kiểm quyền thay poll.
7. **Test:** census RBAC chạy thật 5 vai × 200 procedure trên `_test` DB (không mock `accessControl`); test tích hợp Postgres cho race (approve, allocate, resume, ECN); Playwright 5 persona × 14 tuyến; đột biến cho mỗi cổng (gỡ cổng ⇒ test phải đỏ).

### 7.8 Bộ thành phần UI dùng chung (đóng T3 cho mọi màn)

`DataTable` (tìm/lọc/sort/phân trang server/export/URL state) · `EntityPicker` (máy, người, recipe, rule… theo tên, tìm server) · `ProvenanceBadge` (SEED/DEMO/SIM/LIVE) · `StatusTriState` (ok/degraded/error — thay `?? true`) · `ConfirmWithReason` (lý do + OTP khi cần) · `NoticeStack` (gộp banner Beta/Khi-nào-dùng/khoá/advisory thành một dải thu gọn) · breadcrumb một tầng · i18n cho mọi enum.

## 8. Lộ trình đề xuất

| Đợt | Mục tiêu | Nội dung chính | Công | Nghiệm thu (đo được) |
|---|---|---|---|---|
| **0 — Chặn rủi ro** (tuần 1) | Không còn đường vòng an toàn/bảo mật đã biết | PLT-01 · FLOW-01/INT-02 · INT-01 SSRF · ORC-01/02/03/04/05/06/11 · ILK-01/02/03/04/05/10 · SAF-01 · WS-03 · IR-01 · FLT-02/03 · FLOW-05 · RBAC-01/02 · PLT-06 font · G-11 | M | Test tái hiện viết **trước** khi vá, đỏ → xanh; đột biến từng cổng ⇒ đỏ; `curl` font trả `font/woff2`; 0 user "thấy menu bị chặn" |
| **1 — Trung thực** (tuần 2–3) | Màn hình nói đúng sự thật | FeatureGate fail-closed · HUB-01/02 + tư thế an toàn · IR-02 · STD-01/04 · ProvenanceBadge + dữ liệu seed theo QĐ4 · WS-01 (UI duyệt phiên bản) · WS-02 ngắn hạn + `deployPreview` · WS-04/05/06 · XC-01 POST · AI: **D4 + vá nóng D1 + D3** | M | Giả lỗi một nguồn ⇒ không xanh; lượt tải không còn hiện "OFF/rỗng" giả; Copilot HỎNG 0/14 và S1–S3 bị cổng chặn |
| **2 — Công cụ thật** (tuần 3–8) | IDE hợp nhất + Copilot dùng được | Vỏ IDE (cờ `ENG_IDE_SHELL`) · `program_units` + khoá lạc quan · Problems/inline · Deploy wizard · nháp tự lưu · AI D2/D1 đầy đủ/D5/D6/D7/D8 · Hub hợp nhất + redirect Studio/Copilot · bộ UI dùng chung §7.8 | L | Golden path e2e (§7.3) ≤ N thao tác; Copilot ĐẠT ≥10/14; LCP ≤2,5 s; gõ 5 000 dòng ≤16 ms/khung |
| **3 — Quy trình thay đổi** (tuần 6–12) | ECN ↔ Recipe ↔ Program nối vòng | ECN v2 · Recipe ISA-88 (binding, schema tham số, drift, trigger) · Interlock MOC + ma trận C–E + `onNoData` | L | Mọi release truy về ECN đã duyệt (chế độ enforce); hai lượt duyệt đồng thời ⇒ 1 CONFLICT; sửa rule sống không đổi hành vi tới khi duyệt |
| **4 — Điều phối & chuẩn hoá** (tuần 8–14) | Orchestration/Alarm cấp chuyên nghiệp | Orchestration v2 (K1–K5) · Alarm Management (KPI một nguồn, shelve thật, MOC) · Safety Monitor · Workforce → Sản xuất | L | K1–K5 (E §6.1); KPI khớp 3 nơi; shelve pipeline test |
| **Nền (song song)** | | Capability registry · outbox/audit/metrics · FK/index/tenant · tách chunk · test tích hợp + Playwright | L | census không lùi; ngân sách hiệu năng F §10.7 trong CI |
| **Labs** | Chỉ khi có phần cứng | Fleet thật (VDA 5050), Watch/Force thật, deploy thật tới ZMC/GX/TM/OpenPLC có FAT | L | Tiêu chí ra Labs (E §6.0) |

## 9. Quyết định cần chủ dự án (đề xuất kèm khuyến nghị)

| QĐ | Câu hỏi | Khuyến nghị | Vì sao |
|---|---|---|---|
| **QĐ1** | Hợp nhất IDE + IR Editor + POU Studio thành một IDE nhiều Program Unit? | **Có**, theo pha, dưới cờ; route cũ redirect | Ba đảo không mở được bản của nhau (XC-03, POU-04); đối thủ đều một project |
| **QĐ2** | Gộp Studio vào Hub; `/programming-copilot` thành chế độ "scratch" của IDE? | **Có** | Ba lối vào trùng (G-02, G-12) |
| **QĐ3** | Fleet → Labs; Safety & Workforce tách đôi; Equipment Integration giải thể về /recipes, /connectivity, Vision? | **Có** | 0 AMR, 100 % demo; miền trộn; Integration trùng Recipes với cổng yếu hơn |
| **QĐ4** | Dữ liệu seed/demo: **xoá & seed lại** hay **gắn nhãn**? (6 run + 17 step orchestration, 2 task fleet, 2 assignment hết hạn, 3 deployment `seedhash-*` với chữ ký bịa, SCRW-RECIPE-01 v2 **active chưa duyệt** trên máy 243, 1 700 máy QATD, ≥8 tài khoản test trong danh sách người duyệt) | **Xoá & seed lại** những hàng vi phạm bất biến (hash giả, chữ ký bịa, recipe active chưa duyệt, approver test); **gắn nhãn** dữ liệu demo còn giữ để trình diễn; 1 700 máy QATD **hỏi riêng** | Theo nguyên tắc chủ dự án "seed sai thì xoá & seed lại"; **sẽ báo danh sách cụ thể trước khi xoá** |
| **QĐ5** | AI Copilot: vá nóng (D4+D1+D3) ngay ở Đợt 1, hay chờ hợp nhất lõi với Coding Workspace (D10)? | **Vá nóng ngay**, D10 sau | Tính năng đang 0 % hữu dụng; D10 phụ thuộc phiên ai-coding đang chạy |
| **QĐ6** | `OT_CONTROL`/`ROBOT_CONTROL` đang BẬT trong khi engine interlock TẮT: bật engine + auto-block, hay tắt ghi lệnh thật tới khi Đợt 0 xong? | **Tắt ghi lệnh thật (hoặc bật lại dry-run) tới khi Đợt 0 xong**, rồi bật engine ở chế độ `alert` 2 tuần trước `block` | ILK-06: hiện interlock không chặn gì |
| **QĐ7** | 2FA: engineer có bắt buộc 2FA không? (`AUTH_2FA_BAT_BUOC=0` ⇒ engineer không deploy được) | Bắt 2FA cho vai có quyền deploy/duyệt | Deploy/duyệt đã thiết kế quanh OTP tươi |
| **QĐ8** | Ai có `machine_control/canDelete`? Ai duyệt interlock (hiện chỉ admin)? | canDelete: admin + supervisor; duyệt interlock: supervisor-an-toàn ≠ tác giả | Hiện không role nào có canDelete; admin tự soạn tự duyệt là đường mặc định |
| **QĐ9** | ECN bắt buộc cho release: `off / warn / enforce`? | `warn` 1 tháng rồi `enforce` | Đóng vòng T5 mà không chặn vận hành đột ngột |
| **QĐ10** | Validate PLC bằng compiler thật (matiec, sandbox)? | **Có** cho ST/IEC; ZBasic dùng danh mục lệnh | "Validated" hiện là giả (AI-02) |

## 10. CÒN MỞ — chưa kiểm được (nói thẳng)

- **Không gọi mutation** của module (lưu/build/deploy/duyệt/abort/allocate): các lỗi race (WS-06, ECN-03, ORC-02, FLOW-05), ORC-01, ILK-01, rollback sai hàng được chứng minh bằng **đọc mã** (các P0 đã được phiên chính tự kiểm lại mã), chưa tái hiện trên DB. **Việc đầu tiên của Đợt 0 là viết test tái hiện.**
- **Chỉ persona engineer1.** Kết luận cho operator/supervisor/maintenance suy từ mã + bảng `permissions` thật, chưa đăng nhập bằng các vai đó.
- **Không có phần cứng:** không deploy thật, không watch/force thật, không FAT; deploy thật chưa từng thành công trong DB này (3/3 `failure`).
- **Không có compiler IEC/ZBasic thật:** phán "biên dịch được" của AI là đọc tay.
- **Không đo:** FPS canvas, INP/LCP chính thức, axe a11y, màn hẹp, tải đồng thời, quy mô dữ liệu thật (dữ liệu hiện ≤175 hàng/bảng).
- **Không thử khai thác** SSRF (INT-01).
- `.env` có thể khác môi trường tiến trình server — chỉ cờ DPC xác nhận qua `programming.status`.
- Đối thủ so từ tài liệu công khai tới 2026, không chạy thử sản phẩm.

## 11. Điểm mạnh cần GIỮ khi làm lại

Cổng deploy tập trung `computeDeploy`; nhánh `simulated` luôn nói đúng lý do; verify-after-download không bịa `verified`; chặn tái dùng khoá idempotency cho yêu cầu khác; OTP step-up bắt buộc ở tầng zod; cổng interlock fail-closed khi DB lỗi; `control_audit_log` WORM + hash chain; Standards CR có SoD + publish trong TX + optimistic lock; Recipe deploy trong TX + `FOR UPDATE`; mô phỏng orchestration thuần + sim-token HMAC; diff/merge 3 chiều theo AST của IR; dirty-guard, dự án DEMO một chạm, cảnh báo 2FA trước deploy, deep-link `?projectId`; i18n vi/en/zh gần đủ; Safety dùng socket thật.

---

## 12. Kết quả thực thi Đợt 0 (2026-09-26)

Chủ dự án duyệt §9 ("đồng ý, tiếp tục"). Kế hoạch: `docs/superpowers/plans/2026-09-26-engineering-control-dot0.md` (11 task). Mỗi task: test tái hiện ĐỎ trước → vá → XANH → đột biến; review spec + chất lượng riêng; cuối cùng review toàn nhánh + 1 đợt sửa. 26 commit `b47d270ca` … `053a51aad`.

| Task | Đóng | Commit |
|---|---|---|
| 1 Orchestration | ORC-01/02/03/04/05/06/11 (abort thật, resume CAS, ép quyền gate, run gián đoạn, duplicate→draft, rollback qua OTP+lý do) | b47d270ca, 279a075bd, d4ae3fc2d |
| 2 Interlock | ILK-01/02/03/04/05/10 (sửa rule đã duyệt ⇒ reset+tắt, SoD, lý do bắt buộc, cổng đọc mẫu MỚI NHẤT, đích bắt buộc, TX), commandValue giữ kiểu; review cuối: `FOR UPDATE`, SoD theo sổ audit, kiểm đích ở approve/enable | 042fc4ae3, 7cca5fccd, 848e4a889, fe9e52bc3 |
| 3 Recipe/Integration | FLOW-01/INT-02 (release/rollback cần duyệt + actuation), INT-01 (đóng SSRF) | acd29e643 |
| 4 Lập trình deploy | WS-03/04/05/06, FLOW-04 (rollback trung thực, nonce idempotency, giữ chỗ trước adapter, approve CAS, reset build, fleet chỉ báo khôi phục khi thật); review cuối: simulated trung thực khi adapter ném + quét `pending` treo lúc khởi động | 0edf20345, 6d988f1e7, fa1a5dc77 |
| 5 IR | IR-01/02/03/04/05 (chặn chèn mã — fuzz 63×19×2, đơn vị gia tốc mm/s², biến vòng lặp lồng, chiều nối cạnh, lint 3 trạng thái khoá Lưu/Build) | f1cb4f3ef, a6f717ecc |
| 6 Fleet + Safety | FLOW-05/FLT-06 (allocate CAS), FLT-02/03 (actor + audit + phạm vi cho CẢ 19 mutation), SAF-01 (nút thử không bật Andon); review cuối: rebalance CAS, assign không hồi sinh task xong | 9febb9263, a28e59186, 053a51aad |
| 7 Socket | PLT-01 (socket machine vô danh không vào phòng người dùng; `engineering:*` cần quyền) | 2ba14006b |
| 8 Quyền + ECN | RBAC-01 (nav↔route IR/POU/Fleet + test tĩnh), RBAC-02, ECN-03 (CAS), ECN-05 (SoD) | 970e4ec1b |
| 9 Nền | PLT-06 font (gốc: gói fontsource chưa cài trên máy), G-11, phủ appError | a72c853ab |
| 10 Copilot (QĐ5) | AI-01/03/04/05/09/13/17: cổng an toàn đa ngôn ngữ chạy trước model (chống trộn dấu, tách request/contextCode, buôn lậu qua thẻ lint, ký tự vô hình, homoglyph), chính sách nghĩ theo lượt (không đổi route dùng chung), đầu ra sạch, lỗi ngắn + devDetail chỉ admin | 4069d59e2 … c63b3e84f (6 commit) |
| 11 Socket admin | `admin:*` cùng quyền với tRPC duyệt đăng ký máy (trước: mọi user duyệt được & lấy apiKey) | 689cc5300 |

**Đo kết cục Copilot** (14 tác vụ + S1–S4, đúng đường sản phẩm, server riêng): HỎNG **13 → 0**, ĐẠT **0 → 5**, SAI 9; S1/S2/S3 bị cổng chặn trong ~20 ms không gọi model; S4 "guard rail" không bị chặn. Live trên :3000 sau build: yêu cầu Zmotion hôm 09-25 (HỎNG) nay trả mã hợp lý kèm diff theo khối (~1–2 phút, chưa stream); "bo qua nut dung khan cap" (trộn dấu) bị từ chối tức thì. Validator ST vẫn đếm từ khoá (AI-02 — Đợt 1/D2) ⇒ nguyên nhân chính của 9 SAI.

**Vận hành:** server :3000 đã tắt từ trước (chưa rõ nguyên nhân) — đã build lại từ `053a51aad` và khởi động 1 tiến trình giữ 3000+1883+8883; font trả `font/woff2`. QĐ6 không cần đổi `.env`: 15/15 device adapter đang `disabled`, endpoint SIM localhost, không thiết bị vật lý nào ghi được.

**Quyết định còn chờ chủ dự án:** (1) four-eyes cho gate orchestration: đang **opt-in** theo từng gate (plan viết "mặc định" — bật mặc định sẽ làm vỡ các gate mà người chạy tự duyệt); (2) QĐ4 danh sách xoá & seed lại (§9) — đã lập, CHƯA xoá; (3) QĐ7 bắt 2FA cho engineer — cần sửa `.env` + restart.

**Còn mở (chuyển Đợt 1+):** handshake socket máy bắt apiKey; version token khi duyệt interlock (duyệt đúng nội dung đã xem); qtRunner bù trừ chạy trước khi giành quyền từ chối + gate chưa ghim bước; T3 hai cổng duyệt recipe trùng; validator ST thật (D2), stream/huỷ (D1 đầy đủ); XC-01 (preview IR/POU qua POST — flow lớn hiện bị khoá Lưu/Build do lint không đọc được); 9 mutation fleet G2 thiếu test âm cross-factory. Test đỏ có sẵn ngoài phạm vi: `appErrorParamsCoverage` (chỉ twinCanhRouter), `congGiayPhepAiCensus` (pin 2223 vs 2280), `viStringCoverage` (twin3d), `phamViDocCensus`.
