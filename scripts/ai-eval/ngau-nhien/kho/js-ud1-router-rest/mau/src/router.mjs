import { HttpLoi } from "./loi.mjs";

const KIEU_JSON = "application/json; charset=utf-8";

const tachDoan = (duong) => duong.split("/").slice(1);

/** Khớp các đoạn đường với mẫu (chưa giải mã); trả mảng [ten, doanTho] của tham số, hoặc null nếu không khớp. */
function khop(mauDoan, doan) {
  if (mauDoan.length !== doan.length) return null;
  const thamSo = [];
  for (let i = 0; i < doan.length; i++) {
    const m = mauDoan[i];
    if (m.startsWith(":")) {
      if (doan[i] === "") return null;
      thamSo.push([m.slice(1), doan[i]]);
    } else if (m !== doan[i]) return null;
  }
  return thamSo;
}

export class Router {
  constructor() {
    this.tuyen = [];
    this.mws = [];
  }

  dung(mw) {
    this.mws.push(mw);
  }

  them(method, mau, xuLy) {
    this.tuyen.push({ method: method.toUpperCase(), mauDoan: tachDoan(mau), xuLy });
  }

  async #dieuPhoi(ctx) {
    const doan = tachDoan(ctx.path);
    const allow = [];
    for (const t of this.tuyen) {
      const ts = khop(t.mauDoan, doan);
      if (!ts) continue;
      if (t.method !== ctx.method) {
        if (!allow.includes(t.method)) allow.push(t.method);
        continue;
      }
      const params = {};
      for (const [ten, tho] of ts) {
        try {
          params[ten] = decodeURIComponent(tho);
        } catch {
          throw new HttpLoi(400, "duong-dan-hong");
        }
      }
      ctx.params = params;
      await t.xuLy(ctx);
      return;
    }
    if (allow.length) throw new HttpLoi(405, "phuong-thuc-khong-ho-tro", undefined, { allow: allow.join(", ") });
    throw new HttpLoi(404, "khong-tim-thay");
  }

  async xuLy(yeuCau) {
    const u = new URL(yeuCau.url, "http://router.local");
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const query = {};
    for (const [k, v] of u.searchParams) query[k] = v;
    const headers = {};
    for (const [k, v] of Object.entries(yeuCau.headers ?? {})) headers[k.toLowerCase()] = v;
    const ctx = {
      method: String(yeuCau.method).toUpperCase(),
      path,
      params: {},
      query,
      body: yeuCau.body,
      headers,
      phanHoi: { status: 200, headers: {}, body: null },
    };

    const chuoi = [...this.mws, (c) => this.#dieuPhoi(c)];
    const chay = (i) => {
      let daGoi = false;
      const tiep = () => {
        if (daGoi) return Promise.reject(new Error("tiep() bị gọi hai lần"));
        daGoi = true;
        return chay(i + 1);
      };
      return Promise.resolve().then(() => chuoi[i](ctx, tiep));
    };

    try {
      await chay(0);
    } catch (e) {
      if (e instanceof HttpLoi) {
        const body = { loi: e.ma };
        if (e.chiTiet !== undefined) body.chiTiet = e.chiTiet;
        return { status: e.status, headers: { "content-type": KIEU_JSON, ...e.headers }, body };
      }
      return { status: 500, headers: { "content-type": KIEU_JSON }, body: { loi: "loi-may-chu" } };
    }
    const ph = ctx.phanHoi;
    const body = ph.body === undefined ? null : ph.body;
    const h = { ...ph.headers };
    if (body !== null && !("content-type" in h)) h["content-type"] = KIEU_JSON;
    return { status: ph.status, headers: h, body };
  }
}
