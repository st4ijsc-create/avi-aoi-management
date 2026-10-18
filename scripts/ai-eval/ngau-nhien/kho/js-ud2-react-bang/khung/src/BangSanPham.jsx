import { dinhDangTien, locSapXep, tongGiaTri } from "./locSapXep.mjs";

// BẢN DỞ DANG: chưa lọc/sắp xếp, chưa định dạng tiền, chưa caption, chưa thead/aria-sort,
// chưa đánh dấu hết hàng, chưa tfoot, chưa xử lý danh sách rỗng.
export function BangSanPham({ sanPham }) {
  return (
    <table className="bang-sp">
      <tbody>
        {sanPham.map((sp) => (
          <tr key={sp.ma}>
            <td>{sp.ma}</td>
            <td>{sp.ten}</td>
            <td>{sp.gia}</td>
            <td>{sp.ton}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
