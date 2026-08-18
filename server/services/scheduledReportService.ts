/**
 * Scheduled Report Content Library
 *
 * doc 32 R4: this is NO LONGER a scheduler. The standalone setInterval loop
 * (start/stop/checkAndRunReports/getDueReports/runReport) was RETIRED — the live
 * scheduler is the node-cron `reportScheduler` (server/services/reportScheduler.ts).
 *
 * What remains here is a CONTENT LIBRARY consumed by the live path:
 * - statistics / OEE / machine-health report content builders,
 * - the branded HTML formatters,
 * - previewReport / generateAndSendReport (used by reportScheduler + systemRouters).
 */

import * as db from '../db';
import { sendEmail } from '../_core/email';
import { appError } from '../_core/appError';
import { getFactoryTimezone, nextRunInZone } from '../utils/factoryTime';
// ★★★ 2026-08-17 — xem `_core/reportExportScope.ts` + khối "PHẠM VI CỦA BÁO CÁO HẸN GIỜ" bên dưới.
import { resolveExportScope, exportScopeNote, type ExportActor } from '../_core/reportExportScope';
import { NO_FACTORY_ASSIGNMENT_MESSAGE } from '../_core/accessControlLabels';
// Cổng phạm vi cho bảng KHÔNG có cột tenant (`oee_metrics`, `downtime_events`, danh sách máy
// dựng trong bộ nhớ). Một luật, một chỗ sửa — xem docblock ở `db/reportAggregators.ts`.
import { tenantMachineGate, getTenantScopedMachineIds } from '../db/reportAggregators';
import type { SQL } from 'drizzle-orm';

// Email template config interface - matches db schema
interface EmailTemplateConfig {
  id: number;
  name: string;
  logoUrl: string | null;
  companyName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  warningColor?: string | null;
  successColor?: string | null;
  errorColor?: string | null;
  backgroundColor: string | null;
  textColor?: string | null;
  linkColor?: string | null;
  fontFamily: string | null;
  headingFontFamily?: string | null;
  fontSize?: string | null;
  footerText: string | null;
  copyrightText?: string | null;
  socialLinks?: any;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  isDefault: boolean;
}

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';
export type ReportType = 'statistics' | 'alerts' | 'comprehensive' | 'oee' | 'machine_health';

export interface ScheduledReport {
  id: number;
  name: string;
  type: ReportType;
  frequency: ReportFrequency;
  recipients: string[];
  corporateCode?: string;
  factoryCode?: string;
  isEnabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
  /** Wall-clock fire time "HH:mm" in the FACTORY timezone (doc 27 A1). */
  scheduleTime?: string;
  /** 0 (Sunday) – 6, weekly schedules only. */
  scheduleDayOfWeek?: number | null;
  /** 1–31, monthly schedules only. */
  scheduleDayOfMonth?: number | null;
  /**
   * ★★★ NGƯỜI TẠO LỊCH — trục phạm vi DUY NHẤT của đường hẹn giờ (xem `resolveScheduleScope`).
   * Không còn là một ô siêu dữ liệu trang trí: nó quyết định lượt chạy thấy dữ liệu của ai.
   */
  createdBy: number;
  createdAt: Date;
  /** Cửa sổ dữ liệu ghi đè (mặc định suy từ `frequency`). Dùng cho preview/sendTest/lưới đo. */
  window?: { start: Date; end: Date };
}

export interface ReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  /** Đã áp bộ lọc phạm vi hay chưa (false = người tạo lịch là vai toàn quyền). */
  scopeApplied: boolean;
  /** Câu TỰ KHAI phạm vi in vào email/tài liệu khi số liệu đã bị thu hẹp. */
  scopeNote?: string;
  summary: {
    totalInspections: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    yieldRate: string;
  };
  corporateStats: Array<{
    corporateCode: string;
    totalInspections: number;
    yieldRate: string;
  }>;
  factoryStats: Array<{
    factoryCode: string;
    corporateCode: string;
    totalInspections: number;
    yieldRate: string;
  }>;
  topNGMachines: Array<{
    machineName: string;
    ngCount: number;
    yieldRate: string;
  }>;
  generatedAt: Date;
}

export interface OEEReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  /** Đã áp bộ lọc phạm vi hay chưa (false = người tạo lịch là vai toàn quyền). */
  scopeApplied: boolean;
  /** Câu TỰ KHAI phạm vi in vào email/tài liệu khi số liệu đã bị thu hẹp. */
  scopeNote?: string;
  summary: {
    totalMachines: number;
    avgAvailability: string;
    avgPerformance: string;
    avgQuality: string;
    avgOEE: string;
    totalDowntime: number;
  };
  machineOEE: Array<{
    machineId: number;
    machineCode: string;
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    timestamp: Date;
  }>;
  downtimeByCategory: Record<string, number>;
  machinesNeedingAttention: Array<{
    machineId: number;
    machineCode: string;
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    timestamp: Date;
  }>;
  generatedAt: Date;
}

