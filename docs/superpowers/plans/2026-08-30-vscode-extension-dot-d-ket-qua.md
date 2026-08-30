# Đợt D — kết quả (vòng lặp tác nhân đa bước ở client + đo tỉ lệ tuân thủ giao thức)

Kế hoạch: `2026-08-30-vscode-extension-dot-d.md` · Spec: `../specs/2026-08-28-vscode-extension-ai-local-design.md` (§5.3, §5.4, §10)
Sổ chi tiết: `.superpowers/sdd/2026-08-30-vscode-extension-dot-d/progress.md` + `task-*-report.md`
Nền: Đợt A `78a753c8` · Đợt B `0cbd1dd5` · Đợt C `55d85632` (268 lưới, mig tới 0343).
Base khi bắt đầu Đợt D: `47b01827` (nhánh `feat/hmi-dep`). HEAD khi viết tài liệu này: `cc1a121e`.

## Đã giao

| Task | Commit | Ghi chú |
|---|---|---|
| 1 Bộ tách hàng rào dùng chung + `docYeuCauDoc` | `f52d7531` | 11/11 ca cũ của `deXuatCucBo.ts` CÒN XANH sau khi chuyển dùng chung; đột biến `null` đỏ ở CẢ BA tệp lưới |
| 2 Ba tool ĐỌC cục bộ + hàng rào gửi 2 tầng | `82f2c5ca` → fix `a61dd361` | Đo đĩa thật 13/13 ĐẠT; vá `.git/**` phải đóng khỏi đường ĐỌC (R-D4) |
| 3 Vòng lặp tác nhân ở client (`buocKeTiep`) | `3e4e987f` | Quyết định THUẦN tách khỏi thực thi; trần dùng lại `kepTranVong` (không tự đặt hằng số) |
| 4 Nút Dừng cắt cả SSE lẫn vòng lặp | `998a3436` (dọn nhánh chết) → `3eee0981` | Đo bằng bundle+fetch giả: dừng giữa vòng 2, `AbortError` không bị khai lỗi |
| 5 `@`-mention chỉ tệp | `9204475a` → fix `cc1a121e` | Đo trên đĩa thật: mật khẩu giả trong `.env` không rò dù một mảnh |
| 6 Nghiệm thu LIVE + đo tỉ lệ tuân thủ | — (tài liệu này) | Toàn bộ dưới đây |

**Bất biến giữ nguyên suốt Đợt D:** census `loi/census.unit.test.ts` **19/19 XANH** sau mỗi task —
đúng MỘT `applyEdit`/`WorkspaceEdit` tại `ui/apBanVa.ts`, mọi `fs.*` ghi/xoá/chép trên toàn bundle
= 0. Đợt D không mở đường ghi nào (T2/T3 chỉ đọc; T4 chỉ huỷ; T5 tái dùng `doc_tep`, không đường
đọc riêng). Trọn bộ lưới 373/373 xanh, `ext:check` sạch (đo lần cuối ở Task 5).

---

## ★★★ Task 6 — Nghiệm thu LIVE + đo TỈ LỆ TUÂN THỦ GIAO THỨC

Server AI thật tại `http://localhost:3000`, tài khoản `engineer1`/`User@123`, model 30B cục bộ
thật. Harness: bundle THẬT `src/ui/bangChat.ts` (esbuild, external CHỈ `vscode`) + `vscode` GIẢ
(workspace thử trên **đĩa thật**, `findFiles` đệ quy thật) + đăng nhập THẬT (bundle riêng
`src/mang/dangNhap.ts`) + **`fetch` KHÔNG bị giả** — mọi request (đăng nhập, hỏi model) đi THẬT
tới server đang chạy, chỉ bị **TAP** (chép lại url+body TRƯỚC khi gọi fetch thật) để soi hàng rào
gửi. Script + toàn bộ output thô: `<scratchpad>/t6-live.cjs`, `<scratchpad>/t6-luot-*.txt`,
`<scratchpad>/t6-vong-tran.txt`, `<scratchpad>/t6-day-giao-thuc.txt`,
`<scratchpad>/t6-hangrao-*.txt`, `<scratchpad>/t6-nut-dung.txt`, `<scratchpad>/t6-chan-doan-dung.json`.

Workspace thử: `<scratchpad>/t6-ws/` — vài tệp `.ts`/`.cs` thật mang hằng số/hàm với giá trị BỊA
(không đoán được nếu không đọc), cộng `.env` + `keys/id_rsa` giả cho Step 4. **Không đụng
`sandbox-projects/`.**

### Step 2 — TỈ LỆ TUÂN THỦ GIAO THỨC trên 11 lượt hỏi thật

**Kết quả: 0/11 đúng cú pháp · 0/11 sai cú pháp · 11/11 bỏ qua giao thức hoàn toàn.**

