import { docKho } from "../kho.mjs";

export function lenhList({ co }, io) {
  const ds = docKho(io.duongKho).filter((v) => co["tat-ca"] || !v.xong);
  if (ds.length === 0) {
    io.ghi("Không có việc nào\n");
    return 0;
  }
  for (const v of ds) {
    io.ghi(`${v.xong ? "[x]" : "[ ]"} #${v.id} ${v.tieuDe}${v.han ? ` (hạn ${v.han})` : ""}\n`);
  }
  return 0;
}
