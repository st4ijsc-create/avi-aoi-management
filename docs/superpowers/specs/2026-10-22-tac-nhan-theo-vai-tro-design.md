# Tác nhân lập trình theo VAI TRÒ + qua aiGateway — thiết kế ngắn (2026-10-22, do-model; dieu-phoi DUYỆT kèm 4 chỉnh — §5)

## 1. Hiện trạng (đo, không suy)

- `server/services/ai/agent/goiModelMayChu.ts` gọi THẲNG `aiGgufEngine.chatCompletionStream(options, modelId)` với `modelId =
  cauHinh.modelId` (vắng) hoặc `codeModelBasename()` khi `AI_CODING_MODEL_TASK=code` ⇒ thực tế luôn là model MẶC ĐỊNH của
  llama-server (35B). Không qua `resolveLogicalModel` ⇒ **gán vai trò (`ai_model_bindings`, `code.plc` → 27B) không có tác dụng**
  với tác nhân. Đo: ablation 2026-10-22 lần 1 — khoá khe giữ 27B, mọi lượt tác nhân bị từ chối (`MODEL_LOI`, 0 tool).
- Đường này nằm NGOÀI aiGateway ⇒ không quota/safety/license, không `ai_gateway_metrics`/`ai_llm_audit` (luong-ui đo; cùng tình
  trạng: `phuQuyetToolNative.hoiModelChonTool`). luong-ui đang thêm helper CHỈ-GHI (metrics + audit, không gating) — thiết kế này
  bổ sung phần ĐỊNH TUYẾN và GATING, dùng lại helper ấy cho phần ghi.

## 2. Đề xuất

**2.1 Chọn vai trò MỘT lần mỗi lượt chạy** (không theo từng lượt tool — đổi model giữa vòng tool làm hỏng prefix-cache và hội thoại):
- `vaiTro = "code.plc"` khi dự án được nhận diện là PLC: (i) tệp `.st`/`.scl` trong cây 2 tầng, hoặc `.xml` CHỈ khi là PLCopen thật (chứa namespace `http://www.plcopen.org/xml/tc6` —
  đọc ≤ 4 KB đầu tệp qua hộp cát; mọi `.xml` khác KHÔNG tính) — (chỉnh 1) mà lõi đã đọc
  (`nguCanhDuAn.cay`), HOẶC (ii) tín hiệu chữ tầng 3 (`shared/aiRoles.ts`) trên câu hỏi chọn `code.plc`; ngược lại `vaiTro = "code"`.
- `modelId = resolveLogicalModel(vaiTro, { phamVi: { projectId } })` — đi đúng `dinhTuyenVaiTro` (gán theo dự án > bề mặt > global,
  khoá khe + `kheDangGiu` của 4e1b235db). Ghi `vaiTro`, `modelId`, `nguon` (gan-profile/du-phong/mac-dinh-env) vào sự kiện `bat-dau`
  để UI hiện "đang chạy 27B vì dự án PLC" (minh bạch, không đổi lặng lẽ).

**2.2 Đổi khe** — `chatCompletionStream` đã đi `quaKheNangLuong` (chờ đổi khe có chính sách). Một lượt chạy giữ CÙNG model suốt vòng;
lượt đầu có thể chờ đổi khe (hiện `dang-cho-model`). Trần đổi khe theo token (`tranDoiKheToken`, M4) áp theo `runId` để một người
không giật khe qua lại. Khoá khe còn hiệu lực + model vai trò ≠ khe đang giữ ⇒ `dinhTuyenVaiTro` đã trả dự phòng/khe đang giữ;
(chỉnh 2) Khoá khe giữ model KHÁC + tác nhân `code`: KHÔNG từ chối nếu model khe đang giữ là một hồ sơ HỢP LỆ cho vai trò `code`
(vd 27B làm code được) — khai dự phòng `code` → hồ sơ đang giữ, đi qua `dinhTuyenVaiTro` (không lối tắt riêng). Chỉ khi KHÔNG có
model chấp nhận được mới từ chối NÓI THẬT ở `bat-dau` (không chạy 0 tool rồi báo "xong"). Lý do: đêm có phép đo giữ khoá ⇒ mọi
người dùng tác nhân sẽ bị chặn (đã xảy ra: ablation 2026-10-22 lần 1).

**2.3 Gating** — một `planInference` MỖI LƯỢT CHẠY, ở đầu, trên câu hỏi của người dùng:
- License/Safety/Quota/RateLimit chặn TRƯỚC token đầu tiên ⇒ lỗi rõ ràng ở `bat-dau`. KHÔNG kiểm lại giữa vòng tool: một lượt chạy
  là MỘT yêu cầu của người dùng; ném RateLimit ở lượt tool thứ 7 để lại cây làm việc nửa vời (đã có checkpoint nhưng UX tệ).
- Quota (chỉnh 3): ước lượng = trung vị token/lượt chạy ĐO ĐƯỢC × hệ số an toàn — nguồn số: ablation tác nhân 2026-10-22 (35B, 48
  lượt chạy ST): token ra trung vị ~31k (tat 30,2k · bat 32,3k); hệ số 2 ⇒ ~64k/lượt chạy. KHÔNG dùng `soLuotToiDa × maxTokens`
  (chặn thừa). Vượt ⇒ báo ở `bat-dau`, không ném giữa chừng. Hằng số ghi nguồn tại chỗ, có biến môi trường ghi đè.
