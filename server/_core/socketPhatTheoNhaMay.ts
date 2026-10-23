/**
 * ★★★ P-S1b (2026-10-23, dieu-phoi duyệt) — PHÁT SỰ KIỆN MÁY THEO PHÒNG NHÀ MÁY, KHÔNG PHÁT VÀO `global`.
 *
 * Lỗ (đã đo — `socketPhamViPhong.db.test.ts`): phần lớn sự kiện máy (andon · safety · inspection · oee · dashboard · downtime · mqtt ·
 * spc · maintenance · alert:escalation · machine:status_*) được phát `io.to("global").emit(...)` / `io.emit(...)`, mà MỌI client trình
 * duyệt đều ở trong `global` (kể cả `subscribe {}`) ⇒ người dùng nhà máy B nhận sự kiện của máy nhà máy A. Vá cổng vào phòng
 * (`subscribe`) KHÔNG đủ: lỗ nằm ở tầng PHÁT.
 *
 * Mô hình (cùng tinh thần cách `twin:` đã làm, nhưng rẻ hơn lọc từng socket):
 *   • mỗi socket NGƯỜI DÙNG, ngay khi kết nối (và mỗi lần `subscribe` nếu chưa xong), TỰ vào phòng theo PHẠM VI của họ:
 *       – phạm vi TOÀN QUYỀN (admin / vai không bị thu hẹp) ⇒ `scope:all`;
 *       – còn lại ⇒ `factory:{id}` cho MỌI nhà máy trong phạm vi (cùng `idsTrongPhamVi` mọi router dùng; không gán nhà máy ⇒ không vào phòng nào);
 *   • điểm phát gọi `phatTheoNhaMay(io, tên, payload, phạmViSựKiện, phòngPhụ)`: tra NHÀ MÁY của sự kiện (factoryId → machineId →
 *     machineCode → stationId → lineId → workshopId; có cache), rồi phát vào `scope:all` + `factory:{fid}` + các phòng phụ (machine:/line: — chỉ
 *     socket đã qua cổng phạm vi mới ở trong đó). MỘT lần `emit` trên hợp phòng ⇒ socket ở nhiều phòng chỉ nhận MỘT bản.
 *   • sự kiện TRA KHÔNG RA nhà máy ⇒ KHÔNG phát vào `global`: chỉ `scope:all` (người toàn quyền) + phòng phụ, ghi cảnh báo (gộp, 1 dòng/60 s/sự
 *     kiện) và ĐẾM (`thongKePhat()`). "Không biết nó của ai" rơi về phía CHẶN.
 *
 * `global` vẫn được join (twin trạng thái dùng nó để liệt kê socket) nhưng KHÔNG còn mang dữ liệu máy. Census `socketPhatCensus.test.ts` canh: mọi
 * `io.to("global")` / `io.emit` / `socket.broadcast` trong `server/` phải có miễn kèm lý do.
 */
import type { Server } from "socket.io";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

/** Phòng của người có PHẠM VI TOÀN QUYỀN — nhận mọi sự kiện máy. */
export const PHONG_TOAN_QUYEN = "scope:all";

export interface PhamViSuKien {
  factoryId?: number | null;
  workshopId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
  machineCode?: string | null;
  /** Robot: nhà máy suy qua CHUYỀN hoặc TRẠM của nó (cùng luật `robotInCallerScope`); robot mồ côi ⇒ không tra ra. */
  robotId?: number | null;
}

const TTL_THAY_MS = 5 * 60_000;
const TTL_KHONG_THAY_MS = 10_000; // máy/chuyền mới tạo phải được tra ra sớm
const CACHE_TOI_DA = 5000;
const cache = new Map<string, { fid: number | null; het: number }>();
const khongTraRa = new Map<string, number>();
const lanCanhBaoCuoi = new Map<string, number>();

/** Chỉ lưới: xoá cache tra nhà máy + bộ đếm. */
export function __datLaiPhatTheoNhaMay(): void {
  cache.clear();
  khongTraRa.clear();
  lanCanhBaoCuoi.clear();
}

