# Đợt 10.4 — Kiểm định bởi AI ngoài (node + nút + model ngoài trong ô chọn): KẾ HOẠCH v3 (kiem-dinh DUYỆT mở T2–T6)

> Phiên **luong-ui** · nhánh `feat/ai-flow-studio` · 2026-10-27 · **v3** = v2 (`db06bd4d9`) + provenance thật do-model đo (kho chat/coding do CLIENT ghi) + quyết dieu-phoi (coding giữ, `van-hanh` mặc định) + chỉnh C1–C3 của kiem-dinh · **v2** = v1 (`c77235641`) + quyết định dieu-phoi + 7 trả lời do-model + rà kiem-dinh (B1–B9, N1–N4, bảng đột biến). **kiem-dinh đã DUYỆT mở T2–T6 (2026-10-27).** T0 đã xong.
> Spec: `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §5 B5/B6, §6, §9 · Bàn giao: `2026-10-26-dot10-3-bao-cao-nghiem-thu.md` §7.
> Người đọc: dieu-phoi (duyệt/gộp), kiem-dinh (rà), do-model (chữ ký phía máy chủ), chủ dự án (§8).

## 0. Tóm tắt

10.4 đưa AI ngoài tới tay người dùng ở HAI nơi, **không bao giờ cho AI ngoài công cụ**: (1) **node Luồng `ai.kiem-dinh-ngoai`** (tự động, Q2 chủ dự án), (2) **nút "Nhờ AI ngoài kiểm định"** (người bấm) trên câu trả lời `/ai-chat`, lượt agent, lượt coding. Nút gửi **ID của lượt đã lưu** — máy chủ tự đọc, tự suy nhà máy + mức dữ liệu, **mặc định đóng (`van-hanh`) khi không chứng minh được là kỹ thuật**. 10.4 **không nhận văn bản tự do** từ client.
**Quyết định đã có (dieu-phoi 2026-10-27):** (Q1) sinh chữ bằng model ngoài ở Chat/Coding/KB **KHÔNG tuỳ chọn** — chủ dự án đã quyết (Q4 26/10) "ô chọn gồm model ngoài khi admin bật" ⇒ **lô 10.4b BẮT BUỘC ngay sau 10.4** (§6); (Q2) hộp xác nhận hiển thị chi phí ước + phần trần ngày còn lại; (Q3) bong bóng/extension → 10.4b; (Q4) SoD chạy tay chỉ hiện mã lỗi + hướng dẫn.

## 1. Hiện trạng đã đo

| Việc | Trạng thái |
|---|---|
| `aiChonModel.danhMuc` trả `ngoai:<ncc>:<model>` | CÓ (chỉ khi `AI_NGOAI_ENABLED` + nhà máy `batNgoai` + model `batModel`; `auto` không bao giờ chọn ngoài) |
| Node `ai.llm` / `ai.agent` + `chonModel: "ngoai:…"` | CÓ (qua cổng; `ai.agent` bỏ công cụ ghi/điều khiển) |
| Cổng `goiAiNgoai` + `nguonMuc: be-mat chat/coding/agent-turn/v1` | CÓ (mức dữ liệu do CỔNG suy) |
| KB / chat / coding / agent-lập-trình với `ngoai:` | **404 "chưa cài đặt"** → 10.4b |
| Node `ai.kiem-dinh-ngoai`, thủ tục nút | CHƯA (do-model nhận làm) |
| UI `aiNgoai.*` (khoá, cấu hình, duyệt phiên bản) | CHƯA ở client (toàn `adminProcedure`); `AISettingsPage` đã có ô nhà máy cho khoá (10.2 B6) |
| **T0** (ẩn `ngoai:` theo `duocDungO`) | **XONG** — client `2663c2719`; extension 0.4.1 `d200ab348` (đã cài, sha256 khớp). Thiếu `duocDungO` ⇒ []; extension cần CẢ `chat` + `agent` |

## 2. Quyết định thiết kế

**D1 — Hai đường, không thêm đường thứ ba.** Node + nút gọi CÙNG một hàm máy chủ (`kiemDinhNgoai(...)`: lắp prompt + `goiAiNgoai` + `parseKetQuaKiemDinh`).

**D2 — Hợp đồng kết quả MỘT chỗ:** `shared/ai/kiemDinhNgoai.ts` (**luong-ui viết schema + test; do-model import**), kèm **một hàm kiểm dùng chung** `parseKetQuaKiemDinh(raw: unknown): { ok: true; data: KetQuaKiemDinh } | { ok: false; loi: string }` — node và thủ tục đều gọi ĐÚNG hàm này; chuỗi `loi` đi vào lời nhắc thử lại.
```
KetQuaKiemDinh = {                                   // zod .strict() (khoá lạ, __proto__, constructor ⇒ sai)
  ketLuan: "dat" | "can-sua" | "sai",
  diem: int 0..100,
  banChuanHoa?: string ≤ 20 000,
  loi: { muc: "nghiem-trong"|"vua"|"nhe", moTa ≤500, viTri? ≤200 }[] ≤ 20,
  baiHocDeXuat: { noiDung ≤500, phamVi: "nguoi"|"du-an"|"nha-may", viDu? ≤1000 }[] ≤ 5,
}   // TỔNG kích thước kết quả đã chuẩn hoá ≤ 64 KB
```
Luật nội tại: `ketLuan="dat"` mà có lỗi `nghiem-trong` ⇒ sai schema. **Làm sạch TRƯỚC khi kiểm/lưu/hiển thị (B8 + C1 kiem-dinh):** MỌI chuỗi: bỏ ký tự điều khiển + bidi + zero-width (U+202A–202E, U+2066–2069, U+200B–200F), cắt theo trần. **NFKC CHỈ cho trường ngắn hiển thị** (`moTa`, `viTri`, `viDu`, `noiDung`, nhãn) — **`banChuanHoa` là MÃ ⇒ giữ NFC** (NFKC đổi ligature / toàn-độ-rộng / số mũ ⇒ bản chuẩn hoá SAI). Test cả hai (ligature trong `banChuanHoa` giữ nguyên; trong `moTa` được chuẩn hoá). Thử lại **tối đa 1 lần** (lời nhắc nêu `loi`; là LƯỢT TRẢ PHÍ thứ hai, tính vào trần/sổ như lượt riêng — cổng tự làm; hộp kết quả hiện token/chi phí của CẢ HAI — N2); vẫn sai ⇒ `NGOAI_SAI_SCHEMA` (BAD_GATEWAY 502; UI có thể đặt tên hiển thị "kiểm định sai định dạng").

**D3 — Đầu ra AI ngoài luôn KHÔNG TIN CẬY; hiển thị là VĂN BẢN THUẦN (B6–B9).**
- `banChuanHoa` / `moTa` / `viDu` / `noiDung` hiển thị bằng `<pre>`/`textContent`. **KHÔNG dựng Markdown/HTML** (không ảnh tự tải, không liên kết). Nếu sau này cần định dạng ⇒ bộ render phải tắt HTML thô, chặn `![]()`, liên kết chỉ http(s)+`rel="noopener noreferrer"`+hộp xác nhận, không `javascript:`/`data:`/`vbscript:` — ngoài phạm vi 10.4.
- `viTri`: hiển thị ký tự không-ASCII lạ bằng thoát `\uXXXX` (tránh lừa mắt bằng đồng chữ). `viTri` và mọi chuỗi AI khai: CHỈ HIỂN THỊ — không thành liên kết/nút mở tệp/điều hướng (ghi ở đây + test `../../etc/passwd`, `C:\Windows`, `\\server\share`, `file:///`).
- Nút **Chép** bản chuẩn hoá: chỉ đặt clipboard văn bản, kèm **cảnh báo cố định** "Kiểm tra trước khi chạy/dán vào terminal"; KHÔNG tự chèn vào editor/terminal/tệp. **Không có nút "Áp dụng"** ở 10.4 (áp vào tệp phải qua cửa duyệt diff — lô sau).
- **Một bộ hiển thị duy nhất** `HienThiKetQuaNgoai` (N3) dùng cho hộp kết quả, lịch sử chạy luồng, xuất báo cáo; census (quét AST): mọi chỗ render trường từ `KetQuaKiemDinh` phải import bộ này.
- Node: trường kết quả là dữ liệu thuần; chuỗi trong đó đọc lại bằng `{{ }}` ở node sau là CHUỖI LITERAL; đầu ra node đi vào `ai.agent` phía sau luôn trong khối UNTRUSTED (bất biến `ai.ngoai.test.ts` — dẫn chiếu, N4).

