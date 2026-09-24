# Xử lý việc còn mở — AI Local (2026-09-24)

Đầu vào: báo cáo `2026-09-23-bao-cao-tien-do-ai-local-toan-dot.md` §4–§6 và báo cáo training `2026-09-23-bao-cao-tien-do-ai-local-training.md` §4.
Nhánh `feat/ai-local-L7-hang-rao`, chưa push. Số liệu thô nằm ở `tmp/audit-ai/kb-pdca/` (không vào git) và ở các lượt eval `kb_eval_runs` #33–#40.

## 1. Kết luận

| Việc | Kết quả | Commit |
|---|---|---|
| Backlog 1 — 6 câu ST4I "không kho nào ra nguồn đúng" | **6 → 5**. Nguyên nhân T05 là phiếu `_PHIEU…` và nhật ký dev lọt vào kho; đã loại, ablation xác nhận. 5 câu còn lại **không sửa được bằng trọng số**: số đo bác bỏ. | `08b948639` |
| Nợ 2 — `knowledge/` ~30.000 dòng chưa commit | Tìm ra nguồn: **lịch autosync 03:00 hằng đêm**. Đã commit ảnh chụp dựng lại có lai lịch. **Sẽ bẩn lại mỗi đêm** — cần chủ dự án chọn (§6). | `73b56fd1c` |
| Backlog 2 — bộ vàng ≥ 100 câu rồi chọn reranker | Bộ vàng **42 → 111 câu**. **Giữ nguyên** ngưỡng 0,44 và reranker bge. Không cổng điểm nào tách được câu lạc đề cùng miền. | `3b27b0329` |
| Nợ 3 — test `server/services/ai*` đỏ khi chạy gộp | **11 đỏ / 20 bộ → 4.618/4.618**, hai lượt liền. Báo cáo cũ ghi "chạy riêng thì xanh" là **sai**: 8 tệp đỏ cả khi chạy riêng. Tìm ra 1 lỗi sản phẩm thật. | `63f048bf6` `4027217bd` `fdf3da1e8` |

## 2. Bước 0 — kiểm hệ đo

