/**
 * CỔNG CSDL THẬT — hàng rào tenant có BÍT hay không.
 *
 * ⚠⚠ CA KIỂM NÀY CHỈ CÓ NGHĨA KHI CHẠY BẰNG VAI KHÔNG ĐẶC QUYỀN.
 * Đo được 2026-08-18: `aoi` là superuser + BYPASSRLS + chủ sở hữu 42 bảng có RLS.
 * Chạy đúng bộ ca này bằng `aoi` cho ra con số Y HỆT NHAU ở CẢ BỐN tình huống
 * (không GUC / đúng tenant / SAI tenant / bypass) — tức lưới sẽ XANH kể cả khi
 * mọi chính sách đã bị xoá sạch. Vì vậy ca ĐẦU TIÊN dưới đây là một cầu chì: nó
 * ĐỎ nếu vai đo có `rolsuper` hoặc `rolbypassrls`. Không có cầu chì đó, tất cả
 * các ca còn lại là thước xanh giả.
 *
 * ── ÂM ĐỐI XỨNG (điều thật sự phải chứng minh) ─────────────────────────────
 * "A không thấy B" một mình KHÔNG đủ — một chính sách hỏng theo kiểu "cấm tất"
 * cũng thoả nó. Phải kèm "B ra ĐÚNG số của riêng B". Cả hai chiều đều ở đây.
 *
 * ── ĐỘT BIẾN mà lưới này bắt được ─────────────────────────────────────────
 *   (a) không bật GUC `app.tenant_rls_active`  ⇒ ca "A không thấy B" ĐỎ
 *   (b) đặt SAI tenant vào GUC                 ⇒ ca "B thấy đủ B" ĐỎ
 *   (c) hoàn nguyên 0327 (bỏ nhánh NULL/NULL)  ⇒ ca "hàng vô chủ vẫn hiện" ĐỎ
 *   (d) lối đi KHÔNG danh tính                 ⇒ VẪN chạy (ca chống vá quá tay)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { like } from "drizzle-orm";
import { suppliers as bangSuppliers } from "../../drizzle/schema";

const DB_URL = process.env.DATABASE_URL;

/** Tiền tố CHỈ dùng cho ca kiểm này — dọn dẹp chỉ chạm hàng do chính nó tạo. */
const PFX = "RLSGATE-";
const FAC_A = `${PFX}FAC-A`;
const FAC_B = `${PFX}FAC-B`;

let sql: ReturnType<typeof postgres>;

/** Đọc trong MỘT giao dịch có GUC đặt sẵn — đúng cơ chế `withTenantScope` dùng. */
async function demTrongPhamVi(guc: {
  active?: string;
  bypass?: string;
  factories?: string;
  corporates?: string;
}): Promise<{ a: number; b: number; voChu: number }> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_rls_active', ${guc.active ?? "on"}, true)`;
    await tx`SELECT set_config('app.tenant_bypass', ${guc.bypass ?? "off"}, true)`;
    await tx`SELECT set_config('app.tenant_factory_codes', ${guc.factories ?? ""}, true)`;
    await tx`SELECT set_config('app.tenant_corporate_codes', ${guc.corporates ?? ""}, true)`;
    const [a] = await tx`SELECT count(*)::int n FROM suppliers WHERE code LIKE ${PFX + "%"} AND "factoryCode" = ${FAC_A}`;
    const [b] = await tx`SELECT count(*)::int n FROM suppliers WHERE code LIKE ${PFX + "%"} AND "factoryCode" = ${FAC_B}`;
    const [v] = await tx`SELECT count(*)::int n FROM suppliers WHERE code LIKE ${PFX + "%"} AND "factoryCode" IS NULL`;
    return { a: a.n, b: b.n, voChu: v.n };
  });
}