**D4 — Không công cụ cho AI ngoài ở cả hai đường** (yêu cầu kiểm định KHÔNG mang `congCu`, không nhận đính kèm). Quy tắc §7 ("chọn model ngoài ⇒ bỏ tool ghi/chạy") thoả bằng cấu trúc ở 10.4; ở 10.4b nó thành cờ máy chủ (§6).

**D5 — MÁY CHỦ đọc kho và tự suy; MẶC ĐỊNH ĐÓNG (B1–B4).**
Nguồn (zod `.strict()` — khoá lạ ⇒ 400; **`chay` KHÔNG nhận `mucDuLieu` / nhà máy / văn bản / `congCu` / đính kèm** ⇒ 400):
```
Nguon =
  | { loai: "chat",   cuocTroChuyenId: number, tinNhanId: number }   // ai_chat_conversations + ai_chat_messages (id serial; userId)
  | { loai: "agent",  runId: uuid }                                  // ai_agent_runs (id uuid; userId, projectId, cauHoi, suKien jsonb, tomTat); đáp = tomTat, rỗng ⇒ tin assistant cuối trong suKien
  | { loai: "coding", phienId: uuid, chiSoLuot: number }             // ai_coding_sessions (id uuid; userId, projectId, turns jsonb); chiSoLuot = lượt ASSISTANT, hỏi = lượt user gần nhất trước nó; phiên chưa lưu ⇒ nút vô hiệu
```
**10.4 KHÔNG có nguồn `van-ban`** (đóng cửa lách B4): bong bóng/extension → 10.4b (kèm cơ chế bề mặt-không-kho do-model đề xuất). Bất biến test DOM: bề mặt có kho **không bao giờ** gọi với `loai:"van-ban"` (không còn khoá đó) + đột biến.
- **Sở hữu:** CHỈ chủ lượt (`userId` = người gọi), **không ngoại lệ admin** (kho không có nhà máy để chặn) ⇒ khác ⇒ `NOT_FOUND`.
- **Nhà máy của dữ liệu (B2):** người gọi phải có **đúng MỘT nhà máy** trong phạm vi (như `/v1`); không có/nhiều ⇒ `NOT_FOUND` — **không lấy "nhà máy đầu"** (an toàn hơn quy tắc "mọi nhà máy phải bật", vì kho không gắn nhà máy). Test chéo: người {A,B} ⇒ từ chối dù A bật.
- **Mức dữ liệu — provenance bắt buộc, thiếu ⇒ `van-hanh`:**

