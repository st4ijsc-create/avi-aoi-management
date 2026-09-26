# Kế hoạch thực thi — Doc 80 · Đợt 0 "Chặn rủi ro" + vá nóng Copilot (QĐ5)

> **Spec (nguồn sự thật):** `docs/ECOSYSTEM/80_ENGINEERING_CONTROL_AUDIT_VA_THIET_KE_CAI_TIEN_2026-09-25.md` và các phụ lục trong `docs/ECOSYSTEM/80_ENGINEERING_CONTROL_AUDIT/` (A AI · B IDE · C IR/POU · D Hub/ECN/Recipe/Interlock · E Orchestration/Fleet/Safety/Standards/Integration · F Nền tảng). Mỗi task trỏ về mã phát hiện (`ORC-01`, `ILK-04`…) — **đọc đoạn phụ lục tương ứng trước khi làm**; phụ lục có `file:dòng` và cách đo.
> **Chủ dự án đã duyệt** toàn bộ khuyến nghị §9 (2026-09-26, "đồng ý, tiếp tục").

## Global Constraints (bắt buộc cho MỌI task)

1. **Nhánh dùng chung, nhiều phiên Claude khác cùng repo.** Không `git add -A`/`git add .`, không `stash`, `checkout --`, `reset`, `rebase`, `push`. Commit **chỉ các tệp mình sửa** bằng pathspec: `git add -- <tệp…>` rồi `git commit -m "<msg>" -- <tệp…>`. Trước khi commit chạy `git diff --cached --stat` để chắc chỉ có tệp của task.
2. **Không restart server :3000, không `npm run build`** (build giết server đang chạy), không sửa `.env`, không ghi DB dev (`aoi@5434/aoi_management`). Test chạy trên DB `_test` (vitest.setup tự ép `DATABASE_URL` sang clone `_test`).
3. **TDD bắt buộc:** viết test tái hiện lỗi TRƯỚC, chạy thấy ĐỎ đúng lý do, rồi mới vá, chạy XANH. Sau khi xanh, làm **phép đột biến**: tạm gỡ đúng dòng vá ⇒ test phải ĐỎ ⇒ hoàn nguyên. Ghi cả ba (RED/GREEN/MUTATION) vào báo cáo.
4. **Kiểm kiểu:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (heap mặc định OOM). Test: `npx vitest run <tệp test>`; trước khi commit chạy thêm các tệp test sẵn có của router/service mình chạm.
5. **Không migration mới trong Đợt 0** trừ khi task ghi rõ; dùng cột/bảng sẵn có (`control_audit_log.reason`, `recordAuditEvent`…).
6. **Giữ hành vi các đường không thuộc task byte-identical.** Không đổi hợp đồng API công khai ngoài những gì task nêu; client gọi tới procedure đã đổi phải được cập nhật cùng commit.
7. **Lỗi nghiệp vụ dùng `appError(...)`/`TRPCError` có mã (CONFLICT, FORBIDDEN, PRECONDITION_FAILED, BAD_REQUEST)**, không `throw new Error` (trả 500).
8. **i18n:** mọi chuỗi UI mới qua `t()` với khoá thêm vào cả `vi.json`, `en.json`, `zh.json`.
9. Thông điệp commit theo kiểu repo (không dấu), ví dụ `fix(orchestration): abort dung run dang chay …`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Orchestration — Abort thật, Resume CAS, ép quyền duyệt, run "held", duplicate/rollback qua cổng (ORC-01/02/03/04/05/06/11)

Phụ lục E §4 (ORC) + §6.1. Tệp chính: `server/services/orchestration/foe/foeEngine.ts`, `server/routers/orchestrationRouter.ts`, `server/routers/orchestrationGovRouter.ts`, `client/src/pages/OrchestrationStudio.tsx`.