- Mỗi lượt model trong vòng: ghi metrics bằng `recordPhu({ luotPhu: "agent-luot", requestId: runId })` (mig 0406), lượt chính
  `record` khi kết thúc lượt chạy (tổng token, kết cục). Audit: một hàng/lượt chạy (đã có helper của luong-ui).
- Safety trên KẾT QUẢ TOOL đã có (`lamSachChoModel`, `dangNgo`); Safety đầu vào = `planInference.safeText` cho câu hỏi.

## 3. Cổng đo (viết trước khi làm)

- Ablation tác nhân trên 12 bài ST (cùng danh sách `ablation-compile-st-2026-10-21`) × 2 lượt: vai trò `code` (35B) vs `code.plc`
  (27B, qua định tuyến mới). Cổng: `code.plc` ≥ `code` + 2/24 VÀ trung vị thời gian ≤ 2× (27B dày chậm hơn MoE). Không đạt ⇒ giữ
  gán `code.plc` cho /v1 và Luồng nhưng tác nhân ở `code`.
- Lưới: (i) dự án có `.st` ⇒ `bat-dau.vaiTro = code.plc` và engine nhận model 27B; dự án TS ⇒ `code`; (ii) khoá khe giữ 27B + tác nhân
  `code` ⇒ từ chối nói thật ở `bat-dau` (KHÔNG chạy 0 tool rồi chấm); (iii) RateLimit/Quota/Safety ném ở `planInference` ⇒ không token
  nào ra, không checkpoint; (iv) metrics: N lượt model ⇒ N hàng `luotPhu='agent-luot'` + 1 hàng chính cùng `requestId = runId`.

## 4. Không làm (ngoài phạm vi)

Đổi model GIỮA lượt chạy theo loại lượt tool (đọc vs sửa); chọn vai trò bằng LLM; định tuyến cho `phuQuyetToolNative` (đề xuất riêng).

## 5. Chỉnh của dieu-phoi khi duyệt (2026-10-22)

1. `.xml` chỉ tính khi là PLCopen thật (namespace tc6) — §2.1.
2. Khoá khe giữ model khác: dự phòng `code` → hồ sơ đang giữ nếu hợp lệ; chỉ từ chối khi không có model chấp nhận được — §2.2.
3. Quota theo trung vị token đo được × hệ số an toàn, ghi nguồn số — §2.3.
4. Cổng đo §3 đăng ký vào spec §6 (2026-10-20 design) TRƯỚC khi làm — đã ghi (7a5f4bfc5).
Hiện thực sau cờ, mặc định TẮT. Thứ tự: sau --ir + census; chạy đo SAU A/B /v1 #2.

## 6. Hiện thực (2026-10-22, do-model) — cờ `AI_AGENT_THEO_VAI_TRO` (mặc định BẬT từ 2026-10-23 sau ablation 19/24 vs 15/24; `false` ⇒ tắt)

- `server/services/ai/agent/vaiTroTacNhan.ts`: `chonVaiTroTacNhan` (PLC ⇒ `code.plc`; "code" của thiết kế = vai trò gốc `code.software`),
  `chuanBiLuotChayTheoVaiTro` (`dinhTuyenVaiTro` với `phamVi.projectId` + khoá khe/khe đang giữ; khoá còn hạn mà đích cuối là model khe nặng
  KHÁC model đang giữ ⇒ `AI_KHONG_CO_MODEL` 503 nói thật; rồi MỘT `planInference({ task: "code", auditTask: "agent_run", uocLuongToken })`;
  RateLimit/Quota/Safety/License ⇒ 429/429/422/403), `boDemLuotModel` (đo mỗi lượt model ⇒ `recordPhu agent-luot`).
- `quanLyLuotChay`: gating SAU giữ chỗ, TRƯỚC hàng sổ — từ chối ⇒ nhả chỗ, không hàng sổ, không token; model nhận `safeText`; `bat-dau.model`
  = {vaiTro, model, nguon, bangChung}; kết thúc ⇒ `record` hàng chính cùng `requestId = runId`. REST trả `message` cho mã từ chối.
- `aiGateway.GatewayRequest.uocLuongToken` (chỉnh 3): `AI_QUOTA_ENFORCE` bật + đã dùng + ước lượng > hạn mức ⇒ chặn ở cửa. Mặc định 64 000
  (`AI_AGENT_UOC_LUONG_TOKEN`).
- Chỉnh 2 là việc DỮ LIỆU: sổ dev hiện gán `code.software` theo env (35B, không dự phòng) ⇒ khi phép đo khoá khe giữ 27B, tác nhân dự án
  không-PLC bị TỪ CHỐI nói thật. Muốn chạy được trên 27B lúc ấy: gán `code.software` → hồ sơ 35B với dự phòng [27B] (cần dieu-phoi duyệt).
- Chưa làm: UI hiện `bat-dau.model` (client chỉ nhận, chưa vẽ); mã từ chối mới chưa có chuỗi i18n phía client.
