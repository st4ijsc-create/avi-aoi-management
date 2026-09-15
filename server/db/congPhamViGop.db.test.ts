/**
 * CỔNG CSDL THẬT — Task 17b: **CỔNG PHẠM VI GỘP MỘT LẦN CHO CẢ DANH SÁCH TẦNG**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỚI NÀY ĐO **SỐ CÂU TRUY VẤN**, KHÔNG CHỈ ĐO KẾT QUẢ
 * ══════════════════════════════════════════════════════════════════════════════
 * Thiết kế `docs/superpowers/specs/2026-09-16-twin-canh-nhieu-nha-may.md` §2.2 đo
 * được trên dữ liệu thật, và công thức khớp TUYỆT ĐỐI với mã ở §1.3:
 *
 *     traDatChoTheoTang(N)  admin = 2N+1   ·  có phạm vi = 4N+1   (84 tầng ⇒ 337)
 *     traVungAnToan(N)      admin =  N+2   ·  có phạm vi = 3N+2   (84 tầng ⇒ 254,
 *                                                                 **dù trả 0 hàng**)
 *
 * Nguyên nhân KHÔNG phải SQL chậm: phạm vi được **phân giải lại từ đầu cho TỪNG
 * tầng** (`trongPhamVi` → `idsTrongPhamVi` → `resolveTenantFactoryScope` + một câu
 * `factories`, không bộ nhớ đệm nào ở giữa). Với vai giám đốc, thân `canhThietKe`
 * ba nhà máy tốn 611 câu / 667 ms, trong đó **591 câu (96,7 %)** là cổng.
 *
 * ⇒ Lưới đo bằng **bộ đếm CỦA CHÍNH SẢN PHẨM** (`queryMonitor.getQueryStats`, gắn
 *   vào `client.unsafe` — đúng đường drizzle gửi câu đi), KHÔNG đếm tay, KHÔNG suy
 *   từ mã. Đếm tay là đọc lời khai của mã, không phải đo hành vi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ BA LOẠI Ô, VÀ VÌ SAO PHẢI CÓ ĐỦ CẢ BA
 * ══════════════════════════════════════════════════════════════════════════════
 *   (A) ĐẾM CÂU     — bản vá có thật sự đổi hình dạng chi phí không.
 *   (B) KẾT QUẢ     — tập trả về **giống hệt** trước/sau, đối chiếu bằng một
 *                     ORACLE ĐỘC LẬP (SQL thô), không bằng lời khai của chính hàm.
 *   (C) HÀNG RÀO    — hai chiều: người ngoài phạm vi KHÔNG thấy, người trong phạm
 *                     vi VẪN thấy. Một tối ưu làm rò tenant là lỗi nặng hơn lỗi nó vá.
 *
 * ⚠ Thiếu (B) thì `return []` vô điều kiện làm (A) và nửa (C) xanh hoàn hảo.
 * ⚠ Thiếu (C) chiều DƯƠNG thì cùng bản vá ấy vẫn xanh.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ Ô "BỘ ĐẾM BIẾT KÊU" — G5 Ở TẦNG THIẾT BỊ ĐO
 * ══════════════════════════════════════════════════════════════════════════════
 * Mọi ô đếm câu ở đây đều XANH nếu bộ đếm hỏng và luôn trả 0. Nên có một ô dựng
 * lại **đúng khuôn N+1 cũ** ngay tại chỗ (gọi chính `trongPhamVi` của sản phẩm) và
 * đòi nó phải cho ra ≥ 2N câu. Ô đó ĐỎ khi bộ đếm mù ⇒ mọi ô còn lại mới có nghĩa.
 * Đây là phiên bản đo được của câu "thiết bị đo phải biết kêu trên ca dương đã biết".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI TỰ DỰNG LẤY TENANT + 84 TẦNG (G22)
 * ══════════════════════════════════════════════════════════════════════════════
 * `vitest.setup.ts` ép `DATABASE_URL` sang `aoi_management_test` — nơi KHÔNG có
 * dữ liệu QATD của đợt đo. Mượn id của DB dev sẽ cho "0 hàng" vì **người dùng
 * không tồn tại**, và chiều (−) xanh mà chưa hề chạm luật lọc. Nên lưới dựng lấy:
 * 2 nhà máy · 1 người được gán ĐÚNG MỘT nhà máy · 1 người KHÔNG gán · 3 toà ·
 * **84 tầng** (56 trong phạm vi + 28 ngoài) · 2 đặt chỗ mỗi tầng — rồi xoá đúng
 * chừng ấy theo id.
 *
 * ⚠ 84 tầng KHÔNG phải con số đẹp: đó đúng là số tầng của ba nhà máy QATD
 *   (12 toà × 7 tầng) mà thiết kế đã đo, nên công thức 4N+1/3N+2 đối chiếu được
 *   thẳng với bảng §2.2.
 *
 * ★ G20 — import CHÍNH `traDatChoTheoTang`/`traVungAnToan` của module giao hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { traDatChoTheoTang, traVungAnToan } from "./twinCanh";
import { trongPhamVi } from "./hierarchy";
import { getQueryStats } from "../queryMonitor";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `T17B-${Date.now()}`;

/** Vai KHÔNG phải admin — admin BYPASS cổng, đo bằng admin chứng minh số 0 vô nghĩa. */
const VAI = "supervisor";

