# Phụ lục B — Engineering Workspace (`/engineering`, IDE lập trình thiết bị)

> Thuộc doc 80. Ngày 2026-09-25 · nhánh `feat/ai-local-L7-hang-rao` @ `84f12c7d5` · pha PLAN (không sửa mã).
> Nguồn số thô (ngoài repo): scratchpad phiên `B-workspace/` — `db-raw.txt`, `db2-raw.txt`, `live-raw.json`.
> Phạm vi: `EngineeringWorkspace.tsx` (1929 dòng), `components/engineering/*`, `EngineeringContext.tsx`, `engineeringDeepLink.ts`; server `programmingRouter.ts` (1001), `programmingService.ts` (830), `programmingAdapter.ts` + 6 adapter, `engineeringStream.ts`, `fleetRollout.ts`; DB `drizzle/schema/programming.ts`, mig 0130/0156/0236/0239/0279.

**Điểm:** chức năng 4.0 · UX/bố cục 4.0 · chuyên nghiệp vs đối thủ 2.5 · backend/an toàn 5.5 · DB 4.5 · hiệu năng 6.5.

**Kết luận một câu:** 7 card xếp dọc quanh một ô CodeMirror 360 px; server có nhiều lớp cổng an toàn nhưng với `.env` hiện tại (mọi cờ DPC BẬT) luồng bị cắt ở Build, không đường deploy thật nào thành công được, và rollback ghi sổ sai sự thật.

## 0. Hệ đo

| Nguồn | Cách lấy |
|---|---|
| Mã | Đọc trọn trang, 3 component, router, service, registry, stream, schema; đọc chọn lọc adapter, fleetRollout, dispatcher robot/OT |
| DB | Chỉ SELECT, `default_transaction_read_only=on`, vai `avi_app` |
| tRPC | node fetch, engineer1, CHỈ query. validate/build/simulate/deploy KHÔNG gọi vì chúng GHI DB (`programmingService.ts:167-173, 237-249, 278-289`) |
| Bundle | `dist/public/assets` build 2026-09-25 15:29, gzip |

## 1. Số đo

Cờ: `DPC_DEPLOY_ENABLED`=true · `DPC_VERSION_REVIEW_ENABLED`=true · `DPC_DEPLOY_APPROVAL_ENABLED`=true · `ACTUATION_STEPUP_2FA`=true · `DPC_STREAMING_ENABLED`=true · `DPC_ONLINE_FORCE_ENABLED`=false.

DB live: `projects` 4 (3 SEED + 1 DEMO) · `artifacts` 7 (lớn nhất 336 ký tự; 3 approved, **4 pending_review**) · `builds` 3 · `sim_runs` 3 · `deployments` 3 (đều staging/simulated) · `symbols` 0. Audit: copilotGenerate 19 · deployBuild 3 · copilotComplete 3. **0 FK**; RLS bật nhưng không FORCE, `corporateCode` NULL 4/4 ⇒ vô tác dụng. Seed `contentHash="seedhash-…"` (không phải sha256). `listApprovers` 12 người, ≥8 là tài khoản test. engineer1 `twoFactorEnabled=false`.

| Procedure | ms | Byte |
|---|---:|---:|
| status | 55 | 1 932 |
| listProjects ×10 | 12–18 | 1 404 |
| machine.list | 33 | 39 180 |
| listArtifacts | 13–37 | 801–1 086 |
| listDeployments / listSymbols / fleetVersionMatrix | 11–42 | 31–424 |

| Chunk | raw | gzip |
|---|---:|---:|
| EngineeringWorkspace | 85,8 KB | 17,8 KB |
| CodeEditor (kéo cả mode JS/CSS/XML/YAML/Python/Shell) | 471 KB | 154 KB |
| vendor-three (import tĩnh, chứa luôn React) | 1,46 MB | 420 KB |
| index | 866 KB | 235 KB |

## 2. Frontend theo vùng

