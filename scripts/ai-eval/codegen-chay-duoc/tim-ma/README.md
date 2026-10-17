# Bộ "tìm mã" — cổng Đợt 2 (ngữ cảnh mã)

Thiết kế: `docs/superpowers/specs/2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md` §1.
Cổng: **trả đúng tệp:dòng ≥ 80 %** khi bật tool mới, và **số lượt tool trung vị GIẢM** so với khi tắt
`find_symbol`, `search_code`, `search_docs` (ablation).

## Tệp

- `chuanBi.mjs` — nguồn 15 câu (9 repo chính, 6 `sandbox-projects/agent-f/*`) + regex dòng định nghĩa ⇒ sinh `cau.json`
  từ mã THẬT (định nghĩa phải duy nhất trong cây; `tepGoi` = tệp nhắc tên, chỉ số phụ). `--kiem` = chỉ kiểm khớp mã.
- `cau.json` — đáp án SINH RA; đừng sửa tay số dòng. Mã đổi ⇒ `run-tim-ma` dừng (exit 2) ⇒ chạy lại `chuanBi.mjs`.
- `cham.mjs` — chấm: ĐÚNG ⇔ nêu đường tệp đúng (chuẩn hoá `\`/`/`, không phân biệt hoa thường, ranh giới hai đầu;
  câu agent-f nhận cả đường tương đối trong dự án) **và**, nếu câu đòi dòng, một số dòng gắn với đường đó nằm trong ±5.
  Chỉ chấm câu trả lời CUỐI (chữ sau sự kiện tool cuối + `xong.tomTat`); lời dẫn trước khi gọi tool không tính.
- `khachHoi.mjs` — client SSE `POST /api/ai/agent/runs` chế độ `hoi`, `projectId` `repo`.
- `run-tim-ma.mjs` — harness.

## Chạy

```bash
# 1. KIỂM THƯỚC — không gọi server; bắt buộc trước mọi lượt đo (đúng 100 %, sai tệp/chỉ tên tệp/dính chữ 0 %)
node scripts/ai-eval/codegen-chay-duoc/tim-ma/chuanBi.mjs --kiem
node scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs --config kiem

# 2. NHÁNH BẬT — server khởi động KHÔNG có AI_AGENT_AN_CONG_CU
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs --config agent --nhanh bat --luot 3 --label TM-bat-1

# 3. NHÁNH TẮT — khởi động lại server với  AI_AGENT_AN_CONG_CU=find_symbol,search_code,search_docs
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs --config agent --nhanh tat --luot 3 --label TM-tat-1

# 4. SO SÁNH + phán quyết cổng
node scripts/ai-eval/codegen-chay-duoc/tim-ma/run-tim-ma.mjs --so-sanh TM-bat-1,TM-tat-1
```

Tham số: `--only <id,…|R|A>` (R = repo chính, A = agent-f) · `--luot N` · `--label` · `--cookie` (mặc định
`tmp/audit-ai/ck.txt`) · `--project-id` (mặc định `repo`) · `--tran-phut` (10). `AI_EVAL_LLAMA` (mặc định :8091) cho
cổng sức khoẻ. Báo cáo: `scripts/ai-eval/codegen-chay-duoc/reports/<label>.json` (mỗi hàng: đúng/tệp/dòng nêu, số tool,
tool theo tên + số thành công, ms, token, lý do dừng, câu trả lời cuối).

## Công tắc ablation (server)

`AI_AGENT_AN_CONG_CU` (danh sách tên tool, phẩy) — `server/services/ai/agent/boThucThiMayChu.ts` (`congCuBiAn`): bỏ
các tool đó khỏi bộ phơi cho model, và từ chối (`CONG_CU_BI_AN`) nếu model vẫn gọi. Đọc tại chỗ gọi, cần khởi động lại
server (env của tiến trình). Harness tự canh: nhánh `tat` mà tool mới chạy THÀNH CÔNG ⇒ exit 2 (vứt số); nhánh `bat`
mà model không gọi tool mới lần nào ⇒ cảnh báo.

## Bẫy / giới hạn đã biết

- Lời nhắc hệ thống (`shared/agentCore/loiNhac.ts` quy tắc 9–10) vẫn nêu tên tool Đợt 2 ở nhánh tắt ⇒ nhánh tắt đo
  "được nhắc mà không có" (model có thể phí lượt gọi tool bị ẩn; số `tool mới gọi` của nhánh tắt cho thấy mức này).
- Exit trên Windows: `process.exit` khi còn socket fetch ⇒ libuv assert, mã thoát 127 thay vì 2 ⇒ đường agent ném
  `Thoat` + `process.exitCode`. (`agent-f/run-f.mjs` vẫn dùng `process.exit(2)` sau fetch — mã thoát có thể sai tương tự.)
- Dòng nêu xa phía TRƯỚC đường tệp không được tính (có thể thuộc tệp nêu trước); bảng markdown có cột dòng chỉ được
  tính khi ô số đứng ngay sau ô đường.
- Định nghĩa dùng trong câu repo chính có thể bị agent song song sửa ⇒ `kiemDapAn` dừng đo thay vì chấm theo dòng cũ.
