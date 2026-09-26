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
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "../db";
import { getAndonBoardData, startOfNextDayInZone } from "./andonBoard";
import { getFactoryTimezone, startOfDayInZone } from "../utils/factoryTime";

const ts = Date.now();
const TZ = getFactoryTimezone();
const now = new Date();
const dayStart = startOfDayInZone(now, TZ);
const dayEnd = startOfNextDayInZone(now, TZ);

/** Sáu mốc quanh hai biên. */
const AT = {
  yesterdayEdge: new Date(dayStart.getTime() - 1), // 23:59:59.999 HÔM QUA → ngoài
  past: new Date(now.getTime() - 30 * 60 * 1000), // trong ngày + trong 60′ → trong
  nearFuture: new Date(now.getTime() + 2 * 60 * 1000), // trong ngày, SAU `now` → trong ngày, NGOÀI 60′
  todayEdge: new Date(dayEnd.getTime() - 1), // 23:59:59.999 HÔM NAY → trong
  atBoundary: new Date(dayEnd.getTime()), // 00:00:00 NGÀY MAI → ngoài (biên LOẠI TRỪ)
  farFuture: new Date(dayEnd.getTime() + 12 * 60 * 60 * 1000), // trưa mai → ngoài
};

let factoryId: number;
let machineId: number;

beforeAll(async () => {
  factoryId = await db.createFactory({ code: `ADW_F_${ts}`, name: "Andon day-window fac" });
  const workshopId = await db.createWorkshop({ factoryId, code: `ADW_W_${ts}`, name: "Andon day-window ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `ADW_L_${ts}`, name: "Andon day-window line" });
  const stationId = await db.createStation({ lineId, code: `ADW_S_${ts}`, name: "Andon day-window st", orderIndex: 1 });
  machineId = await db.createMachine({
    stationId,
    code: `ADW_M_${ts}`,
    name: "Andon day-window machine",
    machineType: "AOI",
    apiKey: `adw_${ts}`,
  });

  for (const [tag, at] of Object.entries(AT)) {
    await db.createProductInspection({
      machineId,
      serialNumber: `SN_ADW_${tag}_${ts}`,
      overallResult: "OK",
      originalResult: "OK",
      inspectionTime: at,
    });
  }
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
