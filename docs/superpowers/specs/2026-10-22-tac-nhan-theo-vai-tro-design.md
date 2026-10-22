# Tác nhân lập trình theo VAI TRÒ + qua aiGateway — thiết kế ngắn (2026-10-22, do-model, chờ dieu-phoi duyệt)

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
- `vaiTro = "code.plc"` khi dự án được nhận diện là PLC: (i) tệp `.st`/`.scl`/`.xml`(PLCopen) trong cây 2 tầng mà lõi đã đọc
  (`nguCanhDuAn.cay`), HOẶC (ii) tín hiệu chữ tầng 3 (`shared/aiRoles.ts`) trên câu hỏi chọn `code.plc`; ngược lại `vaiTro = "code"`.
- `modelId = resolveLogicalModel(vaiTro, { phamVi: { projectId } })` — đi đúng `dinhTuyenVaiTro` (gán theo dự án > bề mặt > global,
  khoá khe + `kheDangGiu` của 4e1b235db). Ghi `vaiTro`, `modelId`, `nguon` (gan-profile/du-phong/mac-dinh-env) vào sự kiện `bat-dau`
  để UI hiện "đang chạy 27B vì dự án PLC" (minh bạch, không đổi lặng lẽ).

**2.2 Đổi khe** — `chatCompletionStream` đã đi `quaKheNangLuong` (chờ đổi khe có chính sách). Một lượt chạy giữ CÙNG model suốt vòng;
lượt đầu có thể chờ đổi khe (hiện `dang-cho-model`). Trần đổi khe theo token (`tranDoiKheToken`, M4) áp theo `runId` để một người
không giật khe qua lại. Khoá khe còn hiệu lực + model vai trò ≠ khe đang giữ ⇒ `dinhTuyenVaiTro` đã trả dự phòng/khe đang giữ;
nếu vẫn đòi đổi ⇒ từ chối NÓI THẬT ở `bat-dau` (không chạy 0 tool rồi báo "xong").

**2.3 Gating** — một `planInference` MỖI LƯỢT CHẠY, ở đầu, trên câu hỏi của người dùng:
- License/Safety/Quota/RateLimit chặn TRƯỚC token đầu tiên ⇒ lỗi rõ ràng ở `bat-dau`. KHÔNG kiểm lại giữa vòng tool: một lượt chạy
  là MỘT yêu cầu của người dùng; ném RateLimit ở lượt tool thứ 7 để lại cây làm việc nửa vời (đã có checkpoint nhưng UX tệ).
- Quota: ước lượng chặn trên `soLuotToiDa × maxTokens` so ngân sách còn lại; vượt ⇒ hạ `soLuotToiDa` và báo, không ném giữa chừng.
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