Bố cục thật: header → banner → lưới 280px | 1fr: stepper sticky → card Phiên bản (chip, diff, editor 360px, nút, chẩn đoán) → card Copilot (chỉ 1 nút) → Builds & Sim → Deploy → Fleet → Bảng biến/Monitor. Dock Copilot fixed 420px bên phải, đẩy `body.paddingRight` (`ProgrammingCopilotDock.tsx:56-60,112`).

| Vùng | Hiện trạng |
|---|---|
| Cây dự án | Danh sách phẳng, lọc client (`:219-232, 829-844`); không cây POU/tag/build; dự án `ir-flow` không lọc được (UI chỉ 7 kind) |
| Editor | CodeMirror 6, tô cú pháp tự viết (`CodeEditor.tsx:78-164`); không fold, không autocomplete theo symbol; trang KHÔNG truyền prop `diagnostics` (`EngineeringWorkspace.tsx:1026-1034`); cao cố định 360px; không tab |
| Lưu / dirty | Badge "Chưa lưu" + AlertDialog; không `beforeunload`; Ctrl+S tạo phiên bản mới dù không đổi (`:613-621`); Ctrl+Enter bị nuốt khi focus trong editor |
| Visual | Ladder = form 2 ô text, không vẽ; `parse` bỏ comment/dòng lạ rồi ghi đè buffer (`LadderEditor.tsx:18-31,39`); Teach/Jog chỉ tính pose cục bộ, tên point có thể trùng |
| Kiểm tra / Build | Chẩn đoán dạng text, không click tới dòng (`:1064-1077`); chẩn đoán build bị vứt (`:365-372`) |
| Mô phỏng | Scenario luôn `{}` (`:1125`); timeline chỉ hiện số bước; toast xanh "Đã mô phỏng" cả khi FAIL (`:373-379`) |
| Deploy | Không hiện deploy build/phiên bản/máy nào; bảng 10 dòng 5 cột, không lỗi/giờ/máy/người ký |
| Version / diff / rollback | Chip không có message/tác giả/giờ; `LineDiff` LCS đầy đủ không trần |
| Monitor | Badge nguồn trung thực nhưng nguồn luôn `[]`; không force, không trend |
| Fleet | Checkbox MỌI máy, không lọc theo kind; vẫn cho chọn production dù server chặn (`fleetRollout.ts:208-212`) |
| i18n / a11y | Thiếu `engineering.fleetPhase` ×3 locale; chuỗi cứng; `aria-current` gán mọi bước đã xong; nút "+" không tên truy cập |

**CRUD:** Project C/R ✔, U chỉ gắn thiết bị, D ✘ UI (server `deleteProject` nguy hiểm), nhân bản/import/export ✘ · Artifact append-only ✔, không message/nhánh · Build/Sim không tải output · Deployment 10 dòng thiếu cột · Symbol CRUD ✔, không CSV, `forceable` không có UI.

## 3. So với đối thủ (TIA Portal / CODESYS / TwinCAT / GX Works3 / TMflow / ZDevelop / VS Code)

| Hạng mục | /engineering | Kết luận |
|---|---|---|
| Cây dự án, nhiều POU/tệp, tab | ✘ | Thua mọi đối thủ |
| LD/FBD/SFC đồ hoạ | LD dạng form, phá dữ liệu | Thua |
| Lỗi click-tới-dòng, IntelliSense, cross-ref | ✘ | Thua |
| Mô phỏng thực thi | Chỉ LD chạy 1 scan thật; ST/Zmotion/stub là giả lập cấu trúc | Thua |
| Online/offline compare, watch, force, breakpoint | ✘ / watch rỗng | Thua |
| VCS | append + diff + rollback | Ngang/kém |
| 4 mắt / SoD / audit / canary fleet | ✔ | **Vượt trội / độc đáo** |

