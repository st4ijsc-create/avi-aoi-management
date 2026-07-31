/**
 * Sprint 5 doc 71 Task 7 (F1 phần A) — CỔNG CHẶN HỒI QUY phía CLIENT.
 *
 * Cùng khuôn với server/routers/appErrorCoverage.test.ts (Task 4-8): đếm số "site"
 * `onError` (mỗi chỗ nối vào một `useMutation`/`useQuery` trong client/src/pages và
 * client/src/components) còn hiện message THÔ — CHƯA đi qua mapTrpcError()/
 * toastTrpcError() (client/src/lib/trpcErrors.ts) — và so với một ngân sách GIẢM
 * DẦN. Mỗi đợt di trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ trang mới không thể lặng
 * lẽ thêm nợ. Sạch hoàn toàn khi hằng số về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy: bạn
 * vừa thêm một chỗ hiện `err.message` tiếng Anh thô cho người dùng Việt Nam. Dùng
 * `toastTrpcError(err)` (khi chỉ hiện toast) hoặc `mapTrpcError(err)` (khi cần
 * chuỗi để ghép vào chỗ khác — vd `description:` của toast có tiêu đề riêng).
 *
 * ── VÌ SAO KHÔNG THỂ ĐẾM BẰNG MỘT REGEX/GREP MỘT DÒNG (khác cổng server) ──────
 * Cổng server chỉ cần `grep -c "new TRPCError("` vì mọi lần ném lỗi đều VIẾT TRỰC
 * TIẾP tại chỗ. Ở client, rất nhiều `onError` KHÔNG viết hàm nội tuyến mà tham
 * chiếu một hàm dùng chung khai báo phía trên cùng file, hai dạng phổ biến:
 *   - `onError: onMutationError` (đặt tên khác "onError")
 *   - `onError,` (viết tắt object — tham chiếu biến CÙNG TÊN "onError")
 * Ví dụ thật đã gặp khi đo (Task 7 Step 1): client/src/pages/EquipmentStandards.tsx
 * định nghĩa MỘT `onMutationError` rồi 8 mutation cùng tham chiếu nó; RepairStation.tsx
 * định nghĩa MỘT `onError` (biến) dùng cho 2 mutation. Đếm chỉ khớp
 * `onError:\s*\(` (bỏ qua tham chiếu) sẽ BỎ SÓT các file này hoàn toàn (đo thử ra
 * 0 cho cả 4 file trên trong khi thực tế RepairStation=2, EquipmentStandards=8,
 * FieldDevices=2, EscalationRulesSection=4 — xem lịch sử đo ở Task 7 report).
 * Nên hàm countRawMessageSites() dưới đây CÂN BẰNG NGOẶC (giống radius-context
 * regex của appErrorCoverage.test.ts) + TRA CỨU định nghĩa hàm dùng chung trong
 * CÙNG FILE khi gặp một tham chiếu, rồi phân tích thân hàm đã-giải-quyết đó.
 *
 * ── SỐ ĐO ──────────────────────────────────────────────────────────────────────
 * Task 7 Step 1 (trước khi di trú bất kỳ file nào): 575 site trong 170 file
 * (client/src/pages + client/src/components; không có site nào ngoài hai thư mục
 * này tại thời điểm đo — hooks/lib/_core sạch).
 *   Lô 1 (sản xuất + kiểm tra — 9 file: ProductionOrders/ProductionScheduling/
 *   ProductionSessionSignOff/ProductChangeoverWizard/FeederVerify/
 *   InspectionDetail/RepairStation/NonconformanceReports/QualityHome) — 25 site
 *   → hạ 575 → 550.
 *   Lô 2 (cảnh báo + thiết bị + andon — 8 file: Alerts/ShellAlertChip/
 *   UnifiedDeviceMonitor/MachineCockpit/OperatorSessionControl/WorkOrdersPage/
 *   AndonBoard/OperatorHome) — 19 site → hạ 550 → 531.
 * Tổng Task 7 (F1 phần A): 44 site / 17 file di trú. Phần còn lại (531 site /
 * 153 file) là việc của Task 8 — danh sách đầy đủ nằm trong task-7-report.md.
 *
 * Tự đo lại: chạy hàm countRawMessageSites() ở dưới trên "client/src" (không có
 * lệnh shell một-dòng tương đương vì cần cân bằng ngoặc + tra cứu — xem trên).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC_DIR = join(LIB_DIR, ".."); // client/src

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_RAW_MESSAGE_HANDLERS = 531; // ← Task 7 Step 3 lô 2/2 (F1 phần A, HẾT) — cảnh báo+thiết bị+andon, 19 site / 8 file. Tổng Task 7 = 44/17. Task 8 tiếp tục.

function walkTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkTsxFiles(full)); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name) || name.endsWith(".unit.test.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Từ vị trí `openIdx` trỏ vào một ký tự mở ( { [ — trả về vị trí NGAY SAU ký tự đóng khớp. */
function balanceFrom(src: string, openIdx: number): number {
  const open = src[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    const c = src[k];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return k + 1; }
  }
  return src.length;
}

