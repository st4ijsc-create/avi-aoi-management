# Đợt 7 · Pha 7.1 — Bộ giám sát KHE NẶNG (hoán đổi model theo hàng đợi ái lực) · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một yêu cầu cho model nặng KHÁC model llama-server đang giữ được phục vụ bằng cách hoán đổi khe có chính sách
(gom theo model, lưu trú tối thiểu, ưu tiên người > nền), không bao giờ nạp model nặng thứ hai trong tiến trình.

**Architecture:** `KheNang` (bộ lập lịch thuần, đồng hồ tiêm) đứng TRƯỚC cổng ưu tiên trong `aiLlamaServerClient`
(`postChatCompletion`, `streamChatCompletion`). Hoán đổi dùng lại `DieuPhoiDoiModel` ở chế độ TẠM (không ghi lựa chọn
bền, không phủ env) ⇒ model "nhà" (lựa chọn quản trị / `.env`) giữ nguyên nghĩa. "Tập khe nặng" H = {model nhà} ∪
{artifact của hồ sơ `nang` bật + có tệp}; `laModelServerDangGiu(M)` = M ∈ H (cùng một vị từ cho ĐƯỜNG ĐI và ĐƯỜNG CẤM
nạp trong tiến trình). H = {nhà} ⇒ đi tắt, hành vi y như trước.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §3.5, §6 (7.1).

## Global Constraints
- Giữ Q5: một llama-server 1 × 64k; không thêm tiến trình phục vụ.
- Chỉ tiến trình API được TỰ đổi khe (`batTuDoiKheNang()` gọi ở `server/_core/index.ts`); worker chỉ dùng model đang giữ
  (đổi khe chéo tiến trình có thể giết lượt đang chạy của tiến trình kia — `giuCong` chỉ thấy cổng của chính nó).
- `AI_KHE_NANG_HOAN_DOI=false` ⇒ tắt tự đổi (yêu cầu model khác ⇒ lỗi nói thật, không nạp gì).
- Mặc định: lưu trú tối thiểu 60 s · nền chờ tối đa 10 phút trước khi buộc đổi · rảnh 10 s mới đổi sang model khác ·
  về model nhà sau 15 phút rảnh · đổi hỏng ⇒ nghỉ 60 s cho model đó · xác nhận `/props` có hạn 5 s.
- Không bao giờ để `preempt()` giết :8091 (lưới `aiLlamaServerClient.napTrung.test.ts` giữ nguyên). Thiếu VRAM khi đổi ⇒
  nhờ broker `preempt("interactive", thiếu)` thu hồi hộ khác (sidecar thị giác, model nhỏ rảnh) rồi kiểm lại MỘT lần.

## Review Focus
1. Server chết giữa lúc đổi ⇒ `DieuPhoiDoiModel` quay về model nhà; `KheNang` phải đọc lại `/props`, từ chối người chờ model hỏng (nghỉ 60 s), không treo.
2. `/props` không đọc được (server đang nạp/chết) ⇒ yêu cầu model nhà đi tiếp (engine tự fail-closed); yêu cầu model khác ⇒ lỗi nói thật.
3. Người chờ bấm Dừng (AbortSignal) giữa lúc đang đổi ⇒ rời hàng ngay, lượt đổi vẫn chạy trọn.
4. Lượt luồng (stream) giữ khe suốt vòng đời; consumer bỏ giữa chừng ⇒ nhả ở `finally`.
5. Hồ sơ `nang` trỏ chính model nhà ⇒ không coi là "model khác", không đổi gì.

---

### Task 1: `DieuPhoiDoiModel` — chế độ TẠM + nhờ broker khi thiếu VRAM

**Files:** Modify `server/services/ai/doiModelLlamaServer.ts` · Test `server/services/ai/doiModelLlamaServer.test.ts`

**Interfaces — Produces:**
- `batDau(tenModel: string, nguoi: string | null, tuyChon?: { ben?: boolean }): Promise<{ id; xong }>` — `ben` mặc định `true` (hành vi cũ). `ben:false` ⇒ bước `ghi-lua-chon` và `ap-dung` thành `bo-qua`; quay về dùng lựa chọn ĐÃ CHỐT như cũ.
- `PhuThuocDoiModel.thuHoiVram?: (thieuByte: number) => Promise<number>` — trả số byte đã thu; `layDieuPhoiDoiModel` nối `vramPreempt.preempt("interactive", thieu)`.
- Khi `canByte > trongSauKhiDungByte` và có `thuHoiVram`: gọi với phần thiếu, đọc VRAM lại, kiểm lại một lần; vẫn thiếu ⇒ `VRAM_KHONG_DU` như cũ (thông điệp thêm "đã thu hồi X GiB").

