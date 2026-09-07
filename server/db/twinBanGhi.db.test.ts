/**
 * CỔNG CSDL THẬT — ĐỢT 12 LÔ M (#55): **`twin_ban_ghi` — CRUD BỐ CỤC THEO TÊN**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỚP LỖI L-3 — "BẢNG TỒN TẠI KHÔNG PHẢI LÀ TÍNH NĂNG TỒN TẠI"
 * ══════════════════════════════════════════════════════════════════════════════
 * §11c.2 đo được trước lô này: `drizzle/0351…:158` tạo bảng, schema khai kiểu,
 * DB dev **0 dòng**, `grep twinBanGhi` ngoài schema **0 kết quả**.
 *
 * Một lưới chỉ kiểm "hàm chạy không ném" sẽ xanh với một cài đặt trả `[]` vô
 * điều kiện — tức xanh trên đúng trạng thái mà lô này sinh ra để rời khỏi. Nên
 * mọi ô ở đây đo **hai chiều** và đo **con số**, không đo sự vắng mặt của lỗi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ BỐN BẤT BIẾN ĐƯỢC GHIM, MỖI CÁI CÓ MỘT ĐỘT BIẾN GIẾT ĐƯỢC NÓ
 * ══════════════════════════════════════════════════════════════════════════════
 *   B1 hàng rào tenant hai chiều       — bỏ `scope` ⇒ chiều (−) ĐỎ
 *   B2 ảnh chụp TỰ CHỨA                — đọc lại bảng sống ⇒ ô "sửa bảng sống
 *                                         không đổi ảnh chụp" ĐỎ
 *   B3 MỖI TẦNG ≤ 1 BẢN XUẤT BẢN       — bỏ lượt hạ cờ ⇒ ô đếm = 2 ⇒ ĐỎ
 *   B4 trùng tên trên cùng tầng = GHI ĐÈ — bỏ tìm-trước-khi-tạo ⇒ đếm = 2 ⇒ ĐỎ
 *
 * ★ G20 — import CHÍNH các hàm của module giao hàng (`./twinCanh`). Xoá chúng
 *   thì lưới này ĐỎ, không phải xanh nhờ một bản chép trong fixture.
 *
 * ★ G22 — lưới TỰ DỰNG lấy tenant và dữ liệu, không mượn seed: `vitest.setup.ts`
 *   ép `DATABASE_URL` sang DB test, nơi id của DB dev không tồn tại và mọi ô
 *   "rỗng" sẽ xanh vì một lý do SAI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

import {
  laAnhChupHopLe,
  luuBanGhi,
  traBanGhi,
  traMotBanGhi,
  xoaBanGhi,
  xuatBanBanGhi,
  type AnhChupBoCuc,
} from "./twinCanh";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `M55-${Date.now()}`;

/** Vai KHÔNG phải admin — admin BYPASS mọi cổng; đo bằng admin chứng minh SỐ 0. */
const VAI = "supervisor";

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  userId: number;
  tangTrongId: number;
  tangNgoaiId: number;
  toaNhaIds: number[];
}
let fx: Fixture | null = null;

/** Ảnh chụp thật — KHÁC RỖNG (G5), và hai bản có nội dung KHÁC NHAU. */
function anhChup(soMay: number, xGoc: number): AnhChupBoCuc {
  return {
    phienBan: 1,
    ghiLuc: new Date().toISOString(),
    datCho: Array.from({ length: soMay }, (_, i) => ({
      loaiThucThe: "machine",
      thucTheId: 1000 + i,
      viTriXMm: xGoc + i * 1500,
      viTriYMm: 2000,
      viTriZMm: 0,
      quatX: 0,
      quatY: 0,
      quatZ: 0,
      quatW: 1,
      rongMm: 1400,
      caoMm: 1900,
      sauMm: 1200,
      daKhoa: false,
      hienThi: true,
    })),
  };
}

