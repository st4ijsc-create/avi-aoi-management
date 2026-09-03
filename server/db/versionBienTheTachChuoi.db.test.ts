/**
 * server/db/versionBienTheTachChuoi.db.test.ts
 *
 * ★★★ NEW-3 (review Khối C lượt 9, vòng 2, Important) — `recordVariantOverrideVersion`
 * (`fa2769a3`, I-3) ghi giới hạn HIỆU LỰC CỦA BIẾN THỂ vào CHÍNH chuỗi
 * `measurement_point_versions` của điểm BASE. Trước bản vá đó chuỗi base SẠCH
 * (0 hàng biến thể); SAU bản vá, một hàng biến thể nằm XEN giữa các hàng base
 * thật — khi cờ `SPEC_GATE_SNAPSHOT_ENABLED` BẬT, `resolveLimitsAtInstant` không
 * phân biệt được nguồn, nên một bo BASE (mọi bo v2 hôm nay LUÔN base) có thể bị
 * tái dựng NHẦM bằng giới hạn của một biến thể nó chưa từng thuộc về.
 *
 * Bản vá vòng 2: `recordVariantOverrideVersion` gắn tiền tố CẤU TRÚC
 * `[VARIANT:<id>]` vào ĐẦU `changeReason`; `napLichSuGioiHanTheoDiem` (v2,
 * `cayDay.ts`) và `loadPointLimitSnapshots` (v1.x, `machineApiRouters.ts`) LỌC
 * BỎ hàng mang tiền tố đó khi tái dựng cho bo BASE.
 *
 * ── VÌ SAO CẦN HAI LƯỢT OVERRIDE (không phải một) ────────────────────────────
 * `hieuLucTruocOverride` của LƯỢT OVERRIDE ĐẦU TIÊN luôn bằng giới hạn BASE hiện
 * hành (chưa có gì để lệch) — numeric TRÙNG với base, nên một lượt override duy
 * nhất không đủ để CHỨNG MINH "đọc nhầm hàng biến thể cho ra kết quả SAI" (giá
 * trị đọc nhầm sẽ trùng ngẫu nhiên với giá trị đúng). Lượt override THỨ HAI trên
 * CÙNG biến thể có `hieuLucTruocOverride` = **override thứ nhất đã áp** — một
 * giá trị chỉ tồn tại trên biến thể, không bao giờ xuất hiện trên hàng base thật
 * — đọc nhầm hàng đó cho một bo BASE sẽ tái dựng ra một khoảng SAI, đo được.
 *
 * Chạy trên `aoi_management_test` qua `vitest.setup.ts` guard, vai `avi_app`.
 *
 * ── GOTCHA đo được khi viết lưới này (BG-96 cùng họ, KHÁC vị trí) ───────────
 * `measurement_point_versions.changedAt` là `timestamp` KHÔNG mang time-zone.
 * Client `postgres` RAW dựng riêng trong lưới này (`sql`, không cấu hình phiên
 * giống app) và client `drizzle` của `getDb()` (app dùng SẢN XUẤT, cấu hình
 * phiên qua `server/db/connection.ts`) phân giải CÙNG một giá trị cột thành
 * hai đối tượng `Date` LỆCH NHAU đúng 7 giờ (đo trực tiếp: 20:58:23 vs
 * 13:58:23 cho cùng một hàng) — hai máy khách khác cấu hình timezone phiên.
 * ⇒ KHÔNG được lấy mốc so sánh từ client RAW rồi đem so với `changedAt` mà
 * `napLichSuGioiHanTheoDiem` đọc qua `getDb()`. Mốc `lucDo` phải đến từ CHÍNH
 * `getDb()` (qua `layChangedAtMoiNhat` dưới) — cùng khung quy chiếu với đường
 * đọc sản xuất đang được kiểm.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { eq, desc } from "drizzle-orm";
import { measurementPointVersions } from "../../drizzle/schema";
import { getDb } from "./connection";
import {
  updateMeasurementPointDef,
  recordVariantOverrideVersion,
  setVariantPointOverride,
  apDungVariantPatch,
  createVariant,
  RE_TIEN_TO_VERSION_BIEN_THE,
} from "./product";
import { napLichSuGioiHanTheoDiem } from "./cayDay";
import { giaiGioiHanTaiLucDo } from "../services/gioiHanLucDoCayV2";
import type { PointLimitSnapshot, PointLimitSource } from "../services/pointResultEvaluator";

/** Đọc `changedAt` của hàng version MỚI NHẤT cho một điểm — qua `getDb()`
 * (drizzle), CÙNG máy khách với `napLichSuGioiHanTheoDiem`/`loadPointLimitSnapshots`
 * sản xuất. Dùng để tính mốc so sánh, tránh lệch múi giờ giữa hai máy khách
 * postgres khác cấu hình phiên (xem docblock đầu file). */