Yêu cầu:
- **ORC-01 Abort thật.** Thêm registry tiến trình run đang sống (Map runId → `{ aborting: boolean, controller: AbortController }`). `abortRun` đặt cờ + `abort()` cho run đang sống trong tiến trình, và ghi DB `aborted`. Driver kiểm cờ giữa các bước (điểm `rc.aborting` sẵn có ở ~`:555` phải nhận giá trị thật); các chờ (`delay`, `wait_*`, poll) nhận `AbortSignal` và thoát sớm. **Trạng thái kết thúc không được ghi đè `aborted`**: lệnh ghi trạng thái cuối (`completed`/`failed`) chỉ áp khi trạng thái DB hiện tại ≠ `aborted` (UPDATE có điều kiện `WHERE status <> 'aborted'`). Test: run có bước `delay` dài → abort → không bước nào sau thời điểm abort được thực thi (mock dispatcher đếm lệnh = 0 sau abort) và trạng thái cuối = `aborted`.
- **ORC-02 Resume CAS.** `resumeRun` chuyển trạng thái bằng `UPDATE … SET status='running' WHERE id=$1 AND status IN ('awaiting_confirm','held') RETURNING *`; 0 hàng ⇒ `CONFLICT`. Test: hai lượt resume đồng thời ⇒ đúng một thành công, driver chạy đúng một lần.
- **ORC-03 Ép quyền duyệt cổng.** Khi duyệt một bước gate có `approverRoles`, người duyệt phải có vai thuộc danh sách (admin luôn được); nếu bước khai `fourEyes` (hoặc mặc định nếu schema chưa có: người duyệt ≠ người đã start run) ⇒ từ chối `FORBIDDEN`. Sửa câu UI sai "RBAC is enforced at the API" thành mô tả đúng (i18n).
- **ORC-04 Run bị gián đoạn do restart** không được hiển thị trong nhóm "Đang chờ duyệt" kèm nút Approve. Phân biệt: run `held` do restart (dấu hiệu trong context — đọc mã rehydrate để xác định) ⇒ hiển thị nhóm/nhãn "Bị gián đoạn" với hành động "Tiếp tục…" (có xác nhận) và "Huỷ". Không thêm giá trị enum DB mới trong Đợt 0.
- **ORC-05 Rollback workflow** chuyển sang `deployProcedure` (OTP tươi) và bắt buộc `reason` (min 3 ký tự); không tự điền override sim-gate. Client gọi rollback phải gửi `totpCode` + `reason` (tái dùng `StepUpOtpDialog`/`ConfirmWithReason` sẵn có).
- **ORC-06 Duplicate** tạo bản với `status` không chạy được ngay (dùng giá trị trạng thái nháp/không active sẵn có trong schema — đọc schema; nếu không có, `inactive`) và phải qua deploy gate mới chạy được; procedure dùng `writeProcedure` + `requirePermission("machine_control","canCreate")`.
- **ORC-11** `orchestrationGovRouter` mọi procedure thêm `requirePermission("machine_monitoring","canView")` (đọc) — theo mẫu các router khác — và module gate như `orchestrationRouter`.

Nghiệm thu: test mới cho ORC-01/02/03/06/11 xanh; đột biến gỡ CAS và gỡ kiểm `aborted` làm test đỏ; test sẵn có của orchestration/foe (kể cả `durableOrchestration.test.ts`) vẫn xanh; tsc 0 lỗi.

## Task 2: Interlock — MOC tối thiểu + cổng đọc mẫu mới nhất (ILK-01/02/03/04/05/10)

Phụ lục D §6 + §7.4 "Vá ngay". Tệp chính: `server/routers/interlockRouter.ts`, `server/services/interlock/interlockGate.ts` (+ `ruleEvaluator.ts` nếu cần), `client/src/pages/InterlockRuleManagement.tsx`.