- [ ] Test: `ben:false` thành công ⇒ tệp lựa chọn KHÔNG được ghi, env không bị phủ, `ketQua:"thanh-cong"`, bước `ghi-lua-chon` = `bo-qua`; thiếu 2 GiB + `thuHoiVram` trả 3 GiB và VRAM đọc lại đủ ⇒ đổi tiếp; `thuHoiVram` trả 0 ⇒ `VRAM_KHONG_DU`; không truyền `thuHoiVram` ⇒ như cũ. Các ca cũ xanh nguyên.
- [ ] FAIL → hiện thực → PASS. Commit.

### Task 2: `KheNang` — bộ lập lịch thuần

**Files:** Create `server/services/ai/soModel/kheNang.ts` · Test `server/services/ai/soModel/kheNang.test.ts`

**Interfaces — Produces:**
```ts
export interface BoPhucVuKheNang {
  modelDangGiu(): Promise<string | null>;               // basename từ /props; null = không đọc được
  doiSang(model: string): Promise<void>;                // ném khi hỏng (đã tự quay về nhà)
}
export interface CauHinhKheNang { luuTruToiThieuMs: number; choNenToiDaMs: number; ranhDeDoiMs: number; veNhaSauMs: number;
  nghiSauHongMs: number; xacNhanMs: number; choToiDaMs: number; tuDoi: boolean; dongHo?: () => number }
export class LoiKheNang extends Error { code: "KHE_NANG_TAT" | "KHE_NANG_HONG" | "KHE_NANG_HET_GIO" | "KHE_NANG_HUY" | "KHE_NANG_SERVER" }
export class KheNang {
  constructor(bo: BoPhucVuKheNang, ch: CauHinhKheNang, modelNha: () => string);
  cho(model: string, muc: MucUuTien, signal?: AbortSignal): Promise<() => void>;
  thongKe(): { dangGiu: string | null; dangDoi: string | null; soLanDoi: number; soLanHong: number; dangChay: Record<string, number>; dangCho: { model: string; muc: MucUuTien; choMs: number }[] };
  dung(): void;                                         // gỡ hẹn giờ (test, tắt tiến trình)
}
```
Luật (spec §3.5): nhận ngay khi không đổi, không "xả" và model = đang giữ. Ngược lại vào hàng. Đánh giá: đích = người
chờ model khác có (hạng mức, thời điểm đến) nhỏ nhất; ĐỔI khi đã lưu trú ≥ `luuTruToiThieuMs` VÀ (đích là `tuong-tac`
HOẶC đích chờ ≥ `choNenToiDaMs` HOẶC model đang giữ rảnh — 0 đang chạy, 0 chờ — ≥ `ranhDeDoiMs`). Quyết đổi ⇒ "xả":
lượt mới cho model cũ cũng vào hàng; đang chạy về 0 ⇒ `doiSang`. Không ai chờ, đang giữ ≠ nhà, rảnh ≥ `veNhaSauMs` ⇒ về
nhà. Hỏng ⇒ người chờ model đó bị từ chối `KHE_NANG_HONG`, model nghỉ `nghiSauHongMs`, đọc lại `/props`. `tuDoi:false` ⇒
model khác ⇒ `KHE_NANG_TAT` ngay.

- [ ] Test (đồng hồ giả + `vi.useFakeTimers`): (a) **cổng 7.1**: 30 yêu cầu xen kẽ A/B theo 3 đợt (A×10, B×10, A×10) ⇒ số lần đổi ≤ 3 + 1; (b) có người `tuong-tac` cho A đang chạy liên tục + một yêu cầu `nen` cho B ⇒ mọi yêu cầu A được nhận không chờ đổi cho tới khi B chờ đủ 10 phút; (c) trong 60 s lưu trú, yêu cầu `tuong-tac` cho B chờ, sau 60 s thì đổi; (d) `doiSang` ném ⇒ người chờ B nhận `KHE_NANG_HONG`, yêu cầu B kế trong 60 s bị từ chối ngay, sau 60 s được thử lại; (e) abort khi đang chờ ⇒ `KHE_NANG_HUY`, lượt đổi vẫn xong; (f) rảnh 15 phút ở B ⇒ tự về A (nhà); (g) `modelDangGiu` trả null ⇒ yêu cầu nhà đi tiếp, yêu cầu khác `KHE_NANG_SERVER`; (h) `tuDoi:false` ⇒ `KHE_NANG_TAT`.
- [ ] FAIL → hiện thực → PASS. Commit.

