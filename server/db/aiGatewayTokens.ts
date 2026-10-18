/**
 * ★★★ Đợt 4A (2026-10-17) — tầng dữ liệu của `ai_gateway_tokens` + `ai_gateway_device_codes` (mig 0392): token THEO
 * NGƯỜI DÙNG cho cổng `/v1` và device flow của extension VSCode.
 *
 * ⚠⚠ BẢN RÕ KHÔNG BAO GIỜ XUỐNG CSDL: chỉ `bamToken()` (sha256). Bản rõ rời hàm `taoTokenNguoiDung`/`doiMaThietBi`
 *   đúng MỘT lần trong giá trị trả về; không ghi nhật ký, không đặt vào lỗi.
 * ⚠⚠ MỌI phép so thời gian làm bằng `now()` TRONG SQL (cột `timestamptz`) — không so `Date` JS với cột, để không
 *   dính lớp lỗi "timestamp naive lệch −7 h" của postgres.js.
 * ⚠ PHẠM VI CHỦ: đọc/thu hồi theo id luôn có `userId` trong WHERE — id đoán trúng của người khác cho CÙNG kết quả với
 *   "không tồn tại". Ngoại lệ có chủ đích: `xacThucTokenNguoiDung` (tra theo BĂM — chính token là bằng chứng) và device
 *   flow (tra theo mã; người duyệt là người gắn vào token).
 * ⚠ Hỏng CSDL ⇒ trả mã `csdl` (người gọi FAIL-CLOSED: cổng `/v1` trả 503), KHÔNG ném ra ngoài.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import {
  bamToken,
  chuanHoaMaNguoiDung,
  chuanHoaPhamVi,
  chuanHoaPhamViThietBi,
  chuanHoaSoNgay,
  SO_NGAY_THIET_BI,
  laMaThietBi,
  laTokenNguoiDung,
  sinhMaNguoiDung,
  sinhMaThietBi,
  sinhToken,
  TRAN_TOKEN_HIEU_LUC,
  type PhamVi,
} from "../services/ai/gatewayToken/maToken";
import { suyRaPhaiDoiMatKhau } from "../_core/publicUser";
import { biChanBoiCongDoiMatKhau } from "../../shared/buocDoiMatKhau";

/** Mã thiết bị sống 10 phút (RFC 8628 khuyến nghị ≤ 15 phút). */
export const HET_HAN_THIET_BI_GIAY = 600;
/** Chu kỳ hỏi tối thiểu extension phải giữ; hỏi nhanh hơn ⇒ `cham-lai`. */
export const CHU_KY_HOI_GIAY = 5;
/** Lượt hỏi tối đa của một mã (10 phút / 5 s = 120, chừa biên) — vượt ⇒ coi như hết hạn. */
export const TRAN_LUOT_HOI = 200;
/**
 * ★ Rà bảo mật de591c868 #3 — số mã đang CHỜ (chưa duyệt, còn hạn) tối đa mỗi IP khởi tạo. Một kỹ sư thật có 1–2 cửa
 * sổ VSCode đang đăng nhập cùng lúc; một kẻ rải mã đi lừa thì cần hàng loạt. Trần theo PHÚT (10/phút ở tuyến REST)
 * không chặn được việc rải đều 10 phút ⇒ 100 mã sống cùng lúc; trần này chặn.
 */
export const TRAN_MA_CHO_MOI_IP = 5;

/** IP khởi tạo: cắt 64 (cột varchar(64)); rỗng ⇒ NULL. */
function chuanHoaIp(vao: unknown): string | null {
  const s = typeof vao === "string" ? vao.trim().slice(0, 64) : "";
  return s || null;
}

/** User-Agent khởi tạo (kẻ gọi tự khai — CHỈ để hiển thị/truy vết): bỏ ký tự điều khiển, cắt 200; rỗng ⇒ NULL. */
export function chuanHoaTacNhan(vao: unknown): string | null {
  const s = typeof vao === "string" ? vao.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, 200) : null;
}

type Hang = Record<string, unknown>;
type CoExecute = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

async function chay<T extends Hang>(db: CoExecute, q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as { rows?: unknown[] } | unknown[];
  return ((Array.isArray(r) ? r : (r.rows ?? [])) as T[]);
}

const isoCua = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/** Tên do người/extension đặt: bỏ ký tự điều khiển, cắt 100, rỗng ⇒ mặc định. */
export function chuanHoaTen(vao: unknown, macDinh = "VSCode"): string {
  const s = typeof vao === "string" ? vao.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (s || macDinh).slice(0, 100);
}

