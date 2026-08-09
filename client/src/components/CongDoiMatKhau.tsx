/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-4** — **CỔNG BUỘC ĐỔI MẬT KHẨU, PHÍA CLIENT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LƯỢNG TỪ ĐƯỢC CƯỠNG CHẾ BẰNG **CẤU TẠO CÂY REACT**, KHÔNG BẰNG MỘT DANH SÁCH ROUTE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `App.tsx` có **hơn 200** `<Route>`. Một cổng đặt "ở các route nhạy cảm" là đúng lớp lỗi *"cái gì
 * LIỆT KÊ thì luôn có phần tử thứ N+1"* — đã tái diễn **MƯỜI BẢY** lần trong chuỗi pha này; và
 * `RouteGuard` **không** phủ hết (`/`, `/login`, `/setup`, `/api-docs`, `/change-password`,
 * `/component-showcase` không có guard nào).
 *
 * ⇒ Cổng bọc **CHÍNH `<Router/>`**. Khi khoá, `children` — tức toàn bộ bảng route — **KHÔNG ĐƯỢC
 *   RENDER**. Không có "route lách được", vì **không route nào tồn tại trong cây** lúc ấy. Một
 *   `<Route>` thứ 201 thêm vào ngày mai được che **theo cấu tạo**, không cần ai nhớ khai.
 *   ⚠ Lượt `setLocation` dưới đây **chỉ để thanh địa chỉ nói thật**; nó **không phải** phép khoá.
 *     Nếu ai đó gỡ nó đi, cổng vẫn khoá — đó là dấu hiệu phép khoá nằm đúng chỗ.
 *
 * ⚠⚠ **KHÔNG DỰNG MÀN ĐỔI MẬT KHẨU THỨ HAI.** Cổng render đúng `pages/ChangePassword` đã có
 *    (`/change-password`), nên mọi lượt sửa màn ấy (kể cả lượt vá `auth.me.invalidate()` để cờ
 *    được đọc lại sau khi đổi) áp cho **cả hai** lối vào.
 *
 * ⚠ Quyết định *"có khoá không"* nằm ở `client/src/lib/congDoiMatKhau.ts` (có lưới thật); file này
 *   cố tình chỉ còn một lượt `if`. Xem lý do (node-env, không jsdom) ở docstring module ấy.
 */
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Loader2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { DUONG_DOI_MAT_KHAU, phaiKhoaVaoManDoiMatKhau } from "@/lib/congDoiMatKhau";

/** ⚠ DÙNG LẠI màn đã có — cùng module mà `<Route path="/change-password">` trỏ tới. */
const ChangePassword = lazy(() => import("@/pages/ChangePassword"));

export function CongDoiMatKhau({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  const khoa = phaiKhoaVaoManDoiMatKhau(user as Parameters<typeof phaiKhoaVaoManDoiMatKhau>[0]);

  useEffect(() => {
    // Thanh địa chỉ nói thật (deep-link cũ không được giữ lại trong lịch sử). KHÔNG phải phép khoá.
    if (khoa && location !== DUONG_DOI_MAT_KHAU) setLocation(DUONG_DOI_MAT_KHAU, { replace: true });
  }, [khoa, location, setLocation]);

  if (!khoa) return <>{children}</>;

  return (
    <>
      <div
        role="alert"
        className="flex items-start gap-3 border-b border-warning/40 bg-warning/10 px-4 py-3 text-sm"
      >
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          <p className="font-semibold text-foreground">{t("auth.mustChangePasswordTitle")}</p>
          <p className="text-muted-foreground">{t("auth.mustChangePasswordBanner")}</p>
        </div>
      </div>
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <ChangePassword />
      </Suspense>
    </>
  );
}

export default CongDoiMatKhau;
