# Đợt 10.3 — Cổng AI ngoài: báo cáo nghiệm thu

> Phiên **do-model** · nhánh `feat/ai-do-model` · 2026-10-26 · main đã có tới `6d3860227` (fresh/main `a03700211`); gộp tiếp tới `c6f6f0cb7` (cổng dieu-phoi)
> Spec: `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` · Kế hoạch: `docs/superpowers/plans/2026-10-26-dot10-3-cong-ai-ngoai.md`
> Người đọc: dieu-phoi (gộp), kiem-dinh (rà checklist A–F), chủ dự án (§5 vận hành), luong-ui (§7 bàn giao 10.4).

## 1. Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Task 1–10 (B1–B4) | XONG. kiem-dinh ĐẠT từng lô: lô 1–2, Task 7, Task 8, Task 9 + sửa proxy, Task 10 (13/15 đột biến bắt; 2 lỗ đã đóng ở `1b01838d8`) |
| Gộp main | Task 8+9+10 tới `6d3860227` đã lên fresh/main `a03700211` (cổng dieu-phoi; đỏ duy nhất — census nguoiDungTest ở `flowRouterNgoai.db.test.ts` — dieu-phoi sửa bằng `taoNguoiDungTest`). `1b01838d8` (3 mục bắt buộc của rà T10) + `c6f6f0cb7` ĐÃ được kiem-dinh xác nhận; kiem-dinh NGHIỆM THU 10.3 ĐẠT (A–F); cổng gộp `c6f6f0cb7` do dieu-phoi chạy |
| Migration 0413–0416 | ĐÃ ÁP **DEV** + **_test**, nghiệm thu bằng `avi_app` (cấu trúc · quyền · hành vi hoàn tác · sổ). 0414 áp DEV 2026-10-26 theo hiệu lệnh dieu-phoi; CHECK `ai_api_keys_active_can_nha_may_chk` đã đặt lại trên _test |
| tsc toàn cây (`--max-old-space-size=12288`) | 0 lỗi (cây gộp `f560f8d77`) |
| Lưới lô | ngoai + flow + flowRouter + aiNgoai + openaiGateway + chonModel + 3 census + appErrorParamsCoverage: xanh (lượt cuối: ngoai + flow/nut 365/365; trước đó lô rộng 1022/1022) |
| **Task 11 — quét toàn bộ** (`server/services/ai server/services/flow server/routers server/routes ensus`, cây gộp `f560f8d77`) | 896 tệp / 11 871 ca: **11 858 xanh · 3 đỏ · 10 bỏ qua** (671 s). Đỏ 1+2: `rawErrorCensus` 463 > 462 — do `throw new Error` mới ở `hostAiNgoai.docHostDongTuDb` (`1b01838d8`) ⇒ ĐÃ VÁ thành `LoiHttpLuong(DICH_AI_KHONG_RO)`, chạy lại 32/32 xanh. Đỏ 3: `orchestrationScope.dot5.db.test` F3 (23,9 s dưới tải, không thuộc lô) — chạy riêng 30/30 xanh ⇒ chậm dưới tải, không phải hồi quy |
| Cờ | `AI_NGOAI_ENABLED` mặc định `false` (`.env.example`). Mọi nhà máy mặc định TẮT (`ai_ngoai_nha_may` vắng ⇒ tắt hết). Không có khoá thật trong repo/.env. Mọi lưới dùng máy chủ giả trong tiến trình |

Census GHIM trên nhánh: `congGiayPhepAi` 2425 / beMatAi 452 / aiCoCong 390 / aiMienTru 62 · `phamViDoc` A35 B8 C453 D1212 S717 tổng 2425 · `phamViGhi` 1212 / nợ 142 · `duongVong` 64 tệp miễn trừ / 97 điểm. Gộp vào main mới ⇒ dieu-phoi đo lại trên cây gộp.

## 2. Đã giao (theo kế hoạch)