function canhBao(cho: string, err: unknown): void {
  // ⚠ Không in đối số — có thể chứa bản rõ.
  console.warn(`[aiGatewayTokens] ${cho} hỏng:`, (err as Error)?.message ?? err);
}

// ─── Token ──────────────────────────────────────────────────────────────────────────────────────

export type KetQuaTaoToken =
  | { ok: true; id: number; token: string; tienTo: string; ten: string; phamVi: PhamVi[]; hetHanLuc: string | null }
  | { ok: false; ma: "qua-tran" | "csdl" };

/** Chèn một token trong giao dịch `tx` đã có (khoá tư vấn theo người giữ trần đúng khi hai lượt tạo chạy song song). */
async function chenToken(
  tx: CoExecute,
  vao: { userId: number; ten: string; phamVi: PhamVi[]; soNgay: number; nguon: "web" | "thiet-bi" },
): Promise<KetQuaTaoToken> {
  await chay(tx, sql`SELECT pg_advisory_xact_lock(hashtext(${`ai_gw_token:${vao.userId}`}))`);
  const [dem] = await chay<{ n: number }>(
    tx,
    sql`SELECT count(*)::int AS n FROM ai_gateway_tokens
        WHERE "userId" = ${vao.userId} AND "thuHoiLuc" IS NULL AND "hetHanLuc" > now()`,
  );
  if (Number(dem?.n ?? 0) >= TRAN_TOKEN_HIEU_LUC) return { ok: false, ma: "qua-tran" };
  const moi = sinhToken();
  const [h] = await chay<{ id: number; het_han: unknown }>(
    tx,
    sql`INSERT INTO ai_gateway_tokens ("userId", "tokenHash", "tienTo", ten, "phamVi", nguon, "hetHanLuc")
        VALUES (${vao.userId}, ${moi.bam}, ${moi.tienTo}, ${vao.ten}, ${sql.raw(mangVanBan(vao.phamVi))}, ${vao.nguon},
                now() + make_interval(days => ${vao.soNgay}))
        RETURNING id, "hetHanLuc" AS het_han`,
  );
  return { ok: true, id: Number(h.id), token: moi.token, tienTo: moi.tienTo, ten: vao.ten, phamVi: vao.phamVi, hetHanLuc: isoCua(h.het_han) };
}

/**
 * Bất biến nội bộ: phạm vi tới `mangVanBan` LUÔN đã qua `chuanHoaPhamVi` — vi phạm là lỗi lập trình, không phải
 * lỗi người dùng (không bao giờ tới tRPC dưới dạng câu chữ). Lớp có `code` để máy đọc (rawErrorCensus F3).
 */
export class LoiPhamViTokenNoiBo extends Error {
  readonly code = "PHAM_VI_TOKEN_KHONG_HOP_LE" as const;
  constructor(message: string) {
    super(message);
    this.name = "LoiPhamViTokenNoiBo";
  }
}

/** `ARRAY['chat','fim']::text[]` — phần tử đã qua `chuanHoaPhamVi` (tập đóng 3 chữ thường) nên nội suy thô an toàn. */
function mangVanBan(pv: PhamVi[]): string {
  for (const p of pv) if (!/^[a-z]+$/.test(p)) throw new LoiPhamViTokenNoiBo("phạm vi không hợp lệ");
  return `ARRAY[${pv.map((p) => `'${p}'`).join(",")}]::text[]`;
}

export async function taoTokenNguoiDung(vao: {
  userId: number;
  ten: unknown;
  phamVi?: unknown;
  soNgay?: unknown;
  nguon?: "web" | "thiet-bi";
}): Promise<KetQuaTaoToken> {
  if (!Number.isInteger(vao.userId) || vao.userId <= 0) return { ok: false, ma: "csdl" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "csdl" };
  try {
    return await db.transaction((tx) =>
      chenToken(tx as unknown as CoExecute, {
        userId: vao.userId,
        ten: chuanHoaTen(vao.ten),
        phamVi: chuanHoaPhamVi(vao.phamVi),
        soNgay: chuanHoaSoNgay(vao.soNgay),
        nguon: vao.nguon ?? "web",
      }),
    );
  } catch (err) {
    canhBao("taoTokenNguoiDung", err);
    return { ok: false, ma: "csdl" };
  }
}