async function layChangedAtMoiNhat(pointDefId: number): Promise<Date> {
  const db = await getDb();
  if (!db) throw new Error("layChangedAtMoiNhat: DB không sẵn sàng");
  const [hang] = await db
    .select({ changedAt: measurementPointVersions.changedAt })
    .from(measurementPointVersions)
    .where(eq(measurementPointVersions.pointDefId, pointDefId))
    .orderBy(desc(measurementPointVersions.version))
    .limit(1);
  if (!hang) throw new Error("layChangedAtMoiNhat: không có hàng version nào");
  return hang.changedAt;
}

const DB_URL = process.env.DATABASE_URL;
const RUN = `NW3${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { product: 0, point: 0, variant: 0 };

describe.skipIf(!DB_URL)("NEW-3 — version biến thể KHÔNG được lẫn vào chuỗi base (vai avi_app, DB thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [d] = await sql<{ db: string; usr: string }[]>`SELECT current_database() AS db, current_user AS usr`;
    tenDb = d.db;
    expect(d.usr, "phải đo bằng vai avi_app").toBe("avi_app");
    // eslint-disable-next-line no-console
    console.log(`[NEW-3] current_database()=${d.db} current_user=${d.usr}`);

    const [pm] = await sql<{ id: number }[]>`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"NW3-" + RUN}, 'NEW-3 tach chuoi', 'development') RETURNING id`;
    ids.product = pm.id;

    // Điểm đo TRẦN (không cần cây surface/position/capture — hai hàm đang đo chỉ
    // cần pointDefId + measurement_point_versions, không đọc captureRowId).
    const [mp] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PT-" + RUN}, 'NEW-3 point', 'DIMENSION', 10, 10) RETURNING id`;
    ids.point = mp.id;

    const varId = await createVariant({ productModelId: ids.product, code: "EU", name: "EU", isBase: false } as never);
    ids.variant = varId;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" = ${ids.point}`;
    await sql`DELETE FROM variant_point_overrides WHERE "basePointDefId" = ${ids.point}`;
    await sql`DELETE FROM product_variants WHERE id = ${ids.variant}`;
    await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
    await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★★★ CHUỖI BASE SẠCH SAU KHI override biến thể — napLichSuGioiHanTheoDiem KHÔNG trả hàng biến thể", async () => {
    // BƯỚC 1 — dạy BASE [9;11] (bộ ghi SẢN XUẤT — tạo hàng lịch sử THẬT, không
    // tự INSERT bằng tay: tự dựng bằng chứng cho chính mình là phép đo vô giá trị).
    await updateMeasurementPointDef(ids.point, { lowerLimit: "9", upperLimit: "11" } as never, {
      changeReason: "NEW-3 luoi: day BASE",
    });
    const [baseSauDay] = await sql<{ lowerLimit: string; upperLimit: string }[]>`
      SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${ids.point}`;
    expect(Number(baseSauDay.lowerLimit)).toBe(9);
    expect(Number(baseSauDay.upperLimit)).toBe(11);

    // BƯỚC 2 — OVERRIDE #1 trên biến thể EU (patch upperLimit=3). `hieuLucTruoc`
    // = base HIỆN HÀNH (chưa có override cũ) = [9;11] — CÙNG khuôn router.
    const patch1 = { upperLimit: "3" };
    await recordVariantOverrideVersion(ids.point, ids.variant, baseSauDay as unknown as Record<string, unknown>, {
      changeReason: "NEW-3 luoi: override #1",
    });
    await setVariantPointOverride({ variantId: ids.variant, basePointDefId: ids.point, action: "override", patchJson: patch1 });

    // ★ Mốc "giữa hai override" đọc qua `getDb()` (drizzle) — CÙNG máy khách
    // với `napLichSuGioiHanTheoDiem` sản xuất, KHÔNG phải client `sql` RAW của
    // lưới này (hai client lệch nhau 7 giờ khi phân giải CÙNG một giá trị
    // `timestamp` không time-zone — đo được, xem docblock đầu file: dùng `sql`
    // RAW cho mốc này từng làm `lucDo` rơi TRƯỚC cả `changedAt` của override #1
    // vừa ghi, khiến `resolveLimitsAtInstant` chọn NHẦM hàng dạy base thay vì
    // rơi về "missing"/live như thiết kế). Lấy `changedAt` THẬT rồi nhích +1ms.
    const changedAtOverride1 = await layChangedAtMoiNhat(ids.point);
    const lucDoGiuaHaiOverride = new Date(changedAtOverride1.getTime() + 1);
    // Khoảng nghỉ NHỎ trước khi ghi override #2 — bảo đảm `changedAt` của nó tách
    // biệt (không trùng mili-giây) khỏi mốc vừa tính, để phép so `>= lucDo` không mơ hồ.
    await new Promise((r) => setTimeout(r, 5));

    // BƯỚC 3 — OVERRIDE #2 trên CÙNG biến thể (patch upperLimit=30).
    // `hieuLucTruoc` = apDungVariantPatch(base, patch1) = base VỚI upperLimit ĐÃ
    // BỊ OVERRIDE #1 THAY — giá trị CHỈ tồn tại trên biến thể, không trên base.
    const hieuLucTruocOverride2 = apDungVariantPatch(baseSauDay as unknown as Record<string, unknown>, patch1);
    expect(Number((hieuLucTruocOverride2 as any).upperLimit), "cầu chì: hiệu lực trước override #2 PHẢI mang giá trị override #1 (3), không phải base (11)").toBe(3);
    await recordVariantOverrideVersion(ids.point, ids.variant, hieuLucTruocOverride2, {
      changeReason: "NEW-3 luoi: override #2",
    });
    await setVariantPointOverride({ variantId: ids.variant, basePointDefId: ids.point, action: "override", patchJson: { upperLimit: "30" } });

    // ── ĐO TRÊN ĐĨA — đúng 3 hàng lịch sử, 2 hàng mang tiền tố [VARIANT:<id>] ──
    const hangTho = await sql<{ id: number; changeReason: string | null; snapshotJson: any }[]>`
      SELECT id, "changeReason", "snapshotJson" FROM measurement_point_versions
       WHERE "pointDefId" = ${ids.point} ORDER BY version ASC`;
    expect(hangTho.length, `[${tenDb}] phải có đúng 3 hàng lịch sử (1 dạy base + 2 override)`).toBe(3);
    const soBienThe = hangTho.filter((h) => RE_TIEN_TO_VERSION_BIEN_THE.test(h.changeReason ?? "")).length;
    expect(soBienThe, `[${tenDb}] đúng 2 hàng phải mang tiền tố [VARIANT:${ids.variant}]`).toBe(2);
    expect(hangTho.every((h) => (h.changeReason ?? "").includes(`[VARIANT:${ids.variant}]`) || h === hangTho[0])).toBe(true);

    // ★★★ BẰNG CHỨNG CHÍNH — napLichSuGioiHanTheoDiem (đường ĐỌC của v2) PHẢI
    // LỌC hết 2 hàng biến thể, chỉ trả về hàng dạy BASE.
    const lichSu = await napLichSuGioiHanTheoDiem([ids.point]);
    const cuaDiem = lichSu.get(ids.point) ?? [];
    expect(cuaDiem.length, `[${tenDb}] chuỗi ĐỌC ĐƯỢC cho v2 phải CHỈ còn 1 hàng (dạy base) — 2 hàng biến thể phải bị lọc`).toBe(1);
    expect(cuaDiem[0].limits.upperLimit ?? null, "hàng còn lại phải là snapshot TRƯỚC lượt dạy base (null — chưa dạy)").toBeNull();

    // ══════════════════════════════════════════════════════════════════════
    // ★★★ BẰNG CHỨNG NEW-3 — giải giới hạn TẠI THỜI ĐIỂM GIỮA HAI OVERRIDE:
    // bo BASE phát lại PHẢI tái dựng bằng giới hạn BASE (LIVE, [9;11]),
    // KHÔNG PHẢI giới hạn override #1 (hieuLucTruocOverride2 mang upperLimit=3,
    // giá trị CHỈ tồn tại trên biến thể).
    // ══════════════════════════════════════════════════════════════════════
    const K = "K";
    const gioiHanSongBase: PointLimitSource = { lowerLimit: baseSauDay.lowerLimit, upperLimit: baseSauDay.upperLimit };
    const banDo = new Map([[K, ids.point]]);
    const gioiHanSong = new Map<string, PointLimitSource>([[K, gioiHanSongBase]]);

    const giaiDaLoc = giaiGioiHanTaiLucDo({
      banDo, gioiHanSong,
      lichSu: new Map([[ids.point, cuaDiem]]), // ĐÃ LỌC (napLichSuGioiHanTheoDiem)
      lucDo: lucDoGiuaHaiOverride,
    });
    const ketDaLoc = giaiDaLoc.gioiHan.get(K)!;
    // BẰNG CHỨNG PHỤ — nhánh chọn PHẢI là "missing → LIVE" (`theoSong=1`), KHÔNG
    // PHẢI "instant" tái dựng từ hàng dạy base (`theoSnapshot=0`): xác nhận
    // `lucDo` thật sự đứng SAU `changedAt` của hàng dạy base còn lại trong
    // `cuaDiem`, đúng ý đồ "giữa hai override" — không phải trùng số ngẫu nhiên.
    expect(giaiDaLoc.theoSong, `[${tenDb}] phải rơi về LIVE (không tái dựng từ hàng dạy base)`).toBe(1);
    expect(giaiDaLoc.theoSnapshot, `[${tenDb}] KHÔNG được tái dựng từ snapshot ở nhánh ĐÃ LỌC`).toBe(0);
    // So bằng SỐ (không so chuỗi) — cột `numeric(15,6)` trả "9.000000" từ Postgres,
    // khác định dạng chuỗi thô của patchJson ("3") — ý nghĩa cần đo là GIÁ TRỊ.
    expect(
      { lower: Number(ketDaLoc.lowerLimit), upper: Number(ketDaLoc.upperLimit) },
      `[${tenDb}] ★★★ NEW-3 ĐÃ VÁ — bo base phát lại tái dựng bằng giới hạn BASE [9;11], KHÔNG PHẢI biến thể`,
    ).toEqual({ lower: 9, upper: 11 });

    // ── ĐỘT BIẾN (mô phỏng "bỏ lọc" TRONG BỘ NHỚ, không chạm đĩa/mã thật) ────
    // Tái hiện đúng những gì `napLichSuGioiHanTheoDiem` PHIÊN BẢN CŨ (không lọc)
    // sẽ trả — đọc LẠI cả 3 hàng, kèm `changedAt`. ★ Qua `getDb()` (drizzle),
    // KHÔNG phải `sql` RAW — cùng lý do đã ghi ở mốc `lucDoGiuaHaiOverride`
    // phía trên: hai client lệch nhau 7 giờ khi phân giải cùng cột `timestamp`
    // không time-zone, và `lucDo` ở đây đến từ phía `getDb()`.
    const dbDoc = await getDb();
    if (!dbDoc) throw new Error("DB không sẵn sàng (đột biến)");
    const hangThoDuCot = await dbDoc
      .select({
        changeReason: measurementPointVersions.changeReason,
        snapshotJson: measurementPointVersions.snapshotJson,
        changedAt: measurementPointVersions.changedAt,
      })
      .from(measurementPointVersions)
      .where(eq(measurementPointVersions.pointDefId, ids.point))
      .orderBy(measurementPointVersions.version);
    const lichSuKhongLocThat: PointLimitSnapshot[] = hangThoDuCot.map((h) => ({
      changedAt: h.changedAt, limits: (h.snapshotJson ?? {}) as PointLimitSource, productPointsConfigVersion: null,
    }));
    expect(lichSuKhongLocThat.length, "mô phỏng KHÔNG lọc phải giữ nguyên cả 3 hàng").toBe(3);

    const giaiKhongLoc = giaiGioiHanTaiLucDo({
      banDo, gioiHanSong,
      lichSu: new Map([[ids.point, lichSuKhongLocThat]]),
      lucDo: lucDoGiuaHaiOverride,
    });
    const ketKhongLoc = giaiKhongLoc.gioiHan.get(K)!;
    expect(
      { lower: Number(ketKhongLoc.lowerLimit), upper: Number(ketKhongLoc.upperLimit) },
      `[${tenDb}] ĐỘT BIẾN (bỏ lọc) PHẢI cho kết quả SAI — đọc nhầm hàng biến thể (upperLimit=3), khác BASE thật (11)`,
    ).toEqual({ lower: 9, upper: 3 });
    expect(Number(ketKhongLoc.upperLimit), "kết quả KHÔNG LỌC và ĐÃ LỌC phải KHÁC NHAU — đây là bằng chứng đột biến có ý nghĩa").not.toBe(Number(ketDaLoc.upperLimit));
  }, 60_000);
});
