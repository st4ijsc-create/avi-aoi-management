/**
 * CỔNG CSDL THẬT — Twin 3D Đợt 3 CHẶN-2: "xoá mềm rồi tạo lại cùng mã".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LỖI ĐƯỢC CANH
 * ══════════════════════════════════════════════════════════════════════════════
 * Migration 0350 dựng UNIQIE **không** vị từ `isActive`, còn `twinCanh.ts` xoá
 * MỀM. Cộng lại: dựng 'TN-A' → gõ nhầm → xoá → dựng lại 'TN-A' ⇒ 23505, và
 * KHÔNG có đường nào trong UI lấy lại mã đó ⇒ mã mất VĨNH VIỄN. Kèm theo, lỗi
 * chưa dịch rò NGUYÊN VĂN câu INSERT + tên mọi cột xuống client.
 * Migration 0355 (partial unique) + `ghiBatTrungKhoa` trong `twinCanh.ts` vá cả hai.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN mà lưới này bắt được (đã đo tay, xem báo cáo Đợt 3 vá lỗi)
 * ══════════════════════════════════════════════════════════════════════════════
 *   (a) hoàn nguyên 0355 (bỏ `WHERE "isActive"`)        ⇒ ca "tạo lại sau xoá mềm" ĐỎ
 *   (b) bỏ `ghiBatTrungKhoa` khỏi nhánh insert          ⇒ ca "trùng hàng SỐNG" ĐỎ
 *       (lỗi thành `INTERNAL_SERVER_ERROR`, không phải `CONFLICT`)
 *   (c) bỏ `ghiBatTrungKhoa` khỏi nhánh UPDATE          ⇒ ca "SỬA sang mã đã có" ĐỎ
 *   (d) `laTrungKhoa` chỉ đọc tầng ngoài (không đi `err.cause`) ⇒ mọi ca CONFLICT ĐỎ
 *
 * ⚠ Ca "trùng hàng SỐNG" đo CẢ HAI mặt: mã lỗi ĐÚNG (`CONFLICT`/`ENTITY_DUPLICATE`)
 *   **và** thông điệp KHÔNG chứa mảnh SQL. Chỉ đo mã lỗi là bỏ sót đúng nửa còn lại
 *   của lỗi gốc (rò lược đồ) — nửa mà không assertion nào của Đợt 3 từng canh.
 *
 * ⚠ DỌN SẠCH ở `afterAll` bằng id đã ghi lại: hai bảng này KHÔNG phải WORM (xoá
 *   cứng được), nên lưới không để lại hàng rác. Khoá probe vẫn mang timestamp vì
 *   nó phải KHÁC nhau giữa các ca trong CÙNG một lượt chạy (đang đo chính ràng
 *   buộc trùng mã) — an toàn vì có dọn thật, khác ca WORM của BG-93.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { luuToaNha, xoaToaNha, luuTang, xoaTang } from "./twinCanh";
import { readAppErrorMeta } from "../_core/appError";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
/** Tiền tố để `afterAll` dọn đúng hàng của lưới này, không đụng dữ liệu khác. */
const TIEN_TO = "ZZTEST-D3-CHAN2-";

/** Nhà máy dùng để đo. `luuToaNha` kiểm phạm vi, scope undefined = không giới hạn. */
const FACTORY_ID = 1;

const CO_BAN = {
  factoryId: FACTORY_ID,
  ten: "Xuong lưới CHẶN-2",
  rongMm: 84_000,
  sauMm: 30_000,
  caoMm: 12_000,
};

