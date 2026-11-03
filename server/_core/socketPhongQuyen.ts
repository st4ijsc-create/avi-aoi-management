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
 * ★★ F5-nhanh review (Minor 3, 2026-11-02) — TIỀN LỌC TRONG BỘ NHỚ trước bộ xác thực lại (`socketXacThucLai.ts`), CHỈ THU HẸP.
 *
 * Dashboard / AndonBoard gửi `admin:get_online_machines` mỗi lần nối, với MỌI vai ⇒ không có tiền lọc thì mỗi người không phải admin trả
 * 2 SELECT (người dùng + sổ phiên) chỉ để bị từ chối. Tiền lọc đọc BẢN CHỤP handshake và chỉ được phép trả `false` ở chỗ cổng thật CHẮC CHẮN
 * cũng từ chối với bản chụp ấy; `true` KHÔNG cho qua gì — nơi gọi vẫn xác thực lại rồi chạy cổng thật trên chủ thể mới.
 * ⚠ Hệ quả có chủ ý: người được NÂNG vai sau handshake bị tiền lọc từ chối tới khi nối lại (chiều ĐÓNG — đúng nghĩa "chỉ thu hẹp").
 * ⚠ Cờ RBAC mở ⇒ quyết định cần `checkPermission` (DB) ⇒ tiền lọc không đoán, trả `true` (để cổng thật quyết sau xác thực lại).
 * Census `socketThaoTacNhayCamCensus.test.ts` chỉ cho hai hàm này đứng TRƯỚC xác thực lại, và chỉ ở hình dạng
 * `tienLoc(socket.data) ? await xacThucLaiChoThaoTacSocket(socket) : { ok: false, … }`.
 */
export function tienLocQuanLyDangKyMay(data: DuLieuSocket | null | undefined): boolean {
  if (!laSocketNguoiDung(data)) return false;
  if (!coMoRbacDuyetMay()) return String(data!.user!.role ?? "") === "admin";
  return true;
}
/** Tiền lọc của `admin:reject_registration` — cổng thật chỉ đọc vai (luôn admin), nên tiền lọc = cổng thật trên BẢN CHỤP. */
export function tienLocTuChoiDangKyMay(data: DuLieuSocket | null | undefined): boolean {
  return duocTuChoiDangKyMay(data);
}

/**
 * Phòng thông báo `user:{userId}` — chỉ socket người dùng, và chỉ phòng CỦA CHÍNH người đó.
 */
export function duocVaoPhongNguoiDung(data: DuLieuSocket | null | undefined, userId: unknown): boolean {
  if (!laSocketNguoiDung(data)) return false;
  return Number(userId) === data!.user!.id;
}

/**
 * Phòng `ai:agents` (nudge làm mới Agent Command Center): CHỈ admin | engineer + giấy phép MOD_AI — cùng cặp với
 * `aiAgentCenterRouter` (`roleProcedure("admin","engineer").use(moduleGate("MOD_AI"))`). Lỗi kiểm giấy phép ⇒ false (fail-closed).
 * Việc "sự kiện nào thuộc phạm vi người nhận" do bridge quyết (aiAgentRealtime.ts), cổng này chỉ chặn người không được xem màn.
 */
