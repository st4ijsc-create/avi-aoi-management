/**
 * server/db/twinCanh.ts — ĐƯỜNG GHI/ĐỌC toà nhà + tầng của Twin 3D (§5.3, §10A).
 *
 * Tầng dữ liệu cho `server/routers/twinCanhRouter.ts` (Đợt 3). Bảng đích
 * `twin_toa_nha` / `twin_tang` / `twin_vat_the` đã có từ migration 0350/0351 —
 * file này KHÔNG tạo bảng nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NUMERIC TRẢ VỀ **STRING**, KHÔNG PHẢI NUMBER
 * ════════════════════════════════════════════════════════════════════════════
 * `numeric(14,3)` qua driver `postgres` ra `string` (numeric vượt được
 * Number.MAX_SAFE_INTEGER nên driver không dám ép). Cộng thẳng hai giá trị sẽ
 * NỐI CHUỖI: `"1000" + "500" === "1000500"` — không throw, không cảnh báo, và
 * sai số 1000 lần này chính là lớp lỗi mà §10A.1 dựng hẳn một hộp thoại để
 * chống ở đầu vào. Mọi chỗ ĐỌC ra để tính phải `Number(...)` tường minh; mọi chỗ
 * GHI vào truyền `String(...)` (drizzle `numeric` nhận string).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHẠM VI TENANT — danh tính từ `ctx.user`, KHÔNG từ `input`
 * ════════════════════════════════════════════════════════════════════════════
 * `factoryId` trong input là LỜI TỰ KHAI của người gọi. Mọi hàm dưới đây kiểm
 * `trongPhamVi("factory", …)` TRƯỚC khi đọc/ghi, và với tầng thì tra ngược
 * `twin_tang → twin_toa_nha → factoryId` rồi mới kiểm — không suy phạm vi từ
 * chính input đó (bài học `pham-vi-tenant-dot-lon`: hàng rào lọc theo cột CLIENT
 * TỰ KHAI là không có hàng rào).
 *
 * Ngoài phạm vi ⇒ hình dạng RỖNG / `ENTITY_NOT_FOUND`, KHÔNG phân biệt "không
 * tồn tại" với "có thật nhưng của tenant khác" — một câu riêng cho ca sau là một
 * oracle rò rỉ tồn-tại.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { appError } from "../_core/appError";
import {
  twinToaNha,
  twinTang,
  twinVatThe,
  twinDatCho,
  twinKichThuocLoai,
  twinBanGhi,
  workshops,
  productionLines,
  stations,
  machines,
  workstations,
  // Đợt 7 nợ #26 — E-STOP nổi lên Twin. Robot KHÔNG vào được `twin_dat_cho`
  // (enum `loaiThucThe` không có `robot`), nên an toàn đi đường RIÊNG.
  robots,
  robotTelemetry,
} from "../../drizzle/schema";
import { trongPhamVi, type PhamViNguoiXem } from "./hierarchy";
// Đợt 6 — cùng bộ bóc hàng thô mà `db/machine.ts` dùng (một quy ước, không hai).
import { executeRows } from "../utils/kpi";

/** Nguồn của một giá trị — khớp `twinnguonenum`. */
export type NguonGiaTri = "sinh" | "tay";

/** Nguồn hình học mặt sàn — khớp `twin_tang.nguonHinhHoc` (§10A.4). */
export type NguonHinhHoc = "nhap_tay" | "ban_ve" | "sinh";

/** Số sang chuỗi cho cột `numeric` của drizzle. Một chỗ duy nhất. */
function soRaChuoi(gt: number): string {
  return String(gt);
}

