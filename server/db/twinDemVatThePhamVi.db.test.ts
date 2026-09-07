/**
 * CỔNG CSDL THẬT — ĐỢT 11 LÔ K2: **HÀNG RÀO TENANT CỦA `demVatThe`**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * `twinCanhRouter.demVatThe` khai `async ({ input })` — **không bóc `ctx` một
 * lần nào** — trong khi bốn thủ tục đọc quanh nó đều truyền `phamViCua(ctx)`.
 * Và `tangIds` là lời **TỰ KHAI của client**. Hợp hai điều đó lại: bất kỳ ai qua
 * được cổng `quyenThietKe("canView")` đếm được vật thể của MỌI tầng thuộc MỌI
 * nhà máy — chỉ cần đoán một số nguyên. Đây đúng lớp lỗi đã có tên trong sổ dự
 * án: *"hàng rào tenant lọc theo cột CLIENT TỰ KHAI"*.
 *
 * ⚠ Cổng quyền xanh CHE MẤT việc hàng rào tenant chưa từng được dựng: hai trục
 *   khác nhau, và chỉ một trục có người canh.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI NÀY TỰ DỰNG LẤY CẢ TENANT LẪN DỮ LIỆU (G22 — bài học đắt)
 * ══════════════════════════════════════════════════════════════════════════════
 * Bản đầu của lưới này mượn `e2e_tai_loE` (id 21075) của DB **dev**. Nó XANH —
 * và xanh **VÌ MỘT LÝ DO SAI**: `vitest.setup.ts:64` ép `DATABASE_URL` sang
 * `aoi_management_test`, nơi **user 21075 không tồn tại** và `twin_toa_nha` có
 * **0 hàng**. Người dùng không tồn tại ⇒ 0 gán ⇒ phạm vi RỖNG ⇒ `[]`. Chiều (−)
 * xanh mà chưa hề chạm vào luật lọc; nó sẽ xanh y hệt nếu bản vá bị gỡ sạch.
 *
 * ⇒ Đó đúng là G22: *"không nhận được gì" không phải bằng chứng khi không ai
 *   đang phát*. Nên lưới này **không mượn gì của seed**: nó tạo lấy hai nhà máy,
 *   một người dùng, một bản gán, tầng và vật thể — rồi xoá đúng chừng ấy.
 *
 * ⚠ Và vì thế nó có một ô **ĐỐI CHỨNG DANH TÍNH**: người dùng thử phải thật sự
 *   được gán ĐÚNG MỘT nhà máy. Nếu bản gán không vào được (sai tên cột…), ô đó
 *   đỏ — thay vì để chiều (−) xanh giả như bản đầu.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU — CHIỀU DƯƠNG LÀ CHIỀU DỄ MẤT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (−) người được gán nhà máy A ⇒ đếm vật thể của tầng thuộc nhà máy B = **0**
 *   (+) chính người ấy ⇒ đếm được **đúng 2** vật thể của tầng thuộc A
 *
 * Chiều (+) là đối chứng bắt buộc: một bản vá `return []` vô điều kiện làm chiều
 * (−) xanh hoàn hảo mà đã giết chức năng — đúng lớp "vá quá tay thành chặn tất
 * cả" mà `PhamViNguoiXem` cảnh báo.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN mà lưới này bắt (đã tiêm tay — xem báo cáo lô K)
 * ══════════════════════════════════════════════════════════════════════════════
 *   (a) bỏ `scope` khỏi `demVatTheTheoTang` (khôi phục nguyên lỗ)  ⇒ chiều (−) ĐỎ
 *   (b) `demVatTheTheoTang(input.tangIds)` ở router (quên truyền)  ⇒ chiều (−) ĐỎ
 *   (c) `return []` vô điều kiện (vá quá tay)                       ⇒ chiều (+) ĐỎ
 *
 * ★ G20 — import CHÍNH `demVatTheTheoTang` của module giao hàng. Xoá sạch nó thì
 *   lưới này ĐỎ, không phải xanh nhờ một bản chép trong fixture.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { demVatTheTheoTang } from "./twinCanh";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `K2-${Date.now()}`;

let sql: ReturnType<typeof postgres>;

interface Fixture {
  /** Nhà máy người dùng ĐƯỢC gán. */
  facTrongId: number;
  facTrongCode: string;
  /** Nhà máy người dùng KHÔNG được gán. */
  facNgoaiId: number;
  facNgoaiCode: string;
  userId: number;
  tangTrongId: number;
  tangNgoaiId: number;
  /** Vật thể của tầng TRONG phạm vi (2 hàng). */
  vatTheTrong: number[];
  /** Vật thể của tầng NGOÀI phạm vi (2 hàng). */
  vatTheNgoai: number[];
  toaNhaIds: number[];
}
let fx: Fixture | null = null;