/** Từ vị trí ngay sau "(params)", đọc phần thân hàm mũi tên: block `{...}` hoặc concise expr. */
function readArrowBody(src: string, afterParamsIdx: number): string {
  let k = afterParamsIdx;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src.slice(k, k + 2) === "=>") {
    k += 2;
    while (k < src.length && /\s/.test(src[k])) k++;
  }
  if (src[k] === "{") return src.slice(k, balanceFrom(src, k));
  let depth = 0, end = k;
  for (; end < src.length; end++) {
    const c = src[end];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
    else if (c === ";" && depth === 0) { end++; break; }
    else if (c === "," && depth === 0) break;
  }
  return src.slice(k, end);
}

/** Site vi phạm = có `.message` trong thân hàm ĐÃ-GIẢI-QUYẾT nhưng không gọi mapTrpcError(/toastTrpcError(. */
function isViolationBody(body: string): boolean {
  const hasMessage = /\.message\b/.test(body);
  const hasMapper = /\bmapTrpcError\s*\(|\btoastTrpcError\s*\(/.test(body);
  return hasMessage && !hasMapper;
}

/** Tìm `const/let/var NAME = (async)? (...) => body` hoặc `function NAME(...) {}` trong CÙNG file. */
function resolveNamedDef(src: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const arrowRe = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(async\\s+)?\\(`);
  const m = arrowRe.exec(src);
  if (m) {
    const parenOpen = src.indexOf("(", m.index);
    return readArrowBody(src, balanceFrom(src, parenOpen));
  }
  const fnRe = new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`);
  const fm = fnRe.exec(src);
  if (fm) {
    const parenOpen = src.indexOf("(", fm.index);
    const afterParams = balanceFrom(src, parenOpen);
    let k = afterParams;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] === "{") return src.slice(k, balanceFrom(src, k));
  }
  return null; // không tìm thấy định nghĩa trong file (vd import từ nơi khác) — không đoán
}

/** Đếm mỗi SITE `onError` (khoá trong options object của react-query) hiện message
 *  thô. Xem docstring đầu file để biết vì sao cần cân bằng ngoặc + tra cứu tham
 *  chiếu, thay vì một regex đơn giản. */
function analyzeFile(file: string): { violations: number; lines: number[] } {
  const src = readFileSync(file, "utf8");
  let violations = 0;
  const lines: number[] = [];
  let idx = 0;
  while (true) {
    const found = src.indexOf("onError", idx);
    if (found === -1) break;
    idx = found + 7;

    const lineStart = src.lastIndexOf("\n", found) + 1;
    if (src.slice(lineStart, found).includes("//")) continue; // trong comment dòng đơn

    const before = src.slice(Math.max(0, found - 20), found);
    if (/[A-Za-z0-9_$]$/.test(before)) continue; // vd "...onError" là hậu tố của định danh dài hơn
    const after1 = src[found + 7];
    if (after1 && /[A-Za-z0-9_$]/.test(after1)) continue; // vd "onErrorHandler"

    if (/\b(const|let|var)$/.test(before.trimEnd())) continue; // đây là ĐỊNH NGHĨA — tra cứu on-demand ở nhánh site

    let k = found + 7;
    while (k < src.length && /\s/.test(src[k])) k++;
    let body: string | null = null;
    let refName: string | null = null;
    if (src[k] === ":") {
      k++;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === "(") {
        body = readArrowBody(src, balanceFrom(src, k));
      } else {
        const identMatch = /^[A-Za-z_$][\w$]*/.exec(src.slice(k));
        if (identMatch) refName = identMatch[0];
      }
    } else if (src[k] === "," || src[k] === "}") {
      refName = "onError"; // viết tắt { onError, ... } / { ..., onError }
    } else {
      continue; // dạng không nhận diện được — không đoán, không đếm
    }

    if (refName) {
      const resolved = resolveNamedDef(src, refName);
      if (resolved === null) continue; // không rõ — tránh báo dương tính giả
      body = resolved;
    }

    if (body !== null && isViolationBody(body)) {
      violations++;
      lines.push(src.slice(0, found).split("\n").length);
    }
  }
  return { violations, lines };
}

function countRawMessageSites(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsxFiles(CLIENT_SRC_DIR)) {
    const { violations } = analyzeFile(file);
    if (violations > 0) {
      byFile.push([file.replace(CLIENT_SRC_DIR, "client/src"), violations]);
      total += violations;
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("phủ mã lỗi trong client/src (onError → mapTrpcError/toastTrpcError)", () => {
  it(`còn tối đa ${ALLOWED_RAW_MESSAGE_HANDLERS} site onError hiện message thô`, () => {
    const { total, byFile } = countRawMessageSites();
    if (total > ALLOWED_RAW_MESSAGE_HANDLERS) {
      // In ra file nặng nhất để đợt sau (Task 8) biết bắt đầu từ đâu.
      console.error("[phủ mã lỗi client] còn nợ ở:", byFile.slice(0, 20));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_MESSAGE_HANDLERS);
  });

  it("ngân sách KHÔNG được nới rộng hơn thực tế — số dư thừa che mất nợ mới", () => {
    // Ngân sách phải bám SÁT số thật. Nếu nó cao hơn thực tế, ai đó thêm một
    // `onError: (e) => toast.error(e.message)` mới sẽ lọt qua cổng mà không ai biết.
    const { total } = countRawMessageSites();
    expect(ALLOWED_RAW_MESSAGE_HANDLERS).toBe(total);
  });
});
