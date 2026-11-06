/**
 * ★ Pha 0 P0-6 (2026-11-04) — giữ dữ liệu + DR verify BẬT mặc định (chỉ "=false" tắt khẩn) và SAO LƯU MẶC ĐỊNH theo lịch khi chưa có lịch nào.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lich = vi.hoisted(() => ({ goi: [] as string[], dsLich: [] as unknown[], dump: [] as Array<{ tables?: string[]; label?: string }>, xoa: [] as string[], tep: [] as Array<{ fileName: string }> }));
vi.mock("node-cron", () => ({
  default: { schedule: (expr: string) => (lich.goi.push(expr), { stop: () => undefined }) },
  schedule: (expr: string) => (lich.goi.push(expr), { stop: () => undefined }),
}));
vi.mock("../db", () => ({ listScheduledBackups: async () => lich.dsLich }));
vi.mock("./backupService", async (orig) => {
  const that = await orig<typeof import("./backupService")>();
  return {
    TABLE_CATEGORIES: that.TABLE_CATEGORIES,
    createPgDump: async (o: { tables?: string[]; label?: string }) => (lich.dump.push(o), { fileName: `backup_${o.label}_x.sql`, fileSizeBytes: 1, tableCount: o.tables?.length ?? 0 }),
    listBackupFiles: () => lich.tep,
    deleteBackupFile: (f: string) => void lich.xoa.push(f),
  };
});

import { retentionBat } from "./dataRetentionService";
import { isDisasterRecoveryEnabled } from "./disasterRecoveryService";
import * as sl from "./backupSchedulerService";

const giu = { ...process.env };
beforeEach(() => {
  lich.goi = [];
  lich.dsLich = [];
  lich.dump = [];
  lich.xoa = [];
  lich.tep = [];
  sl.shutdownScheduledBackups();
});
afterEach(() => {
  for (const k of ["DATA_RETENTION_ENABLED", "DR_VERIFY_ENABLED", "BACKUP_MAC_DINH", "DATABASE_URL"]) {
    if (giu[k] === undefined) delete process.env[k];
    else process.env[k] = giu[k];
  }
});

describe("P0-6 — bật mặc định, chỉ '=false' tắt", () => {
  it("★★★ giữ dữ liệu: vắng / 'true' / '1' ⇒ BẬT; 'false' ⇒ tắt", () => {
    for (const [v, kq] of [[undefined, true], ["true", true], ["1", true], ["", true], ["false", false]] as const) {
      if (v === undefined) delete process.env.DATA_RETENTION_ENABLED;
      else process.env.DATA_RETENTION_ENABLED = v;
      expect(retentionBat(), String(v)).toBe(kq);
    }
  });
  it("★★★ DR verify: vắng ⇒ BẬT; 'false' ⇒ tắt", () => {
    delete process.env.DR_VERIFY_ENABLED;
    expect(isDisasterRecoveryEnabled()).toBe(true);
    process.env.DR_VERIFY_ENABLED = "false";
    expect(isDisasterRecoveryEnabled()).toBe(false);
  });
});

describe("P0-6 — sao lưu mặc định theo lịch", () => {
  it("★★★ chưa có lịch bật ⇒ đặt lịch mặc định 02:30 hằng ngày; có lịch ⇒ KHÔNG; BACKUP_MAC_DINH=false ⇒ KHÔNG", async () => {
    await sl.initializeScheduledBackups();
    expect(lich.goi).toEqual([sl.CRON_SAO_LUU_MAC_DINH]);
    expect(sl.laSaoLuuMacDinhDangLich()).toBe(true);
    sl.shutdownScheduledBackups();
    expect(sl.laSaoLuuMacDinhDangLich()).toBe(false);
    lich.goi = [];
    lich.dsLich = [{ id: 1, schedule: "DAILY", scheduleTime: "03:00" }];
    await sl.initializeScheduledBackups();
    expect(lich.goi).toEqual(["0 3 * * *"]);
    expect(sl.laSaoLuuMacDinhDangLich()).toBe(false);
    lich.goi = [];
    lich.dsLich = [];
    process.env.BACKUP_MAC_DINH = "false";
    await sl.initializeScheduledBackups();
    expect(lich.goi).toEqual([]);
  });
  it("★★ phạm vi: mọi nhóm TRỪ inspections và bảng chuỗi thời gian lớn; có users / permissions / audit_logs", () => {
    const b = sl.bangSaoLuuMacDinh();
    for (const co of ["users", "permissions", "machines", "audit_logs", "production_orders", "ai_models"]) expect(b).toContain(co);
    for (const khong of ["product_inspections", "measurement_results", "machine_health_history", "machine_heartbeats", "machine_status_logs"]) expect(b).not.toContain(khong);
  });
  it("★★★ một lượt: pg_dump đúng bảng + nhãn mac_dinh, giữ 7 tệp gần nhất (xoá tệp cũ hơn của CHÍNH nhãn này)", async () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/x";
    lich.tep = Array.from({ length: 9 }, (_, i) => ({ fileName: `backup_mac_dinh_${9 - i}.sql` })).concat([{ fileName: "backup_khac_1.sql" }]);
    const kq = await sl.chaySaoLuuMacDinh();
    expect(kq?.fileName).toBe("backup_mac_dinh_x.sql");
    expect(lich.dump[0]).toMatchObject({ label: "mac_dinh", tables: sl.bangSaoLuuMacDinh() });
    expect(lich.xoa).toEqual(["backup_mac_dinh_2.sql", "backup_mac_dinh_1.sql"]);
  });
});
