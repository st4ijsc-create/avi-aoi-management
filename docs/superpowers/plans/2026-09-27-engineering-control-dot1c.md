# Kế hoạch thực thi — Đợt 1C "Quyết định chủ dự án" (sau Đợt 1B + Đợt 1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task là brief yêu cầu + nghiệm thu; implementer đọc mã tại chỗ.

**Goal:** Thực thi các quyết định chủ dự án chốt ngày 2026-09-27, trả lời các câu hỏi mở ở doc 80 §13 và doc 81 §7.

**Architecture:** Siết cổng an toàn và cổng dữ liệu theo nguyên tắc fail-closed. Tái dùng các helper đã có: `safetyPreflightPolicy`, `otActionBinding`/`robotPayloadHash`, cổng recipe `assertRecipeReleasable` với tham số policy, `ingestRangBuoc`, và bộ ACL MQTT.

**Spec:** quyết định của chủ dự án (nguyên văn, 2026-09-27):
1. "Có/OK": SIM safety-PLC KHÔNG được thoả preflight đối với đích đã commission.
2. "CÓ": áp cổng recipe chặt cho `recordRecipeLoad`, `changeover.approve` và phân phối recipe set.
3. "Đóng": lệnh robot `hitl` không có actionId.
4. Bốn mục nhỏ:
   - a. `copilotGenerate` KHÔNG khoá thêm MOD_AI.
   - b. CÓ allowlist thiết bị cho khoá gateway.
   - c. ĐÓNG đường MQTT cho phép ghi sensor/telemetry chéo máy.
   - d. "tìm hiểu nguyên nhân và fix, lệch 24h là có vấn đề": giữ luật loại mẫu `ts` lệch quá 24 h, đồng thời tìm và sửa gốc gây lệch giờ.

Nguồn chi tiết cho từng mục: doc 80 §13, doc 81 §7, và các ledger `.superpowers/sdd/2026-09-27-engineering-control-dot1b/progress.md` và `…-dot1/progress.md`.

**Ruling của bộ điều phối** (không có trong quyết định, đã chốt để chạy):
- Docker HEALTHCHECK chuyển sang `/readyz`. Lý do: Docker chỉ đánh dấu container unhealthy chứ không tự khởi động lại, nên healthcheck nên nói thật khi DB sập. Probe liveness của k8s vẫn giữ `/health`.

## Global Constraints

Áp y nguyên Global Constraints của `docs/superpowers/plans/2026-09-27-engineering-control-dot1b.md` (điểm 1–11), cộng thêm:

12. **Census là dụng cụ đo.** Sửa đúng thứ census đếm, hoặc khai báo / ghim lại theo đúng quy trình của chính census đó, kèm ghi chú có ngày. Không được né bằng cách đổi tên tệp hay chuyển sang import động.
13. **Không đụng `server/_core/index.ts` về số dòng** (có census ghim số dòng). Mọi thay đổi ở đó phải trung hoà số dòng.
14. **Migration.** Chỉ được thêm migration khi task ghi rõ "được phép". Khi đó phải:
    - đánh số tiếp theo theo quy ước repo;
    - chỉ áp lên DB `_test`;
    - ghi rõ trong báo cáo lệnh cần chạy trên DB dev để chủ dự án/Kỹ thuật tự áp.
15. **Không dùng `git worktree`** (lệnh này treo trong repo này).

## Review Focus

1. **Siết cổng làm chặn oan đường hợp lệ.** Ví dụ: máy chưa commission vẫn phải chạy mô phỏng như cũ; gateway nằm trong allowlist vẫn ghi được. Mỗi task phải có test cho đường hợp lệ.
2. **Nhánh kia của chỗ vá.** OT và robot phải cùng một luật SIM. REST và MQTT phải cùng một luật chéo máy.
3. **Lệch giờ.** Sửa chuỗi thời gian naive không có múi giờ ở một nơi mà bỏ sót nơi khác. Phải grep toàn bộ đường ingest.

---

## Task 1: SIM safety-PLC không thoả preflight cho đích đã commission (+ tag chất lượng xấu ⇒ UNKNOWN)

Tệp: `server/services/ot/adapterFacade.ts` (`getSafetyStatus`), `server/services/ot/safetyPreflightPolicy.ts`, `server/services/ot/commandDispatcher.ts`, `server/services/robot/robotCommandDispatcher.ts`, `server/services/safety/safetyPlcAdapter.ts`, `server/services/safety/safetySourceHealth.ts`, và panel Safety.

Yêu cầu:
- **Đường ghi/chuyển động thật** (đích đã commission, không mô phỏng): preflight chỉ tính là OK khi:
  - có ít nhất một cấu hình safety-PLC có backend hiệu lực là `real` (tức endpoint thật và có ít nhất một tag an toàn được gán) và đọc sạch;
  - không cấu hình nào đọc ra BLOCKED.

  Kết quả chỉ đến từ `sim_empty`, `sim_scripted` hoặc `real_unmapped` ⇒ coi là `UNKNOWN` ⇒ chặn, với lý do `SAFETY_SIM_ONLY`. Lý do này dùng chung một từ vựng cho cả OT lẫn robot; lấy phân loại từ `safetySourceHealth` (hàm `effectiveBackend`) để tránh hai định nghĩa song song.