| Task | Nội dung | Commit chính |
|---|---|---|
| 2 | Migration 0413–0416: enum nhà cung cấp; khoá theo nhà máy (CHECK active ⇒ có nhà máy); cấu hình / model / host nội bộ; sổ + đếm; duyệt phiên bản luồng | `bc08d9637` `1ab263b2f` |
| 3 | Phân loại mức dữ liệu theo LƯỢT (34 loại node + census registry; node lạ ⇒ `van-hanh`; taint đơn điệu) | `c148d3efd` |
| 4 | Trần chi phí đặt-trước NGUYÊN TỬ (một câu INSERT…SELECT…WHERE ON CONFLICT; token + tiền + phút) | `99e8ca82f` |
| 5 | Sổ WORM: ý định trước gọi / kết quả tối đa một; băm nội dung đã che; lưu nguyên văn chỉ khi nhà máy bật | `56410cec1` |
| 6 | Cổng `goiAiNgoai` 12 bước + bộ che (`cheDuLieu.ts`, 103 vectơ) + node AI / `ai.agent` dùng `ngoai:<ncc>:<model>` | `fdb38f34e` `a4ed92b89` `1da570272` `d759311e1` |
| 7 | Khoá theo nhà máy (`aiNgoai.taoKhoa/xoayKhoa/thuHoiKhoa/dsKhoa`) + thủ tục khoá cũ `aiSettings` có phạm vi + audit cùng giao dịch | `a07e038bb` `85a8c4395` `2cf457fd1` |
| 8 | Cấu hình / danh mục / host nội bộ / xem nội dung / DUYỆT NGOÀI + `/v1` | `dab03f8df` `7f518bfdd` `2b75ac824` |
| 9 | Mạng ngoài + 4 nhà cung cấp (Anthropic, OpenAI, Gemini, tương thích OpenAI); DNS một lần + ghim IP; không chuyển hướng; không proxy env; TLS mặc định; trần 4 MB / 120 s | `4143af9bf` `f72dfff60` |
| 10 | B4 — rào chống nhầm đường vòng (host AI tĩnh + động, lúc lưu / lúc gọi / MCP lúc nạp + lúc gọi) + census điểm gọi mạng toàn `server/` | `86a20c5e6` `1b01838d8` |

## 3. Phát hiện thật trong lúc rà (đã sửa, có lưới đột biến)

1. **Duyệt chỉ kiểm lúc BẬT** ⇒ chạy tay phiên bản chưa duyệt, hoặc cha "sạch" gọi con ghim phiên bản chưa duyệt, đi qua được. Sửa: kiểm ở `taoRunTx` (mọi lượt), ở `kiemGoiLuongCon` (bước cha lỗi sạch), và ở cổng (phòng thủ chiều sâu).
2. **Host nội bộ ĐÃ KHAI nhưng phân giải ra 169.254.169.254** ⇒ lọt tới metadata đám mây. Sửa ở cổng ngoài, và ở `kiemDichDen` của Luồng: link-local / metadata LUÔN cấm, kể cả khi danh sách trắng ghi host:cổng. dieu-phoi ĐỒNG Ý thay đổi này.
3. **Proxy env (Node ≥ 24)**: `NODE_USE_ENV_PROXY=1` / `http.setGlobalProxyFromEnv()` đẩy `http.request` qua `HTTP(S)_PROXY` ⇒ vô hiệu ghim IP. Lỗi ảnh hưởng cả node HTTP/MCP của Luồng (Đợt 9). Sửa: `fetchGhim` dùng agent riêng. Test trong tiến trình + tiến trình con thật.
4. **Tập động so IP bỏ qua cổng** ⇒ khai `llm.local:8000` chặn oan mọi dịch vụ cùng máy (kể cả MCP cục bộ `127.0.0.1:8811`). Sửa: so cặp host:cổng / IP:cổng.
5. **Tập động fail-open khi CSDL vắng** ⇒ sửa thành ném `DICH_AI_KHONG_RO`.
6. `/v1` chưa tính lượt mang kết quả tool là `van-hanh`. `duyetNgoai` ghi đè người duyệt khi băm không đổi. `max_tokens` rác chưa kẹp ở biên. Cả ba đã sửa.

