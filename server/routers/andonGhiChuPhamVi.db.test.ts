/**
 * CỔNG CSDL THẬT — ĐỢT 25 VIỆC 2: **GHI CHÚ XỬ LÝ CHO MỘT CẢNH BÁO ANDON.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * Đo 2026-09-15 trên `aoi_management`: `andon_events` có **21 cột** và **0** cột
 * ghi chú. Thủ tục duy nhất nhận `notes` là `andon.resolve`, và
 * `server/services/andon/andonService.ts:276` khi resolve thì
 *
 *     status='resolved', resolvedAt=now(), …, message: notes ?? current.message
 *
 * ⇒ nối nút "ghi chú" của ngăn xử lý vào `resolve` sẽ vừa **ĐÓNG** cảnh báo vừa
 *   **XOÁ mô tả gốc của người báo**. Cả hai hậu quả đều bị lưới này canh, và cả
 *   hai đều ở CHIỀU DƯƠNG (dễ mất hơn chiều âm).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ BA TRỤC ĐO, KHÔNG PHẢI MỘT
 * ══════════════════════════════════════════════════════════════════════════════
 *   §1 NGHIỆP VỤ — nhiều người ghi vào CÙNG một sự cố, mỗi dòng giữ được TÁC GIẢ
 *      và THỜI ĐIỂM, và **không ai đè mất dòng của ai**. Đây là câu hỏi quyết
 *      định hình dạng dữ liệu (bảng riêng, không phải một cột).
 *   §2 PHẠM VI — `id` cảnh báo do client TỰ KHAI, nên `ghiChu`/`danhSachGhiChu`
 *      phải đi qua ĐÚNG cổng `congPhamViAndon` mà `acknowledge`/`resolve` dùng:
 *      ngoài phạm vi ⇒ `NOT_FOUND`, KHÔNG phải `FORBIDDEN`.
 *   §3 RBAC — hai trục khác nhau, và phải TÁCH RỜI ĐƯỢC. Một tài khoản có
 *      `andon/canView` nhưng không `canEdit` phải ĐỌC được ghi chú và KHÔNG ghi
 *      được — nếu ô (−) của §2 xanh vì `PERMISSION_DENIED` thì nó xanh vì cổng
 *      SAI và vẫn xanh y hệt khi bản vá phạm vi bị gỡ (G43).
 *
 * ★ G22 — không dựa vào dữ liệu seed nào: tự dựng 2 nhà máy · 2 chuyền · 2 trạm ·
 *   2 máy · 2 cảnh báo · 3 người dùng, rồi xoá đúng chừng ấy từ trong ra ngoài.
 * ★ G5 — mọi ca dựng dữ kiện KHÁC RỖNG; ô "dữ kiện nền" đầu mỗi khối là cầu chì
 *   chống "xanh vì không đọc được gì".
 * ★ G20 — import CHÍNH `andonRouter` của module giao hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { andonRouter } from "./andonRouter";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `GHICHU-${Date.now()}`;

/** Vai KHÔNG phải admin (admin bypass `requirePermission` ⇒ đo bằng admin = đo số 0). */
const VAI = "engineer";

/** Mô tả gốc của người báo — ô mà `resolve` sẽ ghi đè, và `ghiChu` KHÔNG được chạm. */
const MO_TA_GOC = "Kẹt phôi ở băng tải, đã thử gạt tay";

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongCode: string;
  facTrongId: number;
  facNgoaiId: number;
  workshopIds: number[];
  lineIds: number[];
  tramIds: number[];
  mayTrongId: number;
  mayNgoaiId: number;
  andonTrongId: number;
  andonNgoaiId: number;
  /** Gán nhà máy A, `andon` canView + canEdit. */
  userTrongId: number;
  /** 0 gán, CÙNG quyền — (G43) chỉ khác người trên ở bản gán. */
  userKhongGanId: number;
  /** Gán nhà máy A, `andon` canView nhưng KHÔNG canEdit — tách trục RBAC khỏi trục phạm vi. */
  userChiXemId: number;
}
let fx: Fixture | null = null;

