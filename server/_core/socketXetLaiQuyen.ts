/**
 * ★★★ F5 đầy đủ (2026-11-02) — SOCKET ĐANG SỐNG PHẢI MẤT CÁI NGƯỜI DÙNG ĐÃ MẤT: đổi phạm vi / vai / phiên ⇒ NGẮT, trên MỌI bản sao.
 *
 * Lỗ (kiểm kê `f5-kiem-ke-phan-cong-socket.md` §0–§1): `socket.data.user` là ẢNH CHỤP lúc handshake; các phòng vào lúc nối (`scope:all`,
 * `factory:{id}`, `telemetry:all`, `admin`, `engineering:*`, robot / thiết bị / twin, đăng ký SCADA) không bao giờ được kiểm lại. Người bị gỡ
 * khỏi nhà máy X vẫn nhận `factory:X`; admin bị hạ vẫn ở `scope:all`; tắt tài khoản / đăng xuất / thu hồi phiên để socket chạy tiếp.
 *
 * Thiết kế (kiểm kê §5 phương án B — KHÔNG đánh giá lại phòng tại chỗ):
 *   • NGUỒN PHÁT DUY NHẤT: trigger 0435 `pg_notify('socket_pham_vi', …)` trên 6 bảng (users · user_sessions · user_factory_assignments ·
 *     user_corporate_assignments · permissions · factories) — giao lúc COMMIT, bỏ khi ROLLBACK, phủ mọi người ghi kể cả SQL thẳng.
 *   • BỘ NHẬN (tệp này), trên MỌI bản sao KHÔNG phải edge (`batDauNgheSocketPhamVi`, gọi từ index.ts): mỗi bản sao xử lý socket CỦA NÓ
 *     (`io.local`) và bộ nhớ đệm CỦA NÓ — đúng như nhau có / không có bộ chuyển Redis. THỨ TỰ mỗi tải trọng:
 *       {"u":[…]}         ⇒ với mỗi id: xoá MỌI bộ nhớ đệm theo người (`BO_NHO_THEO_NGUOI`) RỒI ngắt phòng `kiem:user:{id}`;
 *       {"s":S,"u":[id]}  ⇒ cùng lượt xoá cho id, RỒI ngắt `kiem:phien:S` (+ socket của id KHÔNG biết khoá phiên — chiều ĐÓNG);
 *       {"all":1}         ⇒ xoá hết bộ nhớ PHẠM VI (KHÔNG danh tính, KHÔNG bộ nhớ STOP suy giảm — fix round 1 C1), RỒI ngắt mọi socket trình duyệt cục bộ với độ trễ ngẫu nhiên từng socket; giới hạn tần suất
 *                            (≤ 1 lượt / CUA_SO_ALL_MS, dồn cụm thành MỘT lượt đuôi — không mất);
 *       hỏng hình dạng    ⇒ coi như {"all":1} (chịu cùng giới hạn tần suất) + một dòng log (fail-closed).
 *     Lỗi khi xoá bộ nhớ của một người ⇒ VẪN ngắt socket của người đó (`finally`).
 *   • Cụm lớn (`cleanupExpiredSessions` có thể phát hàng nghìn {"s"} một lúc): gộp theo người / theo phiên trong hàng đợi, mỗi nhịp xử lý
 *     tối đa LO_MOI_NHIP mục rồi nhường vòng lặp sự kiện; hàng đợi quá TRAN_HANG ⇒ bỏ hàng đợi và QUÉT (không mất sự kiện nào: lượt quét
 *     kiểm lại mọi socket với DB).
 *   • QUÉT (LISTEN suy giảm / phục hồi — thông báo trong khoảng trống đã mất —, tràn hàng đợi, và định kỳ CHU_KY_QUET_MS cho các hạn THỜI
 *     GIAN: `permissions.expiresAt`, `user_sessions.expiresAt`): CHỈ xoá bộ nhớ phân công (C1) rồi với mỗi socket trình duyệt cục bộ đọc LẠI hàng
 *     người dùng + hàng sổ phiên (`xacThucLaiChoThaoTacSocket`: vai, isActive, buộc đổi mật khẩu, phiên còn sống / chưa hết hạn), phạm vi nhà
 *     máy (`idsTrongPhamVi("factory")`), mã tập đoàn và dấu vân tay quyền; so với dấu vân tay lúc nối; KHÁC ⇒ ngắt; LỖI ⇒ ngắt ở lượt CHẶT,
 *     KHÔNG ngắt (ghi nợ) ở lượt SỰ CỐ lúc `onEpisodeLost` (fix round 1 I1 — xem `yeuCauQuet`). Tải DB bị chặn:
 *     tối đa DONG_THOI_QUET socket song song, phạm vi + quyền tính MỘT lần mỗi người mỗi lượt.
 *
 * Phòng điều khiển `kiem:user:{id}` / `kiem:phien:{user_sessions.id}`: socket.ts vào cả hai lúc nối cho MỌI socket trình duyệt; KHÔNG BAO GIỜ
 * mang sự kiện (census `socketKiemCensus.test.ts`). Khoá phiên là `user_sessions.id` — KHÔNG BAO GIỜ là vé.
 * NOTIFY không mang đặc quyền (ai cũng gửi được): tải trọng giả chỉ gây xét lại / ngắt — chiều AN TOÀN; "all" giả bị giới hạn tần suất.
 * Ngoài phạm vi (phase 2): đổi cha của đối tượng (kiểm kê §1 I — phòng `machine:N` sau khi máy chuyển nhà máy).
 */
