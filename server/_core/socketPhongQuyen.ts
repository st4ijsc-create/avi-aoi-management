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
