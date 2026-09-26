/**
 * AI Local Tools — CỔNG QUYỀN DÙNG CHUNG CHO READ TOOL (G3-A).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — VÀ VÌ SAO NÓ **KHÔNG** LÀ "CƠ CHẾ THỨ HAI".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cơ chế cưỡng chế của repo đã có đủ **hai mảnh** và file này không thêm mảnh nào:
 *
 *   1. `toolRegistry.argsWithAuthCtx` — **XOÁ vô điều kiện** `__authCtx` do model bịa rồi **gán
 *      lại** từ phiên THẬT (`ToolExecContext.user`). Đây là nguồn danh tính DUY NHẤT.
 *   2. `_core/accessControl.checkPermission` — cổng RBAC duy nhất của toàn hệ.
 *
 * Cái file này làm là **gỡ bản sao thứ năm**: `analyticsTools.ts`, `readToolsP2.ts`,
 * `readToolsP2bc.ts`, `readToolsP2d.ts` mỗi file tự chép một `authCtxSchema` + `rbacGate` + bảng
 * `DENY_MSG` **giống hệt nhau**. G3-A phải gắn cổng cho **19 tool nữa nằm ở 4 file khác**; chép
 * thêm bốn bản nữa là chín bản của cùng một luật, và luật chín bản là luật sẽ trôi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ MỘT NGUỒN CHO CẢ **LỜI KHAI** LẪN **PHÉP CƯỠNG CHẾ**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `rbacGate` nhận **chính đối tượng `ToolPermission`** mà tool khai ở `requiredPermission` — không
 * nhận hai chuỗi rời. Nên `Tool.requiredPermission` và cặp (module, action) thực sự đi tới
 * `checkPermission` **là một biến duy nhất**; chúng không thể lệch nhau vì không có hai chỗ để
 * lệch. `toolPermissionQuantifier.test.ts` §4 vẫn ĐO điều này lúc chạy (chặn `checkPermission`,
 * đọc cặp thật sự tới nơi) chứ không tin vào câu này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ FAIL-SAFE — BA CỬA ĐỀU ĐÓNG VỀ PHÍA "TỪ CHỐI":
 *   • `__authCtx` vắng / méo  ⇒ TỪ CHỐI (không phải "chạy với quyền mặc định").
 *   • `checkPermission` NÉM   ⇒ TỪ CHỐI (RBAC hỏng không được biến thành cửa mở).
 *   • cổng trả `false`        ⇒ TỪ CHỐI.
 * Và cổng chạy **TRƯỚC `getDb()`** trong mọi handler: một lượt bị từ chối không được chạm tới một
 * hàng dữ liệu nào, kể cả để rồi vứt đi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ TỪ CHỐI PHẢI **TRUNG THỰC**: câu trả về nói rõ **thiếu quyền nào** (`module/action`). Nó
 * TUYỆT ĐỐI không được nói "không có dữ liệu" — giả vờ rỗng dạy người dùng rằng **hệ thống hỏng**
 * trong khi sự thật là **họ thiếu quyền**, và người vận hành sẽ đi tìm lỗi ở đúng chỗ không có lỗi.
 * `toolPermissionQuantifier.test.ts` §7 cưỡng chế điều này cho MỌI read tool.
 *
 * ⚠ NGÔN NGỮ: câu từ chối viết bằng **tiếng Việt**, cố ý. 19 tool mà file này phục vụ phát
 * `textSummary` **tiếng Việt thuần** ở mọi nhánh và schema của chúng **không khai ô `lang`**, nên
 * `argsWithAuthCtx` không có gì để bơm (nó chỉ bơm khi ô `lang` là `z.enum` ba ngôn ngữ — xem
 * `laOEnumNgonNguHienThi`). Viết ba thứ tiếng ở đây sẽ tạo hai nhánh **không bao giờ chạy được** —
 * đúng loại mã chết mà repo này đã đếm nhiều lần. Muốn đa ngữ thì phải khai `lang` trong schema
 * TRƯỚC, rồi câu từ chối mới có đường nhận nó.
 */

import { z } from "zod";
import { checkPermission } from "../../_core/accessControl";
import type { ToolPermission, ToolResult, ToolResultType } from "./toolRegistry";

/**
 * Ô danh tính dành riêng, do tầng chat/agent bơm vào qua `argsWithAuthCtx`.
 * `.optional()` để bộ phân loại heuristic (vốn không biết gì về phiên) vẫn `safeParse` được —
 * và một `__authCtx` VẮNG được xử lý là **TỪ CHỐI**, không phải "bỏ qua cổng".
 */
export const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();

export type AuthCtx = z.infer<typeof authCtxSchema>;

/** Dạng dùng trong `z.object({ …, __authCtx: authCtxParam })` của mọi read tool có cổng. */
export const authCtxParam = authCtxSchema.optional();

