/**
 * Sprint 5 §4 — registry MÃ LỖI máy-đọc-được.
 *
 * File này KHÔNG import gì để client dùng lại được kiểu mà không kéo theo tRPC
 * server. Thêm mã mới ⇒ thêm vào đây TRƯỚC, tsc sẽ bắt mọi chỗ gõ sai.
 *
 * Quy ước đặt tên: DANH_TỪ_TÌNH_HUỐNG, không nêu tên router (mã phải dùng lại
 * được ở nhiều router — đó chính là lý do có nó).
 */
export const APP_ERROR_CODES = [
  // ── 9 họ phổ quát (§4.1) ──────────────────────────────────────────────────
  "DB_UNAVAILABLE",
  "ENTITY_NOT_FOUND",     // params: { entity }
  "ENTITY_DUPLICATE",     // params: { entity } — KHÔNG có `field`: không template i18n nào
                          // render {{field}} cho mã này. Đợt di trú trước quảng cáo `field?`
                          // trong comment này nhưng không ai từng hiện thực template — 12 chỗ
                          // gọi đã trót truyền field vô ích, dọn ở Task 4 (F5, doc 71).
  "SCOPE_MISMATCH",       // params: { entity, parent }
  "FIELD_REQUIRED",       // params: { field }
  "INVALID_VALUE",        // params: { field, reason? } — Task 5 (doc 71, F4) đã thêm `reason?`
                          // THẬT: khoá client `errors.INVALID_VALUE_WITH_REASON` (có {{reason}})
                          // chỉ được dùng khi `params.reason` là chuỗi khác rỗng — câu GỐC
                          // `errors.INVALID_VALUE` (không đổi) vẫn phục vụ mọi call site cũ chưa
                          // truyền `reason`. `reason` PHẢI là khoá camelCase vào `errors.reason.*`
                          // (client/src/lib/errorCodes.ts), KHÔNG phải câu tiếng Việt/Anh viết tay.
  "FEATURE_DISABLED",     // params: { feature }
  "OPERATION_FAILED",     // params: { operation, reason? } — cùng cơ chế `reason?` với
                          // INVALID_VALUE ở trên (khoá `_WITH_REASON` riêng, xem doc 71 Task 5).
  "PERMISSION_DENIED",    // params: { action, reason? } — `action` vẫn BẮT BUỘC (cổng
                          // appErrorParamsCoverage.test.ts); `reason?` thêm ở Task 5 (doc 71) khi
                          // cần nói THÊM (vd tên quyền cụ thể cần có) ngoài tên action.
  "AUTH_REQUIRED",        // params: {} — chưa đăng nhập (ctx.user null), KHÁC FIELD_REQUIRED
                          // (không phải thiếu một trường nhập) và KHÁC FEATURE_DISABLED.
                          // Task 7 fix round 1 (I-1).
  "TWO_FACTOR_NOT_SET_UP", // params: { reason? } — 2FA CHƯA BẬT cho TÀI KHOẢN này, KHÁC
                          // FEATURE_DISABLED (2FA đang bật toàn hệ thống, chỉ tài khoản này
                          // chưa dùng). Task 7 fix round 1 (I-2).
                          //
                          // Task 5 (doc 71, F4) BAN ĐẦU khôi phục "Vào Cài đặt > Bảo mật để
                          // thiết lập" bằng cách enrich THẲNG câu TĨNH `errors.TWO_FACTOR_NOT_SET_UP`
                          // — SAI: reviewer round 1 (M-5) chỉ ra 6 call site KHÔNG đồng nhất ý
                          // định. 4/6 (defectDispositionRouter.ts, twoFactorRouter.ts verify() +
                          // regenerateBackupCodes(), userRouters.ts verify2FA()) đúng là "cần bật
                          // 2FA để tiếp tục" ⇒ chỉ dẫn "đi thiết lập" hợp lý. NHƯNG 2/6
                          // (twoFactorRouter.ts disable(), userRouters.ts disable2FA()) là người
                          // dùng đang TẮT 2FA — bảo họ "đi thiết lập" NGƯỢC Ý ĐỊNH. Đã trả câu
                          // TĨNH về nguyên bản (không chỉ dẫn) + dùng `reason?: "setUpInSecuritySettings"`
                          // (khoá `TWO_FACTOR_NOT_SET_UP_WITH_REASON`) CHỈ ở đúng 4 call site cần.
  "RATE_LIMITED",         // params: {} — vượt hạn mức thao tác (per-IP/per-machine throttle).
                          // Task 8 — gộp 3+ nơi ném TOO_MANY_REQUESTS rải rác (hierarchyRouters
                          // register/claimKey throttle, machineApiRouters heartbeat). Chi tiết
                          // hạn mức (đơn vị/giờ hay /phút khác nhau tuỳ nơi) giữ ở fallbackMessage,
                          // không đưa vào template vì không có 1 đơn vị chung cho mọi nơi gọi.
  "ACCOUNT_LOCKED",       // params: { remainingMinutes } — khoá brute-force ĐANG hiệu lực, KHÁC
                          // RATE_LIMITED (throttle thao tác) và KHÁC PERMISSION_DENIED (thiếu
                          // quyền) — đây là tài khoản, tạm thời, có thời hạn cụ thể. Review cuối
                          // (đợt sửa cuối, ca I-A #2): server/routers.ts:265 từng gộp nhầm vào
                          // RATE_LIMITED, "ít phút" nói giảm so với 15 phút thật.
  "ACCOUNT_DISABLED",     // params: {} — tài khoản bị admin vô hiệu hoá (users.isActive=false),
                          // KHÁC PERMISSION_DENIED (thiếu quyền — đi xin quyền là sai hướng, tài
                          // khoản này cần được kích hoạt lại, không phải cấp thêm quyền). Review
                          // cuối, ca I-A #3: server/routers.ts:268 từng gộp vào PERMISSION_DENIED.
  "FEATURE_NOT_CONFIGURED", // params: { feature } — tính năng KHÔNG có công tắc bật/tắt, chỉ
                          // thiếu cấu hình bắt buộc (biến môi trường/URL bên ngoài) — KHÁC
                          // FEATURE_DISABLED (có công tắc, ai đó tắt nó). Review cuối, ca I-A #5:
                          // licenseRouter.ts 12 chỗ dùng FEATURE_DISABLED cho LICENSE_SERVER_URL
                          // thiếu — không có công tắc nào để "bật" cho người dùng đi bật.
  "MUST_CHANGE_PASSWORD", // params: {} — Pha 7 / I-4. Tài khoản đang bị BUỘC ĐỔI MẬT KHẨU (Task 8
                          // xoay bí mật trên 8/8 tài khoản vì bí mật cũ đã lộ) nên MỌI thủ tục trừ
                          // tập tối thiểu (đăng nhập · đọc danh tính mình · đổi mật khẩu · đăng
                          // xuất) bị từ chối. KHÁC ACCOUNT_LOCKED (khoá brute-force có thời hạn —
                          // người dùng chỉ có thể CHỜ; ở đây họ có một hành động cụ thể làm được
                          // NGAY và cửa ấy đang mở), KHÁC ACCOUNT_DISABLED (phải nhờ admin bật
                          // lại — ở đây tự gỡ được), và KHÁC PERMISSION_DENIED (đi xin quyền là
                          // sai hướng: quyền không thiếu, chỉ mật khẩu cần đổi). Không mã nào
                          // trong registry mô tả đúng lối thoát, nên tách như ENTITY_EXPIRED đã
                          // tách khỏi ENTITY_NOT_FOUND.
  "ENTITY_EXPIRED",       // params: { entity } — bản ghi CÓ TỒN TẠI nhưng đã quá hạn lưu trữ/hiệu
                          // lực, KHÁC ENTITY_NOT_FOUND (chưa từng có/đã bị xoá). Review cuối, ca
                          // I-A #9: reportArtifactRouter.ts gộp nhánh 'expired' vào ENTITY_NOT_FOUND.

  // ── BG-126 (Khối C, "nợ còn mở", 2026-09-05) ─────────────────────────────
  "CHANGE_REASON_RESERVED_PREFIX", // params: { field } — chuỗi lý do NGƯỜI DÙNG
                          // gõ (changeReason/reason/comment) khớp CHÍNH tiền tố
                          // CẤU TRÚC `[VARIANT:<id>]` (RE_TIEN_TO_VERSION_BIEN_THE,
                          // server/db/product.ts) mà `recordVariantOverrideVersion`
                          // dùng để đánh dấu hàng version của MỘT BIẾN THỂ, không
                          // phải của điểm BASE — snapshot-gate (napLichSuGioiHanTheoDiem/
                          // loadPointLimitSnapshots) LỌC BỎ hàng mang tiền tố này
                          // khi tái dựng cho một điểm BASE. Người dùng gõ đúng
                          // chuỗi đó (vô tình hay cố ý) làm snapshot BASE của họ
                          // VÔ HÌNH với cổng đó. KHÁC INVALID_VALUE (không phải
                          // sai KIỂU/miền giá trị — chuỗi vẫn hợp lệ về mặt zod,
                          // vấn đề là nó GIẢ một tín hiệu nội bộ).

  // ── Nạp tri thức (KB) — Task 3 ────────────────────────────────────────────
  "KB_FILE_TOO_LARGE",        // params: { limitMb }
  "KB_UNSUPPORTED_TYPE",      // params: { ext, supported }
  "KB_CONTENT_TYPE_MISMATCH", // params: { claimed, detected }
  "KB_PARSE_FAILED",          // params: {} — reason chỉ ở fallbackMessage (I-1a, xem kbErrors.ts)
  "KB_NO_TEXT_EXTRACTED",     // params: { source }
  "KB_FETCH_FAILED",          // params: { url } — reason có thể rò IP nội bộ, chỉ log server (I-1b)

  // ── Task 10 (doc71, F3) — xác thực MÁY (server/services/machineAuthService.ts) ──
  "MACHINE_CREDENTIAL_INVALID", // params: { reason? } — khoá/mã máy trình lên KHÔNG hợp lệ
                          // (sai/thu hồi/hết hạn/không thuộc máy/không phải khoá máy) — KHÁC
                          // AUTH_REQUIRED (chưa đăng nhập — đây LÀ một lượt "đăng nhập" bằng khoá
                          // máy, chỉ là khoá sai) và KHÁC ACCOUNT_LOCKED/ACCOUNT_DISABLED (hai mã
                          // đó dành cho TÀI KHOẢN NGƯỜI, không phải khoá máy tự động). Không mã nào
                          // trong 24 mã trên khớp — machine credential là một khái niệm riêng
                          // (server_api_keys.machineId), không phải RBAC người dùng.

  // ── Pha 2B Task 4 (§5.3) — TỪ CHỐI TRUNG THỰC khi xin VRAM ────────────────
  "VRAM_REFUSED",         // params: { owner, priority, requestedMb, availableMb, holders,
                          // preemptable, preemptableMb, reason?, … } — sổ VRAM từ chối một lượt
                          // cấp phát. KHÁC FEATURE_DISABLED/FEATURE_NOT_CONFIGURED (tính năng vẫn
                          // bật và cấu hình đủ — chỉ là hết chỗ NGAY LÚC NÀY, thử lại sau có thể
                          // được) và KHÁC OPERATION_FAILED (thao tác không "hỏng": nó bị TỪ CHỐI
                          // có chủ đích, kèm đủ bốn thứ §5.3 để người vận hành tự gỡ được).
                          // `holders`/`preemptable` đi qua không gian từ điển `errors.list.*`
                          // (client/src/lib/errorCodes.ts) để danh sách RỖNG hiện ra "không có"
                          // đúng ngôn ngữ thay vì một chỗ trống.
  "VRAM_HEADROOM_UNKNOWN", // params: như trên NHƯNG KHÔNG có `availableMb` — dư địa KHÔNG tính
                          // được (`computeHeadroom` fail-closed: `headroomBytes = -Infinity` +
                          // lý do `"invalid-input"`, xem server/services/vram/vramHeadroom.ts).
                          // TÁCH khỏi VRAM_REFUSED vì câu "còn {{availableMb}} MiB" ở đó buộc ta
                          // hoặc in `-Infinity` hoặc BỊA một con số — cả hai đều là nói dối người
                          // vận hành; cùng lý do ENTITY_EXPIRED được tách khỏi ENTITY_NOT_FOUND.
  "VRAM_SLOT_CAP",        // params: như VRAM_REFUSED + `slotsNeeded` — byte VỪA nhưng HẾT KHE
                          // model GGUF (GGUF_MAX_LOADED_MODELS, cửa ĐẾM Đ4). TÁCH khỏi
                          // VRAM_REFUSED vì câu ở đó ("xin 1.000 MiB, còn 25.000 MiB") **tự mâu
                          // thuẫn** trong ca này: nó vừa khai còn thừa 25 GB vừa nói không đủ, rồi
                          // đổ cho độ tin cậy của một con số hoàn toàn đúng ⇒ người trực đi tìm
                          // lỗi ở chỗ không có lỗi. Cách gỡ cũng khác hẳn: **nhả một model**, không
                          // phải tìm thêm byte (review TOÀN NHÁNH, I-3).
  // ── F14 (2026-08-22) — LỖI ĐI RA BẰNG CỬA "THÀNH CÔNG" ────────────────────
  // Hai mã dưới đây KHÔNG dùng với `appError()` (không có gì được ném): chúng là
  // `errorCode` trong PHẢN HỒI 200 OK của các thủ tục dò kết nối. Lý do phải có mã
  // riêng thay vì dịch chuỗi driver: chuỗi ấy (`"ModbusDriver: not connected"`,
  // `"ECONNREFUSED 10.0.0.5:502"`) là thứ KỸ SƯ cần, còn NGƯỜI VẬN HÀNH cần biết
  // "không tới được thiết bị" bằng tiếng của họ. Trả CẢ HAI, không đánh đổi.
  "DEVICE_UNREACHABLE",   // params: { entity: protocol } — nối tới thiết bị không được
                          // (từ chối, quá hạn, driver báo chưa kết nối). Người vận hành
                          // xử được: kiểm dây/nguồn/IP. KHÁC ENTITY_NOT_FOUND (adapter CÓ
                          // trong CSDL — chỉ là không nói chuyện được với nó).
  "DEVICE_PROTOCOL_UNSUPPORTED", // params: { entity: protocol } — bản dựng này không có
                          // driver cho giao thức đó. TÁCH khỏi DEVICE_UNREACHABLE vì cách
                          // gỡ NGƯỢC nhau: một cái đi kiểm dây, cái kia phải đổi cấu hình
                          // hoặc nâng cấp — bảo người vận hành đi ngắt cầu dao vì lý do
                          // thứ hai là làm mất thời gian của họ.

  // ── doc 81 Đợt 1E Task 1 fix round 1 (review I-1, plan Global Constraint 3) ──
  "OT_COMMAND_SUPERSEDED_BY_STOP", // params: { stopKey } — KHÔNG ném: `DispatchResult.appError`
                          // của một lệnh OT đang CHỜ trong hàng đợi per-adapter bị HUỶ vì một lệnh
                          // DỪNG ghim xếp sau nó (ruling R-1E-a; reason `SUPERSEDED_BY_STOP`).
                          // KHÁC BUSY (không làm gì, thử lại sau) và KHÁC OPERATION_FAILED (thiết bị
                          // không hỏng): hệ thống ĐÃ BỎ lệnh của người vận hành, họ phải GỬI LẠI nếu
                          // còn cần — đúng điều mà dòng "cost if wrong" của ruling dựa vào. `stopKey`
                          // = khoá idempotency của lệnh DỪNG (truy vết; câu i18n không nội suy nó).
  "OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY", // no params — doc 81 Đợt 4 final wave G9: như trên nhưng lệnh DỪNG
                          // KHÔNG có khoá idempotency ⇒ câu không có phần "(khoá)" (trước: chữ "unknown" lọt vào câu vi/zh).
  "OT_STOP_UNVERIFIED_QUEUE_FULL", // no params — doc 81 Đợt 11 ruling R-11-o (I-1): KHÔNG ném: `DispatchResult.appError` của
                          // một lệnh "stop" CHƯA XÁC MINH (không phải DỪNG ghim) bị TỪ CHỐI vì danh sách chờ chỗ của adapter đã đủ
                          // (hàng đợi đầy + đã có OT_STOP_UNVERIFIED_WAIT_MAX lệnh như vậy chờ). Không gửi gì; người vận hành phải
                          // dùng DỪNG ghim (hoặc E-STOP của máy). KHÁC BUSY (một DỪNG không bao giờ được bảo "thử lại sau").
  "OT_COMMAND_QUEUE_EXPIRED", // no params — SCADA R1a Task 5 (K9): KHÔNG ném: `DispatchResult.appError` của một lệnh OT THƯỜNG đã chờ
                          // trong hàng đợi per-adapter quá hạn (deadlineMs của lệnh, mặc định 60 s) trước khi tới lượt (reason
                          // `QUEUE_EXPIRED`). Không gửi gì tới thiết bị; người vận hành gửi lại nếu còn cần. DỪNG không bao giờ hết hạn.

  // ── SCADA R1a Task 8 (K1/K5) — từ chối lệnh ghi tag từ HMI (`scadaCommands.request`, server/services/scada/lenhHmi.ts) ──
  // MỌI lời từ chối mang thêm `ma` (= scada_command_attempts.reason_code: CHANNEL_READ_ONLY, OFF_STEP, …) để M5 chọn câu/hành động
  // mà không phải đoán từ appCode. Không mã chung nào nói đúng cách gỡ: kênh chỉ đọc ≠ giá trị sai ≠ máy LOCAL ≠ người khác đang giữ.
  "SCADA_CHANNEL_READ_ONLY",       // params: { ma, tagKey } — kênh không nhận lệnh ghi (input / calculated / writable=false).
  "SCADA_VALUE_TYPE_MISMATCH",     // params: { ma, tagKey, dataType } — giá trị không ép được về kiểu của kênh.
  "SCADA_VALUE_OUT_OF_RANGE",      // params: { ma, tagKey, min, max } — min/max "—" khi không khai cận đó.
  "SCADA_VALUE_OFF_STEP",          // params: { ma, tagKey, step, goiY } — lệch bước; goiY CHỈ là gợi ý, không tự làm tròn.
  "SCADA_VALUE_OFF_STEP_NO_HINT",  // params: { ma, tagKey, step } — như trên, không có điểm lưới nào trong dải để gợi ý.
  "SCADA_ROLE_FLOOR",              // params: { ma, level } — vai của người gọi dưới sàn của mức tác động kênh.
  "SCADA_TOTP_NOT_ENROLLED",       // params: { ma, level } — kênh mức 4–5 cần 2FA mà tài khoản chưa đăng ký. KHÁC
                                   // TWO_FACTOR_NOT_SET_UP: áp BẤT KỂ AUTH_2FA_BAT_BUOC (D5), câu nói rõ là do mức kênh.
  "SCADA_EDGE_NOT_SUPPORTED",      // params: { ma, edgeCode } — adapter do edge sở hữu; HMI trung tâm chưa ra lệnh qua edge (R1c).
  "SCADA_MACHINE_NOT_REMOTE",      // params: { ma, lyDo } — máy không ở REMOTE (lyDo = LyDoCheDo của cheDoMay, M5 dịch riêng).
  "SCADA_TAG_SELECTED_BY_OTHER",   // params: { ma, boiUserId, boiTen, hetHanLuc } — người khác đang giữ khoá chọn kênh (K6).
  "SCADA_REQUEST_ALREADY_HANDLED", // params: { ma } — clientRequestId đã dùng cho yêu cầu đã xử lý / hết hạn / lệnh khác.
  // ── SCADA R1a Task 9 (K1/K6/K8/K9) — từ chối bước 2 `scadaCommands.confirm` (cùng quy ước `ma`) ──
  "SCADA_REQUEST_EXPIRED",         // params: { ma } — yêu cầu quá TTL 60 s (HET_HAN); tạo yêu cầu mới.
  "SCADA_SELECTION_LOST",          // params: { ma } — khoá chọn kênh đã mất (KHOA_MAT: hết hạn / yêu cầu mới hơn / người khác).
  "SCADA_TOTP_REQUIRED",           // params: { ma, level } — kênh mức 4–5 cần mã TOTP (TOTP_CAN); yêu cầu GIỮ, nhập mã rồi xác nhận lại.
  "SCADA_TOTP_INVALID",            // params: { ma, level } — mã TOTP sai / sai định dạng / đã dùng (TOTP_SAI); yêu cầu GIỮ.
  "SCADA_AI_LEVEL_TOO_HIGH",       // params: { ma, level } — trợ lý AI KHÔNG BAO GIỜ ra lệnh mức tác động ≥ 4 (MUC_QUA_CAO ở copilot.confirmAction); từ chối vĩnh viễn, hàng giữ nguyên.
  "SCADA_MACHINE_REBOUND",         // params: { ma } — adapter đã gán sang máy khác sau request (MAY_DA_DOI); tạo yêu cầu mới.
  // ── SCADA R1b-1 Task 2 — STOP HMI một bước (`scadaCommands.dungMay`) ──
  "SCADA_STOP_NOT_PINNED",         // params: { ma } — máy không có adapter bật nào mang tag ghim giá trị DỪNG (CHUA_GHIM_STOP): không gửi gì;
                                   // kỹ sư ghim ở /scada/config/channels, dừng bằng E-STOP cứng.
  "SCADA_STOP_PINS_HIGH_LEVEL",    // params: { ma, soTag, tagKeys } — kiem-dinh R1b-1 H1 (b): máy CÓ ghim nhưng MỌI ghim nằm trên tag mức tác
                                   // động > 1 (GHIM_MUC_CAO) ⇒ STOP HMI không gửi gì; khai mức 1 cho tag dừng, dừng bằng E-STOP cứng.
  // ── kiem-dinh P1-2 (2026-10-24) — đổi cấu hình kênh / chế độ M12 (scadaKenh.capNhat, cheDo.dat, cheDo.go) đòi TOTP TƯƠI mỗi lượt.
  "SCADA_CONFIG_TOTP_REQUIRED",    // params: { ma } — thiếu mã TOTP (TOTP_CAN); nhập mã 6 số rồi lưu lại.
  "SCADA_CONFIG_TOTP_INVALID",     // params: { ma } — mã TOTP sai / sai định dạng / đã dùng (TOTP_SAI); chờ mã mới rồi lưu lại.
  "SCADA_CONFIG_TOTP_NOT_ENROLLED",// params: { ma } — tài khoản chưa đăng ký 2FA (TOTP_CHUA_DANG_KY) ⇒ không đổi được cấu hình kênh.
  // ── SCADA R1a Task 12 (M12, điều phối mục 4 + review T3 M-3) — NHẤT QUÁN lúc cấu hình giữa khai báo kênh (loại / dải / bước) và giá trị
  // đã cam kết sẽ ghi xuống kênh đó (server/services/scada/nhatQuanKenh.ts). `ma` = chính mã; `lyDo` = kết cục của cổng kênh
  // (CHANNEL_READ_ONLY | TYPE_MISMATCH | OUT_OF_RANGE | OFF_STEP); min/max/step "—" khi không khai cận đó.
  "STOP_PIN_NGOAI_DAI",            // params: { ma, lyDo, tagKey, stopValue, min, max, step, goiY } — giá trị DỪNG ghim không ghi được trên kênh theo
                                   // khai báo (khai dải/bước/loại kênh khi đã ghim, hoặc ghim ngoài dải đang khai). Gỡ / đổi ghim hoặc khai lại.
                                   // R1b-2a T2 (m4, K17): cả ghim lệch lưới thô trên tag int CHƯA khai; step = lưới vừa trượt (write_step hoặc |scale|),
                                   // goiY = giá trị hợp lệ gần nhất ("—" khi không có) — MỌI nơi phát qua nhatQuanKenh.thamSoNgoaiDaiStopPin.
  "INTERLOCK_NGOAI_DAI",           // params: { ma, lyDo, tagKey, min, max, step, goc, goiY, ruleId? } — commandValue của luật interlock (đang bật, khi
                                   // khai kênh; hoặc luật đang tạo/sửa/duyệt/bật) không ghi được trên kênh đích ⇒ hành động bảo vệ sẽ bị từ chối.
                                   // R1b-1 T9: cả khi deviceAdapter.tags.update / mappingAsCode.applyImport đổi dataType/writable/scale/offset của tag đích.
                                   // R1b-1 T13 polish m1: lyDo OFF_STEP ⇒ step = bước vừa trượt (write_step hoặc |scale|), goc = gốc lưới (write_min ?? 0 hoặc
                                   // offset), goiY = giá trị hợp lệ gần nhất; còn lại goc / goiY = "—" (thamSoNgoaiDaiInterlock).
  // ── SCADA R1b-1 Task 9 — trỏ lại tag (server/services/scada/troLaiKenh.ts) ──
  "INTERLOCK_MAT_DICH",            // params: { ma, tagKey, ruleId } — đổi tên / chuyển adapter / tắt / xoá tag mà một luật interlock ĐANG BẬT ghi
                                   // lệnh lên ⇒ hành động bảo vệ mất đích. Sửa đích của luật (hoặc tắt luật) trước.
                                   // R1b-1 T10b (m1): cả khi chuyển adapter sang máy khác mà tag của nó là đích / nguồn của luật đang bật.
  "INTERLOCK_DICH_CHUA_SAN_SANG",  // params: { ma, lyDo, tagKey, ruleId } — R1b-1 T10b: interlock.enable luật không phải alert mà tag đích không tồn
                                   // tại / đang tắt / adapter đích tắt, hoặc tag nguồn telemetry_tag ĐÃ KHAI trên máy nhưng tắt (lyDo: dich_khong_ton_tai |
                                   // dich_tat | adapter_dich_tat | nguon_tat). Nguồn không tag thiết bị nào khai ⇒ cho bật (đường DB, fix round 1 I-1).
  "INTERLOCK_NGUON_MO_HO",         // params: { ma, lyDo: "nguon_mo_ho", tagKey, ruleId, soAdapter } — R1b-1 T10b fix round 1 (M-2): interlock.enable luật
                                   // telemetry_tag mà >1 adapter bật của máy cùng mang tag nguồn ⇒ cổng mo_ho mãi. Bỏ trùng trước.
  "STOP_PIN_GO_TRUOC",             // params: { ma, tagKey, stopValue } — fix round 1 (phán quyết T9 b): tag ĐÃ KHAI đang ghim DỪNG mà lượt này đổi định
                                   // nghĩa dây (address/scale/offset/dataType/writable/adapterId), tắt hoặc xoá tag ⇒ gỡ ghim trước (thao tác riêng có lý do).
  "QUA_NHIEU_KENH_DA_KHAI",        // params: { soTag, toiDa } — một lô import trỏ lại quá `toiDa` (200) tag đã khai kênh; chia nhỏ file.
  // ── SCADA R1a Task 16 — BỘ ĐẾM TOTP SAI theo người dùng (server/_core/totpKhoaSai.ts, gọi từ verifyTotpOnce ⇒ MỌI bên gọi TOTP) ──
  "TOTP_TAM_KHOA",                 // params: { remainingMinutes } (+ { ma, level } ở SCADA/copilot) — 5 lần sai / 5 phút ⇒ TOTP khoá 5 phút.
                                   // ⚠ KHÔNG BAO GIỜ mang số lần sai còn lại (điều phối 2026-10-24). KHÁC ACCOUNT_LOCKED (khoá mật khẩu).
  "TOTP_KHONG_KIEM_DUOC",          // no params (+ { ma, level } ở SCADA/copilot) — bộ đếm không hỏi/ghi được DB ⇒ từ chối (fail-closed).
  "MA_DU_PHONG_TAM_KHOA",          // params: { remainingMinutes } — fix round 1: bộ đếm MÃ DỰ PHÒNG riêng (10 lần / 60 phút ⇒ từ chối tới hết giờ ấy),
                                   // trong `db.verifyBackupCode`. ĐỘC LẬP với TOTP_TAM_KHOA. Không bao giờ mang số lần sai.
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Tham số nội suy vào câu i18n. Chỉ nhận nguyên thuỷ — không nhét object/lỗi
 *  vào đây, nó đi thẳng ra client và có thể lộ nội bộ. */
export type AppErrorParams = Record<string, string | number>;