- **Đường mô phỏng / chưa commission:** giữ nguyên hành vi hiện tại, byte-identical.
- **Tag an toàn đọc ra chất lượng xấu** (`safetyPlcAdapter.ts:183`, hiện đang để trống ⇒ OK): với backend `real`, coi là `UNKNOWN`. Đây là lỗ cùng loại với SIM.
- **Panel `safety.sourceHealth`:** hiển thị luật mới, nói rõ "đích đã commission cần safety-PLC THẬT có gán tag".

Nghiệm thu:
- Test DB `_test`, chạy cả OT và robot:
  - chỉ có SIM + đích commission ⇒ bị chặn `SAFETY_SIM_ONLY`, driver giả 0 lần gọi;
  - `real` đã gán tag, đọc sạch ⇒ cho qua;
  - trộn `real` + SIM, trong đó `real` đọc lỗi ⇒ chặn;
  - `real` đọc tag chất lượng xấu ⇒ chặn;
  - đích chưa commission ⇒ vẫn mô phỏng như cũ.
- Đột biến từng lớp.

## Task 2: Cổng recipe chặt cho recordRecipeLoad, changeover.approve, phân phối recipe set

Tệp: `server/db/machineRecipe.ts` (policy của `deployRecipe`), `server/services/equipment/recipeVersioningService.ts` (`recordLoad`), `server/routers/machineRecipeRouter.ts` (`changeover.approve`), `server/services/equipment/recipeSetService.ts`, các UI liên quan, i18n.

Yêu cầu:
- Ba caller trên chuyển từ policy `legacyApprovedOnly` sang `strict`: phải đã duyệt, không archived (trừ rollback có bằng chứng bị thay thế, luật Task 9 Đợt 1), đúng loại máy nếu biết.
- **Recipe set** đang ghim một phiên bản đã bị thay thế ⇒ phân phối bị từ chối ở từng mục, với lý do rõ ràng (i18n) và gợi ý "cập nhật set sang phiên bản hiện hành". UI của set phải hiện được lý do này.
- `changeover.approve`: trả mã lỗi đúng (`PRECONDITION_FAILED` kèm reason), không gộp thành `BAD_REQUEST`.
- `recordRecipeLoad` (hiện chỉ cần `canCreate`): khi `deploy:true`, đòi mức quyền bằng đường deploy chặt, tức sàn vai actuation (`actuationProcedure` hoặc tương đương). Ghi rõ quyền cũ và quyền mới trong báo cáo.

Nghiệm thu:
- Test theo từng caller: phiên bản đã rút ⇒ bị từ chối; sai loại máy ⇒ bị từ chối; phiên bản hợp lệ ⇒ chạy.
- Set ghim phiên bản đã bị thay thế ⇒ từng mục bị từ chối kèm lý do.
- Test quyền cho `recordRecipeLoad` (deploy).
- Đột biến.

## Task 3: Đóng robot `hitl` không có actionId

Tệp: `server/services/robot/robotCommandDispatcher.ts`, `server/routers/vda5050Router.ts`, `server/services/equipment/vda5050Adapter.ts`, `ros2Bridge` (grep), cùng các test đang ghim hợp đồng cũ của Task 5 Đợt 1B (13 test).

Yêu cầu:
- `triggerKind: "hitl"` mà không có actionId ⇒ từ chối `PRECONDITION_FAILED`, reason `HITL_ACTION_REQUIRED`, trước bất kỳ byte nào gửi xuống thiết bị. Lệnh STOP/abort không bao giờ bị chặn.
- `vda5050Router`: người vận hành bấm ⇒ chuyển sang `triggerKind: "manual"`, `confirmedBy` = user của phiên (luật R11).
- `vda5050Adapter` / `ros2Bridge`: đường tự động phải tạo pending action gắn hash (`robotPayloadHash`) theo mẫu FOE; nếu không tạo được thì bị từ chối. Liệt kê mọi caller.
- Cập nhật 13 test đang ghim hợp đồng cũ, ghi rõ từng test đổi kỳ vọng thế nào.

Nghiệm thu: `hitl` không actionId ⇒ bị từ chối, driver 0 byte; manual từ router ⇒ chạy; đường tự động có action gắn hash ⇒ chạy đúng một lần; đột biến.

## Task 4: Allowlist thiết bị cho khoá gateway (IOT_GATEWAY)

Tệp: `server/_core/otIngestRoute.ts`, `server/api/v1/ingestRangBuoc.ts`, và nơi quản lý máy gateway (grep `IOT_GATEWAY`, UI quản lý máy/khoá).