/** Câu từ chối — nêu ĐÍCH DANH quyền còn thiếu. Không bao giờ giả vờ "không có dữ liệu". */
export function cauTuChoi(perm: ToolPermission): string {
  return (
    `Bạn không có quyền "${perm.module}/${perm.action}" nên tôi không thể lấy dữ liệu này. ` +
    `Đây là TỪ CHỐI VÌ THIẾU QUYỀN — không phải vì hệ thống không có số liệu. ` +
    `Liên hệ quản trị viên nếu công việc của bạn cần quyền này.`
  );
}

/** Kết quả TỪ CHỐI: không mang một byte dữ liệu nào, và tự khai lý do ở `note`. */
export function ketQuaTuChoi<T>(
  type: ToolResultType,
  title: string,
  fallback: T,
  perm: ToolPermission,
): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: cauTuChoi(perm),
    note: "PERMISSION_DENIED",
  };
}

/**
 * Cổng RBAC dùng chung. Trả `null` khi **ĐƯỢC PHÉP**; ngược lại trả thẳng một `ToolResult` TỪ CHỐI
 * để handler `return` nguyên văn.
 *
 * ⚠ Gọi nó là **câu lệnh ĐẦU TIÊN** của handler, trước `getDb()` và trước mọi phép giải mã tham số.
 *
 * @param rawAuthCtx  giá trị ô `__authCtx` lấy thẳng từ params (chưa tin được).
 * @param perm        **chính** đối tượng tool khai ở `requiredPermission` (một nguồn duy nhất).
 */
export async function rbacGate<T>(
  rawAuthCtx: unknown,
  perm: ToolPermission,
  type: ToolResultType,
  title: string,
  fallback: T,
): Promise<ToolResult<T> | null> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  // Danh tính vắng/méo ⇒ TỪ CHỐI, và KHÔNG hỏi cổng bằng một danh tính bịa ra.
  if (!parsed.success) return ketQuaTuChoi(type, title, fallback, perm);
  let allowed = false;
  try {
    allowed = await checkPermission(parsed.data.userId, parsed.data.role, perm.module, perm.action);
  } catch {
    allowed = false; // RBAC hỏng ⇒ đóng, không mở.
  }
  return allowed ? null : ketQuaTuChoi(type, title, fallback, perm);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-18 (nhóm B #1) — **PHẠM VI DỮ LIỆU**, THỨ `rbacGate` KHÔNG PHÁT BIỂU ĐƯỢC.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ **HAI CÂU HỎI KHÁC NHAU, VÀ LẪN LỘN CHÚNG CHÍNH LÀ CÁCH LỖ NÀY SỐNG SÓT.**
 *
 *   `rbacGate`            trả lời *"tài khoản này được GỌI tool này không?"*  (một bit BẬT/TẮT)
 *   hàm dưới đây trả lời  *"tài khoản này được THẤY dữ liệu tới ĐÂU?"*        (một TẬP nhà máy)
 *
 * `get_factory_stats` có cổng `dashboard_corporate/canView` từ tuần trước — và vẫn **liệt kê MỌI
 * nhà máy theo mã + TÊN** cho bất kỳ ai giữ bit ấy, kể cả người chỉ được gán một nhà máy. Nó rò
 * **cấu trúc tổ chức**, không chỉ con số. Bit "được xem dashboard tập đoàn" không hề nói "được xem
 * nhà máy của tập đoàn KHÁC".
 *
 * ⇒ Hàm này là **cùng một** bộ phân giải mà `/history`, `analytics_defect_heatmap_summary` và các
 * router phân tích đang dùng (`_core/aiAnalyticsScope` → `accessControl.getUserAssignmentCodes`),
 * chỉ khoác một hình dạng dùng được cho tool. **Không có cơ chế thứ hai.**
 *
 * ⚠ `import()` ĐỘNG: `_core/aiAnalyticsScope` kéo theo `aiGateway` — nhập tĩnh ở đây sẽ lôi cả cụm
 * ấy vào đồ thị nạp của SỔ ĐĂNG KÝ TOOL (module này bị mọi handler nhập). Cùng lý do đã ghi ở
 * `analyticsTools.ts`.
 */
export type PhamViNhaMay =
  /** Vai toàn quyền (admin) — KHÔNG áp mệnh đề lọc nào. */
  | { kind: "global" }
  /** Bị giới hạn, và tập id nhà máy **KHÔNG rỗng**. Nơi gọi PHẢI lọc theo tập này. */
  | { kind: "scoped"; factoryIds: number[] }
  /** Phạm vi RỖNG (chưa được gán / danh tính méo). Nơi gọi PHẢI từ chối, KHÔNG được bỏ lọc. */
  | { kind: "empty" };

export async function giaiPhamViNhaMay(rawAuthCtx: unknown): Promise<PhamViNhaMay> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  // Không thể tới đây nếu `rbacGate` đã chạy trước — nhưng nếu tới thì ĐÓNG, không mở.
  if (!parsed.success) return { kind: "empty" };
  const { resolveFactoryScope, factoryIdsInScope } = await import("../../_core/aiAnalyticsScope");
  const scope = await resolveFactoryScope({ id: parsed.data.userId, role: parsed.data.role } as never);
  if (scope.isGlobal) return { kind: "global" };
  const factoryIds = await factoryIdsInScope(scope);
  return factoryIds.length > 0 ? { kind: "scoped", factoryIds } : { kind: "empty" };
}

