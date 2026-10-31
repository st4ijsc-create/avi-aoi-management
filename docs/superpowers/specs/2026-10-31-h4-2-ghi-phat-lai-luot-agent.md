# H4.2 — Ghi một lượt agent thật, phát lại mãi không GPU (thiết kế, chờ dieu-phoi duyệt)

Ngày: 2026-10-31 · Người lập: do-model · Nguồn: Đợt 12 `docs/superpowers/specs/2026-10-31-harness-tho-ca-hoc-tu-deepseek.md` H4.2 (C-P3).
Trạng thái: THIẾT KẾ ĐÃ DUYỆT HƯỚNG (dieu-phoi 2026-10-31) — chưa viết mã. Ghi ở tối B 01/11 21:00–00:00; phát lại không cần GPU.

## 1. Mục tiêu và giới hạn (nói trước)

- **Được:** kiểm HARNESS chạy thật — lõi `chayVongAgent`, `goiModelMayChu` (cắt suy luận, che bí mật, gom tool call), bộ thực thi máy chủ
  (hộp cát, deny-list, checkpoint, thẻ duyệt), sổ `ai_agent_runs`, sự kiện SSE — với ĐẦU RA MODEL THẬT đã ghi, không cần :8091.
- **Không được:** đo CHẤT LƯỢNG model. Mọi thay đổi làm đổi yêu cầu gửi model (nén ngữ cảnh H1.1, lời nhắc H1.6/7, preserve_thinking…)
  làm phát lại LỆCH ở lượt đầu tiên bị đổi — đó là tín hiệu "đã đổi byte gửi model ⇒ phải A/B trong cửa sổ GPU", không phải lỗi.
  Phát lại không thay A/B; nó thay "chạy lại agent-f để xem harness còn chạy không".

## 2. Điểm ghi — một chỗ, có sẵn

`taoGoiModelMayChu({ chatStream })` đã nhận `HamChatStream` tiêm (lưới dùng). Bộ ghi = một `HamChatStream` bọc hàm thật:

- mỗi lượt model ghi `{ yeuCau: chuanHoa(options), manh: GgufStreamChunk[] }` theo đúng thứ tự (kể cả `reasoning`, `tool_call_delta`,
  `done` với `cacheN`/`promptN` của H0.1);
- bật CHỈ bằng biến môi trường của tiến trình đo trong cửa sổ GPU (`AI_GHI_LUOT_DIR=<thư mục>`), mặc định TẮT; :3000 sản xuất không bật.
  Census: chỉ `goiModelMayChu.ts` đọc biến này.

`chuanHoa(options)` để fixture không vỡ khi đổi prompt (theo DeepSeek): system ⇒ `<<SYSTEM:sha256[0..12]>>`, schema tool ⇒
`<<TOOLS:sha256[0..12]>>` + danh sách TÊN tool; tin còn lại giữ nguyên (đã qua bộ che bí mật của lõi). Băm đầy đủ vẫn lưu để chế độ chặt so.

## 3. Định dạng fixture (JSONL, một tệp / lượt chạy)

```
{"loai":"dau","phienBan":1,"ngay":"…","dist":"<commit>","node":"v26.x","model":"Qwen3.6-35B-A3B-UD-Q4_K_XL","dongLenh8091":"<sha256 dòng lệnh>","bai":"agent-f/f3","cheDo":"sua","duAn":{"ten":"…","goc":"<git bundle tương đối>","commit":"<sha>"}}
{"loai":"luot","n":1,"yeuCau":{…chuẩn hoá…},"manh":[…]}
…
{"loai":"cuoi","suKien":[…sự kiện đã chuẩn hoá…],"cay":{"<đường>":"<sha256 nội dung>"},"lyDo":"hoan-thanh"}
```

Chuẩn hoá sự kiện để so: bỏ thời gian / `ms` / `ttft`, đổi mọi UUID (runId, checkpointId, id thẻ) thành `<ID#k>` theo thứ tự xuất hiện,
giữ nguyên loại, tên tool, `ok`, mã lỗi, đường tệp.