| Nguồn | Ai GHI kho (do-model đo 2026-10-27) | Quy tắc |
|---|---|---|
| **agent** | `ai_agent_runs.suKien` do MÁY CHỦ ghi (`quanLyLuotChay`) — nguồn DUY NHẤT có provenance thật | suy từ TẬP TÊN TOOL đã chạy: chỉ tool MÃ (đọc tệp / tìm mã / tra tài liệu mã) ⇒ `ky-thuat`; **tool lạ/không phân loại ⇒ `van-hanh`** |
| **chat** | `ai_chat_messages` chỉ lưu `{role, content}`; đường stream `aiChat.saveStreamedMessage` nhận câu trả lời do **CLIENT** gửi ⇒ KHÔNG là provenance (cuộc trò chuyện cũng không mang nhà máy) | **luôn `van-hanh`** (kiem-dinh M1: chấp nhận; muốn nới ⇒ lô riêng thêm cột `nguonKb jsonb`, KHÔNG suy từ nội dung) |
| **coding** | `ai_coding_sessions.turns` do **CLIENT** ghi ⇒ KHÔNG là provenance | **`van-hanh` mặc định — dieu-phoi QUYẾT: GIỮ `coding` ở 10.4.** Chỉ chạy khi nhà máy bật `choDuLieuVanHanh`, vẫn qua bộ che. Hộp xác nhận ghi rõ "nội dung lập trình được coi là dữ liệu vận hành"; chưa bật ⇒ nút KHÓA kèm lý do (`xemTruoc` ⇒ `duocPhep:false`, `lyDo: NGOAI_DU_LIEU_VAN_HANH`). Nâng lên `ky-thuat` CHỈ khi có nhật ký lượt do MÁY CHỦ ghi (backlog sau 10.4b) **và** thoả 3 điều kiện kiem-dinh: cờ codingMode đọc từ cột lưu (không từ client), mọi lượt chỉ dùng tập tool ĐỌC repo đóng (không `chay_lenh`), phiên đã lưu |

