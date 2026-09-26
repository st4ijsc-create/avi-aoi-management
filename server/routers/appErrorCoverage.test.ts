/**
 * Sprint 5 §4.4 — CỔNG CHẶN HỒI QUY.
 *
 * "Di trú toàn bộ router" chỉ là lời hứa nếu không có gì đo nó. Test này đếm số
 * chỗ còn ném `new TRPCError` trực tiếp (chưa qua appError) và so với một ngân
 * sách GIẢM DẦN. Mỗi đợt di trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ router mới
 * không thể lặng lẽ thêm nợ. Đợt cuối hạ về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy:
 * bạn vừa thêm một câu lỗi không dịch được cho người dùng Việt Nam. Dùng
 * appError() thay vì new TRPCError().
 *
 * Số đo tại thời điểm tạo cổng (task 4, sau khi task 3 đã di trú kbIngestRouter.ts
 * + kbStudioRouter.ts, 13 chỗ): 1043 chỗ `new TRPCError` trong 117 file
 * (loại `.test.ts`). Tự đo lại bằng:
 *   grep -rno "new TRPCError" server/routers --include=*.ts | grep -v "\.test\.ts" | wc -l
 *
 * ⚠⚠ PHẠM VI CHÍNH XÁC (đính chính ở đợt sửa cuối — C-1, review toàn cục):
 * MỌI khẳng định trong file này chỉ đo `new TRPCError` — TỨC LÀ chỉ bắt lỗi ném
 * bằng constructor tRPC trực tiếp. **Nó KHÔNG ĐO và KHÔNG BAO PHỦ
 * `throw new Error(...)`** — tRPC v11 đặt `message = opts.message ?? cause?.message
 * ?? code`, nên MỘT `throw new Error("Database not available")` (hay bất kỳ chuỗi
 * tiếng Anh viết tay nào khác qua `new Error`) vẫn đi NGUYÊN VẸN tới client, y hệt
 * trước khi có sprint này — cổng ở trên không nhìn thấy nó, và trước đợt sửa cuối
 * này KHÔNG có gì đo nó cả. "Không còn câu tiếng Anh không dịch được" và "không còn
 * `new TRPCError` trong `server/routers/`" là HAI TUYÊN BỐ KHÁC NHAU — nhầm giữa
 * hai điều đó là gốc rễ của C-1. Cổng `ALLOWED_RAW_ERROR_THROWS` ở dưới đóng đúng lỗ
 * hổng THỨ HAI đó (đo `throw new Error(`), một ngân sách RIÊNG, KHÔNG cộng dồn với
 * `ALLOWED_LEGACY_THROWS` — hai họ lỗi độc lập, hai cách sửa khác nhau.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_LEGACY_THROWS = 0; // ← task 8 lô 7/N (CUỐI) — 16 file còn lại chỉ 1 chỗ mỗi file
// (aiEvalRouter/aiInspectionAnalyticsRouter/aiQualityGateRouter/aiRobotAnomalyRouter/
// bootstrapRouter/commissioningRouter/edgeDeploymentRouter/hotFolderRouter/masterDataRouter/
// mqttOeeRouters/mqttSoftwareVersionRouter/operatorBadgeRouter/readinessRouter/rumRouter/
// sitesRouter/statusTemplateRouters — 16 chỗ): 16 - 16 = 0.
//
// ⚠ PHẠM VI CHÍNH XÁC của con số 0 này (đính chính sau review round 1, I-2 —
// câu tuyên bố gốc "mọi TRPCError hướng-người-dùng đều qua appError()" NÓI QUÁ):
// cổng này (test walkTsFiles ở trên) chứng minh **`server/routers/**` + 2 khẳng định
// riêng bên dưới** (`server/_core/dbErrors.ts` + `server/routers.ts`) đã sạch —
// KHÔNG PHẢI toàn bộ ứng dụng. Review round 1 quét thật `server/**` (trừ `.test.ts`,
// trừ chính `appError.ts` — nơi dựng lỗi) và tìm thấy **64 chỗ còn lại trong 13 file**
// `_core`/`services`/`utils` CHƯA di trú (đính chính đợt sửa cuối — số đúng đo được là
// 64/13, không phải 67/14 như bản nháp ban đầu của round 1), cố ý để ngoài phạm vi
// Task 8 (hạ tầng lõi + security-critical, không nên sửa vội cuối một task lớn) —
// danh sách đầy đủ 13 file × số chỗ nằm trong task-8-report.md mục "Fix round 1". Tự
// đo lại bằng:
//   grep -rno "new TRPCError(" server --include=*.ts | grep -v "\.test\.ts" | grep -v "^server/routers/" | grep -v "appError\.ts:" | wc -l
//
// ⚠⚠ Và, tách bạch rất quan trọng (gốc của C-1, xem docstring đầu file): con số này
// — cũng như ALLOWED_LEGACY_THROWS ở trên — đo **`new TRPCError`**, KHÔNG đo
// **"còn câu tiếng Anh không dịch được cho người dùng"**. `throw new Error(...)`
// (75 chỗ trong `server/routers/**`, xem ALLOWED_RAW_ERROR_THROWS bên dưới) không hề
// đi qua `new TRPCError` nhưng message của nó vẫn tới thẳng client — hai cổng đo hai
// thứ khác nhau, cả hai đều cần để nói đúng "sạch cái gì".

const ROUTERS_DIR = dirname(fileURLToPath(import.meta.url));

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkTsFiles(full)); continue; }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function countLegacyThrows(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsFiles(ROUTERS_DIR)) {
    const n = (readFileSync(file, "utf8").match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) { byFile.push([file.replace(ROUTERS_DIR, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("phủ mã lỗi trong server/routers", () => {
  it(`còn tối đa ${ALLOWED_LEGACY_THROWS} chỗ ném TRPCError trực tiếp`, () => {
    const { total, byFile } = countLegacyThrows();
    if (total > ALLOWED_LEGACY_THROWS) {
      // In ra file nặng nhất để đợt sau biết bắt đầu từ đâu.
      console.error("[phủ mã lỗi] còn nợ ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_LEGACY_THROWS);
  });

  it("ngân sách KHÔNG được nới rộng hơn thực tế — số dư thừa che mất nợ mới", () => {
    // Ngân sách phải bám SÁT số thật. Nếu nó cao hơn thực tế, ai đó thêm một
    // `new TRPCError` mới sẽ lọt qua cổng mà không ai biết — cổng hoá vô dụng.
    // (Sửa so với brief gốc: bản gốc assert `total >= 0`, luôn đúng, không
    // kiểm gì. Bám sát bằng `toBe` mới thật sự là ngân sách.)
    const { total } = countLegacyThrows();
    expect(ALLOWED_LEGACY_THROWS).toBe(total);
  });

  it("không còn `new TRPCError({...message: 'Database not available'/...})` nào trong router", () => {
    // Task 5 đợt 1 (§4.5 đợt 1) đã di trú toàn bộ 209 chỗ `throw new
    // TRPCError({ code, message: "Database not available"/"DB not
    // available"/"Database not connected"/"...unavailable" })` sang
    // appError(code, "DB_UNAVAILABLE", undefined, message).
    //
    // ⚠⚠ ĐÍNH CHÍNH TÊN (đợt sửa cuối, C-1 — review toàn cục): tên cũ của khẳng định
    // này là "không còn chuỗi 'Database not available' thô nào bị NÉM (throw) trong
    // router" — SAI, vì nó ngụ ý bao phủ MỌI cách ném ra chuỗi đó, kể cả qua
    // `throw new Error(...)`. Thực tế regex dưới đây CHỈ soi trong ngữ cảnh
    // `new TRPCError({…message:…})` — nó mù hoàn toàn với `throw new Error("Database
    // not available")` (31 chỗ đo được trong `server/routers/**` ở đợt sửa cuối, xem
    // ALLOWED_RAW_ERROR_THROWS bên dưới — tiền tồn tại, không phải hồi quy của sprint
    // này). Tên mới nói đúng phạm vi: chỉ `new TRPCError`, không phải "mọi cách ném".
    //
    // ⚠ Regex SIẾT theo ngữ cảnh `new TRPCError({...` (không chỉ khớp
    // `message:` trần) — khác bản brief gốc. Lý do: server/routers/alertRouters.ts:53
    // có `return { breached, currentValue, message: "Database not available" }`
    // — đây là GIÁ TRỊ TRẢ VỀ của evaluateAlertSetting (đọc bởi scheduler +
    // endpoint test thủ công), KHÔNG phải lỗi ném ra, nên bị loại khỏi đợt di
    // trú (đổi nó là đổi kiểu trả về/hành vi, ngoài phạm vi "một mã, một
    // chuỗi, cơ học"). Regex trần `message:\s*["'\`](Database|DB) ...` sẽ báo
    // dương tính giả ở đúng dòng đó. Regex dưới đây chỉ bắt khi "message:" nằm
    // trong context `new TRPCError({` (bán kính 120 ký tự) — đúng thứ Step 7
    // muốn kiểm: throw thô còn sót, không phải bất kỳ field "message" nào.
    //
    // appError(..., "Database not available") truyền chuỗi ở vị trí tham số
    // thứ 4 dạng gọi hàm — không có "message:" — nên cũng không bị bắt nhầm.
    const rawThrowRe = /new TRPCError\(\{[\s\S]{0,120}?message:\s*["'`](?:Database|DB) (?:not available|not connected|unavailable)["'`]/gi;
    let hits = 0;
    const offenders: string[] = [];
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      const n = (src.match(rawThrowRe) ?? []).length;
      if (n > 0) { hits += n; offenders.push(file.replace(ROUTERS_DIR, "")); }
    }
    if (hits > 0) console.error("[phủ mã lỗi] còn throw thô ở:", offenders);
    expect(hits).toBe(0);
  });

  it("server/_core/dbErrors.ts (withDbErrors/rethrowDbError) không còn ném TRPCError trần", () => {
    // Task 8 (§4.5 đợt 4) — reviewer Task 7 chỉ ra một lỗ hổng trong chính tuyên bố
    // "cổng phủ toàn bộ": walkTsFiles ở trên CHỈ quét server/routers, nhưng ~24
    // call-site `withDbErrors()`/`rethrowDbError()` rải khắp router (componentLibrary/
    // hierarchy/kbStudio/masterData/process/product/system) đều đổ về MỘT điểm ném
    // duy nhất — server/_core/dbErrors.ts — NẰM NGOÀI đường quét đó. Cổng có thể về 0
    // (mọi router "sạch") trong khi helper dùng chung vẫn ném `new TRPCError` thô, và
    // KHÔNG THỬ NGHIỆM nào ở trên bắt được việc đó. Khẳng định riêng này đóng đúng lỗ
    // hổng: đọc thẳng file, đếm ký tự "new TRPCError(" — phải bằng 0 sau khi Task 8 di
    // trú rethrowDbError() sang appError("CONFLICT", "ENTITY_DUPLICATE", ...).
    const dbErrorsPath = join(ROUTERS_DIR, "..", "_core", "dbErrors.ts");
    const src = readFileSync(dbErrorsPath, "utf8");
    const n = (src.match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) console.error(`[phủ mã lỗi] dbErrors.ts còn ${n} chỗ new TRPCError trần`);
    expect(n).toBe(0);
  });

  it("server/routers.ts (đường đăng nhập + bootstrap admin) không còn ném TRPCError trần", () => {
    // Fix round 1 (I-2b, review điều phối viên) — cùng dạng lỗ hổng như dbErrors.ts:
    // `server/routers.ts` NẰM NGOÀI server/routers/ (tên trùng thư mục nhưng là file
    // anh em cùng cấp `server/`), nên walkTsFiles ở trên KHÔNG BAO GIỜ quét tới nó dù
    // nó chứa route `auth.login` (mapping LoginError → tRPC code) và `auth.setupAdmin`
    // — hai đường người dùng thật gặp NHIỀU NHẤT trong toàn ứng dụng. Task 8 đã di trú
    // 3 chỗ ở đây; khẳng định riêng này đảm bảo không ai âm thầm thêm throw thô mới mà
    // cổng không biết.
    const routersTsPath = join(ROUTERS_DIR, "..", "routers.ts");
    const src = readFileSync(routersTsPath, "utf8");
    const n = (src.match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) console.error(`[phủ mã lỗi] routers.ts còn ${n} chỗ new TRPCError trần`);
    expect(n).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Đợt sửa cuối (C-1, review toàn cục) — NGÂN SÁCH THỨ HAI, độc lập với
// ALLOWED_LEGACY_THROWS ở trên.
//
// C-1 phát hiện: describe() ở trên chỉ đo `new TRPCError` — nó KHÔNG NHÌN THẤY
// `throw new Error(...)`. tRPC v11 đặt `message = opts.message ?? cause?.message ??
// code`, nên một `throw new Error("Database not available")` trong `server/routers/**`
// vẫn đưa nguyên chuỗi tiếng Anh đó tới client, y hệt trước khi có sprint mã-lỗi này —
// người dùng Việt Nam vẫn đọc đúng câu mà loạt này tuyên bố đã xoá sổ.
//
// Đo được ở `server/routers/**` (trừ `.test.ts`) tại thời điểm đợt sửa cuối:
//   grep -rno "throw new Error(" server/routers --include=*.ts | grep -v "\.test\.ts" | wc -l
//   → 75 chỗ trong 20 file (31 trong số đó là biến thể "Database/DB not available/not
//   connected/unavailable" — cùng họ câu mà cổng ALLOWED_LEGACY_THROWS/DB_UNAVAILABLE
//   đã xoá sổ ở phía `new TRPCError`, nhưng còn nguyên ở phía `new Error`).
//
// ⚠ TOÀN BỘ 75 chỗ này là NỢ TIỀN TỒN TẠI — không phải hồi quy của đợt sửa cuối, và
// KHÔNG phải việc của đợt sửa cuối để di trú (đó là một đợt quét riêng, cùng cơ học
// "một mã, một chuỗi" như Task 4-8 nhưng nhắm `new Error` thay vì `new TRPCError`).
// Việc CỦA đợt sửa cuối là làm cho cổng ĐO ĐƯỢC món nợ này, để nó không tiếp tục lớn
// lên trong im lặng — cổng dưới đây hoạt động y hệt ALLOWED_LEGACY_THROWS: ngân sách
// bám sát số thật, CHỈ ĐƯỢC GIẢM, không bao giờ được nâng lên để test xanh.
// ═══════════════════════════════════════════════════════════════════════════

/** Hạ số này mỗi khi một đợt quét riêng di trú xong `throw new Error(...)` sang
 *  appError(). KHÔNG BAO GIỜ nâng lên — số dư thừa che mất nợ mới, y hệt
 *  ALLOWED_LEGACY_THROWS ở trên. Ngân sách này ĐỘC LẬP với ALLOWED_LEGACY_THROWS
 *  (hai họ throw khác nhau: `new TRPCError` vs `new Error`), không cộng dồn. */