import type { Server, Socket } from "socket.io";
import { laSocketNguoiDung, idsNhaMayTrongPhamViHoacNem, type DuLieuSocket } from "./socketPhongQuyen";
import { layBoDocChuThe, xacThucLaiChoThaoTacSocket } from "./socketXacThucLai";
import { docVePhienTuCookie } from "./vePhienCookie";

export const KENH_SOCKET_PHAM_VI = "socket_pham_vi";
export const TIEN_TO_PHONG_KIEM = "kiem:";
export function phongKiemNguoi(userId: number): string {
  return `kiem:user:${userId}`;
}
export function phongKiemPhien(sessionId: number): string {
  return `kiem:phien:${sessionId}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Cấu hình (seam cho lưới)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export interface CauHinhXetLaiQuyen {
  /** Số mục (người / phiên) tối đa mỗi nhịp trước khi nhường vòng lặp sự kiện. */
  loMoiNhip: number;
  /** Hàng đợi vượt trần ⇒ bỏ hàng đợi + quét (không mất sự kiện). */
  tranHang: number;
  /** "all" (kể cả tải trọng hỏng): tối đa một lượt mỗi cửa sổ; cụm trong cửa sổ dồn thành MỘT lượt đuôi. */
  cuaSoAllMs: number;
  /** Độ trễ ngẫu nhiên tối đa trước khi ngắt từng socket ở lượt "all" (tránh bão nối lại). */
  treAllToiDaMs: number;
  /** Chu kỳ quét định kỳ (hạn thời gian của quyền / phiên). */
  chuKyQuetMs: number;
  /** Số socket kiểm song song tối đa trong một lượt quét. */
  dongThoiQuet: number;
}
const MAC_DINH: CauHinhXetLaiQuyen = {
  loMoiNhip: 500,
  tranHang: 20_000,
  cuaSoAllMs: 30_000,
  treAllToiDaMs: 3_000,
  chuKyQuetMs: 5 * 60_000,
  dongThoiQuet: 8,
};
let ch: CauHinhXetLaiQuyen = { ...MAC_DINH };

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Đọc tải trọng
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export type ThongBaoPhamVi =
  | { loai: "u"; u: number[] }
  | { loai: "s"; s: number; u: number[] }
  | { loai: "all" }
  | { loai: "hong"; lyDo: string };

const laId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647;

/** Đọc một tải trọng kênh `socket_pham_vi`. Chỉ ba hình dạng của 0435; mọi thứ khác ⇒ `hong` (nơi gọi xử lý như "all"). */
export function docThongBaoPhamVi(raw: unknown): ThongBaoPhamVi {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8_192) return { loai: "hong", lyDo: "kich thuoc / kieu" };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { loai: "hong", lyDo: "khong phai JSON" };
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { loai: "hong", lyDo: "khong phai doi tuong" };
  const r = o as Record<string, unknown>;
  const khoa = Object.keys(r).sort().join(",");
  if (khoa === "all") return r.all === 1 ? { loai: "all" } : { loai: "hong", lyDo: "all khac 1" };
  const u = r.u;
  if (!Array.isArray(u) || u.length === 0 || u.length > 1_000 || !u.every(laId)) return { loai: "hong", lyDo: "u khong hop le" };
  const ds = [...new Set(u as number[])];
  if (khoa === "u") return { loai: "u", u: ds };
  if (khoa === "s,u") return laId(r.s) ? { loai: "s", s: r.s, u: ds } : { loai: "hong", lyDo: "s khong hop le" };
  return { loai: "hong", lyDo: `khoa la (${khoa.slice(0, 40)})` };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Bộ nhớ đệm theo người — XOÁ TRƯỚC KHI NGẮT (nối lại trong cửa sổ TTL không được cấp lại phạm vi cũ)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export interface BoNhoTheoNguoi {
  ten: string;
  xoaNguoi(userId: number): Promise<void>;
  /**
   * Xoá TẤT CẢ — chỉ có ở bộ nhớ PHẠM VI (dữ liệu dẫn xuất, đọc lại được ngay). ★★★ fix round 1 (C1): bộ nhớ DANH TÍNH (authSessionCache)
   * và bộ nhớ STOP suy giảm (robotStopAuthMemo) KHÔNG BAO GIỜ bị xoá toàn cục ở đây: bộ nhớ STOP phải SỐNG QUA một sự cố DB (STOP suy giảm
   * với danh tính BIẾT CUỐI — robotStopAuth.ts / robotStopAuthMemo.ts đầu tệp, L-7 / R-10-bb); nó chỉ bị xoá toàn cục bởi lượt đổi quyền quản
   * trị. Lượt quét bắt đầu ĐÚNG lúc sự cố DB (`onEpisodeLost`) và "all" thì ai cũng NOTIFY được (kể cả tải trọng hỏng) ⇒ xoá toàn cục ở
   * đây là một cách xoá bộ nhớ STOP từ xa.
   */
  xoaHet?: () => Promise<void>;
}
/**
 * MỌI bộ nhớ đệm theo người / theo phạm vi có trong `server/` (kiểm bằng grep `new Map` + TTL lúc viết; báo cáo F5 đầy đủ liệt kê):
 *   1. `accessControl.assignmentCache` (30 s, mã nhà máy / tập đoàn được gán) — người gọi `invalidateAssignmentCache` ĐẦU TIÊN trong sản phẩm;
 *   2. `authSessionCache` L1 (hàng `users` theo phiên, ≤ AUTH_CACHE_TTL_S) — `invalidateAuthUser` (nó cũng dọn bộ nhớ STOP CỦA NGƯỜI ĐÓ);
 *   3. `robotStopAuthMemo` (phiên + sự thật STOP-only) — `invalidateStopAuthForUser` (gọi tường minh: không dựa vào hiệu ứng phụ của 2);
 *   4. `aiAgentPhamVi` (phạm vi chủ hàng agent, 30 s) — `xoaCachePhamViChu`;
 *   5. `routes/_congAnh.nhoDemPhamVi` (phạm vi lối vào ảnh, 30 s, khoá userId:role) — `xoaNhoDemPhamViAnhCuaNguoi`.
 * Không thuộc diện (không theo người): `phamViGhiMay.boNho` (máy → chuỗi tenant), `_uyQuyenAnh.nhoDem` (đường dẫn → khoá tenant, sự kiện WORM).
 * {"u"} / {"s"} xoá CẢ NĂM cho đúng người ấy (cùng hợp đồng với lượt xoá theo người của chính bộ nhớ STOP) — một tải trọng nhắm giả chỉ xoá
 * được bộ nhớ của người ấy + ngắt người ấy (chiều ĐÓNG). "all" / tải trọng hỏng chỉ xoá các bộ có `xoaHet` (1, 4, 5).
 */
export const BO_NHO_THEO_NGUOI: readonly BoNhoTheoNguoi[] = [
  {
    ten: "accessControl.assignmentCache",
    xoaNguoi: async (id) => (await import("./accessControl")).invalidateAssignmentCache(id),
    xoaHet: async () => (await import("./accessControl")).clearAssignmentCache(),
  },
  {
    ten: "authSessionCache",
    xoaNguoi: async (id) => (await import("../services/authSessionCache")).invalidateAuthUser(id),
  },
  {
    ten: "robotStopAuthMemo",
    xoaNguoi: async (id) => (await import("../services/robot/robotStopAuthMemo")).invalidateStopAuthForUser(id),
  },
  {
    ten: "aiAgentPhamVi",
    xoaNguoi: async (id) => (await import("../services/aiAgentPhamVi")).xoaCachePhamViChu(id),
    xoaHet: async () => (await import("../services/aiAgentPhamVi")).xoaCachePhamViChu(),
  },
  {
    ten: "_congAnh.nhoDemPhamVi",
    xoaNguoi: async (id) => (await import("../routes/_congAnh")).xoaNhoDemPhamViAnhCuaNguoi(id),
    xoaHet: async () => (await import("../routes/_congAnh")).xoaNhoDemPhamViAnh(),
  },
];

/** Xoá mọi bộ nhớ theo người cho `id`. Một bộ lỗi KHÔNG chặn các bộ còn lại; trả số bộ lỗi (nơi gọi vẫn ngắt). */
async function xoaBoNhoNguoi(id: number): Promise<number> {
  let loi = 0;
  for (const b of BO_NHO_THEO_NGUOI) {
    try {
      await b.xoaNguoi(id);
    } catch (e) {
      loi++;
      console.error(`[SocketXetLaiQuyen] xoa ${b.ten} cho user ${id} that bai (van ngat):`, (e as Error)?.message ?? e);
    }
  }
  return loi;
}
/** "all" / tải trọng hỏng: CHỈ bộ nhớ PHẠM VI (có `xoaHet`) — KHÔNG danh tính, KHÔNG bộ nhớ STOP (fix round 1 C1). */
async function xoaBoNhoPhamViHet(): Promise<void> {
  for (const b of BO_NHO_THEO_NGUOI) {
    if (!b.xoaHet) continue;
    try {
      await b.xoaHet();
    } catch (e) {
      console.error(`[SocketXetLaiQuyen] xoa het ${b.ten} that bai:`, (e as Error)?.message ?? e);
    }
  }
}
/**
 * Lượt quét: CHỈ bộ nhớ phân công (để phép so phạm vi đọc phân công MỚI — ≤ 30 s nếu không xoá). Không cần xoá gì khác: hàng người dùng + sổ
 * phiên được đọc TƯƠI bằng `xacThucLaiChoThaoTacSocket` (không qua authSessionCache), quyền đọc tươi bằng `docQuyen`.
 */
async function xoaBoNhoChoQuet(): Promise<void> {
  try {
    await BO_NHO_THEO_NGUOI[0].xoaHet!();
  } catch (e) {
    console.error("[SocketXetLaiQuyen] xoa assignmentCache truoc luot quet that bai:", (e as Error)?.message ?? e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Dữ liệu kiểm lúc handshake: khoá phiên + dấu vân tay quyền
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** Hàng quyền tối thiểu cho dấu vân tay. */
export interface HangQuyenVanTay {
  moduleName: string;
  canView?: boolean | null;
  canCreate?: boolean | null;
  canEdit?: boolean | null;
  canDelete?: boolean | null;
  canExport?: boolean | null;
  expiresAt?: Date | string | null;
}
type BoDocQuyen = (userId: number) => Promise<HangQuyenVanTay[]>;
let boDocQuyenGhiDe: BoDocQuyen | null = null;
/** Chỉ lưới: thay bộ đọc hàng `permissions` của một người. `null` ⇒ mặc định (DB thật qua `db/connection`). */
export function __datBoDocQuyenChoTest(f: BoDocQuyen | null): void {
  boDocQuyenGhiDe = f;
}
async function docQuyen(userId: number): Promise<HangQuyenVanTay[]> {
  if (boDocQuyenGhiDe) return boDocQuyenGhiDe(userId);
  const { getDb } = await import("../db/connection");
  const db = await getDb();
  if (!db) return []; // không DB: lượt quét vẫn đóng qua xacThucLai (không đọc được người dùng ⇒ ngắt)
  const { permissions } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  return (await db
    .select({
      moduleName: permissions.moduleName,
      canView: permissions.canView,
      canCreate: permissions.canCreate,
      canEdit: permissions.canEdit,
      canDelete: permissions.canDelete,
      canExport: permissions.canExport,
      expiresAt: permissions.expiresAt,
    })
    .from(permissions)
    .where(eq(permissions.userId, userId))) as HangQuyenVanTay[];
}

/**
 * Dấu vân tay QUYỀN HIỆU LỰC (như `checkPermission` đọc): mỗi module năm bit, hàng đã hết hạn (`expiresAt < bây giờ`) = không bit nào.
 * ⇒ một quyền HẾT HẠN trong lúc socket sống làm dấu vân tay đổi ở lượt quét kế tiếp (không cần lượt ghi nào).
 */
export function vanTayQuyen(rows: readonly HangQuyenVanTay[], bayGio: number = Date.now()): string {
  const b = (v: unknown) => (v === true ? "1" : "0");
  return rows
    .map((r) => {
      const het = r.expiresAt != null && new Date(r.expiresAt).getTime() < bayGio;
      return `${r.moduleName}:${het ? "00000" : b(r.canView) + b(r.canCreate) + b(r.canEdit) + b(r.canDelete) + b(r.canExport)}`;
    })
    .sort()
    .join("|");
}

/**
 * fix round 1 (m5) — MÃ TẬP ĐOÀN được gán (cổng của phòng `sites:*` / `site:{code}`): cùng nguồn `getUserAssignmentCodes` mà bộ phân giải
 * phạm vi dùng; admin ⇒ [] (toàn quyền, không theo mã). Đã sắp xếp.
 */
type BoDocTapDoan = (userId: number, role: string) => Promise<string[]>;
let boDocTapDoanGhiDe: BoDocTapDoan | null = null;
/** Chỉ lưới: thay bộ đọc mã tập đoàn. `null` ⇒ mặc định (`accessControl.getUserAssignmentCodes`, bộ nhớ phân công đã xoá trước lượt quét). */
export function __datBoDocTapDoanChoTest(f: BoDocTapDoan | null): void {
  boDocTapDoanGhiDe = f;
}
async function docTapDoan(userId: number, role: string): Promise<string[]> {
  const ds = boDocTapDoanGhiDe
    ? await boDocTapDoanGhiDe(userId, role)
    : (await (await import("./accessControl")).getUserAssignmentCodes(userId, role)).corporateCodes;
  return [...ds].sort();
}

/** Dấu vân tay lúc nối (trong `socket.data.__vanTay`). Trường `null` = đọc lỗi lúc nối ⇒ lượt quét CHẶT kế tiếp NGẮT (nối lại = đọc lại). */
export interface VanTayHandshake {
  quyen: string | null;
  tapDoan: string[] | null;
}

/**
 * Lúc handshake (socket.ts io.use, SAU `sdk.authenticateRequest`): (1) `user_sessions.id` của vé cookie — khoá phòng `kiem:phien:{id}`;
 * đọc qua CÙNG bộ đọc với xacThucLai (seam chung); KHÔNG lưu vé; (2) dấu vân tay quyền. Không bao giờ ném.
 * Không đọc được khoá phiên ⇒ `null`: socket vẫn ở `kiem:user:{id}`, và một {"s"} của người đó ngắt nó (không biết phiên nào ⇒ chiều ĐÓNG).
 */
export async function chuanBiKiemHandshake(cookieHeader: string | undefined, userId: number, role: string): Promise<{ khoaPhien: number | null; vanTay: VanTayHandshake }> {
  const khoaPhienP = (async (): Promise<number | null> => {
    try {
      const ve = docVePhienTuCookie(cookieHeader);
      if (!ve) return null;
      const hang = await (await layBoDocChuThe()).docPhien(ve);
      return hang && laId(hang.id) && hang.userId === userId ? hang.id : null;
    } catch (e) {
      console.warn("[SocketXetLaiQuyen] khong doc duoc khoa phien luc handshake (socket chi o kiem:user):", (e as Error)?.message ?? e);
      return null;
    }
  })();
  const quyenP = (async (): Promise<string | null> => {
    try {
      return vanTayQuyen(await docQuyen(userId));
    } catch (e) {
      console.warn("[SocketXetLaiQuyen] khong doc duoc quyen luc handshake (quet ke tiep se ngat):", (e as Error)?.message ?? e);
      return null;
    }
  })();
  const tapDoanP = (async (): Promise<string[] | null> => {
    try {
      return await docTapDoan(userId, role);
    } catch (e) {
      console.warn("[SocketXetLaiQuyen] khong doc duoc ma tap doan luc handshake (quet ke tiep se ngat):", (e as Error)?.message ?? e);
      return null;
    }
  })();
  const [khoaPhien, quyen, tapDoan] = await Promise.all([khoaPhienP, quyenP, tapDoanP]);
  return { khoaPhien, vanTay: { quyen, tapDoan } };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Trạng thái
// ═══════════════════════════════════════════════════════════════════════════════════════════════
let io: Server | null = null;
const choNguoi = new Set<number>();
const choPhien = new Map<number, Set<number>>();
let dangChay = false;
let lanAllCuoi = Number.NEGATIVE_INFINITY;
let henAll: NodeJS.Timeout | null = null;
let dangQuet: Promise<void> | null = null;
let quetLai = false;
const choXong: Array<() => void> = [];

export interface ThongKeXetLaiQuyen {
  nhan: number;
  hong: number;
  loXuLy: number;
  loLonNhat: number;
  nguoiXuLy: number;
  phienXuLy: number;
  tranHang: number;
  allYeuCau: number;
  allChay: number;
  quet: number;
  quetSocket: number;
  quetNgat: number;
  quetLoi: number;
  quetMsCuoi: number;
  /** I1 — một lượt `su_co` đã giữ socket vì không tra được: một lượt `chat` đang NỢ (onRecovered / định kỳ trả). */
  quetNo: boolean;
}
const tkMoi = (): ThongKeXetLaiQuyen => ({
  nhan: 0, hong: 0, loXuLy: 0, loLonNhat: 0, nguoiXuLy: 0, phienXuLy: 0, tranHang: 0, allYeuCau: 0, allChay: 0, quet: 0, quetSocket: 0, quetNgat: 0, quetLoi: 0, quetMsCuoi: 0, quetNo: false,
});
let tk = tkMoi();
export function thongKeXetLaiQuyen(): ThongKeXetLaiQuyen {
  return { ...tk };
}

/** socket.ts `initializeSocket` gắn `io` (không DB, không LISTEN): bộ nhận cần nó để ngắt socket cục bộ. */
export function ganIoXetLaiQuyen(s: Server | null): void {
  io = s;
}

function socketNguoiDungCucBo(): Socket[] {
  if (!io) return [];
  return [...io.of("/").sockets.values()].filter((s) => laSocketNguoiDung(s.data as DuLieuSocket));
}
function ngatPhong(phong: string): void {
  io?.local.in(phong).disconnectSockets(true);
}
/** Socket của `userId` KHÔNG biết khoá phiên (đọc lỗi lúc handshake) ⇒ một {"s"} của người đó cũng ngắt chúng (chiều ĐÓNG). */
function ngatSocketKhongKhoaPhien(userId: number): void {
  if (!io) return;
  const nsp = io.of("/");
  for (const sid of [...(nsp.adapter.rooms.get(phongKiemNguoi(userId)) ?? [])]) {
    const s = nsp.sockets.get(sid);
    if (s && !laId((s.data as { khoaPhien?: unknown }).khoaPhien)) s.disconnect(true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Nhận + hàng đợi
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** Bộ xử lý tải trọng của kênh (cũng là seam lưới: gọi thẳng = giả lập một NOTIFY). Không bao giờ ném. */
export function nhanThongBaoPhamVi(raw: unknown): void {
  tk.nhan++;
  const tb = docThongBaoPhamVi(raw);
  if (tb.loai === "hong") {
    tk.hong++;
    console.warn(`[SocketXetLaiQuyen] tai trong hong (${tb.lyDo}) => xu ly nhu {"all":1} (gioi han tan suat)`);
    yeuCauAll("tai trong hong");
    return;
  }
  if (tb.loai === "all") {
    yeuCauAll("factories.code / corporateCode");
    return;
  }
  if (tb.loai === "u") for (const id of tb.u) choNguoi.add(id);
  else {
    let ds = choPhien.get(tb.s);
    if (!ds) choPhien.set(tb.s, (ds = new Set()));
    for (const id of tb.u) ds.add(id);
  }
  if (choNguoi.size + choPhien.size > ch.tranHang) {
    tk.tranHang++;
    console.warn(`[SocketXetLaiQuyen] hang doi vuot tran ${ch.tranHang} (${choNguoi.size} nguoi, ${choPhien.size} phien) => bo hang doi, QUET moi socket`);
    choNguoi.clear();
    choPhien.clear();
    void yeuCauQuet("tran hang doi");
    return;
  }
  lenLich();
}

function lenLich(): void {
  if (dangChay) return;
  dangChay = true;
  setImmediate(() => void xuLyHang());
}

async function xuLyHang(): Promise<void> {
  try {
    while (choNguoi.size + choPhien.size > 0) {
      let con = ch.loMoiNhip;
      const lo: Array<{ loai: "u"; id: number } | { loai: "s"; s: number; u: number[] }> = [];
      for (const id of choNguoi) {
        if (con-- <= 0) break;
        choNguoi.delete(id);
        lo.push({ loai: "u", id });
      }
      for (const [s, u] of choPhien) {
        if (con-- <= 0) break;
        choPhien.delete(s);
        lo.push({ loai: "s", s, u: [...u] });
      }
      const daXoa = new Set<number>(); // gộp: mỗi người xoá bộ nhớ MỘT lần mỗi lô
      for (const m of lo) {
        if (m.loai === "u") {
          tk.nguoiXuLy++;
          try {
            if (!daXoa.has(m.id)) {
              daXoa.add(m.id);
              await xoaBoNhoNguoi(m.id);
            }
          } finally {
            ngatPhong(phongKiemNguoi(m.id));
          }
        } else {
          tk.phienXuLy++;
          try {
            for (const id of m.u) {
              if (daXoa.has(id)) continue;
              daXoa.add(id);
              await xoaBoNhoNguoi(id);
            }
          } finally {
            ngatPhong(phongKiemPhien(m.s));
            for (const id of m.u) ngatSocketKhongKhoaPhien(id);
          }
        }
      }
      tk.loXuLy++;
      tk.loLonNhat = Math.max(tk.loLonNhat, lo.length);
      await new Promise<void>((r) => setImmediate(r)); // nhường vòng lặp sự kiện giữa hai lô
    }
  } catch (e) {
    console.error("[SocketXetLaiQuyen] xu ly hang doi loi => QUET:", (e as Error)?.message ?? e);
    void yeuCauQuet("loi xu ly hang doi");
  } finally {
    dangChay = false;
    if (choNguoi.size + choPhien.size > 0) lenLich();
    else for (const f of choXong.splice(0)) f();
  }
}

// ─── "all" (giới hạn tần suất, dồn cụm) ──────────────────────────────────────────────────────
function yeuCauAll(lyDo: string): void {
  tk.allYeuCau++;
  if (henAll) return; // đã có một lượt đuôi ⇒ dồn
  const cho = lanAllCuoi + ch.cuaSoAllMs - Date.now();
  if (cho <= 0) {
    void chayAll(lyDo);
    return;
  }
  henAll = setTimeout(() => {
    henAll = null;
    void chayAll(`${lyDo} (duoi cua so)`);
  }, cho);
  henAll.unref?.();
}
async function chayAll(lyDo: string): Promise<void> {
  lanAllCuoi = Date.now();
  tk.allChay++;
  const ds = socketNguoiDungCucBo();
  console.warn(`[SocketXetLaiQuyen] "all" (${lyDo}): xoa het bo nho dem, ngat ${ds.length} socket trinh duyet cuc bo (tre <= ${ch.treAllToiDaMs} ms)`);
  try {
    await xoaBoNhoPhamViHet();
  } finally {
    for (const s of ds) {
      const t = setTimeout(() => s.disconnect(true), Math.floor(Math.random() * Math.max(0, ch.treAllToiDaMs)));
      t.unref?.();
    }
  }
}

// ─── QUÉT ────────────────────────────────────────────────────────────────────────────────────
/**
 * ★★★ fix round 1 (I1) — HAI chế độ quét:
 *   • `chat` (mặc định — LISTEN phục hồi, định kỳ, tràn hàng đợi): BẤT KỲ lỗi nào ⇒ NGẮT (fail-closed khi DB đã về);
 *   • `su_co` (CHỈ lúc LISTEN bắt đầu suy giảm — `onEpisodeLost`, tức thường là đầu một sự cố DB): lỗi tra cứu ⇒ KHÔNG ngắt, ghi "NỢ một lượt
 *     quét" (`tk.quetNo`); khác biệt ĐÃ XÁC MINH được (vai / phạm vi / quyền / phiên đọc được mà khác) ⇒ vẫn ngắt. Lý do: không lượt thu hồi nào
 *     COMMIT được khi DB sập; thông báo lỡ trong khoảng trống do lượt `chat` BẮT BUỘC lúc `onRecovered` bắt. Không có chế độ này, một nhịp DB
 *     ngắt MỌI tab cùng lúc (và handshake nối lại khi DB còn sập bị từ chối).
 * Đang quét ⇒ dồn thành MỘT lượt lặp ngay sau, với chế độ CHẶT NHẤT được yêu cầu trong lúc chờ.
 */
export type CheDoQuet = "chat" | "su_co";
let cheDoLap: CheDoQuet = "su_co";
export function yeuCauQuet(lyDo: string, cheDo: CheDoQuet = "chat"): Promise<void> {
  if (dangQuet) {
    quetLai = true;
    if (cheDo === "chat") cheDoLap = "chat";
    return dangQuet;
  }
  dangQuet = (async () => {
    try {
      let l = lyDo;
      let c = cheDo;
      do {
        quetLai = false;
        cheDoLap = "su_co";
        await quetMotLuot(l, c);
        l = `${lyDo} (lap)`;
        c = cheDoLap;
      } while (quetLai);
    } finally {
      dangQuet = null;
    }
  })();
  return dangQuet;
}

interface VanTayNguoiMoi {
  nhaMay: number[] | null;
  quyen: string;
  tapDoan: string[];
}
type KetLuanSocket = "giu" | "ngat" | "loi";

async function quetMotLuot(lyDo: string, cheDo: CheDoQuet): Promise<void> {
  if (!io) return;
  const bd = Date.now();
  tk.quet++;
  await xoaBoNhoChoQuet(); // phân công cũ sẽ che thay đổi (≤ 30 s); KHÔNG xoá danh tính / bộ nhớ STOP (C1)
  const ds = socketNguoiDungCucBo();
  const nho = new Map<string, Promise<VanTayNguoiMoi>>();
  let ngat = 0;
  let loi = 0;
  let giuDoLoi = 0;
  let i = 0;
  const tho = async () => {
    while (i < ds.length) {
      const s = ds[i++];
      let kl: KetLuanSocket;
      try {
        kl = await socketConHopLe(s, nho);
      } catch (e) {
        kl = "loi";
        console.warn(`[SocketXetLaiQuyen] quet (${cheDo}): loi kiem socket ${s.id}:`, (e as Error)?.message ?? e);
      }
      if (kl === "loi") loi++;
      const ngatSocket = kl === "ngat" || (kl === "loi" && cheDo === "chat");
      if (kl === "loi" && cheDo === "su_co") giuDoLoi++;
      if (ngatSocket && !s.disconnected) {
        s.disconnect(true);
        ngat++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(ch.dongThoiQuet, ds.length)) }, tho));
  if (cheDo === "chat") tk.quetNo = false; // lượt chặt đã chạy trọn: nợ (nếu có) đã trả
  else if (giuDoLoi > 0) tk.quetNo = true; // lượt sự cố giữ socket vì không tra được ⇒ nợ một lượt chặt (onRecovered / định kỳ)
  tk.quetSocket += ds.length;
  tk.quetNgat += ngat;
  tk.quetLoi += loi;
  tk.quetMsCuoi = Date.now() - bd;
  console.log(`[SocketXetLaiQuyen] quet ${cheDo} (${lyDo}): ${ds.length} socket, ${nho.size} nguoi, ${ngat} ngat, ${loi} loi, ${giuDoLoi} giu-do-loi, ${tk.quetMsCuoi} ms`);
}

/** Phòng KHÔNG mang dữ liệu theo phạm vi: id riêng của socket, phòng điều khiển, `global` (không dữ liệu — census phát), `user:{id}` của chính họ. */
function laPhongKhongPhamVi(phong: string, s: Socket, userId: number): boolean {
  return phong === s.id || phong.startsWith(TIEN_TO_PHONG_KIEM) || phong === "global" || phong === `user:${userId}`;
}

/**
 * Socket còn khớp dấu vân tay lúc nối? `ngat` = khác biệt ĐÃ XÁC MINH (hoặc từ chối dứt khoát của xacThucLai); `loi` = không tra / không
 * xác minh được (lỗi DB, dấu vân tay lúc nối thiếu). Mọi ngoại lệ được NÉM cho nơi gọi (⇒ `loi`).
 */
async function socketConHopLe(s: Socket, nho: Map<string, Promise<VanTayNguoiMoi>>): Promise<KetLuanSocket> {
  const r = await xacThucLaiChoThaoTacSocket(s); // vai · isActive · buộc đổi mật khẩu · phiên sống / chưa hết hạn / đúng người — fail-closed
  if (!r.ok) return r.lyDo === "LOI_TRA_CUU" ? "loi" : "ngat";
  const d = s.data as DuLieuSocket & { __vanTay?: VanTayHandshake; __phamViNhaMay?: number[] | null; __daVaoPhongPhamVi?: boolean };
  if (String(d.user?.role ?? "") !== r.data.user.role) return "ngat";
  const vt = d.__vanTay;
  if (!vt || typeof vt.quyen !== "string" || !Array.isArray(vt.tapDoan)) return "loi"; // không đối chiếu được (đọc lỗi lúc nối)
  // m5 — chưa có dấu vân tay phạm vi (lượt tự vào phòng chưa xong / lỗi): ở trong BẤT KỲ phòng có phạm vi nào ⇒ không đối chiếu được ⇒ `loi`
  // (lượt chặt NGẮT; nối lại = cấp phòng lại). Không ở phòng có phạm vi nào ⇒ không có gì để mất ⇒ bỏ qua phần phạm vi.
  const coDauVanTayPhamVi = d.__daVaoPhongPhamVi === true;
  if (!coDauVanTayPhamVi && [...s.rooms].some((p) => !laPhongKhongPhamVi(p, s, r.data.user.id))) return "loi";
  const khoa = `${r.data.user.id}:${r.data.user.role}`;
  let p = nho.get(khoa);
  if (!p) {
    const chuThe = r.data;
    p = (async () => ({
      nhaMay: await idsNhaMayTrongPhamViHoacNem(chuThe),
      quyen: vanTayQuyen(await docQuyen(chuThe.user.id)),
      tapDoan: await docTapDoan(chuThe.user.id, chuThe.user.role),
    }))();
    p.catch(() => undefined); // mọi người chờ đều bắt; tránh "unhandled" khi chỉ một socket chờ
    nho.set(khoa, p);
  }
  const moi = await p;
  if (moi.quyen !== vt.quyen) return "ngat";
  if (JSON.stringify(moi.tapDoan) !== JSON.stringify(vt.tapDoan)) return "ngat"; // m5 — cổng `sites:*` / `site:{code}`
  if (coDauVanTayPhamVi && JSON.stringify(moi.nhaMay) !== JSON.stringify(d.__phamViNhaMay)) return "ngat";
  return "giu";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Khởi động (index.ts, mọi bản sao KHÔNG phải edge)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
type ThamSoNghe = Partial<Pick<Parameters<typeof import("../services/ops/pgChannelListener").startChannelListener>[0], "listenClient" | "notifyClient" | "pingMs" | "pingDeadlineMs" | "listenDeadlineMs" | "retryMs" | "alert">>;

/**
 * LISTEN `socket_pham_vi` (bộ nghe dùng chung: LISTEN có hạn, thử lại nền, nhịp tim, cảnh báo) + quét định kỳ. Không chặn boot (gọi không await).
 * Suy giảm (`onEpisodeLost`) và phục hồi (`onRecovered`) ⇒ QUÉT: thông báo trong khoảng trống đã mất.
 */
export async function batDauNgheSocketPhamVi(thamSo: ThamSoNghe = {}): Promise<{ stop(): Promise<void> }> {
  const { startChannelListener } = await import("../services/ops/pgChannelListener");
  const kenh = await startChannelListener({
    channel: KENH_SOCKET_PHAM_VI,
    tag: "SocketXetLaiQuyen",
    onPayload: (raw) => nhanThongBaoPhamVi(raw),
    onEpisodeLost: () => void yeuCauQuet("LISTEN suy giam", "su_co"), // I1: lỗi tra cứu không ngắt, ghi nợ
    onRecovered: () => void yeuCauQuet("LISTEN phuc hoi", "chat"), // I1: BẮT BUỘC, chặt (trả nợ)
    lostMeaning:
      "Until it reconnects, a user whose role / scope / session changed keeps the live socket on THIS replica until the next sweep (<= 5 min); a sweep runs now and on recovery.",
    ...thamSo,
  });
  const hen = setInterval(() => void yeuCauQuet("dinh ky"), ch.chuKyQuetMs);
  hen.unref?.();
  return {
    stop: async () => {
      clearInterval(hen);
      await kenh.stop();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Seam lưới
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function __datCauHinhChoTest(p: Partial<CauHinhXetLaiQuyen> | null): void {
  ch = p ? { ...ch, ...p } : { ...MAC_DINH };
}
export function __datLaiChoTest(): void {
  choNguoi.clear();
  choPhien.clear();
  if (henAll) clearTimeout(henAll);
  henAll = null;
  lanAllCuoi = Number.NEGATIVE_INFINITY;
  quetLai = false;
  tk = tkMoi();
}
/** Chờ hàng đợi xử lý xong (và lượt quét đang chạy, nếu có). */
export async function __choXongChoTest(): Promise<void> {
  if (dangChay || choNguoi.size + choPhien.size > 0) await new Promise<void>((r) => choXong.push(r));
  if (dangQuet) await dangQuet;
}