Yêu cầu:
- **ILK-01** `update` một rule đang `approvedBy != null` hoặc `enabled = true` ⇒ trong CÙNG transaction: reset trạng thái duyệt (`approvedBy/approvedAt` = null) và tắt rule (`enabled=false`), ghi audit `update` với before/after và `reason` "sửa rule đã duyệt ⇒ cần duyệt lại". Nếu patch chỉ đổi trường không ảnh hưởng hành vi (vd `name`, `description`) thì vẫn reset — Đợt 0 chọn an toàn (ghi Ruling nếu thấy cần khác).
- **ILK-02** `approve`: từ chối `FORBIDDEN` nếu người duyệt là `createdBy` hoặc `updatedBy` của rule.
- **ILK-03** `disable`, `delete`, `resolveEvent` nhận `reason: z.string().min(3)` bắt buộc, ghi vào sổ audit (`recordAuditEvent` với `reason`) thay vì `console.info`; tắt/xoá rule mức rủi ro audit `high`. `resolveEvent` ghi audit và lưu ghi chú. UI: các thao tác này mở hộp nhập lý do (tái dùng `ConfirmWithReason`).
- **ILK-04** Truy vấn mẫu telemetry trong `interlockGate.ts` lấy **N mẫu MỚI NHẤT** trong cửa sổ (`ORDER BY ts DESC LIMIT n`) rồi đảo về thứ tự thời gian tăng nếu evaluator cần. Test: 120 mẫu trong cửa sổ, `windowSize` 50, giá trị mới nhất vượt ngưỡng ⇒ cổng CHẶN (trước vá: không chặn).
- **ILK-05** Hành động khác `alert` (vd `stop_line`, `reduce_speed`, `block_command`…) bắt buộc có ít nhất một đích (machine/adapter/tag theo schema) ở create/update ⇒ thiếu ⇒ `BAD_REQUEST`. `commandValue`: nếu schema có cột thì lưu thật; nếu không, bỏ khỏi form và sửa chú thích UI sai "được GHI NHẬN".
- **ILK-10** Mọi thay đổi cấu hình rule và dòng audit tương ứng chung một transaction.

Nghiệm thu: test mới cho từng điểm (tái hiện đỏ trước); đột biến ILK-04 (đổi lại ASC) ⇒ đỏ; `permissions.interlock.test.ts` và test interlock sẵn có xanh; tsc 0.

## Task 3: Recipe — một đường cổng duy nhất + đóng SSRF (FLOW-01/INT-02, INT-01)

Phụ lục E §4 INT + §6.5, phụ lục F FLOW-01. Tệp chính: `server/routers/equipmentIntegrationRouter.ts`, `server/services/**/recipeVersioningService.ts`, `server/db/machineRecipe.ts` (tham chiếu), `server/services/**/euromapAdapter.ts`, `client/src/pages/EquipmentIntegration.tsx`.

Yêu cầu:
- **FLOW-01/INT-02** Release/rollback recipe qua `equipmentIntegration` phải có cùng bảo đảm như `/recipes`: `actuationProcedure` + `requirePermission("machine_control","canEdit")`, và **từ chối release một phiên bản chưa duyệt** (`approvedBy` null ⇒ `PRECONDITION_FAILED`). Cách làm ưu tiên: gọi chung hàm cổng của `db/machineRecipe.ts` (hoặc trích một hàm dùng chung) thay vì giữ hai logic song song; nếu không gộp được trong Đợt 0, thêm kiểm tương đương + test và ghi lý do.
- **INT-01 SSRF:** `euromapOpcuaSnapshot` không được nhận `endpoint` tuỳ ý từ client. Đổi thành: endpoint lấy từ cấu hình đã lưu phía server (adapter/connector đã đăng ký) theo id; nếu API cần thử endpoint mới thì phải là **mutation** `adminProcedure`, endpoint phải khớp allowlist (host trong danh sách adapter đã đăng ký hoặc biến môi trường allowlist sẵn có — đọc mã), và **không** đẩy alarm lên Andon từ một lượt thử. Cập nhật client tương ứng.

Nghiệm thu: test "release phiên bản chưa duyệt qua equipmentIntegration ⇒ bị từ chối"; test "snapshot với endpoint lạ ⇒ bị từ chối, không mở kết nối, không Andon"; test sẵn có của machineRecipe/equipmentIntegration xanh; tsc 0.

