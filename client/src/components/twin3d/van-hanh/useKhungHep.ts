/**
 * useKhungHep.ts — "khung nhìn có hẹp hơn `nguongPx` không?", theo dõi bằng `matchMedia`.
 *
 * ★ Vì sao `matchMedia` chứ không `window.innerWidth` + `resize`: trình duyệt chỉ bắn sự kiện
 *   khi CÂU TRẢ LỜI đổi, nên kéo cửa sổ qua lại trong cùng một bậc không sinh một lượt render nào.
 *   Đọc `innerWidth` thì mỗi pixel kéo là một lần đặt state — đúng lớp lỗi hiệu năng mà vòng PDCA 1
 *   của dự án này đã trả giá.
 * ★ SSR/môi trường không có `matchMedia` ⇒ trả `false` (khung RỘNG): mặc định phải là đường CŨ,
 *   không phải đường mới — một tính năng mới không được bật vì thiếu API để hỏi.
 */
import { useEffect, useState } from "react";

export function useKhungHep(nguongPx: number): boolean {
  const [hep, setHep] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${nguongPx}px)`);
    const capNhat = () => setHep(mq.matches);
    capNhat();
    mq.addEventListener("change", capNhat);
    return () => mq.removeEventListener("change", capNhat);
  }, [nguongPx]);
  return hep;
}