⇒ Hướng đúng: IDE mỏng + quản trị thay đổi mạnh, uỷ thác biên dịch/tải xuống cho toolchain hãng (tinh thần "hybrid" doc 09).

## 4. Phát hiện

**P0**
- **WS-01 — Build bị chặn vì review phiên bản không có UI.** Cờ bật; `buildArtifact` ném lỗi khi chưa duyệt (`service:224-229`); `reviewArtifact` có ở router (`:396-399`) nhưng client gọi 0 lần. DB: 4/7 phiên bản `pending_review`. Lỗi trả về 500.
- **WS-02 — Adapter nhận BuildResult đã mất `meta`** (`service:407-415`; `program_builds` không có cột meta): Zmotion thiếu `filePath` ⇒ luôn failed; Mitsubishi recipe rỗng ⇒ failed; Robot mất `stepList`; IEC `openplcDeployGuard` luôn failed (`iec61131Adapter.ts:55-67`) dù khai `canDownload:true`; Robot/OT staging `actionId=rid("act")` ⇒ dispatcher trả `NOT_CONFIRMED`. Header báo "Deploy: ON" nhưng không deploy thật nào thành công — người dùng chỉ biết sau khi nhập OTP.
- **WS-03 — Rollback nói dối.** UI không gửi `confirmedBy` ⇒ luôn simulated, nhưng server `UPDATE target → rolled_back` vô điều kiện, không transaction (`service:826-828`). Sổ WORM ghi "đã khôi phục" trong khi máy vẫn chạy bản lỗi.

**P1**
- **WS-04 — Khoá idempotency cố định** (`dep-{build}-{stage}`…, `:1240,1257,1914`): bấm lại sau khi bị từ chối nhận lại đúng dòng cũ; toast báo thành công bất kể status.
- **WS-05 — `buildId` không reset** khi đổi/lưu phiên bản ⇒ Deploy/Fleet đẩy build của phiên bản khác phiên bản đang hiển thị.
- **WS-06 — Tranh chấp trên đường actuation:** `deployBuild` SELECT → gọi adapter → mới INSERT; `approveDeployment` UPDATE không điều kiện ⇒ hai lượt bấm song song có thể ghi thiết bị 2 lần.
- **WS-07 — Online Monitor là mặt tiền:** nguồn luôn `[]` (`engineeringStream.ts:124-138`); `sessionId=proj-{id}` dùng chung mọi người; không `stopWatch` khi đổi project/rời trang (vòng 200 ms sống trên server); không endpoint force dù khai `canForce`.
- **WS-08 — Simulation Gate hình thức:** với ST `ok = build.ok`; Zmotion 250 ms/move; gate chỉ đòi `latestSim.ok`.
- **WS-09 — Chẩn đoán không dùng được như IDE** (không panel Problems, không inline).
- **WS-10 — Bố cục không phải IDE** (7 card dọc, editor 360px, card Copilot trùng dock).
- **WS-11 — CRUD dự án thiếu; server `deleteProject` nguy hiểm** (`router:271-290`: không write-floor, không step-up, không transaction; xoá builds mà deployments vẫn trỏ tới — 0 FK).
- **WS-12 — Fleet card hứa điều server cấm** (cho chọn production; không lọc máy theo kind).
- **WS-13 — RBAC lệch nhiều tầng:** nav/RouteGuard `machine_control` nhưng server `machine_monitoring`; thiếu write-floor ở create/update/deleteProject, deleteSymbol; `validateArtifact`/`simulateBuild` (ghi DB) chỉ cần canView; `deleteSymbol` không kiểm symbol thuộc dự án.

**P2** — WS-14 Ladder phá dữ liệu · WS-15 Teach/Jog cục bộ · WS-16 hiệu năng khi lớn (listArtifacts trả content mọi phiên bản; `copilotComplete` là mutation ⇒ mỗi gợi ý inline ghi 1 dòng audit; `listDeployApprovals` N+1) · WS-17 Ctrl+S tạo phiên bản trùng, không nháp · WS-18 lỗi nghiệp vụ trả 500 (`throw new Error`) · WS-19 0 FK, artifact "bất biến" không cưỡng chế ở DB, deploy không ghi `control_audit_log` · WS-20 seed bịa hash/chữ ký · WS-21 approver lẫn tài khoản test.

