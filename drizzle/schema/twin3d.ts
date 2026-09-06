// Schema domain: Twin 3D — nền móng không gian (spec 2026-09-06-nha-may-3d-digital-twin-design §5.3/§5.4/§10A.4)
//
// ════════════════════════════════════════════════════════════════════════════
// HỆ TOẠ ĐỘ THỨ BA — và VÌ SAO phải có, sau khi đã có hai hệ (§5.1)
// ════════════════════════════════════════════════════════════════════════════
// Đo được trên DB dev 2026-09-06:
//   Hệ A  `machines.layoutPositionX/Y` + `machines.layout` jsonb — chuẩn hoá 0–1
//   Hệ B  `machine_positions.positionX/Y/Z` + `rotation`        — int PIXEL
// Cả hai KHÔNG biểu diễn được thứ Twin 3D cần: `positionZ = 0` ở 36/36 hàng và
// `rotation = 0` ở 36/36 hàng — nghĩa là mọi máy cùng độ cao 0 và cùng một hướng.
// Không phải "dữ liệu chưa điền": hai hệ đó không có chỗ cho kích thước máy, và
// pixel/0–1 không quy đổi được sang mét nếu không có tỉ lệ (mà không bảng nào lưu).
//
// Các bảng dưới đây là NGUỒN SỰ THẬT DUY NHẤT cho Twin: MILIMÉT tuyệt đối,
// quaternion, kích thước. Hệ A và B GIỮ NGUYÊN, không đổi ý nghĩa cột nào
// (QĐ-8) — hai editor cũ (FactoryFloorEditor, WorkshopLayoutEditor) chạy song song.
//
// ⚠ QUY ƯỚC TRỤC (§5.2) — Z TRONG DB LÀ ĐỘ CAO, khác three.js:
//     scene.x = viTriXMm / 1000     (Đông)
//     scene.y = viTriZMm / 1000     (LÊN — lấy từ Z của DB)
//     scene.z = viTriYMm / 1000     (Y mặt bằng hướng xuống → Z scene)
//   Quy đổi nằm ở MỘT module thuần `heToaDo.ts` (Đợt 1), không rải trong component.
//
// ⚠ SỐ mm là `numeric(14,3)` → drizzle trả về **string**, không phải number.
//   Đây là hành vi cố ý của driver (numeric có thể vượt Number.MAX_SAFE_INTEGER).
//   Mọi phép tính PHẢI Number(...) tường minh; cộng thẳng hai giá trị sẽ NỐI CHUỖI
//   ("1000" + "500" = "1000500") — lỗi câm, không throw. Xem `heToaDo.ts`.
import {
  pgTable, serial, integer, varchar, text, jsonb, boolean, numeric,
  timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { twinNguonEnum, twinThucTheEnum, twinVatTheEnum } from "./enums";

/**
 * Toà nhà trong khuôn viên một nhà máy.
 *
 * `nguon = 'sinh'` (mặc định) ⇒ UI hiện badge vàng "chưa đo" (NT-4). Kích thước
 * mặc định 60 × 40 × 12 m là một xưởng vừa hợp lý — KHÔNG phải số đo của bất kỳ
 * toà nhà nào có thật, và cờ `nguon` là chỗ hệ tự khai điều đó.
 *
 * `modelVoId` / `donViNguon` (§10A.4) phục vụ con đường A (nhập bản vẽ kỹ thuật):
 * giữ lại đơn vị của file gốc để mở lại được hộp thoại hiệu chỉnh — nhập sai đơn
 * vị cho ra nhà xưởng lớn gấp 1.000 lần và người dùng sẽ không hiểu vì sao.
 */
export const twinToaNha = pgTable("twin_toa_nha", {
  id: serial("id").primaryKey(),
  factoryId: integer("factoryId").notNull(),
  ma: varchar("ma", { length: 64 }).notNull(),
  ten: varchar("ten", { length: 255 }).notNull(),
  viTriXMm: numeric("viTriXMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriYMm: numeric("viTriYMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriZMm: numeric("viTriZMm", { precision: 14, scale: 3 }).default("0").notNull(),
  rongMm: numeric("rongMm", { precision: 14, scale: 3 }).default("60000").notNull(),
  sauMm: numeric("sauMm", { precision: 14, scale: 3 }).default("40000").notNull(),
  caoMm: numeric("caoMm", { precision: 14, scale: 3 }).default("12000").notNull(),
  quatX: numeric("quatX", { precision: 12, scale: 9 }).default("0").notNull(),
  quatY: numeric("quatY", { precision: 12, scale: 9 }).default("0").notNull(),
  quatZ: numeric("quatZ", { precision: 12, scale: 9 }).default("0").notNull(),
  quatW: numeric("quatW", { precision: 12, scale: 9 }).default("1").notNull(),
  /** §10A.4 — vỏ nhà nhập từ bản vẽ; NULL = dựng bằng khối (con đường B). */
  modelVoId: integer("modelVoId"),
  /** §10A.4 — 'mm' | 'cm' | 'm' | 'inch' của file gốc. */
  donViNguon: varchar("donViNguon", { length: 8 }),
  nguon: twinNguonEnum("nguon").default("sinh").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_twin_toa_nha_factory").on(table.factoryId),
  uniqueIndex("uq_twin_toa_nha_factory_ma").on(table.factoryId, table.ma),
]);

export type TwinToaNha = typeof twinToaNha.$inferSelect;
export type InsertTwinToaNha = typeof twinToaNha.$inferInsert;

/**
 * Một mặt sàn của toà nhà. `capSo` âm = hầm; KHÔNG dùng 0 (nhập nhằng giữa "tầng
 * trệt" và "chưa đặt").
 *
 * ⚠ `daiMm`/`rongMm` để NULL ĐƯỢC và KHÔNG được điền từ `factories.floorWidthM/
 * floorDepthM` (§10A.0): SIM-FAC có floorWidthM=1500 / floorDepthM=1200, đọc đúng
 * đơn vị là 1,5 km × 1,2 km — số rác do ai đó nhập pixel vào ô mét. NULL ở đây
 * nghĩa "chưa ai đo mặt sàn này", và cảnh 3D lấy kích thước từ toà nhà cha.
 *
 * `daHieuChuan = false` mặc định: chưa ai click hai điểm trên ảnh nền + nhập
 * khoảng cách thật thì `tiLeMmMoiPx` chỉ là phỏng đoán, và UI phải nói thế.
 */
export const twinTang = pgTable("twin_tang", {
  id: serial("id").primaryKey(),
  toaNhaId: integer("toaNhaId").notNull(),
  capSo: integer("capSo").notNull(),
  ten: varchar("ten", { length: 255 }).notNull(),
  caoDoMm: numeric("caoDoMm", { precision: 14, scale: 3 }).default("0").notNull(),
  caoThongThuyMm: numeric("caoThongThuyMm", { precision: 14, scale: 3 }).default("6000").notNull(),
  /** §10A.4 — dài mặt sàn (trục X). NULL = chưa đo, lấy theo toà nhà. */
  daiMm: numeric("daiMm", { precision: 14, scale: 3 }),
  /** §10A.4 — rộng mặt sàn (trục Y). NULL = chưa đo. */
  rongMm: numeric("rongMm", { precision: 14, scale: 3 }),
  /** §10A.4 — 'nhap_tay' | 'ban_ve' | 'sinh'. */
  nguonHinhHoc: varchar("nguonHinhHoc", { length: 16 }).default("sinh").notNull(),
  anhNenUrl: text("anhNenUrl"),
  anhNenKey: text("anhNenKey"),
  tiLeMmMoiPx: numeric("tiLeMmMoiPx", { precision: 12, scale: 6 }),
  daHieuChuan: boolean("daHieuChuan").default(false).notNull(),
  nguon: twinNguonEnum("nguon").default("sinh").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_twin_tang_toa_nha").on(table.toaNhaId),
  uniqueIndex("uq_twin_tang_toa_nha_cap").on(table.toaNhaId, table.capSo),
]);

export type TwinTang = typeof twinTang.$inferSelect;
export type InsertTwinTang = typeof twinTang.$inferInsert;

/**
 * Vị trí 3D của MỌI thực thể trong cây phân cấp — một bảng thay cho bốn.
 *
 * ★★★ `uniqueIndex(loaiThucThe, thucTheId)` là bất biến quan trọng nhất của toàn
 * mô hình: một máy có ĐÚNG MỘT vị trí trong hệ. Đây là thứ ngăn hệ toạ độ THỨ TƯ
 * ra đời — hệ A và hệ B lệch nhau được chính vì không có gì cấm hai hàng cùng nói
 * về một máy.
 *
 * ⚠ `thucTheId` KHÔNG có khoá ngoại (đa hình — trỏ vào 4 bảng tuỳ `loaiThucThe`).
 * DB không cưỡng chế được "máy id=99 có thật không"; tầng service phải kiểm và
 * script đối soát phải đếm hàng mồ côi. Đánh đổi này khai rõ trong migration 0351.
 *
 * ⚠ `rongMm`/`caoMm`/`sauMm` NULL = **chưa biết**, và NULL đó kích hoạt chuỗi dự
 * phòng §5.3 (bounds của model → twin_kich_thuoc_loai → 1200×1800×800). KHÔNG
 * được thay bằng DEFAULT: "chưa biết" hoá thành "biết rồi, bằng 1200" là mất tin,
 * đúng lớp lỗi NT-3.
 */
export const twinDatCho = pgTable("twin_dat_cho", {
  id: serial("id").primaryKey(),
  tangId: integer("tangId").notNull(),
  loaiThucThe: twinThucTheEnum("loaiThucThe").notNull(),
  thucTheId: integer("thucTheId").notNull(),
  viTriXMm: numeric("viTriXMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriYMm: numeric("viTriYMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriZMm: numeric("viTriZMm", { precision: 14, scale: 3 }).default("0").notNull(),
  rongMm: numeric("rongMm", { precision: 14, scale: 3 }),
  caoMm: numeric("caoMm", { precision: 14, scale: 3 }),
  sauMm: numeric("sauMm", { precision: 14, scale: 3 }),
  /** false = kích thước là SUY RA, không phải ĐO ⇒ badge "chưa đo". */
  kichThuocDaDo: boolean("kichThuocDaDo").default(false).notNull(),
  quatX: numeric("quatX", { precision: 12, scale: 9 }).default("0").notNull(),
  quatY: numeric("quatY", { precision: 12, scale: 9 }).default("0").notNull(),
  quatZ: numeric("quatZ", { precision: 12, scale: 9 }).default("0").notNull(),
  quatW: numeric("quatW", { precision: 12, scale: 9 }).default("1").notNull(),
  tiLeX: numeric("tiLeX", { precision: 10, scale: 6 }).default("1").notNull(),
  tiLeY: numeric("tiLeY", { precision: 10, scale: 6 }).default("1").notNull(),
  tiLeZ: numeric("tiLeZ", { precision: 10, scale: 6 }).default("1").notNull(),
  modelId: integer("modelId"),
  daKhoa: boolean("daKhoa").default(false).notNull(),
  hienThi: boolean("hienThi").default(true).notNull(),
  nguon: twinNguonEnum("nguon").default("sinh").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_twin_dat_cho_tang").on(table.tangId),
  index("idx_twin_dat_cho_thuc_the").on(table.loaiThucThe, table.thucTheId),
  uniqueIndex("uq_twin_dat_cho_thuc_the").on(table.loaiThucThe, table.thucTheId),
]);

export type TwinDatCho = typeof twinDatCho.$inferSelect;
export type InsertTwinDatCho = typeof twinDatCho.$inferInsert;

/**
 * Vật thể cảnh KHÔNG thuộc cây phân cấp: tường, cột, cửa, vạch kẻ sàn, vùng an
 * toàn (polygon trong `diemDa`), kệ, pallet, biển báo, và mọi GLB người dùng nhập.
 *
 * `loai='vung'` + `diemDa` thay thế `factory_zones` — an toàn vì factory_zones đo
 * được **0 dòng** (không có byte nào để mất). Khác biệt: `points` của factory_zones
 * là 0–1, `diemDa` ở đây là **mm**.
 *
 * ⚠ `nguon` mặc định `'tay'` — KHÁC `twinDatCho` (mặc định `'sinh'`): vật thể cảnh
 * phần lớn do người vẽ. Tường bao sinh tự động (§10A.2) phải ghi đè thành `'sinh'`.
 */
export const twinVatThe = pgTable("twin_vat_the", {
  id: serial("id").primaryKey(),
  tangId: integer("tangId").notNull(),
  chaId: integer("chaId"),
  loai: twinVatTheEnum("loai").notNull(),
  ten: varchar("ten", { length: 255 }).notNull(),
  modelId: integer("modelId"),
  viTriXMm: numeric("viTriXMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriYMm: numeric("viTriYMm", { precision: 14, scale: 3 }).default("0").notNull(),
  viTriZMm: numeric("viTriZMm", { precision: 14, scale: 3 }).default("0").notNull(),
  rongMm: numeric("rongMm", { precision: 14, scale: 3 }),
  caoMm: numeric("caoMm", { precision: 14, scale: 3 }),
  sauMm: numeric("sauMm", { precision: 14, scale: 3 }),
  quatX: numeric("quatX", { precision: 12, scale: 9 }).default("0").notNull(),
  quatY: numeric("quatY", { precision: 12, scale: 9 }).default("0").notNull(),
  quatZ: numeric("quatZ", { precision: 12, scale: 9 }).default("0").notNull(),
  quatW: numeric("quatW", { precision: 12, scale: 9 }).default("1").notNull(),
  tiLeX: numeric("tiLeX", { precision: 10, scale: 6 }).default("1").notNull(),
  tiLeY: numeric("tiLeY", { precision: 10, scale: 6 }).default("1").notNull(),
  tiLeZ: numeric("tiLeZ", { precision: 10, scale: 6 }).default("1").notNull(),
  /** Màu đè cho vật TRANG TRÍ. KHÔNG dùng cho màu trạng thái máy (§10.2). */
  mau: varchar("mau", { length: 9 }),
  /** Polygon mm: [[xMm,yMm],…] — cho loai='vung' / 'vach_ke'. */
  diemDa: jsonb("diemDa").$type<Array<[number, number]>>(),
  thuocTinh: jsonb("thuocTinh").$type<Record<string, unknown>>().default({}).notNull(),
  thuTu: integer("thuTu").default(0).notNull(),
  daKhoa: boolean("daKhoa").default(false).notNull(),
  hienThi: boolean("hienThi").default(true).notNull(),
  nguon: twinNguonEnum("nguon").default("tay").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_twin_vat_the_tang").on(table.tangId),
  index("idx_twin_vat_the_cha").on(table.chaId),
]);

export type TwinVatThe = typeof twinVatThe.$inferSelect;
export type InsertTwinVatThe = typeof twinVatThe.$inferInsert;

/**
 * Kích thước mặc định theo loại máy (QĐ-7, §10B.1).
 *
 * ★ MỌI hàng seed có `laGiaDinh = true` — đo được: `bounds IS NULL` ở 5/5 hàng
 * `equipment_3d_models`, tức KHÔNG máy nào trong hệ có kích thước thật. Con số ở
 * đây tồn tại để cảnh 3D có hình khối hợp lý, KHÔNG để ai đọc ra kích thước thật.
 * Kỹ thuật đo lại trong Inspector → `laGiaDinh=false` → badge "chưa đo" tự tắt.
 */
export const twinKichThuocLoai = pgTable("twin_kich_thuoc_loai", {
  /** PK là chính giá trị machinetypeenum — một loại máy có đúng một mặc định. */
  loaiMay: varchar("loaiMay", { length: 32 }).primaryKey(),
  rongMm: numeric("rongMm", { precision: 14, scale: 3 }).notNull(),
  caoMm: numeric("caoMm", { precision: 14, scale: 3 }).notNull(),
  sauMm: numeric("sauMm", { precision: 14, scale: 3 }).notNull(),
  laGiaDinh: boolean("laGiaDinh").default(true).notNull(),
  ghiChu: text("ghiChu"),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type TwinKichThuocLoai = typeof twinKichThuocLoai.$inferSelect;
export type InsertTwinKichThuocLoai = typeof twinKichThuocLoai.$inferInsert;

/**
 * Phiên bản bố cục của một tầng.
 *
 * ★ Màn Vận hành CHỈ ĐỌC bản `daXuatBan = true`. Người đang dựng kéo máy lung tung
 * không được làm rối màn hình vận hành đang chạy — đó là lý do bảng này tồn tại.
 * `anhChup` TỰ CHỨA toàn bộ đặt-chỗ + vật-thể (không JOIN lại bảng sống), nên một
 * bản đã xuất bản không đổi hình khi ai đó sửa bảng sống.
 */
export const twinBanGhi = pgTable("twin_ban_ghi", {
  id: serial("id").primaryKey(),
  tangId: integer("tangId").notNull(),
  nhan: varchar("nhan", { length: 255 }).notNull(),
  anhChup: jsonb("anhChup").$type<Record<string, unknown>>().notNull(),
  daXuatBan: boolean("daXuatBan").default(false).notNull(),
  nguoiTao: integer("nguoiTao"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_twin_ban_ghi_tang").on(table.tangId),
  index("idx_twin_ban_ghi_xuat_ban").on(table.tangId, table.daXuatBan),
]);

export type TwinBanGhi = typeof twinBanGhi.$inferSelect;
export type InsertTwinBanGhi = typeof twinBanGhi.$inferInsert;