const ALLOWED_RAW_ERROR_THROWS = 0; // 21 → 3 → **0** (2026-08-22) — nay là BẤT BIẾN.
//
// Ba chỗ cuối, ba cách xử KHÁC nhau — không cái nào là "di trú cơ học":
//  1-2. machineApiRouters (inspection/processResultAlreadyPersisted) → DbUnavailableError.
//       Ghi chú Task 9 để nguyên chúng với lý do ĐÚNG (catch là `catch { break; }`, không
//       ai đọc chuỗi ⇒ appError chỉ là cosmetic). Nhưng DbUnavailableError KHÁC appError:
//       nó không đổi hình dạng phản hồi, chỉ đặt đúng TÊN. Trung tính về hành vi — đã
//       kiểm tận nơi inspectionStoreForward.ts:456-459.
//  3.   operatorBadgeRouter `dateInput` → `ctx.addIssue()`. Ghi chú Task 9 kết luận "phải
//       tách validate ra khỏi transform" và bỏ sót lối thoát NGẮN HƠN: addIssue là cách
//       của CHÍNH ZOD, sinh zod issue thật ⇒ đi ra đường parseZodIssues → formatZodIssue,
//       và từ bản vá F1 thì "Invalid date" đã dịch được đủ vi/en/zh.
//
// ⚠ Bài học chung của cả ba: **một ghi chú "đã cân nhắc, không làm được" chỉ đóng những
//   cửa nó ĐÃ THỬ.** Đọc kỹ để khỏi lặp việc cũ, nhưng đừng coi nó là danh sách đầy đủ.
//
// ⚠ F2 trong backlog khai **75 chỗ, trong đó 31 chỗ "Database not available"**. Đo lại
//   2026-08-22: **3 chỗ**, 2 chỗ họ DB. Mục sai thứ MƯỜI của tài liệu đó.