## 4. Mã lỗi

`MaLoiNgoai` (`server/services/ai/ngoai/loi.ts`) → tRPC → HTTP (`/v1`):

| Mã | tRPC | HTTP | Nghĩa |
|---|---|---|---|
| `NGOAI_TAT`, `NGOAI_KHONG_TON_TAI` | NOT_FOUND | 404 | cờ tắt / nhà máy-model-khoá không có hoặc ngoài phạm vi (không lộ tồn tại) |
| `NGOAI_QUA_LON` | PAYLOAD_TOO_LARGE | 413 | đầu vào vượt 256 KB/chuỗi hoặc 1 MB tổng |
| `NGOAI_VUOT_TRAN` | TOO_MANY_REQUESTS | 429 | vượt trần ngày / người / luồng / lượt / phút |
| `NGOAI_DEM_HONG`, `NGOAI_SO_HONG`, `NGOAI_CHE_HONG` | SERVICE_UNAVAILABLE | 503 | bộ đếm / sổ / bộ che lỗi ⇒ đóng |
| `NGOAI_NHA_CUNG_CAP_LOI`, `NGOAI_PHAN_HOI_QUA_LON` | BAD_GATEWAY | 502 | nhà cung cấp lỗi / phản hồi > 256 KB |
| `NGOAI_DU_LIEU_VAN_HANH`, `NGOAI_LUONG_TOAN_CUC`, `NGOAI_TU_DUYET_VAN_HANH`, `NGOAI_CHUA_DUYET` | FORBIDDEN | 403 | dữ liệu vận hành chưa cho / luồng toàn hệ thống / tự duyệt luồng có số liệu / phiên bản chưa duyệt |
| `NGOAI_CAM_DINH_KEM`, `NGOAI_TOOL_KHONG_CAP`, `NGOAI_KHOA_KHONG_HOP_LE`, `NGOAI_MODEL_KHONG_HOP_LE`, `NGOAI_URL_KHONG_HOP_LE` | BAD_REQUEST | 400 | đính kèm / tool trả về ngoài tập cấp / khoá sai dạng / tên model / endpoint |

Mã của lớp mạng Luồng (`LoiHttpLuong.ma`): `DICH_LA_AI_NGOAI` (đích là máy chủ AI — chỉ qua node AI `ngoai:…`), `DICH_AI_KHONG_RO` (không đọc được tập động ⇒ đóng), `DICH_METADATA`, `DICH_NOI_BO`. Lỗi lượt: `LoiLuong NGOAI_CHUA_DUYET`. Khoá i18n `errors.*` đủ vi/en/zh (`entityDictionaryCoverage`, `appErrorParamsCoverage` xanh).

## 5. Vận hành — việc của CHỦ DỰ ÁN (spec §8)

Thứ tự bật cho một nhà máy. Không bước nào làm qua `.env` hay qua phiên Claude:

1. **Tạo khoá** trong màn quản trị (`aiNgoai.taoKhoa`, gắn nhà máy). KHÔNG đặt khoá trong `.env`, KHÔNG gửi khoá qua bất kỳ phiên Claude nào.
2. **Danh mục model** (`aiNgoai.datModel`): bắt buộc có giá vào/ra HOẶC trần token mỗi lượt (CHECK 0414).
3. **Cấu hình nhà máy** (`aiNgoai.ghiCauHinh`): `batNgoai`; trần ngày (token / USD), trần mỗi người / mỗi luồng / mỗi lượt / số lần mỗi phút; `hanGiuNgay`. Mở `batNgoai` / `choDuLieuVanHanh` / `luuNguyenVan` ⇒ audit mức CAO.
   - ⚠ Ước tính token lúc ĐẶT TRƯỚC là BI QUAN (byte UTF-8 / 2 ⇒ cao hơn thật **2–4×** với tiếng Anh / mã — tiếng Việt có dấu chưa đo) — chỗ dư hoàn lại khi kết toán, nhưng trần chặn SỚM: đặt trần ngày / người / luồng / lượt theo nhu cầu thật × hệ số 2–4.
