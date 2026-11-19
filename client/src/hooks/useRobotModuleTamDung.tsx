/**
 * Pha 0 · C0-5 — CỜ "mô-đun robot/AGV tạm dừng" cho UI.
 *
 * Nguồn sự thật = máy chủ (`oversight.posture.robotControlEnabled`, cùng vị từ `isRobotControlEnabled()` mà các cổng thật dùng) — client KHÔNG tự đọc env.
 * Ba trạng thái:
 *   • "bat"      — cờ bật: trang chạy như cũ;
 *   • "tam-dung" — cờ TẮT, hoặc KHÔNG đọc được cờ (lỗi mạng/quyền): ĐÓNG mặc định — trang robot không mount, không có mutation nào;
 *   • "dang-tai" — chưa có câu trả lời: cũng KHÔNG mount trang (tránh chớp một lần "bật" rồi tắt).
 * Ngoài Provider (test, màn khác) ngữ cảnh là "bat" ⇒ hành vi cũ không đổi một byte; Provider chỉ được đặt ở App (đã đăng nhập mới hỏi máy chủ).
 */
import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { trpc } from "@/lib/trpc";

export type TrangRobotModule = "bat" | "tam-dung" | "dang-tai";

/** Xuất để test đặt giá trị trực tiếp (không cần dựng truy vấn). */
export const RobotModuleContext = createContext<TrangRobotModule>("bat");
const Ctx = RobotModuleContext;

/** Hàm thuần: gom kết quả truy vấn thành trạng thái — ĐÓNG khi lỗi/thiếu dữ liệu. */
export function trangTuPosture(a: { dangTai: boolean; loi: boolean; robotControlEnabled: boolean | undefined }): TrangRobotModule {
  if (a.dangTai) return "dang-tai";
  if (a.loi) return "tam-dung";
  return a.robotControlEnabled === true ? "bat" : "tam-dung";
}

/**
 * Thêm lớp QUYỀN trước posture: `oversight.posture` cần `machine_monitoring`/canView. Chưa đủ quyền (kể cả quyền CHƯA TẢI XONG)
 * ⇒ "tam-dung" (ĐÓNG, không bao giờ "dang-tai"/"bat") và KHÔNG gọi thủ tục — tránh FORBIDDEN trong thân batch. Chưa đăng nhập ⇒ "bat" như cũ.
 */
export function trangRobotModule(a: {
  coDangNhap: boolean;
  coQuyen: boolean;
  dangTai: boolean;
  loi: boolean;
  robotControlEnabled: boolean | undefined;
}): TrangRobotModule {
  if (!a.coDangNhap) return "bat";
  if (!a.coQuyen) return "tam-dung";
  return trangTuPosture({ dangTai: a.dangTai, loi: a.loi, robotControlEnabled: a.robotControlEnabled });
}

export function RobotModuleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const coQuyen = hasPermission("machine_monitoring", "canView");
  const q = trpc.oversight.posture.useQuery(undefined, { enabled: !!user && coQuyen, staleTime: 30_000, retry: false, refetchOnWindowFocus: false });
  const trang: TrangRobotModule = trangRobotModule({ coDangNhap: !!user, coQuyen, dangTai: q.isLoading, loi: q.isError, robotControlEnabled: q.data?.robotControlEnabled });
  return <Ctx.Provider value={trang}>{children}</Ctx.Provider>;
}

export const useRobotModuleTrang = (): TrangRobotModule => useContext(Ctx);