Yêu cầu:
- Khoá của máy loại `IOT_GATEWAY` chỉ được ghi cho các thiết bị nằm trong allowlist của gateway đó, ở cả `/api/ot/ingest` lẫn `/api/v1/ingest/*`. Thiết bị ngoài allowlist ⇒ 403 cho cả lô, không ghi dòng nào. Mỗi mẫu được ghim `machineId` của thiết bị đích đã được phép.
- **Lưu allowlist:** ưu tiên cột JSON có sẵn (grep `machines` metadata/config). Chỉ khi không có cột phù hợp mới thêm migration (được phép theo Global Constraint 14). Có UI hoặc tRPC để admin/engineer sửa allowlist, có audit.
- **Allowlist rỗng** ⇒ gateway không ghi được gì. Đây là fail-closed, và báo cáo phải ghi rõ hệ quả với các gateway đang chạy.

Nghiệm thu: test DB `_test` cho cả hai route: thiết bị trong list ⇒ ghi được; ngoài list ⇒ 403, 0 dòng; list rỗng ⇒ 403. Test audit khi sửa allowlist. Đột biến.

## Task 5: Đóng MQTT ghi sensor/telemetry chéo máy + subscribe rộng

Tệp: `server/services/mqttService.ts` (`authorizePublish` / `authorizeSubscribe`, cầu telemetry), và phần ingest PdM của `factory/+/+/sensor/+`.

Yêu cầu:
- `factory/{fId}/{machineCode}/sensor/*`: chỉ nhận khi thiết bị MQTT đã xác thực được gắn với đúng máy đó và nhà máy đó. Ràng buộc thiết bị ↔ máy đọc từ `mqtt_clients` hoặc cơ chế có sẵn. Ngoài phạm vi ⇒ từ chối publish, log được gộp.
- Cầu telemetry: `asset_id` trong payload phải khớp máy của thiết bị đã xác thực. Lệch ⇒ loại mẫu và đếm.
- Subscribe `factory/#` và `syn/#`: thiết bị chỉ được subscribe nhánh của máy/nhà máy mình. Client nội bộ của server không bị ảnh hưởng.
- Thiết bị chưa gắn máy ⇒ không publish được `factory/.../sensor`.

Nghiệm thu: test broker thật chạy cổng 0: publish chéo máy bị từ chối và DB không có dòng; đúng máy thì ghi được; subscribe rộng bị từ chối; client nội bộ vẫn chạy. Đột biến.

## Task 6: Lệch giờ — tìm gốc và sửa (giữ luật loại mẫu lệch quá 24 h) + Docker HEALTHCHECK

Nguồn: bộ nhớ dự án `postgresjs-timestamp-naive-lech-7h` (còn 7 câu chưa vá: `db/machine.ts:119`, `twinCanh.ts`, `oeeService.ts` ×3 tại 786/1026/1555, `warRoomService.ts:378`); `new Date(ts)` naive ở `server/api/v1/router.ts:153` và `server/_core/otIngestRoute.ts:61` (BG-96/99); đồng hồ server chạy CMOS không đồng bộ (việc O2 của Kỹ thuật).

Yêu cầu:
- **Đo trước khi sửa:**
  - Trong DB dev, chỉ SELECT: có bao nhiêu mẫu gần đây bị loại vì `ts` lệch về tương lai, theo nguồn/thiết bị. Nếu có số đếm `droppedFutureSkew` trong log/metric thì dùng; không có thì ước lượng bằng truy vấn.
  - Đo độ lệch hiện tại giữa đồng hồ server và NTP: `w32tm /stripchart /computer:time.windows.com /samples:3 /dataonly`, chỉ đọc.
  - Ghi toàn bộ số đo vào báo cáo.
- **Chuỗi thời gian không có múi giờ trên đường ingest:** định nghĩa một luật duy nhất, tái dùng helper BG-99 có sẵn (grep `fakeUtcCensus` và helper parse thời gian máy). Chọn MỘT trong hai và ghi rõ lựa chọn:
  - (a) từ chối, reason `ts_no_timezone`;
  - (b) diễn giải theo múi giờ nhà máy đã cấu hình.
  
  Áp cho mọi cửa ingest (grep toàn repo). Cập nhật `fakeUtcCensus` một cách trung thực.
- **Vá 7 truy vấn −7 h** theo mẫu đã vá trong bộ nhớ dự án, có test so với DB `_test`.
- **Thêm số đo lệch giờ theo thiết bị:** thống kê lệch trung vị/tối đa theo `deviceId`/`machineId` ở `storeForward.getStatus()` hoặc một endpoint chỉ đọc, để vận hành biết thiết bị nào lệch.
- **Docker:** `Dockerfile` và các `docker-compose*.yml` chuyển HEALTHCHECK sang `/readyz`. Probe liveness của k8s/Helm giữ `/health`.

Nghiệm thu: test từng cửa ingest với chuỗi naive, `Z` và offset; test 7 truy vấn; test số đo lệch; báo cáo có số đo trước/sau; đột biến.
