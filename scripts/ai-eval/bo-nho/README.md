# Đo bộ nhớ llama-server :8091 (Đợt 9)

Công cụ đo commit/Private của `llama-server` theo cấu hình, dựng sau sự cố 2026-10-23 22:20 (llama-server 27B giữ ~40 GB
commit ⇒ Windows hết bộ nhớ ảo). Kết quả và quyết định: spec `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §6
("ĐO BỘ NHỚ llama-server", "QUYẾT ĐỊNH … P1 `--cache-ram 0`").

| tệp | việc |
|---|---|
| `do-bo-nho-llama.sh` | điều phối một đợt: khoá khe → mỗi cấu hình dựng :8091, lấy mẫu, chạy tải, tóm tắt → về 35B → nhả khoá |
| `lay-mau-bo-nho.ps1` | lấy mẫu mỗi `-Giay` giây ⇒ CSV `gio,pid,privateGB,wsGB,osCommitTrongGB,soPromptSave`; dừng khi có tệp cờ `-Dung` |
| `tai-dai.mjs` | tải: N lượt prompt khác nhau ~12k token. Tải A (mặc định) nghĩ tắt, ra 200; Tải B (`DAI_RA=1`) nghĩ bật, ra ~6k |

Canh nền suốt đợt GPU dài: `scripts/ai-eval/lib/canh-bo-nho.sh <log>` (drop_caches docker-desktop mỗi 30 phút + dòng `mau` Private
llama-server mỗi 30 s).

```bash
# chạy từ gốc worktree; cấu hình = <nhãn>:<đường doi|sp>:<model 27b|35b>[:<ThemArgs của doi-model>]
bash scripts/ai-eval/bo-nho/do-bo-nho-llama.sh 27b-moi:doi:27b 35b-sp:sp:35b              # kiểm mặc định mới (Tải A)
bash scripts/ai-eval/bo-nho/do-bo-nho-llama.sh "27b-c4096:doi:27b:@('--cache-ram','4096')"  # so với cache bật
TAI=b bash scripts/ai-eval/bo-nho/do-bo-nho-llama.sh 27b-dai:doi:27b                      # Tải B
```

- Đường `doi` = `scripts/ai-eval/codegen-chay-duoc/doi-model.ps1` (công cụ đo; log `tmp/audit-ai/ls-<model>-<dấu giờ>.err.log` của cây chính,
  đọc từ dòng `LOG:` nó in ra). Đường `sp` = `scripts/ai/start-llama-server.ps1 -Force` với `.env` cây chính (CHỈ ĐỌC) — đúng đường
  Task Scheduler / watchdog / API đổi model dùng; log ở `logs/llama-server-<dấu giờ>.err.log` của worktree.
- Kết quả: `tmp/bn-<nhãn>.csv`, `tmp/bn-tai-<nhãn>.log`, dòng `===` ở stdout.
- Đợt đo gốc 2026-10-23 (hai bản tmp đã gộp vào đây): Tải A trên `27b` mặc định / `--cache-ram 0` / `--no-mmap` / `35b`; Tải B trên `27b`
  mặc định / `--cache-ram 0` / `35b`. Lúc đó mặc định doi-model là `--cache-ram 4096`; từ 2026-10-24 là 0 (`-CacheRam`).
- Luật: chỉ chạy khi không có phép đo GPU nào khác (khoá khe chặn); không sửa `.env` cây chính.