⇒ **Hệ quả cho người dùng (UI không được hứa ngược lại):** nút ở `/ai-chat` và coding chỉ dùng được khi nhà máy đã bật `choDuLieuVanHanh`; nơi dùng thoải mái không cần quyền đó là **lượt agent chỉ đọc mã**. **Tài khoản thuộc nhiều nhà máy / admin không gắn nhà máy (quy tắc "đúng MỘT nhà máy", B2)** chưa dùng được kiểm định ngoài ở 10.4 — hộp ghi rõ câu "tài khoản thuộc nhiều nhà máy chưa dùng được kiểm định ngoài" để không bị tưởng là lỗi (C2).

`van-hanh` mà nhà máy chưa `choDuLieuVanHanh` ⇒ `NGOAI_DU_LIEU_VAN_HANH` (403) — UI vô hiệu nút + nói rõ lý do, **nhưng rào thật ở máy chủ** (test gọi thẳng thủ tục).
- **`xemTruoc` chỉ là thông tin** (không gọi mạng, không đặt trần); **`chay` TỰ tính lại mọi thứ** (đọc cờ/nhà máy/mức LÚC GỌI), không nhận token/kết quả `xemTruoc`.
- **Chống bấm đúp/lặp (N1):** `chay` có khoá chống lặp (cùng người + nguồn + model trong N giây ⇒ trả kết quả cũ hoặc 409) + nút vô hiệu khi đang chạy; mỗi lần gọi là TIỀN THẬT.

**D6 — Người bấm thấy TRƯỚC khi gửi (Q2):** hộp xác nhận hiện: model + nhà cung cấp, **mức dữ liệu** máy chủ suy, **ước token bi quan ("ước tính bi quan, có thể cao hơn thật 2–4×") + chi phí ước + phần TRẦN NGÀY CÒN LẠI của nhà máy**, kích thước (`kichThuocByte`/`tranByte` ⇒ quá lớn ⇒ "chọn tệp con" **trước** khi gửi; server vẫn chặn 413), câu "nội dung được che trước khi rời máy". Nút gửi vô hiệu khi `duocPhep=false` (chỉ tiện lợi; `chay` tự kiểm).

**D7 — Danh mục:** mục `ngoai:*` mang `duocDungO` (máy chủ điền). 10.4: `["luong","kiem-dinh"]`; 10.4b mở thêm `chat`/`coding`/`agent`. Client: thiếu ⇒ [] (T0).

**D8 — Phiên bản luồng có node ngoài phải duyệt (`aiNgoai.duyetNgoai`).** T5 thêm UI; do-model thêm `flow.chiTiet.ngoai`. **UI phải HIỂN THỊ cái đang duyệt** (danh sách node ngoài: nhà cung cấp/model/tóm tắt lệnh nhắc, mức dữ liệu tĩnh, ai tạo phiên bản, băm) **trước** nút Duyệt; tự duyệt ⇒ cờ rõ + cảnh báo; non-admin không thấy nút (máy chủ vẫn kiểm — test gọi thẳng).

