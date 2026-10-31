/**
 * ★★★ 2026-08-17 — BẢNG ANDON "HÔM NAY" PHẢI ĐÓNG CẢ HAI ĐẦU.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `getAndonBoardData` dựng cửa sổ ngày bằng ĐÚNG MỘT điều kiện:
 *     const conds: SQL[] = [gte(productInspections.inspectionTime, dayStart)];
 * Chỉ chặn DƯỚI. Một bản ghi mang `inspectionTime` ở TƯƠNG LAI — đồng hồ máy lệch (schema
 * `inspection.ts` ghi rõ: "`inspectionTime` is whatever the MACHINE said"), nhập tay sai, hay dữ
 * liệu test — thoả `>= dayStart` của **mọi ngày kể từ đó**. Nó được cộng vào sản lượng, vào FPY
 * và vào UPH của bảng Andon **vĩnh viễn**, đẩy các con số theo hướng LẠC QUAN mà bảng không có
 * dấu hiệu nào để người vận hành nghi ngờ.
 *
 * ⚠ Chính lỗ này đã cắn lưới `accessControlScope.test.ts`: bản đầu của nó dựng dữ liệu ở cửa sổ
 * TƯƠNG LAI và ô máy đếm 8 thay vì 3 (ghi lại trong docblock của file ấy).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Sáu bản ghi trên MỘT máy riêng của file này, đặt quanh hai biên, để mọi cách viết sai đều đỏ:
 *
 *   ┌ hôm qua −1ms ┐            ┌ now−30′ ┐  ┌ now+2′ ┐        ┌ 23:59:59.999 ┐┌ 00:00 mai ┐┌ mai 12:00 ┐
 *   │   KHÔNG đếm  │            │  đếm    │  │  đếm   │        │     đếm      ││ KHÔNG đếm ││ KHÔNG đếm │
 *   └──────────────┘ dayStart → └─────────┘  └────────┘        └──────────────┘  ← dayEnd
 *
 *  • bỏ chặn trên             ⇒ đếm 5 thay vì 3  ⇒ ĐỎ
 *  • dùng `lte(dayEnd)`       ⇒ đếm 4 (nuốt 00:00 ngày mai) ⇒ ĐỎ  (chống lệch MỘT ĐƠN VỊ)
 *  • chặn nhầm 23:59:59.999   ⇒ đếm 2 ⇒ ĐỎ  (chống vá quá tay)
 *  • bỏ chặn dưới             ⇒ đếm 4 (nuốt hôm qua) ⇒ ĐỎ
 *
 * Và cửa sổ CUỘN 60 phút (`uphLastHour`) mắc CÙNG một lớp lỗi, độc lập với biên ngày: bản ghi
 * `now+2′` vẫn nằm trong ngày hôm nay nên biên ngày không cứu được — cửa sổ cuộn phải tự đóng ở
 * `now`. Bỏ `lte(now)` ⇒ UPH = 2 thay vì 1 ⇒ ĐỎ.
 *
 * ⚠ MÚI GIỜ: `dayStart`/`dayEnd` là nửa đêm theo giờ NHÀ MÁY (`FACTORY_TZ`, mặc định
 * `Asia/Ho_Chi_Minh`), quy về mốc UTC thật. `postgres` chạy `TimeZone=Etc/UTC` và cột
 * `inspectionTime` là `timestamp` không múi mà drizzle đọc/ghi theo UTC — hai vế so sánh cùng hệ
 * quy chiếu. Bản vá KHÔNG đổi ngữ nghĩa "hôm nay" của người dùng, chỉ thêm biên trên: lưới dưới
 * đây tự lấy biên từ `startOfDayInZone`/`startOfNextDayInZone` nên nó đo ĐÚNG cái ngày mà nhà
 * máy nhìn thấy, không phải ngày của máy chủ.
 *
 * Bảng được truy vấn có `factoryId` để mọi phép đếm (kể cả `uphLastHour`, vốn không lọc máy khi
 * không truyền phạm vi) chỉ nhìn nhà máy riêng của file này.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as db from "../db";
import { getAndonBoardData, startOfNextDayInZone } from "./andonBoard";
import { getFactoryTimezone, startOfDayInZone } from "../utils/factoryTime";

const ts = Date.now();
const TZ = getFactoryTimezone();

// ★ ĐỒNG HỒ CỐ ĐỊNH. Bản cũ dựng fixture theo `new Date()` thật (now−30′, now+2′) nên đỏ oan khi chạy 00:00–00:30
// hoặc 23:58–24:00 giờ nhà máy (now−30′ rơi sang hôm qua, now+2′ sang ngày mai). Sản phẩm gọi `new Date()` ở
// `getAndonBoardData` ⇒ chỉ giả `Date` (timer/IO của driver pg giữ nguyên) và đặt giờ giữa ngày cho các ca chính.
const NGAY_MAU = new Date("2026-10-15T05:00:00Z"); // một ngày bất kỳ, chỉ để lấy nửa đêm theo giờ nhà máy
const dayStart = startOfDayInZone(NGAY_MAU, TZ);
const dayEnd = startOfNextDayInZone(NGAY_MAU, TZ);
const now = new Date(dayStart.getTime() + 12 * 3_600_000); // 12:00 giờ nhà máy
const PHUT = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Sáu mốc quanh hai biên. */
const AT = {
  yesterdayEdge: new Date(dayStart.getTime() - 1), // 23:59:59.999 HÔM QUA → ngoài
  past: new Date(now.getTime() - 30 * PHUT), // trong ngày + trong 60′ → trong
  nearFuture: new Date(now.getTime() + 2 * PHUT), // trong ngày, SAU `now` → trong ngày, NGOÀI 60′
  todayEdge: new Date(dayEnd.getTime() - 1), // 23:59:59.999 HÔM NAY → trong
  atBoundary: new Date(dayEnd.getTime()), // 00:00:00 NGÀY MAI → ngoài (biên LOẠI TRỪ)
  farFuture: new Date(dayEnd.getTime() + 12 * 3_600_000), // trưa mai → ngoài
};

