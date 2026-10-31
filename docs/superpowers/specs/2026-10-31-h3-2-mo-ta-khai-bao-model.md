# H3.2 — Một mô tả khai báo cho mỗi model (thiết kế, chờ dieu-phoi duyệt)

Ngày: 2026-10-31 · Người lập: do-model · Nguồn: Đợt 12 `docs/superpowers/specs/2026-10-31-harness-tho-ca-hoc-tu-deepseek.md` H3.2 (C-P4).
Trạng thái: THIẾT KẾ — chưa viết mã. Không cần cửa sổ GPU (mục tiêu: byte gửi model y hệt hôm nay với Qwen3.6-35B-A3B).

## 1. Vấn đề — hành vi theo model rải ở 6 chỗ

| Hành vi | Hôm nay ở đâu | Gắn cứng cho |
|---|---|---|
| Tắt nghĩ / giữ nghĩ | `aiLlamaServerClient.lapCoTatSuyLuan` — `chat_template_kwargs.enable_thinking` / `preserve_thinking` | template Qwen3.x |
| Ngân sách nghĩ theo yêu cầu | `lapNganSachNghi` — tên trường `thinking_budget_tokens` (b9814 đọc; `reasoning_budget_tokens` bị bỏ IM LẶNG) | build llama.cpp |
| Sampling theo chế độ | `ai/hoSoSampling.ts` (`hien-tai` / `chinh-hang`), B2 | Qwen3.6 |
| Trần token một lượt agent | `goiModelMayChu.docMaxTokens` (env `AI_AGENT_MAX_TOKENS_MOT_LUOT`, mặc định 16 000) | — |
| Ngân sách ngữ cảnh của lõi | `GIOI_HAN_MAC_DINH.nganSachNguCanhToken = 65 536` (khớp `-c 65536` của :8091 bằng TAY) | dòng lệnh :8091 |
| Gọi tool | native `tools` + bộ VỚT `<tool_call>` khi build không phân giải | Qwen3 / b9814 |

Đổi model (ba khoá `.env`) không đổi được các mục trên ⇒ model mới chạy với cờ của Qwen3.6 — hoặc phải sửa mã. Ngân sách 64k của lõi lệch
âm thầm nếu `-c` của :8091 đổi.

## 2. Đề xuất — `shared/ai/moTaModel.ts` (dữ liệu, không logic)

```ts
export interface MoTaModel {
  id: string;                         // "qwen3.6-35b-a3b"
  khop: RegExp;                       // khớp basename GGUF (không đuôi), vd /^Qwen3\.6-35B-A3B/i
  nguCanh: { macDinh: number; toiDa: number };          // 65 536 / 262 144 — lõi lấy macDinh, kiểm khớp /props n_ctx lúc chạy
  nghi:
    | { kieu: "khong" }
    | { kieu: "kwargs"; tat: Record<string, unknown>; giu?: Record<string, unknown>; truongNganSach?: "thinking_budget_tokens" };
  sampling: Record<"nghi-coding" | "instruct", { topK?: number; minP?: number; presencePenalty?: number; repeatPenalty?: number; temperature?: number; topP?: number }>;
  traLoiToiDa: number;                // trần token một lượt agent (16 000)
  goiTool: "native" | "native+vot-van-ban";
  anh?: { mmproj: true };
}
export const MO_TA_MODEL: readonly MoTaModel[];   // Qwen3.6-35B-A3B, Qwen3-4B (planner), Qwen3-VL-8B, mxbai (embed: nghi "khong")
export function moTaCho(basename: string | null | undefined): MoTaModel;  // không khớp ⇒ MO_TA_MAC_DINH (= hành vi hôm nay)
```

- Người dùng: `lapCoTatSuyLuan` / `lapNganSachNghi` đọc `moTaCho(model).nghi` (model không có kênh nghĩ ⇒ không gửi `chat_template_kwargs`);
  `hoSoSampling` đọc `sampling`; `goiModelMayChu` đọc `traLoiToiDa` (env vẫn thắng); `quanLyLuotChay` truyền
  `gioiHan.nganSachNguCanhToken = moTaCho(model).nguCanh.macDinh`.
- Kiểm chạy: lần đầu dùng model, đọc `/props` của :8091 (`n_ctx`) — lệch `nguCanh.macDinh` ⇒ cảnh báo một lần + dùng SỐ NHỎ HƠN (không bao
  giờ tin số lớn hơn thực tế).
- KHÔNG đưa vào mô tả: đường dẫn GGUF, khoá env, khe GPU (đã có ở sổ model `soModel/*` + `.env`) — mô tả chỉ là "model này nói thế nào".

## 3. Bất biến và lưới

1. **Byte-y-hệt với Qwen3.6**: lưới dựng thân yêu cầu llama-server cho 6 ca hiện có (tắt nghĩ, giữ nghĩ, ngân sách, sampling hai chế độ, tool)
   trước và sau đổi — so từng byte (ảnh chụp JSON). Không đổi byte ⇒ không cần A/B GPU.
2. Census: chuỗi `enable_thinking` / `preserve_thinking` / `thinking_budget_tokens` chỉ còn trong `moTaModel.ts` (+ danh sách trắng
   `chat_template_kwargs` của `/v1`, đó là đầu vào client).
3. Model không khớp mô tả nào ⇒ `MO_TA_MAC_DINH` = đúng giá trị hôm nay (không đổi hành vi cho model lạ).
4. Đột biến: đổi tên trường ngân sách, bỏ `giu`, đổi `macDinh` ngữ cảnh, model "khong" mà vẫn gửi kwargs ⇒ đỏ.

## 4. Thứ tự

H3.2a mô tả + bộ đọc + lưới byte (không đổi hành vi) → H3.2b nối `nganSachNguCanhToken` theo mô tả + kiểm `/props` (đổi hành vi khi `-c`
khác 64k — hôm nay không khác ⇒ không đổi) → H3.3 adapter ngoài (stream, tool gốc, `retry-after`, `request-id`) đọc mô tả nhà cung cấp cùng kiểu.

## 5. Câu hỏi cho dieu-phoi

1. Đặt ở `shared/ai/` (extension dùng được) hay `server/services/ai/`? Đề xuất `shared/ai/` — extension 0.5.x cũng dựng `chat_template_kwargs`.
2. Kiểm `/props` lúc chạy: chấp nhận thêm một GET tới :8091 lần đầu mỗi tiến trình (có sẵn hàm preflight)?
