# Đợt 10.4b — Sinh chữ bằng model NGOÀI ở Chat / Coding / KB / bong bóng / extension + nút kiểm định ở bong bóng/extension: KẾ HOẠCH (dự thảo)

> Phiên **luong-ui** · nhánh `feat/ai-flow-studio` · 2026-10-27 · **DỰ THẢO — gửi dieu-phoi + kiem-dinh + do-model; CHƯA làm gì.**
> Căn cứ: chủ dự án (Q4 26/10) "ô chọn model gồm cả model bên ngoài khi admin bật" ⇒ 10.4b **BẮT BUỘC** (dieu-phoi 27/10) · spec `2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §4 A3, §5 B3/B6, §9 · báo cáo 10.3 §7 · kế hoạch 10.4 v3 (§6) · yêu cầu bổ sung kiem-dinh C3 · bài học 10.4 (provenance: kho chat/coding do CLIENT ghi).
> Người đọc: dieu-phoi (duyệt/gộp), kiem-dinh (rà — đặc biệt egress + vòng tool), do-model (máy chủ), chủ dự án (§9 quyết định).

## 0. Tóm tắt

10.4 mở AI ngoài cho **kiểm định** (người bấm / node). 10.4b mở nó cho **sinh chữ**: người dùng chọn `ngoai:<ncc>:<model>` ở ô chọn của Chat AI, bong bóng, màn lập trình (Hỏi + Agent), KB và extension, và **mỗi lượt hỏi** gửi dữ liệu ra ngoài. Khác kiểm định ở ba điểm làm rủi ro tăng: (1) egress xảy ra MỖI lượt, tự động theo ô chọn (không có bước "xác nhận từng lần"); (2) bề mặt có **ngữ cảnh do máy chủ ghép** (truy hồi KB, kết quả tool) ⇒ phải phân loại tại điểm ghép; (3) bề mặt có **vòng tool** (Agent/Coding/extension) ⇒ tool ghi/chạy phải bị bỏ cấu trúc, và vòng phải phân loại mức dữ liệu THEO TỪNG LƯỢT.
Nguyên tắc: **mặc định đóng, mở từng bề mặt riêng** (cờ `duocDungO` đã sẵn ở client — T0 10.4): máy chủ thêm `chat` → `coding` → `agent` → (extension = `chat`+`agent`) từng bước, mỗi bước một lô, một lần rà, rollback bằng cách bỏ giá trị khỏi `duocDungO`.

## 1. Hiện trạng đã đo (2026-10-27, tip `4e9f9f05a`)

| Việc | Trạng thái |
|---|---|
| Ô chọn ở chat / bong bóng / coding / agent / extension | CÓ; mục `ngoai:` ẨN trừ khi `duocDungO` chứa bề mặt (T0). Máy chủ hiện khai `["luong","kiem-dinh"]` |
| KB/chat (`/api/ai/local-kb/{ask,stream}`) với `chonModel ngoai:` | `apChonModelKb` ⇒ **404 `modelNgoaiChuaCaiDat`** (giải với `factoryId:null` ⇒ danh mục ngoài rỗng) |
| Lượt agent (`/api/ai/agent/runs`) với `ngoai:` | CHƯA (cùng lý do) |
| `/v1/chat/completions` model `ngoai:` | CÓ (token cá nhân, một nhà máy) — chưa kiểm ở extension |
| Cổng `goiAiNgoai` | CÓ; `nguonMuc be-mat chat/coding/agent-turn/v1` có sẵn trong kiểu; trả MỘT khối (không stream); kết quả luôn `khongTinCay` |
| Nút kiểm định ở bong bóng / extension | CHƯA (10.4 chỉ có `/ai-chat`, lượt agent, lượt coding — nguồn theo ID lưu) |
| Extension 0.4.1 | ô Model nhận `ngoai:` khi `duocDungO ⊇ {chat,agent}`; Agent gọi `/v1` với `model=<mã>`; **công cụ chạy trên MÁY NGƯỜI DÙNG** (đọc/ghi tệp, `chay_lenh`) |

## 2. Quyết định thiết kế đề xuất

**D1 — Mở theo bề mặt, tuần tự, mỗi lô một cờ.** Thứ tự: **L1 Chat/KB không công cụ** → **L2 Coding "Hỏi" (đọc repo)** → **L3 Agent máy chủ** → **L4 bong bóng + extension** (cần cả `chat` + `agent`) + nút kiểm định bong bóng/extension. Mỗi lô: máy chủ + client + e2e + kiem-dinh rà; `duocDungO` chỉ thêm giá trị bề mặt khi lô đó đạt.

**D2 — Phân loại mức dữ liệu tại ĐIỂM GHÉP, đóng mặc định.** Cổng nhận `phanDaGhep: MucDuLieu[]` của TỪNG phần được ghép vào yêu cầu:
- câu hỏi người dùng gõ / đoạn người dùng dán: `ky-thuat` (trách nhiệm người dán — spec §9; UI ghi rõ);
- **đoạn KB truy hồi**: theo LOẠI kho (`vendor`/`studio`/`api` = tài liệu kỹ thuật ⇒ `ky-thuat`; kho vận hành/nhà máy ⇒ `van-hanh`); loại không phân loại được ⇒ `van-hanh`;
- **kết quả tool** mỗi vòng: tool đọc mã/tra tài liệu mã ⇒ `ky-thuat`; tool đọc số liệu/thiết bị/CSDL ⇒ `van-hanh`; tool lạ ⇒ `van-hanh`;
- **lịch sử hội thoại do CLIENT gửi** (history): coi `van-hanh` nếu bất kỳ lượt trước đã mang ngữ cảnh KB/tool (máy chủ không tin ghi chú của client) — đề xuất đơn giản: lịch sử của client **luôn `van-hanh`** (cùng quy tắc kho chat 10.4) ⇒ chat nhiều lượt với model ngoài cần nhà máy cho dữ liệu vận hành. (Hỏi do-model/kiem-dinh ở §9-Q2.)
`van-hanh` mà nhà máy chưa cho (`choDuLieuVanHanh`) ⇒ **403 `NGOAI_DU_LIEU_VAN_HANH` TRƯỚC khi gọi** (đóng), UI giải thích và gợi ý đổi sang model cục bộ — KHÔNG tự hạ cấp (không âm thầm bỏ ngữ cảnh rồi vẫn gửi).

**D3 — Không công cụ ghi/chạy cho model ngoài, theo cấu trúc (C3).** Tập tool của model ngoài = **chỉ đọc** (`read_file`, `list_dir`, `find_files`, `grep`, `find_symbol`, `search_code`, `search_docs`, `lookup_api`, `compile_st`, `todo_write`); `ghi_tep`/`chay_lenh`/`ap_diff`/MCP ngoài/mọi tool ghi hoặc điều khiển **không được cấp**; model trả `tool_call` ngoài tập ⇒ `NGOAI_TOOL_KHONG_CAP` và **vòng DỪNG** (không bỏ qua rồi chạy tiếp). Cờ máy chủ `choPhepCongCuGhi` mặc định `false` và **KHÔNG có công tắc ở UI** (đề xuất giữ vậy suốt 10.4b).
Bổ sung ở lớp **sandbox** (không phụ thuộc bộ che): danh sách TỪ CHỐI tệp nhạy cảm cho mọi tool đọc khi model là ngoài (`.env*`, `*.pem`, `*.key`, `id_*`, `uploads/`, `backups/`, `.git/`, `node_modules/`, thư mục dữ liệu cục bộ); **trần byte đọc mỗi run**; **trần chi phí MỖI RUN** (cổng đã có trần ngày/người/luồng/lượt — thêm trần theo run); **trần số vòng** thấp hơn model cục bộ.

**D4 — Người dùng phải BIẾT trước khi egress mỗi lượt.** (a) Ô chọn đánh dấu mục ngoài bằng nhãn "ngoài · gửi dữ liệu ra <nhà cung cấp>"; (b) **đồng ý một lần mỗi PHIÊN** (sessionStorage, KHÔNG lưu bền) khi lần đầu chọn model ngoài ở bề mặt: hộp nêu nhà cung cấp, "nội dung gửi đi được che", mức dữ liệu máy chủ sẽ suy, trần chi phí còn lại (theo Q2: người thường chỉ thấy trần của mình + "nhà máy còn đủ trần"), "AI ngoài chỉ đọc — công cụ ghi/chạy bị tắt"; chưa đồng ý ⇒ ô giữ nguyên model cũ; (c) mỗi lượt trả lời mang **huy hiệu** "model ngoài: <ncc>/<model> · ~N token · ~$X" (dữ liệu từ `vet` của cổng); (d) lượt lỗi (vượt trần / dữ liệu vận hành chưa cho / nhà cung cấp lỗi) ⇒ thông điệp bản địa, không để câu trả lời rỗng.

**D5 — Một khối, không stream (v1).** Cổng trả MỘT khối; máy chủ KB/agent bọc thành một sự kiện SSE cuối (UI hiện "đang chờ AI ngoài…" thay cho stream chữ). Stream thật từ nhà cung cấp = ngoài phạm vi 10.4b (cần cổng stream + che theo mảnh — rủi ro rò mảnh).

**D6 — Kết quả của model ngoài luôn KHÔNG TIN CẬY.** Chat hiển thị bằng bộ Markdown ĐÃ LỌC có sẵn của chat — nhưng với model ngoài **tắt ảnh tự tải + liên kết tự mở** (cùng phòng thủ D3 của 10.4: ảnh markdown = kênh rò dữ liệu qua URL); khối mã chỉ "Chép", không "Áp dụng/chạy" tự động; đầu ra ngoài đưa vào prompt Local có tool phải bọc UNTRUSTED (đã có bất biến ở Luồng — mở rộng cho lịch sử chat: lượt trả lời ngoài trong `history` gửi lại model cục bộ ⇒ bọc).

**D7 — Nguồn `van-ban` cho bề mặt KHÔNG kho (bong bóng, extension) — mặc định `van-hanh`.** Kiểm định (nút) ở bong bóng/extension gửi văn bản do client giữ (không có provenance). Đề xuất: nguồn `van-ban` **luôn `van-hanh`** (cùng lý do kho chat do client ghi ở 10.4) + tham số `beMat` từ **danh sách đóng** (`bong-bong` | `extension`) kiểm vai/cờ; văn bản ≤ trần; máy chủ KHÔNG nhận `mucDuLieu`. Ở extension, host (không phải webview) giữ văn bản và gọi tRPC bằng cookie — webview chỉ báo "kiểm định lượt N".

**D8 — Extension: vòng tool chạy trên máy người dùng ⇒ ép chỉ-đọc Ở CLIENT.** Chọn model ngoài ở extension ⇒ chế độ bị khoá "Hỏi · chỉ đọc" (ô chế độ vô hiệu + chú thích), `congCu` gửi cho `/v1` chỉ gồm tool đọc, và **host từ chối thực thi** mọi `tool_call` ngoài tập đọc dù máy chủ có lỡ trả (hai lớp: máy chủ cấp tập + client không thực thi). Đường Trợ lý (KB) dùng L1.

## 3. Phân việc

| Phần | Chủ |
|---|---|
| Định tuyến `ngoai:` ở KB/chat (`apChonModelKb` + `streamAnswer`), coding "Hỏi", agent (`quanLyLuotChay`), `/v1` kiểm; phân loại tại điểm ghép; tập tool đọc + từ chối `NGOAI_TOOL_KHONG_CAP` + dừng vòng; sandbox deny-list + trần byte/run + trần chi phí/run; `duocDungO` mở dần; nguồn `van-ban` + `beMat` đóng; i18n lỗi | **do-model** |
| Hộp đồng ý theo phiên, nhãn/huy hiệu ngoài ở ô chọn + lượt trả lời, bộ render ngoài (D6), khoá chế độ + ép đọc ở extension (D8), nút kiểm định ở bong bóng/extension (D7), e2e (nhà cung cấp GIẢ) + harness extension VSCode thật, thông điệp lỗi | **luong-ui** |
| Rà độc lập mỗi lô (egress: che, phân loại điểm ghép, vòng tool, deny-list, trần/run; XSS ở bộ render) | kiem-dinh |
| Gộp + cổng đủ census + dựng :3000 | dieu-phoi |

## 4. Chia lô (mỗi lô = máy chủ + client + e2e + rà)

| Lô | Bề mặt | `duocDungO` thêm | Điểm chính |
|---|---|---|---|
| **L1** | `/ai-chat` + KB (không công cụ; truy hồi KB phân loại theo loại kho) | `chat` | D2, D4, D5, D6; history của client = `van-hanh`; lỗi 403 giải thích |
| **L2** | màn lập trình — chế độ **Hỏi** (đọc repo) | `coding` | D3 đầy đủ (tập đọc, deny-list, trần byte/run, trần chi phí/run); tool kết quả mã ⇒ `ky-thuat` theo TỪNG vòng |
| **L3** | Agent máy chủ (`/api/ai/agent/runs`) | `agent` | cùng D3; chế độ `sua`/`tu-dong` bị khoá khi model ngoài; thẻ duyệt không bao giờ xuất hiện |
| **L4** | bong bóng + extension (Trợ lý = L1, Agent = L3) + nút kiểm định bong bóng/extension | (extension tự bật khi `chat`+`agent`) | D7, D8; extension 0.5.0; xác minh LIVE trong VSCode thật |
Mỗi lô độc lập gộp được; L1 không chờ L2.

## 5. Phần client chi tiết (luong-ui)

- **`ChonModel` / extension**: nhãn "ngoài · gửi dữ liệu ra <ncc>"; chọn mục ngoài lần đầu ⇒ `HopDongYNgoai` (đồng ý theo phiên; không đồng ý ⇒ giữ mã cũ); `xemTruoc`-tương-đương cho sinh chữ? — dùng lại `aiKiemDinh.xemTruoc`? KHÔNG (nó theo nguồn lượt đã lưu). Cần **thủ tục đọc nhẹ** `aiChonModel.thongTinNgoai {chonModel}` ⇒ `{ nhaCungCap, model, mucDuLieuToiDa?, conLaiTranNgay{nguoi, nhaMay{duTranChoLuotNay}}, dinhKemBiCam }` (xin do-model) cho hộp đồng ý.
- **Lượt trả lời**: huy hiệu model ngoài + token/chi phí; bộ render ngoài (tắt ảnh/liên kết) — **một component** `NoiDungTraLoiNgoai`, census AST như `HienThiKetQuaNgoai`; lượt lỗi hiển thị thông điệp theo `MaLoiNgoai`.
- **Coding/Agent**: khi model ngoài ⇒ ô chế độ chỉ cho "Hỏi", chú thích "AI ngoài chỉ đọc"; không có UI bật tool ghi.
- **Bong bóng**: ô chọn đã có; thêm đồng ý theo phiên; nút kiểm định (nguồn `van-ban`, `beMat:"bong-bong"`).
- **Extension 0.5.0**: ô Model + đồng ý theo phiên (webview → host hỏi qua `vscode.window.showWarningMessage` modal — KHÔNG tin webview); ép chỉ-đọc (D8) + test host từ chối tool ngoài tập; nút "Nhờ AI ngoài kiểm định" ở bong bóng trợ lý (host gọi `aiKiemDinh.chay` nguồn `van-ban`); `README`; đóng gói/cài/sha256.
- **e2e**: mở rộng `flow-kiem-dinh-ngoai-ky-su`-style: spec `chat-model-ngoai` (nhà cung cấp GIẢ + khoá/model/host như 10.4): (1) chọn ngoài ⇒ hộp đồng ý; (2) hỏi ⇒ thân tới nhà cung cấp đã CHE khoá/mật khẩu, không `tools`; (3) dữ liệu vận hành chưa cho ⇒ 403 + giải thích; (4) vượt trần ⇒ thông điệp; (5) chuỗi độc/markdown ảnh trong trả lời không tự tải; (6) coding Hỏi: tool đọc `.env` bị từ chối; model giả trả `tool_call` ghi ⇒ vòng dừng; (7) người ngoài phạm vi ⇒ không thấy mục ngoài.
- **Live extension**: harness test-electron đã có (scratchpad `extlive-*`): chọn ngoài, hỏi, đo thân tại nhà cung cấp giả; model giả trả `chay_lenh` ⇒ host từ chối + vòng dừng; nút kiểm định ở bong bóng.

## 6. Kiểm thử / đột biến bắt buộc (đủ để kiem-dinh rà)

Máy chủ: bỏ phân loại điểm ghép ⇒ đỏ; history client coi `ky-thuat` ⇒ đỏ; tool lạ ⇒ phải `van-hanh`; model ngoài trả tool ghi/chạy ⇒ `NGOAI_TOOL_KHONG_CAP` + vòng dừng (bỏ ⇒ đỏ); deny-list (`.env`, `*.pem`, `uploads/`, `backups/`, `.git/`) cho mọi tool đọc (bỏ từng mục ⇒ đỏ); trần byte đọc/run; trần chi phí/run; `choPhepCongCuGhi` mặc định false; nguồn `van-ban` luôn `van-hanh` + `beMat` ngoài danh sách ⇒ 400; cờ nhà máy tắt GIỮA hai lượt ⇒ lượt sau bị từ chối (đọc lúc gọi); đồng thời: `duocDungO` chưa có bề mặt ⇒ `NOT_FOUND`.
Client: bỏ đồng ý theo phiên ⇒ đỏ; đồng ý lưu bền (localStorage) ⇒ đỏ (phải sessionStorage); render ngoài dùng `innerHTML`/ảnh tự tải ⇒ đỏ; ô chế độ không khoá khi model ngoài ⇒ đỏ; extension thực thi tool ngoài tập ⇒ đỏ; census AST: mọi chỗ render trả lời model ngoài import bộ render duy nhất.
i18n vi/en/zh + `i18n:check`; tsc 0; census ghim ĐO có ngày; cổng đủ census do dieu-phoi.

## 7. Rủi ro và giới hạn

- **Egress tự động mỗi lượt** — cái giá của yêu cầu chủ dự án. Giảm bằng: mặc định đóng theo bề mặt, `van-hanh` đòi quyền nhà máy, đồng ý theo phiên, trần chi phí, che, không công cụ ghi. Vẫn là rào chống NHẦM (spec §9).
- Che theo mẫu có giới hạn đã khai (spec §9); ngữ cảnh KB loại không phân loại ⇒ đóng.
- Chat nhiều lượt với model ngoài cần nhà máy cho dữ liệu vận hành (history client = `van-hanh`) — chấp nhận ở v1; nới ⇒ nhật ký lượt do MÁY CHỦ ghi (backlog 10.4).
- Không stream; độ trễ cao hơn model cục bộ — UI nói rõ.
- Extension: vòng tool chạy trên máy người dùng ⇒ lớp bảo vệ hai tầng (D8) là bắt buộc; nếu không đạt thì KHÔNG mở `agent` ở extension (chỉ Trợ lý/KB).
- Ngoài phạm vi: stream thật, fine-tune (G9), tool ghi cho model ngoài, bài học (10.5).

## 8. Thứ tự đề xuất

L1 (do-model server → luong-ui client+e2e → kiem-dinh) → L2 → L3 → L4 (+ extension 0.5.0 + live). Báo cáo nghiệm thu 10.4b sau L4. 10.5 (hàng chờ/duyệt bài học) sau 10.4b — nhắc lại điều kiện UNTRUSTED (N4) cho `baiHocDeXuat`.

## 9. Quyết định / câu hỏi cần trả lời

- **Q1 (chủ dự án/dieu-phoi):** chấp nhận **không stream** ở v1, và **đóng cứng** khi `van-hanh` chưa được nhà máy cho (không hạ cấp âm thầm)?
- **Q2 (do-model/kiem-dinh):** history do client gửi = `van-hanh` luôn (đơn giản, đóng) — có nới được theo cách an toàn (vd máy chủ tự ghép lại lịch sử từ kho do máy chủ ghi) hay để backlog?
- **Q3 (do-model):** phân loại **loại kho KB** (`vendor`/`studio`/`api`/vận hành/…) hiện có sẵn ở đâu để tra tại điểm ghép? Chunk không có `loaiKho` ⇒ `van-hanh`.
- **Q4 (do-model):** thủ tục đọc nhẹ cho hộp đồng ý (`aiChonModel.thongTinNgoai`) — chữ ký đề xuất ở §5; đồng ý?
- **Q5 (do-model/kiem-dinh):** trần byte đọc/run và trần chi phí/run — số mặc định (đề xuất: 256 KB đọc/run, 1/4 trần ngày nhà máy hoặc cấu hình)? Danh sách deny-list tệp nhạy cảm — bổ sung gì?
- **Q6 (dieu-phoi):** extension 0.5.0 gộp cùng L4 hay tách riêng? Mở `agent` ở extension chỉ khi harness live đạt D8 — đồng ý?
- **Q7 (chủ dự án):** hộp đồng ý theo PHIÊN đủ không, hay cần theo LƯỢT cho dữ liệu vận hành?
