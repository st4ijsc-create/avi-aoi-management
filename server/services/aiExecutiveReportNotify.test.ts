/**
 * Push-to-managers tests for the automated executive report.
 *
 * Covers:
 *  - recipients resolved by role (default admin,supervisor) + explicit ids, deduped, inactive skipped
 *  - in-app notification sent once per recipient (mocked notificationService)
 *  - email skipped when flag off / SMTP absent; sent when flag on + SMTP present
 *  - fail-safe: a throwing send is caught, others still sent, never throws
 *  - runExecutiveReportNow is a no-op for notify when EXEC_REPORT_NOTIFY_ENABLED=false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (all dynamic-imported inside the service) ─────────────
const getAllUsers = vi.fn();
const sendReportNotification = vi.fn();
const sendEmail = vi.fn();

vi.mock("../db/auth", () => ({ getAllUsers: (...a: unknown[]) => getAllUsers(...a) }));
vi.mock("./notificationService", () => ({
  sendReportNotification: (...a: unknown[]) => sendReportNotification(...a),
}));
vi.mock("../_core/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

// KPI sources / DB / LLM — keep generate path quiet for runExecutiveReportNow.
const getDb = vi.fn();
const getYieldTrendData = vi.fn();
const paretoByDefectType = vi.fn();
const getMachines = vi.fn();
const computeFailureRisk = vi.fn();
const generateNarrative = vi.fn();
const route = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../db/statistics", () => ({ getYieldTrendData: (...a: unknown[]) => getYieldTrendData(...a) }));
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: (...a: unknown[]) => paretoByDefectType(...a) }));
vi.mock("../db/hierarchy", () => ({ getMachines: (...a: unknown[]) => getMachines(...a) }));
vi.mock("./predictiveMaintenanceService", () => ({ computeFailureRisk: (...a: unknown[]) => computeFailureRisk(...a) }));
vi.mock("./aiProviderRouter", () => ({ generateNarrative: (...a: unknown[]) => generateNarrative(...a) }));
vi.mock("./aiModelRouter", () => ({ route: (...a: unknown[]) => route(...a) }));

import {
  notifyExecutiveSummary,
  resolveExecReportRecipients,
  runExecutiveReportNow,
  type ExecutiveSummaryStructured,
} from "./aiExecutiveReport";

function makeSummary(): ExecutiveSummaryStructured {
  return {
    period: "day",
    lang: "vi",
    window: { start: "2026-06-27T00:00:00.000Z", end: "2026-06-28T00:00:00.000Z" },
    headline: "Sản lượng ổn định, FPY 95%.",
    highlights: ["Throughput 1000 (OK 950 / NG 50).", "Lỗi phổ biến: Bridge."],
    risks: ["NG đang tăng."],
    recommendations: ["Ưu tiên xử lý lỗi Bridge."],
    kpiTable: [
      { label: "Sản lượng kiểm", value: "1000" },
      { label: "Tỷ lệ đạt (FPY)", value: "95.0%" },
    ],
    kpis: { ngRate: 5 } as any,
    generatedBy: "offline",
    generatedAt: new Date().toISOString(),
  };
}

const ENV_KEYS = [
  "EXEC_REPORT_NOTIFY_ENABLED",
  "EXEC_REPORT_NOTIFY_ROLES",
  "EXEC_REPORT_NOTIFY_USER_IDS",
  "EXEC_REPORT_EMAIL_ENABLED",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
];

beforeEach(() => {
  vi.clearAllMocks();
  sendReportNotification.mockResolvedValue({ id: 1 });
  sendEmail.mockResolvedValue({ success: true, messageId: "m1" });
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("resolveExecReportRecipients", () => {
  it("matches default roles (admin,supervisor), dedups, and skips inactive", async () => {
    getAllUsers.mockResolvedValue([
      { id: 1, role: "admin", email: "a@x.com", isActive: true },
      { id: 2, role: "supervisor", email: "s@x.com", isActive: true },
      { id: 3, role: "operator", email: "o@x.com", isActive: true }, // not a target role
      { id: 4, role: "admin", email: null, isActive: false }, // inactive → skipped
    ]);

    const recipients = await resolveExecReportRecipients();
    const ids = recipients.map((r) => r.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("honors EXEC_REPORT_NOTIFY_ROLES and merges explicit user ids (deduped)", async () => {
    process.env.EXEC_REPORT_NOTIFY_ROLES = "admin";
    process.env.EXEC_REPORT_NOTIFY_USER_IDS = "3, 1"; // 1 already an admin → deduped
    getAllUsers.mockResolvedValue([
      { id: 1, role: "admin", email: "a@x.com", isActive: true },
      { id: 2, role: "supervisor", email: "s@x.com", isActive: true }, // role not selected now
      { id: 3, role: "operator", email: "o@x.com", isActive: true }, // selected via explicit id
    ]);

    const recipients = await resolveExecReportRecipients();
    expect(recipients.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it("never throws when the users query fails", async () => {
    getAllUsers.mockRejectedValue(new Error("db down"));
    await expect(resolveExecReportRecipients()).resolves.toEqual([]);
  });
});

describe("notifyExecutiveSummary", () => {
  it("sends one in-app notification per recipient with headline + link", async () => {
    getAllUsers.mockResolvedValue([
      { id: 1, role: "admin", email: "a@x.com", isActive: true },
      { id: 2, role: "supervisor", email: "s@x.com", isActive: true },
    ]);

    const stats = await notifyExecutiveSummary(makeSummary(), 42);

    expect(stats.recipients).toBe(2);
    expect(stats.inAppSent).toBe(2);
    expect(sendReportNotification).toHaveBeenCalledTimes(2);
    expect(sendReportNotification).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: expect.stringContaining("Sản lượng"),
        actionUrl: "/management-insight",
        reportId: 42,
      }),
    );
  });

  it("is a safe no-op (no sends) when there are no recipients", async () => {
    getAllUsers.mockResolvedValue([{ id: 9, role: "operator", email: "o@x.com", isActive: true }]);
    const stats = await notifyExecutiveSummary(makeSummary());
    expect(stats.recipients).toBe(0);
    expect(stats.inAppSent).toBe(0);
    expect(sendReportNotification).not.toHaveBeenCalled();
  });

  it("skips email when EXEC_REPORT_EMAIL_ENABLED is off", async () => {
    getAllUsers.mockResolvedValue([{ id: 1, role: "admin", email: "a@x.com", isActive: true }]);
    // SMTP present but flag off.
    process.env.SMTP_HOST = "smtp.x.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASS = "p";

    const stats = await notifyExecutiveSummary(makeSummary());
    expect(stats.emailsSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips email when flag on but SMTP is not configured", async () => {
    getAllUsers.mockResolvedValue([{ id: 1, role: "admin", email: "a@x.com", isActive: true }]);
    process.env.EXEC_REPORT_EMAIL_ENABLED = "true";
    // No SMTP_* set.
    const stats = await notifyExecutiveSummary(makeSummary());
    expect(stats.emailsSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails recipients with addresses when flag on + SMTP configured", async () => {
    getAllUsers.mockResolvedValue([
      { id: 1, role: "admin", email: "a@x.com", isActive: true },
      { id: 2, role: "supervisor", email: null, isActive: true }, // no email → skipped for email
    ]);
    process.env.EXEC_REPORT_EMAIL_ENABLED = "true";
    process.env.SMTP_HOST = "smtp.x.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";

    const stats = await notifyExecutiveSummary(makeSummary());
    expect(stats.inAppSent).toBe(2);
    expect(stats.emailsSent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.com", subject: expect.stringContaining("[SYNAPSE]"), html: expect.any(String) }),
    );
  });

  it("fail-safe: one throwing in-app send is caught, others still sent, never throws", async () => {
    getAllUsers.mockResolvedValue([
      { id: 1, role: "admin", email: "a@x.com", isActive: true },
      { id: 2, role: "supervisor", email: "s@x.com", isActive: true },
    ]);
    sendReportNotification.mockRejectedValueOnce(new Error("socket down")); // first throws

    let stats: any;
    await expect(
      (async () => {
        stats = await notifyExecutiveSummary(makeSummary());
      })(),
    ).resolves.toBeUndefined();
    expect(stats.inAppSent).toBe(1); // second still went out
    expect(sendReportNotification).toHaveBeenCalledTimes(2);
  });
});

describe("runExecutiveReportNow notify wiring", () => {
  beforeEach(() => {
    route.mockReturnValue({ maxTokens: 1536, temperature: 0.3, tier: 2 });
    // Minimal generate path: db stub returns totals + insert id, LLM offline.
    //
    // Vòng sửa 1 (Wave 3 §4.4, task 5) — totals đổi từ {0,0,0} sang khác 0: kỳ 0-lượt-
    // kiểm-tra chính là cái Wave 3 §4.4 dạy hệ PHẢI bỏ qua (không lưu, không báo), nên
    // dùng nó ở đây (một test khẳng định "có báo insight + có notify") sẽ mâu thuẫn với
    // chính hành vi vừa được sửa. Test này muốn kiểm dây nối notify-khi-lưu-thành-công,
    // nên cần một kỳ THẬT có dữ liệu. `where()` cũng cần lộ `.limit()` cho lượt tra trùng
    // (`persistExecutiveSummary`'s dedupe select) — thiếu nó, lệnh bị ném lỗi, nuốt bởi
    // try/catch, trả `null` thay vì id.
    const whereResult: any = {
      then: (resolve: any, reject?: any) => Promise.resolve([{ total: 100, ok: 90, ng: 10 }]).then(resolve, reject),
      limit: () => Promise.resolve([]), // không có bản trùng sẵn có
    };
    const selectBuilder: any = { from: () => selectBuilder, where: () => whereResult };
    getDb.mockResolvedValue({
      select: () => selectBuilder,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 7 }]) }) }),
    });
    getYieldTrendData.mockResolvedValue([]);
    paretoByDefectType.mockResolvedValue({ items: [] });
    getMachines.mockResolvedValue([]);
    generateNarrative.mockResolvedValue({ text: "Headline: ok", provider: "gguf", model: "m" });
    getAllUsers.mockResolvedValue([{ id: 1, role: "admin", email: "a@x.com", isActive: true }]);
  });

  it("pushes in-app notification by default (flag unset)", async () => {
    const { insightId } = await runExecutiveReportNow("day", "vi");
    expect(insightId).toBe(7);
    expect(sendReportNotification).toHaveBeenCalledTimes(1);
  });

  it("does not notify when EXEC_REPORT_NOTIFY_ENABLED=false", async () => {
    process.env.EXEC_REPORT_NOTIFY_ENABLED = "false";
    await runExecutiveReportNow("day", "vi");
    expect(sendReportNotification).not.toHaveBeenCalled();
  });

  /**
   * Vòng sửa cuối (review toàn nhánh, mục 3) — trước sửa này, `runExecutiveReportNow`
   * bắn notify vô điều kiện theo cờ `notifyEnabled`, không quan tâm `persistExecutiveSummary`
   * có thực sự lưu MỘT DÒNG MỚI hay không. Hai case dưới đây từng ĐỎ:
   *  (a) báo cáo RỖNG (§4.4 chặn lưu, id=null) — notify vẫn bắn với `reportId: undefined`.
   *  (b) chống-trùng (§4.3 trả id CŨ) — notify vẫn bắn lại cho một báo cáo đã gửi rồi.
   */
  it("KHÔNG notify khi báo cáo RỖNG — persistExecutiveSummary chặn lưu (id=null, created=false)", async () => {
    // Kỳ KHÔNG có lượt kiểm tra + KHÔNG có máy rủi ro ⇒ hasReportableContent=false.
    const whereResult: any = {
      then: (resolve: any, reject?: any) => Promise.resolve([{ total: 0, ok: 0, ng: 0 }]).then(resolve, reject),
      limit: () => Promise.resolve([]), // không có bản trùng — không phải nhánh chống-trùng
    };
    const selectBuilder: any = { from: () => selectBuilder, where: () => whereResult };
    getDb.mockResolvedValue({
      select: () => selectBuilder,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 999 }]) }) }), // không được gọi nếu đúng
    });
    getYieldTrendData.mockResolvedValue([]);
    paretoByDefectType.mockResolvedValue({ items: [] });
    getMachines.mockResolvedValue([]);

    const { insightId } = await runExecutiveReportNow("day", "vi");
    expect(insightId).toBeNull();
    expect(sendReportNotification).not.toHaveBeenCalled();
  });

  it("KHÔNG notify khi persistExecutiveSummary chống-trùng và trả về id CŨ (đã gửi rồi)", async () => {
    // Kỳ CÓ dữ liệu thật (hasReportableContent=true) NHƯNG dedupe select tìm thấy
    // một dòng trùng tiêu đề đã tồn tại — persistExecutiveSummary phải trả
    // { id: <id cũ>, created: false }, KHÔNG insert dòng mới.
    const whereResult: any = {
      then: (resolve: any, reject?: any) => Promise.resolve([{ total: 100, ok: 90, ng: 10 }]).then(resolve, reject),
      limit: () => Promise.resolve([{ id: 555 }]), // bản trùng đã có sẵn
    };
    const selectBuilder: any = { from: () => selectBuilder, where: () => whereResult };
    const insertValues = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 12345 }]) }));
    getDb.mockResolvedValue({ select: () => selectBuilder, insert: () => ({ values: insertValues }) });
    getYieldTrendData.mockResolvedValue([]);
    paretoByDefectType.mockResolvedValue({ items: [] });
    getMachines.mockResolvedValue([]);

    const { insightId } = await runExecutiveReportNow("day", "vi");
    expect(insightId).toBe(555); // id CŨ vẫn được trả về (không đổi hành vi đọc)
    expect(insertValues).not.toHaveBeenCalled(); // KHÔNG tạo dòng mới
    expect(sendReportNotification).not.toHaveBeenCalled(); // KHÔNG bắn lại cho báo cáo đã gửi
  });
});