export interface MachineHealthReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  /** Đã áp bộ lọc phạm vi hay chưa (false = người tạo lịch là vai toàn quyền). */
  scopeApplied: boolean;
  /** Câu TỰ KHAI phạm vi in vào email/tài liệu khi số liệu đã bị thu hẹp. */
  scopeNote?: string;
  summary: {
    totalMachines: number;
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    avgHealthScore: string;
  };
  machineHealth: Array<{
    machineId: number;
    machineCode: string;
    healthScore: number;
    oee: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
  machinesNeedingMaintenance: Array<{
    machineId: number;
    machineCode: string;
    healthScore: number;
    oee: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
  generatedAt: Date;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-17 — PHẠM VI CỦA BÁO CÁO HẸN GIỜ. Đọc trước khi sửa bất kỳ dòng nào dưới đây.
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// VẤN ĐỀ RIÊNG CỦA ĐƯỜNG NÀY. Hai đường kia (`powerpoint.exportComparison`,
// `reportArtifact.generate`) có `ctx.user` trong tay — chỉ việc truyền xuống. Đường hẹn giờ
// chạy từ cron, **không có phiên người dùng nào cả**. Vậy lấy phạm vi ở đâu?
//
// QUYẾT ĐỊNH 1 — PHẠM VI LÀ CỦA NGƯỜI TẠO LỊCH (`report.createdBy`).
//   Đó là con người duy nhất mà hệ thống biết đứng sau lượt chạy này. Ba phương án bị loại:
//   ✗ "chạy toàn cục vì là tác vụ hệ thống" — chính là lỗ đang vá. Một engineer chỉ cần bấm
//     "tạo lịch" là có số liệu toàn công ty gửi thẳng vào hộp thư mỗi sáng, vĩnh viễn.
//   ✗ "phạm vi của người NHẬN" — người nhận là một danh sách địa chỉ email tự do
//     (`recipients: string[]`), phần lớn không phải tài khoản trong hệ thống. Không có gì để
//     phân giải, và một email không thể mang nhiều phạm vi khác nhau cùng lúc.
//   ✗ "phạm vi ghi cứng trong hàng lịch lúc tạo" — xem QUYẾT ĐỊNH 2.
//
// QUYẾT ĐỊNH 2 — PHÂN GIẢI LẠI Ở **MỖI LƯỢT CHẠY**, KHÔNG ĐÓNG BĂNG LÚC TẠO LỊCH.
//   Câu hỏi của chủ dự án: *"nếu người ấy sau này mất quyền thì sao?"* Đây là câu trả lời.
//   Một lịch sống nhiều năm; quyền thì đổi. Nếu chụp lại danh sách nhà máy lúc tạo, thì một
//   người bị rút quyền hôm nay **vẫn nhận số liệu của nhà máy cũ mỗi sáng mai** — một đường
//   rò quyền tồn tại đúng bằng tuổi thọ của hàng lịch, và không có màn hình nào cho thấy nó.
//   Phân giải lại mỗi lượt ⇒ quyền co lại thì báo cáo co theo NGAY LƯỢT SAU, không cần ai nhớ
//   đi dọn các lịch cũ. Chi phí: một lượt đọc `users` + hai lượt đọc bảng gán, đã có cache 30 s
//   trong `getUserAssignmentCodes`. Với một cron chạy vài lần/ngày, chi phí ấy bằng không.
//
// QUYẾT ĐỊNH 3 — FAIL-CLOSED KHI KHÔNG XÁC ĐỊNH ĐƯỢC, ba nhánh, mỗi nhánh một câu riêng:
//   ① `createdBy` rỗng/0 (đúng giá trị mà `previewReport`/`reportScheduler` cũ truyền xuống),
//   ② tài khoản không còn tồn tại,
//   ③ tài khoản bị TẮT (`isActive = false`) — kể cả khi vẫn còn nguyên các hàng gán nhà máy;
//      một tài khoản bị vô hiệu hoá không được tiếp tục xuất số liệu qua một cái lịch bỏ quên.
//   ④ tài khoản còn sống nhưng 0 gán nhà máy ⇒ vẫn TỪ CHỐI, với câu của
//      `NO_FACTORY_ASSIGNMENT_MESSAGE`. Lý lẽ giống `assertExportableScope`: một email KPI toàn
//      số 0 gửi mỗi sáng dạy người đọc rằng NHÀ MÁY ĐANG NGỪNG CHẠY — kết luận sai và nguy
//      hiểm, vì nó đẩy người ta đi tìm lỗi ở dây chuyền thay vì ở bảng phân quyền. Lượt chạy
//      bị từ chối được ghi vào `scheduled_report_logs` với status FAILED + đúng câu lý do, nên
//      cái sai hiện ra ở chỗ sửa được (bảng phân quyền) chứ không im lặng.
//
//   ⚠ KHÔNG chặn admin: `scopeEmptyReason` chỉ khác `null` khi tài khoản KHÔNG phải admin VÀ
//   không có gán nào. Lịch do admin tạo vẫn tổng hợp toàn hệ thống, y như trước.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Danh tính + nhãn phạm vi của người tạo lịch, đã được phân giải lại cho lượt chạy này. */
interface ScheduleScope {
  actor: ExportActor;
  scopeApplied: boolean;
  scopeNote?: string;
}

function scheduleOwnerDenied(reason: string, message: string): never {
  throw appError(
    'FORBIDDEN',
    'PERMISSION_DENIED',
    { action: 'canExport', reason },
    message,
  );
}

/**
 * Phân giải phạm vi của một lượt chạy hẹn giờ từ NGƯỜI TẠO LỊCH. Fail-closed — xem khối
 * QUYẾT ĐỊNH ở trên. Không bao giờ trả về "không lọc gì cả" cho một người tạo không xác định.
 */
export async function resolveScheduleScope(report: {
  createdBy?: number | null;
}): Promise<ScheduleScope> {
  const createdBy = report.createdBy ?? 0;
  if (!createdBy || createdBy <= 0) {
    scheduleOwnerDenied(
      'scheduleOwnerUnknown',
      'Không xác định được NGƯỜI TẠO LỊCH của báo cáo này, nên không thể xác định phạm vi dữ ' +
        'liệu được phép tổng hợp. Lượt chạy bị từ chối thay vì gửi đi số liệu toàn hệ thống.',
    );
  }

  const owner = await db.getUserById(createdBy);
  if (!owner) {
    scheduleOwnerDenied(
      'scheduleOwnerMissing',
      `Người tạo lịch (id ${createdBy}) không còn tồn tại, nên không thể xác định phạm vi dữ ` +
        'liệu. Lượt chạy bị từ chối. Hãy tạo lại lịch bằng một tài khoản đang hoạt động.',
    );
  }
  if (owner.isActive === false) {
    scheduleOwnerDenied(
      'scheduleOwnerDisabled',
      `Tài khoản NGƯỜI TẠO LỊCH (${owner.username ?? owner.id}) đã bị vô hiệu hoá, nên lượt ` +
        'chạy này bị từ chối — một cái lịch bỏ quên không được tiếp tục xuất số liệu thay cho ' +
        'một tài khoản đã tắt.',
    );
  }

  const actor: ExportActor = { id: owner.id, role: owner.role };
  const scope = await resolveExportScope(actor);
  if (scope.scopeEmptyReason) {
    // Câu đầy đủ nói rõ ĐÂY LÀ PHẠM VI RỖNG — cố ý KHÔNG dùng cụm "không có dữ liệu".
    scheduleOwnerDenied('noFactoryAssigned', scope.scopeMessage ?? NO_FACTORY_ASSIGNMENT_MESSAGE);
  }

  return { actor, scopeApplied: scope.scopeApplied, scopeNote: exportScopeNote(scope) };
}

/**
 * ★★★ Mệnh đề SQL tenant của người tạo lịch — **một biến RIÊNG, cố ý**.
 *
 * ⚠⚠ Vì sao KHÔNG gộp vào `ScheduleScope`. `resolveDataScope` trả cả `filter`, một đối tượng SQL
 * drizzle mang THAM CHIẾU VÒNG (`PgTable → PgSerial → table`). Nếu `filter` sống chung một mức
 * với ba ô nhãn thì `scope = resolved` rồi `{...scope}` là phép gán HỢP LỆ với `tsc` (TypeScript
 * chỉ cấm thuộc tính thừa với *object literal*) mà lúc chạy đẩy `filter` vào đáp ứng JSON ⇒
 * superjson chết `Converting circular structure to JSON`. Đã xảy ra thật ngày 2026-08-17 trên
 * `dashboard.getStats`, sống sót qua `tsc` sạch cả hai config VÀ 220 ca test.
 *
 * Ở đây `ScheduleScope` chỉ mang CHỮ; mệnh đề SQL chỉ tồn tại trong biến cục bộ của hàm gọi và
 * không có đường nào đi ra nội dung báo cáo. Khuôn theo `externalReportService` (:698–:710).
 *
 * `undefined` = vai toàn quyền ⇒ KHÔNG áp cổng nào (chiều DƯƠNG chống vá quá tay).
 */
async function scheduleTenantFilter(actor: ExportActor): Promise<SQL | undefined> {
  const { getAccessFilterConditions } = await import('../_core/accessControl');
  return getAccessFilterConditions(actor.id, actor.role);
}

class ScheduledReportService {
  /**
   * Compute the next scheduled run strictly after `after` (default: now).
   *
   * Doc 27 §6 A1 (P0): scheduleTime is a FACTORY-timezone wall-clock time.
   * The old implementation used bare `new Date()` + setHours, i.e. the
   * server/OS timezone — on a UTC host a "06:00 daily" report drifted to
   * 06:00 UTC (13:00 Asia/Ho_Chi_Minh), the +7h manual-data-patch incident
   * (doc 27 §6 A1). Now delegates to nextRunInZone, which evaluates
   * the schedule on the factory wall clock (env FACTORY_TZ, default
   * Asia/Ho_Chi_Minh) and returns the correct UTC instant, DST-safe.
   */
  private computeNextRun(
    frequency: ReportFrequency,
    scheduleTime: string,
    opts?: { dayOfWeek?: number | null; dayOfMonth?: number | null; after?: Date },
  ): Date {
    return nextRunInZone({
      frequency,
      time: scheduleTime,
      dayOfWeek: opts?.dayOfWeek,
      dayOfMonth: opts?.dayOfMonth,
      timeZone: getFactoryTimezone(),
      after: opts?.after,
    });
  }

  /**
   * Generate report content
   */
  async generateReportContent(report: ScheduledReport): Promise<ReportContent> {
    const { start, end } = report.window ?? this.getReportPeriod(report.frequency);

    // ★★★ Trục phạm vi của lượt chạy — fail-closed, phân giải LẠI mỗi lượt (xem khối
    // "PHẠM VI CỦA BÁO CÁO HẸN GIỜ" ở đầu file). Đứng TRƯỚC mọi truy vấn: một lượt bị từ chối
    // không được chạm vào dữ liệu, kể cả để rồi vứt đi.
    const scope = await resolveScheduleScope(report);

    // ⚠ MỘT nguồn duy nhất, có chủ đích. Trước đây bảng "theo Công ty" đến từ
    // `getYieldRateByCorporate` còn bảng "theo Nhà máy" từ `getYieldRateByFactory` — hai truy
    // vấn với hai luật phân quyền KHÁC NHAU: cái đầu chỉ nhìn gán CÔNG TY và trả rỗng cho người
    // chỉ được gán NHÀ MÁY. Giữ cả hai sau khi truyền danh tính xuống sẽ sinh ra một email tự
    // mâu thuẫn — "Tổng kiểm tra: 0" ngay bên trên một bảng có 22.995 dòng. Vì hai truy vấn gộp
    // trên CÙNG một tập hàng, cuộn bảng nhà máy theo `corporateCode` cho ra ĐÚNG những con số
    // mà bảng công ty lẽ ra phải có, nên ở đây chỉ còn một lượt đọc và không còn chỗ để lệch.
    const yieldByFactory = await db.getYieldRateByFactory({
      corporateCode: report.corporateCode,
      startDate: start,
      endDate: end,
      userId: scope.actor.id,
      // `getYieldRateByFactory` khai kiểu `'admin' | 'user'` và chỉ so `!== 'admin'`; mọi vai
      // không phải admin đều rơi vào cùng một nhánh, nên phép quy về hai giá trị này là ĐÚNG
      // NGHĨA chứ không phải một phép ép kiểu để `tsc` im.
      userRole: scope.actor.role === 'admin' ? 'admin' : 'user',
    });

    const byCorporate = new Map<string, { corporateCode: string; totalInspections: number; okCount: number; ngCount: number; ntfCount: number }>();
    for (const f of yieldByFactory) {
      const agg = byCorporate.get(f.corporateCode) ?? {
        corporateCode: f.corporateCode,
        totalInspections: 0,
        okCount: 0,
        ngCount: 0,
        ntfCount: 0,
      };
      agg.totalInspections += f.totalInspections;
      agg.okCount += f.okCount;
      agg.ngCount += f.ngCount;
      agg.ntfCount += f.ntfCount;
      byCorporate.set(f.corporateCode, agg);
    }
    const yieldByCorporate = [...byCorporate.values()].map((c) => ({
      ...c,
      yieldRate: c.totalInspections > 0
        ? (((c.okCount + c.ntfCount) / c.totalInspections) * 100).toFixed(2)
        : '0.00',
    }));

    // Calculate summary
    const totalInspections = yieldByCorporate.reduce((sum, c) => sum + c.totalInspections, 0);
    const okCount = yieldByCorporate.reduce((sum, c) => sum + c.okCount, 0);
    const ngCount = yieldByCorporate.reduce((sum, c) => sum + c.ngCount, 0);
    const ntfCount = yieldByCorporate.reduce((sum, c) => sum + c.ntfCount, 0);
    const yieldRate = totalInspections > 0
      ? ((okCount / totalInspections) * 100).toFixed(2)
      : '0.00';

    // Get top NG machines from factory stats
    interface NGMachine {
      machineName: string;
      ngCount: number;
      yieldRate: string;
    }
    
    const topNGMachines: NGMachine[] = yieldByFactory
      .filter(f => f.ngCount > 0)
      .sort((a, b) => b.ngCount - a.ngCount)
      .slice(0, 10)
      .map(f => ({
        machineName: f.factoryCode,
        ngCount: f.ngCount,
        yieldRate: f.yieldRate,
      }));

    return {
      title: this.getReportTitle(report),
      period: { start, end },
      // Email/tài liệu TỰ KHAI phạm vi: một báo cáo 22.995 trông y hệt báo cáo toàn công ty
      // 22.996, và email thì được chuyển tiếp đi khắp nơi, mất sạch ngữ cảnh.
      scopeApplied: scope.scopeApplied,
      scopeNote: scope.scopeNote,
      summary: {
        totalInspections,
        okCount,
        ngCount,
        ntfCount,
        yieldRate,
      },
      corporateStats: yieldByCorporate.map(c => ({
        corporateCode: c.corporateCode,
        totalInspections: c.totalInspections,
        yieldRate: c.yieldRate,
      })),
      factoryStats: yieldByFactory.map(f => ({
        factoryCode: f.factoryCode,
        corporateCode: f.corporateCode,
        totalInspections: f.totalInspections,
        yieldRate: f.yieldRate,
      })),
      topNGMachines,
      generatedAt: new Date(),
    };
  }

  /**
   * Get report period based on frequency
   */
  private getReportPeriod(frequency: ReportFrequency): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (frequency) {
      case 'daily':
        start.setDate(start.getDate() - 1);
        break;
      case 'weekly':
        start.setDate(start.getDate() - 7);
        break;
      case 'monthly':
        start.setMonth(start.getMonth() - 1);
        break;
    }

    return { start, end };
  }

  /**
   * Get report title
   */
  private getReportTitle(report: ScheduledReport): string {
    const periodMap = {
      daily: 'Hàng ngày',
      weekly: 'Hàng tuần',
      monthly: 'Hàng tháng',
    };
    return `Báo cáo ${periodMap[report.frequency]} - ${report.name}`;
  }

  /**
   * Format report as HTML with email template branding
   */
  async formatReportHtml(content: ReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    const formatNumber = (num: number) => num.toLocaleString('vi-VN');

    // Get default template if not provided
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }

    // Default values if no template
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const textColor = templateConfig?.textColor || '#333333';
    const linkColor = templateConfig?.linkColor || '#2563eb';
    const fontFamily = templateConfig?.fontFamily || 'Arial, sans-serif';
    const headingFontFamily = templateConfig?.headingFontFamily || fontFamily;
    const companyName = templateConfig?.companyName || 'SYNAPSE';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    const copyrightText = templateConfig?.copyrightText || `© ${new Date().getFullYear()} ${companyName}`;
    const contactEmail = templateConfig?.contactEmail;
    const contactPhone = templateConfig?.contactPhone;
    const contactAddress = templateConfig?.contactAddress;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: ${fontFamily}; line-height: 1.6; color: ${textColor}; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #ffffff; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    .company-name { font-family: ${headingFontFamily}; font-size: 14px; color: ${secondaryColor}; margin: 0; }
    h1 { font-family: ${headingFontFamily}; color: ${primaryColor}; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px; }
    h2 { font-family: ${headingFontFamily}; color: ${secondaryColor}; margin-top: 30px; }
    a { color: ${linkColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: ${primaryColor}; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .yield-high { color: #16a34a; }
    .yield-medium { color: #ca8a04; }
    .yield-low { color: #dc2626; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
    .footer-contact { margin-top: 10px; }
    .footer-contact a { color: ${linkColor}; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <p class="company-name">${companyName}</p>
  </div>
  <h1>${content.title}</h1>
  <p>Kỳ báo cáo: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  ${content.scopeNote ? `<p style="font-size:13px;color:${secondaryColor};background:${backgroundColor};padding:8px 12px;border-radius:6px;margin:8px 0;"><strong>${content.scopeNote}</strong></p>` : ''}

  <div class="summary">
    <h2 style="margin-top: 0;">Tổng quan</h2>
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${formatNumber(content.summary.totalInspections)}</div>
        <div class="stat-label">Tổng kiểm tra</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ${this.getYieldClass(parseFloat(content.summary.yieldRate))}">${content.summary.yieldRate}%</div>
        <div class="stat-label">Yield Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #16a34a;">${formatNumber(content.summary.okCount)}</div>
        <div class="stat-label">OK</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #dc2626;">${formatNumber(content.summary.ngCount + content.summary.ntfCount)}</div>
        <div class="stat-label">NG/NTF</div>
      </div>
    </div>
  </div>

  <h2>Thống kê theo Công ty</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.corporateStats.map(c => `
        <tr>
          <td>${c.corporateCode}</td>
          <td>${formatNumber(c.totalInspections)}</td>
          <td class="${this.getYieldClass(parseFloat(c.yieldRate))}">${c.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Thống kê theo Nhà máy</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Nhà máy</th>
        <th>Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.factoryStats.slice(0, 20).map(f => `
        <tr>
          <td>${f.factoryCode}</td>
          <td>${f.corporateCode}</td>
          <td>${formatNumber(f.totalInspections)}</td>
          <td class="${this.getYieldClass(parseFloat(f.yieldRate))}">${f.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${content.topNGMachines.length > 0 ? `
  <h2>Top 10 Máy có NG cao nhất</h2>
  <table>
    <thead>
      <tr>
        <th>Tên máy</th>
        <th>Số lượng NG</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.topNGMachines.map(m => `
        <tr>
          <td>${m.machineName}</td>
          <td style="color: #dc2626;">${formatNumber(m.ngCount)}</td>
          <td class="${this.getYieldClass(parseFloat(m.yieldRate))}">${m.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
    ${(contactEmail || contactPhone || contactAddress) ? `
    <div class="footer-contact">
      ${contactEmail ? `<p>Email: <a href="mailto:${contactEmail}">${contactEmail}</a></p>` : ''}
      ${contactPhone ? `<p>Điện thoại: ${contactPhone}</p>` : ''}
      ${contactAddress ? `<p>Địa chỉ: ${contactAddress}</p>` : ''}
    </div>
    ` : ''}
    <p style="margin-top: 15px; font-size: 11px; color: #999;">${copyrightText}</p>
  </div>
</body>
</html>
    `;
  }

  private getYieldClass(yieldRate: number): string {
    if (yieldRate >= 95) return 'yield-high';
    if (yieldRate >= 85) return 'yield-medium';
    return 'yield-low';
  }

  /**
   * Generate and send a one-time report
   */
  /** ⚠ `actor` BẮT BUỘC — xem chú thích ở `previewReport`. */
  async generateAndSendReport(params: {
    name: string;
    type: ReportType;
    frequency: ReportFrequency;
    recipients: string[];
    corporateCode?: string;
    factoryCode?: string;
    actor: ExportActor;
  }): Promise<ReportContent> {
    const report: ScheduledReport = {
      id: 0,
      name: params.name,
      type: params.type,
      frequency: params.frequency,
      recipients: params.recipients,
      corporateCode: params.corporateCode,
      factoryCode: params.factoryCode,
      isEnabled: true,
      createdBy: params.actor.id,
      createdAt: new Date(),
    };

    const content = await this.generateReportContent(report);
    const html = await this.formatReportHtml(content);

    // Send to all recipients
    for (const email of params.recipients) {
      await sendEmail({
        to: email,
        subject: `[SYNAPSE] ${content.title}`,
        html,
      });
    }

    return content;
  }

  /**
   * Generate OEE Report Content — reads from persistent oeeMetrics DB table,
   * NOT the in-memory socket store (which is lost on server restart).
   */
  async generateOEEReportContent(report: ScheduledReport): Promise<OEEReportContent> {
    const { start, end } = report.window ?? this.getReportPeriod(report.frequency);

    // ★★★ Trục phạm vi của lượt chạy — fail-closed, phân giải LẠI mỗi lượt. Đứng TRƯỚC mọi truy
    // vấn (kể cả trước `getDb`): một lượt bị từ chối không được chạm dữ liệu, kể cả để rồi vứt đi.
    const scope = await resolveScheduleScope(report);
    const scopeFilter = await scheduleTenantFilter(scope.actor);

    // Query persisted OEE metrics from DB for the report period
    const { oeeMetrics, downtimeEvents } = await import('../../drizzle/schema');
    const { getDb } = await import('../db/connection');
    const { and, gte, lte, desc } = await import('drizzle-orm');

    // ⚠ `oee_metrics`/`downtime_events` KHÔNG có cột tenant. Cổng dùng LẠI nguyên văn mệnh đề
    // của `getAccessFilterConditions` trong một truy vấn phụ trên `product_inspections` — không
    // dựng lại luật qua machines→lines→factories (nguồn luật thứ hai sẽ trôi). Xem docblock
    // "PHẠM VI CHO BẢNG KHÔNG CÓ CỘT TENANT" ở `db/reportAggregators.ts`.
    const window = { start, end };
    const oeeGate = scopeFilter ? tenantMachineGate(oeeMetrics.machineId, scopeFilter, window) : undefined;
    const downtimeGate = scopeFilter ? tenantMachineGate(downtimeEvents.machineId, scopeFilter, window) : undefined;

    const conn = await getDb();
    const rows = conn ? await conn
      .select({
        machineId: oeeMetrics.machineId,
        machineCode: oeeMetrics.machineCode,
        availability: oeeMetrics.availability,
        performance: oeeMetrics.performance,
        quality: oeeMetrics.quality,
        oee: oeeMetrics.oee,
        timestamp: oeeMetrics.timestamp,
      })
      .from(oeeMetrics)
      .where(and(gte(oeeMetrics.timestamp, start), lte(oeeMetrics.timestamp, end), oeeGate))
      .orderBy(desc(oeeMetrics.timestamp))
      .limit(500) : [];

    // Latest OEE per machine (most recent reading in the period)
    const latestByMachine = new Map<number, typeof rows[0]>();
    for (const row of rows) {
      if (!latestByMachine.has(row.machineId)) latestByMachine.set(row.machineId, row);
    }
    const oeeData = Array.from(latestByMachine.values()).map(r => ({
      machineId: r.machineId,
      machineCode: r.machineCode,
      // oeeMetrics stores as percentage×100 (e.g. 85.5% → 8550); convert back to 0-100
      availability: Number(r.availability) / 100,
      performance: Number(r.performance) / 100,
      quality: Number(r.quality) / 100,
      oee: Number(r.oee) / 100,
      timestamp: r.timestamp,
    }));

    // Calculate averages
    const avgAvailability = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.availability, 0) / oeeData.length : 0;
    const avgPerformance = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.performance, 0) / oeeData.length : 0;
    const avgQuality = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.quality, 0) / oeeData.length : 0;
    const avgOEE = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.oee, 0) / oeeData.length : 0;

    // Downtime summary from persisted downtimeEvents table
    const dtRows = conn ? await conn
      .select({
        category: downtimeEvents.category,
        duration: downtimeEvents.duration,
      })
      .from(downtimeEvents)
      .where(and(gte(downtimeEvents.startTime, start), lte(downtimeEvents.startTime, end), downtimeGate)) : [];

    const downtimeByCategory: Record<string, number> = {};
    let totalDowntime = 0;
    for (const d of dtRows) {
      if (d.duration) {
        downtimeByCategory[d.category] = (downtimeByCategory[d.category] || 0) + d.duration;
        totalDowntime += d.duration;
      }
    }

    // Get machines needing attention (OEE < 80%)
    const machinesNeedingAttention = oeeData
      .filter(m => m.oee < 80)
      .sort((a, b) => a.oee - b.oee)
      .slice(0, 5);
    
    return {
      title: `Báo cáo OEE ${this.getReportPeriodLabel(report.frequency)}`,
      period: { start, end },
      // Email/tài liệu TỰ KHAI phạm vi: một báo cáo OEE của MỘT nhà máy trông y hệt báo cáo
      // toàn công ty, và email thì được chuyển tiếp đi khắp nơi, mất sạch ngữ cảnh.
      scopeApplied: scope.scopeApplied,
      scopeNote: scope.scopeNote,
      summary: {
        totalMachines: oeeData.length,
        avgAvailability: avgAvailability.toFixed(2),
        avgPerformance: avgPerformance.toFixed(2),
        avgQuality: avgQuality.toFixed(2),
        avgOEE: avgOEE.toFixed(2),
        totalDowntime,
      },
      machineOEE: oeeData,
      downtimeByCategory,
      machinesNeedingAttention,
      generatedAt: new Date(),
    };
  }
  
  /**
   * Generate Machine Health Report Content
   */
  async generateMachineHealthReportContent(report: ScheduledReport): Promise<MachineHealthReportContent> {
    const { start, end } = report.window ?? this.getReportPeriod(report.frequency);

    // ★★★ Trục phạm vi — fail-closed, đứng TRƯỚC mọi lượt đọc số liệu máy.
    const scope = await resolveScheduleScope(report);
    const scopeFilter = await scheduleTenantFilter(scope.actor);

    // Import health functions. OEE now comes from the canonical single source
    // (oeeService.getAllMachinesOEELive) instead of the retired in-memory socket path.
    const { getMachineHealthScore } = await import('../_core/socket');
    const { getAllMachinesOEELive } = await import('./oeeService');

    // ⚠ `getAllMachinesOEELive` dựng danh sách máy TRONG BỘ NHỚ (không có chỗ nào nhét mệnh đề
    // WHERE vào), và `machines` không mang mã tenant. Nên cổng phạm vi là bản JS của CÙNG truy
    // vấn phụ: tập máy có bản ghi kiểm nằm trong phạm vi người tạo lịch, trong CÙNG cửa sổ.
    // Vai toàn quyền (`scopeFilter === undefined`) KHÔNG đi qua cổng — giữ nguyên hành vi cũ.
    const scopedMachineIds = scopeFilter
      ? new Set(await getTenantScopedMachineIds(scopeFilter, { start, end }))
      : undefined;

    // Get all OEE metrics and calculate health scores (live values may be null when
    // a machine lacks uptime/production data → coalesce to 0 for the rollup).
    const allOEE = (await getAllMachinesOEELive())
      .filter(m => !scopedMachineIds || scopedMachineIds.has(m.machineId))
      .map(m => ({
      machineId: m.machineId,
      machineCode: m.machineCode,
      oee: m.oee ?? 0,
      availability: m.availability ?? 0,
      quality: m.quality ?? 0,
    }));
    const healthData: Array<{
      machineId: number;
      machineCode: string;
      healthScore: number;
      oee: number;
      status: 'healthy' | 'warning' | 'critical';
    }> = [];
    
    for (const metrics of allOEE) {
      const health = getMachineHealthScore(metrics.machineId);
      const score = health?.score || metrics.oee * 0.8 + metrics.availability * 0.1 + metrics.quality * 0.1;
      
      healthData.push({
        machineId: metrics.machineId,
        machineCode: metrics.machineCode,
        healthScore: score,
        oee: metrics.oee,
        status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical',
      });
    }
    
    // Count by status
    const healthyCount = healthData.filter(m => m.status === 'healthy').length;
    const warningCount = healthData.filter(m => m.status === 'warning').length;
    const criticalCount = healthData.filter(m => m.status === 'critical').length;
    
    // Machines needing maintenance
    const machinesNeedingMaintenance = healthData
      .filter(m => m.status === 'critical' || m.status === 'warning')
      .sort((a, b) => a.healthScore - b.healthScore);
    
    return {
      title: `Báo cáo Sức khỏe Máy ${this.getReportPeriodLabel(report.frequency)}`,
      period: { start, end },
      // Tài liệu tự khai phạm vi — xem chú thích cùng nội dung ở `generateOEEReportContent`.
      scopeApplied: scope.scopeApplied,
      scopeNote: scope.scopeNote,
      summary: {
        totalMachines: healthData.length,
        healthyCount,
        warningCount,
        criticalCount,
        avgHealthScore: healthData.length > 0 
          ? (healthData.reduce((sum, m) => sum + m.healthScore, 0) / healthData.length).toFixed(2)
          : '0',
      },
      machineHealth: healthData,
      machinesNeedingMaintenance,
      generatedAt: new Date(),
    };
  }
  
  /**
   * Format OEE Report as HTML
   */
  async formatOEEReportHtml(content: OEEReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }
    
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const companyName = templateConfig?.companyName || 'SYNAPSE';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    h1 { color: ${primaryColor}; }
    h2 { color: ${secondaryColor}; margin-top: 30px; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: ${primaryColor}; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .oee-high { color: #16a34a; }
    .oee-medium { color: #ca8a04; }
    .oee-low { color: #dc2626; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <h1>${content.title}</h1>
    <p>Giai đoạn: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  </div>
  ${content.scopeNote ? `<p style="font-size:13px;color:${secondaryColor};background:${backgroundColor};padding:8px 12px;border-radius:6px;margin:8px 0;"><strong>${content.scopeNote}</strong></p>` : ''}

  <h2>Tổng quan OEE</h2>
  <div class="summary">
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgOEE}%</div>
        <div class="stat-label">OEE Trung bình</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgAvailability}%</div>
        <div class="stat-label">Availability</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgPerformance}%</div>
        <div class="stat-label">Performance</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgQuality}%</div>
        <div class="stat-label">Quality</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.totalMachines}</div>
        <div class="stat-label">Tổng số máy</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.totalDowntime} phút</div>
        <div class="stat-label">Tổng Downtime</div>
      </div>
    </div>
  </div>
  
  ${content.machinesNeedingAttention.length > 0 ? `
  <h2>Máy cần chú ý (OEE < 80%)</h2>
  <table>
    <thead>
      <tr>
        <th>Máy</th>
        <th>OEE</th>
        <th>Availability</th>
        <th>Performance</th>
        <th>Quality</th>
      </tr>
    </thead>
    <tbody>
      ${content.machinesNeedingAttention.map(m => `
      <tr>
        <td>${m.machineCode}</td>
        <td class="${m.oee >= 70 ? 'oee-medium' : 'oee-low'}">${m.oee.toFixed(1)}%</td>
        <td>${m.availability.toFixed(1)}%</td>
        <td>${m.performance.toFixed(1)}%</td>
        <td>${m.quality.toFixed(1)}%</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}
  
  <h2>Thống kê Downtime theo loại</h2>
  <table>
    <thead>
      <tr>
        <th>Loại</th>
        <th>Thời gian (phút)</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(content.downtimeByCategory).map(([category, duration]) => `
      <tr>
        <td>${category === 'planned' ? 'Kế hoạch' : 
             category === 'unplanned' ? 'Ngoài kế hoạch' :
             category === 'breakdown' ? 'Hỏng hóc' :
             category === 'changeover' ? 'Đổi sản phẩm' :
             category === 'maintenance' ? 'Bảo trì' : 'Khác'}</td>
        <td>${duration}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  
  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
  </div>
</body>
</html>
    `;
  }
  
  /**
   * Format Machine Health Report as HTML
   */
  async formatMachineHealthReportHtml(content: MachineHealthReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }
    
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const companyName = templateConfig?.companyName || 'SYNAPSE';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    h1 { color: ${primaryColor}; }
    h2 { color: ${secondaryColor}; margin-top: 30px; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; }
    .stat-value.healthy { color: #16a34a; }
    .stat-value.warning { color: #ca8a04; }
    .stat-value.critical { color: #dc2626; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .status-healthy { color: #16a34a; font-weight: bold; }
    .status-warning { color: #ca8a04; font-weight: bold; }
    .status-critical { color: #dc2626; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <h1>${content.title}</h1>
    <p>Giai đoạn: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  </div>
  ${content.scopeNote ? `<p style="font-size:13px;color:${secondaryColor};background:${backgroundColor};padding:8px 12px;border-radius:6px;margin:8px 0;"><strong>${content.scopeNote}</strong></p>` : ''}

  <h2>Tổng quan Sức khỏe Máy</h2>
  <div class="summary">
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgHealthScore}%</div>
        <div class="stat-label">Health Score TB</div>
      </div>
      <div class="stat-card">
        <div class="stat-value healthy">${content.summary.healthyCount}</div>
        <div class="stat-label">Khỏe mạnh</div>
      </div>
      <div class="stat-card">
        <div class="stat-value warning">${content.summary.warningCount}</div>
        <div class="stat-label">Cần chú ý</div>
      </div>
      <div class="stat-card">
        <div class="stat-value critical">${content.summary.criticalCount}</div>
        <div class="stat-label">Cần bảo trì</div>
      </div>
    </div>
  </div>
  
  ${content.machinesNeedingMaintenance.length > 0 ? `
  <h2>Máy cần bảo trì</h2>
  <table>
    <thead>
      <tr>
        <th>Máy</th>
        <th>Health Score</th>
        <th>OEE</th>
        <th>Trạng thái</th>
      </tr>
    </thead>
    <tbody>
      ${content.machinesNeedingMaintenance.map(m => `
      <tr>
        <td>${m.machineCode}</td>
        <td>${m.healthScore.toFixed(1)}%</td>
        <td>${m.oee.toFixed(1)}%</td>
        <td class="status-${m.status}">${m.status === 'healthy' ? 'Khỏe mạnh' : m.status === 'warning' ? 'Cần chú ý' : 'Cần bảo trì'}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : `
  <p style="text-align: center; color: #16a34a; font-weight: bold;">Tất cả máy đều hoạt động tốt!</p>
  `}
  
  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
  </div>
</body>
</html>
    `;
  }
  
  private getReportPeriodLabel(frequency: ReportFrequency): string {
    const periodMap = {
      daily: 'Hàng ngày',
      weekly: 'Hàng tuần',
      monthly: 'Hàng tháng',
    };
    return periodMap[frequency];
  }

  /**
   * Preview report content without sending
   */
  /**
   * ⚠ `actor` là BẮT BUỘC (2026-08-17). Trước đây hàm này ghi cứng `createdBy: 0`, và số 0 ấy
   * đi thẳng vào `generateReportContent` — tức mọi bản xem trước, kể cả bản do cron dựng cho
   * một lịch của engineer, đều tổng hợp TOÀN CỤC. Đặt vào chữ ký để "quên truyền" thành lỗi
   * biên dịch chứ không phải một lỗ im lặng.
   */
  async previewReport(params: {
    frequency: ReportFrequency;
    corporateCode?: string;
    factoryCode?: string;
    actor: ExportActor;
    window?: { start: Date; end: Date };
  }): Promise<{ content: ReportContent; html: string }> {
    const report: ScheduledReport = {
      id: 0,
      name: 'Preview Report',
      type: 'statistics',
      frequency: params.frequency,
      recipients: [],
      corporateCode: params.corporateCode,
      factoryCode: params.factoryCode,
      isEnabled: true,
      createdBy: params.actor.id,
      createdAt: new Date(),
      window: params.window,
    };

    const content = await this.generateReportContent(report);
    const html = await this.formatReportHtml(content);

    return { content, html };
  }
}

// Singleton instance
export const scheduledReportService = new ScheduledReportService();

export default scheduledReportService;
