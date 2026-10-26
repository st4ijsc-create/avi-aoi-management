/**
 * ★ Đợt 10.3 (2026-10-26) — CỔNG AI NGOÀI, migration `0414` (cấu hình / danh mục model / host nội bộ theo nhà máy) + `0415` (sổ WORM ý
 * định + kết quả, nội dung đã che có hạn giữ, bộ đếm trần đặt-trước). Spec `2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §5.
 * ⚠ CHECK / trigger WORM / quyền `avi_app` ở tệp SQL — drizzle chỉ mô tả cột.
 */
import { pgTable, integer, varchar, boolean, bigint, numeric, text, timestamp, serial, bigserial, char, date, primaryKey, unique } from "drizzle-orm/pg-core";
import { factories } from "./hierarchy";
import { aiApiKeys } from "./ai";

const tz = (ten: string) => timestamp(ten, { withTimezone: true });

export const aiNgoaiNhaMay = pgTable("ai_ngoai_nha_may", {
  factoryId: integer("factoryId").primaryKey().references(() => factories.id, { onDelete: "cascade" }),
  batNgoai: boolean("batNgoai").notNull().default(false),
  choDuLieuVanHanh: boolean("choDuLieuVanHanh").notNull().default(false),
  luuNguyenVan: boolean("luuNguyenVan").notNull().default(false),
  hanGiuNgay: integer("hanGiuNgay").notNull().default(30),
  tranTokenNgay: bigint("tranTokenNgay", { mode: "number" }),
  tranTienNgayUsd: numeric("tranTienNgayUsd", { precision: 12, scale: 4 }),
  tranTokenNguoiNgay: bigint("tranTokenNguoiNgay", { mode: "number" }),
  tranTokenLuongNgay: bigint("tranTokenLuongNgay", { mode: "number" }),
  tranTokenLuot: bigint("tranTokenLuot", { mode: "number" }),
  tranLanPhut: integer("tranLanPhut").notNull().default(20),
  capNhatBoi: integer("capNhatBoi"),
  capNhatLuc: tz("capNhatLuc").notNull().defaultNow(),
});

export const aiNgoaiModel = pgTable(
  "ai_ngoai_model",
  {
    id: serial("id").primaryKey(),
    factoryId: integer("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
    /** `anthropic` | `openai` | `gemini` | `openai-compat` */
    nhaCungCap: varchar("nhaCungCap", { length: 16 }).notNull(),
    model: varchar("model", { length: 96 }).notNull(),
    nhan: varchar("nhan", { length: 120 }).notNull(),
    keyId: integer("keyId").notNull().references(() => aiApiKeys.id, { onDelete: "restrict" }),
    giaVaoUsdTrieu: numeric("giaVaoUsdTrieu", { precision: 12, scale: 4 }),
    giaRaUsdTrieu: numeric("giaRaUsdTrieu", { precision: 12, scale: 4 }),
    tranTokenLuot: bigint("tranTokenLuot", { mode: "number" }),
    batModel: boolean("batModel").notNull().default(false),
    capNhatBoi: integer("capNhatBoi"),
    capNhatLuc: tz("capNhatLuc").notNull().defaultNow(),
  },
  (t) => [unique("ai_ngoai_model_uniq").on(t.factoryId, t.nhaCungCap, t.model)],
);

export const aiNgoaiHostNoiBo = pgTable(
  "ai_ngoai_host_noi_bo",
  {
    factoryId: integer("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
    /** `host:cổng` chữ thường */
    hostCong: varchar("hostCong", { length: 255 }).notNull(),
    taoBoi: integer("taoBoi"),
    taoLuc: tz("taoLuc").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.factoryId, t.hostCong] })],
);

/** WORM — avi_app chỉ SELECT + INSERT. `loai`: `y-dinh` (TRƯỚC lời gọi) | `ket-qua` (SAU, `yDinhId` trỏ về ý định). */
export const aiExternalCalls = pgTable("ai_external_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  factoryId: integer("factoryId").notNull(),
  nhaMayDuLieu: integer("nhaMayDuLieu").array().notNull().default([]),
  loai: varchar("loai", { length: 8 }).notNull(),
  yDinhId: bigint("yDinhId", { mode: "number" }),
  userId: integer("userId"),
  flowId: varchar("flowId", { length: 64 }),
  runId: varchar("runId", { length: 64 }),
  tuDong: boolean("tuDong").notNull(),
  nhaCungCap: varchar("nhaCungCap", { length: 16 }).notNull(),
  model: varchar("model", { length: 96 }).notNull(),
  mucDich: varchar("mucDich", { length: 32 }),
  mucDuLieu: varchar("mucDuLieu", { length: 12 }),
  soTruongDaChe: integer("soTruongDaChe"),
  bamNoiDung: char("bamNoiDung", { length: 64 }),
  tokenVao: integer("tokenVao"),
  tokenRa: integer("tokenRa"),
  chiPhiUocUsd: numeric("chiPhiUocUsd", { precision: 12, scale: 6 }),
  /** `ok` | `loi` | `tu-choi` | `khong-ro` (đối soát ý định mồ côi) */
  ketCuc: varchar("ketCuc", { length: 12 }),
  maLoi: varchar("maLoi", { length: 48 }),
  taoLuc: tz("taoLuc").notNull().defaultNow(),
});

/** Nội dung ĐÃ CHE (chỉ khi nhà máy bật `luuNguyenVan`), xoá khi hết hạn. */
export const aiExternalCallNoiDung = pgTable("ai_external_call_noi_dung", {
  callId: bigint("callId", { mode: "number" }).primaryKey().references(() => aiExternalCalls.id),
  factoryId: integer("factoryId").notNull(),
  noiDungDaChe: text("noiDungDaChe").notNull(),
  hetHanLuc: tz("hetHanLuc").notNull(),
});

/** Bộ đếm trần đặt-trước theo (nhà máy, ngày UTC+7, khoá) — khoá `nha-may` | `nguoi:<id>` | `luong:<id>` | `luot:<runId>`. */
export const aiNgoaiDem = pgTable(
  "ai_ngoai_dem",
  {
    factoryId: integer("factoryId").notNull(),
    ngay: date("ngay").notNull(),
    khoa: varchar("khoa", { length: 80 }).notNull(),
    tokenGiu: bigint("tokenGiu", { mode: "number" }).notNull().default(0),
    tienGiuUsd: numeric("tienGiuUsd", { precision: 14, scale: 6 }).notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.factoryId, t.ngay, t.khoa] })],
);

export const aiNgoaiDemPhut = pgTable(
  "ai_ngoai_dem_phut",
  {
    factoryId: integer("factoryId").notNull(),
    phut: tz("phut").notNull(),
    so: integer("so").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.factoryId, t.phut] })],
);
