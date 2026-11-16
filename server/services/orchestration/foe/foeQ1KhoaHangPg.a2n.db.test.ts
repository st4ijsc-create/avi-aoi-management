/**
 * Ca theo ngoại lệ Y-01 (AGENTS-ngoai-le.md dòng 28 trên main a1eac8465; bản đầu 73e681d7a). Bản 8 (DO-64, 17/11), soạn trên mã fe609ac7e (lô X-11: bfcd42ddd test + fe609ac7e mã), CHƯA chạy lượt nào.
 * Khói 16/11 (bản 6) trên bản sao f9a7fdd97, URL DB chết: không Q1_PG_CHAY ⇒ skip có tên; Q1_PG_CHAY=1 ⇒ ĐỎ ở beforeAll (ECONNREFUSED) trước mọi INSERT.
 * MỐC LƯỢT 6 (17/11 02:51:05–02:51:14 +07, dieu-phoi, `_test`): ref 8b8a1064e (pilot/q1pg-thu-8, cha fe609ac7e), nội dung tệp ca = bản 8 vòng 2 (sha16 765149c4911d8457; bản này chỉ khác
 *   ở chú thích), worktree _q1pg_wt6, vitest 2.1.9. Dòng in: hashMa eb799c73a6e478b4, hashEdge 2d83d245b79583a3; bốn cờ ROBOT_CONTROL / OT_CONTROL / OT_GATEWAY / FOE_DURABLE = false;
 *   EDGE_RUNTIME_ENABLED trước ca false, trong ca true. Chạy trọn, dọn sạch (0 hàng xoá được ở lại, không thiết bị ở lại), WORM 7 = audit_logs 5 + command_log 1 + device_owner_changes 1
 *   + edge_stop_ack_refusals 0 (trần 8, đúng khung Y-01). Hàng xoá được đã ghi: run_steps 1, ai_pending_actions 1, notifications 3 + 2 (ot_command), robot_motion_lock_requests 1.
 *   Số đo (đồng hồ DB): lần bấm một trả lời 2 995 ms, abortUnconfirmed, câu (a) đúng nguyên văn, đúng một URGENT khoá `nut`; 'aborted' đọc thấy sau 3 120 ms; claim hết; vết abort:s9
 *   failed / chuaXacMinh / adapterNut; hàm liệt kê trả run sau 3 123 ms, quá cửa sổ thì không; lần bấm hai: resend ok sau 282 ms, đúng 1 hàng yêu cầu STOP cho nút (giao sau 237 ms),
 *   câu (d) đúng phần mở đầu. Mọi khẳng định X-11 xanh. ĐỎ đúng ba tên dự kiến (expect.soft): hai Q1-PG-STOP-TRONG-CUA-SO và Q1-PG-X11-CHU-D-DUOI (đuôi thật: "Could not be verified as
 *   a pinned STOP: r1, r2, c1: …"; nguyên nhân: fixture, xem chú thích tại khẳng định đó và tam/do64-bao-cao.md mục 11).
 * KHI CHẠY TAY (HST 17/11, phương án A): ba khẳng định ĐỎ có chủ ý — hai Q1-PG-STOP-TRONG-CUA-SO đỏ là ĐÚNG THIẾT KẾ X-11 (lần bấm một để STOP của adapter nút cho nút gửi, trung tâm
 *   không gửi); Q1-PG-X11-CHU-D-DUOI đỏ do FIXTURE (r1 `set_value` trên máy AUTOMATION, chèn thẳng bỏ qua validateWorkflow; sửa 1 dòng đã biết: `set_machine_param` trong helper ot(),
 *   để dành cho lượt sau). Ca là describe.skip có tên khi vắng Q1_PG_CHAY (cổng thường bỏ qua) và CHỈ chạy tay theo Y-01 trong lượt của phiên điều phối; mỗi lượt để lại ~7 hàng WORM.
 * Số dòng `tệp.ts:N` trong tệp này: tại fe609ac7e khi có ghi "@ fe609ac7e"; các số còn lại chép từ bản 6/7 (rev 3d2b83260 / 77ec64b0b), có thể lệch vài chục dòng ở foeEngine.ts.
 *
 * HÌNH SAU X-11 (Y-01 dòng 28 @ a1eac8465: "thêm MỘT hình đo sau khi lô X-11 xong: hình Abort trong cửa sổ khoá cộng lần bấm Abort thứ hai, riêng hình này trần hàng WORM ở lại là 8
 *   (`audit_logs` 4–5, `command_log` 1, `device_owner_changes` 1, `edge_stop_ack_refusals` 0–1), các hình khác giữ trần 6"; chốt gộp A2(n) của chủ dự án 16/11, qua HST: "lô X-11 xong và hình đo đó cho
 *   thấy STOP của adapter nút được gửi sau lần bấm đầu mà không cần bấm lại"). Vẫn MỘT ca (Y-01). Sau hình (a) bên dưới, cùng ca đo tiếp:
 *   (5) A commit 'held' có chốt; lệnh ghi 'aborted' của lần bấm một (đã bị cắt ở D nhưng còn chờ khoá trong Postgres) rơi vào. Ca chờ có hạn tới khi đọc thấy 'aborted' (đồng hồ DB), rồi gọi
 *       hàm liệt kê THẬT của trung tâm `docRunAbortCanGuiLaiStop` (edgeExecutionCentral.ts:347-399 @ fe609ac7e; pull v1 :284, pull v2 :918; CHỈ ĐỌC) cho nút của ca, khi assignment không
 *       có token claim (`hetClaim`, :379) ⇒ run ĐƯỢC liệt kê; vết `abort:s9` là `failed`, `abortStop: "chuaXacMinh"`, `adapterNut: true` (ghi ở foeEngine.ts:6986-6989, :7004 @ fe609ac7e, cờ từ
 *       foeStepClass.ts:336 qua `ghimNut` foeEngine.ts:6864; vị từ edgeExecutionCentral.ts:335-339). Đối chứng cùng hàm, cùng hàng: `now` quá cửa sổ 15 phút ⇒ KHÔNG liệt kê.
 *   (6) lần bấm Abort thứ hai: run 'aborted' có chốt ⇒ resendAbortStops (foeEngine.ts:6442-6476 @ fe609ac7e) ⇒ s9 qua markedRow (:6955) ⇒ dispatcher thật: adapter thuộc nút, không driver ⇒
 *       routeEdgeOwnedAdapterCommand (commandDispatcher.ts:3359, gọi ở :1450) ⇒ enqueueEdgeDeviceRequest (:3381; edgeNodeCommands.ts:179-212) ⇒ ĐÚNG MỘT hàng robot_motion_lock_requests kind='stop'
 *       của adapter cho nút của ca; `abortStops.xepChoNut = ["s9"]` (foeEngine.ts:7073); câu trả lời mở đầu bằng NGUYÊN VĂN câu (d) của tam/x11-chu-duyet.md (chuBamLai :6388-6423, chuXepChoNut :6380-6382);
 *       giao ≤ 7·D kể từ lúc bấm hai, trả lời ≤ 18·D (chặn trên mã tự ghi, foeEngine.ts:6024-6030 @ fe609ac7e = :6011-6014 mà Y-01 trích ở rev cũ). Trong ca không có xác nhận nào của nút ⇒ xếp 1
 *       (lớp "STOP đã xác nhận không gửi lại" không đo được ở đây: xem GIỚI HẠN X-11).
 *   Trần WORM của ca bản 8 = 8, khung từng bảng theo Y-01 (ca khẳng định từng bảng ở cuối). Bảng dự kiến và nơi ghi: tam/do64-bao-cao.md mục 2.
 *
 * CA NÀY ĐO ĐƯỢC GÌ / KHÔNG ĐO ĐƯỢC GÌ (HST 17/11, qua scada-master; bắt buộc):
 *   Trên `_test` không có nút thật, và ca KHÔNG chạy gateway hay giả lập nút (vùng cấm). Ca chỉ chứng minh phần TRUNG TÂM, trên Postgres thật:
 *     • sau lần bấm đầu trong cửa sổ khoá, khi 'aborted' rơi vào, run được liệt kê cho lượt quét của nút, với vết của đúng STOP s9 (đọc qua chính hàm liệt kê, `docRunAbortCanGuiLaiStop`);
 *     • lần bấm hai xếp s9 cho nút đúng một lần, như ca FakeDb T4-B3-Q1-HAI-LAN-BAM-HIEN-TRANG / T4-B3-Q1-X11-BAM-HAI-CHUA-XAC-NHAN (foeRunStoreParity.dot10.test.ts:3003, :3268 @ fe609ac7e).
 *   KHÔNG đo: nút nhận ảnh quét có chữ ký (`stopsUnconfirmed` của pull v2, edgeExecutionCentral.ts:918-931: ký `runpkg` bằng khoá của trung tâm), kiểm chữ ký ở nút, rồi gửi s9 tới driver
 *     (edgeExecutionAgent.ts:941-957 → walker.resendStops :1219-1240 → foeEngine.resendStopsOfAbortedRun :7572), và trung tâm xác nhận lại (applySweepStop, edgeReportsCentral.ts:685-759). Phần đó thuộc ca của
 *     `edgeExecutionAgent`; X-12 sẽ thêm ca cho phần này. Ca hiện có gần nhất (tên ở tam/do64-bao-cao.md mục 4) phủ đường cổng thiết bị của agent, chưa phủ walker.resendStops.
 *   Kết quả của ca KHÔNG được gọi là "đã đo STOP tới thiết bị". Adapter của ca là `stub`, không có driver nào chạy; dự phòng STOP của trung tâm ở chế độ chạy khô (OT_CONTROL_ENABLED tắt, ca tự kiểm).
 *
 * GIỚI HẠN X-11 (thêm ở bản 8): (i) fixture không bao giờ đặt token claim (assignment chèn không có claimTokenHash), nên cổng `hetClaim` luôn mở: ca không đo được nhánh "nút còn giữ claim ⇒ không
 *   liệt kê" (đối chứng ở FakeDb T4-B3-Q1-DOI-CHUNG-WALKER-SONG :3078, `lapGiu` trong :3003); (ii) ca không gọi completeForNodeV2 (vì sao: đoạn bên dưới), nên phần sau giao dịch của nó
 *   (audit EDGE_RUN_SEGMENT_DONE, quét sau đoạn) không chạy; (iii) mốc giao của lần bấm hai là "createdAt" của hàng yêu cầu, gồm cả việc của dispatcher sau khi nhận lệnh (con số của mã không tính
 *   phần đó, foeEngine.ts:6034 @ fe609ac7e), nên phép so ≤ 7·D chặt hơn chặn trên của mã; (iv) lần bấm thứ ba sau xác nhận (xếp 0) cần nút xác nhận: không làm được trên `_test`.
 *   bật EDGE_RUNTIME_ENABLED chỉ để đường xếp STOP cho nút tạo hàng yêu cầu; adapter là stub; HST duyệt 17/11
 *   (v) EDGE_RUNTIME_ENABLED: ca tự đặt "1" TRONG tiến trình test (process.env, không đọc .env), trả lại ở afterAll, để enqueueEdgeDeviceRequest không ném "unavailable" (edgeNodeCommands.ts:167-168);
 *   cờ chỉ được đọc lúc gọi (edgeCoordinator.ts:40-42), trong mã dưới ca chỉ ở :167 và edgeExecutionCentral.ts:156 (không chạy trong ca). Lượt 5 chạy với cờ tắt.
 *   (vi) HST 17/11 (vòng 2): TRƯỚC mọi INSERT ca ĐỎ nếu tiến trình test bật một trong bốn cờ ROBOT_CONTROL_ENABLED, OT_CONTROL_ENABLED, OT_GATEWAY_ENABLED, FOE_DURABLE ("true" hoặc "1");
 *   ca in tên từng cờ kèm true/false, không in giá trị nào khác.
 * Đề xuất tên và chỗ đặt: server/services/orchestration/foe/foeQ1KhoaHangPg.a2n.db.test.ts   (khớp include `*.db.test.ts`; cạnh khuôn: server/services/edge/edgeHeldConsume.a2n.db.test.ts,
 * edgeStopOwnerRace.dot10.db.test.ts, và `__edgeCentralKit.dot10`).
 *
 * Q-1 (chu-du-an-HST 15/11, điều kiện chặn gộp A2(n)): trên Postgres THẬT, `applyEdgeSegmentEnd` -> `held()` giữ khoá `FOR UPDATE` hàng orchestration_runs (foeRunStore.ts:2139, TRONG giao dịch của người gọi: production edgeExecutionCentral.ts:1196-1197) trong lúc chờ URGENT bền tới
 * 5·D (KET_DOAN_EDGE_TONG_MS, foeRunStore.ts:733, dùng ở :2204). Trong lúc đó `abortRun` (một phiên khác của pool) ghi `status='aborted'` bị khoá chặn; lần ghi bị chặn bởi D
 * (STOP_DB_STEP_DEADLINE_MS = 1000 ms, stopJob.ts:20; foeEngine.ts:7277-7299 @ fe609ac7e) rồi VẪN quét STOP. Bản 6 (HST 16/11, sáu điều kiện; xem do56-brief.md). Ca khẳng định:
 *   (1) phiên A CHỜ THẬT ở foeRunStore.ts:2207: end mang MỘT báo cáo `held` (r1, c1) trong rider `[[A2N:…]]` (dựng bằng ganBaoCaoKhongRoEdge, foeKetCucKhongRo.ts:1053, như nút) ⇒ chotId = r1 (:2178, :2205)
 *       ⇒ benChot (:2206) có đúng URGENT của báo cáo đó (daCo, :2143); mock chỉ treo URGENT có dedupKey `foe_outcome_unknown_compensation_held:<run>:r1:c1:claim2` (khoá dựng ở foeKetCucKhongRo.ts:831,
 *       kind :395, lan `claim<seq>` :1029); mọi URGENT khác (của Abort, của dispatcher) đi thật; ca đếm và in mọi lần gọi;
 *   (2) "A còn giữ khoá" đo bằng phép dò `thuKhoa` (đã qua hai đối chứng) TRONG lúc Abort chạy (vòng dò song song, mốc clock_timestamp()) VÀ ngay sau khi Abort trả lời;
 *   (3) đại lượng chính theo ĐỒNG HỒ DB: t(giao STOP) − t(bấm Abort), t0 = clock_timestamp() ngay trước abortRun, mốc giao = robot_motion_lock_requests."createdAt" (DEFAULT now(), 0374:390;
 *       hàng chèn trong giao dịch ngắn của enqueueEdgeDeviceRequest, edgeNodeCommands.ts:206-209): ≤ 7·D; trả lời ≤ 18·D (chặn trên mã tự ghi, foeEngine.ts:6022-6034 @ fe609ac7e); khoá chặn lệnh ghi quá D
 *       ⇒ trả lời `ok:false`, `reason: "abortUnconfirmed"` (FOE_ABORT_UNCONFIRMED, foeEngine.ts:6043, :7340-7352 @ fe609ac7e); STOP nợ đi ĐÚNG MỘT lần (hàng yêu cầu STOP của adapter: kỳ vọng của hình (a), xem dưới);
 *   (4) không deadlock (`lock_timeout = '10s'` trên các kết nối riêng của ca và trên MỘT kết nối của pool, beforeAll; các kết nối khác của pool theo mặc định máy chủ), sau ca pg_locks không còn
 *       khoá đang chờ, số hàng xoá được về 0, số hàng WORM (đếm TUYỆT ĐỐI theo id mới của ca) in ra và ≤ 8 (bản 8: hình sau X-11; bản 7: ≤ 6), từng bảng trong khung Y-01.
 * Kỳ vọng thời gian lấy theo chặn trên của mã (foeEngine.ts:6011–6014 ở rev Y-01 trích = :6028-6030 @ fe609ac7e), khác chữ Y-01 ngày 15/11 ("biên trễ ≤ D + 500 ms"), đã báo HST 16/11.
 * Hình (a) (HST 16/11): phần Q1-PG-STOP-TRONG-CUA-SO (STOP nợ giao đúng một lần, ≤ 7·D) giữ kỳ vọng của đặc tả và theo đọc mã dự kiến ĐỎ, ở fe609ac7e vẫn ĐỎ: run chưa chốt khi Abort đọc
 *   (khoa = false, foeEngine.ts:6852 @ fe609ac7e) ⇒ s9 `unsure`, chỉ thiếu kết nối (foeStepClass.ts:333-336 @ fe609ac7e) ⇒ không gửi từ trung tâm (planAbortSweep :6150-6151), mà để cho nút
 *   (`choNut`, :7139-7141; câu (a) :7348-7349). Viết bằng expect.soft để các khẳng định khoá / abortUnconfirmed / ≤ 18·D, hình sau X-11, dọn và đếm WORM vẫn chạy và in số.
 *
 * VÌ SAO KHÔNG GỌI completeForNodeV2 (edgeExecutionCentral.ts:1176): nó đòi một nút đã xác thực (EdgeNodePrincipal, v2Gate :1182), một claim hiện hành (checkCurrentClaim :1184, :535),
 * con trỏ luồng báo cáo (cursorLastSeq :1186) và sau giao dịch ghi audit EDGE_RUN_SEGMENT_DONE (:1212, auditEdge :211-214: một hàng audit_logs WORM ngoài Y-01). Phần ca cần chỉ là
 * :1196-1197: `d.transaction(async (tx) => sink.applyEdgeSegmentEnd(tx, runId, {outcome, gateStepId, heldReason, error, nodeCode, claimSeq, def}))`, sink = edgeEngineSink.ts:23 →
 * foeRunStore.applyEdgeSegmentEnd. Ca gọi đúng hàm đó trong đúng dạng giao dịch đó, với cùng các trường.
 *
 * PHẠM VI ĐÃ DUYỆT (chép đúng): chỉ CSDL aoi_management_test, tài khoản ứng dụng (không owner `aoi`); fixture COMMIT mang nhãn `__q1pg_<ts>` ở cột tên/ref của từng bảng; đếm trước/sau theo từng bảng;
 * dọn bằng DELETE đúng các id do ca tạo, trong MỘT giao dịch; hàng WORM ở lại: các hình khác trần 6; hình sau X-11 (bản 8) trần 8 (audit_logs 4–5, command_log 1, device_owner_changes 1,
 * edge_stop_ack_refusals 0–1): ca ĐẾM và IN số hàng WORM thực sinh ra; chạy trong lượt của dieu-phoi.
 * Dọn ở `afterAll` và `finally` trên MỌI đường thoát, kể cả khi ca đỏ.
 * GIỚI HẠN: tiến trình bị giết giữa chừng thì afterAll không chạy; fixture chèn run ở 'running' (hình đo cần). Ca in dòng "Q1PG ids" ngay sau INSERT run. Dọn tay (theo Y-01, phiên điều phối,
 * đếm trước → test-only → commit), đúng các id in ra, một giao dịch: UPDATE orchestration_runs SET status='failed', "finishedAt"=now() WHERE id=<run> AND "workflowRef" LIKE '__q1pg_<ts>%';
 * DELETE notifications ("entityType"='orchestration_run' AND "entityId"=<run>; 'ot_command'/<adapter>), ai_pending_actions (id LIKE 'foe-run<run>-%'), orchestration_run_steps, orchestration_run_edge_assignments
 * ("runId"=<run>), orchestration_runs (id=<run>), orchestration_workflows (id=<workflow>), robot_motion_lock_requests / device_tags ("adapterId"=<adapter>, sau ack STOP), device_adapters (id=<adapter>),
 * edge_nodes (id=<node>). KHÔNG xoá bảng WORM, KHÔNG xoá edge_step_authorizations (avi_app không có DELETE, 0372:129-131).
 *
 * KHẲNG ĐỊNH RÚT RA TỪ ĐỌC MÃ: `io` chỉ được đặt bởi `initNotificationService` (server/services/notificationService.ts:27), chỉ gọi ở server/_core/socket.ts:1552. Một ca THUẦN canh khẳng định này bằng cách quét nguồn:
 * tam/notificationservice-init-mot-cho.test.ts.txt (đề xuất tên: server/services/notificationServiceInitMotCho.test.ts, chạy trong lưới thường, không cần Q1_PG_CHAY).
 *
 * LỚP KIỂM THỨ HAI (ngoài các tự kiểm ở beforeAll): dieu-phoi chạy ĐÚNG lệnh một tệp (`npx vitest run server/services/orchestration/foe/foeQ1KhoaHangPg.a2n.db.test.ts` với Q1_PG_CHAY=1),
 * và ghi vào NHẬT KÝ lượt chạy: dòng lệnh nguyên văn, giờ chạy, và hash (dòng `Q1PG start` ca tự in: ngày, hashMa của foeRunStore.ts + foeEngine.ts).
 *
 * BỔ SUNG HST 15/11 tối (đã áp): user = hằng USER_Q1_PG (2841), KHÔNG tạo user; factory/workshop/line/station dùng lại hàng sẵn có (chỉ đọc); điều kiện cứng kiểm ở beforeAll TRƯỚC mọi INSERT, sai ⇒ ĐỎ (throw), không bao giờ skip;
 * ca chỉ chạy khi có Q1_PG_CHAY=1 (vắng ⇒ describe.skip kèm lý do 'ca chạy tay, để lại hàng WORM, xem Y-01'); in ngày, hash, số hàng trước/sau theo bảng, số WORM để lại.
 *
 * Không đọc/ghi .env*; không in URL hay mật khẩu. DB_URL chỉ đọc từ process.env.DATABASE_URL và chỉ chạy khi khớp /_test\b/ (describe.skipIf, như các tệp .db.test.ts hiện có).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

// URGENT: CHỈ URGENT của phiên A (đúng một dedupKey, H.khoaTreo) treo (không bao giờ trả lời) cho tới khi ca nhả; mọi lần gọi khác đi thật; mọi thứ khác của criticalStopAlert giữ nguyên
// (khuôn: foeRunStoreParity.dot10.test.ts, raiseCriticalStopAlert). Tham số thật: { kind, title, message, recipients, dedupKey, … } (criticalStopAlert.ts:66-94); canhBaoKetCucKhongRo truyền
// `...n` của noiDungCanhBaoKhongRo (foeKetCucKhongRo.ts:865-868), dedupKey `<kind>:<run>:<step>:<comp>:<lan>` (:831). Mỗi lần gọi được GHI (kind, dedupKey, tiêu đề, có treo không, mốc giờ tiến trình).
const H = vi.hoisted(() => ({
  treo: false,
  khoaTreo: null as string | null,
  nhaTat: [] as Array<() => void>,
  goi: [] as Array<{ kind: string; dedupKey: string; title: string; treo: boolean; luc: string }>,
  nguoiNhan: 2841 /* = USER_Q1_PG, khai ở đây vì vi.hoisted chạy trước mọi const */,
}));
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, unknown>) => {
      const kind = String(a.kind ?? "");
      const dedupKey = String(a.dedupKey ?? "");
      const treo = H.treo && H.khoaTreo !== null && dedupKey === H.khoaTreo;
      H.goi.push({ kind, dedupKey, title: String(a.title ?? "").slice(0, 200), treo, luc: new Date().toISOString() }); // bản 8: thêm title (URGENT `nut` của lần bấm một)
      if (treo) return new Promise<void>((ok) => H.nhaTat.push(ok)); // never answers until the case releases it (released: no row, baoBen never called)
      // GIỚI HẠN NGƯỜI NHẬN chỉ trong test (không sửa mã sản xuất): `canhBaoKetCucKhongRo` vẫn tự đọc danh sách admin/supervisor (một SELECT, chỉ đọc; foeKetCucKhongRo.ts:855-858) rồi gọi hàm này;
      // ta thu `recipients` còn đúng người dùng của ca, nên `notifications` chỉ có 1 hàng mỗi URGENT đi thật, không nhân với R = 1 822.
      return (orig.raiseCriticalStopAlert as (x: unknown) => Promise<unknown>)({ ...a, recipients: [H.nguoiNhan] }) as Promise<void>;
    },
  };
});