async function taoNhaMay(code: string, ten: string): Promise<number> {
  const r = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

async function taoTang(factoryId: number, nhan: string) {
  const toa = await sql`
    INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon)
    VALUES (${factoryId}, ${`${DAU}-${nhan}`}, ${`${DAU} toa ${nhan}`}, 'tay')
    RETURNING id`;
  const toaNhaId = (toa[0] as unknown as { id: number }).id;
  const tang = await sql`
    INSERT INTO twin_tang ("toaNhaId", "capSo", ten, nguon)
    VALUES (${toaNhaId}, 1, ${`${DAU} tang ${nhan}`}, 'tay')
    RETURNING id`;
  return { toaNhaId, tangId: (tang[0] as unknown as { id: number }).id };
}

const NGUOI = () => ({ userId: fx!.userId, userRole: VAI });

describe.skipIf(!DB_URL)("#55 — `twin_ban_ghi` CRUD + hàng rào tenant", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const facTrongId = await taoNhaMay(facTrongCode, `${DAU} nha may TRONG`);
    const facNgoaiId = await taoNhaMay(`${DAU}-NGOAI`, `${DAU} nha may NGOAI`);

    const u = await sql`
      INSERT INTO users ("openId", username, name, role, "isActive")
      VALUES (${`${DAU}-openid`}, ${`${DAU}-user`}, ${`${DAU} nguoi thu`}, ${VAI}, true)
      RETURNING id`;
    const userId = (u[0] as unknown as { id: number }).id;

    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột đó.
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userId}, ${facTrongCode})`;

    const trong = await taoTang(facTrongId, "TRONG");
    const ngoai = await taoTang(facNgoaiId, "NGOAI");

    fx = {
      facTrongId,
      facTrongCode,
      facNgoaiId,
      userId,
      tangTrongId: trong.tangId,
      tangNgoaiId: ngoai.tangId,
      toaNhaIds: [trong.toaNhaId, ngoai.toaNhaId],
    };
  });

  afterAll(async () => {
    if (fx) {
      // Xoá TỪ TRONG RA NGOÀI theo id, không dựa vào CASCADE và không dùng
      // predicate rộng — mọi hàng đều mang hậu tố duy nhất `DAU`.
      await sql`DELETE FROM twin_ban_ghi WHERE "tangId" = ANY(${[fx.tangTrongId, fx.tangNgoaiId]})`;
      await sql`DELETE FROM twin_tang WHERE id = ANY(${[fx.tangTrongId, fx.tangNgoaiId]})`;
      await sql`DELETE FROM twin_toa_nha WHERE id = ANY(${fx.toaNhaIds})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${fx.userId}`;
      await sql`DELETE FROM users WHERE id = ${fx.userId}`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  });

  it("ca dương DỰNG ĐƯỢC THẬT — nếu không, mọi ô dưới đo trên tập rỗng", () => {
    expect(fx).not.toBeNull();
    expect(fx!.tangTrongId).not.toBe(fx!.tangNgoaiId);
    expect(fx!.facTrongId).not.toBe(fx!.facNgoaiId);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, không phải 0", async () => {
    // "0 gán" và "được gán A, hỏi B" cho CÙNG kết quả rỗng — phải tách bằng đo.
    const g = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([
      fx!.facTrongCode,
    ]);
  });

  it("★★★ B1 CHIỀU (+) — lưu được vào tầng TRONG phạm vi, và đọc lại thấy", async () => {
    const ghi = await luuBanGhi(
      { tangId: fx!.tangTrongId, nhan: `${DAU} ban A`, anhChup: anhChup(3, 0), nguoiTao: fx!.userId },
      NGUOI(),
    );
    expect(ghi).not.toBeNull();

    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    expect(ds).toHaveLength(1);
    expect(ds[0].nhan).toBe(`${DAU} ban A`);
    // ★ SỐ THỰC THỂ đếm từ chính jsonb — 3, không phải 0 và không phải undefined.
    expect(ds[0].soDatCho).toBe(3);
    // ★ Lưu KHÔNG được tự xuất bản (§5.3: người dựng không làm rối màn đang chạy).
    expect(ds[0].daXuatBan).toBe(false);
  });

  it("★★★ B1 CHIỀU (−) — KHÔNG lưu được vào tầng NGOÀI phạm vi", async () => {
    const ghi = await luuBanGhi(
      { tangId: fx!.tangNgoaiId, nhan: `${DAU} lau`, anhChup: anhChup(2, 0), nguoiTao: fx!.userId },
      NGUOI(),
    );
    expect(ghi).toBeNull();
    // Và không có hàng nào lọt xuống DB — đo TRỰC TIẾP, không tin giá trị trả về.
    const dem = await sql`SELECT count(*)::int AS n FROM twin_ban_ghi WHERE "tangId" = ${fx!.tangNgoaiId}`;
    expect((dem[0] as unknown as { n: number }).n).toBe(0);
  });

  it("★★★ B1 CHIỀU (−) — KHÔNG đọc được bản ghi của tầng NGOÀI phạm vi", async () => {
    // Dựng một bản ghi ở tầng ngoài BẰNG SQL TRỰC TIẾP (vòng qua hàng rào), để
    // ô này đo đúng đường ĐỌC chứ không xanh nhờ đường GHI đã chặn ở ô trên.
    const r = await sql`
      INSERT INTO twin_ban_ghi ("tangId", nhan, "anhChup")
      VALUES (${fx!.tangNgoaiId}, ${`${DAU} cua nguoi khac`}, ${sql.json(anhChup(5, 0) as never)})
      RETURNING id`;
    const idNgoai = (r[0] as unknown as { id: number }).id;

    expect(await traBanGhi([fx!.tangNgoaiId], NGUOI())).toEqual([]);
    // `traMotBanGhi` trả `null` — KHÔNG phân biệt "không có" với "của người
    // khác": một câu riêng cho ca sau là một oracle rò rỉ tồn-tại.
    expect(await traMotBanGhi(idNgoai, NGUOI())).toBeNull();
    // Và cũng không xoá / xuất bản được.
    expect(await xoaBanGhi(idNgoai, NGUOI())).toBeNull();
    expect(await xuatBanBanGhi(idNgoai, NGUOI())).toBeNull();
    // Hàng vẫn còn nguyên — đối chứng cho hai lời gọi trên.
    const con = await sql`SELECT count(*)::int AS n FROM twin_ban_ghi WHERE id = ${idNgoai}`;
    expect((con[0] as unknown as { n: number }).n).toBe(1);
  });

  it("★★★ B4 — TRÙNG TÊN trên cùng tầng là GHI ĐÈ, không tạo hàng thứ hai", async () => {
    // Lược đồ KHÔNG có `UNIQUE ("tangId", nhan)`; hàng rào nằm ở tầng ghi.
    await luuBanGhi(
      { tangId: fx!.tangTrongId, nhan: `${DAU} ban A`, anhChup: anhChup(7, 500), nguoiTao: fx!.userId },
      NGUOI(),
    );
    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    const trung = ds.filter((b) => b.nhan === `${DAU} ban A`);
    expect(trung).toHaveLength(1);
    // ★ Và nội dung ĐÃ ĐỔI — đầu ra khác đầu vào lượt trước (G32). Nếu chỉ đếm
    //   hàng thì một cài đặt "bỏ qua lượt ghi thứ hai" cũng xanh.
    expect(trung[0].soDatCho).toBe(7);
  });

  it("★★★ B2 — ẢNH CHỤP TỰ CHỨA: sửa bảng SỐNG không đổi bản đã ghi", async () => {
    const ten = `${DAU} tu chua`;
    await luuBanGhi(
      { tangId: fx!.tangTrongId, nhan: ten, anhChup: anhChup(4, 9000), nguoiTao: fx!.userId },
      NGUOI(),
    );
    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    const id = ds.find((b) => b.nhan === ten)!.id;

    const truoc = await traMotBanGhi(id, NGUOI());
    expect(truoc).not.toBeNull();
    expect(laAnhChupHopLe(truoc!.anhChup)).toBe(true);
    expect(truoc!.anhChup.datCho).toHaveLength(4);
    // Toạ độ ĐÚNG thứ đã ghi, không phải thứ bảng sống đang có.
    expect(truoc!.anhChup.datCho[0].viTriXMm).toBe(9000);

    // Bảng SỐNG đổi (mô phỏng người dùng kéo máy sau khi ghi bản này).
    await sql`
      INSERT INTO twin_dat_cho ("tangId", "loaiThucThe", "thucTheId", "viTriXMm", "viTriYMm", "viTriZMm", nguon)
      VALUES (${fx!.tangTrongId}, 'machine', 999001, 12345, 6789, 0, 'tay')`;

    const sau = await traMotBanGhi(id, NGUOI());
    // ★★★ Con số KHÔNG ĐỔI. Một cài đặt "đọc lại bảng sống lúc khôi phục" sẽ
    //   cho `viTriXMm = 12345` ở đây — đó chính là đột biến ô này giết.
    expect(sau!.anhChup.datCho).toHaveLength(4);
    expect(sau!.anhChup.datCho[0].viTriXMm).toBe(9000);

    await sql`DELETE FROM twin_dat_cho WHERE "tangId" = ${fx!.tangTrongId} AND "thucTheId" = 999001`;
  });

  it("★★★ B3 — XUẤT BẢN bản thứ hai HẠ CỜ bản thứ nhất (mỗi tầng ≤ 1)", async () => {
    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    expect(ds.length).toBeGreaterThanOrEqual(2);
    const [mot, hai] = ds;

    await xuatBanBanGhi(mot.id, NGUOI());
    let dem = await sql`
      SELECT count(*)::int AS n FROM twin_ban_ghi
      WHERE "tangId" = ${fx!.tangTrongId} AND "daXuatBan" = true`;
    expect((dem[0] as unknown as { n: number }).n).toBe(1);

    await xuatBanBanGhi(hai.id, NGUOI());
    dem = await sql`
      SELECT count(*)::int AS n FROM twin_ban_ghi
      WHERE "tangId" = ${fx!.tangTrongId} AND "daXuatBan" = true`;
    // ★ Bỏ lượt hạ cờ trong `xuatBanBanGhi` ⇒ con số này thành 2 ⇒ ô ĐỎ.
    expect((dem[0] as unknown as { n: number }).n).toBe(1);

    // …và đúng BẢN THỨ HAI đang giữ cờ, không phải bản nào cũng được.
    const dsSau = await traBanGhi([fx!.tangTrongId], NGUOI());
    expect(dsSau.find((b) => b.id === hai.id)!.daXuatBan).toBe(true);
    expect(dsSau.find((b) => b.id === mot.id)!.daXuatBan).toBe(false);
  });

  it("xoá bản ĐANG XUẤT BẢN nói ra điều đó (người gọi cảnh báo được)", async () => {
    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    const dangXuat = ds.find((b) => b.daXuatBan)!;
    const kq = await xoaBanGhi(dangXuat.id, NGUOI());
    expect(kq).toEqual({ daXoa: true, daTungXuatBan: true });
    // Và nó biến mất thật — không phải chỉ báo cáo là đã xoá.
    const con = await sql`SELECT count(*)::int AS n FROM twin_ban_ghi WHERE id = ${dangXuat.id}`;
    expect((con[0] as unknown as { n: number }).n).toBe(0);
  });

  it("xoá bản CHƯA xuất bản ⇒ `daTungXuatBan: false` (đối chứng cho ô trên)", async () => {
    const ds = await traBanGhi([fx!.tangTrongId], NGUOI());
    const nhap = ds.find((b) => !b.daXuatBan);
    expect(nhap).toBeDefined();
    expect(await xoaBanGhi(nhap!.id, NGUOI())).toEqual({ daXoa: true, daTungXuatBan: false });
  });

  it("id không tồn tại ⇒ `null` ở cả ba đường, KHÔNG ném", async () => {
    expect(await traMotBanGhi(2_000_000_000, NGUOI())).toBeNull();
    expect(await xoaBanGhi(2_000_000_000, NGUOI())).toBeNull();
    expect(await xuatBanBanGhi(2_000_000_000, NGUOI())).toBeNull();
  });

  it("`traBanGhi([])` ⇒ `[]` mà không chạm DB (ca biên)", async () => {
    expect(await traBanGhi([], NGUOI())).toEqual([]);
  });
});

describe("laAnhChupHopLe — jsonb KHÔNG có lược đồ, lọc ở một chỗ", () => {
  it("nhận ảnh chụp đúng hình dạng", () => {
    expect(laAnhChupHopLe(anhChup(1, 0))).toBe(true);
  });

  it("★ từ chối `{}`, null, mảng, và phiên bản lạ", () => {
    expect(laAnhChupHopLe({})).toBe(false);
    expect(laAnhChupHopLe(null)).toBe(false);
    expect(laAnhChupHopLe([])).toBe(false);
    expect(laAnhChupHopLe({ phienBan: 2, datCho: [] })).toBe(false);
    expect(laAnhChupHopLe({ phienBan: 1, datCho: "khong-phai-mang" })).toBe(false);
  });
});
