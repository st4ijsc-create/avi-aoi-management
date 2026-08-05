import {
  pgTable, serial, varchar, bigint, integer, boolean, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";

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
  // baseline | reserve | commit | commit_fallback | measure_failed | release | refuse | preempt
  // | drift | adopt | defer | defer_exceeded
  // ⚠ `commit_fallback` (Pha 2A Task 4, T5-15) = sổ được chốt bằng ƯỚC LƯỢNG DỰ PHÒNG sau một
  // phép đo hỏng (khối byte chắc chắn tồn tại — backend CUDA). Ai đọc nhật ký mà không biết loại
  // này sẽ thấy `measure_failed` không có `commit` đi kèm và tưởng giấy phép còn treo. `actualBytes`
  // của dòng đó KHÔNG PHẢI SỐ ĐO (`detail->>'measured' = 'false'`).
  // ⚠ `baseline` (Task 5 review vòng 2, NEW-4) = ảnh chụp NỀN THIẾT BỊ lúc khởi động
  // (nền = thiết bị − sổ). Task 7 và Agent đọc nhật ký PHẢI biết loại này, nếu không sẽ đọc
  // `drift` mà không biết nó đã được trừ đi bao nhiêu.
  // ⚠ `measure_failed` (review TOÀN NHÁNH, I-2) = phép đo delta ĐÃ CHẠY và cho số ÂM ⇒ vô nghĩa
  // ⇒ giấy phép giữ ƯỚC LƯỢNG vĩnh viễn. Đây là nguồn lệch ÂM DAI DẲNG, khác hẳn `reserve` chưa
  // có `commit` (tạm thời, tự lành). Ai đọc nhật ký mà không biết loại này sẽ đi tìm một lượt
  // `commit` KHÔNG BAO GIỜ TỚI.
  event: varchar("event", { length: 24 }).notNull(),
  owner: varchar("owner", { length: 160 }).notNull(),
  leaseKind: varchar("leaseKind", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  estimatedBytes: bigint("estimatedBytes", { mode: "number" }),
  actualBytes: bigint("actualBytes", { mode: "number" }),
  // learned | file-size | config-default | unknown | fallback-after-measure-failure
  // — truy được chỗ nào còn dùng hằng số.
  // ⚠ `unknown` (Task 3 review vòng 1, thiếu ở đây tới tận review TOÀN NHÁNH — M-1) = KHÔNG có
  // learned, KHÔNG có file, KHÔNG có hằng số nào ⇒ ước lượng = **0**. Đây là nấc NGUY HIỂM NHẤT
  // (báo cáo §5.4: ước lượng 0 trong khi thật 526 MiB), nên tuyệt đối không được vắng khỏi danh
  // sách mà người đọc nhật ký dựa vào — cùng lớp lỗi với `baseline` thiếu ở cột `event` bên trên.
  // ⚠⚠ ĐỘ RỘNG 48, KHÔNG PHẢI 16 (Pha 2A Task 4, migration 0311): `fallback-after-measure-failure`
  // dài **30** ký tự. Với `varchar(16)` cũ, Postgres ném 22001 và vì `flushVramEvents()` ghi MỘT
  // LÔ nhiều dòng, MỘT sự kiện dự phòng làm mất TOÀN BỘ lô — telemetry thủng im lặng (lỗi chỉ đi
  // ra một dòng console.warn). Ai thêm giá trị mới cho `VramEstimateSource` phải đếm lại ký tự.
  estimateSource: varchar("estimateSource", { length: 48 }),
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

/**
 * ★★★ Pha 3 Task 2 — **SỔ CHUNG SỐNG**, xuyên tiến trình. Migration `0312_vram_leases.sql`.
 *
 * ⚠⚠ ĐỌC KỸ SỰ KHÁC BIỆT VỚI `vram_events` NGAY TRÊN, vì hai bảng dễ bị nhầm là một:
 *   • `vram_events` — **LỊCH SỬ**, chỉ-ghi-thêm, không ai đọc để quyết định. Một dòng cho mỗi
 *     BIẾN CỐ.
 *   • `vram_leases` — **TRẠNG THÁI SỐNG**, có xoá, và **đường quyết định ĐỌC nó**. Một dòng cho
 *     mỗi GIẤY PHÉP đang tồn tại, ở bất kỳ tiến trình nào.
 * Trước Pha 3 mỗi tiến trình giữ một sổ RIÊNG trong bộ nhớ (`vramBroker.ledger`) ⇒ `api` và
 * `worker` cùng tưởng card còn trống. Bảng này là chỗ hai bên nhìn thấy nhau.
 *
 * ⚠⚠ ĐÂY **KHÔNG** PHẢI NGUỒN SỰ THẬT CỦA MỘT TIẾN TRÌNH VỀ CHÍNH NÓ. Sổ CỤC BỘ mới là. Bảng này
 * là **bản công bố**: mỗi tiến trình GHI trạng thái của mình vào đây và ĐỌC của anh em ra. Một
 * hàng của ta biến mất khỏi đây KHÔNG có nghĩa ta đã nhả — xem khối "bằng chứng đã nhả" ở
 * `server/services/vram/vramSharedLedger.ts` (phát hiện của Pha 3 Task 1: `kill(pid,0)` sớm giả,
 * và một hiệu số của bản sao cũ là đúng hình dạng lỗi T5-11).
 *
 * ⚠ `bytes` là `bigint` ⇒ mọi giá trị không hữu hạn phải bị chặn TRƯỚC khi tới đây (`22P02` làm
 * mất **cả lô**, đúng tiền lệ migration 0311). Hàng rào: `vramSharedLedgerStore.rowFromLease()`.
 *
 * ⚠⚠⚠ RÀNG BUỘC TOPO — **MỘT DATABASE = MỘT THIẾT BỊ GPU** (I-2, review TOÀN NHÁNH). Bảng này CỐ Ý
 * không có cột `host`/`device`, và hàng nền (`leaseKey = "vram:baseline"`) là **MỘT hàng cho cả
 * DB**. `foreignBytes` cộng thẳng byte của mọi hàng không phải của mình, **không hỏi chúng nằm
 * trên card nào** ⇒ hai máy dùng chung một Postgres thì nền của card A bị đọc làm nền của card B,
 * và **không cơ chế nào của Pha 3 phát hiện được** (đó không phải một lệch ĐO ĐƯỢC, đó là một phép
 * cộng sai DÂN SỐ). Hôm nay ràng buộc đúng: chỉ tiến trình Node gọi `startVramReconciler()` mới
 * đọc/ghi bảng này, và chúng nằm trên cùng một máy — `edge` là dịch vụ **C#**, sidecar là **tiến
 * trình con không có broker**. Nối site/`edge` thứ hai ⇒ **PHẢI thêm `deviceKey` (host + UUID GPU)
 * vào khoá chính, vào hàng nền và vào phép lọc của `vramSharedLedger.dungBanSao()` TRƯỚC.**
 */
export const vramLeases = pgTable("vram_leases", {
  /**
   * `${processKey}#${leaseId}` — KHOÁ CHÍNH. ⚠ KHÔNG dùng `leaseId` một mình: nó là
   * `lease-${++seq}` **theo tiến trình**, nên `api` và `worker` cùng đẻ ra `lease-1`.
   */
  leaseKey: varchar("leaseKey", { length: 200 }).primaryKey(),
  /**
   * `${role}:${pid}:${bootMs}`. ⚠ `bootMs` CÓ MẶT vì **HĐH CẤP LẠI PID**: một `worker` chết rồi
   * tiến trình khác nhận đúng PID đó sẽ "kế thừa" giấy phép của người đã chết, và sổ chung khai
   * một khối byte không tồn tại (cùng lớp lỗi nợ N2-2 của Pha 2A).
   */
  processKey: varchar("processKey", { length: 96 }).notNull(),
  pid: integer("pid").notNull(),
  role: varchar("role", { length: 32 }).notNull(),
  leaseId: varchar("leaseId", { length: 64 }).notNull(),
  owner: varchar("owner", { length: 160 }).notNull(),
  leaseKind: varchar("leaseKind", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  /** `actualBytes ?? estimatedBytes` — cùng công thức `vramBroker.leaseBytes()`, một nguồn. */
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  /** `true` ⇔ `bytes` do một THƯỚC đẻ ra. `false` ⇒ ƯỚC LƯỢNG (types.ts, ba nhóm/hai ô). */
  measured: boolean("measured").default(false).notNull(),
  /** `0` = NHÀN RỖI ⇒ thu hồi được. Task 5 (`preempt()` xuyên tiến trình) đứng trên ô này. */
  refCount: integer("refCount").default(1).notNull(),
  /** `VramReclaimerId` hoặc `null` = **KHÔNG ai thu hồi được** hộ này. */
  reclaimer: varchar("reclaimer", { length: 32 }),
  acquiredAt: timestamp("acquiredAt").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("vram_leases_process_idx").on(table.processKey),
  index("vram_leases_updated_idx").on(table.updatedAt),
]);

export type VramLeaseRow = typeof vramLeases.$inferSelect;
export type InsertVramLeaseRow = typeof vramLeases.$inferInsert;
