/**
 * ★★★ PLT-01 (doc 80 Phụ lục F §6 · Task 7 Đợt 0) — PHÂN QUYỀN VÀO PHÒNG SOCKET, MỘT NƠI DUY NHẤT.
 *
 * Handshake cho socket tự khai `auth.clientType:"machine"` đi qua KHÔNG cần cookie (thiết kế doc 56:
 * máy xác thực TỪNG SỰ KIỆN bằng apiKey — confirm_mapping / request_config / sync_started). Bản thân
 * điều đó không sai; cái sai là chính socket vô danh ấy vẫn được vào các phòng HƯỚNG NGƯỜI DÙNG
 * (`engineering:*`, `global`, `admin`, `telemetry:all`, …) qua các handler subscribe chung — đo sống:
 * nhận giá trị PLC live, sự kiện an toàn, telemetry, danh sách máy chờ đăng ký.
 *
 * Luật ở đây:
 *  • Phòng hướng người dùng ⇒ chỉ socket TRÌNH DUYỆT có danh tính người dùng (`laSocketNguoiDung`).
 *    Luồng máy giữ nguyên: `machine:${id}` chỉ vào qua confirm_mapping / sync_started (không qua đây).
 *  • `engineering:*` ⇒ thêm kiểm quyền `machine_monitoring/canView` (alias → `machine_status`) bằng
 *    `checkPermission` sẵn có — ĐÚNG quyền mà `programming.startWatch` (nguồn phát của phòng) đòi.
 *  • "Không biết" rơi về phía CHẶN: lỗi kiểm quyền ⇒ không join.
 *
 * `socket.ts` / `notificationService.ts` import các hàm này; test cũng chạy qua chúng (G20).
 */
import { coDanhTinhNguoiDung, type NguoiXemSocket } from "./twinPhamViQuyen";

/** Hình dạng `socket.data` do handshake middleware gắn. */
export interface DuLieuSocket {
  clientType?: string;
  user?: NguoiXemSocket | null;
}

/** Quyền xem phòng `engineering:{machineId}` — cùng cặp với `programming.startWatch`. */
export const QUYEN_XEM_ENGINEERING = { module: "machine_monitoring", action: "canView" } as const;

/**
 * Socket có phải socket TRÌNH DUYỆT đã xác thực người dùng (cookie phiên hợp lệ ở handshake) không?
 * Socket `machine` (bỏ qua cookie) và mọi socket không có `user.id` số ⇒ false.
 */
export function laSocketNguoiDung(data: DuLieuSocket | null | undefined): boolean {
  return data?.clientType === "browser" && coDanhTinhNguoiDung(data?.user);
}

/**
 * Được vào phòng `engineering:*` không? Socket người dùng + `checkPermission` thật.
 * Lỗi (DB, import…) ⇒ false: một catch cho qua là cửa hậu mở bằng cách làm DB lỗi.
 */
