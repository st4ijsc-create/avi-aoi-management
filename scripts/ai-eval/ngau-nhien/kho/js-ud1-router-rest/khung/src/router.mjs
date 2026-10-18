import { HttpLoi } from "./loi.mjs";

/**
 * Router tối giản — BẢN DỞ DANG: mới khớp đường TĨNH chính xác.
 * Chưa có: tham số `:ten`, query, middleware, 405 + allow, `/` cuối, xử lý lỗi tập trung, content-type mặc định.
 */
export class Router {
  constructor() {
    this.tuyen = [];
    this.mws = [];
  }

  dung(mw) {
    this.mws.push(mw);
  }

  them(method, mau, xuLy) {
    this.tuyen.push({ method, mau, xuLy });
  }

  async xuLy(yeuCau) {
    const path = yeuCau.url.split("?")[0];
    const ctx = {
      method: yeuCau.method,
      path,
      params: {},
      query: {},
      body: yeuCau.body,
      headers: yeuCau.headers ?? {},
      phanHoi: { status: 200, headers: {}, body: null },
    };
    const t = this.tuyen.find((r) => r.method === ctx.method && r.mau === path);
    if (!t) return { status: 404, headers: {}, body: { loi: "khong-tim-thay" } };
    await t.xuLy(ctx);
    return { ...ctx.phanHoi };
  }
}