| # | Câu hỏi (rút gọn) | Thời gian | Phán quyết |
|---|---|---|---|
| 1 | `LayHeSo()` trong `Calculator.cs` trả về gì? | 11.0s | C — bỏ qua |
| 2 | `Chia()` ném ngoại lệ gì khi b=0? | 12.8s | C — bỏ qua |
| 3 | `SO_LAN_THU_LAI_TOI_DA` bằng bao nhiêu? | 0.5s | C — bỏ qua |
| 4 | `THOI_GIAN_CHO_MS` bằng bao nhiêu? | 0.5s | C — bỏ qua |
| 5 | `TEN_DICH_VU` là chuỗi gì? | 9.9s | C — bỏ qua |
| 6 | `ThueVAT` bằng bao nhiêu? | 0.5s | C — bỏ qua |
| 7 | `TIEN_TO_MA_SAN_PHAM` là chuỗi gì? | 9.6s | C — bỏ qua |
| 8 | `layChuoiKetNoi()` dùng port mặc định nào? | 8.2s | C — bỏ qua |
| 9 | Tệp nào trong `src/modules/` có `LayGiaTriBiAn()`? | 1.8s | C — bỏ qua |
| 10 | Chuỗi hiếm `MA_DU_AN_BI_MAT_TG7788` nằm ở tệp nào (grep)? | 11.6s | C — bỏ qua |
| 11 | `README-internal.md` ghi phiên bản nội bộ gì? | 11.1s | C — bỏ qua |

Mỗi lượt được phán quyết bằng **hai tín hiệu THẬT**, không phải cảm tính: (a) văn bản vòng 1 (dựng
lại nguyên byte từ các tin `token` mà `panel.webview.postMessage` nhận — cùng chuỗi
`apDungSuKienChat`/`ketLuanLuotChat` dùng để tạo `traLoiCuoi` thật) có chứa chuỗi `"avi-tool"`
không; (b) có tin tiến độ `"vòng 1/3 — đang đọc/liệt kê/tìm…"` không — tin này CHỈ được
`bangChat.ts` phát SAU khi `docYeuCauDoc` (bộ tách hàng rào **thật**, `khoiAviTool.ts`) đã nhận
diện và **thực thi** ≥1 yêu cầu đọc. Cả 11/11 lượt: cả hai tín hiệu đều KHÔNG — model không hề thử
phát khối `avi-tool`, không có lượt đọc nào chạy.

**Kiểu sai của cả 11 lượt: KHÔNG PHẢI "sai cú pháp"; là BỎ QUA GIAO THỨC HOÀN TOÀN.** Model trả lời
theo đúng persona "Trợ lý kỹ thuật SYNAPSE on-prem cho kỹ sư" (RAG tri thức vận hành nhà máy) — khi
không tìm thấy tài liệu khớp, nó nói thẳng *"Tôi không có thông tin chính xác về câu hỏi này trong
tài liệu hiện tại"* (7/11 lượt), hoặc **BỊA** một cách rất tự tin:

- Lượt 1: bịa hẳn một dòng chân trang `<sub>Đa bước: 2 lượt gọi tool (list_work_orders →
  read_file), 2836 ms.</sub>` — hai "tool" đó (`list_work_orders`, `read_file`) không tồn tại
  trong `avi-tool` protocol lẫn không hề được gọi; con số "2836 ms" cũng bịa.
- Lượt 10 (hỏi grep một chuỗi bí mật): model bỏ qua hoàn toàn câu hỏi, tự bịa một **bài toán số học
  vô can** ("30% của 250 người dùng là bao nhiêu?") rồi giải nó — không liên quan gì tới workspace.
- Lượt 9 (tìm hàm trong `src/modules/`): trả lời *"Không có tệp/thư mục 'src/modules' trong **hộp
  cát repo**"* — thuật ngữ "hộp cát repo" (`AI_REPO_SANDBOX_ROOTS`) chỉ tồn tại ở chế độ SERVER
  (`codingMode:true`) của server, hoàn toàn khác LOCAL — model đang trộn lẫn hai khái niệm nó chưa
  bao giờ được cấp quyền dùng ở đây.
- Nhiều lượt tự bịa "API liên quan"/"Màn hình liên quan"/"Biến cấu hình" không hề tồn tại
  (`/api/ai/local-kb/reload`, `USE_LEGACY_OLLAMA=true`, …) — đúng hành vi mà chính prompt hệ thống
  của persona này RA LỆNH phải làm ("kèm API/schema/cấu hình/CLI cụ thể").

Toàn văn 11 lượt, nguyên byte: `<scratchpad>/t6-luot-01.txt` … `t6-luot-11.txt`.

### ★★★ Nguyên nhân gốc (đọc mã, xác nhận bằng 11 lượt live) — model KHÔNG HỀ ĐƯỢC DẠY giao thức

Đây là phát hiện quan trọng nhất, và nó giải thích vì sao con số ở trên là 0% chứ không phải "thấp":

`bangChat.ts#hoi()` gửi `codingMode: dv.cheDo.loai === "server"` — ở chế độ **LOCAL** luôn là
`false` (đúng thiết kế: server không thấy mã trên máy dev). Nhưng phía server
(`server/services/aiLocalKnowledgeService.ts`), `codingMode:false` đi vào nhánh RAG tri thức vận
hành THÔNG THƯỜNG — `getSystemPromptForRole()` (dòng 1065-1130), một persona
*"Trợ lý kỹ thuật SYNAPSE on-prem cho kỹ sư"* dựng cho hỏi-đáp tài liệu vận hành nhà máy (KPI, quy
trình, cấu hình…). Persona này **không hề nhắc tới `avi-tool`, `doc_tep`/`liet_ke`/`grep`, hay việc
model CÓ THỂ yêu cầu đọc tệp** — grep toàn bộ `aiLocalKnowledgeService.ts` cho các từ khoá đó chỉ
trúng dòng không liên quan. Nhánh "TÁC NHÂN LẬP TRÌNH" thật (`personaSinhMa`/`personaSuaTep`, dòng
~2770+) — persona DUY NHẤT của server có nói tới việc đọc/sửa mã — chỉ được dùng khi
`codingMode:true`, tức chế độ **SERVER**, hoàn toàn khác đường LOCAL mà extension đang đo.

