# Đợt 10.4 — Kiểm định bởi AI ngoài (node + nút + model ngoài trong ô chọn): KẾ HOẠCH

> Phiên **luong-ui** · nhánh `feat/ai-flow-studio` · 2026-10-27 · **DỰ THẢO — chờ dieu-phoi + kiem-dinh + do-model duyệt, CHƯA làm.**
> Spec: `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §5 B5/B6, §6, §9 · Bàn giao: `2026-10-26-dot10-3-bao-cao-nghiem-thu.md` §7 · Hợp đồng máy chủ do **do-model** xác nhận 2026-10-27 (thư gửi luong-ui).
> Người đọc: dieu-phoi (duyệt/gộp), kiem-dinh (rà trước khi làm), do-model (chốt chữ ký phía máy chủ), chủ dự án (§8 quyết định cần có).

## 0. Tóm tắt một đoạn

10.4 đưa AI ngoài tới tay người dùng ở HAI nơi, cả hai **không bao giờ cho AI ngoài công cụ ghi/chạy**: (1) **node Luồng `ai.kiem-dinh-ngoai`** (tự động, Q2), (2) **nút "Nhờ AI ngoài kiểm định"** trên câu trả lời chat + lượt coding/agent (người bấm). Model ngoài vào ô chọn **chỉ ở bề mặt mà máy chủ khai là dùng được** (`duocDungO`). **Đề xuất (cần chủ dự án gật):** KHÔNG biến model ngoài thành model SINH của Chat/Coding/KB ở 10.4 — nút kiểm định đã phục vụ đúng nhu cầu "AI Local làm xong → AI mạnh hơn kiểm lại"; mở sinh-chữ ngoài là lô riêng 10.4b. Việc phải sửa NGAY (độc lập): ô chọn ở chat/coding/agent/extension hiện **có thể hiện mục `ngoai:` mà máy chủ trả 404** — ẩn cho tới khi máy chủ khai.

## 1. Hiện trạng đã đo (2026-10-27, main `35c8a2835`)

| Việc | Trạng thái |
|---|---|
| `aiChonModel.danhMuc` trả `ngoai:<ncc>:<model>` | CÓ (chỉ khi `AI_NGOAI_ENABLED` + nhà máy `batNgoai` + model `batModel`; `auto` không bao giờ chọn ngoài) |
| Node `ai.llm` / `ai.agent` + `chonModel: "ngoai:…"` | CÓ (qua cổng, `ai.agent` bỏ công cụ ghi/điều khiển) |
| Cổng `goiAiNgoai` + `nguonMuc: {loai:"be-mat", beMat:"chat"|"coding"|"agent-turn"|"v1"}` | CÓ trong kiểu (cổng sẵn sàng cho bề mặt người bấm) |
| KB / chat / coding / agent-lập-trình với `ngoai:` | **404 "chưa cài đặt"** |
| Node `ai.kiem-dinh-ngoai`, nút kiểm định, thủ tục kiểm định | CHƯA CÓ |
| UI cho `aiNgoai.*` (khoá/cấu hình/model/duyệt phiên bản) | CHƯA CÓ ở client (toàn `adminProcedure`); `AISettingsPage` mới có ô nhà máy cho khoá cũ (10.2 bước 6) |
| Client ô chọn | `nhomMuc` chỉ giấu `ngoai` ở bề mặt `luong` (cờ `HIEN_NGOAI_O_LUONG=false`); chat/coding/agent/extension sẽ HIỆN `ngoai:` nếu danh mục có ⇒ chọn xong gặp 404 |

## 2. Quyết định thiết kế đề xuất

**D1 — Hai đường, không thêm đường thứ ba.** Node Luồng (tự động) + nút (người bấm). Cả hai gọi CÙNG một hàm kiểm định phía máy chủ (`kiemDinhNgoai(...)`: lắp prompt + gọi `goiAiNgoai` + kiểm schema) để schema/prompt/lỗi giống nhau.

**D2 — Hợp đồng kết quả MỘT chỗ** (`shared/ai/kiemDinhNgoai.ts`, zod + kiểu, dùng cả server lẫn client):

```
KetQuaKiemDinh = {
  ketLuan: "dat" | "can-sua" | "sai",
  diem: int 0..100,
  banChuanHoa?: string            // ≤ 20 000 ký tự
  loi: { muc: "nghiem-trong"|"vua"|"nhe", moTa: string≤500, viTri?: string≤200 }[]   // ≤ 20
  baiHocDeXuat: { noiDung: string≤500, phamVi: "nguoi"|"du-an"|"nha-may", viDu?: string≤1000 }[]  // ≤ 5
}
```
Kiểm hợp lệ chặt (khoá lạ ⇒ sai; kiểu sai ⇒ sai); **thử lại tối đa 1 lần** với lời nhắc nêu lỗi (như `ai.trich-xuat`), vẫn sai ⇒ lỗi rõ `KIEM_DINH_SAI_SCHEMA` (không lưu kết quả nửa vời). `ketLuan="dat"` mà `loi` có `nghiem-trong` ⇒ coi là sai schema (mâu thuẫn nội tại).

**D3 — Đầu ra của AI ngoài luôn KHÔNG TIN CẬY.** Node: trường kết quả (`kiemDinh`) là dữ liệu thuần; chuỗi trong đó đọc lại bằng `{{ }}` ở node sau là CHUỖI LITERAL (đúng bất biến `ai.ngoai.test.ts` đã có). UI: mọi chuỗi hiển thị bằng `textContent` / Markdown đã lọc (cùng bộ render của chat), **không** `dangerouslySetInnerHTML`; nút "Áp dụng bản chuẩn hoá" KHÔNG tồn tại ở 10.4 (chỉ **Chép**) — áp vào tệp phải đi qua cửa duyệt diff có sẵn, làm ở lô sau nếu cần.

**D4 — Không công cụ cho AI ngoài ở cả hai đường** (theo cấu trúc: yêu cầu kiểm định KHÔNG mang `congCu`). Quy tắc §7 bàn giao ("model ngoài ⇒ bỏ tool ghi/chạy") chỉ có nghĩa ở 10.4b; ở 10.4 nó được thoả bằng cách **không có đường nào đưa model ngoài vào vòng tool**.

**D5 — Phân loại dữ liệu do MÁY CHỦ làm.** Nút kiểm định gửi **ID lượt đã lưu**, không gửi văn bản: máy chủ đọc câu hỏi/câu trả lời/diff từ kho, suy mức (`ky-thuat`/`van-hanh`: câu trả lời mang trích dẫn KB hoặc kết quả tool ⇒ `van-hanh`). Chỉ nguồn **không có kho** (bong bóng chat, extension) dùng nguồn `van-ban` (văn bản tự dán ⇒ `ky-thuat`, trách nhiệm người dán — spec §9, UI ghi rõ).

**D6 — Người bấm thấy TRƯỚC khi gửi.** Hộp xác nhận hiện: model + nhà cung cấp, **mức dữ liệu** máy chủ suy (`ky-thuat`/`van-hanh`; `van-hanh` mà nhà máy chưa cho ⇒ nút gửi vô hiệu + lý do), số token ước + chi phí ước (nếu có bảng giá), câu "nội dung được che trước khi rời máy; tự dán = trách nhiệm người dán". Cần thủ tục đọc `xemTruoc` (§4 T1).

**D7 — Model ngoài ở ô chọn theo `duocDungO`.** Mục danh mục `ngoai:*` mang thêm `duocDungO: ("luong"|"kiem-dinh"|"chat"|"coding"|"agent")[]`; máy chủ điền, client lọc theo bề mặt. 10.4 máy chủ khai `["luong","kiem-dinh"]`. Nhờ vậy 10.4b mở bề mặt mới chỉ cần đổi máy chủ, không sửa client.

**D8 — Phiên bản luồng có node ngoài phải được duyệt (`aiNgoai.duyetNgoai`).** Hiện chưa có UI ⇒ người dùng gặp `NGOAI_CHUA_DUYET` mà không biết làm gì. 10.4 thêm banner + nút duyệt trong Flow Studio (xem T5).

## 3. Phân việc

| Phần | Chủ | Ghi chú |
|---|---|---|
| Server: hàm `kiemDinhNgoai` + node `ai.kiem-dinh-ngoai` + census (`PHAN_LOAI_NGUON_NUT`, hạng `ngoai-ghi`, `kiemThamSoNut`, `xuatNhap`) | **do-model** (đã nhận 2026-10-27) | chữ ký §4 |
| Server: thủ tục `aiKiemDinh.{xemTruoc,chay}` (MOD_AI, KHÔNG admin) | do-model | §4 |
| Server: danh mục thêm `duocDungO` | do-model | tương thích ngược (trường thêm) |
| Client: mọi thứ còn lại (T0, T2–T6) | **luong-ui** | |
| Rà độc lập mỗi lô | kiem-dinh | trọng tâm: D3, D5, D6, phạm vi nhà máy, chống XSS ở hộp kết quả |
| 10.4b (model ngoài làm model SINH của chat/coding) | **KHÔNG làm** nếu chủ dự án không gật (§8-Q1) | |

## 4. Chữ ký đề xuất cho do-model (xin xác nhận/sửa)

**T1a. Thủ tục `aiKiemDinh.xemTruoc`** (`moduleProcedure("MOD_AI")`, query):
```
input:  { chonModel: /^ngoai:…$/ (CHON_MODEL_RE nhánh ngoai), nguon: Nguon, tieuChi?: string≤2000 }
output: { duocPhep: boolean, lyDo?: MaLoiNgoai,
          mucDuLieu: "ky-thuat"|"van-hanh", tokenUoc: number, chiPhiUocUsd: number|null,
          nhaCungCap: string, model: string, dinhKemBiCam: boolean }