function countRawErrorThrows(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsFiles(ROUTERS_DIR)) {
    const n = (readFileSync(file, "utf8").match(/throw new Error\(/g) ?? []).length;
    if (n > 0) { byFile.push([file.replace(ROUTERS_DIR, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("phủ mã lỗi trong server/routers — ngân sách `throw new Error(...)` (C-1)", () => {
  it(`còn tối đa ${ALLOWED_RAW_ERROR_THROWS} chỗ throw new Error(...) chưa qua appError`, () => {
    const { total, byFile } = countRawErrorThrows();
    if (total > ALLOWED_RAW_ERROR_THROWS) {
      console.error("[phủ mã lỗi] còn nợ throw new Error(...) ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_ERROR_THROWS);
  });

  it("ngân sách throw new Error(...) KHÔNG được nới rộng hơn thực tế", () => {
    // Cùng lý do với ALLOWED_LEGACY_THROWS: ngân sách phải bám SÁT số thật, nếu
    // không một `throw new Error(...)` mới sẽ lọt qua mà không ai biết.
    const { total } = countRawErrorThrows();
    expect(ALLOWED_RAW_ERROR_THROWS).toBe(total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Task 10 (F3, doc71) — NGÂN SÁCH THỨ BA, đo `new TRPCError(` NGOÀI
// `server/routers/**` (server/_core/*, server/services/*, server/utils/*, …).
//
// ALLOWED_LEGACY_THROWS ở trên (dòng 37) CHỈ quét server/routers — comment của
// chính nó (dòng 43-61) đã tự ghi rõ lỗ hổng này từ Task 8 fix round 1: "64
// chỗ còn lại trong 13 file _core/services/utils CHƯA di trú", cố ý để ngoài
// phạm vi khi đó ("hạ tầng lõi + security-critical, không nên sửa vội cuối một
// task lớn"). Task 10 đóng đúng lỗ hổng thứ ba này — ĐỘC LẬP với 2 ngân sách ở
// trên (một họ throw khác — `new TRPCError`, không phải `throw new Error` —
// VÀ một vùng quét khác — ngoài routers, không phải trong), không cộng dồn.
//
// Đo được tại thời điểm Task 10 bắt đầu (khớp CHÍNH XÁC con số plan đã ghim ở
// task-10-brief.md/plan doc71 — không lệch như cảnh báo "mã đã đổi nhiều"):
//   grep -rno "new TRPCError(" server --include=*.ts | grep -v "\.test\.ts" | grep -v "^server/routers/" | grep -v "appError\.ts:" | wc -l
//   → 64 chỗ / 13 file: machineAuthService.ts 17 · aiAnalyticsScope.ts 13 ·
//   _core/trpc.ts 12 · securityIdentityRouter.ts 5 · thresholdGovernanceService.ts 5 ·
//   notification.ts 4 · safeImagePath.ts 2 · sáu file 1 chỗ (instrumentGate.ts,
//   masterDataIO.ts, faiGateService.ts, voiceTranscription.ts, moduleGate.ts,
//   accessControl.ts).
//
// ⚠ 2 trong 64 (masterDataIO.ts, voiceTranscription.ts) hoá ra là VÍ DỤ MINH
// HOẠ bên trong docstring (/** ... */), KHÔNG phải mã thực thi — regex đếm ký
// tự không phân biệt code với comment (cùng hạn chế sẵn có ở
// ALLOWED_LEGACY_THROWS/ALLOWED_RAW_ERROR_THROWS phía trên, không phải lỗ hổng
// riêng của ngân sách này). Cả hai docstring đã được cập nhật sang mẫu
// appError() cho khớp thực tế thay vì dạy sai pattern cho người đọc sau — xem
// task-10-report.md mục "hai chỗ đo được nhưng không phải nợ thật".
// ═══════════════════════════════════════════════════════════════════════════

const SERVER_DIR = join(ROUTERS_DIR, "..");

function countTrpcErrorsOutsideRouters(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsFiles(SERVER_DIR)) {
    const rel = file.replace(SERVER_DIR, "").replace(/\\/g, "/").replace(/^\//, "");
    if (rel.startsWith("routers/")) continue; // đếm riêng ở ALLOWED_LEGACY_THROWS phía trên
    if (rel === "_core/appError.ts") continue; // nơi ĐỊNH NGHĨA appError(), không phải call-site
    const n = (readFileSync(file, "utf8").match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) { byFile.push([rel, n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Hạ số này mỗi khi một đợt quét riêng di trú xong `new TRPCError(...)` NGOÀI
 *  server/routers/** sang appError(). KHÔNG BAO GIỜ nâng lên — số dư thừa che
 *  mất nợ mới, y hệt 2 ngân sách phía trên. Độc lập, không cộng dồn. */
const ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS = 0; // ← Task 10 (F3, doc71) lô 4/4 (CUỐI) — aiAnalyticsScope.ts (13) +
// safeImagePath.ts (2) + instrumentGate.ts (1) + faiGateService.ts (1) = 17 chỗ di trú thật, cộng 2 chỗ
// masterDataIO.ts/voiceTranscription.ts (ví dụ minh hoạ trong docstring, không phải mã thực thi — cập
// nhật pattern trong comment để cổng đếm ký tự không còn thấy "new TRPCError(" ở đó). 19 → 0.

describe("phủ mã lỗi NGOÀI server/routers/** — ngân sách `new TRPCError(...)` (Task 10, F3)", () => {
  it(`còn tối đa ${ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS} chỗ new TRPCError(...) ngoài server/routers/** chưa qua appError`, () => {
    const { total, byFile } = countTrpcErrorsOutsideRouters();
    if (total > ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS) {
      console.error("[phủ mã lỗi] còn nợ new TRPCError(...) ngoài routers ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS);
  });

  it("ngân sách new TRPCError(...) ngoài routers KHÔNG được nới rộng hơn thực tế", () => {
    // Cùng lý do với 2 ngân sách phía trên: ngân sách phải bám SÁT số thật, nếu
    // không một `new TRPCError(...)` mới ngoài routers sẽ lọt qua mà không ai biết.
    const { total } = countTrpcErrorsOutsideRouters();
    expect(ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS).toBe(total);
  });
});