export type MaTuChoiToken = "khong-hop-le" | "het-han" | "thu-hoi" | "tai-khoan-tat" | "phai-doi-mat-khau" | "csdl";

const ngayCua = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

/**
 * ★★★ Rà bảo mật de591c868 #2 — tài khoản bị chặn ở thời điểm DÙNG token (kiểm lại mỗi lượt, không tin lúc cấp):
 *   • `isActive = false` (tắt bằng bất kỳ đường nào, kể cả SQL thẳng không qua fan-out);
 *   • đang bị BUỘC đổi mật khẩu — mốc `passwordInvalidBefore` nghĩa là bí mật của tài khoản bị coi là LỘ. Hỏi ĐÚNG
 *     chủ duy nhất của vị từ (`suyRaPhaiDoiMatKhau`) + cùng miễn trừ vai như cổng tRPC (`biChanBoiCongDoiMatKhau`), để
 *     token không mở được thứ mà phiên web của chính người ấy đang bị chặn.
 */
function lyDoChanTaiKhoan(h: {
  is_active: boolean | null;
  role: string | null;
  pwd_changed: unknown;
  pwd_invalid: unknown;
}): "tai-khoan-tat" | "phai-doi-mat-khau" | null {
  if (h.is_active === false) return "tai-khoan-tat";
  const phaiDoi = suyRaPhaiDoiMatKhau({ passwordChangedAt: ngayCua(h.pwd_changed), passwordInvalidBefore: ngayCua(h.pwd_invalid) });
  if (biChanBoiCongDoiMatKhau(String(h.role ?? ""), phaiDoi)) return "phai-doi-mat-khau";
  return null;
}
export type KetQuaXacThucToken =
  | { ok: true; tokenId: number; userId: number; role: string; name: string | null; phamVi: PhamVi[]; ten: string }
  | { ok: false; ma: MaTuChoiToken };

/**
 * Phân giải `Authorization: Bearer avgw_…` ⇒ người dùng. Thứ tự phán quyết: không tồn tại ⇒ thu hồi ⇒ hết hạn ⇒ tài
 * khoản tắt (thu hồi đứng trước hết hạn: đó là câu ĐÚNG hơn cho người đã tự tay thu hồi).
 */
export async function xacThucTokenNguoiDung(token: unknown): Promise<KetQuaXacThucToken> {
  if (!laTokenNguoiDung(token)) return { ok: false, ma: "khong-hop-le" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "csdl" };
  try {
    const [h] = await chay<{
      id: number;
      user_id: number;
      pham_vi: string[];
      ten: string;
      thu_hoi: boolean;
      het_han: boolean;
      role: string;
      name: string | null;
      is_active: boolean | null;
      pwd_changed: unknown;
      pwd_invalid: unknown;
    }>(
      db,
      sql`SELECT t.id, t."userId" AS user_id, t."phamVi" AS pham_vi, t.ten,
                 (t."thuHoiLuc" IS NOT NULL) AS thu_hoi, (t."hetHanLuc" <= now()) AS het_han,
                 u.role, u.name, u."isActive" AS is_active,
                 u."passwordChangedAt" AS pwd_changed, u."passwordInvalidBefore" AS pwd_invalid
            FROM ai_gateway_tokens t JOIN users u ON u.id = t."userId"
           WHERE t."tokenHash" = ${bamToken(token)}`,
    );
    if (!h) return { ok: false, ma: "khong-hop-le" };
    if (h.thu_hoi) return { ok: false, ma: "thu-hoi" };
    if (h.het_han) return { ok: false, ma: "het-han" };
    const chan = lyDoChanTaiKhoan(h);
    if (chan) return { ok: false, ma: chan };
    return {
      ok: true,
      tokenId: Number(h.id),
      userId: Number(h.user_id),
      role: String(h.role),
      name: h.name ?? null,
      phamVi: chuanHoaPhamVi(h.pham_vi),
      ten: h.ten,
    };
  } catch (err) {
    canhBao("xacThucTokenNguoiDung", err);
    return { ok: false, ma: "csdl" };
  }
}

/** Ghi "lần dùng cuối" — tối đa một lần mỗi 60 s mỗi token (FIM bắn hàng chục yêu cầu/phút). Không chờ, không ném. */
export function ghiDungLanCuoi(tokenId: number): void {
  void (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.execute(
        sql`UPDATE ai_gateway_tokens SET "dungLanCuoiLuc" = now()
             WHERE id = ${tokenId} AND ("dungLanCuoiLuc" IS NULL OR "dungLanCuoiLuc" < now() - interval '60 seconds')`,
      );
    } catch (err) {
      canhBao("ghiDungLanCuoi", err);
    }
  })();
}

