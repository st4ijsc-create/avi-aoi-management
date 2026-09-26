/**
 * ★★★ 2026-08-17 — PHẠM VI DỮ LIỆU cho ĐƯỜNG XUẤT BÁO CÁO (PDF / PowerPoint / report-builder).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `server/db/statistics.ts` chỉ áp bộ lọc phạm vi khi nơi gọi TRUYỀN `userId` xuống:
 *
 *     if (filters?.userId && filters?.userRole !== 'admin') { …áp bộ lọc… }
 *
 * Mười một điểm gọi trên ba router xuất báo cáo **không truyền gì cả**, nên khối đó KHÔNG BAO
 * GIỜ chạy ⇒ mọi tài khoản đã đăng nhập tải về được số liệu TOÀN CỤC trong PDF/PPTX/widget,
 * kể cả tài khoản 0 gán nhà máy.
 *
 * ⚠ Đây là **lớp lỗi KHÁC** với lỗ `or()` rỗng vá cùng ngày. Ở đó hàm sai; ở đây hàm ĐÚNG mà
 * nơi gọi **bỏ rơi danh tính**. Vì vậy bản vá kia — và mọi lưới của nó — không chạm tới đây:
 * `accessControlScope.test.ts` gọi THẲNG `getDashboardStats(userId…)`, tức nó đo tầng db với
 * danh tính đã được trao tay, đúng cái mà router quên trao.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT MODULE, KHÔNG PHẢI BA LẦN CHÉP TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Ba router (pdf/pptx/report-builder) + hai bề mặt xuất khác cần ĐÚNG một hợp đồng. Chép tay
 * `{ userId: ctx.user.id, userRole: ctx.user.role }` ở 13 chỗ là cách một chỗ lặng lẽ lệch rồi
 * không ai phát hiện — chính xác cách lỗ này ra đời.
 *
 * ⚠⚠ CẤM lấy danh tính từ `input`. `userId` đến từ `ctx.user` (máy chủ tự xác thực) hoặc không
 * từ đâu cả. Một `input.userId` là lời TỰ KHAI của người gọi — nó biến bộ lọc phạm vi thành một
 * ô chọn trên giao diện của kẻ tấn công. Chữ ký `exportScopeArgs(user)` chỉ nhận đối tượng
 * người dùng nên lối sai không diễn đạt được.
 *
 * ⚠⚠ CẤM để `filter` của `resolveDataScope` lọt vào đáp ứng tRPC. Nó là đối tượng SQL drizzle
 * mang tham chiếu vòng (`PgTable → PgSerial → table`) và superjson chết với
 * `Converting circular structure to JSON` — đã xảy ra thật hôm nay (`dashboard.getStats` trả
 * 500 cho MỌI người dùng sau một bản vá `tsc` sạch + 220 ca xanh). `resolveExportScope()` trả
 * qua `scopeLabelsOf()` nên chỉ ba ô CHỮ đi ra ngoài.
 */
import { appError } from "./appError";
import { resolveDataScope } from "./accessControl";
import {
  scopeLabelsOf,
  NO_FACTORY_ASSIGNMENT_MESSAGE,
  type ScopeLabels,
} from "./accessControlLabels";

/** Danh tính người XUẤT. Cố ý chỉ nhận `id`/`role` — hình dạng của `ctx.user`, không phải của `input`. */
export interface ExportActor {
  id: number;
  role: string;
}

/**
 * Đối số danh tính truyền XUỐNG tầng `server/db/statistics.ts`.
 *
 * Trả về đúng hai ô mà mọi hàm thống kê đọc (`userId`/`userRole`) — nơi gọi chỉ việc rải
 * `...exportScopeArgs(ctx.user)` vào đối tượng bộ lọc. Đột biến "gỡ danh tính khỏi một nơi
 * gọi" = xoá đúng một cụm này, và ca kiểm tương ứng đỏ.
 */
export function exportScopeArgs(user: ExportActor): { userId: number; userRole: string } {
  return { userId: user.id, userRole: user.role };
}

/**
 * Ba ô nhãn phạm vi của người xuất — KHÔNG kèm `filter` (xem docblock đầu file).
 * Admin: `scopeApplied=false`, `scopeEmptyReason=null` ⇒ mọi cổng dưới đây cho qua.
 */
export async function resolveExportScope(user: ExportActor): Promise<ScopeLabels> {
  return scopeLabelsOf(await resolveDataScope(user.id, user.role));
}

