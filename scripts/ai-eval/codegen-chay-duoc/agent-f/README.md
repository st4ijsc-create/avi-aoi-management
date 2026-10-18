# Bộ F — tính năng nhiều tệp cho chế độ agent

Thiết kế: `docs/superpowers/specs/2026-10-14-ai-local-dot1-loi-agent-design.md` §1 (cổng **≥ 60 % × 3 lượt**), §4, §6.
Câu hỏi đo: *đưa agent một yêu cầu tính năng thật (tiếng Việt, sửa ≥ 2 tệp + tạo ≥ 1 tệp), nó có làm xong để
**test ẩn** xanh mà không đụng tệp test không?* Không tin lời khai của agent: máy tự chạy test sau lượt chạy.

## Bài (`bai.json`, dự án ở `sandbox-projects/agent-f/<id>/`)

| id | ngôn ngữ / chạy test | yêu cầu | mẫu: sửa / tạo | test hiển thị + ẩn |
|---|---|---|---|---|
| `ts-gio-hang` | TS chạy thẳng Node 24 (type stripping) · `node --test` | mã giảm giá % + theo bậc | 3 / 1 | 5 + 9 |
| `js-cli-viec` | JS ESM · `node --test` | lệnh con `export --csv [--out] [--chua-xong]` | 2 / 2 | 4 + 8 |
| `py-kho-cache` | Python · `python -m pytest` | repo có cache TTL + dịch vụ dùng nó | 2 / 1 | 5 + 11 |
| `py-dang-ky` | Python · `python -m pytest` | kiểm hợp lệ + lỗi song ngữ vi/en | 2 / 1 | 3 + 11 |
| `cs-dat-phong` | C# net10 xUnit · `dotnet test` | đặt phòng lặp hằng tuần, tất cả-hoặc-không | 2 / 1 | 5 + 10 |
| `cs-nhat-ky` | C# net10 xUnit · `dotnet test` | mức FATAL + dòng nối tiếp + báo cáo theo nguồn/JSON | 3 / 1 | 7 + 8 |

Không cần `npm install`. Gói NuGet (xunit 2.9.2, Microsoft.NET.Test.Sdk 17.11.1, xunit.runner.visualstudio 2.8.2)
có sẵn trong `%USERPROFILE%\.nuget\packages`. Lệnh `dotnet test` của agent chạy `--no-restore`: lần đầu trên
worktree mới, bước kiểm "test hiển thị xanh trước" của harness tự restore.

## Tệp

- `an/<bai>/…` — test ẨN, chép vào đúng đường tương đối trong dự án lúc chấm, xoá sau khi chấm.
- `mau/<bai>/…` — lời giải mẫu (các tệp sau khi làm, chép đè lên dự án).
- `cham.mjs` — chấm một bài. **ĐẠT ⇔** test hiển thị + ẩn mã thoát 0, `fail = 0`, `pass ≥ hiển thị + ẩn`
  (bằng chứng test ẩn THỰC SỰ chạy) **và** sha256 của `tepBaoVe` (test hiển thị, conftest, csproj test) bằng bản
  chuẩn **và** không có tệp cấu hình test MỚI (conftest/pytest.ini/pyproject, Directory.Build.*, …).
  CLI: `node cham.mjs --bai <id> [--thu-muc <dir>] [--chuan git|<thư-mục-nguồn>] [--chi-hien-thi]`.
- `khachAgent.mjs` — client SSE của `POST /api/ai/agent/runs` (§4; API chưa có khi viết).
- `run-f.mjs` — harness.

## Chạy

```bash
# KIỂM THƯỚC — không gọi server; bắt buộc trước mọi lượt đo (exit 1 nếu hỏng)
node scripts/ai-eval/codegen-chay-duoc/agent-f/run-f.mjs --config mau      --label F-kiem-mau-1       # phải 6/6
node scripts/ai-eval/codegen-chay-duoc/agent-f/run-f.mjs --config goc      --label F-kiem-goc-1       # phải 0/6 (và test hiển thị xanh)
node scripts/ai-eval/codegen-chay-duoc/agent-f/run-f.mjs --config gian-lan --label F-kiem-gianlan-1   # phải 0/6

# ĐO — cổng sức khoẻ :8091/health (AI_EVAL_LLAMA) + server (AI_EVAL_BASE) trước/sau mỗi lượt; hỏng ⇒ exit 2, vứt số
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/codegen-chay-duoc/agent-f/run-f.mjs --config agent --luot 3 --label F-<nhãn>-1
```

Tham số: `--config mau|goc|gian-lan|agent` · `--luot N` · `--only <id,…|ts|js|py|cs|node|pytest|dotnet>` · `--label` ·
`--noi tai-cho|tam` · `--cookie` (mặc định `tmp/audit-ai/ck.txt`) · `--project-id` (mặc định `repo`) ·
`--tien-to` (đường dự án viết vào câu hỏi; mặc định `sandbox-projects/agent-f/<id>` khớp `repo`) · `--tran-phut` (25).
Báo cáo: `scripts/ai-eval/codegen-chay-duoc/reports/<label>.json` + bảng tóm tắt (đạt/lượt, lý do trượt; agent:
ms trung vị, số tool, token ra, lý do dừng). Mỗi hàng agent có `tepDaDoi` (git status trước khi đặt lại).

## Đặt lại và nơi chấm

- `tai-cho` (mặc định khi các dự án đã commit): chấm trong `sandbox-projects/agent-f/<id>` của **worktree chứa
  script** (ROOT suy từ vị trí tệp); đặt lại TRƯỚC và SAU mỗi lượt bằng `git checkout -- <dir>` +
  `git clean -fd -- <dir>`, chỉ thư mục bài; còn bẩn sau đặt lại ⇒ exit 2. Chuẩn băm = git HEAD.
- `tam`: chép dự án vào `tmp/agent-f-work/<id>` (ngoài git), chuẩn băm = thư mục nguồn. **Dùng khi dự án CHƯA
  commit** (lúc viết bộ đo). `--config agent` từ chối chạy ở `tam` (exit 2) vì agent ghi vào `sandbox-projects/`.

## Bẫy đã gặp khi dựng (đừng lặp)

- `.gitignore` có `sandbox-projects/**/bin/` ⇒ thư mục `bin/` của một dự án Node bị nuốt lặng ⇒ điểm vào CLI
  để ở `viec.mjs` gốc dự án. Thêm bài mới: chạy `git check-ignore` trên mọi tệp bài.
- xUnit `Assert.Throws<T>` là khớp ĐÚNG kiểu; test hiển thị dùng `ThrowsAny<InvalidOperationException>` để lời
  giải đúng (ngoại lệ con) không bị phạt oan.
- `node --test <thư-mục>` KHÔNG chạy thư mục (coi là tệp) ⇒ chấm bằng danh sách tệp tường minh.
- Danh sách tệp tường minh cho pytest cũng vô hiệu `collect_ignore` ⇒ conftest mới chỉ nguy hiểm qua hook,
  nên bị chặn bằng luật "tệp cấu hình test mới".