## 4. Phát lại

- `chatStream` giả rút lượt n trong fixture; kiểm `chuanHoa(options thực)` khớp lượt n:
  - **chặt** (mặc định trong lưới): băm system + tools + tin khớp ⇒ phát mảnh đã ghi; lệch ⇒ ĐỎ kèm "lệch ở lượt n: <trường>, <diff ngắn>";
  - **lỏng** (công cụ chẩn đoán): chỉ so số tin / vai / tên tool — để xem harness còn đi đúng luồng khi prompt đổi.
- Dự án: `git bundle` của dự án hộp cát (chỉ dự án mẫu agent-f / G6 trong `sandbox-projects/`, KHÔNG dữ liệu khách) giải vào thư mục tạm, đúng commit.
- Bộ thực thi THẬT trên thư mục tạm; duyệt thẻ tự động theo kịch bản đã ghi (`da-duyet`/`bi-bac` nằm trong sự kiện).
- Kết: `assertConsumed` (mọi lượt đã rút, không có lời gọi model thừa) + so sự kiện chuẩn hoá + so cây tệp (băm từng tệp).
- Chạy trong vitest (`*.replay.test.ts`), không GPU, không mạng; mỗi fixture vài giây.

## 5. Ghi ở cửa sổ GPU kế tiếp (đề xuất, ~25 phút trong cửa sổ)

- dist có H0.1 (cacheN/promptN) + L3; ghi agent-f 6 bài × 1 + G6 A1/A2 × 1 (bản BẬT preserve_thinking — mặc định hiện hành).
- Ghép cùng cửa sổ với A/B `AI_AGENT_NEN_MOC` (tho-ca-agent H1.1) và `-b 4096 -ub 1024`, nhưng GHI trên cấu hình mặc định, tách khỏi các phép A/B.

## 6. Câu hỏi cho dieu-phoi

1. Fixture vào repo hay ngoài repo? Ước lượng 8 lượt × ~30–200 KB (chủ yếu suy luận) + bundle dự án mẫu nhỏ. Đề xuất: vào repo dưới
   `scripts/ai-eval/phat-lai/fixtures/`, nén gzip, `.gitattributes binary`; suy luận GIỮ (cần cho đường cắt/preserve_thinking).
2. Bộ ghi đặt trong `goiModelMayChu.ts` (một chỗ, sau cờ env) — đồng ý? Phương án khác là bọc ở `aiLlamaServerClient` (bắt cả /v1) nhưng
   rộng hơn mức cần.
3. Ai sở hữu lưới phát lại sau khi có fixture: do-model (ghi + bộ phát) hay kiem-dinh (H4.1 máy chủ giả tiêm lỗi cùng tầng)? Đề xuất:
   do-model viết bộ phát + 8 fixture; kiem-dinh dùng chung bộ phát cho kịch bản lỗi H4.1.

## 7. Quyết định của dieu-phoi (2026-10-31)

1. Fixture VÀO REPO: gzip, mỗi tệp ≤ 2 MB, tổng ≤ 10 MB, dưới `scripts/ai-eval/phat-lai/fixtures/` (hoặc `server/testing/fixtures`).
   TRƯỚC khi commit: chạy bộ che bí mật + quét đường dẫn tuyệt đối của máy (`D:\…`, tên người dùng Windows, thư mục tạm) ⇒ thay bằng token
   (`<<GOC_DU_AN>>`, `<<NGUOI_DUNG>>`); lưới census kiểm mọi fixture không còn mẫu đường tuyệt đối / khoá.
2. Bộ ghi ở `goiModelMayChu.ts` (đường agent — đúng chỗ harness gọi model), KHÔNG ở `aiLlamaServerClient`.
3. Sở hữu: do-model viết bộ phát + 8 fixture; kiem-dinh dùng chung hạ tầng phát cho H4.1 (máy chủ giả tiêm lỗi).
