// Xuất báo cáo CSV cho kế toán. Định dạng cố định (phần mềm kế toán đọc theo cột):
//   ma_don,so_dong,truoc_thue,thue,tong   — mỗi đơn một dòng, theo thứ tự vào
//   TONG_CONG,<tổng số dòng>,<...>,<...>,<...>
import { tongDon } from "./tongHop.mjs";

const TIEU_DE = "ma_don,so_dong,truoc_thue,thue,tong";

export function xuatCsv(dsDon) {
  const dong = [TIEU_DE];
  const tong = { soDong: 0, truocThue: 0, thue: 0, tong: 0 };
  for (const don of dsDon) {
    const t = tongDon(don);
    dong.push(`${don.ma},${t.soDong},${t.truocThue},${t.thue},${t.tong}`);
    for (const k of Object.keys(tong)) tong[k] += t[k];
  }
  dong.push(`TONG_CONG,${tong.soDong},${tong.truocThue},${tong.thue},${tong.tong}`);
  return `${dong.join("\n")}\n`;
}