**P3** — WS-22 a11y/i18n vụn · WS-23 bảng deploy thiếu cột · WS-24 CodeEditor kéo mọi mode; `vendor-three` chứa React · WS-25 stepper không gắn phiên bản hiện tại · WS-26 engineer1 không bật 2FA.

## 5. Thiết kế cải tiến

Bố cục mục tiêu (IDE chuẩn — editor ≥60 % màn hình; đầu ra vào panel dưới có tab; Copilot là một view cột phải):

```
┌ ◧Project▾ ⎇main▾ v7● │ ✓Kiểm tra ⚒Build ⏵Mô phỏng ⇪Deploy… │ 🎯PLC-06·OpenPLC "KHÔNG tải được: chưa cấu hình" │ Review ⏳ ┐
├──┬──────────────┬────────────────────────────────────────┬───────────────────┤
│📁│ EXPLORER     │ [main.st●][Tags][Δ v6↔v7]              │ INSPECTOR         │
│🔍│ ▾Chương trình│  3  x := TRUE;  ~~ 'x' chưa khai báo    │ v7 · Minh · 10:42 │
│⎇ │ ▾Tags(12)    │                                        │ "Sửa interlock"   │
│⏵ │ ▾Phiên bản   │                                        │ Review⏳[Yêu cầu]  │
│📡│ ▾Deploy      │                                        │ Build#12✓ Sim⚠    │
│✨│              │                                        │ Trên máy: v5 a3f9 │
├──┴──────────────┴────────────────────────────────────────┴───────────────────┤
│ [Vấn đề 1][Output][Build][Mô phỏng][Watch][Lịch sử deploy]  ✕ main.st:3:5 … │
├──────────────────────────────────────────────────────────────────────────────┤
│ Ln3 Col5 · ST · Online ○ · Build 12s trước · Copilot ● · Deploy thật: ON    │
└──────────────────────────────────────────────────────────────────────────────┘
```