import * as conn from "../../../db/connection";
import { orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
import { abortRun, FOE_ABORT_UNCONFIRMED } from "./foeEngine";
import { applyEdgeSegmentEnd } from "./foeRunStore";
import { CANH_BAO_KHONG_RO_KIND, TRAN_LOI_EDGE, ganBaoCaoKhongRoEdge, type BaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
import { hashWorkflowDefinition } from "./foeGateApproval";
import { runEdgeAssignments } from "../../edge/edgeExecutionSchema";
import { edgeRuntimeEnabled } from "../../edge/edgeCoordinator";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
// bản 8 (hình sau X-11): hàm liệt kê THẬT mà pull của nút dùng (edgeExecutionCentral.ts:347 @ fe609ac7e, export; chỉ đọc) và cửa sổ gửi lại của engine (đối chứng ngoài cửa sổ)
import { docRunAbortCanGuiLaiStop } from "../../edge/edgeExecutionCentral";
import { ABORT_RESEND_WINDOW_MS } from "@shared/foeAbortResend";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TS = Date.now();
const NHAN = `__q1pg_${TS}`; // nhãn của MỌI hàng fixture (cột tên/ref/code/openId)
const D = STOP_DB_STEP_DEADLINE_MS;
/** chặn trên do mã tự ghi (foeEngine.ts:6022-6034 @ fe609ac7e): mọi STOP được giao trong 7·D kể từ lúc bấm Abort; một run bị chốt trả lời trong 18·D */
const TRAN_GIAO_MS = 7 * D;
const TRAN_TRA_LOI_MS = 18 * D;
/**
 * bản 8 (hình sau X-11) — chữ HST duyệt 17/11: tam/x11-chu-duyet.md (sha16 0e6d8eb62c58435e) dòng 22 = câu (a) (abortUnconfirmed, có STOP để cho nút) và dòng 60 = câu (d) (lần bấm 2, run đã
 * chốt, s9 qua markedRow). Chép NGUYÊN VĂN từ tệp duyệt, chỉ thế N = id run; KHÔNG dựng lại từ mã (mã: foeEngine.ts:7348-7349, :6375-6382, :6388-6423 @ fe609ac7e).
 */
const chuA = (run: number): string => `Abort of run ${run} not confirmed by the database in time: whether the run shows as aborted is not known yet. STOP s9 NOT sent from central: check the machine on site now; if the edge node is offline, use the machine's direct STOP / E-STOP. The edge node that holds its adapter sends it once the database shows the run aborted, after it next reaches central, and only within 15 minutes from when the run was aborted. A further press at central hands it to that node only if by then the run records a command whose outcome is unknown; otherwise it sends nothing for it. STOP steps handed to the dispatcher (the machine has not confirmed them): 0; check the run and retry, but no retry can be counted on after 15 minutes from when the run was aborted.`;
const chuD = (run: number): string => `Run ${run} was already aborted — it records a command whose outcome is unknown. STOP s9 was given to the edge node that holds its adapter: queued for that node, or, where it could not be queued or the node was unreachable, sent as central's fallback STOP (the step's records say which). Nothing confirms it reached the device: check the machine on site now and use its direct STOP / E-STOP if it is still running. The node's answer is recorded at central when it comes. A further press at central hands it to that node again unless the node has confirmed it by then.`;
/** claim của đoạn edge mà phiên A kết thúc; báo cáo trong rider chỉ được đọc khi cùng claim (foeRunStore.ts:2119) */
const CLAIM_A = 2;
/** báo cáo nút đưa vào end của phiên A (BaoCaoKhongRoEdge, foeKetCucKhongRo.ts:985-996): r1 có bù trừ c1 (không phải STOP), kết cục không rõ ⇒ `held`; không `biet` (điều kiện :2206) */
const BAO_A: BaoCaoKhongRoEdge[] = [{ loai: "held", stepId: "r1", compId: "c1", ma: "EDGE_OUTCOME_UNKNOWN", claimSeq: CLAIM_A }];
/** admin cũ nhất không mang tiền tố test; tra 15/11, dieu-phoi (mcp_chi_doc, chỉ SELECT). KHÔNG phải seed. KHÔNG tạo user. */
const USER_Q1_PG = 2841;
/** AUTOMATION, isActive, station 12 → line 1 → workshop 1 → factory 1 (chuỗi seed gốc, 2026-07-10); 0 device_adapters, 0 device_owner_changes; tra 15/11, dieu-phoi (mcp_chi_doc, chỉ SELECT); dự phòng 24, 36. Ca CHỈ ĐỌC machine này và chuỗi phía trên nó. */
const MACHINE_Q1_PG = 12;
const CHAY = process.env.Q1_PG_CHAY === "1"; // biến của test, không phải cờ sản xuất
const LY_DO_SKIP = "ca chạy tay, để lại hàng WORM, xem Y-01 (đặt Q1_PG_CHAY=1 trong lượt dieu-phoi để chạy)";

type Db = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const num = (v: unknown) => Number(v);

/** Bảng mà ca TẠO hoặc GHI THÊM; `cot` là cột nhãn / khoá dùng để đếm và xoá đúng hàng của ca. */
interface Dau {
  readonly bang: string;
  readonly dem: (runId: number | null, ids: Ids) => ReturnType<typeof sql>;
  readonly worm: boolean;
}
interface Ids {
  machine: number | null;
  node: number | null;
  adapter: number | null;
  tag: number | null;
  workflow: number | null;
  run: number | null;
}
const ids: Ids = { machine: null, node: null, adapter: null, tag: null, workflow: null, run: null };

// Mỗi dòng: cách ĐẾM các hàng của ca ở bảng đó. Hàng WORM (worm: true) không xoá được: ca in số đếm.
const DAU: Dau[] = [
  { bang: "orchestration_workflows", dem: () => sql`SELECT count(*)::int AS n FROM orchestration_workflows WHERE ref LIKE ${NHAN + "%"}`, worm: false },
  { bang: "orchestration_runs", dem: () => sql`SELECT count(*)::int AS n FROM orchestration_runs WHERE "workflowRef" LIKE ${NHAN + "%"}`, worm: false },
  { bang: "orchestration_run_steps", dem: (r) => sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${r}`, worm: false },
  { bang: "orchestration_run_edge_assignments", dem: (r) => sql`SELECT count(*)::int AS n FROM orchestration_run_edge_assignments WHERE "runId" = ${r}`, worm: false },
  { bang: "edge_step_authorizations", dem: (r) => sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${r}`, worm: false }, // mig 0372:129-131: avi_app có SELECT/INSERT, KHÔNG DELETE ⇒ chỉ đếm, KHÔNG xoá; sau ca phải = 0 (hàng ở lại ngoài Y-01 ⇒ ĐỎ có tên)
  { bang: "ai_pending_actions", dem: (r) => sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id LIKE ${"foe-run" + r + "-%"}`, worm: false }, // id = orchestrationActionId(idempotencyKey) = `foe-run<runId>-…` (foeStepClass.ts:71-76); bảng KHÔNG có cột runId
  { bang: "notifications", dem: (r) => sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${USER_Q1_PG} AND "entityType" = 'orchestration_run' AND "entityId" = ${r}`, worm: false }, // nối về run bằng entityType/entityId (foeKetCucKhongRo.ts:868; criticalStopAlert.ts:120); khoá chống lặp BỀN = chính bảng này (metadata->>'dedupKey', criticalStopAlert.ts:36-55)
  { bang: "edge_nodes", dem: () => sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${"N-" + NHAN + "%"}`, worm: false },
  { bang: "device_adapters", dem: () => sql`SELECT count(*)::int AS n FROM device_adapters WHERE code LIKE ${NHAN + "%"}`, worm: false },
  { bang: "device_tags", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${i.adapter}`, worm: false },
  { bang: "robot_motion_lock_requests", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${i.adapter}`, worm: false },
  { bang: "notifications(ot_command)", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${USER_Q1_PG} AND "entityType" = 'ot_command' AND "entityId" = ${i.adapter}`, worm: false }, // ot_stop_routed_to_edge (commandDispatcher.ts:3424 @ fe609ac7e) + stop_undelivered nếu nút không liên lạc được (:3414); ot_stop_not_queued nếu không xếp được (:3438)
  { bang: "audit_logs", dem: (r) => sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'orchestration_run' AND "entityId" = ${r}`, worm: true },
  { bang: "command_log", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${i.adapter}`, worm: true }, // writeRejected của STOP xếp cho nút (commandDispatcher.ts:3423 @ fe609ac7e; :3437 nếu không xếp được); dự phòng sendCentralAdapterStop không ghi command_log khi OT_CONTROL_ENABLED tắt (deviceOwnershipService.ts:413)
  { bang: "device_owner_changes", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM device_owner_changes WHERE "deviceKind" = 'adapter' AND "deviceId" = ${i.adapter}`, worm: true }, // cột: drizzle/0374_edge_device_ownership_and_lock_authority.sql:197-206; hàng của ca = INSERT adapter của fixture (trigger 0374:328-330 → device_owner_insert_log :313-323), TRƯỚC lần đếm `truoc`
  { bang: "edge_stop_ack_refusals", dem: (_r, i) => sql`SELECT count(*)::int AS n FROM edge_stop_ack_refusals WHERE "adapterId" = ${i.adapter}`, worm: true }, // WORM (0374:690-714; avi_app SELECT, 0374:101): ack STOP bị từ chối lúc dọn (trường hợp xấu Y-01)
];

async function demTatCa(db: Db, runId: number | null): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const d of DAU) out[d.bang] = num(rowsOf(await db.execute(d.dem(runId, ids)))[0]?.n ?? 0);
  return out;
}
const hieu = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]).filter(([, d]) => d !== 0));

/**
 * Fixture COMMIT (khuôn `dungThe` của edgeHeldConsume.a2n.db.test.ts, nhưng KHÔNG trong giao dịch ROLLBACK: hai phiên phải thấy cùng hàng). Một nút v2 sở hữu MỘT robot; ba người dùng
 * (chủ run, người duyệt, admin) mang nhãn. Mọi id vào `ids` ngay khi tạo để `donDep` xoá đúng chúng kể cả khi dựng dở.
 */
async function dungFixture(db: Db) {
  const one = async (q: ReturnType<typeof sql>) => Number(rowsOf(await db.execute(q))[0]!.id);
  // machine MACHINE_Q1_PG (12) và chuỗi station → line → workshop → factory phía trên nó: SẴN CÓ, CHỈ ĐỌC (đã kiểm ở beforeAll). Chỉ cần `factories.code` cho `edge_nodes.factoryCode`.
  ids.machine = MACHINE_Q1_PG;
  const fac = rowsOf(await db.execute(sql`SELECT f.code AS code FROM machines m JOIN stations s ON s.id = m."stationId" JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" JOIN factories f ON f.id = w."factoryId" WHERE m.id = ${MACHINE_Q1_PG}`))[0];
  if (!fac) throw new Error(`điều kiện trước của ca Q-1 không còn (machine ${MACHINE_Q1_PG} không còn chuỗi station/line/workshop/factory); chọn lại bằng tra chỉ đọc; KHÔNG tạo user`);
  ids.node = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N-${NHAN}`}, ${NHAN}, ${String(fac.code)}, 'online') RETURNING id`);
  await db.execute(sql`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id = ${ids.node}`);
  // adapter RIÊNG (protocol `stub`, enums.ts:251-254; ca tự kiểm ở beforeAll) thuộc nút ⇒ trigger device_owner_insert_log ghi 1 hàng device_owner_changes (WORM, 0374:331-333)
  ids.adapter = await one(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled", "edgeNodeId") VALUES (${ids.machine}, ${`${NHAN}-A`}, ${NHAN}, 'stub', 'stub://q1pg', true, ${ids.node}) RETURNING id`);
  // thẻ `halt` có giá trị DỪNG ghim (device_tags.stop_value, ot.ts:96-98): STOP ghim = lệnh duy nhất đi đường STOP
  ids.tag = await one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", stop_value) VALUES (${ids.adapter}, 'halt', '00001', 'bool', true, true, 'true'::jsonb) RETURNING id`);
  // mọi lệnh là OT (machine sẵn có, chỉ đọc) với `args.adapterId` tường minh: withResolvedAdapter trả nguyên args khi có adapterId số (foeRunStore.ts:1389), nên không phụ thuộc adapter khác của machine
  const ot = (id: string, args: Record<string, unknown> = {}, comp?: unknown) => ({ id, type: "command", machineId: ids.machine, command: "set_value", args: { adapterId: ids.adapter, tagKey: "speed", value: 1, ...args }, ...(comp ? { compensation: comp } : {}) });
  const otStop = (id: string) => ({ id, type: "command", machineId: ids.machine, command: "stop", args: { adapterId: ids.adapter, tagKey: "halt", value: true } });
  const def = { ref: `${NHAN}-wf`, name: NHAN, steps: [{ id: "g0", type: "hitl_gate", prompt: "go?" }, ot("r1", {}, ot("c1")), ot("r2"), otStop("s9")] };
  const [wf] = await db.insert(orchestrationWorkflows).values({ ref: def.ref, name: NHAN, definitionJson: def, status: "active", scopeKey: "global", version: 1 } as never).returning({ id: orchestrationWorkflows.id });
  ids.workflow = wf!.id;
  const [run] = await db.insert(orchestrationRuns).values({ workflowId: wf!.id, workflowRef: def.ref, status: "queued", paramsJson: {}, contextJson: {}, startedBy: USER_Q1_PG } as never).returning({ id: orchestrationRuns.id });
  ids.run = run!.id;
  // eslint-disable-next-line no-console
  console.log("Q1PG ids", JSON.stringify({ run: ids.run, workflow: ids.workflow, node: ids.node, adapter: ids.adapter, tag: ids.tag, nhan: NHAN }));
  await db.insert(runEdgeAssignments).values({ runId: ids.run, edgeNodeId: ids.node!, workflowId: wf!.id, workflowVersion: 1, defHash: hashWorkflowDefinition(def as never), assignedBy: USER_Q1_PG } as never);
  // 0370:125-141 (edge_run_assignment_insert_guard): assignment chỉ chèn được khi run đang 'queued' ⇒ đưa run sang 'running' SAU khi gán nút
  await db.execute(sql`UPDATE orchestration_runs SET status = 'running' WHERE id = ${ids.run} AND "workflowRef" LIKE ${NHAN + "%"}`);
  // hàng của cổng và của r1 (đã gửi, kết quả mất): như một đoạn 2 mà r1 trả kết cục không rõ
  await db.execute(sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson", "finishedAt") VALUES (${ids.run}, 'g0', 'hitl_gate', 'completed', 0, ${JSON.stringify({ approved: true })}::jsonb, now())`);
  await db.execute(sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson") VALUES (${ids.run}, 'r1', 'command', 'running', 1, ${JSON.stringify({ routedTo: "robot-dispatcher" })}::jsonb)`);
  return def;
}

/**
 * Dọn: MỘT giao dịch, DELETE đúng id của ca (không DELETE rộng). Hàng WORM (audit_logs, command_log, device_owner_changes) KHÔNG đụng. STOP đã xếp cho nút (robot_motion_lock_requests) đi đường hợp pháp
 * của khuôn edgeStopOwnerRace.dot10.db.test.ts:34-40 trước khi xoá robot. Chạy ở afterAll VÀ trong finally của ca; lặp lại vô hại.
 */
let thietBiConLai = false; // ack STOP hỏng ⇒ adapter / node / yêu cầu STOP / tag ở lại (trường hợp xấu Y-01), không ép xoá
async function donDep(db: Db): Promise<void> {
  if (ids.run == null && ids.adapter == null && ids.node == null && ids.workflow == null) return;
  let leftover = false;
  thietBiConLai = false;
  if (ids.run != null) {
    try {
      // HST 16/11 (sau lượt 5): trạng thái run NGAY TRƯỚC khi dọn — lệnh UPDATE 'aborted' đã bị cắt ở D vẫn chờ khoá trong Postgres và áp vào sau khi A commit (withDeadline chỉ thôi chờ,
      // boundedClose.ts:126-140); lượt 5 chỉ suy ra điều này từ số hàng câu dọn trả về (0). In trực tiếp để có số đo
      const truocDon = rowsOf(await db.execute(sql`SELECT status, "finishedAt"::text AS xong, left(error, 120) AS loi FROM orchestration_runs WHERE id = ${ids.run}`))[0] ?? null;
      // eslint-disable-next-line no-console
      console.log("Q1PG run just before cleanup:", JSON.stringify(truocDon));
      const doi = await db.execute(sql`UPDATE orchestration_runs SET status = 'failed', "finishedAt" = now(), error = ${"Q1PG cleanup: " + NHAN} WHERE id = ${ids.run} AND "workflowRef" LIKE ${NHAN + "%"} AND status NOT IN ('aborted', 'failed', 'completed') RETURNING id`);
      // eslint-disable-next-line no-console
      console.log("Q1PG cleanup: run moved out of a running status:", rowsOf(doi).length);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Q1PG cleanup: could not move the run out of a running status:", (err as Error)?.message ?? err);
    }
  }
  await db.transaction(async (tx) => {
    if (ids.run != null) {
      await tx.execute(sql`DELETE FROM notifications WHERE "entityType" = 'orchestration_run' AND "entityId" = ${ids.run}`);
      if (ids.adapter != null) await tx.execute(sql`DELETE FROM notifications WHERE "entityType" = 'ot_command' AND "entityId" = ${ids.adapter}`); // nối chắc chắn: entityType/entityId của hàng do sendNotification ghi
      await tx.execute(sql`DELETE FROM ai_pending_actions WHERE id LIKE ${"foe-run" + ids.run + "-%"}`);
      await tx.execute(sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${ids.run}`);
      // orchestration_run_edge_assignments: avi_app KHÔNG có DELETE (0370:202/205); đi theo run: ON DELETE CASCADE (0370:104)
      await tx.execute(sql`DELETE FROM orchestration_runs WHERE id = ${ids.run}`);
    }
    if (ids.workflow != null) await tx.execute(sql`DELETE FROM orchestration_workflows WHERE id = ${ids.workflow}`);
    if (ids.adapter != null) {
      // ĐƯỜNG ACK (drizzle/0374_edge_device_ownership_and_lock_authority.sql): adapter của ca thuộc NÚT, nên CHỈ nút ack được: `edge_stop_ack_central` (0374:784-826) từ chối thiết bị
      // thuộc nút khi chưa có cờ `ownerCannotListAt` (0374:809-812). Ca đóng vai nút bằng `public.edge_stop_ack_edge(p_request, p_node, p_robot, p_adapter, p_owner_epoch, p_outcome, p_unsigned, p_generation)`
      // (0374:833-834; GRANT cho avi_app 0374:1269): (request, nút của ca, NULL, adapter của ca, ownerEpoch hiện tại của adapter, 'done', false). Điều kiện (0374:888-895): đúng nút, đúng epoch, nút còn là chủ (UPDATE ackedAt khi đạt, trả true ở :904).
      // Nó trả boolean: false ⇒ GHI một hàng WORM `edge_stop_ack_refusals` (0374:709): vì vậy chỉ gọi khi đã đọc đủ điều kiện, và nếu vẫn false thì KHÔNG ép xoá.
      const dev = rowsOf(await tx.execute(sql`SELECT "edgeNodeId" AS node, "ownerEpoch" AS epoch FROM device_adapters WHERE id = ${ids.adapter}`))[0];
      const cho = rowsOf(await tx.execute(sql`SELECT id, "edgeNodeId" AS node, "ownerEpoch" AS epoch FROM robot_motion_lock_requests WHERE "adapterId" = ${ids.adapter} AND kind = 'stop' AND "ackedAt" IS NULL AND "resolvedAt" IS NULL`));
      let tatCaAck = true;
      for (const r of cho) {
        const du = dev && num(dev.node) === ids.node && num(r.node) === ids.node && String(r.epoch) === String(dev.epoch);
        const ok = du ? rowsOf(await tx.execute(sql`SELECT public.edge_stop_ack_edge(${r.id}::integer, ${ids.node}::integer, NULL::integer, ${ids.adapter}::integer, ${r.epoch}::bigint, 'done', false) AS ok`))[0]?.ok === true : false;
        if (!ok) tatCaAck = false;
      }
      if (!tatCaAck) {
        // KHÔNG ép xoá: in các hàng còn lại không xoá được (RÁC NGOÀI con số đã trình); adapter và node giữ nguyên (xoá sẽ bị chặn: thiết bị còn STOP chưa ack, 0374:75)
        // eslint-disable-next-line no-console
        console.warn("Q1PG LEFTOVER (not deletable, outside the submitted count):", JSON.stringify({ adapter: ids.adapter, node: ids.node, stopRequests: cho.map((r) => r.id) }));
        leftover = true;
        thietBiConLai = true;
      } else {
        // robot_motion_lock_requests: avi_app KHÔNG có DELETE (0374:1276-1278); STOP đã ack ⇒ đi theo adapter: ON DELETE CASCADE (0374:383), trigger 0374:647-661 / :684 cho qua khi đã ack
        await tx.execute(sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.adapter}`);
        await tx.execute(sql`DELETE FROM device_adapters WHERE id = ${ids.adapter}`); // phải trước edge_nodes: device_adapters.edgeNodeId RESTRICT (0374:146)
      }
    }
    if (ids.node != null && !leftover) await tx.execute(sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`);
    // machine / station / line / workshop / factory / user: hàng SẴN CÓ, không tạo ⇒ không xoá
  });
  if (!leftover) for (const k of Object.keys(ids) as Array<keyof Ids>) (ids[k] as unknown) = null;
}

if (!CHAY) console.info(`[Q1-PG] describe.skip: ${LY_DO_SKIP}`);
(CHAY ? describe : describe.skip)("Q-1 — held() giữ khoá hàng run, Abort trong lúc đó (Postgres thật, hai phiên, fixture COMMIT có dọn)", () => {
  let db: Db;
  const saved: Record<string, string | undefined> = {};
  let keyDir = "";
  const soWorm: Record<string, number> = {};

  beforeAll(async () => {
    // ĐIỀU KIỆN CỨNG, TRƯỚC mọi INSERT. Sai ⇒ throw (ĐỎ), KHÔNG BAO GIỜ skip. Mẫu thông điệp: "điều kiện trước của ca Q-1 không còn (<điều kiện>); chọn lại bằng tra chỉ đọc; KHÔNG tạo user"
    const hong = (dk: string): never => {
      throw new Error(`điều kiện trước của ca Q-1 không còn (${dk}); chọn lại bằng tra chỉ đọc; KHÔNG tạo user`);
    };
    if (!/_test\b/.test(DB_URL)) hong("tên DB không kết thúc _test");
    const d = await conn.getDb();
    if (!d) return hong("không có kết nối DB");
    db = d as Db;
    // (c) ca chạy MỘT MÌNH trong tiến trình riêng, không khởi động server: dùng trạng thái của chính runner vitest (không phải mã sản xuất): worker của tệp này phải chỉ có đúng tệp này,
    // và `isolate` không bị tắt (vitest.config.ts không đặt isolate/pool ⇒ mặc định forks + isolate, mỗi tệp một tiến trình). Đọc `globalThis.__vitest_worker__` (nội bộ vitest 2.1): nếu dạng khác thì ĐỎ và hỏi HST.
    // trạng thái nội bộ vitest 2.1; nâng vitest thì xem lại (HST 15/11)
    const w = (globalThis as { __vitest_worker__?: { ctx?: { files?: Array<{ filepath?: string } | string> }; config?: { isolate?: boolean } } }).__vitest_worker__;
    const tep = (w?.ctx?.files ?? []).map((f) => (typeof f === "string" ? f : f.filepath ?? ""));
    if (!w || tep.length !== 1 || w.config?.isolate === false) hong(`không chứng minh được ca chạy một mình trong tiến trình riêng (files=${JSON.stringify(tep)}, isolate=${String(w?.config?.isolate)})`);
    // (b) cầu hệ sinh thái: KHÔNG kiểm được bằng mã sẵn có: cờ `installed` là biến module không export (server/services/ecosystem/ecosystemEvents.ts:337, đặt ở :377, chỉ gọi ở server/_core/index.ts:3552) và `EventBus.emitter` là trường private (server/_core/eventBus.ts:56).
    // MỨC TỐI THIỂU (HST): (c) + cờ ECOSYSTEM_EVENTS_ENABLED KHÔNG bật, đọc từ process.env NGAY TRONG CA (không đọc tệp .env) + fan-out Redis của bus tắt (getter công khai `fanoutActive`, eventBus.ts:72-74).
    const eco = process.env.ECOSYSTEM_EVENTS_ENABLED;
    if (eco === "true" || eco === "1") hong("ECOSYSTEM_EVENTS_ENABLED đang bật trong môi trường của tiến trình");
    const { eventBus } = await import("../../../_core/eventBus");
    if (eventBus.fanoutActive) hong("eventBus.fanoutActive = true (fan-out Redis liên instance đang bật)");
    // bản 8 (hình sau X-11) — lần bấm hai đi đường adapter thuộc nút (commandDispatcher.ts:3359 @ fe609ac7e); nút không liên lạc được ⇒ dự phòng STOP của trung tâm sendCentralAdapterStop
    // (deviceOwnershipService.ts:399-455). Với OT_CONTROL_ENABLED="true" nó mở phiên driver tạm và ghi xuống adapter (:413-453): đường thiết bị, ngoài Y-01 ⇒ ĐỎ trước mọi INSERT. Tắt ⇒ "simulated", không ghi gì (:413)
    // HST 17/11 (vòng 2): bốn cờ của tiến trình test, đọc process.env (không đọc .env), bật = "true" hoặc "1". In TÊN cờ kèm true/false, không in giá trị nào khác. Bật một cờ ⇒ ĐỎ, trước mọi INSERT
    const CO_CAM = ["ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "OT_GATEWAY_ENABLED", "FOE_DURABLE"] as const;
    const coBat = Object.fromEntries(CO_CAM.map((k) => [k, process.env[k] === "true" || process.env[k] === "1"])) as Record<(typeof CO_CAM)[number], boolean>;
    // eslint-disable-next-line no-console
    console.log("Q1PG flags", JSON.stringify(coBat));
    const dangBat = CO_CAM.filter((k) => coBat[k]);
    if (dangBat.length) hong(`tiến trình test đang bật ${dangBat.join(", ")} (phải tắt cả bốn: ROBOT_CONTROL_ENABLED, OT_CONTROL_ENABLED, OT_GATEWAY_ENABLED, FOE_DURABLE)`);
    // (a) notificationService chưa có `io`: KHÔNG kiểm được bằng mã sẵn có: `io` là `let io` module-level (server/services/notificationService.ts:21), không getter/export; setter duy nhất `initNotificationService` (:27), gọi ở server/_core/socket.ts:1552. Chỉ còn (c).
    // máy và chuỗi cha (CHỈ ĐỌC): machine MACHINE_Q1_PG phải là AUTOMATION, isActive, và KHÔNG có device_adapters nào trước khi ca tạo adapter stub
    const mm = rowsOf(await db.execute(sql`SELECT "machineType" AS loai, "isActive" AS act FROM machines WHERE id = ${MACHINE_Q1_PG}`))[0];
    if (!mm || String(mm.loai) !== "AUTOMATION" || mm.act !== true) hong(`machine ${MACHINE_Q1_PG} không còn là AUTOMATION đang hoạt động`);
    const nad = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM device_adapters WHERE "machineId" = ${MACHINE_Q1_PG}`))[0];
    if (!nad || num(nad.n) !== 0) hong(`machine ${MACHINE_Q1_PG} đã có ${String(nad?.n)} device_adapters (cần đúng 0 trước khi ca tạo adapter stub)`);
    const ten = rowsOf(await db.execute(sql`SELECT current_database() AS db, current_user AS usr`))[0]!;
    if (!/_test$/.test(String(ten.db))) hong(`current_database() = ${String(ten.db)}`);
    if (String(ten.usr) === "aoi") hong("đang dùng tài khoản owner aoi");
    // lượt _test 16/11 14:05 (dieu-phoi): DELETE trên một bảng không có quyền ⇒ 42501 ở bước dọn, giao dịch dọn hoàn tác, run ở lại 'running'. Kiểm quyền TRƯỚC mọi INSERT
    // Mọi bảng CA tự ghi (fixture INSERT/UPDATE, dọn DELETE) và mọi bảng ca đọc / đếm (SELECT), cùng hàm ack: chỉ đọc catalog, TRƯỚC mọi INSERT.
    // Bảng do MÃ dưới test tự ghi (notifications, ai_pending_actions, robot_motion_lock_requests, audit_logs, command_log, device_owner_changes) không kiểm INSERT ở đây: có thể đi qua trigger/hàm SECURITY DEFINER.
    const CAN_QUYEN: ReadonlyArray<readonly [string, string]> = [
      ...(["edge_nodes", "device_adapters", "device_tags", "orchestration_workflows", "orchestration_runs", "orchestration_run_steps", "orchestration_run_edge_assignments"] as const).map((b) => [b, "INSERT"] as const),
      ...(["edge_nodes", "orchestration_runs"] as const).map((b) => [b, "UPDATE"] as const),
      ...(["notifications", "ai_pending_actions", "orchestration_run_steps", "orchestration_runs", "orchestration_workflows", "device_tags", "device_adapters", "edge_nodes"] as const).map((b) => [b, "DELETE"] as const),
      ...(["machines", "stations", "production_lines", "workshops", "factories", "users", "orchestration_workflows", "orchestration_runs", "orchestration_run_steps", "orchestration_run_edge_assignments", "ai_pending_actions", "notifications", "device_adapters", "device_tags", "robot_motion_lock_requests", "audit_logs", "command_log", "device_owner_changes", "edge_stop_ack_refusals", "edge_step_authorizations", "edge_nodes"] as const).map((b) => [b, "SELECT"] as const),
    ];
    for (const [bang, quyen] of CAN_QUYEN) {
      const q = rowsOf(await db.execute(sql`SELECT has_table_privilege(current_user, ${bang}, ${quyen}) AS co`))[0];
      if (q?.co !== true) hong(`tài khoản ứng dụng không có quyền ${quyen} trên ${bang}`);
    }
    const ack = rowsOf(await db.execute(sql`SELECT count(*)::int AS n, coalesce(bool_and(has_function_privilege(current_user, p.oid, 'EXECUTE')), false) AS co FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'edge_stop_ack_edge'`))[0];
    if (!ack || num(ack.n) < 1 || ack.co !== true) hong("không có quyền EXECUTE trên public.edge_stop_ack_edge (đường ack STOP của ca)");
    const u = rowsOf(await db.execute(sql`SELECT id, role, "isActive" FROM users WHERE id = ${USER_Q1_PG}`))[0];
    if (!u || u.role !== "admin" || u.isActive !== true) hong(`user ${USER_Q1_PG} không còn là admin đang hoạt động`);
    const stub = rowsOf(await db.execute(sql`SELECT 1 AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'otprotocolenum' AND e.enumlabel = 'stub'`))[0];
    if (!stub) hong("protocol 'stub' không còn trong otprotocolenum (adapter của ca phải là stub; loopback không tồn tại trong enum)");
    const phien = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`))[0]!;
    void phien; // pool ≥ 3 kết nối RIÊNG của ca: kiểm bằng cấu hình pool của getDb (max) khi có quyền; nếu pool.max < 3 ⇒ hong("pool < 3 kết nối")
    await db.execute(sql`SET lock_timeout = '10s'`);
    // bản 8 (hình sau X-11) — SAU mọi điều kiện cứng: cờ của TIẾN TRÌNH test (không đọc .env, không phải cấu hình máy chủ), trả lại ở afterAll. Bật ⇒ lần bấm hai XẾP STOP cho nút
    // (enqueueEdgeDeviceRequest, edgeNodeCommands.ts:167-212 @ fe609ac7e: một hàng robot_motion_lock_requests); tắt ⇒ ném "unavailable" ⇒ không có hàng yêu cầu, chỉ dự phòng (commandDispatcher.ts:3426-3438).
    // Cờ chỉ được đọc lúc gọi (edgeCoordinator.ts:40-42); mã dưới ca chỉ đọc nó ở edgeNodeCommands.ts:167 (và edgeExecutionCentral.ts:156, resolveAssignableNode, không chạy trong ca)
    saved.EDGE_RUNTIME_ENABLED = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "1";
    if (!edgeRuntimeEnabled()) hong("không bật được EDGE_RUNTIME_ENABLED trong tiến trình test");
    // in bằng chứng đầu lượt
    const hash = createHash("sha256");
    for (const f of ["foeRunStore.ts", "foeEngine.ts"]) hash.update(readFileSync(path.join(__dirname, f)));
    // bản 8: hash riêng của tệp chứa hàm liệt kê (hashMa giữ nghĩa cũ: foeRunStore.ts + foeEngine.ts)
    const hashEdge = createHash("sha256").update(readFileSync(path.join(__dirname, "../../edge/edgeExecutionCentral.ts"))).digest("hex").slice(0, 16);
    // edgeRuntimeEnabled (edgeCoordinator.ts:40-42): bản 8 ca tự bật ở trên (bản 7: chỉ in; lượt 5 chạy với cờ tắt). In cờ trước khi ca đặt và sau
    // eslint-disable-next-line no-console
    console.log("Q1PG start", JSON.stringify({ ngay: new Date().toISOString(), hashMa: hash.digest("hex").slice(0, 16), hashEdge, nhan: NHAN, edgeRuntimeEnabledTruocCa: saved.EDGE_RUNTIME_ENABLED === "true" || saved.EDGE_RUNTIME_ENABLED === "1", edgeRuntimeEnabled: edgeRuntimeEnabled() }));
    void keyDir; void mkdtempSync; void writeFileSync; void rmSync; void os; void randomBytes;
  }, 60_000);

  afterAll(async () => {
    try {
      H.treo = false;
      for (const nha of H.nhaTat.splice(0)) nha();
      if (db) await donDep(db);
    } finally {
      // bản 8 — trả cờ của tiến trình về như trước ca
      if ("EDGE_RUNTIME_ENABLED" in saved) {
        if (saved.EDGE_RUNTIME_ENABLED === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
        else process.env.EDGE_RUNTIME_ENABLED = saved.EDGE_RUNTIME_ENABLED;
      }
      // in số hàng WORM đã sinh (dieu-phoi đếm rộng trước/sau)
      // eslint-disable-next-line no-console
      console.log("Q1PG WORM rows generated by this case:", JSON.stringify(soWorm));
    }
  });

  it("★ held() waits at its end gate holding the run row lock (only its URGENT hangs); an Abort pressed meanwhile answers abortUnconfirmed within 18·D and hands the owed STOP over once within 7·D while A still holds the lock, with no deadlock and nothing left behind; after X-11, once 'aborted' lands the node's listing carries the run for s9 and a second press queues s9 for the node exactly once", async () => {
    let tongWorm = 0;
    // bản 8 — giá trị của lần bấm một, giữ ra ngoài khối đo để khẳng định SAU khi đo xong hình sau X-11 (đo trước, khẳng định sau: một khẳng định đỏ không cắt mất phần đo còn lại)
    let kq1: { ok?: boolean; reason?: string; message?: string; abortStops?: { choNut?: string[]; sent?: string[]; unverified?: string[] } } | null = null;
    let t0Bam = "";
    let urgentBam1: Array<{ kind: string; dedupKey: string; title: string; treo: boolean; luc: string }> = [];
    let soUyQuyen = -1; // -1 = chưa đếm được
    let loiThan: unknown = null;
    let idsCua: Ids = { ...ids };
    let daiA: Promise<unknown> | null = null;
    try {
      const def = await dungFixture(db);
      const nguoiAbort = { id: USER_Q1_PG, role: "admin", name: "q1pg" } as never;
      const truoc = await demTatCa(db, ids.run);

      // ── ĐỐI CHỨNG của phép dò (HST 16/11), TRƯỚC phiên A, không ghi hàng nào: (âm) không ai giữ khoá ⇒ dò KHÔNG thấy khoá; (dương) một giao dịch tay giữ FOR UPDATE
      //    trên đúng hàng run ⇒ dò thấy 55P03. Chứng minh phép dò phân biệt được hai trạng thái. (Không gọi lại applyEdgeSegmentEnd ngoài giao dịch: lời gọi đó ghi 'held' và URGENT thật,
      //    tức thêm hàng ngoài danh sách và đổi trạng thái run trước phiên A.)
      const thuKhoa = async (k: ReturnType<typeof postgres>): Promise<boolean> => {
        try {
          await k.begin(async (t) => {
            await t`SET LOCAL lock_timeout = '10s'`;
            await t`SELECT id FROM orchestration_runs WHERE id = ${ids.run!} FOR UPDATE NOWAIT`;
          });
          return false;
        } catch (e) {
          if ((e as { code?: string }).code === "55P03") return true;
          throw e;
        }
      };
      {
        const dc = postgres(DB_URL, { max: 1, onnotice: () => {} });
        const giuTay = postgres(DB_URL, { max: 1, onnotice: () => {} });
        try {
          expect(await thuKhoa(dc), "đối chứng âm: không ai giữ khoá ⇒ phép dò thấy KHÔNG khoá").toBe(false);
          let nha: () => void = () => {};
          const cho = new Promise<void>((r) => (nha = r));
          const dangGiu = giuTay.begin(async (t) => {
            await t`SET LOCAL lock_timeout = '10s'`;
            await t`SELECT id FROM orchestration_runs WHERE id = ${ids.run!} FOR UPDATE`;
            await cho;
          });
          let thay = false;
          const hanDc = performance.now() + 3_000;
          while (!thay && performance.now() < hanDc) {
            thay = await thuKhoa(dc);
            if (!thay) await new Promise((r) => setTimeout(r, 50));
          }
          nha();
          await dangGiu;
          expect(thay, "đối chứng dương: giao dịch tay giữ FOR UPDATE ⇒ phép dò thấy khoá").toBe(true);
          expect(await thuKhoa(dc), "đối chứng âm sau khi nhả: phép dò lại thấy KHÔNG khoá").toBe(false);
        } finally {
          await dc.end({ timeout: 5 });
          await giuTay.end({ timeout: 5 });
        }
      }

      // ── Phiên A: kết thúc đoạn "held" như production (completeForNodeV2, edgeExecutionCentral.ts:1196-1197): `applyEdgeSegmentEnd` chạy TRONG `d.transaction(async (tx) => …)`; FOR UPDATE ở
      //    foeRunStore.ts:2139 chạy trên `tx` nên khoá giữ tới hết giao dịch, kể cả lúc held() chờ URGENT bền (:2207). Lượt _test 16/11 14:21 gọi trên POOL (autocommit) ⇒ khoá nhả ngay, biKhoa = false.
      //    Bản 6 (điều kiện 2): end mang rider với BAO_A (nút gắn rider bằng ganBaoCaoKhongRoEdge; central tách ở :2119 bằng tachBaoCaoKhongRoEdge, foeKetCucKhongRo.ts:1100-1117, đọc từng báo cáo bằng
      //    docAnomalyKhongRo :1003-1011, lọc claimSeq + baoCaoHopLe foeRunStore.ts:1943-1949). b0 = báo cáo đó (:2177) ⇒ chotTuBao.stepId = r1 (:2178) ⇒ chotId = r1 (:2205); benChot (:2206) = [daCo[0]]
      //    (loai "held", stepId r1, biet vắng) ⇒ A chờ ở :2207 tới 5·D (KET_DOAN_EDGE_TONG_MS, :733) hoặc tới khi ca nhả URGENT. Bản 5 gửi `[[A2N:[]]]` ⇒ baoKhongRo rỗng; sổ 0372 đọc được và rỗng
      //    ⇒ coTheDi rỗng (:2076, :2081) ⇒ q.chot null (:2087) ⇒ chotId undefined ⇒ benChot rỗng ⇒ A KHÔNG chờ (lượt 4).
      const loiA = ganBaoCaoKhongRoEdge("EDGE_OUTCOME_UNKNOWN(r1): sent, but the result could not be recorded (journal: journal_full) — never sent again; the run is held.", BAO_A, TRAN_LOI_EDGE);
      H.khoaTreo = `${CANH_BAO_KHONG_RO_KIND.held}:${ids.run}:r1:c1:claim${CLAIM_A}`; // dedupKey của canhBaoTuBaoCaoEdge(BAO_A[0]) (foeKetCucKhongRo.ts:1029 → :868 → :831; kind :395)
      H.treo = true;
      daiA = db.transaction(async (tx) => applyEdgeSegmentEnd(tx as never, ids.run!, {
        outcome: "held",
        heldReason: "journalFull",
        error: loiA,
        nodeCode: `N-${NHAN}`,
        claimSeq: CLAIM_A,
        def: def as never,
      } as never));
      let aXong = false;
      daiA.then(() => (aXong = true), () => (aXong = true));

      // đợi tới khi A thật sự giữ khoá: một phiên thứ ba thử NOWAIT trên đúng hàng, mong nhận lỗi 55P03 (đang bị khoá). Có hạn: tối đa 5 giây, không phụ thuộc timeout của vitest.
      const doAnh = postgres(DB_URL, { max: 1, onnotice: () => {} });
      // kết nối RIÊNG chỉ đọc clock_timestamp() (ĐỒNG HỒ DB), để mốc không xếp hàng sau pool; mọi hiệu thời gian của đại lượng chính tính TRONG SQL
      const dongHo = postgres(DB_URL, { max: 1, onnotice: () => {} });
      const gioDb = async (): Promise<string> => String((await dongHo`SELECT clock_timestamp()::text AS t`)[0]?.t);
      const msGiua = async (tu: string, den: string): Promise<number> => Number((await dongHo`SELECT (extract(epoch FROM (${den}::timestamptz - ${tu}::timestamptz)) * 1000)::float8 AS ms`)[0]?.ms);
      try {
        let biKhoa = false;
        const han = performance.now() + 5_000;
        while (!biKhoa && performance.now() < han) {
          biKhoa = await thuKhoa(doAnh); // cùng phép dò đã qua hai đối chứng ở trên
          if (!biKhoa) await new Promise((r) => setTimeout(r, 50)); // A chưa tới chỗ khoá: thử lại
        }
        expect(biKhoa, "phiên A giữ khoá hàng run").toBe(true);
        expect(aXong, "A còn đang chờ URGENT bền").toBe(false);

        // ── Phiên B: Abort (kết nối khác của pool) trong lúc A giữ khoá. Song song: vòng dò trên doAnh, mỗi ~100 ms một mốc clock_timestamp() rồi `thuKhoa` (cùng phép dò đã qua hai đối chứng)
        const doTrong: Array<{ t: string; khoa: boolean }> = [];
        let abortXong = false;
        const vongDo = (async () => {
          while (!abortXong) {
            const t = String((await doAnh`SELECT clock_timestamp()::text AS t`)[0]?.t);
            doTrong.push({ t, khoa: await thuKhoa(doAnh) });
            if (!abortXong) await new Promise((r) => setTimeout(r, 100));
          }
        })();
        vongDo.catch(() => undefined); // lỗi của vòng dò được ném lại ở `await vongDo` dưới đây; nhánh này chỉ để nó không thành unhandled rejection trong lúc Abort còn chạy
        const goiTruoc = H.goi.length;
        const t0 = await gioDb(); // ĐỒNG HỒ DB, ngay trước khi bấm
        const p0 = performance.now(); // đồng hồ tiến trình: CHỈ IN, không vào đại lượng chính
        const kq = (await abortRun(ids.run!, nguoiAbort, "q1pg: press while the hold waits").finally(() => {
          abortXong = true;
        })) as { ok?: boolean; reason?: string; status?: string; message?: string; abortStops?: unknown };
        const t1 = await gioDb(); // ĐỒNG HỒ DB, ngay sau khi Abort trả lời
        kq1 = kq as NonNullable<typeof kq1>;
        t0Bam = t0;
        const pAbort = performance.now() - p0;
        await vongDo;
        const aConCho = !aXong && (await thuKhoa(doAnh)); // SAU khi Abort trả về: A chưa xong VÀ phép dò còn thấy khoá
        const goiAbort = H.goi.slice(goiTruoc);
        urgentBam1 = goiAbort;
        const msTraLoi = await msGiua(t0, t1);
        // mốc giao STOP: robot_motion_lock_requests."createdAt" (timestamptz DEFAULT now(), 0374:390; enqueueEdgeDeviceRequest không đặt cột này, edgeNodeCommands.ts:177-191; chèn trong giao dịch ngắn :206-209 ⇒ now() = đầu giao dịch đó)
        const stopRows = rowsOf(await db.execute(sql`SELECT id, "createdAt"::text AS luc, (extract(epoch FROM ("createdAt" - ${t0}::timestamptz)) * 1000)::float8 AS ms FROM robot_motion_lock_requests WHERE "adapterId" = ${ids.adapter} AND kind = 'stop' ORDER BY id`));
        // command_log của adapter: CHỈ IN (writeRejected commandDispatcher.ts:3423, đường dự phòng :3437). "createdAt" là timestamp KHÔNG múi giờ (drizzle/schema/ot.ts:413) ⇒ không dùng làm mốc
        const cmdRows = rowsOf(await db.execute(sql`SELECT id, status, left("errorText", 160) AS loi FROM command_log WHERE "adapterId" = ${ids.adapter} ORDER BY id`));
        // eslint-disable-next-line no-console
        console.log("Q1PG do", JSON.stringify({
          t0, t1, msTraLoi, msTraLoiTienTrinh: Math.round(pAbort),
          ketQua: { ok: kq.ok ?? null, reason: kq.reason ?? null, status: kq.status ?? null, message: kq.message ?? null, abortStops: kq.abortStops ?? null },
          doTrong, aConCho,
          stop: stopRows.map((r) => ({ id: num(r.id), luc: String(r.luc), msTuBam: num(r.ms) })),
          commandLog: cmdRows,
          urgent: { khoaTreo: H.khoaTreo, trongAbort: goiAbort, tatCa: H.goi },
        }));
        // (2) A giữ khoá TRONG lúc Abort chạy và SAU khi Abort trả lời
        expect(doTrong.length, "vòng dò song song có ít nhất một lần dò trong lúc Abort chạy").toBeGreaterThanOrEqual(1);
        expect(doTrong.filter((x) => !x.khoa), "mọi lần dò trong lúc Abort chạy thấy A giữ khoá").toEqual([]);
        expect(aConCho, "A vẫn còn giữ khoá khi Abort trả lời").toBe(true);
        // (1) đối chứng của mock: đúng MỘT lần gọi bị treo, là URGENT `held` của phiên A; URGENT của Abort (abortStopNotSent; bản 8: URGENT `nut` của s9, foeEngine.ts:7160 @ fe609ac7e) không bao giờ bị treo
        expect(H.goi.filter((g) => g.treo).map((g) => g.dedupKey), "lần gọi bị treo: chỉ URGENT của phiên A").toEqual([H.khoaTreo]);
        expect(H.goi.filter((g) => g.treo && g.kind === CANH_BAO_KHONG_RO_KIND.abortStopNotSent).length, "URGENT của Abort không bị treo").toBe(0);
        // (4) chặn trên mã tự ghi (foeEngine.ts:6022-6034 @ fe609ac7e) và câu trả lời khi khoá chặn lệnh ghi 'aborted' quá D (:7277-7299, :7340-7352 @ fe609ac7e)
        expect(msTraLoi, `lệnh ghi 'aborted' bị khoá của A chặn tới hạn D (${D} ms): trả lời sau D (đồng hồ DB)`).toBeGreaterThan(D);
        expect({ ok: kq.ok, reason: kq.reason }, "khoá chặn lệnh ghi quá D ⇒ abortUnconfirmed").toEqual({ ok: false, reason: FOE_ABORT_UNCONFIRMED });
        expect(msTraLoi, `trả lời ≤ 18·D (${TRAN_TRA_LOI_MS} ms, đồng hồ DB)`).toBeLessThanOrEqual(TRAN_TRA_LOI_MS);
        // Q1-PG-STOP-TRONG-CUA-SO (HST 16/11, hình (a)): kỳ vọng theo ĐẶC TẢ (STOP nợ giao đúng một lần, ≤ 7·D). Đọc mã dự kiến ĐỎ: run chưa chốt khi Abort đọc (khoa = false, foeEngine.ts:6852 @ fe609ac7e) ⇒ s9 trên adapter
        //    của nút là `unsure`, chỉ thiếu kết nối (foeStepClass.ts:333-336 @ fe609ac7e) ⇒ không gửi từ trung tâm (:6150-6151) mà để cho nút (choNut, :7139-7141; bản 8 đo phần đó ở hình sau X-11). Đó là phát hiện, KHÔNG đổi cho xanh. expect.soft: ca vẫn chạy tiếp (thả A, pg_locks, đếm, dọn, WORM) và in mọi số
        expect.soft(stopRows.length, "Q1-PG-STOP-TRONG-CUA-SO: STOP nợ s9 đi đúng một lần (robot_motion_lock_requests kind='stop' của adapter)").toBe(1);
        expect.soft(stopRows.length > 0 ? num(stopRows[0]!.ms) : Number.NaN, `Q1-PG-STOP-TRONG-CUA-SO: giao STOP ≤ 7·D (${TRAN_GIAO_MS} ms) kể từ lúc bấm (đồng hồ DB; NaN = không có hàng)`).toBeLessThanOrEqual(TRAN_GIAO_MS);
      } finally {
        await doAnh.end({ timeout: 5 }).catch(() => undefined);
        await dongHo.end({ timeout: 5 }).catch(() => undefined);
      }

      // nhả URGENT để A kết thúc (A cũng bị chặn bởi 5·D tự nhiên): chờ có hạn
      H.treo = false;
      for (const nha of H.nhaTat.splice(0)) nha();
      const kqA = await Promise.race([daiA, new Promise((_r, rej) => setTimeout(() => rej(new Error("A did not finish within 10 s")), 10_000))]);
      // CHỈ IN: kết cục của A và trạng thái cuối của run. withDeadline chỉ thôi CHỜ lệnh ghi 'aborted' (foeEngine.ts:7277-7299 @ fe609ac7e); câu UPDATE vẫn chờ khoá trong Postgres, và khi A commit nó chạy trên
      // hàng 'held' (điều kiện NOT IN completed/failed/aborted, :7289 @ fe609ac7e) ⇒ run có thể thành 'aborted' SAU khi Abort đã trả lời abortUnconfirmed (đọc dưới đây có thể sớm hơn câu đó vài ms)
      const cuoi = rowsOf(await db.execute(sql`SELECT status, left(error, 200) AS loi, (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(coalesce("contextJson", '{}'::jsonb)) AS k) AS "khoaCtx" FROM orchestration_runs WHERE id = ${ids.run}`))[0] ?? null;
      // eslint-disable-next-line no-console
      console.log("Q1PG A and run after", JSON.stringify({ a: kqA, run: cuoi }));

      // ── Không deadlock, không khoá sót: pg_locks không còn khoá của phiên nào mang hàng run của ca
      const khoa = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'orchestration_runs' AND l.locktype = 'tuple' AND NOT l.granted`));
      expect(num(khoa[0]!.n), "không còn khoá tuple đang chờ trên orchestration_runs").toBe(0);
      // HST 16/11 (câu 3): phiên chờ ĐẦU TIÊN trên một hàng bị khoá chờ khoá `transactionid` của người giữ, không phải khoá `tuple` ⇒ phép đếm trên bỏ sót nó. Bắt mọi phiên của CSDL này đang bị
      // chặn (pg_blocking_pids, bất kể loại khoá) với câu lệnh chạm orchestration_runs
      const choTx = rowsOf(await db.execute(sql`SELECT a.pid, a.wait_event_type AS loai, left(a.query, 120) AS cau FROM pg_stat_activity a WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(a.pid)) > 0 AND a.query ILIKE '%orchestration_runs%'`));
      // eslint-disable-next-line no-console
      if (choTx.length) console.warn("Q1PG sessions still blocked on orchestration_runs:", JSON.stringify(choTx));
      expect(choTx.length, "không còn phiên nào bị chặn trên orchestration_runs (kể cả chờ khoá transactionid)").toBe(0);

      // ══ HÌNH SAU X-11 (bản 8; Y-01 dòng 28 @ a1eac8465; chốt gộp A2(n) của chủ dự án 16/11). ĐO trước (mọi số in ở dòng "Q1PG X11"), KHẲNG ĐỊNH sau. Chỉ phần TRUNG TÂM (đầu tệp: đo được / không đo được)
      const nutCa = { nodeId: ids.node!, nodeCode: `N-${NHAN}` };
      // kết nối RIÊNG cho đồng hồ DB và các phép đọc của phần này (không xếp hàng sau pool); chỉ SELECT
      const dh = postgres(DB_URL, { max: 1, onnotice: () => {} });
      const gio = async (): Promise<string> => String((await dh`SELECT clock_timestamp()::text AS t`)[0]?.t);
      const msTu = async (tu: string, den: string): Promise<number> => Number((await dh`SELECT (extract(epoch FROM (${den}::timestamptz - ${tu}::timestamptz)) * 1000)::float8 AS ms`)[0]?.ms);
      const vetAbort = async () =>
        (await dh`SELECT "stepId" AS buoc, status::text AS st, "resultJson"->>'abortStop' AS dang, "resultJson"->>'adapterNut' AS nut FROM orchestration_run_steps WHERE "runId" = ${ids.run!} AND "stepId" LIKE 'abort:%' ORDER BY "stepId"`).map((r) => ({
          buoc: String(r.buoc),
          st: String(r.st),
          dang: r.dang == null ? null : String(r.dang),
          nut: r.nut == null ? null : String(r.nut),
        }));
      const stopCua = async () =>
        (await dh`SELECT id, kind::text AS kind, "edgeNodeId" AS nut, "createdAt"::text AS luc FROM robot_motion_lock_requests WHERE "adapterId" = ${ids.adapter!} ORDER BY id`).map((r) => ({ id: num(r.id), kind: String(r.kind), nut: num(r.nut), luc: String(r.luc) }));
      type Kq2 = { ok?: boolean; status?: string; resend?: boolean; reason?: string; message?: string; abortStops?: { xepChoNut?: string[]; choNut?: string[]; sent?: string[]; failed?: string[]; pending?: string[]; unverified?: string[] } };
      let x11: {
        tThayAborted: string | null;
        msTuBamDenThayAborted: number | null;
        hetClaim: boolean[];
        vetTruocBam2: Array<{ buoc: string; st: string; dang: string | null; nut: string | null }>;
        tLiet: string;
        msTuBamDenLiet: number;
        liet: number[];
        lietNgoaiCua: number[];
        stopTruocBam2: Array<{ id: number; kind: string; nut: number; luc: string }>;
        t2: string;
        t3: string;
        msTraLoi2: number;
        kq2: Kq2;
        stopMoi: Array<{ id: number; kind: string; nut: number; luc: string }>;
        msGiao2: number;
        vetSauBam2: Array<{ buoc: string; st: string; dang: string | null; nut: string | null }>;
        urgentBam2: typeof H.goi;
        commandLogSauBam2: Array<Record<string, unknown>>;
      };
      try {
        // (5) A đã commit 'held' có chốt (dòng "Q1PG A and run after"); lệnh ghi 'aborted' của lần bấm một bị cắt ở D vẫn chờ khoá trong Postgres và áp vào sau khi A commit
        //     (withDeadline chỉ thôi chờ, boundedClose.ts:126-140; điều kiện NOT IN completed/failed/aborted, foeEngine.ts:7289 @ fe609ac7e). Chờ có hạn 5 s; mốc = đồng hồ DB lúc đọc thấy
        let tThayAborted: string | null = null;
        const han5 = performance.now() + 5_000;
        while (tThayAborted === null && performance.now() < han5) {
          const r = (await dh`SELECT status::text AS s, clock_timestamp()::text AS t FROM orchestration_runs WHERE id = ${ids.run!}`)[0];
          if (r?.s === "aborted") tThayAborted = String(r.t);
          else await new Promise((ok) => setTimeout(ok, 50));
        }
        // run không ở 'aborted' ⇒ KHÔNG bấm lần hai (đó sẽ là một Abort mới trên run 'held', ngoài hình và ngoài khung WORM): ĐỎ có tên, ca dọn ở finally
        if (tThayAborted === null) throw new Error("Q1-PG-X11-ABORTED-ROI: lệnh ghi 'aborted' của lần bấm một không áp vào trong 5 s sau khi A commit; không bấm lần hai");
        // cổng `hetClaim` của hàm liệt kê (edgeExecutionCentral.ts:379 @ fe609ac7e): assignment của ca không có token claim (fixture không đặt; GIỚI HẠN X-11 (i))
        const hetClaim = (await dh`SELECT ("claimTokenHash" IS NULL) AS het FROM orchestration_run_edge_assignments WHERE "runId" = ${ids.run!}`).map((r) => r.het === true);
        // vết lần bấm một ghi (foeEngine.ts:6986-6989, :7004 @ fe609ac7e): đọc TRƯỚC lần bấm hai (lần bấm hai ghi đè hàng này bằng recordAbortStop, :6308-6342)
        const vetTruocBam2 = await vetAbort();
        // hàm liệt kê THẬT của pull (v1 :284, v2 :918), trên pool của ca (drizzle có kiểu: finishedAt ghi và đọc cùng một đường, không lệch múi giờ); `now` mặc định = Date.now()
        const tLiet = await gio();
        const liet = (await docRunAbortCanGuiLaiStop(db as never, nutCa)).hang.map((r) => r.a.runId);
        // đối chứng cùng hàm, cùng hàng: `now` quá cửa sổ gửi lại (ABORT_RESEND_WINDOW_MS + 60 s) ⇒ SQL lọc finishedAt (:353-354, :365-366) ⇒ không liệt kê
        const lietNgoaiCua = (await docRunAbortCanGuiLaiStop(db as never, nutCa, Date.now() + ABORT_RESEND_WINDOW_MS + 60_000)).hang.map((r) => r.a.runId);

        // (6) lần bấm Abort thứ hai: run 'aborted' ⇒ resendAbortStops (foeEngine.ts:7250-7254 → :6442 @ fe609ac7e)
        const stopTruocBam2 = await stopCua();
        const goi2 = H.goi.length;
        const t2 = await gio(); // ĐỒNG HỒ DB, ngay trước lần bấm hai
        const kq2 = (await abortRun(ids.run!, nguoiAbort, "q1pg: press again")) as Kq2;
        const t3 = await gio(); // ĐỒNG HỒ DB, ngay sau khi lần bấm hai trả lời
        const msTraLoi2 = await msTu(t2, t3);
        // các lời gọi `void` của dispatcher (cảnh báo ot_stop_routed_to_edge / stop_undelivered, commandDispatcher.ts:3414, :3424) đi nốt trước khi đọc; KHÔNG vào phép đo thời gian
        await new Promise((r) => setTimeout(r, 300));
        const stopSau = await stopCua();
        const stopMoi = stopSau.filter((r) => !stopTruocBam2.some((x) => x.id === r.id));
        // mốc giao = "createdAt" (timestamptz DEFAULT now(), 0374:390) của hàng yêu cầu mới; gồm cả việc của dispatcher sau khi nhận lệnh (GIỚI HẠN X-11 (iii))
        const msGiao2 = stopMoi.length ? await msTu(t2, stopMoi[0]!.luc) : Number.NaN;
        const vetSauBam2 = await vetAbort();
        const commandLogSauBam2 = [...(await dh`SELECT id, status::text AS status, left("errorText", 200) AS loi FROM command_log WHERE "adapterId" = ${ids.adapter!} ORDER BY id`)];
        x11 = {
          tThayAborted,
          msTuBamDenThayAborted: tThayAborted === null ? null : await msTu(t0Bam, tThayAborted),
          hetClaim,
          vetTruocBam2,
          tLiet,
          msTuBamDenLiet: await msTu(t0Bam, tLiet),
          liet,
          lietNgoaiCua,
          stopTruocBam2,
          t2,
          t3,
          msTraLoi2,
          kq2,
          stopMoi,
          msGiao2,
          vetSauBam2,
          urgentBam2: H.goi.slice(goi2),
          commandLogSauBam2,
        };
      } finally {
        await dh.end({ timeout: 5 }).catch(() => undefined);
      }
      // eslint-disable-next-line no-console
      console.log("Q1PG X11", JSON.stringify({ bam1: { message: kq1?.message ?? null, choNut: kq1?.abortStops?.choNut ?? null, urgent: urgentBam1 }, ...x11 }));
      // HST 17/11 (vòng 2): câu trả lời của lần bấm hai, NGUYÊN VĂN (không qua JSON), giữa hai dấu mốc
      // eslint-disable-next-line no-console
      console.log("Q1PG X11 press 2 answer, verbatim >>>\n" + (x11.kq2.message ?? "(no message)") + "\n<<< end");

      // ── KHẲNG ĐỊNH hình sau X-11 (mọi số đã in ở trên)
      // lần bấm một: s9 để cho nút, câu (a), URGENT `nut` (foeEngine.ts:7139-7141, :7160, :7348-7349 @ fe609ac7e; foeKetCucKhongRo.ts:735)
      expect(kq1?.abortStops?.choNut, "Q1-PG-X11-BAM-MOT-CHO-NUT: lần bấm một để đúng s9 cho nút (abortStops.choNut)").toEqual(["s9"]);
      expect(kq1?.message, "Q1-PG-X11-CHU-A: câu trả lời abortUnconfirmed = NGUYÊN VĂN câu (a) của x11-chu-duyet.md (dòng 22)").toBe(chuA(ids.run!));
      const kindNo = CANH_BAO_KHONG_RO_KIND.abortStopNotSent;
      const urgNut = urgentBam1.filter((g) => g.kind === kindNo && g.dedupKey.startsWith(`${kindNo}:${ids.run}:s9:`) && g.dedupKey.endsWith(":nut"));
      expect(urgNut.length, "Q1-PG-X11-URGENT-NUT: lần bấm một nâng ĐÚNG MỘT URGENT của s9 dưới khoá riêng `nut` (foeEngine.ts:7160 @ fe609ac7e)").toBe(1);
      expect(urgNut[0]?.title ?? "", "Q1-PG-X11-URGENT-NUT: tiêu đề URGENT theo bản duyệt (x11-chu-duyet.md dòng 66)").toContain("STOP s9 left to the edge node, NOT confirmed");
      // (5) 'aborted' rơi vào; nút không giữ claim; vết s9 mang cờ nút; hàm liệt kê THẬT liệt kê run, đối chứng ngoài cửa sổ thì không
      expect(x11.tThayAborted, "Q1-PG-X11-ABORTED-ROI: lệnh ghi 'aborted' của lần bấm một áp vào sau khi A commit (đọc thấy trong 5 s)").not.toBeNull();
      expect(x11.hetClaim, "Q1-PG-X11-HET-CLAIM: assignment của run không có token claim (điều kiện hetClaim)").toEqual([true]);
      expect(x11.vetTruocBam2, "Q1-PG-X11-VET: vết duy nhất của lần bấm một là abort:s9 failed / chuaXacMinh / adapterNut (chưa xác nhận)").toEqual([{ buoc: "abort:s9", st: "failed", dang: "chuaXacMinh", nut: "true" }]);
      expect(x11.liet, "Q1-PG-X11-LIET-KE: sau lần bấm đầu, không bấm lại, hàm liệt kê của pull liệt kê run cho nút của ca (STOP s9 của adapter nút được giao cho lượt quét của nút)").toEqual([ids.run]);
      expect(x11.lietNgoaiCua, "Q1-PG-X11-LIET-KE-DOI-CHUNG: cùng hàm, cùng hàng, now quá cửa sổ 15 phút ⇒ không liệt kê").toEqual([]);
      // (6) lần bấm hai: resend, s9 xếp cho nút ĐÚNG MỘT lần, câu (d), chặn trên thời gian
      expect({ ok: x11.kq2.ok, status: x11.kq2.status, resend: x11.kq2.resend }, "Q1-PG-X11-BAM-HAI: lần bấm hai là resend của run đã aborted").toEqual({ ok: true, status: "aborted", resend: true });
      expect(x11.kq2.abortStops?.xepChoNut, "Q1-PG-X11-BAM-HAI-XEP-CHO-NUT: abortStops.xepChoNut = [s9] (foeEngine.ts:7073 @ fe609ac7e)").toEqual(["s9"]);
      expect(x11.stopMoi.map((r) => ({ kind: r.kind, nut: r.nut })), "Q1-PG-X11-BAM-HAI-XEP-MOT: lần bấm hai xếp s9 cho nút của ca ĐÚNG MỘT lần (một hàng robot_motion_lock_requests kind='stop' của adapter)").toEqual([{ kind: "stop", nut: ids.node }]);
      expect(x11.msGiao2, `Q1-PG-X11-BAM-HAI-GIAO: giao STOP ≤ 7·D (${TRAN_GIAO_MS} ms) kể từ lần bấm hai (đồng hồ DB; NaN = không có hàng)`).toBeLessThanOrEqual(TRAN_GIAO_MS);
      expect(x11.msTraLoi2, `Q1-PG-X11-BAM-HAI-TRA-LOI: trả lời ≤ 18·D (${TRAN_TRA_LOI_MS} ms, đồng hồ DB)`).toBeLessThanOrEqual(TRAN_TRA_LOI_MS);
      const msg2 = x11.kq2.message ?? "";
      expect(msg2.startsWith(chuD(ids.run!)), `Q1-PG-X11-CHU-D: câu trả lời lần bấm hai mở đầu bằng NGUYÊN VĂN câu (d) của x11-chu-duyet.md (dòng 60); nhận được: ${msg2.slice(0, 400)}`).toBe(true);
      // phần sau câu (d): fixture có r2 / c1 là set_value, KHÔNG phải lệnh của máy AUTOMATION (capabilityModel.ts:365-372, :398) ⇒ commandOf null (foeStepClass.ts:156-163) ⇒ có thể thêm câu
      // "Could not be verified as a pinned STOP: r2, c1 …" (foeEngine.ts:6407 @ fe609ac7e). Câu đó không phải về s9: chỉ khẳng định không câu nào sau (d) nhắc lại s9
      expect(msg2.slice(chuD(ids.run!).length), "Q1-PG-X11-CHU-D-SAU: phần sau câu (d) không nhắc lại s9").not.toMatch(/\bs9\b/);
      // HST 17/11 (vòng 2): đuôi theo ĐẶC TẢ = đúng một câu, danh sách [r2, c1]. Chép tay từ chỗ mã dựng nó, foeEngine.ts:6407 @ fe609ac7e (không gọi hàm của mã):
      //   `Could not be verified as a pinned STOP: ${chuaXacMinh.join(", ")}: not sent; a later press${chuaKhoa || chuaXacMinh.some((id) => pl[id]?.lop === "xong") ? ` within ${phut} minutes of ${MOC_CUA_SO}` : ""} sends it if its read finds a pinned STOP.`
      //   vế "within …" vắng: chuaKhoa = false (chuBamLai gọi với hai đối số, :6476) và r2/c1 không có lớp trong phanLoai (khoá chỉ từ v.ids, plan.send, noDaBen, daDinh, :6962) ⇒ không `xong`.
      //   Nối bằng một dấu cách (`cau.join(" ")`, :6422). Trước nó trong chuBamLai không còn câu nào: conBen bỏ s9 vì xep (:6398-6399), khongBen / pending / choNut rỗng ở lần bấm này.
      // expect.soft (đọc mã thấy CÓ THỂ đỏ): ở run đã chốt, lapKeHoachStop (foeEngine.ts:1616-1631 @ fe609ac7e) coi một bước là settled chỉ khi không "hong" (hàng failed) và không "đã giao mà chưa
      //   xác nhận" (:1618, :1629). r1 là bước bị chốt (set_value, commandOf null như r2/c1); nếu hàng r1 sau A là failed hoặc tính là đã giao chưa xác nhận thì r1 cũng vào unverified
      //   (planAbortSweep :6150-6151) ⇒ danh sách có thể là [r1, r2, c1]. c1 có trong kế hoạch vì r1 là bước chốt (chuDenHan :1604-1610, bù trừ :6199-6203). Không đổi kỳ vọng cho xanh: in và báo
      // LƯỢT 6 (8b8a1064e): ĐỎ, đuôi thật " Could not be verified as a pinned STOP: r1, r2, c1: not sent; a later press sends it if its read finds a pinned STOP." Nguyên nhân là FIXTURE
      //   (DO-64 vòng 3, mục 11): r1 / r2 / c1 là `set_value`, máy AUTOMATION không có lệnh đó (capabilityModel.ts:365-372, :398) ⇒ commandOf null (foeStepClass.ts:156-163) ⇒ classify đưa vào
      //   unverified (foeEngine.ts:6149-6151) mỗi khi walk tới bước đó; ở run đã chốt r1 KHÔNG settled vì đã giao mà chưa xác nhận (:1629, daGiao :6869 đọc routedTo của hàng r1 fixture). Định
      //   nghĩa thật không thể có lệnh đó (validateWorkflow, workflowModel.ts:524-537). Sửa fixture nhỏ nhất (để dành lần chạy sau, KHÔNG làm ở bản này): `command: "set_value"` của `ot()`
      //   ⇒ `"set_machine_param"` (capabilityModel.ts:208); khi đó đuôi theo đặc tả là RỖNG (r1 / r2 / c1 phân giải được, không phải STOP ⇒ không vào danh sách, :6154-6155).
      const DUOI_THEO_DAC_TA = " Could not be verified as a pinned STOP: r2, c1: not sent; a later press sends it if its read finds a pinned STOP.";
      expect.soft(msg2.slice(chuD(ids.run!).length), "Q1-PG-X11-CHU-D-DUOI: phần sau câu (d) đúng là câu 'Could not be verified …' với [r2, c1] (foeEngine.ts:6407 @ fe609ac7e)").toBe(DUOI_THEO_DAC_TA);
      expect(msg2, "Q1-PG-X11-CHU-D-KHONG-TU-CHOI: không có 'refused or not answered: s9' (s9 giao cho nút không phải bị từ chối)").not.toMatch(/refused or not answered: [^.]*\bs9\b/);

      // ── Đếm: hàng sinh ra lúc chạy, và hàng WORM
      // seam kiểm: số hàng notifications DO CA TẠO (nối bằng entityType/entityId) ≤ 7 và MỌI hàng có userId = 2841; vượt số hoặc sai user thì ĐỎ (bắt trường hợp seam không ăn)
      const nt = rowsOf(await db.execute(sql`SELECT id, "userId" AS uid FROM notifications WHERE ("entityType" = 'orchestration_run' AND "entityId" = ${ids.run}) OR ("entityType" = 'ot_command' AND "entityId" = ${ids.adapter})`));
      expect(nt.length, `notifications do ca tạo (${nt.length}) vượt 7: seam người nhận không ăn`).toBeLessThanOrEqual(7);
      expect(nt.filter((r) => num(r.uid) !== USER_Q1_PG).length, "mọi hàng notifications của ca phải có userId = 2841").toBe(0);
      const sau = await demTatCa(db, ids.run);
      const them = hieu(truoc, sau);
      soUyQuyen = sau["edge_step_authorizations"] ?? 0;
      // eslint-disable-next-line no-console
      console.log("Q1PG rows before / after (per table):", JSON.stringify({ truoc, sau }));
      // eslint-disable-next-line no-console
      console.log("Q1PG rows written during the case (per table):", JSON.stringify(them));
    } catch (err) {
      loiThan = err; // giữ lỗi của THÂN ca: lỗi dọn không được che nó (lượt _test 16/11 14:05)
      throw err;
    } finally {
      // nhả URGENT của A (nếu thân ca đỏ trước khi nhả) và chờ A có hạn TRƯỚC khi dọn: lệnh dọn UPDATE hàng run sẽ đợi khoá của A
      H.treo = false;
      for (const nha of H.nhaTat.splice(0)) nha();
      if (daiA) await Promise.race([daiA.catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
      idsCua = { ...ids };
      try {
        await donDep(db); // MỌI đường thoát, kể cả khi ca đỏ
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Q1PG cleanup error (the case body error, if any, is rethrown instead):", (err as Error)?.message ?? err);
        if (loiThan === null) throw err;
      }
      // WORM: đếm TUYỆT ĐỐI theo id mới của ca (run / adapter là id serial mới ⇒ mọi hàng khớp là của ca), SAU dọn (dọn có thể ghi edge_stop_ack_refusals); in cả khi thân ca đỏ
      try {
        for (const d of DAU) if (d.worm) soWorm[d.bang] = num(rowsOf(await db.execute(d.dem(idsCua.run, idsCua)))[0]?.n ?? 0);
        tongWorm = Object.values(soWorm).reduce((a, b) => a + b, 0);
        // lượt 5 (16/11 15:39): `details` là TEXT (drizzle/schema/system.ts:22, "JSON string"), không phải jsonb ⇒ `details->>'operation'` lỗi 42883. In nguyên chữ (cắt 200), không ép kiểu: chữ có thể không phải JSON hợp lệ
        const auditCua = idsCua.run == null ? [] : rowsOf(await db.execute(sql`SELECT id, action, status, left(details, 200) AS "chiTiet" FROM audit_logs WHERE "entityType" = 'orchestration_run' AND "entityId" = ${idsCua.run} ORDER BY id`));
        // eslint-disable-next-line no-console
        console.log("Q1PG audit rows of the case (action / status / details):", JSON.stringify(auditCua));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Q1PG WORM count error:", (err as Error)?.message ?? err);
        if (loiThan === null) throw err;
      }
    }
    expect(soUyQuyen, "edge_step_authorizations rows of the case run after the case (avi_app cannot delete them; not in Y-01)").toBe(0);
    // sau dọn: số hàng XOÁ ĐƯỢC của ca về 0; hàng WORM ở lại ≤ 8 ở bản 8 (đếm tuyệt đối ở finally, gồm hàng device_owner_changes do INSERT adapter của fixture, 0374:328-330)
    const conLai: Record<string, number> = {};
    for (const d of DAU) if (!d.worm) conLai[d.bang] = num(rowsOf(await db.execute(d.dem(idsCua.run, idsCua)))[0]?.n ?? 0);
    // eslint-disable-next-line no-console
    console.log("Q1PG rows of the case left after cleanup (non-WORM):", JSON.stringify(conLai), "deviceLeftover:", thietBiConLai);
    const THIET_BI = new Set(["edge_nodes", "device_adapters", "device_tags", "robot_motion_lock_requests", "notifications(ot_command)"]);
    // eslint-disable-next-line no-console
    if (thietBiConLai) console.warn("Q1PG LEFTOVER ids (ack failed; Y-01 bad case, not force-deleted):", JSON.stringify({ node: idsCua.node, adapter: idsCua.adapter, tag: idsCua.tag }));
    for (const [bang, n] of Object.entries(conLai)) if (!(thietBiConLai && THIET_BI.has(bang))) expect(n, `rows of the case left in ${bang} after cleanup`).toBe(0);
    // bản 8 — hình sau X-11: trần 8 và khung từng bảng của Y-01 dòng 28 @ a1eac8465 (bảng dự kiến: tam/do64-bao-cao.md mục 2). Lệch khung ⇒ KHÔNG CHẠY ĐƯỢC THEO Y-01: báo HST, không nới
    expect(tongWorm, "WORM rows generated by the case, counted absolutely by its new ids (Y-01: the figure after X-11, ceiling 8)").toBeLessThanOrEqual(8);
    expect(soWorm["audit_logs"] ?? -1, "WORM audit_logs of the case run (Y-01 frame 4–5)").toBeGreaterThanOrEqual(4);
    expect(soWorm["audit_logs"] ?? 99, "WORM audit_logs of the case run (Y-01 frame 4–5)").toBeLessThanOrEqual(5);
    expect(soWorm["command_log"], "WORM command_log of the case adapter (Y-01 frame 1)").toBe(1);
    expect(soWorm["device_owner_changes"], "WORM device_owner_changes of the case adapter (Y-01 frame 1)").toBe(1);
    expect(soWorm["edge_stop_ack_refusals"] ?? 99, "WORM edge_stop_ack_refusals of the case adapter (Y-01 frame 0–1)").toBeLessThanOrEqual(1);
  }, 120_000);
});