## 3. Phân việc

| Phần | Chủ |
|---|---|
| Hàm `kiemDinhNgoai` + node `ai.kiem-dinh-ngoai` + census (`PHAN_LOAI_NGUON_NUT`, hạng `ngoai-ghi`, `kiemThamSoNut`, `xuatNhap`) + `NGOAI_SAI_SCHEMA` | **do-model** |
| Router `aiKiemDinh.{xemTruoc,chay}` (`moduleProcedure("MOD_AI")`, KHÔNG admin) + khoá chống lặp + 3 census ghim | do-model |
| Danh mục `duocDungO`; `flow.chiTiet.ngoai` | do-model |
| `shared/ai/kiemDinhNgoai.ts` + `parseKetQuaKiemDinh` + test schema | **luong-ui** (do-model import) |
| Toàn bộ client (T3–T6), T0 (đã xong) | luong-ui |
| Rà độc lập mỗi lô | kiem-dinh |
| **10.4b** (§6) | do-model (máy chủ) + luong-ui (UI) — BẮT BUỘC sau 10.4 |

## 4. Chữ ký máy chủ (do-model xác nhận 2026-10-27; mục ★ = cần bổ sung)

- `aiKiemDinh.xemTruoc` (query) — input `{ chonModel: ngoai:…, nguon, tieuChi?: string≤2000 }` (zod strict) → output `{ duocPhep, lyDo?: MaLoiNgoai, mucDuLieu, tokenUoc, chiPhiUocUsd|null, nhaCungCap, model, dinhKemBiCam, kichThuocByte, tranByte, ★ conLaiTranNgay: { nhaMay: { token: number|null, usd: number|null }, nguoi: { token: number|null } } }` (null = chưa đặt trần đó; đọc cùng bộ đếm với cổng, lúc đọc — tham khảo). `duocPhep` chỉ tham khảo.
- `aiKiemDinh.chay` (mutation) — cùng input → `{ ketQua: KetQuaKiemDinh, vet: { nhaCungCap, model, tokenVao, tokenRa, chiPhiUocUsd|null, soLanGoi: 1|2 }, callId, tuBoNho?: true }` (`vet` cộng dồn cả lượt thử lại). **Chống lặp (do-model chốt):** khoá = sha256(userId|nguon|chonModel|tieuChi); đang chạy cùng khoá ⇒ 409 `NGOAI_DANG_CHAY`; cùng khoá XONG trong 120 s ⇒ trả KẾT QUẢ CŨ + `tuBoNho:true` (không gọi, không tính phí); bộ nhớ trong tiến trình (khởi động lại mất — tệ nhất thêm một lần gọi). Lỗi: bảng `MaLoiNgoai` + `NGOAI_SAI_SCHEMA`.
- Node `ai.kiem-dinh-ngoai` (`typeVersion 1`, `tacDungPhu:"ngoai-ghi"`, `lapLai:"atMostOnce"`): tham số `chonModel` (BẮT BUỘC `ngoai:…`, kiểm lúc lưu), `cauHoi`, `traLoi`, `tieuChi?`, `truongRa` (mặc định `kiemDinh`), `maxTokens?`; đầu ra item `{ ...json, [truongRa]: KetQuaKiemDinh, [truongRa+"Vet"]: {...} }`; `PHAN_LOAI_NGUON_NUT = "ke-thua"`; `chayThuNut` đóng.
- `flow.chiTiet.ngoai`: `{ coNodeNgoai, daDuyet, duyetBoi?, duyetLuc?, tuDuyet, toanHeThong, taoBoi, nodes: [{ nodeId, nhaCungCap, model, mucTinh: "ky-thuat"|"van-hanh"|"ke-thua", tomTatLenh }] }` — `tomTatLenh` = 200 ký tự đầu của lệnh/tiêu chí SAU bộ che (không lộ khoá lên màn duyệt); `coNodeNgoai:false` ⇒ chỉ `{ coNodeNgoai:false }`.