| # | Thiết kế | Công | Đóng |
|---|---|---|---|
| F1 | **Review phiên bản trong IDE**: lưu kèm message → "Yêu cầu duyệt" → người ≠ tác giả xem diff với bản đang chạy trên máy → duyệt/từ chối (bắt buộc lý do). API `requestVersionReview`, `reviewArtifact(+reason)`, `listVersionReviews`; lỗi `PRECONDITION_FAILED`. DB `reviewReason/reviewRequestedTo/reviewRequestedAt`. UI đọc `status.versionReviewEnabled`. Nghiệm thu: e2e engineer+supervisor; tự duyệt bị chặn; cờ OFF ⇒ 0 phần tử review trong DOM | S–M | WS-01 |
| F2 | **Lưu build meta + `deployPreview`**: `program_builds.metaJson`, `checksum`; `computeDeploy` truyền meta; query thuần `deployPreview({buildId,stage,deviceId})` ⇒ `{verdict: real|simulated|blocked, gates[], target, onDevice}`; `capabilities` phản ánh cấu hình thật. Nghiệm thu: preview khớp kết quả thật ở 5 tổ hợp cờ | M | WS-02 |
| F3 | **Idempotency + khoá tranh chấp**: khoá = nonce mỗi lần mở wizard; `INSERT … status='pending' ON CONFLICT DO NOTHING RETURNING` ⇒ chỉ lượt thắng gọi adapter; duyệt `UPDATE … WHERE status='awaiting_approval' RETURNING`; toast theo `row.status`. Nghiệm thu: 20 lượt song song ⇒ adapter gọi đúng 1 lần | M | WS-04, 06 |
| F4 | **Deploy wizard 4 bước**: Đích (lọc theo kind) → Khác gì (bản trên máy + diff) → Cổng (review/build/sim-fidelity/2FA/endpoint, mỗi cổng ✓✗ có lý do) → Xác nhận (lý do, OTP, kết quả dự kiến). Fleet dùng cùng wizard | M | WS-12, 23 |
| F5 | **Rollback trung thực**: rollback = một deploy tới bản tốt trước, cùng cổng; có transaction; chỉ đánh `rolled_back` khi bản mới ∈ {deployed, verified} | S | WS-03 |
| F6 | **Panel Problems + chẩn đoán inline + `validateSource` (query thuần, debounce 600 ms)**; reset `buildId/sim/diag` khi đổi phiên bản. Nghiệm thu: lỗi gạch ≤1 s, 0 UPDATE | S | WS-05, 09 |
| F7 | **Dự án nhiều POU/tệp + tab**: bảng `program_artifact_files(artifactId,path,language,content,hash)`; artifact = "commit" (message, parent); adapter nhận `files[]`; di trú 1 tệp `main.<ext>` | L | WS-10 |
| F8 | **Nháp tự lưu + commit có message**: `program_drafts`, autosave 2 s, `beforeunload`; từ chối commit trùng hash; Ctrl+S nháp / Ctrl+Shift+S commit / Ctrl+Enter build (keymap CodeMirror) | S–M | WS-17 |
| F9 | **Watch thật + force có cổng**: nguồn qua `adapterFacade`; phiên theo user+tab, heartbeat 10 s, TTL 30 s; `forceSymbol` = `deployProcedure` + cờ + `forceable` + interlock + `control_audit_log` + tự nhả; badge "ĐANG FORCE" | M/L | WS-07 |
| F10 | **Mô phỏng có kịch bản**: `fidelity: execution | structural`; production phải chấp nhận rõ khi chỉ có structural; bảng input kịch bản, Gantt timeline | M | WS-08 |
| F11 | **Ladder**: S = parse giữ nguyên dòng lạ/comment + test round-trip; L = chuyển LD sang POU Studio, bỏ editor LD thứ hai | S / L | WS-14 |
| F12 | **RBAC + vòng đời dự án**: một bảng gate dùng chung client/server; `writeProcedure` mọi thao tác ghi; xoá ⇒ archive (hard-delete admin + step-up + TX); đổi tên / nhân bản / xuất zip / nhập | S–M | WS-11, 13 |
| F13 | **DB**: FK `NOT VALID` → `VALIDATE`; trigger chặn sửa `content/hash/version`; REVOKE DELETE artifacts/builds; retention 20 sim/build; deploy/rollback/force vào `control_audit_log`; seed lại (báo trước) | M | WS-19–21 |
| F14 | **Hiệu năng**: danh sách phiên bản không kèm content; diff Myers trong Worker, trần 2 000 dòng; tách state editor khỏi trang; `copilotComplete` không ghi audit; lazy mode CodeMirror; `manualChunks` tách React khỏi `vendor-three` | S–M | WS-16, 24 |

## 6. Điểm mạnh cần GIỮ
Cổng deploy tập trung trong `computeDeploy`; nhánh `simulated` luôn nói đúng lý do (`service:445-457`); verify-after-download không bịa `verified`; chặn tái dùng khoá idempotency cho yêu cầu khác (`router:126-162`); OTP step-up bắt buộc ở tầng zod; retry khi hai lượt lưu đụng nhau; dirty guard, dự án DEMO một chạm, cảnh báo 2FA trước deploy, badge nguồn watch trung thực, deep-link `?projectId`.

## 7. Chưa kiểm được
Đo re-render bằng profiler; các luồng GHI (lưu/validate/build/sim/deploy — đều ghi DB nên không gọi); hộp OTP step-up; socket `engineering:*`; phần cứng.
