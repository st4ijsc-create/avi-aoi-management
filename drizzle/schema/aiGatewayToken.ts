/**
 * ★★★ Đợt 4A (2026-10-17) — migration `0392`: token THEO NGƯỜI DÙNG cho cổng `/v1` + device flow của extension.
 *
 * ⚠ Chỉ lưu BĂM sha256 (`tokenHash`, `maThietBiHash`) — bản rõ trả đúng một lần, CHECK hex-thường ở CSDL chặn một
 *   bản rõ lỡ ghi vào cột băm. Phạm vi CHỦ TOKEN (`userId` trong mệnh đề WHERE — `server/db/aiGatewayTokens.ts`).
 * ⚠ `timestamptz` (không `timestamp` naive): so hết hạn làm bằng `now()` trong SQL, không ở JS.
 */
import { pgTable, serial, integer, varchar, char, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { sql } from "drizzle-orm";

export const aiGatewayTokens = pgTable(
  "ai_gateway_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex của token `avgw_…` — KHÔNG BAO GIỜ bản rõ. */
    tokenHash: char("tokenHash", { length: 64 }).notNull(),
    /** 12 ký tự đầu (`avgw_xxxxxxx`) — để người dùng nhận ra token, không đủ để dùng. */
    tienTo: varchar("tienTo", { length: 16 }).notNull(),
    ten: varchar("ten", { length: 100 }).notNull(),
    /** Mảng con không rỗng của `chat` | `fim` | `embed`. */
    phamVi: text("phamVi").array().notNull(),
    /** `web` (tạo trên trang) | `thiet-bi` (device flow của extension). */
    nguon: varchar("nguon", { length: 16 }).notNull().default("web"),
    hetHanLuc: timestamp("hetHanLuc", { withTimezone: true }).notNull(),
    thuHoiLuc: timestamp("thuHoiLuc", { withTimezone: true }),
    thuHoiBoi: integer("thuHoiBoi").references(() => users.id, { onDelete: "set null" }),
    dungLanCuoiLuc: timestamp("dungLanCuoiLuc", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_gateway_tokens_hash_uq").on(table.tokenHash),
    index("ai_gateway_tokens_owner_idx").on(table.userId, table.createdAt),
  ],
);

export const aiGatewayDeviceCodes = pgTable(
  "ai_gateway_device_codes",
  {
    id: serial("id").primaryKey(),
    /** sha256 hex của mã bí mật `avgd_…` extension giữ để đổi lấy token. */
    maThietBiHash: char("maThietBiHash", { length: 64 }).notNull(),
    /** Mã ngắn `XXXX-XXXX` người dùng đối chiếu trên trang web. */
    maNguoiDung: varchar("maNguoiDung", { length: 9 }).notNull(),
    ten: varchar("ten", { length: 100 }).notNull(),
    phamVi: text("phamVi").array().notNull(),
    /** `cho` | `da-duyet` | `tu-choi` | `da-doi` (hết hạn = `hetHanLuc <= now()`, không phải một trạng thái lưu). */
    trangThai: varchar("trangThai", { length: 16 }).notNull().default("cho"),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    tokenId: integer("tokenId").references(() => aiGatewayTokens.id, { onDelete: "set null" }),
    soLanHoi: integer("soLanHoi").notNull().default(0),
    hoiLanCuoiLuc: timestamp("hoiLanCuoiLuc", { withTimezone: true }),
    hetHanLuc: timestamp("hetHanLuc", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    /** ★ mig 0394 (rà bảo mật de591c868 #3) — NGUỒN GỐC lượt khởi tạo, hiện trên trang duyệt + vào audit. */
    ipKhoiTao: varchar("ipKhoiTao", { length: 64 }),
    tacNhanKhoiTao: varchar("tacNhanKhoiTao", { length: 200 }),
  },
  (table) => [
    uniqueIndex("ai_gateway_device_codes_ma_tb_uq").on(table.maThietBiHash),
    uniqueIndex("ai_gateway_device_codes_ma_nd_uq").on(table.maNguoiDung),
    index("ai_gateway_device_codes_ip_cho_idx").on(table.ipKhoiTao).where(sql`"trangThai" = 'cho'`),
  ],
);

export type AiGatewayToken = typeof aiGatewayTokens.$inferSelect;
export type AiGatewayDeviceCode = typeof aiGatewayDeviceCodes.$inferSelect;