describe.skipIf(!DB_URL)("cưỡng chế tenant ở tầng CSDL (suppliers)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`DELETE FROM suppliers WHERE code LIKE ${PFX + "%"}`;
    // 2 hàng thuộc A, 3 hàng thuộc B, 1 hàng VÔ CHỦ (không mang mã tenant nào).
    // Số lệch nhau có chủ đích: một chính sách trả nhầm bảng/nhầm chiều sẽ lộ ra
    // ở con số, không chỉ ở "khác 0".
    await sql`
      INSERT INTO suppliers (code, name, "factoryCode") VALUES
        (${PFX + "A1"}, 'RLS gate A1', ${FAC_A}),
        (${PFX + "A2"}, 'RLS gate A2', ${FAC_A}),
        (${PFX + "B1"}, 'RLS gate B1', ${FAC_B}),
        (${PFX + "B2"}, 'RLS gate B2', ${FAC_B}),
        (${PFX + "B3"}, 'RLS gate B3', ${FAC_B}),
        (${PFX + "N1"}, 'RLS gate vo chu', NULL)`;
  });

  afterAll(async () => {
    if (sql) await sql`DELETE FROM suppliers WHERE code LIKE ${PFX + "%"}`;
    await sql?.end();
  });

  it("CẦU CHÌ — vai đo phải THỰC SỰ chịu RLS (không superuser, không BYPASSRLS)", async () => {
    const [r] = await sql<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(
      r.rolsuper,
      `vai "${r.u}" là superuser ⇒ RLS bị bỏ qua ⇒ MỌI ca dưới đây xanh giả. ` +
        `Trỏ DATABASE_URL vào vai ứng dụng (avi_app), không phải owner (aoi).`,
    ).toBe(false);
    expect(r.rolbypassrls, `vai "${r.u}" có BYPASSRLS ⇒ lưới vô nghĩa`).toBe(false);

    // …và bảng đo phải đang BẬT RLS. RLS tắt = mọi ca cũng xanh giả.
    const [t] = await sql<{ on: boolean }[]>`
      SELECT c.relrowsecurity AS on FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = 'suppliers'`;
    expect(t.on, "suppliers không bật RLS ⇒ không có gì để cưỡng chế").toBe(true);
  });

  it("ÂM ĐỐI XỨNG — A không thấy B, VÀ B ra đúng số của riêng B", async () => {
    const nhinTuA = await demTrongPhamVi({ factories: FAC_A });
    const nhinTuB = await demTrongPhamVi({ factories: FAC_B });

    // chiều 1: A bị chặn khỏi B
    expect(nhinTuA.b, "A vẫn đọc được hàng của B ⇒ hàng rào KHÔNG bít").toBe(0);
    // chiều 2 (chống "cấm tất"): A vẫn ra ĐÚNG số của riêng A
    expect(nhinTuA.a, "A không thấy chính hàng của A ⇒ vá quá tay, đây là sự cố chứ không phải cách ly").toBe(2);

    // đối xứng ngược lại
    expect(nhinTuB.a).toBe(0);
    expect(nhinTuB.b).toBe(3);
  });

  it("ĐỘT BIẾN (a) — KHÔNG bật GUC ⇒ hàng rào biến mất (chứng minh ca trên đo thật)", async () => {
    const khongGuc = await demTrongPhamVi({ active: "off", factories: FAC_A });
    // Đúng cái mà ca "âm đối xứng" đòi phải bằng 0. Không bật GUC ⇒ 3.
    expect(khongGuc.b).toBe(3);
    expect(khongGuc.a).toBe(2);
  });

  it("ĐỘT BIẾN (b) — tenant SAI ⇒ không thấy gì có chủ (nhưng hàng vô chủ vẫn hiện)", async () => {
    const sai = await demTrongPhamVi({ factories: `${PFX}KHONG-TON-TAI` });
    expect(sai.a).toBe(0);
    expect(sai.b).toBe(0);
  });

  it("0327 — hàng KHÔNG mang mã tenant nào vẫn HIỆN với người dùng có phạm vi", async () => {
    // Trước 0327 ô này là 0 ⇒ 352/388 hàng trên CSDL dev biến mất khỏi màn hình.
    // Hoàn nguyên 0327 (bỏ nhánh `p_factory IS NULL AND p_corporate IS NULL`) ⇒ ca này ĐỎ.
    for (const g of [{ factories: FAC_A }, { factories: FAC_B }, { factories: `${PFX}KHONG-TON-TAI` }]) {
      const r = await demTrongPhamVi(g);
      expect(r.voChu, `hàng vô chủ bị ẩn với phạm vi ${JSON.stringify(g)}`).toBe(1);
    }
  });

  it("bypass (admin/dịch vụ) ⇒ thấy TẤT CẢ", async () => {
    const r = await demTrongPhamVi({ bypass: "on", factories: FAC_A });
    expect(r.a).toBe(2);
    expect(r.b).toBe(3);
    expect(r.voChu).toBe(1);
  });

  it("ĐỘT BIẾN (c) — lối đi KHÔNG mang danh tính vẫn chạy, thấy đủ (chống vá quá tay)", async () => {
    // Tác vụ nền / cron / MQTT ingest / khoá master: không giao dịch, không GUC.
    // Đây là truy vấn Y HỆT cách chúng đang chạy hôm nay.
    const [a] = await sql`SELECT count(*)::int n FROM suppliers WHERE "factoryCode" = ${FAC_A}`;
    const [b] = await sql`SELECT count(*)::int n FROM suppliers WHERE "factoryCode" = ${FAC_B}`;
    expect(a.n).toBe(2);
    expect(b.n).toBe(3);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // NỐI CẢ HAI NỬA: ALS (danh tính) → `chayTheoPhamViTenantHienTai` → drizzle →
  // vị từ RLS trên CSDL thật. Đây là ĐÚNG hình dạng lời gọi mà
  // `masterDataRouter.listAll`/`getOne` dùng sau 2026-08-18.
  //
  // `tenantContextNoi.unit.test.ts` đã canh phần QUYẾT ĐỊNH bằng db giả — nó
  // không thể phát hiện việc handle giao dịch bị truyền sai, GUC không tới được
  // câu lệnh, hay drizzle mở connection khác. Ca dưới đây đi hết đường thật.
  // ══════════════════════════════════════════════════════════════════════════
  describe("chồng hai lớp: ALS + drizzle + RLS thật (hình dạng của masterDataRouter)", () => {
    const coCu = process.env.TENANT_RLS_ENABLED;
    beforeAll(() => {
      // `vitest.setup` CỐ Ý không nạp .env ⇒ cờ mặc định TẮT trong test. Bật ở đây.
      process.env.TENANT_RLS_ENABLED = "true";
    });
    afterAll(() => {
      if (coCu === undefined) delete process.env.TENANT_RLS_ENABLED;
      else process.env.TENANT_RLS_ENABLED = coCu;
    });

    async function docQuaDrizzle(scope: { factoryCodes?: string[]; bypass?: boolean } | null) {
      const { getDb } = await import("./connection");
      const { chayVoiDanhTinhTenant, chayTheoPhamViTenantHienTai } = await import("./tenantContext");
      const d = await getDb();
      if (!d) throw new Error("khong co CSDL — ca nay phai chay that");
      const doc = () =>
        chayTheoPhamViTenantHienTai(d, async (h) => h.select().from(bangSuppliers).where(like(bangSuppliers.code, `${PFX}%`)));
      const rows = scope ? await chayVoiDanhTinhTenant(scope, doc) : await doc();
      return {
        a: rows.filter((r) => r.factoryCode === FAC_A).length,
        b: rows.filter((r) => r.factoryCode === FAC_B).length,
        voChu: rows.filter((r) => r.factoryCode === null).length,
      };
    }

    it("ÂM ĐỐI XỨNG qua đường thật — A không thấy B, VÀ B ra đúng số của B", async () => {
      const tuA = await docQuaDrizzle({ factoryCodes: [FAC_A] });
      const tuB = await docQuaDrizzle({ factoryCodes: [FAC_B] });
      expect(tuA.b, "A đọc được hàng của B qua đường drizzle ⇒ GUC KHÔNG tới được câu lệnh").toBe(0);
      expect(tuA.a, "A không thấy hàng của chính A ⇒ vá quá tay").toBe(2);
      expect(tuB.a).toBe(0);
      expect(tuB.b).toBe(3);
      // 0327 phải còn nguyên trên đường này nữa, không chỉ trên SQL thô.
      expect(tuA.voChu).toBe(1);
      expect(tuB.voChu).toBe(1);
    });

    it("CHỐNG VÁ QUÁ TAY — không danh tính (tác vụ nền) ⇒ thấy ĐỦ, không trắng màn hình", async () => {
      const r = await docQuaDrizzle(null);
      expect(r.a).toBe(2);
      expect(r.b).toBe(3);
      expect(r.voChu).toBe(1);
    });

    it("CHỐNG VÁ QUÁ TAY — tài khoản 0 gán nhà máy (phạm vi RỖNG) ⇒ thấy ĐỦ", async () => {
      // Cố ý: `quyetDinhCuongChe` trả "pham-vi-rong" ⇒ KHÔNG cưỡng chế. Quyết định
      // "người chưa được gán nhà máy thấy gì" thuộc `accessControl.DENY_ALL_ROWS`,
      // nơi CÓ kênh giải thích; RLS lọc im lặng nên ép ở đây = màn hình trắng nói dối.
      const r = await docQuaDrizzle({ factoryCodes: [] });
      expect(r.a).toBe(2);
      expect(r.b).toBe(3);
      expect(r.voChu).toBe(1);
    });

    it("cờ TẮT ⇒ pass-through, thấy đủ (dù ALS có danh tính hẹp)", async () => {
      process.env.TENANT_RLS_ENABLED = "false";
      try {
        const r = await docQuaDrizzle({ factoryCodes: [FAC_A] });
        expect(r.b, "cờ tắt mà vẫn lọc ⇒ đã phá lối thoát an toàn").toBe(3);
      } finally {
        process.env.TENANT_RLS_ENABLED = "true";
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 0328 — NĂM BẢNG NÓNG: chốt lại phán quyết ĐO ĐƯỢC, để nó không lặng lẽ đảo.
//
// Ba trong năm bảng KHÔNG THỂ bật RLS (TimescaleDB từ chối 0A000 với hypertable
// có columnstore); bảng thứ tư (`wip_tracking`) bật được nhưng ĐẮT 108× (và
// 2.400× cho truy vấn phân trang) nên CỐ Ý không bật. Chi tiết + số đo nằm ở
// `drizzle/0328_tenant_rls_bang_nong_cai_lam_duoc.sql`.
//
// ⚠ Ca dưới đây KHÔNG thử `ALTER TABLE` — vai đo là `avi_app`, nó sẽ vỡ 42501
// (thiếu quyền) chứ không phải 0A000, và một bằng chứng như thế là bằng chứng
// GIẢ: nó đúng vì lý do khác. Phép thử 0A000 chạy bằng owner `aoi` nằm ở
// `scripts/apply-migration-0328.mjs`. Ở đây canh BẤT BIẾN hệ quả: ba bảng ấy là
// hypertable có columnstore ⇒ `relrowsecurity` PHẢI còn false.
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!DB_URL)("0328 — phán quyết năm bảng nóng", () => {
  let s: ReturnType<typeof postgres>;
  const PKG = "PKG0328-";
  const F_A = `${PKG}FAC-A`;
  const F_B = `${PKG}FAC-B`;

  beforeAll(async () => {
    s = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await s`DELETE FROM inspection_packages WHERE "packageId" LIKE ${PKG + "%"}`;
    // 2 thuộc A · 3 thuộc B · 1 vô chủ — số lệch nhau có chủ đích, y như khối trên.
    await s`
      INSERT INTO inspection_packages ("inspectionId","machineId","packageId","storageKey","serialNumber","factoryCode","inspectionTime") VALUES
        (1, 1, ${PKG + "A1"}, 'k/a1', 'SA1', ${F_A}, now()),
        (1, 1, ${PKG + "A2"}, 'k/a2', 'SA2', ${F_A}, now()),
        (1, 1, ${PKG + "B1"}, 'k/b1', 'SB1', ${F_B}, now()),
        (1, 1, ${PKG + "B2"}, 'k/b2', 'SB2', ${F_B}, now()),
        (1, 1, ${PKG + "B3"}, 'k/b3', 'SB3', ${F_B}, now()),
        (1, 1, ${PKG + "N1"}, 'k/n1', 'SN1', NULL,  now())`;
  });

  afterAll(async () => {
    if (s) await s`DELETE FROM inspection_packages WHERE "packageId" LIKE ${PKG + "%"}`;
    await s?.end();
  });

  async function dem(guc: { active?: string; bypass?: string; factories?: string }) {
    return s.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_rls_active', ${guc.active ?? "on"}, true)`;
      await tx`SELECT set_config('app.tenant_bypass', ${guc.bypass ?? "off"}, true)`;
      await tx`SELECT set_config('app.tenant_factory_codes', ${guc.factories ?? ""}, true)`;
      await tx`SELECT set_config('app.tenant_corporate_codes', '', true)`;
      const q = async (w: string) =>
        (await tx.unsafe(`SELECT count(*)::int n FROM inspection_packages WHERE "packageId" LIKE '${PKG}%' AND ${w}`))[0].n as number;
      return { a: await q(`"factoryCode" = '${F_A}'`), b: await q(`"factoryCode" = '${F_B}'`), voChu: await q(`"factoryCode" IS NULL`) };
    });
  }

  it("CẦU CHÌ — vai đo chịu RLS, và `inspection_packages` ĐANG bật RLS", async () => {
    const [r] = await s<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r.rolsuper, `vai "${r.u}" là superuser ⇒ mọi ca dưới xanh giả`).toBe(false);
    expect(r.rolbypassrls).toBe(false);
    const [t] = await s<{ on: boolean }[]>`
      SELECT c.relrowsecurity AS on FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = 'inspection_packages'`;
    expect(t.on, "0328 chưa được áp — chạy `node scripts/apply-migration-0328.mjs`").toBe(true);
  });

  it("ÂM ĐỐI XỨNG trên inspection_packages — A không thấy B, VÀ B ra đúng của B", async () => {
    const tuA = await dem({ factories: F_A });
    const tuB = await dem({ factories: F_B });
    expect(tuA.b, "A đọc được gói của B ⇒ hàng rào KHÔNG bít").toBe(0);
    expect(tuA.a, "A không thấy gói của chính A ⇒ vá quá tay").toBe(2);
    expect(tuB.a).toBe(0);
    expect(tuB.b).toBe(3);
  });

  it("ĐỘT BIẾN — KHÔNG bật GUC ⇒ hàng rào biến mất (chứng minh ca trên đo thật)", async () => {
    const r = await dem({ active: "off", factories: F_A });
    expect(r.b).toBe(3);
    expect(r.a).toBe(2);
  });

  it("0327 còn nguyên — gói KHÔNG mang mã nhà máy vẫn hiện với mọi phạm vi", async () => {
    for (const g of [{ factories: F_A }, { factories: F_B }, { factories: `${PKG}KHONG-CO` }]) {
      expect((await dem(g)).voChu, `gói vô chủ bị ẩn với ${JSON.stringify(g)}`).toBe(1);
    }
  });

  it("CHỐNG VÁ QUÁ TAY — đường ghi/đọc KHÔNG danh tính (máy đẩy gói lên) vẫn chạy", async () => {
    const [a] = await s`SELECT count(*)::int n FROM inspection_packages WHERE "factoryCode" = ${F_A}`;
    const [b] = await s`SELECT count(*)::int n FROM inspection_packages WHERE "factoryCode" = ${F_B}`;
    expect(a.n).toBe(2);
    expect(b.n).toBe(3);
    // …và INSERT không danh tính (MQTT/edge ingest) không bị `WITH CHECK` chặn.
    await s`INSERT INTO inspection_packages ("inspectionId","machineId","packageId","storageKey","serialNumber","factoryCode","inspectionTime")
            VALUES (1, 1, ${PKG + "INGEST"}, 'k/i', 'SI', ${F_B}, now())`;
    const [sau] = await s`SELECT count(*)::int n FROM inspection_packages WHERE "packageId" = ${PKG + "INGEST"}`;
    expect(sau.n, "ingest không danh tính bị WITH CHECK chặn ⇒ mất dữ liệu máy").toBe(1);
  });

  it("wip_tracking PHẢI còn TẮT — 108× (và 2.400× khi phân trang), xem 0328 §2", async () => {
    const [t] = await s<{ on: boolean }[]>`
      SELECT c.relrowsecurity AS on FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = 'wip_tracking'`;
    expect(
      t.on,
      "ai đó đã bật RLS cho wip_tracking. Vị từ buộc gọi `app_factory_of_line_id` (SECURITY DEFINER, " +
        "3 bảng) MỖI HÀNG, kể cả khi cờ TẮT, vì nó là ĐỐI SỐ nên được đánh giá trước phép đoản mạch. " +
        "Đo trên aoi_management/7.047 hàng: count 0,45→48,7 ms; ORDER BY … LIMIT 50: 0,02→50,0 ms. " +
        "Muốn phủ bảng này thì phi chuẩn hoá một cột factoryCode + backfill, đừng dùng hàm phân giải.",
    ).toBe(false);
  });

  it("ba hypertable KHÔNG bật RLS được — bất biến: có columnstore ⇒ relrowsecurity=false", async () => {
    const ten = ["product_inspections", "oee_metrics", "process_results"];
    const rls = await s<{ relname: string; on: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS on FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = ANY(${ten})`;
    const nen = await s<{ hypertable_name: string; compression_enabled: boolean }[]>`
      SELECT hypertable_name, compression_enabled FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'public' AND hypertable_name = ANY(${ten})`;
    expect(rls.length, "ba bảng nóng phải tồn tại").toBe(3);
    expect(nen.length, "ba bảng nóng phải là hypertable").toBe(3);
    for (const h of nen) {
      expect(h.compression_enabled, `${h.hypertable_name} KHÔNG còn columnstore ⇒ đọc lại 0328 §1, RLS có thể đã bật được`).toBe(true);
      expect(
        rls.find((r) => r.relname === h.hypertable_name)?.on,
        `${h.hypertable_name} bật được RLY dù có columnstore ⇒ TimescaleDB đã đổi hành vi, đo lại toàn bộ 0328`,
      ).toBe(false);
    }
  });
});
