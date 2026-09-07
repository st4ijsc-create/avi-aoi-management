/**
 * CỔNG CSDL THẬT — ĐỢT 14 LÔ Q1: **HÀNG RÀO TENANT CỦA `digitalTwinRouter`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * Trước bản vá Q1, `digitalTwinRouter` KHÔNG lọc tenant ở bất kỳ thủ tục nào:
 * `grep -c "phamViCua|idsTrongPhamVi|trongPhamVi"` trên tệp ấy cho **0**. Năm
 * thủ tục đọc đều khai `async ({ input })` — **không bóc `ctx` một lần nào** —
 * nên danh tính không bao giờ rời tay handler, đúng hình dạng của lỗ K2 ở
 * `demVatThe`.
 *
 * Đo trên `aoi_management` (DB dev) ngày 2026-09-07, một tài khoản **0 nhà máy
 * được gán** đọc được:
 *
 *     twinState          → **43/43** máy (42 của SIM-FAC + 1 của nhà máy 18)
 *     wipFlowState       → **4.707** WIP / 12 trạm của chuyền 1
 *     stationLoadHeatmap → cells của chuyền 1
 *     predictionOverlay  → chuỗi WIP của chuyền 1
 *
 * Và ba thủ tục nhận `stationId`/`lineId`/`layoutId` do **client TỰ KHAI**, nên
 * một số nguyên đoán được là một cánh cửa sang tenant khác.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỚI NÀY TỰ DỰNG LẤY TENANT LẪN DỮ LIỆU (G22 — bài học của lô K)
 * ══════════════════════════════════════════════════════════════════════════════
 * `vitest.setup.ts` ép `DATABASE_URL` sang `aoi_management_test`, nơi seed của
 * DB dev **không tồn tại**. Một lưới mượn `maint1`/`engineer1` sẽ XANH vì một lý
 * do SAI: người dùng không tồn tại ⇒ 0 gán ⇒ phạm vi rỗng ⇒ `[]` — chiều (−)
 * xanh mà chưa hề chạm luật lọc, và xanh y hệt khi bản vá bị gỡ sạch.
 *
 * ⇒ Lưới này tạo lấy: 2 nhà máy · 2 xưởng · 2 chuyền · 2 trạm · 2 máy · WIP ·
 *   2 người dùng (một CÓ gán, một KHÔNG) — rồi xoá đúng chừng ấy, từ trong ra
 *   ngoài, không dựa vào CASCADE.
 *
 * ⚠ Ô **ĐỐI CHỨNG DANH TÍNH** bắt buộc: "0 gán" và "được gán A, hỏi B" cho CÙNG
 *   một kết quả rỗng. Không tách được hai câu ấy thì chiều (−) không chứng minh
 *   gì. Nên lưới đo CẢ HAI người, và người CÓ gán phải đọc được đúng phần mình.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU — CHIỀU DƯƠNG LÀ CHIỀU DỄ MẤT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (−) người gán nhà máy A ⇒ 0 máy / 0 WIP / 0 cells của nhà máy B
 *   (+) chính người ấy      ⇒ đọc được ĐÚNG máy và WIP của A
 *
 * Chiều (+) là đối chứng bắt buộc: `return []` vô điều kiện làm chiều (−) xanh
 * hoàn hảo mà đã giết chức năng ("vá quá tay thành chặn tất cả").
 *
 * ⚠ Vai đo là **KHÔNG-admin**. Admin BYPASS mọi cổng ⇒ đo bằng admin chứng minh
 *   SỐ 0. Lưới vẫn có một ô riêng cho admin, nhưng để đo chiều DƯƠNG của
 *   `PhamViNguoiXem` (toàn quyền ⇒ KHÔNG thêm mệnh đề nào), không để "chứng minh
 *   an toàn".
 *
 * ★ G20 — import CHÍNH `digitalTwinRouter` của module giao hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { digitalTwinRouter } from "./digitalTwinRouter";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `Q1-${Date.now()}`;

/** Vai KHÔNG phải admin. */
const VAI = "engineer";

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  facNgoaiCode: string;
  /** Người dùng ĐƯỢC gán `facTrongCode`. */
  userTrongId: number;
  /** Người dùng KHÔNG được gán nhà máy nào. */
  userKhongGanId: number;
  lineTrongId: number;
  lineNgoaiId: number;
  tramTrongId: number;
  tramNgoaiId: number;
  mayTrongId: number;
  mayNgoaiId: number;
  workshopIds: number[];
  wipIds: number[];
}
let fx: Fixture | null = null;

