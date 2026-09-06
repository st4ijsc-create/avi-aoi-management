/**
 * `/twin` — Màn VẬN HÀNH của Nhà máy 3D Digital Twin.
 *
 * ⚠ ĐÂY LÀ STUB CỦA ĐỢT 0. Nó tồn tại để CHIẾM CHỖ định tuyến + điều hướng + i18n,
 * để các đợt sau (Đ1–Đ6) không phải cùng sửa `App.tsx` / `navigation.tsx` / ba tệp
 * locale và đâm nhau khi merge (§12.2: "gộp 5 tệp dùng chung vào Đ0", rủi ro R10).
 *
 * ★ Nó KHÔNG dựng `<Canvas>` nào. Đó là chủ ý, không phải việc chưa làm xong:
 *   • RB-4 — chỉ MỘT `<Canvas>` được sống tại một thời điểm; thêm một canvas ở đây
 *     lúc chưa có bộ điều phối canvas (Đ1) là cách nhanh nhất để cạn WebGL context
 *     và làm ĐEN canvas của `/digital-twin` đang chạy.
 *   • NT-3 — màn này chưa có nguồn dữ liệu; vẽ một cảnh trống trông "bình thường" là
 *     đúng cái cạm bẫy "không có dữ liệu ≠ bình thường". Nói thẳng "chưa dựng" trung
 *     thực hơn một cảnh 3D rỗng nhìn như nhà máy đang yên ổn.
 *
 * Nội dung thật lắp ở Đợt 5 (§9). Đợt 1 thay phần thân bằng kit `twin3d/loi/`.
 */
import { useTranslation } from "react-i18next";

export default function TwinVanHanh() {
  const { t } = useTranslation();

  return (
    <div className="p-6" data-testid="man-twin-van-hanh">
      <h1 className="text-2xl font-semibold text-foreground">{t("twin3d.vanHanh.tieuDe")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("twin3d.vanHanh.moTa")}
      </p>
      <p className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("twin3d.chuaDung")}
      </p>
    </div>
  );
}
