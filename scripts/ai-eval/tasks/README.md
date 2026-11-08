# Bài đo Thợ Cả theo một dạng (lô C, kế hoạch cải tiến 2026-11-08)

Mỗi bài là một thư mục `tasks/<stack>/<id>/`:

| Tệp | Nội dung |
|---|---|
| `prompt.md` | Đề đưa cho model. Không chứa đột biến, không chứa bài kiểm ẩn. |
| `check.mjs` | Chấm. Thoát **0 = ĐẠT, 1 = TRƯỢT, 2 = thước hoặc môi trường hỏng** (vứt số, không tính là trượt). Dòng cuối stdout là một dòng JSON. |
| `bai.json` | `id`, `kieu`, `bo`, `canDb`, nguồn, và với bài repo thì commit gốc, tệp được sửa, blob nguồn ghim. |

## Ba kiểu bài

| `kieu` | Bộ | Model trả gì | Lệnh chấm | Kiểm thước (`--kiem-thuoc`) |
|---|---|---|---|---|
| `ma-don` | `tasks-hard` (12), `tasks-api2` (30) | một câu trả lời có khối mã | `check.mjs --tra-loi <tệp>` | `ok` phải đạt, `bad` phải trượt |
| `agent-f` | `agent-f` (6) | sửa dự án trong `sandbox-projects/agent-f/<id>` | `check.mjs --thu-muc <dir>` | `mau` phải đạt; `goc`, `gian-lan` phải trượt |
| `pilot-repo` | `pilot` (TC-02..05) | một tệp test trong repo | `check.mjs --thu-muc <cây repo>` | `mau` phải đạt; `goc`, `gian-lan` phải trượt |

Bài `ma-don` và `agent-f` là vỏ mỏng sinh bởi `dong-goi.mjs`. Đề và bài kiểm ẩn vẫn nằm ở bộ cũ (`codegen-chay-duoc/`), chấm bằng đúng `cham.mjs` của bộ cũ, nên `run.mjs` và `run-f.mjs` chạy như trước và không có hai bản bài kiểm. Sửa đề ở nguồn rồi chạy lại `dong-goi.mjs`.

Bài `pilot-repo` viết tay. Đột biến nằm trong `check.mjs`. Lời giải mẫu lấy theo blob git (`mauBlob`), không chép vào thư mục bài vì `scripts/**/*.test.ts` nằm trong `include` của vitest.

## Lệnh

```bash
node scripts/ai-eval/tasks/kiem-thuoc.mjs                # toàn bộ; --only <id,…|stack|bộ>
node scripts/ai-eval/tasks/dong-goi.mjs --kiem           # thiếu bài hoặc lệch nguồn thì thoát 1
node --test scripts/ai-eval/tasks/lib/pilotRepo.test.mjs scripts/ai-eval/tasks/run-eval.test.mjs

# Đo: chạy kiem-thuoc trước. Báo cáo vào docs/ai/eval/<ngày>[-nhãn].{json,md}, câu trả lời thô vào D:/DO-AI/eval/ (ngoài repo).
node scripts/ai-eval/tasks/run-eval.mjs --samples 3 --sha
node scripts/ai-eval/tasks/run-eval.mjs --samples 3 --bo tasks-hard --nhan thu
```

`run-eval` thoát 0 khi đo xong (kể cả có bài trượt), 2 khi vứt số và không ghi báo cáo (llama-server chết, thước hỏng), 3 khi chạm trần thời gian (báo cáo có `dungSom`). Báo cáo ghi commit, sha256 model, ctx, budget và cờ `AI_AGENT_*`, `AI_AGENTIC_*`, `AI_CODING_*` trong env của lượt đo.

Bài `ma-don` đo model thuần, nên cờ `AI_AGENT_*` không tác động lên chúng: A/B cờ phải nhìn số của `agent-f`. `agent-f` gọi `run-f.mjs`, cần máy chủ ở `AI_EVAL_BASE` và cookie như README của nó. Bài `pilot-repo` chưa có đường đo trong `run-eval` (cần bộ chạy pilot và lượt `_test`), báo cáo ghi ở `chuaDo`.

## Bẫy

- **Đề lộ cho agent.** Agent chạy trong repo đọc được `scripts/ai-eval/tasks/` nếu cây có thư mục này. Bài `pilot-repo` phải chạy trên `repo.commit` của bài, các commit đó có trước khi `tasks/` tồn tại. Cùng lý do, `agent-f/an` và `agent-f/mau` đã có sẵn rủi ro này từ trước.
- **Một check một cây.** `pilot-repo` áp đột biến tại chỗ rồi khôi phục và so băm. Không chạy hai check song song trên cùng cây, không sửa cây trong lúc chạy.
- **Không chạm CSDL.** `pilot-repo` đặt `DATABASE_URL` trỏ cổng chết. Bài cần `_test` phải khai `canDb: true` và chạy trong lượt do dieu-phoi cấp; hiện chưa có bài nào như vậy. Bài `pgsql`, `tsql`, `pg: true` dùng cụm riêng dựng xong vứt, không phải CSDL của repo.
- **Đổi nguồn sau khi giao.** `--thu-muc` đòi đúng blob trong `nguonGhim`, sai thì thoát 2. `--kiem-thuoc` tự đặt nguồn về blob đó rồi khôi phục, nên main đi tiếp (TC-11 sửa `withParams`) thước vẫn đo được.