## 5. Phần client (luong-ui)

| Lô | Nội dung | Phụ thuộc |
|---|---|---|
| **T0** ✅ | Ẩn `ngoai:` theo `duocDungO` (client + extension 0.4.1) | — |
| **T2** | `shared/ai/kiemDinhNgoai.ts` + `parseKetQuaKiemDinh` + làm sạch + test (≥ 40 ca: khoá lạ/`__proto__`/`constructor`, kiểu sai, vượt trần từng trường, tổng > 64 KB, dat⇒nghiem-trong, bidi/điều khiển, NFKC, chuỗi lồng JSON) | thoả thuận (xong) |
| **T3** | Form node `FormKiemDinhNgoai` (`CO_FORM_CO_KIEU` + hợp đồng `formNutMoi.hopDongMayChu`): ô model CHỈ `ngoai:*` (`duocDungO ∋ "luong"`), biểu thức `cauHoi`/`traLoi`, `tieuChi`; ghi chú bắt buộc (duyệt phiên bản, số liệu vận hành chỉ khi nhà máy cho, kết quả là dữ liệu không tin cậy); ô Model ngoài ở node `ai.*` khác theo `duocDungO`. i18n vi/en/zh | T1c, T2 |
| **T4** | `NutKiemDinhNgoai` + `HopKiemDinhNgoai` (D6) + `HienThiKetQuaNgoai` (D3: `<pre>`, huy hiệu `ketLuan`, điểm, lỗi theo mức, `viTri` thuần chữ, Chép + cảnh báo cố định, `baiHocDeXuat` chỉ hiển thị, vết token/chi phí cả hai lượt). Gắn vào: thẻ lượt agent (`runId`, nguồn duy nhất có provenance thật); câu trả lời `/ai-chat` (`tinNhanId`; luôn `van-hanh`); lượt coding (`phienId`+`chiSoLuot`; `van-hanh` mặc định; chưa lưu ⇒ vô hiệu + lý do). Chat/coding khi nhà máy chưa bật dữ liệu vận hành ⇒ nút KHÓA + lý do rõ (nội dung lập trình được coi là dữ liệu vận hành). Nút CHỈ hiện khi danh mục có `ngoai` với `duocDungO ∋ "kiem-dinh"`. Chống bấm đúp (nút vô hiệu khi đang chạy; 409 `NGOAI_DANG_CHAY` ⇒ "đang chạy, chờ"; `tuBoNho:true` ⇒ nhãn "kết quả đã có từ lần gọi trước — không tính phí lần nữa"; `soLanGoi:2` ⇒ "đã thử lại 1 lần (tính phí hai lượt)"). Hộp xác nhận hiện `conLaiTranNgay` (nhà máy + người; null ⇒ "chưa đặt trần"). Lỗi `MaLoiNgoai` ⇒ câu bản địa chỉ đúng việc phải làm | T1a/b |
| **T5** | UI duyệt phiên bản luồng có node ngoài (D8): bảng node ngoài + mức dữ liệu + người tạo + băm; Duyệt (admin); banner ở nút Bật/Chạy; `NGOAI_TU_DUYET_VAN_HANH`/`NGOAI_CHUA_DUYET` thành thông điệp rõ | `flow.chiTiet.ngoai` |
| **T6** | e2e production, nhà cung cấp GIẢ (`openai_compat` → máy chủ giả trong tiến trình, `host:cổng` khai vào `ai_ngoai_host_noi_bo`) ×3: (1) nhà máy tắt ⇒ không nút/mục ngoài; (2) bật ⇒ nút → hộp xác nhận (mức, ước, trần còn lại) → kết quả đúng schema; (3) JSON sai ⇒ thử lại 1 lần ⇒ vẫn sai ⇒ lỗi rõ, UI không vỡ, token cả hai lượt; (4) chuỗi độc trong `banChuanHoa`/`loi`/`viTri` (`<img onerror>`, `<script>`, `[a](javascript:…)`, **`![](http://127.0.0.1:<cổng>/x)` — đếm yêu cầu tới máy chủ giả = 0**, bidi override, `../../etc/passwd`) hiển thị NGUYÊN VĂN, không phần tử/mạng nguy hiểm; (5) luồng có node ngoài: bản chưa duyệt ⇒ chặn + banner; admin duyệt ⇒ chạy; (6) người ngoài phạm vi/không chủ lượt ⇒ 404; (7) bấm đúp ⇒ một lần gọi | T1–T5 |