## Task 4: Lập trình thiết bị — deploy/rollback trung thực, khoá tranh chấp, reset build (WS-03/04/05/06, FLOW-04)

Phụ lục B §4 + §5 F3/F5, phụ lục F FLOW-04. Tệp chính: `server/services/programming/programmingService.ts`, `server/routers/programmingRouter.ts`, `client/src/pages/EngineeringWorkspace.tsx`.

Yêu cầu:
- **WS-03 Rollback trung thực.** Chỉ đánh dấu deployment đích `rolled_back` khi lượt deploy lùi có trạng thái ∈ {`deployed`,`verified`} — hoặc khi CẢ bản đích lẫn lượt lùi đều `simulated` (ghi nhận nhất quán trong chế độ mô phỏng). Nếu lượt lùi `failed`/`rejected`/`awaiting_approval` ⇒ không đổi trạng thái đích, trả kết quả thật cho client. Hai lệnh update chạy trong một transaction. Từ chối rollback đích đang `rejected`/`awaiting_approval`.
- **WS-04 Idempotency.** Client sinh khoá idempotency mới (nonce) mỗi lần người dùng mở/xác nhận một lượt deploy / yêu cầu duyệt / rollback (theo mẫu fleet đã làm ở `:1455`), thay khoá cố định `dep-{build}-{stage}`. Toast hiển thị theo `status` thật trả về (simulated/deployed/failed/rejected/awaiting_approval), không luôn "thành công".
- **WS-05** Khi đổi phiên bản đang chọn hoặc lưu phiên bản mới: reset `buildId`, kết quả mô phỏng, chẩn đoán build.
- **WS-06 / FLOW-04 Khoá tranh chấp.** `deployBuild`: "giữ chỗ" trước khi gọi adapter — INSERT dòng deployment trạng thái trung gian với khoá idempotency (`ON CONFLICT DO NOTHING RETURNING`); chỉ lượt thắng gọi adapter rồi UPDATE kết quả; lượt thua trả dòng hiện có. Trùng khoá không còn trả 500. `approveDeployment`: `UPDATE … WHERE id=$1 AND status='awaiting_approval' RETURNING` trước khi thực thi; 0 hàng ⇒ `CONFLICT`. Nếu cần một giá trị trạng thái trung gian mà enum chưa có, dùng giá trị sẵn có phù hợp nhất hoặc cột phụ đã có — **không migration**; nếu bắt buộc migration ⇒ báo NEEDS_CONTEXT.

Nghiệm thu: test "rollback mà lượt lùi failed ⇒ đích không thành rolled_back"; test "20 lượt deployBuild song song cùng khoá ⇒ adapter gọi đúng 1 lần"; test "hai approve song song ⇒ 1 thành công + 1 CONFLICT"; test sẵn có `programmingRouter*.test.ts` + `deployStepUpFreshness` xanh; tsc 0.

## Task 5: IR — chặn chèn mã, đơn vị gia tốc, vòng lặp lồng, chiều nối cạnh, lint 3 trạng thái (IR-01/02/03/04/05)

Phụ lục C §3 + §7 Pha 0 (0.1, 0.3–0.6). Tệp chính: `server/services/programming/ir/**` (`irToUrscript.ts`, `irToRos2.ts`, `irSafetyLinter.ts`, schema IR), `client/src/components/**/irTree.ts`, `IrGraphCanvas.tsx`, `client/src/pages/IrEditor.tsx`.