### Task 3: Tập khe nặng + nối dây vào client, router, khởi động

**Files:** Create `server/services/ai/soModel/tapKheNang.ts` (thuần), `server/services/ai/soModel/kheNangMacDinh.ts` (đơn thể + `BoPhucVu` thật) · Modify `server/services/aiLlamaServerClient.ts` (`laModelServerDangGiu`, `postChatCompletion`, `streamChatCompletion`), `server/services/ai/soModel/dinhTuyenVaiTro.ts` (`thuProfile` khe nặng), `server/_core/index.ts` · Test `server/services/ai/soModel/tapKheNang.test.ts`, mở rộng `dinhTuyenVaiTro.test.ts`, chạy lại `aiLlamaServerClient.napTrung.test.ts`.

**Interfaces:**
- `modelKheNangPhu(anh: AnhSoModel, modelNha: string): string[]` — basename của hồ sơ `nang` bật + `available`, khác nhà.
- `laModelKheNang(model: string, anh, env): boolean` — `env.AI_KHE_NANG_HOAN_DOI !== "false"` và model ∈ `modelKheNangPhu`.
- `laModelServerDangGiu(M)`: như cũ **hoặc** `laModelKheNang(M, layAnhSoModel(), process.env)`.
- `quaKheNang<T>(model: string, fn: () => Promise<T>, signal?): Promise<T>` và `quaKheNangLuong<T>(model, moLuong, signal?)` ở `kheNangMacDinh.ts`: `modelKheNangPhu` rỗng ⇒ gọi thẳng `fn` (đi tắt); ngược lại `KheNang.cho(model, mucUuTienHienTai(), signal)` rồi `fn`, nhả ở `finally`.
- `batTuDoiKheNang(): void` — gọi ở `index.ts`; worker không gọi.
- `dinhTuyenVaiTro.thuProfile`: khe `nang` dùng được khi server đang giữ **hoặc** `AI_KHE_NANG_HOAN_DOI !== "false"`; khi phải đổi, bằng chứng ghi `can-doi-khe`.
- Mở rộng `soModelTongQuan`: thêm `kheNang: thongKe()`.

- [ ] Test: tập rỗng ⇒ `laModelServerDangGiu` y như cũ (lưới `napTrung` xanh nguyên); hồ sơ `nang` bật cho Y ⇒ `laModelServerDangGiu(Y)` true (cấm nạp Y trong tiến trình); `AI_KHE_NANG_HOAN_DOI=false` ⇒ false; hồ sơ trỏ chính model nhà ⇒ không vào tập phụ; router: khe nặng khác model đang giữ + hoán đổi bật ⇒ `gan-profile`, bằng chứng `can-doi-khe`; tắt ⇒ dự phòng như 7.0.
- [ ] Chạy lưới `server/services/ai`, `server/services/aiGgufEngine*`, `server/services/aiLlamaServerClient*`, `server/routes/openaiGateway*`, census `server/_core` + `server/routers` + `server/services/vram`. Commit.

### Task 4: Đo sống + tài liệu

- [ ] Trên :3012: tạo artifact/hồ sơ `nang` cho `Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL` (giấy phép Apache-2.0) trong CSDL dev; gọi `/v1/chat/completions` với `model` = basename đó ⇒ khe đổi sang Coder (đo giây), trả lời; gọi `chat` ⇒ sau lưu trú khe về Qwen3.6; kiểm `/props` mỗi bước; log không có dòng nạp model nặng trong tiến trình. Xoá hồ sơ/artifact thử, kiểm khe về nhà.
- [ ] Ghi kết quả vào spec §6 (7.1), cập nhật §3.5 (quyết định: không nhận nuôi :8091 làm hộ preempt được — mâu thuẫn G1-D; thay bằng nhờ broker khi thiếu VRAM; chỉ tiến trình API tự đổi). Commit.