/** 12 toà × 7 tầng của ba nhà máy QATD — xem docblock. */
const SO_TANG_TRONG = 56;
const SO_TANG_NGOAI = 28;
const SO_TANG_TONG = SO_TANG_TRONG + SO_TANG_NGOAI;
/** 2 đặt chỗ mỗi tầng ⇒ số hàng kỳ vọng ở chiều dương. */
const DAT_CHO_MOI_TANG = 2;

/**
 * Trần số câu sau khi gộp cổng.
 *
 * ⚠ Đây KHÔNG phải "số đẹp": đường gộp là **1 câu JOIN tầng→toà** + phép phân giải
 *   phạm vi MỘT lần (`resolveTenantFactoryScope` 1 câu + `factories` 1 câu) + 1 câu
 *   đọc dữ liệu = 4. Trần 6 chừa đúng biên độ cho bộ nhớ đệm gán hết hạn giữa chừng
 *   (TTL 30 s ở `accessControl`), KHÔNG chừa chỗ cho một vòng lặp theo tầng: khuôn
 *   N+1 với N = 84 cho 337 câu, cách trần này hai bậc độ lớn.
 */
const TRAN_CAU = 6;

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  facNgoaiCode: string;
  facNgoaiTen: string;
  /** Người được gán ĐÚNG nhà máy TRONG. */
  userId: number;
  /** Người KHÔNG được gán nhà máy nào — phạm vi RỖNG tường minh. */
  userKhongGanId: number;
  toaNhaIds: number[];
  tangTrongIds: number[];
  tangNgoaiIds: number[];
  datChoIds: number[];
  thucTheBase: number;
}
let fx: Fixture | null = null;

/** Phạm vi của người được gán một nhà máy. */
function scopeTrong() {
  return { userId: fx!.userId, userRole: VAI };
}

/**
 * Đếm số câu SQL mà một lời gọi sinh ra, bằng bộ đếm CỦA SẢN PHẨM.
 *
 * ⚠ `lamNong` chạy TRƯỚC mốc đếm: `getUserAssignmentCodes` có bộ nhớ đệm TTL 30 s
 *   (`server/_core/accessControl.ts:25`), nên lần gọi LẠNH tốn thêm câu và số đo
 *   sẽ nhảy tuỳ lúc. Làm nóng rồi mới đo là đo ĐÚNG trạng thái ổn định — và vẫn
 *   không che được khuôn N+1, vì N+1 lặp lại phép đọc `factories` chứ không lặp
 *   phép đọc bản gán.
 */
async function demCau<T>(lamNong: () => Promise<unknown>, f: () => Promise<T>) {
  await lamNong();
  const truoc = getQueryStats().totalQueries;
  const kq = await f();
  return { soCau: getQueryStats().totalQueries - truoc, kq };
}

