import { HttpLoi } from "./loi.mjs";

const TRUONG = ["ten", "gia", "ton"];
const SAP_XEP = { ten: ["ten", 1], "-ten": ["ten", -1], gia: ["gia", 1], "-gia": ["gia", -1] };
const laSoDuong = (s) => /^[1-9][0-9]*$/.test(s);

function kiemDuLieu(than) {
  if (than === null || typeof than !== "object" || Array.isArray(than)) return { chiTiet: ["than"] };
  const chiTiet = [];
  const ten = typeof than.ten === "string" ? than.ten.trim() : null;
  if (ten === null || ten.length < 1 || ten.length > 100) chiTiet.push("ten");
  if (!Number.isInteger(than.gia) || than.gia < 0) chiTiet.push("gia");
  if (than.ton !== undefined && (!Number.isInteger(than.ton) || than.ton < 0)) chiTiet.push("ton");
  for (const k of Object.keys(than)) if (!TRUONG.includes(k)) chiTiet.push(k);
  if (chiTiet.length) return { chiTiet };
  return { sp: { ten, gia: than.gia, ton: than.ton ?? 0 } };
}

export function dangKySanPham(router) {
  const kho = new Map();
  let idKe = 1;

  const hopLe = (than) => {
    const k = kiemDuLieu(than);
    if (k.chiTiet) throw new HttpLoi(422, "du-lieu-khong-hop-le", k.chiTiet);
    return k.sp;
  };
  const kiemTrung = (ten, boQuaId) => {
    const t = ten.toLowerCase();
    for (const sp of kho.values()) if (sp.id !== boQuaId && sp.ten.toLowerCase() === t) throw new HttpLoi(409, "trung-ten");
  };
  const lay = (ctx) => {
    const id = ctx.params.id;
    const sp = laSoDuong(id) ? kho.get(Number(id)) : undefined;
    if (!sp) throw new HttpLoi(404, "khong-tim-thay");
    return sp;
  };

  router.them("GET", "/sp", async (ctx) => {
    const { q, sapXep, gioiHan } = ctx.query;
    if (sapXep !== undefined && !Object.hasOwn(SAP_XEP, sapXep)) throw new HttpLoi(400, "tham-so-khong-hop-le");
    if (gioiHan !== undefined && (!laSoDuong(gioiHan) || Number(gioiHan) > 100)) throw new HttpLoi(400, "tham-so-khong-hop-le");
    let ds = [...kho.values()];
    const tu = (q ?? "").trim().toLowerCase();
    if (tu) ds = ds.filter((sp) => sp.ten.toLowerCase().includes(tu));
    if (sapXep !== undefined) {
      const [truong, huong] = SAP_XEP[sapXep];
      const khoa = (sp) => (truong === "ten" ? sp.ten.toLowerCase() : sp.gia);
      ds.sort((a, b) => {
        const x = khoa(a);
        const y = khoa(b);
        return huong * (x < y ? -1 : x > y ? 1 : 0) || a.id - b.id;
      });
    }
    ctx.phanHoi.body = { tong: ds.length, ds: ds.slice(0, gioiHan === undefined ? 20 : Number(gioiHan)).map((sp) => ({ ...sp })) };
  });

  router.them("POST", "/sp", async (ctx) => {
    const du = hopLe(ctx.body);
    kiemTrung(du.ten, null);
    const sp = { id: idKe++, ...du };
    kho.set(sp.id, sp);
    ctx.phanHoi.status = 201;
    ctx.phanHoi.headers.location = `/sp/${sp.id}`;
    ctx.phanHoi.body = { ...sp };
  });

  router.them("GET", "/sp/:id", async (ctx) => {
    ctx.phanHoi.body = { ...lay(ctx) };
  });

  router.them("PUT", "/sp/:id", async (ctx) => {
    const cu = lay(ctx);
    const du = hopLe(ctx.body);
    kiemTrung(du.ten, cu.id);
    const sp = { id: cu.id, ...du };
    kho.set(sp.id, sp);
    ctx.phanHoi.body = { ...sp };
  });

  router.them("DELETE", "/sp/:id", async (ctx) => {
    const sp = lay(ctx);
    kho.delete(sp.id);
    ctx.phanHoi.status = 204;
  });
}