Phía extension, chỉ **một chỗ duy nhất** dạy model cú pháp `avi-tool` bằng cách nhét thẳng ví dụ
JSON vào câu hỏi: `src/loi/cauHoiSuaChon.ts` — nhưng đó là cho **Cmd+K** (sửa đoạn đang chọn, một
lối vào hoàn toàn khác `hoi()` thường), và chỉ dạy **tool GHI** (`de_xuat_sua_doan`), không dạy ba
tool ĐỌC. `nguCanh.ts#dungNguCanh()` (ngữ cảnh gửi kèm mọi câu hỏi bình thường) chỉ nhét nội dung
tệp đang mở/đoạn chọn — **không một dòng nào giải thích model có thể yêu cầu đọc thêm**.

Nói cách khác: **một người dùng gõ câu hỏi bình thường vào bảng chat LOCAL hôm nay nói chuyện với
một trợ lý tra cứu tài liệu vận hành, chưa từng biết mình có công cụ đọc mã.** 0/11 không phải vì
model 30B "không có khả năng" phát đúng cú pháp — spec §5.3 gọi đây là rủi ro model có thể "không
tuân giao thức tự chế", nhưng phép đo cho thấy vấn đề còn sớm hơn thế: **không có giao thức nào
được TRUYỀN ĐẠT cho nó ở đường LOCAL bình thường để mà tuân hay không tuân.**

### Thực nghiệm bổ sung Step 3B — dạy thẳng cú pháp trong câu hỏi (KHÔNG tính vào tỉ lệ ở trên)

Để tách hai giả thuyết ("model không có khả năng" và "model chưa từng được dạy"), một câu hỏi
RIÊNG dạy thẳng cú pháp `avi-tool` (giống hệt cách `cauHoiSuaChon.ts` làm cho tool GHI, áp cho
`doc_tep`) rồi yêu cầu đọc 4 tệp lần lượt. Kết quả (1 lần chạy, không đủ để kết luận chắc chắn,
nhưng đủ để nói rõ nó KHÔNG đơn giản như "dạy là xong"):

Model **CÓ THỬ** dùng đúng nhãn khối và JSON hợp lệ:
```
   ```avi-tool
   {"tool":"doc_tep","args":{"path":"src/modules/ModuleA.ts"}}
   ```
```
— nhưng lồng nó vào MỘT MỤC danh sách đánh số (markdown), khiến CẢ BA dòng của khối rào bị THỤT LỀ
3 dấu cách. Chạy trực tiếp regex thật của sản phẩm (`src/loi/khoiAviTool.ts`:
`HANG_RAO = /```avi-tool\r?\n([\s\S]*?)\r?\n```/g`) lên đúng đoạn văn bản này: **0 khối khớp**,
xác nhận bằng lệnh chạy tay, không suy đoán:

```
Regex thật lấy từ nguồn: /```avi-tool\r?\n([\s\S]*?)\r?\n```/g
Tổng số khối avi-tool mà REGEX THẬT khớp được: 0
```