Yêu cầu:
- **IR-01** Mọi trường chuỗi đi vào mã sinh ra (`signal`, `signal_ref`, `tool_id`, giá trị chuỗi của `if`, tên biến…) phải qua whitelist: định danh `^[A-Za-z_][A-Za-z0-9_]{0,63}$` (hoặc quy tắc chặt tương đương theo ngữ cảnh), chuỗi literal được escape đúng ngôn ngữ đích. Thêm rule lint `io-ref-invalid` (error). Emitter ném lỗi nếu nhận ký tự ngoài whitelist (phòng thủ lớp 2). Bộ fuzz ≥50 ca (dấu nháy, xuống dòng, `)`, `;`, `#`, `os.system`, unicode…) ⇒ 0 dòng lạ trong URScript và ROS2, và lint báo lỗi.
- **IR-03** Gia tốc: xác định đơn vị trong IR (đọc schema/tài liệu) và đổi đúng sang m/s² (URScript) / đơn vị ROS2; mặc định block mới hợp lý (≈0,5 m/s² tương đương); lint `accel-limit` báo lỗi khi vượt trần.
- **IR-04** Vòng lặp lồng dùng biến đếm riêng theo độ sâu/id (`i_<depth>` hoặc tương đương) ở URScript (và ROS2 nếu cùng lỗi). Test 2×3 ⇒ thân chạy 6 lần (kiểm bằng cấu trúc mã sinh ra).
- **IR-05** Nối cạnh A→C trên [A,B,C] cho thứ tự [A,C,B] (sửa `reorderRelativeToSibling`/chỗ gọi). Test đơn vị client.
- **IR-02** Badge/KPI lint có 3 trạng thái: OK · có lỗi · **không đọc được** (query lỗi/đang tải) — bỏ `lint?.ok ?? true`; khi không đọc được thì khoá Save/Build và hiển thị lý do (i18n).

Nghiệm thu: fuzz + test từng điểm xanh; đột biến gỡ whitelist ⇒ fuzz đỏ; test IR sẵn có xanh; tsc 0.

## Task 6: Fleet + Safety — allocate CAS, actor/audit, phạm vi ghi, nút thử không bật Andon (FLOW-05/FLT-06, FLT-02, FLT-03, SAF-01)

Phụ lục E §4 FLT/SAF + §6.2/6.3, phụ lục F FLOW-05. Tệp chính: `server/services/**/taskAllocator.ts`, `server/routers/fleetRouter.ts`, `server/services/**/nearMissAdvisor.ts`, `server/routers/safetyRouter.ts`, client liên quan nếu hợp đồng đổi.

Yêu cầu:
- **FLOW-05/FLT-06** `allocateTask` chuyển trạng thái bằng `UPDATE tasks SET … WHERE id=$1 AND status='pending' RETURNING` (0 hàng ⇒ CONFLICT/không gán). Test hai allocate đồng thời ⇒ gán đúng 1 lần.
- **FLT-02** 12 mutation fleet ghi `actor` (user id) và dòng audit bất biến (`recordAuditEvent` như interlock/standards).
- **FLT-03** Mutation fleet kiểm phạm vi nhà máy của thực thể được sửa (tái dùng hàm phạm vi đường đọc `idsTrongPhamVi`); ngoài phạm vi ⇒ FORBIDDEN.
- **SAF-01** Nút thử proximity: sự kiện ghi `detectedBy: 'test'` (hoặc trường provenance sẵn có), **không** gọi Andon; UI ghi rõ "chỉ thử — không phát cảnh báo".

Nghiệm thu: test cho từng điểm; test fleet/safety sẵn có xanh; tsc 0.

## Task 7: Socket — phân quyền vào phòng (PLT-01)

Phụ lục F §6 PLT-01. Tệp chính: `server/_core/socket.ts` (+ `socketMachineAuth.ts`). **Đọc kỹ** thiết kế `SOCKET_MACHINE_AUTH_MODE` (doc 56 GAP-1) và các trình giả lập/SDK máy trong repo (`examples/device-client/`, `scripts/*sim*`, grep `clientType`) để không làm vỡ máy/giả lập đang kết nối.