let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("Đợt 3 CHẶN-2 (mig 0355) — trùng mã: xoá mềm không được chiếm chỗ vĩnh viễn", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    // Xoá CỨNG mọi hàng lưới đã tạo. `twin_tang` CASCADE theo `twin_toa_nha`.
    await sql`DELETE FROM twin_toa_nha WHERE ma LIKE ${TIEN_TO + "%"}`;
    await sql.end();
  });

  it("cầu chì: nhà máy dùng để đo phải TỒN TẠI, nếu không mọi ca dưới xanh giả", async () => {
    // Không có cầu chì này, `luuToaNha` trả `null` vì ngoài phạm vi và mọi
    // assertion "không ném lỗi" bên dưới đúng một cách vô nghĩa.
    const [nm] = await sql`SELECT id FROM factories WHERE id = ${FACTORY_ID}`;
    expect(nm, `factories.id=${FACTORY_ID} phải có thật trong DB đang đo`).toBeTruthy();
  });

  it("★★★ TOÀ NHÀ — xoá mềm rồi TẠO LẠI cùng mã phải THÀNH CÔNG (ngõ cụt đã mở)", async () => {
    const ma = TIEN_TO + "TN-" + Date.now();

    const dau = await luuToaNha({ ...CO_BAN, ma });
    expect(dau, "tạo lần đầu phải được").toBeTruthy();
    expect(dau!.isActive).toBe(true);

    const daXoa = await xoaToaNha(dau!.id);
    expect(daXoa!.isActive, "xoá phải là xoá MỀM, hàng vẫn nằm trong bảng").toBe(false);

    // Đây là ca hỏng gốc: trước 0355 dòng này ném 23505.
    const lai = await luuToaNha({ ...CO_BAN, ma, ten: "Dựng lại sau khi gõ nhầm" });
    expect(lai, "tạo lại cùng mã sau xoá mềm phải THÀNH CÔNG").toBeTruthy();
    expect(lai!.id).not.toBe(dau!.id);
    expect(lai!.isActive).toBe(true);
  });

  it("★★★ TOÀ NHÀ — trùng mã với hàng ĐANG SỐNG vẫn bị chặn, bằng CONFLICT và KHÔNG rò SQL", async () => {
    const ma = TIEN_TO + "TNS-" + Date.now();
    await luuToaNha({ ...CO_BAN, ma });

    let loi: unknown = null;
    try {
      await luuToaNha({ ...CO_BAN, ma, ten: "Trùng với hàng đang sống" });
    } catch (e) {
      loi = e;
    }

    expect(loi, "trùng mã giữa hai hàng SỐNG PHẢI bị chặn — 0355 không nới lỏng điều đó").toBeTruthy();
    expect((loi as { code?: string }).code).toBe("CONFLICT");
    expect(readAppErrorMeta(loi)?.appCode).toBe("ENTITY_DUPLICATE");
    expect(readAppErrorMeta(loi)?.appParams).toMatchObject({ entity: "twinToaNha" });

    // ★ Nửa thứ hai của lỗi gốc: thông điệp gửi đi KHÔNG được mang lược đồ.
    const thongDiep = String((loi as Error).message);
    expect(thongDiep).not.toMatch(/INSERT INTO|insert into/);
    expect(thongDiep).not.toMatch(/"rongMm"|"sauMm"|"quatW"|twin_toa_nha/);
    // …và PHẢI nói được người dùng vừa làm sai gì (có mã trong câu) + đường ra.
    expect(thongDiep).toContain(ma);
  });

  it("★ TOÀ NHÀ — nhánh SỬA cũng được bọc (vá xong phải kiểm NHÁNH KIA)", async () => {
    const maA = TIEN_TO + "TNA-" + Date.now();
    const maB = TIEN_TO + "TNB-" + Date.now();
    await luuToaNha({ ...CO_BAN, ma: maA });
    const b = await luuToaNha({ ...CO_BAN, ma: maB });

    let loi: unknown = null;
    try {
      // Sửa B sang mã của A — cùng ràng buộc, khác nhánh mã nguồn.
      await luuToaNha({ ...CO_BAN, id: b!.id, ma: maA });
    } catch (e) {
      loi = e;
    }
    expect(loi, "SỬA sang một mã đã có phải bị chặn").toBeTruthy();
    expect((loi as { code?: string }).code).toBe("CONFLICT");
    expect(String((loi as Error).message)).not.toMatch(/update .*twin_toa_nha|"quatW"/);
  });

  it("★★★ TẦNG — cùng kịch bản: xoá mềm rồi tạo lại cùng capSo phải THÀNH CÔNG", async () => {
    const ma = TIEN_TO + "TG-" + Date.now();
    const toa = await luuToaNha({ ...CO_BAN, ma });

    const t1 = await luuTang({
      toaNhaId: toa!.id, capSo: 2, ten: "Tầng 2", caoDoMm: 0, caoThongThuyMm: 6000,
    });
    expect(t1).toBeTruthy();

    const daXoa = await xoaTang(t1!.id);
    expect(daXoa!.isActive).toBe(false);

    const t2 = await luuTang({
      toaNhaId: toa!.id, capSo: 2, ten: "Tầng 2 dựng lại", caoDoMm: 0, caoThongThuyMm: 6000,
    });
    expect(t2, "tạo lại cùng capSo sau xoá mềm phải THÀNH CÔNG").toBeTruthy();
    expect(t2!.id).not.toBe(t1!.id);
  });

  it("★★★ TẦNG — trùng capSo với tầng ĐANG SỐNG vẫn bị chặn bằng CONFLICT, không rò SQL", async () => {
    const ma = TIEN_TO + "TGS-" + Date.now();
    const toa = await luuToaNha({ ...CO_BAN, ma });
    await luuTang({ toaNhaId: toa!.id, capSo: 3, ten: "Tầng 3", caoDoMm: 0, caoThongThuyMm: 6000 });

    let loi: unknown = null;
    try {
      await luuTang({
        toaNhaId: toa!.id, capSo: 3, ten: "Tầng 3 trùng", caoDoMm: 0, caoThongThuyMm: 6000,
      });
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeTruthy();
    expect((loi as { code?: string }).code).toBe("CONFLICT");
    expect(readAppErrorMeta(loi)?.appParams).toMatchObject({ entity: "twinTang" });
    expect(String((loi as Error).message)).not.toMatch(/insert into|"caoThongThuyMm"|twin_tang/);
  });

  it("★ ràng buộc trong DB thật sự mang vị từ isActive (đo catalog, không tin migration file)", async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename IN ('twin_toa_nha','twin_tang')
        AND indexname IN ('uq_twin_toa_nha_factory_ma_song','uq_twin_tang_toa_nha_cap_song')`;
    expect(rows.length, "cả hai index partial phải tồn tại").toBe(2);
    for (const r of rows) expect(r.indexdef).toMatch(/WHERE "isActive"/);

    // …và ràng buộc CŨ (không vị từ) phải KHÔNG còn — nếu còn, nó vẫn chặn.
    const cu = await sql`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('uq_twin_toa_nha_factory_ma','uq_twin_tang_toa_nha_cap')`;
    expect(cu.length, "ràng buộc cũ không vị từ phải đã bị bỏ").toBe(0);
  });
});
