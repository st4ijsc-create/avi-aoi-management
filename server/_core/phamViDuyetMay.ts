/**
 * ★★★ F5-nhanh (2026-11-02) — PHẠM VI MÁY cho DUYỆT / TỪ CHỐI đăng ký máy: MỘT hàm, mọi đường gọi.
 *
 * Lỗ được vá (có từ trước F5-nhanh): khi `MACHINE_APPROVE_RBAC_OPEN_ENABLED=true`, người KHÔNG phải admin có permission bit
 * `machine_registration` duyệt được máy của BẤT KỲ nhà máy nào — tRPC `machine.approve` và socket `admin:approve_registration`
 * đều không kiểm phạm vi ⇒ người quản trị đăng ký của nhà máy A đúc được khoá máy cho máy của nhà máy B (và qua `stationId`
 * chuyển máy sang trạm của nhà máy khác).
 *
 * Người gọi (census `server/routers/duyetMayPhamViCensus.test.ts` ghim cả bốn, và mọi đường duyệt/từ chối MỚI):
 *   · tRPC `machine.approve` / `machine.reject` (`server/routers/hierarchyRouters.ts`)
 *   · socket `admin:approve_registration` / `admin:reject_registration` (`server/_core/socket.ts`)
 *
 * Luật:
 *   • vai `admin` ⇒ miễn (không tra phạm vi, không câu DB) — admin luôn toàn quyền phạm vi (`resolveTenantFactoryScope`);
 *   • còn lại ⇒ máy đích phải nằm trong `idsTrongPhamVi("machine", người, { strict: true })` — CÙNG bộ phân giải mọi router dùng
 *     (như `ghiThucTheTrongPhamVi` / `machine.listPending`); nếu có `stationId` đích thì trạm cũng phải trong phạm vi;
 *   • không danh tính / không có máy đích / lỗi tra phạm vi ⇒ TỪ CHỐI (fail-closed);
 *   • người gọi trả ĐÚNG lời từ chối "không có máy" sẵn có của đường ấy ⇒ ngoài phạm vi ≡ không tồn tại.
 *
 * Không import tầng chạy lúc nạp (import động `../db/hierarchy`): socket.ts nạp tệp này lúc khởi động.
 */

export interface NguoiDuyetMay {
  userId?: number | null;
  userRole?: string | null;
}

export type CapDuyetMay = "machine" | "station";

export type KetQuaPhamViDuyetMay =
  | { ok: true }
  | { ok: false; cap: CapDuyetMay; lyDo: "THIEU_DANH_TINH" | "KHONG_CO_MAY" | "NGOAI_PHAM_VI" | "LOI_PHAM_VI" };

type TraIds = (cap: CapDuyetMay, pv: { userId: number; userRole: string }) => Promise<number[] | null>;
let traIdsGhiDe: TraIds | null = null;
/** Chỉ lưới: thay bộ tra phạm vi (không cần CSDL). `null` ⇒ về mặc định (`db/hierarchy.idsTrongPhamVi` strict THẬT). */
export function __datBoTraPhamViDuyetMayChoTest(f: TraIds | null): void {
  traIdsGhiDe = f;
}
async function traIds(cap: CapDuyetMay, pv: { userId: number; userRole: string }): Promise<number[] | null> {
  if (traIdsGhiDe) return traIdsGhiDe(cap, pv);
  const { idsTrongPhamVi } = await import("../db/hierarchy");
  return idsTrongPhamVi(cap, pv, { strict: true });
}

const laIdHopLe = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * Máy đích (và trạm đích nếu có) có nằm trong phạm vi người duyệt không. Không bao giờ ném.
 * @param mayDich id máy, hoặc một hàm trả id (đường socket `reject`: id suy từ mã tự khai — chỉ tra khi KHÔNG phải admin).
 */
export async function kiemPhamViDuyetMay(
  nguoi: NguoiDuyetMay | null | undefined,
  mayDich: number | null | undefined | (() => Promise<number | null | undefined>),
  tuyChon: { stationId?: number | null } = {},
): Promise<KetQuaPhamViDuyetMay> {
  const vai = String(nguoi?.userRole ?? "");
  if (vai === "admin") return { ok: true };
  const userId = nguoi?.userId;
  if (!laIdHopLe(userId)) return { ok: false, cap: "machine", lyDo: "THIEU_DANH_TINH" };
  try {
    const id = typeof mayDich === "function" ? await mayDich() : mayDich;
    if (!laIdHopLe(id)) return { ok: false, cap: "machine", lyDo: "KHONG_CO_MAY" };
    const pv = { userId, userRole: vai };
    const mays = await traIds("machine", pv);
    if (mays !== null && !mays.includes(id)) return { ok: false, cap: "machine", lyDo: "NGOAI_PHAM_VI" };
    const tram = tuyChon.stationId;
    if (tram != null) {
      if (!laIdHopLe(tram)) return { ok: false, cap: "station", lyDo: "NGOAI_PHAM_VI" };
      const trams = await traIds("station", pv);
      if (trams !== null && !trams.includes(tram)) return { ok: false, cap: "station", lyDo: "NGOAI_PHAM_VI" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[PhamViDuyetMay] loi tra pham vi (fail-closed):", (err as Error)?.message ?? err);
    return { ok: false, cap: "machine", lyDo: "LOI_PHAM_VI" };
  }
}
