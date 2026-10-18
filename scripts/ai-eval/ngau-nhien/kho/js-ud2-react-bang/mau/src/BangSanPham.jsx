import { dinhDangTien, locSapXep, tongGiaTri } from "./locSapXep.mjs";

const COT = [
  { khoa: null, nhan: "Mã" },
  { khoa: "ten", nhan: "Tên" },
  { khoa: "gia", nhan: "Giá" },
  { khoa: "ton", nhan: "Tồn" },
];

export function BangSanPham({ sanPham, tuKhoa = "", sapXep = "ten", tang = true }) {
  const ds = locSapXep(sanPham, { tuKhoa, sapXep, tang });
  if (ds.length === 0) return <p className="trong">Không có sản phẩm phù hợp</p>;
  const tongTon = ds.reduce((s, sp) => s + sp.ton, 0);
  return (
    <table className="bang-sp">
      <caption>{ds.length} sản phẩm</caption>
      <thead>
        <tr>
          {COT.map((c) => (
            <th key={c.nhan} aria-sort={c.khoa === sapXep ? (tang ? "ascending" : "descending") : undefined}>
              {c.nhan}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ds.map((sp) => (
          <tr key={sp.ma} data-ma={sp.ma} className={sp.ton === 0 ? "het-hang" : undefined}>
            <td>{sp.ma}</td>
            <td>{sp.ten}</td>
            <td className="so">{dinhDangTien(sp.gia)}</td>
            <td className="so">{sp.ton}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Tổng</td>
          <td></td>
          <td className="so">{dinhDangTien(tongGiaTri(ds))}</td>
          <td className="so">{tongTon}</td>
        </tr>
      </tfoot>
    </table>
  );
}