Yêu cầu:
- Socket có `clientType === "machine"` (chưa xác thực người dùng) **không được** join các phòng hướng người dùng: `engineering:*`, `telemetry:all`, `ai:agents`, `admin`, `global`, `robot:*`, `device:*`, `twin:*`, `site:*`, `sites:global`, `factory:*`, `workshop:*`, `line:*` qua các handler subscribe chung; chỉ giữ các phòng/luồng máy cần (vd `machine:${id}` trong luồng máy đã xác thực apiKey). Ghi log mỗi lần từ chối.
- `engineering:subscribe` chỉ cho socket trình duyệt có user với quyền `machine_monitoring`/`machine_status` canView (dùng cơ chế kiểm quyền server sẵn có).
- Hành vi cho socket trình duyệt hợp lệ giữ nguyên.

Nghiệm thu: test (socket.io client thật hoặc harness sẵn có trong repo): machine-client không cookie gửi `engineering:subscribe` ⇒ không nhận sự kiện `engineering:*`; browser user không quyền ⇒ bị từ chối; browser user có quyền ⇒ nhận được; luồng máy hợp lệ (confirm_mapping/heartbeat) không đổi. tsc 0.

## Task 8: Quyền nhất quán + ECN an toàn (RBAC-01, RBAC-02, ECN-03, ECN-05)

Phụ lục C XC-02, D §1/§4, F §2. Tệp chính: `client/src/lib/navigation.tsx`, `client/src/App.tsx`, `server/routers/ecnRouter.ts`, `server/services/**/ecnService.ts`, `client/src/pages/EngineeringChanges.tsx`, `client/src/pages/EngineeringHub.tsx`.

Yêu cầu:
- **RBAC-01** `/ir-editor`, `/pou-studio`, `/fleet-orchestration`: nav và RouteGuard cùng một quyền. Quyết định: trang có chế độ chỉ-xem ⇒ route dùng `RouteGuard navHref=…` và nav khai `machine_status` (đọc); các nút ghi vẫn gate `machine_control` trong trang/server như hiện tại. Thêm test tĩnh: với mọi item nhóm `engineering` trong nav, route tương ứng trong `App.tsx` dùng `navHref` hoặc cùng permission (test đọc mã nguồn hoặc import cấu hình).
- **RBAC-02** `ecn.create/list/getById/getItems` thêm `requirePermission` (`machine_control` canView cho đọc, canCreate cho create) — theo quy ước gate trang ECN (doc 54 Đ2).
- **ECN-03** `transition` nhận/so `expectedStatus` (client gửi trạng thái đang thấy) và UPDATE có điều kiện `WHERE id=$1 AND status=$expected`; 0 hàng ⇒ CONFLICT. Test hai lượt duyệt đồng thời ⇒ 1 thành công + 1 CONFLICT.
- **ECN-05** Người yêu cầu không được `review`/`approve` ECN của mình (đã có ở approve — mở rộng sang bước xem xét) và người đã xem xét không được đồng thời là người duyệt; duyệt/từ chối trên UI mở hộp xác nhận có ý kiến (bắt buộc với từ chối).

Nghiệm thu: test cho từng điểm; test nav/route tĩnh xanh; tsc 0.

## Task 9: Nền tảng vặt — font không tải được, chuỗi i18n hỏng (PLT-06, G-11)

Phụ lục F PLT-06, doc 80 §4 G-04/G-11. Tệp chính: `client/src/fonts.css` (+ cấu hình Vite nếu cần), `client/src/i18n/locales/{vi,en,zh}.json`.

Yêu cầu:
- **PLT-06** URL font trong `fonts.css` (`url("@fontsource-variable/geist/files/…woff2")`) đang không được bundler phân giải ⇒ build giữ nguyên chuỗi, trình duyệt xin `/assets/@fontsource-variable/...` và nhận `index.html`. Sửa để Vite phân giải và copy tệp woff2 vào `dist/public/assets` (vd dùng đường dẫn tương đối tới `node_modules`, `~`/alias hợp lệ, hoặc import gói `@fontsource-variable/geist` chuẩn). Không chạy `npm run build` toàn bộ (giết server) — kiểm bằng `npx vite build --outDir <thư mục tạm ngoài dist>` (hoặc build client-only vào thư mục tạm) rồi xác nhận tệp `.woff2` có trong output và CSS trỏ đúng; xoá thư mục tạm sau đó.
- **G-11** Khoá `fleetNeedBuild` (vi.json ~dòng 15551 "Chọn một build ở khối \\") và bản en/zh tương ứng: viết lại câu hoàn chỉnh.

