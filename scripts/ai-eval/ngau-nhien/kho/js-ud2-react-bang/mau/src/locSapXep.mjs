/** Logic thuần cho bảng sản phẩm — không phụ thuộc React. */

export function chuanHoa(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d");
}

export function dinhDangTien(so) {
  if (!Number.isSafeInteger(so)) throw new TypeError("số tiền phải là số nguyên an toàn");
  const am = so < 0;
  const chu = String(Math.abs(so));
  let nhom = "";
  for (let i = chu.length; i > 0; i -= 3) nhom = chu.slice(Math.max(0, i - 3), i) + (nhom ? "." + nhom : "");
  return `${am ? "-" : ""}${nhom} ₫`;
}

const KHOA = {
  ten: (sp) => chuanHoa(sp.ten),
  gia: (sp) => sp.gia,
  ton: (sp) => sp.ton,
};

export function locSapXep(ds, { tuKhoa = "", sapXep = "ten", tang = true } = {}) {
  if (!Object.hasOwn(KHOA, sapXep)) throw new RangeError(`sapXep lạ: ${sapXep}`);
  const k = chuanHoa(tuKhoa.trim());
  const loc = k === "" ? [...ds] : ds.filter((sp) => chuanHoa(sp.ten).includes(k) || chuanHoa(sp.ma).includes(k));
  const khoa = KHOA[sapXep];
  const huong = tang ? 1 : -1;
  return loc.sort((a, b) => {
    const x = khoa(a);
    const y = khoa(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return huong * c || (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0);
  });
}

export function tongGiaTri(ds) {
  return ds.reduce((s, sp) => s + sp.gia * sp.ton, 0);
}