Regex hiện tại đòi hàng rào ` ``` ` phải đứng ở **CỘT 0** (không dung sai khoảng trắng đứng
trước/sau `\n`) — một hình dạng markdown rất phổ biến khi model được yêu cầu "trả lời từng bước"
(numbered list) phá vỡ điều kiện đó dù JSON bên trong hoàn toàn hợp lệ. Đây CHÍNH XÁC là loại thông
tin brief mô tả là "đáng giá nhất để sửa lời nhắc/parser sau này" — không phải suy đoán, mà đo được
trực tiếp trên một lượt trả lời thật. Toàn văn: `<scratchpad>/t6-day-giao-thuc.txt`.

### Step 3 — vòng lặp ≥2 vòng + trần: KHÔNG QUAN SÁT ĐƯỢC live

Vì 0/11 (và cả Step 3B) không có lượt nào THỰC THI một tool thật, vòng lặp tác nhân client
(`vongTacNhan.ts`/`buocKeTiep`) **chưa từng chạy quá vòng 1** trong bất kỳ cuộc hội thoại LIVE nào ở
Task 6 — không quan sát được một lượt ≥2 vòng thật, và không quan sát được việc chạm trần
`TRAN_VONG_MAC_DINH=3` bằng model thật. Đây là một khoảng trống live thẳng thắn, KHÔNG che giấu.
Cơ chế (thứ tự ưu tiên huỷ/lỗi/hết trần/hết tool, kẹp `kepTranVong`) vẫn đứng trên bằng chứng CŨ:
12/12 lưới đơn vị của `vongTacNhan.unit.test.ts` (Task 3) + kịch bản 2 vòng dựng bằng fetch giả có
kiểm soát của `do-task3.cjs`/`do-task4.cjs` (Task 3/4) — Task 6 không phủ định các bằng chứng đó,
chỉ nói thẳng: **live thật với model thật CHƯA từng chạm được nhánh mã đó**, vì nguyên nhân gốc ở
trên.

### Step 4 — hàng rào gửi trên dữ liệu THẬT: ĐẠT, đo trên body request thật

**4a — câu hỏi tự nhiên "dụ" model grep bí mật.** Model không thử bất kỳ tool nào (đúng mẫu hình
0% ở trên) nên phép đo này không thực sự "ép" được hàng rào grep hoạt động — nhưng vẫn xác nhận:
0 request nào trong kịch bản chứa mật khẩu giả hay khoá giả (vì không có gì được đọc để mà rò). Có
giá trị bổ sung nhưng KHÔNG phải bằng chứng chính cho hàng rào — xem 4b.
Toàn văn: `<scratchpad>/t6-hangrao-grep-tunhien.txt`.

**4b — @-mention CƯỠNG BỨC `.env` + `keys/id_rsa` giả (bằng chứng chính, tất định).** Dùng cơ chế
Task 5: gửi `{loai:"hoi", tepMention:[".env","keys/id_rsa"]}` — buộc `chayToolCucBo({loai:"doc_tep"})`
chạy THẬT trên đĩa thật, bất kể model có hợp tác hay không. Soi **nguyên văn** thân request thật
gửi tới `/api/ai/local-kb/stream` (TAP fetch, không đoán ý định):

```
Mật khẩu giả "SIEU-MAT-KHAU-T6-KHONG-PHAI-THAT-9911" xuất hiện NGUYÊN VĂN? KHÔNG
Mật khẩu giả xuất hiện dù chỉ MỘT MẢNH (15 ký tự đầu)? KHÔNG
Thân khoá riêng giả "MIIFAKEKEYKHONGPHAITHATT6DEMOONLY" xuất hiện? KHÔNG
Có lời khai từ chối/che cho .env hoặc id_rsa (không im lặng bỏ qua)? CÓ
```

Trích nguyên văn field `question` thật gửi cho model:
```
--- @.env: KHÔNG đọc được — tệp nhạy cảm (.env / khoá riêng / chứng chỉ…) — KHÔNG đọc và KHÔNG gửi: "...\.env" ---
--- @keys/id_rsa: KHÔNG đọc được — tệp nhạy cảm (.env / khoá riêng / chứng chỉ…) — KHÔNG đọc và KHÔNG gửi: "...\keys\id_rsa" ---
```
Cả hai tệp bị chặn Ở TẦNG MỞ (không phải chỉ che sau khi đã đọc), và lời từ chối RÀNH MẠCH xuất
hiện trong ngữ cảnh — đúng thiết kế hai tầng của Task 2/R-D2. Toàn văn:
`<scratchpad>/t6-hangrao-mention.txt`.

### Step 5 — nút Dừng giữa chừng: ★★★ BẮT ĐƯỢC MỘT LỖ THẬT, LIVE-ONLY

**Lần chạy đầu của chính script đo mắc lỗi đo (báo cáo trung thực, không giấu):** bấm Dừng sau một
độ trễ CỐ ĐỊNH 4s — với các câu hỏi bucket (c) trả lời trong 0.5–15s, `hoan_tat` thường đã tới
TRƯỚC khi kịp bấm ⇒ "đo được" một kết quả giả (đua thua, không phải cắt giữa chừng thật). Đã sửa:
hàm `hoiRoiDungMotLan` kiểm NGAY TRƯỚC khi gửi `dung_hoi` xem lượt đã `hoan_tat`/`loi` chưa; nếu
rồi thì tự động thử LẠI với một lượt MỚI (tối đa 6 lần, mọi lần thua đều ghi log trung thực) — quy
tắc "khai kết quả mà không đọc kết quả" của chính dự án này áp dụng cho cả phép đo, không chỉ mã
sản phẩm.

**Lượt chạy đúng (0 lần thua đua, bắt được lúc 3740ms sau khi hỏi — model ĐANG STREAM thật, đã
nhận 1 token):**

```
Đã nhận hoan_tat/loi? CÓ
Thời gian TỪ LÚC BẤM DỪNG tới lúc nhận tín hiệu kết thúc: 215ms
Có thong_bao chứa "Đã dừng"? KHÔNG
Số tin "loi" (AbortError có bị khai thành lỗi không)? 1 (**HỎNG**)
Số tin "hoan_tat"? 0
```

**Đây là một REGRESSION THẬT so với cổng ra Task 4** ("Nút Dừng cắt thật; `AbortError` không bị
khai thành lỗi"), và nó **CHỈ lộ ra khi cắt một luồng đang thật sự bay trên mạng thật** — khuôn
`do-task4.cjs` (Task 4) chỉ mô phỏng huỷ TRƯỚC khi có response (`fetch` giả TREO ở Promise chưa
resolve, reject thủ công với `err.name = "AbortError"` tự tay gán đúng chuẩn) — không mô phỏng huỷ
**GIỮA LÚC ĐANG ĐỌC THÂN STREAM** (sau khi đã có response 200, đang giữa các khung SSE).

**Chẩn đoán tận gốc** (script riêng `<scratchpad>/t6-diag-dung.cjs`, bọc trong suốt bộ đọc
`response.body` thật để soi CHÍNH XÁC exception mà `docLuongSse#doc.read()` nhận, không đổi hành
vi): khi `AbortController.abort(lyDo)` được gọi VỚI MỘT LÝ DO TUỲ CHỈNH (đúng những gì
`dungVongHienTai()` làm: `this.huy?.abort(LY_DO_NGUOI_DUNG_DUNG)`, với
`LY_DO_NGUOI_DUNG_DUNG = "nguoi_dung_dung"` — một CHUỖI, không phải `Error`), và signal đó abort
**trong lúc một `reader.read()` của thân response đang treo chờ dữ liệu**, `fetch` gốc của Node
(undici) reject `read()` bằng **CHÍNH GIÁ TRỊ `signal.reason`** — tức chuỗi trần `"nguoi_dung_dung"`
— KHÔNG bọc trong một `Error`/`DOMException` tên `"AbortError"`. Đo được hai lần độc lập, cả hai ra
cùng kết quả:

```json
{"loai":"LOI_KHI_DOC_STREAM","typeofE":"string","giaTriTho":"nguoi_dung_dung","ctor":"String"}
```

`bangChat.ts` bắt lỗi bằng `if ((e as Error).name === "AbortError")` — trên một chuỗi trần,
`e.name` là `undefined`, điều kiện SAI, rơi xuống nhánh 401 (cũng sai) rồi tới nhánh cuối:
`postMessage({loai:"loi", thongDiep: (e as Error).message})` — `.message` trên một chuỗi cũng là
`undefined` ⇒ người dùng thấy một bong bóng "Lỗi:" **KHÔNG CÓ NỘI DUNG**, thay vì "Đã dừng theo yêu
cầu — ở vòng 1." Tái hiện **4/4 lần** (hai lần trong `t6-live.cjs`, hai lần trong script chẩn đoán
riêng) — không phải một lần ngẫu nhiên.

**Không vá** — đúng ràng buộc của task này ("không được sửa mã sản phẩm, đo xong báo trong nghi
ngại"). Ghi rõ ở mục "Nghi ngại" bên dưới, kèm gợi ý hướng vá cho người sửa sau (không phải chỉ
thị): kiểm cả `(e as Error)?.name === "AbortError"` **lẫn** so sánh trực tiếp
`e === dieuKhien.signal.reason && dieuKhien.signal.aborted`, vì đường huỷ-giữa-thân-stream trả về
NGUYÊN VĂN `reason`, không bọc `Error`.

Toàn văn: `<scratchpad>/t6-nut-dung.txt`, `<scratchpad>/t6-chan-doan-dung.json`.

### Step 6 — dọn sạch

```
$ git status --short sandbox-projects/
(rỗng)
```
Toàn bộ workspace thử + script đo nằm trong `<scratchpad>/` (ngoài repo), không tạo/sửa tệp nào
trong `sandbox-projects/`. `git status --short vscode-extension/` không có thay đổi nào do Task 6
gây ra (hai dòng `M` xuất hiện — `thoatHtml.ts`, `diffDeXuat.ts` — là của tiến trình KHÁC đang chạy
song song trên cùng nhánh, `git diff --shortstat` cho cả hai tệp trả về rỗng tại thời điểm kiểm,
xác nhận Task 6 không chạm chúng).

---

## Tổng kết cổng ra Đợt D

| Hạng mục | Kết quả |
|---|---|
| `ext:check`/`ext:build`/lưới đơn vị | Sạch, 373/373 xanh (đo lần cuối Task 5; Task 6 không sửa mã sản phẩm nên không đổi) |
| Census (đúng 1 `applyEdit`, `fs.*`=0) | 19/19 xanh xuyên suốt Đợt D |
| **Tỉ lệ tuân thủ giao thức trên ≥10 lượt thật** | **0/11 (0%) đúng cú pháp · 0/11 sai cú pháp · 11/11 (100%) bỏ qua giao thức** — số THẬT, không chỉnh câu hỏi cho đẹp |
| Vòng lặp hiện tiến độ cho người dùng | Có (`vòng N/3 — đang …`), nhưng **chưa quan sát được live** vì 0% tuân thủ (xem Step 3) |
| Trần vòng lặp chặn đúng | KHÔNG quan sát được live (cùng lý do); vẫn đúng theo lưới đơn vị + kịch bản fetch-giả có kiểm soát (Task 3/4) |
| Hàng rào gửi trên dữ liệu thật | ĐẠT — 4b (cưỡng bức, tất định) xác nhận `.env`/khoá riêng không rò dù một mảnh, có lời từ chối rành mạch trong request thật |
| Nút Dừng cắt thật · `AbortError` không bị khai lỗi | **HỎNG khi huỷ giữa lúc đang đọc thân stream** (khác kịch bản Task 4 đã đo) — xem Step 5, tái hiện 4/4 lần |
| `sandbox-projects/` sạch | CÓ — `git status --short` rỗng |

## ★★★ Bài học phương pháp

1. **"0% tuân thủ" không phải một số đo mơ hồ — nó có NGUYÊN NHÂN đọc được trong mã.** Đường LOCAL
   của extension gọi đúng persona RAG tri thức vận hành (`getSystemPromptForRole`), không phải
   persona tác nhân lập trình (`personaSinhMa`/`personaSuaTep`, chỉ dùng ở `codingMode:true`/
   SERVER). Không có hàng nào trong `nguCanh.ts`/`dungYeuCauStream` dạy model về `avi-tool` cho
   tool ĐỌC — chỉ Cmd+K dạy, và chỉ cho tool GHI. Đo bằng cách đọc mã TRƯỚC khi chạy live giúp diễn
   giải ĐÚNG con số 0% thay vì kết luận sai "model 30B kém" — vấn đề nằm ở chỗ chưa từng dạy.
2. **Lớp lỗi "khai kết quả mà không đọc kết quả" áp dụng cho CHÍNH PHÉP ĐO, không chỉ mã sản
   phẩm.** Lần chạy Step 5 đầu tiên gần như đã khai "nút Dừng không hoạt động (đã dừng=false)" —
   SAI, vì đó là đua thua của chính script (bấm quá trễ so với tốc độ trả lời cực nhanh của bucket
   (c)), không phải lỗi thật. Phải tự kiểm NGAY TRƯỚC khi khẳng định "đã bắt được lúc đang bay",
   không suy diễn từ độ trễ cố định.