- **Hồi quy của chính đợt này:** `appErrorParamsCoverage` (test sẵn có) đỏ vì các khoá `appError` mới thêm ở `interlockRouter` (Task 2) và `equipmentIntegrationRouter` (Task 3) chưa có mục phủ tham số. Bổ sung đúng các mục đó (KHÔNG đụng `twinCanhRouter` — của phiên khác). Chạy test để chứng minh các khoá của interlock/equipmentIntegration không còn trong danh sách thiếu.

Nghiệm thu: output build tạm có ≥4 tệp `geist*.woff2` và CSS tham chiếu đúng; JSON hợp lệ; `appErrorParamsCoverage` không còn liệt kê khoá của interlock/equipmentIntegration; tsc 0.

## Task 10: Copilot lập trình — vá nóng: cổng an toàn đa ngôn ngữ + ngân sách nghĩ + đầu ra sạch (AI-01, AI-03, AI-04/05, AI-09, AI-13, AI-17)

Phụ lục A §2, §7, §8 (D1 vá nóng, D3, D4 lớp 1+2). Tệp chính: `server/services/**/aiProgrammingCopilot.ts`, `server/routers/programmingRouter.ts` (cổng review/explain), `server/services/**/aiModelRouter.ts` **chỉ đọc** (không đổi route `code` dùng chung — phiên ai-coding sở hữu), `client/src/components/programming/ProgrammingCopilotPanel.tsx`.

**Thứ tự bắt buộc: cổng an toàn (D4) xong và có test TRƯỚC khi nới ngân sách nghĩ (D1).**

Yêu cầu:
- **D4 (AI-03/13/17)** Tạo `copilotSafetyGate` MỘT module, thay hai regex trùng (`aiProgrammingCopilot.ts:~77`, `programmingRouter.ts:~172`):
  - Lớp 1: từ điển **cụm** (động từ nguy hiểm × đối tượng an toàn) tiếng Việt (có và không dấu), Anh, Trung — vd "bỏ qua/vô hiệu hoá/nối tắt/tắt/bypass/disable/jumper/ignore/force/跳过/禁用/屏蔽" × "dừng khẩn cấp/e-stop/estop/interlock/liên động/khoá liên động/cửa bảo vệ/rèm quang/light curtain/guard/safety/急停/安全/联锁". Không khớp từ đơn (để "guard rail", "emergency light" KHÔNG bị chặn).
  - Lớp 2: soi `contextCode`: nếu mã có tín hiệu an toàn (`ESTOP*`, `E_STOP*`, `SAFE*`, `GUARD*`, `*INTERLOCK*`, `LIGHT_CURTAIN*`) và yêu cầu thuộc nhóm sửa/xoá/đổi điều kiện (mode complete/translate/fix hoặc động từ "gỡ/bỏ/xoá/sửa điều kiện dừng") ⇒ chặn (cho phép `explain`).
  - Chẩn đoán của nền tảng (`[safety-lint:…]`) không được làm cổng chặn yêu cầu "giải thích lỗi" (AI-13): đi kênh riêng hoặc loại khỏi chuỗi quét.
  - Cổng chạy **trước** mọi lời gọi model cho mọi mode (kể cả review/explain) — không tốn lượt model khi bị chặn.
  - Kết quả thống nhất `{ refused: true, refusalSource: "gate", reasonCode, userMessage }` (userMessage i18n-friendly tiếng Việt/Anh theo ngôn ngữ yêu cầu).
  - Bộ test ≥40 đối chứng (VI có dấu/không dấu, EN, ZH, trực tiếp/gián tiếp, qua contextCode) ⇒ chặn ≥98 %; ≥20 yêu cầu thường (gồm "guard rail", "emergency light", "đèn khẩn cấp", "dừng băng tải khi đầy") ⇒ không chặn.
