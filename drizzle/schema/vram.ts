import { pgTable, serial, varchar, bigint, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Nhật ký chỉ-ghi-thêm cho module điều phối VRAM.
 * Sổ cái SỐNG nằm trong bộ nhớ tiến trình (server/services/vram/vramBroker.ts,
 * Task 1); bảng này là LỊCH SỬ — cho Agent đọc (pha 4) và là dữ liệu trả lời
 * Ư7 (bí ẩn CUDA).
 */
export const vramEvents = pgTable("vram_events", {
  id: serial("id").primaryKey(),
  // Luôn "vram" ở pha này. Một CỘT để sau thêm ram/cpu/disk, KHÔNG phải một framework.
  resourceKind: varchar("resourceKind", { length: 16 }).default("vram").notNull(),
  // baseline | reserve | commit | release | refuse | preempt | drift | adopt | defer | defer_exceeded
  // ⚠ `baseline` (Task 5 review vòng 2, NEW-4) = ảnh chụp NỀN THIẾT BỊ lúc khởi động
  // (nền = thiết bị − sổ). Task 7 và Agent đọc nhật ký PHẢI biết loại này, nếu không sẽ đọc
  // `drift` mà không biết nó đã được trừ đi bao nhiêu.
  event: varchar("event", { length: 24 }).notNull(),
  owner: varchar("owner", { length: 160 }).notNull(),
  leaseKind: varchar("leaseKind", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  estimatedBytes: bigint("estimatedBytes", { mode: "number" }),
  actualBytes: bigint("actualBytes", { mode: "number" }),
  // learned | file-size | config-default — truy được chỗ nào còn dùng hằng số.
  estimateSource: varchar("estimateSource", { length: 16 }),
  deviceUsedBytes: bigint("deviceUsedBytes", { mode: "number" }),
  ledgerTotalBytes: bigint("ledgerTotalBytes", { mode: "number" }),
  driftBytes: bigint("driftBytes", { mode: "number" }),
  // Pha 1: phán quyết BÓNG của Pha 2 — để biết bán kính trước khi bật cưỡng chế.
  wouldRefuse: varchar("wouldRefuse", { length: 8 }),
  detail: jsonb("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("vram_events_created_idx").on(table.createdAt),
  index("vram_events_owner_idx").on(table.owner),
]);

export type VramEvent = typeof vramEvents.$inferSelect;
export type InsertVramEvent = typeof vramEvents.$inferInsert;
