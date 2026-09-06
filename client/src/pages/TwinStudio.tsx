/**
 * `/twin-studio` — Màn THIẾT KẾ (dựng nhà xưởng, đặt máy) của Nhà máy 3D Digital Twin.
 *
 * ⚠ STUB CỦA ĐỢT 0 — xem docblock `TwinVanHanh.tsx` về lý do chiếm chỗ sớm và vì sao
 * KHÔNG dựng `<Canvas>` ở đây (RB-4: một canvas sống tại một thời điểm).
 *
 * ★ QUYỀN (§6.4 + bài học Khối D): route này gate `settings_factory`, và mục nav
 * tương ứng trong `navigation.tsx` khai ĐÚNG chuỗi đó. Lớp lỗi phải tránh là "một
 * lối vào rồi TỪ CHỐI" — mục nav khai quyền X trong khi route đích đòi quyền Y, nên
 * người dùng THẤY dòng menu rồi bị chặn khi bấm vào.
 *   `RouteGuard navHref="/twin-studio"` là cách repo cưỡng chế điều đó: guard không
 * tự khai quyền mà TRA từ chính `navGroups`, nên hai bên không thể lệch nhau.
 *
 * ⚠ Phép đo quyền cho màn này PHẢI thực hiện bằng tài khoản KHÔNG phải admin — admin
 * bypass `requirePermission`, nên đo bằng admin chứng minh số 0 (§6.4).
 *
 * Nội dung thật lắp ở Đợt 4 (§7, §10A, §10B).
 */
import { useTranslation } from "react-i18next";

export default function TwinStudio() {
  const { t } = useTranslation();

  return (
    <div className="p-6" data-testid="man-twin-studio">
      <h1 className="text-2xl font-semibold text-foreground">{t("twin3d.studio.tieuDe")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("twin3d.studio.moTa")}
      </p>
      <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("twin3d.chuaDung")}
      </p>
    </div>
  );
}
