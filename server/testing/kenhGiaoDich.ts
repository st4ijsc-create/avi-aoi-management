/**
 * Kênh tới giao dịch ROLLBACK của một ca test chạm DB (dùng ở `phatLaiFixture.test.ts`): trong ca, `getDb()` trả CHÍNH giao dịch; NGOÀI ca trả `null` (không ghi gì) VÀ GHI LẠI lời gọi
 * để `kiemKhongLot` làm ca ĐỎ có tên — một lời gọi rơi ra ngoài giao dịch (việc nền chạy muộn, đường ghi quên đi qua `getDb`) không được lặng lẽ bỏ qua.
 * THUẦN: không import vitest / DB; trạng thái nằm trong đối tượng `KenhGiaoDich` do người gọi giữ (khởi tạo bằng `vi.hoisted` ở tệp test).
 */
export interface KenhGiaoDich {
  /** giao dịch của ca đang chạy; `null` ngoài ca */
  db: unknown;
  /** vị trí gọi (vài dòng ngăn xếp) của mỗi lời gọi `getDb()` rơi NGOÀI giao dịch */
  lot: string[];
}

/** Ném ở cuối giao dịch ⇒ ROLLBACK. Tên chứa "rollback" để census `nguoiDungTest` nhận ra giao dịch luôn hoàn tác. */
export class RollbackPhatLai extends Error {}

/**
 * Dùng trong `catch (e)` NGOÀI giao dịch của ca: CHỈ nuốt `RollbackPhatLai` (đích của ROLLBACK); MỌI lỗi khác (expect hỏng, lỗi của ca, lỗi giao dịch) PHẢI ném lại.
 * ★ Nếu nuốt mọi lỗi thì phát lại XANH GIẢ trên mọi lệch (đột biến `void e` của kiem-dinh).
 */
export function nuotRollback(e: unknown): void {
  if (!(e instanceof RollbackPhatLai)) throw e;
}

/** Vài dòng ngăn xếp NGOÀI tệp này, để người đọc thấy ai gọi. */
function viTriGoi(): string {
  const dong = (new Error().stack ?? "").split("\n").slice(1).map((d) => d.trim());
  const ngoai = dong.filter((d) => !/kenhGiaoDich\.ts/.test(d) && !/node:internal/.test(d));
  return ngoai.slice(0, 3).join(" ← ") || "(không rõ nơi gọi)";
}

/** Thay cho `getDb()`: trong giao dịch ⇒ giao dịch; ngoài ⇒ `null` + ghi lại. */
export function layDbTheoKenh(kenh: KenhGiaoDich): unknown {
  if (kenh.db !== null && kenh.db !== undefined) return kenh.db;
  kenh.lot.push(viTriGoi());
  return null;
}

/**
 * Thay cho các hàm lấy kết nối KHÁC `getDb` (`getJobsDb`, `getReadDb`, `openSessionClient`, `getNotifyClient`): GHI LẠI lời gọi (kể cả trong giao dịch — kết nối khác không nằm trong giao dịch của ca)
 * và trả `null` (không rơi vào kết nối thật). `kiemKhongLot` làm ca ĐỎ nêu TÊN hàm.
 */
export function ghiNoiKhac(kenh: KenhGiaoDich, ten: string): null {
  kenh.lot.push(`${ten}: ${viTriGoi()}`);
  return null;
}

/** Ném (làm ca ĐỎ) nếu từ lần kiểm trước có lời gọi `getDb()` rơi ngoài giao dịch; xoá sổ để lần sau đo lại từ đầu. */
export function kiemKhongLot(kenh: KenhGiaoDich): void {
  if (kenh.lot.length === 0) return;
  const ds = kenh.lot.splice(0, kenh.lot.length);
  throw new Error(`getDb() bị gọi NGOÀI giao dịch ROLLBACK ${ds.length} lần (đã trả null, không ghi gì) — một đường ghi / việc nền chưa nằm trong giao dịch. Nơi gọi đầu tiên: ${ds[0]}`);
}