3. **Bằng chứng chính cho một hàng rào an toàn phải TẤT ĐỊNH, không phụ thuộc một model hay thay
   đổi ý.** 4a (câu hỏi tự nhiên) không chứng minh được gì về hàng rào vì model không thử tool nào;
   4b (`@`-mention cưỡng bức, tái dùng cơ chế Task 5) buộc đúng đường mã thật chạy bất kể model hợp
   tác hay không — đây mới là bằng chứng chịu được câu hỏi "điều đó có đúng KHÔNG PHỤ THUỘC hành vi
   model không?".
4. **Live-only bug:** một script fetch-giả TỐT (Task 4, `do-task4.cjs`) vẫn có thể bỏ sót một nhánh
   thật nếu nó chỉ mô phỏng ĐÚNG MỘT giai đoạn của vòng đời fetch (huỷ TRƯỚC response) mà bỏ qua
   giai đoạn khác (huỷ GIỮA thân stream) — hai giai đoạn đó, trên Node/undici thật, ném HAI HÌNH
   DẠNG lỗi khác nhau cho CÙNG một `AbortController.abort(reason)`. Không có cách nào bắt được điều
   này ngoài chạy một `fetch` THẬT, trên một kết nối THẬT, và bấm Dừng đúng lúc luồng đang chảy.

## CHƯA xác minh / còn mở — nói thẳng, không tô hồng

1. ★★★ **Chưa từng chạy trong cửa sổ VSCode THẬT** — nợ từ Đợt C, phải do người dùng bấm F5 (ngoài
   phạm vi mọi đợt tới nay, ghi lại theo đúng brief).
2. ★★★ **Cơ chế vòng lặp ≥2 vòng + trần CHƯA quan sát được trên model thật đang chạy live** — chỉ
   có bằng chứng từ lưới đơn vị (`vongTacNhan.unit.test.ts`, Task 3) và kịch bản fetch-giả có kiểm
   soát (`do-task3.cjs`/`do-task4.cjs`). Nguyên nhân: 0% tuân thủ khiến model không bao giờ tạo ra
   yêu cầu đọc thật để vòng lặp có cái để lặp.
3. ★★★ **Nút Dừng khai "Lỗi" rỗng thay vì "Đã dừng" khi huỷ giữa lúc đang đọc thân SSE stream** —
   tái hiện 4/4 lần, chẩn đoán tận gốc (chuỗi `signal.reason` trần không được `bangChat.ts` nhận
   diện là abort). CHƯA VÁ (đúng ràng buộc "không sửa mã sản phẩm khi đang đo" của task này) — cần
   một task riêng.
4. **Thực nghiệm Step 3B (dạy thẳng cú pháp) chỉ chạy MỘT lần** — không đủ để kết luận "dạy là đủ"
   hay "model vẫn không làm được dù có dạy". Kết quả một lần: model THỬ đúng cú pháp nhưng lồng
   trong danh sách đánh số khiến hàng rào cột-0 của regex từ chối. Cần nhiều lần chạy hơn (và có
   thể cả biến thể prompt không ép định dạng danh sách) để tách bạch hai giả thuyết.
5. **Không đo được liệu regex `HANG_RAO` có nên dung sai khoảng trắng đầu dòng hay không** — đây là
   MỘT QUAN SÁT (từ Step 3B), không phải khuyến nghị đã được quyết định; việc nới lỏng đó có thể mở
   một mặt rò khác (ví dụ khối `avi-tool` giả nằm trong một đoạn code mẫu do model trích dẫn) chưa
   được phân tích ở đây.
6. **4a (câu hỏi tự nhiên grep bí mật) không thực sự exercised hàng rào** vì model không thử tool
   nào — chỉ 4b (cưỡng bức) là bằng chứng chịu lực cho hàng rào gửi.

---

# Đợt D.1 — vá ba lỗi live, rồi ĐO LẠI bằng đúng thước cũ

Nghiệm thu D (T6) đo được **0/11** và bắt ba lỗi. D.1 vá cả ba, mỗi lỗi một commit.

## Gốc rễ THẬT của 0/11 — và một chẩn đoán SAI của người điều phối

Tôi (điều phối) ban đầu chẩn đoán: *"persona tác nhân lập trình bị chặn sau `codingMode === true`,
LOCAL gửi `false` nên không được dạy."* **Chẩn đoán này SAI**, và implementer bác bỏ đúng.

Sự thật đo được: `grep -rl "avi-tool" server/ shared/` ⇒ **0 tệp**. `avi-tool` là giao thức
**do extension tự chế**; máy chủ chưa bao giờ biết nó tồn tại, ở bất kỳ persona nào. `codingMode`
chỉ là cá trích đỏ. Extension **bịa ra một giao thức rồi chờ model tuân theo mà không hề dạy**.

★★★ Bài học: 373 ca lưới xanh cho một tính năng mà **model chưa từng được cho biết là tồn tại**.
Lưới đo *cơ chế phía ta*; không ca nào đo *phía kia có hiểu không*.

| Lỗi | Vá | Commit |
|---|---|---|
| 1. Giao thức không được dạy | `dayGiaoThucDoc.ts` sinh văn bản dạy **từ cùng nguồn** với parser (`khoiAviTool.ts`), chèn ở `yeuCau.ts` | `047d8383` |
| 2. Hàng rào đòi cột 0 | Chấp nhận hàng rào **thụt lề** (CommonMark), gỡ thụt lề nội dung; phủ nhánh đóng lệch + CRLF | `fa5dddf1` |
| 3. Dừng khai lỗi rỗng | Nhận diện huỷ bằng **`AbortSignal.aborted` của controller ta cầm**, không theo hình dạng đối tượng reject | `941017c4` |

