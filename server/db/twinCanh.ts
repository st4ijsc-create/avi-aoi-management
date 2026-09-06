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
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { twinToaNha, twinTang, twinVatThe } from "../../drizzle/schema";
import { trongPhamVi, type PhamViNguoiXem } from "./hierarchy";

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

    const [ket] = await d
      .update(twinToaNha)
      .set({ ...giaTri, updatedAt: new Date() })
      .where(eq(twinToaNha.id, input.id))
      .returning();
    return ket ?? null;
  }

  const [ket] = await d.insert(twinToaNha).values(giaTri).returning();
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

    const [ket] = await d
      .update(twinTang)
      .set({ ...giaTri, updatedAt: new Date() })
      .where(eq(twinTang.id, input.id))
      .returning();
    return ket ?? null;
  }

  const [ket] = await d.insert(twinTang).values(giaTri).returning();
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

/** Đếm vật thể theo loại của một tầng — dùng cho đối soát và cho UI. */
export async function demVatTheTheoTang(tangIds: readonly number[]) {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  if (tangIds.length === 0) return [];
  return d
    .select({ id: twinVatThe.id, tangId: twinVatThe.tangId, loai: twinVatThe.loai, nguon: twinVatThe.nguon })
    .from(twinVatThe)
    .where(inArray(twinVatThe.tangId, [...tangIds]));
}