async function taoNhaMay(code: string, ten: string): Promise<number> {
  const r = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

async function taoNguoi(nhan: string): Promise<number> {
  const u = await sql`
    INSERT INTO users ("openId", username, name, role, "isActive")
    VALUES (${`${DAU}-${nhan}-openid`}, ${`${DAU}-${nhan}`}, ${`${DAU} ${nhan}`}, ${VAI}, true)
    RETURNING id`;
  return (u[0] as unknown as { id: number }).id;
}

/** Một toà + `soTang` tầng của nó. Trả danh sách id tầng theo thứ tự tầng 1..N. */
async function taoToaVaTang(
  factoryId: number,
  nhan: string,
  soTang: number,
): Promise<{ toaNhaId: number; tangIds: number[] }> {
  const toa = await sql`
    INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon, "viTriXMm", "viTriYMm")
    VALUES (${factoryId}, ${`${DAU}-${nhan}`}, ${`${DAU} toa ${nhan}`}, 'tay', 0, 0)
    RETURNING id`;
  const toaNhaId = (toa[0] as unknown as { id: number }).id;
  const tangIds: number[] = [];
  for (let cap = 1; cap <= soTang; cap++) {
    const t = await sql`
      INSERT INTO twin_tang ("toaNhaId", "capSo", ten, nguon, "caoDoMm")
      VALUES (${toaNhaId}, ${cap}, ${`${DAU} ${nhan} tang ${cap}`}, 'tay', ${(cap - 1) * 6000})
      RETURNING id`;
    tangIds.push((t[0] as unknown as { id: number }).id);
  }
  return { toaNhaId, tangIds };
}

describe.skipIf(!DB_URL)("Task 17b — cổng phạm vi GỘP MỘT LẦN cho cả danh sách tầng", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const facNgoaiCode = `${DAU}-NGOAI`;
    const facNgoaiTen = `${DAU} nha may NGOAI pham vi`;
    const facTrongId = await taoNhaMay(facTrongCode, `${DAU} nha may TRONG pham vi`);
    const facNgoaiId = await taoNhaMay(facNgoaiCode, facNgoaiTen);

    const userId = await taoNguoi("nguoi-gan-A");
    const userKhongGanId = await taoNguoi("nguoi-khong-gan");
    // ⚠ Nối bằng `factoryCode` — bảng này KHÔNG có cột `factoryId` (42703 nếu sai).
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userId}, ${facTrongCode})`;

    // 56 tầng TRONG phạm vi, chia làm HAI toà: hai toà cùng một nhà máy là đúng
    // hình dạng đã sinh ra lỗi toạ độ ở Task 17c, và ở đây nó bảo đảm cổng không
    // vô tình đúng nhờ "mỗi nhà máy một toà".
    const t1 = await taoToaVaTang(facTrongId, "TRONG-1", SO_TANG_TRONG / 2);
    const t2 = await taoToaVaTang(facTrongId, "TRONG-2", SO_TANG_TRONG / 2);
    const t3 = await taoToaVaTang(facNgoaiId, "NGOAI-1", SO_TANG_NGOAI);

    const tangTrongIds = [...t1.tangIds, ...t2.tangIds];
    const tangNgoaiIds = t3.tangIds;

    // `uq_twin_dat_cho_thuc_the` là DUY NHẤT trên (loaiThucThe, thucTheId) ⇒ mỗi
    // hàng một `thucTheId` riêng, lấy từ một nền cao để không đụng dữ liệu khác.
    const thucTheBase = 1_000_000_000 + (Date.now() % 1_000_000);
    const datChoIds: number[] = [];
    let k = 0;
    for (const tangId of [...tangTrongIds, ...tangNgoaiIds]) {
      for (let j = 0; j < DAT_CHO_MOI_TANG; j++) {
        const r = await sql`
          INSERT INTO twin_dat_cho ("tangId", "loaiThucThe", "thucTheId", "viTriXMm", "viTriYMm", "viTriZMm", nguon)
          VALUES (${tangId}, 'machine', ${thucTheBase + k}, ${1000 + j * 10}, ${2000 + j * 10}, 0, 'tay')
          RETURNING id`;
        datChoIds.push((r[0] as unknown as { id: number }).id);
        k++;
      }
    }

    fx = {
      facTrongId,
      facTrongCode,
      facNgoaiId,
      facNgoaiCode,
      facNgoaiTen,
      userId,
      userKhongGanId,
      toaNhaIds: [t1.toaNhaId, t2.toaNhaId, t3.toaNhaId],
      tangTrongIds,
      tangNgoaiIds,
      datChoIds,
      thucTheBase,
    };
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      await sql`DELETE FROM twin_dat_cho WHERE id = ANY(${fx.datChoIds})`;
      await sql`DELETE FROM twin_tang WHERE id = ANY(${[...fx.tangTrongIds, ...fx.tangNgoaiIds]})`;
      await sql`DELETE FROM twin_toa_nha WHERE id = ANY(${fx.toaNhaIds})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${fx.userId}`;
      await sql`DELETE FROM users WHERE id = ANY(${[fx.userId, fx.userKhongGanId]})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* (0) DỮ KIỆN NỀN — không có nó, mọi ô dưới đo trên tập rỗng                 */
  /* ═════════════════════════════════════════════════════════════════════════ */

  it("dữ kiện nền DỰNG ĐƯỢC THẬT — 84 tầng (56 trong + 28 ngoài), 168 đặt chỗ", () => {
    expect(fx).not.toBeNull();
    expect(fx!.tangTrongIds).toHaveLength(SO_TANG_TRONG);
    expect(fx!.tangNgoaiIds).toHaveLength(SO_TANG_NGOAI);
    expect(fx!.tangTrongIds.length + fx!.tangNgoaiIds.length).toBe(SO_TANG_TONG);
    expect(fx!.datChoIds).toHaveLength(SO_TANG_TONG * DAT_CHO_MOI_TANG);
    expect(new Set(fx!.tangTrongIds).size).toBe(SO_TANG_TRONG);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, không phải 0", async () => {
    // "0 gán" và "được gán A, hỏi B" cho CÙNG kết quả rỗng. Ô này tách hai câu đó.
    const g = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([
      fx!.facTrongCode,
    ]);
    const g0 = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`;
    expect(g0).toHaveLength(0);
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* (A) ĐẾM CÂU — và trước hết, THIẾT BỊ ĐO PHẢI BIẾT KÊU                      */
  /* ═════════════════════════════════════════════════════════════════════════ */

  it("★★★ BỘ ĐẾM BIẾT KÊU — khuôn N+1 dựng lại tại chỗ vẫn cho ≥ 2N câu", async () => {
    // Ô này KHÔNG đo sản phẩm. Nó đo THIẾT BỊ ĐO: nếu `getQueryStats` mù (luôn 0)
    // thì mọi ô đếm câu bên dưới xanh giả. Vòng lặp dưới gọi chính `trongPhamVi`
    // của sản phẩm — đúng cái mà `traDatChoTheoTang` từng gọi mỗi tầng một lần.
    const N = 12;
    const { soCau } = await demCau(
      () => trongPhamVi("factory", fx!.facTrongId, scopeTrong()),
      async () => {
        for (let i = 0; i < N; i++) await trongPhamVi("factory", fx!.facTrongId, scopeTrong());
      },
    );
    console.log(`[T17b] khuôn N+1 dựng lại: N=${N} ⇒ ${soCau} câu`);
    expect(soCau).toBeGreaterThanOrEqual(2 * N);
  });

  it("★★★ traDatChoTheoTang — 84 tầng tốn ≤ 6 câu (trước bản vá: 4N+1 = 337)", async () => {
    const tatCa = [...fx!.tangTrongIds, ...fx!.tangNgoaiIds];
    const { soCau, kq } = await demCau(
      () => traDatChoTheoTang([tatCa[0]], scopeTrong()),
      () => traDatChoTheoTang(tatCa, scopeTrong()),
    );
    console.log(`[T17b] traDatChoTheoTang(${tatCa.length} tầng) = ${soCau} câu, ${kq.length} hàng`);
    // Ràng buộc số lượng: 0 hàng thì ô này tự thoả trên tập rỗng (G5).
    expect(kq.length).toBe(SO_TANG_TRONG * DAT_CHO_MOI_TANG);
    expect(soCau).toBeLessThanOrEqual(TRAN_CAU);
  });

  it("★★★ SỐ CÂU KHÔNG TĂNG THEO SỐ TẦNG — 84 tầng ≤ 1 tầng + 1", async () => {
    // Đây là BẤT BIẾN, không phải một ngưỡng: mọi khuôn N+1 vỡ ô này bất kể hằng
    // số, còn mọi khuôn gộp đều qua. Ngưỡng tuyệt đối ở ô trên có thể phải nới khi
    // hạ tầng đổi; bất biến này thì không.
    const tatCa = [...fx!.tangTrongIds, ...fx!.tangNgoaiIds];
    const mot = await demCau(
      () => traDatChoTheoTang([tatCa[0]], scopeTrong()),
      () => traDatChoTheoTang([fx!.tangTrongIds[0]], scopeTrong()),
    );
    const nhieu = await demCau(
      () => traDatChoTheoTang([tatCa[0]], scopeTrong()),
      () => traDatChoTheoTang(tatCa, scopeTrong()),
    );
    console.log(`[T17b] 1 tầng = ${mot.soCau} câu · 84 tầng = ${nhieu.soCau} câu`);
    expect(mot.kq.length).toBe(DAT_CHO_MOI_TANG);
    expect(nhieu.soCau).toBeLessThanOrEqual(mot.soCau + 1);
  });

  it("★★★ traVungAnToan — 84 tầng tốn ≤ 6 câu DÙ TRẢ VỀ 0 HÀNG (trước: 3N+2 = 254)", async () => {
    // Chỗ đắt nhất của cả màn: 254 câu để trả về đúng con số không. Ô này là lý do
    // bản vá phải chạm `locTangTrongPhamVi`, không chỉ `traDatChoTheoTang`.
    const tatCa = [...fx!.tangTrongIds, ...fx!.tangNgoaiIds];
    const { soCau, kq } = await demCau(
      () => traVungAnToan([tatCa[0]], scopeTrong()),
      () => traVungAnToan(tatCa, scopeTrong()),
    );
    console.log(`[T17b] traVungAnToan(${tatCa.length} tầng) = ${soCau} câu, ${kq.length} hàng`);
    expect(kq).toEqual([]);
    expect(soCau).toBeLessThanOrEqual(TRAN_CAU);
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* (B) KẾT QUẢ KHÔNG ĐỔI — đối chiếu bằng ORACLE ĐỘC LẬP                      */
  /* ═════════════════════════════════════════════════════════════════════════ */

  it("★★★ KẾT QUẢ — tập đặt chỗ khớp ĐÚNG oracle SQL thô, không thừa không thiếu", async () => {
    // Oracle KHÔNG gọi hàm sản phẩm: nó hỏi thẳng DB "những đặt chỗ nào nằm trên
    // tầng thuộc nhà máy TRONG phạm vi". Một bản vá đổi cách lọc mà lệch kết quả
    // sẽ đỏ ở đây, kể cả khi số câu đẹp.
    const tatCa = [...fx!.tangTrongIds, ...fx!.tangNgoaiIds];
    const kq = await traDatChoTheoTang(tatCa, scopeTrong());
    const oracle = await sql`
      SELECT dc.id FROM twin_dat_cho dc
      JOIN twin_tang s ON s.id = dc."tangId"
      JOIN twin_toa_nha b ON b.id = s."toaNhaId"
      WHERE dc.id = ANY(${fx!.datChoIds}) AND b."factoryId" = ${fx!.facTrongId}
      ORDER BY dc.id`;
    const idOracle = (oracle as unknown as Array<{ id: number }>).map((r) => r.id);
    expect(idOracle).toHaveLength(SO_TANG_TRONG * DAT_CHO_MOI_TANG);
    expect([...kq.map((h) => h.id)].sort((a, b) => a - b)).toEqual(idOracle);
  });

  it("★★★ KẾT QUẢ — toạ độ numeric vẫn về dạng SỐ, không phải chuỗi", async () => {
    // Quy đổi numeric→number là bất biến của chính hàm này (docblock: string lọt
    // lên client thì mọi phép cộng toạ độ thành NỐI CHUỖI). Gộp cổng không được
    // đụng vào nó — ô này ghim điều đó lại.
    const kq = await traDatChoTheoTang([fx!.tangTrongIds[0]], scopeTrong());
    expect(kq).toHaveLength(DAT_CHO_MOI_TANG);
    for (const h of kq) {
      expect(typeof h.viTriXMm).toBe("number");
      expect(typeof h.viTriYMm).toBe("number");
      expect(typeof h.quatW).toBe("number");
    }
    expect(kq.map((h) => h.viTriXMm).sort((a, b) => a - b)).toEqual([1000, 1010]);
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* (C) HÀNG RÀO — HAI CHIỀU                                                   */
  /* ═════════════════════════════════════════════════════════════════════════ */

  it("★★★ (−) chỉ hỏi tầng NGOÀI phạm vi ⇒ RỖNG, và KHÔNG rò mã/tên nhà máy ngoài", async () => {
    const kq = await traDatChoTheoTang(fx!.tangNgoaiIds, scopeTrong());
    expect(kq).toEqual([]);
    const chuoi = JSON.stringify(kq);
    expect(chuoi).not.toContain(fx!.facNgoaiCode);
    expect(chuoi).not.toContain(fx!.facNgoaiTen);
  });

  it("★★★ (−) BIẾT KÊU — CHÍNH những tầng ấy CÓ dữ liệu khi gọi không mang danh tính", async () => {
    // Nếu không có ô này, ô trên xanh y hệt khi 28 tầng NGOÀI vốn rỗng — tức đo
    // "không ai phát sóng" chứ không đo hàng rào (G22).
    const kq = await traDatChoTheoTang(fx!.tangNgoaiIds, undefined);
    expect(kq).toHaveLength(SO_TANG_NGOAI * DAT_CHO_MOI_TANG);
  });

  it("★★★ (−) TRỘN trong+ngoài ⇒ chỉ phần TRONG sống sót, không 'tất cả hoặc không gì'", async () => {
    // Bắt hai bản vá sai cùng lúc: "có mã lạ thì trả rỗng hết" (mất dữ liệu hợp lệ)
    // và "có mã hợp lệ thì cho qua cả danh sách" (rò tenant).
    const kq = await traDatChoTheoTang([...fx!.tangTrongIds, ...fx!.tangNgoaiIds], scopeTrong());
    expect(kq.length).toBe(SO_TANG_TRONG * DAT_CHO_MOI_TANG);
    const tapNgoai = new Set(fx!.tangNgoaiIds);
    expect(kq.some((h) => h.tangId !== null && tapNgoai.has(h.tangId))).toBe(false);
  });

  it("★★★ (+) người TRONG phạm vi VẪN đọc được đủ tầng của mình — chống vá quá tay", async () => {
    const kq = await traDatChoTheoTang(fx!.tangTrongIds, scopeTrong());
    expect(kq).toHaveLength(SO_TANG_TRONG * DAT_CHO_MOI_TANG);
    expect(new Set(kq.map((h) => h.tangId)).size).toBe(SO_TANG_TRONG);
  });

  it("★★★ (−) 0 gán ⇒ phạm vi RỖNG TƯỜNG MINH, không phải 'không lọc'", async () => {
    // `factoryIds: []` phải sinh một mệnh đề chặn, không phải bỏ qua cổng. Đây là
    // ca fail-closed mà một phép tối ưu `if (!ids.length) return tatCa` sẽ phá.
    const kq = await traDatChoTheoTang([...fx!.tangTrongIds, ...fx!.tangNgoaiIds], {
      userId: fx!.userKhongGanId,
      userRole: VAI,
    });
    expect(kq).toEqual([]);
  });

  it("★★★ lối KHÔNG mang danh tính đọc được CẢ HAI nhà máy — chiều dương của phạm vi", async () => {
    const kq = await traDatChoTheoTang([...fx!.tangTrongIds, ...fx!.tangNgoaiIds], undefined);
    expect(kq).toHaveLength(SO_TANG_TONG * DAT_CHO_MOI_TANG);
  });

  it("★★★ tầng TRÙNG LẶP và tầng KHÔNG TỒN TẠI ⇒ im lặng bỏ, không lỗi, không hàng thừa", async () => {
    const t = fx!.tangTrongIds[0];
    const kq = await traDatChoTheoTang([t, t, t, 2_000_000_001, 2_000_000_002], scopeTrong());
    expect(kq).toHaveLength(DAT_CHO_MOI_TANG);
    expect(new Set(kq.map((h) => h.tangId))).toEqual(new Set([t]));
  });

  it("★★★ CỔNG TẦNG ĐỨNG ĐỘC LẬP — chỉ nhận tangIds + phạm vi, không nhận mã nhà máy", async () => {
    // Hàng rào phải suy nhà máy của tầng TỪ DB (`twin_tang → twin_toa_nha`), không
    // từ một danh sách mã do phía gọi truyền kèm. Ô này ghim HÌNH DẠNG HỢP ĐỒNG:
    // hai tham số, và tham số thứ hai là phạm vi người xem. Thêm một tham số
    // "danh sách mã nhà máy" là mở lại đúng lỗ `pham-vi-tenant-dot-lon` (lọc theo
    // cột client tự khai) — và ô này sẽ đỏ trước khi ai kịp gọi nó.
    expect(traDatChoTheoTang.length).toBe(2);
    expect(traVungAnToan.length).toBe(2);
  });
});