## Số đo lại — và phép ABLATION

**Tuân thủ: 0/11 → 10/11 A · 0/11 B · 1/11 C.** (Vòng 1 chèn ở đầu prompt chỉ được 1/11; thêm câu
nhắc **cuối** prompt mới lên 10/11 — vị trí của lời dạy quan trọng ngang nội dung.)

★★★ **Ablation chứng minh nhân quả**: gỡ đúng 2 dòng chèn, build lại bundle, xác nhận chuỗi dạy
không còn trong bundle, chạy lại 5 câu ⇒ **0/5 A, 5/5 C** — sập về đúng baseline. Con số đẹp đến từ
đúng bản vá, không từ chỗ khác. (Người điều phối đã tự đếm lại tệp thô: 10 `A_DUNG_CU_PHAP` + 1
`C_BO_QUA`, ablation 0 A / 5 C — khớp.)

---

# Review TOÀN NHÁNH — lần thứ tám bắt được thứ review-theo-task bỏ lọt

396 ca xanh, census 19/19, `ext:check` sạch — **trong khi ba lỗi nghiêm trọng còn nguyên**.

| # | Lỗi | Vì sao lưới mù |
|---|---|---|
| **H1** | **Đường Cmd+K KHÔNG có hàng rào gửi.** Mở `.env`, bôi đen `DATABASE_URL=…`, Ctrl+Alt+K ⇒ bí mật đi **nguyên văn**. `duocPhepRoiMay`/`cheBiMat` = **0 lần** trong `extension.ts` + `cauHoiSuaChon.ts` (so với 4/3 ở `nguCanh.ts`) | Đây là **đường thứ tư**; lưới chỉ phủ `doc_tep`/`liet_ke`/`grep`/`@`-mention |
| **H2** | **`grep` che theo DÒNG, luật PEM là ĐA DÒNG** ⇒ khoá riêng dán inline trong tệp hợp lệ lọt **thân base64 nguyên văn** | Fixture chỉ dùng bí mật **một dòng**; `id_rsa` bị chặn theo tên nên **nhánh đa dòng chưa từng bị đo** |
| **H3** | **Hồi quy do chính bản vá D.1**: (a) vòng ≥2 **thay hẳn** câu hỏi gốc bằng "KẾT QUẢ TOOL" ⇒ RAG truy hồi sai; (b) D.1 chèn phần dạy ĐỌC vào **mọi** câu kể cả Cmd+K ⇒ model đọc thay vì đề xuất sửa | Phép đo 10/11 hỏi *"model có phát khối không"*, **không** hỏi *"người dùng có nhận được thẻ duyệt không"* |
| M1 | `cauHoiSuaChon.ts` **chép tay** `avi-tool`; docblock `khoiAviTool.ts` **khai sai** rằng nó lấy từ `NHAN_HANG_RAO` ⇒ đổi nhãn ở nguồn thì Cmd+K **chết im lặng**, 396 ca vẫn xanh | Không ca nào nối hai bản sao |
| M2 | **Thứ đã BUILD không phải thứ vừa ĐO**: `dist/extension.js` có **0** lần chuỗi dạy D.1; `.vsix` là bản 29/08 | Census **không soi `dist/`** |
| M3 | `dungNguCanh` bỏ khối vì nhạy cảm mà **không khai** — ngược đúng chiều lỗ `soDaLoaiTruoc` đã vá | — |

**Đợt D.2 vá cả sáu**: `40c18755` (H1, chặn mức TỆP — *không* che nội dung, vì kết quả Cmd+K được
ghi thẳng lên đĩa; che nội dung sẽ ghi rác đè tệp thật) · `5f1de696` (H2) · `b020c25d` (H3) ·
`fc5255a1` (M1) · `08adb5e8` (M3) · `81505f99` (M2, **census nay soi cả bundle đã build**).

**420 ca lưới xanh · census 22/22 · `ext:check` sạch.**

---

# CÒN MỞ — nói thẳng, không giấu

1. ★★★ **Cmd+K chưa chứng minh được đầu-cuối.** Phần client của H3 đã đo bằng **bắt thân request**
   (đúng như thiết kế), nhưng **thẻ duyệt KHÔNG hiện trong 3 lần thử live**. Nguyên nhân nằm ở
   định tuyến **phía server** — tái hiện được cả với câu hỏi thường, không riêng Cmd+K. Vùng đó
   (`server/services/aiLocalTools/`) **đang có tiến trình khác sửa dở** (cây làm việc bẩn), nên
   đợt này **cố ý không đụng vào**. ⚠ Đừng đọc "H3 đã vá" thành "Cmd+K chạy được".
2. ★★★ **Chưa từng chạy trong cửa sổ VSCode THẬT** (nợ từ Đợt C — cần người dùng bấm F5). Đây vẫn
   là cổng trung thực cuối cùng trước khi giao cho lập trình viên.
3. **Server dùng để đo là bản `dist/index.js` lúc 00:29 ngày 30/08** — không nhất thiết khớp mã
   nguồn hiện tại. Mọi con số live ở trên gắn với **bản server đó**.
4. **N=11 là MỘT lần đo**, chưa lặp lại để ước lượng phương sai. Một lượt (lượt 7) treo >13 phút ở
   lần chạy đầu, nghi tranh chấp model với tiến trình khác — nguyên nhân **chưa xác định chắc**.