/** Chuỗi numeric của DB về số. Một chỗ duy nhất — xem cảnh báo nối-chuỗi ở đầu file. */
function chuoiRaSo(gt: string | null | undefined): number | null {
  if (gt === null || gt === undefined) return null;
  const n = Number(gt);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Trùng khoá (23505) — dịch sang câu người đọc hiểu, KHÔNG rò SQL
// ---------------------------------------------------------------------------

/**
 * ★★★ Đợt 3 CHẶN-2 (b) — vì sao phải dịch 23505 ở ĐÂY.
 *
 * Driver `postgres` ném lỗi mang **NGUYÊN VĂN câu INSERT kèm tên MỌI cột** trong
 * `err.query`, và tRPC serialize lỗi chưa-được-dịch xuống client thành
 * `INTERNAL_SERVER_ERROR`. Đo được trước bản vá: client nhận đủ
 *   `INSERT INTO twin_toa_nha ("factoryId", ma, ten, "rongMm", "sauMm", …)`
 * Hai cái sai cùng lúc:
 *   1. RÒ LƯỢC ĐỒ. Tên bảng + tên từng cột là thứ người dùng không cần và kẻ tấn
 *      công thì cần. `INTERNAL_SERVER_ERROR` lẽ ra phải là bức tường, không phải
 *      cửa sổ.
 *   2. NGÕ CỤT CÂM. "INTERNAL_SERVER_ERROR" không nói cho người dùng biết họ vừa
 *      trùng MÃ, cũng không nói phải làm gì. Họ chỉ thấy màn đỏ và không có
 *      đường ra — đúng thứ mà `ENTITY_DUPLICATE` (đã có i18n vi/en/zh) nói được.
 *
 * ⚠ ĐI THEO `err.cause`, không chỉ đọc tầng ngoài: drizzle bọc lỗi driver, nên
 *   `e.code` ở tầng ngoài cùng thường `undefined`. Đây đúng bài học `isMissingTable`
 *   (doc 69) — một phép kiểm chỉ nhìn tầng ngoài là một phép kiểm luôn trả false.
 *
 * ⚠ CHỈ nuốt 23505. Mọi mã lỗi khác PHẢI ném nguyên — dịch bừa một lỗi chưa hiểu
 *   thành "trùng mã" là biến một sự cố thành một lời khai sai.
 */
function laTrungKhoa(err: unknown): boolean {
  let e: unknown = err;
  for (let sau = 0; e != null && sau < 5; sau++) {
    const anyE = e as { code?: string; message?: string; cause?: unknown };
    if (anyE.code === "23505") return true;
    if (String(anyE.message ?? "").includes("duplicate key value violates unique constraint")) {
      return true;
    }
    e = anyE.cause;
  }
  return false;
}

/**
 * Chạy một lượt ghi, dịch 23505 thành `CONFLICT` + `ENTITY_DUPLICATE`.
 *
 * `thucThe` là khoá i18n `errors.entity.*` (không phải câu tiếng Việt viết tay),
 * và `fallbackMessage` nói RÕ đường ra cho log/API `/v1`/client chưa có i18n.
 */
async function ghiBatTrungKhoa<T>(
  thucThe: string,
  fallbackMessage: string,
  chay: () => Promise<T>,
): Promise<T> {
  try {
    return await chay();
  } catch (e) {
    if (laTrungKhoa(e)) {
      throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: thucThe }, fallbackMessage);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Toà nhà
// ---------------------------------------------------------------------------

export interface LuuToaNhaInput {
  /** Có `id` = SỬA, không có = TẠO MỚI. */
  id?: number;
  factoryId: number;
  ma: string;
  ten: string;
  rongMm: number;
  sauMm: number;
  caoMm: number;
  viTriXMm?: number;
  viTriYMm?: number;
  viTriZMm?: number;
  modelVoId?: number | null;
  donViNguon?: string | null;
  nguon?: NguonGiaTri;
}

/**
 * Tạo/sửa một toà nhà.
 *
 * ⚠ `factoryId` được kiểm phạm vi TRƯỚC mọi truy vấn. Khi SỬA, kiểm CẢ HAI: nhà
 * máy đích (input) và nhà máy hiện tại của hàng — nếu không, một `id` đoán được
 * sẽ cho phép "chuyển" toà nhà của tenant khác về nhà máy của mình.
 */
export async function luuToaNha(input: LuuToaNhaInput, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  if (!(await trongPhamVi("factory", input.factoryId, scope))) return null;

  const giaTri = {
    factoryId: input.factoryId,
    ma: input.ma.trim(),
    ten: input.ten.trim(),
    rongMm: soRaChuoi(input.rongMm),
    sauMm: soRaChuoi(input.sauMm),
    caoMm: soRaChuoi(input.caoMm),
    viTriXMm: soRaChuoi(input.viTriXMm ?? 0),
    viTriYMm: soRaChuoi(input.viTriYMm ?? 0),
    viTriZMm: soRaChuoi(input.viTriZMm ?? 0),
    modelVoId: input.modelVoId ?? null,
    donViNguon: input.donViNguon ?? null,
    // ★ NT-4 — mặc định 'tay': hàm này chỉ được gọi từ form người dùng điền.
    // Đường SINH tự động (Đợt 4) phải truyền 'sinh' TƯỜNG MINH.
    nguon: input.nguon ?? "tay",
  } as const;

  if (input.id) {
    const [cu] = await d
      .select({ factoryId: twinToaNha.factoryId })
      .from(twinToaNha)
      .where(eq(twinToaNha.id, input.id))
      .limit(1);
    if (!cu) return null;
    if (!(await trongPhamVi("factory", cu.factoryId, scope))) return null;

    // ★ Đợt 3 CHẶN-2 — SỬA cũng đụng ràng buộc: đổi `ma` sang mã của một toà nhà
    //   khác ĐANG SỐNG là 23505 y hệt lúc TẠO. Bọc cả hai nhánh, không chỉ nhánh
    //   insert (vá một nhánh rồi quên nhánh kia đúng là lớp lỗi "vá xong không
    //   kiểm NHÁNH KIA" của Đợt C).
    const [ket] = await ghiBatTrungKhoa(
      "twinToaNha",
      `Mã toà nhà "${giaTri.ma}" đã có trong nhà máy này. Chọn mã khác hoặc sửa toà nhà đang mang mã đó.`,
      () =>
        d
          .update(twinToaNha)
          .set({ ...giaTri, updatedAt: new Date() })
          .where(eq(twinToaNha.id, input.id as number))
          .returning(),
    );
    return ket ?? null;
  }

  const [ket] = await ghiBatTrungKhoa(
    "twinToaNha",
    `Mã toà nhà "${giaTri.ma}" đã có trong nhà máy này. Chọn mã khác hoặc sửa toà nhà đang mang mã đó.`,
    () => d.insert(twinToaNha).values(giaTri).returning(),
  );
  return ket ?? null;
}

/**
 * Xoá MỀM một toà nhà (`isActive = false`).
 *
 * ⚠ KHÔNG xoá cứng: `twin_tang` treo vào đây bằng `ON DELETE CASCADE`, và một
 * lượt DELETE thật sẽ kéo theo mọi tầng + mọi `twin_dat_cho`/`twin_vat_the` bên
 * dưới — tức là mọi vị trí máy đã đặt tay. Đó là dữ liệu người dùng bỏ công
 * dựng; một cú bấm nhầm không được phép làm bay nó (bài học WORM Khối C).
 */
export async function xoaToaNha(id: number, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [cu] = await d
    .select({ factoryId: twinToaNha.factoryId })
    .from(twinToaNha)
    .where(eq(twinToaNha.id, id))
    .limit(1);
  if (!cu) return null;
  if (!(await trongPhamVi("factory", cu.factoryId, scope))) return null;

  const [ket] = await d
    .update(twinToaNha)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(twinToaNha.id, id))
    .returning();
  return ket ?? null;
}

/** Danh sách toà nhà của một nhà máy. Ngoài phạm vi ⇒ mảng RỖNG. */
export async function traToaNhaTheoNhaMay(factoryId: number, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (!(await trongPhamVi("factory", factoryId, scope))) return [];

  return d
    .select()
    .from(twinToaNha)
    .where(and(eq(twinToaNha.factoryId, factoryId), eq(twinToaNha.isActive, true)))
    .orderBy(asc(twinToaNha.ma));
}

/**
 * Một toà nhà kèm các tầng của nó, đã quy đổi numeric → number.
 *
 * ★ Trả `null` cho cả "không có" lẫn "ngoài phạm vi" — xem docblock đầu file.
 */
export async function traToaNhaKemTang(id: number, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [toa] = await d.select().from(twinToaNha).where(eq(twinToaNha.id, id)).limit(1);
  if (!toa) return null;
  if (!(await trongPhamVi("factory", toa.factoryId, scope))) return null;

  const tangs = await d
    .select()
    .from(twinTang)
    .where(and(eq(twinTang.toaNhaId, id), eq(twinTang.isActive, true)))
    .orderBy(asc(twinTang.capSo));

  return {
    toaNha: {
      ...toa,
      rongMm: chuoiRaSo(toa.rongMm),
      sauMm: chuoiRaSo(toa.sauMm),
      caoMm: chuoiRaSo(toa.caoMm),
      viTriXMm: chuoiRaSo(toa.viTriXMm),
      viTriYMm: chuoiRaSo(toa.viTriYMm),
      viTriZMm: chuoiRaSo(toa.viTriZMm),
    },
    tangs: tangs.map((t) => ({
      ...t,
      caoDoMm: chuoiRaSo(t.caoDoMm),
      caoThongThuyMm: chuoiRaSo(t.caoThongThuyMm),
      daiMm: chuoiRaSo(t.daiMm),
      rongMm: chuoiRaSo(t.rongMm),
      tiLeMmMoiPx: chuoiRaSo(t.tiLeMmMoiPx),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tầng
// ---------------------------------------------------------------------------

export interface LuuTangInput {
  id?: number;
  toaNhaId: number;
  capSo: number;
  ten: string;
  caoDoMm: number;
  caoThongThuyMm: number;
  daiMm?: number | null;
  rongMm?: number | null;
  nguonHinhHoc?: NguonHinhHoc;
  nguon?: NguonGiaTri;
}

/**
 * Tra `factoryId` của toà nhà chứa một tầng — cổng phạm vi cho MỌI thao tác tầng.
 * `null` = tầng/toà nhà không tồn tại.
 */
async function nhaMayCuaToaNha(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  toaNhaId: number,
): Promise<number | null> {
  const [toa] = await d
    .select({ factoryId: twinToaNha.factoryId })
    .from(twinToaNha)
    .where(eq(twinToaNha.id, toaNhaId))
    .limit(1);
  return toa?.factoryId ?? null;
}

/**
 * Tạo/sửa một tầng.
 *
 * ★★★ NT-4 — LUẬT KHÔNG ĐÈ nằm ở tầng GỌI, không ở đây: hàm này ghi đúng những
 *   gì được truyền vào. Đường SINH tự động (Đợt 4) phải TỰ đọc `nguon` hiện tại
 *   và bỏ qua hàng `nguon='tay'` trước khi gọi. Đặt luật ở đây thì một đường ghi
 *   hợp lệ (người dùng sửa tay một tầng đã tay) cũng bị chặn.
 */
export async function luuTang(input: LuuTangInput, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const factoryId = await nhaMayCuaToaNha(d, input.toaNhaId);
  if (factoryId === null) return null;
  if (!(await trongPhamVi("factory", factoryId, scope))) return null;

  const giaTri = {
    toaNhaId: input.toaNhaId,
    capSo: input.capSo,
    ten: input.ten.trim(),
    caoDoMm: soRaChuoi(input.caoDoMm),
    caoThongThuyMm: soRaChuoi(input.caoThongThuyMm),
    // ⚠ NULL ở đây nghĩa "chưa ai đo mặt sàn này" và cảnh 3D lấy kích thước từ
    // toà nhà cha. KHÔNG được thay bằng một số mặc định: "chưa biết" hoá thành
    // "biết rồi, bằng X" là mất tin, đúng lớp lỗi NT-3.
    daiMm: input.daiMm === null || input.daiMm === undefined ? null : soRaChuoi(input.daiMm),
    rongMm: input.rongMm === null || input.rongMm === undefined ? null : soRaChuoi(input.rongMm),
    nguonHinhHoc: input.nguonHinhHoc ?? "sinh",
    nguon: input.nguon ?? "tay",
  } as const;

  if (input.id) {
    const [cu] = await d
      .select({ toaNhaId: twinTang.toaNhaId })
      .from(twinTang)
      .where(eq(twinTang.id, input.id))
      .limit(1);
    if (!cu) return null;
    // Kiểm CẢ toà nhà hiện tại của hàng, không chỉ toà nhà đích: nếu không, một
    // `id` đoán được sẽ chuyển tầng của tenant khác sang toà nhà của mình.
    const factoryCu = await nhaMayCuaToaNha(d, cu.toaNhaId);
    if (factoryCu === null || !(await trongPhamVi("factory", factoryCu, scope))) return null;

    // ★ Đợt 3 CHẶN-2 — cùng lý do như `luuToaNha`: đổi `capSo` sang cấp số của
    //   một tầng khác ĐANG SỐNG trong cùng toà nhà cũng là 23505.
    const [ket] = await ghiBatTrungKhoa(
      "twinTang",
      `Toà nhà này đã có tầng cấp số ${giaTri.capSo}. Chọn cấp số khác hoặc sửa tầng đang mang cấp số đó.`,
      () =>
        d
          .update(twinTang)
          .set({ ...giaTri, updatedAt: new Date() })
          .where(eq(twinTang.id, input.id as number))
          .returning(),
    );
    return ket ?? null;
  }

  const [ket] = await ghiBatTrungKhoa(
    "twinTang",
    `Toà nhà này đã có tầng cấp số ${giaTri.capSo}. Chọn cấp số khác hoặc sửa tầng đang mang cấp số đó.`,
    () => d.insert(twinTang).values(giaTri).returning(),
  );
  return ket ?? null;
}

/**
 * Xoá MỀM một tầng. Cùng lý do như `xoaToaNha`: `twin_dat_cho`/`twin_vat_the`
 * CASCADE theo tầng, nên xoá cứng làm bay mọi vị trí máy đã đặt tay.
 */
export async function xoaTang(id: number, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [cu] = await d
    .select({ toaNhaId: twinTang.toaNhaId })
    .from(twinTang)
    .where(eq(twinTang.id, id))
    .limit(1);
  if (!cu) return null;

  const factoryId = await nhaMayCuaToaNha(d, cu.toaNhaId);
  if (factoryId === null || !(await trongPhamVi("factory", factoryId, scope))) return null;

  const [ket] = await d
    .update(twinTang)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(twinTang.id, id))
    .returning();
  return ket ?? null;
}

/** Gắn ảnh nền + tỉ lệ cho một tầng (§7.4 công cụ "Đặt tỉ lệ"). */
export async function ganAnhNenTang(
  input: {
    tangId: number;
    anhNenUrl: string;
    anhNenKey?: string | null;
    tiLeMmMoiPx?: number | null;
    daHieuChuan?: boolean;
  },
  scope?: PhamViNguoiXem,
) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [cu] = await d
    .select({ toaNhaId: twinTang.toaNhaId })
    .from(twinTang)
    .where(eq(twinTang.id, input.tangId))
    .limit(1);
  if (!cu) return null;
  const factoryId = await nhaMayCuaToaNha(d, cu.toaNhaId);
  if (factoryId === null || !(await trongPhamVi("factory", factoryId, scope))) return null;

  const [ket] = await d
    .update(twinTang)
    .set({
      anhNenUrl: input.anhNenUrl,
      anhNenKey: input.anhNenKey ?? null,
      tiLeMmMoiPx:
        input.tiLeMmMoiPx === null || input.tiLeMmMoiPx === undefined
          ? null
          : soRaChuoi(input.tiLeMmMoiPx),
      // ★ `daHieuChuan` mặc định FALSE khi chỉ tải ảnh lên: chưa ai click hai
      // điểm + nhập khoảng cách thật thì tỉ lệ chỉ là phỏng đoán, và UI phải nói
      // thế. Chỉ công cụ "Đặt tỉ lệ" mới được truyền `true`.
      daHieuChuan: input.daHieuChuan ?? false,
      updatedAt: new Date(),
    })
    .where(eq(twinTang.id, input.tangId))
    .returning();
  return ket ?? null;
}

// ---------------------------------------------------------------------------
// Tường bao sinh tự động (§10A.2)
// ---------------------------------------------------------------------------

export interface TuongBaoGhi {
  ten: string;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number;
  caoMm: number;
  sauMm: number;
}

/**
 * Ghi 4 tường bao sinh tự động cho một tầng.
 *
 * ★★★ CHỈ THAY tường mang `nguon='sinh'`. Tường người dùng đã sửa tay
 *   (`nguon='tay'`) được GIỮ NGUYÊN — đó là luật KHÔNG ĐÈ của NT-4, và đây là
 *   một trong hai chỗ trong Đợt 3 mà luật ấy được cưỡng chế bằng câu SQL chứ
 *   không bằng quy ước (chỗ kia là `apDungCaoDoTuTinh`).
 *
 * ⚠ Xoá CỨNG tường 'sinh' cũ là ĐÚNG ở đây, khác với toà nhà/tầng: một bức
 *   tường máy vẽ không mang dữ liệu người dùng nào, và giữ lại thì mỗi lần sinh
 *   sẽ chồng thêm 4 bức mới lên 4 bức cũ (lớp lỗi "lưới ghi vĩnh viễn" của
 *   BG-93 nhưng ở chiều ngược lại: nhân bản thay vì mất).
 */
export async function ghiDeTuongBaoSinh(
  tangId: number,
  tuongs: readonly TuongBaoGhi[],
  scope?: PhamViNguoiXem,
): Promise<number | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [cu] = await d
    .select({ toaNhaId: twinTang.toaNhaId })
    .from(twinTang)
    .where(eq(twinTang.id, tangId))
    .limit(1);
  if (!cu) return null;
  const factoryId = await nhaMayCuaToaNha(d, cu.toaNhaId);
  if (factoryId === null || !(await trongPhamVi("factory", factoryId, scope))) return null;

  return d.transaction(async (tx) => {
    await tx
      .delete(twinVatThe)
      .where(
        and(
          eq(twinVatThe.tangId, tangId),
          eq(twinVatThe.loai, "tuong"),
          eq(twinVatThe.nguon, "sinh"),
        ),
      );
    if (tuongs.length === 0) return 0;
    const daGhi = await tx
      .insert(twinVatThe)
      .values(
        tuongs.map((t, i) => ({
          tangId,
          loai: "tuong" as const,
          ten: t.ten,
          viTriXMm: soRaChuoi(t.viTriXMm),
          viTriYMm: soRaChuoi(t.viTriYMm),
          viTriZMm: soRaChuoi(t.viTriZMm),
          rongMm: soRaChuoi(t.rongMm),
          caoMm: soRaChuoi(t.caoMm),
          sauMm: soRaChuoi(t.sauMm),
          thuTu: i,
          // ★ Cột `nguon` của `twin_vat_the` mặc định 'tay'; tường bao SINH phải
          // ghi đè TƯỜNG MINH thành 'sinh', nếu không lần sinh sau sẽ không xoá
          // được chúng và chúng sẽ nhân bản.
          nguon: "sinh" as const,
        })),
      )
      .returning({ id: twinVatThe.id });
    return daGhi.length;
  });
}

/**
 * Đếm vật thể theo loại của một tầng — dùng cho đối soát và cho UI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LÔ K/K2 — `scope` KHÔNG PHẢI THAM SỐ TUỲ CHỌN CHO VUI
 * ════════════════════════════════════════════════════════════════════════════
 * Bản trước hàm này KHÔNG nhận `scope`, và `twinCanhRouter.demVatThe` gọi nó
 * bằng `async ({ input })` — **không bóc `ctx` ra một lần nào**. Hậu quả ĐO
 * ĐƯỢC: `tangIds` là lời **TỰ KHAI của client**, nên bất kỳ ai qua được cổng
 * `quyenThietKe("canView")` đều đếm được vật thể của MỌI tầng thuộc MỌI nhà
 * máy — chỉ cần đoán một số nguyên. Đây đúng lớp lỗi đã có tên trong sổ dự án:
 * *"hàng rào tenant lọc theo cột CLIENT TỰ KHAI"*.
 *
 * ⚠ Cổng quyền và hàng rào tenant là HAI trục khác nhau, và trục thứ hai vắng
 *   mặt ở đây. `quyenThietKe` trả lời "vai này được xem thiết kế không"; nó
 *   KHÔNG trả lời "nhà máy này có phải của người ấy không". Một cổng quyền xanh
 *   che mất việc hàng rào tenant chưa từng được dựng.
 *
 * ⇒ Lọc theo ĐÚNG khuôn của `traDatChoTheoTang` (`:866`) — bản sao nguyên văn,
 *   không dựng luật phạm vi thứ hai: suy nhà máy của từng tầng rồi hỏi
 *   `trongPhamVi`. Tầng ngoài phạm vi bị LOẠI KHỎI DANH SÁCH, không ném lỗi:
 *   một câu lỗi riêng cho ca "có thật nhưng của tenant khác" là một oracle rò
 *   rỉ tồn-tại, đúng lý lẽ đã ghi ở `luuToaNha`.
 *
 * ⚠ `scope` **tuỳ chọn** giữ nguyên chiều DƯƠNG của `PhamViNguoiXem`: vắng danh
 *   tính ⇒ `idsTrongPhamVi` trả `null` ⇒ KHÔNG lọc. Đó là hình dạng có thật của
 *   lối gọi nội bộ (seed, script), và là thứ chặn "vá quá tay thành chặn tất cả".
 */
export async function demVatTheTheoTang(tangIds: readonly number[], scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (tangIds.length === 0) return [];

  // ★ G12 — TÁI DÙNG `locTangTrongPhamVi` (`:1587`), KHÔNG viết bản thứ ba của
  //   cùng một luật. Repo đã có HAI nơi hỏi "tầng nào người này được thấy"
  //   (`traVungAnToan`, `luuVungAnToan`); một bản chép thứ ba là chỗ hai bản cài
  //   đặt bắt đầu lệch nhau. Nó cũng rẻ hơn: MỘT truy vấn cho cả danh sách tầng
  //   thay vì một truy vấn mỗi tầng.
  const hopLe = await locTangTrongPhamVi(d, tangIds, scope ?? {});
  if (hopLe.length === 0) return [];

  return d
    .select({ id: twinVatThe.id, tangId: twinVatThe.tangId, loai: twinVatThe.loai, nguon: twinVatThe.nguon })
    .from(twinVatThe)
    .where(inArray(twinVatThe.tangId, hopLe));
}

// ═══════════════════════════════════════════════════════════════════════════
// ĐỢT 4 (§7) — ĐƯỜNG GHI CỦA MÀN THIẾT KẾ: đặt chỗ hàng loạt + sinh tự động
// ═══════════════════════════════════════════════════════════════════════════
//
// ★★★ NỢ N-1 CỦA ĐỢT 3 — QUYẾT ĐỊNH CỦA ĐỢT 4, ghi ở đây vì đây là chỗ nó được
//     giải. Spec §12.1b để lại câu hỏi: "chấp nhận `dungNhaXuong` không chạy
//     trong một transaction, hay tách một lớp transaction không cần quyền?"
//
//     Đợt 4 chọn phương án THỨ HAI, và nó rẻ hơn nhiều so với mô tả trong nợ:
//     `trongPhamVi` KHÔNG cần nằm trong `tx`. Phạm vi là câu hỏi về NGƯỜI GỌI
//     (họ được thấy nhà máy nào), không phải về các hàng sắp ghi; nó không đọc
//     bảng nào mà transaction này ghi. Nên khuôn đúng là:
//
//         kiểm quyền + phạm vi  ─── NGOÀI transaction (một lần, ở trên)
//         ghi mọi hàng          ─── TRONG transaction (nguyên tử)
//
//     Đây đúng là khuôn `ghiDeTuongBaoSinh` đã dùng từ Đợt 3 — tức là repo đã
//     có sẵn câu trả lời, chỉ chưa ai nối nó với nợ N-1. Không cần "hệ phân
//     quyền thứ hai" nào cả.
//
//     ⚠ Đánh đổi phải nói thẳng: giữa lúc kiểm phạm vi và lúc commit có một cửa
//     sổ mà quyền của người dùng có thể bị thu hồi. Cửa sổ đó tính bằng mili
//     giây và tồn tại y hệt ở MỌI procedure của repo (kiểm ở middleware, ghi ở
//     handler) — nó không phải thứ Đợt 4 mới tạo ra, và đóng nó đòi khoá hàng
//     phân quyền trong cùng tx, tức chính "hệ thứ hai" mà `hierarchy.ts` cấm.

/** Một hàng `twin_dat_cho` đi vào đường ghi hàng loạt (§7.3 "Lưu"). */
export interface DatChoGhi {
  loaiThucThe: "workshop" | "line" | "station" | "machine" | "workstation";
  thucTheId: number;
  tangId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm?: number | null;
  caoMm?: number | null;
  sauMm?: number | null;
  kichThuocDaDo?: boolean;
  quatX?: number;
  quatY?: number;
  quatZ?: number;
  quatW?: number;
  daKhoa?: boolean;
  hienThi?: boolean;
  /** Ai ghi hàng này. Người kéo tay ⇒ 'tay' (NT-4: lần sinh sau KHÔNG đè). */
  nguon?: NguonGiaTri;
}

/**
 * Trần một lô ghi. Khớp `TRAN_LO_GHI` của `trangThaiThietKe.ts` — hai hằng ở hai
 * phía đường dây phải bằng nhau, nếu không client chia lô 500 mà server từ chối
 * ở 200, và lần Lưu đầu tiên vượt 200 sẽ hỏng.
 */
export const TRAN_LO_DAT_CHO = 500;

/** Số → chuỗi numeric, giữ NULL là NULL ("chưa biết" khác 0 — xem schema §5.3). */
function soRaChuoiCoNull(gt: number | null | undefined): string | null {
  return gt === null || gt === undefined ? null : soRaChuoi(gt);
}

/**
 * Tra `factoryId` của tầng — cổng phạm vi cho mọi thao tác đặt chỗ.
 * `null` = tầng không tồn tại (hoặc toà nhà của nó không tồn tại).
 */
async function nhaMayCuaTang(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tangId: number,
): Promise<number | null> {
  const [t] = await d
    .select({ toaNhaId: twinTang.toaNhaId })
    .from(twinTang)
    .where(eq(twinTang.id, tangId))
    .limit(1);
  if (!t) return null;
  return nhaMayCuaToaNha(d, t.toaNhaId);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THƯỜNG-1 — THỰC THỂ ĐÍCH PHẢI TỒN TẠI TRƯỚC KHI ĐẶT CHỖ
 * ════════════════════════════════════════════════════════════════════════════
 * Ca dương đo được trước bản vá: gửi `thucTheId: 999999` (không có hàng nào
 * trong `machines`) → HTTP 200 `{"daGhi":1,"daTao":1}`. Hàng đặt chỗ trỏ tới
 * một cái máy không tồn tại được ghi thành công và im lặng.
 *
 * ★ Vì sao đây là lỗi THẬT chứ không phải chuyện sạch sẽ: dải "Sức khoẻ dữ liệu"
 *   của §7.1 đếm `datChoMoCoi` — đặt chỗ không khớp thực thể nào. Đường ghi này
 *   CHÍNH LÀ nguồn sinh ra thứ mà phép đo kia phải đi dọn. Một hệ vừa sinh rác
 *   vừa đếm rác của chính mình thì con số đếm được không nói lên điều gì về thế
 *   giới.
 *
 * ⚠ VÌ SAO KIỂM Ở ĐÂY CHỨ KHÔNG PHẢI THÊM FOREIGN KEY:
 *   `twin_dat_cho` có MỘT cặp cột `(loaiThucThe, thucTheId)` trỏ tới NĂM bảng
 *   khác nhau (khoá đa hình). Postgres KHÔNG có FK đa hình — muốn dùng FK phải
 *   tách thành năm cột nullable + năm ràng buộc, tức đổi schema và di trú toàn
 *   bộ dữ liệu đang có. Kiểm ở tầng ghi bắt đúng lớp lỗi đó với chi phí một
 *   query trên mỗi LOẠI (không phải mỗi hàng).
 *
 * ⚠ KHÔNG chống được đua: một máy bị xoá giữa lúc kiểm và lúc ghi vẫn lọt. Cửa
 *   sổ đó hẹp và hậu quả là một hàng mồ côi — đúng thứ dải Sức khoẻ đã đếm
 *   được. Khai rõ giới hạn thay vì để người sau tưởng đây là bảo đảm tuyệt đối.
 *
 * @returns danh sách khoá `loai:id` KHÔNG tồn tại (rỗng = mọi thực thể có thật).
 */
async function thucTheKhongTonTai(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  hangs: readonly { loaiThucThe: DatChoGhi["loaiThucThe"]; thucTheId: number }[],
): Promise<string[]> {
  const bang = {
    workshop: workshops,
    line: productionLines,
    station: stations,
    machine: machines,
    workstation: workstations,
  } as const;

  const thieu: string[] = [];
  for (const loai of new Set(hangs.map((h) => h.loaiThucThe))) {
    const ids = [...new Set(hangs.filter((h) => h.loaiThucThe === loai).map((h) => h.thucTheId))];
    if (ids.length === 0) continue;
    const t = bang[loai];
    const co = await d.select({ id: t.id }).from(t).where(inArray(t.id, ids));
    const coSet = new Set(co.map((r) => r.id));
    for (const id of ids) if (!coSet.has(id)) thieu.push(`${loai}:${id}`);
  }
  return thieu;
}

/** Kết quả một lượt ghi hàng loạt. */
export interface KetQuaGhiHangLoat {
  daGhi: number;
  daTao: number;
  daCapNhat: number;
}

/**
 * Ghi hàng loạt `twin_dat_cho` trong MỘT transaction (§7.3 "Lưu").
 *
 * ★★★ UPSERT theo `uq_twin_dat_cho_thuc_the` (loaiThucThe, thucTheId) — bất biến
 *   quan trọng nhất của mô hình (§5.3: "một máy có ĐÚNG MỘT vị trí"). Dùng
 *   `onConflictDoUpdate` chứ KHÔNG phải "đọc rồi quyết định insert/update":
 *   khuôn đọc-rồi-ghi có cửa sổ đua, và dưới cửa sổ đó hai phiên cùng lưu sẽ
 *   ném 23505 lên mặt người dùng thay vì hoà nhau một cách yên lành.
 *
 * ★ MỌI tầng đích phải nằm trong phạm vi người gọi. Kiểm TRƯỚC transaction, và
 *   kiểm cho TẬP tangId DUY NHẤT (không phải cho từng hàng) — 500 hàng cùng một
 *   tầng chỉ tốn một lượt kiểm.
 *
 * ★★★ `updatedAt` ghi TƯỜNG MINH `new Date()`: cột có `defaultNow()` nhưng
 *   default chỉ áp lúc INSERT. Nhánh UPDATE của upsert giữ `updatedAt` CŨ nếu
 *   không gán, và khi đó phép đo G5b ("updatedAt đã tiến" chứng minh đường ghi
 *   có chạy) sẽ báo ÂM TÍNH GIẢ trên một lượt ghi ĐÃ THÀNH CÔNG.
 *
 * @returns `null` khi có tầng ngoài phạm vi / không tồn tại — KHÔNG phân biệt
 *          hai ca (oracle rò rỉ tồn-tại, xem docblock đầu file).
 */
export async function ghiDatChoHangLoat(
  hangs: readonly DatChoGhi[],
  scope?: PhamViNguoiXem,
): Promise<KetQuaGhiHangLoat | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (hangs.length === 0) return { daGhi: 0, daTao: 0, daCapNhat: 0 };
  if (hangs.length > TRAN_LO_DAT_CHO) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "hangs", reason: `toi da ${TRAN_LO_DAT_CHO} hang moi lo` },
      `Mot lo toi da ${TRAN_LO_DAT_CHO} hang; nhan ${hangs.length}`,
    );
  }

  // ── Cổng phạm vi: NGOÀI transaction (nợ N-1, xem docblock khối) ────────────
  const tangIds = [...new Set(hangs.map((h) => h.tangId))];
  for (const tangId of tangIds) {
    const factoryId = await nhaMayCuaTang(d, tangId);
    if (factoryId === null) return null;
    if (!(await trongPhamVi("factory", factoryId, scope))) return null;
  }

  // ── ★★★ THƯỜNG-1 — cổng TỒN TẠI, xem `thucTheKhongTonTai` ─────────────────
  //
  // ⚠ Ném BAD_REQUEST chứ KHÔNG trả `null`: `null` ở hàm này đã mang nghĩa
  //   "ngoài phạm vi / tầng không tồn tại" và người gọi dịch nó thành NOT_FOUND
  //   `twinTang`. Gộp hai ca vào một mã trả về sẽ báo cho người dùng rằng TẦNG
  //   sai trong khi thứ sai là MÁY — chẩn đoán dẫn nhầm hướng.
  //
  // ⚠ Thông báo có liệt kê khoá thiếu. Đây KHÔNG phải rò rỉ oracle tồn-tại như
  //   cổng phạm vi ở trên: tới được đây nghĩa là người gọi ĐÃ qua cổng phạm vi
  //   của tầng đích, và các khoá này do CHÍNH họ vừa gửi lên.
  const thieu = await thucTheKhongTonTai(d, hangs);
  if (thieu.length > 0) {
    throw appError(
      "BAD_REQUEST",
      "ENTITY_NOT_FOUND",
      { entity: "twinDatCho", thucThe: thieu.slice(0, 20).join(", ") },
      `Thực thể không tồn tại: ${thieu.slice(0, 20).join(", ")}${thieu.length > 20 ? ` (+${thieu.length - 20})` : ""}`,
    );
  }

  // Đếm hàng ĐÃ CÓ trước khi ghi, để phân biệt tạo mới với cập nhật. Đây là con
  // số BÁO CÁO (hiện trên toast), không điều khiển hành vi ghi nào.
  const khoaCu = new Set<string>();
  for (const loai of new Set(hangs.map((h) => h.loaiThucThe))) {
    const ids = hangs.filter((h) => h.loaiThucThe === loai).map((h) => h.thucTheId);
    if (ids.length === 0) continue;
    const cu = await d
      .select({ thucTheId: twinDatCho.thucTheId })
      .from(twinDatCho)
      .where(and(eq(twinDatCho.loaiThucThe, loai), inArray(twinDatCho.thucTheId, ids)));
    for (const r of cu) khoaCu.add(`${loai}:${r.thucTheId}`);
  }

  const bayGio = new Date();
  await d.transaction(async (tx) => {
    for (const h of hangs) {
      const giaTri = {
        tangId: h.tangId,
        loaiThucThe: h.loaiThucThe,
        thucTheId: h.thucTheId,
        viTriXMm: soRaChuoi(h.viTriXMm),
        viTriYMm: soRaChuoi(h.viTriYMm),
        viTriZMm: soRaChuoi(h.viTriZMm),
        rongMm: soRaChuoiCoNull(h.rongMm),
        caoMm: soRaChuoiCoNull(h.caoMm),
        sauMm: soRaChuoiCoNull(h.sauMm),
        kichThuocDaDo: h.kichThuocDaDo ?? false,
        quatX: soRaChuoi(h.quatX ?? 0),
        quatY: soRaChuoi(h.quatY ?? 0),
        quatZ: soRaChuoi(h.quatZ ?? 0),
        quatW: soRaChuoi(h.quatW ?? 1),
        daKhoa: h.daKhoa ?? false,
        hienThi: h.hienThi ?? true,
        nguon: h.nguon ?? "tay",
        updatedAt: bayGio,
      };
      await tx
        .insert(twinDatCho)
        .values(giaTri)
        .onConflictDoUpdate({
          target: [twinDatCho.loaiThucThe, twinDatCho.thucTheId],
          set: {
            tangId: giaTri.tangId,
            viTriXMm: giaTri.viTriXMm,
            viTriYMm: giaTri.viTriYMm,
            viTriZMm: giaTri.viTriZMm,
            rongMm: giaTri.rongMm,
            caoMm: giaTri.caoMm,
            sauMm: giaTri.sauMm,
            kichThuocDaDo: giaTri.kichThuocDaDo,
            quatX: giaTri.quatX,
            quatY: giaTri.quatY,
            quatZ: giaTri.quatZ,
            quatW: giaTri.quatW,
            daKhoa: giaTri.daKhoa,
            hienThi: giaTri.hienThi,
            nguon: giaTri.nguon,
            updatedAt: bayGio,
          },
        });
    }
  });

  const daCapNhat = hangs.filter((h) => khoaCu.has(`${h.loaiThucThe}:${h.thucTheId}`)).length;
  return { daGhi: hangs.length, daTao: hangs.length - daCapNhat, daCapNhat };
}