4. **Quyết riêng "dữ liệu vận hành"** (`choDuLieuVanHanh`). Mặc định TẮT: số liệu / kết quả tool / ngữ cảnh KB nhà máy không ra ngoài.
5. **Host nội bộ** cho máy chủ tương thích OpenAI trong mạng nhà máy (`aiNgoai.datHostNoiBo`, chỉ admin toàn hệ). Khai đúng `host:cổng`.
6. **Luồng dùng model ngoài**: mỗi PHIÊN BẢN phải `aiNgoai.duyetNgoai`. Băm định nghĩa đổi ⇒ phải duyệt lại. Luồng toàn hệ thống không dùng được.
7. **Bật cờ toàn cục** `AI_NGOAI_ENABLED=true` ở môi trường chạy (cổng 3000) — bước cuối.
   - **Danh sách TRƯỚC KHI BẬT (kỹ thuật, bắt buộc — rà kiem-dinh):** bộ che chặn ba cách né khối 2–8 KB: (a) đoạn bảng base64/hex ≥ 2 000 ký tự bất kể ký tự dính hai bên; (b) ≥ 12 dòng liên tiếp ≥ 40 ký tự toàn bảng base64 (PEM / MIME không nhãn); (c) hex ngăn `:` / khoảng trắng ≥ 900 cặp — ĐÃ CÀI (commit sau `b837a99cd`), kèm lưới tuyến tính 25 họ. Chỉ bật sau khi commit này đã lên main.
8. ⚠ `BUILT_IN_FORGE_API_URL` phải để RỖNG (hiện rỗng). Đặt nó = mở đường ra ngoài KHÔNG qua cổng — cần quyết định riêng (§12 tài liệu an ninh).
9. ⚠ **Ảnh cho phân tích AI** (`annotation.analyzeImage`, `inspection.analyzeWithAI`): `imageUrl` dạng URL TUYỆT ĐỐI tới kho / máy NỘI BỘ — **kể cả chính server** (`http://localhost:3000/uploads/…`, `http://10.x/…`) — bị ĐÓNG (`anh-dich-cam`) cho tới khi khai `host:cổng` vào `AI_IMAGE_HOST_CHO_PHEP`. Khoá kho tệp / đường tương đối (`/uploads/…`) và `data:` không đi mạng ⇒ vẫn chạy. Ảnh http chỉ tải khi sidecar thị giác sẵn sàng.

## 6. Rủi ro còn lại — đã quyết (dieu-phoi, ghi ở `docs/AI_FLOW_SECURITY_OPERATIONS.md` §12)

- Đích admin cấu hình ngoài Luồng (`webhookRouter`, `erpOutbox`, `spcAlertSink`, `siemExporter`, `reportDeliveryService`): **CHẤP NHẬN**. B4 là rào chống nhầm cho Luồng. Backlog: kiểm lúc lưu cấu hình.
- Dịch vụ "forge" của khung gốc: không hoạt động (URL rỗng). Đặt URL cần chủ dự án quyết. Census giữ miễn trừ có ⚠.
- URL máy suy luận "cục bộ" do quản trị đặt (`OLLAMA_BASE_URL`, `LLAMA_SERVER_URL`, KB API): cùng lớp rủi ro admin.
- `kiemDichDen` luôn cấm link-local / metadata: **ĐỒNG Ý**.
- **Bộ che — khối mã hoá dài, giới hạn đã biết (dieu-phoi quyết, không chặn):** sau `0aa62d6e6` vẫn LỌT ba dạng cố ý né — base64 chèn dòng trống giữa các dòng (hoặc mỗi 10 dòng), tiền tố trích dẫn `> ` mỗi dòng, hex ngăn `, `. Bộ che là rào chống NHẦM, không chống người cố ý né (spec §9).
- Giới hạn của bộ che, taint theo lượt, văn bản người dùng tự dán = `ky-thuat`: xem spec §9.

## 7. Bàn giao cho 10.4 (luong-ui)