5. **Hai tool GHI vẫn chưa được dạy** ở đường hỏi thường (ngoài Cmd+K) — ngoài phạm vi Đợt D.
6. Nợ cũ còn nguyên: chưa tạo tệp mới · symlink tệp không kiểm được trên Windows · chuẩn hoá
   EOL/BOM thật của VSCode chưa mô phỏng.

---

# Đợt E — chạy trong VSCode THẬT (trả nợ mở từ Đợt C)

Suốt A→D, **mọi** lưới chạy trên một module `vscode` **GIẢ**. Đợt E dựng
`vscode-extension/test-real-host/` (`@vscode/test-electron`) và chạy trong **extension host thật**.

★ Chỉ thị đầu của tôi (trỏ vào bản VSCode đã cài) **tự tạo ra blocker**: hai tiến trình
`CodeSetup-stable-…` kẹt từ 27/08 giữ mutex `vscode-updating`. Sửa bằng cách để test-electron **tự
tải bản portable** — không đụng tiến trình của người dùng. (Implementer đã đúng khi **không tự ý
giết** hai PID đó.)

## Kết quả: 24 lượt · 22 xanh · 1 ĐỎ · 1 dự đoán BỊ BÁC BỎ

**Xanh — và chỉ VSCode thật mới trả lời nổi:** `activate()` chạy không ném lỗi trong host thật
(**câu hỏi cơ bản nhất, chưa ai từng hỏi suốt bốn đợt**) · **mọi** `contributes.commands` có mặt
trong `getCommands(true)` · ghi đĩa thật qua `WorkspaceEdit`+`save()` (đọc lại bằng `node:fs`,
KHÔNG bằng API vừa ghi) · `asRelativePath` thật **xác nhận quirk thêm tiền tố `app/`** khi ≥2 gốc,
và hàm sản xuất né đúng · `giaiDuongDeXuat` **từ chối** `x.ts` khi cả hai gốc đều có tệp thật.

**Dự đoán bị bác bỏ:** implementer đọc mã và đoán **BOM sẽ rụng** khi sửa dòng 1. Đo thật: **BOM
sống sót** cả khi sửa chính dòng 1 — VSCode giữ BOM như metadata mã hoá, tách khỏi nội dung. Họ tự
ghi nhận đoán sai. *Đây đúng là công dụng của việc chạy thật.*

## ★★★ Ca ĐỎ — lớp lỗi chữ ký, ở một TẦNG MỚI

Tệp EOL **lẫn lộn** `M1\r\nM2\nM3\r\nM4\n`, sửa **mỗi dòng 3**. Đĩa thật:
`M1\nM2\nM3-EDITED\nM4\n` — **dòng 1 bị đổi EOL dù không ai chạm vào nó.**

Gốc rễ: `TextDocument` chỉ mang **MỘT** `eol` cho cả tệp; `save()` **chuẩn hoá toàn tài liệu**.

★★★ `ghepBanVa.ts` giữ EOL **theo từng dòng** và có **lưới đơn vị XANH** chứng minh điều đó. Logic
**đúng** — nhưng **không bao giờ tới được đĩa**. Lưới cũ **đo đúng, nhưng đo nhầm TẦNG**: nó khẳng
định một tính chất mà hệ thống thật vô hiệu hoá. Đây là cùng một lớp lỗi đã cắn dự án tám lần, lần
này ở tầng "lưới thật sự đo cái gì".

**Vá (Đợt D.3, `dcb03cb6`)** — chọn **fail-closed**, KHÔNG mở đường ghi thứ hai:
- Đường (B) "ghi thẳng bằng `fs` cho tệp lẫn lộn" bị **cấm tuyệt đối**: phá bất biến census chịu
  lực nhất (đúng MỘT `applyEdit`, `fs.*` ghi = 0).
- Tệp lẫn lộn ⇒ **từ chối cả lượt**, nói rõ vì sao, **đĩa không đổi một byte**.
- ★ Kiểm đặt **trước khi mở sổ kiểm toán**, không phải sau — mở sổ rồi mới từ chối chính là cách
  Đợt C đẻ ra lỗi 5 và 6 (sổ mở rồi bị đóng sai sự thật).
- **Nhánh kia đã kiểm**: CRLF đồng nhất và LF đồng nhất **vẫn áp vá bình thường** — không cấm tất.
- Lưới `ghepBanVa` **giữ nguyên** (logic chuỗi vẫn đúng, vẫn đáng canh) nhưng **ghi rõ trong tệp**
  rằng tính chất này KHÔNG tới được đĩa, kèm trỏ sang ca real-host.

**434 ca vitest · real-host 15+9 xanh · census 22/22 · `.vsix` đã cài lại** (`st4i.avi-ai-local@0.1.0`,
bundle xác nhận chứa bản vá).

## Còn mở sau Đợt E

1. ★★ **Nghiệm thu phần CON NGƯỜI vẫn chưa làm** — host thật chứng minh extension nạp được, lệnh
   đăng ký đủ, ghi đĩa đúng; **không** chứng minh được người dùng bấm vào thì thấy gì. Cần người
   dùng tự mở VSCode và đi qua checklist trong `that-vscode-report.md`.
2. ★★★ **Cmd+K vẫn chưa hiện thẻ duyệt** (xem phần Đợt D.2 / H3) — nguyên nhân ở định tuyến server,
   vùng đang có tiến trình khác sửa dở.
3. Xung đột phím của keybinding **không kiểm được qua API công khai** — chỉ xác nhận được lệnh tồn tại.