/**
 * Gỡ một thực thể khỏi mặt bằng (§7.3 "Gỡ khỏi mặt bằng", phím Delete).
 *
 * ★★★ XOÁ HÀNG `twin_dat_cho`, TUYỆT ĐỐI KHÔNG chạm `machines`. Máy quay về
 *   "Khu chờ xếp chỗ" và mọi dữ liệu vận hành của nó nguyên vẹn. Hộp thoại xác
 *   nhận ở client nói đúng điều đó — mã ở đây phải khớp với lời hộp thoại, nếu
 *   không thì lời hứa trên UI là lời khai không ai kiểm.
 */
export async function goKhoiMatBang(
  loaiThucThe: DatChoGhi["loaiThucThe"],
  thucTheId: number,
  scope?: PhamViNguoiXem,
): Promise<boolean> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [cu] = await d
    .select({ tangId: twinDatCho.tangId })
    .from(twinDatCho)
    .where(and(eq(twinDatCho.loaiThucThe, loaiThucThe), eq(twinDatCho.thucTheId, thucTheId)))
    .limit(1);
  if (!cu) return false;

  const factoryId = await nhaMayCuaTang(d, cu.tangId);
  if (factoryId === null || !(await trongPhamVi("factory", factoryId, scope))) return false;

  const xoa = await d
    .delete(twinDatCho)
    .where(and(eq(twinDatCho.loaiThucThe, loaiThucThe), eq(twinDatCho.thucTheId, thucTheId)))
    .returning({ id: twinDatCho.id });
  return xoa.length > 0;
}

