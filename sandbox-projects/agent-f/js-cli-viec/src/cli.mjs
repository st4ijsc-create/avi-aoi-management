import { tachThamSo } from "./thamSo.mjs";
import { TRO_GIUP } from "./troGiup.mjs";
import { lenhAdd } from "./lenh/add.mjs";
import { lenhList } from "./lenh/list.mjs";
import { lenhDone } from "./lenh/done.mjs";

/** Bảng lệnh con: tên ⇒ { chay, coBoolean }. */
const LENH = {
  add: { chay: lenhAdd, coBoolean: [] },
  list: { chay: lenhList, coBoolean: ["tat-ca"] },
  done: { chay: lenhDone, coBoolean: [] },
  help: {
    chay: (_ts, io) => {
      io.ghi(TRO_GIUP + "\n");
      return 0;
    },
    coBoolean: [],
  },
};

/**
 * Chạy CLI. `io` = { ghi(s), loi(s), duongKho }. Trả MÃ THOÁT (0 = thành công).
 */
export async function chay(argv, io) {
  const [ten = "help", ...conLai] = argv;
  const lenh = LENH[ten];
  if (!lenh) {
    io.loi(`Lệnh không hợp lệ: ${ten}\n${TRO_GIUP}\n`);
    return 1;
  }
  let thamSo;
  try {
    thamSo = tachThamSo(conLai, lenh.coBoolean);
  } catch (e) {
    io.loi(`${e.message}\n`);
    return 1;
  }
  return await lenh.chay(thamSo, io);
}
