// Schema domain: AOI/AVI Commissioning records (doc 27 §3 C4 + §2 M8 · Wave-2 W2-D)
//
// ════════════════════════════════════════════════════════════════════════════
// Sổ commissioning cho máy AOI/AVI đi qua wizard "Kết nối máy AOI/AVI"
// (/aoi-onboarding). Một dòng = một lượt onboarding của một máy:
//
//   draft          → bản nháp wizard (resumable): configSnapshot giữ trạng thái
//                    từng bước (vendor, nguồn dữ liệu, kết quả dry-run, key prefix).
//   commissioned   → đã ký nghiệm thu (signedBy/signedAt) — ingest của máy được
//                    coi là "production".
//   decommissioned → đã thu hồi nghiệm thu — ingest quay về chế độ commissioning.
//
// GATE MỀM (quan trọng — không phá máy đang chạy): trạng thái này KHÔNG chặn
// submitInspection. Máy chưa commissioned vẫn được nhận dữ liệu bình thường;
// đường ingest (W2-C) chỉ THAM KHẢO server/services/aoiCommissioningService.ts
// (getAoiIngestMode) để GẮN NHÃN bản ghi là "commissioning-mode". Không có
// code path nào từ đây reject một inspection.
//
// KHÔNG lưu secret: configSnapshot chỉ được phép giữ keyPrefix (không bao giờ
// plaintext API key) — router validate/strip trước khi ghi.
//
// Bảng additive thuần (CREATE TABLE/INDEX, không ALTER TYPE, không pg enum mới)
// — status là varchar để migration 0177 re-runnable. machineId là soft-ref tới
// machines.id (nhất quán với phần còn lại của domain; FK theo lô là Đợt 3 / M1).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const aoiCommissioningRecords = pgTable("aoi_commissioning_records", {
  id: serial("id").primaryKey(),
  /** Soft-ref machines.id (router asserts existence before insert). */
  machineId: integer("machineId").notNull(),
  /** 'draft' | 'commissioned' | 'decommissioned' (varchar — see header). */
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  /** Wizard config snapshot (vendor, ingestion, dry-run summary, key prefix…). */
  configSnapshot: jsonb("configSnapshot"),
  /** users.id of the sign-off actor. NULL while draft. */
  signedBy: integer("signedBy"),
  signedAt: timestamp("signedAt"),
  note: text("note"),
  /** users.id that started the wizard draft. */
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_aoi_commissioning_machine").on(table.machineId),
  index("idx_aoi_commissioning_status").on(table.status),
  index("idx_aoi_commissioning_signed_at").on(table.signedAt),
]);

export type AoiCommissioningRecord = typeof aoiCommissioningRecords.$inferSelect;
export type InsertAoiCommissioningRecord = typeof aoiCommissioningRecords.$inferInsert;