/** Số lần sự kiện KHÔNG tra ra nhà máy (theo tên sự kiện) kể từ lúc khởi động. */
export function thongKePhat(): { tong: number; theoSuKien: Record<string, number> } {
  let tong = 0;
  const theoSuKien: Record<string, number> = {};
  for (const [k, v] of khongTraRa) {
    tong += v;
    theoSuKien[k] = v;
  }
  return { tong, theoSuKien };
}

const so = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

async function traCoCache(khoa: string, truyVan: () => Promise<number | null>): Promise<number | null> {
  const bay = Date.now();
  const co = cache.get(khoa);
  if (co && co.het > bay) return co.fid;
  const fid = await truyVan();
  if (cache.size >= CACHE_TOI_DA) cache.clear();
  cache.set(khoa, { fid, het: bay + (fid === null ? TTL_KHONG_THAY_MS : TTL_THAY_MS) });
  return fid;
}

async function chay(q: ReturnType<typeof sql>): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const r = (await db.execute(q)) as unknown as { fid: number | null }[];
  const v = r[0]?.fid;
  return v == null ? null : Number(v);
}

/** Nhà máy của sự kiện — thứ tự ưu tiên: factoryId · machineId · machineCode · stationId · lineId · workshopId. `null` = không tra ra. */
export async function nhaMayCuaSuKien(pv: PhamViSuKien): Promise<number | null> {
  const fid = so(pv.factoryId);
  if (fid !== null) return fid;
  const mid = so(pv.machineId);
  if (mid !== null) {
    const r = await traCoCache(`m:${mid}`, () =>
      chay(sql`SELECT w."factoryId" AS fid FROM machines m JOIN stations s ON s."id" = m."stationId" JOIN production_lines l ON l."id" = s."lineId" JOIN workshops w ON w."id" = l."workshopId" WHERE m."id" = ${mid}`),
    );
    if (r !== null) return r;
  }
  if (typeof pv.machineCode === "string" && pv.machineCode.length > 0 && pv.machineCode.length <= 128) {
    const code = pv.machineCode;
    const r = await traCoCache(`mc:${code}`, () =>
      chay(sql`SELECT w."factoryId" AS fid FROM machines m JOIN stations s ON s."id" = m."stationId" JOIN production_lines l ON l."id" = s."lineId" JOIN workshops w ON w."id" = l."workshopId" WHERE m."code" = ${code} LIMIT 1`),
    );
    if (r !== null) return r;
  }
  const rid = so(pv.robotId);
  if (rid !== null) {
    const r = await traCoCache(`r:${rid}`, () =>
      chay(sql`SELECT COALESCE(w1."factoryId", w2."factoryId") AS fid FROM robots r
        LEFT JOIN production_lines l1 ON l1."id" = r."lineId" LEFT JOIN workshops w1 ON w1."id" = l1."workshopId"
        LEFT JOIN stations s ON s."id" = r."stationId" LEFT JOIN production_lines l2 ON l2."id" = s."lineId" LEFT JOIN workshops w2 ON w2."id" = l2."workshopId"
        WHERE r."id" = ${rid}`),
    );
    if (r !== null) return r;
  }
  const sid = so(pv.stationId);
  if (sid !== null) {
    const r = await traCoCache(`s:${sid}`, () =>
      chay(sql`SELECT w."factoryId" AS fid FROM stations s JOIN production_lines l ON l."id" = s."lineId" JOIN workshops w ON w."id" = l."workshopId" WHERE s."id" = ${sid}`),
    );
    if (r !== null) return r;
  }
  const lid = so(pv.lineId);
  if (lid !== null) {
    const r = await traCoCache(`l:${lid}`, () => chay(sql`SELECT w."factoryId" AS fid FROM production_lines l JOIN workshops w ON w."id" = l."workshopId" WHERE l."id" = ${lid}`));
    if (r !== null) return r;
  }
  const wid = so(pv.workshopId);
  if (wid !== null) {
    const r = await traCoCache(`w:${wid}`, () => chay(sql`SELECT w."factoryId" AS fid FROM workshops w WHERE w."id" = ${wid}`));
    if (r !== null) return r;
  }
  return null;
}