/** Nhà máy + máy RIÊNG cho mỗi kịch bản (mọi phép đếm kể cả UPH chỉ nhìn nhà máy này) và bản ghi ở các mốc cho trước. */
async function dungMay(ky: string, mocs: Record<string, Date>): Promise<{ factoryId: number; machineId: number }> {
  const factoryId = await db.createFactory({ code: `ADW_F${ky}_${ts}`, name: `Andon day-window fac ${ky}` });
  const workshopId = await db.createWorkshop({ factoryId, code: `ADW_W${ky}_${ts}`, name: "Andon day-window ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `ADW_L${ky}_${ts}`, name: "Andon day-window line" });
  const stationId = await db.createStation({ lineId, code: `ADW_S${ky}_${ts}`, name: "Andon day-window st", orderIndex: 1 });
  const machineId = await db.createMachine({
    stationId,
    code: `ADW_M${ky}_${ts}`,
    name: "Andon day-window machine",
    machineType: "AOI",
    apiKey: `adw${ky}_${ts}`,
  });
  for (const [tag, at] of Object.entries(mocs)) {
    await db.createProductInspection({
      machineId,
      serialNumber: `SN_ADW${ky}_${tag}_${ts}`,
      overallResult: "OK",
      originalResult: "OK",
      inspectionTime: at,
    });
  }
  return { factoryId, machineId };
}

let factoryId: number;
let machineId: number;

beforeAll(async () => {
  ({ factoryId, machineId } = await dungMay("A", AT));
});

describe("★★★ getAndonBoardData — cửa sổ 'hôm nay' phải có BIÊN TRÊN", () => {
  /** Ô của máy DUY NHẤT thuộc file này; bảng đã được thu về nhà máy riêng. */
  async function board() {
    const b = await getAndonBoardData({ factoryId });
    const tile = b.lines.flatMap((l) => l.machines).find((m) => m.machineId === machineId);
    return { b, tile };
  }

  it("TIỀN ĐỀ: cửa sổ được tính theo giờ NHÀ MÁY, hai biên cách nhau đúng một ngày lịch", async () => {
    const { b } = await board();

    expect(b.timezone).toBe(TZ);
    expect(b.dayStart).toBe(dayStart.toISOString());
    expect(b.dayEnd).toBe(dayEnd.toISOString());
    // Không neo "24 giờ" (sai vào ngày chuyển DST của múi có DST) — neo vào "đúng một ngày lịch".
    expect(new Date(b.dayEnd).getTime()).toBeGreaterThan(new Date(b.dayStart).getTime());
    // …nhưng với `Asia/Ho_Chi_Minh` (không DST) thì đúng bằng 24 giờ; nếu ai đổi mặc định sang
    // một múi có DST, ca này vẫn đúng vì chỉ chặn ở "trong khoảng 23–25 giờ".
    const hours = (new Date(b.dayEnd).getTime() - new Date(b.dayStart).getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(23);
    expect(hours).toBeLessThanOrEqual(25);
  });

  it("★★ bản ghi ở TƯƠNG LAI (00:00 ngày mai và trưa mai) KHÔNG được đếm vào hôm nay", async () => {
    const { tile } = await board();

    // 3 = past + nearFuture + todayEdge. Bỏ chặn trên ⇒ 5 ⇒ ĐỎ.
    expect(tile).toBeDefined();
    expect(tile!.total).toBe(3);
  });

  it("★★ CHỐNG LỆCH MỘT ĐƠN VỊ: 23:59:59.999 hôm nay VẪN đếm, 00:00:00 ngày mai thì KHÔNG", async () => {
    const { tile } = await board();

    // Biên trên phải LOẠI TRỪ (`lt`), không phải `lte`:
    //   • viết `lte(dayEnd)`  ⇒ nuốt `atBoundary` ⇒ 4 ⇒ ĐỎ,
    //   • chặn nhầm `todayEdge` (ví dụ `lt(now)`) ⇒ 2 ⇒ ĐỎ.
    expect(tile!.total).toBe(3);
  });

  it("★ CHIỀU DƯƠNG: biên DƯỚI vẫn đúng — 23:59:59.999 HÔM QUA không lọt vào hôm nay", async () => {
    const { tile } = await board();

    // Bỏ/nới chặn dưới ⇒ nuốt `yesterdayEdge` ⇒ 4 ⇒ ĐỎ.
    expect(tile!.total).toBe(3);
  });

  it("★★ CỬA SỔ CUỘN 60 PHÚT mắc CÙNG lớp lỗi: bản ghi ở tương lai gần không được vào UPH", async () => {
    const { b } = await board();

    // Chỉ `past` (now−30′) hợp lệ. `nearFuture` (now+2′) nằm TRONG ngày nên biên ngày không
    // loại được nó — chỉ `lte(now)` mới loại. Bỏ `lte(now)` ⇒ 2 ⇒ ĐỎ.
    // `todayEdge` bị loại bởi `gte(now−60′)` (và cả `lte(now)` nếu chạy sát nửa đêm).
    expect(b.kpis.uphLastHour).toBe(1);
  });

  it("★ TỔNG của dải KPI = tổng các ô (một nguồn sự thật), cùng cửa sổ đã đóng hai đầu", async () => {
    const { b } = await board();

    expect(b.kpis.total).toBe(3);
    expect(b.kpis.ok).toBe(3);
  });
});

/**
 * ★ HAI BIÊN NỬA ĐÊM — chính hai khung giờ làm bản cũ đỏ oan (00:05 và 23:59 giờ nhà máy) nay được GHIM làm ca có chủ đích,
 * để một bản vá sai ở biên ngày không còn trốn được vào khe "chỉ lệch khi chạy lúc nửa đêm".
 */
describe("★★ getAndonBoardData — đồng hồ sát nửa đêm (00:05 và 23:59 giờ nhà máy)", () => {
  const luc0005 = new Date(dayStart.getTime() + 5 * PHUT);
  const luc2359 = new Date(dayEnd.getTime() - 1 * PHUT);
  let sau: { factoryId: number; machineId: number };
  let truoc: { factoryId: number; machineId: number };

  beforeAll(async () => {
    // 00:05: now−30′ đã là HÔM QUA (ngoài); dayStart đúng (gte) và now+2′ nằm trong
    sau = await dungMay("B", {
      yesterdayEdge: new Date(dayStart.getTime() - 1),
      past: new Date(luc0005.getTime() - 30 * PHUT),
      atDayStart: new Date(dayStart.getTime()),
      nearFuture: new Date(luc0005.getTime() + 2 * PHUT),
    });
    // 23:59: now+2′ đã là NGÀY MAI (ngoài); now−30′ và 23:59:59.999 hôm nay trong
    truoc = await dungMay("C", {
      past: new Date(luc2359.getTime() - 30 * PHUT),
      todayEdge: new Date(dayEnd.getTime() - 1),
      nearFuture: new Date(luc2359.getTime() + 2 * PHUT),
      atBoundary: new Date(dayEnd.getTime()),
    });
  });

  async function dem(m: { factoryId: number; machineId: number }) {
    const b = await getAndonBoardData({ factoryId: m.factoryId });
    return { b, tile: b.lines.flatMap((l) => l.machines).find((x) => x.machineId === m.machineId) };
  }

  it("00:05: biên DƯỚI — now−30′ (hôm qua) và 23:59:59.999 hôm qua KHÔNG đếm; đúng 00:00:00 và now+2′ đếm", async () => {
    vi.setSystemTime(luc0005);
    const { b, tile } = await dem(sau);
    expect(b.dayStart).toBe(dayStart.toISOString());
    expect(tile!.total).toBe(2); // atDayStart + nearFuture
    expect(b.kpis.uphLastHour).toBe(1); // atDayStart (nearFuture sau now bị loại)
  });

  it("23:59: biên TRÊN — now+2′ (đã sang ngày mai) và đúng 00:00:00 mai KHÔNG đếm; 23:59:59.999 nay đếm", async () => {
    vi.setSystemTime(luc2359);
    const { b, tile } = await dem(truoc);
    expect(b.dayEnd).toBe(dayEnd.toISOString());
    expect(tile!.total).toBe(2); // past + todayEdge
    expect(b.kpis.uphLastHour).toBe(1); // past (todayEdge sau now bị loại)
  });
});