/**
 * Đọc mọi đặt chỗ của một tập tầng, numeric đã quy về number.
 *
 * ★ Quy đổi Ở ĐÂY, không ở client: đây là ranh giới duy nhất mà "numeric ra
 *   string" được phép tồn tại. Để string lọt lên client thì mọi phép cộng toạ độ
 *   trên UI thành nối chuỗi (xem cảnh báo đầu file), và biểu hiện là máy nhảy ra
 *   ngoài vũ trụ chứ không phải một lỗi đọc được.
 */
export async function traDatChoTheoTang(tangIds: readonly number[], scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (tangIds.length === 0) return [];

  const hopLe: number[] = [];
  for (const tangId of new Set(tangIds)) {
    const factoryId = await nhaMayCuaTang(d, tangId);
    if (factoryId === null) continue;
    if (await trongPhamVi("factory", factoryId, scope)) hopLe.push(tangId);
  }
  if (hopLe.length === 0) return [];

  const hang = await d.select().from(twinDatCho).where(inArray(twinDatCho.tangId, hopLe));
  return hang.map((h) => ({
    id: h.id,
    tangId: h.tangId,
    loaiThucThe: h.loaiThucThe,
    thucTheId: h.thucTheId,
    viTriXMm: chuoiRaSo(h.viTriXMm) ?? 0,
    viTriYMm: chuoiRaSo(h.viTriYMm) ?? 0,
    viTriZMm: chuoiRaSo(h.viTriZMm) ?? 0,
    rongMm: chuoiRaSo(h.rongMm),
    caoMm: chuoiRaSo(h.caoMm),
    sauMm: chuoiRaSo(h.sauMm),
    kichThuocDaDo: h.kichThuocDaDo,
    quatX: chuoiRaSo(h.quatX) ?? 0,
    quatY: chuoiRaSo(h.quatY) ?? 0,
    quatZ: chuoiRaSo(h.quatZ) ?? 0,
    quatW: chuoiRaSo(h.quatW) ?? 1,
    daKhoa: h.daKhoa,
    hienThi: h.hienThi,
    nguon: h.nguon,
    updatedAt: h.updatedAt,
  }));
}

/**
 * Cây phân cấp phẳng của một nhà máy — đầu vào cho `sinhBoCuc` và cho cây trái.
 *
 * ★ `machines` KHÔNG có cột `factoryId` (đo được 2026-09-06: nhà máy suy qua
 *   `stations → production_lines → workshops.factoryId`). Viết `machines.factoryId`
 *   là lỗi biên dịch, nhưng suy nhầm đường JOIN thì KHÔNG — nó chỉ trả về ít máy
 *   hơn thực tế, và cây trái thiếu máy mà không ai biết.
 */
export async function traCayPhanCapNhaMay(factoryId: number, scope?: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (!(await trongPhamVi("factory", factoryId, scope))) {
    return { xuong: [], chuyen: [], tram: [], may: [] };
  }

  const xuong = await d
    .select({ id: workshops.id, ma: workshops.code, ten: workshops.name, factoryId: workshops.factoryId })
    .from(workshops)
    .where(eq(workshops.factoryId, factoryId));
  const xuongIds = xuong.map((x) => x.id);
  if (xuongIds.length === 0) return { xuong: [], chuyen: [], tram: [], may: [] };

  const chuyen = await d
    .select({ id: productionLines.id, ma: productionLines.code, ten: productionLines.name, workshopId: productionLines.workshopId })
    .from(productionLines)
    .where(inArray(productionLines.workshopId, xuongIds));
  const chuyenIds = chuyen.map((c) => c.id);
  if (chuyenIds.length === 0) return { xuong, chuyen, tram: [], may: [] };

  const tram = await d
    .select({ id: stations.id, ma: stations.code, ten: stations.name, lineId: stations.lineId, thuTu: stations.orderIndex })
    .from(stations)
    .where(inArray(stations.lineId, chuyenIds));
  const tramIds = tram.map((t) => t.id);
  if (tramIds.length === 0) return { xuong, chuyen, tram, may: [] };

  const may = await d
    .select({
      id: machines.id,
      ma: machines.code,
      ten: machines.name,
      loaiMay: machines.machineType,
      isActive: machines.isActive,
      stationId: machines.stationId,
    })
    .from(machines)
    .where(inArray(machines.stationId, tramIds));

  return { xuong, chuyen, tram, may };
}