function ghiKhongTraRa(ten: string): void {
  khongTraRa.set(ten, (khongTraRa.get(ten) ?? 0) + 1);
  const bay = Date.now();
  if (bay - (lanCanhBaoCuoi.get(ten) ?? 0) >= 60_000) {
    lanCanhBaoCuoi.set(ten, bay);
    console.warn(`[Socket.io] sự kiện ${ten} KHÔNG tra ra nhà máy — KHÔNG phát vào global; chỉ phòng toàn quyền (đã đếm ${khongTraRa.get(ten)} lần)`);
  }
}

/** MỘT chỗ duy nhất gọi `io.to(...).emit` của tệp này (đột biến "phát vào global" nhắm vào đây). `tru`: phòng đã nhận bản đồng bộ — không gửi lần hai. */
function phatVaoPhong(io: Server, phong: string[], ten: string, payload: unknown, tru: string[] = []): void {
  let b = io.to(phong);
  if (tru.length > 0) b = b.except(tru);
  b.emit(ten, payload);
}

/**
 * Phát `ten` tới: phòng toàn quyền + `phongPhu` NGAY (đồng bộ, không cần tra) rồi phòng NHÀ MÁY của sự kiện sau khi tra (bất đồng bộ; loại trừ các phòng
 * đã nhận để socket ở nhiều phòng chỉ nhận MỘT bản). Không bao giờ ném. Không tra ra nhà máy ⇒ KHÔNG `global`: chỉ toàn quyền + `phongPhu`, đếm + cảnh báo.
 */
export function phatTheoNhaMay(io: Server | null | undefined, ten: string, payload: unknown, pv: PhamViSuKien, phongPhu: string[] = []): void {
  if (!io) return;
  const dau = [PHONG_TOAN_QUYEN, ...phongPhu];
  try {
    phatVaoPhong(io, dau, ten, payload);
  } catch (err) {
    console.error(`[Socket.io] phát ${ten} lỗi:`, (err as Error)?.message ?? err);
  }
  void (async () => {
    let fid: number | null = null;
    try {
      fid = await nhaMayCuaSuKien(pv);
    } catch (err) {
      console.error(`[Socket.io] tra nhà máy của ${ten} lỗi:`, (err as Error)?.message ?? err);
    }
    if (fid === null) {
      ghiKhongTraRa(ten);
      return;
    }
    try {
      phatVaoPhong(io, [`factory:${fid}`], ten, payload, dau);
    } catch (err) {
      console.error(`[Socket.io] phát ${ten} lỗi:`, (err as Error)?.message ?? err);
    }
  })();
}

/**
 * Phát một MẢNG (vd. OEE của mọi máy) theo nhà máy: người toàn quyền nhận ĐỦ (ngay); mỗi phòng nhà máy chỉ nhận phần của nhà máy mình. Phần tử tra không ra
 * nhà máy KHÔNG vào phòng nhà máy nào (chỉ toàn quyền), đếm + cảnh báo.
 */
export function phatMangTheoNhaMay<T>(
  io: Server | null | undefined,
  ten: string,
  items: T[],
  layPv: (t: T) => PhamViSuKien,
  boc: (sub: T[]) => unknown,
): void {
  if (!io || items.length === 0) return;
  try {
    phatVaoPhong(io, [PHONG_TOAN_QUYEN], ten, boc(items));
  } catch (err) {
    console.error(`[Socket.io] phát ${ten} lỗi:`, (err as Error)?.message ?? err);
  }
  void (async () => {
    const theoNhaMay = new Map<number, T[]>();
    let khongRa = 0;
    for (const it of items) {
      let fid: number | null = null;
      try {
        fid = await nhaMayCuaSuKien(layPv(it));
      } catch {
        fid = null;
      }
      if (fid === null) {
        khongRa++;
        continue;
      }
      const ds = theoNhaMay.get(fid);
      if (ds) ds.push(it);
      else theoNhaMay.set(fid, [it]);
    }
    if (khongRa > 0) ghiKhongTraRa(ten);
    try {
      for (const [fid, sub] of theoNhaMay) phatVaoPhong(io, [`factory:${fid}`], ten, boc(sub), [PHONG_TOAN_QUYEN]);
    } catch (err) {
      console.error(`[Socket.io] phát ${ten} lỗi:`, (err as Error)?.message ?? err);
    }
  })();
}