- **Hạ tầng đang tắt:** lúc bắt đầu, :3000 và llama-server :8091 đều tắt (máy vừa khởi động lại). Tôi đã khởi động cả hai và báo phiên song song trước.
- **Mã truy hồi trên server khớp HEAD:** từ bản dựng `c95515a5d` đến HEAD, phía server chỉ khác một khối chú thích.
- **Cách đổi kho khi đo:** kho đổi bằng `/api/ai/local-kb/reload`. Server nạp lại từ đĩa, không có cache ở giữa (health báo số đoạn 9.357 rồi 6.310).
- **Đối chứng dựng lại kho:** bản sao kho trước khi sửa (chunks + embeddings) giữ ngoài cây. Khi dựng lại kho từ mã gốc (#35), kết quả **giống hệt** nền (#33). Vậy thay đổi đo được đến từ bản vá, không đến từ việc dựng lại.
- **Bộ ca bị hỏng sẵn:** bộ ca "thẻ đã duyệt" báo "BỘ CA KHÔNG HỢP LỆ, không đo được gì". Nguyên nhân: distractor `knowledge/operational/layout.md` đã bị xoá khi gộp Layout vào TwinHub. Đã thay bằng `twin.md` rồi mới đo.

## 3. Backlog 1 — truy hồi phía kho hệ thống (PDCA)

**Pareto 6 câu (lượt eval #33):**
- **T05:** thua `operational-approved/_PHIEU_DIEN_7_O_TRONG.md` (phiếu hỏi chủ dự án, điểm 0,513 và 0,499) cùng 2 đoạn kế hoạch/báo cáo dev.
- **T06 · T12 · T17 · T18 · T19:** thua thẻ tính năng hoặc thẻ vận hành **cùng chủ đề** (alerts, oee-targets, defect-catalog…). Các thẻ này không chứa đáp án; đã kiểm bằng `scripts/ai-eval/nhan-vang-hep.mjs`.

**Đã vá:**
- `isNoiseDoc` loại `docs/superpowers/**`: 3.044 đoạn, bằng 33 % kho.
- Chunker bỏ mọi tệp `_*.md`.
- Kết quả: kho 9.357 → 6.310 đoạn, không phải nhúng lại.

| Phép đo | Trước | Sau |
|---|---|---|
| ST4I "kho nào cũng ra nguồn đúng" (eval thật) | 24/30 (#33) | **25/30** (#39) |
| Tài liệu Studio tới được trợ lý | 40 % | 43 % |
| 151 câu vàng hệ thống / `eval-rag --ci` | 151/151 · PASS | 151/151 · PASS |
| Thẻ đã duyệt, 20 ca (parity) hit@5 · MRR | 0,80 · 0,608 | **0,85 · 0,635** |
| Vận hành 54 · playbook 8 · kiến trúc 10 | — | không đổi |

**Ablation (dựng lại kho theo từng biến, dùng cùng bộ vector):**

| Biến | T05 | Bộ thẻ đã duyệt |
|---|---|---|
| Gỡ cả hai loại trừ (#35) | trượt (= #33) | — |
| Chỉ loại `_*` (#36) | đạt | 0,85 |
| Chỉ loại `docs/superpowers` (#37) | đạt | 0,80 |

⇒ Mỗi loại trừ một mình đã đủ sửa T05. Phần tăng của bộ thẻ đã duyệt đến từ việc loại `_*`.

**5 câu còn lại — thử trọng số `domain` rồi bác bỏ.** Quét một biến một dòng (nhóm E trong `eval-rag-operational.mjs --sweep`):

| Trọng số `domain` | 1,08 (đang chạy) | 1,18 | 1,25 | 1,35 |
|---|---|---|---|---|
| ST4I 30 câu, hit@5 | 0,70 | 0,83 | 0,90 | 1,00 |
| Thẻ đã duyệt 20 ca | 0,85 | 0,75 | 0,70 | 0,70 |
| Playbook 8 ca | 1,00 | 1,00 | 0,875 | 0,75 |
| Kiến trúc 10 ca | 0,90 | 0,90 | 0,70 | 0,70 |

⇒ Nâng `domain` được ở ST4I nhưng mất ở ba bộ giữ lại. **Không đổi.** Muốn tách "câu hỏi về máy" khỏi "câu hỏi về màn hình phần mềm" cần một tín hiệu theo câu hỏi, không phải một trọng số toàn cục (vòng sau).

## 4. Backlog 2 — bộ vàng 111 câu; ngưỡng và reranker

- **Bộ vàng mới:** thêm 69 câu **viết trước khi đo**, dùng làm tập giữ lại cho ngưỡng đã chọn trên 42 câu cũ.
  - 49 câu trong corpus: regex của mỗi câu đã kiểm là khớp tệp nhãn.
  - 20 câu ngoài corpus cùng miền, gồm vài câu khó chạm từ khoá có trong tài liệu (camera, LED ring, MES, máy nén khí, IPC).
- **Lượt eval thật #40:** trúng nguồn trong top‑5 95 %; qua ngưỡng 84 %; từ chối đúng 19/32.
- **Công cụ so cổng:** `scripts/ai-eval/rerank-tach-quet.mjs`. Tổng lỗi = nguồn đúng bị loại + câu ngoài corpus lọt qua, tính trên 75 câu trong và 32 câu ngoài.

| Cổng | Tổng lỗi tốt nhất | Top‑1 đúng nguồn |
|---|---|---|
| Cosine (tốt nhất @0,359) | 23 (mất 1 + lọt 22) | 58/79 |
| **Cosine @0,44 (sản xuất)** | **23** (mất 10 + lọt 13) | 58/79 |
| bge‑v2‑m3, điểm thô | 21 | 49/79 |
| Qwen3‑Reranker‑0.6B, điểm thô | 22 | 52/79 |

⇒ Chênh ±2 trên 107 câu là nhiễu, nên **giữ 0,44**: ngang mức tốt nhất mà để lọt ít hơn (13 so với 22).
⇒ Reranker thô còn làm top‑1 **tệ hơn** cosine, nên không đổi reranker và không nâng BLEND.

⚠ **Phát hiện về công cụ đo:** `rerank-tach.ts` thực ra trả điểm **trộn** (BLEND 0,20, tức 80 % là cosine), không phải điểm thô như tên gọi. Nay công cụ mặc định dùng điểm thô và in rõ đang dùng loại nào. Số "bge 21/29, Qwen 24/29" ở `6919087c6` nhiều khả năng đo bằng điểm trộn; không kiểm lại được.

## 5. Nợ 3 — lưới test `server/services/ai*`

**Tám tệp đỏ cả khi chạy riêng:**

| Tệp | Gốc rễ | Sửa |
|---|---|---|
| ntfClassifier · ntfPredictor · measurementCorrections · aiThresholdAdvisorCorrections | `afterAll` xoá `product_inspections`, bảng WORM ⇒ 42501 | bỏ lệnh xoá (theo khuôn `apiKeyTenantScope.test.ts`) |
| aiThresholdAdvisorCorrections | `.env` đặt `MACHINE_SHARED_KEY_ALLOWED=false` ⇒ bước seed bị từ chối, 0 ca chạy | cho phép riêng trong test này (theo khuôn `inspection.corporate.test.ts`) |
| aiCodingKhoiSua.stream (§8, 2 ca) | `eol=lf` từ 2026-09-14 biến dự án C# mẫu thành LF ⇒ **mất trục CRLF cả ở live** | `.gitattributes`: `sandbox-projects/csharp-demo/** text eol=crlf`; 59/59 và 423/423 ở 9 tệp liên quan |
| aiAgentCenterService (2 ca router) | ca router nạp cả lớp `server/db` (đọc bảng và `sql` lúc nạp) | mock "bản thật + ghi đè" |
| rcaActionSuggester | chuỗi nạp thật gọi `registerTool` lúc nạp, mock thiếu export này | thêm `registerTool` không làm gì |
| featureStore | ★ **lỗi sản phẩm:** `invalidate()` luôn trả 0, vì đọc `rowCount` (node‑postgres) trong khi driver là postgres‑js dùng `count`; thêm vào đó, id cố định "123" đụng một hàng cache thật | đọc `count`; test dùng id riêng mỗi lượt |

**Đỏ theo tải (chỉ khi chạy gộp):**
- **aiGateway.b7 · aiProviderGatewayRouting · aiSafetyGateway:** hai bộ đếm xả 5 s bị mồ côi sau `vi.resetModules` và ghi vào giữa ca kế. Đã gỡ cả hai bộ đếm sau mỗi ca, và b7 chỉ đếm lượt ghi vào `ai_gateway_metrics`.
- **aiLlmFinetuneSidecar · aiLlmAudit:** `vi.waitFor` mặc định chờ 1 s, ngắn hơn thời gian chạy khi máy tải cao. Đã nâng lên 10 s.
- **`testTimeout` 30 s trong `vitest.config`:** lượt gộp đầu có 2 ca báo "timed out 5000ms", nên tôi thêm dòng này. Ablation một lượt (bỏ dòng này) vẫn cho 4.618/4.618 ⇒ **không chứng minh được là cần**. Tôi vẫn giữ vì nó rẻ; ghi thẳng ở đây.

**Kết quả:** gộp 11 đỏ / 20 bộ → **4.618/4.618** ở hai lượt liên tiếp. `tsc` (heap 8 GB) exit 0.

## 6. Cần chủ dự án quyết

1. **`knowledge/*` bị autosync ghi đè mỗi đêm.** `KB_AUTOSYNC_ENABLED=true` chạy `kb:sync` lúc 03:00 và ghi lên tệp đang được git theo dõi, nên sáng nào cây làm việc cũng bẩn và không ai biết kho ứng với commit nào. Hai cách:
   - **(a)** giữ theo dõi, commit ảnh chụp định kỳ (như `73b56fd1c`);
   - **(b)** đưa các tệp sinh ra (`chunks.jsonl`, `*-catalog.json`, `semantic-graph.json`…) vào `.gitignore` và để máy tự sinh.

   Đề nghị **(b)**, vì `embeddings.jsonl` đã được bỏ qua theo cách này. Nhưng cần kiểm quy trình triển khai offline có dựa vào `knowledge/` trong git hay không.
2. **Ngoại lệ `.gitattributes` cho `sandbox-projects/csharp-demo`** (CRLF). Quy tắc `eol=lf` từng được chủ dự án duyệt, nên đây là ngoại lệ hẹp cần anh/chị biết.

## 7. Chưa làm, có lý do

| Việc | Lý do |
|---|---|
| Backlog 3 — bày lại nút "Nghĩ sâu" | Điều kiện chưa xảy ra: chưa có bài nào mà chế độ cân bằng hỏng vì cạn ngân sách nghĩ |
| Backlog 4 — A2 làm cổng | Là quy tắc đo, không phải lỗi: tỉ lệ thật ≈ 12/27 = 44 %; khi dùng làm cổng phải chạy ≥ 12 lượt |
| Backlog 5 — E01/E02 | Đã chấp nhận từ trước |
| Nợ: nhiễu H ±3 · `python t.py` · GitHub chậm | Lần lượt là quy tắc đo, việc của chủ máy, và không cần lúc này |

## 8. Còn mở — vòng sau

- **5 câu ST4I thua thẻ phần mềm cùng chủ đề:** cần tín hiệu theo câu hỏi (máy hay màn hình) hoặc đa dạng hoá nguồn trong top‑5. Trọng số toàn cục đã bị bác bỏ (§3).
- **Câu lạc đề cùng miền lọt 13/32 ở 0,44:** không cổng điểm nào tách được. Cần tín hiệu khác điểm số, ví dụ tự kiểm câu trả lời có dựa vào đoạn trích hay không.
- **`testTimeout` 30 s:** chưa có ablation dương tính; nếu nhiều lượt gộp sau này đều xanh khi bỏ dòng này thì có thể gỡ.