- **D1 vá nóng (AI-01)** Trong đường copilot (không đổi route `code` dùng chung), đặt chính sách lượt: lượt sinh chính dùng ngân sách nghĩ có giới hạn (vd `thinkingBudgetTokens` ≈ 6000) và `maxTokens` đủ lớn (≥ ngân sách + 4000) — hoặc tắt nghĩ nếu engine không hỗ trợ ngân sách; lượt tự sửa, lượt JSON (IR/POU), và inline luôn **tắt nghĩ**. Đọc `aiLlamaServerClient.ts`/`aiGgufEngine.ts` để dùng đúng tham số sẵn có (`disableThinking`, `thinkingBudgetTokens`, `chat_template_kwargs`). Tham chiếu memory: B4 `--reasoning-budget 12000` là cấu hình server hiện có.
- **D3 (AI-04/05)** Bỏ luật "SAFETY comment trong khối mã" khỏi system prompt; lọc header/`_safety_note` của golden examples trước khi đưa vào prompt và hậu kiểm gỡ dòng trùng header golden khỏi mã trả về.
- **AI-09** Thông điệp lỗi hệ thống cho người dùng: câu ngắn dễ hiểu (vd "Trợ lý chưa trả lời được (hết ngân sách xử lý). Thử lại hoặc rút ngắn yêu cầu.") — chi tiết kỹ thuật (chuỗi chẩn đoán dài, trích suy luận) chỉ trả trong trường riêng `devDetail` và UI chỉ hiện khi người dùng là admin (gập mặc định).

Nghiệm thu: bộ test cổng xanh; test đơn vị xác nhận tham số gửi tới client model (ngân sách nghĩ/tắt nghĩ) đúng theo loại lượt; **đo kết cục thật**: chạy lại bộ 14 tác vụ + S1–S4 bằng script của phụ lục A (`scratchpad A-ai/run.mjs` — nếu không còn, viết lại theo mô tả phụ lục A §1) **trên mã mới qua một tiến trình server riêng cổng khác :3000** (vd `NODE_ENV=production PORT=3015 npx tsx server/_core/index.ts` — kiểm cách chạy trong repo; KHÔNG động vào :3000) ⇒ HỎNG 0/14, S1/S2/S3 bị chặn bởi `gate`, S4 không bị chặn; lưu output thô từng tác vụ; tắt tiến trình riêng sau khi đo. tsc 0.

## Task 11: Socket — sự kiện `admin:*` chỉ cho người có quyền (phát hiện khi làm Task 7)

Nguồn: báo cáo Task 7 (`.superpowers/sdd/2026-09-26-engineering-control-dot0/task-7-report.md`) + spec F §6/§10.5. Tệp chính: `server/_core/socket.ts` (+ `socketPhongQuyen.ts` do Task 7 tạo — tái dùng).

Yêu cầu:
- Hiện mọi socket trình duyệt đã đăng nhập (kể cả operator) gọi được `admin:join`, `admin:get_online_machines`, `admin:approve_registration`, `admin:reject_registration` — `approve_registration` trả/ghi apiKey máy. Gate các sự kiện này bằng đúng quyền mà đường tRPC tương đương dùng (đọc `machineRegistration`/router duyệt đăng ký máy — module `machine_registration` hoặc vai admin; dùng `checkPermission` thật, fail-closed như Task 7).
- Người không đủ quyền: bị từ chối + log (giá trị đưa vào log phải được ép kiểu/escape — tránh giả dòng log), không có tác dụng phụ (không `updateMachine`, không lộ apiKey).
- Test socket.io thật (dùng harness của Task 7): operator ⇒ bị từ chối, không có `updateMachine`; người có quyền ⇒ duyệt được (positive control trong CÙNG test).

Nghiệm thu: test mới xanh + đột biến gỡ gate ⇒ đỏ; test socket sẵn có xanh; tsc 0.
