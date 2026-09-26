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