export interface MucToken {
  id: number;
  tienTo: string;
  ten: string;
  phamVi: PhamVi[];
  nguon: string;
  trangThai: "hieu-luc" | "het-han" | "thu-hoi";
  hetHanLuc: string | null;
  thuHoiLuc: string | null;
  dungLanCuoiLuc: string | null;
  createdAt: string | null;
}

/** Token CỦA MÌNH, mới nhất trước — KHÔNG BAO GIỜ mang băm/bản rõ. */
export async function danhSachTokenCuaToi(userId: number): Promise<MucToken[]> {
  const db = await getDb();
  if (!db || !Number.isInteger(userId) || userId <= 0) return [];
  try {
    const hang = await chay<Hang>(
      db,
      sql`SELECT id, "tienTo" AS tien_to, ten, "phamVi" AS pham_vi, nguon,
                 CASE WHEN "thuHoiLuc" IS NOT NULL THEN 'thu-hoi' WHEN "hetHanLuc" <= now() THEN 'het-han' ELSE 'hieu-luc' END AS trang_thai,
                 "hetHanLuc" AS het_han_luc, "thuHoiLuc" AS thu_hoi_luc, "dungLanCuoiLuc" AS dung_luc, "createdAt" AS tao_luc
            FROM ai_gateway_tokens WHERE "userId" = ${userId}
           ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
    );
    return hang.map((h) => ({
      id: Number(h.id),
      tienTo: String(h.tien_to),
      ten: String(h.ten),
      phamVi: chuanHoaPhamVi(h.pham_vi),
      nguon: String(h.nguon),
      trangThai: h.trang_thai as MucToken["trangThai"],
      hetHanLuc: isoCua(h.het_han_luc),
      thuHoiLuc: isoCua(h.thu_hoi_luc),
      dungLanCuoiLuc: isoCua(h.dung_luc),
      createdAt: isoCua(h.tao_luc),
    }));
  } catch (err) {
    canhBao("danhSachTokenCuaToi", err);
    return [];
  }
}

/** Thu hồi token CỦA MÌNH. `false` = không có gì thu hồi (không tồn tại · của người khác · đã thu hồi). */
export async function thuHoiToken(userId: number, id: number): Promise<boolean> {
  const db = await getDb();
  if (!db || !Number.isInteger(id) || id <= 0) return false;
  try {
    const hang = await chay(
      db,
      sql`UPDATE ai_gateway_tokens SET "thuHoiLuc" = now(), "thuHoiBoi" = ${userId}
           WHERE id = ${id} AND "userId" = ${userId} AND "thuHoiLuc" IS NULL RETURNING id`,
    );
    return hang.length === 1;
  } catch (err) {
    canhBao("thuHoiToken", err);
    return false;
  }
}

export type KetQuaTuThuHoi =
  | { ok: true; tokenId: number; userId: number; tienTo: string; daThuHoiTruoc: boolean }
  | { ok: false; ma: "khong-hop-le" | "csdl" };

/**
 * ★ Đợt 4B-server — TỰ THU HỒI: extension "đăng xuất" bằng chính token nó đang giữ (`POST /api/ai/gateway-token/tu-thu-hoi`).
 *
 * Ngoại lệ có chủ đích của PHẠM VI CHỦ (cùng lý do `xacThucTokenNguoiDung`): tra theo BĂM — người cầm bản rõ chính là bằng
 * chứng. Thu hẹp quyền luôn được phép ⇒ KHÔNG đòi token còn hạn / tài khoản còn bật / còn quyền AI: một token hết hạn hay
 * của tài khoản bị khoá vẫn tự thu hồi được (kết quả chỉ có thể là ít quyền hơn).
 * IDEMPOTENT: đã thu hồi trước đó ⇒ `ok` + `daThuHoiTruoc: true`, KHÔNG ghi đè `thuHoiLuc`/`thuHoiBoi` cũ (giữ dấu vết
 * lượt thu hồi đầu, kể cả lượt HỆ THỐNG có `thuHoiBoi = NULL`). Lượt mới ghi `thuHoiBoi = chủ token` (tự tay).
 */
export async function tuThuHoiTokenTheoBam(token: unknown): Promise<KetQuaTuThuHoi> {
  if (!laTokenNguoiDung(token)) return { ok: false, ma: "khong-hop-le" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "csdl" };
  try {
    const bam = bamToken(token);
    const [moi] = await chay<{ id: number; user_id: number; tien_to: string }>(
      db,
      sql`UPDATE ai_gateway_tokens SET "thuHoiLuc" = now(), "thuHoiBoi" = "userId"
           WHERE "tokenHash" = ${bam} AND "thuHoiLuc" IS NULL
       RETURNING id, "userId" AS user_id, "tienTo" AS tien_to`,
    );
    if (moi) return { ok: true, tokenId: Number(moi.id), userId: Number(moi.user_id), tienTo: String(moi.tien_to), daThuHoiTruoc: false };
    const [cu] = await chay<{ id: number; user_id: number; tien_to: string }>(
      db,
      sql`SELECT id, "userId" AS user_id, "tienTo" AS tien_to FROM ai_gateway_tokens WHERE "tokenHash" = ${bam}`,
    );
    if (!cu) return { ok: false, ma: "khong-hop-le" };
    return { ok: true, tokenId: Number(cu.id), userId: Number(cu.user_id), tienTo: String(cu.tien_to), daThuHoiTruoc: true };
  } catch (err) {
    canhBao("tuThuHoiTokenTheoBam", err);
    return { ok: false, ma: "csdl" };
  }
}

/**
 * ★★★ Rà bảo mật de591c868 #2 — FAN-OUT: một sự kiện vô hiệu DANH TÍNH ⇒ mọi token cá nhân của người đó chết theo.
 *
 * Gọi từ ĐÚNG các điểm vô hiệu phiên đã có của hệ thống (`server/db/auth.ts`):
 *   • `updateUserPassword` (tự đổi + admin đặt lại) — TRONG cùng giao dịch ghi mật khẩu: đổi mật khẩu xong mà token cũ
 *     còn sống là đúng ca "kẻ trộm token sống lâu hơn lượt đổi mật khẩu của nạn nhân";
 *   • `revokeAllSessions` — "đăng xuất mọi thiết bị" (cả hai router) VÀ lượt tắt tài khoản (`updateUser({isActive:false})`
 *     gọi nó): extension là một THIẾT BỊ; và tắt-rồi-bật-lại không được làm token cũ sống lại.
 * Đồng thời: mã thiết bị ĐÃ duyệt nhưng CHƯA đổi ⇒ `tu-choi` (không đúc được token sau sự kiện).
 *
 * ⚠ `thuHoiBoi = NULL` — phân biệt thu hồi HỆ THỐNG với thu hồi tay (tay ghi id người bấm).
 * ⚠ NÉM khi CSDL lỗi (người gọi FAIL-CLOSED: lượt đổi mật khẩu rollback, không có trạng thái "mật khẩu đã đổi mà token
 *   còn sống"). Ngoại lệ có chủ đích: bảng CHƯA tồn tại (CSDL chưa áp mig 0392) ⇒ không thể có token nào ⇒ 0 — để một
 *   môi trường chưa áp 0392 không bị gãy chức năng đổi mật khẩu.
 * ⚠ Không có bộ đệm xác thực token nào để dọn: `xacThucTokenNguoiDung` tra CSDL MỖI yêu cầu (không cache).
 */
export async function thuHoiMoiTokenCuaNguoi(userId: number, tx?: CoExecute): Promise<number> {
  if (!Number.isInteger(userId) || userId <= 0) return 0;
  const db: CoExecute | null = tx ?? ((await getDb()) as unknown as CoExecute | null);
  if (!db) throw new DbUnavailableError("CSDL không sẵn sàng — không thu hồi được token cổng /v1");
  const [co] = await chay<{ co: boolean }>(db, sql`SELECT to_regclass('public.ai_gateway_tokens') IS NOT NULL AS co`);
  if (!co?.co) return 0;
  const hang = await chay(
    db,
    sql`UPDATE ai_gateway_tokens SET "thuHoiLuc" = now()
         WHERE "userId" = ${userId} AND "thuHoiLuc" IS NULL RETURNING id`,
  );
  await db.execute(
    sql`UPDATE ai_gateway_device_codes SET "trangThai" = 'tu-choi' WHERE "userId" = ${userId} AND "trangThai" = 'da-duyet'`,
  );
  return hang.length;
}

// ─── Device flow ────────────────────────────────────────────────────────────────────────────────

export type KetQuaBatDau =
  | { ok: true; maThietBi: string; maNguoiDung: string; hetHanGiay: number; chuKyGiay: number }
  | { ok: false; ma: "csdl" | "qua-tran-cho" };

type CoGiaoDich = CoExecute & { transaction: <T>(fn: (tx: CoGiaoDich) => Promise<T>) => Promise<T> };

/**
 * Extension xin mã. Không xác thực (extension chưa có danh tính) — người gọi giới hạn lượt theo IP.
 * ★ Rà bảo mật de591c868 #3 — ghi NGUỒN GỐC (`ip`, `tacNhan` = User-Agent) để trang duyệt hiện cho người dùng, và cưỡng
 *   chế trần mã đang chờ mỗi IP (`TRAN_MA_CHO_MOI_IP`, khoá tư vấn theo IP giữ trần đúng khi hai lượt xin song song).
 *   Phạm vi xin bị cắt về `PHAM_VI_THIET_BI` ngay lúc lưu (trang duyệt hiện ĐÚNG thứ sẽ được cấp).
 *   `ip` vắng (gọi nội bộ/lưới) ⇒ không áp trần IP.
 */
export async function batDauThietBi(vao: {
  ten?: unknown;
  phamVi?: unknown;
  ip?: unknown;
  tacNhan?: unknown;
}): Promise<KetQuaBatDau> {
  const db = await getDb();
  if (!db) return { ok: false, ma: "csdl" };
  const ten = chuanHoaTen(vao.ten);
  const phamVi = chuanHoaPhamViThietBi(vao.phamVi);
  const ip = chuanHoaIp(vao.ip);
  const tacNhan = chuanHoaTacNhan(vao.tacNhan);
  try {
    // Dọn mã đã chết > 1 ngày — giữ bảng nhỏ và để mã người dùng (UNIQUE) được tái dùng.
    await db.execute(sql`DELETE FROM ai_gateway_device_codes WHERE "hetHanLuc" < now() - interval '1 day'`);
    return await (db as unknown as CoGiaoDich).transaction(async (tx) => {
      if (ip) {
        await chay(tx, sql`SELECT pg_advisory_xact_lock(hashtext(${`ai_gw_device_ip:${ip}`}))`);
        const [dem] = await chay<{ n: number }>(
          tx,
          sql`SELECT count(*)::int AS n FROM ai_gateway_device_codes
              WHERE "ipKhoiTao" = ${ip} AND "trangThai" = 'cho' AND "hetHanLuc" > now()`,
        );
        if (Number(dem?.n ?? 0) >= TRAN_MA_CHO_MOI_IP) return { ok: false as const, ma: "qua-tran-cho" as const };
      }
      for (let lan = 0; lan < 5; lan++) {
        const maTb = sinhMaThietBi();
        const maNd = sinhMaNguoiDung();
        try {
          // SAVEPOINT (giao dịch lồng): một lượt trùng mã (23505) không được làm hỏng cả giao dịch ngoài.
          await tx.transaction((sp) =>
            sp.execute(
              sql`INSERT INTO ai_gateway_device_codes ("maThietBiHash", "maNguoiDung", ten, "phamVi", "hetHanLuc", "ipKhoiTao", "tacNhanKhoiTao")
                  VALUES (${maTb.bam}, ${maNd}, ${ten}, ${sql.raw(mangVanBan(phamVi))},
                          now() + make_interval(secs => ${HET_HAN_THIET_BI_GIAY}), ${ip}, ${tacNhan})`,
            ),
          );
          return { ok: true as const, maThietBi: maTb.ma, maNguoiDung: maNd, hetHanGiay: HET_HAN_THIET_BI_GIAY, chuKyGiay: CHU_KY_HOI_GIAY };
        } catch (err) {
          // Trùng mã người dùng (xác suất ~n/2,56·10¹⁰) ⇒ sinh lại; lỗi khác ⇒ bỏ.
          if ((err as { code?: string })?.code !== "23505" && (err as { cause?: { code?: string } })?.cause?.code !== "23505") throw err;
        }
      }
      return { ok: false as const, ma: "csdl" as const };
    });
  } catch (err) {
    canhBao("batDauThietBi", err);
    return { ok: false, ma: "csdl" };
  }
}

export type MaTuChoiThietBi = "khong-ton-tai" | "het-han" | "da-xu-ly" | "csdl";

export interface XemThietBiOk {
  ok: true;
  /** id hàng mã thiết bị — cho audit (không phải bí mật). */
  id: number;
  ten: string;
  phamVi: PhamVi[];
  conLaiGiay: number;
  /** ★ #3 — nguồn gốc lượt khởi tạo (NULL = hàng cũ trước 0394 / gọi nội bộ). */
  ipKhoiTao: string | null;
  tacNhanKhoiTao: string | null;
  taoLuc: string | null;
}

/** Trang web xem mã trước khi duyệt: tên thiết bị + phạm vi xin + NGUỒN GỐC lượt khởi tạo (IP, User-Agent, lúc tạo). */
export async function xemThietBi(maVao: unknown): Promise<XemThietBiOk | { ok: false; ma: MaTuChoiThietBi }> {
  const ma = chuanHoaMaNguoiDung(maVao);
  if (!ma) return { ok: false, ma: "khong-ton-tai" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "csdl" };
  try {
    const [h] = await chay<{
      id: number;
      ten: string;
      pham_vi: string[];
      trang_thai: string;
      het_han: boolean;
      con_lai: number;
      ip: string | null;
      ua: string | null;
      tao_luc: unknown;
    }>(
      db,
      sql`SELECT id, ten, "phamVi" AS pham_vi, "trangThai" AS trang_thai, ("hetHanLuc" <= now()) AS het_han,
                 greatest(0, floor(extract(epoch FROM ("hetHanLuc" - now()))))::int AS con_lai,
                 "ipKhoiTao" AS ip, "tacNhanKhoiTao" AS ua, "createdAt" AS tao_luc
            FROM ai_gateway_device_codes WHERE "maNguoiDung" = ${ma}`,
    );
    if (!h) return { ok: false, ma: "khong-ton-tai" };
    if (h.het_han) return { ok: false, ma: "het-han" };
    if (h.trang_thai !== "cho") return { ok: false, ma: "da-xu-ly" };
    return {
      ok: true,
      id: Number(h.id),
      ten: h.ten,
      phamVi: chuanHoaPhamViThietBi(h.pham_vi),
      conLaiGiay: Number(h.con_lai),
      ipKhoiTao: h.ip ?? null,
      tacNhanKhoiTao: h.ua ?? null,
      taoLuc: isoCua(h.tao_luc),
    };
  } catch (err) {
    canhBao("xemThietBi", err);
    return { ok: false, ma: "csdl" };
  }
}

/** Người dùng (phiên web) duyệt/từ chối. Chỉ mã đang `cho` và còn hạn đổi được trạng thái — một lần duy nhất. */
export async function quyetThietBi(
  userId: number,
  maVao: unknown,
  dongY: boolean,
): Promise<{ ok: true; trangThai: "da-duyet" | "tu-choi"; id: number } | { ok: false; ma: MaTuChoiThietBi }> {
  const ma = chuanHoaMaNguoiDung(maVao);
  if (!ma) return { ok: false, ma: "khong-ton-tai" };
  const db = await getDb();
  if (!db || !Number.isInteger(userId) || userId <= 0) return { ok: false, ma: "csdl" };
  const trangThai = dongY ? "da-duyet" : "tu-choi";
  try {
    const doi = await chay<{ id: number }>(
      db,
      sql`UPDATE ai_gateway_device_codes SET "trangThai" = ${trangThai}, "userId" = ${userId}
           WHERE "maNguoiDung" = ${ma} AND "trangThai" = 'cho' AND "hetHanLuc" > now() RETURNING id`,
    );
    if (doi.length === 1) return { ok: true, trangThai, id: Number(doi[0].id) };
    const xem = await xemThietBi(ma);
    return { ok: false, ma: xem.ok ? "da-xu-ly" : xem.ma };
  } catch (err) {
    canhBao("quyetThietBi", err);
    return { ok: false, ma: "csdl" };
  }
}

export type KetQuaDoiMa =
  | { trangThai: "cho" | "cham-lai" | "tu-choi" | "het-han" | "khong-hop-le" | "qua-tran" | "csdl" }
  | {
      trangThai: "xong";
      token: string;
      tienTo: string;
      tokenId: number;
      userId: number;
      ten: string;
      phamVi: PhamVi[];
      hetHanLuc: string | null;
      /** ★ #3 — truy vết: hàng mã thiết bị + IP đã khởi tạo nó. */
      maThietBiId: number;
      ipKhoiTao: string | null;
    };

/**
 * Extension hỏi định kỳ bằng mã BÍ MẬT. Một giao dịch + `FOR UPDATE`: hai lượt hỏi song song của một mã đã duyệt
 * không đẻ được hai token — lượt sau thấy `da-doi` ⇒ `khong-hop-le` (dùng một lần).
 */
export async function doiMaThietBi(maThietBi: unknown): Promise<KetQuaDoiMa> {
  if (!laMaThietBi(maThietBi)) return { trangThai: "khong-hop-le" };
  const db = await getDb();
  if (!db) return { trangThai: "csdl" };
  try {
    return await db.transaction(async (txGoc) => {
      const tx = txGoc as unknown as CoExecute;
      const [h] = await chay<{
        id: number;
        trang_thai: string;
        user_id: number | null;
        ten: string;
        pham_vi: string[];
        het_han: boolean;
        qua_nhanh: boolean;
        so_lan: number;
        ip: string | null;
        is_active: boolean | null;
        role: string | null;
        pwd_changed: unknown;
        pwd_invalid: unknown;
      }>(
        tx,
        sql`SELECT d.id, d."trangThai" AS trang_thai, d."userId" AS user_id, d.ten, d."phamVi" AS pham_vi,
                   (d."hetHanLuc" <= now()) AS het_han,
                   coalesce(d."hoiLanCuoiLuc" > now() - make_interval(secs => ${CHU_KY_HOI_GIAY - 1}), false) AS qua_nhanh,
                   d."soLanHoi" AS so_lan, d."ipKhoiTao" AS ip,
                   u."isActive" AS is_active, u.role, u."passwordChangedAt" AS pwd_changed, u."passwordInvalidBefore" AS pwd_invalid
              FROM ai_gateway_device_codes d LEFT JOIN users u ON u.id = d."userId"
             WHERE d."maThietBiHash" = ${bamToken(maThietBi)} FOR UPDATE OF d`,
      );
      if (!h || h.trang_thai === "da-doi") return { trangThai: "khong-hop-le" as const };
      if (h.het_han || Number(h.so_lan) >= TRAN_LUOT_HOI) return { trangThai: "het-han" as const };
      await tx.execute(
        sql`UPDATE ai_gateway_device_codes SET "soLanHoi" = "soLanHoi" + 1, "hoiLanCuoiLuc" = now() WHERE id = ${h.id}`,
      );
      if (h.qua_nhanh) return { trangThai: "cham-lai" as const };
      if (h.trang_thai === "cho") return { trangThai: "cho" as const };
      if (h.trang_thai === "tu-choi") return { trangThai: "tu-choi" as const };
      // ★ Rà bảo mật de591c868 #2 — người duyệt bị tắt / bị buộc đổi mật khẩu GIỮA lúc duyệt và lúc đổi (kể cả bằng SQL
      //   thẳng, không qua fan-out) ⇒ mã chết hẳn (`tu-choi`), KHÔNG đúc token.
      if (lyDoChanTaiKhoan(h)) {
        await tx.execute(sql`UPDATE ai_gateway_device_codes SET "trangThai" = 'tu-choi' WHERE id = ${h.id}`);
        return { trangThai: "tu-choi" as const };
      }
      // da-duyet ⇒ cấp token cho NGƯỜI DUYỆT, đánh dấu đã đổi, cùng giao dịch.
      // ★ #3 — phạm vi TRẦN thiết bị (cắt lại cả hàng cũ trước 0394) + hạn NGẮN `SO_NGAY_THIET_BI`.
      const kq = await chenToken(tx, {
        userId: Number(h.user_id),
        ten: chuanHoaTen(h.ten),
        phamVi: chuanHoaPhamViThietBi(h.pham_vi),
        soNgay: SO_NGAY_THIET_BI,
        nguon: "thiet-bi",
      });
      if (!kq.ok) return { trangThai: kq.ma };
      await tx.execute(sql`UPDATE ai_gateway_device_codes SET "trangThai" = 'da-doi', "tokenId" = ${kq.id} WHERE id = ${h.id}`);
      return {
        trangThai: "xong" as const,
        token: kq.token,
        tienTo: kq.tienTo,
        tokenId: kq.id,
        userId: Number(h.user_id),
        ten: kq.ten,
        phamVi: kq.phamVi,
        hetHanLuc: kq.hetHanLuc,
        maThietBiId: Number(h.id),
        ipKhoiTao: h.ip ?? null,
      };
    });
  } catch (err) {
    canhBao("doiMaThietBi", err);
    return { trangThai: "csdl" };
  }
}
