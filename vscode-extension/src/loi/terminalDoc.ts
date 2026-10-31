/**
 * Đợt 11.4 / mục 6 — TERMINAL CHỈ ĐỌC "Thợ Cả": logic THUẦN. Terminal chỉ HIỆN những lệnh agent đã chạy (đầu ra ĐÃ che bí mật
 * và cắt trần ở `dinhDangKetQuaLenh`) — không nhận phím, không chạy gì. Chuỗi trả về dùng CRLF (pty của VSCode cần).
 */
export const TRAN_KY_TU_MOT_LAN_GHI = 20_000;

/** Bỏ mã điều khiển nguy hiểm (ESC, CSI…) — đầu ra lệnh là dữ liệu không tin cậy, không được điều khiển terminal; giữ \n \t. */
export function lamSachChoTerminal(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

export function dinhDangLanChay(lenh: string, exitCode: number | null, output: string): string {
  let nd = lamSachChoTerminal(output).replace(/\r\n?/g, "\n");
  let cat = "";
  if (nd.length > TRAN_KY_TU_MOT_LAN_GHI) {
    nd = nd.slice(0, TRAN_KY_TU_MOT_LAN_GHI);
    cat = "\n[… đã cắt bớt đầu ra …]";
  }
  const dau = `$ ${lamSachChoTerminal(lenh).replace(/\s+/g, " ").trim()}`;
  const cuoi = `[exit ${exitCode ?? "none"}]`;
  return `${[dau, nd.replace(/\n+$/, ""), cat.replace(/^\n/, ""), cuoi].filter((x) => x !== "").join("\n").replace(/\n/g, "\r\n")}\r\n\r\n`;
}