async function taoNhanh(code: string) {
  const f = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${`${code} nha may`}) RETURNING id`;
  const factoryId = (f[0] as unknown as { id: number }).id;
  const w = await sql`
    INSERT INTO workshops ("factoryId", code, name)
    VALUES (${factoryId}, ${`${code}-W`}, ${`${code} xuong`}) RETURNING id`;
  const workshopId = (w[0] as unknown as { id: number }).id;
  const l = await sql`
    INSERT INTO production_lines ("workshopId", code, name)
    VALUES (${workshopId}, ${`${code}-L`}, ${`${code} chuyen`}) RETURNING id`;
  const lineId = (l[0] as unknown as { id: number }).id;
  const s = await sql`
    INSERT INTO stations ("lineId", code, name)
    VALUES (${lineId}, ${`${code}-S`}, ${`${code} tram`}) RETURNING id`;
  const stationId = (s[0] as unknown as { id: number }).id;
  // ⚠ `machineType` là enum NOT NULL — bỏ ra thì INSERT ném 23502.
  const m = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType")
    VALUES (${stationId}, ${`${code}-M`}, ${`${code} may`}, 'AOI') RETURNING id`;
  const machineId = (m[0] as unknown as { id: number }).id;
  const a = await sql`
    INSERT INTO andon_events (state, reason, status, title, message, "machineId", "stationId", "lineId", "raisedBySystem", "raisedAt")
    VALUES ('red', 'quality', 'raised', ${`${code}-ANDON`}, ${MO_TA_GOC}, ${machineId}, ${stationId}, ${lineId}, true, now())
    RETURNING id`;
  const andonId = (a[0] as unknown as { id: number }).id;
  return { factoryId, workshopId, lineId, stationId, machineId, andonId };
}

/**
 * ★★★ G43 — "BỊ CHẶN" CHƯA ĐỦ; PHẢI CHẶN **TỪ CỔNG NÀO**.
 *
 * Một `rejects.toThrow()` trần xanh y hệt khi `requirePermission` chặn trước — tức
 * xanh mà chưa hề chạm cổng phạm vi, và vẫn xanh khi cổng phạm vi bị gỡ sạch.
 */
async function chanBoiPhamVi(p: Promise<unknown>): Promise<void> {
  let err: any = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "phải BỊ CHẶN, nhưng lời gọi đã THÀNH CÔNG").not.toBeNull();
  const appCode = err?.cause?.appCode ?? err?.appCode ?? err?.shape?.data?.appCode;
  expect(appCode, `chặn bởi cổng SAI: appCode=${appCode}`).not.toBe("PERMISSION_DENIED");
  expect(appCode).toBe("ENTITY_NOT_FOUND");
}

/** Chiều ngược lại của G43: ô này đòi cổng **RBAC** chặn, không phải cổng phạm vi. */
async function chanBoiRbac(p: Promise<unknown>): Promise<void> {
  let err: any = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "phải BỊ CHẶN, nhưng lời gọi đã THÀNH CÔNG").not.toBeNull();
  const appCode = err?.cause?.appCode ?? err?.appCode ?? err?.shape?.data?.appCode;
  expect(appCode).toBe("PERMISSION_DENIED");
}

function goi(userId: number, role: string = VAI) {
  return andonRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}

/** Đọc lại bằng SQL THÔ — mô hình thứ hai, không tin giá trị router trả về (BG-127). */
async function ghiChuCua(andonId: number) {
  const r = await sql`
    SELECT id, note, "createdBy", "createdAt" FROM andon_notes
     WHERE "andonId" = ${andonId} ORDER BY "createdAt" ASC, id ASC`;
  return r as unknown as Array<{ id: number; note: string; createdBy: number | null; createdAt: Date }>;
}

