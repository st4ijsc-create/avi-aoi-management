import { Router } from "./router.mjs";
import { HttpLoi } from "./loi.mjs";
import { dangKySanPham } from "./sanPham.mjs";

/** Ứng dụng kho sản phẩm. GIAO DIỆN CHO SẴN — không sửa tệp này. */
export function taoUngDung() {
  const router = new Router();
  // 1) Phản hồi THÀNH CÔNG (chuỗi middleware/handler không ném) mang header "x-ung-dung: kho-sp".
  router.dung(async (ctx, tiep) => {
    await tiep();
    ctx.phanHoi.headers["x-ung-dung"] = "kho-sp";
  });
  // 2) Mọi yêu cầu có phương thức khác GET phải mang header "x-khoa: bi-mat", nếu không ⇒ 401.
  router.dung(async (ctx, tiep) => {
    if (ctx.method !== "GET" && ctx.headers["x-khoa"] !== "bi-mat") throw new HttpLoi(401, "chua-xac-thuc");
    await tiep();
  });
  dangKySanPham(router);
  return { xuLy: (yeuCau) => router.xuLy(yeuCau) };
}