Mẫu luồng kiểm định: không thêm ở 10.4 (cần `chonModel ngoai:` cụ thể của nhà máy) — làm cùng 10.5.

## 6. Lô 10.4b — BẮT BUỘC ngay sau 10.4 (dieu-phoi, theo quyết định chủ dự án 26/10 Q4)

Sinh chữ bằng model ngoài ở **Chat / Coding / KB / bong bóng / extension / `/v1`**:
- **Máy chủ (do-model, mục (c)):** định tuyến `ngoai:` ở KB/chat/coding tới `goiAiNgoai` (`nguonMuc: be-mat`, phân loại tại điểm ghép); **tool ghi/chạy (`ghi_tep`, `chay_lenh`, `ap_diff`…) BỊ BỎ mặc định**, chỉ bật lại khi yêu cầu mang cờ TƯỜNG MINH (`choPhepCongCuGhi`, mặc định `false`; **không có công tắc ở UI** — đề xuất); nguồn `van-ban` cho bề mặt không-kho (bong bóng, extension) với cơ chế bề mặt-từ-danh-sách-đóng + kiểm vai; `duocDungO` mở `chat`/`coding`/`agent`.
- **Client (luong-ui):** bỏ ẩn theo `duocDungO` (đã sẵn — chỉ máy chủ đổi giá trị); extension (0.4.x): ô nhận `ngoai:` khi `chat`+`agent`; nút kiểm định ở bong bóng/extension (nguồn `van-ban`, UI ghi "văn bản tự dán = trách nhiệm người dán"); cảnh báo cố định khi chọn model ngoài ở bề mặt có công cụ ("AI ngoài chỉ đọc; công cụ ghi/chạy bị tắt").
- **Yêu cầu bổ sung của kiem-dinh (C3) — đưa vào 10.4b ngay từ đầu:** (1) phân loại mức dữ liệu THEO TỪNG LƯỢT của vòng agent (kết quả tool mỗi lượt lại ra ngoài); (2) tập tool CHỈ-ĐỌC cho model ngoài + **trần byte đọc mỗi run**; (3) **danh sách từ chối tệp nhạy cảm** (`.env`, khoá, `uploads`, `backups`, `*.pem`…) ở lớp SANDBOX (không phụ thuộc bộ che); (4) **trần chi phí MỖI RUN**; (5) test "model ngoài trả tool_call ghi/chạy ⇒ `NGOAI_TOOL_KHONG_CAP`, vòng DỪNG"; (6) `choPhepCongCuGhi` mặc định `false` + KHÔNG có UI (đã nêu). Backlog sau 10.4b: nhật ký lượt coding do MÁY CHỦ ghi (để phân loại `ky-thuat` đúng).
- Kiểm định độc lập riêng (egress ở KB/chat/coding là bề mặt mới).

## 7. Kiểm thử, đột biến, census