/** Bảng kích thước mặc định theo loại máy (§5.3 bậc 2 của chuỗi dự phòng). */
export async function traKichThuocTheoLoai() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  const hang = await d.select().from(twinKichThuocLoai);
  return hang.map((h) => ({
    loaiMay: h.loaiMay,
    rongMm: chuoiRaSo(h.rongMm) ?? 0,
    caoMm: chuoiRaSo(h.caoMm) ?? 0,
    sauMm: chuoiRaSo(h.sauMm) ?? 0,
    laGiaDinh: h.laGiaDinh,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 6 (§6.3) — TRẠNG THÁI HÀNG LOẠT CHO VÒNG RENDER CỦA `/twin`        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Một máy kèm trạng thái đã xét tuổi — hình dạng §6.3 của `trangThaiHangLoat`.
 *
 * ★★★ `doTuoiGiay` là ô QUAN TRỌNG NHẤT, và nó có `null` THẬT.
 *
 * §6.3 ghi cột `doTuoiGiay`, nhưng một `number` đơn thuần KHÔNG diễn đạt nổi ba
 * trạng thái mà G15/NT-3 đòi: *đã đo · đang đo · **chưa từng đo***. Nếu máy chưa
 * bao giờ báo cáo mà ta trả `0`, client đọc được "vừa cập nhật xong 0 giây
 * trước" — tức là câu NÓI DỐI mạnh nhất có thể về một máy đã im lặng vĩnh viễn.
 *
 * ⇒ `capNhatLuc = null` **và** `doTuoiGiay = null` ⇔ CHƯA TỪNG có dữ liệu.
 *   Đo được trên DB này: 2/42 máy rơi vào ca đó (xem docblock
 *   `trungThucDuLieu.ts`). Không phải ca lý thuyết.
 */
export interface TrangThaiMayHangLoat {
  machineId: number;
  ma: string;
  ten: string;
  loaiMay: string | null;
  isActive: boolean;
  stationId: number | null;
  /** Giá trị máy TỰ KHAI (`machines.operationStatus`) — CHƯA xét tuổi. */
  trangThai: string | null;
  /** Điểm sức khoẻ 0-100 nếu có; `null` = chưa đo (NT-3.5: `—`, không phải `0`). */
  diemSucKhoe: number | null;
  /** ms epoch của DỮ LIỆU (không phải thời điểm render). `null` = chưa từng có. */
  capNhatLuc: number | null;
  /** Tuổi dữ liệu (giây). `null` = CHƯA TỪNG báo cáo — KHÔNG được quy về 0. */
  doTuoiGiay: number | null;
  /** Uptime 24h (%) — `null` khi cửa sổ 24h không có bản ghi nào để tính. */
  uptimePhanTram: number | null;
}

/**
 * Trạng thái toàn bộ máy của một nhà máy — **SỐ QUERY CỐ ĐỊNH, KHÔNG N+1** (§6.3).
 *
 * Tổng: 4 truy vấn cây phân cấp (`traCayPhanCapNhaMay`) + 1 đọc `machines` +
 * 3 của `trangThaiTapMay` — **không phụ thuộc số máy**. Đo được: N = 1…42 đều
 * cho `trangThaiTapMay` = 3 query (xem thông điệp commit `trangThaiTapMay`).
 *
 * ★ DÙNG LẠI `trangThaiTapMay` của `db/machine.ts`, KHÔNG chép ba truy vấn sang
 *   đây. Luật G12 — xem docblock của hàm đó.
 *
 * ⚠ `bayGio` là THAM SỐ, không phải `Date.now()` ẩn: `doTuoiGiay` phải tất định
 *   trong test, và một `Date.now()` nằm sâu trong tầng db là thứ test không với
 *   tới được.
 */
/**
 * ★★★ PHÉP QUY TUỔI — hàm THUẦN, tách khỏi I/O để TEST ĐƯỢC.
 *
 * Tách ra vì hai quyết định dưới đây đều do PHÉP ĐO ép ra chứ không hiển nhiên,
 * nên chúng phải có test ghim; mà một hàm chạm DB thì test phải dựng DB, và
 * test cần DB là test hay bị tắt. Xem `traTrangThaiHangLoat` cho phần I/O.
 *
 * Hai luật hàm này cưỡng chế:
 *  1. Mốc tươi = **NHỊP TIM**, không trộn `machine_status_logs` (xem docblock
 *     trong `traTrangThaiHangLoat` — đo được 3 conveyor tự khai 0,4 ngày trong
 *     khi im lặng 51,7 ngày).
 *  2. Chưa từng có dữ liệu ⇒ `capNhatLuc`/`doTuoiGiay` = **`null`**, KHÔNG phải
 *     `0`. `0` nghĩa là "vừa cập nhật xong", tức câu nói dối mạnh nhất có thể
 *     về một máy im lặng vĩnh viễn (NT-3.5).
 */
/**
 * ★★★ ĐỢT 6 VÁ THƯỜNG-4 — CHỌN NGUỒN MỐC TƯƠI, TÁCH RA ĐỂ TEST ĐƯỢC.
 *
 * ⚠ VÙNG MÙ ĐÃ CÓ (QA đo 2026-09-07): `quyTuoiMay` là hàm thuần và có 14 test
 * xanh, NHƯNG nó chỉ nhận `{hbBang, hbMay}` — nó KHÔNG BAO GIỜ THẤY
 * `machine_status_logs`. Việc chọn "lấy nguồn nào làm mốc" nằm ở CHỖ GỌI, và
 * chỗ gọi thì KHÔNG test nào với tới. QA tiêm đúng vào đó — đổi thành
 * `max(status_log, heartbeat)` — và **14/14 test VẪN XANH**.
 *
 * Đây ĐÚNG là lỗi mà Đợt 6 tự gây rồi tự sửa (G19): 3 băng tải im lặng 51,7
 * ngày tự khai thành 0,4 ngày. Tự sửa mà KHÔNG ghim thì lần sau lại trôi về.
 *
 * ⇒ Phép chọn nguồn nay là HÀM THUẦN CÓ EXPORT, và test import ĐÚNG nó.
 *
 * ★★★ LUẬT NÓ CƯỠNG CHẾ: mốc tươi CHỈ lấy từ NHỊP TIM — `machines.lastHeartbeat`
 * và bảng `machine_heartbeats`, cùng một đại lượng chỉ khác chỗ lưu. TUYỆT ĐỐI
 * KHÔNG trộn `machine_status_logs`: một hàng log trạng thái là SỰ KIỆN, không
 * phải phép đo "máy này còn nói chuyện với ta không". Trộn vào là làm máy đã
 * ngừng gửi nhịp tim 52 ngày tự khai là mới 0,4 ngày.
 *
 * ★ Chữ ký CỐ Ý nhận cả `statusLogTs` dù KHÔNG dùng: để một đột biến "trộn
 *   status_log vào" phải sửa ĐÚNG hàm này (nơi có test soi), thay vì lặng lẽ
 *   thêm một nguồn ở chỗ gọi mà không test nào thấy.
 */
export function chonNguonMocTuoi(nguon: {
  hbBang: Date | string | null | undefined;
  hbMay: Date | string | null | undefined;
  statusLogTs?: Date | string | null | undefined;
}): { hbBang: Date | string | null | undefined; hbMay: Date | string | null | undefined } {
  // `statusLogTs` được nhận rồi VỨT ĐI — có chủ đích, xem docblock.
  void nguon.statusLogTs;
  return { hbBang: nguon.hbBang, hbMay: nguon.hbMay };
}

export function quyTuoiMay(
  nguon: {
    hbBang: Date | string | null | undefined;
    hbMay: Date | string | null | undefined;
  },
  bayGio: number,
): { capNhatLuc: number | null; doTuoiGiay: number | null } {
  const moc: number[] = [];
  for (const v of [nguon.hbBang, nguon.hbMay]) {
    if (v == null) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) moc.push(t);
  }
  if (moc.length === 0) return { capNhatLuc: null, doTuoiGiay: null };
  const capNhatLuc = Math.max(...moc);
  // `Math.max(0, …)`: đồng hồ lệch vài giây không được thành tuổi ÂM — một nhãn
  // "cập nhật -3 giây trước" làm người đọc nghi ngờ cả màn hình.
  return { capNhatLuc, doTuoiGiay: Math.max(0, Math.round((bayGio - capNhatLuc) / 1000)) };
}

/**
 * Uptime % từ hai khoảng giây. `null` khi cửa sổ 24h KHÔNG có bản ghi nào —
 * "chưa đo" chứ không phải "0% = chết hẳn" (NT-3.5).
 */
export function quyUptime(up: { online: number; offline: number } | undefined): number | null {
  if (!up) return null;
  const tong = up.online + up.offline;
  if (tong <= 0) return null;
  return Math.round((up.online / tong) * 1000) / 10;
}

export async function traTrangThaiHangLoat(
  factoryId: number,
  bayGio: number,
  scope?: PhamViNguoiXem,
): Promise<TrangThaiMayHangLoat[]> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  // Cổng phạm vi nằm TRONG `traCayPhanCapNhaMay` — nhà máy ngoài phạm vi trả cây
  // rỗng, nên danh sách máy cũng rỗng. Không đặt cổng thứ hai ở đây: hai cổng nối
  // tiếp che mất chỗ cổng thật sự được áp (cùng lý lẽ ở `trangThaiTapMay`).
  const cay = await traCayPhanCapNhaMay(factoryId, scope);
  if (cay.may.length === 0) return [];

  const ids = cay.may.map((m) => m.id);
  const { trangThaiTapMay } = await import("./machine");
  const tap = await trangThaiTapMay(ids);

  // `operationStatus` + `lastHeartbeat` + `healthScore` sống ở chính bảng `machines`.
  const hangMay = await d
    .select({
      id: machines.id,
      operationStatus: machines.operationStatus,
      lastHeartbeat: machines.lastHeartbeat,
    })
    .from(machines)
    .where(inArray(machines.id, ids));
  const theoId = new Map(hangMay.map((m) => [m.id, m]));

  return cay.may.map((m) => {
    const bosung = theoId.get(m.id);
    const tt = tap.latestStatusByMachine.get(m.id);
    const hb = tap.latestHeartbeatByMachine.get(m.id);

    /*
     * ★★★ THỜI ĐIỂM DỮ LIỆU = **NHỊP TIM**, KHÔNG phải `max` của mọi nguồn.
     *
     * ⚠ Bản viết đầu của Đợt 6 lấy `max(status_log, heartbeat, lastHeartbeat)`
     * với lý lẽ "máy sống mà trạng thái lâu không đổi thì đừng báo động giả".
     * PHÉP ĐO BÁC BỎ lý lẽ đó:
     *
     *   SIM-L1/L2/L3-CONVEYOR — `operationStatus='running'`
     *     machines.lastHeartbeat  = 2026-07-17  (im lặng 52 ngày)
     *     machine_heartbeats max  = 2026-07-17  (im lặng 52 ngày)
     *     machine_status_logs max = 2026-09-06  (0,4 ngày)  ← `max` chọn ô này
     *
     * Tức là `max` làm ba cái máy đã ngừng gửi nhịp tim 52 ngày **tự khai là mới
     * 0,4 ngày**, chỉ vì có một hàng log trạng thái được ghi gần đây. Đó ĐÚNG là
     * lớp lỗi mà `trungThucDuLieu.tsTrangThaiTuIssues` đã phải vá một lần rồi:
     * *"RAISE một andon lên máy 2 làm ô tươi nhảy 0 → 1"* — một sự kiện KHÔNG
     * PHẢI phép đo trạng thái làm máy im lặng trông như vừa gửi tín hiệu.
     *
     * ⇒ Chỉ nhịp tim mới trả lời được câu "máy này CÒN NÓI CHUYỆN với ta không".
     *   Lấy `max` của hai nguồn nhịp tim (`machines.lastHeartbeat` và bảng
     *   `machine_heartbeats`) — cùng đại lượng, chỉ khác chỗ lưu — và KHÔNG trộn
     *   `machine_status_logs` vào. Kết quả khớp `trungThucDuLieu.ts`: 2/42 máy
     *   CHƯA TỪNG báo cáo (`lastHeartbeat IS NULL`, đo được), 3 máy `running`
     *   rơi vào `khong_ro` vì im lặng 52 ngày.
     */
    /*
     * ★★★ THƯỜNG-4 — việc chọn nguồn đi qua `chonNguonMocTuoi`, là hàm THUẦN
     * CÓ TEST GHIM. Trước đây phép chọn nằm THẲNG ở đây và không test nào với
     * tới, nên QA đổi nó thành `max(status_log, heartbeat)` mà 14/14 vẫn xanh.
     * `tt` (log trạng thái) được TRUYỀN VÀO rồi bị hàm đó VỨT ĐI — có chủ đích:
     * để muốn trộn nó vào thì phải sửa ĐÚNG hàm đang có test soi.
     */
    const nguonMoc = chonNguonMocTuoi({
      hbBang: hb?.ts,
      hbMay: bosung?.lastHeartbeat,
      statusLogTs: tt?.ts,
    });
    const { capNhatLuc, doTuoiGiay } = quyTuoiMay(nguonMoc, bayGio);

    const up = tap.uptimeByMachine.get(m.id);

    return {
      machineId: m.id,
      ma: m.ma,
      ten: m.ten,
      loaiMay: m.loaiMay ?? null,
      isActive: m.isActive ?? false,
      stationId: m.stationId ?? null,
      trangThai: bosung?.operationStatus ?? null,
      /*
       * ★ `diemSucKhoe` = `null` — "CHƯA ĐO", và đó là câu ĐÚNG, không phải chỗ chưa làm.
       *
       * Đo được: `machines` KHÔNG có cột `healthScore` (đã thử và `tsc` bác bỏ);
       * điểm sức khoẻ sống ở `machine_health_history` (`schema/machine.ts:85`),
       * tức là một bảng lịch sử cần thêm MỘT truy vấn nữa. Thêm truy vấn thứ tư
       * ở đây sẽ làm yếu chính thứ procedure này tồn tại để bảo đảm (số query cố
       * định cho vòng render), nên món đó để nguyên là NỢ CÓ KHAI.
       *
       * ⇒ Trả `null` (⇒ UI hiện `—`) chứ TUYỆT ĐỐI không trả `0` hay `100`: một
       *   `0` ở ô sức khoẻ nói "máy này hỏng nặng", một `100` nói "máy hoàn hảo",
       *   và cả hai đều là lời khai bịa về một đại lượng chưa hề đọc (NT-3.5).
       */
      diemSucKhoe: null,
      capNhatLuc,
      doTuoiGiay,
      uptimePhanTram: quyUptime(up),
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 6 (§9.8) — ẢNH LỊCH SỬ CHO TUA LẠI                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ảnh trạng thái toàn nhà máy TẠI một mốc thời gian — nguồn của scrubber (§9.8).
 *
 * ★★★ NGUỒN: `machine_status_logs` (đo được 7.661 dòng, mới nhất 2026-09-06).
 *   KHÔNG dùng `oee_metrics`/`machine_heartbeats` cho lớp phủ này: đo 2026-09-07
 *   thấy hai bảng đó dừng ở **2026-07-17** (~52 ngày trước). Chúng KHÔNG rỗng
 *   như spec cũ ghi — chúng CŨ, và đó là lý do khác nhau dẫn tới cùng một kết
 *   luận hiển thị: mọi máy rơi vào `khong_ro` qua THANG TUỔI, chứ không qua một
 *   danh sách bảng-rỗng viết cứng (danh sách viết cứng sẽ mục đúng như spec cũ
 *   đã mục — hôm nay `ot_telemetry` có 24,4 triệu dòng và vẫn tươi).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI TỪ VỰNG TRẠNG THÁI — ĐO ĐƯỢC, VÀ KHÔNG ĐƯỢC TRỘN
 * ════════════════════════════════════════════════════════════════════════════
 * Đo 2026-09-07, `SELECT status, count(*) FROM machine_status_logs GROUP BY 1`:
 *
 *     online   4.171
 *     offline  3.490
 *
 * ĐÚNG HAI giá trị. Trong khi `machines.operationStatus` là `operationStatusEnum`
 * với TÁM giá trị (`running`/`stopped`/`error`/`maintenance`/`warming_up`/
 * `changeover`/`starved`/`blocked`).
 *
 * ⇒ `machine_status_logs` là **NHẬT KÝ KẾT NỐI**, KHÔNG phải lịch sử trạng thái
 *   vận hành. Nó KHÔNG tái dựng được `running` hay `error`.
 *
 * ⚠ Bản viết đầu của Đợt 6 trả thẳng `status` thô ra client. Hậu quả CÂM đo được:
 *   `mauChoTrangThai` (mauTrangThai.ts:192) rơi về `BANG_MAU.khong_ro` cho mọi
 *   giá trị lạ — nên tua lại vẽ TOÀN BỘ nhà máy thành xám gạch chéo "Không rõ",
 *   không lỗi, không cảnh báo. Một cái máy ĐANG CHẠY lúc 14:32 hiện ra là "không
 *   rõ" — tức là tua lại nói dối về quá khứ, đúng lớp lỗi §9.8 cảnh báo khi hai
 *   đường lệch nhau.
 *
 * ⇒ Ánh xạ TƯỜNG MINH sang từ vựng cảnh, và chỉ nói ĐÚNG cái đo được:
 *     `offline` → `stopped`   (máy mất kết nối: chắc chắn không chạy)
 *     `online`  → `running`   ★ XẤP XỈ CÓ KHAI, xem cảnh báo dưới
 *
 * ⚠⚠ `online → running` là một XẤP XỈ, không phải sự thật: một máy có kết nối
 *   vẫn có thể đang `maintenance`/`starved`/`error`. Nhật ký này KHÔNG mang
 *   thông tin đó và không nguồn nào khác trong DB mang nó theo thời gian. Ta
 *   KHAI xấp xỉ ấy ở đây và ở `nguonXapXi` của giá trị trả về, để UI nói được
 *   *"tua lại chỉ dựng được KẾT NỐI, không dựng được chế độ vận hành"* thay vì
 *   trình bày một quá khứ chi tiết hơn dữ liệu thật (NT-4: số giả định phải tự
 *   khai là giả định).
 *
 * ★ `DISTINCT ON` lấy hàng MỚI NHẤT **không muộn hơn** `mocMs` cho mỗi máy —
 *   đúng nghĩa "trạng thái tại thời điểm T", không phải "hàng gần T nhất" (hàng
 *   gần nhất có thể nằm ở TƯƠNG LAI so với T, và lấy nó là nhìn trộm tương lai).
 *
 * ⚠ SỐ QUERY CỐ ĐỊNH = 4 cây phân cấp + 1 ảnh. Không N+1.
 */
/**
 * Ánh xạ từ vựng NHẬT KÝ KẾT NỐI (`online`/`offline`) sang từ vựng cảnh
 * (`operationStatusEnum`). Xem docblock `traAnhLichSu` cho phép đo và cảnh báo.
 *
 * ★ Giá trị LẠ trả `null` (⇒ `khong_ro`) chứ không đoán: nếu một ngày nhật ký
 *   thêm giá trị thứ ba, ta muốn nó hiện "không rõ" chứ không bị nuốt vào
 *   `running` một cách im lặng.
 */
export function nhatKyRaTrangThaiCanh(status: string | null): string | null {
  if (status === "offline") return "stopped";
  if (status === "online") return "running"; // ★ XẤP XỈ — xem `laXapXi` dưới
  return null;
}

/**
 * Tua lại dựng được KẾT NỐI, KHÔNG dựng được chế độ vận hành. Cờ này đi kèm mọi
 * ảnh lịch sử để UI khai đúng giới hạn đó (NT-4) thay vì trình bày một quá khứ
 * chi tiết hơn dữ liệu thật.
 */
export const LICH_SU_LA_XAP_XI = true;

export async function traAnhLichSu(
  factoryId: number,
  mocMs: number,
  scope?: PhamViNguoiXem,
): Promise<TrangThaiMayHangLoat[]> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const cay = await traCayPhanCapNhaMay(factoryId, scope);
  if (cay.may.length === 0) return [];

  const ids = cay.may.map((m) => m.id);
  const moc = new Date(mocMs);

  const hang = executeRows(
    await d.execute(sql`
      SELECT DISTINCT ON ("machineId")
             "machineId" AS machine_id, status, "timestamp" AS ts
      FROM machine_status_logs
      WHERE "machineId" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND "timestamp" <= ${moc.toISOString()}
      ORDER BY "machineId", "timestamp" DESC
    `),
  ) as Array<{ machine_id: number; status: string | null; ts: Date | null }>;

  const theoId = new Map<number, { status: string | null; ts: Date | null }>();
  for (const r of hang) theoId.set(Number(r.machine_id), { status: r.status, ts: r.ts });

  return cay.may.map((m) => {
    const h = theoId.get(m.id);
    const capNhatLuc = h?.ts ? new Date(h.ts).getTime() : null;
    return {
      machineId: m.id,
      ma: m.ma,
      ten: m.ten,
      loaiMay: m.loaiMay ?? null,
      isActive: m.isActive ?? false,
      stationId: m.stationId ?? null,
      /*
       * ★ `null` khi TẠI MỐC ĐÓ máy chưa từng có bản ghi nào — và đó là câu
       *   đúng: ta không biết nó ở trạng thái gì lúc 08:00 nếu bản ghi đầu tiên
       *   của nó là 09:00. Điền `stopped` vào đây sẽ là bịa ra một quá khứ.
       */
      trangThai: nhatKyRaTrangThaiCanh(h?.status ?? null),
      diemSucKhoe: null,
      capNhatLuc,
      // Tuổi tính TỪ MỐC ĐANG XEM, không từ bây giờ (§9.8).
      doTuoiGiay: capNhatLuc == null ? null : Math.max(0, Math.round((mocMs - capNhatLuc) / 1000)),
      uptimePhanTram: null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ §11 #26 — TRẠNG THÁI AN TOÀN (E-STOP) CỦA ROBOT TRONG MỘT NHÀ MÁY
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Trả robot của một nhà máy kèm HAI nguồn tín hiệu E-STOP, để
 * `tomTatAnToan()` ở client quy về ba trạng thái `nhan|nha|khong_ro`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO ĐƯỜNG RIÊNG, KHÔNG MỞ RỘNG `canhThietKe`/`twin_dat_cho`
 * ════════════════════════════════════════════════════════════════════════
 * Đo được 2026-09-07:
 *   • `twin_dat_cho.loaiThucThe` là enum `workshop|line|station|machine|
 *     workstation` (`drizzle/schema/twin3d.ts`) — **KHÔNG có `robot`**. Thêm
 *     giá trị enum là một migration + đổi hợp đồng của 5 procedure ghi; đó là
 *     việc của Đợt 7, không phải điều kiện để an toàn hiện lên màn hình.
 *   • `duongDanTwin.unit.test.ts:57` ghim `docPhamVi("robot:1") === null` —
 *     robot KHÔNG địa chỉ hoá được trong cảnh.
 *
 * ⇒ Và nó KHÔNG CẦN phải địa chỉ hoá được. §3 NT-2 luật 1 nói rõ: *"Badge alarm
 *   vẽ ở KHÔNG GIAN MÀN HÌNH, không ở không gian thế giới"* — chính là để một
 *   góc camera không bao giờ che được một tín hiệu an toàn. Dải E-STOP của
 *   `/twin` là một banner 2D ở đỉnh trang, nên nó cần biết *robot NÀO đang
 *   nhấn*, KHÔNG cần biết robot ấy đứng ở toạ độ mm nào. Chờ enum mới để hiện
 *   được một banner là buộc an toàn xếp hàng sau hình học.
 *
 * ★ Phạm vi nhà máy đi qua ĐÚNG `traCayPhanCapNhaMay` — cùng bộ phân giải mà mọi
 *   đường dữ liệu khác của Twin dùng (BG-127: độc lập phải ở mô hình, không ở
 *   người đo). Robot neo vào nhà máy qua `lineId`/`stationId`; ta nhận CẢ HAI
 *   đường vì `robots.lineId` và `robots.stationId` đều nullable và dữ liệu thật
 *   dùng `lineId` (3/3 robot dev có `lineId=1`, `stationId=NULL`).
 *
 * ★★★ `isEnabled = false` bị LOẠI, và đó là quyết định có lý do: một robot đã
 *   vô hiệu hoá không có người vận hành nào đang đứng cạnh, nên mạch an toàn của
 *   nó không phải là câu hỏi của ca trực. Ngược lại `status`/`estop` KHÔNG được
 *   lọc — lọc theo trạng thái chính là bỏ mất tập ta đi tìm.
 *
 * ★ `estop` lấy từ hàng telemetry MỚI NHẤT mỗi robot (`DISTINCT ON`). Robot
 *   chưa từng có telemetry ⇒ `estop = null` ⇒ `khong_ro`, KHÔNG phải `nha`
 *   (NT-3: không có dữ liệu ≠ bình thường).
 */
export interface AnToanRobot {
  id: number;
  ma: string;
  ten: string;
  /** `robots.status` — `"estop"` là một GIÁ TRỊ của cột này (fleetRouter.ts:325). */
  status: string | null;
  /** Cờ E-STOP từ telemetry mới nhất. `null` = CHƯA ĐỌC ĐƯỢC. */
  estop: boolean | null;
  /**
   * Mốc telemetry mới nhất — `null` khi robot chưa từng báo cáo.
   *
   * ★ Lấy từ cột `timestamp` (MỐC ĐO của thiết bị), KHÔNG phải `createdAt`
   *   (mốc GHI HÀNG). Hai cột cùng tồn tại trên `robot_telemetry`, và chọn
   *   nhầm cột ghi làm một lô backfill cũ tự khai là vừa đo xong — đúng lớp
   *   lỗi "giả tươi" mà NT-3.4 cấm. `timestamp` cũng là cột ĐƯỢC ĐÁNH CHỈ MỤC
   *   (`idx_robot_telemetry_robot_time`), nên đây còn là lựa chọn đúng về đọc.
   */
  capNhatLuc: number | null;
}

export async function traAnToanRobot(
  factoryId: number,
  scope?: PhamViNguoiXem,
): Promise<AnToanRobot[]> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  // Cổng phạm vi nằm TRONG `traCayPhanCapNhaMay` (nhà máy ngoài phạm vi ⇒ cây
  // rỗng ⇒ không robot nào). Không đặt cổng thứ hai: hai cổng nối tiếp che mất
  // chỗ cổng thật sự được áp — cùng lý lẽ đã ghi ở `traTrangThaiHangLoat`.
  const cay = await traCayPhanCapNhaMay(factoryId, scope);
  const chuyenIds = cay.chuyen.map((c) => c.id);
  const tramIds = cay.tram.map((t) => t.id);
  if (chuyenIds.length === 0 && tramIds.length === 0) return [];

  const dieuKien = [];
  if (chuyenIds.length > 0) dieuKien.push(inArray(robots.lineId, chuyenIds));
  if (tramIds.length > 0) dieuKien.push(inArray(robots.stationId, tramIds));

  const hangRobot = await d
    .select({
      id: robots.id,
      ma: robots.code,
      ten: robots.name,
      status: robots.status,
    })
    .from(robots)
    .where(
      and(
        eq(robots.isEnabled, true),
        dieuKien.length === 1 ? dieuKien[0] : sql`(${dieuKien[0]} OR ${dieuKien[1]})`,
      ),
    );
  if (hangRobot.length === 0) return [];

  const ids = hangRobot.map((r) => r.id);
  const hangTele = executeRows(
    await d.execute(sql`
      SELECT DISTINCT ON ("robotId")
             "robotId" AS robot_id, estop, "timestamp" AS ts
      FROM robot_telemetry
      WHERE "robotId" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      ORDER BY "robotId", "timestamp" DESC
    `),
  ) as Array<{ robot_id: number; estop: boolean | null; ts: Date | null }>;

  const teleTheoId = new Map<number, { estop: boolean | null; ts: Date | null }>();
  for (const r of hangTele) teleTheoId.set(Number(r.robot_id), { estop: r.estop, ts: r.ts });

  return hangRobot.map((r) => {
    const t = teleTheoId.get(r.id);
    return {
      id: r.id,
      ma: r.ma,
      ten: r.ten,
      status: r.status ?? null,
      // `?? null` chứ KHÔNG `?? false`: chưa có telemetry ⇒ CHƯA ĐỌC ĐƯỢC.
      estop: t?.estop ?? null,
      capNhatLuc: t?.ts ? new Date(t.ts).getTime() : null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ĐỢT 8 LÔ C — VÙNG AN TOÀN (§11.1 #5 hiển thị, §11.7 #42 CRUD)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★★★ ĐO ĐƯỢC TRƯỚC KHI VIẾT (Đợt 7 §11c.4, đo lại 2026-09-07 bằng phiên này):
//     `twin_vat_the` = 4 hàng, TOÀN `loai='tuong'`, **0 hàng `'vung'`**.
//     ⇒ #5 và #42 chưa làm ở CẢ TẦNG DỮ LIỆU. Mọi phép đo trên dữ liệu có sẵn
//     trước đợt này là phép đo trên TẬP RỖNG (G5).
//
// ★★★ §11c.3 ghi `VeVungPolygon.tsx` là đích của #42 — tệp đó KHÔNG TỒN TẠI, và
//     `FactoryFloorEditor.tsx:444` vẫn là nơi DUY NHẤT CRUD vùng an toàn trong
//     hệ. Đường mới này là đường THAY THẾ; `FactoryFloorEditor` KHÔNG bị đụng
//     tới cho tới khi cổng ra §11 mở.
//
// ⚠ `factory_zones` (bảng cũ) dùng toạ độ 0–1; ở đây là **mm**, nhất quán với
//   phần còn lại của Twin. KHÔNG di trú dữ liệu — bảng cũ đo được 0 dòng.

/** Một hàng vùng an toàn trả về cho client. `diemDa` đã chuẩn hoá thành cặp số. */
export interface VungAnToanRa {
  id: number;
  tangId: number;
  ten: string;
  diemDa: [number, number][] | null;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  caoMm: number | null;
  mau: string | null;
  daKhoa: boolean;
  hienThi: boolean;
  nguon: "tay" | "sinh";
}

/**
 * `diemDa` (jsonb) → cặp số đã kiểm.
 *
 * ★ jsonb KHÔNG có lược đồ. Một hàng ghi bằng tay hoặc bởi một bản cũ có thể
 *   chứa bất cứ gì; trả thẳng nó ra client là để client tự nổ. Lọc ở ĐÂY, một
 *   lần, thay vì mỗi nơi đọc tự phòng thân.
 */
function docDiemDaJsonb(gt: unknown): [number, number][] | null {
  if (!Array.isArray(gt)) return null;
  const ra: [number, number][] = [];
  for (const c of gt) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const x = Number(c[0]);
    const y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ra.push([x, y]);
  }
  return ra.length > 0 ? ra : null;
}

/** Đọc mọi vùng an toàn của các tầng đã cho, đã lọc phạm vi tenant. */
export async function traVungAnToan(
  tangIds: readonly number[],
  scope: PhamViNguoiXem,
): Promise<VungAnToanRa[]> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (tangIds.length === 0) return [];

  const hopLe = await locTangTrongPhamVi(d, tangIds, scope);
  if (hopLe.length === 0) return [];

  const hang = await d
    .select()
    .from(twinVatThe)
    .where(and(inArray(twinVatThe.tangId, hopLe), eq(twinVatThe.loai, "vung")))
    .orderBy(asc(twinVatThe.thuTu), asc(twinVatThe.id));

  return hang.map((h) => ({
    id: h.id,
    tangId: h.tangId,
    ten: h.ten,
    diemDa: docDiemDaJsonb(h.diemDa),
    // ★ numeric → string qua driver. `Number(...)` TƯỜNG MINH, xem docblock đầu tệp.
    viTriXMm: Number(h.viTriXMm),
    viTriYMm: Number(h.viTriYMm),
    viTriZMm: Number(h.viTriZMm),
    caoMm: h.caoMm == null ? null : Number(h.caoMm),
    mau: h.mau,
    daKhoa: h.daKhoa,
    hienThi: h.hienThi,
    nguon: h.nguon,
  }));
}

/**
 * Lọc danh sách tầng xuống những tầng NGƯỜI GỌI được thấy.
 *
 * ★ Tra ngược `twin_tang → twin_toa_nha → factoryId` rồi mới kiểm phạm vi —
 *   KHÔNG tin `tangId` trong input. Đây là cùng khuôn mà `ghiDeTuongBaoSinh`
 *   dùng; bài học `pham-vi-tenant-dot-lon`: lọc theo cột client tự khai là
 *   không có hàng rào.
 */
async function locTangTrongPhamVi(
  d: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tangIds: readonly number[],
  scope: PhamViNguoiXem,
): Promise<number[]> {
  const tang = await d
    .select({ id: twinTang.id, toaNhaId: twinTang.toaNhaId })
    .from(twinTang)
    .where(inArray(twinTang.id, [...tangIds]));
  const ra: number[] = [];
  for (const t of tang) {
    const factoryId = await nhaMayCuaToaNha(d, t.toaNhaId);
    if (factoryId !== null && (await trongPhamVi("factory", factoryId, scope))) ra.push(t.id);
  }
  return ra;
}

/** Payload ghi một vùng an toàn. */
export interface VungAnToanGhi {
  id?: number;
  tangId: number;
  ten: string;
  diemDa: [number, number][];
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  caoMm: number;
  mau: string;
}

/**
 * Tạo hoặc sửa MỘT vùng an toàn. Trả `null` khi ngoài phạm vi (không phân biệt
 * "không tồn tại" với "của tenant khác" — oracle rò rỉ tồn-tại).
 *
 * ★★★ NT-4 — ghi `nguon: 'tay'`. Vùng an toàn LUÔN do người vẽ; không có đường
 *   sinh tự động nào tạo ra chúng. Ghi `'sinh'` ở đây sẽ khiến `ghiDeTuongBaoSinh`
 *   và mọi đường "xoá rồi sinh lại" tương lai **cuốn mất công vẽ tay** — đúng
 *   lớp lỗi G5b đã bắt được ở `seed-twin-mau.ts`.
 */
export async function luuVungAnToan(
  input: VungAnToanGhi,
  scope: PhamViNguoiXem,
): Promise<{ id: number } | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const hopLe = await locTangTrongPhamVi(d, [input.tangId], scope);
  if (hopLe.length === 0) return null;

  const gt = {
    tangId: input.tangId,
    loai: "vung" as const,
    ten: input.ten,
    diemDa: input.diemDa,
    viTriXMm: soRaChuoi(input.viTriXMm),
    viTriYMm: soRaChuoi(input.viTriYMm),
    viTriZMm: soRaChuoi(input.viTriZMm),
    caoMm: soRaChuoi(input.caoMm),
    mau: input.mau,
    nguon: "tay" as const,
    updatedAt: new Date(),
  };

  if (input.id != null) {
    // ★ Ràng `loai='vung'` vào mệnh đề WHERE: không có nó thì một `id` trỏ vào
    //   hàng TƯỜNG sẽ bị ghi đè thành vùng, và bốn bức tường bao của tầng biến
    //   mất mà không có lỗi nào. `id` đến từ client nên phải coi là tự khai.
    const cu = await d
      .select({ id: twinVatThe.id, tangId: twinVatThe.tangId })
      .from(twinVatThe)
      .where(and(eq(twinVatThe.id, input.id), eq(twinVatThe.loai, "vung")))
      .limit(1);
    if (cu.length === 0) return null;
    // Hàng có thật, nhưng có thể thuộc TẦNG KHÁC ngoài phạm vi.
    const okCu = await locTangTrongPhamVi(d, [cu[0].tangId], scope);
    if (okCu.length === 0) return null;

    await d.update(twinVatThe).set(gt).where(eq(twinVatThe.id, input.id));
    return { id: input.id };
  }

  const [moi] = await d.insert(twinVatThe).values(gt).returning({ id: twinVatThe.id });
  return { id: moi.id };
}

/**
 * Xoá MỘT vùng an toàn.
 *
 * ★★★ Ràng `loai='vung'` — đây là hàng rào chống xoá nhầm TƯỜNG. Một `DELETE`
 *   chỉ theo `id` sẽ xoá được bất kỳ vật thể cảnh nào, kể cả bốn bức tường bao
 *   mà `sinhTuongBao` dựng, và người dùng chỉ phát hiện khi vỏ nhà biến mất.
 *
 * Trả `false` khi không xoá được (không tồn tại, sai loại, hoặc ngoài phạm vi)
 * — một câu trả lời, không phải một ngoại lệ.
 */
export async function xoaVungAnToan(id: number, scope: PhamViNguoiXem): Promise<boolean> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const cu = await d
    .select({ id: twinVatThe.id, tangId: twinVatThe.tangId })
    .from(twinVatThe)
    .where(and(eq(twinVatThe.id, id), eq(twinVatThe.loai, "vung")))
    .limit(1);
  if (cu.length === 0) return false;

  const ok = await locTangTrongPhamVi(d, [cu[0].tangId], scope);
  if (ok.length === 0) return false;

  await d.delete(twinVatThe).where(and(eq(twinVatThe.id, id), eq(twinVatThe.loai, "vung")));
  return true;
}

// ---------------------------------------------------------------------------
// Gán model 3D — hàng rào tenant (§7.4, §10B.2) — #18
// ---------------------------------------------------------------------------

/** Phạm vi gán của một model: đúng một máy, hay cả một chủng loại. */
export type PhamViGanModel =
  | { phamVi: "may"; machineId: number }
  | { phamVi: "chung_loai"; loaiMay: string };

/**
 * Người gọi có được phép gán model ở phạm vi này không.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT ĐĂNG BẠ KHÔNG-TENANT VẪN CẦN HÀNG RÀO TENANT
 * ════════════════════════════════════════════════════════════════════════════
 * `equipment_3d_models` không treo vào chuỗi phân cấp, nên thoạt nhìn nó giống
 * `twin_kich_thuoc_loai` — một bảng tra chung, miễn hàng rào. Nhưng thứ được
 * ghi vào đó là **một liên kết tới `machines.id`**, và hệ quả của liên kết đó
 * hiện ra trong cảnh 3D của tenant sở hữu máy ấy.
 *
 * ⇒ Không kiểm thì bất kỳ ai qua được cổng `settings_factory`/`machine_control`
 *   của **nhà máy mình** cũng đổi được hình khối một máy của **nhà máy khác**.
 *   Không rò dữ liệu (không đọc gì của họ), nhưng ghi được vào cảnh của họ —
 *   và một thay đổi thị giác câm là thứ khó truy nhất.
 *
 * ★ Dùng ĐÚNG `trongPhamVi("machine", …)` — bộ phân giải mà mọi đường khác đi
 *   qua. Tự lọc theo `machines.factoryId` ở đây là dựng bộ luật phân quyền thứ
 *   hai, thứ `hierarchy.ts` cấm (và là gốc của lớp lỗi BG-127).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CẤP CHỦNG LOẠI — ĐÒI SỞ HỮU ÍT NHẤT MỘT MÁY CỦA LOẠI ĐÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Một hàng cấp chủng loại KHÔNG trỏ tới máy nào, nên không có id để kiểm. Câu
 * hỏi đúng là "người này có máy loại đó không": có thì việc gán ảnh hưởng máy
 * của chính họ (và của người khác cùng loại — xem cảnh báo dưới); không có thì
 * họ đang đổi hình cho một chủng loại mà họ không vận hành máy nào.
 *
 * ⚠ NÓI THẲNG GIỚI HẠN: đăng bạ **không có cột phạm vi cho hàng cấp loại**, nên
 *   một hàng `AOI` là TOÀN CỤC — nó đổi hình máy AOI của MỌI tenant. Hàng rào
 *   này thu hẹp *ai được ghi*, KHÔNG thu hẹp *ai bị ảnh hưởng*. Sửa triệt để
 *   cần thêm cột phạm vi vào `equipment_3d_models`, tức MIGRATION — ngoài phạm
 *   vi lô này (brief cấm). Ghi lại ở đây thay vì để lời khai "đã có hàng rào"
 *   che mất chuyện nửa còn lại chưa được rào.
 */
export async function duocGanModel(
  pv: PhamViGanModel,
  scope: PhamViNguoiXem,
): Promise<boolean> {
  if (pv.phamVi === "may") {
    return trongPhamVi("machine", pv.machineId, scope);
  }

  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  // Mọi máy thuộc chủng loại này (không lọc phạm vi ở SQL — để `trongPhamVi`
  // quyết, một bộ luật duy nhất).
  const cungLoai = await d
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.machineType, pv.loaiMay as typeof machines.machineType.enumValues[number]));
  if (cungLoai.length === 0) return false;

  for (const m of cungLoai) {
    if (await trongPhamVi("machine", m.id, scope)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bản ghi bố cục — `twin_ban_ghi` (§5.3, §11 #55)
// ---------------------------------------------------------------------------

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HỢP ĐỒNG PHIÊN BẢN — ĐỌC LƯỢC ĐỒ THẬT RỒI MỚI VIẾT
 * ════════════════════════════════════════════════════════════════════════════
 * §11c.2 xếp #55 vào lớp lỗi **L-3**: bảng có, migration có (`drizzle/0351…:158`),
 * **0 dòng và 0 mã đọc/ghi**. *"Bảng tồn tại không phải là tính năng tồn tại."*
 *
 * Lược đồ đo lại trên DB dev 2026-09-07 (`\d twin_ban_ghi`), KHÔNG đọc từ spec:
 *
 *   id serial PK · "tangId" int NOT NULL → twin_tang ON DELETE CASCADE
 *   nhan varchar(255) NOT NULL · "anhChup" jsonb NOT NULL
 *   "daXuatBan" bool NOT NULL DEFAULT false · "nguoiTao" int → users(id)
 *   "createdAt" timestamptz NOT NULL DEFAULT now()
 *   idx: ("tangId") · ("tangId","daXuatBan")
 *
 * ⇒ **HỢP ĐỒNG NÀY DÙNG ĐƯỢC, KHÔNG CẦN MIGRATION.** `anhChup` là jsonb tự
 *   chứa, đúng thứ §5.3 đòi: một bản đã xuất bản không đổi hình khi ai đó sửa
 *   bảng sống. Lô này vì thế KHÔNG đổi lược đồ (brief cấm, và cũng không cần).
 *
 * ★★★ HAI THIẾU SÓT CỦA LƯỢC ĐỒ — BÁO LẠI, KHÔNG TỰ VÁ BẰNG MIGRATION:
 *
 *   (a) KHÔNG có `UNIQUE ("tangId", nhan)`. Hai bản ghi trùng tên trên cùng một
 *       tầng là hợp lệ với DB, và người dùng không phân biệt được chúng trong
 *       danh sách. Ta cưỡng chế ở tầng ghi (`luuBanGhi` tìm-trước-khi-tạo), và
 *       nói thẳng rằng đó là hàng rào MỀM: hai lượt ghi đồng thời vẫn lọt được.
 *       Vá cứng cần một unique index ⇒ migration ⇒ đợt sau.
 *
 *   (b) KHÔNG có ràng buộc "mỗi tầng nhiều nhất MỘT bản đã xuất bản". §5.3 nói
 *       *"Màn Vận hành chỉ đọc bản đã xuất bản"* — số ít. Với DB hiện tại, N bản
 *       cùng `daXuatBan = true` là hợp lệ, và màn Vận hành sẽ phải chọn bừa một
 *       cái. `xuatBanBanGhi` vì thế HẠ CỜ mọi bản khác trong CÙNG MỘT lượt ghi;
 *       nhưng một partial unique index mới là thứ làm điều đó không lách được.
 */

/** Một bản ghi bố cục, đã lọc phạm vi. `anhChup` KHÔNG trả trong danh sách. */
export interface BanGhiTomTat {
  id: number;
  tangId: number;
  nhan: string;
  daXuatBan: boolean;
  nguoiTao: number | null;
  createdAt: Date;
  /** Số thực thể trong ảnh chụp — để danh sách nói được "bản này có gì". */
  soDatCho: number;
}

/**
 * Hình dạng của `anhChup`.
 *
 * ★★★ ẢNH CHỤP PHẢI TỰ CHỨA — KHÔNG JOIN LẠI BẢNG SỐNG.
 *   Đây là toàn bộ lý do bảng này tồn tại (§5.3). Một "ảnh chụp" chỉ lưu danh
 *   sách id rồi đọc lại `twin_dat_cho` lúc khôi phục KHÔNG phải ảnh chụp: nó
 *   đổi hình mỗi khi ai đó kéo một máy, và "khôi phục bản v3" sẽ cho ra bố cục
 *   hôm nay chứ không phải bố cục hôm ghi v3.
 */
export interface AnhChupBoCuc {
  /** Phiên bản HÌNH DẠNG của chính ảnh chụp — không phải phiên bản bố cục. */
  phienBan: 1;
  ghiLuc: string;
  datCho: Array<{
    loaiThucThe: string;
    thucTheId: number;
    viTriXMm: number;
    viTriYMm: number;
    viTriZMm: number;
    quatX: number;
    quatY: number;
    quatZ: number;
    quatW: number;
    rongMm?: number | null;
    caoMm?: number | null;
    sauMm?: number | null;
    daKhoa?: boolean;
    hienThi?: boolean;
  }>;
}

/**
 * ★ Vì sao có `phienBan` trong chính jsonb dù cột đã tên là "bản ghi":
 *   `daXuatBan`/`nhan` là phiên bản của BỐ CỤC (thứ người dùng đặt tên).
 *   `phienBan` là phiên bản của LƯỢC ĐỒ JSON — thứ mã đọc phải biết để không
 *   đọc nhầm một ảnh chụp cũ bằng luật mới. Trộn hai khái niệm đó vào một số là
 *   cách chắc chắn để một ngày nào đó "v3" nghĩa là hai thứ khác nhau.
 */
export function laAnhChupHopLe(gt: unknown): gt is AnhChupBoCuc {
  if (typeof gt !== "object" || gt === null) return false;
  const o = gt as Record<string, unknown>;
  if (o.phienBan !== 1) return false;
  return Array.isArray(o.datCho);
}

/** Danh sách bản ghi của các tầng đã cho — KHÔNG kèm `anhChup` (có thể rất to). */
export async function traBanGhi(
  tangIds: readonly number[],
  scope: PhamViNguoiXem,
): Promise<BanGhiTomTat[]> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (tangIds.length === 0) return [];

  const hopLe = await locTangTrongPhamVi(d, tangIds, scope);
  if (hopLe.length === 0) return [];

  const hang = await d
    .select()
    .from(twinBanGhi)
    .where(inArray(twinBanGhi.tangId, hopLe))
    .orderBy(desc(twinBanGhi.createdAt), desc(twinBanGhi.id));

  return hang.map((h) => ({
    id: h.id,
    tangId: h.tangId,
    nhan: h.nhan,
    daXuatBan: h.daXuatBan,
    nguoiTao: h.nguoiTao,
    createdAt: h.createdAt,
    // ★ Đếm ở đây, KHÔNG gửi cả `anhChup` xuống rồi để client đếm: một bản ghi
    //   42 máy là ~15 KB, và danh sách 20 bản là 300 KB cho một con số.
    soDatCho: laAnhChupHopLe(h.anhChup) ? h.anhChup.datCho.length : 0,
  }));
}

/** Một bản ghi ĐẦY ĐỦ (kèm `anhChup`) — chỉ đọc khi thật sự khôi phục. */
export async function traMotBanGhi(
  id: number,
  scope: PhamViNguoiXem,
): Promise<{ id: number; tangId: number; nhan: string; daXuatBan: boolean; anhChup: AnhChupBoCuc } | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [h] = await d.select().from(twinBanGhi).where(eq(twinBanGhi.id, id)).limit(1);
  if (!h) return null;
  const hopLe = await locTangTrongPhamVi(d, [h.tangId], scope);
  if (hopLe.length === 0) return null;
  // jsonb KHÔNG có lược đồ — lọc ở ĐÂY, một lần (cùng lý lẽ `docDiemDaJsonb`).
  if (!laAnhChupHopLe(h.anhChup)) return null;

  return {
    id: h.id,
    tangId: h.tangId,
    nhan: h.nhan,
    daXuatBan: h.daXuatBan,
    anhChup: h.anhChup,
  };
}

export interface LuuBanGhiInput {
  tangId: number;
  nhan: string;
  anhChup: AnhChupBoCuc;
  nguoiTao?: number | null;
}

/**
 * Tạo một bản ghi mới, hoặc GHI ĐÈ bản cùng tên trên cùng tầng.
 *
 * ★★★ TÌM-TRƯỚC-KHI-TẠO, vì lược đồ KHÔNG có `UNIQUE ("tangId", nhan)`.
 *   Không có bước này thì bấm "Lưu bản ghi" hai lần với cùng cái tên tạo ra hai
 *   hàng trùng tên, và danh sách hiện hai dòng y hệt nhau — người dùng không có
 *   cách nào biết cái nào là cái họ vừa lưu.
 *
 * ⚠ HÀNG RÀO MỀM: hai lượt ghi ĐỒNG THỜI vẫn lọt được cả hai (không có unique
 *   index để DB từ chối). Đây là giới hạn của lược đồ hiện tại, được báo lại
 *   thay vì tự thêm migration (brief cấm). Xác suất thấp — một người dùng, một
 *   nút — nhưng nó có thật và không nên nằm im.
 */
export async function luuBanGhi(input: LuuBanGhiInput, scope: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const hopLe = await locTangTrongPhamVi(d, [input.tangId], scope);
  if (hopLe.length === 0) return null;

  const [cu] = await d
    .select({ id: twinBanGhi.id })
    .from(twinBanGhi)
    .where(and(eq(twinBanGhi.tangId, input.tangId), eq(twinBanGhi.nhan, input.nhan)))
    .limit(1);

  if (cu) {
    const [ket] = await d
      .update(twinBanGhi)
      .set({ anhChup: input.anhChup as unknown as Record<string, unknown> })
      .where(eq(twinBanGhi.id, cu.id))
      .returning();
    return ket ?? null;
  }

  const [ket] = await d
    .insert(twinBanGhi)
    .values({
      tangId: input.tangId,
      nhan: input.nhan,
      anhChup: input.anhChup as unknown as Record<string, unknown>,
      nguoiTao: input.nguoiTao ?? null,
      // ★ `daXuatBan` CỐ Ý để mặc định false. Lưu một bản nháp không được đẩy
      //   nó ra màn Vận hành đang chạy — đó là cả lý do cột này tồn tại.
    })
    .returning();
  return ket ?? null;
}

/**
 * Xuất bản MỘT bản ghi, và HẠ CỜ mọi bản khác của cùng tầng.
 *
 * ★★★ HAI LƯỢT GHI, MỘT TRANSACTION. Hạ cờ trước rồi nâng cờ sau mà không bọc
 *   transaction để lại một cửa sổ trong đó tầng KHÔNG có bản nào xuất bản —
 *   và màn Vận hành đọc đúng lúc đó sẽ thấy nhà máy rỗng. Cửa sổ ấy dài vài
 *   mili giây, tức nó sẽ xảy ra, và nó sẽ không tái lập được khi đi tìm.
 *
 * ⚠ Vì sao ở ĐÂY bọc transaction được trong khi `dungNhaXuong` (N-1) thì không:
 *   phép kiểm phạm vi đã chạy XONG trước khi mở transaction, và trong transaction
 *   chỉ còn hai câu UPDATE trên MỘT bảng. Không có `trongPhamVi` nào phải chạy
 *   bên trong `tx`, nên không có bộ luật phân quyền thứ hai nào bị sinh ra.
 */
export async function xuatBanBanGhi(id: number, scope: PhamViNguoiXem) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [h] = await d
    .select({ id: twinBanGhi.id, tangId: twinBanGhi.tangId })
    .from(twinBanGhi)
    .where(eq(twinBanGhi.id, id))
    .limit(1);
  if (!h) return null;
  const hopLe = await locTangTrongPhamVi(d, [h.tangId], scope);
  if (hopLe.length === 0) return null;

  return d.transaction(async (tx) => {
    await tx
      .update(twinBanGhi)
      .set({ daXuatBan: false })
      .where(and(eq(twinBanGhi.tangId, h.tangId), eq(twinBanGhi.daXuatBan, true)));
    const [ket] = await tx
      .update(twinBanGhi)
      .set({ daXuatBan: true })
      .where(eq(twinBanGhi.id, id))
      .returning();
    return ket ?? null;
  });
}

/**
 * Xoá một bản ghi.
 *
 * ★ KHÔNG chặn xoá bản đang xuất bản, nhưng NÓI RA qua giá trị trả về: người
 *   gọi biết mình vừa gỡ thứ màn Vận hành đang đọc và cảnh báo được. Chặn hẳn
 *   sẽ khoá người dùng lại với một bản họ muốn bỏ, và họ không có đường ra.
 */
export async function xoaBanGhi(
  id: number,
  scope: PhamViNguoiXem,
): Promise<{ daXoa: boolean; daTungXuatBan: boolean } | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const [h] = await d
    .select({ id: twinBanGhi.id, tangId: twinBanGhi.tangId, daXuatBan: twinBanGhi.daXuatBan })
    .from(twinBanGhi)
    .where(eq(twinBanGhi.id, id))
    .limit(1);
  if (!h) return null;
  const hopLe = await locTangTrongPhamVi(d, [h.tangId], scope);
  if (hopLe.length === 0) return null;

  await d.delete(twinBanGhi).where(eq(twinBanGhi.id, id));
  return { daXoa: true, daTungXuatBan: h.daXuatBan };
}