/** Vai KHÔNG phải admin — admin BYPASS mọi cổng, đo bằng admin chứng minh SỐ 0. */
const VAI = "supervisor";

async function taoNhaMay(code: string, ten: string): Promise<number> {
  const r = await sql`
    INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

async function taoTang(factoryId: number, nhan: string): Promise<{ toaNhaId: number; tangId: number }> {
  const toa = await sql`
    INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon)
    VALUES (${factoryId}, ${`${DAU}-${nhan}`}, ${`${DAU} toa nha ${nhan}`}, 'tay')
    RETURNING id`;
  const toaNhaId = (toa[0] as unknown as { id: number }).id;
  const tang = await sql`
    INSERT INTO twin_tang ("toaNhaId", "capSo", ten, nguon)
    VALUES (${toaNhaId}, 1, ${`${DAU} tang ${nhan}`}, 'tay')
    RETURNING id`;
  return { toaNhaId, tangId: (tang[0] as unknown as { id: number }).id };
}

async function taoVatThe(tangId: number, nhan: string): Promise<number[]> {
  // ⚠ `ten` là NOT NULL (đo trên information_schema) — bỏ ra thì INSERT ném 23502.
  const r = await sql`
    INSERT INTO twin_vat_the ("tangId", loai, ten, nguon)
    VALUES (${tangId}, 'tuong', ${`${DAU} ${nhan} 1`}, 'tay'),
           (${tangId}, 'tuong', ${`${DAU} ${nhan} 2`}, 'tay')
    RETURNING id`;
  return (r as unknown as Array<{ id: number }>).map((x) => x.id);
}

describe.skipIf(!DB_URL)("K2 — `demVatThe` lọc theo phạm vi tenant, hai chiều", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const facNgoaiCode = `${DAU}-NGOAI`;
    const facTrongId = await taoNhaMay(facTrongCode, `${DAU} nha may TRONG pham vi`);
    const facNgoaiId = await taoNhaMay(facNgoaiCode, `${DAU} nha may NGOAI pham vi`);

    const u = await sql`
      INSERT INTO users ("openId", username, name, role, "isActive")
      VALUES (${`${DAU}-openid`}, ${`${DAU}-user`}, ${`${DAU} nguoi thu`}, ${VAI}, true)
      RETURNING id`;
    const userId = (u[0] as unknown as { id: number }).id;

    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột
    //   `factoryId`, dùng sai tên sẽ ném `42703`.
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userId}, ${facTrongCode})`;

    const trong = await taoTang(facTrongId, "TRONG");
    const ngoai = await taoTang(facNgoaiId, "NGOAI");

    fx = {
      facTrongId,
      facTrongCode,
      facNgoaiId,
      facNgoaiCode,
      userId,
      tangTrongId: trong.tangId,
      tangNgoaiId: ngoai.tangId,
      vatTheTrong: await taoVatThe(trong.tangId, "trong"),
      vatTheNgoai: await taoVatThe(ngoai.tangId, "ngoai"),
      toaNhaIds: [trong.toaNhaId, ngoai.toaNhaId],
    };
  });

  afterAll(async () => {
    if (fx) {
      // Xoá ĐÚNG những hàng lưới này tạo, THEO ID / theo mã có hậu tố duy nhất —
      // không xoá theo predicate rộng. Từ trong ra ngoài, không dựa vào CASCADE.
      await sql`DELETE FROM twin_vat_the WHERE id = ANY(${[...fx.vatTheTrong, ...fx.vatTheNgoai]})`;
      await sql`DELETE FROM twin_tang WHERE id = ANY(${[fx.tangTrongId, fx.tangNgoaiId]})`;
      await sql`DELETE FROM twin_toa_nha WHERE id = ANY(${fx.toaNhaIds})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${fx.userId}`;
      await sql`DELETE FROM users WHERE id = ${fx.userId}`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  });

  it("ca dương DỰNG ĐƯỢC THẬT — nếu không, mọi ô dưới đo trên tập rỗng", () => {
    // ⚠ G5: các ô dưới đều xanh trên một tầng không tồn tại. Ô này chặn ca đó.
    expect(fx).not.toBeNull();
    expect(fx!.vatTheTrong).toHaveLength(2);
    expect(fx!.vatTheNgoai).toHaveLength(2);
    expect(fx!.tangTrongId).not.toBe(fx!.tangNgoaiId);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, không phải 0", async () => {
    // ⚠⚠ Ô này tồn tại vì bản đầu của lưới đã XANH GIẢ đúng ở đây: nó mượn một
    //   userId của DB dev, mà DB test không có người ấy ⇒ 0 gán ⇒ phạm vi rỗng
    //   ⇒ chiều (−) xanh mà chưa chạm luật lọc. "0 gán" và "được gán A, hỏi B"
    //   cho CÙNG một kết quả rỗng, nên phải tách hai câu đó ra bằng phép đo.
    const g = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([
      fx!.facTrongCode,
    ]);
  });

  it("★★★ CHIỀU (−) — người gán nhà máy A đếm được **0** vật thể của tầng thuộc B", async () => {
    const hang = await demVatTheTheoTang([fx!.tangNgoaiId], {
      userId: fx!.userId,
      userRole: VAI,
    });
    expect(hang).toEqual([]);
  });

  it("★★★ CHIỀU (+) — CHÍNH người ấy đếm được **đúng 2** vật thể của tầng thuộc A", async () => {
    // Đối chứng bắt buộc: `return []` vô điều kiện làm chiều (−) xanh hoàn hảo
    // mà đã giết chức năng. Cùng một người, cùng một lời gọi — chỉ khác tầng.
    const hang = await demVatTheTheoTang([fx!.tangTrongId], {
      userId: fx!.userId,
      userRole: VAI,
    });
    expect(hang.map((h) => h.id).sort()).toEqual([...fx!.vatTheTrong].sort());
  });

  it("★★★ TRỘN hai tầng — chỉ tầng TRONG phạm vi sống sót, không phải 'tất cả hoặc không gì'", async () => {
    // Ca này bắt một bản vá kiểu "nếu CÓ tầng nào ngoài phạm vi thì trả rỗng
    // hết" — nó làm chiều (−) xanh nhưng làm mất dữ liệu hợp lệ của chính người
    // dùng. Đây là phép đo PHÂN BIỆT hai bản vá mà các ô trên không tách được.
    const hang = await demVatTheTheoTang([fx!.tangTrongId, fx!.tangNgoaiId], {
      userId: fx!.userId,
      userRole: VAI,
    });
    expect(hang.map((h) => h.id).sort()).toEqual([...fx!.vatTheTrong].sort());
    expect(hang.some((h) => h.tangId === fx!.tangNgoaiId)).toBe(false);
  });

  it("lối KHÔNG mang danh tính vẫn đọc được cả hai tầng — chiều DƯƠNG của `PhamViNguoiXem`", async () => {
    // Mẫu thứ hai RỜI HẲN (G9): nhánh `scope === undefined` ⇒ `idsTrongPhamVi`
    // trả `null` ⇒ KHÔNG lọc. Đây là hình dạng CÓ THẬT của lối gọi nội bộ (seed,
    // script), và là thứ chặn "vá quá tay thành chặn tất cả".
    const hang = await demVatTheTheoTang([fx!.tangTrongId, fx!.tangNgoaiId], undefined);
    expect(hang.map((h) => h.id).sort()).toEqual(
      [...fx!.vatTheTrong, ...fx!.vatTheNgoai].sort(),
    );
  });
});