/**
 * ★★ Câu "phạm vi rỗng" TRUNG THỰC cho bề mặt TOOL.
 *
 * ⚠⚠ NÓ TUYỆT ĐỐI KHÔNG ĐƯỢC NÓI *"không có nhà máy nào"* — đó là một **lời khai SAI về thế
 * giới**: hệ thống có nhà máy, người hỏi chỉ không được gán cái nào. Người vận hành nghe câu ấy sẽ
 * đi tìm lỗi ở đúng chỗ không có lỗi (và có thể kết luận nhà máy đã bị xoá). Cùng luật với
 * `cauTuChoi` phía trên và `accessControlLabels.NO_FACTORY_ASSIGNMENT_MESSAGE`.
 *
 * ⚠ Câu chữ cũng cố ý TRÁNH cụm "không có dữ liệu" — kể cả trong vế phủ định (xem lý lẽ ở
 * `accessControlLabels.ts`: người đọc lướt bắt được cụm từ, không bắt được vế phủ định).
 */
export function cauPhamViRong(): string {
  return (
    "Tài khoản của bạn CHƯA ĐƯỢC GÁN nhà máy nào, nên phạm vi xem của bạn đang RỖNG và tôi không " +
    "được phép trả về số liệu của bất kỳ nhà máy nào. Đây là giới hạn PHẠM VI của tài khoản, " +
    "KHÔNG phải kết luận về tình trạng nhà xưởng — hệ thống vẫn đang vận hành và vẫn ghi nhận sản " +
    "lượng bình thường. Liên hệ quản trị viên để được gán nhà máy."
  );
}

/**
 * Kết quả PHẠM VI RỖNG: không mang một byte dữ liệu nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `note` LÀ `PERMISSION_DENIED` — LÝ DO BAN ĐẦU ĐÃ HẾT HIỆU LỰC, LỰA CHỌN THÌ KHÔNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐÍNH CHÍNH 2026-08-18. Lời khai cũ ở đây là: *"cổng thứ tám chỉ chặn khi `note` ∈ {NOT_FOUND,
 * QUERY_ERROR, DB_UNAVAILABLE, PERMISSION_DENIED}, nên một mã MỚI như `SCOPE_EMPTY` sẽ KHÔNG khoá
 * được cổng — vì thế phải chọn mã đã nằm trong tập."* Câu ấy MÔ TẢ ĐÚNG cổng ngày hôm đó, nhưng
 * cái nó mô tả chính là **một lỗ**: tập bốn mã ấy do đếm TAY mà ra và thiếu **17 mã** khác cũng
 * rỗng (`SCOPE_EMPTY`, `NOT_FOUND_WITH_SUGGESTIONS`, `PROG_KB_DISABLED`, …).
 *
 * Cổng thứ tám nay **đã đảo chiều**: *có `note` ⇒ CHẶN*, ngoại lệ mới phải khai tên
 * (`aiLocalKnowledgeService.TOOL_NOTE_VAN_DIEN_GIAI`), và `aiLocalTools/toolNoteCensus.test.ts`
 * bắt mọi mã chưa phân loại. ⇒ Ràng buộc *"phải chọn một mã có sẵn"* KHÔNG CÒN.
 *
 * Vẫn giữ `PERMISSION_DENIED` ở đây, nhưng nay vì **NGHĨA**, không vì ràng buộc kỹ thuật: người
 * gọi bị từ chối vì **phạm vi quyền của tài khoản**, không phải vì hệ thống hết dữ liệu — và
 * `textSummary` (`cauPhamViRong`) mới là chỗ nói rõ đó là "chưa được gán nhà máy" chứ không phải
 * "thiếu bit RBAC". Nếu cần tách hai thứ ấy ở mức `note` cho mục đích chẩn đoán, nay đổi sang
 * `SCOPE_EMPTY` là AN TOÀN — cổng vẫn khoá. `handlers.scopePaths.test.ts` §"CỔNG THỨ TÁM" ĐO
 * điều này bằng chính `toolKhongCoGiDeNoi`, không tin câu này.
 */
export function ketQuaPhamViRong<T>(type: ToolResultType, title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: cauPhamViRong(),
    note: "PERMISSION_DENIED",
  };
}