/**
 * Câu in VÀO tài liệu khi số liệu ĐÃ bị thu hẹp theo phạm vi.
 *
 * ⚠ Không chỉ số 0 mới nói dối. Một PDF của `engineer1` (gán một nhà máy) chứa 22.995 bản ghi
 * trông y hệt một báo cáo TOÀN CÔNG TY 22.996 — chênh nhau đúng một hàng, và không ô nào trên
 * trang nói rằng đây chỉ là một nhà máy. File rời khỏi hệ thống rồi được chuyển tiếp, in ra,
 * dán vào slide họp; lúc ấy không còn ngữ cảnh nào để đính chính. Nên tài liệu tự khai phạm vi
 * của chính nó.
 *
 * Admin (`scopeApplied=false`) không nhận câu này — báo cáo của họ ĐÚNG là toàn hệ thống.
 */
export const SCOPED_EXPORT_NOTE =
  "Phạm vi: chỉ các nhà máy được gán cho tài khoản xuất báo cáo — KHÔNG phải toàn hệ thống.";

export function exportScopeNote(scope: ScopeLabels): string | undefined {
  return scope.scopeApplied ? SCOPED_EXPORT_NOTE : undefined;
}

/**
 * ★★★ TỪ CHỐI XUẤT khi phạm vi RỖNG, thay vì giao một file toàn số 0.
 *
 * **Vì sao từ chối chứ không phải in chú thích lên trang.** Cả hai đều "trung thực" ở thời điểm
 * sinh file, nhưng chúng già đi rất khác nhau:
 *
 *  1. **Số 0 sống lâu hơn chú thích.** Bốn ô KPI khổng lồ ("Tổng kiểm tra: 0 · NG: 0 · Yield:
 *     0,0%") là thứ được chụp màn hình, cắt dán sang email, chiếu lên tường. Dòng chú thích
 *     9pt ở đầu trang không đi cùng. Cái đọng lại là *"nhà máy không chạy"* — kết luận SAI, và
 *     là kết luận nguy hiểm vì nó khiến người ta đi tìm lỗi ở dây chuyền thay vì ở bảng phân
 *     quyền.
 *  2. **Tài liệu ấy có ĐÚNG BẰNG 0 thông tin.** Mọi mục — KPI, bảng máy, top NG, xu hướng —
 *     đều rỗng. Ta không đánh đổi mất mát nào cả: không có gì để mất.
 *  3. **Cổng chặn không bị một lượt đổi bố cục xoá đi.** Chú thích nằm trong `pdfTemplateService`
 *     / `powerpointService`, hai file thuần trình bày mà một task "làm đẹp báo cáo" hoàn toàn có
 *     thể dọn dẹp — và khi đó không lưới nào ở tầng dữ liệu đỏ. Cổng này ở tầng router, có ca
 *     kiểm riêng, và đứng TRƯỚC cả việc sinh file.
 *  4. **Nói đúng lúc người ta còn hành động được.** Lỗi bật lên ngay khi bấm "Xuất", kèm câu chỉ
 *     thẳng việc phải làm (xin admin gán nhà máy). Một file tải về rồi mới đọc chú thích thì đã
 *     muộn một vòng.
 *
 * Khuôn theo tiền lệ có sẵn của chính repo: `_core/aiAnalyticsScope.ts` (:205, :294) cũng TỪ
 * CHỐI tài khoản 0 gán bằng đúng cặp mã `PERMISSION_DENIED` + `reason: "noFactoryAssigned"`
 * (khoá i18n đã dịch đủ vi/en/zh) — không phát minh mã mới.
 *
 * ⚠ KHÔNG chặn admin: `scopeEmptyReason` chỉ khác `null` khi tài khoản KHÔNG phải admin VÀ
 * không có gán nào. Đây là điểm chống "vá quá tay thành chặn tất cả".
 *
 * ⚠ `action` cố ý dùng lại đúng `"canExport"` — khoá `errors.action.canExport` ĐÃ dịch đủ
 * vi/en/zh ("xuất"/"export"/"导出") và đúng bằng tên quyền mà `requirePermission('reports_export',
 * 'canExport')` đã canh. Đặt một literal MỚI ở đây sẽ tạo một khoá i18n chưa dịch, và câu lỗi sẽ
 * rơi về `fallbackMessage` tiếng Việt cho người dùng en/zh — đúng lớp lỗi Sprint 5 đã đi xoá.
 */
export function assertExportableScope(scope: ScopeLabels): void {
  if (!scope.scopeEmptyReason) return;
  throw appError(
    "FORBIDDEN",
    "PERMISSION_DENIED",
    { action: "canExport", reason: "noFactoryAssigned" },
    // Câu đầy đủ (nói rõ ĐÂY LÀ PHẠM VI RỖNG, không phải dây chuyền ngừng chạy) đi kèm để
    // client chưa có khoá i18n và log máy chủ vẫn đọc được đúng nguyên nhân.
    scope.scopeMessage ?? NO_FACTORY_ASSIGNMENT_MESSAGE,
  );
}