export const VAI_XEM_AI_AGENTS = ["admin", "engineer"] as const;
export async function duocVaoPhongAiAgents(data: DuLieuSocket | null | undefined): Promise<boolean> {
  if (!laSocketNguoiDung(data)) return false;
  if (!(VAI_XEM_AI_AGENTS as readonly string[]).includes(String(data!.user!.role ?? ""))) return false;
  try {
    const { isModuleLicensed } = await import("./moduleGate");
    return await isModuleLicensed("MOD_AI");
  } catch (err) {
    console.error("[Socket.io] loi kiem giay phep MOD_AI cho ai:agents:", (err as Error)?.message ?? err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PV-socket-1 (2026-11-03) — PHÒNG FEDERATION `sites:all` / `sites:corp:{mã tập đoàn}` (thay `site:{code}` + `sites:global`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lỗ L1 (pv-socket-kiem-ke §3): `site:update` (KPI + số cảnh báo theo site) phát vào `site:{code}` / `sites:global` mà ai đăng nhập cũng
// join được ⇒ người không có `admin_system`, người tập đoàn khác, người không được xem site cục bộ đều nhận. Hợp đồng tRPC của cùng dữ liệu
// (`federationRouter`): `requirePermission("admin_system","canView")` + `dieuKienTrang` (toàn quyền ⇒ mọi site; người hẹp ⇒ site có
// `corporateCode` thuộc mã tập đoàn của họ VÀ không `isLocal`). Hai hàm dưới đây là CẶP của hợp đồng ấy ở tầng socket:
//   • vào phòng (`phongFederationDuocVao` / `duocVaoPhongFederation`): cùng `checkPermission` + cùng `getUserAssignmentCodes` (isAdmin ⇒
//     `sites:all`; còn lại ⇒ `sites:corp:{mã}` cho mỗi mã; 0 mã ⇒ không phòng nào). Lỗi ⇒ không phòng nào (fail-closed).
//   • phát (`phongNhanSiteUpdate`): `sites:all` + `sites:corp:{site.corporateCode}` CHỈ khi site KHÔNG `isLocal` và có mã.
// Mã tập đoàn trong tên phòng: kiểm hình dạng (chuỗi, ≤ 50, `[A-Za-z0-9_-]` như mã site) — KHÔNG dựng tên phòng từ giá trị chưa kiểm.
// Mã lệch hình dạng ⇒ không phòng (người dùng chỉ mất bản đẩy realtime của mã đó; trang vẫn poll 30 s qua tRPC) — chiều ĐÓNG.

/** Quyền xem màn Federation — cùng cặp `federationRouter` (`requirePermission("admin_system","canView")`). */
export const QUYEN_XEM_FEDERATION = { module: "admin_system", action: "canView" } as const;
/** Phòng toàn quyền của `site:update` (admin: mọi site, kể cả site cục bộ). */
export const PHONG_SITES_TOAN_QUYEN = "sites:all";
/** Tiền tố phòng theo mã tập đoàn của `site:update`. */
export const TIEN_TO_PHONG_SITES_TAP_DOAN = "sites:corp:";
const MA_TAP_DOAN_HOP_LE = /^[A-Za-z0-9_-]{1,50}$/;

/** Tên phòng `sites:corp:{mã}` — mã sai hình dạng ⇒ `null` (không dựng tên phòng). */
export function phongSitesTapDoan(ma: unknown): string | null {
  return typeof ma === "string" && MA_TAP_DOAN_HOP_LE.test(ma) ? `${TIEN_TO_PHONG_SITES_TAP_DOAN}${ma}` : null;
}

/** Hai bộ đọc của cổng federation — tách để lưới tiêm (`__datCongFederationChoTest`); mặc định = `accessControl` THẬT. */
interface CongFederation {
  coQuyen(userId: number, role: string): Promise<boolean>;
  maTapDoan(userId: number, role: string): Promise<{ toanQuyen: boolean; corporateCodes: readonly string[] }>;
}
let congFederationGhiDe: CongFederation | null = null;
/** Chỉ lưới: thay bộ đọc quyền / mã tập đoàn của cổng federation. `null` ⇒ mặc định. */
export function __datCongFederationChoTest(f: CongFederation | null): void {
  congFederationGhiDe = f;
}
async function layCongFederation(): Promise<CongFederation> {
  if (congFederationGhiDe) return congFederationGhiDe;
  const ac = await import("./accessControl"); // import động: như duocVaoPhongEngineering
  return {
    coQuyen: (userId, role) => ac.checkPermission(userId, role, QUYEN_XEM_FEDERATION.module, QUYEN_XEM_FEDERATION.action),
    maTapDoan: async (userId, role) => {
      const r = await ac.getUserAssignmentCodes(userId, role);
      return { toanQuyen: r.isAdmin, corporateCodes: r.corporateCodes };
    },
  };
}

/**
 * Các phòng `site:update` mà socket này ĐƯỢC vào (đã sắp xếp). Không phải socket người dùng / không quyền / 0 mã / LỖI ⇒ `[]`.
 * Toàn quyền (isAdmin — cùng điều kiện `congMaTenant` trả "không lọc") ⇒ CHỈ `sites:all` (phòng ấy đã nhận mọi site).
 */
export async function phongFederationDuocVao(data: DuLieuSocket | null | undefined): Promise<string[]> {
  if (!laSocketNguoiDung(data)) return [];
  try {
    const user = data!.user!;
    const userId = user.id as number;
    const role = String(user.role ?? "");
    const cong = await layCongFederation();
    if (!(await cong.coQuyen(userId, role))) return [];
    const { toanQuyen, corporateCodes } = await cong.maTapDoan(userId, role);
    if (toanQuyen) return [PHONG_SITES_TOAN_QUYEN];
    const ds = new Set<string>();
    for (const ma of corporateCodes) {
      const p = phongSitesTapDoan(ma);
      if (p) ds.add(p);
      else console.warn(`[Socket.io] bo qua ma tap doan sai hinh dang cho phong federation (user=${userId})`);
    }
    return [...ds].sort();
  } catch (err) {
    console.error("[Socket.io] loi kiem quyen phong federation (fail-closed):", (err as Error)?.message ?? err);
    return [];
  }
}

/** Cổng MỘT phòng federation (dùng với `thuVaoPhong`): phòng ∈ `phongFederationDuocVao`. Lỗi ⇒ false. */
export async function duocVaoPhongFederation(data: DuLieuSocket | null | undefined, phong: unknown): Promise<boolean> {
  if (typeof phong !== "string") return false;
  return (await phongFederationDuocVao(data)).includes(phong);
}

/**
 * Phòng NHẬN một `site:update` — gương của `dieuKienTrang`: luôn `sites:all`; thêm `sites:corp:{mã}` CHỈ khi site KHÔNG cục bộ
 * (`isLocal === false`, chặt: thiếu/không rõ ⇒ coi như cục bộ) và có mã tập đoàn hợp lệ.
 */
export function phongNhanSiteUpdate(site: { corporateCode?: string | null; isLocal?: boolean | null }): string[] {
  const ds = [PHONG_SITES_TOAN_QUYEN];
  if (site.isLocal === false && site.corporateCode != null) {
    const p = phongSitesTapDoan(site.corporateCode);
    if (p) ds.push(p);
  }
  return ds;
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

/**
 * ★★★ F5-nhanh review (2026-11-02) — PHẠM VI MÁY của một chủ thể (thường là chủ thể VỪA đọc lại): `null` = toàn quyền (admin / vai toàn
 * quyền — cùng bộ phân giải `idsTrongPhamVi` mọi router dùng, KHÔNG luật thứ hai); tập id = chỉ các máy ấy. Không phải socket người dùng /
 * lỗi ⇒ TẬP RỖNG (fail-closed: thấy ít hơn, không bao giờ thấy nhiều hơn). Dùng cho danh sách quản trị đăng ký máy qua socket khi cờ RBAC
 * mở (mirror tRPC `machine.listPending` = `getPendingMachines(phamViCua(ctx))` lọc theo `idsTrongPhamVi("machine")`).
 */
export async function idsMayTrongPhamViCua(data: DuLieuSocket | null | undefined): Promise<Set<number> | null> {
  if (!laSocketNguoiDung(data)) return new Set();
  try {
    const ids = await (await layCongPhamVi()).idsTrongPhamVi("machine", pvCuaSocket(data!));
    return ids === null ? null : new Set(ids);
  } catch (err) {
    console.error("[Socket.io] loi tinh pham vi may (fail-closed => rong):", (err as Error)?.message ?? err);
    return new Set();
  }
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

/**
 * F5 đầy đủ — phạm vi NHÀ MÁY MỚI của một chủ thể (thường là chủ thể vừa đọc lại), CÙNG bộ phân giải `idsTrongPhamVi("factory")` mà
 * `tuDongVaoPhongPhamVi` cấp phòng, đã sắp xếp. ⚠ NÉM khi lỗi (không nuốt): lượt quét của `socketXetLaiQuyen` coi lỗi là NGẮT (fail-closed).
 */
export async function idsNhaMayTrongPhamViHoacNem(data: DuLieuSocket): Promise<number[] | null> {
  // `data` là chủ thể VỪA đọc lại (`xacThucLaiChoThaoTacSocket` ok ⇒ luôn là socket người dùng); thiếu `user` ⇒ pvCuaSocket ném TypeError.
  const ids = await (await layCongPhamVi()).idsTrongPhamVi("factory", pvCuaSocket(data));
  return ids === null ? null : [...ids].sort((a, b) => a - b);
}

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
    // F5 đầy đủ — DẤU VÂN TAY phạm vi: đúng tập vừa cấp phòng (null = toàn quyền). Lượt quét của `socketXetLaiQuyen` so tập MỚI với tập này;
    // khác ⇒ ngắt (nối lại = phòng mới). Mảng (không Set) để đi qua được bộ chuyển Redis.
    socket.data.__phamViNhaMay = ids === null ? null : [...ids].sort((a, b) => a - b);
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