export async function duocVaoPhongEngineering(data: DuLieuSocket | null | undefined): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  try {
    const user = data!.user!;
    // Import động: giữ socket.ts không kéo accessControl → trpc lúc khởi động (tránh vòng import).
    const { checkPermission } = await import("./accessControl");
    return await checkPermission(
      user.id as number,
      String(user.role ?? ""),
      QUYEN_XEM_ENGINEERING.module,
      QUYEN_XEM_ENGINEERING.action,
    );
  } catch (err) {
    console.error("[Socket.io] loi kiem quyen engineering:", (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * ★★★ Task 11 (doc 80 PLT-01 tiếp — phát hiện khi làm Task 7) — cờ mở RBAC duyệt máy.
 *
 * Mirror Y HỆT `machineApproveRbacOpenEnabled()` (`hierarchyRouters.ts`, doc 56 Đ2a Việc 7):
 * tắt (mặc định) ⇒ `machine.listPending`/`machine.approve` chỉ role admin (byte-identical với
 * `adminProcedure`); bật ⇒ uỷ quyền cho permission bit `machine_registration`. Khai lại (không
 * import từ `hierarchyRouters.ts`) vì lý do như `duocVaoPhongEngineering`: giữ `socket.ts` không
 * kéo cây router/trpc vào lúc khởi động. Đổi tên biến môi trường thì sửa CẢ HAI nơi.
 */
function coMoRbacDuyetMay(): boolean {
  return process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED === "true";
}

/**
 * Được vào/thao tác quản trị đăng ký máy không — `admin:join`, `admin:get_online_machines`
 * (action `"canView"`), `admin:approve_registration` (action `"canEdit"`)?
 *
 * Mirror ĐÚNG quyền mà tRPC tương đương đòi (`machine.listPending`/`machine.approve` qua
 * `machineRegistrationGate(action)`): cờ tắt ⇒ y hệt role admin; cờ bật ⇒ `checkPermission`
 * THẬT trên module `machine_registration`. Lỗi (DB, import…) ⇒ false — fail-closed, như
 * `duocVaoPhongEngineering`.
 */
export async function duocQuanLyDangKyMay(
  data: DuLieuSocket | null | undefined,
  action: "canView" | "canEdit",
): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  const user = data!.user!;
  const role = String(user.role ?? "");
  if (!coMoRbacDuyetMay()) return role === "admin";
  try {
    const { checkPermission } = await import("./accessControl");
    return await checkPermission(user.id as number, role, "machine_registration", action);
  } catch (err) {
    console.error("[Socket.io] loi kiem quyen quan tri dang ky may:", (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * Được từ chối đăng ký máy không — `admin:reject_registration`?
 *
 * tRPC `machine.reject` dùng `adminProcedure` THẲNG (`_shared.ts`), KHÔNG qua
 * `machineRegistrationGate` ⇒ không đọc cờ, không có nhánh permission bit, luôn luôn chỉ role
 * admin. Mirror ĐÚNG: không gọi `checkPermission` (một non-admin được cấp permission bit
 * `machine_registration/canEdit` qua nhánh cờ bật của `approve` VẪN không được `reject` ở tRPC —
 * đưa hàm này qua `checkPermission` sẽ mở rộng quyền reject sai với hợp đồng tRPC).
 */
export function duocTuChoiDangKyMay(data: DuLieuSocket | null | undefined): boolean {
  if (!laSocketNguoiDung(data)) return false;
  return String(data!.user!.role ?? "") === "admin";
}

/**
 * Phòng thông báo `user:{userId}` — chỉ socket người dùng, và chỉ phòng CỦA CHÍNH người đó.
 */
export function duocVaoPhongNguoiDung(data: DuLieuSocket | null | undefined, userId: unknown): boolean {
  if (!laSocketNguoiDung(data)) return false;
  return Number(userId) === data!.user!.id;
}

/** Nhãn ngắn cho log từ chối. */
export function moTaSocket(data: DuLieuSocket | null | undefined): string {
  const ct = data?.clientType ?? "unknown";
  const uid = data?.user?.id;
  return `type=${ct}${typeof uid === "number" ? ` user=${uid}` : ""}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ BẢO MẬT (2026-10-23) — PHẠM VI NHÀ MÁY khi vào phòng `factory:` / `workshop:` / `line:` / `machine:` / `robot:` / `device:` / `telemetry:all`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Trước bản vá, handler `subscribe` cho MỌI socket người dùng join các phòng này bằng id TỰ KHAI ⇒ người dùng nhà máy B nhận
// `telemetry:sample` / `machine:*` / `andon:event` của nhà máy A (cùng lớp IDOR đã vá ở Luồng AI). Chỉ `twin:` có kiểm.
//
// Luật (MỘT bộ phân giải, KHÔNG có bộ luật thứ hai): `trongPhamVi` / `idsTrongPhamVi` của `db/hierarchy` — CÙNG hàm mọi router đọc dùng
// (admin / vai toàn quyền ⇒ phạm vi `null` ⇒ qua; người không gán nhà máy ⇒ `[]` ⇒ chặn). "Không biết" rơi về phía CHẶN: lỗi DB ⇒ false.
// Ngoài phạm vi và KHÔNG TỒN TẠI cho CÙNG kết quả `false` (không lộ tồn tại); nơi gọi phát MỘT lỗi chung không lặp id.

export type CapPhongPhamVi = "factory" | "workshop" | "line" | "machine";

/** Id trong phòng: số nguyên dương HOẶC chuỗi chỉ gồm chữ số; mọi hình dạng khác (mảng, đối tượng, "1e3", "-1", "0x1") ⇒ `null`. */
export function idPhongHopLe(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,12}$/.test(v) ? Number(v) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** Hai hàm phạm vi của `db/hierarchy` mà cổng phòng dùng — tách ra để test dùng tiêm (`__datCongPhamViChoTest`). */
interface CongPhamVi {
  trongPhamVi(cap: CapPhongPhamVi | "line" | "station", id: number, pv: { userId: number; userRole: string }): Promise<boolean>;
  idsTrongPhamVi(cap: "factory" | "machine" | "line" | "station", pv: { userId: number; userRole: string }, opts?: { strict?: boolean }): Promise<number[] | null>;
}
let congPhamViGhiDe: CongPhamVi | null = null;
/** Chỉ lưới: thay cổng phạm vi (vd. tệp đo PHÂN QUYỀN PHÒNG không cần CSDL thật). `null` ⇒ về mặc định (`db/hierarchy` THẬT). */
export function __datCongPhamViChoTest(f: CongPhamVi | null): void {
  congPhamViGhiDe = f;
}
async function layCongPhamVi(): Promise<CongPhamVi> {
  if (congPhamViGhiDe) return congPhamViGhiDe;
  return import("../db/hierarchy"); // import động: socket.ts không kéo cây db lúc khởi động
}

function pvCuaSocket(data: DuLieuSocket): { userId: number; userRole: string } {
  return { userId: data.user!.id as number, userRole: String(data.user!.role ?? "") };
}

/** Được vào phòng `{cap}:{id}` không — nhà máy / xưởng / chuyền / máy NẰM TRONG PHẠM VI người dùng? */
export async function duocVaoPhongPhamVi(data: DuLieuSocket | null | undefined, cap: CapPhongPhamVi, id: unknown): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  const n = idPhongHopLe(id);
  if (n === null) return false;
  try {
    const { trongPhamVi } = await layCongPhamVi();
    return await trongPhamVi(cap, n, pvCuaSocket(data!));
  } catch (err) {
    console.error(`[Socket.io] loi kiem pham vi ${cap}:`, (err as Error)?.message ?? err);
    return false;
  }
}

/** Người dùng có PHẠM VI TOÀN QUYỀN (admin / vai không bị thu hẹp) không? — cùng nguồn `idsTrongPhamVi("machine") === null`. */
export async function coPhamViToanQuyen(data: DuLieuSocket | null | undefined): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  try {
    const { idsTrongPhamVi } = await layCongPhamVi();
    return (await idsTrongPhamVi("machine", pvCuaSocket(data!))) === null;
  } catch (err) {
    console.error("[Socket.io] loi kiem pham vi toan quyen:", (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * Phòng firehose `telemetry:all` mang mẫu của MỌI máy ⇒ CHỈ người toàn quyền (admin telemetry monitor). Người phạm vi hẹp nhận mẫu
 * của máy mình qua `machine:{id}` (đã kiểm phạm vi).
 */
export const duocVaoPhongTelemetryAll = coPhamViToanQuyen;

/** Robot: nằm trong phạm vi qua CHUYỀN hoặc TRẠM của nó (cùng luật `robotInCallerScope`); robot mồ côi ⇒ chỉ người toàn quyền. */
export async function duocVaoPhongRobot(data: DuLieuSocket | null | undefined, robotId: unknown): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  const n = idPhongHopLe(robotId);
  if (n === null) return false;
  try {
    const { idsTrongPhamVi } = await layCongPhamVi();
    const pv = pvCuaSocket(data!);
    const [dong, tram] = await Promise.all([idsTrongPhamVi("line", pv, { strict: true }), idsTrongPhamVi("station", pv, { strict: true })]);
    if (dong === null) return true; // toàn quyền
    const { getDb } = await import("../db/connection");
    const { robots } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false;
    const [r] = await db.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, n)).limit(1);
    if (!r) return false;
    return (r.lineId != null && dong.includes(r.lineId)) || (r.stationId != null && (tram ?? []).includes(r.stationId));
  } catch (err) {
    console.error("[Socket.io] loi kiem pham vi robot:", (err as Error)?.message ?? err);
    return false;
  }
}

/** Khoá thiết bị logic của phòng `device:` (`"machine:7"` · `"robot:1"`): tách + kiểm theo loại; loại lạ ⇒ false. */
export async function duocVaoPhongThietBi(data: DuLieuSocket | null | undefined, khoa: unknown): Promise<boolean> {
  if (typeof khoa !== "string") return false;
  const m = /^(machine|robot):(\d{1,12})$/.exec(khoa);
  if (!m) return false;
  return m[1] === "machine" ? duocVaoPhongPhamVi(data, "machine", m[2]) : duocVaoPhongRobot(data, m[2]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P-S1b (2026-10-23) — TỰ VÀO PHÒNG THEO PHẠM VI: `scope:all` (toàn quyền) hoặc `factory:{id}` cho MỌI nhà máy trong phạm vi
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Cặp của `socketPhatTheoNhaMay.phatTheoNhaMay`: sự kiện máy chỉ còn phát vào `scope:all` + `factory:{fid}` + phòng phụ, KHÔNG vào `global`.
// Vì vậy socket NGƯỜI DÙNG phải ở đúng các phòng đó — suy từ phạm vi của CHÍNH họ (cùng `idsTrongPhamVi` mọi router dùng), không từ lời tự khai.
// Không gán nhà máy nào ⇒ không vào phòng nào (không nhận sự kiện máy). Lỗi ⇒ không join, trả `false` để nơi gọi thử lại ở `subscribe` kế.

/** Phần của `Socket` mà hàm này dùng — tách để test không cần socket thật. */
export interface SocketVaoPhong {
  data: DuLieuSocket & Record<string, unknown>;
  disconnected: boolean;
  join(phong: string): unknown;
}

/** Phòng toàn quyền — khai ở đây (không import `socketPhatTheoNhaMay`) để giữ module này không kéo DB lúc nạp; test canh hai hằng khớp nhau. */
export const PHONG_TOAN_QUYEN_SOCKET = "scope:all";

export async function tuDongVaoPhongPhamVi(socket: SocketVaoPhong): Promise<boolean> {
  if (!laSocketNguoiDung(socket.data)) return false;
  if (socket.data.__daVaoPhongPhamVi === true) return true;
  try {
    const { idsTrongPhamVi } = await layCongPhamVi();
    const ids = await idsTrongPhamVi("factory", pvCuaSocket(socket.data));
    if (socket.disconnected) return false;
    if (socket.data.__daVaoPhongPhamVi === true) return true; // lượt song song đã xong
    if (ids === null) socket.join(PHONG_TOAN_QUYEN_SOCKET);
    else for (const id of ids) socket.join(`factory:${id}`);
    socket.data.__daVaoPhongPhamVi = true;
    return true;
  } catch (err) {
    console.error("[Socket.io] loi tu dong vao phong pham vi:", (err as Error)?.message ?? err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SCADA R0 Task 8 (2026-10-23) — kênh `scada:subscribe`: được xem MỘT tag của máy `machineId` không?
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Socket NGƯỜI DÙNG ∧ quyền `machine_monitoring/canView` (cùng cặp `engineering:*`) ∧ phạm vi: máy có id ⇒ máy NẰM TRONG PHẠM VI;
// adapter KHÔNG gắn máy (`null`) ⇒ chỉ người có phạm vi TOÀN QUYỀN. Lỗi/không biết ⇒ false (fail-closed).
export async function coQuyenXemScada(data: DuLieuSocket | null | undefined): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  try {
    const user = data!.user!;
    const { checkPermission } = await import("./accessControl");
    return await checkPermission(user.id as number, String(user.role ?? ""), QUYEN_XEM_ENGINEERING.module, QUYEN_XEM_ENGINEERING.action);
  } catch (err) {
    console.error("[Socket.io] loi kiem quyen xem tag SCADA:", (err as Error)?.message ?? err);
    return false;
  }
}

/** Phần PHẠM VI của cổng: máy có id ⇒ máy trong phạm vi; `null` ⇒ chỉ người toàn quyền. Lỗi ⇒ false (hai hàm nền đã bắt lỗi). */
export async function trongPhamViTagScada(data: DuLieuSocket | null | undefined, machineId: number | null): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  return machineId != null ? duocVaoPhongPhamVi(data, "machine", machineId) : coPhamViToanQuyen(data);
}

/**
 * SCADA R0 final M4 — phạm vi cho CẢ một lần đăng ký `scada:subscribe`: MỘT `idsTrongPhamVi("machine")` (thay một `trongPhamVi` mỗi máy —
 * tới ~500 lần DB mỗi đăng ký). Trả hàm kiểm thuần, cùng luật `trongPhamViTagScada`: máy có id ⇒ thuộc tập (toàn quyền ⇒ mọi id hợp lệ);
 * `null` (adapter không gắn máy) ⇒ chỉ toàn quyền. Không phải người dùng / lỗi ⇒ từ chối tất cả (fail-closed).
 */
export async function taoKiemPhamViTagScada(data: DuLieuSocket | null | undefined): Promise<(machineId: number | null) => boolean> {
  const tuChoi = (): boolean => false;
  if (!laSocketNguoiDung(data)) return tuChoi;
  try {
    const { idsTrongPhamVi } = await layCongPhamVi();
    const ids = await idsTrongPhamVi("machine", pvCuaSocket(data!));
    if (ids === null) return (mid) => mid === null || idPhongHopLe(mid) !== null;
    const tap = new Set(ids);
    return (mid) => {
      if (mid === null) return false;
      const n = idPhongHopLe(mid);
      return n !== null && tap.has(n);
    };
  } catch (err) {
    console.error("[Socket.io] loi kiem pham vi tag SCADA:", (err as Error)?.message ?? err);
    return tuChoi;
  }
}

/** Cổng ĐẦY ĐỦ cho một tag: quyền ∧ phạm vi. `scadaSocket` gọi hai nửa riêng (quyền MỘT lần mỗi đăng ký, phạm vi mỗi máy). */
export async function duocXemTagScada(data: DuLieuSocket | null | undefined, machineId: number | null): Promise<boolean> {
  if (!(await coQuyenXemScada(data))) return false;
  return trongPhamViTagScada(data, machineId);
}
