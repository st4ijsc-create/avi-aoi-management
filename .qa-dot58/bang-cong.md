| script | chạy? | kết quả / lý do |
|---|---|---|
| `dev` | không | server dev — chiếm cổng |
| `dev:worker` | không | tiến trình nền |
| `dev:edge` | không | tiến trình nền |
| `build` | không | GHI dist/ — dist/ là của phiên khác (3001/3008) |
| `build:secure` | không | GHI dist/ |
| `start` | không | chạy dist/ của phiên khác |
| `start:worker` | không | nt |
| `start:edge` | không | nt |
| `check` | **CÓ** | exit 0 · 0 lỗi |
| `check:tests` | **CÓ** | exit 1 · 27 lỗi NỀN (0 twin3d, 0 e2e) |
| `format` | không | prettier --write . — GHI ĐÈ TOÀN CÂY |
| `lint:tokens` | **CÓ** | tổng 1 111 · Δ=0 (report-only) |
| `test` | **CÓ** | CHẠY THEO PHẠM VI: twin3d 106/2498 + phamVi 17/437 |
| `test:db:setup` | không | GHI DB test |
| `vision:validate` | không | cần model thị giác |
| `i18n:audit` | không | báo cáo trùng i18n:check (đã chạy bản check) |
| `i18n:check` | **CÓ** | 0/0/0 ĐẠT |
| `test:e2e` | **CÓ** | CHẠY THEO SPEC: dot47 16/16 · dot31 4+A5 đỏ+2 không chạy · B1/B2 2/2 |
| `test:e2e:install` | không | tải trình duyệt |
| `db:push` | không | MIGRATION — tuyệt đối không |
| `db:generate` | không | sinh tệp drizzle vào cây |
| `monitor:ai-analytics` | không | cần dịch vụ đang chạy |
| `monitor:ai-analytics:summary` | không | nt |
| `kb:extract` | không | GHI knowledge/ (tracked) |
| `kb:operational-cards` | không | GHI knowledge/ |
| `kb:operational-cards:test` | không | ★ G138 — GHI ĐÈ 169 tệp tracked dưới knowledge/ ⇒ KHÔNG CHẠY |
| `kb:chunk` | không | GHI knowledge/ |
| `kb:embed` | không | GHI + cần GPU |
| `kb:embed:inc` | không | nt |
| `kb:sync` | không | GHI knowledge/ |
| `kb:graph` | không | GHI knowledge/ |
| `kb:phase1` | không | GHI knowledge/ |
| `kb:test` | không | cần API AI đang chạy |
| `kb:eval` | không | cần model |
| `ai:eval:toolcall` | không | cần model |
| `ai:eval:rag` | không | cần model |
| `ai:eval:rag:rerank` | không | cần model |
| `kb:stale-check` | không | đọc — bỏ vì không thuộc phạm vi twin (khai rõ) |
| `eval:specialist` | không | cần model |
| `hooks:install` | không | GHI .git/hooks |
| `ai:backfill` | không | GHI DB |
| `sim:factory` | không | GHI DB |
| `sim:production` | không | GHI DB |
| `sim:scenario` | không | GHI DB |
| `sim:esop` | không | GHI DB |
| `sim:live` | không | GHI DB liên tục |
| `bench:ingest` | không | GHI DB |
| `lake:verify` | không | cần lake |
| `storybook` | không | máy chủ UI |
| `build-storybook` | không | GHI build |
| `ai:bench` | không | cần model |
| `ai:cli` | không | tương tác |
| `ai:mcp` | không | tiến trình nền |
| `ext:check` | không | tsc cho vscode-extension — ngoài phạm vi twin (khai rõ) |
| `ext:build` | không | GHI build |
| `ext:package` | không | GHI .vsix |
| `ext:test-that` | không | bộ test extension — ngoài phạm vi |