- Thủ tục: `aiNgoai.{taoKhoa, xoayKhoa, thuHoiKhoa, dsKhoa, cauHinh, ghiCauHinh, dsModel, datModel, dsHostNoiBo, datHostNoiBo, xemNoiDung, duyetNgoai}`.
  - Tất cả `adminProcedure` + `MOD_AI`, phạm vi nhà máy, ngoài phạm vi ⇒ NOT_FOUND.
  - `duyetNgoai` trả `{ tuDuyet, bam, daDuyetTruoc }`.
  - `aiChonModel.danhMuc` liệt kê `ngoai:<ncc>:<model>` của nhà máy người gọi.
- **BẮT BUỘC (rà kiem-dinh mục 13)**: khi người dùng chọn model ngoài trong màn lập trình / extension, mặc định BỎ tool ghi / chạy (`ghi_tep`, `chay_lenh`, `ap_diff`…) khỏi tập cấp — chỉ đọc + tra tài liệu. Bật lại phải là hành động TƯỜNG MINH.
- UI ghi rõ: văn bản tự dán / payload `kich-hoat.tay` được coi là `ky-thuat` — trách nhiệm của người dán.
- Chưa cài (trả lỗi rõ, không âm thầm): bề mặt KB / chat / tác nhân lập trình với `ngoai:` ⇒ 404 "chưa cài đặt" (cần lô riêng). `chayThuNut` của node dùng model ngoài luôn `NGOAI_CHUA_DUYET` (không có phiên bản để duyệt) — đóng có chủ ý.
- `vectorChe.ts` = bộ vectơ che dùng chung cho đột biến của kiem-dinh.

## 8. Backlog sau 10.3 (chưa làm)

1. ~~`server/_core/llm.ts:237` tải `image_url` bằng `fetch` thô~~ — XONG (lô sau nghiệm thu, phương án B của dieu-phoi): SSRF THẬT (nguồn: `annotation.analyzeImage` chuỗi tự do của người dùng; `inspection.analyzeWithAI` đọc URL do Machine API ghi). Nay qua `_core/taiAnhAnToan.ts` (ghim IP, metadata cấm, nội bộ chỉ khi khai `AI_IMAGE_HOST_CHO_PHEP`, không chuyển hướng, 20 MB, 15 s, `image/*`); ảnh http CHỈ tải khi sidecar thị giác sẵn sàng; `annotation.analyzeImage` sau MOD_AI. **Backlog mới:** Machine API `imageUrl: z.string().url()` — kiểm dạng URL lúc GHI (chỉ khoá kho tệp / data: / host khai).
2. ~~Forge: lưới "URL rỗng ⇒ 0 lời gọi" + cảnh báo khởi động~~ — XONG (lô sau nghiệm thu): `forgeNgoai.ts` + test, cảnh báo khởi động một lần, `oversight.posture.forgeNgoaiBat`.
3. Kiểm `chanHostAiNgoai` lúc LƯU cấu hình của 5 đích admin ở §6.
4. `urlNgoai`: host nội bộ đặt tên công khai (vd `gpu.nhamay.vn` → 10.x) bị buộc https dù đã khai. Hạn chế chức năng, không phải lỗ.
5. ~~Bộ che: trần chuỗi liền 2 000~~ — XONG (lô sau nghiệm thu): ĐO trên `aiSafety` tuyến tính, KHÔNG trần, 12 họ xấu × 256 KB ⇒ chậm nhất 30 ms, t(2n)/t(n) 1,0–2,8. Trần 2 000 che nguyên khối log JSON gọn 2,4 KB (mất dữ liệu kỹ thuật) ⇒ trần chung **8 000** ký tự bất kỳ + (rà kiem-dinh) chuỗi liền ≥ **2 000** ký tự TOÀN bảng base64 / base64url / hex ⇒ che (keystore / PFX / DER dán một khối 2–8 KB không lọt). Lưới: base64 3/6 KB, hex 5 KB ⇒ che; JSON gọn 3,6 KB + log 2,4 KB ⇒ giữ; 4 đột biến ⇒ đỏ.
6. Bề mặt KB / chat / tác nhân lập trình với model ngoài (§7).