async function taoNhanh(code: string, ten: string) {
  const f = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  const factoryId = (f[0] as unknown as { id: number }).id;
  const w = await sql`
    INSERT INTO workshops ("factoryId", code, name)
    VALUES (${factoryId}, ${`${code}-W`}, ${`${ten} xuong`}) RETURNING id`;
  const workshopId = (w[0] as unknown as { id: number }).id;
  const l = await sql`
    INSERT INTO production_lines ("workshopId", code, name)
    VALUES (${workshopId}, ${`${code}-L`}, ${`${ten} chuyen`}) RETURNING id`;
  const lineId = (l[0] as unknown as { id: number }).id;
  const s = await sql`
    INSERT INTO stations ("lineId", code, name)
    VALUES (${lineId}, ${`${code}-S`}, ${`${ten} tram`}) RETURNING id`;
  const stationId = (s[0] as unknown as { id: number }).id;
  // ⚠ `machineType` là enum NOT NULL — bỏ ra thì INSERT ném 23502.
  const m = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType")
    VALUES (${stationId}, ${`${code}-M`}, ${`${ten} may`}, 'AOI') RETURNING id`;
  const machineId = (m[0] as unknown as { id: number }).id;
  return { factoryId, workshopId, lineId, stationId, machineId };
}

/** WIP đang trong chuyền (`exitedAt IS NULL`) — thứ `wipFlowState` đếm. */
async function taoWip(lineId: number, stationId: number, nhan: string): Promise<number[]> {
  const r = await sql`
    INSERT INTO wip_tracking ("lineId", "currentStationId", "serialNumber", "enteredAt")
    VALUES (${lineId}, ${stationId}, ${`${DAU}-${nhan}-1`}, now()),
           (${lineId}, ${stationId}, ${`${DAU}-${nhan}-2`}, now())
    RETURNING id`;
  return (r as unknown as Array<{ id: number }>).map((x) => x.id);
}

/** Caller của router mang danh tính một người dùng cụ thể. */
function goi(userId: number, role: string = VAI) {
  return digitalTwinRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}

describe.skipIf(!DB_URL)("Q1 — `digitalTwinRouter` lọc theo phạm vi tenant, hai chiều", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const facNgoaiCode = `${DAU}-NGOAI`;
    const trong = await taoNhanh(facTrongCode, `${DAU} TRONG`);
    const ngoai = await taoNhanh(facNgoaiCode, `${DAU} NGOAI`);

    const mkUser = async (suffix: string) => {
      const u = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`${DAU}-${suffix}`}, ${`${DAU}-${suffix}`}, ${`${DAU} ${suffix}`}, ${VAI}, true)
        RETURNING id`;
      return (u[0] as unknown as { id: number }).id;
    };
    const userTrongId = await mkUser("trong");
    const userKhongGanId = await mkUser("khonggan");
    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột
    //   `factoryId`, dùng sai tên sẽ ném `42703`.
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userTrongId}, ${facTrongCode})`;

    fx = {
      facTrongId: trong.factoryId,
      facTrongCode,
      facNgoaiId: ngoai.factoryId,
      facNgoaiCode,
      userTrongId,
      userKhongGanId,
      lineTrongId: trong.lineId,
      lineNgoaiId: ngoai.lineId,
      tramTrongId: trong.stationId,
      tramNgoaiId: ngoai.stationId,
      mayTrongId: trong.machineId,
      mayNgoaiId: ngoai.machineId,
      workshopIds: [trong.workshopId, ngoai.workshopId],
      wipIds: [
        ...(await taoWip(trong.lineId, trong.stationId, "trong")),
        ...(await taoWip(ngoai.lineId, ngoai.stationId, "ngoai")),
      ],
    };
  });

  afterAll(async () => {
    if (fx) {
      // Xoá ĐÚNG những hàng lưới này tạo, theo id — không xoá theo predicate rộng.
      await sql`DELETE FROM wip_tracking WHERE id = ANY(${fx.wipIds})`;
      await sql`DELETE FROM machines WHERE id = ANY(${[fx.mayTrongId, fx.mayNgoaiId]})`;
      await sql`DELETE FROM stations WHERE id = ANY(${[fx.tramTrongId, fx.tramNgoaiId]})`;
      await sql`DELETE FROM production_lines WHERE id = ANY(${[fx.lineTrongId, fx.lineNgoaiId]})`;
      await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshopIds})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${[fx.userTrongId, fx.userKhongGanId]})`;
      await sql`DELETE FROM users WHERE id = ANY(${[fx.userTrongId, fx.userKhongGanId]})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  });

  it("ca dương DỰNG ĐƯỢC THẬT — nếu không, mọi ô dưới đo trên tập rỗng", () => {
    // ⚠ G5: các ô dưới đều xanh trên một fixture không tồn tại.
    expect(fx).not.toBeNull();
    expect(fx!.lineTrongId).not.toBe(fx!.lineNgoaiId);
    expect(fx!.mayTrongId).not.toBe(fx!.mayNgoaiId);
    expect(fx!.wipIds).toHaveLength(4);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, không phải 0", async () => {
    // ⚠⚠ "0 gán" và "được gán A, hỏi B" cho CÙNG kết quả rỗng. Ô này tách hai câu.
    const g = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userTrongId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([
      fx!.facTrongCode,
    ]);
    const g2 = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`;
    expect(g2).toHaveLength(0);
  });

  describe("twinState", () => {
    it("★★★ CHIỀU (+) — người gán A đọc được máy của A", async () => {
      const rows = await goi(fx!.userTrongId).twinState({ limit: 500 });
      expect(rows.map((r: any) => r.id)).toContain(fx!.mayTrongId);
    });

    it("★★★ CHIỀU (−) — CHÍNH người ấy KHÔNG đọc được máy của B", async () => {
      const rows = await goi(fx!.userTrongId).twinState({ limit: 500 });
      expect(rows.map((r: any) => r.id)).not.toContain(fx!.mayNgoaiId);
    });

    it("★★★ `stationId` TỰ KHAI của trạm NGOÀI phạm vi ⇒ RỖNG, không phải dữ liệu trạm ấy", async () => {
      // Đây là cửa mà một số nguyên đoán được mở ra trước bản vá.
      const rows = await goi(fx!.userTrongId).twinState({ stationId: fx!.tramNgoaiId, limit: 500 });
      expect(rows).toEqual([]);
    });

    it("người 0 gán đọc được **0** máy — kể cả máy của chính trạm mình khai", async () => {
      const rows = await goi(fx!.userKhongGanId).twinState({ limit: 500 });
      expect(rows).toEqual([]);
      const rows2 = await goi(fx!.userKhongGanId).twinState({ stationId: fx!.tramTrongId, limit: 500 });
      expect(rows2).toEqual([]);
    });

    it("admin KHÔNG bị thu hẹp — chiều DƯƠNG của `PhamViNguoiXem` (toàn quyền ⇒ không lọc)", async () => {
      // ⚠ Ô này KHÔNG chứng minh an toàn (admin bypass mọi cổng). Nó chặn bản vá
      //   quá tay làm hỏng vai toàn quyền — lỗi đã có tên ở `_phamViNguoiXem.ts`.
      //
      // ⚠⚠ Hỏi theo TỪNG TRẠM, không lấy một trang 1000 hàng rồi tìm trong đó:
      //   bản đầu của ô này ĐỎ vì `limit` cắt đúng 1000 hàng và máy fixture rơi
      //   ra ngoài trang — một phép đo hỏng, không phải một bản vá hỏng. Lọc theo
      //   `stationId` cho tập nhỏ và xác định, không phụ thuộc số hàng có sẵn.
      const adm = goi(fx!.userTrongId, "admin");
      const trong = await adm.twinState({ stationId: fx!.tramTrongId, limit: 500 });
      const ngoai = await adm.twinState({ stationId: fx!.tramNgoaiId, limit: 500 });
      expect(trong.map((r: any) => r.id)).toContain(fx!.mayTrongId);
      // ★ Điểm mấu chốt: trạm NGOÀI phạm vi của `userTrongId` — admin vẫn đọc được.
      expect(ngoai.map((r: any) => r.id)).toContain(fx!.mayNgoaiId);
    });
  });

  describe("wipFlowState", () => {
    it("★★★ CHIỀU (+) — người gán A đếm được WIP của chuyền thuộc A", async () => {
      const r = await goi(fx!.userTrongId).wipFlowState({ lineId: fx!.lineTrongId });
      expect(r.totalWip).toBe(2);
      expect(r.stations.map((s: any) => s.stationId)).toEqual([fx!.tramTrongId]);
    });

    it("★★★ CHIỀU (−) — `lineId` TỰ KHAI của chuyền thuộc B ⇒ 0 WIP", async () => {
      const r = await goi(fx!.userTrongId).wipFlowState({ lineId: fx!.lineNgoaiId });
      expect(r.totalWip).toBe(0);
      expect(r.stations).toEqual([]);
    });

    it("★★★ KHÔNG truyền `lineId` ⇒ vẫn chỉ thấy trạm TRONG phạm vi, không phải 'tất cả hoặc không gì'", async () => {
      // Ca này bắt hai bản vá sai cùng lúc: (a) chỉ chặn khi có `lineId` — lời gọi
      // trống vẫn quét mọi chuyền; (b) chặn cả lời gọi trống ⇒ mất dữ liệu hợp lệ.
      const r = await goi(fx!.userTrongId).wipFlowState({});
      const ids = r.stations.map((s: any) => s.stationId);
      expect(ids).toContain(fx!.tramTrongId);
      expect(ids).not.toContain(fx!.tramNgoaiId);
    });

    it("người 0 gán ⇒ 0 WIP ở cả hai lối gọi", async () => {
      expect((await goi(fx!.userKhongGanId).wipFlowState({ lineId: fx!.lineTrongId })).totalWip).toBe(0);
      expect((await goi(fx!.userKhongGanId).wipFlowState({})).totalWip).toBe(0);
    });
  });

  describe("stationLoadHeatmap / predictionOverlay — `lineId` bắt buộc, TỰ KHAI", () => {
    it("★★★ CHIỀU (−) — chuyền thuộc B ⇒ hình dạng rỗng hợp lệ, KHÔNG ném lỗi", async () => {
      // Ngoài phạm vi phải như KHÔNG TỒN TẠI: một lỗi riêng vẫn xác nhận chuyền có thật.
      const sl = await goi(fx!.userTrongId).stationLoadHeatmap({ lineId: fx!.lineNgoaiId, hours: 720 });
      expect(sl.cells).toEqual([]);
      expect(sl.bottleneckStationId).toBeNull();
    });

    it("★★★ `predictionOverlay` phân biệt 'ngoài phạm vi' với 'thiếu dữ liệu' (G47)", async () => {
      // Gộp hai lý do vào một chuỗi là nói dối một trong hai. Chuyền TRONG phạm vi
      // của fixture này có WIP nhưng <3 bucket ⇒ `insufficient_data`; chuyền ngoài
      // phạm vi ⇒ `out_of_scope`. Hai câu khác nhau, hai chuỗi khác nhau.
      const ngoai = await goi(fx!.userTrongId).predictionOverlay({ lineId: fx!.lineNgoaiId });
      expect(ngoai.available).toBe(false);
      expect((ngoai as any).reason).toBe("out_of_scope");

      const trong = await goi(fx!.userTrongId).predictionOverlay({ lineId: fx!.lineTrongId });
      expect((trong as any).reason).not.toBe("out_of_scope");
    });

    it("người 0 gán ⇒ `out_of_scope` kể cả cho chuyền có thật", async () => {
      const r = await goi(fx!.userKhongGanId).predictionOverlay({ lineId: fx!.lineTrongId });
      expect((r as any).reason).toBe("out_of_scope");
    });
  });

  describe("whatIf — MIỄN TRỪ có lý do đo được", () => {
    it("thuần tính toán: KHÔNG chạm CSDL ⇒ người 0 gán vẫn mô phỏng được input của chính mình", async () => {
      // ⚠ Ô này ghim MIỄN TRỪ để nó là một quyết định nhìn thấy được, không phải
      //   một chỗ quên. Mọi con số trả về suy từ `input` — không có hàng tenant nào.
      const r = await goi(fx!.userKhongGanId).whatIf({
        stations: [{ stationId: 1, cycleTimeSec: 10 }],
        horizonHours: 1,
      });
      expect(r).toBeTruthy();
    });
  });
});