**Đột biến BẮT BUỘC (mỗi lô; bỏ ⇒ đỏ):**
- Client: bỏ lọc `duocDungO` ✅(T0); bỏ kiểm schema; render `innerHTML`/Markdown; `viTri` thành anchor; bỏ cảnh báo Chép; nút hiện khi danh mục không có `ngoai`/không có `kiem-dinh`; bề mặt có kho gửi `van-ban` (không còn khoá); bỏ chống bấm đúp; bỏ hiển thị node ngoài ở hộp duyệt.
- Máy chủ (do-model): node nhận `chonModel` không phải `ngoai:`; đầu ra không qua schema; yêu cầu mang `congCu`/đính kèm/khoá lạ ⇒ 400; `chay` tin `mucDuLieu` từ client; **phân loại node mới thành `ky-thuat` thay vì `ke-thua`**; thiếu cột provenance ⇒ phải `van-hanh`; **tool lạ ⇒ `van-hanh`**; người khác/ngoài phạm vi ⇒ `NOT_FOUND` (bỏ kiểm ⇒ đỏ); `xemTruoc` gọi mạng/đặt trần (spy provider/`datTruoc` = 0); cờ nhà máy tắt GIỮA `xemTruoc` và `chay` ⇒ `chay` từ chối; `van-hanh` + `choDuLieuVanHanh=false` gọi thẳng thủ tục ⇒ từ chối; thử lại vô hạn; bỏ khoá chống lặp ⇒ gọi 2 lần; chuỗi `ot.doc → set → ai.kiem-dinh-ngoai` với nhà máy chưa cho vận hành ⇒ `NGOAI_DU_LIEU_VAN_HANH`; chuỗi kiểm-định → kiểm-định giữ taint; người {A,B}, A bật, B tắt ⇒ từ chối.
- T0 bổ sung (đã làm): danh mục cũ không `duocDungO` ⇒ []; mã `ngoai:` đã lưu mà bề mặt không phục vụ ⇒ `auto` + thông báo (không gửi lên máy chủ).
- Census: mục `PHAN_LOAI_NGUON_NUT`; `phamViDocCensus`/`phamViGhiCensus`/`congGiayPhepAiCensus` (ghim ĐO, có ngày) cho router mới; `appErrorParamsCoverage` cho `NGOAI_SAI_SCHEMA`; **census AST: mọi render trường `KetQuaKiemDinh` import `HienThiKetQuaNgoai`** (N3).
- i18n vi/en/zh + `i18n:check` 0 mới; tsc 0 (heap 12 GB); gộp: dieu-phoi chạy đủ census, không full suite song song.

## 8. Quyết định còn mở

- **M1 — ĐÃ ĐÓNG** (do-model + kiem-dinh kiểm schema): chat luôn `van-hanh`; chấp nhận hệ quả; muốn nới ⇒ lô riêng thêm cột `nguonKb`.
- **M2 — ĐÃ QUYẾT** (dieu-phoi): giữ `coding`, `van-hanh` mặc định (xem D5); nâng `ky-thuat` khi có nhật ký lượt do máy chủ ghi + 3 điều kiện kiem-dinh.
- **M3 — ĐÃ CHỐT** (do-model): chống lặp 409 `NGOAI_DANG_CHAY` / kết quả cũ 120 s `tuBoNho:true` (§4).
- **M4 — ĐÃ ĐỒNG Ý** (dieu-phoi): 10.4 gộp mốc riêng, 10.4b sau.

## 9. Rủi ro và giới hạn

- Rò dữ liệu qua nút: D5 (máy chủ đọc kho + mặc định đóng + một nhà máy duy nhất) + D6 (người thấy mức + xác nhận) — vẫn là rào chống NHẦM (spec §9).
- Phản hồi độc: D3 (văn bản thuần) + e2e (4). Chi phí: trần nhà máy (10.3), UI chỉ hiển thị. Kết luận AI ngoài có thể sai: UI ghi "ý kiến của AI ngoài, cần người xem xét"; bài học chỉ là đề xuất — 10.5 **bắt buộc** đi qua người duyệt và **không bao giờ chèn `banChuanHoa`/`baiHocDeXuat` vào prompt Local có tool mà không bọc khối "dữ liệu không tin cậy"** (N4, nhắc lại ở kế hoạch 10.5).
- Ngoài phạm vi 10.4: extension (trừ T0, đã xong), hàng chờ/duyệt bài học (10.5), fine-tune (G9), áp bản chuẩn hoá tự động vào tệp.