```
**T1b. `aiKiemDinh.chay`** (mutation, cùng input) ⇒ `{ ketQua: KetQuaKiemDinh, vet: { nhaCungCap, model, tokenVao, tokenRa, chiPhiUocUsd|null }, callId }`. Lỗi: bảng `MaLoiNgoai` §4 báo cáo 10.3 + `KIEM_DINH_SAI_SCHEMA` (đề xuất 502).
```
Nguon =
  | { loai: "chat",   cuocTroChuyenId: number, tinNhanId: number }     // /ai-chat (đã lưu)
  | { loai: "agent",  runId: string, chiSoTin?: number }               // lượt agent (sổ lượt chạy)
  | { loai: "coding", projectId: string, luotId: string }              // lượt hỏi–đáp màn lập trình (nếu đã lưu — do-model xác nhận có kho nào)
  | { loai: "van-ban", cauHoi: string≤20000, traLoi: string≤50000 }    // CHỈ khi không có kho: bong bóng, extension; coi `ky-thuat`, tự dán
```
Máy chủ kiểm: người gọi **sở hữu** lượt (hoặc admin trong phạm vi), lượt thuộc nhà máy trong phạm vi (ngoài ⇒ `NOT_FOUND`), model ngoài đã `duocDungO` chứa `"kiem-dinh"`. Không nhận `congCu`, không nhận đính kèm.

**T1c. Node `ai.kiem-dinh-ngoai`** (`typeVersion 1`, `tacDungPhu:"ngoai-ghi"`, `lapLai:"atMostOnce"` — gọi trả phí, không lặp):
- tham số: `chonModel` (BẮT BUỘC, chuỗi cố định `ngoai:…`, kiểm lúc lưu — vắng/không phải ngoai ⇒ lỗi lưu), `cauHoi` (biểu thức/chuỗi), `traLoi` (biểu thức/chuỗi), `tieuChi?`, `truongRa` (mặc định `kiemDinh`), `maxTokens?`.
- đầu ra mỗi item: `{ ...item.json, [truongRa]: KetQuaKiemDinh, [truongRa+"Vet"]: {nhaCungCap, model, tokenVao, tokenRa} }`.
- `PHAN_LOAI_NGUON_NUT["ai.kiem-dinh-ngoai"] = "ke-thua"` (đầu ra suy từ đầu vào); `chayThuNut` đóng (như node ngoài khác: `NGOAI_CHUA_DUYET`); `xuatNhap`: bỏ `chonModel ngoai:*` + việc "chon-model" (đã có).

**T1d. Danh mục:** thêm `duocDungO` cho mục `ngoai`.

## 5. Phần client (luong-ui)

| Lô | Nội dung | Phụ thuộc |
|---|---|---|
| **T0** (làm ngay, nhỏ) | `nhomMuc` ẩn mục `ngoai` ở mọi bề mặt trừ khi `duocDungO` chứa bề mặt đó (thay cờ cứng `HIEN_NGOAI_O_LUONG`); danh mục cũ không có `duocDungO` ⇒ coi như `[]`. Ô trong extension: cùng luật trong `chuanHoaDanhMuc`. Test hợp đồng + đột biến. | không (chỉ thêm trường tuỳ chọn) |
| **T2** | `shared/ai/kiemDinhNgoai.ts` (zod + kiểu) — **thống nhất với do-model, MỘT bản** (server import từ `shared/`). Kiểm thử schema (≥ 25 ca: khoá lạ, kiểu sai, vượt trần, mâu thuẫn dat/nghiem-trong). | thoả thuận chữ ký |
| **T3** | Form node `FormKiemDinhNgoai` trong `NodeConfigPanel` (thêm vào `CO_FORM_CO_KIEU` + hợp đồng `formNutMoi.hopDongMayChu`): ô model CHỈ liệt kê `ngoai:*` (`duocDungO ∋ "luong"`), biểu thức cho `cauHoi`/`traLoi` (gợi ý `{{ $json.… }}`), `tieuChi`, ô Model ngoài tại các node `ai.*` khác bật theo `duocDungO`. Ghi chú bắt buộc trong form: "mỗi PHIÊN BẢN luồng có node ngoài phải được duyệt; số liệu vận hành ra ngoài chỉ khi nhà máy cho phép; kết quả AI ngoài là dữ liệu không tin cậy". i18n vi/en/zh. | T1c, T2 |
| **T4** | `NutKiemDinhNgoai` + `HopKiemDinhNgoai` (hộp xác nhận D6 → chạy → thẻ kết quả: huy hiệu `ketLuan`, điểm, danh sách lỗi theo mức, `banChuanHoa` có nút Chép, `baiHocDeXuat` chỉ HIỂN THỊ ("chuyển vào hàng chờ" là 10.5), vết model/token/chi phí). Gắn vào: câu trả lời `/ai-chat`, thẻ lượt agent + kết thúc lượt coding (`DongThoiGianAgent`), (bong bóng/extension: nguồn `van-ban` — quyết ở §8-Q3). Nút CHỈ hiện khi danh mục có mục `ngoai` với `duocDungO ∋ "kiem-dinh"`. Lỗi `MaLoiNgoai` → câu BẢN ĐỊA chỉ đúng việc phải làm (404 "chưa bật cho nhà máy" … 429 "vượt trần"). | T1a/T1b |
| **T5** | **Duyệt phiên bản có node ngoài** trong Flow Studio: banner "phiên bản này dùng AI ngoài — chưa duyệt" + nút Duyệt (chỉ admin; người khác thấy hướng dẫn nhờ admin); hiện `tuDuyet`/`bam`/`daDuyetTruoc`; lỗi `NGOAI_TU_DUYET_VAN_HANH`/`NGOAI_CHUA_DUYET` thành thông điệp rõ ở nút Bật/Chạy. Cần `flow` trả cờ "có node ngoài + đã duyệt chưa" (xin do-model/`flowRouter`; hoặc client suy từ định nghĩa + `duyetNgoai` read — hỏi). | do-model (đọc trạng thái duyệt) |
| **T6** | e2e production (cổng riêng, DB test) với **nhà cung cấp GIẢ** (`openai_compat` trỏ máy chủ giả trong tiến trình, `host:cổng` khai vào `ai_ngoai_host_noi_bo`): (1) nhà máy tắt ⇒ không có nút/mục ngoài; (2) bật + khoá giả + model ⇒ nút hiện, hộp xác nhận hiện mức dữ liệu, kết quả đúng schema hiển thị; (3) máy chủ giả trả JSON sai ⇒ lỗi rõ, không vỡ UI; (4) chuỗi độc (`<img onerror>`, `{{ }}`) trong `banChuanHoa`/`loi` hiển thị NGUYÊN VĂN, không chạy; (5) luồng có node ngoài: bản chưa duyệt ⇒ chặn + banner; admin duyệt ⇒ chạy, `kiemDinh` có trong output; (6) người ngoài phạm vi nhà máy ⇒ 404. ×3. | T1–T5 |

Mẫu luồng (`kiem-dinh-ngoai`) **không** thêm ở 10.4 — mẫu phải mang `chonModel ngoai:…` cụ thể của một nhà máy, nên chỉ có nghĩa sau khi có ghi chú chọn lại (làm cùng 10.5 khi có đường "đề xuất → hàng chờ").

## 6. Kiểm thử, đột biến, census

- Mỗi lô: DOM/unit + **đột biến bắt buộc** (bỏ lọc `duocDungO` ⇒ đỏ; bỏ kiểm schema ⇒ đỏ; render `innerHTML` ⇒ đỏ; gửi `van-ban` thay vì ID ở nguồn có kho ⇒ đỏ; nút hiện khi danh mục không có ngoai ⇒ đỏ).
- Server (do-model): đột biến "node nhận `chonModel` không phải ngoai ⇒ đỏ", "đầu ra không qua schema ⇒ đỏ", "yêu cầu mang `congCu` ⇒ đỏ", census registry (`phanLoaiNut`), `phamViDocCensus`/`phamViGhiCensus`/`congGiayPhepAiCensus` cho 2 thủ tục mới (ghim ĐO, có ngày), `appErrorParamsCoverage` cho mã mới.
- i18n vi/en/zh + `i18n:check` 0 mới; tsc 0 (heap 12 GB); extension KHÔNG đổi ở 10.4 ngoài T0 (nếu chủ dự án không chọn §8-Q3).
- Gộp: dieu-phoi chạy cổng đủ census sau mỗi mốc (nhớ: không chạy full suite song song — `_test` dùng chung).

## 7. Thứ tự và cổng

`T0` (ngay, độc lập) → thoả thuận chữ ký T1/T2 (do-model trả lời §9) → do-model làm T1 (kiem-dinh rà) song song luong-ui làm T2/T3 trên máy chủ GIẢ → T4 → T5 → T6 e2e → báo cáo nghiệm thu 10.4. Không bắt đầu T3–T6 trước khi kiem-dinh/dieu-phoi duyệt kế hoạch này.

## 8. Quyết định cần có

- **Q1 (chủ dự án / dieu-phoi):** KHÔNG mở model ngoài làm model sinh của Chat/Coding/KB ở 10.4 (đề xuất) — chỉ node + nút kiểm định? Nếu muốn mở: lô 10.4b riêng (máy chủ: định tuyến `ngoai:` ở KB/chat/coding + cờ `choPhepCongCuGhi` mặc định `false`, **không có công tắc bật ở UI**; client: bỏ lọc `duocDungO`) và kiem-dinh rà riêng.
- **Q2:** `chiPhiUocUsd` hiển thị cho MỌI người dùng hay chỉ admin? (đề xuất: hiện cho người bấm — họ chịu trần của nhà máy).
- **Q3:** Nút ở **bong bóng chat** và **extension** (không có kho lượt ⇒ nguồn `van-ban`): làm hay để sau? (đề xuất: để sau — extension 0.4.x, tránh mở đường văn bản tự do ra ngoài khi chưa cần.)
- **Q4:** SoD khi chạy tay luồng có node ngoài (`NGOAI_TU_DUYET_VAN_HANH`): UI chỉ hiển thị mã lỗi + hướng dẫn, không tự tìm người duyệt khác. Đồng ý?

## 9. Câu hỏi cho do-model (cần trả lời để chốt T1/T2)

1. Chấp nhận `shared/ai/kiemDinhNgoai.ts` làm nguồn schema duy nhất? Ai viết (đề xuất: luong-ui viết schema + test, do-model import)?
2. Nguồn `chat` / `agent` / `coding`: kho nào thật sự lưu câu hỏi–đáp (bảng + khoá)? Nguồn nào KHÔNG có kho ⇒ chỉ `van-ban`?
3. `aiKiemDinh` đặt router riêng hay trong `aiNgoai` (mà `aiNgoai` toàn `adminProcedure`)? Đề xuất router riêng `moduleProcedure("MOD_AI")` để người dùng thường bấm được.
4. `xemTruoc` có tốn một lượt gọi mạng/giữ chỗ trần không? (đề xuất: KHÔNG — chỉ suy mức + ước token cục bộ, không đặt trước).
5. Đọc trạng thái duyệt phiên bản cho T5: `flow.*` trả thêm `{ coNodeNgoai, daDuyetNgoai, bam }` hay một thủ tục đọc riêng?
6. `KIEM_DINH_SAI_SCHEMA`: mã HTTP/tRPC + khoá i18n do ai thêm?
7. Trần/độ dài: kiểm định gửi cả diff lớn — trần `NGOAI_QUA_LON` 256 KB/chuỗi có đủ? (diff lớn ⇒ UI báo "quá lớn, chọn tệp con" thay vì cắt âm thầm.)

## 10. Rủi ro và giới hạn

- **Rò dữ liệu qua nút:** giảm bằng D5 (máy chủ đọc kho, tự suy mức) + D6 (người thấy mức + xác nhận); vẫn là rào chống NHẦM, không chống cố ý (spec §9).
- **Phản hồi độc:** D3; e2e ca (4).
- **Chi phí:** trần nhà máy (10.3) — UI chỉ hiển thị, không tự đặt trần.
- **Kết luận AI ngoài có thể sai:** UI ghi "ý kiến của AI ngoài, cần người xem xét"; bài học chỉ là đề xuất (10.5 mới có duyệt).
- Ngoài phạm vi 10.4: extension (trừ T0), hàng chờ/duyệt bài học (10.5), fine-tune (G9), áp bản chuẩn hoá tự động vào tệp.
