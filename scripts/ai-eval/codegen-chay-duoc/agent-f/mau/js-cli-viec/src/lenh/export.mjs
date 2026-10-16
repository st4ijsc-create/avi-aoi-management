import fs from "node:fs";
import { docKho } from "../kho.mjs";
import { bangCsv } from "../csv.mjs";

export function lenhExport({ co }, io) {
  if (!co.csv) {
    io.loi("Thiếu định dạng xuất: dùng --csv\n");
    return 2;
  }
  const ds = docKho(io.duongKho).filter((v) => !co["chua-xong"] || !v.xong);
  const csv = bangCsv([
    ["id", "tieuDe", "xong", "han"],
    ...ds.map((v) => [String(v.id), v.tieuDe, v.xong ? "1" : "0", v.han ?? ""]),
  ]);
  if (co.out) {
    fs.writeFileSync(co.out, csv, "utf8");
    io.ghi(`Đã xuất ${ds.length} việc ra ${co.out}\n`);
  } else {
    io.ghi(csv);
  }
  return 0;
}