describe.skipIf(!DB_URL)("Đợt 25 Việc 2 — andon.ghiChu / danhSachGhiChu", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const trong = await taoNhanh(facTrongCode);
    const ngoai = await taoNhanh(`${DAU}-NGOAI`);

    const mkUser = async (suffix: string) => {
      const u = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`${DAU}-${suffix}`}, ${`${DAU}-${suffix}`}, ${`${DAU} ${suffix}`}, ${VAI}, true)
        RETURNING id`;
      return (u[0] as unknown as { id: number }).id;
    };
    const userTrongId = await mkUser("trong");
    const userKhongGanId = await mkUser("khonggan");
    const userChiXemId = await mkUser("chixem");

    // ⚠ `category` là ENUM `permissioncategoryenum` — một giá trị bịa ném 22P02.
    // ⚠ `moduleName` phải là tên ĐÃ RESOLVE (doc 40 alias), nếu không `checkPermission`
    //   không bao giờ đọc tới hàng vừa ghi và mọi ô (−) xanh vì 403.
    const capQuyen = async (userId: number, canEdit: boolean) => {
      await sql`
        INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
        VALUES (${userId}, 'andon'::permissioncategoryenum, ${resolvePermissionModule("andon")},
                true, true, ${canEdit}, false, false)`;
    };
    await capQuyen(userTrongId, true);
    await capQuyen(userKhongGanId, true);
    await capQuyen(userChiXemId, false);

    // ⚠ Nối bằng `factoryCode`, KHÔNG `factoryId` — bảng này không có cột ấy (42703).
    for (const uid of [userTrongId, userChiXemId]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${facTrongCode})`;
    }

    fx = {
      facTrongCode,
      facTrongId: trong.factoryId,
      facNgoaiId: ngoai.factoryId,
      workshopIds: [trong.workshopId, ngoai.workshopId],
      lineIds: [trong.lineId, ngoai.lineId],
      tramIds: [trong.stationId, ngoai.stationId],
      mayTrongId: trong.machineId,
      mayNgoaiId: ngoai.machineId,
      andonTrongId: trong.andonId,
      andonNgoaiId: ngoai.andonId,
      userTrongId,
      userKhongGanId,
      userChiXemId,
    };
  }, 60_000);

  afterAll(async () => {
    if (fx) {
      const uids = [fx.userTrongId, fx.userKhongGanId, fx.userChiXemId];
      // ⚠ Xoá ghi chú TƯỜNG MINH trước cảnh báo: `ON DELETE CASCADE` có làm việc ấy,
      //   nhưng một lưới dọn dấu vết của mình không được dựa vào nó (cùng luật
      //   `twin_dat_cho` ở `twinBonManApiVaiPhamVi.db.test.ts`).
      await sql`DELETE FROM andon_notes WHERE "andonId" = ANY(${[fx.andonTrongId, fx.andonNgoaiId]})`;
      await sql`DELETE FROM andon_events WHERE id = ANY(${[fx.andonTrongId, fx.andonNgoaiId]})`;
      await sql`DELETE FROM machines WHERE id = ANY(${[fx.mayTrongId, fx.mayNgoaiId]})`;
      await sql`DELETE FROM stations WHERE id = ANY(${fx.tramIds})`;
      await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lineIds})`;
      await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshopIds})`;
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM users WHERE id = ANY(${uids})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§0 — dữ kiện nền (cầu chì chống 'xanh vì không đọc được gì')", () => {
    it("fixture dựng được THẬT: hai máy khác nhau, hai cảnh báo khác nhau", () => {
      expect(fx).not.toBeNull();
      expect(fx!.mayTrongId).not.toBe(fx!.mayNgoaiId);
      expect(fx!.andonTrongId).not.toBe(fx!.andonNgoaiId);
    });

    it("★ bảng `andon_notes` CÓ THẬT và đúng 5 cột (migration 0357 đã áp lên DB test)", async () => {
      const r = await sql`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'andon_notes' ORDER BY ordinal_position`;
      expect((r as unknown as Array<{ column_name: string }>).map((x) => x.column_name)).toEqual([
        "id", "andonId", "note", "createdBy", "createdAt",
      ]);
    });

    it("★ hai cảnh báo bắt đầu ở `raised`, mang MÔ TẢ GỐC, và có 0 ghi chú", async () => {
      const r = await sql`
        SELECT id, status, message, "resolvedAt" FROM andon_events
         WHERE id = ANY(${[fx!.andonTrongId, fx!.andonNgoaiId]})`;
      const rows = r as unknown as Array<{ status: string; message: string; resolvedAt: Date | null }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((x) => x.status === "raised")).toBe(true);
      expect(rows.every((x) => x.message === MO_TA_GOC)).toBe(true);
      expect(rows.every((x) => x.resolvedAt === null)).toBe(true);
      expect(await ghiChuCua(fx!.andonTrongId)).toHaveLength(0);
    });

    it("★ ĐỐI CHỨNG DANH TÍNH — `userTrong`/`userChiXem` gán ĐÚNG MỘT nhà máy, `userKhongGan` gán 0", async () => {
      for (const uid of [fx!.userTrongId, fx!.userChiXemId]) {
        const g = await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${uid}`;
        expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([fx!.facTrongCode]);
      }
      const g0 = await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`;
      expect(g0).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§1 — NGHIỆP VỤ: nhiều người cùng xử lý MỘT sự cố", () => {
    it("★★★ CHIỀU (+) — ghi chú xuống CSDL THẬT, giữ nguyên chữ và ĐÓNG DẤU tác giả", async () => {
      const r: any = await goi(fx!.userTrongId).ghiChu({
        id: fx!.andonTrongId,
        note: "Đã kiểm cảm biến vào, chưa thấy lỗi",
      });
      expect(r?.id).toBeTypeOf("number");

      // Mô hình thứ hai — SQL thô, không tin giá trị router trả về.
      const rows = await ghiChuCua(fx!.andonTrongId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBe("Đã kiểm cảm biến vào, chưa thấy lỗi");
      expect(rows[0]!.createdBy).toBe(fx!.userTrongId);
      expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    });

    it("★★★ CẢNH BÁO **KHÔNG BỊ ĐÓNG**, và mô tả gốc của người báo CÒN NGUYÊN", async () => {
      // Đây là khuyết tật mà Việc 2 sinh ra để tránh: nối nút ghi chú vào
      // `andon.resolve` sẽ đặt `status='resolved'` VÀ `message = notes`.
      const r = await sql`
        SELECT status, message, "resolvedAt", "resolvedBy", "mttrSeconds"
          FROM andon_events WHERE id = ${fx!.andonTrongId}`;
      const row = r[0] as unknown as {
        status: string; message: string; resolvedAt: Date | null; resolvedBy: number | null; mttrSeconds: number | null;
      };
      expect(row.status).toBe("raised");
      expect(row.message).toBe(MO_TA_GOC);
      expect(row.resolvedAt).toBeNull();
      expect(row.resolvedBy).toBeNull();
      expect(row.mttrSeconds).toBeNull();
    });

    it("★★★ NGƯỜI THỨ HAI ghi vào CÙNG sự cố ⇒ HAI dòng, HAI tác giả, KHÔNG ai đè ai", async () => {
      // Câu hỏi nghiệp vụ nguyên văn của chủ dự án. Một cột `text` trên hàng cảnh
      // báo trả lời SAI ô này: dòng thứ hai sẽ đè mất dòng thứ nhất.
      await goi(fx!.userKhongGanId, "admin").ghiChu({
        id: fx!.andonTrongId,
        note: "Ca sau: đã thay dây curoa, theo dõi tiếp",
      });
      const rows = await ghiChuCua(fx!.andonTrongId);
      expect(rows).toHaveLength(2);
      expect(rows.map((x) => x.note)).toEqual([
        "Đã kiểm cảm biến vào, chưa thấy lỗi",
        "Ca sau: đã thay dây curoa, theo dõi tiếp",
      ]);
      expect(new Set(rows.map((x) => x.createdBy)).size).toBe(2);
      expect(rows[0]!.createdAt.getTime()).toBeLessThanOrEqual(rows[1]!.createdAt.getTime());
    });

    it("★★★ …và cảnh báo VẪN mở sau dòng thứ hai (ghi chú không bao giờ đóng việc)", async () => {
      const r = await sql`SELECT status, message FROM andon_events WHERE id = ${fx!.andonTrongId}`;
      const row = r[0] as unknown as { status: string; message: string };
      expect(row.status).toBe("raised");
      expect(row.message).toBe(MO_TA_GOC);
    });

    it("★★★ `danhSachGhiChu` trả CẢ HAI dòng, MỚI NHẤT TRƯỚC, kèm tác giả + thời điểm", async () => {
      const ds: any[] = await goi(fx!.userTrongId).danhSachGhiChu({ id: fx!.andonTrongId });
      expect(Array.isArray(ds)).toBe(true);
      expect(ds).toHaveLength(2);
      expect(ds[0].note).toBe("Ca sau: đã thay dây curoa, theo dõi tiếp");
      expect(ds[1].note).toBe("Đã kiểm cảm biến vào, chưa thấy lỗi");
      // Ba ô mà một cột `text` không thể mang: ai, lúc nào, dòng nào.
      for (const g of ds) {
        expect(g.id).toBeTypeOf("number");
        expect(g.createdBy).toBeTypeOf("number");
        expect(g.createdAt).toBeTruthy();
      }
    });

    it("★★★ `danhSachGhiChu` trả **TÊN** người ghi, không phải một số để đi tra bảng khác", async () => {
      // Câu hỏi nghiệp vụ là "AI đã thử gì?". Một `createdBy: 4711` không trả lời
      // được nó trên màn hình; ô này canh `LEFT JOIN users` không bị gỡ đi.
      const ds: any[] = await goi(fx!.userTrongId).danhSachGhiChu({ id: fx!.andonTrongId });
      const cuaToi = ds.find((g) => g.createdBy === fx!.userTrongId);
      expect(cuaToi, "không thấy dòng của chính người thử — ô này đang đo hư không").toBeTruthy();
      expect(cuaToi.tenNguoiGhi).toBe(`${DAU} trong`);
    });

    it("★ …và một ghi chú KHÔNG có tác giả vẫn HIỆN (LEFT JOIN, không phải JOIN)", async () => {
      // `createdBy` NULLABLE (đường hệ thống, hoặc tài khoản đã xoá). Với `JOIN`
      // thường, dòng ấy BIẾN MẤT khỏi hồ sơ sự cố — mất dữ liệu một cách câm.
      await sql`
        INSERT INTO andon_notes ("andonId", note, "createdBy")
        VALUES (${fx!.andonTrongId}, ${`${DAU} khong tac gia`}, NULL)`;
      const ds: any[] = await goi(fx!.userTrongId).danhSachGhiChu({ id: fx!.andonTrongId });
      const moCoi = ds.find((g) => g.note === `${DAU} khong tac gia`);
      expect(moCoi, "dòng không tác giả đã biến mất — đang dùng JOIN thay vì LEFT JOIN").toBeTruthy();
      expect(moCoi.tenNguoiGhi).toBeNull();
    });

    it("ghi chú RỖNG bị zod từ chối — 0 dòng thêm vào", async () => {
      const truoc = (await ghiChuCua(fx!.andonTrongId)).length;
      await expect(goi(fx!.userTrongId).ghiChu({ id: fx!.andonTrongId, note: "" })).rejects.toThrow();
      await expect(goi(fx!.userTrongId).ghiChu({ id: fx!.andonTrongId, note: "   " })).rejects.toThrow();
      expect(await ghiChuCua(fx!.andonTrongId)).toHaveLength(truoc);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§2 — PHẠM VI: `id` cảnh báo do client TỰ KHAI", () => {
    it("★★★ CHIỀU (−) — người gán A ghi chú lên cảnh báo của B ⇒ NOT_FOUND, và 0 dòng ghi", async () => {
      await chanBoiPhamVi(
        goi(fx!.userTrongId).ghiChu({ id: fx!.andonNgoaiId, note: `${DAU} xuyen tenant` }),
      );
      expect(await ghiChuCua(fx!.andonNgoaiId)).toHaveLength(0);
    });

    it("★★★ CHIỀU (−) — người 0 gán ghi chú lên cảnh báo CÓ THẬT của A ⇒ NOT_FOUND", async () => {
      const truoc = (await ghiChuCua(fx!.andonTrongId)).length;
      await chanBoiPhamVi(
        goi(fx!.userKhongGanId).ghiChu({ id: fx!.andonTrongId, note: `${DAU} 0 gan` }),
      );
      expect(await ghiChuCua(fx!.andonTrongId)).toHaveLength(truoc);
    });

    it("★★★ CHIỀU (−) — `danhSachGhiChu` trên cảnh báo của B ⇒ NOT_FOUND (không phải nội dung)", async () => {
      await chanBoiPhamVi(goi(fx!.userTrongId).danhSachGhiChu({ id: fx!.andonNgoaiId }));
    });

    it("★ ĐỐI CHỨNG CHỐNG VÁ QUÁ TAY — vai TOÀN QUYỀN vẫn ghi và đọc được ghi chú của B", async () => {
      await goi(fx!.userTrongId, "admin").ghiChu({ id: fx!.andonNgoaiId, note: `${DAU} admin ghi B` });
      const ds: any[] = await goi(fx!.userTrongId, "admin").danhSachGhiChu({ id: fx!.andonNgoaiId });
      expect(ds).toHaveLength(1);
      expect(ds[0].note).toBe(`${DAU} admin ghi B`);
    });

    it("cảnh báo KHÔNG TỒN TẠI ⇒ CÙNG một mã `NOT_FOUND` (không xác nhận cái nào có thật)", async () => {
      await chanBoiPhamVi(goi(fx!.userTrongId).ghiChu({ id: 2_000_000_000, note: "khong co" }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§3 — RBAC: trục KHÁC trục phạm vi, và phải tách rời được (G43)", () => {
    it("★★★ `andon/canView` mà KHÔNG `canEdit` ⇒ ghi chú bị chặn bởi **RBAC**, không phải phạm vi", async () => {
      const truoc = (await ghiChuCua(fx!.andonTrongId)).length;
      await chanBoiRbac(
        goi(fx!.userChiXemId).ghiChu({ id: fx!.andonTrongId, note: `${DAU} chi xem` }),
      );
      expect(await ghiChuCua(fx!.andonTrongId)).toHaveLength(truoc);
    });

    it("★★★ …CHÍNH người ấy vẫn ĐỌC được ghi chú của nhà máy mình (xem ≠ sửa)", async () => {
      const ds: any[] = await goi(fx!.userChiXemId).danhSachGhiChu({ id: fx!.andonTrongId });
      expect(ds.length).toBeGreaterThan(0);
    });
  });
});
