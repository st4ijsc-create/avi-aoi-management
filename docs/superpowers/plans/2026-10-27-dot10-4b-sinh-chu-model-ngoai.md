# Đợt 10.4b — Sinh chữ bằng model NGOÀI ở Chat / Coding / KB / bong bóng / extension + nút kiểm định ở bong bóng/extension: KẾ HOẠCH v2.1 (kiem-dinh DUYỆT bắt đầu L0 — CHỜ dieu-phoi duyệt sau Q-A)

> Phiên **luong-ui** · nhánh `feat/ai-flow-studio` · 2026-10-27 · **v2** = v1 (`142c67027`) + quyết định dieu-phoi (Q1/Q6/Q7) + rà kiem-dinh (8 mục BẮT BUỘC M1–M8, N1–N6, bảng đột biến bổ sung). **kiem-dinh đã DUYỆT bắt đầu L0 (27/10); dieu-phoi: CHƯA bắt đầu L0 cho tới khi duyệt v2.1 sau khi có Q-A của chủ dự án.** Chưa làm gì.
> Căn cứ: chủ dự án (Q4 26/10) "ô chọn model gồm cả model bên ngoài khi admin bật" ⇒ 10.4b BẮT BUỘC · spec `2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §4 A3, §5 B3/B6, §9 · báo cáo 10.3 §7 · kế hoạch 10.4 v3 · bài học 10.4: kho chat/coding do CLIENT ghi ⇒ không là provenance.
> Người đọc: dieu-phoi (duyệt/gộp), kiem-dinh (rà egress + vòng tool + render), do-model (máy chủ), chủ dự án (§10).

## 0. Tóm tắt

10.4 mở AI ngoài cho **kiểm định** (người bấm / node). 10.4b mở nó cho **sinh chữ**: người dùng chọn `ngoai:<ncc>:<model>` ở ô chọn và **mỗi lượt** gửi dữ liệu ra ngoài. Rủi ro tăng so với kiểm định: (1) egress MỖI lượt, tự động theo ô chọn; (2) bề mặt có **ngữ cảnh do máy chủ/clients ghép** (truy hồi KB, `nguCanh`, kết quả tool); (3) bề mặt có **vòng tool**; (4) kết quả ngoài **quay lại** làm history/bộ nhớ cho model cục bộ có tool (lây ngược).
Nguyên tắc: **mặc định đóng, mở từng bề mặt (cờ `duocDungO`), mỗi lô một lần rà + một lần gộp, rollback = bỏ giá trị khỏi `duocDungO`**. Hai thay đổi lớn so với v1 theo rà kiem-dinh: **(a) chat/KB/bong bóng/trợ lý extension: phần người gõ = `van-hanh`** (đó là trợ lý VẬN HÀNH) — chỉ màn lập trình mới `ky-thuat`; **(b) lô L0 nền tảng** (bộ dựng yêu cầu duy nhất + deny-list dùng chung `shared/` + bộ render duy nhất + dấu nguồn lưu DB) phải xong TRƯỚC L1.

## 1. Hiện trạng đã đo (2026-10-27, tip `8367c1d65`)

| Việc | Trạng thái |
|---|---|
| Ô chọn ở chat / bong bóng / coding / agent / extension | CÓ; mục `ngoai:` ẨN trừ khi `duocDungO` chứa bề mặt (T0). Máy chủ khai `["luong","kiem-dinh"]` |
| KB/chat `/api/ai/local-kb/{ask,stream}` với `chonModel ngoai:` | `apChonModelKb` ⇒ **404 `modelNgoaiChuaCaiDat`** |
| Lượt agent `/api/ai/agent/runs` với `ngoai:` | CHƯA |
| `/v1/chat/completions` model `ngoai:` | CÓ (token cá nhân, một nhà máy) — chưa kiểm ở extension |
| Cổng `goiAiNgoai` | CÓ; `nguonMuc be-mat chat/coding/agent-turn/v1`; một khối (không stream); kết quả luôn `khongTinCay`; `phanDaGhep: MucDuLieu[]` |
| Nút kiểm định ở bong bóng / extension | CHƯA (10.4 chỉ `/ai-chat`, lượt agent, lượt coding theo ID lưu) |
| Extension 0.4.1 | ô Model nhận `ngoai:` khi `duocDungO ⊇ {chat,agent}`; Agent gọi `/v1`; **công cụ chạy trên MÁY NGƯỜI DÙNG**; `nguCanh` tự đính kèm (tệp đang mở, vùng chọn, Problems…) |
| Client gửi lên KB | `question`, `history` (do client), `context.nguCanh` (trang/thực thể do client), ảnh |

## 2. Quyết định thiết kế (đã sửa theo rà kiem-dinh)

**D1 — Mở theo bề mặt, tuần tự.** **L0** nền tảng → **L1** Chat/KB (web, không công cụ) → **L2** Coding "Hỏi" → **L3** Agent máy chủ → **L4** bong bóng web + nút kiểm định bong bóng → **extension 0.5.0 (lô riêng, SAU L3)**. Mỗi lô: máy chủ + client + e2e + kiem-dinh rà + cổng gộp riêng.

**D2 — Mức dữ liệu theo BỀ MẶT + bộ dựng CẤU TRÚC (M1, M2).**
- **Chat / KB / bong bóng / trợ lý extension = trợ lý VẬN HÀNH ⇒ phần người GÕ = `van-hanh`** (cần `choDuLieuVanHanh`). Chỉ **màn lập trình** (Hỏi/Agent: văn bản gõ + mã repo) mới `ky-thuat`. Nếu chủ dự án muốn chat cho `ky-thuat` ⇒ lựa chọn RIÊNG kèm cảnh báo, KHÔNG mặc định (§10-Q-A).
- **MỘT bộ dựng** `ghepPhan(muc, nguon, text)` (máy chủ, module riêng) là đường DUY NHẤT dựng yêu cầu ngoài; cổng chỉ nhận **danh sách phần đã phân loại**; chuỗi không đi qua bộ dựng ⇒ bị loại/từ chối; census AST: mọi nơi gọi `goiAiNgoai`/nhánh `ngoai:` chỉ truyền mảng từ bộ dựng.
- Bảng phân loại TỪNG khối mà đường chat/KB ghép hôm nay (do-model xác nhận từng dòng khi chốt):

| Khối | Mức |
|---|---|
| persona/system tĩnh | `ky-thuat` |
| câu người gõ (chat/KB/bong bóng/extension-Trợ lý) | **`van-hanh`** |
| câu người gõ (màn lập trình) + mã repo đọc bởi tool | `ky-thuat` |
| truy hồi KB | theo LOẠI kho (`vendor`/`studio`/`api` ⇒ `ky-thuat`; kho vận hành/nhà máy ⇒ `van-hanh`); **không có `loaiKho` ⇒ `van-hanh`**; chỉ chunk thuộc nhà máy duy nhất của người gọi + tài liệu kỹ thuật chung (N3) |
| `context.nguCanh` do CLIENT gửi (trang/thực thể/máy đang chọn) | **bị BỎ** khi model ngoài (hoặc `van-hanh`) — không tin, không gửi |
| ghi chú dự án / `remember` / bài học / few-shot | `van-hanh` mặc định (nội dung do người dùng/bài học tích luỹ); tắt khi ngoài nếu không phân loại được |
| kết quả planner/tool vận hành của trợ lý | `van-hanh` |
| tool đọc mã/tra tài liệu mã | `ky-thuat` |
| `history` do client gửi | `van-hanh` (N2: nới chỉ khi máy chủ tự ghi nhật ký lượt + dấu nguồn — backlog) |
| ảnh / tệp / đính kèm | **CẤM** khi model ngoài (cùng D4 của 10.4) |

- **Mức yêu cầu = MAX trên TOÀN BỘ danh sách tin nhắn gửi đi MỖI vòng** (không chỉ phần mới): vòng 1 đọc dữ liệu vận hành ⇒ mọi vòng sau vẫn `van-hanh` (lịch sử còn chứa nó).
- `van-hanh` mà nhà máy chưa cho ⇒ **403 `NGOAI_DU_LIEU_VAN_HANH` TRƯỚC khi gọi** (đóng cứng; không hạ cấp âm thầm); UI giải thích và gợi ý đổi sang model cục bộ.

**D3 — Model ngoài chỉ có tập tool ĐỌC THUẦN; deny-list DÙNG CHUNG (M3, M4, N6).**
- Tập đọc thuần: `read_file`, `list_dir`, `find_files`, `grep`, `find_symbol`, `search_code`, `search_docs`, `lookup_api`. **Loại `compile_st`** (chạy trình biên dịch trên nội dung do model ngoài viết = thực thi) khỏi tập ngoài; `todo_write` chỉ trong phiên (không ghi bền); `remember`, MCP ngoài, `ghi_tep`, `chay_lenh`, `ap_diff`, mọi tool ghi/điều khiển: KHÔNG cấp, KHÔNG quảng bá (không lộ tên/schema cho model). Model trả `tool_call` ngoài tập ⇒ `NGOAI_TOOL_KHONG_CAP` + **vòng DỪNG**.
- **Một module `shared/` duy nhất** (`shared/aiNgoaiDenyList.ts` hoặc tương đương) dùng cho **sandbox máy chủ VÀ host extension** (vì ở extension tool chạy trên máy người dùng — máy chủ không ép được): áp cho mọi tool đọc, **KẾT QUẢ của tool tìm** (`grep`/`find_files`/`search_code`/`find_symbol` lọc dòng/đường dẫn thuộc tệp bị cấm — `grep -r pass` không được lòi `.env`), liệt kê thư mục, VÀ **ngữ cảnh tự đính kèm** (tệp đang mở, vùng chọn, Problems, terminal, git diff — người dùng đang mở `.env` thì extension KHÔNG tự gửi).
- Chuẩn hoá đường dẫn trước khi so: realpath/symlink/junction thoát workspace, phân biệt hoa-thường Windows (`.ENV`), dấu chấm/khoảng trắng cuối, tên 8.3, ADS (`.env::$DATA`), `\\?\`, `..`. **ALLOWLIST theo đuôi nguồn + deny-list**; deny-list: `.env*`, `*.pem *.key *.pfx *.p12 id_* .ssh .aws .kube .npmrc .pypirc .netrc`, `uploads/ backups/ .git/ node_modules/ knowledge/ models/ logs/ test-results/ .claude/ .superpowers/`, `*.sql *.dump *.bak *.csv *.log`, thư mục dữ liệu cục bộ; từ chối nhị phân; trần kích thước/tệp.
- Cấu hình `choPhepCongCuGhi` đọc từ nơi KHÔNG client ghi được; thiếu cấu hình ⇒ `false`; **không có UI bật**. Cmd+K/sửa nội tuyến với model ngoài: kết quả luôn qua thẻ duyệt, không tự áp; lệnh slash có tác dụng phụ bị khoá khi model ngoài.

**D4 — Biết trước khi egress (Q7 dieu-phoi + N1 kiem-dinh).** (a) ô chọn: nhãn "ngoài · gửi dữ liệu ra <ncc>" trên mục ngoài; (b) **đồng ý một lần mỗi PHIÊN** (sessionStorage, không bền), **riêng theo nhà cung cấp+model — đổi ⇒ hỏi lại**; hộp nêu nhà cung cấp, "nội dung được che", **"câu bạn gõ được coi là dữ liệu vận hành" (M1)**, mức máy chủ suy, trần còn lại (Q2: người thường chỉ trần của mình + "nhà máy còn đủ trần"), "AI ngoài chỉ đọc — công cụ ghi/chạy tắt"; (c) với `van-hanh`: thêm **xác nhận MỘT lần mỗi hội thoại** khi lượt đầu bị máy chủ suy là `van-hanh` (máy chủ trả `CAN_XAC_NHAN_VAN_HANH {muc}`; client gửi lại kèm cờ — cờ chỉ là UX, rào thật vẫn ở cổng); (d) **mỗi lượt** mang nhãn "ngoài · gửi dữ liệu ra <ncc>" + huy hiệu `<model> · ~N token · ~$X` lấy từ `vet` **do MÁY CHỦ trả** (không client tự dựng), hiển thị cả khi lượt lỗi (N5).

**D5 — Một khối, không stream (v1; Q1 dieu-phoi).** Máy chủ bọc thành một sự kiện SSE cuối; **nhịp sống (keep-alive)** để proxy không cắt; lỗi cổng map sang mã SSE rõ; không để câu trả lời rỗng (N4).

**D6 — Bộ render DUY NHẤT, CHỨNG MINH bằng ≥ 12 payload (M6).** Một component (`NoiDungTraLoiNgoai` hoặc mở rộng bộ render chat hiện có với chế độ "không tin cậy") dùng cho Chat, bong bóng, extension, Coding Hỏi, Agent và **lịch sử đã lưu** (đọc lại từ CSDL cũng qua bộ này) + census AST. Liên kết **KHÔNG bấm được** (hiển thị văn bản + tên miền), ảnh **tắt hoàn toàn**, khối mã chỉ "Chép". Test DOM ≥ 12 payload: `![x](http://…)`, ảnh tham chiếu `![x][1]`, autolink `<http://…>`, `<img>/<svg>/<iframe>/<style>` HTML thô, `javascript:`/`data:`/`vbscript:`/`//host` trong liên kết, KaTeX/toán (`\href`, `\includegraphics`, trust), mermaid/sơ đồ, bảng, entity — không phần tử nguy hiểm, 0 yêu cầu mạng (spy fetch/Image). Webview extension: CSP `img-src`/`connect-src` chặt (kiểm trong test LIVE).

**D7 — Nguồn `van-ban` (bong bóng/extension) — kênh hẹp (M7).** Luôn `van-hanh`. Trần byte nhỏ **≤ 16 KB**; **giới hạn tốc độ riêng theo người**; **audit từng lần** (sha256 + `beMat` + người, KHÔNG nội dung); `beMat` **ánh xạ CỐ ĐỊNH** tới bề mặt trong `duocDungO` (`bong-bong`⇒`chat`, `extension`⇒`chat|agent`; bề mặt chưa mở ⇒ `NOT_FOUND` — khai `beMat` giả không chọn được bề mặt đang tắt); máy chủ KHÔNG nhận `mucDuLieu`; đính kèm cấm; input strict. Ở extension host (không phải webview) giữ văn bản và gọi tRPC bằng cookie.

**D8 — Extension: vòng tool chạy trên máy người dùng (M3, M4; Q6 dieu-phoi).** Extension 0.5.0 là **lô riêng SAU L3**. Chọn model ngoài ⇒ chế độ khoá "Hỏi · chỉ đọc"; `congCu` gửi `/v1` chỉ tập đọc thuần; **host từ chối thực thi** mọi `tool_call` ngoài tập (kể cả MCP/`chay_lenh`/tool lạ) **và không quảng bá** tool ngoài tập; deny-list dùng module `shared/` chung (kể cả tự đính kèm); không tự đính kèm `.env` đang mở. **Chỉ mở `agent` ở extension khi harness LIVE (VSCode thật) chứng minh M3/M4 trên host**; không đạt ⇒ extension chỉ Hỏi đáp/chat, KHÔNG agent với model ngoài.

**D9 — Lây ngược: dấu nguồn lưu DB + hạ tự trị (M5; N2).**
- Máy chủ **BIẾT** lượt nào là ngoài: lưu **dấu nguồn `ngoai:<ncc>:<model>`** trên bản ghi tin nhắn (cột/khoá riêng, KHÔNG tin cờ client) — cần **migration** (xin dải từ dieu-phoi).
- Dùng dấu đó để: (i) **bọc UNTRUSTED** khi dựng history; (ii) **loại khỏi** mọi vòng học / ingest KB / bộ nhớ dự án / dữ liệu huấn luyện; (iii) **KHÔNG chia sẻ bộ nhớ đệm câu trả lời** giữa ngoài↔cục bộ hay giữa người dùng; (iv) `remember`/đề xuất bài học từ đầu ra ngoài ⇒ CHỈ qua người duyệt (10.5).
- Sau một lượt ngoài, các lượt **CỤC BỘ có tool** trong cùng hội thoại bị **HẠ TỰ TRỊ** (cơ chế `ha-tu-tri` / `noi-dung-dang-ngo` đã có ở agent: mọi ghi/lệnh cần người duyệt).

**D10 — Trần (M8, N6).** Ngoài trần ngày/người/luồng/lượt/phút của cổng: (i) trần **số VÒNG** ngoài và **TỔNG CHI PHÍ MỖI RUN** dùng giữ chỗ NGUYÊN TỬ cộng dồn (không chỉ kiểm cuối run); (ii) **MỘT lượt ngoài đang bay mỗi người** (chống xả song song); (iii) huỷ từ client **vẫn tất toán sổ**; (iv) "thử lại" nhà cung cấp không nhân chi phí ngoài trần; (v) **trần byte đọc/run áp lên KẾT QUẢ tool gửi đi**, thêm **trần số tệp đọc/run**; số mặc định đề xuất: 256 KB đọc/run, 1/4 trần ngày nhà máy cho chi phí/run (do-model chốt).

## 3. Phân việc

| Phần | Chủ |
|---|---|
| **L0 máy chủ**: bộ dựng `ghepPhan` + census; module deny-list `shared/` (+ test biến thể); dấu nguồn DB (migration); trần mới (D10); nguồn `van-ban` + `beMat` ánh xạ cố định | **do-model** |
| L1–L3 máy chủ: định tuyến `ngoai:` ở KB/chat, coding Hỏi, agent; tập đọc thuần; dừng vòng; `duocDungO` mở dần; mã `CAN_XAC_NHAN_VAN_HANH`; keep-alive SSE | do-model |
| **L0 client**: bộ render duy nhất (D6) + 12 payload + census; hộp đồng ý theo phiên (D4); nhãn/huy hiệu; | **luong-ui** |
| L1–L4 client + e2e (nhà cung cấp GIẢ) ; bong bóng; nút kiểm định bong bóng; extension 0.5.0 + harness LIVE | luong-ui |
| Rà độc lập mỗi lô | kiem-dinh |
| Gộp + cổng đủ census + dựng :3000 | dieu-phoi |

## 4. Chia lô

| Lô | Nội dung | `duocDungO` thêm |
|---|---|---|
| **L0a** (máy chủ, rà lần 1) | bộ dựng `ghepPhan` + census AST + module deny-list `shared/` (thuần; bộ test biến thể) | — |
| **L0a'** (máy chủ, rà lần 2 — chạm DB/cổng, đột biến DB riêng) | migration dấu nguồn (dải **0417–0418**, 0419 dự phòng; do-model viết SQL gửi dieu-phoi TRƯỚC khi áp DEV) + trần D10 + `van-ban` + tách `choPhepCongCuGhi` | — |
| **L0b** (client, rà lần 3 — DOM) | bộ render duy nhất (D6) + đồng ý theo phiên / xác nhận vận hành (D4) | — |
(Nếu dieu-phoi muốn ít vòng: gộp L0a+L0a', GIỮ L0b riêng. Chưa mở bề mặt nào ở L0.)
| **L1** | `/ai-chat` + KB (không công cụ); người gõ = van-hanh; truy hồi KB theo loại kho | `chat` |
| **L2** | màn lập trình — **Hỏi** (đọc repo; người gõ + mã = ky-thuat; tool đọc theo TỪNG vòng) | `coding` |
| **L3** | Agent máy chủ (`sua`/`tu-dong` khoá với model ngoài; thẻ duyệt không xuất hiện) | `agent` |
| **L4** | bong bóng web + nút kiểm định bong bóng (nguồn `van-ban`) | — (bong bóng dùng `chat`) |
| **E** | extension 0.5.0: Hỏi đáp (Trợ lý = L1); Agent CHỈ khi harness LIVE chứng minh D8 | (tự bật khi `chat`+`agent`) |

## 5. Phần client chi tiết (luong-ui)

- **Ô chọn + hộp đồng ý (D4)**: thủ tục đọc nhẹ `aiChonModel.thongTinNgoai {chonModel}` ⇒ `{ nhaCungCap, model, conLaiTranNgay{ nguoi{token|null}, nhaMay{ duTranChoLuotNay, token?, usd? (admin) } }, dinhKemBiCam }` — **chỉ thông tin, không giữ chỗ, quyền tối thiểu theo Q2(b)** (kiem-dinh đồng ý Q4). Đồng ý lưu `sessionStorage` theo khoá `nhà cung cấp:model`; `CAN_XAC_NHAN_VAN_HANH` ⇒ hộp xác nhận một lần/hội thoại.
- **Lượt trả lời**: nhãn + huy hiệu từ `vet` máy chủ; component render duy nhất (D6); lượt lỗi hiển thị thông điệp theo `MaLoiNgoai`.
- **Coding/Agent**: model ngoài ⇒ chế độ chỉ "Hỏi", chú thích "AI ngoài chỉ đọc".
- **Bong bóng**: đồng ý theo phiên; nút kiểm định (`van-ban`, `beMat:"bong-bong"`).
- **Extension 0.5.0 (lô E)**: modal xác nhận do HOST (`showWarningMessage`) không tin webview; ép chỉ-đọc + host từ chối/không quảng bá tool ngoài tập; dùng module deny-list `shared/`; nút kiểm định ở bong bóng trợ lý (host gọi `aiKiemDinh.chay` nguồn `van-ban`); README; đóng gói/cài/sha256; **harness LIVE** (scratchpad `extlive-*`): chọn ngoài, hỏi, đo thân tại nhà cung cấp giả (khoá/mật khẩu đã che; tệp `.env` đang mở KHÔNG tự đính kèm; `grep -r` không lòi `.env`), model giả trả `chay_lenh`/tool lạ ⇒ host từ chối + vòng dừng, CSP webview chặn ảnh/`connect`.
- **e2e web** (nhà cung cấp GIẢ như 10.4): (1) hộp đồng ý + nhãn; (2) thân tới nhà cung cấp đã CHE, không `tools`, không `nguCanh`/ảnh/đính kèm; (3) van-hanh chưa cho ⇒ 403 + giải thích (người gõ coi van-hanh); (4) `CAN_XAC_NHAN_VAN_HANH` một lần/hội thoại; (5) vượt trần/1 lượt bay/người; (6) payload độc không tự tải; (7) coding Hỏi: tool đọc `.env`/`uploads` bị từ chối, `grep` không lòi dòng; model giả trả tool ghi ⇒ vòng dừng; (8) lượt cục bộ có tool SAU lượt ngoài bị hạ tự trị; (9) lượt ngoài bị bọc UNTRUSTED trong history và loại khỏi ingest; (10) người ngoài phạm vi không thấy mục ngoài.

## 6. Bảng đột biến BẮT BUỘC (đủ danh sách của kiem-dinh)

1. `nguCanh`/trang do client gửi lọt vào yêu cầu ngoài ⇒ đỏ.
2. Mức = MAX trên toàn bộ tin nhắn MỖI vòng (vòng 2 chỉ tool ky-thuat nhưng lịch sử có van-hanh ⇒ van-hanh).
3. Mọi nơi gọi `goiAiNgoai` qua bộ dựng (census AST); chuỗi ngoài bộ dựng ⇒ từ chối.
4. `grep`/`find_files`/`search_code`/`find_symbol` không trả dòng/đường dẫn từ `.env`/`uploads/` (kết quả tìm, không chỉ `read_file`).
5. Từng mục deny-list + biến thể hoa-thường / ADS / symlink / junction / `..` / `\\?\` / 8.3.
6. `compile_st` / `remember` / MCP / `todo_write` bền không có trong tập ngoài và không quảng bá.
7. Lượt cục bộ có tool SAU lượt ngoài bị hạ tự trị.
8. Dấu nguồn ngoài lưu DB và dùng để bọc history + loại khỏi ingest/học/bộ nhớ.
9. Bộ nhớ đệm không dùng chung ngoài↔cục bộ / giữa người dùng.
10. `van-ban`: vượt 16 KB ⇒ 413; vượt tốc độ ⇒ 429; `beMat` ngoài danh sách ⇒ 400; bề mặt tắt ⇒ NOT_FOUND; `mucDuLieu` do client ⇒ 400.
11. Trần tổng chi phí/run (giữ chỗ nguyên tử) + 1 lượt bay/người + huỷ vẫn tất toán + retry không nhân chi phí + trần byte kết quả tool.
12. Host extension: từ chối tool ngoài tập + không quảng bá + deny-list host + `.env` đang mở không tự đính kèm.
13. Render: ≥ 12 payload ở mọi bề mặt + liên kết không bấm được + CSP webview.
14. `choPhepCongCuGhi` không đọc được từ client/môi trường người dùng; thiếu cấu hình ⇒ false.
15. Chat/KB/bong bóng: câu người gõ coi `van-hanh` (bỏ ⇒ đỏ); chunk KB không `loaiKho` ⇒ van-hanh; chunk nhà máy khác không vào yêu cầu (N3).
16. Đồng ý theo phiên lưu `sessionStorage` (không bền); đổi nhà cung cấp/model ⇒ hỏi lại; `CAN_XAC_NHAN_VAN_HANH` một lần/hội thoại.
i18n vi/en/zh + `i18n:check`; tsc 0 (heap 12 GB); census ghim ĐO có ngày; cổng đủ census do dieu-phoi.

## 6b. Bổ sung theo rà vòng 2 của kiem-dinh (NÊN — đưa vào L0/L2)

1. **D3 deny theo TÊN** ngoài allowlist đuôi (vì `*.json/*.yaml/*.md/*.toml` vẫn chứa bí mật): `*secret* *credential* *password* *token* appsettings*.json docker-compose*.y*ml *.local.* *.prod.* config/*local*` — test mỗi mẫu + biến thể hoa-thường (bộ che ở cổng là lớp sau, không thay thế).
2. **L2 Coding "Hỏi"**: workspace còn TỰ ĐÍNH KÈM ngữ cảnh khác ngoài tool đọc (repo-context 4k tiêm sẵn, TERMINAL/đuôi sống, Problems, log dán) ⇒ bảng D2: terminal/log/đầu ra lệnh ⇒ KHÔNG gửi khi model ngoài (hoặc van-hanh); repo-context tiêm sẵn ⇒ cũng qua deny-list.
3. **D10(ii) "một lượt bay/người"** phải sống qua nhiều tiến trình/khởi động lại: lưu DB (hàng/khoá có TTL, hết hạn khi tiến trình chết), không chỉ bộ nhớ; đột biến: bỏ giải phóng khi lỗi/huỷ ⇒ người dùng kẹt vĩnh viễn ⇒ test TTL.
4. **D9 dấu nguồn** GHI cùng giao dịch với câu trả lời, KHÔNG có đường client cập nhật; thêm cột cho cả coding session/agent run (hoặc, nếu chưa, lượt ngoài ở coding/agent coi như history `van-hanh` + bọc UNTRUSTED); test: client sửa/ghi đè dấu ⇒ bị bỏ.
5. **`CAN_XAC_NHAN_VAN_HANH`**: máy chủ trả mã TRƯỚC khi gọi nhà cung cấp (không tốn phí, không egress) + test "không gọi mạng khi chưa xác nhận"; cờ client không nâng được mức hay bỏ qua 403 `NGOAI_DU_LIEU_VAN_HANH`.
6. Migration: dải 0417–0418, DDL owner `aoi`, idempotent, áp `_test` trước; census cột mới.

## 7. Rủi ro và giới hạn

- **Egress tự động mỗi lượt** — cái giá của yêu cầu chủ dự án; giảm bằng mặc định đóng theo bề mặt, người gõ = vận hành ⇒ đòi quyền nhà máy, đồng ý theo phiên + xác nhận vận hành, trần chi phí, che, tập đọc thuần, deny-list dùng chung. Vẫn là rào chống NHẦM (spec §9).
- Chat nhiều lượt với model ngoài cần nhà máy cho dữ liệu vận hành (history client = van-hanh; người gõ = van-hanh) ⇒ model ngoài ở chat là tính năng **chỉ cho nhà máy đã bật dữ liệu vận hành**; nới ⇒ nhật ký lượt do MÁY CHỦ ghi (N2, backlog).
- Không stream; độ trễ cao hơn model cục bộ — UI nói rõ.
- Extension: nếu không chứng minh được M3/M4 trên host ⇒ KHÔNG agent với model ngoài ở extension.
- Che theo mẫu có giới hạn đã khai (spec §9); deny-list là rào theo tên/đuôi, không thay trách nhiệm người dùng với nội dung tệp cho phép.
- Ngoài phạm vi: stream thật, fine-tune (G9), tool ghi cho model ngoài, bài học (10.5).

## 8. Thứ tự

10.4 gộp xong → **L0** (server do-model ‖ client luong-ui) → **L1** → **L2** → **L3** → **L4** → **E** (extension 0.5.0). Báo cáo nghiệm thu 10.4b sau L4 (+E). 10.5 (hàng chờ/duyệt bài học) sau đó — nhắc lại điều kiện UNTRUSTED (N4 của 10.4) và "chỉ qua người duyệt" (D9-iv).

## 9. Trả lời đã có

dieu-phoi: Q1 ĐỒNG Ý (không stream; van-hanh chưa cho ⇒ 403 trước khi gọi) · Q6 TÁCH (extension 0.5.0 sau L1–L3; agent ở extension chỉ khi harness LIVE chứng minh) · Q7 PHIÊN đủ kèm nhãn mỗi lượt + đổi model/nhà cung cấp hỏi lại. kiem-dinh: Q1 đồng ý · Q2 backlog theo N2 · Q3 do-model (mặc định van-hanh) · Q4 đồng ý thủ tục đọc nhẹ, quyền tối thiểu Q2(b) · Q5 như D10 + deny-list M3 · Q6 như D8 · Q7 phiên + xác nhận van-hanh (N1).

## 10. Câu hỏi còn mở

- **Q-A (chủ dự án, dieu-phoi đang hỏi):** kiem-dinh ĐỒNG Ý ĐÓNG: chat/KB/bong bóng với model ngoài **chỉ cho nhà máy đã bật dữ liệu vận hành**. Chế độ "chỉ kỹ thuật" cho chat ⇒ **BACKLOG, không làm ở 10.4b** (câu gõ không chứng minh được là kỹ thuật, chỉ là lời khai người dùng); nếu sau này mở ⇒ công tắc RIÊNG của admin nhà máy (không gộp `choDuLieuVanHanh`), tắt truy hồi KB vận hành + nguCanh, cảnh báo cố định.
- **Q-B — ĐÃ CẤP:** dải **0417–0418** (0419 dự phòng); do-model viết SQL gửi dieu-phoi trước khi áp DEV. DDL bằng owner `aoi`, idempotent, áp `_test` TRƯỚC; census cột mới không lộ ra `list` của client chưa cần.
- **Q-C (do-model):** chốt chữ ký `ghepPhan`, danh sách khối thực tế của đường KB/chat hiện tại (bảng D2) — xác nhận/sửa từng dòng; `loaiKho` của chunk có ở đâu.
- **Q-D (do-model):** vị trí module deny-list `shared/` (ý kiến: `shared/aiNgoaiDenyList.ts`, thuần, không phụ thuộc Node `fs` — chuẩn hoá đường dẫn nhận hàm `realpath` tiêm vào để dùng được ở extension host lẫn máy chủ).
- **Q-E (do-model):** cơ chế "1 lượt ngoài bay/người" + trần chi phí/run (giữ chỗ nguyên tử cộng dồn): bảng đếm hiện có (`ai_ngoai_dem`) có đủ hay cần khoá run?
- **Q-F — ĐÃ CHỐT:** TÁCH L0a / L0a' / L0b (xem §4).
